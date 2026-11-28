/**
 * Savings pots: money set aside for something (the car, gifts, a trip) with no target needed.
 *
 * A pot holds a total made of dated lines: money put in, and money taken out (a line below zero). Life Is keeps the
 * score only; no money moves. A pot cannot go below nothing, and a closed pot takes no new lines until it is opened again.
 *
 * Private unless shared: a pot belongs to whoever made it and nobody else sees it unless its owner shares it with
 * people by name, the way a spending category is shared (money.ts). People it is shared with see it and can put in and
 * take out; only its owner can rename it, close it, remove it, or change who it is shared with.
 *
 * Money is whole cents.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { shown } from './displayName.ts';
import { fmt } from './goalFigures.ts';
import { Problem } from './problem.ts';
import { clean, dayOrNull, stamp, todayOf, type Clock } from './small.ts';

export type PotLine = { id: number; day: string; cents: number; note: string | null; by: string | null; mine: boolean };
export type Pot = {
  id: number; name: string; closed_on: string | null; balance: number;
  mine: boolean; owner: string; shared_with: { id: number; name: string }[];
  lines: PotLine[];
};
export type PotsView = { currency: string; pots: Pot[]; /** What is in all the open pots together. */ total: number; people: { id: number; name: string }[] };
export type PotInput = { name?: string | null; shared_with?: number[]; closed?: boolean };
export type LineInput = { day?: string | null; cents?: number | null; note?: string | null };

const MOST = 100_000_000_00;

export function pots(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const sign = async (q: Queries = db) => (await q.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'shopping_currency'", [viewer]))?.value ?? '$';

  async function seenPot(q: Queries, id: number): Promise<{ id: number; owner_id: number; name: string; closed_on: string | null }> {
    const row = await q.get<{ id: number; owner_id: number; name: string; closed_on: string | null }>(
      'SELECT p.id, p.owner_id, p.name, p.closed_on FROM money_pots p WHERE p.id = ? AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM money_pot_shares s WHERE s.pot_id = p.id AND s.user_id = ?))', [id, viewer, viewer]);
    if (!row) throw new Problem(404, "That pot isn't here anymore. It may have been deleted.");
    return row;
  }
  async function ownPot(q: Queries, id: number) {
    const row = await seenPot(q, id);
    if (row.owner_id !== viewer) throw new Problem(403, 'Only the person who made this pot can change it');
    return row;
  }
  const balanceOf = async (q: Queries, id: number) => (await q.get<{ n: number }>('SELECT COALESCE(SUM(cents), 0) AS n FROM money_pot_lines WHERE pot_id = ?', [id]))!.n;
  async function share(q: Queries, id: number, people: number[] | undefined) {
    if (people === undefined) return;
    await q.run('DELETE FROM money_pot_shares WHERE pot_id = ?', [id]);
    for (const user of new Set(people)) {
      if (user === viewer) continue;
      if (!(await q.get('SELECT id FROM users WHERE id = ?', [user]))) throw new Problem(400, "That person isn't in this Life Is");
      await q.run('INSERT INTO money_pot_shares (pot_id, user_id) VALUES (?, ?)', [id, user]);
    }
  }
  const nameOf = (name: string | null | undefined) => {
    const n = clean(name, 80);
    if (!n) throw new Problem(400, 'Give the pot a name');
    return n;
  };

  return {
    async list(): Promise<PotsView> {
      const rows = await db.all<{ id: number; name: string; closed_on: string | null; owner_id: number; owner: string }>(
        `SELECT p.id, p.name, p.closed_on, p.owner_id, ${shown('o')} AS owner FROM money_pots p JOIN users o ON o.id = p.owner_id
         WHERE p.owner_id = ? OR EXISTS (SELECT 1 FROM money_pot_shares s WHERE s.pot_id = p.id AND s.user_id = ?) ORDER BY p.closed_on IS NOT NULL, p.name COLLATE NOCASE, p.id`, [viewer, viewer]);
      const out: Pot[] = [];
      for (const r of rows) {
        const lines = await db.all<{ id: number; day: string; cents: number; note: string | null; user_id: number | null; by: string | null }>(
          `SELECT l.id, l.day, l.cents, l.note, l.user_id, ${shown('u')} AS by FROM money_pot_lines l LEFT JOIN users u ON u.id = l.user_id WHERE l.pot_id = ? ORDER BY l.day DESC, l.id DESC`, [r.id]);
        const shared = await db.all<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM money_pot_shares s JOIN users u ON u.id = s.user_id WHERE s.pot_id = ? ORDER BY u.username`, [r.id]);
        out.push({
          id: r.id, name: r.name, closed_on: r.closed_on, balance: lines.reduce((n, l) => n + l.cents, 0), mine: r.owner_id === viewer, owner: r.owner, shared_with: shared,
          lines: lines.map((l) => ({ id: l.id, day: l.day, cents: l.cents, note: l.note, by: l.by, mine: l.user_id === viewer })),
        });
      }
      const people = await db.all<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM users u WHERE u.id != ? ORDER BY u.username`, [viewer]);
      return { currency: await sign(), pots: out, total: out.filter((p) => p.closed_on === null).reduce((n, p) => n + p.balance, 0), people };
    },

    async create(input: PotInput): Promise<{ id: number }> {
      return atomic(db, async (tx) => {
        const made = await tx.run('INSERT INTO money_pots (owner_id, name, created_at) VALUES (?, ?, ?)', [viewer, nameOf(input.name), stamp(clock())]);
        await share(tx, made.lastId, input.shared_with);
        return { id: made.lastId };
      });
    },

    /** Rename it, change who it is shared with, close it (closed: true) or open it again (closed: false). */
    async update(id: number, input: PotInput): Promise<void> {
      await atomic(db, async (tx) => {
        await ownPot(tx, id);
        if (input.name !== undefined && input.name !== null) await tx.run('UPDATE money_pots SET name = ? WHERE id = ?', [nameOf(input.name), id]);
        if (input.closed !== undefined) await tx.run('UPDATE money_pots SET closed_on = ? WHERE id = ?', [input.closed ? today() : null, id]);
        await share(tx, id, input.shared_with);
      });
    },

    async remove(id: number): Promise<void> {
      await ownPot(db, id);
      await db.run('DELETE FROM money_pots WHERE id = ?', [id]);
    },

    /** Put money in (above zero) or take it out (below zero), with the day and a few words. */
    async addLine(id: number, input: LineInput): Promise<{ id: number }> {
      return atomic(db, async (tx) => {
        const pot = await seenPot(tx, id);
        if (pot.closed_on !== null) throw new Problem(409, `${pot.name} is closed. Open it again to put money in or take it out.`);
        const cents = input.cents ?? null;
        if (cents === null || !Number.isInteger(cents) || cents === 0 || Math.abs(cents) > MOST) throw new Problem(422, 'The amount should be money, more than nothing');
        const day = input.day ? dayOrNull(input.day) : today();
        if (!day) throw new Problem(422, "That isn't a day I can read");
        const have = await balanceOf(tx, id);
        if (have + cents < 0) throw new Problem(422, `There is only ${fmt(await sign(tx), have)} in ${pot.name}`);
        const made = await tx.run('INSERT INTO money_pot_lines (pot_id, user_id, day, cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, viewer, day, cents, clean(input.note, 300), stamp(clock())]);
        return { id: made.lastId };
      });
    },

    /** Take a line back out of the record: by whoever wrote it or the pot's owner, and only if the pot stays at or above nothing. */
    async removeLine(lineId: number): Promise<void> {
      await atomic(db, async (tx) => {
        const line = await tx.get<{ id: number; pot_id: number; user_id: number | null; cents: number }>('SELECT id, pot_id, user_id, cents FROM money_pot_lines WHERE id = ?', [lineId]);
        if (!line) throw new Problem(404, "That line isn't here anymore.");
        const pot = await seenPot(tx, line.pot_id);
        if (pot.owner_id !== viewer && line.user_id !== viewer) throw new Problem(403, 'Only the one who wrote this line, or the pot\'s owner, can remove it');
        if ((await balanceOf(tx, pot.id)) - line.cents < 0) throw new Problem(422, 'Taking that line out would leave less than nothing in the pot');
        await tx.run('DELETE FROM money_pot_lines WHERE id = ?', [lineId]);
      });
    },
  };
}
export type PotTools = ReturnType<typeof pots>;
