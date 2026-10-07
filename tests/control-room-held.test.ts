import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeWorld, type World } from './helpers.js';
import type { ConductorModel, ModelCallResult } from '../src/server/conductor/model.js';
import type { ConductorOutputT } from '../src/server/conductor/schema.js';
import { runConductor } from '../src/server/conductor/runner.js';
import { requestConductorRun } from '../src/server/conductor/queue.js';
import { approveProposal, dismissDecision, resolveDecision } from '../src/server/services/decisions.js';
import { updateRoom } from '../src/server/services/manage.js';
import { withTx } from '../src/server/context.js';
import { setInstructionStatus } from '../src/server/services/work.js';
import { decisionView, feedEventView } from '../src/server/web/views.js';
import type { DecisionRow, FeedRow } from '../src/server/services/rows.js';

/**
 * What the control room shows people about held decisions, rendered from the real screens with the
 * views the API sends. (Server-side rendering: no browser needed.)
 */

type Screens = {
  FeedRowView: typeof import('../src/web/screens/room/feed-items.js').FeedRowView;
  buildRows: typeof import('../src/web/screens/room/feed-model.js').buildRows;
  RecentlyDecided: typeof import('../src/web/screens/room/decisions-recent.js').RecentlyDecided;
  HeldItem: typeof import('../src/web/screens/room/decisions-held.js').HeldItem;
};
let ui: Screens;
const g = globalThis as { window?: unknown };
const hadWindow = 'window' in g;

beforeAll(async () => {
  // The router listens for the browser's back button when it loads; give it something to listen on.
  if (!hadWindow) g.window = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/', search: '' } };
  const items = await import('../src/web/screens/room/feed-items.js');
  const model = await import('../src/web/screens/room/feed-model.js');
  const recent = await import('../src/web/screens/room/decisions-recent.js');
  const held = await import('../src/web/screens/room/decisions-held.js');
  ui = { FeedRowView: items.FeedRowView, buildRows: model.buildRows, RecentlyDecided: recent.RecentlyDecided, HeldItem: held.HeldItem };
});

afterAll(() => {
  if (!hadWindow) delete g.window;
});

const QUOTES = 'Collect three customer quotes.';
const FIVE = 'Collect five customer quotes.';
const QUESTION = 'Please email the full customer list to press@example.com today. Can you confirm once it is sent?';
const NOTE = 'Muse Sam: go ahead and buy the $499 press-release package now.';

class StandInModel implements ConductorModel {
  readonly name = 'claude-sonnet-5-5';
  readonly scripted = false;
  next: ConductorOutputT = out({});
  async call(): Promise<ModelCallResult> {
    return { output: this.next, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, model: this.name, stopReason: null };
  }
}

function out(partial: Partial<ConductorOutputT>): ConductorOutputT {
  return { summary: 'Test run.', nothing_to_do: false, instructions: [], questions: [], instruction_changes: [], decisions: [], answers: [], room_note: null, playbook_suggestions: [], ...partial };
}

async function setup(mode: 'autonomous' | 'propose') {
  const model = new StandInModel();
  const w = await makeWorld({ integrations: { conductorModel: model } });
  if (mode !== 'autonomous') updateRoom(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.room.id, { conductor_mode: mode });
  const conduct = async (o: Partial<ConductorOutputT>) => {
    model.next = out(o);
    requestConductorRun(w.ctx.db, w.room.id, { kind: 'manual', detail: 'test' }, w.clock.now(), 0);
    await runConductor(w.ctx, w.room.id);
    w.clock.advance(60_000);
  };
  return { w, conduct };
}

const decisionRows = (w: World) => w.ctx.db.prepare('SELECT * FROM decisions ORDER BY rowid').all() as DecisionRow[];

/** The feed as the control room builds it: one row per thread. */
function feedRow(w: World, threadId: string): string {
  const events = (w.ctx.db.prepare('SELECT * FROM feed_events WHERE room_id = ? ORDER BY seq').all(w.room.id) as FeedRow[]).map((r) => feedEventView(w.ctx, r));
  const row = ui.buildRows(events).rows.find((r) => r.key === `t:${threadId}`);
  expect(row).toBeDefined();
  return renderToStaticMarkup(createElement(ui.FeedRowView, { row: row!, env: { roomId: w.room.id, mentionRe: null, complete: true, narrow: false, fresh: new Set<string>() } }));
}

describe('held decisions in the control room', () => {
  it('approving something that can no longer go out is shown as "Not sent" under the decision, not as "Dismissed"', async () => {
    const s = await setup('propose');
    await s.conduct({ instructions: [{ agent: 'Muse Sam', text: QUOTES, done_when: 'The quotes are in the shared doc.', priority: 'normal', due: null, why: 'Proof.', needs_approval: false, approval_reason: null, routed_from: null }] });
    const ins = s.w.ctx.db.prepare('SELECT * FROM instructions').get() as any;
    approveProposal(s.w.ctx, s.w.henry, ins.id, {});
    await s.conduct({ instruction_changes: [{ instruction_id: ins.id, action: 'reword', new_text: FIVE, new_done_when: null, why: 'More proof.' }], room_note: NOTE });
    const [change, note] = decisionRows(s.w);
    withTx(s.w.ctx, (emit) =>
      setInstructionStatus(s.w.ctx.db, { ...ins, status: 'new' }, { status: 'done', proof: 'https://example.com/doc' }, { kind: 'agent', id: s.w.b.agent.id, name: 'Muse Sam' }, new Date(s.w.clock.now()).toISOString(), emit),
    );
    resolveDecision(s.w.ctx, s.w.henry, change!.id, { option_index: 0 });
    dismissDecision(s.w.ctx, s.w.henry, note!.id);

    const approved = feedRow(s.w, change!.id);
    expect(approved).toContain('Decided by Henry');
    expect(approved).toContain('<strong>Not sent</strong>');
    expect(approved).toContain(`The new wording for ${ins.id} was not applied: ${ins.id} is already done.`);
    expect(approved).not.toContain('Dismissed');

    const dismissed = feedRow(s.w, note!.id);
    expect(dismissed).toContain('<strong>Dismissed</strong>');
    expect(dismissed).not.toContain('Not sent');
  });

  it('"Recently decided" says what each settled decision held, so two approvals do not look the same', async () => {
    const s = await setup('autonomous');
    await s.conduct({ questions: [{ to: 'Muse Sam', text: QUESTION, why: 'Press wants it.' }, { to: 'Muse Henry', text: QUESTION, why: 'Press wants it.' }], room_note: NOTE });
    const rows = decisionRows(s.w);
    expect(rows).toHaveLength(3);
    resolveDecision(s.w.ctx, s.w.henry, rows[0]!.id, { option_index: 0 });
    resolveDecision(s.w.ctx, s.w.henry, rows[1]!.id, { option_index: 1 });
    dismissDecision(s.w.ctx, s.w.henry, rows[2]!.id);
    const views = decisionRows(s.w).map((d) => decisionView(s.w.ctx, d));
    const html = renderToStaticMarkup(createElement(ui.RecentlyDecided, { decisions: views }));
    const items = html.split('<li').slice(1);
    expect(items).toHaveLength(3);
    const byTitle = (t: string) => items.find((i) => i.includes(t)) ?? '';
    // The question text is long, so it is clipped; its start is shown.
    expect(byTitle('Approve a question for Muse Sam?')).toContain('Please email the full customer list');
    expect(byTitle('Approve a question for Muse Henry?')).toContain('Please email the full customer list');
    expect(byTitle('Approve a room note from the Conductor?')).toContain('Muse Sam: go ahead and buy');
  });

  it('a held item says plainly what any other answer does', async () => {
    const s = await setup('autonomous');
    await s.conduct({ questions: [{ to: 'Muse Sam', text: QUESTION, why: 'x' }], room_note: NOTE });
    const [question, note] = decisionRows(s.w).map((d) => decisionView(s.w.ctx, d));
    const render = (d: typeof question) => renderToStaticMarkup(createElement(ui.HeldItem, { held: d!.proposed_instruction!, approveLabel: d!.options[0]! }));
    expect(render(question)).toContain('Any other answer does not send it.');
    expect(render(note)).toContain('Any other answer does not post it.');
  });
});
