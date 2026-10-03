import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApp, createContext } from '../src/server/app.js';
import { FakeClock } from '../src/server/clock.js';
import { openDatabase } from '../src/server/db/index.js';
import { createInvite, createPerson } from '../src/server/services/auth.js';
import { createAgent, createRoom, rotateKey } from '../src/server/services/manage.js';
import { MONDAY_9AM } from './helpers.js';

/**
 * Definition of done #14 (part): no secrets appear in logs. Real traffic goes through every door
 * with the production logger switched on (debug level); everything it writes is captured and
 * searched for secrets. The stored connection and audit logs are checked too.
 */
describe('logs', () => {
  it('never contain agent keys, page tokens, passwords, session cookies or invite tokens', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const ctx = createContext({ db: openDatabase(':memory:'), clock: new FakeClock(MONDAY_9AM), env: { NODE_ENV: 'production', LOG_LEVEL: 'debug', BASE_URL: 'http://tempo.test' } });
    const { app } = await buildApp({ logger: true, logStream: sink }, ctx);

    const password = 'very secret password 123';
    const henry = await createPerson(ctx, { name: 'Henry', email: 'henry@example.com', password, role: 'admin' });
    const room = createRoom(ctx, henry, { name: 'Launch' });
    const agent = createAgent(ctx, henry, { name: 'Muse Henry', type: 'muse', room_ids: [room.id] });
    const { token: inviteToken } = createInvite(ctx, henry, { email: 'pat@example.com' });

    const login = await app.inject({ method: 'POST', url: '/api/app/login', headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo' }, payload: JSON.stringify({ email: 'henry@example.com', password }) });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const sessionToken = cookie.split('=')[1];
    const csrf = JSON.parse(login.body).csrf_token as string;
    await app.inject({ method: 'GET', url: '/api/app/me', headers: { cookie } });
    await app.inject({ method: 'POST', url: '/api/app/login', headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo' }, payload: JSON.stringify({ email: 'henry@example.com', password: 'wrong ' + password }) });
    await app.inject({ method: 'GET', url: `/invite/${inviteToken}` });
    await app.inject({ method: 'GET', url: `/api/app/invites/${inviteToken}` });
    const created = await app.inject({ method: 'POST', url: '/api/app/agents', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'Instinct Henry', type: 'instinct', room_ids: [room.id] }) });
    const createdKey = JSON.parse(created.body).api_key as string;
    await app.inject({ method: 'POST', url: '/api/v1/agent/check-in', headers: { authorization: `Bearer ${agent.apiKey}`, 'content-type': 'application/json' }, payload: '{}' });
    await app.inject({ method: 'GET', url: '/api/v1/agent/whoami', headers: { 'x-api-key': agent.apiKey } });
    await app.inject({ method: 'GET', url: '/api/v1/agent/whoami', headers: { authorization: 'Bearer tempo_ak_wrongwrongwrongwrongwrongwrong' } });
    await app.inject({ method: 'GET', url: `/a/${agent.pageToken}`, headers: { 'user-agent': 'Mozilla/5.0 Chrome/140' } });
    await app.inject({ method: 'POST', url: `/a/${agent.pageToken}`, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 Chrome/140' }, payload: 'card_id=card_1' });
    const rotated = rotateKey(ctx, { kind: 'person', id: henry.id, name: 'Henry' }, agent.agent.id, 'api');
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = new Client({ name: 'log-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${rotated}` } } }));
    await client.callTool({ name: 'tempo_whoami', arguments: {} });
    await client.close();
    await app.close();

    const all = lines.join('');
    expect(lines.length).toBeGreaterThan(20); // the logger really captured the traffic
    expect(all).toContain('/a/[redacted]');
    expect(all).toContain('/invite/[redacted]');
    for (const secret of [agent.apiKey, agent.pageToken, rotated, createdKey, password, sessionToken, csrf, inviteToken, 'tempo_ak_wrongwrongwrongwrongwrongwrong']) {
      expect(all.includes(secret), `log contains a secret starting ${secret.slice(0, 6)}`).toBe(false);
    }
    const stored = JSON.stringify(ctx.db.prepare('SELECT * FROM connection_log').all()) + JSON.stringify(ctx.db.prepare('SELECT * FROM audit_log').all());
    for (const secret of [agent.apiKey, agent.pageToken, rotated, createdKey, password, sessionToken, inviteToken]) expect(stored.includes(secret)).toBe(false);
  });
});
