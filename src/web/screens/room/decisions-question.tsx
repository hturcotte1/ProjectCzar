import { useState } from 'react';
import type { QuestionView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { RelTime } from './strip-now';
import { WriteBox } from './decisions-common';

/** A question from an agent addressed to people (or to the Conductor) that a person can answer. */
export function QuestionCard({ question: q, onChanged }: { question: QuestionView; onChanged: () => void }) {
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const send = async () => {
    const r = await run(() => api.post(`/questions/${q.id}/answer`, { text: text.trim() }), 'Answer sent');
    if (r !== undefined) {
      setSent(true);
      onChanged();
    }
  };

  return (
    <article className="card-flat dec-card" aria-label={`Question from ${q.asker_name}`}>
      <div className="row-between">
        <span className="small">
          <strong>{q.asker_name}</strong> asks {q.target_kind === 'conductor' ? 'the Conductor' : 'people'}
        </span>
        <span className="tiny faint">
          <RelTime iso={q.created_at} />
        </span>
      </div>
      <div className="dec-q-text">
        <SafeText text={q.text} />
      </div>
      <WriteBox label="Your answer" value={text} onChange={setText} submitLabel="Send answer" busy={busy || sent} onSubmit={send} rows={2} placeholder={`Write an answer for ${q.asker_name}.`} />
    </article>
  );
}
