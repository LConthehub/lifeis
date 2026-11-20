/**
 * The one door between Life Is and its database.
 *
 * The kitchen (and every section after it) is written against the Db interface below, never against a
 * particular SQLite library. Each place Life Is runs then supplies its own Db:
 *   - the self-hosted server: SQLCipher through a Node library, where a query answers at once;
 *   - the phone and tablet app: SQLCipher through Capacitor, where every query crosses into native code
 *     and answers later (a Promise);
 *   - the tests: a plain in-memory SQLite.
 * Because the phone can only answer later, everything here has to be async, even where the server could
 * answer at once.
 */

/** A value SQLite can hold. Bytes (a Uint8Array) are for pictures. */
export type Value = string | number | null | Uint8Array;

/** A row as it comes back: column name -> value. */
export type Row = Record<string, Value>;

/** What a write did: the id of the row it added (only meaningful after an INSERT), and how many rows it touched. */
export type Written = { lastId: number; changes: number };

/** Reading and writing. `?` in the SQL is filled from params, in order. */
export interface Queries {
  /** The first matching row, or undefined when there is none. */
  get<T extends Row = Row>(sql: string, params?: Value[]): Promise<T | undefined>;
  /** Every matching row, in the order the SQL asks for. */
  all<T extends Row = Row>(sql: string, params?: Value[]): Promise<T[]>;
  /** An INSERT, UPDATE or DELETE. */
  run(sql: string, params?: Value[]): Promise<Written>;
}

/**
 * Several writes that all happen or none do. Everything inside the transaction goes through this, not
 * through the Db it came from, and it must end with commit() or rollback(): until then, the Db's own
 * reads and writes wait. After either, it can't be used again.
 */
export interface Tx extends Queries {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface Db extends Queries {
  /** Starts a transaction. Waits for one already open to end. */
  begin(): Promise<Tx>;
}

/** Does the work in a transaction: kept if it finishes, undone if it throws. */
export async function atomic<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  let result: T;
  try {
    result = await work(tx);
  } catch (problem) {
    await tx.rollback();
    throw problem;
  }
  await tx.commit();
  return result;
}
