import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { linkProps } from '../../lib/router';
import { useMediaQuery } from '../../lib/media';
import { ErrorBanner, Light, useAction } from '../../components/ui';
import { TopBar } from '../../App';
import { AgentStrip } from './AgentStrip';
import { Feed } from './Feed';
import { Composer } from './Composer';
import { Lanes } from './Lanes';
import { DecisionsPanel } from './DecisionsPanel';
import { ConductorPanel } from './ConductorPanel';
import { PlaybookTab } from './PlaybookTab';
import { BriefsTab } from './BriefsTab';
import { HealthTab } from './HealthTab';
import { RoomSettings } from './RoomSettings';
import { ConductorBanner } from './room-banner';

/**
 * One room: agent strip on top, the live feed (with the composer) in the middle, and on wide
 * screens a right-hand panel with what is waiting on people and the Conductor. On narrow screens
 * the panel's contents become tabs.
 */
const TABS: { id: string; label: string; wideHidden?: boolean }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'now', label: 'Working now' },
  { id: 'decisions', label: 'Waiting on you', wideHidden: true },
  { id: 'conductor', label: 'Conductor' },
  { id: 'playbook', label: 'Playbook' },
  { id: 'briefs', label: 'Daily brief' },
  { id: 'health', label: 'Health' },
  { id: 'settings', label: 'Settings' },
];

export function RoomPage({ roomId, tab, onMenu }: { roomId: string; tab: string; onMenu: () => void }) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const wide = useMediaQuery('(min-width: 1181px)');
  const { busy, run } = useAction();
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<RoomDetail>(`/rooms/${roomId}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [roomId]);

  // Refresh the room summary shortly after anything changes (coalescing bursts of events).
  const soon = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 250);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [load]);

  useLive((e) => {
    if (e.type === 'poll' || e.type === 'reconnected') return soon();
    if ((e.type === 'room' || e.type === 'decision' || e.type === 'conductor') && e.room_id === roomId) return soon();
    if (e.type === 'agent' && e.room_ids.includes(roomId)) return soon();
    if (e.type === 'feed' && e.room_id === roomId && ['report', 'instruction', 'instruction_status', 'question', 'answer', 'proposal', 'decision', 'decision_resolved', 'system'].includes(e.event.kind)) soon();
  });

  if (error && !detail) {
    return (
      <>
        <TopBar title="Room" onMenu={onMenu} />
        <div className="page">
          <ErrorBanner error={error} />
        </div>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <TopBar title="Loading…" onMenu={onMenu} />
        <div className="page muted">Loading the room…</div>
      </>
    );
  }

  const room = detail.room;
  const waiting = detail.decisions.filter((d) => d.status === 'open').length + detail.proposals.length + detail.questions_for_people.length;
  const active = TABS.some((t) => t.id === tab) && !(wide && tab === 'decisions') ? tab : 'feed';
  const worst = detail.agents.some((a) => a.status === 'red') ? 'red' : detail.agents.some((a) => a.status === 'amber') ? 'amber' : detail.agents.some((a) => a.status === 'green') ? 'green' : 'gray';

  return (
    <>
      <TopBar
        title={
          <span className="row" style={{ gap: 8 }}>
            <Light light={room.paused ? 'gray' : worst} large />
            {room.name}
            {room.is_sandbox && <span className="pill pill-purple">sandbox</span>}
            {room.paused && <span className="pill pill-amber">paused</span>}
          </span>
        }
        onMenu={onMenu}
      >
        <button
          type="button"
          className={`btn btn-sm${room.paused ? ' btn-primary' : ''}`}
          disabled={busy}
          onClick={() => run(async () => {
            await api.post(`/rooms/${room.id}/${room.paused ? 'resume' : 'pause'}`, {});
            await load();
          }, room.paused ? 'Room resumed' : 'Room paused')}
          title={room.paused ? 'Agents get their work again and the Conductor runs' : 'Agents are told to do nothing here and the Conductor issues nothing'}
        >
          {room.paused ? 'Resume' : 'Pause all'}
        </button>
      </TopBar>

      {room.paused && (
        <div className="banner banner-warn" style={{ margin: '10px 16px 0' }}>
          This room is paused{room.paused_by_name ? ` by ${room.paused_by_name}` : ''}. Cards tell its agents to do nothing here, and the Conductor issues nothing, until you resume it.
        </div>
      )}
      {detail.conductor.banner && !room.paused && <ConductorBanner key={detail.conductor.banner} text={detail.conductor.banner} />}

      <AgentStrip agents={detail.agents} />

      <div className="tabs" role="tablist">
        {TABS.filter((t) => !(wide && t.wideHidden)).map((t) => (
          <a key={t.id} role="tab" aria-selected={active === t.id} className={`tab${active === t.id ? ' active' : ''}`} {...linkProps(`/rooms/${room.id}/${t.id === 'feed' ? '' : t.id}`.replace(/\/$/, ''))}>
            {t.label}
            {t.id === 'decisions' && waiting > 0 && <span className="pill pill-accent">{waiting}</span>}
          </a>
        ))}
      </div>

      <div className="room-layout">
        <div className="room-center">
          {active === 'feed' && (
            <>
              <Feed detail={detail} />
              <Composer detail={detail} />
            </>
          )}
          {active !== 'feed' && (
            <div className="page">
              {active === 'now' && <Lanes detail={detail} />}
              {active === 'decisions' && <DecisionsPanel detail={detail} onChanged={load} />}
              {active === 'conductor' && <ConductorPanel detail={detail} onChanged={load} />}
              {active === 'playbook' && <PlaybookTab roomId={room.id} />}
              {active === 'briefs' && <BriefsTab roomId={room.id} />}
              {active === 'health' && <HealthTab roomId={room.id} />}
              {active === 'settings' && <RoomSettings detail={detail} onChanged={load} />}
            </div>
          )}
        </div>
        {wide && (
          <aside className="room-panel desktop-only" aria-label="Waiting on people and the Conductor">
            <div className="panel-body stack">
              <DecisionsPanel detail={detail} onChanged={load} />
              <hr className="divider" />
              <ConductorPanel detail={detail} onChanged={load} compact />
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
