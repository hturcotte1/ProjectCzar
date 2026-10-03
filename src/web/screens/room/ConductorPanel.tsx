import type { ConductorRunView, RoomDetail } from '../../../shared/app-types';
import { ErrorBanner } from '../../components/ui';
import { ConductorCompact } from './conductor-compact';
import { RunNowButton } from './conductor-common';
import { GoalEditor } from './conductor-goal';
import { useRoomData } from './conductor-load';
import { RunLog } from './conductor-log';
import { ModeChoices } from './conductor-mode';
import { UsageCard } from './conductor-usage';
import './room-c.css';

/**
 * The Conductor: a quick look in the right-hand panel (compact), or the whole story as a tab
 * (goal, mode, budget and the log of every run).
 */
export function ConductorPanel({ detail, onChanged, compact }: { detail: RoomDetail; onChanged: () => void; compact?: boolean }) {
  if (compact) return <ConductorCompact detail={detail} onChanged={onChanged} />;
  return <ConductorFull detail={detail} onChanged={onChanged} />;
}

function ConductorFull({ detail, onChanged }: { detail: RoomDetail; onChanged: () => void }) {
  const roomId = detail.room.id;
  const { data, error, reload } = useRoomData<{ runs: ConductorRunView[] }>(`/rooms/${roomId}/conductor`, (e) => (e.type === 'conductor' || e.type === 'room') && e.room_id === roomId);

  // Anything that changes the room also changes what the log shows (a new goal or mode triggers a run).
  const changed = async () => {
    await Promise.resolve(onChanged());
    await reload();
  };

  return (
    <div className="c-page stack" style={{ gap: 18 }}>
      <header className="c-head">
        <h2>The Conductor</h2>
        <p className="c-intro">
          The Conductor reads what your agents report and writes their next instructions. It stays inside this room's limits and never makes up facts. Everything it does is written down in the log below.
        </p>
      </header>

      <section className="card" aria-labelledby="c-goal-title">
        <div className="c-card-title">
          <h3 id="c-goal-title">Goal</h3>
        </div>
        <GoalEditor roomId={roomId} goal={detail.room.goal} onChanged={changed} />
      </section>

      <section className="card" aria-labelledby="c-mode-title">
        <div className="c-card-title">
          <h3 id="c-mode-title">Mode</h3>
        </div>
        <ModeChoices detail={detail} onChanged={changed} />
      </section>

      <section className="card" aria-labelledby="c-usage-title">
        <div className="c-card-title">
          <h3 id="c-usage-title">Cost and activity</h3>
        </div>
        <UsageCard summary={detail.conductor} />
        <hr className="divider" />
        <div className="stack-sm">
          <p className="small muted" style={{ margin: 0 }}>
            The Conductor looks at the room by itself when something happens. You can also ask it to look right now.
          </p>
          <RunNowButton detail={detail} onChanged={changed} />
        </div>
      </section>

      <section aria-labelledby="c-log-title" className="stack">
        <div>
          <h3 id="c-log-title">Conductor log</h3>
          <p className="small muted" style={{ margin: '3px 0 0' }}>
            Newest first. Open a run to see what woke it up, what it saw, what it decided and why, and what it cost.
          </p>
        </div>
        <ErrorBanner error={error} />
        <div aria-live="polite">
          <RunLog runs={data?.runs ?? null} />
        </div>
      </section>
    </div>
  );
}
