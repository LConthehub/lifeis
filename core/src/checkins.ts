/**
 * The daily check-in: ten seconds a day. Sleep (hours), water (glasses), energy (1 to 5) and one optional line, each of
 * them optional. One entry a day, and it can be changed.
 *
 * Private to the person it belongs to, like measures: every read and write goes through `owner_id = the viewer`, and
 * nothing else in Life Is reads this table (not search, the front page, reminders, the assistant, a voice key, or another
 * person's download). Life Is keeps what the person typed. It adds up nothing into a score, counts no streak, gives no
 * advice and says nothing good or bad about a day.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, stamp, todayOf, type Clock } from './small.ts';

/** How many days back the view goes: four weeks. */
export const CHECKIN_DAYS = 28;
export type Checkin = { id: number; day: string; sleep_hours: number | null; water: number | null; energy: number | null; line: string | null };
export type CheckinInput = { day?: string | null; sleep_hours?: number | null; water?: number | null; energy?: number | null; line?: string | null };

const COLUMNS = 'id, day, sleep_hours, water, energy, line';

export function checkins(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  return {
    /** The last four weeks of the viewer's own entries, newest first, and today's day. */
    async recent(days = CHECKIN_DAYS): Promise<{ today: string; days: number; entries: Checkin[] }> {
      const t = today();
      const entries = await db.all<Checkin>(`SELECT ${COLUMNS} FROM checkins WHERE owner_id = ? AND day > ? AND day <= ? ORDER BY day DESC`, [viewer, addDays(t, -days), addDays(t, 1)]);
      return { today: t, days, entries };
    },

    /** Keeps the entry for a day (today if none is given), replacing what was there. */
    async save(input: CheckinInput): Promise<Checkin> {
      const t = today();
      const day = input.day || t;
      dayNumber(day);
      if (day > addDays(t, 1)) throw new Problem(400, "A check-in can't be for a day that hasn't come yet");
      if (dayNumber(day) < dayNumber(t) - 3650) throw new Problem(400, 'Pick a day in the last ten years');
      const sleep = input.sleep_hours ?? null;
      if (sleep !== null && (typeof sleep !== 'number' || !Number.isFinite(sleep) || sleep < 0 || sleep > 24)) throw new Problem(400, 'Sleep is hours, from 0 to 24');
      const water = input.water ?? null;
      if (water !== null && (!Number.isInteger(water) || water < 0 || water > 99)) throw new Problem(400, 'Water is a whole number of glasses');
      const energy = input.energy ?? null;
      if (energy !== null && (!Number.isInteger(energy) || energy < 1 || energy > 5)) throw new Problem(400, 'Energy is a number from 1 to 5');
      const line = clean(input.line, 300);
      if (sleep === null && water === null && energy === null && !line) throw new Problem(400, 'Add at least one thing to keep: sleep, water, energy or a line');
      await db.run(`INSERT INTO checkins (owner_id, day, sleep_hours, water, energy, line, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, day) DO UPDATE SET sleep_hours = excluded.sleep_hours, water = excluded.water, energy = excluded.energy, line = excluded.line`,
      [viewer, day, sleep === null ? null : Math.round(sleep * 100) / 100, water, energy, line, stamp(clock())]);
      return (await db.get<Checkin>(`SELECT ${COLUMNS} FROM checkins WHERE owner_id = ? AND day = ?`, [viewer, day]))!;
    },

    /** Takes one day's entry away. */
    async remove(day: string): Promise<void> {
      dayNumber(day);
      const gone = await db.run('DELETE FROM checkins WHERE owner_id = ? AND day = ?', [viewer, day]);
      if (!gone.changes) throw new Problem(404, "That day's check-in isn't here anymore.");
    },
  };
}

export type Checkins = ReturnType<typeof checkins>;
