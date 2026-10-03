import { afterEach, describe, expect, it } from 'vitest';
import { Client as V1Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as V1Transport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client as V2Client, StreamableHTTPClientTransport as V2Transport } from '@modelcontextprotocol/client';
import { count, makeWorld, type World } from './helpers.js';
import { personPost } from '../src/server/services/people-actions.js';
import { revokeKeys } from '../src/server/services/manage.js';

const TOOL_NAMES = ['tempo_check_in', 'tempo_lookup', 'tempo_post', 'tempo_report', 'tempo_whoami'];

let open: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const o of open) await o.close().catch(() => {});
  open = [];
});

async function listen(w: World): Promise<string> {
  const addr = await w.app.listen({ port: 0, host: '127.0.0.1' });
  open.push({ close: () => w.app.close() });
  return addr;
}

async function v1(url: string, key: string | null): Promise<V1Client> {
  const client = new V1Client({ name: 'tempo-test-v1', version: '1.0.0' });
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  await client.connect(new V1Transport(new URL(`${url}/mcp`), { requestInit: { headers } }));
  open.push({ close: () => client.close() });
  return client;
}

async function v2(url: string, key: string): Promise<V2Client> {
  const client = new V2Client({ name: 'tempo-test-v2', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } } as never);
  await client.connect(new V2Transport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  open.push({ close: () => client.close() });
  return client;
}

function text(result: any): string {
  return (result.content ?? []).map((c: any) => c.text).join('\n');
}

describe('Door A: MCP over streamable HTTP', () => {
  it('a client on the official v1 SDK can initialize, list tools and call each one', async () => {
    const w = await makeWorld();
    personPost(w.ctx, w.sam, w.room.id, { kind: 'question', to: 'Muse Henry', text: 'Which headline do you prefer?' });
    const url = await listen(w);
    const client = await v1(url, w.a.apiKey);
    expect(client.getServerVersion()?.name).toBe('tempo');
    expect(client.getInstructions()).toMatch(/tempo_check_in/);

    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
    for (const t of tools) {
      expect(t.description && t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations).toBeTruthy();
    }
    const report = tools.find((t) => t.name === 'tempo_report')!;
    expect(Object.keys(report.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['card_id', 'rooms', 'answers', 'instruction_updates', 'questions', 'playbook_entries']),
    );
    expect(tools.find((t) => t.name === 'tempo_whoami')!.annotations?.readOnlyHint).toBe(true);

    const who = await client.callTool({ name: 'tempo_whoami', arguments: {} });
    expect(who.isError).toBeFalsy();
    expect((who.structuredContent as any).connected).toBe(true);
    expect(text(who)).toMatch(/Connected to Tempo as Muse Henry/);

    const cardRes = await client.callTool({ name: 'tempo_check_in', arguments: {} });
    const card = cardRes.structuredContent as any;
    expect(card.card_id).toMatch(/^card_/);
    expect(text(cardRes)).toContain('TEMPO BRIEFING CARD');
    expect(text(cardRes)).toContain('Which headline do you prefer?');
    const qid = card.rooms[0].questions_for_you[0].id;

    const bad = await client.callTool({ name: 'tempo_report', arguments: { card_id: card.card_id, rooms: [{ room_id: w.room.id, working_on: 'Headlines.' }] } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/^Report not accepted\. Missing: an answer to q_\d+/);

    const good = await client.callTool({
      name: 'tempo_report',
      arguments: { card_id: card.card_id, rooms: [{ room_id: w.room.id, working_on: 'Headlines.' }], answers: [{ question_id: qid, answer: 'The second one.' }] },
    });
    expect(good.isError).toBeFalsy();
    expect((good.structuredContent as any).ok).toBe(true);

    const post = await client.callTool({ name: 'tempo_post', arguments: { kind: 'note', text: 'Heads up: new hero image in the doc.' } });
    expect(post.isError).toBeFalsy();
    expect((post.structuredContent as any).id).toMatch(/^evt_/);

    const look = await client.callTool({ name: 'tempo_lookup', arguments: { query: 'hero image' } });
    expect(look.isError).toBeFalsy();
    expect((look.structuredContent as any).results.length).toBeGreaterThan(0);

    // The connection log has every call with the exact text the agent saw.
    const rows = w.ctx.db.prepare("SELECT action, result, message FROM connection_log WHERE door = 'mcp' ORDER BY id").all() as any[];
    expect(rows.some((r) => r.action === 'initialize' && r.result === 'ok')).toBe(true);
    expect(rows.some((r) => r.action === 'report' && r.result === 'rejected' && r.message === text(bad))).toBe(true);
    expect(rows.filter((r) => r.action === 'report' && r.result === 'ok').length).toBe(1);
  });

  it('a client on the v2 SDK speaking the 2026-07-28 protocol works too', async () => {
    const w = await makeWorld();
    const url = await listen(w);
    const client = await v2(url, w.b.apiKey);
    expect((client as any).getProtocolEra?.()).toBe('modern');
    const tools = (await client.listTools()).tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual(TOOL_NAMES);
    const cardRes: any = await client.callTool({ name: 'tempo_check_in', arguments: {} });
    const card = cardRes.structuredContent;
    const ok: any = await client.callTool({ name: 'tempo_report', arguments: { card_id: card.card_id, rooms: [{ room_id: w.room.id, working_on: 'Pricing table.' }] } });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent.message).toMatch(/Report accepted/);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports WHERE agent_id = ?', w.b.agent.id)).toBe(1);
  });

  it('answers with plain JSON (not SSE) in both protocol eras', async () => {
    const w = await makeWorld();
    const url = await listen(w);
    const legacy = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.a.apiKey}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
    });
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get('content-type')).toMatch(/application\/json/);
    const body = await legacy.json();
    expect(body.result.serverInfo.name).toBe('tempo');
  });

  it('a bad or missing key gets a clear error; a revoked key stops at once', async () => {
    const w = await makeWorld();
    const url = await listen(w);
    await expect(v1(url, 'tempo_ak_not_a_real_key')).rejects.toThrow(/not recognized.*Authorization: Bearer/s);
    await expect(v1(url, null)).rejects.toThrow(/No agent key was sent/);
    const raw = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    expect(raw.status).toBe(401);
    expect(raw.headers.get('www-authenticate')).toMatch(/Bearer/);
    const j = await raw.json();
    expect(j.error.message).toMatch(/No agent key was sent/);

    const client = await v1(url, w.a.apiKey);
    expect((await client.callTool({ name: 'tempo_whoami', arguments: {} })).isError).toBeFalsy();
    revokeKeys(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.a.agent.id, 'api');
    await expect(client.callTool({ name: 'tempo_whoami', arguments: {} })).rejects.toThrow(/revoked or replaced/);
  });

  it('GET and DELETE on /mcp are refused with 405 and a plain explanation', async () => {
    const w = await makeWorld();
    const r = await w.app.inject({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${w.a.apiKey}` } });
    expect(r.statusCode).toBe(405);
    expect(JSON.parse(r.body).error.message).toMatch(/send each JSON-RPC message as a POST/);
  });
});
