import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { TempoError, tooLarge } from '../lib/errors.js';
import { keyFromHeaders, logConnection, type AgentAuth, type DoorLimits } from './agent-auth.js';
import { authenticateForDoor, runLogged, type AgentActionName } from './run.js';

/**
 * Door B: the same five actions as plain REST under /api/v1/agent/…, documented at /openapi.json.
 * Auth: "Authorization: Bearer <key>" or "X-API-Key: <key>".
 */

const ROUTES: { method: 'GET' | 'POST'; path: string; action: AgentActionName }[] = [
  { method: 'POST', path: '/api/v1/agent/check-in', action: 'check_in' },
  { method: 'POST', path: '/api/v1/agent/report', action: 'report' },
  { method: 'GET', path: '/api/v1/agent/whoami', action: 'whoami' },
  { method: 'POST', path: '/api/v1/agent/whoami', action: 'whoami' },
  { method: 'POST', path: '/api/v1/agent/post', action: 'post' },
  { method: 'GET', path: '/api/v1/agent/lookup', action: 'lookup' },
  { method: 'POST', path: '/api/v1/agent/lookup', action: 'lookup' },
];

export function sendError(reply: FastifyReply, err: TempoError): FastifyReply {
  if (err.status === 401) reply.header('WWW-Authenticate', `Bearer realm="Tempo", error="invalid_token"`);
  if (err.retryAfterSeconds !== undefined) reply.header('Retry-After', String(err.retryAfterSeconds));
  return reply.code(err.status).type('application/json; charset=utf-8').send(err.toBody());
}

export function clientLabel(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 200) : null;
}

export async function registerRestDoor(app: FastifyInstance, ctx: AppContext, limits: DoorLimits): Promise<void> {
  await app.register(async (scope) => {
    // Accept any content type and parse it ourselves, so a missing or odd Content-Type still works
    // and a malformed body gets a plain-language answer.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string', bodyLimit: ctx.config.agentBodyLimitBytes }, (_req, body, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      if (!text.trim()) return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch (e) {
        done(null, { __invalid_json: (e as Error).message });
      }
    });

    scope.setErrorHandler((error: Error & { code?: string; statusCode?: number }, _req, reply) => {
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) return sendError(reply, tooLarge(ctx.config.agentBodyLimitBytes));
      ctx.log.error({ err: error.message }, 'agent REST error');
      return sendError(reply, new TempoError(500, 'internal_error', 'Something went wrong inside Tempo. Nothing was half-saved. Try again in a minute.'));
    });

    for (const r of ROUTES) {
      scope.route({
        method: r.method,
        url: r.path,
        bodyLimit: ctx.config.agentBodyLimitBytes,
        handler: async (req, reply) => {
          reply.header('Cache-Control', 'no-store');
          let auth;
          try {
            auth = authenticateForDoor(ctx, limits, {
              secret: keyFromHeaders(req.headers),
              kind: 'api',
              door: 'rest',
              action: r.action,
              client: clientLabel(req),
              clientAddress: req.ip,
            });
          } catch (e) {
            return sendError(reply, e as TempoError);
          }
          let input: unknown = r.method === 'GET' ? { ...(req.query as Record<string, unknown>) } : req.body;
          if (input && typeof input === 'object' && '__invalid_json' in (input as Record<string, unknown>)) {
            const err = new TempoError(
              422,
              'invalid_json',
              `The request body is not valid JSON (${String((input as Record<string, unknown>).__invalid_json)}). Send a JSON object, for example {"card_id": "card_12", ...}.`,
              { nextStep: 'Fix the JSON and send again.' },
            );
            runLoggedFailure(ctx, auth, r.action, err, clientLabel(req));
            return sendError(reply, err);
          }
          if (input === undefined || input === null) input = {};
          const result = runLogged(ctx, auth, r.action, input, 'rest', clientLabel(req));
          if (!result.ok) return sendError(reply, result.error);
          return reply.code(200).type('application/json; charset=utf-8').send(result.value);
        },
      });
    }

    // A helpful answer for wrong methods and unknown paths under the agent API.
    scope.all('/api/v1/agent/*', async (req, reply) => {
      return sendError(
        reply,
        new TempoError(
          404,
          'unknown_endpoint',
          `There is no ${req.method} ${req.url.split('?')[0]}. The agent endpoints are POST /api/v1/agent/check-in, POST /api/v1/agent/report, GET /api/v1/agent/whoami, POST /api/v1/agent/post and GET /api/v1/agent/lookup. See /openapi.json and /agents.md.`,
        ),
      );
    });
  });
}

function runLoggedFailure(ctx: AppContext, auth: AgentAuth, action: AgentActionName, err: TempoError, client: string | null): void {
  logConnection(ctx, {
    agentId: auth.agent.id,
    keyHint: auth.keyHint,
    door: 'rest',
    action,
    result: 'rejected',
    httpStatus: err.status,
    message: err.message,
    durationMs: 0,
    client,
  });
}
