import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { nextId, parseJson } from '../db/index.js';
import { iso } from '../lib/time.js';
import { createPerson } from '../services/auth.js';
import { randomSecret } from '../lib/crypto.js';
import { addPersonToRoom, createAgent, createRoom, revokeKeys } from '../services/manage.js';
import { getAgent, roomPeople } from '../services/repo.js';
import type { PersonRow } from '../services/rows.js';
import { appendFeed } from '../services/feed.js';
import { ClaudeWriter, ScriptedWriter, StandIn, type CheckInOutcome } from './standins.js';

/**
 * Rehearsal mode: a sandbox room with two stand-in agents on a sped-up clock, driven through all
 * three doors, including deliberate misbehavior. Every expected behavior is checked and the
 * results are stored with the rehearsal, so it doubles as the end-to-end acceptance test.
 *
 *  Stand-in A uses Door A (MCP), alternating the official v1 and v2 clients.
 *  Stand-in B alternates Door B (REST) and Door C (the agent page).
 *
 * Misbehavior covered: skipping a required answer, missing check-ins (amber, red, alert,
 * recovery), disagreeing (a decision), and asking to do something outside the limits (a decision,
 * not an instruction).
 */

export interface RehearsalResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RehearsalOptions {
  /** Where the running server can be reached from inside this process. */
  baseUrl: string;
  startedBy: PersonRow | null;
  /** Upper bound on check-in rounds (the full script needs about 8). */
  maxRounds: number;
  /** A sped-up clock: 60 means one real second is one minute for the stand-ins. */
  clockSpeed?: number;
  /** Stand-in check-in interval in (sped-up) minutes. 30 at 60x speed is a check-in every 30 seconds. */
  intervalMinutes?: number;
  onLog?: (line: string) => void;
  /** Called once the sandbox exists, with the rehearsal id and room id. */
  onStarted?: (id: string, roomId: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running: string | null = null;
export function rehearsalRunning(): string | null {
  return running;
}

export async function runRehearsal(ctx: AppContext, opts: RehearsalOptions): Promise<{ id: string; roomId: string; passed: boolean; results: RehearsalResult[] }> {
  if (running) throw new Error(`A rehearsal is already running (${running}).`);
  const speed = opts.clockSpeed ?? 60;
  const interval = opts.intervalMinutes ?? 30;
  const roundMs = (interval * 60_000) / speed;
  const results: RehearsalResult[] = [];
  const logLines: { at: string; text: string }[] = [];

  // ---------------------------------------------------------------- set up the sandbox
  let owner = opts.startedBy;
  if (!owner) {
    owner = (ctx.db.prepare("SELECT * FROM people WHERE role = 'admin' AND disabled_at IS NULL ORDER BY created_at LIMIT 1").get() as PersonRow | undefined) ?? null;
  }
  if (!owner) {
    owner = await createPerson(ctx, { name: 'Rehearsal owner', email: `rehearsal-${randomSecret(4).toLowerCase()}@example.invalid`, password: randomSecret(16), role: 'admin' });
  }
  const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE is_sandbox = 1').get() as { n: number }).n + 1;
  // Keep only the latest few sandbox rooms visible.
  ctx.db.prepare(`UPDATE rooms SET archived_at = ? WHERE is_sandbox = 1 AND archived_at IS NULL AND id NOT IN (SELECT id FROM rooms WHERE is_sandbox = 1 ORDER BY created_at DESC LIMIT 2)`).run(iso(ctx.clock.now()));
  const room = createRoom(ctx, owner, {
    name: `Sandbox rehearsal ${n}`,
    goal: 'Rehearse a small product launch: a landing page with final copy, a pricing table and three customer quotes, plus a launch email.',
    rules: ['This is a rehearsal with stand-in agents. Nothing here is real work.'],
    is_sandbox: true,
    clock_speed: speed,
    work_days: [1, 2, 3, 4, 5, 6, 7],
    work_start: '00:00',
    work_end: '23:59',
  });
  for (const p of ctx.db.prepare("SELECT id FROM people WHERE role = 'admin' AND disabled_at IS NULL").all() as { id: string }[]) {
    if (p.id !== owner.id) addPersonToRoom(ctx, { kind: 'system', id: null, name: 'Tempo' }, room.id, p.id);
  }
  const schedule = (offset: number) => ({ interval_minutes: interval, grace_minutes: 15, offset_minutes: offset, work_days: [1, 2, 3, 4, 5, 6, 7], work_start: '00:00', work_end: '23:59' });
  const a = createAgent(ctx, owner, { name: `Ada (stand-in ${n})`, type: 'stand_in', room_ids: [room.id], schedule: schedule(0), clock_speed: speed });
  const b = createAgent(ctx, owner, { name: `Bo (stand-in ${n})`, type: 'stand_in', room_ids: [room.id], schedule: schedule(Math.round(interval / 2)), clock_speed: speed });

  const id = nextId(ctx.db, 'reh');
  ctx.db
    .prepare(`INSERT INTO rehearsals (id, room_id, started_by, started_at, status, max_rounds) VALUES (?, ?, ?, ?, 'running', ?)`)
    .run(id, room.id, opts.startedBy?.id ?? null, iso(ctx.clock.now()), opts.maxRounds);
  running = id;
  opts.onStarted?.(id, room.id);

  const log = (text: string) => {
    const line = { at: iso(Date.now()), text };
    logLines.push(line);
    opts.onLog?.(text);
    ctx.db.prepare('UPDATE rehearsals SET log = ? WHERE id = ?').run(JSON.stringify(logLines.slice(-300)), id);
    ctx.bus.publish({ type: 'room', roomId: room.id, what: 'rehearsal' });
  };
  const check = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    log(`${passed ? 'PASS' : 'FAIL'}: ${name}. ${detail}`);
    ctx.db.prepare('UPDATE rehearsals SET results = ? WHERE id = ?').run(JSON.stringify(results), id);
  };
  withTx(ctx, (emit) =>
    appendFeed(
      ctx.db,
      { roomId: room.id, kind: 'system', actorKind: 'system', actorName: 'Tempo', text: `Rehearsal ${id} started: two stand-in agents on a sped-up clock (a check-in every ${Math.round(roundMs / 1000)} seconds).`, data: { event: 'rehearsal_started' }, at: iso(ctx.clock.now()) },
      emit,
    ),
  );

  const writer = ctx.config.anthropicApiKey ? new ClaudeWriter(ctx.config.anthropicApiKey, ctx.config.standInModel, new ScriptedWriter(n)) : new ScriptedWriter(n);
  log(`Sandbox room "${room.name}" with ${a.agent.name} (MCP) and ${b.agent.name} (REST and agent page). Writer: ${writer.label}. One round is ${Math.round(roundMs / 1000)} s.`);
  const A = new StandIn({ name: a.agent.name, baseUrl: opts.baseUrl, apiKey: a.apiKey, pageLink: `${opts.baseUrl}/a/${a.pageToken}`, doors: ['mcp-v1', 'mcp-v2'], writer });
  const B = new StandIn({ name: b.agent.name, baseUrl: opts.baseUrl, apiKey: b.apiKey, pageLink: `${opts.baseUrl}/a/${b.pageToken}`, doors: ['rest', 'page'], writer });

  const status = (agentId: string) => getAgent(ctx.db, agentId)?.status ?? 'gray';
  const outcomes: { who: string; o: CheckInOutcome }[] = [];
  const doCheckIn = async (s: StandIn, plan: Parameters<StandIn['checkIn']>[0] = {}) => {
    const o = await s.checkIn(plan);
    outcomes.push({ who: s.name, o });
    const last = o.attempts.at(-1);
    log(`${s.name} checked in through ${o.door} (${o.cardId}): ${o.attempts.map((t) => (t.ok ? 'accepted' : `rejected (${t.status})`)).join(', then ')}. ${last && !last.ok ? `Tempo said: ${last.message}` : ''}`);
    return o;
  };
  const waitFor = async (what: string, test: () => boolean, timeoutMs: number): Promise<number | null> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (test()) return Date.now() - start;
      await sleep(500);
    }
    log(`Timed out waiting for: ${what}`);
    return null;
  };
  let rounds = 0;
  const round = () => ++rounds <= opts.maxRounds;

  let passed = false;
  try {
    // ---------------------------------------------------------------- 0. connection test
    const who = await A.whoami();
    check('Connection test (tempo_whoami over MCP)', who.ok && /Connected to Tempo/.test(who.message), who.message.slice(0, 160));

    // ---------------------------------------------------------------- round 1
    if (round()) {
      const qText = 'Which pricing tier should the landing page lead with?';
      const oa = await doCheckIn(A, { workingOn: 'Researching competitor pricing tables for the landing page.', questions: [{ to: b.agent.name, text: qText }] });
      const qRow = ctx.db.prepare('SELECT * FROM questions WHERE room_id = ? AND text = ?').get(room.id, qText) as { id: string } | undefined;
      await sleep(roundMs / 2);
      const ob = await doCheckIn(B, { workingOn: 'Researching competitor pricing tables and tiers.', skipAnswersFirst: true });
      const reports = (ctx.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE card_id = ?').get(ob.cardId) as { n: number }).n;
      check(
        "A question from one agent reaches the other agent's next card",
        !!qRow && ob.questionIds.includes(qRow.id),
        qRow ? `${qRow.id} was on ${b.agent.name}'s card ${ob.cardId}.` : 'The question was not stored.',
      );
      const first = ob.attempts[0];
      const last = ob.attempts.at(-1)!;
      check(
        'A report that skips a required answer is rejected, naming the missing item, and the corrected report is accepted without duplicates',
        ob.attempts.length === 2 && !first.ok && first.status === 422 && /an answer to q_\d+/.test(first.message) && last.ok && reports === 1,
        `First attempt: ${first.ok ? 'accepted' : `rejected with "${first.message.slice(0, 140)}"`}; corrected: ${last.ok ? 'accepted' : 'rejected'}; reports stored for the card: ${reports}.`,
      );
      void oa;
      await sleep(roundMs / 2);
    }

    // ---------------------------------------------------------------- round 2
    if (round()) {
      const oa = await doCheckIn(A);
      const answer = ctx.db.prepare(`SELECT answer FROM questions WHERE room_id = ? AND asker_id = ? AND status = 'answered'`).get(room.id, a.agent.id) as { answer: string } | undefined;
      check(
        "The answer appears on the asking agent's next card and in the feed",
        !!answer && oa.newItemsText.includes(answer.answer.slice(0, 30)) && (ctx.db.prepare("SELECT COUNT(*) AS n FROM feed_events WHERE room_id = ? AND kind = 'answer'").get(room.id) as { n: number }).n >= 1,
        answer ? `Answer: "${answer.answer.slice(0, 100)}".` : 'No answer was stored.',
      );
      await sleep(roundMs / 2);
      await doCheckIn(B, { instructionStatus: 'in_progress' });
      await sleep(roundMs / 2);
    }

    // ---------------------------------------------------------------- round 3: disagreement and a request outside the limits
    if (round()) {
      await doCheckIn(A, { instructionStatus: 'in_progress', disagreements: [{ with: b.agent.name, about: 'the headline tone', my_view: 'A playful headline fits this audience better than a plain one.' }] });
      const dis = ctx.db.prepare(`SELECT id, title FROM decisions WHERE room_id = ? AND source = 'disagreement'`).get(room.id) as { id: string; title: string } | undefined;
      check('Two agents disagreeing becomes a decision for people', !!dis, dis ? `${dis.id}: ${dis.title}` : 'No decision was raised.');
      await sleep(roundMs / 4);
      const ask = await B.post({ kind: 'question', to: 'people', text: 'May I spend $29 on a stock photo for the hero image?' });
      log(`${b.agent.name} asked: "May I spend $29 on a stock photo for the hero image?" (${ask.ok ? ask.id : ask.message})`);
      await sleep(roundMs / 4);
      await doCheckIn(B, { instructionStatus: 'in_progress' });
      // Give the Conductor a moment to run on the new reports.
      await waitFor('a Conductor run', () => !!ctx.db.prepare(`SELECT 1 FROM conductor_runs WHERE room_id = ? AND status IN ('acted','nothing_to_do','skipped','failed')`).get(room.id), roundMs * 2);
      await sleep(3000);
      const limitDec = ctx.db.prepare(`SELECT id, title FROM decisions WHERE room_id = ? AND source = 'limits'`).get(room.id) as { id: string; title: string } | undefined;
      const spendIns = ctx.db.prepare(`SELECT id FROM instructions WHERE room_id = ? AND text LIKE '%$29%' AND status NOT IN ('proposed', 'rejected', 'cancelled')`).get(room.id);
      check('Asking to do something outside the limits becomes a decision, not an instruction', !!limitDec && !spendIns, limitDec ? `${limitDec.id}: ${limitDec.title}${spendIns ? ' (but an instruction was issued!)' : ''}` : 'No decision was raised.');
    }

    // ---------------------------------------------------------------- rounds 4+: B goes quiet
    const quietStart = Date.now();
    log(`${b.agent.name} now stops checking in, to rehearse missed check-ins.`);
    const keepA = (async () => {
      while (Date.now() - quietStart < roundMs * 6 && status(b.agent.id) !== 'red' && rounds < opts.maxRounds) {
        await sleep(roundMs);
        if (!round()) break;
        await doCheckIn(A, { instructionStatus: 'in_progress' }).catch((e) => log(`${a.agent.name} check-in failed: ${(e as Error).message}`));
      }
    })();
    const amberAfter = await waitFor(`${b.agent.name} turning amber`, () => status(b.agent.id) === 'amber' || status(b.agent.id) === 'red', roundMs * 4);
    const redAfter = await waitFor(`${b.agent.name} turning red`, () => status(b.agent.id) === 'red', roundMs * 5);
    const alert = await waitFor('the red alert', () => !!ctx.db.prepare(`SELECT 1 FROM alerts WHERE agent_id = ? AND kind = 'agent_red'`).get(b.agent.id), roundMs);
    await keepA;
    check(
      'Missed check-ins turn amber, then red, and alert the owner once',
      amberAfter !== null && redAfter !== null && alert !== null && (ctx.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE agent_id = ? AND kind = 'agent_red'`).get(b.agent.id) as { n: number }).n === 1,
      `Amber after ${amberAfter === null ? '—' : `${Math.round(amberAfter / 1000)} s`} of silence, red after ${redAfter === null || amberAfter === null ? '—' : `${Math.round((amberAfter + redAfter) / 1000)} s`}; red alerts: ${(ctx.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE agent_id = ? AND kind = 'agent_red'`).get(b.agent.id) as { n: number }).n}.`,
    );

    // ---------------------------------------------------------------- recovery
    rounds++;
    await doCheckIn(B, { instructionStatus: 'done' });
    const green = await waitFor(`${b.agent.name} back to green`, () => status(b.agent.id) === 'green', roundMs);
    const recovered = await waitFor('the recovery alert', () => !!ctx.db.prepare(`SELECT 1 FROM alerts WHERE agent_id = ? AND kind = 'agent_recovered'`).get(b.agent.id), roundMs);
    check('The agent recovers: green again, with a recovery alert', green !== null && recovered !== null, green !== null ? 'Back to green after checking in.' : `Status is ${status(b.agent.id)}.`);

    // ---------------------------------------------------------------- whole-loop checks
    const doors = (ctx.db.prepare(`SELECT DISTINCT door FROM connection_log WHERE agent_id IN (?, ?) AND result = 'ok' AND action = 'report'`).all(a.agent.id, b.agent.id) as { door: string }[]).map((r) => r.door).sort();
    check('Check-ins completed through all three doors', ['mcp', 'page', 'rest'].every((d) => doors.includes(d)), `Doors with accepted reports: ${doors.join(', ')}.`);
    const eras = new Set(outcomes.filter((x) => x.o.door.startsWith('mcp') && x.o.attempts.some((t) => t.ok)).map((x) => x.o.door));
    check('Both MCP protocol versions worked (2025 "initialize" and 2026-07-28)', eras.has('mcp-v1') && eras.has('mcp-v2'), `MCP clients used successfully: ${[...eras].join(', ')}.`);

    const runs = ctx.db.prepare(`SELECT status, actions, model FROM conductor_runs WHERE room_id = ?`).all(room.id) as { status: string; actions: string; model: string | null }[];
    // Every Conductor instruction that was live before its agent's next card must be on that card.
    const issued = (ctx.db.prepare(`SELECT id, agent_id, issued_at FROM instructions WHERE room_id = ? AND issuer_kind = 'conductor' AND issued_at IS NOT NULL`).all(room.id) as { id: string; agent_id: string; issued_at: string }[]).filter(
      (i) => !!ctx.db.prepare('SELECT 1 FROM cards WHERE agent_id = ? AND issued_at > ?').get(i.agent_id, i.issued_at),
    );
    const seenOnCards = issued.filter((i) => outcomes.some((x) => x.o.instructionIds.includes(i.id)));
    check(
      "The Conductor ran and its instructions reached the next cards",
      runs.some((r) => r.status === 'acted' || r.status === 'nothing_to_do') && seenOnCards.length === issued.length,
      `${runs.length} Conductor run${runs.length === 1 ? '' : 's'} (${runs[0]?.model ?? 'no model'}); ${issued.length} instruction${issued.length === 1 ? '' : 's'} issued, ${seenOnCards.length} seen on a later card.`,
    );

    const leaks = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM feed_events WHERE room_id != ? AND actor_id IN (?, ?)`).get(room.id, a.agent.id, b.agent.id) as { n: number }).n;
    const other = ctx.db.prepare('SELECT id FROM rooms WHERE id != ? LIMIT 1').get(room.id) as { id: string } | undefined;
    let isolated = leaks === 0;
    let isoDetail = `Feed items written outside the sandbox: ${leaks}.`;
    if (other) {
      const res = await fetch(`${opts.baseUrl}/api/v1/agent/lookup?room_id=${other.id}`, { headers: { authorization: `Bearer ${a.apiKey}` } });
      isolated = isolated && res.status === 403;
      isoDetail += ` Looking into another room: HTTP ${res.status}.`;
    }
    check('Nothing leaks between rooms', isolated, isoDetail);

    passed = results.every((r) => r.passed);
  } catch (e) {
    check('The rehearsal ran to the end', false, `Stopped with an error: ${(e as Error).message}`);
  } finally {
    await A.close().catch(() => {});
    await B.close().catch(() => {});
    // Park the stand-ins: paused (gray, so they don't go red later) and their keys revoked.
    const actor = { kind: 'system' as const, id: null, name: 'Tempo' };
    for (const ag of [a.agent.id, b.agent.id]) {
      ctx.db.prepare('UPDATE agents SET paused_at = ? WHERE id = ?').run(iso(ctx.clock.now()), ag);
      revokeKeys(ctx, actor, ag, 'api');
      revokeKeys(ctx, actor, ag, 'page');
    }
    const summary = `${results.filter((r) => r.passed).length} of ${results.length} checks passed.`;
    log(`Rehearsal finished: ${summary}`);
    ctx.db.prepare('UPDATE rehearsals SET status = ?, finished_at = ?, results = ? WHERE id = ?').run(passed ? 'passed' : 'failed', iso(ctx.clock.now()), JSON.stringify(results), id);
    withTx(ctx, (emit) =>
      appendFeed(
        ctx.db,
        { roomId: room.id, kind: 'system', actorKind: 'system', actorName: 'Tempo', text: `Rehearsal ${id} finished: ${summary} The stand-ins are now paused.`, data: { event: 'rehearsal_finished', passed }, at: iso(ctx.clock.now()) },
        emit,
      ),
    );
    running = null;
  }
  return { id, roomId: room.id, passed, results };
}

export function latestRehearsalFor(ctx: AppContext, personId: string) {
  const row = ctx.db
    .prepare(`SELECT r.* FROM rehearsals r JOIN room_people rp ON rp.room_id = r.room_id WHERE rp.person_id = ? ORDER BY r.started_at DESC LIMIT 1`)
    .get(personId) as Record<string, any> | undefined;
  if (!row) return null;
  return {
    id: row.id,
    room_id: row.room_id,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    max_rounds: row.max_rounds,
    log: parseJson(row.log, []),
    results: parseJson(row.results, []),
    people: roomPeople(ctx.db, row.room_id).length,
  };
}
