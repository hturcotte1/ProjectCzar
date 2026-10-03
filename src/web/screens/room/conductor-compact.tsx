import type { RoomDetail } from '../../../shared/app-types';
import { linkProps } from '../../lib/router';
import { Pill, Time } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { MODE_WORDS, NextRun, RunNowButton, STATUS_WORDS, SpendBar, forcedModeLabel, sentence, spentText } from './conductor-common';
import { money } from '../../lib/format';
import './room-c.css';

/** The Conductor in the right-hand panel on wide screens: a quick look, not the whole story. */
export function ConductorCompact({ detail, onChanged }: { detail: RoomDetail; onChanged: () => void }) {
  const c = detail.conductor;
  const room = detail.room;
  const tabLink = linkProps(`/rooms/${room.id}/conductor`);
  const forced = forcedModeLabel(c);
  const last = c.last_run;

  return (
    <section className="c-compact stack" aria-labelledby="c-compact-title">
      <h2 id="c-compact-title">The Conductor</h2>

      {c.banner && !room.paused && (
        <div className="banner banner-info small" role="status">
          {c.banner}
        </div>
      )}

      <div>
        <div className="row-between" style={{ marginBottom: 3 }}>
          <span className="c-label" style={{ margin: 0 }}>
            Goal
          </span>
          <a className="small" {...tabLink}>
            Edit
          </a>
        </div>
        {room.goal.trim() ? (
          <div className="c-compact-goal c-clamp c-clamp-6">
            <SafeText text={room.goal} />
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            No goal yet. Add one so the Conductor knows what to work toward.
          </p>
        )}
      </div>

      <dl className="kv">
        <dt>Mode</dt>
        <dd>
          <strong>{MODE_WORDS[c.mode].name}</strong>
        </dd>
        {forced && (
          <>
            <dt>Right now</dt>
            <dd>
              <Pill tone="amber">{forced}</Pill>
            </dd>
          </>
        )}
      </dl>

      <div>
        <div className="c-spend-line">
          <span className="muted">Spent this month</span>
          <span>
            <strong>{spentText(c.month_spent_usd)}</strong> <span className="muted">of {money(c.month_budget_usd)}</span>
          </span>
        </div>
        <SpendBar spent={c.month_spent_usd} budget={c.month_budget_usd} />
      </div>

      <div>
        <span className="c-label">Last run</span>
        {last ? (
          <div className="c-compact-last">
            <div className="row" style={{ gap: 8 }}>
              <Pill tone={STATUS_WORDS[last.status].tone}>{STATUS_WORDS[last.status].label}</Pill>
              <Time iso={last.started_at} className="small muted" />
            </div>
            <div className="c-clamp c-clamp-3">
              <SafeText text={sentence(last.summary ?? last.skip_reason ?? last.error ?? 'No summary was written.')} />
            </div>
            <a className="small" {...tabLink}>
              Read the log
            </a>
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            It has not run in this room yet.
          </p>
        )}
        {c.pending_run_at && !room.paused && (
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>
            Next run starts <NextRun iso={c.pending_run_at} />.
          </p>
        )}
      </div>

      <RunNowButton detail={detail} onChanged={onChanged} />
    </section>
  );
}
