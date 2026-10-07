/**
 * Reading text for the limits safety net (limits.ts): splits an instruction or a question into
 * clauses, strips the polite wrapping around the request ("Would it be OK if I...", "Ada, ...",
 * "Once Henry approves, ..."), and works out each clause's frame:
 *
 *   act       an instruction, a request or a plan: "Email the client", "Can I buy the plan?"
 *   content   work about something: drafting, research, sorting, reporting, copy, a question
 *             about what happened ("Draft the email to customers", "Find out what Stripe charges")
 *   negated   the act is forbidden: "Don't email the client"
 *   report    a statement about someone else: "Customers bought 40 licences last month"
 *   state     a finished act as a goal, usually a done-when line: "The deposit is paid"
 *
 * The rules (limits-rules.ts) then look for an act of spending, contacting, deleting or sharing.
 */

export type Frame = 'act' | 'content' | 'negated' | 'report' | 'state';

export interface Clause {
  /** Lower case, quotes replaced by "q", parentheses removed, wrapping stripped. */
  text: string;
  /** The same words in their original case (for names). */
  raw: string;
  frame: Frame;
  /** Everything written before this clause, lower case: what "it" or "them" can point back to. */
  before: string;
  /** The same, in the original case (for names). */
  beforeRaw: string;
  /** Each earlier clause on its own, in the original case: its first word is where a sentence starts. */
  beforeParts: string[];
  /** Labels on buttons the text says to press: 'Click "Buy"' gives "buy". */
  pressed: string[];
  /** Every quoted text in the sentence, lower case ("anyone with the link"). */
  quoted: string[];
  /** A statement in a text that asks for nothing but work about it (set by limits.ts). */
  factOnly?: boolean;
}

// ------------------------------------------------------------------------------------------------
// The team
//
// Who is on the team comes only from the names passed in (the room's people and agents), never from
// names written into the rules. In each clause a teammate's name is swapped for a placeholder of the
// same length ("Henry" becomes "qmmmm"), so a rule can say "a teammate" without knowing any name.
// ------------------------------------------------------------------------------------------------

/** The room's people and agents, as the limits check reads them (see teamOf). */
export interface Team {
  /** One-word names ("Henry", "Ada"): a teammate in any case. */
  anyCase: Set<string>;
  /** Single words of longer names ("Henry" of "Henry Turcotte", "Closer" of "The Closer"): a teammate only when written with a capital, as names are. */
  capitalOnly: Set<string>;
  /** Longer names as a whole, word by word ("muse henry", "the closer", "an do"): a teammate in any case. */
  phrases: string[][];
}

/** Small ordinary words never count as a teammate on their own, even in a name ("The Closer", "An Do", "Will"). */
const ORDINARY = new Set(
  (
    'the a an to do of and or in on at by for with from into onto it its is be as so no not up out off my our your his her their we you ' +
    'he she they me us him them this that these those all any some each every one i if then than but also just only very more most new old ' +
    'get got go let can could will would shall should may might must have has had did does was were are am been being what which who whom ' +
    'whose when where why how here there now today yes ok okay hi hey dear team room owner owners agent agents conductor people person ' +
    'everyone anyone someone nobody'
  ).split(' '),
);

/** Titles are never a name on their own ("Dr" of "Dr. Ada Lovelace"). */
const TITLES = new Set('dr mr mrs ms mx miss prof sir dame lord lady rev st jr sr phd md'.split(' '));

/** Letters without accents, as normalise() leaves the text ("José" is read as "jose"). */
export function plainLetters(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/**
 * `notNames` are words that never count as a teammate on their own because they mean something
 * else to the rules: places and tools ("LinkedIn" of an agent called "LinkedIn Muse"), roles and
 * outsiders ("Support", "Press"), days and so on (limits-rules.ts passes them). A whole name still
 * counts ("Support Bot").
 */
export function teamOf(names: string[], notNames: ReadonlySet<string> = new Set()): Team {
  const team: Team = { anyCase: new Set(), capitalOnly: new Set(), phrases: [] };
  for (const name of names) {
    const words = plainLetters(name).toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
    const real = words.filter((w) => /\p{L}/u.test(w) && w.length > 1 && !ORDINARY.has(w) && !TITLES.has(w) && !notNames.has(w));
    if (words.length === 1) {
      for (const w of real) team.anyCase.add(w);
      continue;
    }
    if (words.length > 1) team.phrases.push(words);
    for (const w of real) team.capitalOnly.add(w);
    // Written as a handle: "Muse_Henry", "@MuseHenry", "muse-henry".
    if (real.length) for (const joined of [words.join(''), words.join('_'), words.join('-')]) team.anyCase.add(joined);
  }
  team.phrases.sort((a, b) => b.join(' ').length - a.join(' ').length);
  return team;
}

export const NO_TEAM: Team = teamOf([]);

/** A teammate's placeholder in clause text. */
export const TEAMMATE = /^qm+$/;

/** A word starts after a character that cannot be part of a name ("jean-luc" holds no "luc"). */
const WORD_CHAR = /[\p{L}\p{N}_'-]/u;
/** A word ends where no letter or digit follows, also not after a hyphen or an apostrophe ("dana's" is "dana"). */
const WORD_END = /^(?:s')|^(?![\wÀ-ɏ]|-[\p{L}\p{N}]|'(?!s\b)\p{L})/u;

/**
 * Swaps each whole-word occurrence of the given words for a same-length placeholder: "q" and then
 * the kind's letter ("dana's" with kind "n" becomes "qnnn's"). Longer words win.
 */
export function swapWords(s: string, kinds: Map<string, string>): string {
  if (!kinds.size) return s;
  const words = [...kinds.keys()].sort((a, b) => b.length - a.length);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (i === 0 || !WORD_CHAR.test(s[i - 1])) {
      const hit = words.find((w) => s.startsWith(w, i) && WORD_END.test(s.slice(i + w.length, i + w.length + 2)));
      if (hit) {
        out += 'q' + kinds.get(hit)!.repeat(hit.length - 1);
        i += hit.length;
        continue;
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

/** The words of a text as names are read: "Henry's" gives "Henry". */
function nameWords(raw: string): string[] {
  return raw
    .replace(/[^\p{L}\p{N}_'@.&-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^@+/, '').replace(/'s$|'$/, '').replace(/[.]+$/, ''))
    .filter(Boolean);
}

const CAPITALISED = /^\p{Lu}\p{Ll}/u;

/** Where a teammate's longer name starts at word i, how many words it has (0 if none). */
function phraseAt(words: string[], i: number, team: Team): number {
  for (const p of team.phrases) {
    if (i + p.length <= words.length && p.every((w, k) => words[i + k].toLowerCase() === w)) return p.length;
  }
  return 0;
}

/** The words in a text (lower case) that name a teammate. */
export function teammatesIn(raw: string, team: Team): Set<string> {
  const out = new Set<string>();
  if (!team.anyCase.size && !team.phrases.length) return out;
  const words = nameWords(raw);
  for (let i = 0; i < words.length; i++) {
    const n = phraseAt(words, i, team);
    if (n) {
      for (let k = 0; k < n; k++) out.add(words[i + k].toLowerCase());
      i += n - 1;
      continue;
    }
    const lower = words[i].toLowerCase();
    // A first name followed by another surname is someone else: "Priya Raman" when the team has
    // Priya Nair, "Sam Altman" when it has Sam.
    const next = words[i + 1];
    if (next && CAPITALISED.test(next) && !team.anyCase.has(next.toLowerCase()) && !team.capitalOnly.has(next.toLowerCase()) && !notNameAfter(next)) continue;
    // One word of a longer name counts when written as a name. As the first word of a clause it is
    // the person only when it reads as the subject ("Henry has had a look"), not as a verb ("Bill
    // Acme for the retainer", "Chase the client" when the team has Bill Chen and Chase Miller).
    const subject = i > 0 || SUBJECT_NEXT.test(next ?? '') || (!IS_VERB.test(lower) && !OBJECT_NEXT.test(next ?? '') && !(next && CAPITALISED.test(next)));
    if (team.anyCase.has(lower) || (team.capitalOnly.has(lower) && subject && /^\p{Lu}/u.test(words[i]))) out.add(lower);
  }
  return out;
}

/** After a first word that is a person: "Henry has had a look", "Sam will send it". */
const SUBJECT_NEXT = /^(?:has|have|had|is|was|were|are|will|would|can|could|should|shall|may|might|must|did|does|do|said|says|wants|needs|thinks|asked|approved|agreed|signed|sent|wrote|already|just|also|still|and|or)$/i;
/** After a first word that is a verb: "Chase the client", "Grant them access". */
const OBJECT_NEXT = /^(?:the|a|an|our|my|your|their|his|her|its|them|him|it|this|that|these|those|all|every|everyone|anyone|each|any|some|up|out|in|back|[$€£]?\d.*)$/i;

/** Capitalised words that are not a surname: "Priya Monday", "Henry FYI". */
const NOT_SURNAME = new Set('monday tuesday wednesday thursday friday saturday sunday today tomorrow tonight please thanks fyi asap eod okay ok and or but so the a an to for from at in on with by of is are was will can could would should has have'.split(' '));
const notNameAfter = (w: string) => NOT_SURNAME.has(w.toLowerCase()) || !/^[\p{L}'-]+$/u.test(w);

/** The lower-case text with every teammate's name swapped for a "qmmm" placeholder. */
export function swapTeammates(lower: string, raw: string, team: Team): string {
  if (!team.anyCase.size && !team.phrases.length) return lower;
  let s = lower;
  // Longer names first, word by word: "the closer" becomes "qmm qmmmmm".
  for (const p of team.phrases) {
    let from = 0;
    for (;;) {
      const at = s.indexOf(p[0], from);
      if (at < 0) break;
      from = at + 1;
      if (at > 0 && WORD_CHAR.test(s[at - 1])) continue;
      let end = at;
      let ok = true;
      const parts: [number, number][] = [];
      for (const [k, w] of p.entries()) {
        if (k > 0) {
          const gap = /^\s+/.exec(s.slice(end));
          if (!gap) {
            ok = false;
            break;
          }
          end += gap[0].length;
        }
        if (!s.startsWith(w, end)) {
          ok = false;
          break;
        }
        parts.push([end, w.length]);
        end += w.length;
      }
      if (!ok || !WORD_END.test(s.slice(end, end + 2))) continue;
      for (const [start, len] of parts) s = s.slice(0, start) + 'q' + 'm'.repeat(len - 1) + s.slice(start + len);
    }
  }
  const single = new Map<string, string>();
  for (const w of teammatesIn(raw, team)) if (team.anyCase.has(w) || team.capitalOnly.has(w)) single.set(w, 'm');
  // A clause that starts with a verb keeps it, even when someone on the team has that name ("Bill
  // Acme for the March retainer" when the team has a Bill), unless it reads as the subject ("Bill
  // has had a look").
  const head = /^([\p{L}'-]+)(?![,:])\s*(\S*)/u.exec(s);
  if (head && single.has(head[1]) && (IS_VERB.test(head[1]) || CONTENT_HEADS.has(head[1])) && !SUBJECT_NEXT.test(head[2])) {
    return head[1] + swapWords(s.slice(head[1].length), single);
  }
  return swapWords(s, single);
}

/** Is the word at this position of the original text a teammate's name? ("so Henry can publish it") */
function teammateAt(text: string, at: number, team: Team): boolean {
  const words = nameWords(text.slice(at, at + 200));
  if (!words.length) return false;
  if (phraseAt(words, 0, team)) return true;
  const lower = words[0].toLowerCase();
  if (words[1] && CAPITALISED.test(words[1]) && !notNameAfter(words[1]) && !team.capitalOnly.has(words[1].toLowerCase())) return false;
  return team.anyCase.has(lower) || (team.capitalOnly.has(lower) && /^\p{Lu}/u.test(words[0]));
}

// ------------------------------------------------------------------------------------------------
// Word lists shared by the frames and the rules
// ------------------------------------------------------------------------------------------------

/**
 * Heads of clauses that are work about something rather than doing it: writing, editing, research,
 * sorting, planning, building and fixing. Risky words after them are the topic, not the act.
 */
export const CONTENT_HEADS = new Set(
  (
    'draft drafts redraft write rewrite rewrites edit edits proofread polish tighten shorten trim cut condense expand prepare prep outline compose ' +
    'design redesign mock sketch wireframe illustrate plan brainstorm research investigate find look check verify double-check review read reread ' +
    'study analyze analyse audit compare summarize summarise recap list count track note record log tag flag pull collect gather compile ' +
    'document describe suggest recommend propose think decide pick choose select sort order reorder re-order rank group filter rename ' +
    'translate update tweak adjust improve fix debug refactor test monitor build implement handle wire introduce resize crop mark move ' +
    'archive restore recover undo label caption format structure organize organise tidy clean prioritize prioritise estimate calculate ' +
    'total measure map flesh finish finalize finalise complete continue start begin keep reword phrase say mention state include highlight ' +
    'stress emphasize emphasise explain show present create make add put insert attach link replace swap change set use turn get ' +
    'see figure work learn understand familiarize familiarise skim scan watch listen transcribe proof spell-check fact-check'
  ).split(' '),
);

/** Words that start a question about facts rather than a request to act. */
export const FACT_QUESTION = /^(?:how\s+(?:many|much|often|long|do|does|did|is|are|was|were|should\s+we\s+word|can\s+we\s+word)|which|what|what's|whats|who|whom|whose|why|where|did|didn't|does|doesn't|do\s+(?:we|they|you)\s+(?:know|have|still)|has\s+(?:anyone|anybody|someone|somebody|he|she|it|qm+)|have\s+(?:you|we|they)|had|were|was|is\s+there|are\s+there|any\s+idea)\b/;

const SUBORDINATE = /^(?:when|whenever|once|if|after|as\s+soon\s+as|before|until|unless|since|because|while|so\s+that|in\s+case)\b/;

/** Wrapping in front of the request itself; stripped repeatedly. */
const WRAPPERS: RegExp[] = [
  /^(?:fyi|btw|ps|note|reminder|nb)\s*[:,-]\s*/,
  /^(?:please|pls|plz|kindly|ok(?!\s+(?:to|if|for)\b)|okay(?!\s+(?:to|if|for)\b)|alright(?!\s+(?:to|if)\b)|all\s+right|great|good|perfect|thanks|thank\s+you|cheers|sure|yes|yep|right|so|now|next|then|also|and|first|firstly|second|secondly|finally|lastly|quickly|today|tonight|tomorrow|asap|just|hey|hi|meanwhile|afterwards|later|again|instead|separately|in\s+the\s+meantime|this\s+(?:morning|afternoon|week)|by\s+(?:friday|monday|tomorrow|eod|end\s+of\s+day))\b[,:!]?\s*/,
  /^(?:looks\s+good|sounds\s+good|all\s+good|approved|confirmed|done|signed\s+off|good\s+to\s+go|ready)\b[,:!]?\s*/,
  /^(?:can|could|may|might|should|shall|must)\s+(?:i|we)\s+(?:also\s+|maybe\s+|perhaps\s+|actually\s+|still\s+|just\s+|now\s+|quickly\s+|simply\s+|quietly\s+|please\s+)*/,
  /^(?:can|could|would|will)\s+you\s+(?!like\b)(?:please\s+)?/,
  /^(?:would|will|is|was)\s+it\s+be\s+(?:ok|okay|alright|all\s+right|fine|possible|acceptable|a\s+problem|an\s+issue)\s+(?:for\s+me\s+|for\s+us\s+)?(?:to|if\s+(?:i|we))\s+/,
  /^(?:would|will)\s+it\s+be\s+(?:ok|okay|alright|all\s+right|fine)\s+(?:to|if\s+(?:i|we))\s+/,
  /^(?:is|are)\s+(?:it|that)\s+(?:ok|okay|alright|all\s+right|fine|cool|acceptable)\s+(?:for\s+me\s+|for\s+us\s+)?(?:to|if\s+(?:i|we))\s+/,
  /^(?:is\s+it\s+)?(?:ok|okay|alright|fine|cool)\s+(?:for\s+me\s+|for\s+us\s+)?(?:to|if\s+(?:i|we))\s+/,
  /^(?:do\s+you\s+)?mind\s+if\s+(?:i|we)\s+/,
  /^(?:do\s+you\s+)?want\s+(?:me|us)\s+to\s+/,
  /^would\s+you\s+like\s+(?:me|us)\s+to\s+/,
  /^(?:i'd|i\s+would|we'd|we\s+would)\s+like\s+to\s+/,
  /^(?:i|we)\s+(?:want|need|plan|intend|hope|mean|ought|have|got)\s+to\s+/,
  /^(?:i'm|i\s+am|we're|we\s+are)\s+(?:going\s+to|about\s+to|planning\s+to|planning\s+on|thinking\s+of|thinking\s+about|ready\s+to|happy\s+to|keen\s+to)\s+/,
  /^(?:planning|going|hoping|intending|about|ready|happy|keen|aiming)\s+to\s+/,
  /^(?:perhaps\s+|maybe\s+)?it\s+(?:might|may|could|would|will)\s+(?:also\s+)?(?:be\s+(?:worth|good|nice|kind|wise|sensible|helpful|useful|best|better|time|tidier|cleaner|simpler|easier|smart|ideal|great|fine|a\s+good\s+idea|an\s+idea|polite|prudent)|make\s+sense|help)\s+(?:to\s+|if\s+(?:we|i)\s+)?/,
  /^(?:it(?:'s|\s+is)\s+)?(?:probably\s+)?(?:(?:worth|a\s+good\s+idea|best)\s+(?:to\s+)?|time\s+to\s+)(?=[a-z])/,
  /^might\s+it\s+be\s+(?:worth|an\s+idea|a\s+good\s+idea|best|sensible|wise)\s+(?:to\s+)?/,
  /^might\s+i\s+suggest\s+(?:that\s+)?(?:we|i)?\s*/,
  /^(?:suggest|recommend|propose)\s+(?:that\s+)?(?:we|i)\s+(?:should\s+)?/,
  /^(?:i'd|i\s+would|we'd|we\s+would)\s+(?:gently\s+|just\s+|strongly\s+)?(?:suggest|recommend|propose|advise)\s+(?:that\s+)?(?:we|i)?\s*(?:should\s+)?/,
  /^(?:i|we)\s+(?:was|were|am|are|'m|'re)\s+(?:thinking|wondering)\s+(?:of\s+|about\s+|whether\s+|if\s+)?(?:(?:i|we)\s+)?(?:might\s+|could\s+|should\s+|ought\s+to\s+|would\s+)?/,
  /^i\s+wonder\s+(?:whether|if)\s+(?:we|i)\s+(?:ought\s+to|should|could|might)\s+/,
  /^would\s+(?:anyone|anybody|you|everyone)\s+mind\s+if\s+(?:i|we)\s+/,
  /^(?:perhaps|maybe|possibly)\s+(?:we|i)\s+(?:could|can|should|might|ought\s+to)\s+/,
  /^(?:perhaps|maybe|possibly)\s+/,
  /^that\s+(?:we|i)\s+(?:should\s+)?(?=[a-z])/,
  /^(?:in|on|for|from|at|within|inside|under)\s+(?:the|our|this|that|a|an|each|every|last|next|tomorrow's|today's)\s+[^,]{1,40},\s*/,
  /^(?:i'm\s+|i\s+am\s+|we're\s+|we\s+are\s+)?thinking\s+(?:we\s+should|i\s+should|of|about|i'll|we'll|i\s+could|we\s+could)\s+/,
  /^(?:i|we)\s+think\s+(?:we|i)\s+should\s+/,
  /^(?:i'll|i\s+will|we'll|we\s+will|i'd|we'd|let\s+me|let's|lets|let\s+us)\s+(?:go\s+ahead\s+and\s+)?/,
  /^(?:we|you|i)\s+(?:should|must|need\s+to|have\s+to|has\s+to|ought\s+to|can|could|might|may)\s+(?:also\s+|maybe\s+|probably\s+|now\s+|still\s+|just\s+)*/,
  /^(?:you'll|you\s+will|you'd|you\s+would)\s+(?:need\s+to\s+)?/,
  /^(?:need|needs|have|has|got)\s+to\s+/,
  /^(?:remember|be\s+sure|make\s+sure|ensure|don't\s+forget|do\s+not\s+forget|try|feel\s+free|go\s+on|time|it's\s+time|it\s+is\s+time|it'd\s+be\s+good|it\s+would\s+be\s+good|it'd\s+be\s+great|it\s+would\s+be\s+great)\s+(?:to\s+)?(?=[a-z])/,
  /^(?:go\s+ahead|ahead)\s+(?:and\s+)?(?!with\b)(?=[a-z])/,
  /^to\s+(?=[a-z])/,
];

/** Request nouns after "go ahead with", "proceed with": the act is the noun. */
const PROCEED = /^(?:go\s+ahead\s+with|proceed\s+with|move\s+forward\s+with|go\s+for|sort\s+out|get\s+on\s+with|follow\s+through\s+(?:on|with)|push\s+(?:on\s+)?with|carry\s+on\s+with|(?:is\s+)?(?:now|today|this\s+week)\s+(?:a\s+)?good\s+time\s+(?:for|to)|(?:is\s+it\s+)?(?:a\s+)?good\s+time\s+(?:for|to))\s+/;

/** A negation in front of the act. */
export const NEGATED_START =
  /^(?:don't|dont|do\s+not|does\s+not|doesn't|never|no\s+need\s+to|there's\s+no\s+need\s+to|there\s+is\s+no\s+need\s+to|you\s+don't\s+need\s+to|you\s+do\s+not\s+need\s+to|no\s+one\s+should|nobody\s+should|no-one\s+should|we\s+should\s+not|we\s+shouldn't|you\s+should\s+not|you\s+shouldn't|we\s+must\s+not|you\s+must\s+not|under\s+no\s+circumstances|in\s+no\s+case|skip|hold\s+off|holding\s+off|avoid|refrain\s+from|stop|not\s+yet|not\s+now|wait\s+(?:before|to)|be\s+careful\s+not\s+to|make\s+sure\s+not\s+to|make\s+sure\s+you\s+don't|remember\s+not\s+to|please\s+don't|please\s+do\s+not|no\s+more|nothing|none|no|not|without|forget\s+about)\b/;

/** A negation inside a statement: "Customer data must not be shared". */
export const NEGATED_INSIDE = /\b(?:must\s+not|mustn't|should\s+not|shouldn't|cannot|can't|won't|will\s+not|do\s+not|don't|does\s+not|doesn't|never|not\s+be|not\s+to|no\s+longer)\b/;

/** Words that make a clause a statement about others, not a request. */
const THIRD_PERSON_VERB = /^(?:\w+s|is|are|was|were|has|have|had|did|does|will|would|can|could|should|must|may|might|went|got|came|said|told|sent|wrote|spoke|met|made|took|paid|bought|spent|left|asked|agreed|signed|approved|already|just|still|also|never)$/;

// ------------------------------------------------------------------------------------------------
// Normalising and splitting
// ------------------------------------------------------------------------------------------------

/** What follows an arrow or a slash that means "then": a request ("send it", "post the summary"). */
const THEN_REQUEST = /^([\p{L}-]+)\s+(?:it|them|him|her|this|that|these|those|the|a|an|our|their|your|my|all|every|each|any|some|"[^"]*"|[$€£]|\d)/u;
const thenRequest = (rest: string) => {
  const m = THEN_REQUEST.exec(rest);
  return !!m && (IS_VERB.test(m[1].toLowerCase()) || CONTENT_HEADS.has(m[1].toLowerCase()));
};

function normalise(text: string): string {
  return text
    // A keycap number is a list number ("1️⃣ Draft the reply"), read before its marks are removed.
    .replace(/(\d)\uFE0F?\u20E3/g, '$1. ')
    // Accents and compatibility forms read as plain letters ("José", full-width letters), as team
    // names do (teamOf); invisible characters never split or hide a word ("em\u200bail").
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    // Every kind of line break is a line break, and every other run of spaces is one space.
    .replace(/\r\n?|[\u2028\u2029\u0085\v\f]/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    // Emoji and pictographs are decoration ("📧 Email the client"); between words one ends a clause,
    // as a comma would ("Hi team 👋 can I publish the post?"). U+2063 is the clause mark (CLAUSE_SPLIT).
    .replace(/^([^\S\n]*)[\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u20E3]+/gmu, '$1 ')
    .replace(/[\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u20E3]+/gu, ' \u2063 ')
    // A word that looks like one of the check's placeholders ("qmm", "QNNN") is escaped, so an agent
    // cannot pass itself or anyone else off as a teammate (see swapTeammates and limits-rules.ts).
    .replace(/\b(q)(?=([mntf])\2*\b)/gi, '$1$1')
    // Formatting is not meaning: "**publish**", "*delete*", "`Email the client`" read as plain words.
    // A short capitalised label in backticks is a label, as in quotes: "`Buy now` should be green".
    .replace(/`([A-Z][A-Za-z]*(?: [A-Za-z]+){0,2})`/g, (m: string, label: string) => (/\b(?:the|a|an|my|our|your|their|it|them|this|that|all|every)\b/i.test(label) ? label : `"${label}"`))
    .replace(/`+/g, '')
    // "Henry&Sam", "Henry+Sam": two names.
    .replace(/(\p{Lu}\p{Ll}+)([&+])(?=\p{Lu}\p{Ll})/gu, '$1 $2 ')
    .replace(/(^|[\s(\[{"'])(?:\*{1,3}|_{1,3})(?=[^\s*_])/g, '$1')
    .replace(/(?<=[^\s*_])(?:\*{1,3}|_{1,3})(?=$|[\s)\]}.,;:!?"'])/gm, '')
    // An arrow, or a spaced slash, before a request reads as "then" ("Draft the reply -> send it");
    // not inside code ("$order->pay()") or a label change ("Save -> Publish").
    .replace(/\s*(?:-{1,2}>|={1,2}>|[→⇒⟶➔➜⇨]|\s\/)\s*/g, (m: string, at: number, all: string) => (thenRequest(all.slice(at + m.length)) ? ', then ' : m))
    // "Draft/send the reply": two verbs joined by a slash are two acts.
    .replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, (m: string, a: string, b: string) => {
      const verb = (w: string) => IS_VERB.test(w.toLowerCase()) || CONTENT_HEADS.has(w.toLowerCase());
      return verb(a) && verb(b) && !/^w$/i.test(a) ? `${a} and ${b}` : m;
    })
    // shorthand: "w/ the client", "the old acct", "fix typos + delete the folder"
    .replace(/\bw\/o\b/gi, 'without')
    .replace(/\bw\//gi, 'with ')
    .replace(/\baccts\b/gi, 'accounts')
    .replace(/\bacct\b/gi, 'account')
    .replace(/\benvs\b/gi, 'environments')
    .replace(/\benv\b/gi, 'environment')
    .replace(/\bmsgs?\b/gi, 'message')
    .replace(/\bre:?\s+(?=the\b|our\b|a\b|your\b)/gi, 'about ')
    .replace(/\s\+\s/g, ' and ')
    // "Do not, for now, email the client": the aside does not end the negation.
    .replace(/\b(do\s+not|don't|dont|never|please\s+do\s+not|please\s+don't)\s*,\s*([^,.;]{1,40}?)\s*,\s*/gi, '$1 ')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+[–—]\s+/g, ', ')
    .replace(/[–—]/g, '-')
    .replace(/\s&\s/g, ' and ')
    .replace(/[^\S\n]+/g, ' ');
}

const LIST_MARKER = /^\s*(?:[-*•·>+]+\s*|#{1,6}\s+|\[[^\]\n]{0,24}\]\s*|\(?\d{1,2}[.)](?:\s+|(?=[A-Z]))|\(?[a-hA-H][.)]\s+|(?:[Ss]tep|[Tt]ask|[Ii]tem)\s+\d{1,2}\s*(?:[-.)]|,)\s+)+/;
/** A row of a Markdown table: "| Pay the venue deposit ($500) | Sam |" (cells are read as sentences). */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;
/** A list number or letter at the start of a sentence ("2) Email it to the client"). */
const SENTENCE_MARKER = /^\(?(?:\d{1,2}|[a-hA-H])[.)]\s+/;
/** Numbered items written on one line: "1) Draft the reply. 2) Email it to the client." */
const INLINE_ITEMS = [/(?:^|\s)\(?\d{1,2}\)\s+/g, /(?:^|\s)\d{1,2}\.\s+(?=[A-Za-z])/g, /(?:^|\s)\(?[a-h]\)\s+(?=[A-Za-z])/g];
function splitInlineItems(line: string): string {
  for (const re of INLINE_ITEMS) {
    const marks = [...line.matchAll(re)];
    if (marks.length < 2) continue;
    // Only items that are requests ("1) Draft the reply 2) Email it to the client"), not a numbered
    // list inside one request ("Send Lena (1) the offer letter and (2) the benefits summary").
    const items = marks.map((m) => (line.slice(m.index! + m[0].length).split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z-]/g, ''));
    if (!items.every((w) => IS_VERB.test(w) || CONTENT_HEADS.has(w))) continue;
    // Not inside copy after a label ("Draft the FAQ answer: a) go to Settings b) delete your account").
    const prefix = line.slice(0, marks[0].index).trim();
    if (/:$/.test(prefix) && colonFrame(`${prefix} x`)?.copyFollows) continue;
    line = line.replace(re, (m) => (/^\s/.test(m) ? '. ' : ''));
  }
  return line.replace(/^\.\s+/, '');
}

/** Splits a line into sentences without breaking "$29.99", "tempo.app" or "e.g.". */
function sentencesOf(line: string): string[] {
  return line
    .replace(/\b(e\.g|i\.e|etc|vs|approx|incl|mr|mrs|ms|dr)\.\s/gi, '$1 ')
    .split(/(?<=[.!?;])\s+|(?<=[.!?])(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does text in brackets ask for something ("then email it to the client", "don't post it yet")? */
/** A verb that makes a bracket a statement ("(pay button does nothing)"), never a plural noun ("drafts"). */
const BRACKET_FACT = /^(?:is|are|was|were|has|had|did|does|doesn't|didn't|isn't|won't|will|went|got|came|said|told|sent|wrote|spoke|met|made|took|paid|bought|spent|left|asked|agreed|signed|approved)$/;

function bracketRequest(inner: string, alone: boolean, team: Team): string | null {
  // "(done when it has been emailed to the client)" is a goal, read like a done-when line.
  if (/^done\s+when\b/i.test(inner)) return inner;
  // "(Ada: delete the old exports)", "(old exports: delete them)", "(+ email it to the client)".
  const body = (/^[^:]{1,40}:\s+(.+)$/.exec(inner)?.[1] ?? inner).replace(/^(?:\+|&|and)\s+/i, '');
  const parts = body.replace(/\s+/g, ' ').split(CLAUSE_SPLIT);
  const request = parts.some((part) => {
    let t = stripWrapping(swapTeammates(part.toLowerCase(), part, team).replace(/[.!?;:,]+$/, '').trim()).text;
    t = stripWrapping(stripAddressee(t)).text;
    t = afterCondition(t) ?? t;
    const words = t.split(/\s+/);
    const head = baseForm(words[0] ?? '');
    if (NEGATED_START.test(t)) return true;
    if (!IS_VERB.test(head)) return false;
    // Brackets that are the whole sentence: "(Buy the domain today.)"
    if (alone) return true;
    // "(pay button does nothing on mobile)", "(order 1042)", "(Buy now)": a fact, a number or a label.
    if (words.slice(1, 4).some((w) => BRACKET_FACT.test(w))) return false;
    return /^(?:it|them|him|her|us|this|that|these|those|the|a|an|our|their|your|my|all|every|each|any|some|both|"q"|[$€£]\d|to|on|out|up|down|back|over|off)\b/.test(words[1] ?? '');
  });
  return request ? body : null;
}

/** Labels on buttons to press, and the text with every other quote reduced to "q". */
function quotes(sentence: string): { text: string; pressed: string[] } {
  const pressed: string[] = [];
  let text = sentence.replace(
    /\b(?:click|clicking|hit|hitting|press|pressing|tap|tapping|push|select|choose|use)\s+(?:on\s+)?(?:the\s+)?"([^"]{1,40})"(?:\s+(?:button|link|option))?/gi,
    (_m, label: string) => {
      pressed.push(label.toLowerCase());
      return `pressed "q"`;
    },
  );
  text = text.replace(/"[^"]*"/g, '"q"').replace(/(^|\s)'[^']{1,60}'(?=[\s.,;:!?]|$)/g, '$1"q"');
  return { text, pressed };
}

/** Clause boundaries: "and" or "then" before another verb, "but", "so", a comma before a request. */
const VERBISH =
  String.raw`(?:email|e-mail|mail|send|resend|forward|reply|respond|answer|call|phone|text|message|dm|ping|contact|reach|tell|let|ask|invite|pay|buy|purchase|order|get|grab|book|hire|renew|upgrade|subscribe|sign|delete|remove|wipe|drop|clear|purge|destroy|erase|empty|publish|post|tweet|share|upload|launch|deploy|ship|push|release|make|put|go|take|turn|open|give|add|start|run|set|switch|move|cancel|close|confirm|accept|approve|charge|bill|invoice|refund|transfer|wire|spend|place|loop|cc|follow|check|draft|write|review|edit|fix|finish|polish|prepare|update|use|create|keep|announce|present|show|demo|pitch|meet|schedule|book|notify|inform|introduce|intro|forward|top|expense|tip|donate|pledge|back|bid|register|enroll|enrol|onboard|offboard|archive|restore|merge|kick|trigger|flip|roll|promote|list|submit|stream|livestream|reveal|unveil|paste|commit|expose|leak|disclose|announce|queue|drop|shoot|circle|touch|sync|loop|line|do|hop|jump|lock|settle|cover|treat|bring|commission|rent|reserve|lease|order|pre-order|preorder|re-order|reorder|venmo|paypal|zelle|recharge|reload|bump|raise|increase|up|double|allocate|throw|boost|promote|sponsor|fund|invest|bin|trash|scrap|nuke|prune|flush|truncate|tear|shut|terminate|deactivate|overwrite|replace|force-push|unpublish|unlist|take|negotiate|reschedule|cancel|decline|reply|deploying|bin|rm|factory|warn|thank|remind|point|agree|countersign|invite|dm|text|ping|proceed)`;
const CLAUSE_SPLIT = new RegExp(
  String.raw`\s*(?:\u2063\s*|,\s*(?:and\s+)?then\s+|\s+and\s+then\s+|\s+then\s+(?=${VERBISH}\b)|,?\s+but\s+(?:also\s+)?|,\s+so\s+|\s+so\s+(?!that\b|far\b|much\b|many\b|long\b|we\s+can\b)(?=(?:we|i|you|they|it|${VERBISH})\b)|,?\s+and\s+(?:also\s+)?(?=${VERBISH}\b(?!\s+(?:list|copy|page|form|button|link|draft|template|address|tracking|events?|flow)\b))|,?\s+and\s+(?=(?:no|nothing|none|never)\b)|,\s+(?!(?:up|down)\s+(?:from|to|by)\b)(?![\w-]+\s+or\s+[\w-]+\b)(?=(?:${VERBISH}|can|could|should|shall|may|is\s+it|would|ok|okay|go\s+ahead|please|don't|do\s+not|never)\b))`,
  'i',
);
/** A whole word that is a verb from the list above; a clause that starts with one. Built once. */
const IS_VERB = new RegExp(`^${VERBISH}$`);
const STARTS_WITH_VERB = new RegExp(`^${VERBISH}\\b`);
/** "X is approved send it to the client" (see gluedRequest). */
const GLUED = new RegExp(String.raw`^(?:[\w'-]+\s+){1,4}?(?:is|are|looks|seems)\s+(?:\w+\s+)?(?:approved|ready|done|good|fine|ok|okay|final|signed\s+off|finished)\s+(${VERBISH}\s+.*)$`);

function stripWrapping(text: string): { text: string; conditional: boolean } {
  let t = text.trim().replace(/^[,:;.\s]+/, '');
  let conditional = false;
  for (let i = 0; i < 12; i++) {
    const before = t;
    t = t.replace(/^@[\w.-]+[,:]?\s+/, '');
    for (const w of WRAPPERS) {
      const m = w.exec(t);
      if (m && m[0]) {
        if (/\bif\s+(?:i|we)\s+$|\b(?:of|about)\s+$|\bworth\s+$/.test(m[0])) conditional = true;
        t = t.slice(m[0].length);
      }
    }
    if (t === before) break;
  }
  return { text: t, conditional };
}

const IRREGULAR: Record<string, string> = {
  sent: 'send', told: 'tell', gave: 'give', wrote: 'write', met: 'meet', spoke: 'speak', bought: 'buy', paid: 'pay', spent: 'spend',
  got: 'get', put: 'put', shared: 'share', took: 'take', ran: 'run', shot: 'shoot', made: 'make', set: 'set', left: 'leave', brought: 'bring',
  threw: 'throw', went: 'go', did: 'do', had: 'have', let: 'let', cut: 'cut', hit: 'hit', rang: 'ring', sold: 'sell', forwarded: 'forward',
};

/** "dropped" after "if I" reads as "drop"; "deploying" at the start reads as "deploy". */
function baseForm(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  const isVerb = (w: string) => IS_VERB.test(w);
  const candidates: string[] = [];
  if (/ied$/.test(word)) candidates.push(word.slice(0, -3) + 'y');
  const m = /^(.*?)(?:ed|ing)$/.exec(word);
  if (m) {
    const stem = m[1];
    candidates.push(stem, stem + 'e');
    if (/([^aeiou])\1$/.test(stem)) candidates.push(stem.slice(0, -1));
  }
  return candidates.find(isVerb) ?? word;
}

function normaliseHead(text: string, conditional: boolean): string {
  const words = text.split(/\s+/);
  const head = words[0] ?? '';
  if (/ing$/.test(head) || (conditional && (/ed$/.test(head) || IRREGULAR[head]))) {
    const base = baseForm(head);
    if (base !== head) return [base, ...words.slice(1)].join(' ');
  }
  return text.replace(/^put\s+together\b/, 'compile');
}

/** "Muse Henry email the client", "@Ada email the vendor": a team member addressed by name (names are placeholders here). */
function stripAddressee(lower: string): string {
  const mate = (w: string) => TEAMMATE.test(w.replace(/^@/, ''));
  // "could Bo message the journalist", "Muse Sam could reply to the customer": a teammate asked to
  // act. "Henry can publish it" is what a person may do, so "can" only counts as a question.
  {
    const words = lower.split(/\s+/);
    for (const n of [2, 1]) {
      let rest: string[] | null = null;
      if (/^(?:could|can|should|might|would)$/.test(words[0] ?? '') && words.slice(1, 1 + n).every(mate)) rest = words.slice(1 + n);
      else if (words.slice(0, n).every(mate) && /^(?:could|should|might)$/.test(words[n] ?? '')) rest = words.slice(n + 1);
      if (rest && rest.length && STARTS_WITH_VERB.test(rest.join(' '))) return rest.join(' ');
    }
  }
  for (const take of [2, 1]) {
    const words = lower.split(/\s+/);
    if (words.length < take + 2) continue;
    const names = words.slice(0, take);
    const verb = words[take];
    const next = words[take + 1];
    if (!names.every((n) => mate(n) || n === 'conductor')) continue;
    if (!IS_VERB.test(verb)) continue;
    if (!/^(?:it|them|him|her|us|the|a|an|our|their|this|that|these|those|all|every|each|some|any|"q"|\d|[$€£]|to|about|on|with|out|back|up|in)/.test(next)) continue;
    return words.slice(take).join(' ');
  }
  return lower;
}

/** "When the deck is ready send it": the request after a condition with no comma. */
function afterCondition(text: string): string | null {
  if (!SUBORDINATE.test(text)) return null;
  const words = text.split(/\s+/);
  for (let i = 2; i < words.length - 1; i++) {
    if (IS_VERB.test(words[i]) && /^(?:it|them|him|her|the|a|an|our|their|this|that|these|those|all|every|"q"|\d|[$€£]|out|up|down|live|to)/.test(words[i + 1])) {
      return words.slice(i).join(' ');
    }
  }
  return null;
}

/** "X is approved send it to the client": a request glued to a short statement in front. */
function gluedRequest(text: string): string | null {
  const m = GLUED.exec(text);
  return m ? m[1] : null;
}

function frameOf(text: string): Frame {
  if (NEGATED_START.test(text)) return 'negated';
  // "delete nothing", "tell no one", "share none of it"
  if (/^\S+(?:\s+\S+)?\s+(?:nothing|no\s+one|nobody|no-one|none)\b/.test(text)) return 'negated';
  const head = text.split(/\s+/)[0] ?? '';
  if (FACT_QUESTION.test(text)) return 'content';
  if (SUBORDINATE.test(text)) return 'content';
  if (CONTENT_HEADS.has(head)) return 'content';
  if (IS_VERB.test(head)) return 'act';
  // A statement: "The deposit is paid", "Customers bought 40 licences", "Henry will call them".
  if (NEGATED_INSIDE.test(text)) return 'negated';
  const words = text.split(/\s+/);
  const verbAt = words.findIndex((w, i) => i > 0 && i < 6 && THIRD_PERSON_VERB.test(w));
  if (verbAt > 0 && /\b(?:is|are|'s|'re|has\s+been|have\s+been|gets?|got|must\s+be|should\s+be|needs?\s+to\s+be|has\s+to\s+be|have\s+to\s+be|to\s+be|needs?|is\s+being|are\s+being|will\s+be|can\s+see|has|have)\b/.test(text)) return 'state';
  return 'report';
}

// ------------------------------------------------------------------------------------------------
// Copy and labels after a colon
// ------------------------------------------------------------------------------------------------

/** "Headline idea:", "Pricing table:", "CTA:": what follows is copy or research, not a request. */
const COPY_LABEL =
  /\b(?:headline|headlines|subhead|subheadline|subheading|tagline|taglines|slogan|cta|ctas|button|buttons|label|labels|tooltip|banner|copy|caption|captions|alt\s+text|subject\s+line|subject|preheader|title|heading|text|wording|line|lines|idea|ideas|option|options|test|variant|version|quote|testimonial|example|examples|faq|answer|question|table|comparison|pricing|price|prices|plans|tiers|report|research|notes|note|summary|finding|findings|data|stats|numbers|results|rules|policy|guidelines|template|snippet|placeholder|script|transcript|reply|draft|message\s+text|body|intro|outro|bio|description|hook|prompt|tweet\s+text|post\s+text|announcement\s+text)\s*$/;

/** Splits "label: content". Returns what to read, or null to read the sentence as it is. */
/**
 * A label over requests, not copy: "Plan for today:", "Next steps:", "Question:", "Q:", "Note:",
 * "Step 2:", "Update for Henry:". What follows is read.
 */
const TASK_LABEL =
  /^(?:(?:my|our|the|your|today's|tomorrow's|this\s+week's|quick|urgent|one|small|final|work)\s+)*(?:plans?|work|tasks?|to-?dos?|todo\s+list|next(?:\s+steps?)?|steps?|action(?:\s+items?)?|actions|updates?|reminders?|agenda|checklist|review\s+checklist|priorities|question|questions|q|note|notes|answer|summary|request|ask|follow-?ups?|decision|status|heads\s+up|fyi|ps|nb|(?:step|task|item|point|phase|part)\s+\d+)(?:\s+(?:for|of|from|to|on)\s+.{1,40})?$/;

/** Words for copy being written, whose bracketed examples are not requests. */
const COPY_EXAMPLES = /\b(?:options?|ideas?|examples?|labels?|ctas?|headlines?|taglines?|slogans?|names?|variants?|versions?|copy|wording|buttons?|titles?|subject\s+lines?|lines?|suggestions?|alternatives?|choices?|captions?|hooks?|text|messages?|notifications?|scripts?|tutorials?|guides?|sections?|articles?|instructions|steps|faqs?|tooltips?|banners?|placeholders?|microcopy|prompts?)\b/;

function colonFrame(sentence: string): { read: string; copyFollows: boolean } | null {
  const m = /^(.{1,80}?):\s+(.*)$/.exec(sentence);
  if (!m || /^\s*done\s+when\b/i.test(m[1])) return null;
  const left = m[1].toLowerCase().trim();
  const right = m[2];
  if (TASK_LABEL.test(left)) return { read: right, copyFollows: false };
  if (/\d$/.test(m[1])) return null;
  const { text: leftStripped } = stripWrapping(left);
  const head = leftStripped.split(/\s+/)[0] ?? '';
  if (NEGATED_START.test(leftStripped) || /\b(?:rules?|don'ts|never|without\s+asking|off[- ]limits|avoid)\b/.test(leftStripped)) return { read: '', copyFollows: true };
  if (CONTENT_HEADS.has(head) || FACT_QUESTION.test(leftStripped)) return { read: left, copyFollows: true };
  if (COPY_LABEL.test(leftStripped)) return { read: '', copyFollows: true };
  if (IS_VERB.test(head)) return null;
  // A topic label ("Holiday email to customers: draft it by Friday"): read what follows.
  return { read: right, copyFollows: false };
}

// ------------------------------------------------------------------------------------------------
// The clauses of a text
// ------------------------------------------------------------------------------------------------

/** Thrown when reading a text takes longer than the check allows (limits.ts turns it into "could not read"). */
export class TooMuchWork extends Error {}

export function clausesOf(input: string, team: Team = NO_TEAM, deadline = Infinity): Clause[] {
  const out: Clause[] = [];
  let before = '';
  let beforeRaw = '';
  const beforeParts: string[] = [];
  let copyBlock = false;
  let copyIsList = false;
  const lines = normalise(input).split('\n');
  lines.forEach((rawLine, lineNo) => {
    if (performance.now() > deadline) throw new TooMuchWork();
    let trimmed = rawLine.trim();
    // A Markdown table: the rule row is skipped, each cell of the other rows is read as a sentence.
    if (TABLE_ROW.test(trimmed)) {
      if (TABLE_RULE.test(trimmed)) return;
      trimmed = trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()).filter(Boolean).map((cell) => cell.replace(/[.!?;:,]*$/, '.')).join(' ');
    }
    const listed = LIST_MARKER.test(trimmed);
    let line = splitInlineItems(trimmed).replace(LIST_MARKER, '').trim();
    if (!line) {
      copyBlock = false;
      return;
    }
    // Copy written as a list ("Use these points:" then bullets) ends at the first line that is not a
    // list item: "The reply has been sent to Dana" after the bullets is read again.
    if (copyBlock && copyIsList && !listed) copyBlock = false;
    if (copyBlock) copyIsList ||= listed;
    const doneWhen = /^done\s+when\b[:,]?\s*/i.test(line);
    if (doneWhen) {
      line = line.replace(/^done\s+when\b[:,]?\s*/i, '');
      copyBlock = false;
    }
    if (copyBlock && lineNo > 0) {
      before += ' ' + swapTeammates(line.toLowerCase(), line, team);
      return;
    }
    copyIsList = false;
    const quotedTexts = [...line.matchAll(/"([^"]*)"|(?:^|\s)'([^']{1,60})'(?=[\s.,;:!?]|$)/g)].map((m) => (m[1] ?? m[2] ?? '').toLowerCase());
    const { text: lineQuoted, pressed } = quotes(line);
    for (let sentence of sentencesOf(lineQuoted)) {
      if (performance.now() > deadline) throw new TooMuchWork();
      const goal = doneWhen || lineNo > 0;
      sentence = sentence.replace(/^done\s+when\b[:,]?\s*/i, '').replace(SENTENCE_MARKER, '');
      // Text in brackets is set aside; a request in it ("(then email it to the client)") is read as a
      // clause of its own, after the sentence. Asides ("(e.g. Stripe)", "(it is $29)") are not.
      const inBrackets: string[] = [];
      const alone = /^[(\[][^()[\]]*[)\]][.!?]?$/.test(sentence.trim());
      // Examples of copy being written: "Write three CTA options (Buy now, Get started, Start your trial)".
      const outside = stripWrapping(sentence.replace(/\s*[([][^()[\]]*[)\]]/g, ' ').toLowerCase().trim()).text;
      const examples = CONTENT_HEADS.has(outside.split(/\s+/)[0] ?? '') && COPY_EXAMPLES.test(outside);
      const aside = (_m: string, inner: string) => {
        const plain = inner.replace(/\s+/g, ' ').trim();
        // Unless it is a next step ("then send it") or about the thing written ("send it to the client").
        if (examples && !/^(?:and\s+)?(?:then|once|after|when|if)\b/i.test(plain) && !/^\S+\s+(?:it|them|this|that|these|those)\b/i.test(plain)) return ' ';
        const request = bracketRequest(plain, alone, team);
        if (request) inBrackets.push(request);
        return ' ';
      };
      // Twice, for a bracket inside a bracket: "(then email it to the client (Dana at Acme))".
      let body = sentence.replace(/\s*[([]([^()[\]]*)[)\]]/g, aside);
      if (/[([][^()[\]]*[)\]]/.test(body)) body = body.replace(/\s*[([]([^()[\]]*)[)\]]/g, aside);
      body = body.replace(/\s+/g, ' ').trim();
      const colon = colonFrame(body);
      if (colon) {
        if (colon.copyFollows && /:\s*$/.test(body)) copyBlock = true;
        body = colon.read;
        if (!body) {
          before += ' ' + swapTeammates(sentence.toLowerCase(), sentence, team);
          continue;
        }
      }
      if (/:\s*$/.test(sentence) && !colon) {
        const label = stripWrapping(sentence.toLowerCase().replace(/:\s*$/, '')).text;
        // "Plan for today:" over a list is a list of requests; "Draft three subject lines:" is copy.
        if (CONTENT_HEADS.has(label.split(/\s+/)[0] ?? '') && !TASK_LABEL.test(label.trim())) copyBlock = true;
      }
      const prepare = (b: string) =>
        b
        // "I'd suggest, if it's alright, that we...": a polite aside is not a clause
        .replace(/,\s*(?:if\s+(?:it's|that's|it\s+is|that\s+is)\s+(?:alright|all\s+right|ok|okay|fine)(?:\s+with\s+\w+)?|if\s+possible|if\s+you\s+(?:agree|don't\s+mind)|perhaps|maybe|please)\s*,\s*/gi, ' ')
        // "Shopify Payments, Stripe and PayPal": "and" inside a list of names joins them
        .replace(/(\b[A-Z][\w'-]*),?\s+and\s+(?=[A-Z][a-z])/g, (m, name: string, at: number) => (at === 0 ? m : `${name} \u0026 `))
        .replace(/\b((?:how|what|when|where|why|which|whether)\s+(?:to|[\w']+\s+(?:can|could|should|will|would|may|might|must|do|does|did))\s+\w+)\s+and\s+/gi, '$1 \u0026 ')
        .replace(/\b((?:he|she|they|[A-Z][\w'-]*)\s+(?:will|can|could|should|would|may|might|must|'ll|is\s+going\s+to|are\s+going\s+to)\s+\w+)\s+and\s+/g, '$1 \u0026 ')
        // "Draft it so Henry can publish it": a clause starts at "so" before a teammate (marked, then split)
        .replace(/\s+so\s+(?=\S)/g, (m: string, at: number, all: string) => (teammateAt(all, at + m.length, team) ? ' \u2063 ' : m));
      const parts = [...prepare(body).split(CLAUSE_SPLIT), ...inBrackets.flatMap((b) => prepare(b.trim()).split(CLAUSE_SPLIT))];
      for (const part of parts) {
        let raw = part.trim().replace(/[.!?;:,]+$/, '');
        // A done-when goal set in brackets: "(done when it has been emailed to the client)".
        const partGoal = /^done\s+when\b[:,]?\s*/i.test(raw);
        if (partGoal) raw = raw.replace(/^done\s+when\b[:,]?\s*/i, '');
        if (!raw) continue;
        const lower = swapTeammates(raw.toLowerCase(), raw, team);
        let { text, conditional } = stripWrapping(lower);
        text = stripAddressee(text);
        const again = stripWrapping(text);
        text = again.text;
        conditional ||= again.conditional;
        text = afterCondition(text) ?? gluedRequest(text) ?? text;
        text = stripWrapping(text).text;
        text = normaliseHead(text, conditional);
        const proceed = PROCEED.exec(text);
        if (proceed) text = 'proceed ' + text.slice(proceed[0].length);
        let frame = frameOf(text);
        if ((goal || partGoal) && (frame === 'report' || frame === 'content') && !FACT_QUESTION.test(text) && !CONTENT_HEADS.has(text.split(/\s+/)[0] ?? '')) frame = 'state';
        if (!text) continue;
        out.push({ text, raw, frame, before: before.trim(), beforeRaw: beforeRaw.trim(), beforeParts: [...beforeParts], pressed, quoted: quotedTexts });
        before += ' ' + lower;
        beforeRaw += ' ' + raw;
        beforeParts.push(raw);
      }
    }
  });
  return out;
}
