import { useState } from 'react';
import type { AgentView } from '../../../shared/app-types';
import { useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { FormError } from './form-error';
import { ScheduleFields, checkDraft, draftFrom, type ScheduleDraft, type ScheduleErrors } from './schedule-fields';

/**
 * Edit when the agent is expected to check in. The form restarts from the saved schedule whenever the
 * schedule changes on the server (the page gives it a key built from the schedule).
 */
export function AgentSchedule({ agent, onSaved }: { agent: AgentView; onSaved: () => void }) {
  const saved = draftFrom(agent.schedule);
  const [draft, setDraft] = useState<ScheduleDraft>(saved);
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkDraft(draft, { offsetRequired: true, withGrace: true });
    setErrors(checked.errors);
    if (!checked.input) {
      setError(new Error('Please fix the highlighted fields.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/agents/${agent.id}`, { schedule: checked.input });
      toast('Schedule saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <p className="muted small" style={{ margin: 0 }}>
        Now: <strong>{agent.schedule.text}</strong>
      </p>
      <FormError error={error} />
      <ScheduleFields value={draft} onChange={setDraft} errors={errors} idPrefix="ag-edit" withGrace offsetHint="Shifts every check-in later by this many minutes, so agents in the same room don't all check in together." />
      <div className="banner banner-info" role="note">
        <span>Your agent keeps its own repeating task. After you save new times, send it the updated message from “Connect your agent” so it matches.</span>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save schedule'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft(saved);
            setErrors({});
            setError(null);
          }}
        >
          Undo changes
        </button>
      </div>
    </form>
  );
}
