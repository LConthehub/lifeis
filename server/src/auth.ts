/**
 * Signing in: password hashing, sessions, and slowing down guessing.
 *
 * - Passwords are hashed with scrypt, in the same form the Python server wrote, so existing passwords work.
 * - Session tokens are random; only their SHA-256 hash is stored in the database, so a copy of the database
 *   can't be used to sign in.
 * - Repeated failed sign-ins are slowed down with an increasing lockout, kept in the database so a restart
 *   doesn't forget it.
 * - Sessions that sit unused are signed out automatically.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { atomic, type Db } from '../../core/src/index.ts';

export const SESSION_COOKIE = 'lifeis_session';
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 12;
/** Minutes a session may sit unused; 0 = stay signed in (up to 30 days). Each person picks theirs. */
export const IDLE_CHOICES = [5, 15, 30, 60, 120, 480, 0];

const SCRYPT = { N: 2 ** 14, r: 8, p: 1 };
/** The most work a stored hash may ask for, so a damaged or planted row can't stall the server. */
const MAX_SCRYPT_MEMORY = 256 * 1024 * 1024;

export type User = { id: number; username: string; is_admin: boolean };
export type Clock = () => Date;

const stamp = (at: Date) => at.toISOString().slice(0, 19) + '+00:00';

// ---------- passwords ----------

function derive(password: string, salt: Buffer, length: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(password, 'utf8'), salt, length, { N, r, p, maxmem: MAX_SCRYPT_MEMORY }, (problem, key) => {
      if (problem) reject(problem);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await derive(password, salt, 32, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltHex, hashHex, ...more] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex || more.length) return false;
  const numbers = [n, r, p].map(Number);
  if (!numbers.every((x) => Number.isInteger(x) && x > 0) || !/^([0-9a-f]{2})+$/i.test(saltHex + hashHex)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  try {
    const digest = await derive(password, Buffer.from(saltHex, 'hex'), expected.length, numbers[0]!, numbers[1]!, numbers[2]!);
    return timingSafeEqual(digest, expected);
  } catch {
    return false;
  }
}

// A real hash to compare against when the username doesn't exist, so the time taken doesn't give away
// whether a username is real.
const dummyHash = hashPassword(randomBytes(8).toString('hex'));

type UserRow = { id: number; username: string; password_hash: string; is_admin: number };

export async function checkLogin(db: Db, username: string, password: string): Promise<User | null> {
  const row = await db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()]);
  if (!row) {
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return { id: row.id, username: row.username, is_admin: Boolean(row.is_admin) };
}

// ---------- sessions ----------

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** A new session. How and from where it was opened is kept, so the person can see their signed-in devices. */
export async function createSession(db: Db, userId: number, from: { method?: string; ip?: string; userAgent?: string }, clock: Clock): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = clock();
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, method, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [tokenHash(token), userId, stamp(now), stamp(new Date(now.getTime() + SESSION_DAYS * 86_400_000)), stamp(now),
      from.method ?? null, from.ip ?? null, (from.userAgent ?? '').slice(0, 300) || null]);
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [stamp(now)]);
  return token;
}

/** How long this person's session may sit unused before it is signed out. 0 means never. */
export async function idleMinutesFor(db: Db, userId: number, fallback: number): Promise<number> {
  const row = await db.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'idle_minutes'", [userId]);
  if (!row || row.value === null || !/^\s*-?\d+\s*$/.test(row.value)) return fallback;
  return Math.max(0, Number(row.value));
}

/**
 * The signed-in person for a session cookie, or null. A session ends 30 days after sign-in, or sooner if it
 * sits unused for longer than the person's auto sign-out time. `touch: false` is for background requests
 * (polling): they don't count as use.
 */
export async function userForToken(db: Db, token: string | undefined, clock: Clock, idleFallback: number, touch = true): Promise<User | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const row = await db.get<{ id: number; username: string; is_admin: number; expires_at: string; created_at: string; last_seen_at: string | null }>(
    `SELECT u.id, u.username, u.is_admin, s.expires_at, s.created_at, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [hash]);
  if (!row) return null;
  const now = clock().getTime();
  const lastSeen = new Date(row.last_seen_at ?? row.created_at).getTime();
  const idle = await idleMinutesFor(db, row.id, idleFallback);
  const expired = !(new Date(row.expires_at).getTime() >= now); // a date that can't be read counts as expired
  if (expired || (idle && !(now - lastSeen <= idle * 60_000))) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [hash]);
    return null;
  }
  if (touch && (row.last_seen_at === null || now - lastSeen > 30_000)) {
    await db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [stamp(new Date(now)), hash]);
  }
  return { id: row.id, username: row.username, is_admin: Boolean(row.is_admin) };
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
}

export async function deleteUserSessions(db: Db, userId: number, keepToken?: string): Promise<void> {
  if (keepToken) await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [userId, tokenHash(keepToken)]);
  else await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

// ---------- slowing down guessing ----------

/**
 * After `freeAttempts` failures for a key, lock it for 2, 4, 8 … seconds (15 minutes at most). Kept in the
 * database (table login_throttle), so restarting Life Is doesn't give a guesser a fresh start. A key that
 * has had no failure for a day is forgotten.
 */
export class LoginThrottle {
  static readonly MAX_LOCK_SECONDS = 15 * 60;
  static readonly MAX_TRACKED = 10_000; // so a flood of made-up usernames can't fill the database
  static readonly FORGET_AFTER = 24 * 3600;

  readonly prefix: string;
  readonly freeAttempts: number;

  constructor(prefix: string, freeAttempts = 5) {
    this.prefix = prefix;
    this.freeAttempts = freeAttempts;
  }

  private key(key: string) {
    return `${this.prefix}:${key}`.slice(0, 200);
  }

  async secondsLocked(db: Db, key: string, clock: Clock): Promise<number> {
    const row = await db.get<{ locked_until: number }>('SELECT locked_until FROM login_throttle WHERE key = ?', [this.key(key)]);
    return row ? Math.max(0, Math.trunc(row.locked_until - clock().getTime() / 1000 + 0.999)) : 0;
  }

  async failure(db: Db, key: string, clock: Clock): Promise<void> {
    const now = clock().getTime() / 1000;
    await atomic(db, async (tx) => {
      await tx.run('DELETE FROM login_throttle WHERE updated_at < ?', [now - LoginThrottle.FORGET_AFTER]);
      const tracked = (await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_throttle'))!.n;
      if (tracked >= LoginThrottle.MAX_TRACKED) {
        // Still full: forget the entries that failed longest ago.
        await tx.run('DELETE FROM login_throttle WHERE key IN (SELECT key FROM login_throttle ORDER BY updated_at LIMIT ?)',
          [LoginThrottle.MAX_TRACKED / 2]);
      }
      const row = await tx.get<{ failures: number }>('SELECT failures FROM login_throttle WHERE key = ?', [this.key(key)]);
      const failures = (row?.failures ?? 0) + 1;
      const until = failures >= this.freeAttempts
        ? now + Math.min(2 ** Math.min(failures - this.freeAttempts + 1, 20), LoginThrottle.MAX_LOCK_SECONDS)
        : 0;
      await tx.run(
        `INSERT INTO login_throttle (key, failures, locked_until, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
        [this.key(key), failures, until, now]);
    });
  }

  async success(db: Db, key: string): Promise<void> {
    await db.run('DELETE FROM login_throttle WHERE key = ?', [this.key(key)]);
  }
}

// Failures are counted three ways. A username from one address gets 5 tries. One address gets 20 across all
// usernames (a household behind one address is allowed some typos). And a username gets 30 across all
// addresses: high enough that a stranger who knows your username can't easily lock you out, low enough to
// stop a botnet.
export const pairThrottle = new LoginThrottle('pair');
export const ipThrottle = new LoginThrottle('ip', 20);
export const userThrottle = new LoginThrottle('user', 30);
