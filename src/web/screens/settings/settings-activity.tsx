import { useEffect, useMemo, useState } from 'react';
import type { AuditEntry, ConnectionLogEntry } from '../../../shared/app-types';
import { Empty, ErrorBanner, Time } from '../../components/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { ConnectionEntries } from '../agents/connection-log';
import { useLoaded } from '../agents/hooks';
import { Card } from './settings-card';

// ------------------------------------------------------------------------------ audit log
const ACTION_WORDS: Record<string, string> = {
  'person.login': 'signed in',
  'person.create_admin': 'created the first admin account',
  'person.password_change': 'changed a password',
  'person.update': 'updated a profile',
  'person.disable': 'turned off an account',
  'invite.create': 'made an invite link',
  'invite.accept': 'accepted an invite',
  'invite.revoke': 'withdrew an invite',
  'agent.create': 'added an agent',
  'agent.update': 'changed an agent',
  'agent.archive': 'removed an agent',
  'key.rotate': 'made a new agent key',
  'key.revoke': 'turned off an agent key',
  'page_link.rotate': 'made a new agent page link',
  'page_link.revoke': 'turned off an agent page link',
  'room.create': 'created a room',
  'room.update': 'changed room settings',
  'room.pause': 'paused a room',
  'room.resume': 'resumed a room',
  'room.add_agent': 'added an agent to a room',
  'room.remove_agent': 'took an agent out of a room',
  'room.add_person': 'added a person to a room',
  'room.remove_person': 'took a person out of a room',
  'room.export': "exported a room's history",
  'decision.resolve': 'settled a decision',
  'decision.dismiss': 'dismissed a decision',
  'instruction.create': 'gave an instruction',
  'instruction.cancel': 'cancelled an instruction',
  'proposal.approve': 'approved a proposed instruction',
  'proposal.reject': 'turned down a proposed instruction',
  'question.answer': 'answered a question',
  'playbook.create': 'added a playbook lesson',
  'playbook.update': 'edited a playbook lesson',
  'playbook.archive': 'removed a playbook lesson',
  'backup.download': 'downloaded a backup',
};

function actionWords(action: string): string {
  return ACTION_WORDS[action] ?? action.replace(/[._]/g, ' ');
}

/** "name: Muse Henry · type: muse" from the saved details, skipping anything that is not simple text. */
function detailsText(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    let text: string | null = null;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) text = value.join(', ');
    if (text) parts.push(`${key.replace(/_/g, ' ')}: ${text.length > 100 ? `${text.slice(0, 100)}…` : text}`);
  }
  return parts.join(' · ');
}

const PAGE = 40;

function AuditCard() {
  const { me } = useMe();
  const { data: entries, error, loading } = useLoaded(() => api.get<AuditEntry[]>('/audit'));
  const [shown, setShown] = useState(PAGE);
  const roomName = useMemo(() => new Map(me.rooms.map((r) => [r.id, r.name])), [me.rooms]);
  const admin = me.person.role === 'admin';

  return (
    <Card
      id="st-audit"
      title="Activity log"
      intro={admin ? 'Who did what in Tempo, newest first. This is a record of changes, not of room conversations.' : 'Changes you made, and changes in your rooms, newest first.'}
    >
      {error && !entries ? <ErrorBanner error={error} /> : null}
      {loading && !entries && <div className="muted">Loading the activity log…</div>}
      {entries && entries.length === 0 && <Empty>Nothing has been recorded yet.</Empty>}
      {entries && entries.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table st-audit">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, shown).map((a) => {
                  const room = a.room_id ? roomName.get(a.room_id) : null;
                  const detail = detailsText(a.details);
                  return (
                    <tr key={a.id}>
                      <td className="st-audit-when">
                        <Time iso={a.at} />
                      </td>
                      <td>{a.actor_name ?? 'Tempo'}</td>
                      <td>
                        <span>{actionWords(a.action)}</span>
                        {room && <span className="muted"> in {room}</span>}
                        {detail && <div className="faint tiny st-audit-detail">{detail}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {entries.length > shown && (
            <div>
              <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({entries.length - shown} older)
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------ unmatched requests
function UnmatchedCard() {
  const { data, error, loading, reload } = useLoaded(() => api.get<ConnectionLogEntry[]>('/connections/unmatched'));
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 5000);
    return () => window.clearInterval(t);
  }, [reload]);

  return (
    <Card
      id="st-unmatched"
      title="Requests Tempo doesn't recognize"
      intro="These came with a key that Tempo doesn't know. Usually an agent is using an old, mistyped or turned-off key. Newest first; this list updates by itself every 5 seconds."
    >
      {error && !data ? <ErrorBanner error={error} /> : null}
      {loading && !data && <div className="muted">Loading…</div>}
      {data && data.length === 0 && <Empty>None. Every request so far came with a key Tempo knows.</Empty>}
      {data && data.length > 0 && <ConnectionEntries entries={data} showKey />}
    </Card>
  );
}

export function ActivitySection() {
  const { me } = useMe();
  return (
    <div className="stack">
      {me.person.role === 'admin' && <UnmatchedCard />}
      <AuditCard />
    </div>
  );
}
