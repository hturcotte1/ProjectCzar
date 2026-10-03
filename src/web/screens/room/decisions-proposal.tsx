import { useId, useState } from 'react';
import type { InstructionView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { Dialog, Pill, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { InstructionFacts, PriorityPill, issuerWords } from './lanes-parts';
import { RelTime } from './strip-now';

/**
 * A Conductor instruction waiting for approval (propose mode): approve it as written, edit it
 * first, or reject it.
 */
export function ProposalCard({ proposal: p, onChanged }: { proposal: InstructionView; onChanged: () => void }) {
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.text);
  const [doneWhen, setDoneWhen] = useState(p.done_when);
  const [sent, setSent] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const textId = useId();
  const doneId = useId();
  const locked = busy || sent;

  const approve = async (body: { text?: string; done_when?: string }, message: string) => {
    const r = await run(() => api.post(`/instructions/${p.id}/approve`, body), message);
    if (r !== undefined) {
      setSent(true);
      onChanged();
    }
  };

  return (
    <article className="card-flat dec-card" aria-label={`Instruction for ${p.agent_name}, waiting for approval`}>
      <div className="row-between">
        <span className="row" style={{ gap: 8 }}>
          <strong>For {p.agent_name}</strong>
          <PriorityPill priority={p.priority} />
        </span>
        <span className="tiny faint">
          Proposed <RelTime iso={p.created_at} /> by {issuerWords(p)}
        </span>
      </div>

      {editing ? (
        <div className="stack">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={textId}>What {p.agent_name} should do</label>
            <textarea id={textId} className="textarea" rows={4} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoFocus />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={doneId}>Done when</label>
            <input id={doneId} className="input" value={doneWhen} maxLength={500} onChange={(e) => setDoneWhen(e.target.value)} />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked || !text.trim()}
              onClick={() => approve({ text: text.trim(), done_when: doneWhen.trim() }, 'Approved with your changes')}
            >
              {busy ? 'Sending…' : 'Approve with changes'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={locked} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <InstructionFacts text={p.text} doneWhen={p.done_when} dueAt={p.due_at} />
          {p.why && (
            <div className="small muted">
              <strong>Why:</strong> <SafeText text={p.why} />
            </div>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={locked} onClick={() => approve({}, 'Approved and sent')}>
              {busy ? 'Sending…' : 'Approve'}
            </button>
            <button type="button" className="btn" disabled={locked} onClick={() => setEditing(true)}>
              Edit, then approve
            </button>
            <button type="button" className="btn btn-danger" disabled={locked} onClick={() => setRejecting(true)}>
              Reject
            </button>
          </div>
        </>
      )}

      {rejecting && (
        <RejectDialog
          proposal={p}
          onClose={() => setRejecting(false)}
          onDone={() => {
            setRejecting(false);
            setSent(true);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

function RejectDialog({ proposal, onClose, onDone }: { proposal: InstructionView; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [reason, setReason] = useState('');
  const id = useId();
  const reject = async () => {
    const r = await run(() => api.post(`/instructions/${proposal.id}/reject`, reason.trim() ? { reason: reason.trim() } : {}), 'Instruction rejected');
    if (r !== undefined) onDone();
  };
  return (
    <Dialog title="Reject this instruction?" onClose={() => !busy && onClose()}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {proposal.agent_name} will not be asked to do this. The Conductor may propose something else later.
        </p>
        <blockquote className="lane-quote">
          <SafeText text={proposal.text} />
        </blockquote>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={id}>Reason (optional)</label>
          <textarea id={id} className="textarea" rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="This helps the Conductor choose better next time." />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Keep it waiting
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={reject}>
            {busy ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
