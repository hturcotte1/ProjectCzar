import type { ReactNode } from 'react';

/** A titled card used by every settings section. */
export function Card({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="card st-card" aria-labelledby={id}>
      <div className="stack">
        <div>
          <h2 id={id}>{title}</h2>
          {intro && <p className="muted small st-intro">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
