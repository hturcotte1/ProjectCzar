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
import { clausesOf, teamOf } from './limits-text.js';
import { RULES, jobAct, limitPatterns, type RuleContext } from './limits-rules.js';

/** Words that tie a room's own limit to one of the built-in rules. */
const BUILT_IN_WORDS: Record<string, RegExp> = {
  spending: /\b(?:spend\w*|money|pay\w*|purchas\w*|buy\w*|cost\w*|budget)\b/i,
  contacting: /\b(?:contact\w*|e-?mail\w*|outside\s+the\s+team|reach\w*|messag\w*|call\w*)\b/i,
  deleting: /\b(?:delet\w*|remov\w*|eras\w*|destroy\w*)\b/i,
  sharing: /\b(?:shar\w*|publish\w*|post\w*\s+publicly|outside\s+the\s+project)\b/i,
};

/** The words of a text, lower case, split the way a word boundary splits them ("pre-order" is two). */
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/);
}

/**
 * Runs every pattern once and checks a few sentences, so the first real check of the day does not
 * pay for getting them ready (about half a second). Called when the server starts.
 */
let warm = false;
export function warmUpLimits(): void {
  if (warm) return;
  warm = true;
  // Twice: the engine prepares a pattern on its first use and speeds it up on the next.
  for (let i = 0; i < 2; i++) for (const re of limitPatterns()) re.test('Warm up: email Dana at Acme the $29 invoice, then delete the folder and post it on LinkedIn.');
  const team = ['Henry', 'Muse Henry'];
  for (const text of [
    'Draft the reply to the client.\nDone when: it is sent to Dana at Acme.',
    'Can I buy the stock photo for $29?',
    'Delete the old drafts folder, then post the announcement on LinkedIn.',
    'Ask Priya Raman at Northwind whether the invoice was paid.',
  ]) limitConcern(text, [], team);
}

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '');
}

/** What a flag says if the check itself fails: it asks a person rather than letting the text through. */
export const UNREADABLE = 'something the limits check could not read';

/**
 * The ceiling on the work one text can cause. The check runs on the server's only thread, inside a
 * check-in, so it must never hold everything else up: a text with more clauses than this, or one
 * that takes longer than this, goes to a person instead ("could not read"). Ordinary texts take
 * about a millisecond; the largest text an agent may send takes a few tens of milliseconds.
 */
export const MAX_CLAUSES = 400;
export const MAX_CHECK_MS = 250;

class TooMuchWork extends Error {}

/**
 * Returns the limit the text appears to cross (e.g. "spending money"), or null.
 * `team` is the names of the room's people and agents: anyone else the text names is outside the
 * team ("Email Dana at Acme"). Without it, only roles and companies count as outsiders.
 * It never throws: a check-in or a Conductor run must not fail because of it.
 */
export function limitConcern(text: string, askFirst: string[], team: string[] = []): string | null {
  // Getting the patterns ready is not part of a check's time: the server does it when it starts.
  if (!warm) warmUpLimits();
  try {
    return concernOf(text, askFirst, team, performance.now() + MAX_CHECK_MS);
  } catch {
    return UNREADABLE;
  }
}

function concernOf(text: string, askFirst: string[], team: string[], deadline: number): string | null {
  // Who is on the team comes only from the names passed in (see teamOf): "Ada (stand-in 1)" gives
  // the name "ada stand-in 1" and the word "Ada", never a bracket.
  const ctx: RuleContext = { team: teamOf(team) };
  const clauses = clausesOf(text, ctx.team);
  if (clauses.length > MAX_CLAUSES || performance.now() > deadline) throw new TooMuchWork();
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
  const within = () => {
    if (performance.now() > deadline) throw new TooMuchWork();
    return true;
  };
  for (const rule of RULES) {
    if (live.some((c) => within() && rule.test(c, ctx))) {
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
    if (live.some((c) => keyWords.every((w) => wordsOf(c.raw).some((x) => x.startsWith(w))))) return limit;
  }
  return null;
}
