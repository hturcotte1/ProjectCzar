/**
 * A throwaway Tempo with realistic data, for looking at the control room while building it and
 * for browser tests. Run:  npx vite build && npx tsx scripts/dev-server.ts --port 4100 [--web dist/web]
 * Sign in as henry@example.com / "tempo demo password" (admin) or sam@example.com / same.
 * Prints the agent keys so you can act as agents with curl.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, createContext } from '../src/server/app.js';
import { openDatabase } from '../src/server/db/index.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { seedDemo } from '../src/server/demo-seed.js';
import { wireRuntime } from '../src/server/runtime.js';

async function main() {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 4100;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-dev-'));
  const ctx = createContext({
    db: openDatabase(path.join(dir, 'tempo.db')),
    env: { ...process.env, NODE_ENV: 'development', BASE_URL: `http://localhost:${port}`, DATA_DIR: dir },
  });
  const seeded = await seedDemo(ctx);
  const webArg = process.argv.indexOf('--web');
  const webDir = path.resolve(webArg > 0 ? process.argv[webArg + 1] : 'dist/web');
  // Wired like the real server (Conductor, sweeps, briefs, the rehearsal button).
  const scheduler = new Scheduler(ctx);
  const hooks = wireRuntime(ctx, scheduler, () => `http://127.0.0.1:${port}`);
  const { app } = await buildApp({ webDir, hooks }, ctx);
  await app.listen({ port, host: '127.0.0.1' });
  scheduler.start();
  console.log(`Tempo dev server on http://localhost:${port}`);
  console.log(JSON.stringify(seeded, null, 2));
  const keysOut = process.argv.indexOf('--keys-out');
  if (keysOut > 0) {
    fs.mkdirSync(path.dirname(path.resolve(process.argv[keysOut + 1])), { recursive: true });
    fs.writeFileSync(process.argv[keysOut + 1], JSON.stringify(seeded, null, 2));
  }
}

void main();
