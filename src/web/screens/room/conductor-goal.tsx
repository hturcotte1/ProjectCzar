import { useCallback, useEffect, useId, useState } from 'react';
import type { GoalHistoryEntry } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { Time, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import './room-c.css';

const MAX_GOAL = 4000;

/** The room's goal: editable by anyone in the room, with the earlier versions underneath. */
export function GoalEditor({ roomId, goal, onChanged }: { roomId: string; goal: string; onChanged: () => void | Promise<void> }) {
  const id = useId();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<string | null>(null); // null: untouched, follows the saved goal
  const [history, setHistory] = useState<GoalHistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.get<GoalHistoryEntry[]>(`/rooms/${roomId}/goal-history`));
    } catch {
      /* the history is a nicety; the editor still works without it */
    }
  }, [roomId]);
  // The saved goal changes when anyone edits it, so reload the history with it.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory, goal]);

  const value = draft ?? goal;
  const dirty = draft !== null && draft.trim() !== goal.trim();

  const save = () =>
    run(async () => {
      await api.patch(`/rooms/${roomId}`, { goal: value.trim() });
      await onChanged();
      setDraft(null);
    }, 'Goal saved. The Conductor will take a fresh look.');

  return (
    <div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor={id} className="sr-only">
          Goal
        </label>
        <textarea
          id={id}
          className="textarea"
          rows={5}
          value={value}
          maxLength={MAX_GOAL}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty && !busy) {
              e.preventDefault();
              void save();
            }
          }}
          aria-describedby={`${id}-hint`}
        />
        <span className="hint" id={`${id}-hint`}>
          Say in a few sentences what this room is working toward. The Conductor turns it into instructions for each agent, and takes a fresh look whenever you change it.
        </span>
        {value.length > MAX_GOAL - 500 && (
          <span className="tiny c-counter c-counter-warn">
            {value.length} of {MAX_GOAL} characters
          </span>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save goal'}
        </button>
        {dirty && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)}>
            Discard changes
          </button>
        )}
      </div>

      {history.length > 1 && (
        <details className="c-history">
          <summary>Earlier versions of the goal ({history.length - 1})</summary>
          <ul className="c-history-list">
            {history.slice(1).map((h, i) => (
              <li key={`${h.changed_at}-${i}`} className="c-history-item">
                <SafeText text={h.goal} />
                <div className="row-between">
                  <span className="tiny faint">
                    {h.changed_by_name ? `${h.changed_by_name}, ` : ''}
                    <Time iso={h.changed_at} />
                  </span>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setDraft(h.goal)}>
                    Use this version
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
