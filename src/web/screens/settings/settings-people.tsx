import { useState } from 'react';
import type { InviteView, PersonListEntry } from '../../../shared/app-types';
import { CopyButton, Empty, ErrorBanner, Pill, Time, useAction } from '../../components/ui';
import { api } from '../../lib/api';
import { fullTime } from '../../lib/format';
import { useMe } from '../../lib/me';
import { ConfirmDialog } from '../agents/confirm';
import { useLoaded } from '../agents/hooks';
import { Card } from './settings-card';

// ------------------------------------------------------------------------------ people
function PeopleCard() {
  const { me } = useMe();
  const { data: people, error, loading, reload } = useLoaded(() => api.get<PersonListEntry[]>('/people'));
  const [target, setTarget] = useState<PersonListEntry | null>(null);
  const { busy, run } = useAction();

  const turnOff = async () => {
    if (!target) return;
    const ok = await run(() => api.post(`/people/${target.id}/disable`, {}), `${target.name}'s account is turned off.`);
    if (ok) {
      setTarget(null);
      void reload();
    }
  };

  return (
    <Card id="st-people" title="People" intro="Everyone with a Tempo account.">
      {error && !people ? <ErrorBanner error={error} /> : null}
      {loading && !people && <div className="muted">Loading people…</div>}
      {people && (
        <ul className="st-list">
          {people.map((p) => (
            <li key={p.id} className="st-person">
              <div className="st-person-main">
                <span className="st-person-name">
                  {p.name}
                  {p.id === me.person.id && <span className="faint"> (you)</span>}
                </span>
                <span className="muted small st-person-email">{p.email}</span>
              </div>
              <div className="row st-person-tags">
                {p.role === 'admin' && <Pill tone="purple">Admin</Pill>}
                {p.disabled && <Pill tone="red">Turned off</Pill>}
                <span className="faint tiny">
                  Joined <Time iso={p.created_at} />
                </span>
              </div>
              {!p.disabled && p.id !== me.person.id && (
                <button type="button" className="btn btn-danger btn-sm st-person-act" onClick={() => setTarget(p)} disabled={busy}>
                  Turn off account
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {target && (
        <ConfirmDialog title={`Turn off ${target.name}'s account?`} confirmLabel="Turn off account" danger busy={busy} onConfirm={() => void turnOff()} onCancel={() => setTarget(null)}>
          <p>
            <strong>{target.name}</strong> will be signed out straight away and won't be able to sign in again. Every key and page link for their agents stops working immediately, and any invite links they made stop working too.
          </p>
          <p className="muted small">This can't be undone from here. What they wrote stays in the rooms.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------ invites
function inviteStatus(i: InviteView): { word: string; tone?: 'green' | 'amber' | 'accent' } {
  if (i.used_at) return { word: 'Accepted', tone: 'green' };
  if (i.revoked_at) return { word: 'Withdrawn' };
  if (new Date(i.expires_at).getTime() <= Date.now()) return { word: 'Expired', tone: 'amber' };
  return { word: 'Waiting', tone: 'accent' };
}

function NewInvite({ onCreated }: { onCreated: () => void }) {
  const { me } = useMe();
  const rooms = me.rooms.filter((r) => !r.is_sandbox);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [made, setMade] = useState<InviteView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const invite = await api.post<InviteView>('/invites', { email: email.trim() || undefined, role, room_ids: roomIds });
            setMade(invite);
            setEmail('');
            setRoomIds([]);
            onCreated();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBanner error={error} />
        <div className="st-invite-grid">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="st-inv-email">Their email (optional)</label>
            <input id="st-inv-email" className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
            <span className="hint">If you add it, the link only works for that address.</span>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="st-inv-role">They will be</label>
            <select id="st-inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
              <option value="member">A member</option>
              <option value="admin">An admin (can invite people and download backups)</option>
            </select>
          </div>
        </div>
        {rooms.length > 0 && (
          <fieldset className="st-fieldset">
            <legend className="label">Add them to these rooms (optional)</legend>
            <div className="st-rooms">
              {rooms.map((r) => (
                <label key={r.id} className="check">
                  <input type="checkbox" checked={roomIds.includes(r.id)} onChange={() => setRoomIds((ids) => (ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]))} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Making the link…' : 'Make an invite link'}
          </button>
        </div>
      </form>

      {made?.link && (
        <div className="st-link" role="status">
          <div className="row-between">
            <strong>Invite link{made.email ? ` for ${made.email}` : ''}</strong>
            <CopyButton text={made.link} label="Copy link" />
          </div>
          <code className="st-link-url">{made.link}</code>
          <p className="muted small" style={{ margin: 0 }}>
            Copy it now: Tempo shows it only once. It works one time and expires {fullTime(made.expires_at)}. Send it to them yourself.
          </p>
        </div>
      )}
    </div>
  );
}

function InviteList({ reloadKey }: { reloadKey: number }) {
  const { data: invites, error, loading, reload } = useLoaded(() => api.get<InviteView[]>('/invites'), [reloadKey]);
  const [target, setTarget] = useState<InviteView | null>(null);
  const { busy, run } = useAction();

  const withdraw = async () => {
    if (!target) return;
    const ok = await run(() => api.del(`/invites/${target.id}`), 'Invite withdrawn.');
    if (ok) {
      setTarget(null);
      void reload();
    }
  };

  if (error && !invites) return <ErrorBanner error={error} />;
  if (loading && !invites) return <div className="muted">Loading invites…</div>;
  if (!invites || invites.length === 0) return <Empty>No invites yet.</Empty>;

  return (
    <>
      <ul className="st-list">
        {invites.map((i) => {
          const s = inviteStatus(i);
          return (
            <li key={i.id} className="st-person">
              <div className="st-person-main">
                <span className="st-person-name">{i.email ?? 'Anyone with the link'}</span>
                <span className="muted small">
                  {i.role === 'admin' ? 'Admin' : 'Member'} · made <Time iso={i.created_at} />
                </span>
              </div>
              <div className="row st-person-tags">
                <Pill tone={s.tone}>{s.word}</Pill>
                {s.word === 'Waiting' && (
                  <span className="faint tiny">
                    expires <Time iso={i.expires_at} />
                  </span>
                )}
                {s.word === 'Accepted' && (
                  <span className="faint tiny">
                    <Time iso={i.used_at} />
                  </span>
                )}
              </div>
              {s.word === 'Waiting' && (
                <button type="button" className="btn btn-sm st-person-act" onClick={() => setTarget(i)} disabled={busy}>
                  Withdraw
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {target && (
        <ConfirmDialog title="Withdraw this invite?" confirmLabel="Withdraw invite" danger busy={busy} onConfirm={() => void withdraw()} onCancel={() => setTarget(null)}>
          <p>
            The link {target.email ? `for ${target.email} ` : ''}will stop working. You can make a new one at any time.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function InvitesCard() {
  const [version, setVersion] = useState(0);
  return (
    <>
      <Card id="st-invite" title="Invite someone" intro="An invite is a link that works once and expires after a few days. Send it to the person yourself.">
        <NewInvite onCreated={() => setVersion((v) => v + 1)} />
      </Card>
      <Card id="st-invites" title="Invites you've made">
        <InviteList reloadKey={version} />
      </Card>
    </>
  );
}

/** People and invites: admins only (the tab is hidden from everyone else, and the server refuses them too). */
export function PeopleSection() {
  return (
    <div className="stack">
      <InvitesCard />
      <PeopleCard />
    </div>
  );
}
