# Decisions

Every choice where the brief was silent, where two requirements pulled against each other, or
where the outside world turned out different from the brief. Each entry says what was chosen,
what was rejected, and why. Newest sections are at the bottom of each part.

---

## Part 1: What the section 2 fact checks changed (checked 2026-10-03)

The checks were delegated to five Sonnet researcher agents (one per topic) with a second,
skeptical verifier pass on the two build-critical topics (MCP SDK, hosting). Sources are listed
in the research notes; the conclusions that changed the build are below.

### 1.1 The MCP SDK and protocol moved on

* **Found:** `@modelcontextprotocol/sdk` 1.32 is now the *maintenance* line. The official SDK's
  current line is v2 (since 2026-07-27), published as `@modelcontextprotocol/server` and
  `@modelcontextprotocol/client` (plus adapters such as `@modelcontextprotocol/node`). The current
  MCP spec is **2026-07-28**, which is stateless by design (no `initialize`, no sessions). Older
  clients still speak the 2025 protocol (which starts with `initialize`). Per the spec's
  compatibility table, a legacy-only server fails modern clients, and a modern-only server fails
  legacy clients. v2's `createMcpHandler` answers legacy clients over SSE, not JSON.
* **Chose:** a **dual-era** MCP server on the v2 packages (`@modelcontextprotocol/server` 2.3 +
  `@modelcontextprotocol/node` 2.1): modern requests go to `createMcpHandler(…, { legacy: 'reject',
  responseMode: 'json' })`; legacy requests (detected with the SDK's `isLegacyRequest`) go to a
  fresh stateless `NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
  enableJsonResponse: true })`. Both eras get JSON responses. Tests drive it with **both** official
  clients: v1 `@modelcontextprotocol/sdk` (initialize, list tools, call each) and v2
  `@modelcontextprotocol/client` (modern protocol).
* **Rejected:** v1-only server (would break modern clients as they roll out); v2 handler alone
  (legacy clients would get SSE, not the JSON the brief asks for).
* **Why it matters:** we don't know which SDK version Muse writes its client with. Serving both
  removes that unknown.

### 1.2 Muse

* **Confirmed:** cloud VM, public internet only, custom connectors built in chat, token auth in a
  standard header with the real key swapped in by Meta's egress layer, recurring tasks that run
  until cancelled, an approval layer, caution about outside instructions.
* **Changed / nuanced:**
  * Muse *speaking MCP* for custom connectors is described only by third parties (Parallel,
    Sprites). Other write-ups say custom connectors use REST/OpenAPI. **So Door B (REST +
    OpenAPI) is treated as first-class, not a fallback**, and the join message offers both.
  * Meta's own approval labels differ from "read-only / ask / allow". The prompt offers *Allow once,
    Allow for this task, Allow for this site, Always allow, Deny*; settings live under *Manage
    Permissions*, with a separate *Artifacts and scheduled task approvals* section. The join note
    tells the owner to choose **Always allow** and to check both places.
  * Meta's egress layer drops auto-allow for a process that has just read personal data
    ("tainted egress"), so an approval prompt can reappear even after "Always allow". This is in
    the first-real-test troubleshooting notes, and Tempo flags "card opened, no report" as the
    likely symptom.
  * No published minimum interval for recurring tasks; supported forms are daily, weekly or a
    custom interval. The join message states the schedule as explicit weekday times.
  * Keys in headers only is an inference, not a published rule; we design for it anyway.
  * "Nothing can wake Muse" is undocumented either way; we assume pull-only, as the brief says.

### 1.3 Instinct

* No MCP or API support (the bland.ai page is Bland describing what Instinct *would* need).
* It **now has its own email address** (since about Sept 9, 2026). Email stays out of scope
  (brief section 17), but the seam for a future email door is noted.
* No dependable built-in scheduler, so the owner-side scheduled text stays.
* iPhone Shortcuts "Time of Day" automations can send an **iMessage** without a tap; WhatsApp
  automations are unreliable (may need a tap). Each automation runs at one time of day, so the tip
  says to make one per check-in time. The tip says "iMessage is the dependable route".
* The brief's note that Instinct is "weak at holding standing rules" isn't in the cited article;
  it is treated as the owners' own experience and doesn't change the design.

### 1.4 Hosting: Railway config files are deprecated

* **Found:** Railway's "Config as Code" (`railway.json` / `railway.toml`) is deprecated: new
  services cannot use it since 2026-08-28 and it stops entirely on 2026-12-01. The replacement is
  infrastructure-as-code in `.railway/railway.ts`, applied with `railway config apply`, or settings
  made in the dashboard / CLI. Volumes are mounted at runtime only, as root. Railway prevents two
  deployments overlapping on a volume (so no double-writer risk, but a few seconds of downtime per
  deploy). Hobby is still $5/month including $5 of usage; there is now also a Free plan, but it
  can't keep a service always-on with restart policy "Always".
* **Chose:** ship `.railway/railway.ts` (the current mechanism) and do the deploy with CLI
  commands that don't depend on any config file. No `railway.json`.
* Fly.io fallback config (`fly.toml`) uses `auto_stop_machines = "off"` (the brief's
  `min_machines_running` has no effect with that setting, so it is left out).

### 1.5 Other checks

* Claude: `claude-sonnet-5-5` exists at **$2 / $10 per million input / output tokens**
  (confirmed). It runs adaptive thinking by default; structured output uses
  `output_config.format`.
* ntfy is still maintained and a good free choice. The public server allows about 250 messages
  per day per sender, and anyone who knows a topic name can read it, so topics must be long and
  random and alerts carry no project content (as the brief already requires).
* Node.js: the current LTS is **Node 24**; the container uses `node:24-bookworm-slim`.
* Claude Code subagents: the per-call `model` option exists; a lower effort level needs a
  definition file in `.claude/agents/`, which did not exist when this session started, so (as the
  brief says) per-call model choice is used instead.

---

## Part 2: Stack

| Piece | Choice | Why / rejected |
|---|---|---|
| Language/runtime | TypeScript 6.0 on Node 24 LTS | TypeScript 7 (native compiler) is brand new; 6.0 is the mature line. |
| Web framework | Fastify 5 | Mature, fast, per-route body limits, good hooks. Rejected Express (slower, fewer built-ins) and Hono (younger). |
| Database | SQLite via better-sqlite3, WAL mode | Synchronous API makes transactions simple and safe. Rejected `node:sqlite` (still experimental). |
| Migrations | Numbered SQL migrations in `src/server/db/migrations.ts`, tracked in `schema_migrations` | Boring and transparent; no ORM. |
| Validation | zod 4, one set of schemas for all three doors | Also generates the MCP tool schemas and the OpenAPI document. |
| Time zones | luxon | Real IANA time zones with daylight saving. |
| Passwords | argon2id (`@node-rs/argon2`) | Current OWASP recommendation; prebuilt binaries, no compiler needed. |
| Agent keys, page tokens, sessions | Random 192-bit secrets stored as SHA-256 hashes | Slow hashing is unnecessary for long random secrets and would slow every agent call. |
| Control room | React 19 + Vite, plain CSS with theme tokens | Mature and boring; clean JSON API boundary. |
| Agent page (Door C) | Server-rendered HTML, no JavaScript | Must work with JavaScript off. |
| Tests | vitest; Playwright for the browser checks | |

---

## Part 3: Design tensions and how they were resolved

1. **Forgiving doors vs strict reports.** Validation is forgiving about *shape* (a string where a
   list is expected, a map instead of a list, camelCase names, "in progress" for `in_progress`,
   a missing `room_id` when there is only one room) and strict about *content* (every required
   item, every length limit). Every problem is listed at once, with the exact field. Rejected:
   strict schema validation (Muse would hit opaque errors) and silently accepting partial reports
   (breaks the core promise).

2. **MCP input validation.** The MCP SDK normally validates tool inputs itself and answers with
   zod's technical messages. Tempo advertises exact JSON Schemas in `tools/list` but lets
   arguments through to its own shared validator, so all three doors reject the same things with
   the same plain words.

3. **Calling `tempo_check_in` twice.** A second call while the card is still open (20 minutes)
   returns **the same card**, so a retry or a page reload never loses anything. Rejected: a fresh
   card per call (a retry would invalidate the card the agent is working on).

4. **Late reports.** A card that isn't reported on within 20 minutes is marked as an incomplete
   check-in (a visible problem). A report that arrives later is still **accepted for 2 hours**
   if no newer card was opened, because an approval tap may have delayed it. The incomplete mark
   stays in the history.

5. **Re-sending a report** replaces the earlier version in place: the same report row, the same
   feed entries (updated), answers overwritten, instruction statuses only recorded if they
   changed, new questions/lessons matched by position so they aren't duplicated. A re-sent
   report must still be complete.

6. **When is an agent "on time"?** A completed check-in counts for every scheduled slot up to
   half an interval after it. So an agent on a steady cadence that isn't aligned to Tempo's grid
   (Muse's scheduler may drift) stays green. Amber = one slot missed past the grace period (or a
   card opened and not reported within 20 minutes); red = two slots missed. The working-hours end
   time is inclusive (8 am to 6 pm hourly means 11 check-ins).

7. **Readable ids.** Ids are short sequential numbers with a prefix (`q_12`, `ins_31`,
   `card_118`), matching the brief's examples and cheap in tokens. Isolation never relies on ids
   being secret; every read and write checks room membership in the service layer.

8. **Disagreements.** The brief wants a decision "when two agents disagree" even without the
   Conductor. Reports gained an optional `disagreements` list per room (`with`, `about`,
   `my_view`); each entry becomes a decision for people. The Conductor can also raise one.

9. **Limits safety net.** Besides telling the Conductor the limits, Tempo runs a plain keyword
   check (money, outside contact, deleting, sharing outside) on Conductor instructions and on
   agents' questions to people/the Conductor. Anything it flags becomes a decision, never an
   instruction. It errs toward asking a person.

10. **Agent names are unique** (case-insensitive), because agents address each other by name.

11. **Door C's link carries a secret in the URL**, unlike Muse's header-only rule. That is
    inherent to "a link a browser agent opens"; the page token is separate from the API key, the
    page sends `no-referrer`, loads nothing from third parties, and the token is redacted from
    logs. The full link is only shown when created or rotated; join messages generated later show
    a placeholder and a "rotate to get a fresh link" button.

12. **First contact.** A `tempo_whoami` call counts as the agent connecting (the light leaves
    gray). If setup stalls after that, the light goes amber then red and the owner is alerted,
    which is what you want during a first real test.

13. **People's questions to "the whole room"** become one question per agent, so each must
    answer. Instructions to the whole room likewise become one per agent.

14. **Sped-up sandbox clock.** Stand-in agents have a `clock_speed` (e.g. 60×): every schedule
    duration (interval, grace, the 20-minute card window) is divided by it and working hours are
    ignored. This lets the in-app "Run rehearsal" button use a fast clock in one sandbox room
    while every real room keeps real time. Tests use the injectable fake clock instead.
