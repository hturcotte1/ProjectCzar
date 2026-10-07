import { swapWords, teammatesIn, type Clause, type Team } from './limits-text.js';

/**
 * The four default limits as rules over clauses (see limits-text.ts for how text becomes clauses).
 * Each rule has:
 *   strict   patterns trusted in any clause that is not negated, even work about something
 *            ("List the app on the Chrome Web Store" starts with a research word but is an act)
 *   loose    patterns that only count in a request or a statement, never inside drafting or
 *            research ("$29" in "Write the CTA: Buy now for $29" is copy)
 *   state    patterns for a finished act given as the goal ("the deposit is paid")
 * Patterns are written for lower-case text with wrapping already removed, so most start at the
 * head verb (^). Recipients and public places are shared building blocks below.
 */

export interface RuleContext {
  /** The room's people and agents (see teamOf in limits-text.ts); anyone else named is outside the team. */
  team: Team;
}

export interface Rule {
  label: string;
  /** The first word of the label, used to find the room's own wording for the same limit. */
  key: string;
  test(c: Clause, ctx: RuleContext): boolean;
}

/**
 * Every pattern the rules use, built once when this module loads. Nothing is ever built from the
 * text being checked or from anyone's name: names are swapped for fixed placeholders instead (see
 * "Names" below). Building patterns per text made each new name cost tens of milliseconds and kept
 * memory growing (DECISIONS.md item 50).
 */
const PATTERNS: RegExp[] = [];
function re(source: string, flags = ''): RegExp {
  const r = new RegExp(source, flags);
  PATTERNS.push(r);
  return r;
}
/** All patterns, for warming them up when the server starts and for tests. */
export function limitPatterns(): readonly RegExp[] {
  return PATTERNS;
}

// ------------------------------------------------------------------------------------------------
// Shared pieces
// ------------------------------------------------------------------------------------------------

const DET = String.raw`(?:the|a|an|our|your|my|their|his|her|its|this|that|these|those|all|every|each|some|any|both|another|other|several|a\s+few|few|many|more|new|\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)`;

/** People and organisations outside the team. */
const OUTSIDER_NOUN = String.raw`(?:(?:freelance|external|outside|third-party|agency)\s+[a-z][\w-]*|contract\s+(?:workers?|staff|designers?|developers?|writers?|editors?|engineers?|hires?)|sign-?ups|signups|registrants|trial\s+users|new\s+users|members|customers?|clients?|vendors?|suppliers?|press|journalists?|reporters?|media|editors?\s+at|investors?|vcs?|angels?|prospects?|leads?|influencers?|creators?|bloggers?|podcasters?|podcast\s+hosts?|hosts?|newsletter\s+writers?|users?|subscribers?|beta\s+testers?|testers?|beta\s+users?|early\s+adopters?|candidates?|applicants?|finalists?|recruiters?|headhunters?|references?|agenc(?:y|ies)|freelancers?|contractors?|consultants?|partners?|resellers?|distributors?|wholesalers?|retailers?|buyers?|decision-?makers?|sponsors?|donors?|landlords?|bank|insurers?|accountants?|bookkeepers?|lawyers?|attorneys?|legal\s+team|advisors?|advisers?|mentors?|founders?|ceos?|ctos?|cfos?|cmos?|coos?|hiring\s+managers?|account\s+managers?|customer\s+success\s+managers?|sales\s+reps?|reps?|maintainers?|moderators?|organi[sz]ers?|event\s+organi[sz]ers?|venue\s+managers?|venue|caterers?|photographers?|videographers?|printers?|print\s+shops?|designers?\s+at|followers|fans|audience|attendees|participants|commenters?|reviewers?\s+on|community\s+members?|community|public|outsiders?|strangers?|third[- ]part(?:y|ies)|support|support\s+team|helpdesk|sales\s+team|the\s+folks|folks|waitlist|wait\s+list|mailing\s+list|email\s+list|e-?mail\s+lists?|press\s+list|customer\s+list|customer\s+base|user\s+base|subscriber\s+list|prospect\s+list|leads?\s+list|contact\s+list|journalist\s+list)`;

/** Words that make the noun before them a thing, not a person: "customer quotes", "client library". */
const THING_AFTER = String.raw`(?:quotes?|lists?(?!\s+(?:about|that|we))|pages?|portal(?!\s+about)|stor(?:y|ies)|feedback|data|success\s+(?:stories|metrics)|segments?|personas?|journeys?|names?|logos?|testimonials?|reviews?|interviews?(?!\s+with)|research|insights?|counts?|base(?!\s+about)|sections?|logins?|faqs?|tiers?|copy|decks?|kits?|e-?mails?(?!\s+(?:about|today|now))|surveys?|docs?|documents?|notes|questions|needs|pain\s+points|problems|use\s+cases|onboarding|retention|churn|database|records?|accounts?(?!\s+(?:that|who))|profiles?|types?|examples|comments(?!\s+(?:on|under))|ratings|numbers|metrics|growth|acquisition|team\s+(?:page|bio)|plan|tickets?(?!\s+in)|articles?|policy|center|pricing|template|matrix|map|endpoint|endpoints|api|apis|service|services|sdk|library|libraries|package|packages|side|-side|table|schema|model|field|ids?|id\s+field|tracker|sheet|spreadsheet|macros|memo|proposal|scorecard|case\s+stud(?:y|ies)|program|programme|badges?|photos?|results|language|logic|code|module|component|object|class|record|portfolio|portfolios|details|info|information|address|addresses|phone\s+numbers?|contact\s+sheet|calls?\s+notes|requests?|messages|carousel|section|validation|cache|settings|dashboard|panel|app|portal|login|session|token|key|keys|events?|webhooks?|count|charter|guidelines|guide|playbook|resources|landing\s+page|website|site|newsletter\s+(?:draft|copy|template)|sequence\s+(?:draft|copy)|filter|segment|column|tag|label|button|form|flow|experience|journey|voice|language|objections|complaints|tickets\s+(?:queue)?|happiness|satisfaction|nps|testimonial|referrals?\s+program|discount\s+codes?|promo\s+codes?(?!\s+to)|managers?|roles?|positions?|benefits?|value|pain|problem|needs|story|stories|success|quote|wins?|outcomes?)`;

/** "Acme's marketing team", "the agency's designer": a person or group at an outside organisation. */
const ROLE_AFTER = String.raw`(?:'s|s'|')\s+(?:[\w-]+\s+){0,2}?(?:team|designer|developer|engineer|cto|ceo|cfo|cmo|coo|founder|owner|legal\s+team|legal|support|support\s+team|marketing\s+team|sales\s+team|people|staff|folks|reps?|contact|manager|lead|account\s+manager|buyer|head\s+of\s+\w+|director|vp|president|partner|editor|producer|host|assistant|recruiter|accountant|lawyer)\b`;

const MODIFIER = String.raw`(?:(?!(?:with|from|to|for|of|in|on|at|by|about|and|or|but|so|than|as|into|onto|over|under|out|up|off|down|back|whether|if|what|how|why|when|where|who|whom|that|which|whatever|re|is|are|was|were|said|qm+)\b)[\w'$-]+\s+)`;
const OUTSIDER = String.raw`(?:${MODIFIER}{0,4}?(?:[a-z]+-)?${OUTSIDER_NOUN}(?:${ROLE_AFTER}|(?:'s|s'|')?(?![\w'-])(?!(?:'s|s'|')?\s+${THING_AFTER}\b)))`;

/** "everyone who signed up", "the people on the waitlist", "anyone outside the team". */
const AUDIENCE = String.raw`(?:(?:(?:the|all\s+the|all|those|these)\s+)?(?:everyone|everybody|anyone|people|folks|those|users|customers)\s+(?:who|that|on\s+(?:the|our)\s+(?:waitlist|wait\s+list|list|mailing\s+list|email\s+list|beta)|from\s+(?:the|our)\s+(?:webinar|waitlist|trade\s+show|event|list)|at\s+\w+|outside)|(?:someone|anyone|people|everyone|anybody|somebody)\s+outside(?:\s+(?:the|our)\s+(?:team|company|project))?|outside\s+(?:the|our)\s+(?:team|company)|external\s+(?:people|contacts|parties|partners|stakeholders))`;

/** Known services and tools: a send to one of these is moving data, not talking to someone. */
const TOOL_NAMES = new Set(
  (
    'slack notion figma canva github gitlab google gmail drive docs sheets linkedin twitter x instagram facebook meta tiktok youtube vimeo reddit ' +
    'medium substack mailchimp hubspot salesforce stripe shopify zapier webflow wordpress vercel netlify heroku aws s3 rds azure gcp cloudflare ' +
    'sentry datadog grafana postgres redis kafka docker npm jira trello asana airtable zoom loom buffer hootsuite semrush ahrefs grammarly ' +
    'dropbox box chatgpt openai claude anthropic tempo lighthouse ga4 analytics excel word powerpoint keynote calendar outlook teams discord ' +
    'pastebin gist dev.to hashnode spotify twitch gumroad arxiv indeed wellfound producthunt hackernews intercom zendesk typeform calendly ' +
    'twilio sendgrid postmark segment mixpanel amplitude hotjar vistaprint stickermule fiverr upwork mondays fridays supabase gemini copilot ' +
    'expenses finance marketing sales legal design engineering product ops support'
  ).split(' '),
);
const NOT_NAMES = new Set(
  (
    'security finance legal marketing sales design engineering product ops support admin research operations general shared random ' +
    'nobody everyone someone anyone everybody somebody anybody nothing this that these those our their my your his her its there here who why how ' +
    'all each every some any no yes hi hey thanks also then now today tomorrow yesterday once if after before please can could would should will ' +
    "might must shall let let's ok okay draft write send upload done collect prepare summarise summarize read make give put turn " +
    'i monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ' +
    'q1 q2 q3 q4 ok okay faq cta api pr sso hr url pdf crm sow nda ux ui ai ceo cto cfo eod asap utc mt pt et gb tb kb mb usd eur gbp ' +
    'done when is it the a an we you they he she please also then and but so if once after before team room conductor'
  ).split(' '),
);

const EMAIL_ADDRESS = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

/** Capitalised names in the clause that are not on the team (people and companies outside). */
const PUBLIC_WORDS = new Set(
  'hacker news product hunt indie hackers slideshare chrome web store app play apple podcasts stack overflow show hn reddit gumroad arxiv wellfound indeed dev.to hashnode medium substack twitch spotify youtube vimeo instagram facebook tiktok linkedin twitter threads mastodon bluesky discord g2 capterra trustpilot pastebin gist github'.split(' '),
);

function outsideNames(c: Clause, ctx: RuleContext, humanVerb: boolean, includeFirst = false): string[] {
  const words = c.raw.replace(/[^\p{L}\p{N}_'@.&-]+/gu, ' ').trim().split(/\s+/);
  const mates = teammatesIn(c.raw, ctx.team);
  const out: string[] = [];
  words.forEach((w, i) => {
    const bare = w.replace(/'s$|'$/, '').replace(/[.]+$/, '');
    // An e-mail address is someone ("Email dana@acme.com the contract").
    if (EMAIL_ADDRESS.test(bare)) {
      out.push(bare.toLowerCase());
      return;
    }
    if (!/^\p{Lu}\p{Ll}/u.test(bare) && !/^\p{Lu}\p{Lu}?\p{Ll}+\p{Lu}/u.test(bare) && !/^\p{Lu}'\p{Lu}\p{Ll}/u.test(bare)) return;
    if (i === 0 && !includeFirst) return;
    if (PUBLIC_WORDS.has(bare.toLowerCase())) return;
    const lower = bare.toLowerCase();
    if (NOT_NAMES.has(lower) || mates.has(lower)) return;
    if (!humanVerb && TOOL_NAMES.has(lower)) return;
    out.push(lower);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Names
//
// A rule that asks "is this aimed at someone outside the team?" needs the names in the text. They
// are never written into a pattern. Instead each name is swapped, in a copy of the text, for a
// placeholder of the same length: "qnnnn" for a name outside the team, "qttttt" for an outside name
// that is also a known tool ("Slack"), "qfff" for a capitalised first word (counted only where a
// clause can start with the person: "Dana has been emailed"). Each such rule exists twice, built
// once: one version for plain words (run on the text), one for placeholders (run on the copy).
// Keeping the length keeps patterns that count characters ("within 60 characters") the same.
// ------------------------------------------------------------------------------------------------

/** The names in one clause, and copies of text with them swapped for placeholders. */
interface NameView {
  /** Any name outside the team (not counting a capitalised first word). */
  has: boolean;
  /** A capitalised first word that may be a name. */
  first: boolean;
  /**
   * Copies of `s` to try: one with every name swapped, and one per name with only that name
   * swapped. The second kind keeps every other word as written, so a name that is also a word a
   * rule needs ("Book a Zoom with Daniel Okafor", "Add Lena Fischer to the Newsletter", "Pitch it
   * to Inc.") still works as that word.
   */
  copies(s: string, withFirst: boolean): string[];
}

/** At most this many names get a copy of their own (each copy is a few pattern tests). */
const MAX_NAME_COPIES = 12;
const views = new WeakMap<Clause, NameView>();

function namesOf(c: Clause, ctx: RuleContext): NameView {
  const cached = views.get(c);
  if (cached) return cached;
  const human = outsideNames(c, ctx, true);
  const strict = new Set(outsideNames(c, ctx, false));
  const kinds = new Map<string, string>();
  for (const n of human) kinds.set(n, strict.has(n) ? 'n' : 't');
  const withFirst = new Map(kinds);
  for (const n of outsideNames(c, ctx, true, true)) if (!withFirst.has(n)) withFirst.set(n, 'f');
  const memo = new Map<string, string[]>();
  const view: NameView = {
    has: kinds.size > 0,
    first: withFirst.size > kinds.size,
    copies(s, first) {
      const key = (first ? '1' : '0') + s;
      let out = memo.get(key);
      if (out === undefined) {
        const all = first ? withFirst : kinds;
        out = [swapWords(s, all)];
        if (all.size > 1) {
          for (const [n, k] of [...all].slice(0, MAX_NAME_COPIES)) out.push(swapWords(s, new Map([[n, k]])));
        }
        out = [...new Set(out)];
        memo.set(key, out);
      }
      return out;
    },
  };
  views.set(c, view);
  return view;
}

/** A name in a rule: "Dana", "the Acme team", "Hollis & Co", "Northwind's CTO". */
const namePlaceholder = (tok: string) =>
  String.raw`(?:${DET}\s+)?${tok}(?:(?:\s+|\s*(?:,|&)\s*)${tok}){0,3}(?:\s*(?:&|and)\s*co\b\.?|\s+(?:inc|ltd|llc|gmbh|plc|co)\b\.?)?(?:${ROLE_AFTER}|(?:'s|s')?(?![\wÀ-ɏ]))`;
/** A teammate's own outside contacts: "Ada's lawyer", "Henry's accountant". */
const TEAMMATES_OUTSIDER = String.raw`(?:${DET}\s+)?qm+(?:'s|s'|')\s+(?:[\w-]+\s+)?(?:lawyers?|attorneys?|accountants?|bookkeepers?|bankers?|landlords?|doctors?|clients?|customers?|contacts?|investors?|partners?|friends?|family|wife|husband|mother|father|brother|sister|son|daughter|parents?|neighbou?rs?|boss|managers?|mentors?|colleagues?|co-?workers?|recruiters?|vendors?|suppliers?|contractors?|freelancers?|agents?|printers?|photographers?)\b`;
const OUTSIDE_NAME = 'q(?:n+|t+)';
const OUTSIDE_NAME_NOT_TOOL = 'qn+';
const OUTSIDE_NAME_OR_FIRST = 'q(?:n+|t+|f+)';

/**
 * Who a clause is aimed at, if anyone outside the team, in three flavours: "human" for verbs that
 * reach a person (a tool's name counts: "Message Zoom support"), "strict" for verbs that could
 * also move data (a tool's name does not count: "Send the export to Slack"), and "who" for goals
 * that start with the person ("Dana has been emailed").
 */
const SLOTS = {
  human: {
    words: String.raw`(?:${OUTSIDER}|${AUDIENCE}|${TEAMMATES_OUTSIDER})`,
    names: String.raw`(?:${namePlaceholder(OUTSIDE_NAME)}|(?:\w+\s+){0,2}(?:at|from)\s+${namePlaceholder(OUTSIDE_NAME)})`,
  },
  strict: {
    words: String.raw`(?:${OUTSIDER}|${AUDIENCE}|${TEAMMATES_OUTSIDER})`,
    names: String.raw`(?:${namePlaceholder(OUTSIDE_NAME_NOT_TOOL)}|(?:\w+\s+){0,2}(?:at|from)\s+${namePlaceholder(OUTSIDE_NAME)})`,
  },
  who: {
    words: String.raw`(?:${OUTSIDER}|${AUDIENCE}|${TEAMMATES_OUTSIDER}|every\s+(?:new\s+)?(?:customer|lead|user|subscriber|client|candidate)|each\s+(?:customer|lead|client|candidate))`,
    names: namePlaceholder(OUTSIDE_NAME_OR_FIRST),
  },
};

interface Pair {
  words: RegExp;
  names: RegExp;
  withFirst: boolean;
}
function pair(kind: keyof typeof SLOTS, build: (slot: string) => string): Pair {
  return { words: re(build(SLOTS[kind].words)), names: re(build(SLOTS[kind].names)), withFirst: kind === 'who' };
}
/** Does the rule match, with its slot filled by an outsider word or by a name outside the team? */
function seen(p: Pair, s: string, nv: NameView): boolean {
  if (p.words.test(s)) return true;
  if (!nv.has && !(p.withFirst && nv.first)) return false;
  return nv.copies(s, p.withFirst).some((copy) => p.names.test(copy));
}

const REACHED = String.raw`(?:e-?mailed|messaged|texted|called|phoned|notified|informed|contacted|told|invited|cc'd|briefed|pitched|pinged|reached|thanked|replied\s+to|sent\s+(?:the|an?|our)\b)`;
/** "posted for Henry", "shared with Sam": a teammate (as a placeholder) after "for" or "with". */
const FOR_TEAMMATE = /\b(?:for|with)\s+qm+(?![\w])/;

/** "to check", "to review": what the thing is for, not who gets it. */
const PURPOSE_VERB = /^(?:check|review|read|look|see|approve|sign|verify|compare|test|print|fill|edit|use|proofread|confirm|skim|study|keep|file|reconcile|audit|tidy|fix|update|finish|polish|help|consider|discuss|decide|choose|pick|vote|annotate|comment|translate|format|work)\b/;

function mentionsOutsider(text: string): boolean {
  return S1.test(text);
}

const PRONOUN_OBJ = String.raw`(?:it|them|him|her|this|that|these|those|the\s+(?:reply|email|message|update|deck|draft|note|answer|response|invite|invitation|quote|file|files|doc|pdf|link|news))`;

/** Places that are public, or outside the project's own tools. */
const PUBLIC_PLACE = String.raw`(?:(?:our|the|a|my|his|her|their|your|company|public|official|personal|main|new|community|open|[\w-]+'s)\s+){0,2}(?:dribbble|behance|pinterest|etsy|tumblr|flickr|portfolio\s+site|community(?:\s+(?:forum|discord|slack|page|group|board|server))?|linkedin|twitter|x(?=[\s.,;!?]|$)|facebook|fb|instagram|ig|tiktok|threads|mastodon|bluesky|reddit|r\/\w+|subreddit|hacker\s*news|hn|show\s+hn|product\s*hunt|indie\s*hackers|dev\.to|hashnode|medium|substack|youtube|vimeo|twitch|spotify|apple\s+podcasts|soundcloud|slideshare|scribd|gist|pastebin|stack\s*overflow|quora|discord|slack\s+community|community\s+forum|forums?|g2|capterra|trustpilot|blog|website|web\s*site|site|homepage|landing\s+page|careers\s+page|jobs?\s+page|status\s+page|chrome\s+web\s+store|app\s+store|play\s+store|gumroad|arxiv|indeed|wellfound|angellist|newswire|internet|web|social(?:\s+media)?|socials|chatgpt|(?:free\s+)?online\s+tool|third[- ]party\s+tool|tempo\.app|[\w-]+\.(?:com|app|io|ai|co|org|net|dev)(?!\w))`;
const NOT_PUBLIC_AFTER = String.raw`(?:settings|config|configuration|file|files|codebase|component|theme\s+file|resolution|design|designs|version\s+of|fonts?|form|forms|browser|developers?|dev|safe|friendly|ready|optimi[sz]ed|format|size|quality|traffic|visitors|growth|presence|strategy|captions?|drafts?|copy|outline|ideas?|plan|planning|calendar|folder|folders|docs?|documents?|templates?|mock-?ups?|strategy|brief|board|tracker|sheet|spreadsheet|analytics|numbers|stats|engagement|metrics|comments|account\s+settings|repo|repository|assets|kit|section|team|redesign|audit|migration|copy\s+deck|post\s+draft|preview|staging|changes|bug|error|issue|layout|work)`;
const PUBLIC = String.raw`${PUBLIC_PLACE}\b(?!\s+(?:[\w-]+\s+)?${NOT_PUBLIC_AFTER}\b)`;

/** Places inside the project: posting there is never sharing outside. */
const INTERNAL = /\bposted\s+here\b|\bhere\s+(?:for|in|so)\b|\b(?:posted|shared|put|left)\s+(?:here|for\s+(?:the\s+team|review|approval))\b|\b(?:in|to|into|on|with)\s+(?:the\s+|our\s+|this\s+)?(?:room|tempo(?!\.)|team|shared\s+drive|drive|shared\s+folder|folder|doc|shared\s+doc|draft|outline|deck|channel|thread\s+here|feed|playbook|internal\s+\w+|private\s+\w+|staging)\b(?!'s)|\bwith\s+(?:the\s+team|everyone\s+here|the\s+conductor|qm+(?!'s))\b/;
/** "Posted for Sam", "with Henry's notes": for a teammate, unless a public place is named too. */
const TEAMMATE_INTERNAL = /\b(?:(?:posted|shared|put|left)\s+for|with)\s+qm+\b/;

// ------------------------------------------------------------------------------------------------
// Money
// ------------------------------------------------------------------------------------------------

const NUM_WORD = String.raw`(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|a\s+few|a\s+couple(?:\s+of)?|several|hundred|thousand)`;
const AMOUNT = String.raw`(?:(?:[$€£¥₹₩₽₺₪฿₫₴₦]|\b(?:us|au|ca|nz|hk|s|r)\$)\s?\d|\d[\d.,]*\s?(?:k|m)?\s?[$€£¥₹]|\b(?:usd|eur|gbp|cad|aud|chf|jpy|inr|nzd|sek|nok|dkk|mxn|brl|sgd|hkd|cny|rmb|zar|pln|czk|huf|ils|aed)\s?\d|\b\d[\d.,]*\s?(?:k|m|bn)?\s?(?:usd|eur|gbp|cad|aud|chf|jpy|inr|nzd|sek|nok|dkk|mxn|brl|sgd|hkd|dollars?|bucks|euros?|pounds(?!\s+(?:of|heavier|lighter))|quid|rupees?|yen|francs?|kronor|krona|cents)\b|\b${NUM_WORD}(?:[\s-]+(?:hundred|thousand|grand))?\s+(?:dollars?|bucks|euros?|pounds|quid|grand|k)\b|\ba\s+grand\b|\b(?:a|one|two|three|five|ten)\s+hundred\b(?=\s*(?:\??$|,|;|\.|\s+(?:for|on|to)\b)))`;
const AMOUNT_RE = re(AMOUNT, 'g');
/** An amount given as a rate in a price list ("$29/month", "$9 per seat", "€15 monthly"). */
const RATE = String.raw`${AMOUNT}[\d.,]*\s?(?:k|m)?\s?(?:(?:\/|per\s+|a\s+|an\s+|each\s+)\s?(?:mo|month|months|yr|year|annum|seat|user|member|person|licen[cs]e|head|week|wk|day|message|sms|transaction|channel|workspace|order|booking|editor|creator|5\s+users)\b|(?:monthly|yearly|annually|one-time|lifetime)\b)`;
const RATE_RE = re(RATE, 'g');
/** With a rate, these still mean spending: "Allocate $30 a day to ads". */
const SPEND_CONTEXT = /\b(?:agree|accept|approve|sign|offer|salary|wage|retainer|fee|hire|budget|spend|spending|plan\s+for|put|throw|ads?|advertising|campaign|boost|pay|paying|buy|purchase|order|subscribe|upgrade|hire|book|approve|accept|charge|top\s+up|commit)\b/;
const CODE_CONTEXT = /\bas\s+the\s+(?:\w+\s+)?(?:name|argument|arg|parameter|param|value|variable|path|id)\b|\b(?:script|shell|bash|zsh|command|argument|arg|param|parameter|variable|env|cli|regex|placeholder|template\s+string|positional)\b/;
const TIME_UNIT = /^(?:hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|seconds?|secs?|sprints?|afternoons?|mornings?|evenings?|nights?|sessions?|pomodoros?)$/;

function hasAmount(text: string): boolean {
  const all = text.match(AMOUNT_RE);
  if (!all) return false;
  let rest = text;
  if (!SPEND_CONTEXT.test(text)) rest = rest.replace(RATE_RE, ' ');
  const left = rest.match(AMOUNT_RE);
  if (!left) return false;
  if (CODE_CONTEXT.test(text) && left.every((a) => /^\$\d$/.test(a.trim()))) return false;
  return true;
}

/** Goods and paid things you get, grab or pick up. */
const PAID_THING = String.raw`(?:plans?|tiers?|subscriptions?|licen[cs]es?|seats?|domains?|tickets?|passes|pass|memberships?|premium|pro|version\s+of|add-?ons?|upgrades?|template\s+packs?|stock\s+photos?|stock\s+images?|fonts?|themes?|plugins?|courses?|books?|copies|hardcover|paperback|gifts?|gift\s+cards?|flowers|wine|lunch|dinner|breakfast|coffee|pastries|pizza|food|snacks|drinks|catering|hardware|laptops?|monitors?|keyboards?|desks?|chairs?|equipment|supplies|paper|swag|merch|stickers|business\s+cards|cards|prints|posters?|flyers?|banners?|brochures?|mugs|t-?shirts?|hoodies?|samples|materials?|parts|credits|tokens|minutes|instances?|servers?|hosting|storage|bandwidth|space|booths?|tables?\s+at|rooms?|venue|hotel|flights?|trains?|taxi|uber|lyft|cab|car|van|projector|camera|microphones?|lights|annual\s+plan|monthly\s+plan|bundle|kit|ebook|e-?book|report\s+from|data\s+set|dataset|list\s+of\s+leads|leads\s+list|ads?|advert|placements?)`;
const PAID_THING_SKIP = String.raw`(?:key|keys|count|details?|info|information|number|numbers|id|ids|url|link|links|name|names|price|prices|pricing|cost|costs|quote|quotes|terms|page|pages|copy|text|screenshot|screenshots|logo|feedback|list(?!\s+of\s+leads)|credit\s+line|photo\s+credits?|image\s+credits?)`;

/** The object after a verb, up to the first preposition: "the annual Canva Pro plan for the team" gives "the annual canva pro plan". */
function objectAfter(text: string, verb: RegExp): string | null {
  const m = verb.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const cut = rest.search(/\s(?:from|for|to|on|in|at|with|by|before|after|so|because|while|if|when|that|which|who|and|or|but|instead|until|via|through|today|tomorrow|now|asap|this|next)\b|[,;!?]|\.(?=\s|$)/);
  return (cut >= 0 ? rest.slice(0, cut) : rest).trim();
}

function paidObject(obj: string | null): boolean {
  if (!obj) return false;
  if (S2.test(obj) && !S3.test(obj)) return false;
  if (S4.test(obj)) return false;
  return S5.test(obj) || S6.test(obj) || hasAmount(obj) || /\b(?:\d+|a\s+few|more|extra|another|two|three|five|ten)\s+(?:more\s+)?(?:[\w-]+\s+)?(?:seats?|licen[cs]es?|copies|credits)\b/.test(obj);
}

const TECH_THING = String.raw`(?:packages?|dependenc(?:y|ies)|deps|librar(?:y|ies)|lib|sdk|framework|service|services|module|parser|node|postgres|mysql|database|db|section|page|photos?|copy|deck|slides?|settings|docs|readme|workflow|scripts?|tests?|ci|runner|browser|os|firmware|schema|api|client|model|image|runtime|python|typescript|react|vite|eslint|compiler|toolchain|engine|component|components|cli|plugin\s+version|code|checklist|outline|onboarding\s+plan|launch\s+plan|project\s+plan|content\s+plan|test\s+plan|migration\s+plan|plan\s+parser|team\s+page|business\s+section|account\s+service|sso\s+module)`;

const GET_VERB = /^(?:get|grab|pick\s+up|snag|nab|score|obtain|secure|source|acquire|go\s+for)\b/;

const MONEY_STRICT: RegExp[] = [
  // buying
  /^(?:buy|buys|purchase|procure|pre-?order|preorder|bulk\s+(?:order|buy|purchase))\b(?!\s+(?:us\s+)?(?:some\s+)?(?:time|a\s+(?:few|couple\s+of)\s+(?:days|hours|weeks))\b|\s+in\b|\s+into\b)/,
  /^(?:order|orders)\b(?!.*\b(?:by|alphabetically|chronologically|numerically|from\s+(?:the\s+)?(?:\w+est|cheapest|newest|oldest|smallest|largest|highest|lowest|a|top|most|least)\s+to|in\s+(?:ascending|descending|reverse|the\s+right|the\s+same|which)|so\s+(?:that\s+)?(?:pricing|billing|the\s+\w+)\s+comes?|on\s+the\s+(?:slide|page|dashboard|board|list|sprint)|in\s+the\s+(?:table|list|doc|deck|report|gallery|comparison|sheet|outline|faq)|priority|importance|date|severity)\b)/,
  /^restock\b/,
  /^(?:re-?order|reorder)\b.{0,60}\bfrom\s+(?:the\s+|our\s+)?(?:usual\s+|regular\s+|same\s+)?(?:supplier|vendor|wholesaler|manufacturer|printer|distributor)\b/,
  /^(?:re-?order|reorder)\s+(?:the\s+|more\s+|some\s+)?(?:[\w-]+\s+){0,3}?(?:paper|supplies|stickers|cards|business\s+cards|ink|toner|coffee|stock|inventory|mugs|samples|labels|boxes|materials)\b/,
  GET_VERB,
  /^(?:place|put\s+in|submit)\s+(?:an?\s+|the\s+|our\s+|another\s+|a\s+new\s+|a\s+bulk\s+)?(?:[\w-]+\s+)?orders?\b(?!\s+(?:form|page|confirmation|flow|status|history|number|summary|email|details|field|template)\b)/,
  /^book\s+(?:a\s+|an\s+|the\s+|two\s+|\d+\s+)?(?:freelance\s+|contract\s+|local\s+|professional\s+)?(?:[\w-]+\s+)?(?:illustrators?|designers?|photographers?|videographers?|developers?|writers?|editors?|freelancers?|contractors?|consultants?|animators?|models?|actors?|presenters?|hosts?|speakers?|musicians?)\b/,
  /^(?:make|give|send|pledge)\s+(?:a\s+|an\s+|the\s+|our\s+)?(?:[\w$€£.,-]+\s+){0,2}?(?:donation|contribution|pledge|payment|deposit|bank\s+transfer|wire\s+transfer|gift\s+of)\b(?!\s+(?:events?|data|logs?|webhooks?|notifications?|records?|reminders?|details|info|confirmations?|receipts?|e-?mails?|links?|pages?|forms?|status|updates?|reports?|summar(?:y|ies)|schedules?|instructions|requests?|methods?|options?|flow|tests?|ids?))/,
  /^cover\s+(?:the\s+)?(?:[\w-]+\s+)?(?:pizza|lunch|dinner|breakfast|food|drinks|coffee|snacks|costs?|bill|tab|expenses?|fees?|deposit|travel|tickets?|hotel)\b/,
  /^(?:transfer|move|send|wire|withdraw|pay\s+out)\s+(?:the\s+|our\s+|all\s+)?(?:[\w-]+\s+)?(?:proceeds|revenue|donations|payouts?|earnings|balance|funds|money|takings|float|cash)\b/,
  /^(?:hire|commission)\b(?!\s+(?:date|plan|process|criteria|guide|checklist|rate|flow|page))/,
  /^(?:spin\s+up|provision|launch|start|add|scale\s+up|rent|order)\s+(?:a\s+|an\s+|the\s+|another\s+|\d+\s+|two\s+|more\s+|extra\s+)?(?:[\w-]+\s+){0,3}?(?:bigger|larger|more\s+powerful|extra|additional|dedicated|gpu|beefier|faster)\s+(?:[\w-]+\s+){0,2}?(?:instances?|servers?|machines?|nodes?|clusters?|gpus?|vms?|dynos?|databases?|boxes)\b/,
  /^(?:give|offer|issue|apply|grant|add|credit)\s+.{0,40}\b(?:\d+%\s+|[$€£]\d+\s+)?(?:credit|discount|rebate|refund|waiver|free\s+months?|comp)\b(?!\s+(?:card|line|score|check|limit|terms|policy|code\s+field))/,
  /^(?:waive|comp)\s+(?:the\s+|their\s+|his\s+|her\s+)?(?:[\w-]+\s+)?(?:fee|fees|charge|invoice|bill|subscription|setup)\b/,
  /^(?:process|approve|issue|handle|clear|action|push\s+through)\s+(?:the\s+|all\s+|any\s+)?(?:pending\s+|open\s+|outstanding\s+|queued\s+)?(?:[\w-]+\s+)?refunds?\b/,
  /^(?:hire|commission|retain|engage|contract|bring\s+on|bring\s+in|take\s+on)\s+(?:a\s+|an\s+|the\s+|some\s+|another\s+|two\s+|three\s+|\d+\s+)?(?:[\w-]+\s+){0,2}?(?:freelancers?|contractors?|agency|agencies|designers?|developers?|devs?|consultants?|photographers?|videographers?|copywriters?|writers?|editors?|illustrators?|artists?|translators?|virtual\s+assistants?|vas?|firm|studio|lawyers?|accountants?|bookkeepers?|someone|somebody|people|help|team|caterers?|printers?|voice\s+actors?|animators?|models?|recruiters?|interns?|temps?|staff)\b/,
  /^(?:book|reserve|rent|lease|lock\s+in|hold)\s+(?:a\s+|an\s+|the\s+|some\s+|our\s+|two\s+|\d+\s+)?(?:[\w'-]+\s+){0,3}?(?:flights?|technicians?|plumbers?|electricians?|cleaners?|movers?|couriers?|drivers?|tutors?|coaches?|trainers?|interpreters?|translators?|djs?|bands?|facilitators?|panels?|respondents|repair|service|services|hotels?|rooms?|venues?|booths?|stands?|tables?|space|spaces|desks?|car|cars|van|vans|uber|lyft|taxi|cab|train|bus|projector|camera|equipment|studio|photographer|caterers?|catering|tickets?|seats?|airbnb|apartment|coworking|day\s+pass|meeting\s+room|conference\s+room|stage|screen|microphones?|lights|truck)\b/,
  /^(?:sign\s+(?:us\s+|me\s+|them\s+|him\s+|her\s+|everyone\s+)?up\s+for|register\s+(?:us\s+|me\s+|them\s+)?for|enrol+\s+(?:us\s+|me\s+)?in|join)\s+(?:a\s+|an\s+|the\s+|our\s+)?(?:[\w'-]+\s+){0,3}?(?:plans?|tiers?|trials?|seats?|premium|pro|subscriptions?|memberships?|courses?|conferences?|workshops?|bootcamps?|programs?|summits?|webinars?\s+series|accounts?\s+on|team\s+plan)\b/,
  /^register\s+(?:a\s+|an\s+|the\s+|our\s+|new\s+|another\s+)*(?:[\w.-]+\s+)?(?:domains?\b(?!\s+(?:events?|models?|handlers?|logic|layer|objects?|entit(?:y|ies)))|[\w-]+\.(?:com|app|io|ai|co|net|org|dev)\b)/,
  /^subscribe\s+(?:us\s+|me\s+)?(?:to|for)\s+(?!(?:(?:the|our|their|a|an|your|my)\s+)?(?:[\w-]+\s+)?(?:newsletter|mailing\s+list|updates|notifications|alerts|events?|webhooks?|topics?|channel|feed|rss|blog|podcast|calendar|thread|stream|queue|changes|hooks?|room|repo|issue|order\s+events|messages)\b)/,
  /^upgrade\b(?!\s+(?:the\s+|our\s+|my\s+|its\s+)?(?:[\w-]+\s+){0,2}?(?:packages?|dependenc(?:y|ies)|deps|librar(?:y|ies)|lib|sdk|framework|service|module|parser|node|postgres|mysql|section|page|photos?|copy|deck|slides?|settings|docs|readme|workflow|scripts?|tests?|ci|runner|browser|os|firmware|schema|api|client|model|runtime|python|typescript|react|vite|eslint|compiler|toolchain|engine|components?|cli|checklist|outline|onboarding\s+plan|launch\s+plan|project\s+plan|content\s+plan|test\s+plan|migration\s+plan|plan\s+parser)\b)/,
  /^upgrade\b.{0,60}?\bto\s+(?:the\s+|a\s+|an\s+)?(?:next|higher|bigger|larger|paid|pro|premium|business|team|teams|enterprise|plus|growth|standard|advanced|unlimited|annual|yearly|monthly|top)\s+(?:[\w-]+\s+)?(?:plan|tier|edition|subscription|package|level|version)\b/,
  /^(?:switch|move|bump|migrate|put|downgrade|change|convert)\b.{0,60}?\b(?:up\s+)?(?:to|onto)\s+(?:the\s+|a\s+|an\s+)?(?:[\w-]+\s+){0,2}?(?:plan|tier|billing|edition|subscription|licen[cs]e|seats?|pricing\s+plan)\b/,
  /^(?:book|order|buy|hire|run|use|set\s+up|start|sign\s+up\s+for|add|enable|get|commission)\b.{0,50}\bpaid\b(?!\s+(?:[\w-]+\s+)?(?:report|copy|section|page|draft|analysis|summary|deck|doc|results))/,
  /^scale\s+.{0,40}\b(?:up|to)\b.{0,30}\b(?:instance|plan|tier|gb|tb|nodes?|servers?|cpus?|replicas?|larger|bigger|size|machine|dyno)\b/,
  /^(?:turn\s+on|enable|activate|switch\s+on|add|install|buy|get)\s+.{0,40}\b(?:paid|premium)\b(?!\s+(?:[\w-]+\s+)?(?:report|analysis|doc|summary|review|audit|copy|plan\s+section|section|page|deck|draft|research|study|metrics|data|results|column|tab))/,
  /^(?:turn\s+on|enable|activate|add|install|buy|get)\s+(?:the\s+|a\s+|an\s+)?(?:[\w-]+\s+){0,3}?add-?on\b/,
  /^renew\b/,
  /^(?:top\s+up|recharge|reload|refill)\b/,
  /^add\s+(?:[\w$€£.,-]+\s+){0,3}?(?:seats?|licen[cs]es?|credits|funds|money|balance)\b/,
  /^add\s+(?:a\s+|an\s+|another\s+|\d+\s+|two\s+|three\s+)?(?:more\s+)?(?:paid\s+)?(?:users?|members?)\s+to\s+(?:our|the)\s+(?:[\w-]+\s+)?(?:plan|subscription|account|workspace|licen[cs]e)\b/,
  /^(?:expense|reimburse)\b/,
  /^(?:refund|re-?fund)\b/,
  /^(?:issue|give|process|send|grant|approve|offer|do)\s+(?:the\s+|a\s+|an\s+|them\s+a\s+|the\s+customer\s+a\s+|him\s+a\s+|her\s+a\s+)?(?:full\s+|partial\s+)?refund/,
  /^pay\b(?!\s+(?:(?:a\s+lot\s+of|a\s+bit\s+more|more|less|extra|close|closer|special|careful|particular|the\s+same|equal|enough|some|no|little|much|full|any|more\s+careful|real|proper|serious)\s+)?(?:attention|heed|mind|respects?|tribute|homage|lip\s+service|dividends|a\s+visit|it\s+forward|off)\b|\s+it\s+no\s+mind)/,
  /^spend\s+(?:up\s+to\s+|about\s+|around\s+|roughly\s+|at\s+most\s+|less\s+than\s+|no\s+more\s+than\s+|more\s+than\s+|over\s+|under\s+)?(?:(?:more|less|extra|any|some|the|our|my|a\s+(?:few|bit|little))\s+)?(?:money|cash|budget|funds|credits|dollars|euros)\b/,
  /^charge\b(?!\s+(?:the\s+|my\s+|your\s+)?(?:battery|batteries|phone|laptop|device|cable))/,
  /^retry\s+.{0,30}\b(?:charges?|payments?|payouts?)\b/,
  /^(?:process|send|release|approve|schedule|run)\s+(?:the\s+)?(?:pending\s+|outstanding\s+)?(?:payouts?|payments?|payroll|transfers?|wires?)\b(?!\s+(?:events?|data|logs?|info|details|form|webhooks?|notifications?|records?|metrics|code|module|service|page|flow|tests?))/,
  /^(?:bill|invoice)\b(?!.*\b(?:template|layout|design|copy|wording|format|page)\b)/,
  /^(?:send|forward|submit|issue|raise|e-?mail)\s+(?:.{1,40}\s+)?(?:the\s+|an?\s+|our\s+|this\s+)?(?:[\w-]+\s+)?invoices?\b(?!\s+(?:template|wording|copy|layout|design|format|draft|example|sample|fields?|page)\b)/,
  /^(?:tip|donate|pledge|sponsor|fund|crowdfund)\b(?!\s+(?:list|page|copy|section|of)\b)/,
  /^back\s+(?!up\b)(?:the\s+|a\s+|our\s+)?(?:[\w-]+\s+){0,3}?(?:kickstarter|indiegogo|campaign|project|crowdfunding|fundraiser|patreon)\b/,
  /^invest\s+(?:[$€£\d]|money|cash|funds|(?:in|into)\s+(?:the\s+|a\s+|some\s+)?(?:stocks?|shares?|crypto|bitcoin|a\s+fund|fund|startups?|compan(?:y|ies)|the\s+round|bonds?|real\s+estate|ads|advertising|paid))/,
  /^(?:bid|place\s+(?:a\s+)?bids?)\b/,
  /^(?:put\s+down|pay|cover|send|make|leave|place|wire|transfer)\s+(?:a\s+|the\s+)?(?:[\w$€£.,-]+\s+){0,2}?deposits?\b/,
  /^(?:settle|settle\s+up)\b(?!\s+(?:on|the\s+(?:headline|debate|question|argument|design)))/,
  /^pick\s+up\s+the\s+(?:tab|bill|check|cheque)\b/,
  /^treat\s+.{1,40}\s+to\s+(?:lunch|dinner|drinks|coffee|a\s+meal|breakfast|a\s+gift)\b/,
  /^(?:send|get|buy|order|give)\s+(?:.{1,40}\s+)?(?:flowers|a\s+gift|gifts|a\s+bottle(?:\s+of\s+\w+)?|wine|champagne|a\s+hamper|chocolates|a\s+gift\s+card|gift\s+cards|swag\s+box|a\s+thank[- ]you\s+gift)\b/,
  /^(?:venmo|paypal|zelle|cash\s*app|revolut|wise)\b/,
  /^(?:wire|transfer|send|move|pay\s+out|remit)\s+(?:over\s+)?(?:[$€£]?\s?\d|(?:money|cash|funds)\b|the\s+(?:(?:money|funds|deposit|balance|fees?)\b|payments?\b(?!\s+(?:form|page|flow|code|module|service|events?|button|screen|processor|provider|api|integration|details|method|logic|webhook|data|tests?))))/,
  /^(?:run|set\s+up|launch|start|buy|place|book|turn\s+on|boost|put\s+up|create\s+and\s+run|kick\s+off)\s+(?:a\s+|an\s+|the\s+|our\s+|some\s+|more\s+|new\s+)?(?:[\w$€£\/.,-]+\s+){0,3}?(?:ads?|adverts?|advertisements?|advertising|ad\s+campaigns?|ad\s+sets?|sponsored\s+(?:posts?|content|ads?)|paid\s+(?:campaigns?|promotions?|posts?|ads?|social|search|media)|promoted\s+(?:posts?|tweets?)|google\s+ads|meta\s+ads)\b(?!\s+(?:brief|copy|plan|ideas?|draft|outline|mock-?ups?|concepts?|creative|headlines?|text|strategy|proposal|report)s?\b)/,
  /^boost\s+(?:the|this|that|our|a|it)\b(?:\s+[\w-]+){0,2}?\s*(?:post|tweet|video|reel|story|page|it)?\b/,
  /^promote\s+.{0,40}\b(?:with\s+(?:a\s+)?paid|paid\s+boost|ads?\b|budget)/,
  /^(?:put|throw|allocate|commit|add|move|spend|invest|plan\s+for|budget|earmark|set\s+aside|dedicate)\s+(?:(?:a|an|some|more|another|extra|the|our|small|big|little|bit|of|few|whole|\d[\d,.]*k?|[$€£][\d,.]+k?)\s+){0,4}?(?:budget|money|cash|funds|spend|[$€£]?\d[\d,.]*k?|ad\s+spend)(?:\s+(?:a|per|each|every)\s+(?:day|week|month))?\s+(?:behind|into|on|to|at|for|toward|towards)\b/,
  /^(?:increase|raise|bump|up|double|triple|boost|top\s+up|lift|grow|expand|use|spend|allocate|release|unlock|approve|commit|exceed|go\s+over|blow|add\s+to)\s+(?:the\s+|our\s+|a\s+|more\s+|some\s+|extra\s+|any\s+|this\s+month's\s+)?(?:daily\s+|weekly\s+|monthly\s+)?(?:(?!performance|error|time|token|bundle|size|latency|byte|memory|cpu|perf|frame|render)[\w-]+\s+){0,2}?budget\b(?!\s+(?:template|tab|numbers?|sheet|doc|section|line|heading|figures?|spreadsheet|summary|report|column|row|cell)\b)/,
  /^(?:increase|raise|bump|up|double|lift)\s+(?:the\s+|our\s+)?(?:[\w-]+\s+){0,2}?(?:spend|spending\s+(?:limit|cap)|ad\s+spend|bid|bids|credit\s+limit)\b/,
  /^(?:start|begin|activate|take|kick\s+off|open)\s+(?:a\s+|an\s+|the\s+|our\s+)?(?:[\w-]+\s+){0,3}?trial\b/,
  /^(?:approve|accept|sign|countersign|confirm|agree\s+to|green-?light|sign\s+off\s+on|go\s+with)\s+(?:the\s+|a\s+|an\s+|our\s+|their\s+|its\s+)?(?:[\w'-]+'s\s+)?(?:[\w$€£.,'-]+\s+){0,3}?(?:agreements?|msa|nda|fees?|rates?|prices?|pricing|quotes?|estimates?|(?:sub)?contracts?|sow|statement\s+of\s+work|proposals?|purchase\s+orders?|po|orders?|bookings?|purchases?|invoices?|expenses?|offers?|deals?|bids?|retainers?|budgets?|spend|payments?|renewals?|upgrades?|subscriptions?|reservations?|engagement\s+letter|terms)\b/,
  /^(?:accept|approve)\s+(?:the\s+|their\s+)?(?:[\w-]+\s+)?(?:[$€£]?\d[\d,.]*\s?[$€£]?\s+)?(?:quote|estimate)/,
  /^proceed\s+(?:the\s+|a\s+|an\s+|our\s+|my\s+|with\s+)?(?:(?!of\b)[\w'-]+\s+){0,2}?(?:purchase|order|booking|upgrade|renewal|refund|payment|deposit|subscription|sign-?up|reservation|hire|hiring|buy|bill|bills|tab|invoice|fees?|expense|hotel|hotels|flights?|accommodation|travel|venue|car\s+rental|rental|catering|tickets?|(?:annual|monthly|yearly|paid|pro|premium|business|team|enterprise|plus|standard|growth)\s+(?:plan|tier|version|licen[cs]e))\b(?!\s+(?:form|page|flow|copy|template|button|screen|email|confirmation|status|history|section))/,
  /^print\s+(?:\d|a\s+few|some|several|a\s+(?:batch|run)|more|extra|copies|\w+\s+(?:copies|flyers|posters|cards|banners|stickers))/,
  /^print\s+.{0,40}\b(?:at|from|with)\s+(?:the\s+)?(?:copy\s+shop|print\s+shop|printers?|printing\s+company|vistaprint|moo|stickermule|staples|fedex)\b/,
  /^(?:get|have)\s+.{1,50}?\s+(?:printed|catered|framed|shipped\s+(?:express|overnight))\b/,
  /^(?:get|have)\s+.{1,50}?\s+(?:made|designed|built|shot|filmed|edited|done|created|produced|written|translated|illustrated|animated|voiced|photographed)\s+(?:by|on|via|through|at)\s+(?:a\s+|an\s+|the\s+)?(?:[\w-]+\s+)?(?:fiverr|upwork|99designs|toptal|freelancers?|agency|contractors?|studio|professional|pro|print\s+shop|printer|vendor)\b/,
  /^(?:get|have)\s+.{1,40}?\s+(?:renewed|registered|booked|upgraded|bought|purchased|ordered|paid|reserved|catered)\b/,
  /\b(?:on|via|through|from|off)\s+(?:fiverr|upwork|99designs|toptal|taskrabbit|thumbtack)\b/,
  /^proceed\s+.{0,40}\bpurchase\b/,
  /^(?:click|hit|press|tap)\s+(?:buy|purchase|upgrade|subscribe|pay|order|checkout|check\s+out)\b/,
  /^(?:go\s+through|complete|finish|finali[sz]e)\s+(?:the\s+)?(?:check-?out|purchase|order|payment|booking|sign-?up\s+for\s+the\s+(?:paid|pro))\b(?!\s+(?:flow|page|copy|form|design|tests?|screen|step)\b)/,
  /^(?:use|put\s+(?:it|this|that|them)\s+on|charge\s+(?:it|this|that|them)\s+to|pay\s+with|enter|add)\s+(?:the\s+|our\s+|my\s+|a\s+|your\s+|their\s+)?(?:[\w'-]+\s+)?(?:credit\s+card|debit\s+card|company\s+card|corporate\s+card|card|visa|amex|mastercard|paypal\s+account)\b/,
  /^(?:put|charge|bill|expense)\s+.{1,50}?\s+(?:on|to)\s+(?:the\s+|my\s+|our\s+|a\s+)?(?:company\s+|corporate\s+|business\s+)?(?:credit\s+card|debit\s+card|card|amex|visa|mastercard|tab|expense\s+account)\b/,
  /^(?:raise|increase|bump|lift)\s+(?:our\s+|the\s+)?(?:[\w-]+\s+){0,3}?(?:spending|usage|credit|billing)\s+(?:limit|cap|quota)\b/,
  /^sign\s+(?:us\s+|me\s+)?up\s+(?:for\s+)?(?:a\s+|the\s+)?(?:[\w-]+\s+)?(?:paid|pro|premium|trial|plan|tier)\b/,
];

const MONEY_LOOSE: RegExp[] = [
  /\bpaid\s+(?:trials?|boost|ads?|promotion|campaign|placement|post|search|social|media|seat|seats|plan|tier|version|account|add-?on|feature|subscription|licen[cs]e|membership|upgrade|template|course|workshop|tool|app|service|edition)\b(?!\s+(?:report|copy|section|page|draft))/,
  /\b(?:company|corporate|business)\s+(?:credit\s+)?card\b/,
  /\bon\s+(?:my|our|the)\s+(?:credit\s+)?card\b/,
  /\b(?:accept|approve|sign)\s+(?:their|the|its|his|her)\s+(?:quote|estimate|offer|contract|proposal)\b/,
  /\bpay\s+(?:on|upon|at|when|after|before)\s+(?:delivery|receipt|arrival|completion|pickup)\b/,
  /\bcosts?\s+(?:a\s+grand|\w+\s+hundred|\d)/,
  /\b(?:we're|we\s+are|we've\s+been|are\s+we)\s+on\s+(?:the\s+)?(?:[\w-]+\s+)?(?:plan|tier)\b/,
  /\b(?:asks?|needs?|requires?|wants?)\s+(?:for\s+)?(?:a\s+|our\s+|the\s+)?(?:credit\s+card|card\s+details|payment\s+details|billing\s+details|card\s+up\s+front)\b/,
];

const MONEY_STATE =
  /\b(?:is|are|'s|'re|be|been|being|gets?|got|getting|was\s+just|has|have)\s+(?:all\s+|fully\s+|now\s+|already\s+|finally\s+)?(?:paid(?!\s+(?:attention|off))|bought|purchased|ordered|pre-?ordered|booked|reserved|rented|renewed|registered|signed|countersigned|upgraded|refunded|invoiced|billed|charged|hired|subscribed|topped\s+up|funded|sponsored|expensed|reimbursed|settled|placed\s+(?:with|on|at|for))\b|\bneeds?\s+(?:renewing|paying|buying|ordering|booking|upgrading|topping\s+up)\b|\border\b.{0,30}\bplaced\b|\bplaced\s+(?:an?\s+)?order\b|\b(?:accepted|approved|signed|countersigned)\s+(?:the\s+|their\s+|our\s+)?(?:[\w'-]+'s\s+)?(?:[\w-]+\s+)?(?:quote|estimate|contract|proposal|offer|sow|invoice|po|purchase\s+order)\b/;

function moneyTest(c: Clause): boolean {
  const t = c.text;
  if (c.pressed.some((p) => /\b(?:buy|purchase|pay|upgrade|subscribe|place\s+order|order\s+now|check\s*out|confirm\s+(?:purchase|order|payment)|renew|start\s+(?:free\s+)?trial)\b/.test(p))) return true;
  // get / grab / pick up: only with something paid
  if (GET_VERB.test(t)) {
    const obj = objectAfter(t, GET_VERB);
    if (paidObject(obj)) return true;
    if (/^(?:get|obtain|secure)\s+(?:a\s+|the\s+|our\s+)?(?:full\s+|partial\s+)?(?:refund|reimbursement|credit\s+note|rebate)\b/.test(t)) return true;
    if (/^get\s+(?:\w+\s+){0,2}?(?:a|an|the|some|two|\d+)\s+(?:[\w-]+\s+)?(?:gifts?|flowers|seats?|licen[cs]es?)\b(?!\s+(?:key|keys|count|details?|info|number|id|file|text|terms|holder|type))/.test(t)) return true;
  }
  // (get / grab / pick up only count with something paid, checked just above)
  if (MONEY_STRICT.some((re) => re !== GET_VERB && re.test(t))) return true;
  // "spend" with an amount, not with time
  if (/^spend\b/.test(t) && hasAmount(t)) return true;
  // "Should I sign up anyway?" after "The trial asks for a credit card"
  if (/^sign\s+(?:us\s+|me\s+)?up\b/.test(t) && /\b(?:trial|plan|credit\s+card|paid|pro|premium|subscription|costs?|prices?|pricing|cheapest|tiers?|[$€£]\d)/.test(c.before + ' ' + t)) return true;
  if (c.frame === 'state' && MONEY_STATE.test(t)) return true;
  if (c.frame === 'content') return false;
  if (MONEY_LOOSE.some((re) => re.test(t))) return true;
  // A past figure inside a report is a fact, not spending: "the AWS bill was $312 last month".
  const pastFigure = c.frame === 'report' && (c.factOnly === true || /\b(?:last|previous|past)\s+(?:week|month|quarter|year)|\bin\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|20\d\d)\b|\bago\b|\bso\s+far\b|\byear[- ]to[- ]date\b|\bytd\b|\breport\b|\bdashboard\b|\bsummary\b|\bstatement\b/.test(t));
  if (hasAmount(t) && !pastFigure) {
    // "Spend 2 hours", "pass $1 as the name": not money.
    const m = t.match(AMOUNT_RE)!;
    const realAmount = m.some((a) => {
      const after = t.slice(t.indexOf(a) + a.length).trim().split(/\s+/)[0] ?? '';
      return !TIME_UNIT.test(after);
    });
    if (realAmount) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------
// Contacting people outside the team
// ------------------------------------------------------------------------------------------------

const CONTACT_DIRECT = String.raw`(?:e-?mail|mail|text|sms|message|dm|pm|whatsapp|call(?!\s+out\b)|phone|ring|ping|contact|cold[- ]?(?:e-?mail|call|dm|message)|thank|congratulate|notify|inform|remind|nudge|tell|ask|invite|interview|survey|poll|brief|pitch|meet|visit|cc|bcc|chase|reconnect\s+with|update|warn|alert|reassure|greet|welcome|phone-?screen|interview|negotiate\s+with|negotiate|hound|pester|approach|court|lobby)`;
const CONTACT_PHRASAL = String.raw`(?:get\s+on\s+(?:a\s+)?(?:quick\s+)?call\s+with|reach\s+out\s+to|reach|write\s+(?:back\s+)?to|reply\s+(?:back\s+)?(?:to|on|in|under)|respond\s+(?:to|on|in|under)|answer|follow\s+up\s+(?:with|on)|check\s+in\s+with|touch\s+base\s+with|circle\s+back\s+(?:with|to)|get\s+back\s+to|get\s+in\s+touch\s+with|get\s+hold\s+of|sync\s+(?:up\s+)?with|catch\s+up\s+with|talk\s+(?:to|with)|speak\s+(?:to|with)|chat\s+with|connect\s+with|hop\s+on\s+(?:a\s+)?(?:quick\s+)?call\s+with|jump\s+on\s+(?:a\s+)?(?:quick\s+)?call\s+with|go\s+meet|apologi[sz]e\s+to|explain\s+(?:it\s+|this\s+|that\s+)?to|disclose\s+(?:it\s+|this\s+)?to|report\s+back\s+to|run\s+(?:it|this|that)\s+by|run\s+.{1,30}\s+by|reach\s+back\s+out\s+to|ring\s+up|call\s+up|phone\s+up|look\s+up\s+and\s+call)`;
const CONTACT_SEND = String.raw`(?:send|resend|re-send|forward|e-?mail|mail|text|message|dm|deliver|submit|pitch|present|explain|disclose|announce|introduce|intro|show|demo|give|hand|hand\s+over|offer|reply|respond|apologi[sz]e|send\s+out|reach\s+out|walk\s+through|pass\s+(?:along|on)|relay|fax|ship|share|reshare)`;

/** Words for the team itself: the people and agents in the room are never outside. */
const TEAM_WORDS = /^(?:me|us|myself|yourself|ourselves|the\s+team|our\s+team|the\s+whole\s+team|team|teammates?|the\s+room|everyone|everybody|all|the\s+agents?|agents?|the\s+other\s+agents?|the\s+conductor|conductor|the\s+owners?|owners?|the\s+people\s+in\s+the\s+room|people\s+in\s+the\s+room|the\s+channel|the\s+group|the\s+thread|whoever)\b/;
/** Things that a "call" or "ping" can be aimed at in software. */
const THING_OBJECT = /^(?:the\s+|our\s+|a\s+|an\s+|this\s+|that\s+|all\s+|every\s+)?(?:[\w\/.-]+\s+){0,2}?(?:comments?|threads?|e-?mails?|messages?|reviews?|tickets?|questions?|issues?|posts?|doc|draft|pr|notes?|feedback|endpoint|api|function|method|service|script|job|webhook|hook|tool|model|server|database|db|url|route|handler|queue|worker|health\s*check|cron|lambda|sdk|library|module|it|this|that)\b|^(?:out|off|up|back|for|about|if|whether|how|why|what|when|around|in|on|over)\b/;
/** Verbs that can only mean reaching a person: their object is someone, so anyone not on the team is outside. */
const HUMAN_VERB = /^(?:reply\s+(?:back\s+)?to|respond\s+to|write\s+back\s+to|dm|pm|message|text|sms|whatsapp|call|phone|ring|ping|invite|tell|warn|remind|thank|congratulate|ask|nudge|chase|reach\s+out\s+to|reach|follow\s+up\s+with|check\s+in\s+with|touch\s+base\s+with|circle\s+back\s+with|get\s+back\s+to|get\s+in\s+touch\s+with|sync\s+(?:up\s+)?with|catch\s+up\s+with|talk\s+to|speak\s+to|speak\s+with|talk\s+with|chat\s+with|meet\s+with|meet|interview|brief|notify|inform|welcome|greet|get\s+on\s+(?:a\s+)?(?:quick\s+)?call\s+with|hop\s+on\s+(?:a\s+)?(?:quick\s+)?call\s+with|schedule\s+(?:a\s+|the\s+)?(?:[\w-]+\s+)?(?:calls?|meetings?|demos?|interviews?|chats?)\s+with|set\s+up\s+(?:a\s+)?(?:[\w-]+\s+)?(?:calls?|meetings?|demos?)\s+with)\s+/;

const TEAMMATE_OUTSIDE = re(`^${TEAMMATES_OUTSIDER}`);
/** The rest of a list of people after a teammate: is anyone in it outside the team? */
function reachesSomeoneElse(rest: string, names: ReadonlySet<string>): boolean {
  const r = rest.trim();
  // A name outside the team, as the clause's names found it ("Tell Sam and Dana that ...").
  if (names.has((r.split(/\s+/)[0] ?? '').replace(/^@+/, '').replace(/[^\p{L}\p{N}_'.@+-]/gu, '').replace(/'s$/, ''))) return true;
  if (!r || TEAM_WORDS.test(r) || THING_OBJECT.test(r) || /^@?qm+\b/.test(r) || /^(?:it|them|him|her|this|that|these|those|to|about|that|what|when|whether|if|how|why)\b/.test(r)) return false;
  return /^(?:@?q[ntf]+|the\s+|our\s+|a\s+|an\s+|their\s+|all\s+|every\s+|some\s+|[\w.+-]+@)/.test(r) || OUTSIDER_START.test(r);
}

function personObject(t: string, names: ReadonlySet<string>): boolean {
  const m = HUMAN_VERB.exec(t);
  if (!m) return false;
  if (/^(?:call|ring|ping|tell)\s+(?:out|off|it|me|us)\b|^ask\s+(?:for|about|around|yourself|whether|if)\b|^text\s+(?:size|color|colour|field|box|wrap)\b|^message\s+(?:queue|bus|broker|format)\b/.test(t)) return false;
  const rest = t.slice(m[0].length).replace(/^(?:back\s+|again\s+|directly\s+|quickly\s+|personally\s+)/, '');
  if (TEAM_WORDS.test(rest) || THING_OBJECT.test(rest)) return false;
  if (TEAMMATE_OUTSIDE.test(rest)) return true;
  const first = rest.split(/\s+/).slice(0, 4).map((w) => w.replace(/[^\p{L}\p{N}_@'.-]/gu, '').replace(/^@+/, '').replace(/'s$/, ''));
  if (first.some((w, i) => i < 2 && /^qm+$/.test(w))) {
    // "Tell Sam and Dana that the launch moved": someone else is reached as well.
    const more = /^@?qm+(?:\s+qm+)?\s*(?:,|\band\b|&|\+|\/)\s*(.+)$/.exec(rest);
    return !!more && reachesSomeoneElse(more[1], names);
  }
  if (/^(?:it|them|him|her|this|that|these|those)\b/.test(rest)) return false;
  return rest.length > 0;
}

function contactTest(c: Clause, ctx: RuleContext): boolean {
  const t = c.text;
  // "Present the pricing to customers as three tiers on the page": page copy, not a meeting.
  if (/^(?:present|show|explain|introduce)\b.*\b(?:on|in)\s+(?:the\s+|our\s+)?(?:page|site|website|deck|copy|pricing\s+page|doc|landing\s+page|homepage|slide|faq)\b/.test(t)) return false;
  const nv = namesOf(c, ctx);
  const recipientHere = seen(P1, t, nv);
  if (c.pressed.some((p) => /\b(?:send|reply|email|invite|call)\b/.test(p)) && (recipientHere || mentionsOutsider(c.before) || /\b(?:newsletter|campaign|blast|announcement|launch\s+e-?mail)\b/.test(t))) return true;
  // message the speakers, text the shuttle driver, invite jordan from northwind: anyone not on the team
  const names = new Set(outsideNames(c, ctx, true));
  if (personObject(t, names)) return true;
  {
    const m = /^(?:send|resend|forward|e-?mail|mail|deliver|pass\s+along|hand\s+over|hand|report)\b.{0,60}?\s+to\s+(.+)$/.exec(t);
    const first = m?.[1].split(/\s+/)[0]?.replace(/[^\p{L}\p{N}_'-]/gu, '').replace(/'s$/, '') ?? '';
    const capital = c.raw.split(/\s+/).some((w) => /^\p{Lu}/u.test(w) && w.replace(/[^\p{L}\p{N}_'-]/gu, '').replace(/'s$/, '').toLowerCase() === first);
    if (m && !capital && PURPOSE_VERB.test(m[1])) {
      // "send him the list of accounts to check": a purpose, nobody named
    } else if (m) {
      // Every recipient counts: "to Sam and the client", "to Henry/Sam" (both teammates).
      const parts = m[1].split(/\s*(?:,|\band\b|&|\+|\/)\s*/).filter(Boolean).slice(0, 4);
      const outside = (np: string) => {
        if (TEAMMATE_OUTSIDE.test(np)) return true;
        const words = np.split(/\s+/).slice(0, 3).map((w) => w.replace(/[^\p{L}\p{N}_'-]/gu, '').replace(/'s$/, ''));
        const teamish = TEAM_WORDS.test(np) || words.some((w) => /^(?:qm+|me|us|you|yourself|them|him|her|it)$/.test(w));
        const thing = /^(?:the\s+|our\s+|a\s+|an\s+|this\s+|my\s+|your\s+)?(?:[\w\/.-]+\s+){0,2}?(?:folder|drive|doc|docs|document|room|tempo|channel|board|tracker|sheet|spreadsheet|repo|repository|server|service|api|endpoint|queue|bucket|inbox|printer|archive|trash|bin|backlog|pipeline|staging|production|prod|dashboard|crm|wiki|playbook|thread|draft|deck|file|list|top|bottom|end|front|back|start|review|approval|next|last|later|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/.test(np) || /^(?:\d|[$€£])/.test(np);
        const toolName = outsideNames(c, ctx, false).length === 0 && /^[a-z0-9.-]+$/.test(words[0] ?? '') && TOOL_NAMES.has(words[0] ?? '');
        return !teamish && !thing && !toolName;
      };
      if (outside(parts[0] ?? m[1]) || parts.slice(1).some((part) => reachesSomeoneElse(part, names))) return true;
    }
  }
  if (/^(?:dm|pm|message|text|ping|invite|tell|ask|e-?mail|follow\s+up\s+with|reach\s+out\s+to)\s+@[\w.]+/.test(t) && !/^\S+(?:\s+\S+)?\s+@qm+/.test(t)) return true;
  // email the client, ask our vendor, reach out to the press, reply to the user's issue
  if (seen(P2, t, nv)) return true;
  if (seen(P3, t, nv)) return true;
  // replying to comments, reviews, tickets and emails from people outside
  if (/^(?:answer|reply\s+(?:to|on)|respond\s+(?:to|on)|address|work\s+through|get\s+back\s+to)\s+(?:the\s+|all\s+|every\s+|each\s+|any\s+|our\s+|those\s+|these\s+)?(?:[\w'-]+\s+){0,2}?(?:questions?|comments?|reviews?|replies|reply|mentions?|messages?|dms?|e-?mails?|tickets?|inquir(?:y|ies)|enquir(?:y|ies)|complaints?|threads?|issues?|requests?|applications?)\b/.test(t) && !/\b(?:qm+|team|conductor|teammate)'?s?\b.{0,20}\b(?:comments?|questions|messages|replies|review)|\b(?:in|on)\s+(?:the\s+)?(?:doc|draft|room|tempo|pr|pull\s+request|code\s+review|outline)\b|\bcode\s+review\b/.test(t)) return true;
  if (seen(P4, t, nv)) return true;
  if (/^proceed\s+(?:the\s+|our\s+)?(?:[\w-]+\s+)?(?:outreach|newsletter|e-?mail\s+blast|blast)\b/.test(t)) return true;
  // email the draft to the client; send the deck over to Acme's CFO; demo the beta for customers
  if (seen(P5, t, nv)) return true;
  if (seen(P6, t, nv)) return true;
  // send the client the contract; give the client a call; drop the prospect a line
  if (seen(P7, t, nv)) return true;
  // let the client know, keep the vendor in the loop, loop the agency in, put the client on cc
  if (seen(P8, t, nv)) return true;
  if (/^let\s+(?!me\b|us\b|you\b|them\s+know\b|the\s+team\b|everyone\b|qm+\b)(?!(?:the\s+)?(?:conductor|agents?|owners?|room|team|people\s+in\s+the\s+room)\b).{1,60}?\s+know\b/.test(t)) return true;
  if (seen(P9, t, nv)) return true;
  if (seen(P10, t, nv)) return true;
  // calls, meetings and demos with outsiders
  if (seen(P11, t, nv)) return true;
  if (seen(P12, t, nv)) return true;
  if (seen(P13, t, nv)) return true;
  if (/^(?:phone-?screen|interview|check\s+references|do\s+(?:a\s+)?phone\s+screen|line\s+up\s+interviews|reference[- ]check)\b/.test(t) && /\b(?:candidates?|applicants?|finalists?|references?|the\s+\w+\s+candidate|for\s+the\s+(?:senior|junior))\b|^check\s+references/.test(t)) return true;
  // announcements to many people at once
  if (/^(?:send|send\s+out|e-?mail|mail|text|message|blast|resend|push|fire\s+off|schedule|queue|trigger|launch|go\s+out\s+with|announce|notify|dm|pm)\b.{0,60}\b(?:waitlist|wait\s+list|mailing\s+list|email\s+list|e-?mail\s+lists?|press\s+list|customer\s+(?:list|base)|subscriber\s+list|subscribers|contact\s+list|prospect\s+list|leads?\s+list|user\s+base|everyone|everybody|all\s+(?:\d+\s+)?(?:users|customers|subscribers|leads|contacts|members)|every\s+(?:customer|user|subscriber|lead|contact)|journalist\s+list|influencer\s+list|newsletter)\b/.test(t)) return true;
  if (/^(?:send|send\s+out|schedule|push|release|launch|go\s+out\s+with|blast)\s+(?:the\s+|our\s+|this\s+|a\s+|today's\s+)?(?:[\w-]+\s+){0,2}?(?:newsletter|survey|questionnaire|poll|email\s+blast|mass\s+e-?mail|e-?mail\s+campaign|drip|announcement\s+e-?mail|launch\s+e-?mail|press\s+release|price-?change\s+notice|notice\s+to)s?\b(?!\s+(?:draft|copy|template|outline|plan|ideas?)s?\b)/.test(t)) return true;
  if (/^(?:hit|press|click)\s+send\b/.test(t)) return true;
  if (/^set\s+(?:the\s+)?(?:newsletter|email|campaign|announcement|blast)\s+to\s+(?:go\s+out|send)/.test(t)) return true;
  if (seen(P14, t, nv)) return true;
  if (/^(?:open|file|raise|submit|log|create)\s+(?:a\s+|an\s+)?(?:support\s+)?(?:ticket|case|request|issue)\s+with\s+/.test(t)) return true;
  if (/^upload\b.{0,60}?\bto\s+(?:the|our|their|an?)\s+(?:[\w-]+\s+){0,2}?(?:agency|vendor|supplier|client|customer|printer|partner|accountant|lawyer|auditor|photographer|contractor|freelancer|studio|lab)(?:'s|s')?(?:\s+(?:portal|site|server|dropbox|drive|inbox|ftp|folder|upload\s+page))?\b/.test(t)) return true;
  if (S7.test(t) && !/\b(?:tool|checker|platform|app|ai|service|website|online|portal\s+for\s+tools)\b/.test(t.split(/\bto\s+/).slice(1).join(' '))) return true;
  if (/^(?:close|resolve|answer|update)\s+.{0,40}\b(?:ticket|case|request|thread|issue)\b.{0,20}\bwith\s+(?:a\s+|an\s+)?(?:short\s+|quick\s+|brief\s+|polite\s+)?(?:reply|response|note|message|email|answer)\b/.test(t)) return true;
  if (/^contact\b(?!\s+(?:page|form|details|info|sheet|list|section|us\s+(?:page|form)|fields?|button)\b)/.test(t)) return true;
  if (/^(?:request|get|ask\s+for|gather|collect)\s+(?:a\s+)?(?:quotes?|bids|estimates?|proposals?)\s+from\s+(?:\w+\s+)?(?:\d+|a\s+few|several|three|two|some|other|local|different)?\s*(?:[\w-]+\s+)?(?:vendors?|suppliers?|printers?|print\s+shops?|agencies|contractors|freelancers|shops?|companies|venues|caterers|photographers)\b/.test(t)) return true;
  if (/^(?:trigger|run|kick\s+off|start|execute|fire)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?(?:job|task|script|workflow|cron|automation|zap|sequence|campaign)\s+(?:that|which|to)\s+(?:e-?mails?|texts?|messages?|notif(?:y|ies)|sends?\s+(?:an?\s+)?e-?mails?)/.test(t)) return true;
  if (/^(?:trigger|send|resend|fire)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?e-?mails?\s+(?:to|for)\s+(?:all|every|everyone)\b/.test(t)) return true;
  if (/^(?:demo|present|walk\s+through|show\s+(?:the\s+|our\s+)?(?:demo|beta|product|prototype|mock-?ups?|designs?|deck|slides|app|roadmap))\b.{0,40}\b(?:to|for|with)\s+(?:a\s+few\s+|some\s+|our\s+)?(?:customers|prospects|clients|investors|leads|users)\b/.test(t)) return true;
  if (/^(?:give|offer)\s+(?:the\s+)?(?:verge|press|techcrunch|\w+)\s+an?\s+exclusive\b/.test(t)) return true;
  if (/^(?:decline|turn\s+down|reject|accept|counter)\s+(?:the\s+)?[\w'-]+'s\s+(?:proposal|pitch|offer|invite|invitation|request|application)\b/.test(t)) return true;
  if (/^brief\s+(?:the\s+)?(?:reporters|journalists|press|media|analysts)/.test(t)) return true;
  // a pronoun or no object, with someone outside mentioned just before: "Send it to them today"
  if (!S8.test(t) && (PRONOUN_SEND.test(t) || PRONOUN_SEND_WHEN.test(t)) || S9.test(t)) {
    if (mentionsOutsider(c.before) || S10.test(t) && mentionsOutsider(c.before)) return true;
    if (earlierNames(c, ctx).length && /\b(?:at|from)\s+[a-z]/.test(c.before)) return true;
  }
  // "Send it to them today" where they were named before; "Email her the signed copy"
  if (S11.test(t) && mentionsOutsiderOrName(c.before)) return true;
  if (S12.test(t) && mentionsOutsiderOrName(c.before)) return true;
  if (/^(?:keep|leave)\s+(?:them|him|her)\s+(?:in\s+the\s+loop|posted|updated)/.test(t) && mentionsOutsiderOrName(c.before)) return true;
  // goals: "The client has been emailed", "All 40 subscribers have been notified", "the reply is sent"
  if (c.frame === 'state') {
    const t = c.text.replace(/\s+(?:before|until|unless|once|so\s+that|in\s+case)\s+.*$/, '');
    // "The client has been emailed", "All 40 subscribers have been notified"
    if (seen(P15, t, nv)) return true;
    // "Every new customer has received it", "Acme has the update in their inbox"
    if (seen(P16, t, nv)) return true;
    if (S13.test(t)) return true;
    // "the reply is sent", "the first email has gone out to this week's sign-ups", "it's in her inbox"
    const sent = /\b(?:has|have|is|are|'s|was|gets?|got)\s+(?:been\s+)?(?:all\s+)?(?:sent|delivered|forwarded|mailed|e-?mailed)\b/.test(t) || /\b(?:gone|go|goes|went)\s+out\b/.test(t) || /\b(?:in|reached)\s+(?:his|her|their)\s+inbox\b/.test(t);
    const outsiderNear = seen(P17, t, nv) || S14.test(t) || mentionsOutsider(c.before) || earlierNames(c, ctx).length > 0;
    if (sent && outsiderNear) return true;
    // "it has been shared with Northwind's team"
    if (seen(P18, t, nv)) return true;
  }
  if (c.frame === 'content' || c.frame === 'report') {
    if (/^is\s+.{1,40}\bgood\s+to\s+go\s+out\s+to\b/.test(t) && seen(P19, t, nv)) return true;
    return false;
  }
  if (seen(P20, t, nv)) return true;
  return false;
}

/** Names outside the team in the clauses before this one (each clause's first word is not a name). */
function earlierNames(c: Clause, ctx: RuleContext): string[] {
  return c.beforeParts.flatMap((raw) => outsideNames({ ...c, raw }, ctx, true));
}

function mentionsOutsiderOrName(before: string): boolean {
  return mentionsOutsider(before) || /\b(?:from|at)\s+[a-z][\w-]+\b/.test(before) || /\b[a-z]+'s\s+(?:team|cto|ceo|cfo|legal|support|marketing)\b/.test(before);
}

// ------------------------------------------------------------------------------------------------
// Deleting
// ------------------------------------------------------------------------------------------------

/** Parts of a draft, a deck or code: removing these is editing, not deleting anything. */
const CONTENT_PART = String.raw`(?:words?|sentences?|paragraphs?|lines?|commas?|periods?|full\s+stops?|typos?|spaces?|bullets?|bullet\s+points?|headings?|subheadings?|emojis?|phrases?|clauses?|characters?|letters?|filler(?:\s+words)?|adjectives?|adverbs?|exclamation\s+(?:marks?|points?)|hyphens?|dashes?|placeholders?|lorem\s+ipsum|footnotes?|captions?|line\s+breaks?|blank\s+lines?|whitespace|taglines?|repetition|jargon|buzzwords?|intro|outro|sections?|rows?|columns?|cells?|slides?|photos?|images?|pictures?|graphics?|icons?|tables?(?!\s+(?:from\s+the\s+)?(?:database|db))|charts?|ctas?|buttons?|testimonials?|quotes?|items?|entr(?:y|ies)|comments?|todos?|code|statements?|dependenc(?:y|ies)|imports?|attributes?|fields?|filters?|menu(?:\s+items?)?|endpoints?|functions?|methods?|class(?:es)?|variables?|version\s+numbers?|labels?|links?|banners?|footers?|headers?|logos?|numbers?|phone\s+numbers?|e-?mail\s+address(?:es)?|address(?:es)?|names?|mentions?|references?|paragraph|subhead|copy|text|wording|header|stock\s+photo|carousel|hero|video\s+section|price|pricing\s+line|competitor\s+row|cta\s+button|password|watermark|border|background|shadow|animation|tab|tabs|widget|sidebar\s+item|bios?|signature|disclaimer|line\s+item|option|options|step|steps|question|questions|answer|answers|bullet\s+list|toc|table\s+of\s+contents|log\s+statements?|debug\s+(?:logs?|statements?)|console\s+logs?|todo\s+comments?)`;
/** Places that hold a draft, a deck or code. */
const CONTENT_PLACE = String.raw`(?:draft|drafts|doc|document|deck|pitch\s+deck|slide\s+\d+|slide|slides|page\s+draft|mock-?up|mockup|readme|one-pager|battlecard|proposal|outline|copy|router|component|template|script|spreadsheet|sheet|faq|post\s+draft|email\s+draft|newsletter\s+draft|case\s+study|landing\s+page\s+draft|homepage\s+draft|presentation|brief|report|article|essay|bio|form|config|file\s+\w+\.\w+|[\w-]+\.(?:ts|tsx|js|jsx|json|md|py|css|html|yml|yaml)|error\s+message|message\s+text|footer|header|sidebar|nav|menu|modal|carousel|section|table|layout|design|wireframe)`;
/** Things that are data: removing these deletes something. */
const DATA_THING = String.raw`(?:files?|folders?|director(?:y|ies)|repos?|repositor(?:y|ies)|branch(?:es)?|databases?|dbs?|records?|accounts?|users?|backups?|data|datasets?|drives?|channels?|workspaces?|projects?|rooms?|archives?|logs?|history|everything|all\s+of\s+it|stuff|docs|documents|drafts|posts?|tweets?|threads?|e-?mails|messages|attachments?|assets|uploads?|versions?|recordings?|videos?|spreadsheets|sheets|decks|contacts?|subscribers?|leads|customers?|members?|lists?|snapshots?|volumes?|buckets?|environments?|envs?|servers?|stacks?|clusters?|instances?|images?\s+(?:in|on)\s+(?:the\s+)?(?:registry|bucket|server)|exports?|mockups|pages?\s+(?:on|from)\s+(?:the\s+)?(?:site|website|blog|live)|blog\s+posts?|articles|listings?|reviews?|comments\s+on\s+(?:our|the)\s+(?:post|page)|tables?\s+(?:in|on|from)\s+(?:the\s+)?(?:prod|production|database|db)|collections?|indexes|indices|keys|secrets|tokens\s+in|caches?\s+in\s+prod|queues?|topics?|sites?|apps?|pipelines?|zaps?|automations?|forms?|surveys?|calendars?|events\s+in)`;

const DELETE_VERB = String.raw`(?:rm|factory\s+reset|delete|erase|purge|destroy|shred|nuke|wipe|obliterate|hard[- ]delete|bulk[- ]delete|permanently\s+(?:delete|remove|erase)|force[- ]delete|remove|get\s+rid\s+of|bin|trash|throw\s+(?:away|out)|discard|scrap|ditch|dump|junk|toss|clear\s+out|clean\s+out|clean\s+up|prune|flush|empty|tear\s+down|take\s+down|shut\s+down|kill|decommission|deprovision|retire|unpublish|unlist|drop|truncate|overwrite|replace|reset|close|cancel|terminate|deactivate|clear|zap|axe|cull)`;

function deleteTest(c: Clause): boolean {
  const t = c.text;
  if (c.pressed.some((p) => /\b(?:delete|remove|empty\s+trash|discard|destroy|wipe|purge|close\s+account|cancel\s+subscription)\b/.test(p))) return true;
  if (/\bwipe\s+the\s+slate\b|\bclean\s+slate\b/.test(t)) return false;
  // shell and database commands
  // Shell and database commands, when run ("Run `rm -rf /data`"); a command that is only the topic of
  // drafting or code work ("Add a lint rule that blocks `rm -rf`") is not an act.
  const runs = c.frame !== 'content' || /^(?:run|execute|exec|type|enter|issue|fire)\b/.test(t);
  if (runs && (/\bterraform\s+destroy\b|\bgit\s+branch\s+-d\b|\brm\s+-[a-z]*r|\bdrop\s+(?:table|database|schema|collection)\b|\btruncate\s+(?:table\s+)?(?!.*\b(?:name|names|title|text|string|label|to\s+\d)\b)\w+\s+on\s+(?:the\s+)?(?:prod|production)|\bdelete\s+from\b|\bgit\s+push\s+(?:-f|--force)\b|\bforce[- ]push\b|\bflushall\b|\bflushdb\b/.test(t) || CLI_DELETE.test(t))) return true;
  if (/^(?:run|trigger|execute|kick\s+off|start)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?(?:deletion|delete|cleanup|clean-?up|purge|wipe|teardown|destroy|reset)\s+(?:script|job|task|command|migration|workflow)\b/.test(t)) return true;
  if (/^(?:run|trigger|execute|kick\s+off|start)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?(?:job|task|script|workflow|cron|migration|automation|command)\s+(?:that|which|to)\s+(?:deletes?|wipes?|purges?|drops?|removes?|truncates?|clears?|destroys?)\b/.test(t)) return true;
  if (/^replace\s+(?:the\s+)?(?:prod|production|live)\s+(?:data|database|db)\b/.test(t)) return true;
  if (/^overwrite\b/.test(t) && (/\b(?:prod|production|live|database|db|customers|users|records|accounts|backups?)\b/.test(t) || !S15.test(t)) && !/\b(?:draft|copy|text|wording|intro|paragraph)\b/.test(t.split(/\s+with\s+/)[0])) return true;
  if (/^(?:close|cancel|terminate|deactivate|shut\s+down|delete|remove|kill)\s+(?:the\s+|our\s+|my\s+|their\s+|this\s+|old\s+)?(?:[\w-]+\s+){0,3}?(?:accounts?|workspaces?|subscriptions?\s+and)\b(?!\s+(?:settings|page|form|copy|name|email|password|section|details|tab|screen|menu|manager)\b)/.test(t)) return true;
  if (/^take\s+.{1,50}?\s+down\b(?!\s+(?:a\s+notch|to))/.test(t) && !/^take\s+(?:it|this|that)\s+down\s+a\b/.test(t)) return true;
  if (/^factory\s+reset\b|^(?:wipe|reset)\s+.{0,30}\b(?:phone|laptop|device|computer|tablet|drive|disk|machine|mac|pc)\b/.test(t)) return true;
  if (/^(?:take\s+down|tear\s+down|decommission|deprovision|retire|unpublish|unlist|shut\s+down|kill)\s+(?:the\s+|our\s+|old\s+)?(?:[\w-]+\s+){0,3}?(?:posts?|pages?|sites?|websites?|blog\s+posts?|articles?|videos?|tweets?|listings?|servers?|environments?|envs?|stacks?|clusters?|staging|instances?|databases?|apps?|landing\s+pages?|campaigns?|old\s+\w+)\b/.test(t)) return true;
  if (/^(?:drop|truncate)\s+(?:the\s+)?(?:[\w-]+\s+)?(?:tables?|databases?|db|collections?|schema|index)\b(?!.*\bfrom\s+(?:the\s+)?(?:readme|doc|draft|deck|page|onboarding\s+doc|outline|slide))/.test(t) && !/\b(?:name|names|title)\s+to\b/.test(t)) return true;
  if (/^(?:flush|clear|wipe|purge|reset)\s+(?:out\s+)?(?:the\s+|all\s+)?(?:prod|production|live)\b/.test(t)) return true;
  if (/^(?:flush|purge)\s+(?:the\s+)?(?:[\w-]+\s+)?(?:redis|database|db|cache|queue|cdn)\b/.test(t)) return true;
  if (/^empty\s+(?:the\s+)?(?:[\w-]+\s+)?(?:trash|bin|recycle\s+bin|bucket|folder|drive|inbox|database|table|list)\b/.test(t)) return true;
  if (/^(?:clean\s+up|clear\s+out|clean\s+out|prune|cull)\b/.test(t) && S16.test(t) && !/\b(?:code|copy|text|wording|outline|draft\s+text|css|styles|imports|formatting|layout)\b/.test(t)) return true;
  if (/^(?:clear|reset)\s+(?:out\s+)?(?:the\s+|all\s+|our\s+)?(?:[\w-]+\s+)?(?:data|database|db|records|history|backups?|contacts|subscribers|logs|repo|repository|server|drive|folder|inbox)\b(?!\s+(?:[\w-]+\s+)?(?:fields?|form|section|filters?|search|selection|badge|count|pool|timeout|connection|connections|settings|cache\s+key|config))/.test(t) && !/\b(?:after|when|on)\s+(?:the\s+)?(?:user|submit|save|logout|unmount|close)\b/.test(t) && !/\bform\s+data\b/.test(t)) return true;
  if (/^(?:empty|clear)\s+.{0,30}\btrash\b/.test(t)) return true;
  if (/^(?:move|put|send|drag)\s+.{0,40}\bto\s+(?:the\s+)?(?:trash|bin|recycle\s+bin)\b/.test(t)) return true;
  if (/\bby\s+(?:getting\s+rid\s+of|deleting|removing|wiping|clearing\s+out|purging|binning|trashing|throwing\s+away|emptying|pruning|dropping)\b/.test(t) && !S17.test(t)) return true;
  if (c.frame !== 'content' && /\b(?:and\s+)?(?:dropping|deleting|removing|purging|discarding|wiping)\s+(?:the\s+|all\s+)?(?:rest|duplicates|others|remaining\s+[\w-]+|old\s+(?:records|rows|data|ones|files|entries))\b/.test(t)) return true;
  if (/^take\s+.{1,50}?\s+off\s+(?:the\s+|our\s+)?(?:[\w-]+\s+)?(?:site|website|blog|page|portfolio|store|shop|channel|feed|instagram|linkedin|homepage|listing)\b/.test(t)) return true;
  if (/^proceed\s+.{0,30}\b(?:deletion|wipe|purge|cleanup|clean-?up|teardown|removal|delete)\b/.test(t) && !S18.test(t)) return true;
  if (/^(?:the\s+)?(?:[\w-]+\s+){0,2}?(?:wipe|deletion|purge)\b/.test(t) && c.frame !== 'report' && c.frame !== 'content') return true;
  // delete / remove / bin ... with an object
  const verb = S19.exec(t);
  if (verb) {
    const rest = t.slice(verb[0].length).trim();
    // "drop it in Tempo for feedback": putting something somewhere, not deleting it
    if (/^drop$/.test(verb[0].trim()) && /\b(?:in|into|onto|on)\s+(?:the\s+|our\s+|this\s+)?(?:tempo|room|doc|drive|folder|thread|chat|channel|slack|deck|draft|inbox|sheet|tracker|board)\b/.test(rest)) return false;
    if (/\bon\s+line\s+\d+|\bconsole\.\w+|\bdebug\s+(?:line|output|print)/.test(rest)) return false;
    if (/^(?:the\s+|a\s+|an\s+)?(?:old\s+)?session\b.*\bon\s+(?:logout|unmount|close|exit)|^(?:the\s+)?(?:chart|component|modal|listener|instance|timer|interval|observer|subscription|socket|connection)\b/.test(rest)) return false;
    if (/^(?:[\w-]+\s+)?(?:timeout|filters?|pool|password|badge|counter|count|state|styles?|zoom|layout|form|search|selection|cache\s+key|flag)\b/.test(rest) && !/\bfrom\s+(?:the\s+)?(?:prod|production|server|database)\b/.test(rest)) return false;
    if (/^(?:it|them|this|that|these|those)\b/.test(rest)) {
      // "Drop it" after "The test database is stale"; "Delete it" after "The second paragraph is weak"
      const back = c.before.split(/[.;!?]|\s+and\s+/).filter(Boolean).pop() ?? c.before;
      if (S20.test(back) && !S21.test(back)) return false;
      if (/^(?:reset|replace|close|cancel|clear|kill|drop|retire|terminate)$/.test(verb[0].trim())) return S22.test(back);
      return true;
    }
    if (/^(?:reset|replace|close|cancel|clear|kill|drop|retire|terminate)$/.test(verb[0].trim()) && !S23.test(rest)) return false;
    const head = (objectAfter(' ' + rest, /^/) ?? rest).replace(/\s+(?:you|we|i|they|that|which|who)\s+\w+.*$/, '');
    const fromPlace = /\b(?:from|in|on|of)\s+(?:the\s+|this\s+|that\s+|our\s+|my\s+|your\s+|slide\s+\d+\s+of\s+the\s+)?(?:[\w-]+\s+){0,3}?([\w.-]+)\b/.exec(rest);
    const partAtEnd = S24.test(head.replace(/\s+(?:about|for|on|with|from|in|of)\b.*$/, ''));
    const inContentPlace = fromPlace && S25.test(rest);
    const dataHead = S26.test(head) || S27.test(rest);
    if (partAtEnd && !dataHead) return false;
    if (inContentPlace && !dataHead) return false;
    if (inContentPlace && dataHead && /\b(?:draft|doc|deck|slide|mock-?up|readme|copy)\b/.test(rest) && !/\b(?:folders?|files?|drafts\s+folder|cms|drive)\b/.test(rest)) return false;
    // "remove" and other soft verbs need something that holds data; "delete" needs anything that is not a part of a draft
    if (/^(?:delete|erase|purge|destroy|shred|nuke|wipe|obliterate|hard[- ]delete|bulk[- ]delete|permanently|force[- ]delete|bin|trash|throw|discard|scrap|ditch|dump|junk|toss|zap|axe|get\s+rid\s+of)/.test(verb[0])) return true;
    if (dataHead) return true;
    if (/\b(?:old|stale|unused|inactive|duplicate|archived|outdated|previous|legacy)\s+\w+/.test(rest) && /^(?:remove|clean\s+up|clear\s+out|prune)/.test(verb[0]) && !partAtEnd) return true;
    return false;
  }
  if (c.frame === 'state') {
    if (/\b(?:no|nothing|none|not\s+a\s+single)\b/.test(t.split(/\b(?:is|are|has|have|was|were|gets?)\b/)[0] ?? '')) return false;
    const subject = t.split(/\b(?:is|are|has|have|was|were|gets?|got)\b/)[0] ?? '';
    const draftPart = S28.test(subject) && !S29.test(subject);
    if (!draftPart && /\b(?:is|are|be|been|being|has|have|gets?|got)\s+(?:all\s+|now\s+|already\s+|permanently\s+)?(?:deleted|removed|erased|purged|wiped|destroyed|dropped|emptied|cleared\s+out|pruned|overwritten|torn\s+down|taken\s+down|shut\s+down|binned|trashed)\b/.test(t)) return true;
    if (!draftPart && /\b(?:is|are|'s|'re|be|been)\s+(?:all\s+|now\s+)?gone\b(?!\s+out)/.test(t)) return true;
    if (/\b(?:accounts?|subscriptions?|workspaces?|repos?|channels?)\b.{0,20}\b(?:is|are|has\s+been|have\s+been)\s+(?:closed|cancell?ed|deactivated|terminated)\b/.test(t)) return true;
    if (/\bonly\s+.{1,40}\s+remains?\b/.test(t)) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------
// Sharing outside the project (publishing included)
// ------------------------------------------------------------------------------------------------

const SHARE_VERB = String.raw`(?:post|repost|cross-?post|tweet|retweet|share|reshare|publish|republish|upload|put|drop|submit|list|stream|livestream|live-?stream|reveal|announce|launch|unveil|debut|paste|commit|push|deploy|ship|release|send|get|go|syndicate|add|place|pin|feature|embed|host|mirror|leak|expose|broadcast|air|premiere|schedule|queue|run)`;
const TECH_PUBLISH = /\b(?:events?|messages?|metrics?|logs?\s+to|to\s+(?:the\s+)?(?:message\s+)?(?:queue|topic|kafka|redis|sns|pubsub|bus|stream|internal|private|staging|room|channel\s+in\s+tempo|tempo)|docker\s+image|container\s+image|image\s+to\s+(?:our\s+)?(?:private\s+)?registry|private\s+registry|internal\s+wiki|in\s+the\s+room|to\s+the\s+room|meeting\s+minutes\s+in|package\s+to\s+(?:our\s+)?private|artifact|build\s+artifact|test\s+results?)\b/;

function shareTest(c: Clause, ctx: RuleContext): boolean {
  const t = c.text;
  const publicHere = S30.test(t);
  if (c.pressed.some((p) => /\b(?:publish|post|share|tweet|go\s+live|make\s+public|deploy|release|launch)\b/.test(p))) return true;
  const internal = INTERNAL.test(t) || (!publicHere && (TEAMMATE_INTERNAL.test(t) || (/\b(?:posted|shared|post|share|for\s+review)\b/.test(t) && FOR_TEAMMATE.test(t))));
  // project data into an outside tool: "Upload our customer list to Canva", "Paste the tickets into an online AI tool"
  // Data about people: customers, users, contacts, support tickets, interview recordings.
  const dataThing = /\b(?:(?:customer|client|user|contact|subscriber|lead|member|candidate|employee|patient|donor|personal|private|support|sales|billing|crm|e-?mail|interview|survey|payroll|hr|attendee|participant|guest|staff|vendor|device|applicant|volunteer)s?\s+(?:[\w-]+\s+)?(?:list|lists|data|database|db|records|e-?mails|addresses|contacts|tickets|events|exports?|recordings?|transcripts?|logs|spreadsheet|sheet|csv|responses|details|info|table)|(?:customer|client|user|contact|subscriber|lead|member)\s+(?:list|lists|base|data|database|db)|(?:exported|full|our|the|all)\s+(?:support\s+)?tickets|(?:the|our)\s+(?:customer|user|production)\s+(?:database|db)|^(?:connect|sync)\s+(?:the\s+|our\s+)?(?:[\w-]+\s+)?(?:database|db|warehouse|data\s+warehouse|crm)|leads|subscribers|contacts|customers|(?:full\s+)?(?:response|responses|survey)\s+exports?|including\s+(?:their\s+|the\s+)?(?:e-?mails|e-?mail\s+addresses|names|phone\s+numbers|addresses|personal\s+(?:data|details|info)))\b/;
  if (/^(?:upload|import|paste|feed|load|copy|sync|connect|export|send|push|give|hand)\b/.test(t) && dataThing.test(t)
    && /\b(?:to|into|with|in)\s+(?:a\s+|an\s+|the\s+|our\s+|this\s+|that\s+)?(?:new\s+|free\s+|online\s+|third[- ]party\s+|outside\s+)?(?:[\w.-]+\s+){0,2}?(?:tool|platform|app|service|crm|ai|vendor|website|site|product|system|marketplace|chatbot|gpt|plugin)\b/.test(t)
    && !/\b(?:to|into|in)\s+(?:the\s+|our\s+)?(?:shared\s+drive|drive|folder|room|tempo|doc|team|playbook)\b/.test(t)) return true;
  if (/^(?:upload|import|paste|feed|load|copy|sync|connect|export)\b/.test(t) && dataThing.test(t) && outsideNames(c, ctx, true).some((n) => n !== 'tempo')) return true;
  // giving outsiders access
  const nv = namesOf(c, ctx);
  if (seen(P21, t, nv)) return true;
  {
    const m = /^(?:give|grant)\s+(.{1,60}?)\s+(?:edit|view|viewer|read|write|comment|full|admin|owner|editor|guest)?\s*(?:access|rights|permissions?)\b/.exec(t);
    if (m && !TEAM_WORDS.test(m[1]) && !m[1].split(/\s+/).some((w) => /^@?(?:qm+|me|us|yourself)(?:'s)?$/.test(w))) return true;
  }
  if (seen(P22, t, nv)) return true;
  if (seen(P23, t, nv)) return true;
  if (/^(?:push|move|bump|postpone|delay|defer|shift)\b.{0,50}\bto\s+(?:next|later|another|the\s+following|tomorrow|monday|tuesday|wednesday|thursday|friday)\b|^push\s+back\b/.test(t)) return false;
  // publish (not events to a queue, not a private registry)
  if (/^(?:publish|republish)\b/.test(t) && !TECH_PUBLISH.test(t)) return true;
  if (/^(?:tweet|retweet|cross-?post|livestream|live-?stream|syndicate|broadcast)\b/.test(t)) return true;
  if (/^(?:leak|expose|disclose|reveal|unveil|debut)\b/.test(t) && !/^(?:expose|reveal)\s+(?:the\s+)?(?:[\w-]+\s+)?(?:helper|method|function|api|endpoint|field|property|setting|button|option|config)\b/.test(t)) return true;
  if (/^announce\b/.test(t) && !/\b(?:internally|to\s+the\s+team|in\s+the\s+room|to\s+(?:qm+|the\s+conductor))\b/.test(t)) return true;
  if (/^go\s+public\b|^break\s+(?:the\s+)?embargo\b|^open-?source\b|\bnpm\s+publish\b|^(?:go|goes|going)\s+live\b/.test(t)) return true;
  // post / upload / put ... on a public place
  if (!internal && S31.test(t) && !/^(?:push)\s+(?:the\s+)?(?:[\w-]+\s+)?(?:branch|commit|commits|fix|code|changes|pr)\b/.test(t) && !/^share\s+(?:your|my|our|some|any)\s+(?:thoughts|feedback|ideas|notes|views|opinions|take|findings|concerns|questions)\b/.test(t)) return true;
  if (!internal && S32.test(t)) return true;
  // go live / make live / put live / take live / ship to production
  if (/^(?:make|put|take|get|push|bring|set|turn|switch|flip)\s+(?:.{0,40}?\s+)?live\b(?!\s+(?:chat|demo|session|stream\s+plan))/.test(t)) return true;
  if (/^(?:deploy|ship|release|push|promote|roll\s+out|launch|move|merge|cut\s+over)\b.{0,50}?\b(?:to|into|on|onto|in|for)\s+(?:the\s+)?(?:production|prod|live|live\s+site|main\s+and\s+let\s+the\s+pipeline\s+deploy|netlify|vercel|heroku|all\s+(?:users|visitors|customers)|100%\s+of\s+(?:users|traffic|visitors)|everyone|the\s+public|public|app\s+store|play\s+store|chrome\s+web\s+store|npm)\b/.test(t)) return true;
  if (/\blet\s+the\s+pipeline\s+deploy\s+to\s+production\b|^(?:kick\s+off|start|trigger|run)\s+(?:the\s+)?(?:production|prod|live)\s+(?:deploy|deployment|release)\b/.test(t)) return true;
  if (/^(?:release|launch|ship|open|roll\s+out|debut)\b.{0,40}\b(?:to\s+the\s+public|publicly|to\s+everyone|to\s+all\s+(?:users|visitors)|on\s+product\s*hunt|on\s+hacker\s*news|to\s+the\s+world)\b/.test(t)) return true;
  if (/^(?:release|ship)\s+(?:v\d|version\s+\d|the\s+(?:hotfix|update|new\s+version|app|product|beta))\b(?!.*\b(?:notes|checklist|plan|branch|candidate|to\s+staging|locally)\b)/.test(t)) return true;
  if (/^launch\s+(?:on|at)\s+/.test(t) && publicHere) return true;
  if (/^(?:launch|ship)\s+(?:the\s+|our\s+)?(?:new\s+)?(?:site|website|landing\s+page|homepage|app|product|beta|v\d|store|shop)\b(?!.*\b(?:locally|localhost|simulator|emulator|staging|dev\s+server|ios\s+simulator|android\s+emulator|copy|plan|checklist|brief|draft|email|timeline)\b)/.test(t)) return true;
  if (/^(?:make|set)\s+.{1,50}?\s+(?:visible|live|available|accessible|public)\s+(?:on|to)\s+(?:the\s+|our\s+)?(?:website|site|store|shop|public|everyone|customers|users|homepage|blog)\b/.test(t)) return true;
  if (/^(?:schedule|set|queue)\s+.{0,40}\bto\s+(?:go\s+live|publish|go\s+out|post)\b/.test(t) && !/\b(?:newsletter|e-?mail|campaign|blast|survey)\b/.test(t)) return true;
  if (/^(?:flip|turn|switch|enable|roll\s+out|set)\b.*\bflags?\b.*\b(?:everyone|all\s+(?:users|customers|visitors)|production|prod|100%)\b/.test(t)) return true;
  if (/\bso\s+(?:that\s+)?(?:the\s+|our\s+)?(?:[\w-]+\s+){0,2}?(?:goes|go|is|are)\s+live\b/.test(t)) return true;
  if (/^(?:put|get|send)\s+.{0,30}\b(?:out|up)\b(?!\s+(?:of|for\s+review|to\s+qm+\b))/.test(t) && /^put\s+.{0,30}\bout\b|\bup\s+(?:on|for\s+free)\b/.test(t)) return true;
  // live site edits
  if (/\blive\s+(?:site|website|page|homepage|app|store|version)\b/.test(t) && /^(?:update|change|swap|add|upload|push|edit|replace|put|post|publish|deploy|switch)\b/.test(t)) return true;
  // public settings and links
  if (/^(?:make|set|switch(?!\s+off)|change|flip(?!\s+off)|turn(?!\s+off)|open)\s+.{1,50}?\s+(?:to\s+|from\s+private\s+to\s+)?(?:public(?:-read)?|world-readable|anyone\s+with\s+(?:the|a)\s+link|visible\s+to\s+(?:everyone|anyone|the\s+public))(?![\w-])(?!\s+(?:holidays?|facing|api|key|method|class|interface|function|property|field|records?|domain)\b)/.test(t) && !/\b(?:method|constructor|class|function|property|field|getter|setter|member|variable|helper|endpoint)\b/.test(t)) return true;
  if (/^(?:turn\s+on|enable|launch|open|activate|switch\s+on|publish|create)\s+(?:the\s+|our\s+|a\s+)?public\s+(?!holidays?\b)\w+/.test(t)) return true;
  if (/^(?:set|change|switch|flip|turn|update)\s+.{0,40}\b(?:visibility|sharing(?:\s+settings?)?|link\s+sharing|access|acl|permissions?)\b.{0,20}\bto\s+(?:"q"|public|anyone|everyone)/.test(t) && (!/"q"/.test(t) || c.quoted.some((q) => /public|anyone|everyone|on the web/.test(q)))) return true;
  if (/^(?:turn\s+on|enable|switch\s+on|create|make|generate|share|send|post|publish|open)\s+.{0,30}\b(?:link\s+sharing|public\s+(?:\w+\s+)?link|public\s+sharing|anyone\s+with\s+(?:the|a)\s+link|share\s+link\s+for\s+anyone)\b/.test(t)) return true;
  if (/^open\s+.{0,40}\bto\s+(?:anyone|everyone|the\s+public|the\s+world)\b/.test(t)) return true;
  if (/^expose\b|\bto\s+the\s+internet\b/.test(t) && /^(?:expose|open|make|put)/.test(t)) return true;
  if (/^(?:paste|commit|push|drop|put|post|upload|share|pin)\s+.{0,50}\b(?:into|in|to|on)\s+(?:a\s+|the\s+|our\s+|their\s+)?public\s+\w+/.test(t)) return true;
  if (/^(?:upload|paste|put|send|feed|give|import|copy|load)\s+.{0,60}\b(?:to|into|in)\s+(?:a\s+|an\s+)?(?:free\s+|online\s+|third[- ]party\s+)+(?:[\w-]+\s+){0,3}?[\w-]+/.test(t) && !INTERNAL.test(t)) return true;
  if (/^(?:upload|paste|put|send|share|feed|give)\s+.{0,50}\b(?:to|into|in|with)\s+(?:a\s+|an\s+|the\s+)?(?:chatgpt|gpt|free\s+online\s+tool|online\s+tool|third[- ]party\s+(?:tool|service|site|app)|random\s+website)\b/.test(t)) return true;
  if (/\bso\s+(?:that\s+)?(?:anyone|everyone|the\s+public|people|visitors|the\s+world)\s+can\s+(?:see|view|access|read|download|find)\b/.test(t)) return true;
  if (/^share\b(?!\s+(?:your|my|our|some|any)\s+(?:thoughts|feedback|ideas|notes|views|opinions|take|findings|concerns|questions)\b).{0,60}\b(?:publicly|externally|outside\s+(?:the|our)\s+(?:team|company|project)|with\s+the\s+world|with\s+(?:another|other|outside)\s+compan(?:y|ies)|with\s+(?:competitors?|third[- ]part(?:y|ies)))\b/.test(t)) return true;
  if (/^(?:list|submit)\s+.{0,40}\b(?:on|to)\s+(?:the\s+)?(?:chrome\s+web\s+store|app\s+store|play\s+store|product\s*hunt|marketplace|gumroad|ebay|amazon|etsy|arxiv|directories|directory)\b/.test(t)) return true;
  if (/^(?:queue|schedule)\s+(?:the\s+|our\s+|a\s+)?(?:[\w-]+\s+)?(?:tweets?|posts?|threads?|reels?|stories|videos?)\b(?!\s+(?:for\s+review|in\s+the\s+doc|draft))/.test(t) && !/\bdraft/.test(t)) return true;
  if (/^proceed\s+.{0,40}\b(?:launch|announcement|release|publication|go-?live|deploy(?:ment)?|post|reveal)\b/.test(t)) return true;
  // post with no place: only clearly public things, or "post it" after a public place
  if (/^(?:post|share)\s+(?:the\s+|our\s+|a\s+|this\s+)?(?:[\w-]+\s+)?(?:news|announcement|launch|thread|tweet|video|teaser|reveal|press\s+release|job|opening|story|case\s+study|blog\s+post|article|reel|funding\s+news|update\s+publicly)\b/.test(t) && !internal && !/\bwith\s+/.test(t)) return true;
  if (/^(?:post|publish|share|upload|put\s+up)\s+(?:it|them|this|that)\b/.test(t) && S33.test(c.before)) return true;
  // goals: "The post is live on LinkedIn", "Visitors to tempo.app can see it", "Done when: posted"
  if (c.frame === 'state' && !internal) {
    if (/^(?:no|nothing|none)\b/.test(t)) return false;
    if (S34.test(t)) return true;
    if (S35.test(t)) return true;
    if (/\b(?:visitors|anyone|everyone|the\s+public|customers|users|people)\b.{0,40}\bcan\s+(?:see|view|access|read|find|download)\b/.test(t)) return true;
    if (S36.test(t) && (S37.test(t) || S38.test(c.before) || /\b(?:announcement|tweet|press\s+release|job\s+(?:ad|post|listing)|listing|video|reel|teaser|launch\s+post|article)s?\b/.test(t))) return true;
    if (/^(?:published|live|tweeted|shipped|deployed|released|launched)\s*$/.test(t) || (/^(?:posted|up)\s*$/.test(t) && S39.test(c.before))) return true;
    if (/\b(?:in|on)\s+production\b/.test(t) && /\b(?:is|are|runs?|running)\b/.test(t)) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------

export const MONEY: Rule = { label: 'spending money', key: 'spending', test: (c) => moneyTest(c) };
export const CONTACT: Rule = { label: 'contacting anyone outside the team', key: 'contacting', test: (c, ctx) => contactTest(c, ctx) };
export const DELETE: Rule = { label: 'deleting anything', key: 'deleting', test: (c) => deleteTest(c) };
export const SHARE: Rule = { label: 'sharing anything outside the project', key: 'sharing', test: (c, ctx) => shareTest(c, ctx) };

export const RULES: Rule[] = [MONEY, CONTACT, DELETE, SHARE];

/**
 * Words that never count as a teammate on their own, though they may be part of a team name: days
 * and small words, tools and public places ("LinkedIn" of "LinkedIn Muse"), and roles and outsiders
 * ("Support", "Press"). See teamOf in limits-text.ts.
 */
export const NOT_TEAM_WORDS: ReadonlySet<string> = new Set([
  ...NOT_NAMES,
  ...TOOL_NAMES,
  ...PUBLIC_WORDS,
  ...(
    'customer customers client clients vendor vendors supplier suppliers press journalist journalists reporter reporters media investor investors ' +
    'prospect prospects lead leads influencer influencers creator creators user users subscriber subscribers candidate candidates applicant ' +
    'applicants partner partners sponsor sponsors donor donors support sales billing outreach pilot social community public agency freelancer ' +
    'freelancers contractor contractors consultant consultants accountant lawyer recruiter photographer printer venue legal finance marketing ' +
    'growth success help helpdesk desk service services bot assistant agent agents team linkedin twitter x facebook instagram tiktok youtube ' +
    'reddit discord slack email mail inbox newsletter blog website site store shop'
  ).split(' '),
]);

/** For the clause splitter: a run-a-job clause carries its own act ("Run the script that deletes all staging data"). */
export function jobAct(text: string): string | null {
  const m = /^(?:run|trigger|kick\s+off|execute|start|launch|fire)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?(?:job|task|script|workflow|cron|pipeline|migration|automation|zap|sequence|command)\s+(?:that|which)\s+(.*)$/.exec(text);
  if (!m) return null;
  return m[1].replace(/^(\w+?)(ches|shes|xes|sses|zes)\b/, (_w, a: string, b: string) => a + b.slice(0, -2)).replace(/^(\w+[^s])s\b/, '$1');
}

// Patterns used inside the rules above, built once when this module loads.
/** "gh repo delete acme/old-site", "aws s3 rm s3://exports --recursive", "kubectl delete namespace staging". */
const CLI_DELETE = re(String.raw`\b(?:gh|aws|gcloud|gsutil|az|kubectl|helm|heroku|fly|flyctl|vercel|netlify|docker|git|supabase|firebase|terraform|pulumi|doctl|railway|s3cmd|rclone)\b[^.;]{0,80}?(?:\s(?:delete|destroy|rm|rmdir|purge|prune|terminate|drop)\b|\s--delete\b|\s-d\s)`);
/** The start of a list of people outside the team ("the client", "everyone who signed up"). */
const OUTSIDER_START = re(String.raw`^(?:${OUTSIDER}|${AUDIENCE})`);
/** "Send it to them today", but not "send it to Henry" (teammates are "qmmm" placeholders here). */
const PRONOUN_SEND = re(String.raw`^(?:${CONTACT_DIRECT}|${CONTACT_PHRASAL}|${CONTACT_SEND})\s+(?:${PRONOUN_OBJ})\b(?!\s+(?:to|with)\s+(?:the\s+team|me|us|qm+)\b)`);
const PRONOUN_SEND_WHEN = re(String.raw`^(?:${CONTACT_DIRECT}|${CONTACT_PHRASAL}|${CONTACT_SEND})\s+(?:back\b|today|now|tomorrow|asap|by\s+\w+|before\s+\w+|this\s+\w+)`);
const S1 = re(String.raw`\b(?:${OUTSIDER}|${AUDIENCE})`);
const S2 = re(String.raw`\b${PAID_THING_SKIP}$`);
const S3 = re(String.raw`\b(?:paid|premium|pro)\b`);
const S4 = re(String.raw`\b(?:image|photo|picture|font)\s+credits?$`);
const S5 = re(String.raw`\b${PAID_THING}$`);
const S6 = re(String.raw`\b(?:paid|premium|pro|business|team|enterprise|plus|annual|yearly|lifetime)\s+(?:[\w-]+\s+)?(?:version|plan|tier|account|edition|licen[cs]e|seat|seats|subscription|membership)\b`);
const S7 = re(String.raw`^upload\s+.{0,50}?\bto\s+(?=the\s|our\s|their\s|an?\s)(?:${OUTSIDER})`);
const S8 = re(String.raw`\b(?:on|to|onto)\s+(?:the\s+|our\s+)?${PUBLIC}`);
const S9 = re(String.raw`^(?:reply|respond|call|e-?mail|phone|text|answer|follow\s+up)\s*$`);
const S10 = re(String.raw`\b(?:to|with)\s+(?:them|him|her)\b`);
const S11 = re(String.raw`^(?:${CONTACT_SEND}|${CONTACT_DIRECT})\b.{0,40}\b(?:to|with)\s+(?:them|him|her)\b`);
const S12 = re(String.raw`^(?:${CONTACT_DIRECT}|send|give|show|tell)\s+(?:them|him|her)\b`);
const S13 = re(String.raw`^(?:${OUTSIDER}|each\s+\w+|every\s+\w+).{0,30}\b(?:has|have)\s+(?:okayed|ok'd|approved|agreed|confirmed|signed\s+off)\b.{0,30}\bby\s+(?:e-?mail|phone|text)`);
const S14 = re(String.raw`\b(?:${OUTSIDER}|${AUDIENCE})`);
const S15 = re(String.raw`^overwrite\s+(?:the\s+|this\s+|that\s+)?(?:[\w-]+\s+){0,2}?${CONTENT_PART}\b`);
const S16 = re(String.raw`\b(?:${DATA_THING}|old|stale|unused|merged|inactive|duplicate)\b`);
const S17 = re(String.raw`\bby\s+[\w-]+(?:\s+[\w-]+)?\s+(?:the\s+|any\s+|some\s+)?(?:[\w-]+\s+){0,2}?${CONTENT_PART}\b`);
const S18 = re(String.raw`\bof\s+(?:the\s+)?(?:[\w'-]+\s+){0,2}?(?:${CONTENT_PART}|${CONTENT_PLACE})\b`);
const S19 = re(String.raw`^${DELETE_VERB}\b`);
const S20 = re(String.raw`\b${CONTENT_PART}\b`);
const S21 = re(String.raw`\b${DATA_THING}\b`);
const S22 = re(String.raw`\b${DATA_THING}\b`);
const S23 = re(String.raw`\b${DATA_THING}\b`);
const S24 = re(String.raw`\b${CONTENT_PART}$`);
const S25 = re(String.raw`\b(?:from|in|on|of)\s+(?:the\s+|this\s+|that\s+|our\s+|my\s+|your\s+|slide\s+\d+\s+of\s+the\s+)?(?:[\w-]+\s+){0,3}?${CONTENT_PLACE}\b`);
const S26 = re(String.raw`\b${DATA_THING}$`);
const S27 = re(String.raw`^(?:all|everything|anything|the\s+lot)\b`);
const S28 = re(String.raw`\b${CONTENT_PART}\b`);
const S29 = re(String.raw`\b${DATA_THING}\b`);
const S30 = re(String.raw`\b${PUBLIC}`);
const S31 = re(String.raw`^${SHARE_VERB}\b(?:\s+(?!on\b|to\b|onto\b|in\b|into\b|at\b|across\b|via\b)[\w'"$€£.&-]+){0,10}?\s+(?:up\s+|out\s+|live\s+)?(?:on|to|onto|in|into|at|across|via|through)\s+(?:the\s+)?${PUBLIC}`);
const S32 = re(String.raw`^${SHARE_VERB}\s+(?:it|them|this|that)\s+(?:up\s+)?(?:on|to)\s+${PUBLIC}`);
const S33 = re(String.raw`\b${PUBLIC}`);
const S34 = re(String.raw`(?:\b(?:is|are|be|been|being|has\s+been|have\s+been|goes|went|gone|go)|'s|'re)\s+(?:now\s+|already\s+|fully\s+)?(?:live|public|published|tweeted|deployed|released|launched|shipped|up\s+on|out\s+on|on\s+(?:the\s+|our\s+)?${PUBLIC_PLACE}|visible\s+to\s+(?:everyone|anyone|the\s+public|visitors))\b`);
const S35 = re(String.raw`^(?:it|the\s+[\w-]+(?:\s+[\w-]+)?)(?:\s+(?:is|are)|'s|'re)\s+(?:now\s+)?(?:up\s+|live\s+)?on\s+(?:the\s+|our\s+)?${PUBLIC_PLACE}`);
const S36 = re(String.raw`(?:\b(?:is|are|be|been|being|has\s+been|have\s+been)|'s|'re)\s+(?:now\s+|already\s+)?posted\b`);
const S37 = re(String.raw`\b${PUBLIC}`);
const S38 = re(String.raw`\b${PUBLIC}`);
const S39 = re(String.raw`\b${PUBLIC}`);

// Patterns that name who is reached, built once: one for plain words, one for name placeholders.
const P1 = pair('human', (slot) => String.raw`\b(?:${slot})`);
const P2 = pair('human', (slot) => String.raw`^(?:${CONTACT_DIRECT}|${CONTACT_PHRASAL})\s+(?:back\s+|out\s+to\s+|up\s+with\s+|with\s+|again\s+|directly\s+|personally\s+|quickly\s+|now\s+)?(?:${slot})`);
const P3 = pair('human', (slot) => String.raw`^negotiate\b.{0,50}\bwith\s+(?:${slot})`);
const P4 = pair('human', (slot) => String.raw`^proceed\s+(?:the\s+|a\s+|our\s+)?(?:[\w-]+\s+){0,2}?(?:outreach|e-?mails?|calls?|follow-?ups?|reply|replies|announcement\s+e-?mail|newsletter|invites?|intro|introduction|campaign|blast|message|messages)\b.{0,40}\b(?:to|with|for)\s+(?:${slot})`);
const P5 = pair('strict', (slot) => String.raw`^${CONTACT_SEND}\b(?!\s+(?:a\s+|the\s+)?(?:banner|message|modal|pop-?up|tooltip|notice|warning|error|prompt|toast|alert)\s+to\s+users)(?:\s+(?!to\b|with\b|for\b|cc\b)[\w'"$€£.-]+){0,10}?\s+(?:over\s+|out\s+|along\s+|back\s+)?(?:to|for|cc)\s+(?:${slot})`);
const P6 = pair('strict', (slot) => String.raw`^(?:share|reshare|forward|show)\b(?!\s+(?:your|my|our|some|any)\s+(?:thoughts|feedback|ideas|notes|views|opinions|take|findings|concerns|questions)\b).{0,60}?\bwith\s+(?:${slot})`);
const P7 = pair('human', (slot) => String.raw`^(?:send|resend|forward|mail|e-?mail|text|give|show|hand|offer|tell|ask|drop|shoot|fire\s+off|get|write|pass)\s+(?:${slot})\s+(?:a|an|the|our|this|that|these|those|some|it|them|\d|"q"|quick|short|heads|details|word|news|info)\b`);
const P8 = pair('human', (slot) => String.raw`^let\s+(?:${slot}).{0,60}?\s(?:know|hear)\b`);
const P9 = pair('human', (slot) => String.raw`^(?:keep|loop|bring|add|put|cc|copy)\s+(?:in\s+)?(?:${slot})\s+(?:in\s+the\s+loop|posted|updated|informed|in\b|into\b|on\s+(?:the\s+)?(?:cc|bcc|thread|email|chain)|to\s+the\s+(?:email\s+)?(?:thread|chain|conversation|call|loop))`);
const P10 = pair('human', (slot) => String.raw`^(?:loop\s+in|cc\s+in|bring\s+in)\s+(?:${slot})`);
const P11 = pair('human', (slot) => String.raw`^(?:book|schedule|set\s+up|arrange|organi[sz]e|line\s+up|hold|run|do|have|plan|reschedule|cancel|move|accept|confirm|take|join|attend|host|lead)\s+(?:a\s+|an\s+|the\s+|our\s+|another\s+|\d+\s+)?(?:[\w-]+\s+){0,2}?(?:calls?|meetings?|demos?|chats?|interviews?|zoom|video\s+call|phone\s+screen|screens?|coffee|lunch|kickoff|kick-off|check-?ins?|walkthroughs?|sessions?|invites?|presentations?|pitch(?:es)?|intro\s+calls?|call\s+back|follow-?up)\s+(?:with|for|to)\s+(?:${slot})`);
const P12 = pair('human', (slot) => String.raw`^(?:book|schedule)\s+(?:${slot})\s+(?:in\s+)?(?:for|into)\b`);
const P13 = pair('human', (slot) => String.raw`^accept\s+(?:the\s+)?(?:${slot})\s+(?:[\w-]+\s+)?(?:invite|invitation|request)`);
const P14 = pair('human', (slot) => String.raw`^(?:enrol+|enroll|add|put|subscribe)\s+(?:${slot}).{0,40}\b(?:sequence|campaign|drip|cadence|nurture|outreach|newsletter|mailing\s+list)\b`);
const P15 = pair('who', (slot) => String.raw`(?:^|\s)${slot}\s+(?:has|have|had)?\s*(?:been\s+|was\s+|were\s+|is\s+|are\s+|gets?\s+|got\s+|(?:should|must|needs?\s+to|has\s+to|have\s+to|will|is\s+to|are\s+to)\s+be\s+)(?:all\s+|now\s+|already\s+)?${REACHED}`);
const P16 = pair('who', (slot) => String.raw`(?:^|\s)${slot}\s+(?:has|have)\s+(?:received|got|had)\b|(?:^|\s)${slot}\s+(?:has|have)\s+.{0,30}\bin\s+(?:their|his|her|its)\s+inbox\b`);
const P17 = pair('who', (slot) => String.raw`\b(?:to|with|for)\s+${slot}`);
const P18 = pair('who', (slot) => String.raw`\bshared\s+(?:it\s+)?with\s+${slot}`);
const P19 = pair('human', (slot) => String.raw`\bto\s+(?:${slot})`);
const P20 = pair('human', (slot) => String.raw`\bgo(?:es|ing)?\s+out\s+to\s+(?:${slot})`);
const P21 = pair('human', (slot) => String.raw`^(?:give|grant|share|offer)\s+(?:${slot})\s+(?:edit|view|viewer|read|write|comment|full|admin|owner|editor|guest)?\s*(?:access|rights|permissions?)\b`);
const P22 = pair('human', (slot) => String.raw`^(?:add|invite)\s+(?:${slot})\s+(?:as\s+(?:a\s+|an\s+)?(?:collaborator|viewer|editor|guest|member|admin|owner|contributor)|to\s+(?:our|the)\s+(?:shared\s+)?(?:[\w-]+\s+)?(?:figma|github|repo|drive|folder|workspace|slack|notion|file|doc|board|channel|project|org|organi[sz]ation))`);
const P23 = pair('human', (slot) => String.raw`^(?:let|allow)\s+(?:${slot})\s+(?:see|view|access|edit|look\s+at|read|into|download)\b`);
