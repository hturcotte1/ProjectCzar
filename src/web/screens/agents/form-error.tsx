import { useEffect, useRef } from 'react';
import { ErrorBanner } from '../../components/ui';

/** An error banner that scrolls itself into view when it appears, so a long form never fails silently. */
export function FormError({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [error]);
  if (!error) return null;
  return (
    <div ref={ref}>
      <ErrorBanner error={error} />
    </div>
  );
}
