/**
 * Done shopping at a store: the part of the grocery list that was got there becomes spending.
 *
 * A trip is one visit to one store. Its lines are the things on the list that are in the buggy and go to that store
 * (shopping.ts decides where each goes). The person says what the receipt came to; the estimate from the prices on
 * the lines is filled in for them. That total becomes one spending entry (in the month's grocery category, when
 * there is one), or several when the receipt is split: the split is suggested from what each line belongs to (the
 * week's menu, a project's supplies, the household) and the person changes the amounts. A part that belongs to a
 * project is a paid cost on that project (projects.ts), so it is counted there and in the budget's Projects line.
 *
 * The receipt can be a photo, read on the device (receipt.ts finds the lines; the person checks them). What a line saved is kept apart
 * from what was paid (prices.saved_cents), the receipt's photo, made small on the device, stays with the trip (trip_receipts) and so with
 * the spending entry, and the lines are tied to the trip so a later, cheaper price can say what to ask the store for (shopping.ts drops).
 *
 * The trip is kept (shopping_trips) so that a charge the bank brings in later for the same store and amount, on a
 * close day, is recognized as it and not counted again (money.ts). The lines that were got are then taken off the
 * list; their prices stay, with the store, as price history.
 *
 * Money is whole cents.
 */
import { atomic, type Db } from './db.ts';
import { Problem } from './problem.ts';
import { projects } from './projects.ts';
import { shopping } from './shopping.ts';
import { MAX_THING_PHOTO } from './inventory.ts';
import { readReceipt, tieToList, type Receipt, type Tie } from './receipt.ts';
import { clean, dayOrNull, labelKey, pictureType, stamp, todayOf, type Clock } from './small.ts';

export type Belongs = 'menu' | 'project' | 'household' | 'groceries';
export type TripLine = { id: number; label: string; cents: number | null; /** What was saved on it; the full price is the two together. */ saved_cents: number; assumed: boolean; belongs: Belongs; project_id: number | null; project: string | null };
export type TripPart = { key: string; label: string; cents: number; lines: number; category_id: number | null; project_id: number | null };
export type TripPlan = {
  currency: string;
  /** The store, as the list spells it; null for lines with no store. */
  store: string | null;
  day: string;
  lines: TripLine[];
  /** What the lines come to (prices paid, and last prices standing in). */
  estimate_cents: number;
  /** What the lines saved, in all. */
  saved_cents: number;
  /** Lines in the buggy with no price at all. */
  unpriced: number;
  /** The suggested split of the receipt. One part when everything belongs together. */
  parts: TripPart[];
  /** What a part can go in. */
  categories: { id: number; name: string }[];
  projects: { id: number; name: string }[];
};
export type TripInput = {
  store?: string | null;
  /** The store the lines are listed under, when that is not `store`: lines with no store yet (null or empty), done at the store named. */
  from?: string | null;
  total_cents?: number | null;
  /** What the receipt saved in all (the lines' savings and any not tied to a line). Left out: what the lines saved. */
  saved_cents?: number | null;
  /** The receipt's photo, already made small, to keep with the spending. */
  photo?: Uint8Array | null;
  day?: string | null;
  /** Left out: the whole receipt is one entry. Otherwise the amounts must add up to the total. */
  parts?: { label?: string | null; cents?: number | null; category_id?: number | null; project_id?: number | null }[];
};
export type TripDone = { id: number; store: string; day: string; total_cents: number; estimate_cents: number | null; saved_cents: number; entries: number; got: number; receipt: boolean };

const MOST = 100_000_000_00;
const HOUSEHOLD_AISLE = /household|cleaning|paper|laundry|pet|health|beauty|toiletr|personal|baby|pharmacy/i;

export function trips(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const SEEN = `SELECT c.id, c.name FROM money_categories c WHERE c.owner_id = ? OR EXISTS (SELECT 1 FROM money_shares s WHERE s.category_id = c.id AND s.user_id = ?)`;

  async function plan(store: string | null): Promise<TripPlan> {
    const shop = await shopping(db, owner, clock).summary();
    const want = (clean(store, 100) ?? '').toLowerCase();
    const rows = await db.all<{ id: number; label: string; from_plan: number; aisle: string | null }>(
      `SELECT g.id, g.label, g.from_plan, i.aisle FROM grocery g LEFT JOIN ingredients i ON i.id = g.ingredient_id WHERE g.owner_id = ? AND g.done = 1 ORDER BY g.id`, [owner]);
    const supplies = await db.all<{ label: string; project_id: number; project: string }>(
      `SELECT l.label, p.id AS project_id, p.name AS project FROM project_items l JOIN projects p ON p.id = l.project_id
       WHERE p.owner_id = ? AND l.used_on IS NULL AND p.status IN ('idea', 'planned', 'active', 'paused') ORDER BY p.id, l.id`, [owner]);
    const lines: TripLine[] = [];
    for (const r of rows) {
      const l = shop.lines.find((x) => x.id === r.id);
      if (!l || (l.store ?? '').toLowerCase() !== want) continue;
      const a = labelKey(r.label);
      const supply = r.from_plan ? undefined : supplies.find((s) => { const b = labelKey(s.label); return b.length >= 3 && (a === b || a.includes(b) || b.includes(a)); });
      const belongs: Belongs = r.from_plan ? 'menu' : supply ? 'project' : r.aisle && HOUSEHOLD_AISLE.test(r.aisle) ? 'household' : 'groceries';
      lines.push({ id: r.id, label: r.label, cents: l.price_cents, saved_cents: l.saved_cents, assumed: l.assumed, belongs, project_id: supply?.project_id ?? null, project: supply?.project ?? null });
    }
    const categories = await db.all<{ id: number; name: string }>(`${SEEN} ORDER BY c.owner_id = ? DESC, c.sort_order, c.id`, [owner, owner, owner]);
    const groceries = shop.grocery_budget?.category_id ?? null;
    const household = categories.find((c) => /household|house|home/i.test(c.name))?.id ?? null;

    const groups = new Map<string, TripPart>();
    const add = (key: string, label: string, category_id: number | null, project_id: number | null, cents: number) => {
      const part = groups.get(key) ?? groups.set(key, { key, label, cents: 0, lines: 0, category_id, project_id }).get(key)!;
      part.cents += cents;
      part.lines += 1;
    };
    for (const l of lines) {
      if (l.belongs === 'project') add(`project:${l.project_id}`, `${l.project} supplies`, null, l.project_id, l.cents ?? 0);
      else if (l.belongs === 'household') add('household', 'Household', household, null, l.cents ?? 0);
      else if (l.belongs === 'menu') add('menu', "The week's meals", groceries, null, l.cents ?? 0);
      else add('groceries', 'Groceries', groceries, null, l.cents ?? 0);
    }
    const order = (p: TripPart) => (p.key === 'menu' ? 0 : p.key === 'groceries' ? 1 : p.key === 'household' ? 2 : 3);
    const parts = [...groups.values()].sort((a, b) => order(a) - order(b));
    return {
      currency: shop.currency, store: store ? clean(store, 100) : null, day: today(), lines,
      estimate_cents: lines.reduce((n, l) => n + (l.cents ?? 0), 0), saved_cents: lines.reduce((n, l) => n + l.saved_cents, 0), unpriced: lines.filter((l) => l.cents === null).length,
      parts, categories, projects: await db.all<{ id: number; name: string }>(
        `SELECT id, name FROM projects WHERE owner_id = ? AND status IN ('idea', 'planned', 'active', 'paused') ORDER BY name COLLATE NOCASE`, [owner]),
    };
  }

  return {
    /** What done shopping at this store would do: its lines, their estimate, and how the receipt might be split. */
    plan,

    /** The photo of a trip's receipt, or null when it has none. */
    async receipt(tripId: number): Promise<{ type: string; bytes: Uint8Array } | null> {
      if (!(await db.get('SELECT 1 AS x FROM shopping_trips WHERE id = ? AND owner_id = ?', [tripId, owner]))) throw new Problem(404, "That shopping trip isn't here anymore. It may have been deleted.");
      return (await db.get<{ type: string; bytes: Uint8Array }>('SELECT type, bytes FROM trip_receipts WHERE trip_id = ? AND owner_id = ?', [tripId, owner])) ?? null;
    },

    /** A receipt read from a photo's words: what it says, and which line in the buggy for this store each thing on it is. Nothing is changed. */
    async readReceipt(text: string, from: string | null): Promise<{ receipt: Receipt; ties: Tie[]; lines: TripLine[] }> {
      const receipt = readReceipt(text);
      const mine = await plan(from);
      return { receipt, ties: tieToList(receipt.items, mine.lines), lines: mine.lines };
    },

    /**
     * Done at a store. Writes the receipt as spending (one entry, or one for each part), keeps the trip so a later bank
     * charge for it is not counted again, puts the store on the prices paid, and takes the lines that were got off the list.
     */
    async finish(input: TripInput): Promise<TripDone> {
      const store = clean(input.store, 100);
      if (!store) throw new Problem(400, 'Say which store it was');
      const total = input.total_cents;
      if (typeof total !== 'number' || !Number.isInteger(total) || total < 0 || total > MOST) throw new Problem(422, 'The receipt total should be an amount of money, not below zero');
      const day = dayOrNull(input.day) ?? today();
      const mine = await plan(input.from !== undefined ? input.from : store);
      const given = input.parts && input.parts.length > 0 ? input.parts : null;
      const parts = (given ?? [{ label: null, cents: total, category_id: mine.categories.find((c) => /grocer/i.test(c.name))?.id ?? null, project_id: null }]).map((p) => {
        const cents = p.cents;
        if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0 || cents > MOST) throw new Problem(422, 'Each part should be an amount of money, not below zero');
        return { label: clean(p.label, 100), cents, category_id: p.category_id ?? null, project_id: p.project_id ?? null };
      });
      const saved = input.saved_cents ?? mine.lines.reduce((n, l) => n + l.saved_cents, 0);
      if (!Number.isInteger(saved) || saved < 0 || saved > MOST) throw new Problem(422, 'What the receipt saved should be an amount of money, not below zero');
      if (input.photo && (input.photo.length > MAX_THING_PHOTO || pictureType(input.photo) === null)) throw new Problem(400, "That isn't a picture Life Is can keep (JPEG, PNG or WebP), or it is too large");
      const added = parts.reduce((n, p) => n + p.cents, 0);
      if (added !== total) throw new Problem(400, `The parts add up to ${(added / 100).toFixed(2)}, and the receipt total is ${(total / 100).toFixed(2)}. They should match.`);
      return atomic(db, async (tx) => {
        await tx.run('INSERT OR IGNORE INTO stores (owner_id, name, created_at) VALUES (?, ?, ?)', [owner, store, stamp(clock())]);
        const name = (await tx.get<{ name: string }>('SELECT name FROM stores WHERE owner_id = ? AND name = ? COLLATE NOCASE', [owner, store]))?.name ?? store;
        const made = await tx.run('INSERT INTO shopping_trips (owner_id, store, day, estimate_cents, total_cents, saved_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [owner, name, day, mine.lines.length > 0 ? mine.estimate_cents : null, total, saved, stamp(clock())]);
        const tripId = made.lastId;
        if (input.photo) await tx.run('INSERT INTO trip_receipts (trip_id, owner_id, type, bytes, created_at) VALUES (?, ?, ?, ?, ?)', [tripId, owner, pictureType(input.photo)!, input.photo, stamp(clock())]);
        const kept = parts.length > 1 ? parts.filter((p) => p.cents > 0) : parts;
        let entries = 0;
        for (const p of kept) {
          if (p.project_id !== null) {
            const project = await tx.get<{ name: string }>('SELECT name FROM projects WHERE id = ? AND owner_id = ?', [p.project_id, owner]);
            if (!project) throw new Problem(404, "That project isn't here anymore. It may have been deleted.");
            await projects(db, owner, clock).spend(p.project_id, { label: `${name}: ${p.label ?? `${project.name} supplies`}`, cents: p.cents, day, trip: tripId }, tx);
          } else {
            if (p.category_id !== null && !(await tx.get(`SELECT 1 AS x FROM (${SEEN}) WHERE id = ?`, [owner, owner, p.category_id]))) throw new Problem(404, "That category isn't here anymore. It may have been deleted.");
            await tx.run('INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at, trip_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
              [owner, p.category_id, kept.length > 1 ? `${name}: ${p.label ?? 'Other'}` : `Groceries at ${name}`, p.cents, day, stamp(clock()), tripId]);
          }
          entries += 1;
        }
        const ids = mine.lines.map((l) => l.id);
        if (ids.length > 0) {
          const marks = ids.map(() => '?').join(',');
          await tx.run(`UPDATE prices SET store = ?, trip_id = ?, day = ? WHERE owner_id = ? AND grocery_id IN (${marks})`, [name, tripId, day, owner, ...ids]);
          await tx.run(`DELETE FROM grocery WHERE owner_id = ? AND id IN (${marks})`, [owner, ...ids]);
        }
        return { id: tripId, store: name, day, total_cents: total, estimate_cents: mine.lines.length > 0 ? mine.estimate_cents : null, saved_cents: saved, entries, got: ids.length, receipt: Boolean(input.photo) };
      });
    },
  };
}
export type TripTools = ReturnType<typeof trips>;
