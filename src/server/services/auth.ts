import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { nextId, parseJson } from '../db/index.js';
import { TempoError, badRequest } from '../lib/errors.js';
import { randomSecret, sha256 } from '../lib/crypto.js';
import { iso } from '../lib/time.js';
import { audit } from './audit.js';
import { addPersonToRoom, createPersonRecord } from './manage.js';
import { getPerson, getRoom, isPersonInRoom } from './repo.js';
import type { PersonRow } from './rows.js';

/**
 * Sign-in for people: argon2id password hashes, opaque session tokens (stored hashed), a CSRF
 * token per session, and single-use invite links that expire.
 */

// OWASP's argon2id baseline: 19 MiB memory, 2 iterations, 1 lane.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 10;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, password);
  } catch {
    return false;
  }
}

export function checkPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw badRequest(`Passwords must be at least ${MIN_PASSWORD} characters long.`, [{ field: 'password', message: 'too short' }]);
  }
  if (password.length > 200) throw badRequest('Passwords must be under 200 characters.', [{ field: 'password', message: 'too long' }]);
}

export async function createPerson(
  ctx: AppContext,
  a: { name: string; email: string; password: string; role: 'admin' | 'member' },
): Promise<PersonRow> {
  checkPasswordStrength(a.password);
  const passwordHash = await hashPassword(a.password);
  return createPersonRecord(ctx, { name: a.name, email: a.email, passwordHash, role: a.role });
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export interface Session {
  person: PersonRow;
  csrfToken: string;
  tokenHash: string;
}

export function createSession(ctx: AppContext, personId: string): { token: string; csrfToken: string } {
  const token = randomSecret(32);
  const csrfToken = randomSecret(24);
  const now = ctx.clock.now();
  ctx.db
    .prepare('INSERT INTO sessions (token_hash, person_id, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), personId, csrfToken, iso(now), iso(now), iso(now + SESSION_DAYS * 86400_000));
  return { token, csrfToken };
}

export function getSession(ctx: AppContext, token: string | undefined | null): Session | null {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = ctx.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | { person_id: string; csrf_token: string; expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return null;
  const now = ctx.clock.now();
  if (new Date(row.expires_at).getTime() <= now) {
    ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const person = getPerson(ctx.db, row.person_id);
  if (!person || person.disabled_at) return null;
  // Sliding expiry, written at most once an hour.
  if (now - new Date(row.last_seen_at).getTime() > 3600_000) {
    ctx.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(iso(now), iso(now + SESSION_DAYS * 86400_000), tokenHash);
  }
  return { person, csrfToken: row.csrf_token, tokenHash };
}

export function deleteSession(ctx: AppContext, token: string | undefined | null): void {
  if (token) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteSessionsFor(ctx: AppContext, personId: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE person_id = ?').run(personId);
}

const GENERIC_LOGIN_ERROR = 'That email and password don\'t match an account. Check them and try again.';

export async function login(ctx: AppContext, email: string, password: string): Promise<PersonRow> {
  const person = ctx.db.prepare('SELECT * FROM people WHERE email = ?').get(String(email ?? '').trim().toLowerCase()) as PersonRow | undefined;
  // Always run one hash verification so timing doesn't reveal which emails exist.
  const ok = await verifyPassword(person?.password_hash ?? (await dummyHash()), String(password ?? ''));
  if (!person || !ok || person.disabled_at) throw new TempoError(401, 'login_failed', GENERIC_LOGIN_ERROR);
  return person;
}

// A real argon2id hash of a random string, so unknown emails take as long as known ones.
let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomSecret(16));
  return dummy;
}

/** Changes the password and signs the person out everywhere except the session making the change. */
export async function changePassword(ctx: AppContext, person: PersonRow, current: string, next: string, keepSessionHash?: string): Promise<void> {
  if (!(await verifyPassword(person.password_hash, current))) {
    throw new TempoError(403, 'wrong_password', 'Your current password is not right.');
  }
  checkPasswordStrength(next);
  const h = await hashPassword(next);
  ctx.db.prepare('UPDATE people SET password_hash = ? WHERE id = ?').run(h, person.id);
  ctx.db.prepare('DELETE FROM sessions WHERE person_id = ? AND token_hash != ?').run(person.id, keepSessionHash ?? '');
  audit(ctx, { kind: 'person', id: person.id, name: person.name }, 'person.password_change', 'person', person.id, null, {});
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

export interface InviteRow {
  id: string;
  token_hash: string;
  email: string | null;
  role: 'admin' | 'member';
  room_ids: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
}

export function createInvite(
  ctx: AppContext,
  admin: PersonRow,
  input: { email?: string | null; role?: 'admin' | 'member'; room_ids?: string[] },
): { invite: InviteRow; token: string; link: string } {
  if (admin.role !== 'admin') throw new TempoError(403, 'admin_only', 'Only an admin can invite people.');
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('That does not look like an email address.', [{ field: 'email', message: 'invalid' }]);
  const roomIds = (input.room_ids ?? []).filter((id) => getRoom(ctx.db, id));
  const token = randomSecret(24);
  const id = nextId(ctx.db, 'inv');
  const now = ctx.clock.now();
  ctx.db
    .prepare('INSERT INTO invites (id, token_hash, email, role, room_ids, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, sha256(token), email, input.role === 'admin' ? 'admin' : 'member', JSON.stringify(roomIds), admin.id, iso(now), iso(now + INVITE_DAYS * 86400_000));
  audit(ctx, { kind: 'person', id: admin.id, name: admin.name }, 'invite.create', 'invite', id, null, { email, role: input.role ?? 'member' });
  const invite = ctx.db.prepare('SELECT * FROM invites WHERE id = ?').get(id) as InviteRow;
  return { invite, token, link: `${ctx.config.baseUrl}/invite/${token}` };
}

export function findInvite(ctx: AppContext, token: string): InviteRow | null {
  const row = ctx.db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(String(token ?? ''))) as InviteRow | undefined;
  if (!row || row.used_at || row.revoked_at || new Date(row.expires_at).getTime() <= ctx.clock.now()) return null;
  // An invite is only as good as the admin who wrote it.
  const creator = getPerson(ctx.db, row.created_by);
  if (!creator || creator.disabled_at || creator.role !== 'admin') return null;
  return row;
}

export async function acceptInvite(
  ctx: AppContext,
  token: string,
  input: { name: string; email?: string; password: string },
): Promise<PersonRow> {
  const invite = findInvite(ctx, token);
  if (!invite) {
    throw new TempoError(410, 'invite_invalid', 'This invite link has already been used, has expired, or was withdrawn. Ask the person who invited you for a new link.');
  }
  const email = invite.email ?? input.email ?? '';
  checkPasswordStrength(input.password);
  const passwordHash = await hashPassword(input.password);
  return withTx(ctx, () => {
    // Re-check inside the transaction (hashing the password took a moment): the link may have been
    // used, withdrawn or expired meanwhile, or its admin turned off.
    if (!findInvite(ctx, token)) throw new TempoError(410, 'invite_invalid', 'This invite link has already been used, has expired, or was withdrawn.');
    const person = createPersonRecord(ctx, { name: input.name, email, passwordHash, role: invite.role });
    ctx.db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?').run(iso(ctx.clock.now()), person.id, invite.id);
    for (const roomId of parseJson<string[]>(invite.room_ids, [])) {
      // Only rooms that still exist and that the inviter still belongs to.
      const room = getRoom(ctx.db, roomId);
      if (!room || room.archived_at || !isPersonInRoom(ctx.db, invite.created_by, roomId)) continue;
      addPersonToRoom(ctx, { kind: 'system', id: null, name: 'Tempo' }, roomId, person.id);
    }
    audit(ctx, { kind: 'person', id: person.id, name: person.name }, 'invite.accept', 'invite', invite.id, null, {});
    return person;
  });
}

export function revokeInvite(ctx: AppContext, admin: PersonRow, inviteId: string): void {
  if (admin.role !== 'admin') throw new TempoError(403, 'admin_only', 'Only an admin can withdraw invites.');
  ctx.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL').run(iso(ctx.clock.now()), inviteId);
  audit(ctx, { kind: 'person', id: admin.id, name: admin.name }, 'invite.revoke', 'invite', inviteId, null, {});
}
