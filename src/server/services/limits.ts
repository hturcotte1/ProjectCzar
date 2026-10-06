/**
 * A plain safety net for the room's limits. The Conductor is told the limits and must flag
 * anything outside them; this check catches what it misses, and also catches an agent asking
 * permission for something outside the limits. Anything it flags becomes a decision for a person,
 * never an instruction.
 *
 * Every rule needs a real signal, not a common word. The text is read clause by clause
 * (limits-text.ts): writing, research and sorting are work about something ("Draft the email to
 * customers", "Order the images by date"), a forbidden act is not an act ("Don't email the
 * client"), and a done-when line that describes a finished act is a request for it ("The deposit is
 * paid"). The rules (limits-rules.ts) then look for spending, contacting someone outside the team,
 * deleting, or sharing outside the project. When a case is truly unclear they lean toward asking a
 * person. See DECISIONS.md (items 39 and 45 to 48) and tests/limits.test.ts.
 */
import { clausesOf } from './limits-text.js';
import { RULES, jobAct, type RuleContext } from './limits-rules.js';

/** Words that tie a room's own limit to one of the built-in rules. */
const BUILT_IN_WORDS: Record<string, RegExp> = {
  spending: /\b(?:spend\w*|money|pay\w*|purchas\w*|buy\w*|cost\w*|budget)\b/i,
  contacting: /\b(?:contact\w*|e-?mail\w*|outside\s+the\s+team|reach\w*|messag\w*|call\w*)\b/i,
  deleting: /\b(?:delet\w*|remov\w*|eras\w*|destroy\w*)\b/i,
  sharing: /\b(?:shar\w*|publish\w*|post\w*\s+publicly|outside\s+the\s+project)\b/i,
};

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '');
}

/** What a flag says if the check itself fails: it asks a person rather than letting the text through. */
export const UNREADABLE = 'something the limits check could not read';

/**
 * Returns the limit the text appears to cross (e.g. "spending money"), or null.
 * `team` is the names of the room's people and agents: anyone else the text names is outside the
 * team ("Email Dana at Acme"). Without it, only roles and companies count as outsiders.
 * It never throws: a check-in or a Conductor run must not fail because of it.
 */
export function limitConcern(text: string, askFirst: string[], team: string[] = []): string | null {
  try {
    return concernOf(text, askFirst, team);
  } catch {
    return UNREADABLE;
  }
}

function concernOf(text: string, askFirst: string[], team: string[]): string | null {
  // Names are words only: "Ada (stand-in 1)" gives "ada" and "stand-in", never a bracket.
  const words = team.flatMap((n) => n.toLowerCase().split(/[^\p{L}\p{N}'-]+/u)).filter((w) => /\p{L}/u.test(w));
  const ctx: RuleContext = { team: new Set(words) };
  const clauses = clausesOf(text, ctx.team);
  // "Run the script that deletes all staging data": the job's act is the act.
  for (const c of [...clauses]) {
    const act = c.frame === 'act' || c.frame === 'content' ? jobAct(c.text) : null;
    if (act) clauses.push({ ...c, text: act, frame: 'act' });
  }
  // Statements around nothing but work about them are facts: "The venue quote came in at €4,200.
  // Add it to the comparison table." A request anywhere in the text makes them part of the ask.
  const asks = clauses.some((c) => c.frame === 'act' || c.frame === 'state');
  for (const c of clauses) if (c.frame === 'report') c.factOnly = !asks;
  const live = clauses.filter((c) => c.frame !== 'negated');
  for (const rule of RULES) {
    if (live.some((c) => rule.test(c, ctx))) {
      // Prefer the room's own wording for the limit when one matches the rule.
      const own = askFirst.find((l) => BUILT_IN_WORDS[rule.key].test(l));
      return own ?? rule.label;
    }
  }
  // A room's own limits that the rules above don't cover: match when every key word appears
  // (as a whole word, any ending) in one clause that is not forbidden.
  for (const limit of askFirst) {
    if (Object.values(BUILT_IN_WORDS).some((re) => re.test(limit))) continue;
    const keyWords = limit
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4 && !['anything', 'anyone', 'outside', 'project', 'before', 'without', 'person'].includes(w))
      .map(stem);
    if (!keyWords.length) continue;
    if (live.some((c) => keyWords.every((w) => new RegExp(String.raw`\b${w}\w*`, 'i').test(c.raw)))) return limit;
  }
  return null;
}
