import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, createContext } from './app.js';
import { makeEmailSender, makePushSender } from './alerts/channels.js';
import { Scheduler } from './scheduler/index.js';
import { nightlyBackupJob } from './services/backup.js';
import { wireRuntime } from './runtime.js';

/**
 * Tempo's single process: web server, MCP endpoint, scheduler and Conductor together.
 */
async function main(): Promise<void> {
  const ctx = createContext();
  ctx.integrations.sendEmail = makeEmailSender(ctx.config);
  ctx.integrations.sendPush = makePushSender(ctx.config);
  const scheduler = new Scheduler(ctx);
  scheduler.addJob(nightlyBackupJob);
  const hooks = wireRuntime(ctx, scheduler);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = path.resolve(here, '../web');
  const { app } = await buildApp({ logger: true, webDir, hooks }, ctx);

  await app.listen({ port: ctx.config.port, host: ctx.config.host });
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
