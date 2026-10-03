import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, createContext } from './app.js';
import { loadDotEnvIfPresent } from './config.js';
import { makeEmailSender, makePushSender } from './alerts/channels.js';
import { Scheduler } from './scheduler/index.js';
import { nightlyBackupJob } from './services/backup.js';
import { wireRuntime } from './runtime.js';

/**
 * Tempo's single process: web server, MCP endpoint, scheduler and Conductor together.
 */
async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const ctx = createContext();
  ctx.integrations.sendEmail = makeEmailSender(ctx.config);
  ctx.integrations.sendPush = makePushSender(ctx.config);
  const scheduler = new Scheduler(ctx);
  scheduler.addJob(nightlyBackupJob);
  let internal = `http://127.0.0.1:${ctx.config.port}`;
  const hooks = wireRuntime(ctx, scheduler, () => internal);

  const here = path.dirname(fileURLToPath(import.meta.url));
  // The built control room sits next to the compiled server (dist/web). When the server runs from
  // source (npm run dev), use the last build in dist/web instead of the unbuilt src/web.
  const besideServer = path.resolve(here, '../web');
  const webDir = fs.existsSync(path.join(besideServer, 'assets')) ? besideServer : path.resolve('dist/web');
  const { app } = await buildApp({ logger: true, webDir, hooks }, ctx);

  await app.listen({ port: ctx.config.port, host: ctx.config.host });
  const addr = app.server.address();
  if (addr && typeof addr === 'object') internal = `http://127.0.0.1:${addr.port}`;
  scheduler.start();
  ctx.log.info(
    {
      baseUrl: ctx.config.baseUrl,
      database: ctx.config.databasePath,
      conductor: ctx.integrations.conductorModel ? ctx.config.conductorModel : 'off (no ANTHROPIC_API_KEY): rooms run in relay mode',
      email: ctx.integrations.sendEmail ? 'on' : 'off',
    },
    'Tempo is running',
  );

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    ctx.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await scheduler.stop();
      ctx.db.pragma('wal_checkpoint(TRUNCATE)');
      ctx.db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((e) => {
  console.error('Tempo failed to start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
