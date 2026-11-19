/**
 * A Db for the tests: plain SQLite in memory, through the one built into Node. Not encrypted, and never
 * used for anyone's real records.
 */
import { createRequire } from 'node:module';
import type { Db, Queries, Row, Tx, Value, Written } from '../src/db';

// Loaded this way because the test runner doesn't yet know "node:sqlite" as part of Node.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export function memoryDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  const direct: Queries = {
    async get<T extends Row>(sql: string, params: Value[] = []) {
      const row = sqlite.prepare(sql).get(...params);
      return row ? ({ ...row } as T) : undefined;
    },
    async all<T extends Row>(sql: string, params: Value[] = []) {
      return sqlite.prepare(sql).all(...params).map((row) => ({ ...row }) as T);
    },
    async run(sql: string, params: Value[] = []): Promise<Written> {
      const done = sqlite.prepare(sql).run(...params);
      return { lastId: Number(done.lastInsertRowid), changes: Number(done.changes) };
    },
  };

  // There is one connection, so an open transaction owns it: everything else queues behind `free`.
  let free: Promise<void> = Promise.resolve();
  const waiting = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => {
    await free;
    return fn(...args);
  };

  return {
    get: waiting(direct.get) as Queries['get'],
    all: waiting(direct.all) as Queries['all'],
    run: waiting(direct.run),
    async begin(): Promise<Tx> {
      const before = free;
      let release!: () => void;
      free = new Promise<void>((resolve) => (release = resolve));
      await before;
      sqlite.exec('BEGIN IMMEDIATE');
      let open = true;
      const inside = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => {
        if (!open) throw new Error('This transaction has already ended.');
        return fn(...args);
      };
      const end = (sql: string) => inside(async () => {
        open = false;
        try {
          sqlite.exec(sql);
        } finally {
          release();
        }
      });
      return {
        get: inside(direct.get) as Queries['get'],
        all: inside(direct.all) as Queries['all'],
        run: inside(direct.run),
        commit: end('COMMIT'),
        rollback: end('ROLLBACK'),
      };
    },
  };
}
