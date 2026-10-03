import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { nextId, parseJson } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { TempoError } from '../lib/errors.js';
import { iso, ms, plainTime, relative, shortTime } from '../lib/time.js';
import type { ArrivedItemT, CardT, Door, ReportResultT } from '../schemas/agent.js';
import { CHECKIN_DELAY_MS, requestConductorRun } from '../conductor/queue.js';
import { buildCard } from './card.js';
import { appendFeed, feedEventId, updateFeed } from './feed.js';
import { limitConcern } from './limits.js';
import { agentRooms, getAgent, getRoom, roomLimits } from './repo.js';
import type { AgentRow, CardRequirements, CardRow, InstructionRow, QuestionRow, ReportRow } from './rows.js';
import { OPEN_INSTRUCTION_STATUSES } from './rows.js';
import { nextDueAfterCheckin, scaled, scheduleFromRow } from './schedule.js';
import { refreshAgentStatus } from './status.js';
import { rejectionMessage, validateReport, type NormalizedReport } from './report-validation.js';
import {
  answerQuestion,
  createDecision,
  createPlaybookEntry,
  createQuestion,
  getInstruction,
  getQuestion,
  quote,
  setInstructionStatus,
  type Actor,
} from './work.js';

/** How long after a card expires a late report is still accepted (scaled by clock speed). */
const LATE_REPORT_WINDOW_MINUTES = 120;

type Emit = (e: BusEvent) => void;

export function agentActor(agent: AgentRow): Actor {
  return { kind: 'agent', id: agent.id, name: agent.name };
}

function latestCard(ctx: AppContext, agentId: string): CardRow | undefined {
  return ctx.db
    .prepare('SELECT * FROM cards WHERE agent_id = ? ORDER BY issued_at DESC, rowid DESC LIMIT 1')
    .get(agentId) as CardRow | undefined;
}

export function getCard(ctx: AppContext, cardId: string): CardRow | undefined {
  return ctx.db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow | undefined;
}

/**
 * Marks an open card whose time ran out as an incomplete check-in and writes a system event.
 * Called by the scheduler, and by openCard when it finds one.
 */
export function markCardIncomplete(ctx: AppContext, card: CardRow, emit: Emit): void {
  if (card.status !== 'open') return;
  const now = iso(ctx.clock.now());
  ctx.db.prepare(`UPDATE cards SET status = 'expired', incomplete_at = ? WHERE id = ? AND status = 'open'`).run(now, card.id);
  const agent = getAgent(ctx.db, card.agent_id);
  if (!agent) return;
  for (const room of agentRooms(ctx.db, agent.id)) {
    appendFeed(
      ctx.db,
      {
        roomId: room.id,
        kind: 'system',
        actorKind: 'system',
        actorName: 'Tempo',
        targetAgentId: agent.id,
        refId: card.id,
        text: `${agent.name} opened a card (${card.id}) ${shortTime(ms(card.issued_at), room.timezone)} but did not send a report in time. This counts as an incomplete check-in. If this keeps happening, the agent may be waiting for its owner to approve the Tempo connection.`,
        data: { event: 'checkin_incomplete', agent_id: agent.id, card_id: card.id, show_on_cards: false },
        at: now,
      },
      emit,
    );
  }
}

/**
 * tempo_check_in: returns the agent's briefing card. If the agent already has an open card that
 * has not run out of time, the same card comes back (so a retry never loses anything).
 */
export function openCard(ctx: AppContext, agentIn: AgentRow, door: Door): CardT {
  return withTx(ctx, (emit) => {
    const agent = getAgent(ctx.db, agentIn.id)!;
    const now = ctx.clock.now();
    const nowIso = iso(now);
    const schedule = scheduleFromRow(agent);
    const latest = latestCard(ctx, agent.id);

    ctx.db
      .prepare(
        `UPDATE agents SET first_seen_at = COALESCE(first_seen_at, ?), last_seen_at = ?, last_card_at = ? WHERE id = ?`,
      )
      .run(nowIso, nowIso, nowIso, agent.id);

    if (latest && latest.status === 'open' && now < ms(latest.expires_at)) {
      ctx.db.prepare('UPDATE cards SET opened_count = opened_count + 1 WHERE id = ?').run(latest.id);
      const card = parseJson<CardT>(latest.content, {} as CardT);
      const nextDue = nextDueAfterCheckin(schedule, now);
      emit({ type: 'agent', agentId: agent.id, roomIds: agentRooms(ctx.db, agent.id).map((r) => r.id) });
      return {
        ...card,
        now: nowIso,
        now_text: plainTime(now, agent.timezone),
        next_check_in_due: nextDue !== null ? iso(nextDue) : null,
        next_check_in_due_text: nextDue !== null ? `${plainTime(nextDue, agent.timezone)} (${relative(now, nextDue)})` : 'not scheduled',
      };
    }
    if (latest && latest.status === 'open') markCardIncomplete(ctx, latest, emit);

    const cardId = nextId(ctx.db, 'card');
    const built = buildCard(ctx, agent, cardId);
    const expires = now + scaled(schedule, ctx.config.cardTimeoutMinutes);
    ctx.db
      .prepare(
        `INSERT INTO cards (id, agent_id, door, issued_at, expires_at, status, paused, content, requirements, since_cutoff)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        agent.id,
        door,
        nowIso,
        iso(expires),
        built.requirements.all_paused ? 1 : 0,
        JSON.stringify(built.card),
        JSON.stringify(built.requirements),
        built.sinceCutoff,
      );
    refreshAgentStatus(ctx, agent.id, emit);
    return built.card;
  });
}

function cardNotYours(cardId: string): TempoError {
  return new TempoError(
    422,
    'card_unknown',
    `card_id "${cardId}" is not a card Tempo gave you. Call tempo_check_in to get your card, then send the report with that card's card_id.`,
    { nextStep: 'Call tempo_check_in, then send the report with the card_id it returns.' },
  );
}

/**
 * tempo_report: validates the report against its card and saves it in one transaction.
 * Sending again with the same card_id updates the same report; nothing is duplicated.
 */
export function submitReport(ctx: AppContext, agentIn: AgentRow, rawIn: unknown, door: Door): ReportResultT {
  let raw: unknown = rawIn;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new TempoError(422, 'report_invalid', 'The report must be a JSON object with card_id and the items your card asks for. It could not be read as JSON.', {
        nextStep: 'Send the report as a JSON object.',
      });
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TempoError(422, 'report_invalid', 'The report must be a JSON object with card_id and the items your card asks for.', {
      nextStep: 'Send the report as a JSON object.',
    });
  }
  const obj = raw as Record<string, unknown>;
  const cardIdRaw = obj.card_id ?? obj.cardId ?? obj.card;
  const cardId = typeof cardIdRaw === 'string' ? cardIdRaw.trim() : typeof cardIdRaw === 'number' ? `card_${cardIdRaw}` : '';
  if (!cardId) {
    throw new TempoError(
      422,
      'report_incomplete',
      'Report not accepted. Missing: card_id. Every report answers one card: call tempo_check_in, then send the report with the card_id from that card.',
      { problems: [{ field: 'card_id', message: 'card_id is missing' }], nextStep: 'Add card_id and send again.' },
    );
  }

  const now = ctx.clock.now();
  const agent = getAgent(ctx.db, agentIn.id)!;
  const card = getCard(ctx, cardId);
  if (!card || card.agent_id !== agent.id) throw cardNotYours(cardId);
  const latest = latestCard(ctx, agent.id)!;
  if (latest.id !== card.id) {
    throw new TempoError(
      409,
      'card_replaced',
      `card_id "${cardId}" was replaced by a newer card, "${latest.id}", when you checked in again. Send your report with card_id "${latest.id}" (it asks for: ${parseJson<CardT>(latest.content, {} as CardT).you_must_send_back?.join('; ') ?? 'see the card'}).`,
      { nextStep: `Send the report with card_id "${latest.id}".` },
    );
  }
  const schedule = scheduleFromRow(agent);
  if (card.status === 'expired' && now > ms(card.expires_at) + scaled(schedule, LATE_REPORT_WINDOW_MINUTES)) {
    throw new TempoError(
      410,
      'card_expired',
      `card_id "${cardId}" ran out of time (cards stay open for ${ctx.config.cardTimeoutMinutes} minutes, and late reports are accepted for ${LATE_REPORT_WINDOW_MINUTES / 60} hours after that). Call tempo_check_in for a fresh card and report on that one.`,
      { nextStep: 'Call tempo_check_in for a fresh card.' },
    );
  }

  const requirements = parseJson<CardRequirements>(card.requirements, {
    rooms: [],
    questions: [],
    instructions: [],
    paused_rooms: [],
    all_paused: true,
  });
  const { report, problems } = validateReport({ db: ctx.db, agent, cardId, requirements, raw: obj });
  if (problems.length) {
    throw new TempoError(422, 'report_incomplete', rejectionMessage(problems, cardId), {
      problems: problems.map(({ field, message }) => ({ field, message })),
      nextStep: `Fix the items listed and send the report again with the same card_id (${cardId}).`,
    });
  }

  const result = withTx(ctx, (emit) => applyReport(ctx, agent, card, report, door, emit));

  const arrived = arrivedSinceCard(ctx, agent, card);
  const nextDue = nextDueAfterCheckin(schedule, now);
  const message = result.updated
    ? `Report for ${cardId} updated (revision ${result.revision}). Nothing was duplicated.`
    : requirements.all_paused
      ? `Acknowledged ${cardId}. Tempo is paused for you, so there is nothing to do until a later card says it has resumed.`
      : `Report accepted for ${cardId}. Thank you.`;
  return {
    ok: true,
    message:
      message +
      (nextDue !== null ? ` Next check-in due ${plainTime(nextDue, agent.timezone)}.` : '') +
      (arrived.length ? ` ${arrived.length} new item${arrived.length === 1 ? '' : 's'} arrived for you after your card was issued; see arrived_since_card.` : ''),
    report_id: result.reportId,
    card_id: cardId,
    updated: result.updated,
    next_check_in_due: nextDue !== null ? iso(nextDue) : null,
    next_check_in_due_text: nextDue !== null ? `${plainTime(nextDue, agent.timezone)} (${relative(now, nextDue)})` : 'not scheduled',
    arrived_since_card: arrived,
  };
}

function reportFeedText(agentName: string, r: NormalizedReport['rooms'][number]): string {
  const parts = [`${agentName} is working on: ${r.working_on}`];
  if (r.finished.length) parts.push(`Finished: ${r.finished.map((f) => f.what).join('; ')}`);
  if (r.notes_for_others) parts.push(`Note: ${r.notes_for_others}`);
  if (r.blocked) parts.push(`Blocked: ${r.blocked.reason}`);
  return parts.join(' | ');
}

function applyReport(
  ctx: AppContext,
  agent: AgentRow,
  card: CardRow,
  report: NormalizedReport,
  door: Door,
  emit: Emit,
): { reportId: string; updated: boolean; revision: number } {
  const db = ctx.db;
  const now = ctx.clock.now();
  const at = iso(now);
  const actor = agentActor(agent);
  const existing = db.prepare('SELECT * FROM reports WHERE card_id = ?').get(card.id) as ReportRow | undefined;
  const reportId = existing?.id ?? nextId(db, 'rep');
  const revision = existing ? existing.revision + 1 : 1;
  const body = JSON.stringify(report);
  if (existing) {
    db.prepare('UPDATE reports SET body = ?, updated_at = ?, revision = ?, door = ? WHERE id = ?').run(body, at, revision, door, reportId);
  } else {
    db.prepare(
      'INSERT INTO reports (id, card_id, agent_id, door, created_at, updated_at, revision, body) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    ).run(reportId, card.id, agent.id, door, at, at, body);
  }

  const touchedRooms = new Set<string>();

  // Room entries: the "working on now" lanes and one report event per room.
  for (const r of report.rooms) {
    touchedRooms.add(r.room_id);
    const data = {
      report_id: reportId,
      card_id: card.id,
      agent_id: agent.id,
      working_on: r.working_on,
      finished: r.finished,
      notes_for_others: r.notes_for_others,
      blocked: r.blocked,
      disagreements: r.disagreements.map((d) => ({ with: d.with_name, about: d.about, my_view: d.my_view })),
      revision,
      door,
    };
    const prev = db.prepare('SELECT feed_seq FROM report_rooms WHERE report_id = ? AND room_id = ?').get(reportId, r.room_id) as
      | { feed_seq: number | null }
      | undefined;
    let seq = prev?.feed_seq ?? null;
    if (seq) {
      updateFeed(db, seq, { text: reportFeedText(agent.name, r), data, at }, emit);
    } else {
      seq = appendFeed(
        db,
        {
          roomId: r.room_id,
          kind: 'report',
          actorKind: 'agent',
          actorId: agent.id,
          actorName: agent.name,
          refId: reportId,
          text: reportFeedText(agent.name, r),
          data,
          at,
        },
        emit,
      );
    }
    db.prepare(
      `INSERT INTO report_rooms (report_id, room_id, agent_id, working_on, finished, notes_for_others, blocked_reason, blocked_unblock, created_at, updated_at, feed_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id, room_id) DO UPDATE SET working_on = excluded.working_on, finished = excluded.finished,
         notes_for_others = excluded.notes_for_others, blocked_reason = excluded.blocked_reason, blocked_unblock = excluded.blocked_unblock,
         updated_at = excluded.updated_at`,
    ).run(
      reportId,
      r.room_id,
      agent.id,
      r.working_on,
      JSON.stringify(r.finished),
      r.notes_for_others,
      r.blocked?.reason ?? null,
      r.blocked?.what_would_unblock ?? null,
      at,
      at,
      seq,
    );

    r.disagreements.forEach((d, idx) => {
      createDecision(
        db,
        {
          roomId: r.room_id,
          title: `${agent.name} and ${d.with_name} disagree: ${quote(d.about, 70)}`,
          context: `${agent.name} says: ${d.my_view}`,
          options: [`Go with ${agent.name}'s view`, `Go with ${d.with_name}'s current approach`, 'Something else (write it)'],
          recommendation: null,
          why: null,
          source: 'disagreement',
          sourceRef: reportId,
          sourceKey: `${reportId}:dis:${r.room_id}:${idx}`,
          agentIds: [agent.id, d.with_agent_id],
          raisedBy: actor,
          at,
        },
        emit,
      );
    });
  }

  // Answers.
  for (const a of report.answers) {
    const q = getQuestion(db, a.question_id) as QuestionRow;
    answerQuestion(db, q, actor, a.answer, at, emit, reportId);
    touchedRooms.add(q.room_id);
  }

  // Instruction updates. A declined instruction becomes a decision for people.
  for (const u of report.instruction_updates) {
    const ins = getInstruction(db, u.instruction_id) as InstructionRow;
    touchedRooms.add(ins.room_id);
    const changed = setInstructionStatus(db, ins, { status: u.status, note: u.note, proof: u.proof }, actor, at, emit, reportId);
    if (changed && u.status === 'declined' && ins.status !== 'declined') {
      const evt = db.prepare('SELECT MAX(id) AS id FROM instruction_events WHERE instruction_id = ?').get(ins.id) as { id: number };
      createDecision(
        db,
        {
          roomId: ins.room_id,
          title: `${agent.name} declined ${ins.id}: ${quote(ins.text, 70)}`,
          context: `${agent.name}'s reason: ${u.note ?? '(none given)'}`,
          options: ['Withdraw the instruction', `Ask ${agent.name} to do it anyway`, 'Give it to someone else', 'Something else (write it)'],
          recommendation: null,
          why: null,
          source: 'declined',
          sourceRef: ins.id,
          sourceKey: `declined:${ins.id}:${evt.id}`,
          agentIds: [agent.id],
          raisedBy: actor,
          at,
        },
        emit,
      );
    }
  }

  // New questions. Questions to people or the Conductor that ask permission for something outside
  // the room's limits also become a decision, so a person answers them.
  report.questions.forEach((q, idx) => {
    touchedRooms.add(q.room_id);
    const row = createQuestion(
      db,
      { roomId: q.room_id, asker: actor, target: q.target, text: q.text, sourceKey: `${reportId}:q:${idx}`, at },
      emit,
    );
    if (q.target.kind !== 'agent') raiseLimitDecisionForQuestion(ctx, row, agent, emit);
  });

  report.playbook_entries.forEach((p, idx) => {
    touchedRooms.add(p.room_id);
    createPlaybookEntry(db, { roomId: p.room_id, title: p.title, body: p.text, author: actor, sourceKey: `${reportId}:pb:${idx}`, at }, emit);
  });

  // The check-in is complete.
  if (card.status !== 'completed') {
    db.prepare(`UPDATE cards SET status = 'completed', completed_at = ? WHERE id = ?`).run(at, card.id);
    db.prepare(`UPDATE agents SET last_checkin_at = ?, last_checkin_card_id = ?, last_seen_at = ? WHERE id = ?`).run(
      at,
      card.id,
      at,
      agent.id,
    );
  } else {
    db.prepare(`UPDATE agents SET last_seen_at = ? WHERE id = ?`).run(at, agent.id);
  }

  for (const roomId of touchedRooms) {
    const room = getRoom(db, roomId);
    if (!room || room.paused_at) continue;
    requestConductorRun(db, roomId, { kind: 'checkin', detail: `${agent.name} checked in (${card.id})` }, now, CHECKIN_DELAY_MS, room.clock_speed);
  }
  refreshAgentStatus(ctx, agent.id, emit);
  return { reportId, updated: !!existing, revision };
}

export function raiseLimitDecisionForQuestion(ctx: AppContext, q: QuestionRow, asker: AgentRow, emit: Emit): void {
  const room = getRoom(ctx.db, q.room_id);
  if (!room) return;
  const concern = limitConcern(q.text, roomLimits(room).ask_a_person_first);
  if (!concern) return;
  createDecision(
    ctx.db,
    {
      roomId: q.room_id,
      title: `${asker.name} asks about ${concern}: ${quote(q.text, 80)}`,
      context: `This is outside what agents may do without asking (${concern}), so a person needs to decide. ${asker.name} asked: ${q.text}`,
      options: ['Yes, go ahead', 'No, do not do this', 'Something else (write it)'],
      recommendation: null,
      why: `Room limits say to ask a person before ${concern}.`,
      source: 'limits',
      sourceRef: q.id,
      sourceKey: `limits:${q.id}`,
      agentIds: [asker.id],
      raisedBy: { kind: 'system', id: null, name: 'Tempo' },
      at: iso(ctx.clock.now()),
    },
    emit,
  );
}

/** Questions, instructions and messages for this agent that arrived after the card was issued. */
function arrivedSinceCard(ctx: AppContext, agent: AgentRow, card: CardRow): ArrivedItemT[] {
  const db = ctx.db;
  const tz = agent.timezone;
  const out: ArrivedItemT[] = [];
  const rooms = agentRooms(db, agent.id).filter((r) => !r.paused_at);
  for (const room of rooms) {
    const qs = db
      .prepare(
        `SELECT * FROM questions WHERE room_id = ? AND target_kind = 'agent' AND target_agent_id = ? AND status = 'open' AND created_at > ?`,
      )
      .all(room.id, agent.id, card.issued_at) as QuestionRow[];
    for (const q of qs) {
      out.push({ room_id: room.id, kind: 'question', id: q.id, from: q.asker_kind === 'conductor' ? 'the Conductor' : (q.asker_kind === 'agent' ? getAgent(db, q.asker_id ?? '')?.name : null) ?? 'a person', at: shortTime(ms(q.created_at), tz), text: quote(q.text, 300) });
    }
    const placeholders = OPEN_INSTRUCTION_STATUSES.map(() => '?').join(',');
    const ins = db
      .prepare(`SELECT * FROM instructions WHERE room_id = ? AND agent_id = ? AND status IN (${placeholders}) AND issued_at > ?`)
      .all(room.id, agent.id, ...OPEN_INSTRUCTION_STATUSES, card.issued_at) as InstructionRow[];
    for (const i of ins) {
      out.push({ room_id: room.id, kind: 'instruction', id: i.id, from: i.issuer_kind === 'conductor' ? 'the Conductor' : 'a person', at: shortTime(ms(i.issued_at ?? i.created_at), tz), text: quote(i.text, 300) });
    }
    const msgs = db
      .prepare(
        `SELECT seq, actor_name, text, created_at FROM feed_events WHERE room_id = ? AND kind = 'message' AND target_agent_id = ? AND created_at > ? ORDER BY seq`,
      )
      .all(room.id, agent.id, card.issued_at) as { seq: number; actor_name: string; text: string; created_at: string }[];
    for (const m of msgs) {
      out.push({ room_id: room.id, kind: 'message', id: feedEventId(m.seq), from: m.actor_name, at: shortTime(ms(m.created_at), tz), text: quote(m.text, 300) });
    }
  }
  return out.slice(0, 10);
}
