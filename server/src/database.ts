/**
 * The database file, encrypted.
 *
 * Everything Life Is keeps is in one SQLite file, encrypted with SQLCipher (AES-256), page by page, with a
 * random 256-bit key that is kept apart from it (keys.ts). A copy of the database file on its own, such as a
 * copied data folder or an old upgrade copy, can't be read without that key.
 *
 * What it doesn't do: protect against someone who can use the computer while the key is there. Disk
 * encryption and a locked computer account still matter.
 *
 * This is the same file, the same encryption and the same key file as the Python server used
 * (backend/dbfile.py), so records made by one open in the other.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, renameSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { LATEST, migrate, serialDb, type Db, type Row, type Value } from '../../core/src/index.ts';
import { fileSecret } from './keys.ts';

const KEY_NAME = 'database.key';
const PLAIN_HEADER = 'SQLite format 3\0';

export type OpenDatabase = { db: Db; file: string; close(): void };

/** Whether a database file is stored unencrypted. */
function isPlain(file: string): boolean {
  if (!existsSync(file)) return false;
  const start = Buffer.alloc(16);
  const handle = openSync(file, 'r');
  try {
    readSync(handle, start, 0, 16, 0);
  } finally {
    closeSync(handle);
  }
  return start.toString('latin1') === PLAIN_HEADER;
}

function connect(file: string, keyDir: string) {
  const sqlite = new Database(file, { timeout: 5000 });
  sqlite.pragma("cipher = 'sqlcipher'");
  sqlite.pragma('legacy = 4');
  sqlite.pragma(`key = "x'${fileSecret(path.join(keyDir, KEY_NAME)).toString('hex')}'"`);
  try {
    sqlite.prepare('SELECT COUNT(*) FROM sqlite_master').get();
  } catch {
    sqlite.close();
    throw new Error(`The database at ${file} can't be opened with the key in ${keyDir}. ` +
      'If the key was lost or replaced, restore a backup; the database is left as it was.');
  }
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

/** Opens (or makes) the database in dataDir, brought up to date. A copy is saved before any upgrade. */
export async function openDatabase(dataDir: string, keyDir: string): Promise<OpenDatabase> {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'lifeis.db');
  if (isPlain(file)) {
    throw new Error(`The database at ${file} isn't encrypted, and this version of Life Is only opens encrypted ones. It is left as it was.`);
  }
  const sqlite = connect(file, keyDir);
  const db = serialDb({
    get: (sql, params: Value[]) => sqlite.prepare(sql).get(...params) as Row | undefined,
    all: (sql, params: Value[]) => sqlite.prepare(sql).all(...params) as Row[],
    run: (sql, params: Value[]) => {
      const done = sqlite.prepare(sql).run(...params);
      return { lastId: Number(done.lastInsertRowid), changes: done.changes };
    },
    exec: (sql) => void sqlite.exec(sql),
  });
  await migrate(db, async (from) => {
    // Nothing else is using the file yet, and nothing is half-written, so a copy of the file is a whole copy.
    const copy = path.join(dataDir, `lifeis.before-v${LATEST}.db`);
    if (existsSync(copy)) renameSync(copy, copy + '.old');
    copyFileSync(file, copy);
    console.warn(`Upgrading the database from v${from} to v${LATEST}. A copy was saved at ${copy}`);
  });
  return { db, file, close: () => void sqlite.close() };
}
