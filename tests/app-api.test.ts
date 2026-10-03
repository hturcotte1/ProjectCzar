import { afterEach, describe, expect, it } from 'vitest';
import { checkIn, count, fullReport, makeWorld, report, type World } from './helpers.js';
import { createPerson } from '../src/server/services/auth.js';
import { createRoom } from '../src/server/services/manage.js';

interface Session {
  cookie: string;
  csrf: string;
}

async function signIn(w: World, email: string, password: string): Promise<Session> {
  const r = await w.app.inject({
    method: 'POST',
    url: '/api/app/login',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo' },
    payload: JSON.stringify({ email, password }),
  });
  expect(r.statusCode).toBe(200);
  const setCookie = String(r.headers['set-cookie']);
  expect(setCookie).toMatch(/tempo_session=.+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax/);
  return { cookie: setCookie.split(';')[0], csrf: JSON.parse(r.body).csrf_token };
}

async function call(w: World, s: Session | null, method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (s) headers.cookie = s.cookie;
  if (s && method !== 'GET') headers['x-csrf-token'] = s.csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await w.app.inject({ method: method as any, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
  let parsed: any = r.body;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    /* text */
  }
  return { status: r.statusCode, body: parsed, headers: r.headers };
}

async function worldWithLogins() {
  const w = await makeWorld();
  // makeWorld creates people with placeholder hashes; give them real passwords.
  const henry = await createPerson(w.ctx, { name: 'Henry T', email: 'henry2@example.com', password: 'correct horse battery', role: 'admin' });
  const sam = await createPerson(w.ctx, { name: 'Sam L', email: 'sam2@example.com', password: 'another good password', role: 'member' });
  return { w, henry, sam };
}

let toClose: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of toClose) await c().catch(() => {});
  toClose = [];
});

describe('control room API', () => {
  it('signs in with email and password, and refuses bad credentials with one generic message', async () => {
    const { w } = await worldWithLogins();
    const bad = await call(w, null, 'POST', '/api/app/login', { email: 'henry2@example.com', password: 'wrong password!' }, { 'x-requested-with': 'tempo' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toMatch(/don't match an account/);
    const unknown = await call(w, null, 'POST', '/api/app/login', { email: 'nobody@example.com', password: 'wrong password!' }, { 'x-requested-with': 'tempo' });
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    const s = await signIn(w, 'henry2@example.com', 'correct horse battery');
    const me = await call(w, s, 'GET', '/api/app/me');
    expect(me.status).toBe(200);
    expect(me.body.person.name).toBe('Henry T');
    expect(me.body.csrf_token).toBe(s.csrf);
    expect((await call(w, null, 'GET', '/api/app/me')).status).toBe(401);
  });

  it('rejects forged cross-site requests (no CSRF token, wrong origin, or form posts)', async () => {
    const { w } = await worldWithLogins();
    const s = await signIn(w, 'henry2@example.com', 'correct horse battery');
    const room = (await call(w, s, 'POST', '/api/app/rooms', { name: 'Ops' })).body;
    expect(room.id).toMatch(/^room_/);
    // Missing token.
    const noToken = await w.app.inject({ method: 'POST', url: `/api/app/rooms/${room.id}/pause`, headers: { cookie: s.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(noToken.statusCode).toBe(403);
    expect(JSON.parse(noToken.body).error.code).toBe('csrf_failed');
    // Wrong origin even with the token.
    const evil = await call(w, s, 'POST', `/api/app/rooms/${room.id}/pause`, {}, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    // A classic HTML form post (cross-site forms can only send form encodings).
    const form = await w.app.inject({ method: 'POST', url: `/api/app/rooms/${room.id}/pause`, headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': s.csrf }, payload: 'a=1' });
    expect(form.statusCode).toBe(415);
    // Sign-in without the app's header (a cross-site login form) is refused too.
    const loginForm = await w.app.inject({ method: 'POST', url: '/api/app/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'henry2@example.com', password: 'correct horse battery' }) });
    expect(loginForm.statusCode).toBe(403);
    // The real thing works.
    const ok = await call(w, s, 'POST', `/api/app/rooms/${room.id}/pause`, {});
    expect(ok.status).toBe(200);
    expect(ok.body.paused).toBe(true);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM audit_log WHERE action = 'room.pause'")).toBe(1);
  });

  it('shows people only rooms they belong to; being admin grants no access to room content', async () => {
    const { w, sam } = await worldWithLogins();
    const henryS = await signIn(w, 'henry2@example.com', 'correct horse battery');
    const samS = await signIn(w, 'sam2@example.com', 'another good password');
    const samRoom = createRoom(w.ctx, sam, { name: 'Sam only', goal: 'Private goal' });
    const rooms = (await call(w, henryS, 'GET', '/api/app/rooms')).body;
    expect(rooms.map((r: any) => r.id)).not.toContain(samRoom.id);
    for (const path of ['', '/feed', '/conductor', '/playbook', '/health', '/export', '/briefs']) {
      const r = await call(w, henryS, 'GET', `/api/app/rooms/${samRoom.id}${path}`);
      expect(r.status).toBe(404);
    }
    const post = await call(w, henryS, 'POST', `/api/app/rooms/${samRoom.id}/messages`, { kind: 'note', to: 'room', text: 'hi' });
    expect(post.status).toBe(404);
    expect((await call(w, samS, 'GET', `/api/app/rooms/${samRoom.id}`)).body.room.goal).toBe('Private goal');
  });

  it('runs the composer: instructions, questions and notes reach the feed and the cards', async () => {
    const { w, henry } = await worldWithLogins();
    const s = await signIn(w, 'henry2@example.com', 'correct horse battery');
    // Put the new Henry into the world's room.
    w.ctx.db.prepare('INSERT INTO room_people (room_id, person_id, added_at) VALUES (?, ?, ?)').run(w.room.id, henry.id, new Date().toISOString());
    const ins = await call(w, s, 'POST', `/api/app/rooms/${w.room.id}/messages`, { kind: 'instruction', to: w.a.agent.id, text: 'Draft three taglines.', done_when: 'Three taglines in the doc.', priority: 'high' });
    expect(ins.status).toBe(200);
    expect(ins.body.ids[0]).toMatch(/^ins_/);
    const note = await call(w, s, 'POST', `/api/app/rooms/${w.room.id}/messages`, { kind: 'note', to: 'room', text: '@Muse Sam please look at the pricing page.' });
    expect(note.status).toBe(200);
    const feed = (await call(w, s, 'GET', `/api/app/rooms/${w.room.id}/feed?limit=10`)).body;
    expect(feed.events.at(-1).kind).toBe('message');
    expect(feed.events.at(-1).data.mentions).toEqual([{ id: w.b.agent.id, name: 'Muse Sam' }]);
    const card = (await checkIn(w, w.a.apiKey)).body;
    expect(card.rooms[0].instructions_for_you[0]).toMatchObject({ text: 'Draft three taglines.', from: 'Henry T' });
    const detail = (await call(w, s, 'GET', `/api/app/rooms/${w.room.id}`)).body;
    expect(detail.lanes.find((l: any) => l.agent_id === w.a.agent.id).instructions[0].text).toBe('Draft three taglines.');
    expect(detail.conductor.effective_mode).toBe('relay');
    expect(detail.conductor.banner).toMatch(/no Anthropic API key/);
    // Filters and search.
    const onlyMessages = (await call(w, s, 'GET', `/api/app/rooms/${w.room.id}/feed?kind=message`)).body;
    expect(onlyMessages.events.every((e: any) => e.kind === 'message')).toBe(true);
    const search = (await call(w, s, 'GET', `/api/app/rooms/${w.room.id}/feed?q=taglines`)).body;
    expect(search.events.length).toBeGreaterThan(0);
  });

  it('creates an agent, shows its key once, and gives the owner the join messages and connection log', async () => {
    const { w, henry } = await worldWithLogins();
    const s = await signIn(w, 'henry2@example.com', 'correct horse battery');
    w.ctx.db.prepare('INSERT INTO room_people (room_id, person_id, added_at) VALUES (?, ?, ?)').run(w.room.id, henry.id, new Date().toISOString());
    const created = await call(w, s, 'POST', '/api/app/agents', { name: 'Instinct Henry', type: 'instinct', room_ids: [w.room.id] });
    expect(created.status).toBe(200);
    expect(created.body.api_key).toMatch(/^tempo_ak_/);
    expect(created.body.page_link).toMatch(/^http:\/\/tempo\.test\/a\/pg_/);
    expect(created.body.messages.join_message).toContain(created.body.page_link);
    expect(created.body.messages.scheduled_text).toContain(created.body.page_link);
    const id = created.body.agent.id;
    // Later views never show the secret.
    const join = await call(w, s, 'GET', `/api/app/agents/${id}/join`);
    expect(JSON.stringify(join.body)).not.toContain(created.body.api_key);
    expect(join.body.messages.link_is_placeholder).toBe(true);
    // Other people can see the agent but not its keys or join page.
    const samS = await signIn(w, 'sam2@example.com', 'another good password');
    expect((await call(w, samS, 'GET', `/api/app/agents/${id}/join`)).status).toBe(404);
    const conn = await call(w, s, 'GET', `/api/app/agents/${id}/connections`);
    expect(conn.status).toBe(200);
    // Muse join message mentions the MCP URL, OpenAPI and guide.
    const muse = await call(w, s, 'POST', '/api/app/agents', { name: 'Muse Henry 2', type: 'muse', room_ids: [w.room.id] });
    expect(muse.body.messages.join_message).toContain('http://tempo.test/mcp');
    expect(muse.body.messages.join_message).toContain('http://tempo.test/openapi.json');
    expect(muse.body.messages.join_message).toContain('Run a Tempo check-in: call tempo_check_in, do what the card asks, then call tempo_report.');
    expect(muse.body.messages.join_message).not.toContain(muse.body.api_key);
  });

  it('invites a person with a single-use link that expires', async () => {
    const { w } = await worldWithLogins();
    const s = await signIn(w, 'henry2@example.com', 'correct horse battery');
    const inv = await call(w, s, 'POST', '/api/app/invites', { email: 'pat@example.com', role: 'member' });
    expect(inv.body.link).toMatch(/\/invite\/.+/);
    const token = inv.body.link.split('/invite/')[1];
    expect((await call(w, null, 'GET', `/api/app/invites/${token}`)).body.valid).toBe(true);
    const accept = await call(w, null, 'POST', '/api/app/invites/accept', { token, name: 'Pat', password: 'pat password 123' }, { 'x-requested-with': 'tempo' });
    expect(accept.status).toBe(200);
    expect(accept.body.person.email).toBe('pat@example.com');
    const again = await call(w, null, 'POST', '/api/app/invites/accept', { token, name: 'Pat 2', password: 'pat password 123' }, { 'x-requested-with': 'tempo' });
    expect(again.status).toBe(410);
    const inv2 = await call(w, s, 'POST', '/api/app/invites', { email: 'late@example.com' });
    w.clock.advance(8 * 86400_000);
    const t2 = inv2.body.link.split('/invite/')[1];
    expect((await call(w, null, 'POST', '/api/app/invites/accept', { token: t2, name: 'Late', password: 'late password 123' }, { 'x-requested-with': 'tempo' })).status).toBe(410);
  });

  it('streams new events to an open control room within about two seconds', async () => {
    const { w, henry } = await worldWithLogins();
    w.ctx.db.prepare('INSERT INTO room_people (room_id, person_id, added_at) VALUES (?, ?, ?)').run(w.room.id, henry.id, new Date().toISOString());
    const s = await signIn(w, 'henry2@example.com', 'correct horse battery');
    const url = await w.app.listen({ port: 0, host: '127.0.0.1' });
    const ac = new AbortController();
    toClose.push(async () => ac.abort());
    toClose.push(() => w.app.close());
    const res = await fetch(`${url}/api/app/stream`, { headers: { cookie: s.cookie }, signal: ac.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const started = Date.now();
    // An agent reports; the feed event must arrive on the stream.
    setTimeout(async () => {
      const card = (await checkIn(w, w.a.apiKey)).body;
      await report(w, w.a.apiKey, fullReport(card, { rooms: [{ room_id: w.room.id, working_on: 'Live update test.' }] }));
    }, 100);
    while (!buf.includes('Live update test.')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      if (Date.now() - started > 4000) break;
    }
    expect(buf).toContain('event: feed');
    expect(buf).toContain('Live update test.');
    expect(Date.now() - started).toBeLessThan(2500);
    // Events for rooms the person isn't in never arrive.
    expect(buf).not.toContain('Sam only');
  });
});
