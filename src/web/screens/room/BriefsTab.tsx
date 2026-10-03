import { useEffect, useState } from 'react';
import type { BriefView, RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { Empty, ErrorBanner, Pill, Time } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { clock12, cost, daysText } from './conductor-common';
import { useRoomData } from './conductor-load';
import './room-c.css';

/** "2026-10-03" becomes "Saturday, October 3" (read as a calendar date, not shifted by time zone). */
function dayLabel(forDate: string, short = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(forDate);
  if (!m) return forDate;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat(undefined, short ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}

function Method({ brief }: { brief: BriefView }) {
  return brief.method === 'model' ? (
    <Pill tone="purple">Written by the Conductor</Pill>
  ) : (
    <span title="Put together by Tempo from the facts, without the Conductor">
      <Pill>Rules-based summary</Pill>
    </span>
  );
}

/** The daily brief: one short report per working day. The latest is shown in full, older ones fold away. */
export function BriefsTab({ roomId }: { roomId: string }) {
  const { data, error } = useRoomData<BriefView[]>(`/rooms/${roomId}/briefs`, (e) => e.type === 'room' && e.room_id === roomId && e.what === 'brief');
  const briefs = data ? [...data].sort((a, b) => b.for_date.localeCompare(a.for_date)) : null;
  const latest = briefs?.[0];
  const older = briefs?.slice(1) ?? [];

  return (
    <div className="c-page stack" style={{ gap: 16 }}>
      <header className="c-head">
        <h2>Daily brief</h2>
        <p className="c-intro">A short report for each working day: what each agent did, decisions made, open questions, blockers, what is next, how on time check-ins were, and what the Conductor spent.</p>
      </header>

      <ErrorBanner error={error} />
      {briefs === null && !error && <p className="muted">Loading the daily brief…</p>}
      {briefs && briefs.length === 0 && <NoBriefsYet roomId={roomId} />}

      {latest && (
        <section className="card c-brief" aria-labelledby="c-latest-title">
          <div>
            <span className="c-label">Latest brief</span>
            <h3 id="c-latest-title" style={{ fontSize: '1.15rem' }}>
              {dayLabel(latest.for_date)}
            </h3>
          </div>
          <div className="row small muted">
            <Method brief={latest} />
            <span>
              Written <Time iso={latest.created_at} />
            </span>
            {latest.cost_usd > 0 && <span>Cost {cost(latest.cost_usd)}</span>}
          </div>
          <div className="c-brief-text">
            <SafeText text={latest.text} />
          </div>
        </section>
      )}

      {older.length > 0 && (
        <section aria-labelledby="c-older-title" className="stack-sm">
          <h3 id="c-older-title">Earlier briefs</h3>
          <ul className="c-older">
            {older.map((b) => (
              <li key={b.id}>
                <details>
                  <summary>
                    <strong>{dayLabel(b.for_date, true)}</strong>
                    <Method brief={b} />
                  </summary>
                  <div className="c-brief-text">
                    <SafeText text={b.text} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Tells people when the first brief will show up, using the room's own brief time when we can read it. */
function NoBriefsYet({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<RoomDetail['room'] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<RoomDetail>(`/rooms/${roomId}`)
      .then((d) => live && setRoom(d.room))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [roomId]);

  return (
    <Empty>
      <p style={{ margin: 0 }}>No daily brief yet.</p>
      <p className="small faint" style={{ margin: '4px 0 0' }}>
        {room
          ? `A brief arrives at ${clock12(room.brief_time)} (${room.timezone} time), ${room.work_days.length === 7 ? 'every day' : `on working days: ${daysText(room.work_days)}`}.`
          : 'A brief arrives at the room’s brief time (7:30 am by default, in the room’s time zone) on working days.'}{' '}
        You can change that time in Settings.
      </p>
    </Empty>
  );
}
