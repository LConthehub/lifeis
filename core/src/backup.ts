/**
 * A backup: everything Life Is holds, in one file that only a passphrase opens.
 *
 * The file is made to be put anywhere, a cloud drive included, without that place learning anything: it is
 * encrypted before it leaves (AES-256-GCM), with a key worked out from a passphrase the person chooses
 * (PBKDF2, 600,000 rounds). Life Is does not keep the passphrase. Lose it and the file cannot be opened, by
 * anyone; that is the point, and the pages say so.
 *
 * Bringing one back replaces everything held, all or nothing. A backup from a newer Life Is is refused.
 * Who is signed in where is not part of a backup.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { LATEST, currentVersion } from './migrations.ts';
import { Problem } from './problem.ts';

export const PASSPHRASE_MIN = 8;
const MAGIC = new TextEncoder().encode('LIFEIS-BACKUP-1\n');
const ROUNDS = 600_000;
/** Kept out of a backup: sign-ins belong to the place they were made. */
const LEFT_OUT = new Set(['sessions', 'login_throttle']);

type Kept = string | number | null | { bytes: string };
type Held = { made_at: string; version: number; tables: Record<string, { columns: string[]; rows: Kept[][] }> };

const named = (name: string) => `"${name.replace(/"/g, '""')}"`;

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const typed = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ROUNDS }, typed, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function checked(passphrase: unknown): string {
  if (typeof passphrase !== 'string' || passphrase.length < PASSPHRASE_MIN) throw new Problem(422, `The passphrase needs at least ${PASSPHRASE_MIN} characters`);
  return passphrase;
}

async function tablesOf(db: Queries): Promise<string[]> {
  const found = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid");
  return found.map((t) => t.name).filter((name) => !LEFT_OUT.has(name));
}
const columnsOf = async (db: Queries, table: string) => (await db.all<{ name: string }>(`PRAGMA table_info(${named(table)})`)).map((c) => c.name);

/** Everything held, as one encrypted file. */
export async function makeBackup(db: Db, passphrase: unknown, clock: () => Date): Promise<Uint8Array> {
  const secret = checked(passphrase);
  // One transaction, so the file is everything as it was at one moment.
  const held = await atomic(db, async (tx): Promise<Held> => {
    const tables: Held['tables'] = {};
    for (const table of await tablesOf(tx)) {
      const columns = await columnsOf(tx, table);
      const rows = await tx.all(`SELECT ${columns.map(named).join(', ')} FROM ${named(table)} ORDER BY rowid`);
      tables[table] = { columns, rows: rows.map((row) => columns.map((c): Kept => { const v = row[c]!; return v instanceof Uint8Array ? { bytes: toBase64(v) } : v; })) };
    }
    return { made_at: clock().toISOString(), version: await currentVersion(tx as unknown as Db), tables };
  });
  const plain = await through(new TextEncoder().encode(JSON.stringify(held)), new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const locked = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, await keyFrom(secret, salt), plain as BufferSource));
  const file = new Uint8Array(MAGIC.length + salt.length + iv.length + locked.length);
  file.set(MAGIC, 0); file.set(salt, MAGIC.length); file.set(iv, MAGIC.length + 16); file.set(locked, MAGIC.length + 28);
  return file;
}

async function open(file: Uint8Array, passphrase: unknown): Promise<Held> {
  if (typeof passphrase !== 'string' || !passphrase) throw new Problem(422, 'Type the passphrase this backup was made with');
  if (file.length < MAGIC.length + 28 + 16 || MAGIC.some((byte, at) => file[at] !== byte)) throw new Problem(400, "That file isn't a Life Is backup");
  const salt = file.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = file.subarray(MAGIC.length + 16, MAGIC.length + 28);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: MAGIC }, await keyFrom(passphrase, salt), file.subarray(MAGIC.length + 28) as BufferSource);
  } catch {
    throw new Problem(400, "That passphrase doesn't open this backup, or the file has been damaged");
  }
  const held = JSON.parse(new TextDecoder().decode(await through(new Uint8Array(plain), new DecompressionStream('gzip')))) as Held;
  if (!held || typeof held.version !== 'number' || typeof held.tables !== 'object') throw new Problem(400, "That file isn't a Life Is backup");
  return held;
}

/**
 * Replaces everything held with what a backup holds. All of it or none of it: if anything goes wrong, what
 * was there before is still there.
 */
export async function restoreBackup(db: Db, file: Uint8Array, passphrase: unknown): Promise<{ made_at: string; rows: number }> {
  const held = await open(file, passphrase);
  if (held.version > LATEST) throw new Problem(400, 'That backup was made by a newer Life Is than this one. Update Life Is, then bring it back.');
  let count = 0;
  await atomic(db, async (tx) => {
    // Rows point at each other; the pointing is checked once everything is back, not row by row.
    try { await tx.run('PRAGMA defer_foreign_keys = ON'); } catch { /* the order below is then what keeps it right */ }
    const here = await tablesOf(tx);
    for (const table of [...here].reverse()) await tx.run(`DELETE FROM ${named(table)}`);
    for (const table of here) {
      const from = held.tables[table];
      if (!from) continue;
      // Only what this Life Is has a place for: an older backup simply has less.
      const known = new Set(await columnsOf(tx, table));
      const use = from.columns.map((name, at) => ({ name, at })).filter((c) => known.has(c.name));
      if (use.length === 0) continue;
      const sql = `INSERT INTO ${named(table)} (${use.map((c) => named(c.name)).join(', ')}) VALUES (${use.map(() => '?').join(', ')})`;
      for (const row of from.rows) {
        await tx.run(sql, use.map((c): Value => { const v = row[c.at] ?? null; return v !== null && typeof v === 'object' ? fromBase64(v.bytes) : v; }));
        count += 1;
      }
    }
  });
  return { made_at: held.made_at, rows: count };
}
