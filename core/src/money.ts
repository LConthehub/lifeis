/**
 * Life is spending: what was planned for the month, and what was spent.
 *
 * A category ("Groceries", "House", "Fun") has an amount for each month. Spending is written down as it
 * happens, in a category or in none. Each category then says what is left this month, and so does the month
 * as a whole. What was paid on a project is an entry too (tagged with the project, made when the cost is paid, and
 * changed only from the project), so it is counted once: the Projects line is drawn from those entries.
 * Spending tagged to a plan with a goal comes out of that goal, so the categories and the month leave it out (budget.ts).
 * A trip to a store (core/src/trips.ts) makes entries tagged with the trip, so a charge the bank brings in later
 * for the same store and amount, on a close day, is recognized as that trip and not counted again.
 *
 * Private unless shared: a category belongs to whoever made it and nobody else sees it, or anything in it,
 * unless its owner shares it with people by name. Those people see the category and its spending and can add
 * to it; only the owner can change its amount, its name, or who it is shared with. Spending in no category is
 * only ever its writer's. So a surprise stays a surprise: keep it in a category that isn't shared.
 *
 * Money is whole cents. Nothing here knows about income, bills or savings; this is spending against a plan.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { shown } from './displayName.ts';
import { goalEntryIds } from './goalFigures.ts';
import { Problem } from './problem.ts';
import { attachTags, onlyTagged, unlink, type TagRef } from './tags.ts';
import { addDays, clean, dayNumber, dayOrNull, labelKey, stamp, todayOf, type Clock } from './small.ts';

export type Person = { id: number; username: string; name: string };
export type Category = {
  id: number;
  name: string;
  monthly_cents: number;
  /** Spent in it this month, by everyone it is shared with. */
  spent: number;
  left: number;
  /** Whether it is yours (you can change it) or shared with you. */
  mine: boolean;
  owner: string;
  shared_with: Person[];
};
export type Entry = {
  id: number;
  label: string;
  cents: number;
  day: string;
  note: string | null;
  category_id: number | null;
  category: string | null;
  /** Who wrote it down. */
  by: string;
  mine: boolean;
  tag_list: TagRef[];
  /** The grocery trip it was written from, when its receipt has a photo; the photo is at /api/shopping/trips/:id/receipt. */
  receipt_trip: number | null;
};
export type ProjectSpend = { project_id: number; project: string; label: string; cents: number; day: string };
/** A cost on a project that is planned and not yet paid, with the month it is due (the project's day), if it has one. */
export type ComingCost = { project_id: number; project: string; label: string; cents: number; month: string | null };
export type Month = {
  month: string;
  currency: string;
  categories: Category[];
  /** Your spending in no category. */
  uncategorised: number;
  /** What you paid on projects this month: the entries tagged with a project. */
  projects: { spent: number; lines: ProjectSpend[] };
  /** What is planned on projects and not yet paid, for projects due this month. Not counted in the totals. */
  coming: { cents: number; lines: ComingCost[] };
  total: { planned: number; spent: number; left: number };
  entries: Entry[];
  /** Other people in this Life Is a category could be shared with. Empty when there is nobody else. */
  people: Person[];
};
export type CategoryInput = { name?: string | null; monthly_cents?: number | null; shared_with?: number[] };
export type EntryInput = { label?: string | null; cents?: number | null; day?: string | null; note?: string | null; category_id?: number | null };

/** One line of a bank's statement on its way in. `category_id` left out means "the one an earlier entry with this label used". */
export type StatementItem = {
  label: string; cents: number; day: string; keep: boolean; category_id?: number | null;
  /** Set when a bank's own service (SimpleFIN) sent it: its account and transaction, kept on the entry so it is never brought in twice. */
  bank?: { account: string; txn: string };
};
export type StatementMark = { already: boolean; suggested: number | null; /** The trip to a store this line is the bank's record of, when it is. */ trip: number | null };
export type StatementBrought = { added: number; already: number; left_out: number; months: { month: string; added: number }[] };

/** How many days apart a bank's date and the day of a trip can be, and still be the same purchase. */
const CLOSE_DAYS = 5;
const squash = (text: string) => labelKey(text).replace(/[^\p{L}\p{N}]+/gu, '');
/** Whether a bank's words for a charge name this store: the store's name, or its first word (when long enough), is in them. */
function names(label: string, store: string): boolean {
  const said = squash(label);
  const whole = squash(store);
  const first = squash(labelKey(store).split(/[^\p{L}\p{N}]+/u)[0] ?? '');
  return whole.length > 0 && (said.includes(whole) || (first.length >= 3 && said.includes(first)));
}

const MOST = 100_000_000_00;
function cents(value: number | null | undefined, what: string): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0 || value > MOST) throw new Problem(422, `${what} should be an amount of money, not below zero`);
  return Math.round(value);
}

export function money(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  /** The categories this person can see: their own, and those shared with them. */
  // Plain `?` marks only: each use of SEEN takes the person twice (`seen`), in the order the marks appear.
  const SEEN = `SELECT c.id FROM money_categories c WHERE c.owner_id = ? OR EXISTS (SELECT 1 FROM money_shares s WHERE s.category_id = c.id AND s.user_id = ?)`;
  const seen = [owner, owner];

  async function seenCategory(q: Queries, id: number): Promise<{ id: number; owner_id: number }> {
    const row = await q.get<{ id: number; owner_id: number }>(
      `SELECT c.id, c.owner_id FROM money_categories c WHERE c.id = ? AND (c.owner_id = ? OR EXISTS (SELECT 1 FROM money_shares s WHERE s.category_id = c.id AND s.user_id = ?))`, [id, owner, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }
  async function ownCategory(q: Queries, id: number) {
    const row = await seenCategory(q, id);
    if (row.owner_id !== owner) throw new Problem(403, 'Only the person who made this category can change it');
    return row;
  }
  async function share(q: Queries, id: number, people: number[] | undefined) {
    if (people === undefined) return;
    await q.run('DELETE FROM money_shares WHERE category_id = ?', [id]);
    for (const person of new Set(people)) {
      if (person === owner) continue;
      if (!(await q.get('SELECT 1 AS x FROM users WHERE id = ?', [person]))) throw new Problem(400, "One of those people isn't in this Life Is");
      await q.run('INSERT INTO money_shares (category_id, user_id) VALUES (?, ?)', [id, person]);
    }
  }
  /** An entry this person may change: their own, or any in a category they own. */
  async function changeable(q: Queries, id: number) {
    const row = await q.get<{ id: number }>(
      `SELECT e.id FROM money_entries e LEFT JOIN money_categories c ON c.id = e.category_id WHERE e.id = ? AND (e.owner_id = ? OR c.owner_id = ?)`, [id, owner, owner]);
    if (!row) throw new Problem(404, 'Not found');
    if (await q.get('SELECT 1 AS x FROM money_entries WHERE id = ? AND project_id IS NOT NULL', [id])) throw new Problem(409, 'That is a cost on a project. Change it on the project.');
  }
  async function checkedEntry(q: Queries, input: EntryInput) {
    const label = clean(input.label, 200);
    if (!label) throw new Problem(400, 'Say what it was spent on');
    const category = input.category_id ?? null;
    if (category !== null) await seenCategory(q, category);
    return { label, cents: cents(input.cents, 'The amount'), day: dayOrNull(input.day) ?? todayOf(clock), note: clean(input.note, 1000), category };
  }

  /**
   * For each line of a statement: whether an entry like it is already written down (same day, same amount, same
   * label as names are compared), and the category an earlier entry with that label was in. Only entries this
   * person can see are looked at. Two identical lines in one statement are two purchases, so each existing
   * entry accounts for one line, the first in the file, and no more.
   */
  async function marked(q: Queries, items: { label: string; cents: number; day: string }[], fromBank = false): Promise<StatementMark[]> {
    if (items.length === 0) return [];
    const days = items.map((i) => i.day).sort();
    const key = (label: string, cents: number, day: string) => `${day}|${cents}|${labelKey(label)}`;
    const have = new Map<string, number>();
    for (const e of await q.all<{ label: string; cents: number; day: string }>(
      // What came from the bank's own service has its own id to be told apart by, so two like purchases from it stay two.
      `SELECT e.label, e.cents, e.day FROM money_entries e WHERE e.day BETWEEN ? AND ? AND (e.owner_id = ? OR e.category_id IN (${SEEN}))${fromBank ? ' AND e.bank_txn IS NULL' : ''}`,
      [days[0]!, days[days.length - 1]!, owner, ...seen])) have.set(key(e.label, e.cents, e.day), (have.get(key(e.label, e.cents, e.day)) ?? 0) + 1);
    // A trip to a store: the same amount as the receipt total, a close day, and the bank's words name the store. Each trip is one line.
    const trips = await q.all<{ id: number; store: string; day: string; total_cents: number }>(
      `SELECT t.id, t.store, t.day, t.total_cents FROM shopping_trips t WHERE t.owner_id = ? AND t.matched = 0 AND t.day BETWEEN ? AND ?
       AND EXISTS (SELECT 1 FROM money_entries e WHERE e.trip_id = t.id) ORDER BY t.day, t.id`, [owner, addDays(days[0]!, -CLOSE_DAYS), addDays(days[days.length - 1]!, CLOSE_DAYS)]);
    const taken = new Set<number>();
    const earlier = new Map<string, number>();
    for (const e of await q.all<{ label: string; category_id: number }>(
      `SELECT e.label, e.category_id FROM money_entries e WHERE e.category_id IN (${SEEN}) ORDER BY e.day DESC, e.id DESC LIMIT 20000`, seen)) {
      if (!earlier.has(labelKey(e.label))) earlier.set(labelKey(e.label), e.category_id);
    }
    return items.map((item) => {
      const label = clean(item.label, 200) ?? '';
      const k = key(label, item.cents, item.day);
      const n = have.get(k) ?? 0;
      if (n > 0) have.set(k, n - 1);
      const trip = n > 0 ? undefined : trips.find((t) => !taken.has(t.id) && t.total_cents === item.cents && Math.abs(dayNumber(t.day) - dayNumber(item.day)) <= CLOSE_DAYS && names(label, t.store));
      if (trip) taken.add(trip.id);
      return { already: n > 0 || trip !== undefined, suggested: earlier.get(labelKey(label)) ?? null, trip: trip?.id ?? null };
    });
  }

  return {
    /** What a statement's lines would do, before anything is written. See bankStatement.ts. */
    lookOver(items: { label: string; cents: number; day: string }[]): Promise<StatementMark[]> {
      return marked(db, items);
    },

    /**
     * Write down the lines of a statement that are kept, each in its own day's month. A line already written
     * down is skipped. Each goes through the same checks as addEntry, so a category that isn't yours to use refuses the whole
     * statement, and nothing is written. One change: all of it or none.
     */
    async bringIn(items: StatementItem[]): Promise<StatementBrought> {
      return atomic(db, async (tx) => {
        const fromBank = items.some((i) => i.bank);
        const marks = await marked(tx, items, fromBank);
        const result: StatementBrought = { added: 0, already: 0, left_out: 0, months: [] };
        const months = new Map<string, number>();
        for (const [i, item] of items.entries()) {
          if (item.bank && await tx.get('SELECT 1 AS x FROM money_entries WHERE owner_id = ? AND bank_account = ? AND bank_txn = ?', [owner, item.bank.account, item.bank.txn])) { result.already += 1; continue; }
          if (marks[i]!.already) {
            result.already += 1;
            // The charge is a trip already written down: the trip is tied to the bank's line, so it is never brought in or matched twice.
            if (marks[i]!.trip !== null) {
              await tx.run('UPDATE shopping_trips SET matched = 1, bank_account = ?, bank_txn = ? WHERE id = ?', [item.bank?.account ?? null, item.bank?.txn ?? null, marks[i]!.trip]);
              if (item.bank) await tx.run('UPDATE money_entries SET bank_account = ?, bank_txn = ? WHERE id = (SELECT MIN(id) FROM money_entries WHERE trip_id = ? AND bank_txn IS NULL)', [item.bank.account, item.bank.txn, marks[i]!.trip]);
            }
            continue;
          }
          if (!item.keep) { result.left_out += 1; continue; }
          const e = await checkedEntry(tx, { label: item.label, cents: item.cents, day: item.day, category_id: item.category_id === undefined ? marks[i]!.suggested : item.category_id });
          await tx.run('INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at, bank_account, bank_txn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [owner, e.category, e.label, e.cents, e.day, e.note, now(), item.bank?.account ?? null, item.bank?.txn ?? null]);
          result.added += 1;
          months.set(e.day.slice(0, 7), (months.get(e.day.slice(0, 7)) ?? 0) + 1);
        }
        result.months = [...months].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, added]) => ({ month, added }));
        return result;
      });
    },

    /** A month ("2046-03"; this month when left out): every category you can see, and what was spent. */
    async month(given?: string | null, tag?: number | null): Promise<Month> {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(given ?? '') ? given! : todayOf(clock).slice(0, 7);
      const within = [`${month}-01`, `${month}-31`];
      const sign = await db.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'shopping_currency'", [owner]);
      const goalIds = await goalEntryIds(db, owner);
      const rows = await db.all<{ id: number; name: string; monthly_cents: number; owner_id: number; owner: string; spent: number }>(
        `SELECT c.id, c.name, c.monthly_cents, c.owner_id, ${shown('u')} AS owner,
                COALESCE((SELECT SUM(e.cents) FROM money_entries e WHERE e.category_id = c.id AND e.day BETWEEN ? AND ?${goalIds.size > 0 ? ` AND e.id NOT IN (${[...goalIds].map(() => '?').join(',')})` : ''}), 0) AS spent
         FROM money_categories c JOIN users u ON u.id = c.owner_id WHERE c.id IN (${SEEN}) ORDER BY c.sort_order, c.id`, [...within, ...goalIds, ...seen]);
      const shares = await db.all<{ category_id: number; id: number; username: string; name: string }>(
        `SELECT s.category_id, u.id, u.username, ${shown('u')} AS name FROM money_shares s JOIN users u ON u.id = s.user_id WHERE s.category_id IN (${SEEN}) ORDER BY u.username`, seen);
      const categories = rows.map((c): Category => ({
        id: c.id, name: c.name, monthly_cents: c.monthly_cents, spent: c.spent, left: c.monthly_cents - c.spent, mine: c.owner_id === owner, owner: c.owner,
        shared_with: shares.filter((s) => s.category_id === c.id).map((s) => ({ id: s.id, username: s.username, name: s.name })),
      }));
      const entries = await db.all<Omit<Entry, 'mine' | 'tag_list'> & { owner_id: number }>(
        `SELECT e.id, e.label, e.cents, e.day, e.note, e.category_id, c.name AS category, ${shown('u')} AS by, e.owner_id, (SELECT r.trip_id FROM trip_receipts r WHERE r.trip_id = e.trip_id) AS receipt_trip
         FROM money_entries e LEFT JOIN money_categories c ON c.id = e.category_id JOIN users u ON u.id = e.owner_id
         WHERE e.day BETWEEN ? AND ? AND e.project_id IS NULL AND ((e.category_id IS NULL AND e.owner_id = ?) OR e.category_id IN (${SEEN}))
         ORDER BY e.day DESC, e.id DESC`, [...within, owner, ...seen]);
      const lines = await db.all<ProjectSpend>(
        `SELECT p.id AS project_id, p.name AS project, e.label, e.cents, e.day
         FROM money_entries e JOIN projects p ON p.id = e.project_id
         WHERE e.owner_id = ? AND e.day BETWEEN ? AND ? ORDER BY e.day DESC, e.id DESC`, [owner, ...within]);
      // Planned and not paid yet, on projects still going: shown in the month the project is due, or, with no day, in this month.
      const thisMonth = todayOf(clock).slice(0, 7);
      const coming = (await db.all<{ project_id: number; project: string; label: string; cents: number; due_on: string | null }>(
        `SELECT p.id AS project_id, p.name AS project, k.label, k.planned_cents AS cents, p.due_on FROM project_costs k JOIN projects p ON p.id = k.project_id
         WHERE p.owner_id = ? AND k.paid_on IS NULL AND k.planned_cents > 0 AND p.status NOT IN ('done', 'dropped')
         ORDER BY COALESCE(p.due_on, '9999'), p.id, k.sort_order, k.id`, [owner]))
        .map((c): ComingCost => ({ project_id: c.project_id, project: c.project, label: c.label, cents: c.cents, month: c.due_on ? c.due_on.slice(0, 7) : null }))
        .filter((c) => month >= thisMonth && (c.month ?? thisMonth) === month);
      const uncategorised = entries.filter((e) => e.category_id === null && !goalIds.has(e.id)).reduce((sum, e) => sum + e.cents, 0);
      const onProjects = lines.reduce((sum, l) => sum + l.cents, 0);
      const planned = categories.reduce((sum, c) => sum + c.monthly_cents, 0);
      const spent = categories.reduce((sum, c) => sum + c.spent, 0) + uncategorised + onProjects;
      return {
        month, currency: sign?.value ?? '$', categories, uncategorised, projects: { spent: onProjects, lines },
        coming: { cents: coming.reduce((sum, c) => sum + c.cents, 0), lines: coming },
        total: { planned, spent, left: planned - spent },
        entries: (await attachTags(db, owner, 'spending', await onlyTagged(db, owner, 'spending', entries, tag))).map(({ owner_id, ...e }) => ({ ...e, mine: owner_id === owner })),
        people: await db.all<Person>(`SELECT u.id, u.username, ${shown('u')} AS name FROM users u WHERE u.id != ? ORDER BY u.username`, [owner]),
      };
    },

    async addCategory(input: CategoryInput): Promise<{ id: number }> {
      const name = clean(input.name, 80);
      if (!name) throw new Problem(400, 'Give the category a name');
      return atomic(db, async (tx) => {
        const next = (await tx.get<{ n: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM money_categories WHERE owner_id = ?', [owner]))!.n;
        const made = await tx.run('INSERT INTO money_categories (owner_id, name, monthly_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
          [owner, name, cents(input.monthly_cents ?? 0, 'The amount for the month'), next, now()]);
        await share(tx, made.lastId, input.shared_with);
        return { id: made.lastId };
      });
    },

    /** Change a category's name, its amount, or who it is shared with. Only its owner can. */
    async updateCategory(id: number, input: CategoryInput): Promise<void> {
      await atomic(db, async (tx) => {
        await ownCategory(tx, id);
        const name = clean(input.name, 80);
        if (name) await tx.run('UPDATE money_categories SET name = ? WHERE id = ?', [name, id]);
        if (input.monthly_cents !== undefined) await tx.run('UPDATE money_categories SET monthly_cents = ? WHERE id = ?', [cents(input.monthly_cents, 'The amount for the month'), id]);
        await share(tx, id, input.shared_with);
      });
    },

    /** Remove a category. What was spent in it is kept, in no category, and goes back to being only its writer's. */
    async removeCategory(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        await ownCategory(tx, id);
        await tx.run('UPDATE money_entries SET category_id = NULL WHERE category_id = ?', [id]);
        await tx.run('DELETE FROM money_categories WHERE id = ?', [id]);
      });
    },

    async addEntry(input: EntryInput): Promise<{ id: number }> {
      return atomic(db, async (tx) => {
        const e = await checkedEntry(tx, input);
        const made = await tx.run('INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [owner, e.category, e.label, e.cents, e.day, e.note, now()]);
        return { id: made.lastId };
      });
    },

    async updateEntry(id: number, input: EntryInput): Promise<void> {
      await atomic(db, async (tx) => {
        await changeable(tx, id);
        const e = await checkedEntry(tx, input);
        await tx.run('UPDATE money_entries SET category_id = ?, label = ?, cents = ?, day = ?, note = ? WHERE id = ?', [e.category, e.label, e.cents, e.day, e.note, id]);
      });
    },

    async removeEntry(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        await changeable(tx, id);
        const trip = (await tx.get<{ trip_id: number | null }>('SELECT trip_id FROM money_entries WHERE id = ?', [id]))?.trip_id ?? null;
        await tx.run('DELETE FROM money_entries WHERE id = ?', [id]);
        await unlink(tx, 'spending', id);
        // The last entry of a trip gone, the trip is gone too, and a charge for it would be new again.
        if (trip !== null && !(await tx.get('SELECT 1 AS x FROM money_entries WHERE trip_id = ?', [trip]))) { await tx.run('DELETE FROM trip_receipts WHERE trip_id = ?', [trip]); await tx.run('DELETE FROM shopping_trips WHERE id = ?', [trip]); }
      });
    },
  };
}
