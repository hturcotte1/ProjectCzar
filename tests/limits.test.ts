import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { limitConcern } from '../src/server/services/limits.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { CONTACT, HARMLESS, MONEY, RISKY, TEAM } from './limits-cases.js';

describe('the limits safety net', () => {
  it('has enough cases to mean something', () => {
    expect(HARMLESS.length).toBeGreaterThanOrEqual(40);
    expect(RISKY.length).toBeGreaterThanOrEqual(25);
  });

  it.each(HARMLESS)('leaves ordinary work alone: %s', (text) => {
    expect(limitConcern(text, DEFAULT_LIMITS_ASK_FIRST, TEAM)).toBeNull();
  });

  it.each(RISKY)('flags %s as %s', (text, limit) => {
    expect(limitConcern(text, DEFAULT_LIMITS_ASK_FIRST, TEAM)).toBe(limit);
  });

  it("uses the room's own wording for a limit when it has one", () => {
    expect(limitConcern('Buy the stock photo for $29.', ['spending any money at all'])).toBe('spending any money at all');
    expect(limitConcern('Buy the stock photo for $29.', [])).toBe(MONEY);
  });

  it("matches a room's own extra limit only when all its key words appear, whole", () => {
    const askFirst = [...DEFAULT_LIMITS_ASK_FIRST, 'changing prices on the live site'];
    expect(limitConcern('Change the prices on the pricing page today.', askFirst)).toBe('changing prices on the live site');
    expect(limitConcern('Note which competitors have the lowest prices.', askFirst)).toBeNull();
    // A default limit is matched by its rule, never by loose words ("sharing" in "keep sharing updates").
    expect(limitConcern('Keep sharing updates in Tempo as you go.', DEFAULT_LIMITS_ASK_FIRST)).toBeNull();
    expect(limitConcern('Avoid contacting the team after hours.', DEFAULT_LIMITS_ASK_FIRST)).toBeNull();
  });

  it('looks at one sentence at a time, and joins an instruction with its done-when line safely', () => {
    expect(limitConcern('Draft the reply to the client.\nDone when Henry has read it.', DEFAULT_LIMITS_ASK_FIRST)).toBeNull();
    expect(limitConcern('Draft the reply.\nDone when it is sent to the client.', DEFAULT_LIMITS_ASK_FIRST)).toBe(CONTACT);
  });
});

/**
 * Sentences written by two rounds of independent reviewers (DECISIONS.md items 45 and 46): 1,205
 * from seven reviewers who aimed at the first rewrite's weak spots, and 559 from seven more who
 * wrote ordinary sentences without seeing the code. Every claimed mistake was checked by a separate
 * judge against the written policy. Sharing a file with an outsider may be called contacting them
 * or sharing outside the project; both count.
 */
describe('sentences from the independent review', () => {
  const reviewed = JSON.parse(fs.readFileSync(new URL('./fixtures/limits-reviewed.json', import.meta.url), 'utf8')) as {
    text: string;
    expected: string | null;
    also?: string[];
  }[];

  it('has them all', () => {
    expect(reviewed.length).toBeGreaterThanOrEqual(1760);
    expect(reviewed.filter((c) => c.expected === null).length).toBeGreaterThanOrEqual(890);
  });

  it.each(reviewed.map((c) => [c.text.replace(/\n/g, ' / '), c.expected ?? 'nothing', c] as const))('%s → %s', (_text, _label, c) => {
    const got = limitConcern(c.text, DEFAULT_LIMITS_ASK_FIRST, TEAM);
    if (c.expected === null) expect(got).toBeNull();
    else expect([c.expected, ...(c.also ?? [])]).toContain(got);
  });
});

describe('the limits check on hostile text', () => {
  // Agent text is untrusted: no input of the allowed size may make the check slow.
  const hostile = [
    'the '.repeat(500),
    'Send ' + 'Acme Globex Initech '.repeat(100) + 'the deck',
    'draft the email and '.repeat(100),
    'Done when the client\n'.repeat(100),
    'email ' + 'the '.repeat(495),
    'make ' + 'the '.repeat(490) + 'public',
    'delete ' + 'a-'.repeat(990),
    'pay ' + '$1 '.repeat(600),
  ].map((t) => t.slice(0, 2000));

  it.each(hostile.map((t, i) => [i, t] as const))('answers quickly on hostile text %i', (_i, text) => {
    limitConcern(text, DEFAULT_LIMITS_ASK_FIRST, TEAM); // warm up the pattern cache
    const started = performance.now();
    limitConcern(text, DEFAULT_LIMITS_ASK_FIRST, TEAM);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
