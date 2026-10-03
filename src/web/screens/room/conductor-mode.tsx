import { useState } from 'react';
import type { ConductorMode, RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { linkProps } from '../../lib/router';
import { useAction } from '../../components/ui';
import { MODE_WORDS, forcedModeLabel } from './conductor-common';
import './room-c.css';

const ORDER: ConductorMode[] = ['autonomous', 'propose', 'relay'];

/** Three clear choices for how much freedom the Conductor has. Saves as soon as one is picked. */
export function ModeChoices({ detail, onChanged }: { detail: RoomDetail; onChanged: () => void | Promise<void> }) {
  const { busy, run } = useAction();
  const [pending, setPending] = useState<ConductorMode | null>(null);
  const current = pending ?? detail.room.conductor_mode;
  const forced = forcedModeLabel(detail.conductor);
  const waiting = detail.proposals.length;

  const choose = (mode: ConductorMode) => {
    if (mode === detail.room.conductor_mode || busy) return;
    setPending(mode);
    void run(async () => {
      try {
        await api.patch(`/rooms/${detail.room.id}`, { conductor_mode: mode });
        await onChanged();
      } finally {
        setPending(null);
      }
    }, `The Conductor is now in ${MODE_WORDS[mode].name} mode.`);
  };

  return (
    <div className="stack">
      <fieldset className="c-modes">
        <legend className="label">How much freedom does the Conductor have?</legend>
        {ORDER.map((m) => (
          <label key={m} className="c-choice" data-checked={current === m} data-busy={busy}>
            <input type="radio" name="conductor-mode" value={m} checked={current === m} disabled={busy} onChange={() => choose(m)} />
            <span className="c-choice-text">
              <strong>
                {MODE_WORDS[m].name}
                {m === 'autonomous' && <span className="muted"> (the usual choice)</span>}
              </strong>
              <span className="small muted">{MODE_WORDS[m].explain}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {forced && (
        <p className="small" role="status" style={{ margin: 0 }}>
          <strong>Right now this room is acting as {forced}.</strong> The choice above is kept and takes effect again once that is sorted out.
        </p>
      )}
      {waiting > 0 && (
        <p className="small" style={{ margin: 0 }}>
          {waiting} {waiting === 1 ? 'instruction is' : 'instructions are'} waiting for your approval. Find {waiting === 1 ? 'it' : 'them'} under{' '}
          <a {...linkProps(`/rooms/${detail.room.id}/decisions`)}>Waiting on you</a>.
        </p>
      )}
    </div>
  );
}
