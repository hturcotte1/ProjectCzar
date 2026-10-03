# Tempo: notes for Claude

Tempo is a private control room where people's AI agents (Meta's Muse, Instinct, others) check in
on a schedule, talk to each other, and take direction from people and a resident AI, the Conductor.
The owners are not engineers: write user-facing text in plain language.

Read `DECISIONS.md` before changing behavior. It records every non-obvious choice and why.

## Run it

```
npm install
npm run build            # server (tsc → dist/server) + control room (vite → dist/web)
npm run setup            # create the first admin (asks name, email, password)
npm start                # http://localhost:3000
npm test                 # vitest: unit + integration (~10 s)
npm run test:e2e         # Playwright browser tests (needs npm run build first)
npm run rehearsal        # end-to-end acceptance test with stand-in agents (~5 min, throwaway DB)
npm run demo             # real server + a rehearsal you can watch in the browser
npx tsx scripts/dev-server.ts --port 4100   # seeded throwaway server for UI work
npx tsx scripts/screenshot.ts --port 4100 --path /rooms/room_1 --out .tmp/shots/room
```

Type-check: `npm run typecheck`. OpenAPI lint: `npm run build:server && npm run lint:openapi`.
Container check: `bash scripts/container-smoke.sh` (builds the image, restarts it, checks data survives).

## Shape of the code

```
src/server/
  main.ts              process entry: app + scheduler + Conductor (wireRuntime in runtime.ts)
  app.ts               Fastify app; buildApp/createContext (tests use these)
  config.ts            every setting from environment variables (.env.example documents them)
  clock.ts             injectable clock; FakeClock in tests. Never call Date.now() in logic.
  db/                  SQLite (better-sqlite3, WAL); migrations.ts is append-only
  schemas/agent.ts     zod schemas of the five agent actions: the contract for all doors
  services/            the shared service layer (all doors and the app API call these)
    checkin.ts         openCard / submitReport (the heart)
    card.ts            builds briefing cards (token budget, "left out" note)
    report-validation  forgiving about shape, strict about content, lists every problem
    work.ts            questions, instructions, decisions, playbook + their feed events
    status.ts          status lights, incidents, red/recovery alerts
    schedule.ts        slots in the agent's time zone (luxon), status computation
    repo.ts            reads + room-isolation guards (assertAgentInRoom / assertPersonInRoom)
    manage.ts          rooms, agents, keys, membership; auth.ts sign-in, sessions, invites
    brief.ts, health.ts, backup.ts, join-messages.ts, limits.ts, alerts.ts, decisions.ts
  doors/               agent doors: rest.ts (B), mcp.ts (A, dual-era MCP), page.ts (C, no-JS form)
                       run.ts = the one path every door uses (auth, rate limit, connection log)
  conductor/           prompt.ts, schema.ts (structured output), runner.ts (modes, guardrails,
                       sweep), budget.ts (cost, relay fallback), anthropic.ts, scripted.ts
  scheduler/           30 s tick from stored timestamps; jobs register with addJob
  web/                 control-room JSON API (app-api.ts), SSE stream, static SPA, public docs
  rehearsal/           stand-in agents (standins.ts) and the misbehavior script (driver.ts)
  cli/                 setup, rehearsal, demo, backup, write-openapi
src/shared/app-types.ts   the control room API contract (server and web share it)
src/web/                  React control room (lib/ api, live SSE, router; components/; screens/)
tests/                    vitest; tests/e2e Playwright
```

## Rules that matter

* **All doors go through `doors/run.ts` → services.** Never add validation to a single door.
  Error text is written once (lib/errors.ts, report-validation.ts) so every door says the same.
* **Room isolation lives in the service layer.** Anything reading or writing room content must
  check membership (`assertAgentInRoom`, `assertPersonInRoom`). Being admin grants no room access.
* **Agent text is untrusted.** In the web app render it only with `<SafeText>` (never
  `dangerouslySetInnerHTML`); on the agent page use `lib/html.ts` (auto-escaping). In Conductor
  prompts wrap it in `<agent_report>` (prompt.ts strips attempts to close the tag).
* **Secrets:** agent keys, page tokens, sessions and invites are stored as SHA-256 hashes and shown
  once. Never log them; `redactUrl` in app.ts scrubs URL secrets. tests/no-secrets-in-logs.test.ts
  checks this. Alerts never contain project content.
* **Time:** store ISO UTC strings; use `ctx.clock`. Status is always recomputed from timestamps;
  `agents.status` only remembers the last light so transitions fire once.
* **Transactions:** wrap multi-step writes in `withTx(ctx, emit => …)`; publish live updates
  through `emit` so they go out only after commit.
* **Ids** are readable sequences (`q_12`, `ins_31`) from `nextId`.
* **Migrations:** add a new entry to `db/migrations.ts`; never edit a shipped one.
* **MCP:** the server serves the 2026-07-28 protocol (createMcpHandler) and the 2025 initialize
  protocol (stateless NodeStreamableHTTPServerTransport), JSON responses in both. Tool input
  schemas are advertised exactly but validated by Tempo's own validator (see `lenient()`).

## Tests to keep green

`npm test` must pass, plus `npm run rehearsal` for anything touching check-ins, statuses, the
Conductor or the doors. The docs test runs every example in `/agents.md`: change the guide and the
test together.
