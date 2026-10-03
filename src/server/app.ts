import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type Config } from './config.js';
import { systemClock, type Clock } from './clock.js';
import { openDatabase, type DB } from './db/index.js';
import { Bus } from './lib/bus.js';
import type { AppContext, Integrations, Logger } from './context.js';
import { silentLogger } from './context.js';
import { makeDoorLimits, type DoorLimits } from './doors/agent-auth.js';
import { registerRestDoor } from './doors/rest.js';
import { registerMcpDoor } from './doors/mcp.js';

export interface BuildOptions {
  config?: Partial<Config>;
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  db?: DB;
  integrations?: Partial<Integrations>;
  logger?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  limits: DoorLimits;
}

/** Hides secrets that travel in URL paths (agent page tokens, invite tokens) from logs. */
export function redactUrl(url: string): string {
  return url.replace(/\/a\/[^/?#]+/g, '/a/[redacted]').replace(/\/invite\/[^/?#]+/g, '/invite/[redacted]').replace(/token=[^&]+/g, 'token=[redacted]');
}

export function createContext(opts: BuildOptions = {}): AppContext {
  const config = loadConfig(opts.env ?? process.env, opts.config ?? {});
  const db = opts.db ?? openDatabase(config.databasePath);
  return {
    db,
    clock: opts.clock ?? systemClock,
    config,
    bus: new Bus(),
    log: silentLogger,
    integrations: {
      conductorModel: null,
      sendEmail: null,
      sendPush: null,
      ...opts.integrations,
    },
  };
}

export async function buildApp(opts: BuildOptions = {}, ctxIn?: AppContext): Promise<BuiltApp> {
  const ctx = ctxIn ?? createContext(opts);
  const app = Fastify({
    logger: opts.logger
      ? {
          level: ctx.config.logLevel,
          serializers: {
            req: (req) => ({ method: req.method, url: redactUrl(req.url) }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
        }
      : false,
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 256 * 1024,
  });
  if (opts.logger) {
    const l = app.log;
    ctx.log = {
      info: (o, m) => l.info(o as object, m),
      warn: (o, m) => l.warn(o as object, m),
      error: (o, m) => l.error(o as object, m),
      debug: (o, m) => l.debug(o as object, m),
    } satisfies Logger;
  }
  const limits = makeDoorLimits(ctx);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  app.get('/healthz', async (_req, reply) => {
    try {
      ctx.db.prepare('SELECT 1').get();
      return reply.send({ ok: true, time: new Date(ctx.clock.now()).toISOString() });
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await registerRestDoor(app, ctx, limits);
  await registerMcpDoor(app, ctx, limits);

  return { app, ctx, limits };
}
