import { describe, expect, it } from 'vitest';
import { UNREADABLE, limitConcern, warmUpLimits } from '../src/server/services/limits.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { CONTROLS, FLAGGED, MISSED, OWN_LIMIT, OWN_LIMIT_CASES, SLOW, TEAMS, type Case } from './limits-second-look-cases.js';

/**
 * Tempo's own second look at the rewritten limits check (DECISIONS.md item 57): requests it missed,
 * ordinary work it flagged, and texts that took seconds. Each sentence is checked with the team it
 * was found with.
 */
const ask = DEFAULT_LIMITS_ASK_FIRST;
const label = (c: Case) => `${c[0].replace(/\n/g, ' / ')} (team: ${c[2]})`;

describe('requests the rewritten check missed', () => {
  it.each(MISSED.map((c) => [label(c), c] as const))('%s', (_l, [text, expected, team]) => {
    const got = limitConcern(text, ask, [...TEAMS[team]]);
    expect([expected].flat()).toContain(got);
  });
});

describe('ordinary work the rewritten check flagged', () => {
  it.each(FLAGGED.map((c) => [label(c), c] as const))('%s', (_l, [text, , team]) => {
    expect(limitConcern(text, ask, [...TEAMS[team]])).toBeNull();
  });
});

describe('answers that were already right stay right', () => {
  it.each(CONTROLS.map((c) => [label(c), c] as const))('%s', (_l, [text, expected, team]) => {
    expect(limitConcern(text, ask, [...TEAMS[team]])).toBe(expected);
  });
});

describe("a room's own limit about an act", () => {
  it.each(OWN_LIMIT_CASES)('%s', (text, crossed) => {
    const got = limitConcern(text, [...ask, OWN_LIMIT], [...TEAMS.full]);
    if (crossed) expect(got).not.toBeNull();
    else expect(got).toBeNull();
  });
});

describe('a long run of spaces inside brackets', () => {
  it.each(SLOW)('is read in under 50 ms, with an answer: %s', (_l, text) => {
    warmUpLimits();
    const start = performance.now();
    const got = limitConcern(text, ask, [...TEAMS.test]);
    const ms = performance.now() - start;
    expect(ms, `took ${ms.toFixed(1)} ms`).toBeLessThan(50);
    expect(got).not.toBe(UNREADABLE);
  });
});
