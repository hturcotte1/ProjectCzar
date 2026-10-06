import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DateTime } from 'luxon';
import { afterEach, describe, expect, it } from 'vitest';
import { makeWorld, type World } from './helpers.js';
import type { ConductorModel, ModelCallResult } from '../src/server/conductor/model.js';
import { MAX_TOKENS_RETRY_CAP, retryMaxTokens } from '../src/server/conductor/model.js';
import type { ConductorOutputT } from '../src/server/conductor/schema.js';
import { runConductor } from '../src/server/conductor/runner.js';
import { requestConductorRun } from '../src/server/conductor/queue.js';
import { AnthropicConductorModel } from '../src/server/conductor/anthropic.js';
import { loadConfig } from '../src/server/config.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { BRIEF_MAX_TOKENS, briefJob } from '../src/server/services/brief.js';

/**
 * Token limits (outside review, fix 2). The model's thinking counts toward max_tokens, so a reply
 * can be cut off before its JSON is finished (stop reason "max_tokens"). The Conductor starts at
 * CONDUCTOR_MAX_TOKENS (16,000 by default) and the brief at 8,000; a cut-off reply gets one retry
 * with double the limit, capped at 32,000, and a run that still fails says why in plain words.
 */

type Reply = { stopReason: string | null; output: unknown };

/** A stand-in model that records the limit it was given and replies from a script. */
class LimitModel implements ConductorModel {
  readonly name = 'claude-sonnet-5-5';
  readonly scripted = false;
  limits: number[] = [];
  users: string[] = [];
  constructor(private readonly replies: Reply[]) {}
  async call(args: { user: string; maxTokens: number }): Promise<ModelCallResult> {
    this.limits.push(args.maxTokens);
    this.users.push(args.user);
    const r = this.replies[Math.min(this.limits.length - 1, this.replies.length - 1)];
    return {
      output: r.output,
      stopReason: r.stopReason,
      model: this.name,
      usage: { input_tokens: 5000, output_tokens: r.stopReason === 'max_tokens' ? this.limits.at(-1)! : 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  }
}

const CUT_OFF: Reply = { stopReason: 'max_tokens', output: null };

function good(): Reply {
  const o: ConductorOutputT = {
    summary: 'Nothing needs changing.', nothing_to_do: true, instructions: [], questions: [], instruction_changes: [], decisions: [], answers: [], room_note: null, playbook_suggestions: [],
  };
  return { stopReason: null, output: o };
}

async function conduct(model: ConductorModel, config: Parameters<typeof makeWorld>[0]['config'] = {}) {
  const w = await makeWorld({ config, integrations: { conductorModel: model } });
  requestConductorRun(w.ctx.db, w.room.id, { kind: 'manual', detail: 'test' }, w.clock.now(), 0);
  await runConductor(w.ctx, w.room.id);
  return { w, run: w.ctx.db.prepare('SELECT * FROM conductor_runs ORDER BY rowid DESC LIMIT 1').get() as any };
}

describe('Conductor token limits', () => {
  it('starts at 16,000 tokens and retries a cut-off reply once at double the limit', async () => {
    const model = new LimitModel([CUT_OFF, good()]);
    const { run } = await conduct(model);
    expect(model.limits).toEqual([16_000, 32_000]);
    expect(model.users[1]).toContain('Your previous reply was cut off before it finished.');
    expect(run).toMatchObject({ status: 'nothing_to_do', attempts: 2, input_tokens: 10_000, output_tokens: 16_900 });
  });

  it('says in plain words when both replies ran out of room', async () => {
    const model = new LimitModel([CUT_OFF]);
    const { w, run } = await conduct(model);
    expect(model.limits).toEqual([16_000, 32_000]);
    expect(run.status).toBe('failed');
    expect(run.summary).toBe(
      'No action was taken: the Conductor ran out of room twice. Its replies, thinking included, hit the limit of 16,000 and then 32,000 tokens. If this keeps happening, raise CONDUCTOR_MAX_TOKENS or lower CONDUCTOR_EFFORT.',
    );
    expect(run.error).toBe('its reply was cut off at the 32,000-token limit (its thinking counts toward the limit)');
    // Both cut-off replies were paid for, so both count toward the cost.
    expect(run.output_tokens).toBe(48_000);
    expect(run.cost_usd).toBeGreaterThan(0);
    expect((w.ctx.db.prepare('SELECT COUNT(*) n FROM instructions').get() as any).n).toBe(0);
  });

  it('keeps the old wording when a reply fails for another reason', async () => {
    const { run } = await conduct(new LimitModel([{ stopReason: 'refusal', output: null }]));
    expect(run.status).toBe('failed');
    expect(run.error).toBe('the model declined to answer');
    expect(run.summary).toBe('No action was taken because the Conductor did not produce a usable answer after one retry.');
  });

  it('takes its first limit from CONDUCTOR_MAX_TOKENS, and the retry never goes above 32,000 (or below the first)', async () => {
    const m1 = new LimitModel([CUT_OFF, good()]);
    await conduct(m1, { conductorMaxTokens: 20_000 });
    expect(m1.limits).toEqual([20_000, 32_000]);
    const m2 = new LimitModel([CUT_OFF, good()]);
    await conduct(m2, { conductorMaxTokens: 40_000 });
    expect(m2.limits).toEqual([40_000, 40_000]);

    expect(loadConfig({ NODE_ENV: 'test' }).conductorMaxTokens).toBe(16_000);
    expect(loadConfig({ NODE_ENV: 'test', CONDUCTOR_MAX_TOKENS: '24000' }).conductorMaxTokens).toBe(24_000);
    expect(loadConfig({ NODE_ENV: 'test', CONDUCTOR_MAX_TOKENS: '10' }).conductorMaxTokens).toBe(1_024);
    expect(loadConfig({ NODE_ENV: 'test', CONDUCTOR_MAX_TOKENS: '999999' }).conductorMaxTokens).toBe(64_000);
    expect(retryMaxTokens(8_000)).toBe(16_000);
    expect(retryMaxTokens(16_000)).toBe(MAX_TOKENS_RETRY_CAP);
    expect(retryMaxTokens(50_000)).toBe(50_000);
  });
});

describe('daily brief token limits', () => {
  const boise = (local: string) => DateTime.fromISO(local, { zone: 'America/Boise' }).toMillis();
  const BRIEF = { brief: 'What each agent did\n- Muse Henry worked on the pricing copy.\nDecisions made\n- None.' };

  async function brief(model: LimitModel) {
    const w: World = await makeWorld({ integrations: { conductorModel: model } });
    const sched = new Scheduler(w.ctx);
    sched.addJob(briefJob(sched));
    w.clock.set(boise('2026-10-06T07:45'));
    await sched.tick();
    await sched.idle();
    return w.ctx.db.prepare('SELECT * FROM briefs').get() as any;
  }

  it('starts at 8,000 tokens and retries a cut-off brief once at 16,000', async () => {
    const model = new LimitModel([CUT_OFF, { stopReason: null, output: BRIEF }]);
    const b = await brief(model);
    expect(BRIEF_MAX_TOKENS).toBe(8_000);
    expect(model.limits).toEqual([8_000, 16_000]);
    expect(b.method).toBe('model');
    // Both calls are counted: 2 × 5,000 input and 8,000 + 900 output at $2 / $10 per million.
    expect(b.cost_usd).toBeCloseTo((10_000 * 2 + 8_900 * 10) / 1e6, 6);
  });

  it('falls back to the rules brief, and says why, when both tries run out of room', async () => {
    const model = new LimitModel([CUT_OFF]);
    const b = await brief(model);
    expect(model.limits).toEqual([8_000, 16_000]);
    expect(b.method).toBe('rules');
    expect(b.text).toContain("(Written by rules: the Conductor's version ran out of room twice, at 8,000 and then 16,000 tokens including its thinking.)");
  });
});

describe('the real model adapter', () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  /** A local stand-in for the Messages API that streams one reply and records the request. */
  async function fakeApi(reply: { text: string; stop_reason: string; output_tokens: number; thinking_tokens: number }) {
    const seen: { body: any; beta: string | undefined }[] = [];
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ body: JSON.parse(raw), beta: req.headers['anthropic-beta'] as string | undefined });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
        send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: reply.output_tokens, output_tokens_details: { thinking_tokens: reply.thinking_tokens } } });
        send('message_stop', { type: 'message_stop' });
        res.end();
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
  }

  it('sends the limit it is given, streams the reply, and reports a cut-off reply as max_tokens', async () => {
    const api = await fakeApi({ text: '{"summary": "Half a rep', stop_reason: 'max_tokens', output_tokens: 16_000, thinking_tokens: 15_400 });
    const model = new AnthropicConductorModel('sk-test', 'claude-sonnet-5-5', 'medium', 'default', api.url);
    const res = await model.call({ system: 'S', user: 'U', schema: { type: 'object' }, maxTokens: 16_000 });
    expect(api.seen[0].body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16_000, stream: true, output_config: { effort: 'medium', format: { type: 'json_schema' } }, fallbacks: 'default' });
    expect(api.seen[0].beta).toContain('server-side-fallback-2026-07-01');
    expect(res).toMatchObject({ stopReason: 'max_tokens', output: null, usage: { input_tokens: 1200, output_tokens: 16_000, thinking_tokens: 15_400 } });
  });

  it('parses a finished reply, and leaves the refusal fallback off when told to', async () => {
    const api = await fakeApi({ text: '{"brief": "All quiet."}', stop_reason: 'end_turn', output_tokens: 700, thinking_tokens: 500 });
    const model = new AnthropicConductorModel('sk-test', 'claude-sonnet-5-5', 'low', 'off', api.url);
    const res = await model.call({ system: 'S', user: 'U', schema: { type: 'object' }, maxTokens: 8_000 });
    expect(api.seen[0].body.fallbacks).toBeUndefined();
    expect(api.seen[0].beta ?? '').not.toContain('server-side-fallback');
    expect(res).toMatchObject({ stopReason: null, output: { brief: 'All quiet.' }, usage: { output_tokens: 700, thinking_tokens: 500 } });
  });
});
