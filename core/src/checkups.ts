/**
 * Checkups on your own schedule: the dentist, the eyes, bloodwork, the vet for a pet. A person lists them with a name, how
 * often (every so many weeks, months or years), the day of the last one, and a note and a cost if they like. Life Is works
 * out the next one and says what is overdue or coming soon. It gives no advice about when anyone should go.
 *
 * Private to the person they belong to, with no switch to share them and no way in for anyone else, the person in charge
 * included. Every read and write goes through `owner_id = the viewer`. Nothing else reads these tables: not search, the
 * front page, the assistant, a voice key or another person's download. The one exception is the person's own morning
 * reminder, which gets a plain line for a checkup coming due (`digestLines`), and is theirs alone.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, stamp, todayOf, type Clock } from './small.ts';
import { addInterval } from './upkeep.ts';

export const MAX_CHECKUPS = 100;
export const CHECKUP_UNITS = ['week', 'month', 'year'] as const;
export type CheckupUnit = (typeof CHECKUP_UNITS)[number];
export type CheckupState = 'unknown' | 'overdue' | 'due' | 'soon' | 'later';
export type Checkup = {
  id: number; name: string; every_n: number; every_unit: CheckupUnit; last_on: string | null; note: string | null; cost_cents: number | null;
  next_on: string | null; days_left: number | null; state: CheckupState;
};
export type CheckupInput = { name: string; every_n: number; every_unit: string; last_on?: string | null; note?: string | null; cost_cents?: number | null };

type Row = { id: number; name: string; every_n: number; every_unit: CheckupUnit; last_on: string | null; note: string | null; cost_cents: number | null };
const COLUMNS = 'id, name, every_n, every_unit, last_on, note, cost_cents';
/** "Coming soon" is the next 30 days. */
export const SOON_DAYS = 30;

export function checkupDue(row: Pick<Row, 'every_n' | 'every_unit' | 'last_on'>, today: string): Pick<Checkup, 'next_on' | 'days_left' | 'state'> {
  if (!row.last_on) return { next_on: null, days_left: null, state: 'unknown' };
  const next = addInterval(row.last_on, row.every_n, row.every_unit);
  const left = dayNumber(next) - dayNumber(today);
  return { next_on: next, days_left: left, state: left < 0 ? 'overdue' : left === 0 ? 'due' : left <= SOON_DAYS ? 'soon' : 'later' };
}

const wholeOk = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function checkups(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const shape = (r: Row): Checkup => ({ ...r, ...checkupDue(r, today()) });
  async function one(id: number): Promise<Row> {
    const row = await db.get<Row>(`SELECT ${COLUMNS} FROM checkups WHERE id = ? AND owner_id = ?`, [id, viewer]);
    if (!row) throw new Problem(404, "That checkup isn't here anymore. It may have been deleted.");
    return row;
  }
  function tidy(input: CheckupInput) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give the checkup a name');
    if (!wholeOk(input.every_n) || input.every_n < 1 || input.every_n > 999) throw new Problem(400, 'How often is a whole number, like every 6 months');
    if (!(CHECKUP_UNITS as readonly string[]).includes(input.every_unit)) throw new Problem(400, 'It comes round every so many weeks, months or years');
    const last = input.last_on ? dayOrNull(input.last_on) : null;
    if (last && last > addDays(today(), 1)) throw new Problem(400, "The last one can't be on a day that hasn't come yet");
    const cost = input.cost_cents ?? null;
    if (cost !== null && (!wholeOk(cost) || cost < 0 || cost > 100_000_000)) throw new Problem(400, 'A cost is in whole cents');
    return { name, every_n: input.every_n, every_unit: input.every_unit as CheckupUnit, last_on: last, note: clean(input.note, 1000), cost_cents: cost };
  }

  return {
    /** The viewer's own checkups: the ones needing them first, then by name. */
    async list(): Promise<Checkup[]> {
      const rows = await db.all<Row>(`SELECT ${COLUMNS} FROM checkups WHERE owner_id = ?`, [viewer]);
      const order: Record<CheckupState, number> = { overdue: 0, due: 1, soon: 2, later: 3, unknown: 4 };
      return rows.map(shape).sort((a, b) => order[a.state] - order[b.state] || (a.next_on ?? '').localeCompare(b.next_on ?? '') || a.name.localeCompare(b.name) || a.id - b.id);
    },

    async create(input: CheckupInput): Promise<Checkup> {
      const t = tidy(input);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM checkups WHERE owner_id = ?', [viewer]))?.n ?? 0;
      if (count >= MAX_CHECKUPS) throw new Problem(400, `Life Is keeps ${MAX_CHECKUPS} checkups at most`);
      const made = await db.run('INSERT INTO checkups (owner_id, name, every_n, every_unit, last_on, note, cost_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [viewer, t.name, t.every_n, t.every_unit, t.last_on, t.note, t.cost_cents, stamp(clock())]);
      return shape(await one(made.lastId));
    },

    async update(id: number, input: CheckupInput): Promise<Checkup> {
      await one(id);
      const t = tidy(input);
      await db.run('UPDATE checkups SET name = ?, every_n = ?, every_unit = ?, last_on = ?, note = ?, cost_cents = ? WHERE id = ? AND owner_id = ?',
        [t.name, t.every_n, t.every_unit, t.last_on, t.note, t.cost_cents, id, viewer]);
      return shape(await one(id));
    },

    /** Marks it done today (or on the day given): the last day moves, and so does the next. */
    async done(id: number, day?: string | null): Promise<Checkup> {
      await one(id);
      const on = dayOrNull(day) ?? today();
      if (on > addDays(today(), 1)) throw new Problem(400, "A checkup can't be done on a day that hasn't come yet");
      await db.run('UPDATE checkups SET last_on = ? WHERE id = ? AND owner_id = ?', [on, id, viewer]);
      return shape(await one(id));
    },

    async remove(id: number): Promise<void> {
      await one(id);
      await db.run('DELETE FROM checkups WHERE id = ? AND owner_id = ?', [id, viewer]);
    },

    /** The morning round's lines for the viewer: a checkup overdue, due today, or about to be (said a month, a week, a day ahead, and the day). */
    async digestLines(): Promise<{ title: string; detail: string; link: string; urgent: boolean }[]> {
      const out: { title: string; detail: string; link: string; urgent: boolean }[] = [];
      for (const c of await this.list()) {
        if (c.days_left === null) continue;
        const left = c.days_left;
        const said = left < 0 ? (-left) % 7 === 1 : [SOON_DAYS, 7, 1, 0].includes(left);
        if (!said) continue;
        const when = left < 0 ? `was due ${-left === 1 ? 'yesterday' : `${-left} days ago`}` : left === 0 ? 'due today' : left === 1 ? 'due tomorrow' : `due in ${left} days`;
        out.push({ title: `Checkup: ${c.name}`, detail: when, link: '/checkups', urgent: left <= 0 });
      }
      return out;
    },
  };
}

export type Checkups = ReturnType<typeof checkups>;
