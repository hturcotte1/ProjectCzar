/**
 * One error shape for every door and the control room API.
 *
 * Wire format (JSON):
 *   { "ok": false,
 *     "error": { "code": "report_incomplete",
 *                "message": "Report not accepted. Missing: ... Send the report again with the same card_id (card_12).",
 *                "problems": [{ "field": "answers", "message": "an answer to q_12 ('Which tier?')" }],
 *                "next_step": "Add the missing items and send the report again with the same card_id (card_12)." } }
 *
 * `message` is always a complete plain-language explanation that includes what to do next,
 * so a client that only shows one string still tells the agent everything.
 */
export interface Problem {
  field: string;
  message: string;
}

export type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 503;

export interface ErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    problems?: Problem[];
    next_step?: string;
    retry_after_seconds?: number;
  };
}

export class TempoError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;
  readonly problems: Problem[] | undefined;
  readonly nextStep: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: ErrorStatus,
    code: string,
    message: string,
    opts: { problems?: Problem[]; nextStep?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'TempoError';
    this.status = status;
    this.code = code;
    this.problems = opts.problems;
    this.nextStep = opts.nextStep;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  toBody(): ErrorBody {
    const error: ErrorBody['error'] = { code: this.code, message: this.message };
    if (this.problems && this.problems.length) error.problems = this.problems;
    if (this.nextStep) error.next_step = this.nextStep;
    if (this.retryAfterSeconds !== undefined) error.retry_after_seconds = this.retryAfterSeconds;
    return { ok: false, error };
  }
}

export function isTempoError(e: unknown): e is TempoError {
  return e instanceof TempoError;
}

// Common errors, worded once so every door says the same thing.

export function unauthorized(reason: 'missing' | 'invalid' | 'revoked'): TempoError {
  const what =
    reason === 'missing'
      ? 'No agent key was sent.'
      : reason === 'revoked'
        ? 'This agent key has been revoked or replaced.'
        : 'This agent key is not recognized.';
  return new TempoError(
    401,
    reason === 'missing' ? 'key_missing' : reason === 'revoked' ? 'key_revoked' : 'key_invalid',
    `${what} Send your Tempo agent key in the "Authorization: Bearer <key>" header (or the "X-API-Key" header). ` +
      `If you don't have a working key, ask your owner to create or rotate one in Tempo (Agents → your agent → Keys) ` +
      `and enter it through your secure credential prompt, not in chat.`,
    { nextStep: 'Ask your owner for a valid Tempo agent key, then try again.' },
  );
}

export function forbiddenRoom(roomId: string): TempoError {
  return new TempoError(
    403,
    'room_forbidden',
    `You are not a member of room ${roomId}, so you can't read or write anything there. ` +
      `Use only the room ids listed on your briefing card (call tempo_whoami to see them).`,
    { nextStep: 'Use a room_id from your own briefing card.' },
  );
}

export function rateLimited(retryAfterSeconds: number, limitPerMinute: number): TempoError {
  return new TempoError(
    429,
    'rate_limited',
    `Too many requests: this key is limited to ${limitPerMinute} requests per minute. ` +
      `Wait ${retryAfterSeconds} seconds, then try again. A normal check-in needs only two calls.`,
    { nextStep: `Wait ${retryAfterSeconds} seconds and retry.`, retryAfterSeconds },
  );
}

export function tooLarge(limitBytes: number): TempoError {
  return new TempoError(
    413,
    'body_too_large',
    `The request body is larger than ${Math.round(limitBytes / 1024)} KB. Keep each text field under 2,000 characters, ` +
      `send links instead of file contents, and try again.`,
    { nextStep: 'Shorten the report and send it again.' },
  );
}

export function notFound(what: string, nextStep?: string): TempoError {
  return new TempoError(404, 'not_found', `${what} was not found.${nextStep ? ' ' + nextStep : ''}`, { nextStep });
}

export function badRequest(message: string, problems?: Problem[], nextStep?: string): TempoError {
  return new TempoError(422, 'invalid_input', message, { problems, nextStep });
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
