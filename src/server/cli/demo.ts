import { buildApp, createContext } from '../app.js';
import { loadDotEnvIfPresent } from '../config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEmailSender, makePushSender } from '../alerts/channels.js';
import { Scheduler } from '../scheduler/index.js';
import { nightlyBackupJob } from '../services/backup.js';
import { wireRuntime } from '../runtime.js';
import { runRehearsal } from '../rehearsal/driver.js';
import { createPerson } from '../services/auth.js';
import { randomSecret } from '../lib/crypto.js';

/**
 * `npm run demo`: starts Tempo normally, adds a sandbox room and runs a rehearsal in it so you can
 * open the control room and watch it happen. Keeps running afterwards; stop it with Ctrl+C.
 */
async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const ctx = createContext();
  ctx.integrations.sendEmail = makeEmailSender(ctx.config);
  ctx.integrations.sendPush = makePushSender(ctx.config);
  let login: { email: string; password: string } | null = null;
  const admins = (ctx.db.prepare("SELECT COUNT(*) AS n FROM people WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n;
  if (admins === 0) {
    const password = `demo-${randomSecret(9)}`;
    await createPerson(ctx, { name: 'Demo admin', email: 'demo@example.com', password, role: 'admin' });
    login = { email: 'demo@example.com', password };
  }
  const scheduler = new Scheduler(ctx);
  scheduler.addJob(nightlyBackupJob);
  let internal = `http://127.0.0.1:${ctx.config.port}`;
  const hooks = wireRuntime(ctx, scheduler, () => internal);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { app } = await buildApp({ hooks, webDir: path.resolve(here, '../../web') }, ctx);
  await app.listen({ port: ctx.config.port, host: ctx.config.host });
  const addr = app.server.address();
  if (addr && typeof addr === 'object') internal = `http://127.0.0.1:${addr.port}`;
  scheduler.start();
  console.log(`\nTempo demo is running. Open ${ctx.config.baseUrl} in your browser.`);
  if (login) console.log(`Sign in with email ${login.email} and password ${login.password} (a demo admin created just now).`);
  else console.log('Sign in with your admin account.');
  console.log('A sandbox room called "Sandbox rehearsal N" appears in the room list; open it to watch two stand-in agents work.\n');
  const res = await runRehearsal(ctx, { baseUrl: internal, startedBy: null, maxRounds: 12, onLog: (l) => console.log(`  ${l}`) });
  console.log(`\nThe rehearsal ${res.passed ? 'passed' : 'had failures'}. Tempo keeps running so you can look around. Press Ctrl+C to stop.`);
  const stop = async () => {
    await scheduler.stop();
    await app.close();
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e) => {
  console.error('The demo could not start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
