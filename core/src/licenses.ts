/**
 * Licenses and permits: a driver's license, a passport, a nursing license, a fishing license, a pet's tag.
 * What it is, whose it is, its number, who issued it, when, and when it runs out.
 *
 * A license can be tied to a renewal in upkeep (upkeep.ts, kind 'renewal'), so the reminder, the morning
 * digest and the calendar all work the way they do for any other renewal. The renewal is first due a lead
 * time before the license runs out, and follows the license if its expiry day is changed. The two are kept
 * apart on purpose: removing the renewal in Upkeep leaves the license (the database clears the link), and
 * marking the renewal done does not change the license. The license says "Renewed? Update the new expiry day"
 * until its expiry day is moved forward.
 *
 * The license number is kept as a plain column like a serial number or a microchip number (the database
 * itself is what is encrypted). It is only ever returned by `get` (to show it or to change it); the list says
 * only whether there is one. It is never copied into the renewal, its notes, search results, the calendar
 * or the morning reminder, which only ever see the license's name and holder.
 *
 * `licenses(db, owner)` is one person's licenses: everything it reads and writes is theirs.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, stamp, todayOf, type Clock } from './small.ts';
import { addInterval, upkeep, type DueState, type Job } from './upkeep.ts';

export const LICENSE_CATEGORIES = ['Driving', 'Travel', 'Work', 'Outdoors', 'Pets', 'Vehicle', 'Other'] as const;
export type LicenseCategory = (typeof LICENSE_CATEGORIES)[number];
/** "Soon" is this many days or fewer before it runs out. */
export const SOON_DAYS = 60;
export const LEAD_UNITS = ['day', 'week', 'month'] as const;
export type LeadUnit = (typeof LEAD_UNITS)[number];
export type Lead = { n: number; unit: LeadUnit };

export type LicenseInput = {
  name: string;
  category?: string | null;
  holder?: string | null;
  number?: string | null;
  issuer?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  note?: string | null;
};
export type RemindInput = {
  /** How long before it runs out the renewal is first due: 30 days, 6 months. Left out: what it had, or the usual for its category. */
  lead_n?: number | null;
  lead_unit?: string | null;
  /** The years a renewed license lasts, so the renewal comes round again. Left out: what it had, else a one-time reminder. null: one-time. */
  term_years?: number | null;
};

export type LicenseReminder = {
  job_id: number;
  lead: Lead;
  /** Years between renewals, or null for a one-time reminder. */
  term_years: number | null;
  /** The day the renewal is due now (null once a one-time one has been done), and how it stands. */
  due_on: string | null;
  state: DueState;
  /** The renewal was marked done, and the license's expiry day has not been moved forward since. */
  renewed: boolean;
};
export type License = {
  id: number; name: string; category: string | null; holder: string | null; has_number: boolean; issuer: string | null;
  issued_on: string | null; expires_on: string | null; note: string | null;
  /** Days until it runs out; below 0, it has. Null with no expiry day. */
  days_left: number | null;
  state: 'expired' | 'soon' | 'later' | 'none';
  reminder: LicenseReminder | null;
};
/** The one place a number is returned. */
export type LicenseFull = License & { number: string | null };

/** The usual lead for a category, and why. Travel papers: many countries want months of validity left, and renewing takes weeks. */
export function defaultLead(category: string | null): Lead & { why: string | null } {
  if (category === 'Travel') {
    return { n: 6, unit: 'month', why: 'Many countries ask that a passport still be good for 6 months after you arrive, and renewing travel papers can take weeks, so this starts 6 months before it runs out.' };
  }
  return { n: 30, unit: 'day', why: null };
}

/** Common licenses, to start from. Only what is the same nationwide has a term; the rest say the state sets it. */
export type LicenseStarter = { name: string; category: LicenseCategory; issuer: string | null; term_years: number | null; note: string | null };
const STATE_SETS = 'Your state sets how long it lasts: type yours as the term.';
export const LICENSE_STARTERS: LicenseStarter[] = [
  { name: "Driver's license", category: 'Driving', issuer: 'Your state DMV', term_years: null, note: STATE_SETS },
  { name: 'Passport', category: 'Travel', issuer: 'U.S. Department of State', term_years: 10, note: 'A passport for an adult is good for 10 years.' },
  { name: "Child's passport (under 16)", category: 'Travel', issuer: 'U.S. Department of State', term_years: 5, note: 'A passport for a child under 16 is good for 5 years.' },
  { name: 'Global Entry', category: 'Travel', issuer: 'U.S. Customs and Border Protection', term_years: 5, note: 'Good for 5 years.' },
  { name: 'TSA PreCheck', category: 'Travel', issuer: 'Transportation Security Administration', term_years: 5, note: 'Good for 5 years.' },
  { name: 'Vehicle registration', category: 'Vehicle', issuer: 'Your state DMV', term_years: null, note: STATE_SETS },
  { name: 'Parking permit', category: 'Vehicle', issuer: null, term_years: null, note: 'Whoever issues it sets how long it lasts.' },
  { name: 'Hunting license', category: 'Outdoors', issuer: 'Your state wildlife agency', term_years: null, note: STATE_SETS },
  { name: 'Fishing license', category: 'Outdoors', issuer: 'Your state wildlife agency', term_years: null, note: STATE_SETS },
  { name: 'Boating license', category: 'Outdoors', issuer: 'Your state', term_years: null, note: `${STATE_SETS} Some states ask for a boater education card instead.` },
  { name: 'Concealed carry permit', category: 'Other', issuer: 'Your state or county', term_years: null, note: STATE_SETS },
  { name: 'Nursing license', category: 'Work', issuer: 'Your state board', term_years: null, note: `${STATE_SETS} Many ask for continuing education before renewing.` },
  { name: 'Teaching license', category: 'Work', issuer: 'Your state', term_years: null, note: STATE_SETS },
  { name: 'Contractor license', category: 'Work', issuer: 'Your state', term_years: null, note: STATE_SETS },
  { name: 'Real estate license', category: 'Work', issuer: 'Your state', term_years: null, note: STATE_SETS },
  { name: 'CPR certification', category: 'Work', issuer: null, term_years: null, note: 'The course that gave it sets how long it lasts.' },
  { name: 'Business license', category: 'Work', issuer: 'Your city, county or state', term_years: null, note: 'Whoever issues it sets how long it lasts.' },
  { name: 'Pet license', category: 'Pets', issuer: 'Your city or county', term_years: null, note: 'Your city or county sets how long it lasts.' },
  { name: 'Library card', category: 'Other', issuer: null, term_years: null, note: null },
];

type Row = {
  id: number; name: string; category: string | null; holder: string | null; number: string | null; issuer: string | null;
  issued_on: string | null; expires_on: string | null; note: string | null; job_id: number | null;
};
const COLUMNS = 'id, name, category, holder, number, issuer, issued_on, expires_on, note, job_id';
const LEAD_KEY = (id: number) => `license_lead_${id}`;

/** The day a renewal is first due: a lead before the license runs out. */
export const dueBefore = (expires: string, lead: Lead): string => (lead.unit === 'day' ? addDays(expires, -lead.n) : addInterval(expires, -lead.n, lead.unit));

/** What the renewal is called: "Renew Dana's driver's license". */
export function renewalName(name: string, holder: string | null): string {
  const what = /[A-Z]/.test(name.slice(1)) || /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
  return `Renew ${holder ? `${holder}'s ` : ''}${what}`.slice(0, 200);
}

function leadFrom(n: number | null | undefined, unit: string | null | undefined): Lead | null {
  if (n == null && unit == null) return null;
  if (!(LEAD_UNITS as readonly string[]).includes(unit ?? '')) throw new Problem(400, 'Say how long before: days, weeks or months');
  if (!(Number.isInteger(n) && n! >= 0 && n! <= 1000)) throw new Problem(400, 'How long before is a whole number, 0 or more');
  return { n: n!, unit: unit as LeadUnit };
}

export function licenses(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);

  async function rowOf(id: number): Promise<Row> {
    const found = await db.get<Row>(`SELECT ${COLUMNS} FROM licenses WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, "That license isn't here anymore. It may have been deleted.");
    return found;
  }

  async function leads(): Promise<Map<number, Lead>> {
    const out = new Map<number, Lead>();
    for (const r of await db.all<{ key: string; value: string | null }>("SELECT key, value FROM user_settings WHERE user_id = ? AND key LIKE 'license_lead_%'", [owner])) {
      const [n, unit] = (r.value ?? '').split(' ');
      if (Number.isInteger(Number(n)) && (LEAD_UNITS as readonly string[]).includes(unit ?? '')) out.set(Number(r.key.slice('license_lead_'.length)), { n: Number(n), unit: unit as LeadUnit });
    }
    return out;
  }
  const saveLead = (id: number, lead: Lead) => db.run(
    'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value', [owner, LEAD_KEY(id), `${lead.n} ${lead.unit}`]);

  async function build(rows: Row[]): Promise<LicenseFull[]> {
    const jobs = rows.some((r) => r.job_id !== null) ? new Map((await upkeep(db, owner, clock).list()).filter((j) => j.mine).map((j) => [j.id, j])) : new Map<number, Job>();
    const kept = await leads();
    const day = today();
    return rows.map((r): LicenseFull => {
      const left = r.expires_on ? dayNumber(r.expires_on) - dayNumber(day) : null;
      const job = r.job_id !== null ? jobs.get(r.job_id) : undefined;
      let reminder: LicenseReminder | null = null;
      if (job) {
        const lead = kept.get(r.id) ?? defaultLead(r.category);
        const expected = r.expires_on ? dueBefore(r.expires_on, lead) : null;
        const next = job.due.next_day ?? job.first_due;
        reminder = {
          job_id: job.id, lead: { n: lead.n, unit: lead.unit }, term_years: job.every?.unit === 'year' ? job.every.n : null,
          due_on: next, state: job.due.state,
          renewed: Boolean(job.last_done && expected && (job.first_due === null || job.first_due > expected)),
        };
      }
      return {
        id: r.id, name: r.name, category: r.category, holder: r.holder, has_number: r.number !== null, number: r.number, issuer: r.issuer,
        issued_on: r.issued_on, expires_on: r.expires_on, note: r.note, days_left: left,
        state: left === null ? 'none' : left < 0 ? 'expired' : left <= SOON_DAYS ? 'soon' : 'later', reminder,
      };
    });
  }
  /** Without the number: what a list or a banner needs. */
  const bare = ({ number: _number, ...rest }: LicenseFull): License => rest;

  function checked(input: LicenseInput) {
    const name = clean(input.name, 120);
    if (!name) throw new Problem(400, 'Say what the license is');
    const category = clean(input.category, 40);
    if (category !== null && !(LICENSE_CATEGORIES as readonly string[]).includes(category)) throw new Problem(400, `Pick one of: ${LICENSE_CATEGORIES.join(', ')}`);
    const day = (value: string | null | undefined, what: string) => {
      const kept = clean(value, 20);
      if (kept === null) return null;
      const ok = dayOrNull(kept);
      if (!ok) throw new Problem(400, `Pick the day ${what}`);
      return ok;
    };
    const issued = day(input.issued_on, 'it was issued');
    const expires = day(input.expires_on, 'it runs out');
    if (issued && expires && expires < issued) throw new Problem(400, "It can't run out before it was issued");
    return { name, category, holder: clean(input.holder, 80), number: clean(input.number, 60), issuer: clean(input.issuer, 120), issued, expires, note: clean(input.note, 2000) };
  }

  /** Move the renewal to follow the license (its day, and its name if it still has the one made for the license). */
  async function followWith(job: Job, lead: Lead, expires: string | null, rename: string | null) {
    const first = expires ? dueBefore(expires, lead) : job.first_due;
    if (first === job.first_due && rename === null) return;
    await upkeep(db, owner, clock).update(job.id, {
      name: rename ?? job.name, activity: job.activity, item_id: job.item?.id ?? null, every_n: job.every?.n ?? null, every_unit: job.every?.unit ?? null,
      every_reading: job.every_reading, reading_unit: job.reading_unit, first_due: first, assigned_to: job.assigned_to?.id ?? null, steps: job.steps, note: job.note,
    });
  }
  async function linked(row: Row): Promise<Job | null> {
    if (row.job_id === null) return null;
    return (await upkeep(db, owner, clock).list()).find((j) => j.id === row.job_id && j.mine) ?? null;
  }

  const one = async (id: number): Promise<LicenseFull> => (await build([await rowOf(id)]))[0]!;
  const ORDER = 'ORDER BY expires_on IS NULL, expires_on, name COLLATE NOCASE, id';

  const api = {
    /** Every license this person keeps, soonest to run out first, without the numbers. */
    async list(): Promise<License[]> {
      return (await build(await db.all<Row>(`SELECT ${COLUMNS} FROM licenses WHERE owner_id = ? ${ORDER}`, [owner]))).map(bare);
    },
    /** One license, with its number. */
    get: one,

    async create(input: LicenseInput): Promise<LicenseFull> {
      const v = checked(input);
      const made = await db.run(
        'INSERT INTO licenses (owner_id, name, category, holder, number, issuer, issued_on, expires_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, v.name, v.category, v.holder, v.number, v.issuer, v.issued, v.expires, v.note, now(), now()]);
      return one(made.lastId);
    },

    /** Change a license. If its expiry day moved and it has a renewal, the renewal's due day follows. */
    async update(id: number, input: LicenseInput): Promise<LicenseFull> {
      const before = await rowOf(id);
      const v = checked(input);
      await db.run('UPDATE licenses SET name = ?, category = ?, holder = ?, number = ?, issuer = ?, issued_on = ?, expires_on = ?, note = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
        [v.name, v.category, v.holder, v.number, v.issuer, v.issued, v.expires, v.note, now(), id, owner]);
      const job = await linked(before);
      if (job) {
        const lead = (await leads()).get(id) ?? defaultLead(v.category);
        const moved = v.expires !== null && v.expires !== before.expires_on;
        const named = renewalName(v.name, v.holder);
        const rename = job.name === renewalName(before.name, before.holder) && job.name !== named ? named : null;
        if (moved || rename) await followWith(job, lead, moved ? v.expires : null, rename);
      }
      return one(id);
    },

    /** Take a license away. With `withReminder`, its renewal in upkeep goes too; otherwise it stays. */
    async remove(id: number, withReminder = false): Promise<void> {
      const row = await rowOf(id);
      if (withReminder && row.job_id !== null) {
        const job = await linked(row);
        if (job) await upkeep(db, owner, clock).remove(job.id);
      }
      await db.run('DELETE FROM licenses WHERE id = ? AND owner_id = ?', [id, owner]);
      await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, LEAD_KEY(id)]);
    },

    /**
     * "Remind me to renew": make a renewal in upkeep for this license, first due a lead before it runs out,
     * coming round every `term_years` years (or once, with none). Done again, it sets the one it has.
     */
    async remind(id: number, input: RemindInput = {}): Promise<LicenseFull> {
      const row = await rowOf(id);
      if (!row.expires_on) throw new Problem(400, 'Add the day it runs out first, so there is a day to count back from');
      const typed = leadFrom(input.lead_n, input.lead_unit);
      const stored = (await leads()).get(id);
      const lead = typed ?? stored ?? defaultLead(row.category);
      const term = input.term_years;
      if (term != null && !(Number.isInteger(term) && term >= 1 && term <= 100)) throw new Problem(400, 'The term is a whole number of years, 1 or more');
      const first = dueBefore(row.expires_on, { n: lead.n, unit: lead.unit });
      const job = await linked(row);
      if (job) {
        const years = term === undefined ? (job.every?.unit === 'year' ? job.every.n : null) : term;
        await upkeep(db, owner, clock).update(job.id, {
          name: job.name, activity: job.activity, item_id: job.item?.id ?? null, every_n: years, every_unit: years ? 'year' : null,
          every_reading: job.every_reading, reading_unit: job.reading_unit, first_due: first, assigned_to: job.assigned_to?.id ?? null, steps: job.steps, note: job.note,
        });
      } else {
        const why = defaultLead(row.category).why;
        const made = await upkeep(db, owner, clock).create({
          name: renewalName(row.name, row.holder), kind: 'renewal', activity: 'Papers', first_due: first,
          every_n: term ?? null, every_unit: term ? 'year' : null,
          note: `Kept under Licenses. ${why ?? ''}`.trim(),
        });
        await db.run('UPDATE licenses SET job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [made.id, now(), id, owner]);
      }
      await saveLead(id, { n: lead.n, unit: lead.unit });
      return one(id);
    },

    /** Licenses that have run out, or run out within `withinDays`, the soonest (or longest ago) first. */
    async expiring(withinDays: number): Promise<License[]> {
      if (!(Number.isInteger(withinDays) && withinDays >= 0 && withinDays <= 3650)) throw new Problem(400, 'Look ahead a whole number of days, 0 or more');
      const rows = await db.all<Row>(`SELECT ${COLUMNS} FROM licenses WHERE owner_id = ? AND expires_on IS NOT NULL AND expires_on <= ? ${ORDER}`, [owner, addDays(today(), withinDays)]);
      return (await build(rows)).map(bare);
    },
  };
  return api;
}

/** Licenses that have run out or will within `withinDays`, soonest first, for a banner. */
export const expiring = (db: Db, owner: number, clock: Clock, withinDays: number): Promise<License[]> => licenses(db, owner, clock).expiring(withinDays);

export type Licenses = ReturnType<typeof licenses>;
