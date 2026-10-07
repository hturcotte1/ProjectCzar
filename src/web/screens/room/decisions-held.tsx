import type { ProposedInstructionView } from '../../../shared/app-types';
import { SafeText } from '../../components/SafeText';
import { InstructionFacts, PriorityPill } from './lanes-parts';

/**
 * One short line saying what a decision held back, for places that otherwise show only its title
 * (titles leave the held text out, because a decided title reaches agents' cards). Render it with
 * SafeText: it is the Conductor's text, which can quote agents.
 */
export function heldLine(p: ProposedInstructionView, max = 140): string {
  const text = p.kind === 'reword' ? `New wording: ${p.text}` : p.kind === 'playbook' ? `${p.title ?? ''}: ${p.text}` : p.text;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What any answer other than the first option does with the held item. */
const OTHER_ANSWER: Record<ProposedInstructionView['kind'], string> = {
  instruction: 'Any other answer does not send it.',
  reword: 'Any other answer keeps the current wording.',
  question: 'Any other answer does not send it.',
  answer: 'Any other answer does not send it.',
  note: 'Any other answer does not post it.',
  playbook: 'Any other answer does not save it.',
};

/**
 * What a decision holds back, and what choosing its first option does with it. Everything here
 * was written by the Conductor or quotes an agent, so all of it goes through SafeText.
 */
export function HeldItem({ held: p, approveLabel }: { held: ProposedInstructionView; approveLabel: string }) {
  return (
    <div className="dec-held">
      <HeldBody held={p} approveLabel={approveLabel} />
      <div className="tiny muted">{OTHER_ANSWER[p.kind] ?? OTHER_ANSWER.instruction}</div>
    </div>
  );
}

function HeldBody({ held: p, approveLabel }: { held: ProposedInstructionView; approveLabel: string }) {
  const lead = `If you choose “${approveLabel}”, `;
  const agent = p.agent_name ?? 'the agent';
  switch (p.kind) {
    case 'reword':
      return (
        <div className="dec-proposed">
          <div className="small dec-proposed-label">
            {lead}
            {p.instruction_id ?? 'the instruction'} for {agent} changes:
          </div>
          <div className="dec-compare">
            <div className="dec-compare-col">
              <div className="dec-compare-head">Now:</div>
              <InstructionFacts text={p.previous_text ?? ''} doneWhen={p.previous_done_when} />
            </div>
            <div className="dec-compare-col dec-compare-new">
              <div className="dec-compare-head">Would become:</div>
              <InstructionFacts text={p.text} doneWhen={p.done_when} />
            </div>
          </div>
        </div>
      );
    case 'question':
      return (
        <div className="dec-proposed">
          <div className="small dec-proposed-label">
            {lead}this question goes to {agent}:
          </div>
          <div className="lane-ins-text">
            <SafeText text={p.text} />
          </div>
        </div>
      );
    case 'note':
      return (
        <div className="dec-proposed">
          <div className="small dec-proposed-label">{lead}this note goes to every agent in the room:</div>
          <div className="lane-ins-text">
            <SafeText text={p.text} />
          </div>
        </div>
      );
    case 'answer':
      return (
        <div className="dec-proposed">
          <div className="small dec-proposed-label">
            {lead}this answer goes to {agent}:
          </div>
          {p.question_text && (
            <div className="small muted">
              {agent} asked{p.question_id ? ` (${p.question_id})` : ''}: <SafeText text={p.question_text} />
            </div>
          )}
          <div className="lane-ins-text">
            <SafeText text={p.text} />
          </div>
        </div>
      );
    case 'playbook':
      return (
        <div className="dec-proposed">
          <div className="small dec-proposed-label">{lead}this lesson is saved to the playbook, which every agent in the room sees:</div>
          <div className="lane-ins-text">
            <strong>
              <SafeText text={p.title ?? ''} />
            </strong>
          </div>
          <div className="small">
            <SafeText text={p.text} />
          </div>
        </div>
      );
    default:
      return (
        <div className="dec-proposed">
          <div className="small dec-proposed-label">
            {lead}this goes to {agent}:
          </div>
          {p.priority && <PriorityPill priority={p.priority} />}
          <InstructionFacts text={p.text} doneWhen={p.done_when} dueAt={p.due_at} />
        </div>
      );
  }
}
