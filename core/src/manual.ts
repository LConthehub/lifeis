/**
 * The house manual: what someone else needs to know to look after the home. Where the water shuts off, the
 * Wi-Fi, who to call, bin day, and each pet's food and vet. For a sitter, a guest, family, or the day
 * something goes wrong and the person who knows isn't there.
 *
 * It can be printed, or shared by a link that needs no sign-in: the long random part of the address is the
 * only key, it stops working on a day the person picks, and an entry marked private (the alarm code) is
 * never on it.
 */
import type { Db } from './db.ts';
import { placePaths } from './inventory.ts';
import { pets } from './pets.ts';
import { Problem } from './problem.ts';
import { addDays, clean, stamp, todayOf, type Clock } from './small.ts';

export const MANUAL_SECTIONS = [
  { id: 'emergency', title: 'In an emergency', hint: 'Where to shut things off, and what to grab.', ideas: ['Water shut-off', 'Gas shut-off', 'Breaker box', 'Fire extinguisher', 'First-aid kit', 'Where to meet outside'] },
  { id: 'contacts', title: 'Who to call', hint: 'People and their numbers.', ideas: ['Emergency contact', 'Doctor', 'Plumber', 'Electrician', 'Landlord', 'A neighbor with a key'] },
  { id: 'house', title: 'How the house works', hint: 'The things that are obvious only to you.', ideas: ['Wi-Fi', 'Thermostat', 'Alarm', 'Spare key', 'Hot water', 'TV and remotes'] },
  { id: 'routines', title: 'Day to day', hint: 'What happens when.', ideas: ['Trash and recycling days', 'Plants to water', 'Mail and parcels', 'Bedtimes', 'Allergies and medicines'] },
] as const;
export type ManualSection = (typeof MANUAL_SECTIONS)[number]['id'];

export type EntryInput = { section: string; title: string; body?: string | null; phone?: string | null; place_id?: number | null; private?: boolean };
export type ManualEntry = { id: number; section: ManualSection; title: string; body: string | null; phone: string | null; place_id: number | null; place: string | null; private: boolean };
export type ManualPet = { id: number; name: string; species: string | null; food: string | null; vet_name: string | null; vet_phone: string | null; note: string | null };
export type Manual = {
  sections: { id: ManualSection; title: string; hint: string; ideas: string[]; entries: ManualEntry[] }[];
  pets: ManualPet[];
  share: { on: boolean; token: string | null; expires_on: string | null; pets: boolean };
};
/** What the shared link shows: no private entries, nothing that can be changed. */
export type SharedManual = { sections: { title: string; entries: Omit<ManualEntry, 'private' | 'place_id' | 'id' | 'section'>[] }[]; pets: Omit<ManualPet, 'id'>[]; expires_on: string | null };

const MAX_ENTRIES = 200;
function newToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Row = { id: number; section: ManualSection; title: string; body: string | null; phone: string | null; place_id: number | null; private: number };

async function entriesOf(db: Db, owner: number): Promise<ManualEntry[]> {
  const places = await db.all<{ id: number; parent_id: number | null; name: string; note: string | null }>('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]);
  const paths = placePaths(places);
  return (await db.all<Row>('SELECT id, section, title, body, phone, place_id, private FROM manual_entries WHERE owner_id = ? ORDER BY sort_order, id', [owner]))
    .map((r) => ({ ...r, private: r.private === 1, place: r.place_id !== null ? (paths.get(r.place_id) ?? null) : null }));
}

async function petsOf(db: Db, owner: number, clock: Clock): Promise<ManualPet[]> {
  const mine = pets(db, owner, clock);
  const out: ManualPet[] = [];
  for (const p of await mine.list()) {
    const whole = await mine.get(p.id);
    out.push({ id: p.id, name: p.name, species: p.species, food: whole.food, vet_name: whole.vet_name, vet_phone: whole.vet_phone, note: whole.note });
  }
  return out;
}

export function manual(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  async function checked(input: EntryInput) {
    if (!MANUAL_SECTIONS.some((s) => s.id === input.section)) throw new Problem(400, "That isn't a part of the manual");
    const title = clean(input.title, 120);
    if (!title) throw new Problem(400, 'Say what it is');
    if (input.place_id != null && !(await db.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [input.place_id, owner]))) throw new Problem(404, "That place isn't one of yours");
    return [input.section, title, clean(input.body, 3000), clean(input.phone, 40), input.place_id ?? null, input.private ? 1 : 0] as const;
  }
  async function share(): Promise<Manual['share']> {
    const row = await db.get<{ token: string; expires_on: string | null; pets: number }>('SELECT token, expires_on, pets FROM manual_shares WHERE owner_id = ?', [owner]);
    // A link past its day is as good as off.
    if (!row || (row.expires_on !== null && row.expires_on < todayOf(clock))) return { on: false, token: null, expires_on: null, pets: true };
    return { on: true, token: row.token, expires_on: row.expires_on, pets: row.pets === 1 };
  }
  async function get(): Promise<Manual> {
    const entries = await entriesOf(db, owner);
    return {
      sections: MANUAL_SECTIONS.map((s) => ({ id: s.id, title: s.title, hint: s.hint, ideas: s.ideas.filter((i) => !entries.some((e) => e.section === s.id && e.title.toLowerCase() === i.toLowerCase())), entries: entries.filter((e) => e.section === s.id) })),
      pets: await petsOf(db, owner, clock),
      share: await share(),
    };
  }

  return {
    get,

    async addEntry(input: EntryInput): Promise<Manual> {
      const values = await checked(input);
      const count = (await db.get<{ n: number; next: number }>('SELECT COUNT(*) AS n, COALESCE(MAX(sort_order) + 1, 0) AS next FROM manual_entries WHERE owner_id = ?', [owner]))!;
      if (count.n >= MAX_ENTRIES) throw new Problem(400, `The manual holds ${MAX_ENTRIES} entries at most`);
      await db.run('INSERT INTO manual_entries (owner_id, section, title, body, phone, place_id, private, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, ...values, count.next, now(), now()]);
      return get();
    },

    async updateEntry(id: number, input: EntryInput): Promise<Manual> {
      if (!(await db.get('SELECT id FROM manual_entries WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
      await db.run('UPDATE manual_entries SET section = ?, title = ?, body = ?, phone = ?, place_id = ?, private = ?, updated_at = ? WHERE id = ?', [...(await checked(input)), now(), id]);
      return get();
    },

    async removeEntry(id: number): Promise<Manual> {
      await db.run('DELETE FROM manual_entries WHERE id = ? AND owner_id = ?', [id, owner]);
      return get();
    },

    /**
     * Turn the shared link on (a new address each time, so an old one stops working), for so many days or
     * until it's turned off. `withPets` says whether the pets are on it.
     */
    async shareFor(days: number | null, withPets = true): Promise<Manual> {
      if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) throw new Problem(400, 'A link lasts 1 to 365 days, or until you turn it off');
      const until = days === null ? null : addDays(todayOf(clock), days);
      await db.run(`INSERT INTO manual_shares (owner_id, token, expires_on, pets, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET token = excluded.token, expires_on = excluded.expires_on, pets = excluded.pets, created_at = excluded.created_at`,
      [owner, newToken(), until, withPets ? 1 : 0, now()]);
      return get();
    },

    async stopSharing(): Promise<Manual> {
      await db.run('DELETE FROM manual_shares WHERE owner_id = ?', [owner]);
      return get();
    },
  };
}

/** What a shared link shows, or null when there is no such link or its day has passed. */
export async function manualFor(db: Db, token: string, clock: Clock = () => new Date()): Promise<SharedManual | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db.get<{ owner_id: number; expires_on: string | null; pets: number }>(
    'SELECT owner_id, expires_on, pets FROM manual_shares WHERE token = ?', [token]);
  if (!row || (row.expires_on !== null && row.expires_on < todayOf(clock))) return null;
  const entries = (await entriesOf(db, row.owner_id)).filter((e) => !e.private);
  return {
    sections: MANUAL_SECTIONS.map((s) => ({ title: s.title, entries: entries.filter((e) => e.section === s.id).map(({ title, body, phone, place }) => ({ title, body, phone, place })) })).filter((s) => s.entries.length),
    pets: row.pets === 1 ? (await petsOf(db, row.owner_id, clock)).map(({ id: _id, ...p }) => p) : [],
    expires_on: row.expires_on,
  };
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tel = (phone: string) => `<a href="tel:${esc(phone.replace(/[^0-9+]/g, ''))}">${esc(phone)}</a>`;

/** The shared manual as a page of its own: plain, readable on a phone, printable, with no scripts. */
export function manualHtml(m: SharedManual): string {
  const entry = (e: SharedManual['sections'][number]['entries'][number]) => `<div class="e"><h3>${esc(e.title)}</h3>${e.place ? `<p class="where">Where: ${esc(e.place)}</p>` : ''}${
    e.phone ? `<p class="phone">${tel(e.phone)}</p>` : ''}${e.body ? `<p>${esc(e.body).replace(/\n/g, '<br>')}</p>` : ''}</div>`;
  const pet = (p: SharedManual['pets'][number]) => `<div class="e"><h3>${esc(p.name)}${p.species ? ` <small>${esc(p.species)}</small>` : ''}</h3>${
    p.food ? `<p><b>Food:</b> ${esc(p.food)}</p>` : ''}${p.vet_name || p.vet_phone ? `<p><b>Vet:</b> ${[p.vet_name ? esc(p.vet_name) : '', p.vet_phone ? tel(p.vet_phone) : ''].filter(Boolean).join(' · ')}</p>` : ''}${
    p.note ? `<p>${esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>House manual</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f4f8f7;color:#1c2b2a;line-height:1.45}
main{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 3rem}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:1.75rem 0 .5rem;border-bottom:2px solid #1c5a55;padding-bottom:.2rem}
h3{font-size:1rem;margin:0}small{font-weight:400;color:#5c6b6a}
.e{background:#fff;border-radius:.75rem;padding:.75rem .9rem;margin:.5rem 0;box-shadow:0 1px 2px rgba(0,0,0,.06);break-inside:avoid}
.e p{margin:.3rem 0 0}.where{color:#1c5a55}.phone a{font-size:1.15rem;font-weight:600}
a{color:#1c5a55}.foot{color:#5c6b6a;font-size:.85rem;margin-top:2rem}
@media print{body{background:#fff}.e{box-shadow:none;border:1px solid #ccc}}
</style></head><body><main><h1>House manual</h1><p class="foot" style="margin-top:0">Shared with you${m.expires_on ? `. This link works until ${esc(m.expires_on)}` : ''}.</p>
${m.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.entries.map(entry).join('')}`).join('')}
${m.pets.length ? `<h2>Pets</h2>${m.pets.map(pet).join('')}` : ''}
${!m.sections.length && !m.pets.length ? '<p>Nothing has been written here yet.</p>' : ''}
<p class="foot">Made with Life Is. Nothing on this page can be changed from here.</p></main></body></html>`;
}

export type ManualStore = ReturnType<typeof manual>;
