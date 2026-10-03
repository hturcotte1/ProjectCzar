import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionLogEntry } from '../../../shared/app-types';
import { Empty, ErrorBanner, Pill } from '../../components/ui';
import { api } from '../../lib/api';
import { fullTime } from '../../lib/format';
import { useLive } from '../../lib/live';
import { useLoaded } from './hooks';

/**
 * The connection log: every request an agent made, newest first, with exactly the text it was shown.
 * This is how a first connection gets debugged, so rejected and failed requests stand out and the
 * message is never cut short.
 */

const DOORS: Record<string, string> = { mcp: 'Tool connection (mcp)', rest: 'Web request (rest)', page: 'Private page' };
const RESULTS: Record<ConnectionLogEntry['result'], { word: string; tone: 'green' | 'amber' | 'red' }> = {
  ok: { word: 'OK', tone: 'green' },
  rejected: { word: 'Rejected', tone: 'amber' },
  error: { word: 'Error', tone: 'red' },
};

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** "2:15:07 PM" today, "Oct 3, 2:15:07 PM" on other days. */
function stamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return today ? clockFmt.format(d) : `${dayFmt.format(d)}, ${clockFmt.format(d)}`;
}

export function ConnectionEntries({ entries, showKey }: { entries: ConnectionLogEntry[]; showKey?: boolean }) {
  return (
    <ol className="ag-log" aria-label="Requests, newest first">
      {entries.map((e) => {
        const r = RESULTS[e.result] ?? { word: e.result, tone: 'amber' as const };
        return (
          <li key={e.id} className={`ag-log-row ag-log-${e.result}`}>
            <div className="ag-log-top">
              <time dateTime={e.at} title={fullTime(e.at)} className="ag-log-time">
                {stamp(e.at)}
              </time>
              <Pill tone={r.tone}>{r.word}</Pill>
              <span className="ag-log-door">{DOORS[e.door] ?? e.door}</span>
              <code className="ag-log-action">{e.action}</code>
              {e.http_status !== null && <span className="faint small">HTTP {e.http_status}</span>}
              {e.duration_ms !== null && <span className="faint tiny">{e.duration_ms} ms</span>}
            </div>
            <div className="ag-log-msg">{e.message ? e.message : <span className="faint">No message was shown.</span>}</div>
            {(e.client || (showKey && e.key_hint) || e.card_id) && (
              <div className="ag-log-meta">
                {showKey && e.key_hint && <span>Key tried: {e.key_hint}</span>}
                {e.card_id && <span>Card {e.card_id}</span>}
                {e.client && <span>{e.client}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The agent's own log. Refreshes every 5 seconds while the page is open, and when the agent does something. */
export function ConnectionLog({ agentId }: { agentId: string }) {
  const { data, error, loading, reload } = useLoaded(() => api.get<ConnectionLogEntry[]>(`/agents/${agentId}/connections?limit=100`), [agentId]);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const newest = useRef<number | null>(null);

  // Tell screen readers when new requests arrive (not on the first load).
  useEffect(() => {
    if (!data) return;
    const top = data.length ? data[0].id : 0;
    if (newest.current !== null && top > newest.current) {
      const fresh = data.filter((e) => e.id > newest.current!).length;
      setAnnounce(fresh === 1 ? '1 new request' : `${fresh} new requests`);
    }
    newest.current = Math.max(top, newest.current ?? 0);
    setUpdatedAt(new Date().toISOString());
  }, [data]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 5000);
    return () => window.clearInterval(t);
  }, [reload]);

  const soon = useRef<number | null>(null);
  const refreshSoon = useCallback(() => {
    if (soon.current) return;
    soon.current = window.setTimeout(() => {
      soon.current = null;
      void reload();
    }, 300);
  }, [reload]);
  useEffect(() => () => void (soon.current && window.clearTimeout(soon.current)), []);
  useLive((e) => {
    if ((e.type === 'agent' && e.agent_id === agentId) || e.type === 'reconnected') refreshSoon();
  });

  const entries = data ?? [];
  const problems = entries.filter((e) => e.result !== 'ok').length;
  const shown = problemsOnly ? entries.filter((e) => e.result !== 'ok') : entries;

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted small" style={{ margin: 0, maxWidth: '60ch' }}>
          Every time your agent talks to Tempo it shows up here, with the exact words Tempo showed it. Newest first. Updates by itself every 5 seconds
          {updatedAt && <> (last checked {clockFmt.format(new Date(updatedAt))})</>}.
        </p>
        <div className="ag-seg" role="group" aria-label="Which requests to show">
          <button type="button" className={`btn btn-sm${!problemsOnly ? ' ag-seg-on' : ''}`} aria-pressed={!problemsOnly} onClick={() => setProblemsOnly(false)}>
            All ({entries.length})
          </button>
          <button type="button" className={`btn btn-sm${problemsOnly ? ' ag-seg-on' : ''}`} aria-pressed={problemsOnly} onClick={() => setProblemsOnly(true)}>
            Problems only ({problems})
          </button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {error && !data ? <ErrorBanner error={error} /> : null}
      {loading && !data && <div className="muted">Loading the log…</div>}
      {data && shown.length === 0 && (
        <Empty>
          {problemsOnly ? (
            'No problems. Every request worked.'
          ) : (
            <>
              Nothing yet. When your agent first talks to Tempo, it will appear here.
              <br />
              <span className="small">If it says it tried but nothing shows up, it may be using a key Tempo doesn't recognize. An admin can see those under Settings, then Activity.</span>
            </>
          )}
        </Empty>
      )}
      {shown.length > 0 && <ConnectionEntries entries={shown} />}
    </div>
  );
}
