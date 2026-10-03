import type { DB } from '../db/index.js';
import { nextId, parseJson } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { appendFeed, updateFeed } from './feed.js';
import { getAgent, getPerson } from './repo.js';
import type { DecisionRow, InstructionRow, InstructionStatusAll, QuestionRow } from './rows.js';

/**
 * Questions, instructions, decisions and playbook entries: creating them, changing them, and
 * writing the matching feed events. Callers run these inside a transaction (see withTx).
 */

type Emit = (e: BusEvent) => void;

export interface Actor {
  kind: 'agent' | 'person' | 'conductor' | 'system';
  id: string | null;
  name: string;
}

export function quote(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ----------------------------------------------------------------------------------------------
// Questions
// ----------------------------------------------------------------------------------------------

export interface NewQuestionArgs {
  roomId: string;
  asker: Actor;
  target: { kind: 'agent'; agentId: string; name: string } | { kind: 'people' } | { kind: 'conductor' };
  text: string;
  why?: string | null;
  sourceKey?: string | null;
  at: string;
}

export function createQuestion(db: DB, a: NewQuestionArgs, emit: Emit): QuestionRow {
  if (a.sourceKey) {
    const existing = db.prepare('SELECT * FROM questions WHERE source_key = ?').get(a.sourceKey) as
      | QuestionRow
      | undefined;
    if (existing) {
      if (existing.text !== a.text && existing.status === 'open') {
        db.prepare('UPDATE questions SET text = ? WHERE id = ?').run(a.text, existing.id);
        if (existing.feed_seq)
          updateFeed(db, existing.feed_seq, { text: questionFeedText(a, existing.id), at: a.at, data: questionData(a, existing.id) }, emit);
      }
      return db.prepare('SELECT * FROM questions WHERE id = ?').get(existing.id) as QuestionRow;
    }
  }
  const id = nextId(db, 'q');
  db.prepare(
    `INSERT INTO questions (id, room_id, asker_kind, asker_id, target_kind, target_agent_id, text, why, status, created_at, source_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(
    id,
    a.roomId,
    a.asker.kind === 'system' ? 'conductor' : a.asker.kind,
    a.asker.id,
    a.target.kind,
    a.target.kind === 'agent' ? a.target.agentId : null,
    a.text,
    a.why ?? null,
    a.at,
    a.sourceKey ?? null,
  );
  const seq = appendFeed(
    db,
    {
      roomId: a.roomId,
      kind: 'question',
      actorKind: a.asker.kind,
      actorId: a.asker.id,
      actorName: a.asker.name,
      targetAgentId: a.target.kind === 'agent' ? a.target.agentId : null,
      threadId: id,
      refId: id,
      text: questionFeedText(a, id),
      data: questionData(a, id),
      at: a.at,
    },
    emit,
  );
  db.prepare('UPDATE questions SET feed_seq = ? WHERE id = ?').run(seq, id);
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow;
}

function targetLabel(t: NewQuestionArgs['target']): string {
  return t.kind === 'agent' ? t.name : t.kind === 'people' ? 'the people' : 'the Conductor';
}

function questionFeedText(a: NewQuestionArgs, id: string): string {
  return `Question ${id} for ${targetLabel(a.target)}: ${a.text}`;
}

function questionData(a: NewQuestionArgs, id: string): Record<string, unknown> {
  return {
    question_id: id,
    to_kind: a.target.kind,
    to_name: targetLabel(a.target),
    to_agent_id: a.target.kind === 'agent' ? a.target.agentId : null,
    text: a.text,
    why: a.why ?? null,
  };
}

export function answerQuestion(
  db: DB,
  q: QuestionRow,
  answerer: Actor,
  answer: string,
  at: string,
  emit: Emit,
  reportId: string | null = null,
): { changed: boolean } {
  if (q.status === 'answered' && q.answer === answer) return { changed: false };
  db.prepare(
    `UPDATE questions SET status = 'answered', answer = ?, answered_at = COALESCE(answered_at, ?), answerer_kind = ?, answerer_id = ?, answer_report_id = ?
     WHERE id = ?`,
  ).run(answer, at, answerer.kind, answerer.id, reportId, q.id);
  const data = { question_id: q.id, question: q.text, answer };
  const text = `Answer to ${q.id} (${quote(q.text, 60)}): ${answer}`;
  if (q.answer_feed_seq) {
    updateFeed(db, q.answer_feed_seq, { text, data, at }, emit);
  } else {
    const seq = appendFeed(
      db,
      {
        roomId: q.room_id,
        kind: 'answer',
        actorKind: answerer.kind,
        actorId: answerer.id,
        actorName: answerer.name,
        targetAgentId: q.asker_kind === 'agent' ? q.asker_id : null,
        threadId: q.id,
        refId: q.id,
        text,
        data,
        at,
      },
      emit,
    );
    db.prepare('UPDATE questions SET answer_feed_seq = ? WHERE id = ?').run(seq, q.id);
  }
  return { changed: true };
}

export function getQuestion(db: DB, id: string): QuestionRow | undefined {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined;
}

// ----------------------------------------------------------------------------------------------
// Instructions
// ----------------------------------------------------------------------------------------------

export interface NewInstructionArgs {
  roomId: string;
  agentId: string;
  issuer: { kind: 'person'; personId: string; name: string } | { kind: 'conductor'; runId: string | null };
  text: string;
  doneWhen: string;
  priority?: 'low' | 'normal' | 'high';
  dueAt?: string | null;
  why?: string | null;
  /** 'proposed' waits for a person's approval (propose mode); 'new' goes straight to the card. */
  status: 'proposed' | 'new';
  at: string;
}

export function createInstruction(db: DB, a: NewInstructionArgs, emit: Emit): InstructionRow {
  const id = nextId(db, 'ins');
  const agent = getAgent(db, a.agentId);
  db.prepare(
    `INSERT INTO instructions (id, room_id, agent_id, issuer_kind, issuer_person_id, text, done_when, priority, due_at, why, status,
       created_at, issued_at, updated_at, last_movement_at, conductor_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    a.roomId,
    a.agentId,
    a.issuer.kind,
    a.issuer.kind === 'person' ? a.issuer.personId : null,
    a.text,
    a.doneWhen,
    a.priority ?? 'normal',
    a.dueAt ?? null,
    a.why ?? null,
    a.status,
    a.at,
    a.status === 'new' ? a.at : null,
    a.at,
    a.at,
    a.issuer.kind === 'conductor' ? a.issuer.runId : null,
  );
  db.prepare(
    `INSERT INTO instruction_events (instruction_id, status, note, actor_kind, actor_id, at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, a.status, a.why ?? null, a.issuer.kind, a.issuer.kind === 'person' ? a.issuer.personId : null, a.at);
  const issuerName = a.issuer.kind === 'person' ? a.issuer.name : 'Conductor';
  const agentName = agent?.name ?? a.agentId;
  const seq = appendFeed(
    db,
    {
      roomId: a.roomId,
      kind: a.status === 'proposed' ? 'proposal' : 'instruction',
      actorKind: a.issuer.kind,
      actorId: a.issuer.kind === 'person' ? a.issuer.personId : null,
      actorName: issuerName,
      targetAgentId: a.agentId,
      threadId: id,
      refId: id,
      text:
        a.status === 'proposed'
          ? `Proposed instruction ${id} for ${agentName} (waiting for approval): ${a.text}`
          : `Instruction ${id} for ${agentName}: ${a.text}`,
      data: instructionData(db, id),
      at: a.at,
    },
    emit,
  );
  db.prepare('UPDATE instructions SET feed_seq = ? WHERE id = ?').run(seq, id);
  return getInstruction(db, id)!;
}

export function instructionData(db: DB, id: string): Record<string, unknown> {
  const i = getInstruction(db, id);
  if (!i) return {};
  const agent = getAgent(db, i.agent_id);
  return {
    instruction_id: i.id,
    to_agent_id: i.agent_id,
    to_agent_name: agent?.name ?? i.agent_id,
    issuer_kind: i.issuer_kind,
    issuer_name: i.issuer_kind === 'person' ? (getPerson(db, i.issuer_person_id ?? '')?.name ?? 'a person') : 'Conductor',
    text: i.text,
    done_when: i.done_when,
    priority: i.priority,
    due_at: i.due_at,
    why: i.why,
    status: i.status,
  };
}

export function getInstruction(db: DB, id: string): InstructionRow | undefined {
  return db.prepare('SELECT * FROM instructions WHERE id = ?').get(id) as InstructionRow | undefined;
}

const STATUS_WORDS: Record<string, string> = {
  new: 'new',
  acknowledged: 'acknowledged',
  in_progress: 'in progress',
  blocked: 'blocked',
  done: 'done',
  declined: 'declined',
  cancelled: 'cancelled',
  rejected: 'rejected',
  proposed: 'proposed',
};

export function statusWords(s: string): string {
  return STATUS_WORDS[s] ?? s;
}

/** Records a status change (no-op if nothing changed). Returns true if something changed. */
export function setInstructionStatus(
  db: DB,
  ins: InstructionRow,
  next: { status: InstructionStatusAll; note?: string | null; proof?: string | null },
  actor: Actor,
  at: string,
  emit: Emit,
  reportId: string | null = null,
): boolean {
  const note = next.note ?? null;
  const proof = next.proof ?? null;
  if (ins.status === next.status && (ins.status_note ?? null) === note && (ins.proof ?? null) === proof) return false;
  const movement = ins.status !== next.status;
  db.prepare(
    `UPDATE instructions SET status = ?, status_note = ?, proof = ?, updated_at = ?, last_movement_at = CASE WHEN ? THEN ? ELSE last_movement_at END,
       issued_at = CASE WHEN issued_at IS NULL AND ? = 'new' THEN ? ELSE issued_at END
     WHERE id = ?`,
  ).run(next.status, note, proof, at, movement ? 1 : 0, at, next.status, at, ins.id);
  const agent = getAgent(db, ins.agent_id);
  const seq = appendFeed(
    db,
    {
      roomId: ins.room_id,
      kind: 'instruction_status',
      actorKind: actor.kind,
      actorId: actor.id,
      actorName: actor.name,
      targetAgentId: ins.agent_id,
      threadId: ins.id,
      refId: ins.id,
      text:
        `${ins.id} (${quote(ins.text, 60)}) is now ${statusWords(next.status)}` +
        (note ? `. Note: ${note}` : '') +
        (proof ? `. Proof: ${proof}` : ''),
      data: { instruction_id: ins.id, status: next.status, previous_status: ins.status, note, proof, agent_name: agent?.name },
      at,
    },
    emit,
  );
  db.prepare(
    `INSERT INTO instruction_events (instruction_id, status, note, proof, actor_kind, actor_id, report_id, at, feed_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(ins.id, next.status, note, proof, actor.kind, actor.id, reportId, at, seq);
  return true;
}

// ----------------------------------------------------------------------------------------------
// Decisions
// ----------------------------------------------------------------------------------------------

export interface ProposedInstruction {
  agent_id: string;
  text: string;
  done_when: string;
  priority: 'low' | 'normal' | 'high';
  due_at: string | null;
  why: string | null;
  issuer_kind: 'conductor' | 'person';
  issuer_person_id?: string | null;
  run_id?: string | null;
}

export interface NewDecisionArgs {
  roomId: string;
  title: string;
  context: string;
  options: string[];
  recommendation?: string | null;
  why?: string | null;
  source: DecisionRow['source'];
  sourceRef?: string | null;
  sourceKey?: string | null;
  agentIds: string[];
  proposedInstruction?: ProposedInstruction | null;
  raisedBy: Actor;
  runId?: string | null;
  at: string;
}

export function createDecision(db: DB, a: NewDecisionArgs, emit: Emit): DecisionRow {
  if (a.sourceKey) {
    const existing = db.prepare('SELECT * FROM decisions WHERE source_key = ?').get(a.sourceKey) as
      | DecisionRow
      | undefined;
    if (existing) return existing;
  }
  const id = nextId(db, 'dec');
  const options = a.options.filter((o) => o.trim()).slice(0, 6);
  db.prepare(
    `INSERT INTO decisions (id, room_id, title, context, options, recommendation, why, source, source_ref, source_key, agent_ids,
       proposed_instruction, status, created_at, conductor_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(
    id,
    a.roomId,
    a.title,
    a.context,
    JSON.stringify(options),
    a.recommendation ?? null,
    a.why ?? null,
    a.source,
    a.sourceRef ?? null,
    a.sourceKey ?? null,
    JSON.stringify([...new Set(a.agentIds)]),
    a.proposedInstruction ? JSON.stringify(a.proposedInstruction) : null,
    a.at,
    a.runId ?? null,
  );
  const seq = appendFeed(
    db,
    {
      roomId: a.roomId,
      kind: 'decision',
      actorKind: a.raisedBy.kind,
      actorId: a.raisedBy.id,
      actorName: a.raisedBy.name,
      threadId: id,
      refId: id,
      text: `Decision needed (${id}): ${a.title}`,
      data: {
        decision_id: id,
        title: a.title,
        context: a.context,
        options,
        recommendation: a.recommendation ?? null,
        why: a.why ?? null,
        source: a.source,
        source_ref: a.sourceRef ?? null,
      },
      at: a.at,
    },
    emit,
  );
  db.prepare('UPDATE decisions SET feed_seq = ? WHERE id = ?').run(seq, id);
  emit({ type: 'decision', roomId: a.roomId, decisionId: id });
  return db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DecisionRow;
}

export function getDecision(db: DB, id: string): DecisionRow | undefined {
  return db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DecisionRow | undefined;
}

export function decisionOptions(d: DecisionRow): string[] {
  return parseJson<string[]>(d.options, []);
}

// ----------------------------------------------------------------------------------------------
// Playbook
// ----------------------------------------------------------------------------------------------

export function createPlaybookEntry(
  db: DB,
  a: { roomId: string; title: string; body: string; author: Actor; sourceKey?: string | null; at: string },
  emit: Emit,
): string {
  if (a.sourceKey) {
    const existing = db.prepare('SELECT id, title, body FROM playbook_entries WHERE source_key = ?').get(a.sourceKey) as
      | { id: string; title: string; body: string }
      | undefined;
    if (existing) {
      if (existing.title !== a.title || existing.body !== a.body) {
        db.prepare('UPDATE playbook_entries SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(
          a.title,
          a.body,
          a.at,
          existing.id,
        );
      }
      return existing.id;
    }
  }
  const id = nextId(db, 'pb');
  db.prepare(
    `INSERT INTO playbook_entries (id, room_id, title, body, author_kind, author_id, source_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    a.roomId,
    a.title,
    a.body,
    a.author.kind === 'system' ? 'conductor' : a.author.kind,
    a.author.id,
    a.sourceKey ?? null,
    a.at,
    a.at,
  );
  appendFeed(
    db,
    {
      roomId: a.roomId,
      kind: 'playbook',
      actorKind: a.author.kind,
      actorId: a.author.id,
      actorName: a.author.name,
      refId: id,
      text: `Saved to the playbook (${id}): ${a.title}`,
      data: { playbook_id: id, title: a.title, body: a.body },
      at: a.at,
    },
    emit,
  );
  return id;
}
