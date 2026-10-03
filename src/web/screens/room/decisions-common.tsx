import { useId } from 'react';
import type { DecisionView } from '../../../shared/app-types';

/** A small plain label for why a decision is waiting on a person. */
export const SOURCE_WORDS: Record<DecisionView['source'], string> = {
  conductor: 'Raised by the Conductor',
  disagreement: 'Agents disagree',
  declined: 'An agent declined an instruction',
  limits: "Outside the room's limits",
  question: "From an agent's question",
  person: 'Raised by a person',
};

/** Options that end in "(write it)" need the person's own words. */
export const needsWords = (option: string): boolean => /write it/i.test(option);

/** "Something else (write it)" is shown as "Something else…". */
export function optionLabel(option: string): string {
  const stripped = option.replace(/\s*\(write it\)\s*$/i, '').trim();
  return stripped !== option.trim() ? `${stripped}…` : option;
}

/** Which option the recommendation points at, or -1 when it does not match one exactly enough. */
export function recommendedIndex(d: Pick<DecisionView, 'options' | 'recommendation'>): number {
  const rec = d.recommendation?.trim().toLowerCase();
  if (!rec) return -1;
  const norm = d.options.map((o) => o.trim().toLowerCase());
  const exact = norm.indexOf(rec);
  if (exact >= 0) return exact;
  return norm.findIndex((o) => o.startsWith(rec) || rec.startsWith(o));
}

/** A labelled box for writing, with a send button. Cmd/Ctrl+Enter sends. */
export function WriteBox({
  label,
  value,
  onChange,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  autoFocus,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  submitLabel: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="dec-write">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        maxLength={2000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && value.trim() && !busy) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || !value.trim()} onClick={onSubmit}>
          {busy ? 'Sending…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
