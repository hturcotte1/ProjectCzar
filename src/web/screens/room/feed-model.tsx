import type { FeedEvent } from '../../../shared/app-types';

/**
 * The feed's data rules, kept free of screens: which filters exist, how a list of events turns into
 * timeline rows (questions, instructions and decisions with their replies nested), and how live
 * events merge into what is already on screen.
 */

/** Window event the composer fires after sending, so the feed jumps to the bottom to show it. */
export const FEED_JUMP_EVENT = 'tempo-feed-jump';

// ------------------------------------------------------------------------------------ filters

export const KIND_GROUPS = [
  { id: 'report', label: 'Reports', kinds: ['report'] },
  { id: 'question', label: 'Questions', kinds: ['question', 'answer'] },
  { id: 'instruction', label: 'Instructions', kinds: ['instruction', 'proposal', 'instruction_status'] },
  { id: 'decision', label: 'Decisions', kinds: ['decision', 'decision_resolved'] },
  { id: 'conductor', label: 'Conductor', kinds: ['conductor_note', 'brief'] },
  { id: 'message', label: 'Messages', kinds: ['message', 'post'] },
  { id: 'system', label: 'System', kinds: ['system', 'playbook'] },
] as const;

export interface FeedFilters {
  /** Agent id, or '' for everyone. */
  agent: string;
  /** Ids from KIND_GROUPS; empty means every kind. */
  groups: string[];
  /** Search words. */
  q: string;
}

export const NO_FILTERS: FeedFilters = { agent: '', groups: [], q: '' };

export function filtersOn(f: FeedFilters): boolean {
  return !!f.agent || f.groups.length > 0 || !!f.q;
}

export function filterKinds(f: FeedFilters): string[] {
  return KIND_GROUPS.filter((g) => f.groups.includes(g.id)).flatMap((g) => g.kinds);
}

/** The filter part of the feed URL, starting with "&" (or empty). */
export function filterQuery(f: FeedFilters): string {
  let s = '';
  if (f.agent) s += `&agent=${encodeURIComponent(f.agent)}`;
  const kinds = filterKinds(f);
  if (kinds.length) s += `&kind=${kinds.join(',')}`;
  if (f.q) s += `&q=${encodeURIComponent(f.q)}`;
  return s;
}

/** Same rules the server applies, so live events that would not be in the list are left out. */
export function matchesFilters(ev: FeedEvent, f: FeedFilters): boolean {
  if (f.agent && !((ev.actor_kind === 'agent' && ev.actor_id === f.agent) || ev.target_agent_id === f.agent)) return false;
  const kinds = filterKinds(f);
  if (kinds.length && !kinds.includes(ev.kind)) return false;
  if (f.q) {
    const text = ev.text.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w))) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------ threads

/** Events that start a thread; their replies share the thread_id. */
const ROOT_KINDS = ['question', 'instruction', 'proposal', 'decision'];

export interface FeedRowModel {
  /** Stable across updates: "t:<thread id>" for threads, "e:<seq>" for everything else. */
  key: string;
  root: FeedEvent;
  replies: FeedEvent[];
  /** A reply whose first message is older than what is loaded (shown on its own with a hint). */
  orphan: boolean;
}

export function buildRows(events: FeedEvent[]): { rows: FeedRowModel[]; rowOfSeq: Map<number, string> } {
  const rootOf = new Map<string, FeedEvent>();
  for (const ev of events) {
    if (ev.thread_id && ROOT_KINDS.includes(ev.kind) && !rootOf.has(ev.thread_id)) rootOf.set(ev.thread_id, ev);
  }
  const repliesOf = new Map<string, FeedEvent[]>();
  const rows: FeedRowModel[] = [];
  const rowOfSeq = new Map<number, string>();
  for (const ev of events) {
    const root = ev.thread_id ? rootOf.get(ev.thread_id) : undefined;
    if (ev.thread_id && root && root !== ev) {
      const list = repliesOf.get(ev.thread_id) ?? [];
      list.push(ev);
      repliesOf.set(ev.thread_id, list);
      rowOfSeq.set(ev.seq, `t:${ev.thread_id}`);
      continue;
    }
    const isRoot = !!ev.thread_id && root === ev;
    const key = isRoot ? `t:${ev.thread_id}` : `e:${ev.seq}`;
    rowOfSeq.set(ev.seq, key);
    rows.push({ key, root: ev, replies: [], orphan: !!ev.thread_id && !isRoot });
  }
  for (const row of rows) {
    if (row.root.thread_id && !row.orphan) row.replies = repliesOf.get(row.root.thread_id) ?? [];
  }
  return { rows, rowOfSeq };
}

// ------------------------------------------------------------------------------------ merging

/**
 * Adds new events and replaces changed ones. Returns the new list, the seq numbers that are new or
 * changed, and which of those are new. Events older than the oldest loaded one are left out while earlier pages exist.
 */
export function mergeEvents(list: FeedEvent[], incoming: FeedEvent[], hasEarlier: boolean): { list: FeedEvent[]; touched: number[]; added: number[] } {
  const bySeq = new Map(list.map((e) => [e.seq, e]));
  const oldest = list.length ? list[0].seq : 0;
  const touched: number[] = [];
  const added: number[] = [];
  for (const ev of incoming) {
    const have = bySeq.get(ev.seq);
    if (have) {
      if (have.updated_at !== ev.updated_at || have.text !== ev.text) {
        bySeq.set(ev.seq, ev);
        touched.push(ev.seq);
      }
    } else if (!hasEarlier || ev.seq > oldest) {
      bySeq.set(ev.seq, ev);
      touched.push(ev.seq);
      added.push(ev.seq);
    }
  }
  if (!touched.length) return { list, touched, added };
  return { list: [...bySeq.values()].sort((a, b) => a.seq - b.seq), touched, added };
}

/** Puts an earlier page in front of the list. */
export function prependEvents(list: FeedEvent[], earlier: FeedEvent[]): FeedEvent[] {
  const have = new Set(list.map((e) => e.seq));
  return [...earlier.filter((e) => !have.has(e.seq)), ...list];
}

// ------------------------------------------------------------------------------------ small helpers

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday" or "Friday, October 3". */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return 'Today';
  if (dayKey(iso) === dayKey(new Date(now.getTime() - 86400_000).toISOString())) return 'Yesterday';
  return dayFmt.format(d);
}

export const STATUS_WORDS: Record<string, string> = {
  proposed: 'proposed',
  new: 'new',
  acknowledged: 'acknowledged',
  in_progress: 'in progress',
  blocked: 'blocked',
  done: 'done',
  declined: 'declined',
  cancelled: 'cancelled',
  rejected: 'rejected',
};

export const DOOR_WORDS: Record<string, string> = {
  mcp: 'via connector',
  rest: 'via web link',
  page: 'via private page',
  email: 'via email',
};

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
