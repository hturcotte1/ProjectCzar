import type { RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { useAction } from '../../components/ui';
import { RoomForm } from './settings-form';
import { AgentsCard, PeopleCard } from './settings-members';
import './room-c.css';

/**
 * Everything about the room itself: its details and rules, who and what is in it, pausing, and
 * a download of its history. Each setting says in one sentence what it does.
 */
export function RoomSettings({ detail, onChanged }: { detail: RoomDetail; onChanged: () => void }) {
  const room = detail.room;
  const { busy, run } = useAction();

  return (
    <div className="c-page c-settings stack" style={{ gap: 18 }}>
      <header className="c-head">
        <h2>Room settings</h2>
        <p className="c-intro">Anyone in this room can change these. Changes apply straight away, and the feed notes when rules or limits change.</p>
      </header>

      <RoomForm room={room} onChanged={onChanged} />
      <PeopleCard detail={detail} onChanged={onChanged} />
      <AgentsCard detail={detail} onChanged={onChanged} />

      <section className="card c-danger-zone" aria-labelledby="c-set-pause">
        <div className="c-card-title">
          <h3 id="c-set-pause">{room.paused ? 'This room is paused' : 'Pause this room'}</h3>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          {room.paused
            ? `Paused${room.paused_by_name ? ` by ${room.paused_by_name}` : ''}. Agents are told to do nothing here and the Conductor issues nothing. Resume to start things moving again.`
            : 'Agents are told to do nothing here and the Conductor issues nothing, until you resume. Use it when something is going wrong and you need everything to stop.'}
        </p>
        <button
          type="button"
          className={`btn${room.paused ? ' btn-primary' : ''}`}
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.post(`/rooms/${room.id}/${room.paused ? 'resume' : 'pause'}`, {});
              await Promise.resolve(onChanged());
            }, room.paused ? 'Room resumed' : 'Room paused')
          }
        >
          {busy ? 'Working…' : room.paused ? 'Resume the room' : 'Pause the room'}
        </button>
      </section>

      <section className="card" aria-labelledby="c-set-export">
        <div className="c-card-title">
          <h3 id="c-set-export">Download this room's history</h3>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          Saves everything in this room as one file: the feed, reports, questions, instructions, decisions, playbook, daily briefs and the Conductor's log. Keep it as a backup or open it in another tool.
        </p>
        <a className="btn" href={`/api/app/rooms/${encodeURIComponent(room.id)}/export`} download>
          Download history
        </a>
      </section>
    </div>
  );
}
