import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, createContext } from '../app.js';
import { loadDotEnvIfPresent } from '../config.js';
import { openDatabase } from '../db/index.js';
import { Scheduler } from '../scheduler/index.js';
import { wireRuntime } from '../runtime.js';
import { runRehearsal } from '../rehearsal/driver.js';

/**
 * `npm run rehearsal`: the end-to-end acceptance test. Starts Tempo in this process (by default on
 * a throwaway database), creates a sandbox room with two stand-in agents on a sped-up clock, runs
 * the full script including misbehavior, prints every check, and exits with 0 only if all pass.
 * Add --use-data to run it against the real database instead (it then stays as a sandbox room).
 */
async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const useData = process.argv.includes('--use-data');
  const roundsArg = process.argv.indexOf('--rounds');
  const maxRounds = roundsArg > 0 ? Number(process.argv[roundsArg + 1]) : 12;
  const tmp = useData ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-rehearsal-'));
  const env = { ...process.env, ...(tmp ? { DATA_DIR: tmp, DATABASE_PATH: path.join(tmp, 'tempo.db') } : {}) };
  const ctx = createContext({ env, ...(tmp ? { db: openDatabase(path.join(tmp, 'tempo.db')) } : {}) });
  const scheduler = new Scheduler(ctx);
  let url = '';
  const hooks = wireRuntime(ctx, scheduler, () => url);
  const { app } = await buildApp({ hooks }, ctx);
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  scheduler.start();
  console.log(`Rehearsal: Tempo is running at ${url} on ${tmp ? 'a throwaway database' : ctx.config.databasePath}.`);
  console.log(`Conductor: ${ctx.integrations.conductorModel ? `${ctx.config.conductorModel} (real API key)` : 'scripted stand-in (no ANTHROPIC_API_KEY)'}.`);
  const t0 = Date.now();
  const res = await runRehearsal(ctx, {
    baseUrl: url,
    startedBy: null,
    maxRounds,
    onLog: (line) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s] ${line}`),
  });
  console.log('\nResults');
  for (const r of res.results) console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
  console.log(`\n${res.passed ? 'Rehearsal passed' : 'Rehearsal FAILED'}: ${res.results.filter((r) => r.passed).length} of ${res.results.length} checks passed.`);
  await scheduler.stop();
  await app.close();
  ctx.db.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(res.passed ? 0 : 1);
}

main().catch((e) => {
  console.error('Rehearsal could not run:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
