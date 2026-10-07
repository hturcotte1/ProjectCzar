import { useId, useState } from 'react';
import type { DecisionView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { Dialog, Pill, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { HeldItem } from './decisions-held';
import { RelTime } from './strip-now';
import { SOURCE_WORDS, WriteBox, needsWords, optionLabel, recommendedIndex } from './decisions-common';

const shorten = (s: string, max = 48) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Where the person is writing their own words: under one option, or as "something else". */
type Writing = { kind: 'option'; index: number } | { kind: 'else' } | null;

/** A decision waiting on a person: one tap on an option, or their own words. */
export function DecisionCard({ decision: d, onChanged }: { decision: DecisionView; onChanged: () => void }) {
  const { busy, run } = useAction();
  const [writing, setWriting] = useState<Writing>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const titleId = useId();
  const rec = recommendedIndex(d);
  const locked = busy || sent;

  const send = async (body: { option_index?: number; text?: string }) => {
    const r = await run(() => api.post(`/decisions/${d.id}/resolve`, body), 'Decision sent');
    if (r !== undefined) {
      setSent(true);
      onChanged();
    }
  };

  const toggleWriting = (w: Writing) => {
    const same = writing && w && writing.kind === w.kind && (w.kind === 'else' || (writing.kind === 'option' && writing.index === w.index));
    setWriting(same ? null : w);
  };

  const submitWriting = () => {
    if (!writing) return;
    void send(writing.kind === 'option' ? { option_index: writing.index, text: text.trim() } : { text: text.trim() });
  };

  return (
    <article className="card-flat dec-card" aria-labelledby={titleId}>
      <div className="row-between">
        <Pill tone={d.source === 'limits' || d.source === 'declined' ? 'amber' : 'purple'}>{SOURCE_WORDS[d.source]}</Pill>
        <span className="tiny faint">
          Raised <RelTime iso={d.created_at} />
        </span>
      </div>
      <h3 id={titleId} className="dec-title">
        <SafeText text={d.title} />
      </h3>
      {d.context && (
        <div className="small muted">
          <SafeText text={d.context} />
        </div>
      )}
      {d.recommendation && rec < 0 && (
        <div className="small">
          <strong>Suggested:</strong> <SafeText text={d.recommendation} />
        </div>
      )}
      {d.why && (
        <div className="small muted">
          <strong>{d.recommendation ? 'Why this is recommended:' : 'Why this came up:'}</strong> <SafeText text={d.why} />
        </div>
      )}

      {d.proposed_instruction && <HeldItem held={d.proposed_instruction} approveLabel={shorten(optionLabel(d.options[0] ?? 'the first option'))} />}

      <div className="dec-options" role="group" aria-label="Your options">
        {d.options.map((opt, i) => {
          const wordsNeeded = needsWords(opt);
          const open = writing?.kind === 'option' && writing.index === i;
          return (
            <button
              key={i}
              type="button"
              className={`btn btn-option dec-option${rec === i ? ' dec-option-rec' : ''}${open ? ' dec-option-open' : ''}`}
              disabled={locked}
              aria-expanded={wordsNeeded ? open : undefined}
              onClick={() => (wordsNeeded ? toggleWriting({ kind: 'option', index: i }) : void send({ option_index: i }))}
            >
              <span className="dec-option-label">{optionLabel(opt)}</span>
              {rec === i && <Pill tone="green">Recommended</Pill>}
            </button>
          );
        })}
      </div>

      {writing && (
        <WriteBox
          key={writing.kind === 'option' ? `o${writing.index}` : 'else'}
          label={writing.kind === 'option' ? 'Write what you decide' : 'What do you decide?'}
          value={text}
          onChange={setText}
          submitLabel="Send decision"
          busy={locked}
          autoFocus
          onSubmit={submitWriting}
          onCancel={() => setWriting(null)}
          placeholder="Say it in your own words."
        />
      )}

      <div className="row-between dec-foot">
        <button type="button" className="btn btn-ghost btn-sm b-touch" disabled={locked} aria-expanded={writing?.kind === 'else'} onClick={() => toggleWriting({ kind: 'else' })}>
          Decide something else
        </button>
        <button type="button" className="btn btn-ghost btn-sm b-touch" disabled={locked} onClick={() => setConfirmDismiss(true)}>
          Dismiss
        </button>
      </div>

      {confirmDismiss && (
        <DismissDialog
          decision={d}
          onClose={() => setConfirmDismiss(false)}
          onDone={() => {
            setConfirmDismiss(false);
            setSent(true);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

function DismissDialog({ decision, onClose, onDone }: { decision: DecisionView; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const dismiss = async () => {
    const r = await run(() => api.post(`/decisions/${decision.id}/dismiss`, {}), 'Decision dismissed');
    if (r !== undefined) onDone();
  };
  return (
    <Dialog title="Dismiss this decision?" onClose={() => !busy && onClose()}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          It will be closed without an answer, and nothing is sent to anyone. This cannot be undone.
        </p>
        <blockquote className="lane-quote">
          <SafeText text={decision.title} />
        </blockquote>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Keep it open
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={dismiss}>
            {busy ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
