import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MAX_CLAUSES, UNREADABLE, limitConcern, warmUpLimits } from '../src/server/services/limits.js';
import { limitPatterns } from '../src/server/services/limits-rules.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { makeWorld, type World } from './helpers.js';
import { SPEED_TEAM, nameMaker, reviewerTexts, seedFromEnv } from './limits-names.js';

/**
 * The limits check runs on the server's only thread, inside a check-in, so it must stay fast however
 * many new names a text holds (DECISIONS.md item 50). Every run uses new made-up names: the seed is
 * printed so a failure can be repeated with LIMITS_SEED=<seed>.
 */
const seed = seedFromEnv();
console.log(`limits speed tests: made-up names from seed ${seed} (repeat with LIMITS_SEED=${seed})`);
const name = nameMaker(seed);
const ask = DEFAULT_LIMITS_ASK_FIRST;

function timed<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

describe('the limits check stays fast with names it has never seen', () => {
  it('checks each of the reviewer\'s texts in under 50 ms after one warm-up', () => {
    warmUpLimits();
    for (const { label, text } of reviewerTexts(name)) {
      const { ms } = timed(() => limitConcern(text, ask, SPEED_TEAM));
      expect(ms, `${label} (${text.length} characters) took ${ms.toFixed(1)} ms`).toBeLessThan(50);
    }
  });

  it('checks 300 short questions, each with a new person and company, in under 3 seconds in all', () => {
    warmUpLimits();
    const { ms } = timed(() => {
      for (let i = 0; i < 300; i++) limitConcern(`Should I ask ${name()} ${name()} at ${name()} about the role?`, ask, SPEED_TEAM);
    });
    expect(ms, `300 questions took ${ms.toFixed(0)} ms`).toBeLessThan(3000);
  });

  it('builds no pattern while it checks: every pattern is built once, when the module loads', () => {
    warmUpLimits();
    const count = limitPatterns().length;
    const built = vi.spyOn(globalThis, 'RegExp');
    try {
      for (let i = 0; i < 50; i++) {
        limitConcern(`Email ${name()} at ${name()} the contract, then tell ${name()} ${name()} it went out.`, ask, [...SPEED_TEAM, `${name()} ${name()}`]);
      }
      expect(built).not.toHaveBeenCalled();
    } finally {
      built.mockRestore();
    }
    expect(limitPatterns().length).toBe(count);
  });

  it('keeps memory flat: 2,000 checks with all-new names grow the heap by less than 30 MB', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const run = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', 'tests/limits-heap-child.ts', String(seed)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.trim().split('\n').pop()!) as { growthMb: number };
    expect(result.growthMb, `the heap grew by ${result.growthMb.toFixed(1)} MB`).toBeLessThan(30);
  });
});

describe('the work one text can cause has a ceiling', () => {
  it(`sends a text with more than ${MAX_CLAUSES} clauses to a person ("could not read")`, () => {
    const text = Array.from({ length: MAX_CLAUSES + 20 }, (_, i) => `Tidy item ${i}.`).join(' ');
    expect(limitConcern(text, ask, SPEED_TEAM)).toBe(UNREADABLE);
  });

  it('sends a text that takes too long to a person ("could not read")', () => {
    warmUpLimits();
    let calls = 0;
    // Each reading of the clock jumps a second ahead, as if every step were very slow.
    const slow = vi.spyOn(performance, 'now').mockImplementation(() => 1000 * calls++);
    try {
      expect(limitConcern('Sort the candidate list by fit.\nTidy the notes.', ask, SPEED_TEAM)).toBe(UNREADABLE);
    } finally {
      slow.mockRestore();
    }
    expect(limitConcern('Sort the candidate list by fit.\nTidy the notes.', ask, SPEED_TEAM)).toBeNull();
  });
});

describe('end to end: a recruiting question does not hold the server up', () => {
  let w: World | null = null;
  afterAll(async () => {
    await w?.app.close();
  });

  it('answers the 10-candidate question in under 300 ms, and a health request made meanwhile waits less than 300 ms', async () => {
    w = await makeWorld();
    const base = await w.app.listen({ port: 0, host: '127.0.0.1' });
    warmUpLimits(); // what the server does when it starts
    const post = (text: string) =>
      fetch(`${base}/api/v1/agent/post`, {
        method: 'POST',
        headers: { authorization: `Bearer ${w!.a.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'question', to: 'people', text }),
      });
    // The app has been running: one ordinary request first.
    expect((await post('Which pricing tier should the landing page lead with?')).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);

    const lines = Array.from({ length: 10 }, (_, i) => `${i + 1}. ${name()} ${name()}, currently at ${name()}.`);
    const question = `Which of these candidates should we interview first?\n${lines.join('\n')}`;
    const postStart = performance.now();
    let done = false;
    const posting = post(question).then(async (r) => {
      done = true;
      return { status: r.status, ms: performance.now() - postStart, body: await r.json() };
    });
    // Health requests, one after another, for as long as the post is being handled.
    const waits: number[] = [];
    while (!done && waits.length < 1000) {
      const start = performance.now();
      const r = await fetch(`${base}/healthz`);
      expect(r.status).toBe(200);
      waits.push(performance.now() - start);
    }
    const posted = await posting;
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.ms, `the post took ${posted.ms.toFixed(0)} ms`).toBeLessThan(300);
    const longest = Math.max(...waits);
    expect(longest, `a health request waited ${longest.toFixed(0)} ms (${waits.length} requests while the post was handled)`).toBeLessThan(300);
  });
});
