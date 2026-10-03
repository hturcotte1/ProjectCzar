import { useState, type ReactNode } from 'react';
import { Dialog } from '../../components/ui';

/**
 * A "are you sure?" box. For serious actions pass requireText: the person must type it
 * (usually the thing's name) before the button turns on.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  requireText,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ready = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();
  return (
    <Dialog title={title} onClose={busy ? undefined : onCancel}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConfirm();
        }}
      >
        <div className="stack-sm">{children}</div>
        {requireText && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="confirm-typed">
              To go ahead, type <strong>{requireText}</strong> below
            </label>
            <input id="confirm-typed" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
