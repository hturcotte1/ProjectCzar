/**
 * A plain safety net for the room's limits. The Conductor is told the limits and must flag
 * anything outside them; this check catches the obvious cases even if it doesn't, and also
 * catches an agent asking permission for something outside the limits. Anything it flags
 * becomes a decision for a person, never an instruction.
 *
 * It deliberately errs on the side of asking a person.
 */
interface Rule {
  label: string;
  /** Words that must appear for the rule to match. */
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    label: 'spending money',
    patterns: [
      /\$\s?\d/,
      /\b\d+(\.\d+)?\s?(usd|dollars|eur|euros|gbp)\b/i,
      /\b(buy|purchase|pay|paying|paid|spend|spending|subscribe|subscription|order|invoice|charge|credit card|checkout|upgrade (?:to|our|the) (?:paid|pro|premium)|ad spend|run ads|boost (?:the )?post)\b/i,
    ],
  },
  {
    label: 'contacting anyone outside the team',
    patterns: [
      /\b(email|e-mail|call|phone|text|dm|message|contact|reach out to|write to|pitch|cold[- ]email)\b[^.]{0,60}\b(customer|customers|client|clients|vendor|vendors|press|journalist|reporter|investor|investors|partner|partners|prospect|prospects|lead|leads|supplier|influencer|outside|external|public|stranger|someone outside)\b/i,
      /\b(send|post|publish)\b[^.]{0,40}\b(newsletter|press release|announcement|tweet|linkedin|social media|mailing list)\b/i,
    ],
  },
  {
    label: 'deleting anything',
    patterns: [/\b(delete|deleting|remove permanently|erase|wipe|drop (?:the )?(?:table|database)|destroy|purge|rm -rf)\b/i],
  },
  {
    label: 'sharing anything outside the project',
    patterns: [
      /\b(share|sharing|upload|uploading|publish|publishing|make public|post publicly|leak|forward)\b[^.]{0,60}\b(outside|externally|public|publicly|third[- ]party|other compan|another team|anyone else|the internet)\b/i,
    ],
  },
];

/** Returns the limit the text appears to cross (e.g. "spending money"), or null. */
export function limitConcern(text: string, askFirst: string[]): string | null {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      // Prefer the room's own wording for the limit when one matches the rule.
      const key = rule.label.split(' ')[0];
      const own = askFirst.find((l) => l.toLowerCase().includes(key));
      return own ?? rule.label;
    }
  }
  // Room-specific limits: match when the limit's key words appear in the text.
  for (const limit of askFirst) {
    const keyWords = limit
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4 && !['anything', 'anyone', 'outside', 'project', 'before'].includes(w));
    if (keyWords.length && keyWords.every((w) => text.toLowerCase().includes(w))) return limit;
  }
  return null;
}
