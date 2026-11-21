/**
 * A Db made from one SQLite connection: the server's and the tests', which answer at once, or a phone's,
 * which answers a moment later.
 *
 * One connection can hold one transaction, so an open transaction owns the connection: every other read,
 * write and transaction waits in line until it ends. That is what keeps one person's half-finished change
 * from being mixed with, or undone alongside, someone else's.
 */
import type { Db, Queries, Row, Tx, Value, Written } from './db.ts';

/** The connection, as plainly as it can be put. Each of these may answer straight away or with a promise. */
type Soon<T> = T | Promise<T>;
export type Connection = {
  get(sql: string, params: Value[]): Soon<Row | undefined>;
  all(sql: string, params: Value[]): Soon<Row[]>;
  run(sql: string, params: Value[]): Soon<Written>;
  /** SQL with nothing to fill in and nothing to give back: BEGIN, COMMIT, ROLLBACK. */
  exec(sql: string): Soon<void>;
};

export function serialDb(connection: Connection): Db {
  const direct: Queries = {
    get: async <T extends Row>(sql: string, params: Value[] = []) => (await connection.get(sql, params)) as T | undefined,
    all: async <T extends Row>(sql: string, params: Value[] = []) => (await connection.all(sql, params)) as T[],
    run: async (sql: string, params: Value[] = []) => connection.run(sql, params),
  };

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
      try {
        await connection.exec('BEGIN IMMEDIATE');
      } catch (problem) {
        release();
        throw problem;
      }
      let open = true;
      const inside = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => {
        if (!open) throw new Error('This transaction has already ended.');
        return fn(...args);
      };
      const end = (sql: string) => inside(async () => {
        open = false;
        try {
          await connection.exec(sql);
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
