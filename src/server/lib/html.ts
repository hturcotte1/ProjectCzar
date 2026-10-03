/**
 * Small HTML helpers for server-rendered pages (the agent page, error pages).
 *
 * The rule: text is escaped unless it has been explicitly marked safe. `html` is a tagged template
 * that escapes every interpolated value, so a page can be written as markup without anyone having
 * to remember to call escapeHtml. Always put attribute values in double quotes (escapeHtml escapes
 * double quotes, single quotes, &, < and >).
 *
 *   html`<p class="note">${agentText}</p>`      // agentText is escaped
 *   html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`   // arrays of fragments are joined
 *   html`<div>${raw('<b>trusted</b>')}</div>`   // only for markup we wrote ourselves
 */

/** A string of markup that is already safe to put in a page. Create with `html` or `raw`. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function isSafeHtml(v: unknown): v is SafeHtml {
  return v instanceof SafeHtml;
}

/** Marks markup we wrote ourselves as safe. Never pass text that came from a person or an agent. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for use in element content or in a double- or single-quoted attribute. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** Auto-escaping tagged template: every interpolated value is escaped unless it is a SafeHtml. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Joins fragments with a separator (the separator is markup we wrote, the fragments are already safe). */
export function joinHtml(parts: SafeHtml[], separator: SafeHtml | string = ''): SafeHtml {
  return new SafeHtml(parts.map((p) => p.value).join(separator instanceof SafeHtml ? separator.value : separator));
}

const URL_CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** Splits "https://x.test/a)." into the link part and the punctuation that belongs to the sentence. */
function splitTrailingPunctuation(candidate: string): [string, string] {
  let end = candidate.length;
  while (end > 0) {
    const ch = candidate[end - 1];
    if ('.,;:!?*'.includes(ch)) {
      end--;
    } else if (CLOSERS[ch]) {
      const body = candidate.slice(0, end);
      const opens = body.split(CLOSERS[ch]).length - 1;
      const closes = body.split(ch).length - 1;
      if (closes > opens) end--;
      else break;
    } else {
      break;
    }
  }
  return [candidate.slice(0, end), candidate.slice(end)];
}

/**
 * Escapes agent- or person-written text and turns http:// and https:// addresses into links.
 * Nothing else is ever turned into markup. Links carry rel="noopener noreferrer nofollow".
 * Line breaks are kept by the page's CSS (white-space: pre-wrap), not by <br>.
 */
export function linkify(text: string | null | undefined): SafeHtml {
  const source = text ?? '';
  let out = '';
  let last = 0;
  for (const m of source.matchAll(URL_CANDIDATE)) {
    const start = m.index ?? 0;
    const [candidate, trailing] = splitTrailingPunctuation(m[0]);
    let href: string | null = null;
    try {
      const u = new URL(candidate);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) href = u.href;
    } catch {
      href = null;
    }
    out += escapeHtml(source.slice(last, start));
    if (href) {
      out += `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">${escapeHtml(candidate)}</a>${escapeHtml(trailing)}`;
    } else {
      out += escapeHtml(m[0]);
    }
    last = start + m[0].length;
  }
  out += escapeHtml(source.slice(last));
  return new SafeHtml(out);
}
