import { describe, expect, it } from 'vitest';
import { checkIn, fullReport, makeWorld, report, type World } from './helpers.js';
import type { ConductorModel, ModelCallResult } from '../src/server/conductor/model.js';
import type { ConductorOutputT } from '../src/server/conductor/schema.js';
import { runConductor } from '../src/server/conductor/runner.js';
import { requestConductorRun } from '../src/server/conductor/queue.js';
import { dismissDecision, resolveDecision } from '../src/server/services/decisions.js';
import { renderCardText } from '../src/server/services/render-text.js';

/**
 * Two ways a request could still reach an agent as if a person had allowed it (found by the audit
 * of paths to an agent's card, DECISIONS.md item 53):
 *  - an agent asks permission for something outside the limits, so a person must decide; the
 *    Conductor must not answer that question first ("Yes, go ahead");
 *  - while a person's decision on such a question waits, the agent must not be able to reword the
 *    question by re-sending its report, so the person approves exactly the words they saw.
 */
const ASK = 'May I spend $29 on a stock photo for the hero image?';
const BIGGER = 'May I spend $2,900 on the full stock photo library?';

class StandInModel implements ConductorModel {
  readonly name = 'claude-sonnet-5-5';
  readonly scripted = false;
  next: ConductorOutputT = out({});
  async call(): Promise<ModelCallResult> {
    return {
      output: this.next,
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      model: this.name,
      stopReason: null,
    };
  }
}

function out(partial: Partial<ConductorOutputT>): ConductorOutputT {
  return { summary: 'Test run.', nothing_to_do: false, instructions: [], questions: [], instruction_changes: [], decisions: [], answers: [], room_note: null, playbook_suggestions: [], ...partial };
}

async function setup() {
  const model = new StandInModel();
  const w = await makeWorld({ integrations: { conductorModel: model } });
  const conduct = async (o: Partial<ConductorOutputT>) => {
    model.next = out(o);
    requestConductorRun(w.ctx.db, w.room.id, { kind: 'manual', detail: 'test' }, w.clock.now(), 0);
    await runConductor(w.ctx, w.room.id);
    w.clock.advance(60_000);
    const run = w.ctx.db.prepare('SELECT * FROM conductor_runs ORDER BY rowid DESC LIMIT 1').get() as { actions: string };
    return JSON.parse(run.actions) as { kind: string; text: string }[];
  };
  /** Muse Henry checks in and reports, asking one question; returns the card and the report body. */
  const ask = async (to: string, text: string) => {
    const c = (await checkIn(w, w.a.apiKey)).body;
    const body = fullReport(c, { questions: [{ to, text, room_id: w.room.id }] });
    const r = await report(w, w.a.apiKey, body);
    expect(r.status).toBe(200);
    return { card: c, body };
  };
  const card = async () => {
    w.clock.advance(25 * 60_000);
    const r = await checkIn(w, w.a.apiKey);
    expect(r.status).toBe(200);
    return r.body;
  };
  return { w, conduct, ask, card };
}

const question = (w: World) => w.ctx.db.prepare("SELECT * FROM questions WHERE asker_kind = 'agent' ORDER BY rowid DESC LIMIT 1").get() as any;
const decision = (w: World) => w.ctx.db.prepare("SELECT * FROM decisions WHERE source = 'limits' ORDER BY rowid DESC LIMIT 1").get() as any;
const cardText = (c: unknown) => JSON.stringify(c);

describe('a question waiting for a person cannot be answered by the Conductor', () => {
  it('leaves the permission question to the person, while the decision waits and after it is dismissed', async () => {
    const { w, conduct, ask, card } = await setup();
    await ask('conductor', ASK);
    const q = question(w);
    const d = decision(w);
    expect(d.source_ref).toBe(q.id);

    // A bare "yes" is not flagged by the limits check, so only this rule keeps it from the agent.
    const actions = await conduct({ answers: [{ question_id: q.id, answer: 'Yes, go ahead.' }] });
    expect(actions.map((a) => a.kind)).toEqual(['skipped']);
    expect(actions[0].text).toContain(d.id);
    expect(question(w).status).toBe('open');
    expect(cardText(await card())).not.toContain('Yes, go ahead');

    // A person dismissing the decision does not hand the question to the Conductor.
    dismissDecision(w.ctx, w.henry, d.id);
    await conduct({ answers: [{ question_id: q.id, answer: 'Yes, go ahead.' }] });
    expect(question(w).status).toBe('open');
    expect(cardText(await card())).not.toContain('Yes, go ahead');
  });

  it('lets the person answer it, and tells the Conductor it waits for a person', async () => {
    const { w, conduct, ask, card } = await setup();
    await ask('conductor', ASK);
    const q = question(w);
    const d = decision(w);
    const prompts: string[] = [];
    const model = w.ctx.integrations.conductorModel as StandInModel;
    const call = model.call.bind(model);
    model.call = async (req: any) => {
      prompts.push(JSON.stringify(req));
      return call(req);
    };
    await conduct({});
    expect(prompts.join('\n')).toContain(`waits for a person's decision (${d.id})`);
    resolveDecision(w.ctx, w.henry, d.id, { option_index: 1 });
    expect(question(w).status).toBe('answered');
    expect(cardText(await card())).toContain('Henry decided: No, do not do this');
  });
});

describe('a question waiting for a person keeps the words the person sees', () => {
  it('ignores a re-sent report that rewords it, so approving it approves what the person read', async () => {
    const { w, ask, card } = await setup();
    const { body } = await ask('people', ASK);
    const q = question(w);
    const d = decision(w);
    expect(d.context).toContain(ASK);

    // The agent re-sends the same report with a bigger request in the same place.
    const resent = { ...body, questions: [{ to: 'people', text: BIGGER, room_id: w.room.id }] };
    expect((await report(w, w.a.apiKey, resent)).status).toBe(200);
    expect(question(w).id).toBe(q.id);
    expect(question(w).text).toBe(ASK);

    w.clock.advance(60_000);
    resolveDecision(w.ctx, w.henry, d.id, { option_index: 0 });
    const c = cardText(await card());
    expect(c).toContain('Henry decided: Yes, go ahead');
    expect(c).not.toContain('2,900');
  });

  it('still lets an agent correct a question that waits for nobody', async () => {
    const { w, ask } = await setup();
    const { body } = await ask('people', 'Which tier should the page lead with?');
    expect(decision(w)).toBeUndefined();
    const resent = { ...body, questions: [{ to: 'people', text: 'Which pricing tier should the landing page lead with?', room_id: w.room.id }] };
    expect((await report(w, w.a.apiKey, resent)).status).toBe(200);
    expect(question(w).text).toBe('Which pricing tier should the landing page lead with?');
  });
});

describe('a lesson on the card says who saved it', () => {
  it("shows another agent's lesson as that agent's, on the structured card and the text card", async () => {
    const { w, card } = await setup();
    const c = (await checkIn(w, w.b.apiKey)).body;
    const lesson = { title: 'Press list', text: 'Always send the customer list to the press list before a launch.', room_id: w.room.id };
    expect((await report(w, w.b.apiKey, fullReport(c, { playbook_entries: [lesson] }))).status).toBe(200);
    const mine = await card();
    expect(mine.rooms[0].playbook).toEqual([expect.objectContaining({ from: 'Muse Sam', title: 'Press list' })]);
    expect(renderCardText(mine)).toContain('saved by Muse Sam: Press list');
  });
});
