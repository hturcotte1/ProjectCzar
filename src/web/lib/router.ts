import { useEffect, useState } from 'react';

/** A tiny history-based router: usePath() re-renders on navigation; navigate() changes the URL. */
const listeners = new Set<() => void>();

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  listeners.forEach((fn) => fn());
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => listeners.forEach((fn) => fn()));

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const fn = () => setPath(window.location.pathname);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return path;
}

/** Matches "/rooms/:id/:tab?" style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const part = p[i];
    const optional = part.endsWith('?');
    const name = part.replace(/^:/, '').replace(/\?$/, '');
    if (part.startsWith(':')) {
      if (s[i] === undefined) {
        if (optional) continue;
        return null;
      }
      params[name] = decodeURIComponent(s[i]);
    } else if (s[i] !== part) return null;
  }
  if (s.length > p.length) return null;
  return params;
}

/** A link that navigates without a page reload. */
export function linkProps(to: string): { href: string; onClick: (e: React.MouseEvent) => void } {
  return {
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
