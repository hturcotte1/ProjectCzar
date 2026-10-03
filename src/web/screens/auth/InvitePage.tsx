import { useEffect, useState } from 'react';
import type { MeResponse } from '../../../shared/app-types';
import { ErrorBanner } from '../../components/ui';
import { api } from '../../lib/api';
import { fullTime } from '../../lib/format';
import { linkProps } from '../../lib/router';
import { AuthFrame, PasswordField } from './auth-common';

interface InviteInfo {
  valid: boolean;
  email: string | null;
  inviter_name: string | null;
  expires_at: string | null;
}

const MIN_PASSWORD = 10;

export function InvitePage({ token, onSignedIn }: { token: string; onSignedIn: (me: MeResponse) => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setLoadError(null);
    api
      .get<InviteInfo>(`/invites/${encodeURIComponent(token)}`)
      .then((r) => !cancelled && setInfo(r))
      .catch((e) => !cancelled && setLoadError(e));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loadError) {
    return (
      <AuthFrame title="We couldn't open your invite">
        <div className="stack">
          <ErrorBanner error={loadError} />
          <p className="muted">Check your connection and reload this page.</p>
        </div>
      </AuthFrame>
    );
  }
  if (!info) {
    return (
      <div className="auth-wrap muted" role="status">
        Opening your invite…
      </div>
    );
  }
  if (!info.valid) {
    return (
      <AuthFrame title="This invite doesn't work any more" footer={<a {...linkProps('/')}>Already have an account? Sign in</a>}>
        <p>This invite link has already been used, has expired, or was withdrawn.</p>
        <p className="muted">Ask the person who invited you to send a new link. Each link works once and expires after a few days.</p>
      </AuthFrame>
    );
  }
  return <AcceptForm token={token} info={info} onSignedIn={onSignedIn} />;
}

function AcceptForm({ token, info, onSignedIn }: { token: string; info: InviteInfo; onSignedIn: (me: MeResponse) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(info.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(new Error('Please tell us your name.'));
    if (!email.trim()) return setError(new Error('Please enter your email address.'));
    if (password.length < MIN_PASSWORD) return setError(new Error(`Your password needs at least ${MIN_PASSWORD} characters. A few short words in a row works well.`));
    if (password !== confirm) return setError(new Error('The two passwords are not the same. Type them again.'));
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<MeResponse>('/invites/accept', { token, name: name.trim(), email: email.trim(), password });
      onSignedIn(me);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Join Tempo"
      intro={
        <>
          {info.inviter_name ? `${info.inviter_name} invited you to Tempo.` : 'You have been invited to Tempo.'} Choose a password to finish.
          {info.expires_at && <span className="faint small au-expiry"> This link works once and expires {fullTime(info.expires_at)}.</span>}
        </>
      }
      footer={<a {...linkProps('/')}>Already have an account? Sign in</a>}
    >
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorBanner error={error} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="invite-name">Your name</label>
          <input id="invite-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} autoFocus />
          <span className="hint">This is how the others in your rooms will see you.</span>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            className="input"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!!info.email}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={info.email ? 'invite-email-hint' : undefined}
          />
          {info.email && (
            <span className="hint" id="invite-email-hint">
              The invite was made for this address.
            </span>
          )}
        </div>
        <PasswordField id="invite-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
        <PasswordField id="invite-confirm" label="Type the password again" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button className="btn btn-primary au-submit" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create my account'}
        </button>
      </form>
    </AuthFrame>
  );
}
