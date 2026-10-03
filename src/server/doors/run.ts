import type { AppContext } from '../context.js';
import { TempoError, isTempoError, rateLimited } from '../lib/errors.js';
import type { CardT, Door, LookupResultT, PostResultT, ReportResultT, WhoamiResultT } from '../schemas/agent.js';
import { lookup, post, whoami } from '../services/agent-actions.js';
import { openCard, submitReport } from '../services/checkin.js';
import {
  agentForSecret,
  authenticateSecret,
  enforceRateLimit,
  internalError,
  logConnection,
  presentedHint,
  type AgentAuth,
  type DoorLimits,
} from './agent-auth.js';

/**
 * The single path every agent door takes for every action, so validation, records and the
 * connection log are identical whichever door is used.
 */

export type AgentActionName = 'check_in' | 'report' | 'whoami' | 'post' | 'lookup';

export interface ActionResultMap {
  check_in: CardT;
  report: ReportResultT;
  whoami: WhoamiResultT;
  post: PostResultT;
  lookup: LookupResultT;
}

export function runService<A extends AgentActionName>(
  ctx: AppContext,
  auth: AgentAuth,
  action: A,
  input: unknown,
  door: Door,
): ActionResultMap[A] {
  switch (action) {
    case 'check_in':
      return openCard(ctx, auth.agent, door) as ActionResultMap[A];
    case 'report':
      return submitReport(ctx, auth.agent, input, door) as ActionResultMap[A];
    case 'whoami':
      return whoami(ctx, auth.agent, door) as ActionResultMap[A];
    case 'post':
      return post(ctx, auth.agent, input, door) as ActionResultMap[A];
    case 'lookup':
      return lookup(ctx, auth.agent, input, door) as ActionResultMap[A];
  }
  throw new Error(`unknown action ${action as string}`);
}

export function summarize(action: AgentActionName, value: unknown): string {
  if (action === 'check_in') {
    const c = value as CardT;
    const q = c.rooms.reduce((n, r) => n + r.questions_for_you.length, 0);
    const i = c.rooms.reduce((n, r) => n + r.instructions_for_you.length, 0);
    return `Card ${c.card_id} shown: ${c.rooms.length} room${c.rooms.length === 1 ? '' : 's'}, ${q} question${q === 1 ? '' : 's'}, ${i} instruction${i === 1 ? '' : 's'}${c.paused ? ' (paused)' : ''}.`;
  }
  return (value as { message: string }).message;
}

export interface Authed {
  auth: AgentAuth;
}

/** Authenticates (and rate-limits) a request. Failures are logged and rethrown. */
export function authenticateForDoor(
  ctx: AppContext,
  limits: DoorLimits,
  args: { secret: string | null; kind: 'api' | 'page'; door: Door; action: string; client: string | null; clientAddress: string },
): AgentAuth {
  const started = Date.now();
  try {
    const auth = authenticateSecret(ctx, args.secret, args.kind);
    enforceRateLimit(ctx, limits, auth.keyId);
    return auth;
  } catch (e) {
    const err = isTempoError(e) ? e : internalError();
    if (err.status === 401 || err.status === 404) {
      const r = limits.failedAuthPerClient.check(args.clientAddress, Date.now());
      logConnection(ctx, {
        agentId: agentForSecret(ctx, args.secret),
        keyHint: presentedHint(args.secret),
        door: args.door,
        action: args.action,
        result: 'rejected',
        httpStatus: err.status,
        message: err.message,
        durationMs: Date.now() - started,
        client: args.client,
      });
      if (!r.ok) throw rateLimited(r.retryAfterSeconds, 30);
      throw err;
    }
    logConnection(ctx, {
      agentId: agentForSecret(ctx, args.secret),
      keyHint: presentedHint(args.secret),
      door: args.door,
      action: args.action,
      result: 'rejected',
      httpStatus: err.status,
      message: err.message,
      durationMs: Date.now() - started,
      client: args.client,
    });
    throw err;
  }
}

/** Runs an action for an authenticated agent and records the outcome in the connection log. */
export function runLogged<A extends AgentActionName>(
  ctx: AppContext,
  auth: AgentAuth,
  action: A,
  input: unknown,
  door: Door,
  client: string | null,
): { ok: true; value: ActionResultMap[A] } | { ok: false; error: TempoError } {
  const started = Date.now();
  try {
    const value = runService(ctx, auth, action, input, door);
    logConnection(ctx, {
      agentId: auth.agent.id,
      keyHint: auth.keyHint,
      door,
      action,
      result: 'ok',
      httpStatus: 200,
      message: summarize(action, value),
      cardId: action === 'check_in' ? (value as CardT).card_id : action === 'report' ? (value as ReportResultT).card_id : null,
      durationMs: Date.now() - started,
      client,
    });
    return { ok: true, value };
  } catch (e) {
    let err: TempoError;
    if (isTempoError(e)) err = e;
    else {
      ctx.log.error({ err: (e as Error).message, stack: (e as Error).stack, action, door }, 'agent action failed');
      err = internalError();
    }
    const cardId =
      action === 'report' && input && typeof input === 'object' && typeof (input as Record<string, unknown>).card_id === 'string'
        ? ((input as Record<string, unknown>).card_id as string).slice(0, 40)
        : null;
    logConnection(ctx, {
      agentId: auth.agent.id,
      keyHint: auth.keyHint,
      door,
      action,
      result: err.status >= 500 ? 'error' : 'rejected',
      httpStatus: err.status,
      message: err.message,
      cardId,
      durationMs: Date.now() - started,
      client,
    });
    return { ok: false, error: err };
  }
}
