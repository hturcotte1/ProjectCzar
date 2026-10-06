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
   instruction. It errs toward asking a person. (Rewritten after the outside review: see item 39.)

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

15. **The Conductor's cost control has a cheap pre-check.** The brief says the Conductor runs about
    45 seconds after every completed check-in. At hourly check-ins for four agents that is ~40
    runs a day, which at Sonnet 5.5 prices would blow the $15 budget. So every run happens and is
    logged, but when the only triggers are routine check-ins that bring no news (same `working_on`,
    nothing finished, no notes, questions, blockers or status changes) the model is **not called**
    and the log says "nothing new". People's messages, instructions, goal changes, decisions and
    stale items always reach the model. Identical consecutive skips within an hour are merged into
    one log line so the log stays readable.

16. **The 15-minute sweep** looks for stale items (a question unanswered for two intervals, an
    instruction with no movement for a day, a blocked or red agent). It calls the model only when
    something is stale, and not again for the same stale picture for two hours, to bound cost.

17. **Approval-needed instructions.** In every mode, an instruction the Conductor flags as needing
    approval, or that the limits check flags, becomes a decision carrying the proposed instruction.
    Choosing the first option ("Approve and send it") creates the instruction. In propose mode,
    ordinary Conductor instructions wait as proposals (approve, edit-then-approve, or reject).

18. **What relay mode may do.** Relay originates no work: the Conductor's own instructions and
    instruction changes are dropped (and the log says so). It may still route a person's request
    (an instruction whose `routed_from` points at a person's message or question that it saw),
    answer questions addressed to it from facts in front of it, ask clarifying questions, raise
    decisions and post room notes.

19. **The Conductor never cancels or rewords a person's instruction**, only its own.

20. **Budget scope.** One monthly budget covers all rooms, including model-written daily briefs.
    When it runs out, every room shows the relay banner and no model calls are made.

21. **Scripted Conductor for sandbox rooms.** With no API key, real rooms run in relay mode (as
    the brief requires). Sandbox rooms instead use a small, clearly labeled rules-based stand-in
    ("scripted rehearsal Conductor", $0) so a rehearsal or demo still shows the whole loop:
    instructions on cards, overlap redirected, outside-limits requests turned into decisions.
    With a key, sandbox rooms use the real model.

22. **Refusals and failures.** A model refusal, a cut-off reply or schema-invalid output gets one
    retry with the problem explained; a second failure is logged as a failed run and nothing is
    applied. The API's server-side refusal fallback (a beta feature) is not used, because failing
    safe is acceptable here and it could not be tested without a key.

23. **Rehearsal timing.** Stand-ins check in every 30 sped-up minutes at 60× speed, i.e. every 30
    seconds, with a 15-second grace period and a 20-second card window. The whole script, including
    waiting for an agent to go amber and then red, takes about five minutes. Stand-in A uses the
    MCP door and alternates the official v1 and v2 SDK clients (both protocol versions); stand-in B
    alternates REST and the agent page. `npm run rehearsal` uses a throwaway database by default
    (`--use-data` runs it against the real one); `npm run demo` and the in-app button use the real
    database and leave the sandbox room behind for review, with the stand-ins paused and their keys
    revoked. Only the two most recent sandbox rooms stay visible.

24. **Link previews don't open cards.** Messaging apps fetch links to draw previews (iMessage,
    WhatsApp…). If that opened a card, the preview would start a check-in that then times out. The
    agent page recognizes preview bots and HEAD requests and serves a tiny page without opening a
    card. A real browser is unaffected.

25. **Health and status use the same rule.** A check-in counts for the slot half an interval before
    it, including an agent's very first check-in.

26. **Daily brief.** On the room's working days at its brief time (default 7:30 am room time); a
    brief missed because the server was down is written as soon as it is back, the same day. Never
    for sandbox rooms. Written by the Conductor's model when available and within budget (from the
    same facts as the rules-based version, with agent text marked untrusted), otherwise the
    rules-based version. Emailed to the room's people if email is set up. Note: unlike alerts, the
    brief necessarily contains project content, so it goes only by email, never by push.

27. **Backups.** Nightly at 3:00 am (default time zone) to `DATA_DIR/backups`, keeping 7, using
    SQLite's online backup (safe while running). The "download a backup" button is admin-only and
    audited. Tension: a full backup contains every room, while "being admin does not grant access to
    a room's content". Resolution: the backup is a disaster-recovery file for the operator, who
    already has the same data on the server's disk; it is never shown in the app, only downloaded,
    and each download is in the audit log.

28. **Security finding fixed during the build.** The no-secrets-in-logs test found that invite
    tokens could appear in request logs (the invite-check API path, and the framework's default
    "route not found" message). Both are now redacted. Agent page tokens were already redacted.

29. **Container user.** The container runs as root because Railway (and Fly) mount volumes as root.
    It is a single-purpose container with no other services.

30. **Build tools in the image.** better-sqlite3 ships a ready-made binary, but npm still runs its
    build step during install, which needs python3 and make. They are installed in the build stage
    only; the final image has just Node, the production packages and the compiled app (about 100 MB
    compressed). Rejected: an Alpine image (native modules would need compiling against musl) and a
    distroless image (no shell for `railway ssh` to create the first admin).

31. **Hosting config as code.** Railway now takes its settings from `.railway/railway.ts` (the
    old `railway.json` is deprecated, see Part 1). Secrets and the public address are never in that
    file, because it is in git; they are set with `railway variable set`. The same settings are
    listed in plain words at the top of the file for anyone who prefers the dashboard.

32. **Manual backups and restore.** `npm run backup` writes a copy any time (safe while running)
    next to the nightly ones; manual copies are never pruned. Restoring is deliberately not a
    button: you stop Tempo, replace the file and start it again, so a mistaken click can never
    overwrite the live database. The owner guide explains the steps.

33. **Where the "Run rehearsal" button lives.** On its own page in the sidebar rather than inside a
    room, because a rehearsal creates its own sandbox room and must never touch a real one. Any
    signed-in person can start one; only one runs at a time, and it is capped at 20 rounds (the full script needs 8).

34. **Security review (milestone 9).** Five independent reviewers each attacked one area (sign-in
    and sessions, room isolation, injection, the agent doors, resource abuse), each with working
    proof-of-concept scripts; every finding was then checked by a separate skeptic. What was found
    and fixed (tests in `tests/security.test.ts`):

    | Finding | Fix |
    |---|---|
    | An open live-update stream kept sending room content after sign-out, password change or account disable | The stream re-checks the session before every event and every heartbeat and closes when it is gone |
    | One address could lock every account out of sign-in (the per-account counter was charged even for refused attempts) | Per-address limit on all attempts; per-account limits count failures only, mostly per account and address, with a high cross-address backstop |
    | `TRUST_PROXY=true` let a client choose its own address with `X-Forwarded-For` | `TRUST_PROXY` is now a hop count (1 on Railway and Fly); only the proxy's own entry is believed |
    | A disabled admin's unused invites still worked; an invite still added rooms the inviter had left | Disabling withdraws the person's invites; invites need an active admin; only rooms the inviter still belongs to are added; acceptance re-checks everything in its transaction |
    | Changing a password left other sessions signed in | Other sessions are signed out |
    | Removing a person left their agents in the room, so the person could still read it through their agent | Their agents leave with them; agent room access also requires the owner to be in the room |
    | An agent removed from a room could still write into it by re-sending an old report; reported cards could be re-sent forever; a reused open card still showed a room the agent had left | Reports only count for rooms the agent is still in; a reported card can be corrected for 2 hours; an open card is rebuilt when the agent's rooms change |
    | Anyone could add their agent to a sandbox room they were not in | The sandbox exception is gone |
    | Removing an agent that was not in the room revealed its name and wrote a false feed line | Refused with 404, nothing written |
    | Agent text reached the Conductor outside the untrusted wrapper (via limits decisions and playbook titles) and line breaks could forge a person's line | Every item is one line; everything not written by a person or the Conductor is wrapped; tag removal no longer needs a `>` |
    | An agent could fake an instruction on another owner's agent's card with line breaks | Other agents' text is indented (text) or quoted (agent page); the card's about line says other agents' text is information, not instruction |
    | The daily brief wrapped only `working_on` | Every agent-written fact is wrapped and cleaned |

35. **Security review, part two (agent doors and resource abuse).** Fixed, with tests in
    `tests/security-abuse.test.ts`:

    | Finding | Fix |
    |---|---|
    | A JSON-RPC batch let one `/mcp` request run up to ~100 tool calls past the 60-a-minute key limit | Batches are refused with a plain error; one message per POST |
    | Failed-key requests could write unlimited, large rows to the connection log (disk fill) | Fixed, short action labels; while an address floods bad keys, one row a minute |
    | A removed agent could still rewrite its own earlier question or lesson by re-sending a report aimed at another room | Re-send keys include the room; a re-send never overwrites a lesson a person edited |
    | Lookup by event id showed proposals waiting for approval | Event lookup only returns kinds agents may see elsewhere |
    | Sign-in limiter memory grew without bound (and long emails) | Bounded limiters with cheap batch trimming; absurd input refused before counting |
    | No cap on open questions one agent could aim at another; a flood made the target's card too big to answer | At most 5 open questions from one agent to one recipient and 20 from agents to one agent, in posts and reports alike, with a plain reason |
    | The Conductor's prompt grew with every open item, so one agent could make each run expensive | Each prompt section is capped and clipped and says how many were left out |
    | Every agent-raised decision emailed and pushed everyone | Email and push for decisions at most once per person per room per 30 minutes (the app lists all); delivery runs in the background so a slow mail server never holds up the scheduler |
    | A 5-minute, around-the-clock schedule made room health take ~9 s per agent | Each day's slots are computed once and reused (now milliseconds) |
    | Unlimited live streams per person | At most 5; a new one closes the oldest |
    | Room create/update accepted `is_sandbox`, `clock_speed` and unchecked size limits from the web | Only the fields people may set, with ranges (card size 300 to 20,000; open instructions 1 to 20) |
    | An agent checking in and reporting in a loop could raise thousands of disagreement decisions, and the scheduler's per-tick alert check had no index | At most 3 disagreements per agent per room waiting on people (a plain reason otherwise); an index on alerts by decision (migration 2) |
    | *Found by the skeptics while checking the fixes:* lines in a person's name quoted ~60 characters of agent text bare in the Conductor's prompt; a rejected proposal's status line could be looked up; a re-sent report could reorder questions past the cap | Those lines are rebuilt without the quote; agents' lookup skips proposal status lines; a correction may change a question's wording but not its recipient |

    In all, the reviewers raised 27 findings; the skeptics, run against the code after the fixes,
    found every one fixed apart from the three leftovers and the disagreement flood in the last two
    rows, which were then fixed too.

    The review also found a latent scheduler bug while I fixed the above: a tick with nothing to
    await could leave its "running" marker stale and skip every later tick. Fixed; the status tests
    caught it. **Residual risks, accepted:** a compromised agent key can still trigger up to 12
    Conductor runs an hour in its rooms (each now bounded in size, roughly 10 cents at most). In the
    worst case that uses up the monthly Conductor budget within about a day, after which every room
    falls back to relay mode; the budget is the hard cap, and the spend shows in the Conductor panel
    so the owner can turn the key off. And
    any signed-in person can list everyone's name and email (needed to add people to rooms); fine for
    a small team, revisit if Tempo ever hosts more than one company.

36. **What Propose mode holds back.** In Propose mode every *instruction* the Conductor writes waits
    for a person, as the brief says. Its short notes and its questions to agents still go out,
    because they assign no work and are needed to chase stale items. The owner guide and the
    first-test plan say exactly this.

37. **Signing out.** Added a **Sign out** button (bottom of the room list); sessions also end on
    password change for every other device. Rejected: shorter sessions (agents never use sessions,
    and two people should not have to sign in every day).

38. **New agents follow their room's clock.** The "Add an agent" form copies the first chosen
    room's time zone, working days and hours, as the brief says ("a room's time zone and working
    hours are the defaults for its agents' schedules"); the person can still change them.

## Part 5: Fixes from the outside review (before the first deploy)

An outside review ran every test and the rehearsal, then probed a running copy by hand. Each fix
below has a test that fails on the code before the fix and passes after it.

39. **The limits safety net needs a real signal, not a common word.** The old check matched single
    words, so "in order to", "in charge of", "pay attention", "subscription tiers" and "the invoice
    template" all became "spending money" decisions; in autonomous mode every such Conductor
    instruction waited for a person. Now every rule needs evidence of the act itself:
    * **Money:** a currency amount, or a buying verb used as a verb with something to buy ("buy the
      stock photo", "pay for the plan", "place an order", "order 50 business cards", "subscribe to",
      "upgrade to the paid plan", "charge the client", "run paid ads", "hire a freelancer", "renew
      the domain", "start a free trial"). Bare "order", "charge", "pay", "subscription" and
      "invoice" are not enough. One deliberate exception: price-list rates written as copy ("Basic
      $9/month, Pro $29/month") are not spending when nothing in the sentence buys.
    * **Contacting outsiders:** a contact verb used as a verb (an instruction, a question or a plan,
      not "the email" or "draft three emails") aimed at someone outside the team: customers,
      clients, vendors, press, investors, prospects, users and so on. Writing a message for review
      is not contacting; sending it is. Talking to teammates never counts.
    * **Deleting:** deleting, removing, wiping or emptying files, folders, records, accounts,
      posts or data. Editing text inside a draft (a word, a paragraph, a typo, a photo on a page
      draft) is not deleting anything.
    * **Sharing outside the project:** publishing, posting on a public place (social media, the
      blog, the website), going live, making something public, giving outsiders access, sharing
      with other companies. Posting in Tempo or sharing with the team never counts.
    * Each sentence is checked on its own (an instruction and its "done when" line are separate
      sentences); "don't", "never" and "without" right before the verb mean the act is forbidden;
      a short quoted button label ("Buy now") is copy, not an action.
    * A room's own extra limits still match when all their key words appear as whole words;
      the four default limits are now matched only by their rules, never by loose words ("keep
      sharing updates" no longer counts as "sharing anything outside the project").
    * When a case is truly unclear the rules still lean toward asking a person: "remove the
      duplicate rows", "launch the landing page" and "survey users" are flagged on purpose.

    `tests/limits.test.ts` holds the table: 64 harmless sentences that must pass and 45 risky ones
    that must be flagged with the right limit, including every sentence from the review. Rejected:
    a model call per sentence (costs money on every check-in, and the safety net must work with no
    API key), and a single list of "risky words" with exceptions (it is how the old bug happened).

## Part 4: Delegation record

| Piece | Delegated to | Checked how |
|---|---|---|
| Section 2 fact checks (5 topics) + skeptical re-check of MCP SDK and hosting | Sonnet researchers; verifier on the inherited model | Read every finding; build decisions above |
| Door C, the agent page (`doors/page.ts`, `page-form.ts`, `lib/html.ts`) | Sonnet | Ran its 35 tests; read the page as an agent sees it; changed how skipped answers are worded; three-doors test |
| OpenAPI document, `/agents.md` guide, test that runs every example | Sonnet | Ran its tests (Redocly lint inside) |
| Email and ntfy alert channels | Sonnet | Ran its 25 tests (fake SMTP server, fake ntfy server) |
| Control-room screens (4 builders: feed+composer; strip+lanes+decisions; Conductor+room tabs; agents+settings+auth) | Sonnet | See milestone 5 notes |
| Rehearsal stand-in agents | Sonnet | Its tests plus the full rehearsal |
| Dockerfile, Railway and Fly config, container smoke script | Sonnet | Ran the smoke script (build, restart, data survives) |
| README, owner guide, first real test plan | Sonnet | Read all three against the code; fixed what had changed since (sign-out, schedule defaults, banner text); its fresh-clone run of the README steps is in its report |
| Security review: five finders plus a skeptic per finding | Inherited model (finders), skeptics | Read every finding and its proof-of-concept; the lead fixed each and wrote a test for it |
| Kept by the lead | — | Database, check-in service and validation, sign-in/keys/isolation, MCP door, scheduler, Conductor, brief, rehearsal driver, integration, this file |
