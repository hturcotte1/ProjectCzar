import { z } from 'zod';

/**
 * What the Conductor returns on every run. The JSON Schema below is sent to the model as its
 * structured-output format (every field required; optional values are null), and the zod schema
 * validates what comes back. Invalid output is retried once; if it is still invalid, nothing
 * happens and the run is logged as failed.
 */

const S = (max: number) => z.string().max(max);

export const ConductorOutput = z.object({
  summary: S(1500),
  nothing_to_do: z.boolean(),
  instructions: z
    .array(
      z.object({
        agent: S(100),
        text: S(1000),
        done_when: S(400),
        priority: z.enum(['low', 'normal', 'high']),
        due: S(40).nullable(),
        why: S(600),
        needs_approval: z.boolean(),
        approval_reason: S(400).nullable(),
        routed_from: S(40).nullable(),
      }),
    )
    .max(8),
  questions: z.array(z.object({ to: S(100), text: S(800), why: S(400) })).max(4),
  instruction_changes: z
    .array(
      z.object({
        instruction_id: S(40),
        action: z.enum(['cancel', 'reword']),
        new_text: S(1000).nullable(),
        new_done_when: S(400).nullable(),
        why: S(400),
      }),
    )
    .max(6),
  decisions: z
    .array(
      z.object({
        title: S(200),
        context: S(1200),
        options: z.array(S(300)).min(2).max(5),
        recommendation: S(300).nullable(),
        why: S(600),
        agents: z.array(S(100)).max(10),
      }),
    )
    .max(3),
  answers: z.array(z.object({ question_id: S(40), answer: S(1500) })).max(6),
  room_note: S(800).nullable(),
  playbook_suggestions: z.array(z.object({ title: S(200), text: S(1200) })).max(2),
});

export type ConductorOutputT = z.infer<typeof ConductorOutput>;

const str = (description: string) => ({ type: 'string', description });
const nullableStr = (description: string) => ({ type: ['string', 'null'], description });

/** JSON Schema for the model's structured output (all properties required, no extras). */
export const CONDUCTOR_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'nothing_to_do', 'instructions', 'questions', 'instruction_changes', 'decisions', 'answers', 'room_note', 'playbook_suggestions'],
  properties: {
    summary: str('2 to 4 plain sentences for the people reading the log: what you noticed and what you decided, and why.'),
    nothing_to_do: { type: 'boolean', description: 'True when nothing needs doing this run (a valid and common answer). Then the lists are empty.' },
    instructions: {
      type: 'array',
      description: 'New instructions for agents. Small concrete steps. Empty in relay mode unless routing a person\'s request.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agent', 'text', 'done_when', 'priority', 'due', 'why', 'needs_approval', 'approval_reason', 'routed_from'],
        properties: {
          agent: str('Exact agent name from the roster.'),
          text: str('The instruction, one small step, in plain words.'),
          done_when: str('A concrete, checkable "done when" line.'),
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          due: nullableStr('ISO 8601 date-time when it is due, or null.'),
          why: str('Why this, why this agent, and what it connects to.'),
          needs_approval: { type: 'boolean', description: 'True if this needs a person\'s approval first (anything outside the room\'s limits, or risky).' },
          approval_reason: nullableStr('If needs_approval, which limit or risk.'),
          routed_from: nullableStr('If this routes a person\'s request, the id of their message or question (e.g. evt_12 or q_4); otherwise null.'),
        },
      },
    },
    questions: {
      type: 'array',
      description: 'Clarifying questions. "to" is an agent name or "people".',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['to', 'text', 'why'],
        properties: { to: str('Agent name or "people".'), text: str('The question.'), why: str('Why you need to know.') },
      },
    },
    instruction_changes: {
      type: 'array',
      description: 'Cancel or reword one of YOUR open instructions (never a person\'s).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['instruction_id', 'action', 'new_text', 'new_done_when', 'why'],
        properties: {
          instruction_id: str('e.g. ins_31'),
          action: { type: 'string', enum: ['cancel', 'reword'] },
          new_text: nullableStr('For reword: the new text.'),
          new_done_when: nullableStr('For reword: the new done-when line, or null to keep it.'),
          why: str('Why.'),
        },
      },
    },
    decisions: {
      type: 'array',
      description: 'Choices only a person can make: conflicts between agents, anything outside the limits, direction changes.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'context', 'options', 'recommendation', 'why', 'agents'],
        properties: {
          title: str('Short question for the person.'),
          context: str('What happened, in plain words, with sources.'),
          options: { type: 'array', items: { type: 'string' }, description: '2 to 5 options a person can pick with one tap.' },
          recommendation: nullableStr('The option you recommend (copy its text), or null.'),
          why: str('Why you recommend it, or why it needs a person.'),
          agents: { type: 'array', items: { type: 'string' }, description: 'Agent names whose next card should show the outcome.' },
        },
      },
    },
    answers: {
      type: 'array',
      description: 'Answers to questions addressed to the Conductor. Only answer from facts in front of you; otherwise leave it for people.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question_id', 'answer'],
        properties: { question_id: str('e.g. q_12'), answer: str('The answer.') },
      },
    },
    room_note: nullableStr('A short public note for people (and agents) when you change direction, or null.'),
    playbook_suggestions: {
      type: 'array',
      description: 'Lessons worth saving for everyone, if any.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'text'],
        properties: { title: str('Short title.'), text: str('The lesson.') },
      },
    },
  },
};
