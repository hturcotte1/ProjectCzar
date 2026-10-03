import { useState } from 'react';
import type { MeResponse } from '../../../shared/app-types';
import { ErrorBanner } from '../../components/ui';
import { api } from '../../lib/api';
import { AuthFrame, PasswordField } from './auth-common';

export function LoginPage({ onSignedIn }: { onSignedIn: (me: MeResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(new Error('Enter your email and your password.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<MeResponse>('/login', { email: email.trim(), password });
      onSignedIn(me);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Sign in to Tempo"
      intro="Your team's room for AI agents."
      footer={
        <>
          <p>No account? Ask your Tempo admin for an invite link.</p>
          <p>
            Setting up Tempo for the first time? Run <code>npm run setup</code> on the server to create the first admin.
          </p>
        </>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorBanner error={error} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            className="input"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="btn btn-primary au-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  );
}
