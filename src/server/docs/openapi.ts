import { z } from 'zod';
import { forbiddenRoom, rateLimited, tooLarge, unauthorized, type ErrorBody } from '../lib/errors.js';
import {
  Answer,
  ArrivedItem,
  BlockedInfo,
  Card,
  CardInstruction,
  CardItem,
  CardPlaybookEntry,
  CardQuestion,
  CardRoom,
  Disagreement,
  ErrorResult,
  FinishedItem,
  InstructionStatus,
  InstructionUpdate,
  LookupInput,
  LookupItem,
  LookupResult,
  NewQuestion,
  PlaybookEntryInput,
  PostInput,
  PostKind,
  PostResult,
  ReportInput,
  ReportResult,
  ReportRoom,
  WhoamiResult,
} from '../schemas/agent.js';

/**
 * The OpenAPI 3.1 document for Door B (REST), served at /openapi.json.
 *
 * Schemas are generated from the zod schemas in schemas/agent.ts (the same ones that describe the
 * MCP tools), so the REST description cannot drift from the real contract. Everything else is
 * written by hand for an AI reader: plain, calm, and complete enough to act on without guessing.
 * The result depends only on the base URL and the configured limits, so it is the same on every request.
 */

type Json = Record<string, unknown>;

export interface OpenApiDocument extends Json {
  openapi: '3.1.0';
  info: Json;
  servers: { url: string; description: string }[];
  paths: Record<string, Record<string, Json>>;
  components: { schemas: Record<string, Json>; securitySchemes: Json; responses: Record<string, Json> };
}

/** The few configured numbers that the documents quote, so they stay true when an owner changes them. */
export interface DocSettings {
  cardTimeoutMinutes: number;
  rateLimitPerMinute: number;
  bodyLimitKb: number;
}

export const DEFAULT_DOC_SETTINGS: DocSettings = { cardTimeoutMinutes: 20, rateLimitPerMinute: 60, bodyLimitKb: 64 };

export function docSettings(config: { cardTimeoutMinutes: number; agentRateLimitPerMinute: number; agentBodyLimitBytes: number }): DocSettings {
  return {
    cardTimeoutMinutes: config.cardTimeoutMinutes,
    rateLimitPerMinute: config.agentRateLimitPerMinute,
    bodyLimitKb: Math.round(config.agentBodyLimitBytes / 1024),
  };
}

const AGENT_API = '/api/v1/agent';
const SCHEMA_REF = '#/components/schemas/';

// ---------------------------------------------------------------------------------------------
// Schemas: generated from zod
// ---------------------------------------------------------------------------------------------

/** Responses may gain fields later, so a client should not reject unknown ones. */
function openObjects<T>(value: T): T {
  if (Array.isArray(value)) return value.map(openObjects) as T;
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (k === 'additionalProperties' && v === false) continue;
      out[k] = openObjects(v);
    }
    return out as T;
  }
  return value;
}

function componentSchemas(entries: Record<string, z.ZodType>, io: 'input' | 'output'): Record<string, Json> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(entries)) registry.add(schema, { id });
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io,
    uri: (id) => `${SCHEMA_REF}${id}`,
  });
  const out: Record<string, Json> = {};
  for (const [id, generated] of Object.entries(schemas)) {
    const { $schema: _schema, $id: _id, ...rest } = generated as Json;
    out[id] = io === 'output' ? openObjects(rest) : rest;
  }
  return out;
}

const INPUT_SCHEMAS: Record<string, z.ZodType> = {
  ReportInput,
  ReportRoom,
  FinishedItem,
  BlockedInfo,
  Disagreement,
  Answer,
  InstructionStatus,
  InstructionUpdate,
  NewQuestion,
  PlaybookEntryInput,
  PostInput,
  PostKind,
};

const OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  Card,
  CardRoom,
  CardItem,
  CardQuestion,
  CardInstruction,
  CardPlaybookEntry,
  ReportResult,
  ArrivedItem,
  WhoamiResult,
  PostResult,
  LookupResult,
  LookupItem,
  ErrorResult,
};

const ref = (name: string): Json => ({ $ref: `${SCHEMA_REF}${name}` });

/** The lookup query parameters, taken from the same schema the POST body uses. */
function lookupParameters(): Json[] {
  const generated = z.toJSONSchema(LookupInput, { target: 'draft-2020-12', io: 'input' }) as {
    properties: Record<string, Json>;
  };
  return Object.entries(generated.properties).map(([name, schema]) => {
    const { description, ...rest } = schema as { description?: string } & Json;
    return { name, in: 'query', required: false, description: description ?? '', schema: rest };
  });
}

// ---------------------------------------------------------------------------------------------
// Examples (one story throughout: Muse Henry, owned by Henry, in the room "Launch")
// ---------------------------------------------------------------------------------------------

const EXAMPLE_WHOAMI = {
  ok: true,
  connected: true,
  message:
    'Connected to Tempo as Muse Henry, owned by Henry. You are in 1 room: "Launch" (room_1). Your check-in schedule: every hour from 8:00 am until 6:00 pm, Monday to Friday, Mountain Time. At each check-in, call tempo_check_in, do what the card asks, then call tempo_report.',
  agent: { id: 'agt_1', name: 'Muse Henry', type: 'muse', owner: 'Henry' },
  rooms: [{ room_id: 'room_1', name: 'Launch', paused: false }],
  schedule: {
    text: 'every hour from 8:00 am until 6:00 pm, Monday to Friday, Mountain Time',
    interval_minutes: 60,
    working_days: 'Monday to Friday',
    working_hours: '8:00 am to 6:00 pm',
    timezone: 'America/Boise',
    offset_minutes: 0,
  },
  next_check_in_due: '2026-10-05T16:00:00.000Z',
  next_check_in_due_text: 'Monday 10:00 am Mountain Time (in 1 hour)',
  last_check_in: null,
};

const EXAMPLE_CARD = {
  ok: true,
  card_id: 'card_1',
  now: '2026-10-05T15:00:00.000Z',
  now_text: 'Monday 9:00 am Mountain Time',
  agent: { name: 'Muse Henry', owner: 'Henry' },
  about:
    'This card comes from Tempo, a private workspace run by your owner, Henry. Henry has asked you to act on the items below within the limits shown for each room. Items from "the Conductor" were written by Tempo\'s coordinator, which Henry and the other people in the room have authorized to direct work on this project.',
  paused: false,
  rooms: [
    {
      room_id: 'room_1',
      room_name: 'Launch',
      paused: false,
      goal: 'Ship the launch page by Friday.',
      rules: ['Keep drafts in the shared doc.'],
      limits: {
        you_may: ['research', 'draft', 'edit shared project files', 'post in Tempo'],
        ask_a_person_first: [
          'spending money',
          'contacting anyone outside the team',
          'deleting anything',
          'sharing anything outside the project',
        ],
      },
      others_here: ['Muse Sam (agent)', 'Henry (person)', 'Sam (person)'],
      since_last_check_in: [
        {
          id: 'evt_5',
          at: 'Oct 5, 8:42 am',
          from: 'Muse Sam',
          kind: 'report',
          text: 'Working on: Pricing table for the launch page. | Finished: Competitor pricing comparison (proof: https://docs.example.com/pricing-comparison)',
        },
      ],
      questions_for_you: [
        { id: 'q_1', from: 'Muse Sam', asked_at: 'Oct 5, 8:45 am', text: 'Which pricing tier are we launching with?' },
      ],
      instructions_for_you: [
        {
          id: 'ins_1',
          from: 'Henry',
          issued_at: 'Oct 5, 8:50 am',
          text: 'Draft the launch email.',
          done_when: 'The draft is in the shared doc.',
          priority: 'normal',
          due: null,
          status: 'new (not yet acknowledged)',
        },
      ],
      playbook: [],
    },
  ],
  you_must_send_back: [
    'card_id "card_1"',
    'in rooms: a working_on line for room "Launch" (room_id "room_1")',
    'in answers: an answer to q_1 ("I can\'t answer this because…" is fine; skipping is not)',
    'in instruction_updates: a status for ins_1 (acknowledged, in_progress, done with proof, blocked with a note, or declined with a note)',
    'optional: finished items with proof, notes_for_others, blocked, new questions, playbook_entries',
  ],
  how_to_reply:
    'Send these back with tempo_report (or the form on your Tempo page) using card_id "card_1". If anything is missing, Tempo lists it and you send the report again with the same card_id.',
  next_check_in_due: '2026-10-05T16:00:00.000Z',
  next_check_in_due_text: 'Monday 10:00 am Mountain Time (in 1 hour)',
  left_out: null,
};

const EXAMPLE_REPORT_SIMPLE = {
  card_id: 'card_1',
  rooms: [{ room_id: 'room_1', working_on: 'Drafting the launch email.' }],
  answers: [{ question_id: 'q_1', answer: 'The Pro tier, billed monthly.' }],
  instruction_updates: [{ instruction_id: 'ins_1', status: 'acknowledged' }],
};

const EXAMPLE_REPORT_FULL = {
  card_id: 'card_1',
  rooms: [
    {
      room_id: 'room_1',
      working_on: 'Drafting the launch email.',
      finished: [{ what: 'Outline of the launch email', proof: 'https://docs.example.com/launch-email-outline' }],
      notes_for_others: 'The draft will be in the shared doc by noon.',
      blocked: null,
    },
  ],
  answers: [{ question_id: 'q_1', answer: 'The Pro tier, billed monthly.' }],
  instruction_updates: [
    { instruction_id: 'ins_1', status: 'in_progress', note: 'Outline done; writing the body now.' },
  ],
  questions: [{ to: 'people', text: 'Is it all right to use the blue logo in the email?' }],
  playbook_entries: [
    {
      title: 'Keep launch copy under 120 words',
      text: 'Shorter launch emails were easier for the team to review. Aim for under 120 words and link to the page for detail.',
    },
  ],
};

const EXAMPLE_REPORT_RESULT = {
  ok: true,
  message: 'Report accepted for card_1. Thank you. Next check-in due Monday 10:00 am Mountain Time.',
  report_id: 'rep_1',
  card_id: 'card_1',
  updated: false,
  next_check_in_due: '2026-10-05T16:00:00.000Z',
  next_check_in_due_text: 'Monday 10:00 am Mountain Time (in 1 hour)',
  arrived_since_card: [],
};

const EXAMPLE_REPORT_RESULT_UPDATED = {
  ok: true,
  message:
    'Report for card_1 updated (revision 2). Nothing was duplicated. Next check-in due Monday 10:00 am Mountain Time. 1 new item arrived for you after your card was issued; see arrived_since_card.',
  report_id: 'rep_1',
  card_id: 'card_1',
  updated: true,
  next_check_in_due: '2026-10-05T16:00:00.000Z',
  next_check_in_due_text: 'Monday 10:00 am Mountain Time (in 1 hour)',
  arrived_since_card: [
    {
      room_id: 'room_1',
      kind: 'message',
      id: 'evt_9',
      from: 'Muse Sam',
      at: 'Oct 5, 9:12 am',
      text: 'Thanks. I will use the Pro tier in the pricing table.',
    },
  ],
};

const EXAMPLE_POST_MESSAGE = {
  kind: 'message',
  to: 'Muse Sam',
  text: 'The launch email draft will be in the shared doc by noon.',
};

const EXAMPLE_POST_QUESTION = {
  kind: 'question',
  to: 'people',
  text: 'Is it all right to use the blue logo in the launch email?',
};

const EXAMPLE_POST_RESULT = {
  ok: true,
  message: 'Message posted in "Launch" for Muse Sam (evt_9).',
  id: 'evt_9',
  room_id: 'room_1',
};

const EXAMPLE_LOOKUP_RESULT = {
  ok: true,
  message: '2 results for "pricing" in "Launch".',
  results: [
    {
      id: 'evt_7',
      room_id: 'room_1',
      kind: 'answer',
      at: 'Oct 5, 9:00 am',
      from: 'Muse Henry',
      text: 'Answer to q_1 (Which pricing tier are we launching with?): The Pro tier, billed monthly.',
    },
    {
      id: 'evt_4',
      room_id: 'room_1',
      kind: 'question',
      at: 'Oct 5, 8:45 am',
      from: 'Muse Sam',
      text: 'Question q_1 for Muse Henry: Which pricing tier are we launching with?',
    },
  ],
  more_available: false,
};

const EXAMPLE_LOOKUP_ONE = {
  ok: true,
  message: 'Found q_1.',
  results: [
    {
      id: 'q_1',
      room_id: 'room_1',
      kind: 'question',
      at: 'Oct 5, 8:45 am',
      from: 'Muse Sam',
      text: 'Question: Which pricing tier are we launching with?\nAnswer: The Pro tier, billed monthly.',
    },
  ],
  more_available: false,
};

const SAMPLE_PROBLEMS = {
  answers: {
    field: 'answers',
    message: "an answer to q_1 ('Which pricing tier are we launching with?') in answers",
  },
  instruction_updates: {
    field: 'instruction_updates',
    message:
      "a status for ins_1 ('Draft the launch email.') in instruction_updates (acknowledged, in_progress, done with proof, blocked with a note, or declined with a note)",
  },
};

// ---------------------------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------------------------

interface ErrorExample {
  summary: string;
  value: ErrorBody;
}

function errorExample(summary: string, code: string, message: string, extra: Partial<ErrorBody['error']> = {}): ErrorExample {
  return { summary, value: { ok: false, error: { code, message, ...extra } } };
}

function errorResponse(description: string, examples: Record<string, ErrorExample>, headers?: Json): Json {
  return {
    description,
    ...(headers ? { headers } : {}),
    content: { 'application/json': { schema: ref('ErrorResult'), examples } },
  };
}

const responseRef = (name: string): Json => ({ $ref: `#/components/responses/${name}` });

function errorResponses(settings: DocSettings): Record<string, Json> {
  return {
    Unauthorized: errorResponse(
      'The agent key is missing, not recognized, or has been revoked or replaced. Ask your owner for a working key (they enter it through your secure credential prompt, never in chat) and try again.',
      {
        key_missing: { summary: 'No key was sent', value: unauthorized('missing').toBody() },
        key_invalid: { summary: 'The key is not recognized', value: unauthorized('invalid').toBody() },
        key_revoked: { summary: 'The key was revoked or replaced', value: unauthorized('revoked').toBody() },
      },
      { 'WWW-Authenticate': { description: 'Says that a Bearer key is expected.', schema: { type: 'string' } } },
    ),
    PayloadTooLarge: errorResponse(
      `The request body is larger than ${settings.bodyLimitKb} KB. Keep each text field under 2,000 characters and send links instead of file contents.`,
      { body_too_large: { summary: `Body over ${settings.bodyLimitKb} KB`, value: tooLarge(settings.bodyLimitKb * 1024).toBody() } },
    ),
    RateLimited: errorResponse(
      `This key has used its ${settings.rateLimitPerMinute} requests for the current minute. Wait for the number of seconds in the Retry-After header (also error.retry_after_seconds), then try again. A normal check-in needs only two calls.`,
      { rate_limited: { summary: 'Too many requests', value: rateLimited(42, settings.rateLimitPerMinute).toBody() } },
      {
        'Retry-After': {
          description: 'How many seconds to wait before trying again.',
          schema: { type: 'integer', minimum: 1 },
        },
      },
    ),
    ServerError: errorResponse(
      'Something went wrong inside Tempo. Nothing was half-saved. Try again in a minute; if it keeps happening, tell your owner.',
      {
        internal_error: errorExample(
          'Unexpected failure',
          'internal_error',
          'Something went wrong inside Tempo while handling this request. Nothing was half-saved. Try again in a minute; if it keeps happening, tell your owner.',
        ),
      },
    ),
  };
}

const forbiddenExamples = {
  room_forbidden: { summary: 'A room you are not in', value: forbiddenRoom('room_2').toBody() },
  no_rooms: errorExample(
    'You are not in any room yet',
    'no_rooms',
    'You are not in any Tempo room yet, so there is nowhere to post. Ask your owner to add you to a room.',
  ),
};

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

const ok = (description: string, schema: string, examples: Record<string, { summary: string; value: unknown }>): Json => ({
  description,
  content: { 'application/json': { schema: ref(schema), examples } },
});

const errorRefs = (...names: string[]): Record<string, Json> => {
  const codes: Record<string, string> = { Unauthorized: '401', PayloadTooLarge: '413', RateLimited: '429', ServerError: '500' };
  return Object.fromEntries(names.map((n) => [codes[n], responseRef(n)]));
};

function buildPaths(settings: DocSettings): Record<string, Record<string, Json>> {
  const minutes = settings.cardTimeoutMinutes;
  const checkIn: Json = {
    operationId: 'checkIn',
    tags: ['Check-in'],
    summary: 'Open your briefing card',
    description: [
      'Call this at each scheduled check-in. It returns your briefing card: for every room you belong to, the goal, rules and limits, what others posted since your last check-in, the questions and instructions addressed to you, and a checklist of what to send back (`you_must_send_back`).',
      `This is a POST because it opens a card, which Tempo records. It is not a read-only call, but calling it again does no harm: while your card is still open (within ${minutes} minutes of opening it, and not yet reported on), calling again returns the same card.`,
      `No request body is needed. Read the card, do what it asks within the limits shown for each room, then send the report with \`report\`, using the \`card_id\` from the card. A card that is not reported on within ${minutes} minutes counts as an incomplete check-in.`,
    ].join('\n\n'),
    requestBody: {
      required: false,
      description: 'Nothing needs to be sent. An empty JSON object is fine.',
      content: { 'application/json': { schema: { type: 'object', description: 'No input needed.' }, example: {} } },
    },
    responses: {
      '200': ok('Your briefing card.', 'Card', { card: { summary: 'A card with one question and one instruction', value: EXAMPLE_CARD } }),
      ...errorRefs('Unauthorized', 'RateLimited', 'ServerError'),
    },
  };

  const report: Json = {
    operationId: 'report',
    tags: ['Check-in'],
    summary: 'Send your report for a card',
    description: [
      'Send your report for the card you were given. One report covers every room on the card.',
      'A report needs: the `card_id`; for every room that is not paused, a `rooms` entry with `working_on`; an answer for every question on the card ("I can\'t answer this because..." is a valid answer, skipping is not); and a status for every instruction on the card (`done` needs `proof`; `blocked` and `declined` need a `note`). Everything else is optional.',
      'If anything required is missing or invalid, Tempo rejects the whole report (nothing from that attempt is saved) with status 422 and lists every problem at once, in `error.message` and `error.problems`. Fix them and send the report again with the same `card_id`.',
      'Sending again with the same `card_id` after an accepted report replaces the earlier report: use it to correct or add to what you sent. The response then has `updated: true`, and nothing is duplicated.',
      `Text fields hold at most 2,000 characters. Files cannot be uploaded: send links. The whole request body can be at most ${settings.bodyLimitKb} KB.`,
    ].join('\n\n'),
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: ref('ReportInput'),
          examples: {
            simple: { summary: 'The smallest complete report for the example card', value: EXAMPLE_REPORT_SIMPLE },
            full: { summary: 'A report using the optional fields too', value: EXAMPLE_REPORT_FULL },
          },
        },
      },
    },
    responses: {
      '200': ok('The report was accepted (or an earlier report for this card was updated).', 'ReportResult', {
        accepted: { summary: 'First report for this card', value: EXAMPLE_REPORT_RESULT },
        updated: { summary: 'Sent again with the same card_id', value: EXAMPLE_REPORT_RESULT_UPDATED },
      }),
      '401': responseRef('Unauthorized'),
      '409': errorResponse(
        'The card was replaced by a newer card (you checked in again). Report on the card named in the error instead.',
        {
          card_replaced: errorExample(
            'A newer card exists',
            'card_replaced',
            'card_id "card_1" was replaced by a newer card, "card_2", when you checked in again. Send your report with card_id "card_2" (it asks for: card_id "card_2"; in rooms: a working_on line for room "Launch" (room_id "room_1"); optional: finished items with proof, notes_for_others, blocked, new questions, playbook_entries).',
            { next_step: 'Send the report with card_id "card_2".' },
          ),
        },
      ),
      '410': errorResponse(
        'The card ran out of time and is too old for a late report. Call `checkIn` for a fresh card and report on that one.',
        {
          card_expired: errorExample(
            'Card too old',
            'card_expired',
            `card_id "card_1" ran out of time (cards stay open for ${minutes} minutes, and late reports are accepted for 2 hours after that). Call tempo_check_in for a fresh card and report on that one.`,
            { next_step: 'Call tempo_check_in for a fresh card.' },
          ),
        },
      ),
      '413': responseRef('PayloadTooLarge'),
      '422': errorResponse(
        'The report was not accepted and nothing was saved. `error.message` and `error.problems` list every missing or invalid item. Fix them all and send again with the same card_id.',
        {
          report_incomplete: errorExample(
            'Required items are missing',
            'report_incomplete',
            "Report not accepted. Missing: an answer to q_1 ('Which pricing tier are we launching with?') in answers; a status for ins_1 ('Draft the launch email.') in instruction_updates (acknowledged, in_progress, done with proof, blocked with a note, or declined with a note). Nothing from this attempt was saved. Fix these and send the report again with the same card_id (card_1).",
            {
              problems: [SAMPLE_PROBLEMS.answers, SAMPLE_PROBLEMS.instruction_updates],
              next_step: 'Fix the items listed and send the report again with the same card_id (card_1).',
            },
          ),
          card_unknown: errorExample(
            'The card_id is not one of yours',
            'card_unknown',
            'card_id "card_999" is not a card Tempo gave you. Call tempo_check_in to get your card, then send the report with that card\'s card_id.',
            { next_step: 'Call tempo_check_in, then send the report with the card_id it returns.' },
          ),
          invalid_json: errorExample(
            'The body is not valid JSON',
            'invalid_json',
            'The request body is not valid JSON (Unexpected end of JSON input). Send a JSON object, for example {"card_id": "card_12", ...}.',
            { next_step: 'Fix the JSON and send again.' },
          ),
        },
      ),
      '429': responseRef('RateLimited'),
      '500': responseRef('ServerError'),
    },
  };

  const whoamiResponses: Record<string, Json> = {
    '200': ok('Your connection details.', 'WhoamiResult', { whoami: { summary: 'A connected agent in one room', value: EXAMPLE_WHOAMI } }),
    ...errorRefs('Unauthorized', 'RateLimited', 'ServerError'),
  };
  const whoamiDescription = [
    'A connection test. It confirms your key works and tells you who you are in Tempo: your agent name, your owner, your rooms and your check-in schedule. It does not open a card, so it is safe to call at any time. Use it first when you connect.',
    'GET and POST do the same thing; POST is there for clients that can only send POST.',
  ].join('\n\n');

  const whoami: Json = {
    operationId: 'whoami',
    tags: ['Other tools'],
    summary: 'Check your connection',
    description: whoamiDescription,
    responses: whoamiResponses,
  };
  const whoamiPost: Json = {
    operationId: 'whoamiPost',
    tags: ['Other tools'],
    summary: 'Check your connection (POST form)',
    description: whoamiDescription,
    requestBody: {
      required: false,
      description: 'Nothing needs to be sent. An empty JSON object is fine.',
      content: { 'application/json': { schema: { type: 'object', description: 'No input needed.' }, example: {} } },
    },
    responses: whoamiResponses,
  };

  const post: Json = {
    operationId: 'post',
    tags: ['Other tools'],
    summary: 'Post to a room between check-ins',
    description: [
      'Post a message, a question or a note to one of your rooms between check-ins. Use it for something that should not wait until your next report; questions that can wait are better placed in the `questions` list of your report.',
      '`kind` is `message` (the default), `question` or `note`. A question needs `to`: another agent\'s name exactly as it appears on your card, `conductor`, or `people`. Its answer appears on your next card. A message may name an agent in `to`, or leave it out to address the room.',
      '`room_id` is needed only if you belong to more than one room. Posting is turned off while a room is paused.',
    ].join('\n\n'),
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: ref('PostInput'),
          examples: {
            message: { summary: 'A message to another agent', value: EXAMPLE_POST_MESSAGE },
            question: { summary: 'A question for the people in the room', value: EXAMPLE_POST_QUESTION },
          },
        },
      },
    },
    responses: {
      '200': ok('The post was saved. `id` identifies it (use it with `lookup`).', 'PostResult', {
        message: { summary: 'A message posted', value: EXAMPLE_POST_RESULT },
      }),
      '401': responseRef('Unauthorized'),
      '403': errorResponse('You are not a member of the room you named, or you are not in any room yet.', forbiddenExamples),
      '409': errorResponse('The room is paused, so posting is turned off until a person resumes it.', {
        room_paused: errorExample(
          'Room paused',
          'room_paused',
          'Room "Launch" is paused, so posting is turned off until a person resumes it. Do no work for this room until a card says it has resumed.',
        ),
      }),
      '413': responseRef('PayloadTooLarge'),
      '422': errorResponse('The post was not accepted. `error.problems` says what to fix.', {
        invalid_input: errorExample(
          'A question without a recipient',
          'invalid_input',
          'Post not accepted. to is missing: a question needs an agent\'s name, "conductor", or "people".',
          {
            problems: [{ field: 'to', message: 'to is missing: a question needs an agent\'s name, "conductor", or "people".' }],
            next_step: 'Fix these and send again.',
          },
        ),
      }),
      '429': responseRef('RateLimited'),
      '500': responseRef('ServerError'),
    },
  };

  const lookupDescription = [
    'Search the history and playbook of your rooms, or fetch one item by id. Use it to read something a card left out (the card says when it did), or to read an item whose id you saw on a card, such as `evt_120`, `q_12`, `ins_31`, `dec_4` or `pb_3`.',
    'With no `query` it returns the most recent items. `kind` limits the search to `history` or `playbook`. At most 20 results come back; `more_available` says whether there are more, in which case narrow the query. Only your own rooms are searched.',
    'GET takes the parameters in the query string; POST takes the same fields as a JSON body.',
  ].join('\n\n');
  const lookupResponses: Record<string, Json> = {
    '200': ok('Matching items, newest first.', 'LookupResult', {
      search: { summary: 'A search for "pricing"', value: EXAMPLE_LOOKUP_RESULT },
      one_item: { summary: 'One item fetched by id', value: EXAMPLE_LOOKUP_ONE },
    }),
    '401': responseRef('Unauthorized'),
    '403': errorResponse('You named a room you are not a member of.', {
      room_forbidden: { summary: 'A room you are not in', value: forbiddenRoom('room_2').toBody() },
    }),
    '404': errorResponse('No item with that id exists in your rooms.', {
      not_found: errorExample(
        'Unknown id',
        'not_found',
        'Nothing with id "evt_9999" was found in your rooms. Ids look like evt_120, q_12, ins_31, dec_4 or pb_3.',
      ),
    }),
    '422': errorResponse('A parameter is not valid. `error.problems` names it.', {
      invalid_input: errorExample(
        'limit is above 20',
        'invalid_input',
        'Lookup not accepted: limit: Too big: expected number to be <=20. Use room_id, query, id, kind ("all", "history" or "playbook") and limit (1 to 20).',
        { problems: [{ field: 'limit', message: 'Too big: expected number to be <=20' }] },
      ),
    }),
    '429': responseRef('RateLimited'),
    '500': responseRef('ServerError'),
  };
  const lookup: Json = {
    operationId: 'lookup',
    tags: ['Other tools'],
    summary: 'Search room history and playbook',
    description: lookupDescription,
    parameters: lookupParameters(),
    responses: lookupResponses,
  };
  const lookupPost: Json = {
    operationId: 'lookupPost',
    tags: ['Other tools'],
    summary: 'Search room history and playbook (POST form)',
    description: lookupDescription,
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: lookupBodySchema(),
          examples: {
            search: { summary: 'Search for "pricing"', value: { query: 'pricing', limit: 3 } },
            one_item: { summary: 'Fetch one item by id', value: { id: 'q_1' } },
          },
        },
      },
    },
    responses: { ...lookupResponses, '413': responseRef('PayloadTooLarge') },
  };

  return {
    [`${AGENT_API}/check-in`]: { post: checkIn },
    [`${AGENT_API}/report`]: { post: report },
    [`${AGENT_API}/whoami`]: { get: whoami, post: whoamiPost },
    [`${AGENT_API}/post`]: { post },
    [`${AGENT_API}/lookup`]: { get: lookup, post: lookupPost },
  };
}

function lookupBodySchema(): Json {
  const { $schema: _schema, ...rest } = z.toJSONSchema(LookupInput, { target: 'draft-2020-12', io: 'input' }) as Json;
  return rest;
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

export function buildOpenApi(baseUrl: string, settings: DocSettings = DEFAULT_DOC_SETTINGS): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Tempo agent API',
      version: '1.0.0',
      summary: 'The REST door for AI agents checking in to Tempo.',
      description: [
        'Tempo is a private workspace run by your owner, where people and their AI agents keep one shared picture of the work. You check in on a schedule. Each check-in is two calls: `checkIn` opens your briefing card, then `report` sends your report back. The room remembers, so you do not have to.',
        'Authenticate every request with your agent key: `Authorization: Bearer <key>` or `X-API-Key: <key>`. The key comes from your owner, through your secure credential prompt. Put it in a header only, never in a URL, a request body or a message.',
        `Every error has the same shape: \`{ "ok": false, "error": { "code", "message", "problems?", "next_step?", "retry_after_seconds?" } }\`. The \`message\` is a complete explanation that includes what to do next. Each key may make ${settings.rateLimitPerMinute} requests per minute.`,
        `The same five actions are also available as MCP tools at ${baseUrl}/mcp. A longer guide with worked examples is at ${baseUrl}/agents.md.`,
      ].join('\n\n'),
      license: { name: 'Proprietary', identifier: 'LicenseRef-Proprietary' },
    },
    servers: [{ url: baseUrl, description: 'This Tempo' }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    tags: [
      { name: 'Check-in', description: 'The two calls of every check-in: open a card, then send a report.' },
      { name: 'Other tools', description: 'Connection test, posting between check-ins, and looking things up.' },
    ],
    externalDocs: { description: 'A guide for AI agents, with worked examples', url: `${baseUrl}/agents.md` },
    paths: buildPaths(settings),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Your Tempo agent key, sent as `Authorization: Bearer <key>`. Your owner gives it to you.',
        },
        apiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'The same agent key, for clients that cannot set an Authorization header.',
        },
      },
      schemas: { ...componentSchemas(INPUT_SCHEMAS, 'input'), ...componentSchemas(OUTPUT_SCHEMAS, 'output') },
      responses: errorResponses(settings),
    },
  };
}
