import { z } from 'zod';

/**
 * The agent-facing contract, shared by all three doors (MCP, REST, agent page) and used to
 * generate the MCP tool schemas and the OpenAPI document.
 *
 * These schemas DESCRIBE the canonical shapes. Validation of incoming reports is done by
 * services/report-validation.ts, which is deliberately forgiving about shape (a string where a
 * list is expected, a map instead of a list) and strict about content, and which explains every
 * problem at once in plain words. That way every door rejects the same things with the same text.
 */

export const MAX_TEXT = 2000;

const text = (description: string, max = MAX_TEXT) => z.string().max(max).describe(description);

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export const CheckInInput = z
  .object({})
  .describe('No input needed. Returns your briefing card for every room you belong to.');

export const WhoamiInput = z.object({}).describe('No input needed.');

export const FinishedItem = z.object({
  what: text('What you finished.'),
  proof: text('A link, or a sentence saying where the result is.').optional(),
});

export const BlockedInfo = z.object({
  reason: text('Why you are blocked.'),
  what_would_unblock: text('What would unblock you, and who could do it.'),
});

export const Disagreement = z.object({
  with: z.string().max(200).describe("The name of the agent you disagree with (as shown on your card)."),
  about: text('What the disagreement is about.'),
  my_view: text('Your position and why.'),
});

export const ReportRoom = z.object({
  room_id: z.string().max(100).describe('The room this entry is about (from your card).'),
  working_on: text('Required. One to three sentences on what you are doing right now for this room.'),
  finished: z.array(FinishedItem).max(20).optional().describe('What you finished since your last check-in, each with proof.'),
  notes_for_others: text('Anything the other agents or people in this room should know.').optional(),
  blocked: BlockedInfo.nullable().optional().describe('Only if you are blocked. Leave out or null if not.'),
  disagreements: z
    .array(Disagreement)
    .max(3)
    .optional()
    .describe('If you disagree with another agent, say so here. A person will decide.'),
});

export const Answer = z.object({
  question_id: z.string().max(100).describe('The id of a question on your card, e.g. q_12.'),
  answer: text('Your answer. "I can\'t answer this because…" is allowed. Skipping is not.'),
});

export const InstructionStatus = z.enum(['acknowledged', 'in_progress', 'done', 'blocked', 'declined']);

export const InstructionUpdate = z.object({
  instruction_id: z.string().max(100).describe('The id of an instruction on your card, e.g. ins_31.'),
  status: InstructionStatus.describe(
    'acknowledged, in_progress, done (needs proof), blocked (needs a note) or declined (needs a note).',
  ),
  note: text('Required for blocked and declined. Optional otherwise.').optional(),
  proof: text('Required for done: a link, or a sentence saying where the result is.').optional(),
});

export const NewQuestion = z.object({
  to: z
    .string()
    .max(200)
    .describe('Who should answer: an agent\'s name, "conductor", or "people".'),
  text: text('The question.'),
  room_id: z
    .string()
    .max(100)
    .optional()
    .describe('Which room the question belongs to. Required only if you are in more than one room.'),
});

export const PlaybookEntryInput = z.object({
  title: text('A short title for the lesson.', 200),
  text: text('The lesson, written so another agent could act on it.'),
  room_id: z.string().max(100).optional().describe('Required only if you are in more than one room.'),
});

export const ReportInput = z.object({
  card_id: z.string().max(100).describe('The card_id from the card you are answering.'),
  rooms: z.array(ReportRoom).max(20).optional().describe('One entry per room on the card.'),
  answers: z.array(Answer).max(50).optional().describe('One answer per question on the card.'),
  instruction_updates: z
    .array(InstructionUpdate)
    .max(50)
    .optional()
    .describe('One status per instruction on the card.'),
  questions: z.array(NewQuestion).max(10).optional().describe('New questions you want answered.'),
  playbook_entries: z
    .array(PlaybookEntryInput)
    .max(5)
    .optional()
    .describe('Lessons worth saving for everyone in the room.'),
});

export const PostKind = z.enum(['message', 'question', 'note']);

export const PostInput = z.object({
  kind: PostKind.default('message').describe('message, question (needs "to"), or note.'),
  text: text('What you want to say.'),
  to: z
    .string()
    .max(200)
    .optional()
    .describe('For a question: an agent\'s name, "conductor", or "people". For a message: optionally an agent\'s name.'),
  room_id: z.string().max(100).optional().describe('Required only if you are in more than one room.'),
});

export const LookupInput = z.object({
  room_id: z.string().max(100).optional().describe('Search only this room. Defaults to all your rooms.'),
  query: z.string().max(200).optional().describe('Words to search for. Leave out to get the most recent items.'),
  id: z
    .string()
    .max(100)
    .optional()
    .describe('Fetch one item by id, e.g. evt_120, q_12, ins_31, dec_4 or pb_3.'),
  kind: z.enum(['all', 'history', 'playbook']).default('all').describe('What to search.'),
  limit: z.number().int().min(1).max(20).default(10).describe('How many results (at most 20).'),
});

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

export const CardItem = z.object({
  id: z.string().describe('Use with tempo_lookup to read the full item.'),
  at: z.string(),
  from: z.string(),
  kind: z.string(),
  text: z.string(),
});

export const CardQuestion = z.object({
  id: z.string(),
  from: z.string(),
  asked_at: z.string(),
  text: z.string(),
});

export const CardInstruction = z.object({
  id: z.string(),
  from: z.string().describe('Who issued it: a named person, or the Conductor on behalf of the room\'s people.'),
  issued_at: z.string(),
  text: z.string(),
  done_when: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  due: z.string().nullable(),
  status: z.string(),
});

export const CardPlaybookEntry = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
});

export const CardRoom = z.object({
  room_id: z.string(),
  room_name: z.string(),
  paused: z.boolean(),
  goal: z.string(),
  rules: z.array(z.string()),
  limits: z.object({
    you_may: z.array(z.string()),
    ask_a_person_first: z.array(z.string()),
  }),
  others_here: z.array(z.string()).describe('The other agents and people in this room.'),
  since_last_check_in: z.array(CardItem),
  questions_for_you: z.array(CardQuestion),
  instructions_for_you: z.array(CardInstruction),
  playbook: z.array(CardPlaybookEntry),
});

export const Card = z.object({
  ok: z.literal(true),
  card_id: z.string(),
  now: z.string(),
  now_text: z.string(),
  agent: z.object({ name: z.string(), owner: z.string() }),
  about: z.string(),
  paused: z.boolean(),
  rooms: z.array(CardRoom),
  you_must_send_back: z.array(z.string()),
  how_to_reply: z.string(),
  next_check_in_due: z.string().nullable(),
  next_check_in_due_text: z.string(),
  left_out: z.string().nullable().describe('What was left out to keep the card short, and how to fetch it.'),
});

export const ArrivedItem = z.object({
  room_id: z.string(),
  kind: z.string(),
  id: z.string(),
  from: z.string(),
  at: z.string(),
  text: z.string(),
});

export const ReportResult = z.object({
  ok: z.literal(true),
  message: z.string(),
  report_id: z.string(),
  card_id: z.string(),
  updated: z.boolean().describe('True when this replaced an earlier report for the same card.'),
  next_check_in_due: z.string().nullable(),
  next_check_in_due_text: z.string(),
  arrived_since_card: z
    .array(ArrivedItem)
    .describe('Questions, instructions and messages for you that arrived after your card was issued.'),
});

export const WhoamiResult = z.object({
  ok: z.literal(true),
  connected: z.literal(true),
  message: z.string(),
  agent: z.object({ id: z.string(), name: z.string(), type: z.string(), owner: z.string() }),
  rooms: z.array(z.object({ room_id: z.string(), name: z.string(), paused: z.boolean() })),
  schedule: z.object({
    text: z.string(),
    interval_minutes: z.number(),
    working_days: z.string(),
    working_hours: z.string(),
    timezone: z.string(),
    offset_minutes: z.number(),
  }),
  next_check_in_due: z.string().nullable(),
  next_check_in_due_text: z.string(),
  last_check_in: z.string().nullable(),
});

export const PostResult = z.object({
  ok: z.literal(true),
  message: z.string(),
  id: z.string(),
  room_id: z.string(),
});

export const LookupItem = z.object({
  id: z.string(),
  room_id: z.string(),
  kind: z.string(),
  at: z.string(),
  from: z.string(),
  text: z.string(),
});

export const LookupResult = z.object({
  ok: z.literal(true),
  message: z.string(),
  results: z.array(LookupItem),
  more_available: z.boolean(),
});

export const ErrorResult = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    problems: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    next_step: z.string().optional(),
    retry_after_seconds: z.number().optional(),
  }),
});

export type CardT = z.infer<typeof Card>;
export type CardRoomT = z.infer<typeof CardRoom>;
export type CardItemT = z.infer<typeof CardItem>;
export type ReportInputT = z.infer<typeof ReportInput>;
export type ReportResultT = z.infer<typeof ReportResult>;
export type WhoamiResultT = z.infer<typeof WhoamiResult>;
export type PostResultT = z.infer<typeof PostResult>;
export type LookupResultT = z.infer<typeof LookupResult>;
export type ArrivedItemT = z.infer<typeof ArrivedItem>;
export type InstructionStatusT = z.infer<typeof InstructionStatus>;

export type Door = 'mcp' | 'rest' | 'page' | 'email' | 'internal';
