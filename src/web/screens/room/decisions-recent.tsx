import type { DecisionView } from '../../../shared/app-types';
import { SafeText } from '../../components/SafeText';
import { RelTime } from './strip-now';

/** Decisions that are already settled, collapsed so they do not crowd what still needs a person. */
export function RecentlyDecided({ decisions }: { decisions: DecisionView[] }) {
  if (decisions.length === 0) return null;
  const sorted = [...decisions].sort((a, b) => (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at));
  return (
    <details className="dec-recent">
      <summary>Recently decided ({decisions.length})</summary>
      <ul className="dec-recent-list">
        {sorted.map((d) => (
          <li key={d.id}>
            <div className="small dec-recent-title">
              <SafeText text={d.title} />
            </div>
            <div className="small muted">
              {d.status === 'dismissed' ? (
                'Dismissed without an answer'
              ) : (
                <>
                  Decided: <SafeText text={d.resolution ?? 'no answer recorded'} />
                </>
              )}
            </div>
            <div className="tiny faint">
              {d.resolved_by_name ? `${d.status === 'dismissed' ? 'Dismissed' : 'Decided'} by ${d.resolved_by_name} ` : ''}
              <RelTime iso={d.resolved_at} />
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
