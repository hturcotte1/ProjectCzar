import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Light as LightT } from '../../shared/app-types';
import { LIGHT_WORDS, fullTime, when } from '../lib/format';

/** Small shared building blocks. Screens should use these for a consistent look. */

export function Light({ light, large, title }: { light: LightT; large?: boolean; title?: string }) {
  return <span className={`light light-${light}${large ? ' light-lg' : ''}`} title={title ?? LIGHT_WORDS[light]} aria-label={title ?? LIGHT_WORDS[light]} role="img" />;
}

export function Time({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={fullTime(iso)} className={className}>
      {when(iso)}
    </time>
  );
}

export function Avatar({ name, kind }: { name: string; kind: 'agent' | 'person' | 'conductor' | 'system' }) {
  const initials = kind === 'conductor' ? 'C' : kind === 'system' ? 'T' : name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className={`avatar avatar-${kind}`} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy', small }: { text: string; label?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn${small ? ' btn-sm' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(820px, 100%)' } : undefined}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              Close
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="banner banner-error" role="alert">
      {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'accent' | 'green' | 'amber' | 'red' | 'purple' }) {
  return <span className={`pill${tone ? ` pill-${tone}` : ''}`}>{children}</span>;
}

// ------------------------------------------------------------------------------------ toasts
interface Toast {
  id: number;
  text: string;
  error?: boolean;
}
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' toast-error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** toast('Saved') or toast(error.message, true) */
export function useToast(): (text: string, error?: boolean) => void {
  return useContext(ToastCtx);
}

/** Runs an async action with a busy flag and shows its error as a toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
