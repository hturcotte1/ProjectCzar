import type { InstructionStatus, InstructionView } from '../../../shared/app-types';
import { Pill, Time } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { useNow } from './strip-now';

type Tone = 'accent' | 'green' | 'amber' | 'red' | 'purple' | undefined;

/** Plain words for where an instruction stands. */
export const INSTRUCTION_STATUS: Record<InstructionStatus, { label: string; tone: Tone }> = {
  proposed: { label: 'Waiting for approval', tone: 'purple' },
  new: { label: 'Sent, not seen yet', tone: 'accent' },
  acknowledged: { label: 'Seen', tone: 'accent' },
  in_progress: { label: 'In progress', tone: 'accent' },
  blocked: { label: 'Blocked', tone: 'red' },
  done: { label: 'Done', tone: 'green' },
  declined: { label: 'Declined', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: undefined },
  rejected: { label: 'Rejected', tone: undefined },
};

/** The statuses where a person can still cancel. */
export const CAN_CANCEL: InstructionStatus[] = ['new', 'acknowledged', 'in_progress', 'blocked'];

export function issuerWords(ins: Pick<InstructionView, 'issuer_kind' | 'issuer_name'>): string {
  return ins.issuer_kind === 'conductor' ? 'the Conductor' : ins.issuer_name;
}

export function PriorityPill({ priority }: { priority: InstructionView['priority'] }) {
  if (priority === 'high') return <Pill tone="amber">High priority</Pill>;
  if (priority === 'low') return <Pill>Low priority</Pill>;
  return null;
}

/** The facts of an instruction: what to do, when it counts as done, due date, and proof. */
export function InstructionFacts({
  text,
  doneWhen,
  dueAt,
  note,
  proof,
  overdueCounts,
}: {
  text: string;
  doneWhen?: string | null;
  dueAt?: string | null;
  note?: string | null;
  proof?: string | null;
  overdueCounts?: boolean;
}) {
  const now = useNow();
  const overdue = !!overdueCounts && !!dueAt && new Date(dueAt).getTime() < now;
  return (
    <>
      <div className="lane-ins-text">
        <SafeText text={text} />
      </div>
      {(doneWhen || dueAt || note || proof) && (
        <dl className="kv lane-ins-kv">
          {doneWhen ? (
            <>
              <dt>Done when</dt>
              <dd>
                <SafeText text={doneWhen} />
              </dd>
            </>
          ) : null}
          {dueAt ? (
            <>
              <dt>Due</dt>
              <dd>
                <Time iso={dueAt} /> {overdue && <Pill tone="red">Overdue</Pill>}
              </dd>
            </>
          ) : null}
          {note ? (
            <>
              <dt>Note</dt>
              <dd>
                <SafeText text={note} />
              </dd>
            </>
          ) : null}
          {proof ? (
            <>
              <dt>Proof</dt>
              <dd>
                <SafeText text={proof} />
              </dd>
            </>
          ) : null}
        </dl>
      )}
    </>
  );
}

/** One instruction in a lane. A person can cancel it while it is still open. */
export function InstructionItem({ ins, cancelled, onCancel }: { ins: InstructionView; cancelled: boolean; onCancel: (ins: InstructionView) => void }) {
  const status = cancelled ? INSTRUCTION_STATUS.cancelled : INSTRUCTION_STATUS[ins.status];
  const open = !cancelled && CAN_CANCEL.includes(ins.status);
  return (
    <li className={`lane-ins${cancelled ? ' lane-ins-gone' : ''}`}>
      <div className="row lane-ins-head">
        <Pill tone={status.tone}>{status.label}</Pill>
        <PriorityPill priority={ins.priority} />
        <span className="tiny faint">from {issuerWords(ins)}</span>
      </div>
      <InstructionFacts text={ins.text} doneWhen={ins.done_when} dueAt={ins.due_at} note={ins.status_note} proof={ins.proof} overdueCounts={open} />
      {open && (
        <div>
          <button type="button" className="btn btn-ghost btn-sm b-touch" onClick={() => onCancel(ins)}>
            Cancel this instruction
          </button>
        </div>
      )}
    </li>
  );
}
