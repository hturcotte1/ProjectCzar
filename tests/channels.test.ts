import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEmailSender, makeEmailSenderWithTimeout, makePushSender, postToNtfy } from '../src/server/alerts/channels.js';
import { loadConfig } from '../src/server/config.js';

const TOKEN = 'tk_ntfy_secret_token_123';
const PASSWORD = 'hunter2-smtp-password';

function listen(server: http.Server | net.Server | SMTPServer): Promise<number> {
  return new Promise((resolve) => {
    const s = server as net.Server;
    // SMTPServer wraps a net.Server and has its own listen().
    if (server instanceof SMTPServer) {
      server.listen(0, '127.0.0.1', () => resolve((server.server.address() as AddressInfo).port));
    } else {
      s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port));
    }
  });
}

/* ------------------------------------------------------------------ push (ntfy) */

interface Seen {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('push channel (ntfy)', () => {
  let server: http.Server;
  let base: string;
  let seen: Seen[];
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  const ok: typeof handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"id":"abc","event":"message"}');
  };
  const cfg = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', NTFY_SERVER: base, NTFY_TOKEN: TOKEN, ...extra });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        handler(req, res);
      });
    });
    base = `http://127.0.0.1:${await listen(server)}`;
  });

  beforeEach(() => {
    seen = [];
    handler = ok;
  });

  afterEach(() => {
    server.closeAllConnections();
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it('posts the message to the topic with title, priority, tags, click and token', async () => {
    const send = makePushSender(cfg())!;
    expect(send).toBeTypeOf('function');
    await send('henry-alerts', 'Tempo: a decision is waiting in Launch', 'A decision (dec_1) is waiting for a person in room Launch.', 'http://tempo.test/');
    expect(seen).toHaveLength(1);
    const r = seen[0];
    expect(r.method).toBe('POST');
    expect(r.url).toBe('/henry-alerts');
    expect(r.body).toBe('A decision (dec_1) is waiting for a person in room Launch.');
    expect(r.headers.title).toBe('Tempo: a decision is waiting in Launch');
    expect(r.headers.priority).toBe('default');
    expect(r.headers.tags).toBe('bell');
    expect(r.headers.click).toBe('http://tempo.test/');
    expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(r.headers['content-type'])).toContain('text/plain');
  });

  it('marks red alerts high priority with a warning tag, and green ones with a check mark', async () => {
    const send = makePushSender(cfg())!;
    await send('t', 'Tempo: Muse Henry has gone quiet (red)', 'body');
    await send('t', 'Tempo: Muse Henry is back (green)', 'body');
    expect(seen[0].headers.priority).toBe('high');
    expect(seen[0].headers.tags).toBe('warning');
    expect(seen[1].headers.priority).toBe('default');
    expect(seen[1].headers.tags).toBe('white_check_mark');
  });

  it('sends no Authorization header without a token and no Click header without a link', async () => {
    const send = makePushSender(loadConfig({ NODE_ENV: 'test', NTFY_SERVER: base }))!;
    await send('t', 'Title', 'body');
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].headers.click).toBeUndefined();
  });

  it('leaves out a click link that is not a web link', async () => {
    const send = makePushSender(cfg())!;
    await send('t', 'Title', 'body', 'javascript:alert(1)');
    await send('t', 'Title', 'body', 'not a url');
    expect(seen[0].headers.click).toBeUndefined();
    expect(seen[1].headers.click).toBeUndefined();
  });

  it('encodes a non-ASCII title as RFC 2047 so the header is safe', async () => {
    const send = makePushSender(cfg())!;
    const title = 'Tempo: Muse Zoë is back (green) ✅';
    await send('t', title, 'Body with an accent: é');
    const header = String(seen[0].headers.title);
    const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(header);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64').toString('utf8')).toBe(title);
    expect(seen[0].headers.tags).toBe('white_check_mark');
    expect(seen[0].body).toBe('Body with an accent: é');
  });

  it('does not let a title carry line breaks into the headers', async () => {
    const send = makePushSender(cfg())!;
    await send('t', 'Line one\r\nX-Evil: yes', 'body');
    expect(seen[0].headers['x-evil']).toBeUndefined();
    expect(seen[0].headers.title).toBe('Line one X-Evil: yes');
  });

  it('truncates long titles and bodies to ntfy limits', async () => {
    const send = makePushSender(cfg())!;
    await send('t', 'T'.repeat(500), 'b'.repeat(5000));
    const header = String(seen[0].headers.title);
    const title = header.startsWith('=?UTF-8?B?') ? Buffer.from(header.slice(10, -2), 'base64').toString('utf8') : header;
    expect(Array.from(title)).toHaveLength(200);
    expect(title.startsWith('TTTT')).toBe(true);
    expect(Array.from(seen[0].body)).toHaveLength(4000);
    expect(seen[0].body.startsWith('bbbb')).toBe(true);
  });

  it('keeps multi-byte bodies under the 4 KB byte limit', async () => {
    const send = makePushSender(cfg())!;
    await send('t', 'Title', '€'.repeat(3000));
    expect(Buffer.byteLength(seen[0].body, 'utf8')).toBeLessThanOrEqual(4096);
    expect(seen[0].body.startsWith('€€')).toBe(true);
  });

  it('percent-encodes unusual topic characters', async () => {
    const send = makePushSender(cfg())!;
    await send('café?x', 'Title', 'body');
    expect(seen[0].url).toBe('/caf%C3%A9%3Fx');
  });

  it('rejects empty topics and topics with "/" or whitespace without sending anything', async () => {
    const send = makePushSender(cfg())!;
    await expect(send('', 't', 'b')).rejects.toThrow(/empty/);
    await expect(send('a/b', 't', 'b')).rejects.toThrow(/spaces or "\/"/);
    await expect(send('my topic', 't', 'b')).rejects.toThrow(/spaces or "\/"/);
    await expect(send(' lead', 't', 'b')).rejects.toThrow(/spaces or "\/"/);
    await expect(send('a\nb', 't', 'b')).rejects.toThrow(/spaces or "\/"/);
    await expect(send('..', 't', 'b')).rejects.toThrow(/not a valid/);
    expect(seen).toHaveLength(0);
  });

  it('rejects with the HTTP status and the start of the answer on a non-2xx reply', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('boom');
    };
    await expect(makePushSender(cfg())!('t', 'Title', 'body')).rejects.toThrow('ntfy answered HTTP 500: boom');
  });

  it('cuts a long error answer to 200 characters and never echoes the token', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 42908, http: 429, error: `too many requests for ${TOKEN} ${'x'.repeat(500)}` }));
    };
    const err = await makePushSender(cfg())!('t', 'Title', 'body').then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message.startsWith('ntfy answered HTTP 429: ')).toBe(true);
    expect(err!.message.length).toBeLessThanOrEqual('ntfy answered HTTP 429: '.length + 200);
    expect(err!.message).not.toContain(TOKEN);
  });

  it('reports an empty error answer without a trailing colon', async () => {
    handler = (_req, res) => {
      res.writeHead(503);
      res.end();
    };
    await expect(makePushSender(cfg())!('t', 'Title', 'body')).rejects.toThrow(/^ntfy answered HTTP 503$/);
  });

  it('does not treat a redirect as success', async () => {
    handler = (_req, res) => {
      res.writeHead(301, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    };
    await expect(makePushSender(cfg())!('t', 'Title', 'body')).rejects.toThrow('ntfy answered HTTP 301');
    expect(seen).toHaveLength(1);
  });

  it('gives up when ntfy does not answer in time', async () => {
    handler = () => {
      /* never answer */
    };
    const started = Date.now();
    await expect(postToNtfy(cfg(), 't', 'Title', 'body', undefined, 200)).rejects.toThrow('ntfy did not answer within 0.2 seconds');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reports an unreachable server without leaking the token', async () => {
    const dead = http.createServer();
    const port = await listen(dead);
    await new Promise((r) => dead.close(r));
    const err = await postToNtfy(cfg({ NTFY_SERVER: `http://127.0.0.1:${port}` }), 't', 'Title', 'body', undefined, 5000).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/^ntfy could not be reached: /);
    expect(err!.message).not.toContain(TOKEN);
  });
});

/* ------------------------------------------------------------------ email (SMTP) */

interface Mail {
  from: string | false;
  to: string[];
  raw: string;
  username: string | null;
}

/** Splits a raw message into unfolded headers (lower-case names) and the decoded text body. */
function parseMail(raw: string): { headers: Record<string, string>; text: string } {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ');
  const bodyRaw = raw.slice(split + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  const enc = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase();
  let bytes: Buffer;
  if (enc === 'quoted-printable') {
    const qp = bodyRaw.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    bytes = Buffer.from(qp, 'latin1');
  } else if (enc === 'base64') {
    bytes = Buffer.from(bodyRaw, 'base64');
  } else {
    bytes = Buffer.from(bodyRaw, 'utf8');
  }
  return { headers, text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
}

/** Decodes "=?UTF-8?B?...?=" and "=?UTF-8?Q?...?=" words. */
function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_m, kind: string, data: string) => {
      if (kind.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      const q = data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(q, 'latin1').toString('utf8');
    });
}

describe('email channel (SMTP)', () => {
  let smtp: SMTPServer;
  let port: number;
  let mails: Mail[];

  const cfg = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), ...extra });

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      secure: false,
      disabledCommands: ['STARTTLS'],
      allowInsecureAuth: true,
      logger: false,
      onAuth(auth, _session, cb) {
        if (auth.username === 'tempo' && auth.password === PASSWORD) return cb(null, { user: auth.username });
        // Deliberately echoes the password, to prove the sender hides it from error messages.
        return cb(new Error(`Bad login for ${auth.username} with ${auth.password}`));
      },
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          mails.push({
            from: session.envelope.mailFrom && session.envelope.mailFrom.address,
            to: session.envelope.rcptTo.map((r) => r.address),
            raw: Buffer.concat(chunks).toString('utf8'),
            username: session.user ? String(session.user) : null,
          });
          cb();
        });
      },
    });
    port = await listen(smtp);
  });

  beforeEach(() => {
    mails = [];
  });

  afterAll(async () => {
    await new Promise((r) => smtp.close(() => r(undefined)));
  });

  it('returns null without SMTP settings', () => {
    expect(makeEmailSender(loadConfig({ NODE_ENV: 'test' }))).toBeNull();
    expect(makeEmailSender(loadConfig({ NODE_ENV: 'test', SMTP_HOST: '  ' }))).toBeNull();
  });

  it('sends a plain-text email from the configured address', async () => {
    const send = makeEmailSender(cfg({ SMTP_FROM: 'Tempo Alerts <alerts@tempo.test>' }))!;
    expect(send).toBeTypeOf('function');
    const text = 'Muse Henry has missed two check-ins and is red.\n\nOpen Tempo: http://tempo.test/';
    await send('henry@example.com', 'Tempo: Muse Henry has gone quiet (red)', text);
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.from).toBe('alerts@tempo.test');
    expect(m.to).toEqual(['henry@example.com']);
    expect(m.username).toBeNull();
    const parsed = parseMail(m.raw);
    expect(decodeWords(parsed.headers.subject)).toBe('Tempo: Muse Henry has gone quiet (red)');
    expect(parsed.headers.from).toContain('alerts@tempo.test');
    expect(parsed.headers.from).toContain('Tempo Alerts');
    expect(parsed.headers.to).toContain('henry@example.com');
    expect(parsed.headers['content-type']).toMatch(/^text\/plain/);
    expect(m.raw).not.toMatch(/content-type:\s*text\/html/i);
    expect(parsed.text.trimEnd()).toBe(text);
  });

  it('uses the default sender address when SMTP_FROM is not set', async () => {
    await makeEmailSender(cfg())!('sam@example.com', 'Hello', 'Hi');
    expect(mails[0].from).toBe('tempo@localhost');
  });

  it('delivers long lines and non-ASCII text unchanged', async () => {
    const send = makeEmailSender(cfg())!;
    const text = `Muse Zoë (rooms: Launch) has missed two scheduled check-ins and is now red. ${'More words. '.repeat(20)}\n\nOpen Tempo: http://tempo.test/`;
    await send('henry@example.com', 'Tempo: Muse Zoë is back (green)', text);
    const parsed = parseMail(mails[0].raw);
    expect(decodeWords(parsed.headers.subject)).toBe('Tempo: Muse Zoë is back (green)');
    expect(parsed.text.trimEnd()).toBe(text);
  });

  it('keeps a subject on one line so it cannot add recipients or headers', async () => {
    const send = makeEmailSender(cfg())!;
    await send('henry@example.com', 'Tempo: hello\r\nBcc: evil@example.com', 'Hi');
    expect(mails[0].to).toEqual(['henry@example.com']);
    const parsed = parseMail(mails[0].raw);
    expect(parsed.headers.bcc).toBeUndefined();
    expect(parsed.headers.subject).toBe('Tempo: hello Bcc: evil@example.com');
  });

  it('logs in when a user and password are set', async () => {
    const send = makeEmailSender(cfg({ SMTP_USER: 'tempo', SMTP_PASS: PASSWORD }))!;
    await send('henry@example.com', 'Hello', 'Hi');
    expect(mails).toHaveLength(1);
    expect(mails[0].username).toBe('tempo');
  });

  it('fails with a short message that never contains the password', async () => {
    const send = makeEmailSender(cfg({ SMTP_USER: 'tempo', SMTP_PASS: 'wrong-' + PASSWORD }))!;
    const err = await send('henry@example.com', 'Hello', 'Hi').then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/^email failed/);
    expect(err!.message).toContain('[hidden]');
    expect(err!.message).not.toContain(PASSWORD);
    expect(err!.message.length).toBeLessThan(300);
    expect(mails).toHaveLength(0);
  });

  it('fails when nobody is listening', async () => {
    const dead = net.createServer();
    const deadPort = await listen(dead);
    await new Promise((r) => dead.close(r));
    const send = makeEmailSenderWithTimeout(cfg({ SMTP_PORT: String(deadPort) }), 5000)!;
    await expect(send('henry@example.com', 'Hello', 'Hi')).rejects.toThrow(/^email failed/);
  });

  it('gives up on a mail server that accepts the connection but never speaks', async () => {
    const sockets: net.Socket[] = [];
    const silent = net.createServer((s) => sockets.push(s));
    const silentPort = await listen(silent);
    try {
      const send = makeEmailSenderWithTimeout(cfg({ SMTP_PORT: String(silentPort), SMTP_PASS: PASSWORD, SMTP_USER: 'tempo' }), 300)!;
      const started = Date.now();
      const err = await send('henry@example.com', 'Hello', 'Hi').then(
        () => null,
        (e: Error) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toMatch(/^email failed/);
      expect(err!.message).not.toContain(PASSWORD);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((r) => silent.close(r));
    }
  });
});
