/**
 * A Db for the tests: plain SQLite in memory, through the one built into Node. Not encrypted, and never
 * used for anyone's real records.
 */
import { createRequire } from 'node:module';
import type { Db, Row } from '../src/db.ts';
import { serialDb } from '../src/serialDb.ts';

// Loaded this way because the test runner doesn't yet know "node:sqlite" as part of Node.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export function memoryDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  return serialDb({
    get: (sql, params) => {
      const row = sqlite.prepare(sql).get(...params);
      return row ? ({ ...row } as Row) : undefined;
    },
    all: (sql, params) => sqlite.prepare(sql).all(...params).map((row) => ({ ...row }) as Row),
    run: (sql, params) => {
      const done = sqlite.prepare(sql).run(...params);
      return { lastId: Number(done.lastInsertRowid), changes: Number(done.changes) };
    },
    exec: (sql) => sqlite.exec(sql),
  });
}
