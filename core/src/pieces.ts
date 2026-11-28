/**
 * A thing's pieces: the small parts that go missing (the egg cooker's piercing pin, the lid of the pot).
 *
 * A piece is a light line on a thing, not a thing of its own: a name, how many, an optional place, and a state (here, missing or
 * broken). Pieces never appear in the Things lists or its counts, but search finds the thing they belong to.
 *
 * "Check the pieces" goes through them with a check box each; what is not checked is marked missing, and the thing remembers when it
 * was last checked. A piece that is missing or broken can go on the shopping list. A piece that is replaced every so often becomes its
 * own Upkeep job, named like "Egg cooker: new piercing pin".
 *
 * `pieces(db, owner)` is one person's: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { Problem } from './problem.ts';
import { clean, labelKey, stamp, todayOf, type Clock } from './small.ts';
import { addInterval, upkeep, EVERY_UNITS, type EveryUnit } from './upkeep.ts';

export const PIECE_STATES = ['here', 'missing', 'broken'] as const;
export type PieceState = (typeof PIECE_STATES)[number];

const MAX_PIECES = 60;
const MAX_QUANTITY = 1000;

export type Piece = {
  id: number;
  item_id: number;
  name: string;
  quantity: number;
  place: string | null;
  state: PieceState;
  /** "Replace every 6 months": both or neither. */
  every: { n: number; unit: EveryUnit } | null;
  /** The Upkeep job that replacing it made. */
  job_id: number | null;
};

export type PieceInput = {
  name: string;
  quantity?: number | null;
  place?: string | null;
  /** Left out: unchanged. */
  state?: string;
  /** Left out: unchanged. null clears it (and the Upkeep job it made). */
  every?: { n: number; unit: string } | null;
};

export type Pieces = {
  item_id: number;
  pieces: Piece[];
  /** How many lines are not here (missing or broken). */
  missing: number;
  broken: number;
  /** The day the pieces were last checked, and how many were missing then. Null when they never were. */
  checked_on: string | null;
  checked_missing: number | null;
};

type Row = { id: number; item_id: number; name: string; quantity: number; place: string | null; state: PieceState; every_n: number | null; every_unit: EveryUnit | null; job_id: number | null };

const asPiece = (row: Row): Piece => ({
  id: row.id, item_id: row.item_id, name: row.name, quantity: row.quantity, place: row.place, state: row.state,
  every: row.every_n && row.every_unit ? { n: row.every_n, unit: row.every_unit } : null, job_id: row.job_id,
});

/** What the Upkeep job for replacing a piece is called: "Egg cooker: new piercing pin". */
export const jobName = (thing: string, piece: string): string => `${thing}: new ${piece}`.slice(0, 200);

export function pieces(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);
  const jobs = () => upkeep(db, owner, clock);

  async function thing(q: Queries, id: number): Promise<{ id: number; name: string }> {
    const row = await q.get<{ id: number; name: string }>('SELECT id, name FROM items WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, "That thing isn't here anymore. It may have been deleted.");
    return row;
  }
  async function piece(q: Queries, id: number): Promise<Row & { thing: string }> {
    const row = await q.get<Row & { thing: string }>(
      `SELECT p.id, p.item_id, p.name, p.quantity, p.place, p.state, p.every_n, p.every_unit, p.job_id, i.name AS thing
       FROM item_pieces p JOIN items i ON i.id = p.item_id WHERE p.id = ? AND i.owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, "That piece isn't here anymore. It may have been deleted.");
    return row;
  }

  async function view(q: Queries, itemId: number): Promise<Pieces> {
    const owned = await thing(q, itemId);
    const rows = await q.all<Row>('SELECT id, item_id, name, quantity, place, state, every_n, every_unit, job_id FROM item_pieces WHERE item_id = ? ORDER BY sort_order, id', [itemId]);
    // A piece brought back from a download may be replaced every so often with its job not yet joined to it: join it to the job of its name.
    for (const r of rows) {
      if (!r.every_n || r.job_id !== null) continue;
      const job = await q.get<{ id: number }>('SELECT id FROM upkeep_jobs WHERE owner_id = ? AND item_id = ? AND name = ? ORDER BY id LIMIT 1', [owner, itemId, jobName(owned.name, r.name)]);
      if (job) { r.job_id = job.id; await q.run('UPDATE item_pieces SET job_id = ? WHERE id = ?', [job.id, r.id]); }
    }
    const checked = await q.get<{ pieces_checked_on: string | null; pieces_checked_missing: number | null }>('SELECT pieces_checked_on, pieces_checked_missing FROM items WHERE id = ?', [itemId]);
    const list = rows.map(asPiece);
    return {
      item_id: itemId, pieces: list, missing: list.filter((p) => p.state !== 'here').length, broken: list.filter((p) => p.state === 'broken').length,
      checked_on: checked?.pieces_checked_on ?? null, checked_missing: checked?.pieces_checked_missing ?? null,
    };
  }

  /** What a piece says about how often it is replaced, checked. */
  function every(input: PieceInput['every']): { n: number; unit: EveryUnit } | null {
    if (input === null || input === undefined) return null;
    if (!EVERY_UNITS.includes(input.unit as EveryUnit)) throw new Problem(400, 'Replace it every so many days, weeks, months or years');
    if (!(Number.isInteger(input.n) && input.n > 0 && input.n <= 1000)) throw new Problem(400, 'How often is a whole number, 1 or more');
    return { n: input.n, unit: input.unit as EveryUnit };
  }

  /** Makes, renames or removes the Upkeep job that goes with a piece, so that it matches what the piece now says. */
  async function keepJob(row: { id: number; item_id: number; name: string; thing: string; job_id: number | null }, wanted: { n: number; unit: EveryUnit } | null): Promise<number | null> {
    let exists = row.job_id !== null && Boolean(await db.get('SELECT id FROM upkeep_jobs WHERE id = ? AND owner_id = ?', [row.job_id, owner]));
    if (!exists && wanted) {
      // A job already kept under its usual name (brought back from a download) is the piece's own: not made twice.
      const same = await db.get<{ id: number }>('SELECT id FROM upkeep_jobs WHERE owner_id = ? AND item_id = ? AND name = ? ORDER BY id LIMIT 1', [owner, row.item_id, jobName(row.thing, row.name)]);
      if (same) { row = { ...row, job_id: same.id }; exists = true; }
    }
    const name = jobName(row.thing, row.name);
    if (!wanted) {
      if (exists) await jobs().remove(row.job_id!);
      return null;
    }
    if (exists) {
      const job = await jobs().get(row.job_id!);
      await jobs().update(row.job_id!, { name, item_id: row.item_id, every_n: wanted.n, every_unit: wanted.unit, first_due: job.first_due, activity: job.activity, steps: job.steps, note: job.note });
      return row.job_id;
    }
    const made = await jobs().create({ name, item_id: row.item_id, every_n: wanted.n, every_unit: wanted.unit, first_due: addInterval(today(), wanted.n, wanted.unit) });
    return made.id;
  }

  function values(input: PieceInput) {
    const name = clean(input.name, 120);
    if (!name) throw new Problem(400, 'Give the piece a name');
    const quantity = input.quantity ?? 1;
    if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY)) throw new Problem(400, 'How many is a whole number, 1 or more');
    if (input.state !== undefined && !PIECE_STATES.includes(input.state as PieceState)) throw new Problem(400, 'A piece is here, missing or broken');
    return { name, quantity, place: clean(input.place, 120) };
  }

  return {
    async list(itemId: number): Promise<Pieces> {
      return view(db, itemId);
    },

    async add(itemId: number, input: PieceInput): Promise<Pieces> {
      const owned = await thing(db, itemId);
      const v = values(input);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM item_pieces WHERE item_id = ?', [itemId]))!.n;
      if (count >= MAX_PIECES) throw new Problem(400, `A thing can list up to ${MAX_PIECES} pieces`);
      const state = (input.state ?? 'here') as PieceState;
      const wanted = every(input.every);
      const made = await db.run(
        'INSERT INTO item_pieces (item_id, name, quantity, place, state, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [itemId, v.name, v.quantity, v.place, state, count + 1, now()]);
      if (wanted) {
        const job = await keepJob({ id: made.lastId, item_id: itemId, name: v.name, thing: owned.name, job_id: null }, wanted);
        await db.run('UPDATE item_pieces SET every_n = ?, every_unit = ?, job_id = ? WHERE id = ?', [wanted.n, wanted.unit, job, made.lastId]);
      }
      return view(db, itemId);
    },

    async update(id: number, input: PieceInput): Promise<Pieces> {
      const row = await piece(db, id);
      const v = values(input);
      const state = (input.state ?? row.state) as PieceState;
      const wanted = input.every === undefined ? (row.every_n && row.every_unit ? { n: row.every_n, unit: row.every_unit } : null) : every(input.every);
      const job = await keepJob({ id, item_id: row.item_id, name: v.name, thing: row.thing, job_id: row.job_id }, wanted);
      await db.run('UPDATE item_pieces SET name = ?, quantity = ?, place = ?, state = ?, every_n = ?, every_unit = ?, job_id = ? WHERE id = ?',
        [v.name, v.quantity, v.place, state, wanted?.n ?? null, wanted?.unit ?? null, job, id]);
      return view(db, row.item_id);
    },

    async remove(id: number): Promise<Pieces> {
      const row = await piece(db, id);
      await keepJob({ id, item_id: row.item_id, name: row.name, thing: row.thing, job_id: row.job_id }, null);
      await db.run('DELETE FROM item_pieces WHERE id = ?', [id]);
      return view(db, row.item_id);
    },

    /**
     * Go through the pieces: the ones named in `here` were found and are marked here (a broken one stays broken); every other piece
     * is marked missing. The thing then remembers the day and how many are missing.
     */
    async check(itemId: number, here: number[]): Promise<Pieces> {
      await thing(db, itemId);
      return atomic(db, async (tx) => {
        const rows = await tx.all<{ id: number; state: PieceState }>('SELECT id, state FROM item_pieces WHERE item_id = ?', [itemId]);
        if (rows.length === 0) throw new Problem(400, 'This thing has no pieces to check yet');
        const found = new Set(here);
        let missing = 0;
        for (const r of rows) {
          const next: PieceState = found.has(r.id) ? (r.state === 'broken' ? 'broken' : 'here') : 'missing';
          if (next !== 'here') missing += 1;
          if (next !== r.state) await tx.run('UPDATE item_pieces SET state = ? WHERE id = ?', [next, r.id]);
        }
        await tx.run('UPDATE items SET pieces_checked_on = ?, pieces_checked_missing = ?, updated_at = ? WHERE id = ?', [today(), missing, now(), itemId]);
        return view(tx, itemId);
      });
    },

    /** Put a piece on the shopping list (once: when it is already there, not yet bought, nothing is added). */
    async shop(id: number): Promise<{ added: boolean; pieces: Pieces }> {
      const row = await piece(db, id);
      const label = clean(row.name, 200)!;
      const open = await db.all<{ label: string }>('SELECT label FROM grocery WHERE owner_id = ? AND done = 0', [owner]);
      const already = open.some((l) => labelKey(l.label) === labelKey(label));
      if (!already) {
        await db.run('INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, created_at) VALUES (?, NULL, ?, ?, NULL, ?, ?)',
          [owner, label, row.quantity > 1 ? row.quantity : null, `for ${row.thing}`, now()]);
      }
      return { added: !already, pieces: await view(db, row.item_id) };
    },
  };
}

export type PiecesOf = ReturnType<typeof pieces>;
