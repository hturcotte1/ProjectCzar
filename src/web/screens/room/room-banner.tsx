import { useEffect, useState } from 'react';
import './room-b.css';

/** Banners this browser has already shown in full (kept per viewer; a convenience only). */
const SEEN_KEY = 'tempo-banners-seen';

function seenBanners(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The Conductor's relay banner ("the Conductor is off because...", "this month's budget is used
 * up..."). The first time someone sees a banner it is shown in full; after that it is one line with
 * a **More** button, so the feed keeps the screen. A new banner (different words) is shown in full
 * again once.
 */
export function ConductorBanner({ text }: { text: string }) {
  const [seenBefore] = useState(() => seenBanners().includes(text));
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      const seen = seenBanners();
      if (!seen.includes(text)) localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, text].slice(-10)));
    } catch {
      /* private window or storage blocked: the banner just stays in full */
    }
  }, [text]);
  const oneLine = seenBefore && !expanded;
  return (
    <div className={`banner banner-info room-banner${oneLine ? ' room-banner-short' : ''}`} role="status">
      <span className="room-banner-text">{text}</span>
      {seenBefore && (
        <button type="button" className="btn btn-ghost btn-sm room-banner-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}
