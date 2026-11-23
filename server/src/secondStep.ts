/**
 * The second step of signing in: a code from an authenticator app (TOTP, RFC 6238), recovery codes, and the
 * short-lived single-use challenges that both this and passkeys (passkeys.ts) wait on.
 *
 * - The app's secret is kept locked with the vault (AES-256-GCM, key in its own file apart from the database),
 *   never in the clear, and is shown to the person once, at setup.
 * - Recovery codes are kept only as scrypt hashes, the same hashing passwords use. Their random part is long
 *   enough to be safe against guessing, and scrypt keeps a copy of the database alone from being used to
 *   work them out. A code is checked against the person's own unused ones, so it costs a little time to try,
 *   which is also why wrong tries are counted by the sign-in throttle.
 * - A code from the app works once: the last 30-second step accepted is kept, and the same or an earlier step
 *   is refused afterwards.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { atomic, type Db, type Sealer } from '../../core/src/index.ts';
import { hashPassword, verifyPassword, type Clock } from './auth.ts';
import { vault } from './vault.ts';

/**
 * The lock for the app's secret when main.ts hasn't handed one over: the vault in the same key folder main.ts
 * uses (KEY_DIR, or DATA_DIR/keys), for the purpose "second_step". The key file is only made when first needed.
 */
export function sealerFromEnvironment(env: NodeJS.ProcessEnv = process.env): Sealer {
  const dataDir = env.DATA_DIR || path.resolve('data');
  return vault(env.KEY_DIR || path.join(dataDir, 'keys'), 'second_step');
}

export const STEP_SECONDS = 30;
export const CODE_DIGITS = 6;
export const RECOVERY_CODES = 10;
const RECOVERY_LENGTH = 10;
// No 0/o or 1/i/l: these get misread off paper.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const PENDING_MINUTES = 5;
export const SETUP_MINUTES = 10;
export const ISSUER = 'Life Is';
const MAX_OPEN = 5000;

const stamp = (at: Date) => at.toISOString().slice(0, 19) + '+00:00';

// ---------- the app's code (RFC 6238 over RFC 4226, SHA-1, 6 digits, 30 seconds) ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const at = BASE32.indexOf(ch);
    if (at === -1) throw new Error('Not a valid secret');
    value = (value << 5) | at;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one 30-second step. */
export function totpCode(key: Uint8Array, step: number, digits = CODE_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** The step a typed code belongs to: this one, or one either side to allow for a clock that is a little off. */
export function stepOfCode(key: Uint8Array, code: string, nowMs: number): number | null {
  if (!new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code)) return null;
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  const typed = Buffer.from(code);
  let found: number | null = null;
  for (const step of [current, current - 1, current + 1]) {
    // Every step is compared, whatever the first said, so the time taken doesn't say which one it was.
    if (timingSafeEqual(Buffer.from(totpCode(key, step)), typed) && found === null) found = step;
  }
  return found;
}

export function newSecret(): string {
  return toBase32(randomBytes(20));
}

/** The address an authenticator app reads from the QR code. */
export function otpAddress(username: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(username)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${STEP_SECONDS}`;
}

/** Four letters at a time, to type in. */
export const spaced = (secret: string) => secret.match(/.{1,4}/g)!.join(' ');

// ---------- challenges: short-lived, single use ----------

const hashed = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

export type Challenge = { user_id: number | null; data: Record<string, unknown>; attempts: number };
type ChallengeRow = { token_hash: string; kind: string; user_id: number | null; data: string | null; attempts: number; expires_at: string };

/** A new challenge, kept by the hash of its token (a copy of the database holds nothing to answer one with). */
export async function makeChallenge(db: Db, kind: string, userId: number | null, data: Record<string, unknown> | null,
  minutes: number, clock: Clock, token = randomBytes(32).toString('base64url')): Promise<string> {
  const now = clock();
  await db.run('DELETE FROM auth_challenges WHERE expires_at < ?', [stamp(now)]);
  // So a flood of requests that start a sign-in can't fill the database: past this, the oldest are forgotten.
  if ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_challenges'))!.n >= MAX_OPEN) {
    await db.run('DELETE FROM auth_challenges WHERE token_hash IN (SELECT token_hash FROM auth_challenges ORDER BY created_at LIMIT ?)', [MAX_OPEN / 2]);
  }
  await db.run('INSERT INTO auth_challenges (token_hash, kind, user_id, data, attempts, created_at, expires_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    [hashed(token), kind, userId, data ? JSON.stringify(data) : null, stamp(now), stamp(new Date(now.getTime() + minutes * 60_000))]);
  return token;
}

const parsed = (row: ChallengeRow): Challenge => ({ user_id: row.user_id, attempts: row.attempts, data: row.data ? JSON.parse(row.data) : {} });

/** Looks at a challenge without using it up. Null when there is none of this kind, or it has run out. */
export async function peekChallenge(db: Db, token: unknown, kind: string, clock: Clock): Promise<Challenge | null> {
  if (typeof token !== 'string' || !token || token.length > 400) return null;
  const row = await db.get<ChallengeRow>('SELECT * FROM auth_challenges WHERE token_hash = ? AND kind = ?', [hashed(token), kind]);
  if (!row) return null;
  if (!(row.expires_at >= stamp(clock()))) {
    await db.run('DELETE FROM auth_challenges WHERE token_hash = ?', [row.token_hash]);
    return null;
  }
  return parsed(row);
}

/** Uses a challenge up: the first to ask gets it, and nobody does after. Null when there is none, or it ran out. */
export async function takeChallenge(db: Db, token: unknown, kind: string, clock: Clock): Promise<Challenge | null> {
  if (typeof token !== 'string' || !token || token.length > 400) return null;
  return atomic(db, async (tx) => {
    const row = await tx.get<ChallengeRow>('SELECT * FROM auth_challenges WHERE token_hash = ? AND kind = ?', [hashed(token), kind]);
    if (!row) return null;
    await tx.run('DELETE FROM auth_challenges WHERE token_hash = ?', [row.token_hash]);
    return row.expires_at >= stamp(clock()) ? parsed(row) : null;
  });
}

export async function dropChallenge(db: Db, token: string): Promise<void> {
  await db.run('DELETE FROM auth_challenges WHERE token_hash = ?', [hashed(token)]);
}

/** One more wrong try on a challenge; returns how many it has had. */
export async function countAttempt(db: Db, token: string): Promise<number> {
  await db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE token_hash = ?', [hashed(token)]);
  return (await db.get<{ attempts: number }>('SELECT attempts FROM auth_challenges WHERE token_hash = ?', [hashed(token)]))?.attempts ?? 99;
}

export const tokenKey = hashed;

// ---------- one person's security ----------

export type SecurityRow = { user_id: number; totp_secret: string | null; totp_last_step: number; webauthn_handle: string | null; notice: string | null };

export async function securityOf(db: Db, userId: number): Promise<SecurityRow | undefined> {
  return db.get<SecurityRow>('SELECT user_id, totp_secret, totp_last_step, webauthn_handle, notice FROM user_security WHERE user_id = ?', [userId]);
}

/** Whether signing in asks for a code. */
export async function secondStepOn(db: Db, userId: number): Promise<boolean> {
  return Boolean((await securityOf(db, userId))?.totp_secret);
}

async function ensureRow(tx: { run: Db['run'] }, userId: number, clock: Clock) {
  await tx.run('INSERT OR IGNORE INTO user_security (user_id, updated_at) VALUES (?, ?)', [userId, stamp(clock())]);
}

/** The random handle passkeys carry for this person: neither their username nor their number here. */
export async function userHandle(db: Db, userId: number, clock: Clock): Promise<Buffer> {
  const have = (await securityOf(db, userId))?.webauthn_handle;
  if (have) return Buffer.from(have, 'base64url');
  const made = randomBytes(32);
  await atomic(db, async (tx) => {
    await ensureRow(tx, userId, clock);
    await tx.run('UPDATE user_security SET webauthn_handle = ? WHERE user_id = ? AND webauthn_handle IS NULL', [made.toString('base64url'), userId]);
  });
  return Buffer.from((await securityOf(db, userId))!.webauthn_handle!, 'base64url');
}

// ---------- recovery codes ----------

export const recoveryKey = (typed: string) => typed.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function recoveryLeft(db: Db, userId: number): Promise<number> {
  return (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]))!.n;
}

/** Ten new codes, in a form to write down (abcde-fghjk). Returned here and never again. */
async function newRecovery(): Promise<{ shown: string[]; hashes: string[] }> {
  const shown: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODES; i += 1) {
    const code = Array.from({ length: RECOVERY_LENGTH }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    shown.push(`${code.slice(0, 5)}-${code.slice(5)}`);
    hashes.push(await hashPassword(code));
  }
  return { shown, hashes };
}

async function useRecovery(db: Db, userId: number, typed: string, clock: Clock): Promise<boolean> {
  const rows = await db.all<{ id: number; code_hash: string }>('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
  let match: number | null = null;
  // Every unused code is checked, so the time taken doesn't say which one was right.
  for (const row of rows) if (await verifyPassword(typed, row.code_hash) && match === null) match = row.id;
  if (match === null) return false;
  return (await db.run('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [stamp(clock()), match])).changes === 1;
}

// ---------- checking a code ----------

/**
 * A code typed at the second step: from the app (6 digits) or a recovery code (10 letters and numbers).
 * Returns what it was, or null. Either kind works once.
 */
export async function checkCode(db: Db, sealer: Sealer, userId: number, typed: unknown, clock: Clock): Promise<'app' | 'recovery' | null> {
  if (typeof typed !== 'string' || typed.length > 40) return null;
  const text = typed.replace(/[\s-]/g, '');
  const row = await securityOf(db, userId);
  if (!row?.totp_secret) return null;
  if (/^\d+$/.test(text)) {
    const secret = sealer.unseal(row.totp_secret);
    if (!secret) return null; // locked with a key this computer doesn't have
    const step = stepOfCode(fromBase32(secret), text, clock().getTime());
    if (step === null) return null;
    // Only a step later than the last one used counts, and only one try can be the one that moves it on.
    const moved = await db.run('UPDATE user_security SET totp_last_step = ? WHERE user_id = ? AND totp_last_step < ?', [step, userId, step]);
    return moved.changes === 1 ? 'app' : null;
  }
  if (/^[a-z0-9]{10}$/i.test(text)) return (await useRecovery(db, userId, recoveryKey(text), clock)) ? 'recovery' : null;
  return null;
}

// ---------- turning it on and off ----------

/** Switches two-step on, with ten fresh recovery codes (returned here, once). `step` is the step proved at setup. */
export async function turnOn(db: Db, sealer: Sealer, userId: number, secret: string, step: number, clock: Clock): Promise<string[]> {
  const { shown, hashes } = await newRecovery();
  await atomic(db, async (tx) => {
    await ensureRow(tx, userId, clock);
    await tx.run('UPDATE user_security SET totp_secret = ?, totp_last_step = ?, notice = NULL, updated_at = ? WHERE user_id = ?',
      [sealer.seal(secret), step, stamp(clock()), userId]);
    await tx.run('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
    for (const hash of hashes) await tx.run('INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)', [userId, hash, stamp(clock())]);
    await tx.run("DELETE FROM auth_challenges WHERE user_id = ? AND kind IN ('totp_setup', 'second_step')", [userId]);
  });
  return shown;
}

/** Replaces the recovery codes. */
export async function remakeRecovery(db: Db, userId: number, clock: Clock): Promise<string[]> {
  const { shown, hashes } = await newRecovery();
  await atomic(db, async (tx) => {
    await tx.run('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
    for (const hash of hashes) await tx.run('INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)', [userId, hash, stamp(clock())]);
  });
  return shown;
}

/**
 * Switches two-step off: the secret and the recovery codes are deleted, and any sign-in waiting for its code
 * is cancelled. `notice` is a sentence the person is shown next time they sign in (when an admin did it).
 */
export async function turnOff(db: Db, userId: number, clock: Clock, notice: string | null = null): Promise<void> {
  await atomic(db, async (tx) => {
    await ensureRow(tx, userId, clock);
    await tx.run('UPDATE user_security SET totp_secret = NULL, totp_last_step = 0, notice = COALESCE(?, notice), updated_at = ? WHERE user_id = ?',
      [notice, stamp(clock()), userId]);
    await tx.run('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
    await tx.run("DELETE FROM auth_challenges WHERE user_id = ? AND kind IN ('totp_setup', 'second_step', 'passkey_second')", [userId]);
  });
}

export async function setNotice(db: Db, userId: number, notice: string | null, clock: Clock): Promise<void> {
  await atomic(db, async (tx) => {
    await ensureRow(tx, userId, clock);
    await tx.run('UPDATE user_security SET notice = ?, updated_at = ? WHERE user_id = ?', [notice, stamp(clock()), userId]);
  });
}

/** "March 5, 2046": the day as a person says it. */
export const dayWords = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
