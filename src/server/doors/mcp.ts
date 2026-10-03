import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { McpServer, createMcpHandler, isLegacyRequest, type AuthInfo } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import type { z } from 'zod';
import type { AppContext } from '../context.js';
import { TempoError, tooLarge } from '../lib/errors.js';
import {
  Card,
  CheckInInput,
  LookupInput,
  LookupResult,
  PostInput,
  PostResult,
  ReportInput,
  ReportResult,
  WhoamiInput,
  WhoamiResult,
  type CardT,
  type LookupResultT,
  type PostResultT,
  type ReportResultT,
  type WhoamiResultT,
} from '../schemas/agent.js';
import { getAgent } from '../services/repo.js';
import {
  renderCardText,
  renderLookupText,
  renderPostText,
  renderReportResultText,
  renderWhoamiText,
} from '../services/render-text.js';
import { keyFromHeaders, logConnection, type AgentAuth, type DoorLimits } from './agent-auth.js';
import { clientLabel } from './rest.js';
import { authenticateForDoor, runLogged, type AgentActionName } from './run.js';

/**
 * Door A: a remote MCP server at /mcp over streamable HTTP, stateless, JSON responses.
 *
 * It serves both protocol eras, because clients in the field speak either:
 *  - modern (2026-07-28): stateless by design; handled by the SDK's createMcpHandler (JSON only);
 *  - legacy (2025-era, starts with "initialize"): a fresh stateless transport per request with
 *    JSON responses enabled.
 * Auth is "Authorization: Bearer <agent key>" (or "X-API-Key"), checked before the SDK sees the
 * request. Every request is written to the agent's connection log.
 */

const SERVER_INFO = { name: 'tempo', version: '1.0.0' };

const INSTRUCTIONS =
  'Tempo is a private workspace run by your owner. At each scheduled check-in: call tempo_check_in to get your briefing card, ' +
  'do what it asks within the limits shown, then call tempo_report with the card_id and everything listed under "you must send back". ' +
  'If a report is missing something, Tempo lists every missing item; fix them and send again with the same card_id.';

/**
 * A schema that advertises the exact JSON Schema of `schema` in tools/list but accepts any
 * object, so Tempo's own validator (shared by all doors) can explain problems in plain words.
 */
function lenient(schema: z.ZodType) {
  const std = (schema as unknown as { '~standard': { jsonSchema: { input: (o: unknown) => Record<string, unknown> } } })['~standard'];
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'tempo',
      validate: (value: unknown) => ({ value: (value && typeof value === 'object' ? value : {}) as Record<string, unknown> }),
      jsonSchema: {
        input: (opts: unknown) => std.jsonSchema.input(opts),
        output: (opts: unknown) => std.jsonSchema.input(opts),
      },
    },
  };
}

interface Outcome {
  action: string;
  result: 'ok' | 'rejected' | 'error';
  status: number;
  message: string;
  cardId: string | null;
  logged: boolean;
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function buildServer(ctx: AppContext, auth: AgentAuth, client: string | null, outcome: Outcome): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  const run = <A extends AgentActionName>(action: A, input: unknown, render: (v: any) => string): ToolResult => {
    // Re-read the agent so a key revoked a moment ago stops working at once.
    const fresh = getAgent(ctx.db, auth.agent.id);
    const result = runLogged(ctx, { ...auth, agent: fresh ?? auth.agent }, action, input, 'mcp', client);
    outcome.logged = true;
    if (!result.ok) {
      return { content: [{ type: 'text', text: result.error.message }], isError: true };
    }
    return {
      content: [{ type: 'text', text: render(result.value) }],
      structuredContent: result.value as unknown as Record<string, unknown>,
    };
  };

  server.registerTool(
    'tempo_check_in',
    {
      title: 'Open your Tempo briefing card',
      description:
        'Call at each scheduled check-in. Returns your briefing card for every room you belong to: goal, rules, limits, what others posted since your last check-in, questions and instructions for you, and exactly what to send back with tempo_report. Calling again within 20 minutes returns the same card.',
      inputSchema: lenient(CheckInInput),
      outputSchema: Card,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: unknown) => run('check_in', args, (c: CardT) => renderCardText(c)),
  );

  server.registerTool(
    'tempo_report',
    {
      title: 'Send your check-in report',
      description:
        'Send the report for a card: card_id, one rooms entry per room (working_on is required), an answer for every question and a status for every instruction on the card. If anything is missing, Tempo rejects the report and lists every missing item; send it again with the same card_id (that updates the same report, nothing is duplicated).',
      inputSchema: lenient(ReportInput),
      outputSchema: ReportResult,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: unknown) => run('report', args, (r: ReportResultT) => renderReportResultText(r)),
  );

  server.registerTool(
    'tempo_whoami',
    {
      title: 'Check your Tempo connection',
      description: 'Connection test. Returns your agent name, owner, rooms and check-in schedule, and confirms you are connected.',
      inputSchema: lenient(WhoamiInput),
      outputSchema: WhoamiResult,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: unknown) => run('whoami', args, (w: WhoamiResultT) => renderWhoamiText(w)),
  );

  server.registerTool(
    'tempo_post',
    {
      title: 'Post to a room between check-ins',
      description:
        'Post a message, question or note to one of your rooms between check-ins. A question needs "to": another agent\'s name, "conductor" or "people"; its answer appears on your next card.',
      inputSchema: lenient(PostInput),
      outputSchema: PostResult,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => run('post', args, (p: PostResultT) => renderPostText(p)),
  );

  server.registerTool(
    'tempo_lookup',
    {
      title: 'Search room history and playbook',
      description:
        'Search your rooms\' history and playbook, or fetch one item by id (evt_120, q_12, ins_31, dec_4, pb_3), for example something a card left out. At most 20 results.',
      inputSchema: lenient(LookupInput),
      outputSchema: LookupResult,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: unknown) => run('lookup', args, (l: LookupResultT) => renderLookupText(l)),
  );

  return server;
}

function jsonRpcError(err: TempoError): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: err.status === 401 ? -32001 : err.status === 429 ? -32029 : -32000,
      message: err.message,
      data: { tempo_code: err.code, next_step: err.nextStep ?? null },
    },
  };
}

const TOOL_NAMES = new Set(['tempo_check_in', 'tempo_report', 'tempo_whoami', 'tempo_post', 'tempo_lookup']);

/** A short, fixed label for the connection log; never copies arbitrary text from the request. */
function methodOf(body: unknown): string {
  if (Array.isArray(body)) return 'batch';
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const m = typeof b.method === 'string' ? b.method : 'response';
    if (m === 'tools/call') {
      const name = (b.params as Record<string, unknown> | undefined)?.name;
      return typeof name === 'string' && TOOL_NAMES.has(name) ? `tools/call ${name}` : 'tools/call (unknown tool)';
    }
    return /^[a-z][a-z/_]{0,40}$/i.test(m) ? m : 'other';
  }
  return 'unknown';
}

export async function registerMcpDoor(app: FastifyInstance, ctx: AppContext, limits: DoorLimits): Promise<void> {
  // Modern-era requests. The agent is resolved before the SDK sees the request and passed through authInfo.
  const modern = toNodeHandler(
    createMcpHandler(
      ({ authInfo }) => {
        const extra = (authInfo?.extra ?? {}) as { auth?: AgentAuth; client?: string | null; outcome?: Outcome };
        if (!extra.auth || !extra.outcome) throw new Error('missing Tempo auth context');
        return buildServer(ctx, extra.auth, extra.client ?? null, extra.outcome);
      },
      { legacy: 'reject', responseMode: 'json', onerror: (e) => ctx.log.warn({ err: e.message }, 'mcp handler error') },
    ),
    { maxRequestBodySize: ctx.config.agentBodyLimitBytes },
  );

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string', bodyLimit: ctx.config.agentBodyLimitBytes }, (_req, body, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      if (!text.trim()) return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch {
        done(null, { __invalid_json: true });
      }
    });
    scope.setErrorHandler((error: Error & { code?: string; statusCode?: number }, _req, reply) => {
      const err =
        error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413
          ? tooLarge(ctx.config.agentBodyLimitBytes)
          : new TempoError(500, 'internal_error', 'Something went wrong inside Tempo. Try again in a minute.');
      return reply.code(err.status).send(jsonRpcError(err));
    });

    scope.route({
      method: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
      url: '/mcp',
      bodyLimit: ctx.config.agentBodyLimitBytes,
      handler: async (req, reply) => {
        const started = Date.now();
        const client = clientLabel(req);
        if (req.method !== 'POST') {
          return reply
            .code(405)
            .header('Allow', 'POST')
            .send(
              jsonRpcError(
                new TempoError(405, 'method_not_allowed', 'Method not allowed. This MCP endpoint is stateless: send each JSON-RPC message as a POST to /mcp.'),
              ),
            );
        }
        const body = req.body as unknown;
        const action = methodOf(body);
        let auth: AgentAuth;
        try {
          auth = authenticateForDoor(ctx, limits, {
            secret: keyFromHeaders(req.headers),
            kind: 'api',
            door: 'mcp',
            action,
            client,
            clientAddress: req.ip,
          });
        } catch (e) {
          const err = e as TempoError;
          if (err.status === 401) reply.header('WWW-Authenticate', `Bearer realm="Tempo", error="invalid_token"`);
          if (err.retryAfterSeconds !== undefined) reply.header('Retry-After', String(err.retryAfterSeconds));
          return reply.code(err.status).send(jsonRpcError(err));
        }
        if (Array.isArray(body)) {
          // JSON-RPC batches would let one request run many tool calls past the per-key limit.
          const err = new TempoError(400, 'batch_not_supported', 'Send one JSON-RPC message per POST. Batches (JSON arrays) are not supported.');
          logConnection(ctx, { agentId: auth.agent.id, keyHint: auth.keyHint, door: 'mcp', action, result: 'rejected', httpStatus: 400, message: err.message, durationMs: Date.now() - started, client });
          return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: err.message } });
        }
        if (body && typeof body === 'object' && '__invalid_json' in (body as Record<string, unknown>)) {
          const err = new TempoError(400, 'invalid_json', 'The request body is not valid JSON. Send one JSON-RPC message per POST.');
          logConnection(ctx, { agentId: auth.agent.id, keyHint: auth.keyHint, door: 'mcp', action, result: 'rejected', httpStatus: 400, message: err.message, durationMs: Date.now() - started, client });
          return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } });
        }

        const outcome: Outcome = { action, result: 'ok', status: 200, message: '', cardId: null, logged: false };
        reply.hijack();
        const res = reply.raw;
        res.on('finish', () => {
          if (outcome.logged) return;
          const status = res.statusCode;
          logConnection(ctx, {
            agentId: auth.agent.id,
            keyHint: auth.keyHint,
            door: 'mcp',
            action,
            result: status < 400 ? 'ok' : status >= 500 ? 'error' : 'rejected',
            httpStatus: status,
            message: status < 400 ? `${action}: ok` : `${action}: protocol error (HTTP ${status})`,
            durationMs: Date.now() - started,
            client,
          });
        });

        const raw = req.raw as IncomingMessage & { auth?: AuthInfo };
        try {
          const legacy = await isLegacyRequest(await toWebRequest(raw, body), body);
          if (legacy) {
            const server = buildServer(ctx, auth, client, outcome);
            const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            res.on('close', () => {
              void transport.close();
              void server.close();
            });
            await server.connect(transport);
            await transport.handleRequest(raw, res, body);
            return;
          }
          raw.auth = { token: 'agent-key', clientId: auth.agent.id, scopes: [], extra: { auth, client, outcome } };
          await modern(raw, res, body);
        } catch (e) {
          ctx.log.error({ err: (e as Error).message }, 'mcp request failed');
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(jsonRpcError(new TempoError(500, 'internal_error', 'Something went wrong inside Tempo. Try again in a minute.'))));
          }
        }
      },
    });
  });
}
