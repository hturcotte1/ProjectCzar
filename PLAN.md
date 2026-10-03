# Tempo build plan

Tempo is one Node.js process (web server, MCP endpoint, scheduler, Conductor) with a SQLite
database. Agents reach it through three doors that all call one shared service layer.
People watch and steer through a web control room.

**Lead (me) keeps:** database design, check-in service and its validation, sign-in, keys and
room isolation, the Conductor (prompt, schema, modes, budget), the scheduler, everything that
touches several parts at once, all integration, `DECISIONS.md`, and the final run of section 15.

**Delegated** pieces are marked `[delegate → model]`. Each gets a written brief, owns its own
files, and is checked by tests I run myself before it is accepted.

## Milestones

1. **Foundations.** Section 2 fact checks `[delegate → Sonnet researchers + verifier]`.
   Project skeleton, config, injectable clock, ids, error format, database schema and
   migrations, shared zod schemas for the agent actions. Commit.
2. **Check-in service + Door B (REST).** `openCard`, `submitReport`, `whoami`, `post`,
   `lookup` with full validation (every missing item listed at once), re-send updates in place,
   room isolation. REST routes, key auth, rate limits, connection log. Tests. Commit.
3. **Door A (MCP) + Door C (agent page).** Stateless streamable HTTP MCP server (me).
   Agent page: plain HTML form, works without JavaScript `[delegate → Sonnet]`.
   Tests proving all three doors store identical records (me). Commit.
4. **Schedules, status lights, alerts.** Schedule math in the agent's time zone (luxon),
   green/amber/red/gray from stored timestamps, incidents, once-per-incident alerts,
   scheduler tick (me). Email and ntfy channels `[delegate → Sonnet]`. Fake-clock tests. Commit.
5. **Control room.** Sign-in, sessions, CSRF, invites, JSON app API, live updates over SSE
   with polling fallback (me). React screens built on a fixed API contract and shared UI kit
   (me), individual screens `[delegate → Sonnet, one screen group each]`. Commit.
6. **Conductor.** Prompt, structured output schema, one retry, three modes, decisions,
   limits guard, budget + rate cap, relay fallback banner, readable log, debounce and sweep
   (me). Tests with a scripted model. Commit.
7. **Join messages, playbook, daily brief, room health, settings, export, backup.**
   Join/re-arm message generator `[delegate → Sonnet]`, brief, health, backup (me),
   remaining settings screens `[delegate → Sonnet]`. Commit.
8. **Rehearsal + demo.** Stand-in agents (Door A via official MCP client, Door B/C
   alternating), scripted misbehavior, pass/fail report `[stand-ins delegate → Sonnet]`;
   driver, sandbox room, in-app button (me). Commit.
9. **Hardening + documents + container.** Section 11 review (adversarial review workflow),
   OpenAPI 3.1 + `/agents.md` `[delegate → Sonnet]`, README / owner guide / first real
   test `[delegate → Sonnet, reviewed by me]`, Dockerfile + `railway.json` + `fly.toml`
   `[delegate → Sonnet]`. Commit.
10. **Verification + report + deploy.** Run every section 15 item and the full rehearsal,
    write the final report, then deploy with you.

## Stack (details and reasons in DECISIONS.md)

TypeScript on Node 24 LTS · Fastify 5 · better-sqlite3 (WAL, numbered SQL migrations) ·
zod 4 (one schema set for all doors, also generates the OpenAPI document) ·
`@modelcontextprotocol/sdk` 1.x · `@anthropic-ai/sdk` · luxon · argon2id · React + Vite for
the control room · vitest + Playwright for tests.
