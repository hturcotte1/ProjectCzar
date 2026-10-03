import { useState, type ReactNode } from 'react';
import './auth.css';

/** The calm centered card around the sign-in and invite screens. */
export function AuthFrame({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-wrap">
      <main className="auth-card card au-card">
        <div className="au-brand">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true" /> Tempo
          </span>
        </div>
        <h1 className="au-title">{title}</h1>
        {intro && <p className="muted au-intro">{intro}</p>}
        {children}
        {footer && <div className="au-footer">{footer}</div>}
      </main>
    </div>
  );
}

/** A password box with a "Show" button, so people can check what they typed (helpful on a phone). */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={id}>{label}</label>
      <div className="au-password">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
