import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { TempoError, badRequest } from '../lib/errors.js';
import { iso } from '../lib/time.js';
import { MAX_TEXT } from '../schemas/agent.js';
import { PERSON_DELAY_MS, requestConductorRun } from '../conductor/queue.js';
import { audit } from './audit.js';
import { appendFeed, feedEventId } from './feed.js';
import { assertPersonInRoom, findAgentInRoom, roomAgents } from './repo.js';
import type { PersonRow } from './rows.js';
import { OPEN_INSTRUCTION_STATUSES } from './rows.js';
import { answerQuestion, createInstruction, createQuestion, getInstruction, getQuestion, setInstructionStatus, type Actor } from './work.js';

/**
 * What people do from the composer: notes, questions and instructions. Instructions typed by a
 * person always go straight to the agent's card, whatever the Conductor's mode.
 */

export function personActor(p: PersonRow): Actor {
  return { kind: 'person', id: p.id, name: p.name };
}

export interface PersonPostInput {
  kind: 'note' | 'question' | 'instruction';
  /** "room", "conductor", or an agent id or name. */
  to: string;
  text: string;
  done_when?: string;
  priority?: 'low' | 'normal' | 'high';
  due_at?: string | null;
}

export interface PersonPostResult {
  kind: PersonPostInput['kind'];
  ids: string[];
  message: string;
}

function mentionedAgents(ctx: AppContext, roomId: string, text: string): { id: string; name: string }[] {
  const lower = text.toLowerCase();
  return roomAgents(ctx.db, roomId)
    .filter((a) => lower.includes(`@${a.name.toLowerCase()}`))
    .map((a) => ({ id: a.id, name: a.name }));
}

export function personPost(ctx: AppContext, person: PersonRow, roomId: string, input: PersonPostInput): PersonPostResult {
  const room = assertPersonInRoom(ctx.db, person.id, roomId);
  const text = (input.text ?? '').trim();
  if (!text) throw badRequest('Write something first.', [{ field: 'text', message: 'required' }]);
  if (text.length > MAX_TEXT) throw badRequest('Messages must be under 2,000 characters.', [{ field: 'text', message: 'too long' }]);
  if (!['note', 'question', 'instruction'].includes(input.kind)) throw badRequest('Choose note, question or instruction.', [{ field: 'kind', message: 'invalid' }]);
  const to = (input.to ?? 'room').trim();
  const toAgent = to !== 'room' && to !== 'conductor' ? findAgentInRoom(ctx.db, roomId, to) : undefined;
  if (to !== 'room' && to !== 'conductor' && !toAgent) throw badRequest(`"${to}" is not an agent in this room.`, [{ field: 'to', message: 'unknown' }]);
  const now = ctx.clock.now();
  const at = iso(now);
  const actor = personActor(person);

  return withTx(ctx, (emit) => {
    if (input.kind === 'instruction') {
      const targets = toAgent ? [toAgent] : to === 'room' ? roomAgents(ctx.db, roomId) : [];
      if (!targets.length) throw badRequest('An instruction needs an agent to go to. Pick one agent (or the whole room if it has agents).', [{ field: 'to', message: 'needs an agent' }]);
      const doneWhen = (input.done_when ?? '').trim();
      if (doneWhen.length > 500) throw badRequest('"Done when" must be under 500 characters.', [{ field: 'done_when', message: 'too long' }]);
      const ids = targets.map(
        (a) =>
          createInstruction(
            ctx.db,
            {
              roomId,
              agentId: a.id,
              issuer: { kind: 'person', personId: person.id, name: person.name },
              text,
              doneWhen,
              priority: input.priority ?? 'normal',
              dueAt: input.due_at ?? null,
              status: 'new',
              at,
            },
            emit,
          ).id,
      );
      audit(ctx, actor, 'instruction.create', 'instruction', ids.join(','), roomId, {});
      if (!room.paused_at) requestConductorRun(ctx.db, roomId, { kind: 'person_instruction', detail: `${person.name} issued ${ids.join(', ')}` }, now, PERSON_DELAY_MS, room.clock_speed);
      return { kind: 'instruction', ids, message: `Instruction${ids.length > 1 ? 's' : ''} ${ids.join(', ')} will be on the next card.` };
    }

    if (input.kind === 'question') {
      const targets: ({ kind: 'agent'; agentId: string; name: string } | { kind: 'conductor' })[] = toAgent
        ? [{ kind: 'agent', agentId: toAgent.id, name: toAgent.name }]
        : to === 'conductor'
          ? [{ kind: 'conductor' }]
          : roomAgents(ctx.db, roomId).map((a) => ({ kind: 'agent' as const, agentId: a.id, name: a.name }));
      if (!targets.length) throw badRequest('There are no agents in this room to ask.', [{ field: 'to', message: 'no agents' }]);
      const ids = targets.map((t) => createQuestion(ctx.db, { roomId, asker: actor, target: t, text, at }, emit).id);
      if (!room.paused_at && to === 'conductor') {
        requestConductorRun(ctx.db, roomId, { kind: 'question_for_conductor', detail: `${person.name} asked ${ids[0]}` }, now, PERSON_DELAY_MS, room.clock_speed);
      }
      return { kind: 'question', ids, message: `Question${ids.length > 1 ? 's' : ''} ${ids.join(', ')} posted.` };
    }

    const mentions = to === 'room' ? mentionedAgents(ctx, roomId, text) : [];
    const seq = appendFeed(
      ctx.db,
      {
        roomId,
        kind: 'message',
        actorKind: 'person',
        actorId: person.id,
        actorName: person.name,
        targetAgentId: toAgent?.id ?? null,
        text: `${person.name}${toAgent ? ` to ${toAgent.name}` : to === 'conductor' ? ' to the Conductor' : ''}: ${text}`,
        data: { text, to_kind: toAgent ? 'agent' : to, to_name: toAgent?.name ?? null, mentions },
        at,
      },
      emit,
    );
    if (!room.paused_at) {
      requestConductorRun(ctx.db, roomId, { kind: 'person_message', detail: `${person.name} posted ${feedEventId(seq)}` }, now, to === 'conductor' ? PERSON_DELAY_MS : 45_000, room.clock_speed);
    }
    return { kind: 'note', ids: [feedEventId(seq)], message: 'Posted.' };
  });
}

/** A person answers a question addressed to people (or to the Conductor, when it can't). */
export function answerAsPerson(ctx: AppContext, person: PersonRow, questionId: string, text: string): void {
  const q = getQuestion(ctx.db, questionId);
  if (!q) throw new TempoError(404, 'not_found', 'That question was not found.');
  assertPersonInRoom(ctx.db, person.id, q.room_id);
  const answer = text.trim();
  if (!answer) throw badRequest('Write an answer first.', [{ field: 'text', message: 'required' }]);
  if (answer.length > MAX_TEXT) throw badRequest('Answers must be under 2,000 characters.', [{ field: 'text', message: 'too long' }]);
  if (q.target_kind === 'agent') {
    throw new TempoError(409, 'not_for_people', 'This question is for an agent; it will answer at its next check-in. You can post a note instead.');
  }
  withTx(ctx, (emit) => {
    answerQuestion(ctx.db, q, personActor(person), answer, iso(ctx.clock.now()), emit);
    audit(ctx, personActor(person), 'question.answer', 'question', q.id, q.room_id, {});
  });
}

/** A person cancels an open instruction (or rejects a proposal). */
export function cancelInstruction(ctx: AppContext, person: PersonRow, instructionId: string, reason: string | null): void {
  const ins = getInstruction(ctx.db, instructionId);
  if (!ins) throw new TempoError(404, 'not_found', 'That instruction was not found.');
  assertPersonInRoom(ctx.db, person.id, ins.room_id);
  if (!OPEN_INSTRUCTION_STATUSES.includes(ins.status) && ins.status !== 'proposed') {
    throw new TempoError(409, 'not_open', `That instruction is already ${ins.status}.`);
  }
  withTx(ctx, (emit) => {
    setInstructionStatus(ctx.db, ins, { status: ins.status === 'proposed' ? 'rejected' : 'cancelled', note: reason }, personActor(person), iso(ctx.clock.now()), emit);
    audit(ctx, personActor(person), ins.status === 'proposed' ? 'proposal.reject' : 'instruction.cancel', 'instruction', ins.id, ins.room_id, {});
  });
}
