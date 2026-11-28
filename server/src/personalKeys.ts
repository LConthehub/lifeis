/**
 * Personal keys: a named key a person makes for a voice shortcut (Siri Shortcuts), good for a short list of things.
 *
 * - The key is random, shown once when it is made, and never kept: only its SHA-256 hash is (as with a session),
 *   so a copy of the database can't be used with it. The last four letters are kept so keys can be told apart.
 * - A key opens only the /api/voice addresses, only for the things in its list, and only for the person who made it.
 *   It never signs anyone in: it has no cookie, no session, and no way to reach anything else.
 * - A turned-off or deleted key is refused the next request. A wrong, off, deleted or badly made key all get the same
 *   answer, so nobody learns which. Wrong ones are counted per address and slowed down like wrong passwords.
 * - Each key may be used 60 times a minute.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isKeyAction, KEY_ACTIONS, type Db, type KeyAction } from '../../core/src/index.ts';
import { addDays, dayNumber, todayOf } from '../../core/src/small.ts';
import { LoginThrottle, type Clock } from './auth.ts';
import { Refusal } from './http.ts';

export const KEY_PREFIX = 'lik_';
const FORMAT = /^lik_[A-Za-z0-9_-]{43}$/;
export const MOST_KEYS = 10;
export const MAX_KEY_NAME = 60;
export const PER_MINUTE = 60;

export const REFUSED = "That key isn't working.";

/** Wrong keys from one address: 20 free, then slower and slower. */
export const keyThrottle = new LoginThrottle('key', 20);

const hashOf = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/** A key nobody has used for this many days stops working: counted from its last use, or from when it was made. */
export const UNUSED_DAYS = 365;
const stopsOn = (row: { created_at: string; last_used_on: string | null }) => addDays(row.last_used_on ?? row.created_at.slice(0, 10), UNUSED_DAYS);

export type KeyInfo = {
  id: number; name: string; hint: string; can: KeyAction[]; says: string[]; on: boolean; created_at: string; last_used_on: string | null;
  /** The day the key stops working if it is not used again. */
  stops_on: string;
};
type Row = { id: number; name: string; hint: string; can: string; is_on: number; created_at: string; last_used_on: string | null };

const actionsOf = (can: string): KeyAction[] => can.split(',').filter(isKeyAction);
const describe = (row: Row): KeyInfo => {
  const can = actionsOf(row.can);
  return { id: row.id, name: row.name, hint: row.hint, can, says: can.map((id) => KEY_ACTIONS.find((a) => a.id === id)!.says), on: row.is_on === 1, created_at: row.created_at, last_used_on: row.last_used_on, stops_on: stopsOn(row) };
};
const COLUMNS = 'id, name, hint, can, is_on, created_at, last_used_on';

export async function listKeys(db: Db, owner: number): Promise<KeyInfo[]> {
  return (await db.all<Row>(`SELECT ${COLUMNS} FROM personal_keys WHERE owner_id = ? ORDER BY id`, [owner])).map(describe);
}

/** Makes a key. The key itself is in the answer once and nowhere else. */
export async function makeKey(db: Db, owner: number, input: { name: string; can: string[] }, clock: Clock): Promise<{ key: string; info: KeyInfo }> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Refusal(400, 'Give the key a name, like "Siri on my iPhone"');
  if (name.length > MAX_KEY_NAME) throw new Refusal(400, `A key's name is at most ${MAX_KEY_NAME} letters`);
  const can = [...new Set(input.can)];
  if (can.length === 0 || !can.every(isKeyAction)) throw new Refusal(400, 'Choose what the key may do');
  if ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM personal_keys WHERE owner_id = ?', [owner]))!.n >= MOST_KEYS) {
    throw new Refusal(400, `That's ${MOST_KEYS} keys. Delete one you don't use first.`);
  }
  const key = KEY_PREFIX + randomBytes(32).toString('base64url');
  const made = await db.run('INSERT INTO personal_keys (owner_id, name, key_hash, hint, can, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [owner, name, hashOf(key), key.slice(-4), can.join(','), clock().toISOString().slice(0, 19) + '+00:00']);
  const row = (await db.get<Row>(`SELECT ${COLUMNS} FROM personal_keys WHERE id = ?`, [made.lastId]))!;
  return { key, info: describe(row) };
}

export async function turnKey(db: Db, owner: number, id: number, on: boolean): Promise<KeyInfo> {
  const done = await db.run('UPDATE personal_keys SET is_on = ? WHERE id = ? AND owner_id = ?', [on ? 1 : 0, id, owner]);
  if (!done.changes) throw new Refusal(404, "That key isn't here anymore. It may have been deleted.");
  return describe((await db.get<Row>(`SELECT ${COLUMNS} FROM personal_keys WHERE id = ?`, [id]))!);
}

export async function deleteKey(db: Db, owner: number, id: number): Promise<void> {
  await db.run('DELETE FROM personal_keys WHERE id = ? AND owner_id = ?', [id, owner]);
}

// ---------- using one ----------

/** Per key, when its last requests were (in memory: a restart gives a fresh minute, which is fine). */
const recent = new Map<string, number[]>();

export type KeyUse = { id: number; owner: number; can: KeyAction[] };

/** The key in `Authorization: Bearer <key>`, or undefined. */
export function bearer(header: string | string[] | undefined): string | undefined {
  const text = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer[ \t]+(\S{1,200})[ \t]*$/i.exec(text ?? '');
  return m?.[1];
}

/**
 * Who a key is, if it is good and on. Anything else is the same refusal, and a wrong one is counted against the address.
 * Counts as a use: the day it was last used is kept (the day only, nothing else about the request).
 */
export async function useKey(db: Db, key: string | undefined, ip: string, clock: Clock): Promise<KeyUse> {
  const wait = await keyThrottle.secondsLocked(db, ip, clock);
  if (wait) throw new Refusal(429, `Too many wrong keys. Try again in ${wait} seconds.`);
  const hash = key && FORMAT.test(key) ? hashOf(key) : '';
  const row = hash
    ? await db.get<{ id: number; owner_id: number; can: string; is_on: number; created_at: string; last_used_on: string | null }>(
      'SELECT id, owner_id, can, is_on, created_at, last_used_on FROM personal_keys WHERE key_hash = ?', [hash])
    : undefined;
  if (!row || row.is_on !== 1) {
    await keyThrottle.failure(db, ip, clock);
    throw new Refusal(401, REFUSED);
  }
  // Unused for a year: it has stopped (the same answer as any key that isn't working). It is not a wrong guess, so not counted.
  if (dayNumber(todayOf(clock)) >= dayNumber(stopsOn(row))) throw new Refusal(401, REFUSED);
  const now = clock().getTime();
  const times = (recent.get(hash) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= PER_MINUTE) throw new Refusal(429, 'That key is being used too fast. Wait a minute.');
  times.push(now);
  recent.set(hash, times);
  const day = todayOf(clock);
  if (row.last_used_on !== day) await db.run('UPDATE personal_keys SET last_used_on = ? WHERE id = ?', [day, row.id]);
  return { id: row.id, owner: row.owner_id, can: actionsOf(row.can) };
}
