import { useState } from 'react';
import type { MeResponse } from '../../../shared/app-types';
import { ErrorBanner, Pill, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { linkProps } from '../../lib/router';
import { PasswordField } from '../auth/auth-common';
import { Card } from './settings-card';
import { NotificationsCard } from './settings-notify';

function ProfileCard() {
  const { me, refresh } = useMe();
  const [name, setName] = useState(me.person.name);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = name.trim() !== me.person.name;

  return (
    <Card id="st-profile" title="Your profile">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.patch<MeResponse>('/me', { name: name.trim() });
            await refresh();
            toast('Name saved.');
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBanner error={error} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="st-name">Your name</label>
          <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="name" />
          <span className="hint">This is how the others in your rooms see you.</span>
        </div>
        <dl className="kv st-kv">
          <dt>Email</dt>
          <dd>{me.person.email}</dd>
          <dt>Role</dt>
          <dd>{me.person.role === 'admin' ? <Pill tone="purple">Admin</Pill> : 'Member'}</dd>
        </dl>
        <div>
          <button className="btn btn-primary" disabled={busy || !dirty || !name.trim()}>
            {busy ? 'Saving…' : 'Save name'}
          </button>
        </div>
      </form>
    </Card>
  );
}

const MIN_PASSWORD = 10;

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  return (
    <Card id="st-password" title="Change your password">
      <form
        className="stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!current) return setError(new Error('Type your current password first.'));
          if (next.length < MIN_PASSWORD) return setError(new Error(`The new password needs at least ${MIN_PASSWORD} characters.`));
          if (next !== again) return setError(new Error('The two new passwords are not the same.'));
          setBusy(true);
          setError(null);
          try {
            await api.patch('/me', { current_password: current, new_password: next });
            setCurrent('');
            setNext('');
            setAgain('');
            toast('Password changed.');
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBanner error={error} />
        <PasswordField id="st-pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField id="st-pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
        <PasswordField id="st-pw-again" label="Type the new password again" value={again} onChange={setAgain} autoComplete="new-password" />
        <div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** The "You" tab: profile, password, alerts and a pointer to your agents. */
export function YouSection() {
  return (
    <div className="stack">
      <ProfileCard />
      <NotificationsCard />
      <PasswordCard />
      <Card id="st-agents" title="Your agents, keys and schedules" intro="Agents, their keys, their check-in times and their connection logs each live on the agent's own page.">
        <div>
          <a className="btn" {...linkProps('/agents')}>
            Go to your agents
          </a>
        </div>
      </Card>
    </div>
  );
}
