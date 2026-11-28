/**
 * Medicines: a private list for a person, for a child (a household member with no sign-in) or for a pet.
 *
 * Life Is only keeps what the person types and reminds them. It never gives advice, never checks a dose and never says
 * anything about a medicine. The name, the dose and when it is taken are the person's own words.
 *
 * Whose: the person who keeps a list (`owner_id`) sees it, and nobody else does, not even the person in charge of the
 * house, unless the keeper shares one medicine with chosen people (`medicine_shares`, the way a private thing is
 * shared in inventory.ts). A list kept for a child or a pet is the keeper's, and is seen by them and who they share with.
 * Someone a medicine is shared with can look, and cannot change it.
 *
 * Reminders are routine steps (routines.ts): a medicine is placed in a time of the person's own routine ("Morning") as a step
 * with `medicine_id`. Checking the step is taking the dose: it counts the number left down, and unchecking it counts it
 * back up. The step's own words stay the plain word "Medicine" in the database; the name is read here, only for the people
 * who may see the medicine. So search, a download of routines and the AI connection never meet a name.
 *
 * A reminder that includes a medicine says only "Morning routine: 1 step" and never the name, unless the person switched
 * names on for themselves (one switch, kept in `user_settings`). The same goes for the refill reminder: a week before the
 * doses would run out.
 *
 * Nothing here leaves the device.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { shown } from './displayName.ts';
import { Problem } from './problem.ts';
import { addDays, clean, labelKey, pictureType, stamp, todayOf, type Clock } from './small.ts';

export const MAX_MEDICINE_PHOTO = 8_000_000;
export const MAX_MEDICINES = 200;
/** The routine times a medicine can be put in with one tap when the person has none yet. */
export const QUICK_TIMES = ['Morning', 'Evening'] as const;
/** What a routine made for medicines is called. */
export const MEDICINE_ROUTINE = 'Medicines';
/** The step's own words in the database: a plain word, never the name. */
export const PLACEHOLDER = 'Medicine';
/** How many days before the doses would run out the reminder starts. */
export const REFILL_DAYS = 7;
const NAMES_KEY = 'medicines_show_names';

export type MedicineInput = {
  name: string;
  dose?: string | null;
  when_taken?: string | null;
  /** How many doses are left (a tablet, a drop, a spoonful: the person's own count). Null: not counting. */
  left?: number | null;
  /** How many of those one dose uses (1 to 99). */
  per_dose?: number | null;
  /** How many a refill adds, for the "Got a refill" button. */
  fill_size?: number | null;
  prescriber_name?: string | null; prescriber_phone?: string | null; pharmacy_name?: string | null; pharmacy_phone?: string | null;
  reason?: string | null; note?: string | null;
  /** Whose: one of the keeper's pets, or one of their household members. Neither: the keeper's own. */
  for_pet?: number | null;
  for_member?: number | null;
  /** The routine times (ids) it shows in. Left out: they stay as they are (a new medicine is in none). */
  times?: number[] | null;
  /** Times to make now in a routine called "Medicines" for this person: Morning and Evening. */
  make?: string[] | null;
};

export type Subject = { kind: 'me' | 'pet' | 'member'; id: number | null; name: string; times: { id: number; title: string }[] };
export type Dose = { day: string; at: string | null; by: string | null };
export type Medicine = {
  id: number; name: string; dose: string | null; when_taken: string | null;
  left: number | null; per_dose: number; fill_size: number | null;
  /** How many times a day it is a step in a routine (at least 1), which the run-out day is worked from. */
  per_day: number;
  /** About how many days the doses left will last, the day they run out, and whether that is within a week. */
  days_left: number | null; run_out_on: string | null; refill_soon: boolean;
  prescriber_name: string | null; prescriber_phone: string | null; pharmacy_name: string | null; pharmacy_phone: string | null;
  reason: string | null; note: string | null; photo: boolean;
  for_kind: Subject['kind']; for_id: number | null; for_name: string;
  mine: boolean;
  /** Who keeps it, when it is not the viewer. */
  keeper: string | null;
  /** The routine times it shows in. */
  times: { id: number; title: string }[];
  /** Whom it is shared with (user ids): only the keeper sees this. */
  people: number[];
  /** How many times it was taken today, and the latest doses taken. */
  taken_today: number;
  doses: Dose[];
};
export type MedicineList = {
  mine: Medicine[]; shared: Medicine[]; subjects: Subject[];
  /** The people a medicine can be shared with. */
  people: { id: number; name: string }[];
  show_names: boolean;
};

type Row = {
  id: number; owner_id: number; for_member: number | null; for_pet: number | null; name: string; dose: string | null; when_taken: string | null;
  left_count: number | null; per_dose: number; fill_size: number | null; prescriber_name: string | null; prescriber_phone: string | null;
  pharmacy_name: string | null; pharmacy_phone: string | null; reason: string | null; note: string | null; photo: number;
  keeper: string | null; pet_name: string | null; member_name: string | null;
};
const SELECT = `SELECT m.id, m.owner_id, m.for_member, m.for_pet, m.name, m.dose, m.when_taken, m.left_count, m.per_dose, m.fill_size, m.prescriber_name, m.prescriber_phone,
  m.pharmacy_name, m.pharmacy_phone, m.reason, m.note, m.photo_type IS NOT NULL AS photo, ${shown('k')} AS keeper, pt.name AS pet_name, hm.name AS member_name
  FROM medicines m JOIN users k ON k.id = m.owner_id LEFT JOIN pets pt ON pt.id = m.for_pet LEFT JOIN household_members hm ON hm.id = m.for_member`;
/** What a person may see: their own, and the ones shared with them. Needs the viewer twice. */
const SEEN = '(m.owner_id = ? OR EXISTS (SELECT 1 FROM medicine_shares x WHERE x.medicine_id = m.id AND x.user_id = ?))';

/** Whether this person has switched names on in their reminders. Off unless they did. */
export async function showsNames(q: Queries, user: number): Promise<boolean> {
  return (await q.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [user, NAMES_KEY]))?.value === '1';
}

/**
 * A step of a routine was checked (`1`) or unchecked (`-1`): the number left comes down by what a dose uses, or goes back.
 * Does nothing for a step that is not a medicine, or a medicine that is not being counted.
 */
export async function countDose(q: Queries, stepId: number, direction: 1 | -1): Promise<void> {
  const m = await q.get<{ id: number; left_count: number | null; per_dose: number }>(
    'SELECT m.id, m.left_count, m.per_dose FROM routine_steps s JOIN medicines m ON m.id = s.medicine_id WHERE s.id = ?', [stepId]);
  if (!m || m.left_count === null) return;
  const next = direction === 1 ? Math.max(0, m.left_count - m.per_dose) : m.left_count + m.per_dose;
  await q.run('UPDATE medicines SET left_count = ? WHERE id = ?', [next, m.id]);
}

const phoneOk = (text: string | null) => text === null || /^[0-9 ()+\-.,x#]{3,40}$/i.test(text);

/** Finds, or makes, a time of a routine of this keeper for a person, child or pet. A routine made here is a plain one with no clock times. */
async function ensureTime(q: Queries, owner: number, kind: Subject['kind'], subject: number | null, routineName: string, timeName: string, at: string): Promise<number> {
  const where = kind === 'pet' ? ['for_pet = ?', [subject]] : kind === 'member' ? ['for_member = ?', [subject]] : ['for_user = ? AND for_member IS NULL AND for_pet IS NULL', [owner]];
  let routine = (await q.get<{ id: number }>(`SELECT id FROM routines WHERE owner_id = ? AND kind = 'plain' AND ${where[0] as string} AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1`, [owner, ...(where[1] as Value[]), routineName]))?.id;
  if (routine === undefined) {
    const next = (await q.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM routines WHERE owner_id = ?', [owner]))?.n ?? -1;
    routine = (await q.run(
      'INSERT INTO routines (owner_id, name, kind, for_user, for_member, for_pet, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [owner, routineName, 'plain', kind === 'me' ? owner : null, kind === 'member' ? subject : null, kind === 'pet' ? subject : null, next + 1, at, at])).lastId;
  }
  const found = await q.get<{ id: number }>('SELECT id FROM routine_times WHERE routine_id = ? AND name = ? COLLATE NOCASE', [routine, timeName]);
  if (found) return found.id;
  const count = (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM routine_times WHERE routine_id = ?', [routine]))?.n ?? 0;
  if (count >= 6) throw new Problem(400, 'A routine holds 6 times at most');
  return (await q.run('INSERT INTO routine_times (routine_id, name, at_time, sort_order) VALUES (?, ?, ?, ?)', [routine, timeName, null, count])).lastId;
}

export type Restored = {
  name: string; dose: string | null; when_taken: string | null; left: number | null; per_dose: number; fill_size: number | null;
  prescriber_name: string | null; prescriber_phone: string | null; pharmacy_name: string | null; pharmacy_phone: string | null; reason: string | null; note: string | null;
  for_pet: number | null; for_member: number | null;
  /** The routine times it shows in, by the names a download carries. */
  places: { routine: string; time: string }[];
  /** The people it is shared with (user ids). */
  people: number[];
};

/**
 * Puts a medicine from a download back for its keeper, in the routines it was in (made again when they are not there) and shared
 * with the people given. Gives its id and the step of each place, so the doses taken can be put back too. The number left is
 * kept as the download had it: putting back the doses taken does not count it down again.
 */
export async function restoreMedicine(q: Queries, owner: number, r: Restored, at: string): Promise<{ id: number; steps: Map<string, number> }> {
  const next = (await q.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM medicines WHERE owner_id = ?', [owner]))?.n ?? -1;
  const made = await q.run(
    `INSERT INTO medicines (owner_id, for_member, for_pet, name, dose, when_taken, left_count, per_dose, fill_size, prescriber_name, prescriber_phone, pharmacy_name, pharmacy_phone, reason, note, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [owner, r.for_member, r.for_pet, r.name, r.dose, r.when_taken, r.left, r.per_dose, r.fill_size, r.prescriber_name, r.prescriber_phone, r.pharmacy_name, r.pharmacy_phone, r.reason, r.note, next + 1, at, at]);
  const kind: Subject['kind'] = r.for_pet !== null ? 'pet' : r.for_member !== null ? 'member' : 'me';
  const steps = new Map<string, number>();
  for (const p of r.places) {
    const time = await ensureTime(q, owner, kind, r.for_pet ?? r.for_member, p.routine, p.time, at);
    const have = await q.get<{ id: number }>('SELECT id FROM routine_steps WHERE time_id = ? AND medicine_id = ?', [time, made.lastId]);
    const top = (await q.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM routine_steps WHERE time_id = ?', [time]))?.n ?? -1;
    const step = have?.id ?? (await q.run("INSERT INTO routine_steps (time_id, words, rule, sort_order, medicine_id) VALUES (?, ?, 'daily', ?, ?)", [time, PLACEHOLDER, top + 1, made.lastId])).lastId;
    steps.set(`${labelKey(p.routine)}|${labelKey(p.time)}`, step);
  }
  for (const person of [...new Set(r.people)]) {
    if (person !== owner) await q.run('INSERT OR IGNORE INTO medicine_shares (medicine_id, user_id, created_at) VALUES (?, ?, ?)', [made.lastId, person, at]);
  }
  return { id: made.lastId, steps };
}

export function medicines(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);
  const NOT_HERE = "That medicine isn't here anymore. It may have been deleted.";

  async function seen(q: Queries, id: number): Promise<Row> {
    const row = await q.get<Row>(`${SELECT} WHERE m.id = ? AND ${SEEN}`, [id, viewer, viewer]);
    if (!row) throw new Problem(404, NOT_HERE);
    return row;
  }
  async function owned(q: Queries, id: number): Promise<Row> {
    const row = await q.get<Row>(`${SELECT} WHERE m.id = ? AND m.owner_id = ?`, [id, viewer]);
    if (!row) throw new Problem(404, NOT_HERE);
    return row;
  }

  /** The routine times a person's list could use: their own plain routines for this person, child or pet. */
  async function timesFor(q: Queries, kind: Subject['kind'], id: number | null): Promise<{ id: number; title: string }[]> {
    const clause = kind === 'pet' ? ['r.for_pet = ?', [id]] : kind === 'member' ? ['r.for_member = ?', [id]] : ['r.for_user = ? AND r.for_member IS NULL AND r.for_pet IS NULL', [viewer]];
    const rows = await q.all<{ id: number; routine: string; time: string }>(
      `SELECT t.id, r.name AS routine, t.name AS time FROM routine_times t JOIN routines r ON r.id = t.routine_id
       WHERE r.owner_id = ? AND r.kind = 'plain' AND ${clause[0] as string} ORDER BY r.sort_order, r.id, t.sort_order, t.id`, [viewer, ...(clause[1] as Value[])]);
    return rows.map((x) => ({ id: x.id, title: labelKey(x.routine) === labelKey(x.time) ? x.routine : `${x.routine}: ${x.time}` }));
  }

  async function build(q: Queries, r: Row): Promise<Medicine> {
    const mine = r.owner_id === viewer;
    const kind: Subject['kind'] = r.for_pet !== null ? 'pet' : r.for_member !== null ? 'member' : 'me';
    const steps = await q.all<{ id: number; time_id: number; routine: string; time: string }>(
      `SELECT s.id, t.id AS time_id, rt.name AS routine, t.name AS time FROM routine_steps s JOIN routine_times t ON t.id = s.time_id JOIN routines rt ON rt.id = t.routine_id
       WHERE s.medicine_id = ? ORDER BY rt.sort_order, rt.id, t.sort_order, t.id`, [r.id]);
    const perDay = Math.max(1, steps.length);
    const daysLeft = r.left_count === null ? null : Math.floor(r.left_count / (r.per_dose * perDay));
    const doses = (await q.all<{ day: string; ticked_at: string | null; by_name: string | null; by_user: number | null }>(
      `SELECT k.day, k.ticked_at, k.by_user, ${shown('bu')} AS by_name FROM routine_ticks k JOIN routine_steps s ON s.id = k.step_id LEFT JOIN users bu ON bu.id = k.by_user
       WHERE s.medicine_id = ? ORDER BY k.day DESC, k.ticked_at DESC, k.step_id DESC LIMIT 10`, [r.id]))
      .map((d) => ({ day: d.day, at: d.ticked_at, by: d.by_user === viewer ? 'you' : d.by_name }));
    const takenToday = (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM routine_ticks k JOIN routine_steps s ON s.id = k.step_id WHERE s.medicine_id = ? AND k.day = ?', [r.id, today()]))?.n ?? 0;
    return {
      id: r.id, name: r.name, dose: r.dose, when_taken: r.when_taken, left: r.left_count, per_dose: r.per_dose, fill_size: r.fill_size, per_day: perDay,
      days_left: daysLeft, run_out_on: daysLeft === null ? null : addDays(today(), daysLeft), refill_soon: daysLeft !== null && daysLeft <= REFILL_DAYS,
      prescriber_name: r.prescriber_name, prescriber_phone: r.prescriber_phone, pharmacy_name: r.pharmacy_name, pharmacy_phone: r.pharmacy_phone,
      reason: r.reason, note: r.note, photo: Boolean(r.photo),
      for_kind: kind, for_id: kind === 'pet' ? r.for_pet : kind === 'member' ? r.for_member : null,
      for_name: kind === 'pet' ? r.pet_name ?? 'Pet' : kind === 'member' ? r.member_name ?? 'Household' : mine ? 'You' : r.keeper ?? 'Someone',
      mine, keeper: mine ? null : r.keeper,
      times: steps.map((s) => ({ id: s.time_id, title: labelKey(s.routine) === labelKey(s.time) ? s.routine : `${s.routine}: ${s.time}` })),
      people: mine ? (await q.all<{ user_id: number }>('SELECT user_id FROM medicine_shares WHERE medicine_id = ? ORDER BY user_id', [r.id])).map((x) => x.user_id) : [],
      taken_today: takenToday, doses,
    };
  }

  /** Checks a number typed: whole, in a range, or null when left blank. */
  function whole(value: unknown, what: string, least: number, most: number): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (!(typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most)) throw new Problem(400, `${what} is a whole number from ${least} to ${most}`);
    return value;
  }

  /** The columns a medicine keeps, checked, in the order the SQL names them. */
  async function checked(q: Queries, input: MedicineInput, existing: Row | null) {
    const name = clean(input.name, 120);
    if (!name) throw new Problem(400, 'Type the name of the medicine');
    const unsaid = input.for_pet === undefined && input.for_member === undefined;
    const forPet = unsaid ? existing?.for_pet ?? null : input.for_pet ?? null;
    const forMember = unsaid ? existing?.for_member ?? null : input.for_member ?? null;
    if (forPet !== null && forMember !== null) throw new Problem(400, 'A list is for one person or one pet');
    if (forPet !== null && !(await q.get('SELECT 1 AS one FROM pets WHERE id = ? AND owner_id = ?', [forPet, viewer]))) throw new Problem(404, "That pet isn't yours");
    if (forMember !== null && !(await q.get('SELECT 1 AS one FROM household_members WHERE id = ? AND owner_id = ?', [forMember, viewer]))) throw new Problem(404, "That person isn't in your household");
    const phones = [clean(input.prescriber_phone, 40), clean(input.pharmacy_phone, 40)];
    if (!phones.every(phoneOk)) throw new Problem(400, 'A phone number is digits, with spaces, dashes or brackets');
    const perDose = whole(input.per_dose, 'How many one dose uses', 1, 99) ?? 1;
    return {
      forPet, forMember,
      values: [name, clean(input.dose, 200), clean(input.when_taken, 200), whole(input.left, 'How many are left', 0, 99999), perDose, whole(input.fill_size, 'A refill', 1, 99999),
        clean(input.prescriber_name, 120), phones[0]!, clean(input.pharmacy_name, 120), phones[1]!, clean(input.reason, 300), clean(input.note, 3000)] as Value[],
    };
  }

  /** Finds or makes the routine called "Medicines" for this person, child or pet, with a time of each name asked for. Gives the time ids. */
  async function makeTimes(q: Queries, kind: Subject['kind'], id: number | null, names: string[]): Promise<number[]> {
    const wanted = [...new Set(names.map((n) => clean(n, 40)).filter((n): n is string => n !== null))];
    const out: number[] = [];
    for (const name of wanted) out.push(await ensureTime(q, viewer, kind, id, MEDICINE_ROUTINE, name, now()));
    return out;
  }

  /** Makes the medicine a step in exactly these routine times (the ones that suit this person, child or pet). */
  async function place(q: Queries, id: number, kind: Subject['kind'], subject: number | null, wanted: number[]): Promise<void> {
    const allowed = new Set((await timesFor(q, kind, subject)).map((t) => t.id));
    const times = [...new Set(wanted)];
    const have = new Map((await q.all<{ id: number; time_id: number }>('SELECT id, time_id FROM routine_steps WHERE medicine_id = ?', [id])).map((s) => [s.time_id, s.id]));
    if (!times.every((t) => allowed.has(t) || have.has(t))) throw new Problem(404, "That time of day isn't one of this person's routines");
    for (const [time, step] of have) if (!times.includes(time)) await q.run('DELETE FROM routine_steps WHERE id = ?', [step]);
    for (const time of times) {
      if (have.has(time)) continue;
      const next = (await q.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM routine_steps WHERE time_id = ?', [time]))?.n ?? -1;
      await q.run("INSERT INTO routine_steps (time_id, words, rule, sort_order, medicine_id) VALUES (?, ?, 'daily', ?, ?)", [time, PLACEHOLDER, next + 1, id]);
    }
  }

  async function wholeOne(id: number): Promise<Medicine> {
    return build(db, await seen(db, id));
  }

  return {
    /** Everything the viewer may see: their own lists and what others shared with them, and who they could share with. */
    async list(): Promise<MedicineList> {
      const rows = await db.all<Row>(`${SELECT} WHERE ${SEEN} ORDER BY m.sort_order, m.name COLLATE NOCASE, m.id`, [viewer, viewer]);
      const all: Medicine[] = [];
      for (const r of rows) all.push(await build(db, r));
      const subjects: Subject[] = [{ kind: 'me', id: null, name: 'You', times: await timesFor(db, 'me', null) }];
      for (const p of await db.all<{ id: number; name: string }>('SELECT id, name FROM pets WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id', [viewer])) {
        subjects.push({ kind: 'pet', id: p.id, name: p.name, times: await timesFor(db, 'pet', p.id) });
      }
      for (const m of await db.all<{ id: number; name: string }>('SELECT id, name FROM household_members WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id', [viewer])) {
        subjects.push({ kind: 'member', id: m.id, name: m.name, times: await timesFor(db, 'member', m.id) });
      }
      return {
        mine: all.filter((m) => m.mine), shared: all.filter((m) => !m.mine), subjects,
        people: await db.all<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM users u WHERE u.id != ? ORDER BY name COLLATE NOCASE, u.id`, [viewer]),
        show_names: await showsNames(db, viewer),
      };
    },

    get: wholeOne,

    async create(input: MedicineInput): Promise<Medicine> {
      const id = await atomic(db, async (tx) => {
        if (((await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM medicines WHERE owner_id = ?', [viewer]))?.n ?? 0) >= MAX_MEDICINES) throw new Problem(400, `Life Is keeps ${MAX_MEDICINES} medicines at most`);
        const c = await checked(tx, input, null);
        const next = (await tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM medicines WHERE owner_id = ?', [viewer]))?.n ?? -1;
        const made = await tx.run(
          `INSERT INTO medicines (owner_id, for_member, for_pet, name, dose, when_taken, left_count, per_dose, fill_size, prescriber_name, prescriber_phone, pharmacy_name, pharmacy_phone, reason, note, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [viewer, c.forMember, c.forPet, ...c.values, next + 1, now(), now()]);
        const kind: Subject['kind'] = c.forPet !== null ? 'pet' : c.forMember !== null ? 'member' : 'me';
        const subject = c.forPet ?? c.forMember;
        const wanted = [...(input.times ?? []), ...(await makeTimes(tx, kind, subject, input.make ?? []))];
        if (wanted.length) await place(tx, made.lastId, kind, subject, wanted);
        return made.lastId;
      });
      return wholeOne(id);
    },

    /** Changes a medicine. Only its keeper. Times left out stay as they are. */
    async update(id: number, input: MedicineInput): Promise<Medicine> {
      await atomic(db, async (tx) => {
        const row = await owned(tx, id);
        const c = await checked(tx, input, row);
        await tx.run(
          `UPDATE medicines SET for_member = ?, for_pet = ?, name = ?, dose = ?, when_taken = ?, left_count = ?, per_dose = ?, fill_size = ?, prescriber_name = ?, prescriber_phone = ?, pharmacy_name = ?, pharmacy_phone = ?, reason = ?, note = ?, updated_at = ? WHERE id = ?`,
          [c.forMember, c.forPet, ...c.values, now(), id]);
        const kind: Subject['kind'] = c.forPet !== null ? 'pet' : c.forMember !== null ? 'member' : 'me';
        const subject = c.forPet ?? c.forMember;
        const subjectChanged = row.for_pet !== c.forPet || row.for_member !== c.forMember;
        const given = input.times ?? null;
        const makeNames = input.make ?? [];
        if (given !== null || makeNames.length > 0 || subjectChanged) {
          // Times left out stay as they are, unless the medicine moved to someone else, whose routines are not these.
          const kept = (await tx.all<{ time_id: number }>('SELECT time_id FROM routine_steps WHERE medicine_id = ?', [id])).map((s) => s.time_id);
          const wanted = [...(given ?? (subjectChanged ? [] : kept)), ...(await makeTimes(tx, kind, subject, makeNames))];
          await place(tx, id, kind, subject, wanted);
        }
      });
      return wholeOne(id);
    },

    /** Takes a medicine away, with its place in the routines and its doses. */
    async remove(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        await owned(tx, id);
        await tx.run('DELETE FROM routine_steps WHERE medicine_id = ?', [id]);
        await tx.run('DELETE FROM medicines WHERE id = ?', [id]);
      });
    },

    /** A refill was picked up: the number left goes up by `amount`, or by the size of a refill the person gave. */
    async refilled(id: number, amount?: number | null): Promise<Medicine> {
      const row = await owned(db, id);
      const add = amount ?? row.fill_size;
      if (add === null || add === undefined) throw new Problem(400, 'Say how many the refill holds');
      if (!(Number.isInteger(add) && add >= 1 && add <= 99999)) throw new Problem(400, 'A refill is a whole number, 1 or more');
      await db.run('UPDATE medicines SET left_count = ?, updated_at = ? WHERE id = ?', [(row.left_count ?? 0) + add, now(), id]);
      return wholeOne(id);
    },

    /** Share one medicine with exactly these people (an empty list: with nobody). Only its keeper. */
    async shareWith(id: number, people: number[]): Promise<{ people: number[] }> {
      return atomic(db, async (tx) => {
        await owned(tx, id);
        const wanted = [...new Set(people)];
        if (wanted.length > 50 || !wanted.every((p) => Number.isInteger(p) && p > 0)) throw new Problem(400, 'Pick people from the list');
        for (const person of wanted) {
          if (person === viewer || !(await tx.get('SELECT id FROM users WHERE id = ?', [person]))) throw new Problem(400, 'Pick people from the list');
        }
        await tx.run('DELETE FROM medicine_shares WHERE medicine_id = ?', [id]);
        for (const person of wanted) await tx.run('INSERT INTO medicine_shares (medicine_id, user_id, created_at) VALUES (?, ?, ?)', [id, person, now()]);
        return { people: wanted.sort((a, b) => a - b) };
      });
    },

    /** The one switch, the viewer's own: whether a reminder shows medicine names. Off until they turn it on. */
    async setShowNames(on: boolean): Promise<{ show_names: boolean }> {
      await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [viewer, NAMES_KEY, on ? '1' : '0']);
      return { show_names: on };
    },

    async setPhoto(id: number, bytes: Uint8Array): Promise<Medicine> {
      const type = pictureType(bytes);
      if (!type) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_MEDICINE_PHOTO) throw new Problem(400, 'That photo is too large to keep');
      await owned(db, id);
      await db.run('UPDATE medicines SET photo_type = ?, photo = ?, updated_at = ? WHERE id = ?', [type, bytes, now(), id]);
      return wholeOne(id);
    },

    async removePhoto(id: number): Promise<Medicine> {
      await owned(db, id);
      await db.run('UPDATE medicines SET photo_type = NULL, photo = NULL WHERE id = ?', [id]);
      return wholeOne(id);
    },

    /** The photo of the label, for its keeper and the people it is shared with. */
    async photo(id: number): Promise<{ type: string; bytes: Uint8Array } | null> {
      await seen(db, id);
      const found = await db.get<{ type: string | null; bytes: Uint8Array | null }>('SELECT photo_type AS type, photo AS bytes FROM medicines WHERE id = ?', [id]);
      return found?.type && found.bytes ? { type: found.type, bytes: found.bytes } : null;
    },

    /**
     * The refill reminder lines for the viewer's own medicines, for the morning digest: from a week before the doses would run out.
     * Without the switch for names, a line says only that a refill is coming and where to look.
     */
    async refillLines(): Promise<{ title: string; detail: string | null; link: string; urgent: boolean }[]> {
      const names = await showsNames(db, viewer);
      const soon: Medicine[] = [];
      for (const r of await db.all<Row>(`${SELECT} WHERE m.owner_id = ? AND m.left_count IS NOT NULL ORDER BY m.name COLLATE NOCASE, m.id`, [viewer])) {
        const m = await build(db, r);
        if (m.refill_soon) soon.push(m);
      }
      if (!soon.length) return [];
      const words = (m: Medicine) => (m.days_left === 0 ? 'runs out today' : m.days_left === 1 ? 'runs out tomorrow' : `about ${m.days_left} days left`);
      if (!names) {
        return [{ title: soon.length === 1 ? 'A refill is coming up' : `${soon.length} refills are coming up`, detail: 'Open Life Is to see which', link: '/medicines', urgent: soon.some((m) => (m.days_left ?? 9) <= 1) }];
      }
      return soon.map((m) => ({ title: `Refill: ${m.name}`, detail: `${m.for_kind === 'me' ? '' : `${m.for_name} · `}${words(m)}`, link: '/medicines', urgent: (m.days_left ?? 9) <= 1 }));
    },
  };
}

export type Medicines = ReturnType<typeof medicines>;
