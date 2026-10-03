#!/usr/bin/env bash
# Container smoke test for Tempo.
#
# Builds the image, runs it with a fresh data volume, creates the first admin inside the container,
# signs in through the API, creates a room and an agent, calls the agent REST door with the agent's
# key, restarts the container and checks that everything survived the restart. Prints PASS or FAIL
# for each check, removes the container and the volume when it ends, and exits non-zero if
# anything failed.
#
# Run it from anywhere:  bash scripts/container-smoke.sh
#
# Optional settings (environment variables):
#   SMOKE_SKIP_BUILD=1       Reuse an existing tempo:smoke image instead of building it again.
#   SMOKE_KEEP=1             Leave the container and volume behind after the run, for debugging.
#   SMOKE_CA_BUNDLE=<file>   SANDBOX ONLY. Path to a CA bundle that is passed into the image build as
#                            a build secret (never stored in the image). Needed only where outbound
#                            HTTPS goes through a proxy with its own certificate authority, as in the
#                            Claude Code sandbox, where npm inside "docker build" otherwise fails
#                            with SELF_SIGNED_CERT_IN_CHAIN. If the variable is not set and the
#                            sandbox's bundle (/root/.ccr/ca-bundle.crt) exists, that is used. On a
#                            normal machine, and on Railway or Fly, nothing is passed and the
#                            Dockerfile builds unchanged.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="tempo:smoke"
RUN_ID="$$"
CONTAINER="tempo-smoke-${RUN_ID}"
VOLUME="tempo-smoke-data-${RUN_ID}"
ADMIN_NAME="Smoke Test"
ADMIN_EMAIL="smoke@example.com"
ADMIN_PASSWORD="smoke-pass-${RANDOM}${RANDOM}-ok"
ROOM_NAME="Smoke Room"
AGENT_NAME="Smoke Agent"

WORK="$(mktemp -d)"
COOKIES="${WORK}/cookies.txt"
BODY="${WORK}/body.json"
FAILURES=0
STARTED=0

# ---------------------------------------------------------------------------------- output helpers
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
note() { printf '      %s\n' "$1"; }
# A check that cannot be recovered from: the later steps depend on it.
die() { fail "$1"; exit 1; }

# ---------------------------------------------------------------------------------- JSON helpers
# jq if it is installed, otherwise python3. Both read JSON on stdin.
if command -v jq >/dev/null 2>&1; then
  json_field() { jq -er "$1"; }                       # json_field '.csrf_token'
  json_ids()   { jq -er '.[].id'; }                   # ids of a top-level array of objects
else
  json_field() {
    python3 -c '
import json, re, sys
value = json.load(sys.stdin)
for part in re.findall(r"[^.\[\]]+", sys.argv[1]):
    value = value[int(part)] if isinstance(value, list) else value[part]
if value is None:
    sys.exit(1)
print(value)
' "$1"
  }
  json_ids() { python3 -c 'import json, sys; [print(item["id"]) for item in json.load(sys.stdin)]'; }
fi

# ---------------------------------------------------------------------------------- cleanup
cleanup() {
  local code=$?
  if [ "$STARTED" = 1 ] && { [ "$code" != 0 ] || [ "$FAILURES" != 0 ]; }; then
    echo
    echo "---- last 40 lines of the container log ----"
    docker logs --tail 40 "$CONTAINER" 2>&1 || true
    echo "--------------------------------------------"
  fi
  if [ "${SMOKE_KEEP:-0}" = 1 ]; then
    echo "SMOKE_KEEP=1: leaving container ${CONTAINER} and volume ${VOLUME} in place."
  else
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  echo
  if [ "$code" != 0 ] || [ "$FAILURES" != 0 ]; then
    echo "RESULT: FAIL (${FAILURES} failed check(s))"
    [ "$code" = 0 ] && code=1
  else
    echo "RESULT: PASS (all checks passed)"
  fi
  exit "$code"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------------- HTTP helper
# http METHOD PATH [extra curl arguments...]
# Sets STATUS (the HTTP status code) and leaves the response body in $BODY.
http() {
  local method=$1 path=$2
  shift 2
  STATUS=$(curl -sS --noproxy '*' --max-time 20 -o "$BODY" -w '%{http_code}' -X "$method" "${BASE_URL}${path}" "$@" || true)
}

# Signs in as the admin. Sets CSRF. Fatal if it does not work.
sign_in() {
  http POST /api/app/login -c "$COOKIES" \
    -H 'content-type: application/json' -H 'x-requested-with: tempo' \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}"
  [ "$STATUS" = 200 ] || die "sign in (POST /api/app/login) returned ${STATUS}: $(head -c 300 "$BODY")"
  CSRF=$(json_field '.csrf_token' <"$BODY") || die "the sign-in response had no csrf_token"
}

wait_for_health() {
  local what=$1 i
  for i in $(seq 1 60); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != true ]; then
      die "${what}: the container stopped before it became healthy"
    fi
    if curl -fsS --noproxy '*' --max-time 3 -o "$BODY" "${BASE_URL}/healthz" 2>/dev/null; then
      pass "${what}: /healthz answered after about ${i}s ($(tr -d '\n' <"$BODY"))"
      return 0
    fi
    sleep 1
  done
  die "${what}: /healthz did not answer within 60 seconds"
}

# ---------------------------------------------------------------------------------- 1. build
command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable"

if [ "${SMOKE_SKIP_BUILD:-0}" = 1 ]; then
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "SMOKE_SKIP_BUILD=1 but there is no ${IMAGE} image"
  note "skipping the build (SMOKE_SKIP_BUILD=1)"
else
  BUILD_ARGS=()
  CA_BUNDLE="${SMOKE_CA_BUNDLE:-}"
  if [ -z "$CA_BUNDLE" ] && [ -f /root/.ccr/ca-bundle.crt ]; then CA_BUNDLE=/root/.ccr/ca-bundle.crt; fi  # sandbox only
  if [ -n "$CA_BUNDLE" ]; then
    BUILD_ARGS+=(--secret "id=cabundle,src=${CA_BUNDLE}")
    note "sandbox only: passing ${CA_BUNDLE} to the build as a build secret"
  fi
  echo "Building ${IMAGE} (the first build can take a few minutes)..."
  if DOCKER_BUILDKIT=1 docker build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} -t "$IMAGE" . >"${WORK}/build.log" 2>&1; then
    pass "docker build -t ${IMAGE} ."
  else
    tail -40 "${WORK}/build.log"
    die "docker build failed"
  fi
fi
SIZE_BYTES=$(docker image inspect -f '{{.Size}}' "$IMAGE")
note "image size as reported by docker: $((SIZE_BYTES / 1024 / 1024)) MB"

# ---------------------------------------------------------------------------------- 2. start
if command -v python3 >/dev/null 2>&1; then
  PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
else
  PORT=$(node -e 'const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); })')
fi
BASE_URL="http://localhost:${PORT}"

docker volume create "$VOLUME" >/dev/null
docker run -d --name "$CONTAINER" \
  -p "127.0.0.1:${PORT}:3000" \
  -e "BASE_URL=${BASE_URL}" \
  -v "${VOLUME}:/data" \
  "$IMAGE" >/dev/null
STARTED=1
note "container ${CONTAINER} on ${BASE_URL}, volume ${VOLUME}"
wait_for_health "first start"

# The container's own health check command, run once by hand (its first automatic run is 30 s away).
HEALTH_CMD=$(docker inspect -f '{{json .Config.Healthcheck.Test}}' "$IMAGE" | json_field '.[1]') || die "the image has no HEALTHCHECK"
if docker exec "$CONTAINER" sh -c "$HEALTH_CMD" >/dev/null 2>&1; then
  pass "the image's HEALTHCHECK command succeeds inside the container"
else
  fail "the image's HEALTHCHECK command failed inside the container"
fi

if docker exec "$CONTAINER" test -s /data/tempo.db; then
  pass "the database file is on the volume (/data/tempo.db)"
else
  fail "no database file at /data/tempo.db"
fi

# ---------------------------------------------------------------------------------- 3. admin
# Same non-interactive form as on a real host: name and email as variables, password on stdin.
if printf '%s\n' "$ADMIN_PASSWORD" | docker exec -i "$CONTAINER" sh -c \
  "TEMPO_ADMIN_NAME='${ADMIN_NAME}' TEMPO_ADMIN_EMAIL='${ADMIN_EMAIL}' node dist/server/cli/setup.js --password-stdin" \
  >"${WORK}/setup.log" 2>&1; then
  pass "first admin created inside the container (node dist/server/cli/setup.js --password-stdin)"
else
  cat "${WORK}/setup.log"
  die "the setup command failed"
fi

# ---------------------------------------------------------------------------------- 4. use the API
sign_in
pass "signed in through POST /api/app/login (got a session cookie and a CSRF token)"

http POST /api/app/rooms -b "$COOKIES" \
  -H 'content-type: application/json' -H "x-csrf-token: ${CSRF}" \
  -d "{\"name\":\"${ROOM_NAME}\"}"
[ "$STATUS" = 200 ] || die "creating a room returned ${STATUS}: $(head -c 300 "$BODY")"
ROOM_ID=$(json_field '.id' <"$BODY") || die "the room response had no id"
pass "created a room (${ROOM_ID})"

http POST /api/app/agents -b "$COOKIES" \
  -H 'content-type: application/json' -H "x-csrf-token: ${CSRF}" \
  -d "{\"name\":\"${AGENT_NAME}\",\"type\":\"other\",\"room_ids\":[\"${ROOM_ID}\"]}"
[ "$STATUS" = 200 ] || die "creating an agent returned ${STATUS}: $(head -c 300 "$BODY")"
AGENT_KEY=$(json_field '.api_key' <"$BODY") || die "the agent response had no api_key"
pass "created an agent and received its API key"

http GET /api/v1/agent/whoami -H "Authorization: Bearer ${AGENT_KEY}"
if [ "$STATUS" = 200 ]; then pass "GET /api/v1/agent/whoami with the agent key returned 200"; else fail "whoami returned ${STATUS}: $(head -c 300 "$BODY")"; fi

http GET /
if [ "$STATUS" = 200 ] && grep -q '<div id="root">' "$BODY"; then
  pass "GET / returns the control room page (contains <div id=\"root\">)"
else
  fail "GET / returned ${STATUS} and did not contain <div id=\"root\">"
fi

http GET /agents.md
if [ "$STATUS" = 200 ]; then pass "GET /agents.md returned 200"; else fail "GET /agents.md returned ${STATUS}"; fi

# ---------------------------------------------------------------------------------- 5. restart
# docker restart sends SIGTERM and waits (here up to 20 s) before it kills the process. Tempo should
# answer SIGTERM at once: close the server, flush the database and exit. A slow restart would mean
# the signal never reached node (for example a shell as process 1).
RESTART_START=$SECONDS
docker restart -t 20 "$CONTAINER" >/dev/null
RESTART_TOOK=$((SECONDS - RESTART_START))
if docker logs "$CONTAINER" 2>&1 | grep -q '"msg":"shutting down"' && [ "$RESTART_TOOK" -lt 15 ]; then
  pass "graceful shutdown: Tempo handled SIGTERM itself (restart took ${RESTART_TOOK}s)"
else
  fail "no graceful shutdown seen in the log, or the restart took ${RESTART_TOOK}s (SIGTERM may not reach node)"
fi
wait_for_health "after restart"

# ---------------------------------------------------------------------------------- 6. data survived
rm -f "$COOKIES"
sign_in
pass "signed in again after the restart (the admin survived)"

http GET /api/app/rooms -b "$COOKIES"
if [ "$STATUS" = 200 ] && json_ids <"$BODY" | grep -qx "$ROOM_ID"; then
  pass "GET /api/app/rooms still lists ${ROOM_ID} after the restart"
else
  fail "GET /api/app/rooms (status ${STATUS}) does not list ${ROOM_ID} after the restart"
fi

http GET /api/v1/agent/whoami -H "Authorization: Bearer ${AGENT_KEY}"
if [ "$STATUS" = 200 ]; then pass "the agent key still works after the restart (whoami 200)"; else fail "whoami after the restart returned ${STATUS}: $(head -c 300 "$BODY")"; fi

http GET /
if [ "$STATUS" = 200 ] && grep -q '<div id="root">' "$BODY"; then pass "GET / still serves the control room after the restart"; else fail "GET / after the restart returned ${STATUS}"; fi

# The final summary and the exit code come from the cleanup trap.
