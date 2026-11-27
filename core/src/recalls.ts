/**
 * Recall alerts for the cars a person keeps. An outside service, and so off until a person turns it on.
 *
 * It asks the U.S. National Highway Traffic Safety Administration (nhtsa.gov), which publishes safety recalls
 * and needs no account and no key. The one thing ever sent is a car's make, model and year, in the address of
 * the question. Never the VIN, never the name a person gave the car, never who they are.
 *
 * A thing counts as a car when its kind has fields named Make, Model and Year, and all three are filled in
 * with a plausible model year. Nothing is guessed from a thing's name: a car missing one of them is listed as
 * needing details instead, and nothing is asked about it.
 *
 * A make, model and year is not a VIN, so some recalls listed may not apply to the car itself. The pages say
 * so, and send people to NHTSA's own site for a certain answer.
 *
 * `fetcher` asks a web address for its answer; it is handed in because that differs by where Life Is runs.
 */
import type { Answer, Fetcher } from './connections.ts';
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { labelKey, stamp, type Clock } from './small.ts';

export const RECALL_SERVICE = {
  name: 'Recall alerts',
  site: 'https://www.nhtsa.gov',
  sends: 'The make, model and year of each car you have recorded (for example Subaru, Outback, 2019), and nothing else. No VIN, no name, no account, no key. It asks api.nhtsa.gov, the U.S. National Highway Traffic Safety Administration, once a week and when you press "Check now".',
};

/** Where NHTSA answers. A test or a stand-in can be pointed somewhere else by the server. */
export const NHTSA_API = 'https://api.nhtsa.gov';

const ON = 'recalls_on';
const CHECKED = 'recalls_checked_at';
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
/** Even when the person insists, a check this soon after another is only a double press. */
const MOMENT = 10_000;
const OLDEST_YEAR = 1950;

export type Vehicle = { item_id: number; name: string; make: string; model: string; year: number };
/** A thing of a car's kind that can't be checked yet, and what it lacks: "Make", "Model" or "Year". */
export type NeedsDetails = { item_id: number; name: string; missing: string[] };
export type Found = { vehicles: Vehicle[]; needs: NeedsDetails[] };

export type Recall = {
  id: number; item_id: number; campaign: string; component: string | null; summary: string | null; consequence: string | null;
  remedy: string | null; park_it: boolean; park_outside: boolean; over_the_air: boolean;
  /** The day NHTSA was told, as 2020-05-28. */
  reported_on: string | null; first_seen_at: string; dismissed_at: string | null;
};
export type Result = 'ok' | 'not_listed' | 'failed';
export type CheckedVehicle = Vehicle & { checked_at: string | null; result: Result | null; message: string | null; open: number; dismissed: number };
export type RecallStatus = {
  /** Whether this copy of Life Is can reach outside at all. */
  available: boolean;
  on: boolean;
  last_check: string | null;
  vehicles: CheckedVehicle[];
  needs_details: NeedsDetails[];
};
export type VehicleRecalls = CheckedVehicle & { recalls: Recall[] };
export type CheckReport = { asked: number; found: number; not_listed: number; failed: number };

export const NOT_LISTED = 'NHTSA has nothing under this make, model and year. That can mean no recalls, or that NHTSA spells it differently';

/** The model year in what was typed, when it is a plausible one: a whole number from 1950 to two years ahead. */
function modelYear(value: string | undefined, now: Date): number | null {
  const text = (value ?? '').trim();
  if (!/^\d{4}(\.0+)?$/.test(text)) return null;
  const year = Math.trunc(Number(text));
  return year >= OLDEST_YEAR && year <= now.getFullYear() + 2 ? year : null;
}

/**
 * One person's things that are cars, and are known well enough to ask about, and those of a car's kind that
 * lack something. Only the kind's own fields are read, never the name, and never the VIN.
 */
export async function vehiclesOf(db: Db, owner: number, clock: Clock = () => new Date()): Promise<Found> {
  const fields = await db.all<{ kind_id: number; id: number; name: string }>(
    `SELECT f.kind_id, f.id, f.name FROM kind_fields f JOIN kinds k ON k.id = f.kind_id WHERE k.owner_id = ?`, [owner]);
  const byKind = new Map<number, { make?: number; model?: number; year?: number }>();
  for (const f of fields) {
    const slot = labelKey(f.name);
    if (slot !== 'make' && slot !== 'model' && slot !== 'year') continue;
    byKind.set(f.kind_id, { ...byKind.get(f.kind_id), [slot]: f.id });
  }
  const carKinds = [...byKind].filter(([, f]) => f.make && f.model && f.year);
  const found: Found = { vehicles: [], needs: [] };
  const now = clock();
  for (const [kindId, f] of carKinds) {
    const things = await db.all<{ id: number; name: string }>('SELECT id, name FROM items WHERE owner_id = ? AND kind_id = ? AND gone_on IS NULL AND kind_id NOT IN (SELECT id FROM kinds WHERE guard IS NOT NULL) ORDER BY name COLLATE NOCASE, id', [owner, kindId]);
    for (const thing of things) {
      const values = await db.all<{ field_id: number; value: string }>('SELECT field_id, value FROM item_values WHERE item_id = ? AND field_id IN (?, ?, ?)', [thing.id, f.make!, f.model!, f.year!]);
      const of = (id: number) => values.find((v) => v.field_id === id)?.value;
      const make = (of(f.make!) ?? '').trim().replace(/\s+/g, ' ');
      const model = (of(f.model!) ?? '').trim().replace(/\s+/g, ' ');
      const year = modelYear(of(f.year!), now);
      const missing = [!make && 'Make', !model && 'Model', year === null && 'Year'].filter((m): m is string => Boolean(m));
      // Words longer than any make or model are something else typed in the wrong box: not sent.
      if (!missing.length && make.length <= 60 && model.length <= 60) found.vehicles.push({ item_id: thing.id, name: thing.name, make, model, year: year! });
      else found.needs.push({ item_id: thing.id, name: thing.name, missing: missing.length ? missing : [make.length > 60 ? 'Make' : 'Model'] });
    }
  }
  found.vehicles.sort((a, b) => a.name.localeCompare(b.name) || a.item_id - b.item_id);
  found.needs.sort((a, b) => a.name.localeCompare(b.name) || a.item_id - b.item_id);
  return found;
}

/** "28/05/2020", as NHTSA writes it, as 2020-05-28; null when it isn't a day. */
export function reportedDay(text: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The address NHTSA is asked: the make, model and year, and nothing else. */
export function recallAddress(base: string, v: { make: string; model: string; year: number }): string {
  return `${base.replace(/\/+$/, '')}/recalls/recallsByVehicle?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&modelYear=${v.year}`;
}

/** Whose turn it is for the weekly check: everyone with this turned on, never checked or last checked over a week ago. */
export async function recallsDue(db: Db, clock: Clock): Promise<number[]> {
  const now = clock().getTime();
  const rows = await db.all<{ user_id: number; checked: string | null }>(
    `SELECT s.user_id, (SELECT c.value FROM user_settings c WHERE c.user_id = s.user_id AND c.key = ?) AS checked
     FROM user_settings s WHERE s.key = ? AND s.value = '1' ORDER BY s.user_id`, [CHECKED, ON]);
  return rows.filter((r) => { const at = r.checked ? Date.parse(r.checked) : NaN; return !(now - at <= WEEK); }).map((r) => r.user_id);
}

type RecallRow = Omit<Recall, 'park_it' | 'park_outside' | 'over_the_air'> & { park_it: number; park_outside: number; over_the_air: number };
const RECALL_COLUMNS = 'id, item_id, campaign, component, summary, consequence, remedy, park_it, park_outside, over_the_air, reported_on, first_seen_at, dismissed_at';

export function recalls(db: Db, owner: number, clock: Clock = () => new Date(), fetcher?: Fetcher, base: string = NHTSA_API) {
  const setting = async (key: string) => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]))?.value ?? null;
  const isOn = async () => Boolean(fetcher) && (await setting(ON)) === '1';
  const text = (value: unknown, most = 6000) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, most) : null);
  const recall = (r: RecallRow): Recall => ({ ...r, park_it: r.park_it === 1, park_outside: r.park_outside === 1, over_the_air: r.over_the_air === 1 });

  async function counts(): Promise<Map<number, { open: number; dismissed: number }>> {
    const rows = await db.all<{ item_id: number; open: number; dismissed: number }>(
      `SELECT item_id, SUM(dismissed_at IS NULL) AS open, SUM(dismissed_at IS NOT NULL) AS dismissed FROM vehicle_recalls WHERE owner_id = ? GROUP BY item_id`, [owner]);
    return new Map(rows.map((r) => [r.item_id, { open: r.open, dismissed: r.dismissed }]));
  }
  async function checkedVehicles(): Promise<{ found: Found; list: CheckedVehicle[] }> {
    const found = await vehiclesOf(db, owner, clock);
    const kept = new Map((await db.all<{ item_id: number; checked_at: string; result: Result; message: string | null; looked_up: string }>(
      'SELECT item_id, checked_at, result, message, looked_up FROM recall_checks WHERE owner_id = ?', [owner])).map((r) => [r.item_id, r]));
    const tally = await counts();
    return {
      found,
      list: found.vehicles.map((v) => {
        const k = kept.get(v.item_id);
        // A result is for the make, model and year it was asked about: if those were changed, there isn't one yet.
        const current = k && k.looked_up === `${v.make}|${v.model}|${v.year}` ? k : undefined;
        const n = tally.get(v.item_id);
        return { ...v, checked_at: current?.checked_at ?? null, result: current?.result ?? null, message: current?.message ?? null, open: n?.open ?? 0, dismissed: n?.dismissed ?? 0 };
      }),
    };
  }

  async function status(): Promise<RecallStatus> {
    const { found, list } = await checkedVehicles();
    return { available: Boolean(fetcher), on: await isOn(), last_check: await setting(CHECKED), vehicles: list, needs_details: found.needs };
  }

  /** What NHTSA says of one car: its recalls, or that it isn't listed. Throws only when the answer can't be had. */
  async function ask(v: Vehicle): Promise<{ result: Result; message: string | null; recalls: Record<string, unknown>[] }> {
    let answer: Answer;
    try {
      answer = await fetcher!(recallAddress(base, v), { Accept: 'application/json', 'User-Agent': 'LifeIs/0.1 (self-hosted household app)' });
    } catch {
      return { result: 'failed', message: "NHTSA couldn't be reached just now", recalls: [] };
    }
    // NHTSA answers 400 for a make, model and year it has no table for, which is not the same as no recalls.
    if (answer.status === 400 || answer.status === 404) return { result: 'not_listed', message: NOT_LISTED, recalls: [] };
    if (answer.status !== 200) return { result: 'failed', message: "NHTSA couldn't answer just now. Try again in a moment.", recalls: [] };
    try {
      const data = await answer.json() as { results?: unknown };
      if (!data || typeof data !== 'object' || !Array.isArray(data.results)) throw new Error('not an answer');
      return { result: 'ok', message: null, recalls: data.results.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null) };
    } catch {
      return { result: 'failed', message: "NHTSA's answer couldn't be read", recalls: [] };
    }
  }

  async function keep(v: Vehicle, asked: Awaited<ReturnType<typeof ask>>, at: string): Promise<number> {
    const lookedUp = `${v.make}|${v.model}|${v.year}`;
    let stored = 0;
    if (asked.result === 'ok' || asked.result === 'not_listed') {
      // Recalls found for another make, model or year (the car was corrected since) don't belong to it now.
      await db.run('DELETE FROM vehicle_recalls WHERE owner_id = ? AND item_id = ? AND looked_up <> ?', [owner, v.item_id, lookedUp]);
    }
    for (const r of asked.recalls) {
      const campaign = text(r.NHTSACampaignNumber, 40);
      if (!campaign) continue;
      // Already kept: its words are brought up to date, and when it was first seen and whether it was dismissed stay as they were.
      await db.run(
        `INSERT INTO vehicle_recalls (owner_id, item_id, campaign, component, summary, consequence, remedy, park_it, park_outside, over_the_air, reported_on, looked_up, first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, item_id, campaign) DO UPDATE SET component = excluded.component, summary = excluded.summary, consequence = excluded.consequence,
           remedy = excluded.remedy, park_it = excluded.park_it, park_outside = excluded.park_outside, over_the_air = excluded.over_the_air,
           reported_on = excluded.reported_on, looked_up = excluded.looked_up`,
        [owner, v.item_id, campaign, text(r.Component, 300), text(r.Summary), text(r.Consequence), text(r.Remedy), r.parkIt === true ? 1 : 0, r.parkOutSide === true ? 1 : 0,
          r.overTheAirUpdate === true ? 1 : 0, reportedDay(r.ReportReceivedDate), lookedUp, at]);
      stored += 1;
    }
    await db.run(
      `INSERT INTO recall_checks (owner_id, item_id, looked_up, checked_at, result, message) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, item_id) DO UPDATE SET looked_up = excluded.looked_up, checked_at = excluded.checked_at, result = excluded.result, message = excluded.message`,
      [owner, v.item_id, lookedUp, at, asked.result, asked.message]);
    return stored;
  }

  /** Most serious first: do not drive, then park outside, then the most recently reported. */
  const bySeriousness = (a: Recall, b: Recall) =>
    Number(b.park_it) - Number(a.park_it) || Number(b.park_outside) - Number(a.park_outside) || (b.reported_on ?? '').localeCompare(a.reported_on ?? '') || a.id - b.id;

  async function forVehicles(list: CheckedVehicle[], withDismissed: boolean): Promise<VehicleRecalls[]> {
    const rows = (await db.all<RecallRow>(`SELECT ${RECALL_COLUMNS} FROM vehicle_recalls WHERE owner_id = ?`, [owner])).map(recall);
    return list.map((v) => ({
      ...v,
      recalls: rows.filter((r) => r.item_id === v.item_id && (withDismissed ? r.dismissed_at !== null : r.dismissed_at === null)).sort(bySeriousness),
    }));
  }

  async function one(id: number): Promise<Recall> {
    const row = await db.get<RecallRow>(`SELECT ${RECALL_COLUMNS} FROM vehicle_recalls WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, "That recall isn't here anymore. It may have been deleted.");
    return recall(row);
  }

  return {
    status,

    /** Turn recall alerts on or off. Off, nothing is ever asked. What was found is kept, but not shown. */
    async turn(wanted: boolean): Promise<RecallStatus> {
      if (wanted && !fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
      if (wanted) await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, '1') ON CONFLICT(user_id, key) DO UPDATE SET value = '1'`, [owner, ON]);
      else await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, ON]);
      return status();
    },

    /**
     * Asks NHTSA about each car that is known well enough, once each. Refused when a check was made in the last
     * hour, unless the person pressed the button (`force`); even then a second press within ten seconds is refused.
     * One car's trouble never stops the others.
     */
    async check(options: { force?: boolean } = {}): Promise<CheckReport & { status: RecallStatus }> {
      if (!fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
      if (!(await isOn())) throw new Problem(400, 'Recall alerts are turned off. Turn them on in Settings, under "Connections".');
      const last = await setting(CHECKED);
      const age = last ? clock().getTime() - Date.parse(last) : Infinity;
      if (age >= 0 && age < (options.force ? MOMENT : HOUR)) {
        throw new Problem(400, options.force ? 'Recalls were only just checked. Give it a moment.' : 'Recalls were checked less than an hour ago.');
      }
      const { vehicles } = await vehiclesOf(db, owner, clock);
      const at = stamp(clock());
      // Marked before asking, so a check that is interrupted is not run again straight away.
      await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, CHECKED, at]);
      const report: CheckReport = { asked: 0, found: 0, not_listed: 0, failed: 0 };
      for (const v of vehicles) {
        report.asked += 1;
        const asked = await ask(v);
        await keep(v, asked, at);
        if (asked.result === 'ok') report.found += 1; else if (asked.result === 'not_listed') report.not_listed += 1; else report.failed += 1;
      }
      return { ...report, status: await status() };
    },

    /** Open recalls for each car, most serious first; or, with `dismissed`, the ones put aside. Nothing when off. */
    async list(options: { dismissed?: boolean } = {}): Promise<{ on: boolean; vehicles: VehicleRecalls[]; needs_details: NeedsDetails[] }> {
      const { found, list } = await checkedVehicles();
      if (!(await isOn())) return { on: false, vehicles: [], needs_details: found.needs };
      return { on: true, vehicles: await forVehicles(list, Boolean(options.dismissed)), needs_details: found.needs };
    },

    /**
     * What a thing's page shows: whether it is a car, and (when alerts are on) its recalls. `needs` lists what
     * a car's kind asks for that is missing; the thing must be this person's own.
     */
    async forThing(itemId: number, options: { dismissed?: boolean } = {}): Promise<{
      available: boolean; on: boolean; is_vehicle: boolean; needs: string[] | null; vehicle: VehicleRecalls | null; dismissed_count: number; dismissed: Recall[];
    }> {
      if (!await db.get('SELECT 1 AS yes FROM items WHERE id = ? AND owner_id = ?', [itemId, owner])) throw new Problem(404, "That thing isn't here anymore. It may have been deleted.");
      const { found, list } = await checkedVehicles();
      const mine = list.find((v) => v.item_id === itemId) ?? null;
      const lacking = found.needs.find((n) => n.item_id === itemId) ?? null;
      const on = await isOn();
      const base = { available: Boolean(fetcher), on, is_vehicle: Boolean(mine || lacking), needs: lacking?.missing ?? null };
      if (!on || !mine) return { ...base, vehicle: null, dismissed_count: 0, dismissed: [] };
      const [open] = await forVehicles([mine], false);
      const [put] = await forVehicles([mine], true);
      return { ...base, vehicle: open!, dismissed_count: put!.recalls.length, dismissed: options.dismissed ? put!.recalls : [] };
    },

    /** Put a recall aside: it stays aside through later checks. */
    async dismiss(id: number): Promise<Recall> {
      await one(id);
      await db.run('UPDATE vehicle_recalls SET dismissed_at = COALESCE(dismissed_at, ?) WHERE id = ? AND owner_id = ?', [stamp(clock()), id, owner]);
      return one(id);
    },

    async restore(id: number): Promise<Recall> {
      await one(id);
      await db.run('UPDATE vehicle_recalls SET dismissed_at = NULL WHERE id = ? AND owner_id = ?', [id, owner]);
      return one(id);
    },
  };
}

export type Recalls = ReturnType<typeof recalls>;
