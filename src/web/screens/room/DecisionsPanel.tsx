import type { RoomDetail } from '../../../shared/app-types';
import { Pill } from '../../components/ui';
import { DecisionCard } from './decisions-card';
import { ProposalCard } from './decisions-proposal';
import { QuestionCard } from './decisions-question';
import { RecentlyDecided } from './decisions-recent';
import './room-b.css';

/**
 * Everything waiting on a person, in the order of how much it blocks: decisions, then Conductor
 * instructions to approve, then questions from agents. Shown in the side panel and as a tab.
 */
export function DecisionsPanel({ detail, onChanged }: { detail: RoomDetail; onChanged: () => void }) {
  const open = detail.decisions.filter((d) => d.status === 'open');
  const settled = detail.decisions.filter((d) => d.status !== 'open');
  const proposals = detail.proposals;
  const questions = detail.questions_for_people;
  const count = open.length + proposals.length + questions.length;

  return (
    <section className="dec-panel stack" aria-labelledby="dec-panel-title">
      <h2 id="dec-panel-title" className="row" style={{ gap: 8 }}>
        Waiting on you
        {count > 0 && (
          <Pill tone="accent">
            {count}
            <span className="sr-only"> waiting</span>
          </Pill>
        )}
      </h2>
      <p className="sr-only" aria-live="polite">
        {count === 0 ? 'Nothing is waiting on you.' : `${count} ${count === 1 ? 'item is' : 'items are'} waiting on you.`}
      </p>

      {count === 0 && (
        <div className="empty dec-calm">
          <p style={{ margin: 0 }}>Nothing is waiting on you.</p>
          <p className="small faint" style={{ margin: '4px 0 0' }}>
            Decisions, instructions to approve and questions will show up here.
          </p>
        </div>
      )}

      {open.length > 0 && (
        <div className="stack" role="group" aria-label="Decisions">
          <h3 className="dec-sub">Decisions</h3>
          {open.map((d) => (
            <DecisionCard key={d.id} decision={d} onChanged={onChanged} />
          ))}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="stack" role="group" aria-label="Instructions to approve">
          <h3 className="dec-sub">Instructions to approve</h3>
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onChanged={onChanged} />
          ))}
        </div>
      )}

      {questions.length > 0 && (
        <div className="stack" role="group" aria-label="Questions for people">
          <h3 className="dec-sub">Questions for you</h3>
          {questions.map((q) => (
            <QuestionCard key={q.id} question={q} onChanged={onChanged} />
          ))}
        </div>
      )}

      <RecentlyDecided decisions={settled} />
    </section>
  );
}
