/**
 * The database on a phone: SQLite, encrypted with SQLCipher (the same encryption the server's database has).
 *
 * The key is made on the phone the first time the app opens, 256 random bits, and handed straight to the
 * phone's keystore. It is never shown, never typed, and never leaves the phone; Life Is itself does not keep
 * a copy. So the database file is unreadable anywhere but on this phone, in this app.
 *
 * Everything above this file talks to the `Db` the core defines, so nothing else knows which SQLite it has.
 */
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { serialDb } from '../../../core/src/index.ts';

const NAME = 'lifeis';

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Pictures are bytes. The phone's SQLite takes them, and gives them back, as plain lists of numbers.
const toPhone = (value) => (value instanceof Uint8Array ? { type: 'Buffer', data: Array.from(value) } : value);
const fromPhone = (row) => {
  for (const name of Object.keys(row)) if (Array.isArray(row[name])) row[name] = Uint8Array.from(row[name]);
  return row;
};

export async function openNativeDatabase() {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  if (!(await sqlite.isSecretStored()).result) await sqlite.setEncryptionSecret(newKey());
  // The page can be reloaded while the app stays open; then the phone still holds the connection.
  await sqlite.checkConnectionsConsistency().catch(() => {});
  const held = (await sqlite.isConnection(NAME, false)).result;
  const phone = held ? await sqlite.retrieveConnection(NAME, false) : await sqlite.createConnection(NAME, true, 'secret', 1, false);
  await phone.open();

  const rows = async (sql, params) => ((await phone.query(sql, params.map(toPhone))).values ?? []).map(fromPhone);
  const connection = {
    get: async (sql, params) => (await rows(sql, params))[0],
    all: rows,
    async run(sql, params) {
      const { changes } = await phone.run(sql, params.map(toPhone), false);
      return { lastId: Number(changes?.lastId ?? 0), changes: Number(changes?.changes ?? 0) };
    },
    async exec(sql) {
      if (/^BEGIN/i.test(sql)) await phone.beginTransaction();
      else if (/^COMMIT/i.test(sql)) await phone.commitTransaction();
      else if (/^ROLLBACK/i.test(sql)) await phone.rollbackTransaction();
      else await phone.execute(sql, false);
    },
  };
  // The phone writes each change to its file as it is made, so there is never anything waiting to be kept.
  return { db: serialDb(connection), saved: async () => {} };
}
