import { useCallback, useEffect, useState } from 'react';
import type { RehearsalView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { linkProps } from '../../lib/router';
import { ErrorBanner, Pill, Time, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';

/**
 * Rehearsal: two stand-in agents in a sandbox room on a sped-up clock, driven through all three
 * doors, including deliberate misbehavior. Every expected behavior is checked and listed here.
 */
export function RehearsalPage() {
  const { refresh } = useMe();
  const [latest, setLatest] = useState<RehearsalView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rounds, setRounds] = useState(12);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    try {
      setLatest(await api.get<RehearsalView | null>('/rehearsals/latest'));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a rehearsal runs, refresh its log every two seconds.
  useEffect(() => {
    if (latest?.status !== 'running') return;
    const t = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(t);
  }, [latest?.status, load]);

  const running = latest?.status === 'running';
  const passed = latest?.results.filter((r) => r.passed).length ?? 0;

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Rehearse with stand-in agents</h2>
        <p className="muted">
          A rehearsal creates a clearly labeled sandbox room with two stand-in agents that check in every 30 seconds (a sped-up clock). One connects the way a Muse
          would (MCP); the other alternates between the plain web API and the agent page an Instinct would use. On purpose, they skip a required answer, disagree,
          ask to spend money, and go quiet for a while. Tempo checks that each of those is handled correctly. It takes about three minutes, touches no real room,
          and the stand-ins are paused afterwards.
        </p>
        <div className="row">
          <label className="row small" htmlFor="rounds">
            Most check-in rounds
            <input id="rounds" className="input" style={{ width: 80 }} type="number" min={8} max={20} value={rounds} onChange={(e) => setRounds(Number(e.target.value) || 12)} />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || running}
            onClick={() =>
              run(async () => {
                try {
                  await api.post('/rehearsals', { max_rounds: rounds });
                } catch (e) {
                  setError(e);
                  throw e;
                }
                await load();
                await refresh();
              }, 'Rehearsal started')
            }
          >
            {running ? 'Rehearsal running…' : 'Run rehearsal'}
          </button>
        </div>
      </section>

      <ErrorBanner error={error} />

      {latest && (
        <section className="card stack" aria-live="polite">
          <div className="row-between">
            <h2>Latest rehearsal</h2>
            {latest.status === 'running' && <Pill tone="accent">running</Pill>}
            {latest.status === 'passed' && <Pill tone="green">passed</Pill>}
            {latest.status === 'failed' && <Pill tone="red">had failures</Pill>}
          </div>
          <div className="small muted">
            Started <Time iso={latest.started_at} />
            {latest.finished_at && (
              <>
                {' '}· finished <Time iso={latest.finished_at} />
              </>
            )}{' '}
            · <a {...linkProps(`/rooms/${latest.room_id}`)}>open the sandbox room</a>
          </div>
          {latest.results.length > 0 && (
            <div className="stack-sm">
              <h3>
                Checks: {passed} of {latest.results.length} passed
              </h3>
              <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {latest.results.map((r) => (
                  <li key={r.name} className="card-flat">
                    <div className="row">
                      <Pill tone={r.passed ? 'green' : 'red'}>{r.passed ? 'Pass' : 'Fail'}</Pill>
                      <strong>{r.name}</strong>
                    </div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      <SafeText text={r.detail} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {latest.log.length > 0 && (
            <details open={running}>
              <summary className="small">Step-by-step log ({latest.log.length} lines)</summary>
              <pre className="copyable" style={{ marginTop: 8 }}>
                {latest.log.map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.text}`).join('\n')}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
