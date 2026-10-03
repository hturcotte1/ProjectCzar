import { Fragment } from 'react';

/**
 * Renders untrusted text (anything an agent or person wrote) as plain text, with http(s) links made
 * clickable and nothing else. Never use dangerouslySetInnerHTML for user content.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

export function SafeText({ text, className }: { text: string | null | undefined; className?: string }) {
  const value = text ?? '';
  const parts: (string | { url: string })[] = [];
  let last = 0;
  for (const m of value.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(value.slice(last, idx));
    parts.push({ url: m[0] });
    last = idx + m[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer nofollow">
            {p.url}
          </a>
        ),
      )}
    </span>
  );
}
