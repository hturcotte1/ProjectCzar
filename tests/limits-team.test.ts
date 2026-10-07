import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { limitConcern } from '../src/server/services/limits.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { CONTACT, HARMLESS, RISKY, TEAM } from './limits-cases.js';

/**
 * Who is on the team comes only from the names passed in, never from names written into the rules
 * (DECISIONS.md item 51). A longer name counts as a whole name; small ordinary words never count.
 */
const ask = DEFAULT_LIMITS_ASK_FIRST;
const REVIEW_TEAM = ['Henry Turcotte', 'Priya Nair', 'Muse Henry', 'Muse Priya'];

describe('the team is the list passed in, and nothing else', () => {
  it('treats Sam, Ada and Bo like Dana when none of them is on the team', () => {
    for (const who of ['Dana', 'Sam', 'Ada', 'Bo']) {
      expect(limitConcern(`Send the pricing proposal to ${who}.`, ask, REVIEW_TEAM), who).toBe(CONTACT);
    }
  });

  it('treats every teammate alike, whatever their name', () => {
    expect(limitConcern('Tell Henry the client approved the draft.', ask, REVIEW_TEAM)).toBeNull();
    expect(limitConcern('Tell Priya the client approved the draft.', ask, REVIEW_TEAM)).toBeNull();
    expect(limitConcern('Send the pricing proposal to Priya.', ask, REVIEW_TEAM)).toBeNull();
    expect(limitConcern('Send the pricing proposal to Muse Priya.', ask, REVIEW_TEAM)).toBeNull();
  });

  it('never lets small ordinary words in a name count as a teammate ("The Closer", "An Do")', () => {
    for (const text of ['Message the speakers about their slots.', 'Invite the giveaway winners to the call.', 'Message an illustrator about the cover.']) {
      expect(limitConcern(text, ask, REVIEW_TEAM), text).toBe(CONTACT);
      expect(limitConcern(text, ask, [...REVIEW_TEAM, 'The Closer']), `${text} (with The Closer)`).toBe(CONTACT);
      expect(limitConcern(text, ask, [...REVIEW_TEAM, 'An Do']), `${text} (with An Do)`).toBe(CONTACT);
    }
  });

  it('matches a longer name as a whole name', () => {
    expect(limitConcern('Message the closer about the renewal.', ask, [...REVIEW_TEAM, 'The Closer'])).toBeNull();
    expect(limitConcern('Message An Do about the cover.', ask, [...REVIEW_TEAM, 'An Do'])).toBeNull();
    expect(limitConcern('Message Do about the cover.', ask, [...REVIEW_TEAM, 'An Do'])).toBe(CONTACT);
  });
});

/** Swaps whole words, keeping how each was written: "Henry" to "Priya", "henry" to "priya". */
function rename(text: string, names: Record<string, string>): string {
  return text.replace(/\b[A-Za-z]+\b/g, (w) => {
    const to = names[w.toLowerCase()];
    if (!to) return w;
    if (w === w.toUpperCase() && w.length > 1) return to.toUpperCase();
    if (w[0] === w[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
    return to.toLowerCase();
  });
}

const TEAM_WORDS = ['henry', 'sam', 'ada', 'bo', 'muse', 'instinct'];
const RENAMED: Record<string, string>[] = [
  { henry: 'Priya', sam: 'Tomasz', ada: 'Zainab', bo: 'Kofi', muse: 'Zephra', instinct: 'Quillon' },
  { henry: 'Mateo', sam: 'Ingrid', ada: 'Rafael', bo: 'Lena', muse: 'Arvo', instinct: 'Nimbo' },
];

describe('every reviewed sentence that names a teammate gets the same answer with the team renamed', () => {
  const reviewed = JSON.parse(fs.readFileSync(new URL('./fixtures/limits-reviewed.json', import.meta.url), 'utf8')) as { text: string; expected: string | null }[];
  const all = [...reviewed.map((r) => ({ text: r.text, expected: r.expected })), ...HARMLESS.map((t) => ({ text: t, expected: null })), ...RISKY.map(([t, l]) => ({ text: t, expected: l }))];
  const naming = all.filter((c) => new RegExp(`\\b(?:${TEAM_WORDS.join('|')})\\b`, 'i').test(c.text));

  it('has enough of them to mean something', () => {
    expect(naming.length).toBeGreaterThanOrEqual(200);
  });

  for (const [i, names] of RENAMED.entries()) {
    const team = TEAM.map((n) => rename(n, names));
    it(`set ${i + 1}: ${team.join(', ')} (people and agents renamed)`, () => {
      const different: string[] = [];
      for (const c of naming) {
        const original = limitConcern(c.text, ask, TEAM);
        const renamed = rename(c.text, names);
        const got = limitConcern(renamed, ask, team);
        if (got !== original) different.push(`${renamed.replace(/\n/g, ' / ')} -> ${got ?? 'nothing'} (with the original names: ${original ?? 'nothing'})`);
      }
      expect(different).toEqual([]);
    });
  }
});
