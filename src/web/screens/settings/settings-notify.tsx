import { useState } from 'react';
import type { MeResponse } from '../../../shared/app-types';
import { CopyButton, ErrorBanner, Pill, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { Card } from './settings-card';

const TOPIC_RE = /^[A-Za-z0-9_-]{12,64}$/;
// 32 letters and digits: 256 is a multiple of 32, so every character is equally likely.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** "tempo-" followed by 20 random characters, from the browser's secure random numbers. */
export function makeTopic(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return `tempo-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

function EmailAlerts() {
  const { me, refresh } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const configured = me.features.email_configured;

  const change = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch<MeResponse>('/me', { notify_email: on });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      <div className="row-between">
        <h3>Email</h3>
        <Pill tone={configured ? 'green' : 'amber'}>{configured ? 'Email is set up on this server' : 'Email is not set up yet'}</Pill>
      </div>
      <ErrorBanner error={error} />
      <label className="check st-check">
        <input type="checkbox" checked={me.person.notify_email} disabled={busy} onChange={(e) => void change(e.target.checked)} />
        Email me at {me.person.email} when an agent goes quiet or something needs a decision
      </label>
      {!configured && (
        <p className="muted small st-intro">Tempo can't send email until your admin sets it up on the server. You can switch this on now and it will start working then.</p>
      )}
    </div>
  );
}

function PhoneAlerts() {
  const { me, refresh } = useMe();
  const saved = me.person.ntfy_topic ?? '';
  const [topic, setTopic] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const clean = topic.trim();
  const valid = clean === '' || TOPIC_RE.test(clean);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch<MeResponse>('/me', { ntfy_topic: value });
      await refresh();
      if (value === null) setTopic('');
      toast(value === null ? 'Phone alerts are off.' : 'Phone alerts are saved.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      <div className="row-between">
        <h3>Phone</h3>
        <Pill tone={saved ? 'green' : undefined}>{saved ? 'On' : 'Off'}</Pill>
      </div>
      <p className="muted small st-intro">Get alerts on your phone with ntfy, a free app that shows short messages.</p>
      <ol className="st-steps small">
        <li>Install the free <strong>ntfy</strong> app on your phone (iPhone or Android).</li>
        <li>
          In the app, subscribe to the topic written below, typed exactly. If it asks for a server, use <code>{me.features.push_server}</code>.
        </li>
        <li>Press Save here.</li>
      </ol>
      <ErrorBanner error={error} />
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="st-topic">Your private topic</label>
        <input
          id="st-topic"
          className="input st-mono"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="tempo-…"
          aria-invalid={!valid}
          aria-describedby="st-topic-hint"
        />
        <span className={`hint${valid ? '' : ' st-bad'}`} id="st-topic-hint">
          {valid ? 'Use the button to make a long random name that nobody could guess.' : 'Use 12 to 64 letters, numbers, - or _. A long random name is safest.'}
        </span>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => setTopic(makeTopic())} disabled={busy}>
          Generate a private topic
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save(clean || null)} disabled={busy || !valid || clean === saved}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <CopyButton text={saved} label="Copy topic" />}
        {saved && (
          <button type="button" className="btn btn-ghost" onClick={() => void save(null)} disabled={busy}>
            Turn off phone alerts
          </button>
        )}
      </div>
      <div className="banner banner-warn st-note" role="note">
        <span>
          Anyone who knows your topic name can read your alerts, so keep it private. Alerts only say things like “Muse Henry has missed 2 check-ins”; they never contain project details.
        </span>
      </div>
    </div>
  );
}

export function NotificationsCard() {
  return (
    <Card id="st-notify" title="Alerts to you" intro="Alerts always show on the Alerts page. You can also get them by email or on your phone.">
      <EmailAlerts />
      <hr className="divider" style={{ margin: 0 }} />
      <PhoneAlerts />
    </Card>
  );
}
