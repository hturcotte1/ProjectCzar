/**
 * A throwaway Tempo with realistic data, for looking at the control room while building it and
 * for browser tests. Run:  npx vite build && npx tsx scripts/dev-server.ts --port 4100 [--web dist/web]
 * Sign in as henry@example.com / "tempo demo password" (admin) or sam@example.com / same.
 * Prints the agent keys so you can act as agents with curl.
 *
 * --clock 2026-10-07T16:00:00Z starts the server's "now" at that moment (here a Wednesday, 10:00 am
 * in Boise) and lets it move forward in real time. The browser tests use it so the demo room is
 * inside working hours whatever the real time of day. Without it, the server uses the real clock.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, createContext } from '../src/server/app.js';
import { clockStartingAt, systemClock } from '../src/server/clock.js';
import { openDatabase } from '../src/server/db/index.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { seedDemo } from '../src/server/demo-seed.js';
import { wireRuntime } from '../src/server/runtime.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const port = Number(arg('port') ?? 4100);
  const clockArg = arg('clock');
  let clock = systemClock;
  if (clockArg !== undefined) {
    try {
      clock = clockStartingAt(clockArg);
    } catch (err) {
      console.error(`--clock: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-dev-'));
  const ctx = createContext({
    db: openDatabase(path.join(dir, 'tempo.db')),
    clock,
    env: { ...process.env, NODE_ENV: 'development', BASE_URL: `http://localhost:${port}`, DATA_DIR: dir },
  });
  const seeded = await seedDemo(ctx);
  const webDir = path.resolve(arg('web') ?? 'dist/web');
  // Wired like the real server (Conductor, sweeps, briefs, the rehearsal button).
  const scheduler = new Scheduler(ctx);
  const hooks = wireRuntime(ctx, scheduler, () => `http://127.0.0.1:${port}`);
  const { app } = await buildApp({ webDir, hooks }, ctx);
  await app.listen({ port, host: '127.0.0.1' });
  scheduler.start();
  console.log(`Tempo dev server on http://localhost:${port}`);
  if (clockArg !== undefined) console.log(`Its clock started at ${clockArg} and moves forward in real time.`);
  console.log(JSON.stringify(seeded, null, 2));
  const keysOut = arg('keys-out');
  if (keysOut) {
    fs.mkdirSync(path.dirname(path.resolve(keysOut)), { recursive: true });
    fs.writeFileSync(keysOut, JSON.stringify(seeded, null, 2));
  }
}

void main();
