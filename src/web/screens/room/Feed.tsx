import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FeedEvent, FeedPage, RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { ErrorBanner, useToast } from '../../components/ui';
import { FilterBar } from './feed-filters';
import { FeedRowView, mentionPattern, type ItemEnv } from './feed-items';
import {
  FEED_JUMP_EVENT,
  NO_FILTERS,
  buildRows,
  dayKey,
  dayLabel,
  filterQuery,
  filtersOn,
  matchesFilters,
  mergeEvents,
  prefersReducedMotion,
  prependEvents,
  type FeedFilters,
} from './feed-model';
import './feed.css';

type Intent = { type: 'bottom' } | { type: 'keep'; height: number; top: number };
interface Unseen {
  key: string;
  /** The changed row is above what the person is looking at. */
  up: boolean;
}

function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return on;
}

function findRow(scroller: HTMLElement, key: string): HTMLElement | null {
  for (const n of scroller.querySelectorAll<HTMLElement>('[data-row]')) if (n.dataset.row === key) return n;
  return null;
}

/** 'in' when any part of the row is on screen, otherwise which side it is on. */
function whereIs(scroller: HTMLElement, key: string): 'in' | 'above' | 'below' | null {
  const node = findRow(scroller, key);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const c = scroller.getBoundingClientRect();
  if (r.bottom <= c.top + 4) return 'above';
  if (r.top >= c.bottom - 4) return 'below';
  return 'in';
}

/**
 * The room's live timeline: newest at the bottom, replies nested under their question, instruction
 * or decision, filters and search above, and new activity arriving without a refresh.
 */
export function Feed({ detail }: { detail: RoomDetail }) {
  const roomId = detail.room.id;
  const toast = useToast();
  const narrow = useMediaQuery('(max-width: 1180px)');

  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [unseen, setUnseen] = useState<Unseen[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<FeedEvent[]>([]);
  const hasMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const unseenRef = useRef<Unseen[]>([]);
  unseenRef.current = unseen;
  const loadToken = useRef(0);
  const loadingRef = useRef(true);
  const intent = useRef<Intent | null>({ type: 'bottom' });
  const atBottom = useRef(true);
  /** Live changes waiting to be checked against the screen: seq -> whether the event is new. */
  const flagged = useRef(new Map<number, boolean>());
  const catching = useRef(false);
  const polls = useRef(0);
  const mounted = useRef(true);

  const query = useMemo(() => filterQuery(filters), [filters]);
  const { rows, rowOfSeq } = useMemo(() => buildRows(events), [events]);
  const rowRootSeq = useMemo(() => new Map(rows.map((r) => [r.key, r.root.seq])), [rows]);

  // The single place the list changes, so refs and state never disagree.
  const commit = useCallback((next: FeedEvent[]) => {
    eventsRef.current = next;
    setEvents(next);
  }, []);

  const setMore = (v: boolean) => {
    hasMoreRef.current = v;
    setHasMore(v);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A different room starts from scratch.
  useEffect(() => {
    commit([]);
    setMore(false);
    setUnseen([]);
    setSearch('');
    setFilters(NO_FILTERS);
    intent.current = { type: 'bottom' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Search words apply 300 ms after typing stops.
  useEffect(() => {
    const q = search.trim();
    if (q === filters.q) return;
    const t = window.setTimeout(() => setFilters((f) => ({ ...f, q })), 300);
    return () => window.clearTimeout(t);
  }, [search, filters.q]);

  // ---------------------------------------------------------------- loading

  /** Pulls in anything newer than what is on screen (and, now and then, edits to recent items). */
  const catchUp = useCallback(
    async (refreshTail: boolean) => {
      if (catching.current || loadingRef.current) return;
      catching.current = true;
      const token = loadToken.current;
      const q = filterQuery(filtersRef.current);
      try {
        for (let guard = 0; guard < 5; guard++) {
          const list = eventsRef.current;
          const newest = list.length ? list[list.length - 1].seq : 0;
          const page = await api.get<FeedPage>(`/rooms/${roomId}/feed?limit=200&after=${newest}${q}`);
          if (token !== loadToken.current) return;
          applyIncoming(page.events);
          if (!page.has_more || !page.events.length) break;
        }
        if (refreshTail) {
          const tail = await api.get<FeedPage>(`/rooms/${roomId}/feed?limit=50${q}`);
          if (token === loadToken.current) applyIncoming(tail.events);
        }
      } catch {
        /* the next poll or reconnect tries again */
      } finally {
        catching.current = false;
      }
    },
    // applyIncoming only touches refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomId],
  );

  function applyIncoming(incoming: FeedEvent[]) {
    const { list, touched, added } = mergeEvents(eventsRef.current, incoming, hasMoreRef.current);
    if (!touched.length) return;
    touched.forEach((s) => flagged.current.set(s, added.includes(s)));
    commit(list);
  }

  useEffect(() => {
    const token = ++loadToken.current;
    loadingRef.current = true;
    setStatus('loading');
    setError(null);
    api.get<FeedPage>(`/rooms/${roomId}/feed?limit=50${query}`).then(
      (page) => {
        if (token !== loadToken.current) return;
        loadingRef.current = false;
        intent.current = { type: 'bottom' };
        commit(page.events);
        setMore(page.has_more);
        setStatus('ready');
        void catchUp(false); // anything that arrived while the page was loading
      },
      (e) => {
        if (token !== loadToken.current) return;
        loadingRef.current = false;
        setError(e);
        setStatus('error');
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, query, reload]);

  const loadEarlier = async () => {
    const first = eventsRef.current[0];
    const el = scrollRef.current;
    if (!first || !el || loadingMore) return;
    setLoadingMore(true);
    const token = loadToken.current;
    try {
      const page = await api.get<FeedPage>(`/rooms/${roomId}/feed?limit=50&before=${first.seq}${query}`);
      if (token !== loadToken.current) return;
      intent.current = { type: 'keep', height: el.scrollHeight, top: el.scrollTop };
      commit(prependEvents(eventsRef.current, page.events));
      setMore(page.has_more);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load earlier items.', true);
    } finally {
      setLoadingMore(false);
    }
  };

  // ---------------------------------------------------------------- live

  useLive((e) => {
    if (e.type === 'feed') {
      if (e.room_id !== roomId || loadingRef.current) return;
      if (!matchesFilters(e.event, filtersRef.current)) return;
      applyIncoming([e.event]);
    } else if (e.type === 'poll') {
      polls.current++;
      void catchUp(polls.current % 4 === 0);
    } else if (e.type === 'reconnected') {
      void catchUp(true);
    }
  });

  // ---------------------------------------------------------------- scrolling

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const it = intent.current;
    if (it?.type === 'bottom') {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    } else if (it?.type === 'keep') {
      el.scrollTop = it.top + (el.scrollHeight - it.height);
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    intent.current = null;
  }, [events, status]);

  const flash = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setFresh((prev) => new Set([...prev, ...keys]));
    window.setTimeout(() => {
      if (mounted.current) setFresh((prev) => new Set([...prev].filter((k) => !keys.includes(k))));
    }, 3500);
  }, []);

  // After live changes are on screen: highlight what is visible, count what is out of sight.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !flagged.current.size) return;
    // A brand-new row that the feed scrolled to by itself needs no "N new" button; a reply that
    // landed in an older thread does, if that thread is out of sight.
    const keys = new Map<string, boolean>();
    flagged.current.forEach((isNew, seq) => {
      const k = rowOfSeq.get(seq);
      if (!k) return;
      const newRow = isNew && rowRootSeq.get(k) === seq;
      keys.set(k, (keys.get(k) ?? true) && newRow);
    });
    flagged.current.clear();
    const inView: string[] = [];
    const hidden: Unseen[] = [];
    keys.forEach((newRow, key) => {
      const w = whereIs(el, key);
      if (w === 'in') inView.push(key);
      else if (w && !(newRow && atBottom.current)) hidden.push({ key, up: w === 'above' });
    });
    flash(inView);
    if (hidden.length) setUnseen((prev) => [...prev.filter((p) => !hidden.some((h) => h.key === p.key)), ...hidden]);
  }, [events, rowOfSeq, rowRootSeq, flash]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (unseenRef.current.length) {
      const still = unseenRef.current.filter((u) => whereIs(el, u.key) !== 'in');
      if (still.length !== unseenRef.current.length) setUnseen(still);
    }
  };

  const behavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');

  const jumpToNew = () => {
    const el = scrollRef.current;
    if (!el) return;
    const above = unseen.find((u) => u.up);
    const node = above ? findRow(el, above.key) : null;
    if (node) {
      node.scrollIntoView({ block: 'center', behavior: behavior() });
      flash([above!.key]);
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: behavior() });
    }
    setUnseen([]);
  };

  // After the composer sends, show the person their own message even if they had scrolled up.
  useEffect(() => {
    const fn = () => {
      atBottom.current = true;
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: behavior() });
    };
    window.addEventListener(FEED_JUMP_EVENT, fn);
    return () => window.removeEventListener(FEED_JUMP_EVENT, fn);
  }, []);

  // ---------------------------------------------------------------- filters

  const toggleGroup = (id: string) => setFilters((f) => ({ ...f, groups: f.groups.includes(id) ? f.groups.filter((g) => g !== id) : [...f.groups, id] }));
  const clearFilters = () => {
    setSearch('');
    setFilters(NO_FILTERS);
  };

  // ---------------------------------------------------------------- render

  const nameKey = [...detail.agents.map((a) => a.name), ...detail.people.map((p) => p.name), 'Conductor'].join('\n');
  const mentionRe = useMemo(() => mentionPattern(nameKey.split('\n')), [nameKey]);
  const env: ItemEnv = { roomId, mentionRe, complete: !filters.groups.length && !filters.q, narrow, fresh };
  const filtered = filtersOn(filters);

  let prevDay = '';
  const timeline = rows.map((row) => {
    const day = dayKey(row.root.created_at);
    const newDay = day !== prevDay;
    prevDay = day;
    return (
      <Fragment key={row.key}>
        {newDay && (
          <div className="feed-day" role="separator">
            <span>{dayLabel(row.root.created_at)}</span>
          </div>
        )}
        <FeedRowView row={row} env={env} />
      </Fragment>
    );
  });

  return (
    <div className="feed-wrap">
      <FilterBar
        agents={detail.agents}
        filters={filters}
        search={search}
        onSearch={setSearch}
        onAgent={(agent) => setFilters((f) => ({ ...f, agent }))}
        onToggleGroup={toggleGroup}
        onClear={clearFilters}
      />
      <div className="feed-stage">
        <div
          ref={scrollRef}
          className={`feed${status === 'loading' && events.length ? ' feed-dim' : ''}`}
          onScroll={onScroll}
          role="log"
          aria-label="Room activity"
          aria-live="polite"
          aria-busy={status === 'loading'}
          tabIndex={0}
        >
          {status === 'error' && !events.length && (
            <div className="stack feed-error">
              <ErrorBanner error={error} />
              <div>
                <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>
                  Try again
                </button>
              </div>
            </div>
          )}
          {status === 'loading' && !events.length && (
            <div className="empty" role="status">
              Loading the feed…
            </div>
          )}
          {status === 'ready' && !events.length && (
            <div className="empty">
              {filtered ? (
                <>
                  <p>Nothing matches these filters.</p>
                  <button type="button" className="btn btn-sm" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              ) : (
                'Nothing here yet. When agents check in, their reports appear here.'
              )}
            </div>
          )}
          {events.length > 0 && (
            <>
              {hasMore ? (
                <div className="feed-earlier">
                  <button type="button" className="btn btn-sm" disabled={loadingMore} onClick={() => void loadEarlier()}>
                    {loadingMore ? 'Loading…' : 'Load earlier'}
                  </button>
                </div>
              ) : (
                !filtered && <div className="feed-start">This is the start of the room.</div>
              )}
              {timeline}
            </>
          )}
        </div>
        <div className="feed-newwrap" role="status">
          {unseen.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm feed-newpill" onClick={jumpToNew}>
              {unseen.length} new {unseen.every((u) => u.up) ? '↑' : '↓'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
