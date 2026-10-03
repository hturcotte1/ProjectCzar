import { useSyncExternalStore } from 'react';
import { fullTime, relative } from '../../lib/format';

/**
 * One shared clock for "in 12 min" / "5 min ago" labels, so they stay fresh without every label
 * running its own timer. Ticks every 30 seconds while anything on screen is listening.
 */
let now = Date.now();
let timer: number | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (timer === null) {
    now = Date.now(); // the last tick may be long ago if nothing was on screen
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/** Re-renders the caller every 30 seconds and returns the current time. */
export function useNow(): number {
  useSyncExternalStore(subscribe, () => now, () => now);
  return Date.now();
}

/** "in 12 min" or "5 min ago", with the full date and time on hover. */
export function RelTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const t = useNow();
  if (!iso) return null;
  return (
    <time dateTime={iso} title={fullTime(iso)} className={className}>
      {relative(iso, t)}
    </time>
  );
}
