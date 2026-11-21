/**
 * The database, when Life Is keeps everything on the device itself instead of on a server.
 *
 * THIS ONE IS A STAND-IN, for building and trying the on-device app in a browser. It is SQLite compiled to
 * run inside the page, held in memory and saved whole into the browser's own storage after each change. It
 * is NOT encrypted, so it must never be what ships: on a phone, this file's job is done by SQLCipher through
 * Capacitor, opened with a key the phone's keystore holds. Everything above this file is the same either way,
 * because all of it talks to the `Db` the core defines and never to a particular SQLite.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { serialDb } from '../../../core/src/index.ts';

const STORE = 'lifeis-device';
const KEY = 'database';

function storage() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(STORE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function kept() {
  const idb = await storage();
  return new Promise((resolve, reject) => {
    const get = idb.transaction('files').objectStore('files').get(KEY);
    get.onsuccess = () => resolve(get.result ?? null);
    get.onerror = () => reject(get.error);
  });
}
async function keep(bytes) {
  const idb = await storage();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('files', 'readwrite');
    tx.objectStore('files').put(bytes, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Opens the device's database, as the core's Db. `saved()` resolves once everything written so far is kept. */
export async function openDeviceDatabase() {
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: console.error });
  const { capi, wasm } = sqlite3;
  const sqlite = new sqlite3.oo1.DB(':memory:');
  const before = await kept();
  if (before) {
    const at = wasm.allocFromTypedArray(before);
    sqlite.checkRc(capi.sqlite3_deserialize(sqlite.pointer, 'main', at, before.byteLength, before.byteLength,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE));
  }
  sqlite.exec('PRAGMA foreign_keys = ON');

  // Saving: a moment after the last change, and never two saves at once.
  let waiting = null;
  let saving = Promise.resolve();
  let inTransaction = false;
  const save = () => { saving = saving.then(() => keep(capi.sqlite3_js_db_export(sqlite.pointer))).catch(console.error); return saving; };
  const changed = () => {
    if (inTransaction) return;
    clearTimeout(waiting);
    waiting = setTimeout(() => { waiting = null; save(); }, 150);
  };

  const rows = (sql, params) => sqlite.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows' });
  const connection = {
    get: (sql, params) => rows(sql, params)[0],
    all: (sql, params) => rows(sql, params),
    run(sql, params) {
      sqlite.exec({ sql, bind: params });
      changed();
      return { lastId: Number(capi.sqlite3_last_insert_rowid(sqlite.pointer)), changes: sqlite.changes() };
    },
    exec(sql) {
      sqlite.exec(sql);
      if (/^BEGIN/i.test(sql)) inTransaction = true;
      if (/^(COMMIT|ROLLBACK)/i.test(sql)) { inTransaction = false; changed(); }
    },
  };
  return {
    db: serialDb(connection),
    /** Resolves when what has been written is safely kept. */
    async saved() {
      if (waiting !== null) { clearTimeout(waiting); waiting = null; save(); }
      await saving;
    },
  };
}
