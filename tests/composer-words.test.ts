import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/web/lib/api.js';
import { notSentText } from '../src/web/screens/room/composer-words.js';
import { createPerson } from '../src/server/services/auth.js';
import { addPersonToRoom } from '../src/server/services/manage.js';
import { makeWorld } from './helpers.js';

/**
 * Review round 2: a failed send said "Could not reach Tempo. Check your connection; it will retry."
 * Nothing retries a send: the message stays in the box until the person presses Send again. The
 * words now say what happened and what to do. (The browser test checks the line is visible.)
 *
 * Review round 3: "was not sent" is only known when Tempo itself answers with one of its error
 * replies (it refused the message, or the save was undone). A dropped connection, or an error page
 * from the hosting service in front of Tempo (502, 503, 504), can come after Tempo saved the message,
 * and pressing Send again would then give the agents the same instruction twice. Those now say the
 * message may not have been sent, and to look in the feed before sending again.
 */

const MAYBE =
  'Your message may not have been sent: Tempo could not be reached. It is still in the box. If it does not show up in the feed, check your connection and press Send again.';

describe('what the message box says when a send fails', () => {
  it('when Tempo cannot be reached', () => {
    const text = notSentText(new ApiError(0, 'network', 'Could not reach Tempo. Check your connection and try again.'));
    expect(text).toBe(MAYBE);
    expect(text).not.toMatch(/retry/i);
    expect(text).not.toContain('was not sent');
  });

  it('when the server fails', () => {
    expect(notSentText(new ApiError(500, 'internal_error', 'Something went wrong. Please try again.', [], true))).toBe(
      'Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.',
    );
    // A 502 that is not Tempo's own reply comes from the hosting service: Tempo may have saved it.
    expect(notSentText(new ApiError(502, 'error', 'Something went wrong (HTTP 502).'))).toBe(MAYBE);
  });

  it("passes on the server's own reason when there is something to change", () => {
    expect(notSentText(new ApiError(400, 'bad_request', 'Pick an agent for this instruction', [], true))).toBe(
      'Your message was not sent. Pick an agent for this instruction. It is still in the box.',
    );
  });

  it('never says "not sent" about something it cannot know', () => {
    const unknown = 'Your message may not have been sent: something went wrong. It is still in the box. If it does not show up in the feed, press Send again.';
    expect(notSentText(new Error(''))).toBe(unknown);
    expect(notSentText('odd')).toBe(unknown);
  });
});

describe('what the message box says, through the real request path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Sends a message with the given reply from the network, and returns the words under the box. */
  async function sendFails(reply: () => Promise<Response>): Promise<string> {
    vi.stubGlobal('fetch', vi.fn(reply));
    try {
      await api.post('/rooms/room_1/messages', { kind: 'instruction', to: 'Muse Henry', text: 'Draft the pricing table.' });
    } catch (e) {
      return notSentText(e);
    }
    throw new Error('expected the send to fail');
  }

  it('a dropped connection may come after Tempo saved the message, so it does not say "not sent"', async () => {
    expect(await sendFails(() => Promise.reject(new TypeError('Failed to fetch')))).toBe(MAYBE);
  });

  it('nor does a reply that breaks off halfway', async () => {
    // The answer started (Tempo had saved it) and then the connection dropped.
    const broken = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new TypeError('network error'));
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    expect(await sendFails(broken)).toBe(MAYBE);
  });

  it('nor does an error page from the hosting service in front of Tempo', async () => {
    const pages = [
      () => Promise.resolve(new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, headers: { 'content-type': 'text/html' } })),
      () => Promise.resolve(new Response(JSON.stringify({ status: 'error', code: 503, message: 'Application failed to respond' }), { status: 503, headers: { 'content-type': 'application/json' } })),
      () => Promise.resolve(new Response('', { status: 504 })),
    ];
    for (const page of pages) expect(await sendFails(page)).toBe(MAYBE);
  });

  it("Tempo's own error reply says for certain that the message was not sent", async () => {
    const tempo = (status: number, code: string, message: string) => () =>
      Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers: { 'content-type': 'application/json' } }));
    expect(await sendFails(tempo(500, 'internal_error', 'Something went wrong. Please try again.'))).toBe(
      'Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.',
    );
    expect(await sendFails(tempo(400, 'bad_request', '"Muse Bob" is not an agent in this room.'))).toBe(
      'Your message was not sent. "Muse Bob" is not an agent in this room. It is still in the box.',
    );
    expect(await sendFails(tempo(401, 'signed_out', 'Please sign in.'))).toBe('Your message was not sent. Please sign in. It is still in the box.');
  });

  it("Tempo's own 500 really means nothing was saved: the whole send is undone", async () => {
    // What the words above rely on. The server fails halfway through saving an instruction (after the
    // instruction is written, while it writes the audit line); its reply then goes to the message box.
    const w = await makeWorld();
    const person = await createPerson(w.ctx, { name: 'Henry T', email: 'henry2@example.com', password: 'correct horse battery', role: 'admin' });
    addPersonToRoom(w.ctx, { kind: 'person', id: w.henry.id, name: w.henry.name }, w.room.id, person.id);
    const login = await w.app.inject({
      method: 'POST',
      url: '/api/app/login',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo' },
      payload: JSON.stringify({ email: 'henry2@example.com', password: 'correct horse battery' }),
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const csrf = JSON.parse(login.body).csrf_token as string;
    const before = (w.ctx.db.prepare('SELECT COUNT(*) AS n FROM instructions').get() as { n: number }).n;
    w.ctx.db.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'disk trouble'); END;`);
    const r = await w.app.inject({
      method: 'POST',
      url: `/api/app/rooms/${w.room.id}/messages`,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo', cookie, 'x-csrf-token': csrf },
      payload: JSON.stringify({ kind: 'instruction', to: 'Muse Henry', text: 'Draft the pricing table.' }),
    });
    expect(r.statusCode).toBe(500);
    expect((w.ctx.db.prepare('SELECT COUNT(*) AS n FROM instructions').get() as { n: number }).n).toBe(before);
    expect(w.ctx.db.prepare(`SELECT COUNT(*) AS n FROM feed_events WHERE text LIKE '%Draft the pricing table.%'`).get()).toEqual({ n: 0 });
    // And the message box says so.
    expect(await sendFails(() => Promise.resolve(new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } })))).toBe(
      'Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.',
    );
  });
});
