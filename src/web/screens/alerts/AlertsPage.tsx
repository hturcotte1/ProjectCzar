import { useState } from 'react';
import type { AlertView } from '../../../shared/app-types';
import { CopyButton, Empty, ErrorBanner, Time, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useMe } from '../../lib/me';
import { linkProps } from '../../lib/router';
import { useLoaded } from '../agents/hooks';
import { Deliveries, KindPill, rearmText } from './alert-parts';
import './alerts.css';

function AlertCard({ alert, onRead, busy }: { alert: AlertView; onRead: (id: string) => void; busy: boolean }) {
  const unread = !alert.read_at;
  const rearm = rearmText(alert.body);
  return (
    <li className={`card al-card${unread ? ' al-unread' : ''}`}>
      <div className="al-head">
        <span className={`al-dot${unread ? ' on' : ''}`} aria-hidden="true" />
        <h2 className="al-title">
          {unread && <span className="sr-only">Unread: </span>}
          {alert.title}
        </h2>
        <KindPill kind={alert.kind} />
        <Time iso={alert.created_at} className="faint small al-time" />
      </div>

      <div className="al-body">
        <SafeText text={alert.body} />
      </div>

      {rearm && (
        <div className="row al-copy">
          <CopyButton text={rearm} label="Copy the message to send" />
          <span className="faint small">Send it to the agent to wake it up.</span>
        </div>
      )}

      <div className="al-foot">
        <div className="row al-links">
          {alert.agent_id && (
            <a className="small" {...linkProps(`/agents/${alert.agent_id}`)}>
              Open the agent
            </a>
          )}
          {alert.room_id && (
            <a className="small" {...linkProps(`/rooms/${alert.room_id}`)}>
              {alert.decision_id ? 'Open the room to decide' : 'Open the room'}
            </a>
          )}
        </div>
        <Deliveries deliveries={alert.deliveries} />
        {unread && (
          <button type="button" className="btn btn-sm al-read" disabled={busy} onClick={() => onRead(alert.id)}>
            Mark as read
          </button>
        )}
      </div>
    </li>
  );
}

export function AlertsPage() {
  const { refresh } = useMe();
  const { data: alerts, error, loading, reload } = useLoaded(() => api.get<AlertView[]>('/alerts'));
  const { busy, run } = useAction();
  const [onlyUnread, setOnlyUnread] = useState(false);

  useLive((e) => {
    if (e.type === 'alert' || e.type === 'reconnected' || e.type === 'poll') void reload();
  });

  const unread = (alerts ?? []).filter((a) => !a.read_at).length;
  const shown = onlyUnread ? (alerts ?? []).filter((a) => !a.read_at) : (alerts ?? []);

  const afterChange = async () => {
    await reload();
    await refresh(); // updates the count next to "Alerts" in the sidebar
  };
  const markRead = async (id: string) => {
    const ok = await run(() => api.post(`/alerts/${id}/read`, {}));
    if (ok) await afterChange();
  };
  const markAll = async () => {
    const ok = await run(() => api.post('/alerts/read-all', {}), 'All alerts marked as read.');
    if (ok) await afterChange();
  };

  return (
    <div className="stack al-page">
      <div className="row-between">
        <p className="muted" style={{ margin: 0, maxWidth: '54ch' }}>
          Tempo tells you here when an agent goes quiet, comes back, or when something needs your decision. Alerts never include project details.
        </p>
        <button type="button" className="btn" onClick={() => void markAll()} disabled={busy || unread === 0}>
          Mark all as read
        </button>
      </div>

      {alerts && alerts.length > 0 && (
        <div className="row-between">
          <p className="small" style={{ margin: 0 }} aria-live="polite">
            {unread === 0 ? 'You are all caught up.' : unread === 1 ? '1 unread alert' : `${unread} unread alerts`}
          </p>
          <label className="check small">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
            Show only unread
          </label>
        </div>
      )}

      {error && !alerts ? <ErrorBanner error={error} /> : null}
      {loading && !alerts && <div className="muted">Loading alerts…</div>}
      {alerts && alerts.length === 0 && <Empty>No alerts yet. When something needs your attention, it will show up here.</Empty>}
      {alerts && alerts.length > 0 && shown.length === 0 && <Empty>Nothing unread.</Empty>}

      {shown.length > 0 && (
        <ul className="al-list" aria-label="Alerts, newest first">
          {shown.map((a) => (
            <AlertCard key={a.id} alert={a} onRead={(id) => void markRead(id)} busy={busy} />
          ))}
        </ul>
      )}
    </div>
  );
}
