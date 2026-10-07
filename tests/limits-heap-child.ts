/**
 * Run by tests/limits-speed.test.ts in its own process with --expose-gc: how much memory 2,000
 * checks with all-new names leave behind after a full garbage collection. Prints one JSON line.
 */
import { limitConcern, warmUpLimits } from '../src/server/services/limits.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { SPEED_TEAM, nameMaker } from './limits-names.js';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('run with --expose-gc');
const name = nameMaker(Number(process.argv[2] ?? 1));
const question = () => `Should I ask ${name()} ${name()} at ${name()} Labs about the role, or email ${name()} first?`;
warmUpLimits();
for (let i = 0; i < 200; i++) limitConcern(question(), DEFAULT_LIMITS_ASK_FIRST, SPEED_TEAM);
const settle = () => {
  for (let i = 0; i < 4; i++) gc();
  return process.memoryUsage().heapUsed;
};
const before = settle();
for (let i = 0; i < 2000; i++) limitConcern(question(), DEFAULT_LIMITS_ASK_FIRST, SPEED_TEAM);
const after = settle();
console.log(JSON.stringify({ before, after, growthMb: (after - before) / 1e6 }));
