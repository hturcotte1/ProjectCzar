import type { AlertView } from '../../../shared/app-types';
import { Pill } from '../../components/ui';

/** Alert kinds and delivery results in plain words. */

export const KIND_WORDS: Record<string, { word: string; tone?: 'green' | 'amber' | 'red' | 'accent' }> = {
  agent_red: { word: 'Missed check-ins', tone: 'red' },
  agent_recovered: { word: 'Back on track', tone: 'green' },
  decision_waiting: { word: 'Needs a decision', tone: 'accent' },
};

const CHANNEL_WORDS: Record<string, string> = { app: 'In Tempo', email: 'Email', push: 'Phone' };

function deliveryWords(result: string): { text: string; tone?: 'green' | 'amber' | 'red'; detail?: string } {
  if (result === 'shown') return { text: 'shown here', tone: 'green' };
  if (result === 'sent') return { text: 'sent', tone: 'green' };
  if (result.startsWith('failed')) return { text: 'could not be sent', tone: 'red', detail: result.replace(/^failed:?\s*/, '') };
  if (result === 'off for this person') return { text: 'turned off in your settings' };
  if (result === 'email not set up') return { text: "not sent: email isn't set up on this server" };
  if (result === 'push not set up') return { text: "not sent: phone alerts aren't set up on this server" };
  if (result === 'no push topic for this person') return { text: 'not sent: no phone topic in your settings' };
  if (result === 'not sent for rehearsals') return { text: 'not sent (rehearsal)' };
  return { text: result };
}

/** "In Tempo: shown here · Email: sent · Phone: could not be sent" */
export function Deliveries({ deliveries }: { deliveries: AlertView['deliveries'] }) {
  const entries = Object.entries(deliveries);
  if (entries.length === 0) {
    return <span className="faint tiny">Being delivered…</span>;
  }
  return (
    <ul className="al-deliveries" aria-label="Where this alert was sent">
      {entries.map(([channel, result]) => {
        const w = deliveryWords(result);
        return (
          <li key={channel} title={w.detail}>
            <span className="faint">{CHANNEL_WORDS[channel] ?? channel}: </span>
            <span className={w.tone ? `al-d-${w.tone}` : 'muted'}>{w.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function KindPill({ kind }: { kind: string }) {
  const k = KIND_WORDS[kind];
  return k ? <Pill tone={k.tone}>{k.word}</Pill> : null;
}

const REARM_MARKER = /send it this message:\s*/i;

/** Red alerts end with the message to send the quiet agent. Returns it, or null when there is none. */
export function rearmText(body: string): string | null {
  const m = REARM_MARKER.exec(body);
  if (!m) return null;
  const text = body.slice(m.index + m[0].length).trim();
  return text || null;
}
