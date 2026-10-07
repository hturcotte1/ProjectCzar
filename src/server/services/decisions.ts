import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { parseJson } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { TempoError, badRequest } from '../lib/errors.js';
import { iso } from '../lib/time.js';
import { MAX_TEXT } from '../schemas/agent.js';
import { PERSON_DELAY_MS, requestConductorRun } from '../conductor/queue.js';
import { audit } from './audit.js';
import { appendFeed, updateFeed } from './feed.js';
import { assertPersonInRoom, getAgent, getRoom, isAgentInRoom } from './repo.js';
import type { DecisionRow, PersonRow } from './rows.js';
import { OPEN_INSTRUCTION_STATUSES } from './rows.js';
import { personActor } from './people-actions.js';
import {
  answerQuestion,
  CONDUCTOR,
  createInstruction,
  createPlaybookEntry,
  createQuestion,
  decisionOptions,
  getDecision,
  getInstruction,
  getQuestion,
  instructionData,
  postConductorNote,
  quote,
  rewordInstruction,
  statusWords,
  type ProposedInstruction,
} from './work.js';

type Emit = (e: BusEvent) => void;

/**
 * People resolve decisions with one tap (an option) or their own words. The resolution appears on
 * the relevant agents' next cards. Some decisions carry a follow-up: what a decision held back
 * (a new instruction, new wording for one, or the Conductor's question, note, answer or playbook
 * lesson) goes out when a person chooses the first option; a permission question is answered.
 */

export function resolveDecision(
  ctx: AppContext,
  person: PersonRow,
  decisionId: string,
  input: { option_index?: number | null; text?: string | null },
): void {
  const d = getDecision(ctx.db, decisionId);
  if (!d) throw new TempoError(404, 'not_found', 'That decision was not found.');
  const room = assertPersonInRoom(ctx.db, person.id, d.room_id);
  if (d.status !== 'open') throw new TempoError(409, 'already_decided', `This decision was already ${d.status}.`);
  const options = decisionOptions(d);
  const custom = (input.text ?? '').trim();
  if (custom.length > MAX_TEXT) throw badRequest('The answer must be under 2,000 characters.', [{ field: 'text', message: 'too long' }]);
  let optionIndex: number | null = null;
  let resolution: string;
  if (input.option_index !== undefined && input.option_index !== null) {
    if (!Number.isInteger(input.option_index) || input.option_index < 0 || input.option_index >= options.length) {
      throw badRequest('Pick one of the options.', [{ field: 'option_index', message: 'invalid' }]);
    }
    optionIndex = input.option_index;
    const opt = options[optionIndex];
    const needsWords = /write it/i.test(opt);
    if (needsWords && !custom) throw badRequest('Write what you decided.', [{ field: 'text', message: 'required for this option' }]);
    resolution = needsWords ? custom : custom ? `${opt}. ${custom}` : opt;
  } else {
    if (!custom) throw badRequest('Pick an option or write what you decided.', [{ field: 'text', message: 'required' }]);
    resolution = custom;
  }

  const now = ctx.clock.now();
  const at = iso(now);
  withTx(ctx, (emit) => {
    ctx.db
      .prepare(`UPDATE decisions SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution = ?, resolution_option = ? WHERE id = ?`)
      .run(at, person.id, resolution, optionIndex, d.id);
    const agentIds = parseJson<string[]>(d.agent_ids, []);
    appendFeed(
      ctx.db,
      {
        roomId: d.room_id,
        kind: 'decision_resolved',
        actorKind: 'person',
        actorId: person.id,
        actorName: person.name,
        threadId: d.id,
        refId: d.id,
        text: `${person.name} decided ${d.id} (${quote(d.title, 60)}): ${resolution}`,
        data: { decision_id: d.id, title: d.title, resolution, option_index: optionIndex, agent_ids: agentIds },
        at,
      },
      emit,
    );
    if (d.feed_seq) {
      const ev = ctx.db.prepare('SELECT data FROM feed_events WHERE seq = ?').get(d.feed_seq) as { data: string } | undefined;
      const data = parseJson<Record<string, unknown>>(ev?.data, {});
      updateFeed(ctx.db, d.feed_seq, { text: `Decision ${d.id}: ${d.title} (decided)`, data: { ...data, status: 'resolved', resolution }, at }, emit);
    }

    // Follow-ups. What the decision held back goes out only if a person chose the first option.
    const held = d.proposed_instruction ? parseJson<ProposedInstruction | null>(d.proposed_instruction, null) : null;
    if (held && optionIndex === 0) applyHeld(ctx, d, held, person, at, emit);
    if (d.source === 'limits' && d.source_ref) {
      const q = getQuestion(ctx.db, d.source_ref);
      if (q && q.status === 'open') answerQuestion(ctx.db, q, personActor(person), `${person.name} decided: ${resolution}`, at, emit);
    }
    if (d.source === 'declined' && d.source_ref && optionIndex === 1) {
      const ins = getInstruction(ctx.db, d.source_ref);
      if (ins) {
        createInstruction(
          ctx.db,
          {
            roomId: ins.room_id,
            agentId: ins.agent_id,
            issuer: { kind: 'person', personId: person.id, name: person.name },
            text: ins.text,
            doneWhen: ins.done_when,
            priority: ins.priority,
            dueAt: ins.due_at,
            why: `${person.name} asked you to do this anyway after you declined ${ins.id}: ${resolution}`,
            status: 'new',
            at,
          },
          emit,
        );
      }
    }
    audit(ctx, personActor(person), 'decision.resolve', 'decision', d.id, d.room_id, { option_index: optionIndex });
    emit({ type: 'decision', roomId: d.room_id, decisionId: d.id });
    if (!room.paused_at) {
      requestConductorRun(ctx.db, d.room_id, { kind: 'decision_resolved', detail: `${person.name} decided ${d.id}` }, now, PERSON_DELAY_MS, room.clock_speed);
    }
  });
}

/**
 * A person approved what a decision held back: send it now. If it can no longer go out (the agent
 * left, the question was answered, the instruction is finished or has changed since), nothing is
 * sent and the feed says so in plain words.
 */
function applyHeld(ctx: AppContext, d: DecisionRow, held: ProposedInstruction, person: PersonRow, at: string, emit: Emit): void {
  const db = ctx.db;
  const approval = { personName: person.name, decisionId: d.id };
  const notApplied = (text: string) =>
    appendFeed(db, { roomId: d.room_id, kind: 'system', actorKind: 'system', actorName: 'Tempo', threadId: d.id, refId: d.id, text, data: { event: 'held_not_applied', decision_id: d.id }, at }, emit);
  const agentHere = (agentId: string) => {
    const agent = getAgent(db, agentId);
    return agent && !agent.archived_at && isAgentInRoom(db, agent.id, d.room_id) ? agent : null;
  };

  switch (held.kind) {
    case undefined:
    case 'instruction': {
      const agent = agentHere(held.agent_id);
      if (!agent) {
        notApplied(`The instruction from ${d.id} was not sent: ${getAgent(db, held.agent_id)?.name ?? 'that agent'} is no longer in this room.`);
        return;
      }
      const ins = createInstruction(
        db,
        {
          roomId: d.room_id,
          agentId: agent.id,
          issuer:
            held.issuer_kind === 'person' && held.issuer_person_id
              ? { kind: 'person', personId: held.issuer_person_id, name: person.name }
              : { kind: 'conductor', runId: held.run_id ?? null },
          text: held.text,
          doneWhen: held.done_when,
          priority: held.priority,
          dueAt: held.due_at,
          why: `${held.why ? `${held.why} ` : ''}Approved by ${person.name} (${d.id}).`,
          status: 'new',
          at,
        },
        emit,
      );
      db.prepare('UPDATE instructions SET approved_by = ? WHERE id = ?').run(person.id, ins.id);
      return;
    }
    case 'reword': {
      const ins = getInstruction(db, held.instruction_id);
      const open = ins && (OPEN_INSTRUCTION_STATUSES.includes(ins.status) || ins.status === 'proposed');
      const problem = !ins || ins.room_id !== d.room_id
        ? `${held.instruction_id} is no longer in this room`
        : ins.issuer_kind !== 'conductor'
          ? `${ins.id} was given by a person`
          : !open
            ? `${ins.id} is already ${statusWords(ins.status)}`
            : ins.text !== held.previous_text || ins.done_when !== held.previous_done_when
              ? `${ins.id} has changed since this was raised`
              : null;
      if (problem || !ins) {
        notApplied(`The new wording for ${held.instruction_id} was not applied: ${problem}.`);
        return;
      }
      rewordInstruction(db, ins, { text: held.text, doneWhen: held.done_when, why: held.why, approval }, at, emit);
      return;
    }
    case 'question': {
      const agent = agentHere(held.agent_id);
      if (!agent) {
        notApplied(`The Conductor's question from ${d.id} was not sent: ${getAgent(db, held.agent_id)?.name ?? 'that agent'} is no longer in this room.`);
        return;
      }
      createQuestion(db, { roomId: d.room_id, asker: CONDUCTOR, target: { kind: 'agent', agentId: agent.id, name: agent.name }, text: held.text, why: held.why, at }, emit);
      return;
    }
    case 'note':
      postConductorNote(db, { roomId: d.room_id, text: held.text, runId: held.run_id, approval, at }, emit);
      return;
    case 'answer': {
      const q = getQuestion(db, held.question_id);
      if (!q || q.room_id !== d.room_id) {
        notApplied(`The Conductor's answer to ${held.question_id} was not sent: ${held.question_id} is no longer in this room.`);
      } else if (q.status !== 'open') {
        notApplied(`The Conductor's answer to ${q.id} was not sent: ${q.id} was already ${q.status === 'answered' ? 'answered' : 'closed'}.`);
      } else {
        answerQuestion(db, q, CONDUCTOR, held.text, at, emit);
      }
      return;
    }
    case 'playbook': {
      const exists = db.prepare('SELECT 1 FROM playbook_entries WHERE room_id = ? AND LOWER(title) = LOWER(?) AND archived_at IS NULL').get(d.room_id, held.title);
      if (exists) {
        notApplied(`The Conductor's lesson from ${d.id} was not saved: the playbook already has a lesson with the same title.`);
        return;
      }
      createPlaybookEntry(db, { roomId: d.room_id, title: held.title, body: held.text, author: CONDUCTOR, at }, emit);
      return;
    }
  }
}

export function dismissDecision(ctx: AppContext, person: PersonRow, decisionId: string): void {
  const d = getDecision(ctx.db, decisionId);
  if (!d) throw new TempoError(404, 'not_found', 'That decision was not found.');
  assertPersonInRoom(ctx.db, person.id, d.room_id);
  if (d.status !== 'open') return;
  withTx(ctx, (emit) => {
    const at = iso(ctx.clock.now());
    ctx.db.prepare(`UPDATE decisions SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE id = ?`).run(at, person.id, d.id);
    appendFeed(
      ctx.db,
      { roomId: d.room_id, kind: 'system', actorKind: 'person', actorId: person.id, actorName: person.name, threadId: d.id, refId: d.id, text: `${person.name} dismissed decision ${d.id} (${quote(d.title, 60)}).`, data: { event: 'decision_dismissed', decision_id: d.id }, at },
      emit,
    );
    audit(ctx, personActor(person), 'decision.dismiss', 'decision', d.id, d.room_id, {});
    emit({ type: 'decision', roomId: d.room_id, decisionId: d.id });
  });
}

/** Propose mode: a person approves a Conductor instruction (optionally edited) with one tap. */
export function approveProposal(ctx: AppContext, person: PersonRow, instructionId: string, edits: { text?: string; done_when?: string }): void {
  const ins = getInstruction(ctx.db, instructionId);
  if (!ins) throw new TempoError(404, 'not_found', 'That proposal was not found.');
  assertPersonInRoom(ctx.db, person.id, ins.room_id);
  if (ins.status !== 'proposed') throw new TempoError(409, 'not_proposed', `That instruction is already ${ins.status}.`);
  const text = edits.text?.trim() || ins.text;
  const doneWhen = edits.done_when?.trim() ?? ins.done_when;
  if (text.length > MAX_TEXT || doneWhen.length > 500) throw badRequest('That is too long.', [{ field: 'text', message: 'too long' }]);
  const room = getRoom(ctx.db, ins.room_id)!;
  withTx(ctx, (emit) => {
    const at = iso(ctx.clock.now());
    ctx.db
      .prepare(`UPDATE instructions SET status = 'new', text = ?, done_when = ?, issued_at = ?, updated_at = ?, last_movement_at = ?, approved_by = ? WHERE id = ?`)
      .run(text, doneWhen, at, at, at, person.id, ins.id);
    ctx.db
      .prepare(`INSERT INTO instruction_events (instruction_id, status, note, actor_kind, actor_id, at) VALUES (?, 'new', ?, 'person', ?, ?)`)
      .run(ins.id, `Approved by ${person.name}${text !== ins.text || doneWhen !== ins.done_when ? ' (edited)' : ''}`, person.id, at);
    const agent = getAgent(ctx.db, ins.agent_id);
    appendFeed(
      ctx.db,
      {
        roomId: ins.room_id,
        kind: 'instruction',
        actorKind: 'person',
        actorId: person.id,
        actorName: person.name,
        targetAgentId: ins.agent_id,
        threadId: ins.id,
        refId: ins.id,
        text: `${person.name} approved the Conductor's instruction ${ins.id} for ${agent?.name ?? ins.agent_id}: ${text}`,
        data: { ...instructionData(ctx.db, ins.id), approved_by: person.name },
        at,
      },
      emit,
    );
    audit(ctx, personActor(person), 'proposal.approve', 'instruction', ins.id, ins.room_id, { edited: text !== ins.text });
    emit({ type: 'room', roomId: room.id, what: 'proposals' });
  });
}
