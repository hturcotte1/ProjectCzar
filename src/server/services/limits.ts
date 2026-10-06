/**
 * A plain safety net for the room's limits. The Conductor is told the limits and must flag
 * anything outside them; this check catches the obvious cases even if it doesn't, and also
 * catches an agent asking permission for something outside the limits. Anything it flags
 * becomes a decision for a person, never an instruction.
 *
 * Every rule needs a real signal, not a single common word: for money that is a currency amount
 * or a buying verb used as a verb with something being bought ("buy the stock photo", "pay for
 * the plan"), never a bare "order", "charge", "pay" or "invoice" ("in order to", "in charge of",
 * "pay attention", "the invoice template"). When a sentence is truly unclear the rules still lean
 * toward asking a person. See DECISIONS.md (the limits safety net) and tests/limits.test.ts.
 */

/** Words before a bare verb that show it is used as a verb (an instruction, a question, a plan). */
const VERB_LEAD =
  String.raw`(?:^|[,:;(\-–—]\s*|\b(?:and|or|then|also|please|pls|to|i|we|you|they|he|she|it|will|would|can|could|should|shall|may|might|must|let's|lets|i'll|we'll|you'll|they'll|i'd|we'd|just|now|first|next|finally|later|today|tomorrow|quickly|directly|personally|already|immediately|asap|go ahead and|okay to|ok to|fine to|allowed to|need to|want to|plan to|going to|have to|has to|got to|needs to|wants to|try to|trying to|then go)\s+)`;

/**
 * Words that make the next word a noun ("the email", "our order", "three emails") or the object
 * of writing work ("draft emails to customers"), so it is not something being done.
 */
const NOUN_LEAD =
  /\b(?:the|a|an|this|that|these|those|our|your|my|their|his|her|its|each|every|any|no|new|welcome|launch|follow-up|marketing|sample|test|short|long|one|another|same|whole|two|three|four|five|six|several|many|few|some|more|\d+|draft|drafting|write|writing|prepare|preparing|review|reviewing|edit|editing|proofread|polish|create|creating|outline|compose|composing|summari[sz]e|read|reading|check|checking|test|testing|improve|shorten|rewrite|rewriting|translate|personali[sz]e|tidy|organi[sz]e|sort|tag|label|archive|count|track|log|list|collect|gather|find)\s+$/i;

/** "was published": checking something that already happened, not an instruction to do it. */
const PASSIVE_LEAD = /\b(?:was|were)\s+$/i;

/** Irregular past forms read as verbs, like "emailed" does. */
const IRREGULAR_PAST = /^(?:sent|told|gave|wrote|met|spoke|bought|paid|spent|got|put|shared|hit|left|made|took|ran|shot|rang)$/;

/** A name at the start of a sentence, addressing an agent: "Ada email the client". */
const ADDRESSEE_LEAD = /^\s*[A-Z][\w'-]*\s+$/;

/** "don't", "never", "without" right before the verb: the sentence forbids the act. */
const NEGATION_LEAD = /\b(?:don't|dont|do not|does not|doesn't|never|not|without|avoid|no|won't|shouldn't|should not|must not|mustn't|refrain from|stop|instead of)\s+(?:ever\s+|yet\s+|actually\s+)?$/i;

const DET = String.raw`(?:the|a|an|our|your|my|their|its|this|that|these|those|some|any|all|every|each|another|more|new|extra|additional|two|three|four|five|ten|\d+)`;

interface Rule {
  label: string;
  /** The first word of the label, used to find the room's own wording for the same limit. */
  key: string;
  signals: Signal[];
}

/**
 * A signal is a pattern plus, for verbs that are also everyday nouns, a check that the match is
 * used as a verb (`verbLead`: a bare form must follow an instruction-like lead) and is not negated.
 */
interface Signal {
  re: RegExp;
  /** For a pattern that starts with a word that is also a noun: require a verb-like position. */
  needsVerbLead?: boolean;
  /** Skip the match when it is forbidden ("don't email the client"). Default true. */
  negatable?: boolean;
}

function sig(pattern: string, opts: { verb?: boolean; negatable?: boolean } = {}): Signal {
  return { re: new RegExp(pattern, 'gi'), needsVerbLead: opts.verb ?? false, negatable: opts.negatable ?? true };
}

// ------------------------------------------------------------------------------------------------
// Money
// ------------------------------------------------------------------------------------------------

const AMOUNT = String.raw`(?:[$€£]\s?\d|\b(?:usd|eur|gbp|cad|aud|us\$)\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m)?\s?(?:usd|dollars?|bucks|euros?|eur|gbp|quid|pounds sterling)\b)`;
const AMOUNT_RE = new RegExp(AMOUNT, 'gi');
/** An amount that is a rate in a price list ("$29/month", "$9 per seat"). */
const RATE_RE = new RegExp(AMOUNT + String.raw`[\d,.]*\s?(?:k|m)?\s?(?:\/|per\s+|a\s+|an\s+|each\s+)\s?(?:mo|month|months|yr|year|annum|seat|user|member|licen[cs]e|head|week|wk|day)\b`, 'gi');
const PRICE_COPY_WORDS = /\b(?:pric(?:e|es|ing)|tiers?|plans?|table|page|copy|list|competitors?|comparison|compare|draft|write|rewrite|headline|section)\b/i;
const ANY_BUYING_WORD =
  /\b(?:buy|buys|buying|bought|purchas\w*|pay|pays|paying|paid|spen[dt]\w*|subscrib\w*|sign(?:ing)?\s+up|upgrad\w*|renew\w*|order\w*|check\s*out|charg\w*|book\w*|hire|hiring|rent\w*|donat\w*|invest\w*|transfer\w*|wire)\b/i;

const PURCHASABLE = String.raw`(?:business\s+cards?|cards|stickers|swag|merch(?:andise)?|t-?shirts?|shirts|mugs|hoodies|prints?|printing|posters?|flyers?|banners?|samples?|supplies|equipment|hardware|laptops?|monitors?|licen[cs]es?|seats?|credits?|domains?|food|lunch|dinner|coffee|pizza|catering|tickets?|copies|units|inventory|stock|materials?|parts|ads?|photos?|images?|software|subscriptions?|tools?)`;

const MONEY: Rule = {
  label: 'spending money',
  key: 'spending',
  signals: [
    // buy / purchase used as a verb with something to buy
    sig(
      String.raw`\b(?:buy|buys|buying|bought|purchase|purchases|purchasing|purchased)\b(?!\s*-\s*in\b|\s+in\b|\s+into\b|\s+(?:us\s+)?time\b|\s+(?:flow|funnel|page|button|history|journey|intent|path|process|decision|guide|experience|habits?|behaviou?r|patterns?|signals?|committee|power|cycle|criteria|personas?|confirmation|receipt|step|screen|form|cta|link|now\b|price|order|journey)s?\b)`,
      { verb: true },
    ),
    sig(String.raw`\b(?:complete|completing|make|making|finali[sz]e|approve|approving|confirm|confirming)\s+(?:the|a|this|our)\s+purchase\b`),
    // pay, but not "pay attention", "pay off", "paid plan"
    sig(
      String.raw`\b(?:pay|pays|paying|paid)\s+(?!attention\b|close\s+attention|careful|special\s+attention|off\b|respects?\b|tribute\b|homage\b|it\s+forward\b|a\s+visit\b|heed\b|lip\s+service\b|dividends\b)(?:for\b|to\b|the\b|a\b|an\b|our\b|their\b|them\b|him\b|her\b|us\b|up\b|out\b|upfront\b|in\s+advance\b|\d|[$€£]|invoices?\b|bills?\b|fees?\b|vendors?\b|suppliers?\b|contractors?\b|freelancers?\b|deposits?\b|subscriptions?\b|it\b|this\b|that\b|someone\b|anyone\b|everyone\b|extra\b|more\b)`,
      { verb: true },
    ),
    // spend money (not "spend time")
    sig(
      String.raw`\bspen(?:d|ds|ding|t)\s+(?:up\s+to\s+|about\s+|around\s+|roughly\s+|at\s+most\s+|less\s+than\s+|no\s+more\s+than\s+|more\s+than\s+|over\s+|under\s+)?(?:more\s+|less\s+|extra\s+|any\s+|some\s+|the\s+|our\s+|my\s+|a\s+(?:few|bit|little)\s+)?(?:[$€£]|\d|money|cash|budget|funds?\b|on\b|credits?\b|dollars|euros)`,
      { verb: true },
    ),
    // subscribe to something that costs (not a newsletter or a channel)
    sig(
      String.raw`\bsubscrib(?:e|es|ing|ed)\s+(?:us\s+|me\s+)?(?:to|for)\s+(?!(?:(?:the|our|their|a|an|your|my)\s+)?(?:newsletter|mailing\s+list|updates|notifications|alerts|topic|channel|feed|rss|blog|podcast|calendar|thread|ntfy|room)\b)`,
      { verb: true },
    ),
    // upgrade to a paid plan
    sig(
      String.raw`\bupgrad(?:e|es|ing|ed)\s+(?:to\s+|our\s+|the\s+|my\s+|your\s+|their\s+|a\s+)*(?:[\w-]+\s+)?(?:paid|pro|premium|business|team|enterprise|plus|plan|tier|account|subscription|licen[cs]es?|seats?|workspace)\b`,
      { verb: true },
    ),
    sig(String.raw`\b(?:use|switch\s+to|move\s+to|get|buy|try|go\s+with)\s+(?:the\s+)?(?:paid|pro|premium)\s+(?:version|plan|tier|account|edition)\b`),
    // place an order; order something to buy
    sig(
      String.raw`\b(?:place|placing|placed|put\s+in|submit|submitting)\s+(?:an?\s+|the\s+|our\s+|another\s+|a\s+new\s+|a\s+bulk\s+)?(?:[\w-]+\s+)?orders?\b(?!\s+(?:of|form|page|confirmation|flow|status|history|number|summary|email|details|field|template|in\s+which)\b)`,
    ),
    sig(String.raw`\b(?:order|orders|ordering|ordered|re-?order)\s+(?:(?:a|an|some|more|new|extra|another|\d+)\s+(?:[\w-]+\s+){0,2}?|(?:the|our|those|these)\s+(?:[\w-]+\s+){0,2}?(?=${PURCHASABLE}\b))`, { verb: true }),
    sig(String.raw`\b(?:order|ordering)\s+(?:it|them|this|that|these|those)?\s*(?:from|on|through|via)\s+(?!top\b|the\s+top\b|bottom\b|left\b|right\b|first\b|newest\b|oldest\b|most\b|least\b|highest\b|lowest\b|a\s+to\s+z\b)`, { verb: true }),
    // charge a card or a client
    sig(
      String.raw`\bcharg(?:e|es|ed|ing)\s+(?:it\s+|that\s+|this\s+|them\s+)?(?:to\s+|on\s+)?(?:the\s+|our\s+|a\s+|my\s+|their\s+|his\s+|her\s+)?(?:company\s+|corporate\s+|business\s+|credit\s+|debit\s+)?(?:cards?|accounts?|clients?|customers?|company|them|us|him|her|\d|[$€£])`,
    ),
    // invoices: issuing, sending or paying one (not the template)
    sig(String.raw`\binvoic(?:e|es|ed|ing)\s+(?:the|our|a|an|this|that|them|him|her|every|each|all)\s+(?:[\w-]+\s+)?(?:clients?|customers?|vendors?|company|companies|partners?|accounts?)\b`),
    sig(
      String.raw`\b(?:send|sending|sent|issue|issuing|raise|raising|submit|submitting|approve|approving|settle|settling|process|processing)\s+(?:the\s+|an?\s+|our\s+|this\s+|that\s+|all\s+)?(?:[\w-]+\s+)?invoices?\b(?!\s+(?:template|wording|copy|layout|design|format|draft|example|sample|fields?|page)s?\b)`,
    ),
    // cards
    sig(String.raw`\b(?:use|using|put|putting|enter|entering|add|adding|charge|charging|on)\s+(?:it\s+|this\s+|that\s+|them\s+)?(?:on\s+|to\s+)?(?:the\s+|our\s+|my\s+|a\s+|your\s+|their\s+)?(?:company\s+|corporate\s+|business\s+)?(?:credit|debit|company|corporate)\s+card\b`),
    sig(String.raw`\b(?:complete|completing|finish|finishing|go\s+through)\s+(?:the\s+|a\s+)?check[- ]?out\b(?!\s+(?:flow|page|copy|form|design|tests?)\b)`),
    // ads that cost money
    sig(
      String.raw`\b(?:run|running|launch|launching|start|starting|boost|boosting|buy|buying|place|placing|book|booking|turn\s+on|set\s+up|setting\s+up|create|creating|publish|publishing)\s+(?:a\s+|an\s+|some\s+|the\s+|our\s+|more\s+|new\s+)?(?:[\w-]+\s+){0,2}?(?:ads|adverts?|advertisements?|advertising|ad\s+campaigns?|ad\s+sets?|sponsored\s+(?:posts?|content|ads?)|paid\s+(?:campaigns?|promotions?|posts?|ads?|social|search|media)|promoted\s+(?:posts?|tweets?))\b(?!\s+(?:brief|copy|plan|ideas?|draft|outline|mock-?ups?|concepts?|creative|headlines?|text|strategy|proposal)s?\b)`,
      { verb: true },
    ),
    sig(String.raw`\bboost(?:ing|ed)?\s+(?:the|this|that|our|a)\s+(?:[\w-]+\s+)?(?:post|tweet|video|reel)\b`, { verb: true }),
    // budgets
    sig(String.raw`\b(?:use|using|spend|spending|allocate|allocating|commit|committing|approve|approving|increase|increasing|raise|raising|double|doubling|triple|top\s+up|release|unlock|exceed|go\s+over)\s+(?:the\s+|our\s+|a\s+|more\s+|some\s+|extra\s+|any\s+)?(?:[\w-]+\s+)?budget\b`),
    sig(String.raw`\b(?:increase|increasing|raise|raising|double|doubling|triple|boost|set|bump)\s+(?:the\s+|our\s+)?(?:daily\s+|monthly\s+|weekly\s+)?(?:ad\s+|marketing\s+|media\s+)?spend\b`),
    // hiring, booking, renting, renewing, signing up, trials
    sig(
      String.raw`\b(?:hire|hiring|hired|retain|retaining|commission|commissioning|engage|engaging)\s+(?:a\s+|an\s+|the\s+|some\s+|another\s+|two\s+|three\s+|\d+\s+)?(?:[\w-]+\s+)?(?:freelancers?|contractors?|agency|agencies|designers?|developers?|consultants?|photographers?|copywriters?|writers?|editors?|illustrators?|translators?|virtual\s+assistants?|firm|studio|lawyer|accountant)\b`,
      { verb: true },
    ),
    sig(
      String.raw`\b(?:book|booking|booked|reserve|reserving|reserved|rent|renting|rented|lease|leasing|leased)\s+(?:a\s+|an\s+|the\s+|some\s+|our\s+)?(?:[\w-]+\s+)?(?:flights?|hotels?|venues?|booth|stand|space|car|van|equipment|tickets?|seats?|domains?|servers?|studio|photographer|caterers?|catering)\b`,
      { verb: true },
    ),
    sig(String.raw`\bregister(?:s|ed|ing)?\s+(?:a\s+|an\s+|the\s+|our\s+|new\s+)?(?:[\w.-]+\s+)?domains?\b`),
    sig(String.raw`\brenew(?:s|ed|ing|al)?\s+(?:of\s+)?(?:the\s+|our\s+|a\s+|my\s+)?(?:[\w-]+\s+)?(?:subscriptions?|plan|licen[cs]es?|domains?|contract|membership|seats?|account|hosting)\b`),
    sig(String.raw`\bsign(?:s|ing|ed)?\s+(?:us\s+|me\s+|them\s+)?up\s+for\s+(?:a\s+|an\s+|the\s+|our\s+)?(?:[\w-]+\s+){0,2}?(?:paid|pro|premium|plan|subscription|trial|licen[cs]e|membership|tier|seats?)\b`),
    sig(String.raw`\b(?:start|starting|begin|beginning|activate|activating)\s+(?:a\s+|an\s+|the\s+|our\s+)?(?:free\s+)?(?:[\w-]+\s+)?trial\b`, { verb: true }),
    // donating, sponsoring, investing, moving money
    sig(String.raw`\bdonat(?:e|es|ed|ing)\b`, { verb: true }),
    sig(String.raw`\bsponsor(?:s|ed|ing)?\s+(?:a|an|the|our|this|that)\b`, { verb: true }),
    sig(String.raw`\binvest(?:s|ed|ing)?\s+(?:in|into)\s+(?!(?:\w+\s+)?(?:time|effort|energy|learning|ourselves|people|relationships)\b)`, { verb: true }),
    sig(String.raw`\b(?:transfer|transferring|wire|wiring|send|sending|move|moving)\s+(?:the\s+|some\s+|our\s+)?(?:money|funds|cash|payments?|deposits?)\b`),
    sig(String.raw`\b(?:wire|bank)\s+transfer\b`),
    sig(String.raw`\breimburs\w*`),
    sig(String.raw`\bexpens(?:e|ing)\s+(?:it|this|that|them)\b`),
    sig(String.raw`\b(?:costs?|costing)\s+(?:us\s+)?(?:money|anything|extra)\b`),
    sig(String.raw`\b(?:get|getting|obtain|obtaining|acquire|acquiring)\s+(?:a\s+|an\s+|the\s+|our\s+|more\s+|extra\s+|another\s+|\d+\s+)?(?:[\w-]+\s+)?(?:licen[cs]es?|seats?|credits?|paid\s+\w+)\b`, { verb: true }),
  ],
};

/** A currency amount counts, except a price list's rates being written as copy. */
function hasMoneyAmount(sentence: string): boolean {
  const amounts = sentence.match(AMOUNT_RE);
  if (!amounts) return false;
  const withoutRates = sentence.replace(RATE_RE, ' ');
  if (withoutRates.match(AMOUNT_RE)) return true;
  // Only rates like "$29/month": price copy, unless anything in the sentence buys.
  return !(PRICE_COPY_WORDS.test(sentence) && !ANY_BUYING_WORD.test(sentence));
}

// ------------------------------------------------------------------------------------------------
// Contacting people outside the team
// ------------------------------------------------------------------------------------------------

/** People outside the team. A word followed by a noun it describes ("customer quotes") is not one. */
const OUTSIDER_NOUN = String.raw`(?:customers?|clients?|vendors?|suppliers?|press|journalists?|reporters?|media|investors?|vcs?|prospects?|leads|influencers?|users|subscribers|beta\s+testers|testers|candidates?|applicants?|recruiters?|agenc(?:y|ies)|freelancers?|contractors?|partners?|sponsors?|donors?|landlord|bank|support|founders?|advisors?|hiring\s+managers?|followers|community|public|outsiders?|strangers?|third[- ]part(?:y|ies)|mailing\s+list|everyone\s+on\s+(?:the|our)\s+(?:list|mailing\s+list))`;
const NOT_PEOPLE_AFTER = String.raw`(?!\s+(?:quotes?|lists?|pages?|stor(?:y|ies)|feedback|data|success|segments?|personas?|journeys?|names?|logos?|testimonials?|reviews?|interviews?|research|insights?|counts?|base|sections?|portals?|logins?|faqs?|tiers?|copy|decks?|kits?|e-?mails?|surveys?|docs?|notes|questions|needs|pain\s+points|problems|use\s+cases|onboarding|retention|churn|database|records|accounts?|profiles?|types|examples|comments|ratings|numbers|metrics|growth|acquisition|release|team\s+(?:page|bio)|plan|tickets?|articles?|policy|center|pricing|section|template|matrix|map|calls?\s+notes)\b)`;
const OUTSIDER = String.raw`(?:(?:the|our|a|an|any|all|every|some|those|these|potential|new|existing|current|prospective|paying|beta|key|top|early|loyal|past|former|target|local|interested|\d+|ten|five|three|two|external|outside|a\s+few|several|each|most|many|other|their|your|my|[a-z-]+(?:est|ing|ful|ive|ic|al|ent|ant))\s+){0,3}${OUTSIDER_NOUN}\b(?:'s|s')?${NOT_PEOPLE_AFTER}`;
const PHRASE_OUTSIDE = String.raw`(?:someone|anyone|people|everyone|anybody|somebody)\s+outside(?:\s+(?:the|our)\s+(?:team|company|project))?|outside\s+(?:the|our)\s+(?:team|company)|external\s+(?:people|contacts|parties|partners|stakeholders)`;

const CONTACT_VERB = String.raw`(?:e-?mail(?:s|ed|ing)?|mail(?:s|ed|ing)?|message(?:s|d)?|messaging|dm(?:s|ed|ing)?|text(?:s|ed|ing)?|call(?:s|ed|ing)?|phone(?:s|d)?|phoning|ring(?:s|ing)?|ping(?:s|ed|ing)?|contact(?:s|ed|ing)?|cc(?:'d|ed)?|bcc|invite(?:s|d)?|inviting|pitch(?:es|ed|ing)?|interview(?:s|ed|ing)?|survey(?:s|ed|ing)?|poll(?:s|ed|ing)?|ask(?:s|ed|ing)?|tell(?:s|ing)?|told|notify|notifies|notified|notifying|inform(?:s|ed|ing)?|update(?:s|d)?|updating|remind(?:s|ed|ing)?|thank(?:s|ed|ing)?|nudge(?:s|d)?|nudging|cold[- ]e-?mail(?:s|ed|ing)?|cold[- ]call(?:s|ed|ing)?|loop\s+in|introduce(?:s|d)?|introducing)`;

const CONTACT: Rule = {
  label: 'contacting anyone outside the team',
  key: 'contacting',
  signals: [
    // email the client, call our vendor, ask customers
    sig(String.raw`\b${CONTACT_VERB}\s+(?:out\s+to\s+)?(?:back\s+)?${OUTSIDER}`, { verb: true }),
    sig(String.raw`\b${CONTACT_VERB}\s+(?:out\s+to\s+)?(?:back\s+)?(?:${PHRASE_OUTSIDE})`, { verb: true }),
    // email the draft to the client; send it to customers; share it with investors
    sig(
      String.raw`\b(?:${CONTACT_VERB}|send|sends|sending|sent|forward(?:s|ed|ing)?|share(?:s|d)?|sharing|show(?:s|ed|ing)?|give|gives|gave|hand|deliver(?:s|ed|ing)?|submit(?:s|ted|ting)?|present(?:s|ed|ing)?|reply|replies|replied|respond(?:s|ed|ing)?)\b(?:\s+(?!to\b|with\b)[\w'’$-]+){0,8}?\s+(?:to|with|cc)\s+(?:${OUTSIDER}|${PHRASE_OUTSIDE})`,
      { verb: true },
    ),
    // reach out to, get in touch with, follow up with, reply to, talk to, meet with
    sig(String.raw`\b(?:reach(?:es|ed|ing)?\s+out\s+to|get(?:s|ting)?\s+in\s+touch\s+with|got\s+in\s+touch\s+with|follow(?:s|ed|ing)?\s+up\s+with|repl(?:y|ies|ied|ying)\s+to|respond(?:s|ed|ing)?\s+to|talk(?:s|ed|ing)?\s+(?:to|with)|speak(?:s|ing)?\s+(?:to|with)|spoke\s+(?:to|with)|meet(?:s|ing)?\s+(?:with\s+)?|met\s+(?:with\s+)?|write\s+to|wrote\s+to|connect(?:s|ed|ing)?\s+with|chat(?:s|ted|ting)?\s+with|negotiate(?:s|d)?\s+with|negotiating\s+with)\s+(?:${OUTSIDER}|${PHRASE_OUTSIDE})`, { verb: true }),
    sig(String.raw`\b(?:set\s+up|setting\s+up|schedule|scheduling|book|booking|arrange|arranging|organi[sz]e|hop\s+on|jump\s+on|get\s+on)\s+(?:a\s+|an\s+|the\s+)?(?:[\w-]+\s+)?(?:call|meeting|demo|chat|interview|zoom|video\s+call)\s+with\s+(?:${OUTSIDER}|${PHRASE_OUTSIDE})`),
    // mass outreach
    sig(
      String.raw`\b(?:send|sending|sent|blast|blasting|schedule|scheduling|push|pushing|launch|launching)\s+(?:out\s+)?(?:the\s+|our\s+|a\s+|this\s+|an\s+)?(?:[\w-]+\s+)?(?:newsletter|email\s+blast|mass\s+email|e-?mail\s+campaign|drip\s+campaign|cold\s+(?:e-?mails?|outreach)|outreach\s+e-?mails?|announcement\s+e-?mail|launch\s+e-?mail|marketing\s+e-?mail|press\s+release)s?\b(?!\s+(?:draft|copy|template|outline|plan|ideas?)s?\b)`,
      { verb: true },
    ),
    sig(String.raw`\bcold[- ](?:e-?mail|call|outreach|dm)\w*`),
  ],
};

// ------------------------------------------------------------------------------------------------
// Deleting
// ------------------------------------------------------------------------------------------------

/** Pieces of text being edited: deleting these is editing a draft, not deleting anything. */
const TEXT_PART = String.raw`(?:(?:the|that|this|those|these|any|all|extra|duplicate|duplicated|unused|last|first|second|third|final|opening|closing|empty|stray|trailing|double|repeated|redundant|filler|old|two|three|\d+)\s+){0,3}(?:words?|sentences?|paragraphs?|lines?|commas?|periods?|full\s+stops?|typos?|spaces?|bullets?|bullet\s+points?|headings?|subheadings?|emojis?|phrases?|clauses?|characters?|letters?|filler|adjectives?|adverbs?|exclamation\s+(?:marks?|points?)|hyphens?|dashes?|placeholders?|lorem\s+ipsum|footnotes?|captions?|line\s+breaks?|blank\s+lines?|whitespace|taglines?|repetition|jargon|buzzwords?|intro|outro)\b`;
const FILE_THING = String.raw`(?:files?|folders?|director(?:y|ies)|repos?|repositor(?:y|ies)|branch(?:es)?|databases?|dbs?|tables?|records?|rows?|accounts?|users?|backups?|data|datasets?|drives?|channels?|workspaces?|projects?|rooms?|archives?|logs?|history|everything|all\s+of\s+it|docs?|documents?|drafts?|pages?|posts?|tweets?|e-?mails?|messages?|attachments?|assets?|uploads?|versions?|recordings?|videos?|photos?|images?|spreadsheets?|sheets?|decks?|notes|contacts?|subscribers?|list)`;

const DELETE: Rule = {
  label: 'deleting anything',
  key: 'deleting',
  signals: [
    sig(
      String.raw`\b(?:delete|deletes|deleting|deleted|erase|erases|erasing|erased|purge|purges|purging|purged|destroy|destroys|destroying|destroyed|shred|shredding|shredded|nuke|nuking|nuked|wipe|wipes|wiping|wiped)\b(?!\s+${TEXT_PART})(?!\s+(?:the\s+|a\s+|an\s+|that\s+|this\s+)?(?:["'\w-]+\s+){0,3}?from\s+(?:the|this|that|our|your)\s+(?:[\w-]+\s+)?(?:draft|doc|document|copy|headline|intro|outline|text|paragraph|sentence|section|slide|deck|bio|caption|subject\s+line|title|tagline|summary|homepage|landing\s+page|hero|header|footer|layout|design|mock-?up|email\s+draft)\b)`,
      { verb: true },
    ),
    sig(String.raw`\b(?:remove|removes|removing|removed|get\s+rid\s+of|getting\s+rid\s+of|trash|trashing|trashed|bin|binned|discard|discarding|discarded)\s+(?:(?:the|our|all|old|unused|those|these|any|stale|duplicate|every|each|outdated|previous|archived)\s+){0,3}(?:(?!from\b|to\b|in\b|on\b|of\b|with\b)[\w-]+\s+){0,2}?${FILE_THING}\b(?!\s+(?:section|heading|paragraph|copy|text|field|column|label|placeholder|template|wording|link|button|icon|tab|bullet|mention|reference|count)s?\b)(?!\s+(?:from|out\s+of)\s+(?:the|this|that|our)\s+(?:[\w-]+\s+)?(?:draft|doc|document|copy|outline|list|section|slide|deck|page|homepage|landing\s+page|hero|header|footer|layout|design|mock-?up|email\s+draft|post)\b)`, { verb: true }),
    sig(String.raw`\b(?:permanently|irreversibly|for\s+good)\s+(?:delete|remove|erase|destroy|wipe)\w*|\b(?:delete|remove|erase|destroy|wipe)\w*\s+(?:\w+\s+){0,3}?(?:permanently|for\s+good|irreversibly)\b`),
    sig(String.raw`\b(?:drop|dropping|truncate|truncating)\s+(?:the\s+)?(?:\w+\s+)?(?:tables?|databases?|db|collections?|schema|index)\b`),
    sig(String.raw`\b(?:clear|clearing|cleared|empty|emptying|emptied)\s+(?:out\s+)?(?:all\s+|the\s+|our\s+)?(?:\w+\s+)?(?:data|database|db|records|history|backups?|inbox|drive|folder|trash|recycle\s+bin|bin)\b(?!\s+(?:fields?|form|section|filters?|search|selection)\b)`, { verb: true }),
    sig(String.raw`\b(?:reset|resetting|wipe|wiping)\s+(?:the\s+|our\s+)?(?:\w+\s+)?(?:database|db|data|repo|repository|server|drive)\b`, { verb: true }),
    sig(String.raw`\boverwrit(?:e|es|ing|ten)\s+(?:the\s+|all\s+|our\s+|any\s+)?(?:\w+\s+)?(?:files?|backups?|database|data|folder|records)\b`),
    sig(String.raw`\b(?:close|closing|cancel|cancelling|canceling|terminate|terminating|deactivate|deactivating)\s+(?:the\s+|our\s+|my\s+|their\s+|this\s+)?(?:[\w-]+\s+)?accounts?\b(?!\s+(?:settings|page|form|copy|name|email|password|section|details|tab|screen|menu)\b)`, { verb: true }),
    sig(String.raw`\brm\s+-[a-z]*r[a-z]*f?\b|\bformat\s+(?:the\s+)?(?:drive|disk|hard\s+drive|laptop)\b`),
    sig(String.raw`\b(?:move|moving|put|putting|send|sending)\s+(?:\w+\s+){0,4}?to\s+(?:the\s+)?(?:trash|bin|recycle\s+bin)\b`),
  ],
};

// ------------------------------------------------------------------------------------------------
// Sharing outside the project (publishing included)
// ------------------------------------------------------------------------------------------------

const PUBLIC_PLACE = String.raw`(?:(?:our|the|a|my|his|her|their|your|company|public|official|personal)\s+){0,2}(?:linkedin|twitter|x\.com|x\b(?=\s|\.|$)|facebook|instagram|tiktok|threads|mastodon|bluesky|reddit|r\/\w+|hacker\s*news|product\s*hunt|youtube|medium|substack|github|blog|website|web\s*site|site|homepage|web|internet|social(?:\s+media)?|socials|forums?|discord|app\s+store|play\s+store|press|community|subreddit|pastebin|public\s+(?:channel|folder|repo|repository|page|link|drive))\b(?!\s+(?:drafts?|copy|outline|ideas?|plan|calendar|folder|docs?|documents?|templates?|mock-?ups?|strategy|brief|post\s+draft)\b)`;

const SHARE: Rule = {
  label: 'sharing anything outside the project',
  key: 'sharing',
  signals: [
    // post, publish, upload or share something on a public place
    sig(
      String.raw`\b(?:post|posts|posting|posted|publish|publishes|publishing|published|tweet|tweets|tweeting|tweeted|share|shares|sharing|shared|announce|announces|announcing|announced|upload|uploads|uploading|uploaded|put|puts|putting|submit|submits|submitting|submitted|cross-?post\w*|repost\w*|schedule|schedules|scheduling|scheduled|release|releases|releasing|released|go\s+live|push)\b(?:\s+(?!on\b|to\b|onto\b|in\b|at\b)[\w'’$-]+){0,8}?\s+(?:on|to|onto|in|at)\s+${PUBLIC_PLACE}`,
      { verb: true },
    ),
    // publish / go live without naming the place
    sig(String.raw`\b(?:publish|publishes|publishing|published)\b(?!\s+(?:button|date|time|settings?|step|queue|flow)\b)`, { verb: true }),
    sig(String.raw`\b(?:go|goes|going|went)\s+live\b|\bpush(?:es|ed|ing)?\s+(?:\w+\s+){0,3}?live\b|\bmake\s+(?:it|this|that|them|the\s+[\w-]+(?:\s+[\w-]+)?)\s+(?:live|public)\b|\blaunch(?:es|ed|ing)?\s+(?:the|our)\s+(?:[\w-]+\s+)?(?:site|website|landing\s+page|page|app|product)\b(?!\s+(?:copy|plan|checklist|brief|draft|email)\b)|\bdeploy\w*\s+(?:\w+\s+){0,3}?to\s+production\b`, { verb: true }),
    // share or send something with people outside
    sig(
      String.raw`\b(?:share|shares|sharing|shared|send|sends|sending|sent|forward|forwards|forwarding|forwarded|show|shows|showing|showed|give|gives|giving|gave|hand|handing|upload|uploads|uploading|uploaded|email|emails|emailing|emailed|leak|leaks|leaking|leaked|expose|exposing|disclose|disclosing|reveal|revealing)\b(?:\s+(?!with\b|to\b)[\w'’$-]+){0,8}?\s+(?:with|to)\s+(?:${PHRASE_OUTSIDE}|(?:the\s+)?(?:public|press)|(?:other|another|outside)\s+(?:compan(?:y|ies)|teams?|organi[sz]ations?)|competitors?|third[- ]part(?:y|ies)|anyone\s+(?:else|with\s+the\s+link))\b`,
      { verb: true },
    ),
    sig(String.raw`\b(?:share|shares|sharing|shared|post|posting|posted|send|sending|sent|upload|uploading|uploaded|release|releasing|released|publish\w*)\s+(?:\w+\s+){0,5}?(?:publicly|externally|outside\s+(?:the|our)\s+(?:team|company|project)|with\s+the\s+world)\b`, { verb: true }),
    sig(String.raw`\bmake\s+(?:the\s+|this\s+|that\s+|our\s+)?(?:[\w-]+\s+){0,2}?(?:public|world-readable|visible\s+to\s+(?:everyone|anyone|the\s+public))\b|\bpublic\s+link\b|\banyone\s+with\s+the\s+link\b|\bleak(?:s|ed|ing)?\s+(?:the|this|that|it|our|any|all)\b`),
    // giving outsiders access
    sig(String.raw`\b(?:give|gives|gave|giving|grant|grants|granted|granting)\s+${OUTSIDER}\s+(?:edit\s+|view\s+|read\s+|full\s+|admin\s+)?access\b`, { verb: true }),
  ],
};

const RULES: Rule[] = [MONEY, CONTACT, DELETE, SHARE];

/** Splits text into sentences, so a pattern never reaches across two of them. */
function sentences(text: string): string[] {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A short label in double quotes ("Buy now") is copy being written, not an action. */
function withoutShortQuotedLabels(sentence: string): string {
  return sentence.replace(/"([^"]{1,40})"/g, (whole, inner: string) => (inner.trim().split(/\s+/).length <= 4 ? ' "…" ' : whole));
}

const VERB_LEAD_RE = new RegExp(VERB_LEAD + '$', 'i');

function signalMatches(signal: Signal, sentence: string): boolean {
  signal.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = signal.re.exec(sentence))) {
    const before = sentence.slice(0, m.index);
    if (m[0].length === 0) signal.re.lastIndex++;
    if (signal.negatable !== false && NEGATION_LEAD.test(before)) continue;
    if (signal.needsVerbLead) {
      const word = m[0].toLowerCase().split(/\s+/)[0];
      // An inflected form ("emailed", "deleting", "buys") reads as a verb unless an article or
      // possessive makes it a noun; a bare form ("email", "order") must follow a verb-like lead.
      const bare = (!/(?:s|ed|ing|'d)$/.test(word) && !IRREGULAR_PAST.test(word)) || /^(?:press|process|business|access|address|this|cross|less|dress)$/.test(word);
      if (NOUN_LEAD.test(before)) continue;
      if ((/ed$/.test(word) || IRREGULAR_PAST.test(word)) && PASSIVE_LEAD.test(before)) continue;
      if (bare && !VERB_LEAD_RE.test(before) && !ADDRESSEE_LEAD.test(before)) continue;
    }
    return true;
  }
  return false;
}

function ruleMatches(rule: Rule, sentence: string): boolean {
  if (rule === MONEY && hasMoneyAmount(sentence)) return true;
  return rule.signals.some((s) => signalMatches(s, sentence));
}

/** Words that tie a room's own limit to one of the built-in rules above. */
const BUILT_IN_WORDS: Record<string, RegExp> = {
  spending: /\b(?:spend\w*|money|pay\w*|purchas\w*|buy\w*|cost\w*|budget)\b/i,
  contacting: /\b(?:contact\w*|e-?mail\w*|outside\s+the\s+team|reach\w*|messag\w*|call\w*)\b/i,
  deleting: /\b(?:delet\w*|remov\w*|eras\w*|destroy\w*)\b/i,
  sharing: /\b(?:shar\w*|publish\w*|post\w*\s+publicly|outside\s+the\s+project)\b/i,
};

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '');
}

/** Returns the limit the text appears to cross (e.g. "spending money"), or null. */
export function limitConcern(text: string, askFirst: string[]): string | null {
  const parts = sentences(text).map(withoutShortQuotedLabels);
  for (const rule of RULES) {
    if (parts.some((p) => ruleMatches(rule, p))) {
      // Prefer the room's own wording for the limit when one matches the rule.
      const own = askFirst.find((l) => BUILT_IN_WORDS[rule.key].test(l));
      return own ?? rule.label;
    }
  }
  // A room's own limits that the rules above don't cover: match when every key word appears
  // (as a whole word, any ending) in one sentence.
  for (const limit of askFirst) {
    if (Object.values(BUILT_IN_WORDS).some((re) => re.test(limit))) continue;
    const keyWords = limit
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4 && !['anything', 'anyone', 'outside', 'project', 'before', 'without', 'person'].includes(w))
      .map(stem);
    if (!keyWords.length) continue;
    if (parts.some((p) => keyWords.every((w) => new RegExp(String.raw`\b${w}\w*`, 'i').test(p)))) return limit;
  }
  return null;
}
