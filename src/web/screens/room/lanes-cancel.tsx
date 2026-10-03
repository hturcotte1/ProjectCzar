import { useId, useState } from 'react';
import type { InstructionView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { Dialog, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';

/** Asks before cancelling an open instruction. The reason is optional and goes to the agent. */
export function CancelDialog({ instruction, onClose, onDone }: { instruction: InstructionView; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const fieldId = useId();

  const cancel = async () => {
    const r = await run(() => api.post(`/instructions/${instruction.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}), 'Instruction cancelled');
    if (r !== undefined) onDone();
  };

  return (
    <Dialog title="Cancel this instruction?" onClose={() => !busy && onClose()}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {instruction.agent_name} will see that it was cancelled the next time it checks in.
        </p>
        <blockquote className="lane-quote">
          <SafeText text={instruction.text} />
        </blockquote>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={fieldId}>Reason (optional)</label>
          <textarea id={fieldId} className="textarea" rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="For example: plans changed." />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Keep it
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={cancel}>
            {busy ? 'Cancelling…' : 'Cancel instruction'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
