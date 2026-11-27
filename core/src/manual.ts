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
import { guestServices, type SharedService } from './homeServices.ts';
import { placePaths } from './inventory.ts';
import { pets } from './pets.ts';
import { Problem } from './problem.ts';
import { addDays, clean, stamp, todayOf, type Clock } from './small.ts';

export const MANUAL_SECTIONS = [
  { id: 'emergency', title: 'In an emergency', hint: 'Where to shut things off, and what to grab.', ideas: ['Water shut-off', 'Gas shut-off', 'Breaker box', 'Fire extinguisher', 'First-aid kit', 'Where to meet outside'] },
  { id: 'contacts', title: 'Who to call', hint: 'People and their numbers.', ideas: ['Emergency contact', 'Doctor', 'Plumber', 'Electrician', 'Landlord', 'A neighbor with a key'] },
  { id: 'house', title: 'How the house works', hint: 'The things that are obvious only to you.', ideas: ['Wi-Fi', 'Thermostat', 'Alarm', 'Spare key', 'Hot water', 'TV and remotes'] },
  { id: 'routines', title: 'Day to day', hint: 'What happens when.', ideas: ['Trash and recycling days', 'Plants to water', 'Mail and packages', 'Bedtimes', 'Allergies and medicines'] },
] as const;
export type ManualSection = (typeof MANUAL_SECTIONS)[number]['id'];

export type EntryInput = { section: string; title: string; body?: string | null; phone?: string | null; place_id?: number | null; private?: boolean };
export type ManualEntry = { id: number; section: ManualSection; title: string; body: string | null; phone: string | null; place_id: number | null; place: string | null; private: boolean };
export type ManualPet = { id: number; name: string; species: string | null; food: string | null; vet_name: string | null; vet_phone: string | null; note: string | null };
export type Manual = {
  sections: { id: ManualSection; title: string; hint: string; ideas: string[]; entries: ManualEntry[] }[];
  pets: ManualPet[];
  share: { on: boolean; token: string | null; expires_on: string | null; pets: boolean };
  /** Whether the shared page says it was made with Life Is (on unless the person turned it off). */
  credit: boolean;
};
/** What the shared link shows: no private entries, nothing that can be changed. */
export type SharedManual = { sections: { title: string; entries: Omit<ManualEntry, 'private' | 'place_id' | 'id' | 'section'>[] }[]; pets: Omit<ManualPet, 'id'>[]; services: SharedService[]; expires_on: string | null; credit: boolean };

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

const CREDIT = 'manual_credit';
/** The quiet "Made with Life Is" line on the shared page: on unless the person turned it off. Kept with their other settings. */
async function creditOf(db: Db, owner: number): Promise<boolean> {
  return (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, CREDIT]))?.value !== '0';
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
      credit: await creditOf(db, owner),
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
      if (!(await db.get('SELECT id FROM manual_entries WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, "That entry isn't here anymore. It may have been deleted.");
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

    async setCredit(on: boolean): Promise<Manual> {
      await db.run('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value', [owner, CREDIT, on ? '1' : '0']);
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
    // Links marked for guests that the person sharing may see: only the address that works away from home.
    services: await guestServices(db, row.owner_id),
    expires_on: row.expires_on,
    credit: await creditOf(db, row.owner_id),
  };
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tel = (phone: string) => `<a href="tel:${esc(phone.replace(/[^0-9+]/g, ''))}">${esc(phone)}</a>`;

/**
 * The shared manual as a page of its own: in Life Is's look (cream and chocolate, Fraunces and Nunito, the owner's heart and
 * mushroom mark), readable on a phone, printable, with no scripts. The fonts and the mark come from the household's own Life
 * Is (/fonts and /mark-192.png, in frontend/public); nothing loads from another site. The one link to another site is the
 * quiet credit at the foot, which the person in charge can turn off.
 */
export function manualHtml(m: SharedManual): string {
  const entry = (e: SharedManual['sections'][number]['entries'][number]) => `<div class="e"><h3>${esc(e.title)}</h3>${e.place ? `<p class="where">Where: ${esc(e.place)}</p>` : ''}${
    e.phone ? `<p class="phone">${tel(e.phone)}</p>` : ''}${e.body ? `<p>${esc(e.body).replace(/\n/g, '<br>')}</p>` : ''}</div>`;
  const pet = (p: SharedManual['pets'][number]) => `<div class="e"><h3>${esc(p.name)}${p.species ? ` <small>${esc(p.species)}</small>` : ''}</h3>${
    p.food ? `<p><b>Food:</b> ${esc(p.food)}</p>` : ''}${p.vet_name || p.vet_phone ? `<p><b>Vet:</b> ${[p.vet_name ? esc(p.vet_name) : '', p.vet_phone ? tel(p.vet_phone) : ''].filter(Boolean).join(' · ')}</p>` : ''}${
    p.note ? `<p>${esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}</div>`;
  const service = (v: SharedService) => `<div class="e"><h3>${esc(v.name)}</h3>${
    v.address ? `<p class="phone"><a href="${esc(v.address)}" rel="noopener noreferrer">${esc(v.address)}</a></p>` : '<p>Only works at home.</p>'}${v.note ? `<p>${esc(v.note).replace(/\n/g, '<br>')}</p>` : ''}</div>`;
  const groups = [...new Set(m.services.map((v) => v.group ?? ''))];
  const services = groups.map((g) => `${g ? `<h3 class="grp">${esc(g)}</h3>` : ''}${m.services.filter((v) => (v.group ?? '') === g).map(service).join('')}`).join('');
  const credit = m.credit ? ` Made with Life Is, a private home organizer you run yourself. <a href="https://lifeis.living" rel="noopener noreferrer">lifeis.living</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark"><title>House Manual</title><style>
@font-face{font-family:"Fraunces Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(/fonts/fraunces-soft.woff2) format("woff2-variations")}
@font-face{font-family:"Nunito Variable";font-style:normal;font-display:swap;font-weight:200 1000;src:url(/fonts/nunito.woff2) format("woff2-variations")}
:root{--paper:#f1e5c8;--card:#fbf3e0;--ink:#422a17;--soft:#6f5a44;--line:#e4cfa4;--accent:#734825;--rule:#e7602b;--shadow:0 1px 3px rgba(66,42,23,.14)}
@media (prefers-color-scheme:dark){:root{--paper:#2a190d;--card:#3a2412;--ink:#fbf4e4;--soft:#d2b184;--line:#533519;--accent:#eead3e;--rule:#eead3e;--shadow:none}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font-family:"Nunito Variable",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-weight:600;margin:0;background:var(--paper);color:var(--ink);line-height:1.5;overflow-wrap:anywhere}
.bar{background:linear-gradient(100deg,#4a2f1a 0%,#5f361b 55%,#933f1d 100%);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.bar div{max-width:40rem;margin:0 auto;padding:.6rem 1rem;display:flex;align-items:center;gap:.5rem}
.bar img{width:2.25rem;height:2.25rem;display:block}
.bar span{font-family:"Fraunces Variable",Georgia,Cambria,serif;font-variation-settings:"SOFT" 100;font-size:1.2rem;font-weight:700;line-height:1}
main{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 3rem}
h1,h2{font-family:"Fraunces Variable",Georgia,Cambria,serif;font-variation-settings:"SOFT" 100;letter-spacing:-.005em}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 .25rem}
h2{font-size:1.25rem;margin:1.75rem 0 .5rem;border-bottom:3px solid var(--rule);padding-bottom:.2rem}
h3{font-size:1rem;font-weight:850;margin:0}
small{font-weight:600;color:var(--soft)}
.e{background:var(--card);border:1px solid var(--line);border-radius:1.25rem;padding:.8rem 1rem;margin:.6rem 0;box-shadow:var(--shadow);break-inside:avoid}
.grp{margin:1rem 0 0;color:var(--soft)}
.e p{margin:.3rem 0 0}
.where{color:var(--accent)}
.phone a{font-size:1.15rem;font-weight:850}
a{color:var(--accent)}
b{font-weight:850}
.foot{color:var(--soft);font-size:.9rem;margin-top:2rem}
.top{margin-top:0}
@media print{body{background:#fff;color:#000}.bar{background:none;color:#000;box-shadow:none;border-bottom:2px solid #000}.e{box-shadow:none;border:1px solid #999;background:#fff}a,.where,.grp,small,.foot{color:#000}h2{border-bottom-color:#000}}
</style></head><body><header class="bar"><div><img src="/mark-192.png" alt="" width="36" height="36"><span>Life is</span></div></header><main><h1>House Manual</h1><p class="foot top">Shared with you${m.expires_on ? `. This link works until ${esc(m.expires_on)}` : ''}.</p>
${m.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.entries.map(entry).join('')}`).join('')}
${m.pets.length ? `<h2>Pets</h2>${m.pets.map(pet).join('')}` : ''}
${m.services.length ? `<h2>Links</h2>${services}` : ''}
${!m.sections.length && !m.pets.length && !m.services.length ? '<p>Nothing has been written here yet.</p>' : ''}
<p class="foot">Nothing on this page can be changed from here.${credit}</p></main></body></html>`;
}

export type ManualStore = ReturnType<typeof manual>;
