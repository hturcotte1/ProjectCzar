import type { DB } from '../db/index.js';
import type { Problem } from '../lib/errors.js';
import { listJoin } from '../lib/errors.js';
import { MAX_TEXT } from '../schemas/agent.js';
import { agentRooms, findAgentInRoom, getRoom } from './repo.js';
import type { AgentRow, CardRequirements, InstructionRow, QuestionRow } from './rows.js';
import { OPEN_INSTRUCTION_STATUSES } from './rows.js';
import { getInstruction, getQuestion, questionCapProblem, quote } from './work.js';

/**
 * Validates a report against the card it answers.
 *
 * Forgiving about shape: a string where a list is expected, a map instead of a list, camelCase
 * names, common synonyms for statuses, a missing room_id when there is only one room.
 * Strict about content: every required item must be present, and every problem is reported at
 * once with the exact field to fix. Nothing is saved unless the whole report is valid.
 */

export type ProblemKind = 'missing' | 'invalid';
export interface ReportProblem extends Problem {
  kind: ProblemKind;
}

export type QuestionTarget =
  | { kind: 'agent'; agentId: string; name: string }
  | { kind: 'people' }
  | { kind: 'conductor' };

export interface NormalizedReport {
  card_id: string;
  rooms: {
    room_id: string;
    working_on: string;
    finished: { what: string; proof: string | null }[];
    notes_for_others: string | null;
    blocked: { reason: string; what_would_unblock: string } | null;
    disagreements: { with_agent_id: string; with_name: string; about: string; my_view: string }[];
  }[];
  answers: { question_id: string; answer: string }[];
  instruction_updates: {
    instruction_id: string;
    status: 'acknowledged' | 'in_progress' | 'done' | 'blocked' | 'declined';
    note: string | null;
    proof: string | null;
  }[];
  questions: { room_id: string; target: QuestionTarget; text: string }[];
  playbook_entries: { room_id: string; title: string; text: string }[];
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

/** Accepts a list, a single object, or a map keyed by id (the key is put into `idKey`). */
function asList(v: unknown, idKey?: string): unknown[] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    const keys = Object.keys(v);
    const looksLikeMap = idKey && keys.length > 0 && keys.every((k) => /^[a-z]+_\d+$/i.test(k));
    if (looksLikeMap) {
      return keys.map((k) => {
        const val = v[k];
        return isObj(val) ? { [idKey!]: k, ...val } : { [idKey!]: k, __value: val };
      });
    }
    return [v];
  }
  return [v];
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

const STATUS_SYNONYMS: Record<string, NormalizedReport['instruction_updates'][number]['status']> = {
  acknowledged: 'acknowledged',
  acknowledge: 'acknowledged',
  ack: 'acknowledged',
  received: 'acknowledged',
  seen: 'acknowledged',
  ok: 'acknowledged',
  new: 'acknowledged',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  in_process: 'in_progress',
  working: 'in_progress',
  started: 'in_progress',
  doing: 'in_progress',
  ongoing: 'in_progress',
  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  blocked: 'blocked',
  stuck: 'blocked',
  declined: 'declined',
  decline: 'declined',
  refused: 'declined',
  rejected: 'declined',
  wont_do: 'declined',
};

function normStatus(v: unknown): NormalizedReport['instruction_updates'][number]['status'] | null {
  const s = str(v);
  if (!s) return null;
  const key = s.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  return STATUS_SYNONYMS[key] ?? null;
}

const PEOPLE_WORDS = ['people', 'person', 'humans', 'human', 'owner', 'owners', 'team', 'everyone'];
const CONDUCTOR_WORDS = ['conductor', 'tempo', 'the conductor'];

function notBlocked(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === 'string') return ['', 'no', 'none', 'n/a', 'na', 'false', 'not blocked', 'nothing'].includes(v.trim().toLowerCase());
  if (isObj(v)) {
    const reason = str(pick(v, 'reason', 'why'));
    const unblock = str(pick(v, 'what_would_unblock', 'whatWouldUnblock', 'unblock', 'needs'));
    return !reason && !unblock;
  }
  return false;
}

export function chars(n: number): string {
  return n.toLocaleString('en-US');
}

export interface ValidationInput {
  db: DB;
  agent: AgentRow;
  cardId: string;
  requirements: CardRequirements;
  raw: Obj;
}

export function validateReport(i: ValidationInput): { report: NormalizedReport; problems: ReportProblem[] } {
  const { db, agent, requirements: req, raw } = i;
  const problems: ReportProblem[] = [];
  const missing = (field: string, message: string) => problems.push({ kind: 'missing', field, message });
  const invalid = (field: string, message: string) => problems.push({ kind: 'invalid', field, message });

  const textField = (field: string, v: unknown, opts: { required?: boolean; max?: number; label?: string } = {}): string | null => {
    const max = opts.max ?? MAX_TEXT;
    if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') {
      invalid(field, `${field} must be text.`);
      return null;
    }
    const s = str(v);
    if (!s) {
      if (opts.required) missing(field, opts.label ?? `${field}`);
      return null;
    }
    if (s.length > max) {
      invalid(field, `${field} is ${chars(s.length)} characters long; the limit is ${chars(max)}. Shorten it (send a link for long material).`);
      return s.slice(0, max);
    }
    return s;
  };

  const report: NormalizedReport = {
    card_id: i.cardId,
    rooms: [],
    answers: [],
    instruction_updates: [],
    questions: [],
    playbook_entries: [],
  };

  const myRooms = agentRooms(db, agent.id);
  const myRoomIds = new Set(myRooms.map((r) => r.id));
  // Rooms on the card that the agent has since left are ignored, like paused ones.
  const activeRoomIds = req.rooms.filter((id) => myRoomIds.has(id));
  const roomName = (id: string) => getRoom(db, id)?.name ?? id;
  const defaultRoom = activeRoomIds.length === 1 ? activeRoomIds[0] : null;
  const roomChoices = () =>
    listJoin(activeRoomIds.map((id) => `"${id}" (${roomName(id)})`)) || 'none (all your rooms are paused)';

  // ----- rooms ---------------------------------------------------------------------------------
  const roomEntries = asList(pick(raw, 'rooms', 'room'), 'room_id');
  const seenRooms = new Set<string>();
  roomEntries.forEach((entryRaw, idx) => {
    const f = `rooms[${idx}]`;
    if (!isObj(entryRaw)) {
      invalid(f, `${f} must be an object with room_id and working_on.`);
      return;
    }
    let roomId = str(pick(entryRaw, 'room_id', 'roomId', 'room', 'id'));
    if (!roomId && defaultRoom && roomEntries.length === 1) roomId = defaultRoom;
    if (!roomId) {
      invalid(`${f}.room_id`, `${f} has no room_id. Use one of: ${roomChoices()}.`);
      return;
    }
    if (req.paused_rooms.includes(roomId)) return; // paused rooms need nothing; ignore what was sent
    if (req.rooms.includes(roomId) && !myRoomIds.has(roomId)) return; // left the room since the card; ignore
    if (!activeRoomIds.includes(roomId)) {
      invalid(
        `${f}.room_id`,
        myRoomIds.has(roomId)
          ? `${f}.room_id "${roomId}" is not on this card.`
          : `${f}.room_id "${roomId}" is not one of your rooms. Use one of: ${roomChoices()}.`,
      );
      return;
    }
    if (seenRooms.has(roomId)) {
      invalid(f, `room "${roomId}" appears more than once in rooms. Send one entry per room.`);
      return;
    }
    seenRooms.add(roomId);

    const working_on = textField(`${f}.working_on`, pick(entryRaw, 'working_on', 'workingOn', 'working_on_now'), {
      required: true,
      label: `a working_on line for room "${roomName(roomId)}" (rooms entry with room_id "${roomId}": one to three sentences on what you are doing now)`,
    });

    const finished: NormalizedReport['rooms'][number]['finished'] = [];
    const finRaw = pick(entryRaw, 'finished', 'done', 'completed');
    const finList = typeof finRaw === 'string' ? (finRaw.trim() ? [finRaw] : []) : asList(finRaw);
    if (finList.length > 20) invalid(`${f}.finished`, `${f}.finished has ${finList.length} items; send at most 20.`);
    finList.slice(0, 20).forEach((it, j) => {
      const ff = `${f}.finished[${j}]`;
      if (typeof it === 'string') {
        const what = textField(`${ff}.what`, it);
        if (what) finished.push({ what, proof: null });
        return;
      }
      if (!isObj(it)) {
        invalid(ff, `${ff} must be an object with what and proof.`);
        return;
      }
      const what = textField(`${ff}.what`, pick(it, 'what', 'item', 'text', 'title'), {
        required: true,
        label: `${ff}.what (say what you finished)`,
      });
      const proof = textField(`${ff}.proof`, pick(it, 'proof', 'link', 'url', 'where'));
      if (what) finished.push({ what, proof });
    });

    const notes = textField(`${f}.notes_for_others`, pick(entryRaw, 'notes_for_others', 'notesForOthers', 'notes', 'note'));

    let blocked: NormalizedReport['rooms'][number]['blocked'] = null;
    const blockedRaw = pick(entryRaw, 'blocked', 'blocker');
    if (!notBlocked(blockedRaw)) {
      if (typeof blockedRaw === 'string' || blockedRaw === true) {
        const reason = typeof blockedRaw === 'string' ? textField(`${f}.blocked.reason`, blockedRaw) : null;
        missing(
          `${f}.blocked.what_would_unblock`,
          `what would unblock you in room "${roomName(roomId)}" (send blocked as { "reason": "…", "what_would_unblock": "…" })`,
        );
        if (reason) blocked = { reason, what_would_unblock: '' };
      } else if (isObj(blockedRaw)) {
        const reason = textField(`${f}.blocked.reason`, pick(blockedRaw, 'reason', 'why'), {
          required: true,
          label: `${f}.blocked.reason (why you are blocked in room "${roomName(roomId)}")`,
        });
        const unblock = textField(
          `${f}.blocked.what_would_unblock`,
          pick(blockedRaw, 'what_would_unblock', 'whatWouldUnblock', 'unblock', 'needs'),
          {
            required: true,
            label: `${f}.blocked.what_would_unblock (what would unblock you in room "${roomName(roomId)}")`,
          },
        );
        if (reason) blocked = { reason, what_would_unblock: unblock ?? '' };
      } else {
        invalid(`${f}.blocked`, `${f}.blocked must be null or an object with reason and what_would_unblock.`);
      }
    }

    const disagreements: NormalizedReport['rooms'][number]['disagreements'] = [];
    const disList = asList(pick(entryRaw, 'disagreements', 'disagreement'));
    if (disList.length > 3) invalid(`${f}.disagreements`, `${f}.disagreements has ${disList.length} items; send at most 3.`);
    disList.slice(0, 3).forEach((d, j) => {
      const df = `${f}.disagreements[${j}]`;
      if (!isObj(d)) {
        invalid(df, `${df} must be an object with with, about and my_view.`);
        return;
      }
      const withName = textField(`${df}.with`, pick(d, 'with', 'agent'), { required: true, max: 200, label: `${df}.with (the agent you disagree with)` });
      const about = textField(`${df}.about`, pick(d, 'about', 'topic'), { required: true, label: `${df}.about` });
      const myView = textField(`${df}.my_view`, pick(d, 'my_view', 'myView', 'view', 'position'), { required: true, label: `${df}.my_view` });
      if (!withName || !about || !myView) return;
      const other = findAgentInRoom(db, roomId!, withName);
      if (!other || other.id === agent.id) {
        invalid(`${df}.with`, `${df}.with "${withName}" is not another agent in room "${roomName(roomId!)}".`);
        return;
      }
      disagreements.push({ with_agent_id: other.id, with_name: other.name, about, my_view: myView });
    });

    if (working_on) {
      report.rooms.push({
        room_id: roomId,
        working_on,
        finished,
        notes_for_others: notes,
        blocked,
        disagreements,
      });
    }
  });
  for (const roomId of activeRoomIds) {
    if (!seenRooms.has(roomId)) {
      missing(
        'rooms',
        `a working_on line for room "${roomName(roomId)}" (add a rooms entry with room_id "${roomId}" and working_on: one to three sentences on what you are doing now)`,
      );
    }
  }

  // ----- answers -------------------------------------------------------------------------------
  const answerEntries = asList(pick(raw, 'answers', 'answer'), 'question_id');
  const answered = new Set<string>();
  answerEntries.forEach((a, idx) => {
    const f = `answers[${idx}]`;
    if (!isObj(a)) {
      invalid(f, `${f} must be an object with question_id and answer.`);
      return;
    }
    const qid = str(pick(a, 'question_id', 'questionId', 'id', 'question'));
    if (!qid) {
      invalid(`${f}.question_id`, `${f} has no question_id.`);
      return;
    }
    const answer = textField(`${f}.answer`, pick(a, 'answer', 'text', '__value'), {
      required: true,
      label: `the answer text for ${qid} (in ${f}.answer)`,
    });
    const q = getQuestion(db, qid);
    const allowed =
      q && q.target_kind === 'agent' && q.target_agent_id === agent.id && myRoomIds.has(q.room_id) && !req.paused_rooms.includes(q.room_id);
    if (!allowed) {
      invalid(`${f}.question_id`, `${qid} is not a question for you on this card. Remove it from answers.`);
      return;
    }
    if (answered.has(qid)) {
      invalid(`${f}.question_id`, `${qid} is answered more than once. Send one answer per question.`);
      return;
    }
    answered.add(qid);
    if (answer) report.answers.push({ question_id: qid, answer });
  });
  for (const qid of req.questions) {
    if (!answered.has(qid)) {
      const q = getQuestion(db, qid) as QuestionRow | undefined;
      if (q && q.status === 'cancelled') continue;
      missing('answers', `an answer to ${qid} ('${quote(q?.text ?? '', 90)}') in answers`);
    }
  }

  // ----- instruction updates ------------------------------------------------------------------
  const updEntries = asList(pick(raw, 'instruction_updates', 'instructionUpdates', 'instructions'), 'instruction_id');
  const updated = new Set<string>();
  updEntries.forEach((u, idx) => {
    const f = `instruction_updates[${idx}]`;
    if (!isObj(u)) {
      invalid(f, `${f} must be an object with instruction_id and status.`);
      return;
    }
    const iid = str(pick(u, 'instruction_id', 'instructionId', 'id', 'instruction'));
    if (!iid) {
      invalid(`${f}.instruction_id`, `${f} has no instruction_id.`);
      return;
    }
    const ins = getInstruction(db, iid) as InstructionRow | undefined;
    const isMine = ins && ins.agent_id === agent.id && myRoomIds.has(ins.room_id) && !req.paused_rooms.includes(ins.room_id);
    if (!isMine) {
      invalid(`${f}.instruction_id`, `${iid} is not an instruction for you on this card. Remove it from instruction_updates.`);
      return;
    }
    if (!OPEN_INSTRUCTION_STATUSES.includes(ins!.status) && !req.instructions.includes(iid)) {
      invalid(`${f}.instruction_id`, `${iid} is already ${ins!.status} and is no longer on your card. Remove it from instruction_updates.`);
      return;
    }
    if (updated.has(iid)) {
      invalid(`${f}.instruction_id`, `${iid} appears more than once. Send one status per instruction.`);
      return;
    }
    updated.add(iid);
    const statusRaw = pick(u, 'status', 'state', '__value');
    const status = normStatus(statusRaw);
    if (!status) {
      if (statusRaw === undefined || str(statusRaw) === '') {
        missing(`${f}.status`, `a status for ${iid} ('${quote(ins!.text, 60)}') in ${f}.status: acknowledged, in_progress, done, blocked or declined`);
      } else {
        invalid(`${f}.status`, `${f}.status "${str(statusRaw)}" is not a status. Use acknowledged, in_progress, done, blocked or declined.`);
      }
      return;
    }
    const note = textField(`${f}.note`, pick(u, 'note', 'notes', 'reason', 'comment'));
    const proof = textField(`${f}.proof`, pick(u, 'proof', 'link', 'url', 'where'));
    if (status === 'done' && !proof) {
      missing(`${f}.proof`, `proof for ${iid}, which is marked done (in ${f}.proof: a link, or a sentence saying where the result is)`);
    }
    if ((status === 'blocked' || status === 'declined') && !note) {
      missing(`${f}.note`, `a note for ${iid}, which is marked ${status} (in ${f}.note: say why${status === 'blocked' ? ' and what would unblock it' : ''})`);
    }
    report.instruction_updates.push({ instruction_id: iid, status, note, proof });
  });
  for (const iid of req.instructions) {
    if (!updated.has(iid)) {
      const ins = getInstruction(db, iid);
      if (ins && !OPEN_INSTRUCTION_STATUSES.includes(ins.status)) continue; // cancelled since the card was issued
      missing(
        'instruction_updates',
        `a status for ${iid} ('${quote(ins?.text ?? '', 70)}') in instruction_updates (acknowledged, in_progress, done with proof, blocked with a note, or declined with a note)`,
      );
    }
  }

  // ----- new questions -------------------------------------------------------------------------
  const qEntries = asList(pick(raw, 'questions', 'new_questions'));
  const pendingQuestions = new Map<string, number>();
  if (qEntries.length > 10) invalid('questions', `questions has ${qEntries.length} items; send at most 10.`);
  qEntries.slice(0, 10).forEach((q, idx) => {
    const f = `questions[${idx}]`;
    if (!isObj(q)) {
      invalid(f, `${f} must be an object with to and text.`);
      return;
    }
    const text = textField(`${f}.text`, pick(q, 'text', 'question'), { required: true, label: `${f}.text (the question)` });
    const roomId = resolveRoomForNewItem(f, str(pick(q, 'room_id', 'roomId', 'room')), activeRoomIds, myRoomIds, roomChoices, invalid);
    const toRaw = str(pick(q, 'to', 'for', 'target'));
    if (!toRaw) {
      missing(`${f}.to`, `who ${f} is for (in ${f}.to: an agent's name, "conductor", or "people")`);
      return;
    }
    if (!roomId || !text) return;
    const target = resolveTarget(db, roomId, toRaw, agent);
    if (!target) {
      invalid(`${f}.to`, `${f}.to "${toRaw}" is not an agent in room "${roomName(roomId)}". Use an agent's name from your card, "conductor", or "people".`);
      return;
    }
    if (target.kind === 'agent' && target.agentId === agent.id) {
      invalid(`${f}.to`, `${f} is addressed to you. Ask another agent, "conductor", or "people".`);
      return;
    }
    // At most a few open questions per recipient, so no agent can flood another's card.
    const key = `${roomId}|${target.kind}|${target.kind === 'agent' ? target.agentId : ''}`;
    const adding = (pendingQuestions.get(key) ?? 0) + 1;
    const label = target.kind === 'agent' ? target.name : target.kind === 'people' ? 'people' : 'the Conductor';
    const existingReport = db.prepare('SELECT id FROM reports WHERE card_id = ?').get(i.cardId) as { id: string } | undefined;
    const cap = questionCapProblem(db, roomId, agent.id, target, label, adding, existingReport ? `${existingReport.id}:q:` : null);
    if (cap) {
      invalid(`${f}`, `${f} cannot be sent: ${cap}`);
      return;
    }
    pendingQuestions.set(key, adding);
    report.questions.push({ room_id: roomId, target, text });
  });

  // ----- playbook entries ----------------------------------------------------------------------
  const pbEntries = asList(pick(raw, 'playbook_entries', 'playbookEntries', 'playbook', 'lessons'));
  if (pbEntries.length > 5) invalid('playbook_entries', `playbook_entries has ${pbEntries.length} items; send at most 5.`);
  pbEntries.slice(0, 5).forEach((p, idx) => {
    const f = `playbook_entries[${idx}]`;
    if (!isObj(p)) {
      invalid(f, `${f} must be an object with title and text.`);
      return;
    }
    const title = textField(`${f}.title`, pick(p, 'title', 'name'), { required: true, max: 200, label: `${f}.title` });
    const text = textField(`${f}.text`, pick(p, 'text', 'body', 'lesson'), { required: true, label: `${f}.text` });
    const roomId = resolveRoomForNewItem(f, str(pick(p, 'room_id', 'roomId', 'room')), activeRoomIds, myRoomIds, roomChoices, invalid);
    if (title && text && roomId) report.playbook_entries.push({ room_id: roomId, title, text });
  });

  return { report, problems };
}

function resolveRoomForNewItem(
  f: string,
  given: string | null,
  activeRoomIds: string[],
  myRoomIds: Set<string>,
  roomChoices: () => string,
  invalid: (field: string, message: string) => void,
): string | null {
  if (given) {
    if (!activeRoomIds.includes(given)) {
      invalid(
        `${f}.room_id`,
        myRoomIds.has(given) ? `${f}.room_id "${given}" is paused right now.` : `${f}.room_id "${given}" is not one of your rooms. Use one of: ${roomChoices()}.`,
      );
      return null;
    }
    return given;
  }
  if (activeRoomIds.length === 1) return activeRoomIds[0];
  invalid(`${f}.room_id`, `${f} needs a room_id because you are in more than one room. Use one of: ${roomChoices()}.`);
  return null;
}

export function resolveTarget(db: DB, roomId: string, toRaw: string, _agent: AgentRow): QuestionTarget | null {
  const key = toRaw.trim().replace(/^@/, '').toLowerCase();
  if (PEOPLE_WORDS.includes(key)) return { kind: 'people' };
  if (CONDUCTOR_WORDS.includes(key)) return { kind: 'conductor' };
  const a = findAgentInRoom(db, roomId, key);
  return a ? { kind: 'agent', agentId: a.id, name: a.name } : null;
}

/** "Report not accepted. Missing: …. Also fix: …. Send the report again with the same card_id (card_12)." */
export function rejectionMessage(problems: ReportProblem[], cardId: string): string {
  const missing = problems.filter((p) => p.kind === 'missing').map((p) => p.message);
  const invalid = problems.filter((p) => p.kind === 'invalid').map((p) => p.message);
  const parts: string[] = ['Report not accepted.'];
  if (missing.length) parts.push(`Missing: ${missing.join('; ')}.`);
  if (invalid.length) parts.push(`${missing.length ? 'Also fix' : 'Please fix'}: ${invalid.join(' ')}`);
  parts.push(`Nothing from this attempt was saved. Fix ${problems.length === 1 ? 'this' : 'these'} and send the report again with the same card_id (${cardId}).`);
  return parts.join(' ');
}
