/**
 * For people who rent: the lease, the landlord's repairs, and the move-in and move-out record.
 *
 * - The lease: its first and last day, the day rent is due, the deposit (cents), the landlord's name and contact as typed,
 *   and one notice deadline the person sets (the day to tell the landlord they are staying or leaving). Life Is reminds
 *   the person before the lease ends and before that deadline, in the morning reminders (see reminders.ts).
 * - A landlord's job: an Upkeep job marked as the landlord's says "Ask the landlord" in place of Done. Life Is writes a short
 *   dated note (what is wrong, since when, the place). The person copies it or opens it in the phone's share sheet; Life Is keeps
 *   a copy of each note with its date, and the job keeps when the landlord was asked and when it was fixed.
 * - The record: room by room, a condition note and the person's own dated photos, once at move-in and again at move-out.
 *
 * Nothing is sent from here. The note is only written; the person is the one who sends it. Nothing here is legal or money advice.
 * Everything is the person's own: one person's lease, rooms and photos are never seen by another.
 */
import { atomic, type Db } from './db.ts';
import { Problem } from './problem.ts';
import { clean, dayNumber, dayOrNull, pictureType, stamp, todayOf, type Clock } from './small.ts';
import { upkeep, type Job } from './upkeep.ts';

/** The same size limit and kinds of picture as the photo kept on a thing (JPEG, PNG or WebP). */
export const MAX_RENTAL_PHOTO = 8_000_000;
export const MAX_ROOMS = 40;
export const MAX_ROOM_PHOTOS = 12;
export const PHASES = ['in', 'out'] as const;
export type Phase = (typeof PHASES)[number];
/** The days before the end of a lease, and before the notice deadline, that a reminder is sent. */
export const LEASE_END_REMINDERS = [60, 30, 14, 7, 1, 0];
export const NOTICE_REMINDERS = [30, 14, 7, 1, 0];

export type LeaseInput = {
  start_day?: string | null; end_day?: string | null; rent_day?: number | null; deposit_cents?: number | null;
  landlord_name?: string | null; landlord_contact?: string | null; notice_day?: string | null; notice_label?: string | null;
};
export type Lease = {
  start_day: string | null; end_day: string | null; rent_day: number | null; deposit_cents: number | null;
  landlord_name: string | null; landlord_contact: string | null; notice_day: string | null; notice_label: string | null;
  /** Days until the lease ends and until the notice deadline (below 0 is past), or null when not set. */
  end_days: number | null;
  notice_days: number | null;
};
export type NoteInput = { what?: string | null; since?: string | null; place?: string | null };
export type LandlordNote = { id: number; day: string; body: string };
export type RoomPhoto = { id: number; phase: Phase; day: string; type: string };
export type Room = { id: number; name: string; in_note: string | null; out_note: string | null; photos: RoomPhoto[] };
export type RoomInput = { name?: string; in_note?: string | null; out_note?: string | null };
export type DigestLine = { title: string; detail: string; link: string; urgent: boolean };

const BLANK = { start_day: null, end_day: null, rent_day: null, deposit_cents: null, landlord_name: null, landlord_contact: null, notice_day: null, notice_label: null };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day as people write it: Nov 28, 2026. */
export const dayWords = (day: string) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; return `${MONTHS[m - 1]} ${d}, ${y}`; };

export function renters(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);

  async function mineJob(id: number): Promise<Job> {
    const job = await upkeep(db, owner, clock).get(id);
    if (!job.mine) throw new Problem(403, 'Only the person whose job this is can change it');
    return job;
  }

  /** The note as it would be written, for a job: the person can change what it says before they copy it. */
  async function draft(job: Job, input: NoteInput, day: string): Promise<string> {
    const what = clean(input.what, 1000) ?? clean(job.note, 1000) ?? job.name;
    const since = input.since ? dayOrNull(input.since) : null;
    if (input.since && !since) throw new Problem(400, 'Pick the day it began, or leave it empty');
    const place = clean(input.place, 200) ?? job.item?.place ?? job.item?.name ?? null;
    const lease = await getLease();
    const lines = [
      `Date: ${dayWords(day)}`,
      lease.landlord_name ? `To: ${lease.landlord_name}` : null,
      `Repair needed: ${job.name}`,
      `What is wrong: ${what}`,
      `Since: ${since ? dayWords(since) : 'not sure'}`,
      place ? `Where: ${place}` : null,
      'Please let me know when this can be fixed.',
    ];
    return lines.filter((l) => l !== null).join('\n');
  }

  async function getLease(): Promise<Lease> {
    const row = await db.get<typeof BLANK>('SELECT start_day, end_day, rent_day, deposit_cents, landlord_name, landlord_contact, notice_day, notice_label FROM leases WHERE owner_id = ?', [owner]);
    const lease = row ?? BLANK;
    const from = (d: string | null) => (d ? dayNumber(d) - dayNumber(today()) : null);
    return { ...lease, end_days: from(lease.end_day), notice_days: from(lease.notice_day) };
  }

  async function ownRoom(id: number) {
    const room = await db.get<{ id: number }>('SELECT id FROM rental_rooms WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!room) throw new Problem(404, "That room isn't here anymore. It may have been deleted.");
  }

  async function photoOf(id: number): Promise<{ type: string; bytes: Uint8Array }> {
    const found = await db.get<{ type: string; bytes: Uint8Array }>(
      'SELECT p.type, p.bytes FROM rental_photos p JOIN rental_rooms r ON r.id = p.room_id WHERE p.id = ? AND r.owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, "That photo isn't here anymore. It may have been deleted.");
    return found;
  }

  async function rooms(): Promise<Room[]> {
    const list = await db.all<{ id: number; name: string; in_note: string | null; out_note: string | null }>(
      'SELECT id, name, in_note, out_note FROM rental_rooms WHERE owner_id = ? ORDER BY sort_order, id', [owner]);
    const photos = await db.all<RoomPhoto & { room_id: number }>(
      'SELECT p.id, p.room_id, p.phase, p.day, p.type FROM rental_photos p JOIN rental_rooms r ON r.id = p.room_id WHERE r.owner_id = ? ORDER BY p.day, p.id', [owner]);
    return list.map((r) => ({ ...r, photos: photos.filter((p) => p.room_id === r.id).map(({ id, phase, day, type }) => ({ id, phase, day, type })) }));
  }

  return {
    // ---------- the landlord's jobs ----------

    /** What the note would say now, without keeping it. */
    async preview(jobId: number, input: NoteInput = {}): Promise<{ text: string }> {
      return { text: await draft(await mineJob(jobId), input, today()) };
    },

    /** The landlord was asked: the note is kept with its date, the job remembers the day, and it is no longer marked fixed. */
    async ask(jobId: number, input: NoteInput = {}): Promise<{ job: Job; note: LandlordNote }> {
      const job = await mineJob(jobId);
      if (!job.landlord) throw new Problem(400, "That job isn't marked as the landlord's");
      const day = today();
      const body = await draft(job, input, day);
      const made = await atomic(db, async (tx) => {
        const row = await tx.run('INSERT INTO landlord_notes (job_id, day, body, created_at) VALUES (?, ?, ?, ?)', [jobId, day, body, now()]);
        await tx.run('UPDATE upkeep_jobs SET asked_on = ?, fixed_on = NULL WHERE id = ?', [day, jobId]);
        return row.lastId;
      });
      return { job: await upkeep(db, owner, clock).get(jobId), note: { id: made, day, body } };
    },

    /** The notes kept for a job, newest first. */
    async notes(jobId: number): Promise<LandlordNote[]> {
      await mineJob(jobId);
      return db.all<LandlordNote>('SELECT id, day, body FROM landlord_notes WHERE job_id = ? ORDER BY day DESC, id DESC', [jobId]);
    },

    /** It was fixed. The day is kept on the job and in its history, so "Asked 12 days ago" goes away. */
    async fixed(jobId: number, day?: string | null): Promise<Job> {
      const job = await mineJob(jobId);
      if (!job.landlord) throw new Problem(400, "That job isn't marked as the landlord's");
      const on = day ? dayOrNull(day) : today();
      if (!on) throw new Problem(400, 'Pick the day it was fixed');
      await upkeep(db, owner, clock).done(jobId, { day: on, note: 'Fixed' });
      await db.run('UPDATE upkeep_jobs SET fixed_on = ? WHERE id = ?', [on, jobId]);
      return upkeep(db, owner, clock).get(jobId);
    },

    // ---------- the lease ----------

    lease: getLease,

    async setLease(input: LeaseInput): Promise<Lease> {
      const start = input.start_day ? dayOrNull(input.start_day) : null;
      const end = input.end_day ? dayOrNull(input.end_day) : null;
      const notice = input.notice_day ? dayOrNull(input.notice_day) : null;
      if (input.start_day && !start) throw new Problem(400, 'Pick the day the lease starts');
      if (input.end_day && !end) throw new Problem(400, 'Pick the day the lease ends');
      if (input.notice_day && !notice) throw new Problem(400, 'Pick the day the notice is due');
      if (start && end && end < start) throw new Problem(400, 'The lease ends before it starts');
      const rent = input.rent_day ?? null;
      if (rent !== null && !(Number.isInteger(rent) && rent >= 1 && rent <= 31)) throw new Problem(400, 'The day rent is due is a day of the month, 1 to 31');
      const deposit = input.deposit_cents ?? null;
      if (deposit !== null && !(Number.isInteger(deposit) && deposit >= 0 && deposit < 1e11)) throw new Problem(400, 'The deposit is an amount, 0 or more');
      await db.run(
        `INSERT INTO leases (owner_id, start_day, end_day, rent_day, deposit_cents, landlord_name, landlord_contact, notice_day, notice_label, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET start_day = excluded.start_day, end_day = excluded.end_day, rent_day = excluded.rent_day, deposit_cents = excluded.deposit_cents,
           landlord_name = excluded.landlord_name, landlord_contact = excluded.landlord_contact, notice_day = excluded.notice_day, notice_label = excluded.notice_label, updated_at = excluded.updated_at`,
        [owner, start, end, rent, deposit, clean(input.landlord_name, 120), clean(input.landlord_contact, 300), notice, notice ? clean(input.notice_label, 120) : null, now()]);
      return getLease();
    },

    async clearLease(): Promise<void> {
      await db.run('DELETE FROM leases WHERE owner_id = ?', [owner]);
    },

    // ---------- the move-in and move-out record ----------

    rooms,

    async addRoom(name: string): Promise<Room[]> {
      const text = clean(name, 80);
      if (!text) throw new Problem(400, 'Give the room a name');
      const count = (await db.get<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(sort_order) AS last FROM rental_rooms WHERE owner_id = ?', [owner]))!;
      if (count.n >= MAX_ROOMS) throw new Problem(400, `A record holds ${MAX_ROOMS} rooms at most`);
      await db.run('INSERT INTO rental_rooms (owner_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)', [owner, text, (count.last ?? 0) + 1, now()]);
      return rooms();
    },

    /** Change a room's name or either condition note. Left out: unchanged. Null or empty clears a note. */
    async updateRoom(id: number, input: RoomInput): Promise<Room[]> {
      await ownRoom(id);
      if (input.name !== undefined) {
        const text = clean(input.name, 80);
        if (!text) throw new Problem(400, 'Give the room a name');
        await db.run('UPDATE rental_rooms SET name = ? WHERE id = ?', [text, id]);
      }
      if (input.in_note !== undefined) await db.run('UPDATE rental_rooms SET in_note = ? WHERE id = ?', [clean(input.in_note, 3000), id]);
      if (input.out_note !== undefined) await db.run('UPDATE rental_rooms SET out_note = ? WHERE id = ?', [clean(input.out_note, 3000), id]);
      return rooms();
    },

    async removeRoom(id: number): Promise<Room[]> {
      await ownRoom(id);
      await db.run('DELETE FROM rental_rooms WHERE id = ?', [id]);
      return rooms();
    },

    /** Keep one of the person's own photos for a room, at move-in or at move-out, dated (today unless a day is given). */
    async addPhoto(roomId: number, phase: string, bytes: Uint8Array, day?: string | null): Promise<Room[]> {
      await ownRoom(roomId);
      if (!(PHASES as readonly string[]).includes(phase)) throw new Problem(400, 'Pick one: move-in or move-out');
      const type = pictureType(bytes);
      if (!type) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_RENTAL_PHOTO) throw new Problem(400, 'That photo is too large to keep');
      const taken = day ? dayOrNull(day) : today();
      if (!taken) throw new Problem(400, 'Pick the day the photo was taken');
      const have = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM rental_photos WHERE room_id = ? AND phase = ?', [roomId, phase]))!.n;
      if (have >= MAX_ROOM_PHOTOS) throw new Problem(400, `A room holds ${MAX_ROOM_PHOTOS} photos at most for each of move-in and move-out`);
      await db.run('INSERT INTO rental_photos (room_id, phase, day, type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [roomId, phase, taken, type, bytes, now()]);
      return rooms();
    },

    photo: photoOf,

    async removePhoto(id: number): Promise<Room[]> {
      await photoOf(id);
      await db.run('DELETE FROM rental_photos WHERE id = ?', [id]);
      return rooms();
    },

    // ---------- reminders ----------

    /** What the morning reminder says about the lease: its end, and the notice deadline. */
    async digestLines(): Promise<DigestLine[]> {
      const lease = await getLease();
      const out: DigestLine[] = [];
      const say = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`);
      if (lease.end_days !== null && LEASE_END_REMINDERS.includes(lease.end_days)) {
        out.push({ title: 'Your lease ends', detail: `${say(lease.end_days)}, ${dayWords(lease.end_day!)}`, link: '/things/renting', urgent: lease.end_days <= 1 });
      }
      if (lease.notice_days !== null && NOTICE_REMINDERS.includes(lease.notice_days)) {
        out.push({ title: lease.notice_label ? `Notice due: ${lease.notice_label}` : 'A notice is due to your landlord', detail: `${say(lease.notice_days)}, ${dayWords(lease.notice_day!)}`, link: '/things/renting', urgent: lease.notice_days <= 1 });
      }
      return out;
    },
  };
}
export type Renters = ReturnType<typeof renters>;
