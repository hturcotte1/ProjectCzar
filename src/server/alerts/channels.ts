import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

/**
 * Optional alert channels: email (SMTP) and phone push (ntfy). Both are best effort: the caller
 * records 'sent' or 'failed: <message>' per channel. These functions send exactly the text they are
 * given and add nothing else, so alert text (agent name, room name, status) is all that ever leaves.
 * Error messages are short and never contain the SMTP password or the ntfy token.
 */

/** A dead mail or push server must never hang the scheduler. */
const TIMEOUT_MS = 10_000;
/** ntfy limits: titles are small, bodies are up to 4 KB. */
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 4_000;
const MAX_BODY_BYTES = 4_096;
const MAX_ERROR_CHARS = 200;

/** Keeps at most `max` characters (whole code points), ending with an ellipsis when cut. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** Keeps at most `maxBytes` bytes of UTF-8 (whole characters), ending with an ellipsis when cut. */
function clipBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let used = 3; // room for the ellipsis
  let out = '';
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return `${out}…`;
}

/** One short line for an error message, with any secret blanked out. */
function shortError(message: string, secrets: (string | null | undefined)[]): string {
  let out = message;
  for (const s of secrets) if (s) out = out.split(s).join('[hidden]');
  return clip(out.replace(/\s+/g, ' ').trim(), MAX_ERROR_CHARS);
}

/** ---------- Email (SMTP via nodemailer) ---------- */

export function makeEmailSender(config: Config): ((to: string, subject: string, text: string) => Promise<void>) | null {
  return makeEmailSenderWithTimeout(config, TIMEOUT_MS);
}

/** Same as makeEmailSender with the network timeout passed in (so tests do not wait 10 s). */
export function makeEmailSenderWithTimeout(
  config: Config,
  timeoutMs: number,
): ((to: string, subject: string, text: string) => Promise<void>) | null {
  const smtp = config.smtp;
  if (!smtp) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    dnsTimeout: timeoutMs,
  });
  return async (to, subject, text) => {
    try {
      await transport.sendMail({
        from: smtp.from,
        to,
        // A subject is one line; line breaks in it would only ever be an accident.
        subject: subject.replace(/\s+/g, ' ').trim(),
        text,
      });
    } catch (e) {
      const err = e as Error & { code?: string };
      const code = err.code ? ` (${err.code})` : '';
      throw new Error(`email failed${code}: ${shortError(err.message ?? String(e), [smtp.pass])}`);
    }
  };
}

/** ---------- Phone push (ntfy) ---------- */

export function makePushSender(config: Config): ((topic: string, title: string, body: string, clickUrl?: string) => Promise<void>) | null {
  return (topic, title, body, clickUrl) => postToNtfy(config, topic, title, body, clickUrl, TIMEOUT_MS);
}

/** Header values must be printable ASCII; anything else is sent as RFC 2047 "=?UTF-8?B?...?=", which ntfy decodes. */
export function headerSafe(value: string): string {
  const oneLine = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(oneLine)) return oneLine;
  return `=?UTF-8?B?${Buffer.from(oneLine, 'utf8').toString('base64')}?=`;
}

function checkTopic(topic: string): void {
  if (topic === '') throw new Error('ntfy topic is empty');
  if (/[\s/]/.test(topic)) throw new Error('ntfy topic must not contain spaces or "/"');
  if (/^\.+$/.test(topic)) throw new Error('ntfy topic is not a valid name');
}

/** Only plain web links are attached as the tap target of a notification. */
function safeClickUrl(clickUrl: string | undefined): string | null {
  if (!clickUrl) return null;
  try {
    const u = new URL(clickUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Same as the sender returned by makePushSender with the timeout passed in (so tests do not wait 10 s). */
export async function postToNtfy(
  config: Config,
  topic: string,
  title: string,
  body: string,
  clickUrl: string | undefined,
  timeoutMs: number,
): Promise<void> {
  checkTopic(topic);
  const token = config.ntfy.token;
  const red = title.includes('(red)');
  const green = title.includes('(green)');
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    // Alerts are rare; a fresh connection each time avoids reusing one the server already closed.
    Connection: 'close',
    Title: headerSafe(clip(title, MAX_TITLE_CHARS)),
    Priority: red ? 'high' : 'default',
    Tags: red ? 'warning' : green ? 'white_check_mark' : 'bell',
  };
  const click = safeClickUrl(clickUrl);
  if (click) headers.Click = click;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: number;
  let ok: boolean;
  let answer: string;
  try {
    const res = await fetch(`${config.ntfy.server}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers,
      body: clipBytes(clip(body, MAX_BODY_CHARS), MAX_BODY_BYTES),
      signal: controller.signal,
      // A redirect would turn the POST into a GET and look like success; report it instead.
      redirect: 'manual',
    });
    status = res.status;
    ok = res.ok;
    answer = await res.text();
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`ntfy did not answer within ${timeoutMs / 1000} seconds`);
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err.cause?.code ?? err.cause?.message ?? err.message ?? String(e);
    throw new Error(`ntfy could not be reached: ${shortError(String(why), [token])}`);
  } finally {
    clearTimeout(timer);
  }
  if (!ok) {
    const detail = shortError(answer, [token]);
    throw new Error(`ntfy answered HTTP ${status}${detail ? `: ${detail}` : ''}`);
  }
}
