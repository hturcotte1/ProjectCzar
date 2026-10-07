import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { parseJson } from '../db/index.js';
import { TempoError, badRequest, listJoin } from '../lib/errors.js';
import { iso, ms, plainTime, relative, shortTime } from '../lib/time.js';
import { LookupInput, MAX_TEXT, PostKind, type Door, type LookupResultT, type PostResultT, type WhoamiResultT } from '../schemas/agent.js';
import { requestConductorRun, PERSON_DELAY_MS } from '../conductor/queue.js';
import { agentActor, raiseLimitDecisionForQuestion } from './checkin.js';
import { appendFeed, feedEventId } from './feed.js';
import { agentRooms, assertAgentInRoom, getAgent, getPerson, getRoom, ownerName } from './repo.js';
import type { AgentRow, FeedRow, RoomRow } from './rows.js';
import { resolveTarget } from './report-validation.js';
import { describeSchedule, nextDueAfterCheckin, scheduleFromRow } from './schedule.js';
import { refreshAgentStatus } from './status.js';
import { clockLabel, daysLabel } from '../lib/time.js';
import { createQuestion, questionCapProblem, quote } from './work.js';

type Obj = Record<string, unknown>;

function asObj(raw: unknown): Obj {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (typeof v === 'object' && v && !Array.isArray(v)) return v as Obj;
    } catch {
      /* fall through */
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('The input must be a JSON object.', undefined, 'Send a JSON object.');
  }
  return raw as Obj;
}

function touch(ctx: AppContext, agent: AgentRow): void {
  const at = iso(ctx.clock.now());
  withTx(ctx, (emit) => {
    const firstContact = !agent.first_seen_at;
    ctx.db.prepare('UPDATE agents SET first_seen_at = COALESCE(first_seen_at, ?), last_seen_at = ? WHERE id = ?').run(at, at, agent.id);
    if (firstContact) refreshAgentStatus(ctx, agent.id, emit);
  });
}

/** tempo_whoami: a connection test that also explains the routine. */
export function whoami(ctx: AppContext, agentIn: AgentRow, _door: Door): WhoamiResultT {
  touch(ctx, agentIn);
  const agent = getAgent(ctx.db, agentIn.id)!;
  const now = ctx.clock.now();
  const rooms = agentRooms(ctx.db, agent.id);
  const s = scheduleFromRow(agent);
  const scheduleText = describeSchedule(s, now);
  const nextDue = nextDueAfterCheckin(s, agent.last_checkin_at ? ms(agent.last_checkin_at) : now);
  const owner = ownerName(ctx.db, agent);
  const roomList = rooms.map((r) => `"${r.name}" (${r.id})`);
  return {
    ok: true,
    connected: true,
    message:
      `Connected to Tempo as ${agent.name}, owned by ${owner}. ` +
      (rooms.length
        ? `You are in ${rooms.length} room${rooms.length === 1 ? '' : 's'}: ${listJoin(roomList)}. `
        : 'You are not in any room yet; your owner will add you. ') +
      `Your check-in schedule: ${scheduleText}. At each check-in, call tempo_check_in, do what the card asks, then call tempo_report.`,
    agent: { id: agent.id, name: agent.name, type: agent.type, owner },
    rooms: rooms.map((r) => ({ room_id: r.id, name: r.name, paused: !!r.paused_at || !!agent.paused_at })),
    schedule: {
      text: scheduleText,
      interval_minutes: agent.interval_minutes,
      working_days: daysLabel(s.workDays),
      working_hours: `${clockLabel(agent.work_start)} to ${clockLabel(agent.work_end)}`,
      timezone: agent.timezone,
      offset_minutes: agent.offset_minutes,
    },
    next_check_in_due: nextDue !== null ? iso(nextDue) : null,
    next_check_in_due_text: nextDue !== null ? `${plainTime(nextDue, agent.timezone)} (${relative(now, nextDue)})` : 'not scheduled',
    last_check_in: agent.last_checkin_at,
  };
}

function pickRoom(ctx: AppContext, agent: AgentRow, roomIdRaw: unknown, field = 'room_id'): RoomRow {
  const rooms = agentRooms(ctx.db, agent.id);
  if (typeof roomIdRaw === 'string' && roomIdRaw.trim()) {
    return assertAgentInRoom(ctx.db, agent.id, roomIdRaw.trim());
  }
  if (rooms.length === 1) return rooms[0];
  if (rooms.length === 0) {
    throw new TempoError(403, 'no_rooms', 'You are not in any Tempo room yet, so there is nowhere to post. Ask your owner to add you to a room.');
  }
  throw badRequest(
    `${field} is needed because you are in more than one room. Use one of: ${listJoin(rooms.map((r) => `"${r.id}" (${r.name})`))}.`,
    [{ field, message: 'room_id is required when you are in more than one room' }],
    'Add room_id and send again.',
  );
}

/** tempo_post: a message, question or note between check-ins. */
export function post(ctx: AppContext, agentIn: AgentRow, raw: unknown, _door: Door): PostResultT {
  const input = asObj(raw);
  const agent = getAgent(ctx.db, agentIn.id)!;
  const problems: { field: string; message: string }[] = [];
  const kindParsed = PostKind.safeParse(typeof input.kind === 'string' ? input.kind.trim().toLowerCase() : (input.kind ?? 'message'));
  if (!kindParsed.success) problems.push({ field: 'kind', message: 'kind must be "message", "question" or "note".' });
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) problems.push({ field: 'text', message: 'text is missing: say what you want to post.' });
  if (text.length > MAX_TEXT) problems.push({ field: 'text', message: `text is ${text.length.toLocaleString('en-US')} characters long; the limit is 2,000.` });
  const kind = kindParsed.success ? kindParsed.data : 'message';
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  if (kind === 'question' && !to) problems.push({ field: 'to', message: 'to is missing: a question needs an agent\'s name, "conductor", or "people".' });
  if (problems.length) {
    throw badRequest(`Post not accepted. ${problems.map((p) => p.message).join(' ')}`, problems, 'Fix these and send again.');
  }
  const room = pickRoom(ctx, agent, input.room_id);
  if (room.paused_at || agent.paused_at) {
    throw new TempoError(409, 'room_paused', `Room "${room.name}" is paused, so posting is turned off until a person resumes it. Do no work for this room until a card says it has resumed.`);
  }
  let target = to ? resolveTarget(ctx.db, room.id, to, agent) : null;
  if (to && !target) {
    throw badRequest(`to "${to}" is not an agent in room "${room.name}". Use an agent's name, "conductor", or "people".`, [
      { field: 'to', message: 'unknown recipient' },
    ]);
  }
  if (target && target.kind === 'agent' && target.agentId === agent.id) {
    throw badRequest('You addressed this to yourself. Use another agent\'s name, "conductor", or "people".', [{ field: 'to', message: 'cannot address yourself' }]);
  }
  if (kind === 'question' && target) {
    const label = target.kind === 'agent' ? target.name : target.kind === 'people' ? 'people' : 'the Conductor';
    const cap = questionCapProblem(ctx.db, room.id, agent.id, target, label, 1);
    if (cap) throw new TempoError(409, 'too_many_open_questions', `Question not posted: ${cap}`, { nextStep: 'Wait for answers on your next card, then ask again.' });
  }
  const now = ctx.clock.now();
  const at = iso(now);
  return withTx(ctx, (emit) => {
    ctx.db.prepare('UPDATE agents SET first_seen_at = COALESCE(first_seen_at, ?), last_seen_at = ? WHERE id = ?').run(at, at, agent.id);
    if (kind === 'question') {
      const q = createQuestion(ctx.db, { roomId: room.id, asker: agentActor(agent), target: target!, text, at }, emit);
      if (target!.kind !== 'agent') raiseLimitDecisionForQuestion(ctx, q, agent, emit);
      if (target!.kind === 'conductor') {
        requestConductorRun(ctx.db, room.id, { kind: 'question_for_conductor', detail: `${agent.name} asked ${q.id}` }, now, PERSON_DELAY_MS, room.clock_speed);
      }
      return { ok: true, message: `Question ${q.id} posted in "${room.name}". The answer will appear on your card.`, id: q.id, room_id: room.id };
    }
    const toAgent = target && target.kind === 'agent' ? target : null;
    const seq = appendFeed(
      ctx.db,
      {
        roomId: room.id,
        kind: 'post',
        actorKind: 'agent',
        actorId: agent.id,
        actorName: agent.name,
        targetAgentId: toAgent?.agentId ?? null,
        text: `${kind === 'note' ? 'Note' : 'Message'}${toAgent ? ` to ${toAgent.name}` : ''}: ${text}`,
        data: { kind, text, to_name: toAgent?.name ?? (target ? (target.kind === 'people' ? 'the people' : 'the Conductor') : null), to_kind: target?.kind ?? 'room' },
        at,
      },
      emit,
    );
    return {
      ok: true,
      message: `${kind === 'note' ? 'Note' : 'Message'} posted in "${room.name}"${toAgent ? ` for ${toAgent.name}` : ''} (${feedEventId(seq)}).`,
      id: feedEventId(seq),
      room_id: room.id,
    };
  });
}

/** Full text of a feed event (cards show a clipped version). */
export function feedFullText(ev: FeedRow): string {
  const d = parseJson<Record<string, any>>(ev.data, {});
  if (ev.kind === 'report') {
    const parts = [`Working on: ${d.working_on ?? ''}`];
    for (const f of (d.finished ?? []) as { what: string; proof?: string }[]) parts.push(`Finished: ${f.what}${f.proof ? ` (proof: ${f.proof})` : ''}`);
    if (d.notes_for_others) parts.push(`Note for others: ${d.notes_for_others}`);
    if (d.blocked?.reason) parts.push(`Blocked: ${d.blocked.reason}. Would unblock: ${d.blocked.what_would_unblock ?? ''}`);
    for (const x of (d.disagreements ?? []) as { with: string; about: string; my_view: string }[]) parts.push(`Disagrees with ${x.with} about ${x.about}: ${x.my_view}`);
    return parts.join('\n');
  }
  if (ev.kind === 'decision') {
    const opts = ((d.options ?? []) as string[]).map((o, i) => `${i + 1}. ${o}`).join(' ');
    return `${ev.text}\n${d.context ?? ''}${opts ? `\nOptions: ${opts}` : ''}`;
  }
  return ev.text;
}

const LOOKUP_KINDS_HISTORY = ['report', 'post', 'message', 'question', 'answer', 'instruction', 'instruction_status', 'decision', 'decision_resolved', 'conductor_note', 'brief'];

/** tempo_lookup: search a room's history and playbook, or fetch one item by id. Results are capped. */
export function lookup(ctx: AppContext, agentIn: AgentRow, raw: unknown, _door: Door): LookupResultT {
  const obj = asObj(raw);
  if (typeof obj.limit === 'string' && obj.limit.trim()) obj.limit = Number(obj.limit);
  const parsed = LookupInput.safeParse(obj);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'input', message: i.message }));
    throw badRequest(
      `Lookup not accepted: ${problems.map((p) => `${p.field}: ${p.message}`).join('; ')}. Use room_id, query, id, kind ("all", "history" or "playbook") and limit (1 to 20).`,
      problems,
    );
  }
  const input = parsed.data;
  const agent = getAgent(ctx.db, agentIn.id)!;
  touch(ctx, agent);
  const tz = agent.timezone;
  const myRooms = agentRooms(ctx.db, agent.id);
  const rooms = input.room_id ? [assertAgentInRoom(ctx.db, agent.id, input.room_id)] : myRooms;
  const roomIds = rooms.map((r) => r.id);
  if (!roomIds.length) return { ok: true, message: 'You are not in any room yet.', results: [], more_available: false };
  const inRooms = (id: string) => roomIds.includes(id);
  const notFound = () =>
    new TempoError(404, 'not_found', `Nothing with id "${input.id}" was found in your rooms. Ids look like evt_120, q_12, ins_31, dec_4 or pb_3.`);

  // One item by id.
  if (input.id) {
    const id = input.id.trim();
    const m = /^(evt|q|ins|dec|pb)_\d+$/.exec(id);
    if (!m) throw notFound();
    const prefix = m[1];
    if (prefix === 'evt') {
      const ev = ctx.db.prepare('SELECT * FROM feed_events WHERE seq = ?').get(Number(id.slice(4))) as FeedRow | undefined;
      // Only the kinds agents may see anywhere else (never proposals waiting for approval).
      if (!ev || !inRooms(ev.room_id) || ![...LOOKUP_KINDS_HISTORY, 'system', 'playbook'].includes(ev.kind)) throw notFound();
      // Nor status lines about proposals (they quote what people have not approved).
      if (ev.kind === 'instruction_status' && parseJson<Record<string, unknown>>(ev.data, {}).previous_status === 'proposed') throw notFound();
      // Nor a decision that holds something back for a person (it quotes it).
      if (ev.kind === 'decision' && ctx.db.prepare('SELECT 1 FROM decisions WHERE feed_seq = ? AND proposed_instruction IS NOT NULL').get(ev.seq)) throw notFound();
      return {
        ok: true,
        message: `Found ${id}.`,
        results: [{ id, room_id: ev.room_id, kind: ev.kind, at: shortTime(ms(ev.created_at), tz), from: ev.actor_name, text: feedFullText(ev) }],
        more_available: false,
      };
    }
    const table = prefix === 'q' ? 'questions' : prefix === 'ins' ? 'instructions' : prefix === 'dec' ? 'decisions' : 'playbook_entries';
    const row = ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, any> | undefined;
    if (!row || !inRooms(row.room_id)) throw notFound();
    let text: string;
    let from = '';
    if (prefix === 'q') {
      text = `Question: ${row.text}${row.status === 'answered' ? `\nAnswer: ${row.answer}` : `\nStatus: ${row.status}`}`;
      from = row.asker_kind === 'agent' ? (getAgent(ctx.db, row.asker_id)?.name ?? '') : row.asker_kind === 'person' ? (getPerson(ctx.db, row.asker_id)?.name ?? '') : 'the Conductor';
    } else if (prefix === 'ins') {
      // The Conductor's reason ("why") is for people, like on the card: agents act on the text and
      // done-when line, which pass the limits check. A person's own reason is shown.
      const why = row.why && row.issuer_kind === 'person' ? `\nWhy: ${row.why}` : '';
      text = `Instruction for ${getAgent(ctx.db, row.agent_id)?.name ?? row.agent_id}: ${row.text}\nDone when: ${row.done_when}\nStatus: ${row.status}${row.status_note ? `\nNote: ${row.status_note}` : ''}${row.proof ? `\nProof: ${row.proof}` : ''}${why}`;
      from = row.issuer_kind === 'person' ? (getPerson(ctx.db, row.issuer_person_id)?.name ?? '') : 'the Conductor';
      if (row.status === 'proposed' || row.status === 'rejected') throw notFound();
    } else if (prefix === 'dec') {
      if (row.proposed_instruction) throw notFound();
      const opts = parseJson<string[]>(row.options, []);
      text = `Decision: ${row.title}\n${row.context}\nOptions: ${opts.map((o, i) => `${i + 1}. ${o}`).join(' ')}\nStatus: ${row.status}${row.resolution ? `\nDecided: ${row.resolution}` : ''}`;
      from = 'Tempo';
    } else {
      if (row.archived_at) throw notFound();
      text = `${row.title}\n${row.body}`;
      from = row.author_kind === 'agent' ? (getAgent(ctx.db, row.author_id)?.name ?? '') : row.author_kind === 'person' ? (getPerson(ctx.db, row.author_id)?.name ?? '') : 'the Conductor';
    }
    return {
      ok: true,
      message: `Found ${id}.`,
      results: [{ id, room_id: row.room_id, kind: table.replace(/s$/, '').replace('playbook_entrie', 'playbook'), at: shortTime(ms(row.created_at), tz), from, text }],
      more_available: false,
    };
  }

  const terms = (input.query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[%_\\]/g, ''))
    .filter((t) => t.length > 0)
    .slice(0, 8);
  const limit = input.limit;
  const results: LookupResultT['results'] = [];
  let more = false;
  const placeholders = roomIds.map(() => '?').join(',');

  if (input.kind !== 'playbook') {
    const kindPh = LOOKUP_KINDS_HISTORY.map(() => '?').join(',');
    const where = terms.map(() => 'LOWER(text || \' \' || data) LIKE ?').join(' AND ');
    const rows = ctx.db
      .prepare(
        `SELECT * FROM feed_events WHERE room_id IN (${placeholders}) AND kind IN (${kindPh}) ${where ? `AND ${where}` : ''}
         AND kind != 'proposal' AND NOT (kind = 'instruction_status' AND json_extract(data, '$.previous_status') = 'proposed')
         AND NOT (kind = 'decision' AND EXISTS (SELECT 1 FROM decisions d WHERE d.feed_seq = feed_events.seq AND d.proposed_instruction IS NOT NULL))
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(...roomIds, ...LOOKUP_KINDS_HISTORY, ...terms.map((t) => `%${t}%`), limit + 1) as FeedRow[];
    if (rows.length > limit) more = true;
    for (const ev of rows.slice(0, limit)) {
      results.push({ id: feedEventId(ev.seq), room_id: ev.room_id, kind: ev.kind, at: shortTime(ms(ev.created_at), tz), from: ev.actor_name, text: quote(feedFullText(ev), 600) });
    }
  }
  if (input.kind !== 'history') {
    const where = terms.map(() => 'LOWER(title || \' \' || body) LIKE ?').join(' AND ');
    const rows = ctx.db
      .prepare(
        `SELECT * FROM playbook_entries WHERE room_id IN (${placeholders}) AND archived_at IS NULL ${where ? `AND ${where}` : ''} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...roomIds, ...terms.map((t) => `%${t}%`), limit + 1) as { id: string; room_id: string; title: string; body: string; updated_at: string; author_kind: string }[];
    if (rows.length > limit) more = true;
    for (const p of rows.slice(0, limit)) {
      results.push({ id: p.id, room_id: p.room_id, kind: 'playbook', at: shortTime(ms(p.updated_at), tz), from: p.author_kind, text: quote(`${p.title}: ${p.body}`, 600) });
    }
  }
  const capped = results.slice(0, limit);
  if (results.length > limit) more = true;
  const roomNames = rooms.map((r) => `"${r.name}"`);
  return {
    ok: true,
    message:
      `${capped.length} result${capped.length === 1 ? '' : 's'}${terms.length ? ` for "${terms.join(' ')}"` : ' (most recent)'} in ${listJoin(roomNames)}.` +
      (more ? ' More are available: narrow the query, or use an id to read one item in full.' : ''),
    results: capped,
    more_available: more,
  };
}

export function roomNameOf(ctx: AppContext, roomId: string): string {
  return getRoom(ctx.db, roomId)?.name ?? roomId;
}
