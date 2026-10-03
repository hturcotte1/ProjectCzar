import type { CardT, InstructionStatusT } from '../schemas/agent.js';

/**
 * The agent page form (Door C): field names, and the mapping from submitted fields to a report.
 *
 * FIELD NAMING CONTRACT. Names are flat strings with dots; nothing else may be relied on.
 * Anything that fills the form programmatically (the rehearsal stand-in, tests) uses exactly these.
 * <room_id> is like room_3, <question_id> like q_12, <instruction_id> like ins_31. Agent names can
 * contain spaces and are sent exactly as shown in the "to" menu.
 *
 *   card_id                                   the ONLY hidden input; the card being answered
 *
 *   For each room on the card that is not paused:
 *   room.<room_id>.working_on                 textarea, required
 *   room.<room_id>.finished.<n>.what          n = 1..3; a row with what and proof both empty is ignored
 *   room.<room_id>.finished.<n>.proof
 *   room.<room_id>.notes_for_others           textarea
 *   room.<room_id>.blocked_reason             both empty = not blocked
 *   room.<room_id>.blocked_unblock
 *
 *   For each question on the card:
 *   answer.<question_id>                      textarea
 *
 *   For each instruction on the card:
 *   ins.<instruction_id>.status               radio: acknowledged | in_progress | done | blocked | declined
 *   ins.<instruction_id>.note
 *   ins.<instruction_id>.proof
 *
 *   New questions, n = 1..2 (a row with empty text is ignored):
 *   question.<n>.to                           select: another agent's exact name, "conductor" or "people"
 *   question.<n>.text
 *   question.<n>.room_id                      select of rooms; present only if the agent has 2+ active rooms
 *
 *   One lesson for the playbook, n = 1 (a row with title and text both empty is ignored):
 *   lesson.<n>.title
 *   lesson.<n>.text
 *   lesson.<n>.room_id                        same rule as question.<n>.room_id
 *
 * formToReport turns the fields into the canonical report. It adds an entry for every room, question
 * and instruction on the card even when the agent left it empty (empty strings), so the shared
 * validator, not this file, writes the "missing" messages. Empty optional text is left out, a room
 * with no blocker gets blocked: null, and the lists are always present. It never invents a value.
 */

export const MAX_FINISHED_ROWS = 3;
export const MAX_NEW_QUESTIONS = 2;
export const MAX_LESSONS = 1;

/** The field names, in one place so the page that draws the form and the code that reads it agree. */
export const FIELD = {
  cardId: 'card_id',
  workingOn: (roomId: string) => `room.${roomId}.working_on`,
  finishedWhat: (roomId: string, n: number) => `room.${roomId}.finished.${n}.what`,
  finishedProof: (roomId: string, n: number) => `room.${roomId}.finished.${n}.proof`,
  notesForOthers: (roomId: string) => `room.${roomId}.notes_for_others`,
  blockedReason: (roomId: string) => `room.${roomId}.blocked_reason`,
  blockedUnblock: (roomId: string) => `room.${roomId}.blocked_unblock`,
  answer: (questionId: string) => `answer.${questionId}`,
  insStatus: (instructionId: string) => `ins.${instructionId}.status`,
  insNote: (instructionId: string) => `ins.${instructionId}.note`,
  insProof: (instructionId: string) => `ins.${instructionId}.proof`,
  questionTo: (n: number) => `question.${n}.to`,
  questionText: (n: number) => `question.${n}.text`,
  questionRoom: (n: number) => `question.${n}.room_id`,
  lessonTitle: (n: number) => `lesson.${n}.title`,
  lessonText: (n: number) => `lesson.${n}.text`,
  lessonRoom: (n: number) => `lesson.${n}.room_id`,
} as const;

/** The five instruction statuses as radio buttons, each said in plain words. */
export const INSTRUCTION_STATUS_CHOICES: { value: InstructionStatusT; label: string }[] = [
  { value: 'acknowledged', label: 'Acknowledged: I have read this and will do it' },
  { value: 'in_progress', label: 'In progress: I am working on it now' },
  { value: 'done', label: 'Done: it is finished (write the proof below)' },
  { value: 'blocked', label: 'Blocked: I cannot continue (write a note below)' },
  { value: 'declined', label: 'Declined: I will not do this (write a note below)' },
];

export type FormFields = URLSearchParams | Record<string, string>;

/** Browsers send line breaks as CRLF; store plain \n so length limits count what the agent typed. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function reader(fields: FormFields): (name: string) => string {
  if (fields instanceof URLSearchParams) return (name) => clean(fields.get(name));
  return (name) => clean(Object.hasOwn(fields, name) ? fields[name] : undefined);
}

export function formToReport(fields: FormFields, card: CardT): Record<string, unknown> {
  const get = reader(fields);
  const activeRooms = card.rooms.filter((r) => !r.paused);

  const rooms = activeRooms.map((r) => {
    const finished: { what: string; proof?: string }[] = [];
    for (let n = 1; n <= MAX_FINISHED_ROWS; n++) {
      const what = get(FIELD.finishedWhat(r.room_id, n));
      const proof = get(FIELD.finishedProof(r.room_id, n));
      if (!what && !proof) continue;
      finished.push(proof ? { what, proof } : { what });
    }
    const reason = get(FIELD.blockedReason(r.room_id));
    const unblock = get(FIELD.blockedUnblock(r.room_id));
    const notes = get(FIELD.notesForOthers(r.room_id));
    const entry: Record<string, unknown> = {
      room_id: r.room_id,
      working_on: get(FIELD.workingOn(r.room_id)),
      finished,
      blocked: reason || unblock ? { reason, what_would_unblock: unblock } : null,
    };
    if (notes) entry.notes_for_others = notes;
    return entry;
  });

  const answers = activeRooms.flatMap((r) =>
    r.questions_for_you.map((q) => ({ question_id: q.id, answer: get(FIELD.answer(q.id)) })),
  );

  const instruction_updates = activeRooms.flatMap((r) =>
    r.instructions_for_you.map((i) => {
      const entry: Record<string, unknown> = { instruction_id: i.id, status: get(FIELD.insStatus(i.id)) };
      const note = get(FIELD.insNote(i.id));
      const proof = get(FIELD.insProof(i.id));
      if (note) entry.note = note;
      if (proof) entry.proof = proof;
      return entry;
    }),
  );

  const questions: Record<string, unknown>[] = [];
  for (let n = 1; n <= MAX_NEW_QUESTIONS; n++) {
    const text = get(FIELD.questionText(n));
    if (!text) continue;
    const entry: Record<string, unknown> = { to: get(FIELD.questionTo(n)), text };
    const roomId = get(FIELD.questionRoom(n));
    if (roomId) entry.room_id = roomId;
    questions.push(entry);
  }

  const playbook_entries: Record<string, unknown>[] = [];
  for (let n = 1; n <= MAX_LESSONS; n++) {
    const title = get(FIELD.lessonTitle(n));
    const text = get(FIELD.lessonText(n));
    if (!title && !text) continue;
    const entry: Record<string, unknown> = { title, text };
    const roomId = get(FIELD.lessonRoom(n));
    if (roomId) entry.room_id = roomId;
    playbook_entries.push(entry);
  }

  return {
    card_id: get(FIELD.cardId) || card.card_id,
    rooms,
    answers,
    instruction_updates,
    questions,
    playbook_entries,
  };
}
