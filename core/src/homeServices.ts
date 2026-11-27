/**
 * Home services: links to the programs people run at home (a media server, a photos app, the router's page).
 *
 * The person in charge (an admin) keeps the list and chooses who sees each link: everyone, chosen people, or
 * only themselves. A link someone cannot see is not in anything they are sent: not the list, not search, not
 * their download, not their Home page. Each person pins the links they want on a card of their own Home page.
 *
 * Nothing is fetched: no logos, no checks that a program is running. A link is only an address that opens in
 * the person's own browser. There is no place for a password, and an address with one in it is refused.
 *
 * A link can be marked for guests. It then shows on the shared house manual, with only its away address (or,
 * when it has only an address that works at home, a line saying so).
 */
import type { Db, Queries } from './db.ts';
import { shown } from './displayName.ts';
import { Problem } from './problem.ts';
import { clean, stamp, type Clock } from './small.ts';

/** The icons a link may use: meanings from the app's own icon set (frontend/src/components/Icon.jsx). */
export const SERVICE_ICONS = ['link', 'media', 'film', 'show', 'music', 'book', 'game', 'photo', 'home', 'email', 'data', 'paper', 'phone', 'settings', 'bank', 'cart', 'assistant', 'weather', 'recipe', 'thing', 'scan', 'car', 'pet'] as const;
/** The colors a link may use: names from the app's palette (see frontend tailwind.config.js). */
export const SERVICE_COLORS = ['brown', 'plum', 'green', 'rust', 'orange', 'gold'] as const;
export type ServiceWho = 'everyone' | 'chosen' | 'me';
export type AddressAt = 'any' | 'home' | 'away';

export type ServiceInput = {
  name?: string | null;
  address?: string | null;
  address_at?: string | null;
  address2?: string | null;
  address2_at?: string | null;
  icon?: string | null;
  color?: string | null;
  group?: string | null;
  order?: number | null;
  note?: string | null;
  who?: string | null;
  people?: number[] | null;
  guests?: boolean | null;
};

export type ServiceView = {
  id: number;
  name: string;
  address: string;
  /** Where the first address works: anywhere, only at home, or only away. */
  address_at: AddressAt;
  address2: string | null;
  address2_at: 'home' | 'away' | null;
  icon: string;
  color: string;
  group: string | null;
  order: number;
  note: string | null;
  pinned: boolean;
  /** Who sees it, for the person in charge only (everyone else gets null: it is not theirs to know). */
  sharing: { who: ServiceWho; people: number[]; guests: boolean } | null;
};
export type ServiceList = {
  /** Whether the viewer is the person in charge: the one who adds and changes links. */
  can_change: boolean;
  services: ServiceView[];
  /** The people a link can be chosen for (everyone but the person in charge). Only the person in charge is sent this. */
  people: { id: number; name: string }[];
  icons: readonly string[];
  colors: readonly string[];
};
/** What the shared house manual shows of a link: nothing but its name, note and the address that works away from home. */
export type SharedService = { name: string; group: string | null; note: string | null; address: string | null; only_at_home: boolean };

type Row = {
  id: number; name: string; url: string; url_at: AddressAt; url2: string | null; url2_at: 'home' | 'away' | null; icon: string; color: string;
  grp: string | null; sort_order: number; note: string | null; who: ServiceWho; guests: number;
};
const COLUMNS = 's.id, s.name, s.url, s.url_at, s.url2, s.url2_at, s.icon, s.color, s.grp, s.sort_order, s.note, s.who, s.guests';
const MAX_SERVICES = 200;

async function isAdmin(q: Queries, user: number): Promise<boolean> {
  return Boolean(await q.get('SELECT 1 AS yes FROM users WHERE id = ? AND is_admin = 1', [user]));
}

/** The links a person may see, in order: the person in charge sees all; anyone else, the ones for everyone and the ones chosen for them. */
export async function servicesSeenBy(q: Queries, user: number): Promise<Row[]> {
  const admin = await isAdmin(q, user);
  return admin
    ? q.all<Row>(`SELECT ${COLUMNS} FROM home_services s ORDER BY s.sort_order, s.id`)
    : q.all<Row>(`SELECT ${COLUMNS} FROM home_services s
        WHERE s.who = 'everyone' OR (s.who = 'chosen' AND EXISTS (SELECT 1 FROM home_service_people p WHERE p.service_id = s.id AND p.user_id = ?))
        ORDER BY s.sort_order, s.id`, [user]);
}

/** The usernames a link is chosen for, for the download. */
export async function chosenNames(q: Queries, serviceId: number): Promise<string[]> {
  return (await q.all<{ username: string }>('SELECT u.username FROM home_service_people p JOIN users u ON u.id = p.user_id WHERE p.service_id = ? ORDER BY u.username', [serviceId])).map((r) => r.username);
}

/** What the shared house manual shows for a person who shares it: links marked for guests that this person may see. */
export async function guestServices(q: Queries, sharer: number): Promise<SharedService[]> {
  return (await servicesSeenBy(q, sharer)).filter((s) => s.guests === 1).map((s) => {
    const away = s.url_at !== 'home' ? s.url : s.url2_at === 'away' ? s.url2 : null;
    return { name: s.name, group: s.grp, note: s.note, address: away, only_at_home: away === null };
  });
}

/** Words typed with no password in them, to open in a browser: http or https, and nothing like `user:secret@`. */
export function addressFrom(given: unknown, what = 'The address'): string {
  let text = typeof given === 'string' ? given.trim() : '';
  if (!text) throw new Problem(400, `${what} is needed`);
  if (text.length > 500 || /\s/.test(text)) throw new Problem(400, `${what} is too long or has a space in it`);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { throw new Problem(400, `${what} does not look like an address`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Problem(400, `${what} must start with http:// or https://`);
  if (!url.hostname) throw new Problem(400, `${what} does not look like an address`);
  if (url.username || url.password) throw new Problem(400, `${what} has a name and password in it. Leave passwords out of Life Is: sign in on the page itself`);
  return text;
}

const oneOf = <T extends string>(list: readonly T[], given: unknown, fallback: T, what: string): T => {
  if (given === undefined || given === null || given === '') return fallback;
  if (typeof given !== 'string' || !list.includes(given as T)) throw new Problem(400, `That is not a ${what} Life Is has`);
  return given as T;
};

export function homeServices(db: Db, user: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  async function admin(): Promise<boolean> { return isAdmin(db, user); }
  async function mustBeInCharge(): Promise<void> {
    if (!(await admin())) throw new Problem(403, 'Only the person in charge can add or change these links');
  }

  async function view(rows: Row[], inCharge: boolean): Promise<ServiceView[]> {
    const pinned = new Set((await db.all<{ service_id: number }>('SELECT service_id FROM home_service_pins WHERE user_id = ?', [user])).map((p) => p.service_id));
    const chosen = new Map<number, number[]>();
    if (inCharge) for (const p of await db.all<{ service_id: number; user_id: number }>('SELECT service_id, user_id FROM home_service_people ORDER BY user_id')) chosen.set(p.service_id, [...(chosen.get(p.service_id) ?? []), p.user_id]);
    return rows.map((r) => ({
      id: r.id, name: r.name, address: r.url, address_at: r.url_at, address2: r.url2, address2_at: r.url2_at, icon: r.icon, color: r.color,
      group: r.grp, order: r.sort_order, note: r.note, pinned: pinned.has(r.id),
      sharing: inCharge ? { who: r.who, people: chosen.get(r.id) ?? [], guests: r.guests === 1 } : null,
    }));
  }

  async function list(): Promise<ServiceList> {
    const inCharge = await admin();
    const people = inCharge
      ? await db.all<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM users u WHERE u.is_admin = 0 ORDER BY name COLLATE NOCASE, u.id`)
      : [];
    return { can_change: inCharge, services: await view(await servicesSeenBy(db, user), inCharge), people, icons: SERVICE_ICONS, colors: SERVICE_COLORS };
  }

  async function checked(input: ServiceInput, before?: Row) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Say what it is called');
    const url = addressFrom(input.address);
    let url_at = oneOf(['any', 'home', 'away'] as const, input.address_at, 'any', 'place for an address to work');
    let url2: string | null = null;
    let url2_at: 'home' | 'away' | null = null;
    if (input.address2 !== undefined && input.address2 !== null && String(input.address2).trim() !== '') {
      url2 = addressFrom(input.address2, 'The second address');
      url2_at = oneOf(['home', 'away'] as const, input.address2_at, 'away', 'place for an address to work');
      // With two, each says where it works, and they are not the same place.
      if (url_at === 'any') url_at = url2_at === 'home' ? 'away' : 'home';
      if (url_at === url2_at) throw new Problem(400, 'One address is for at home and the other for away');
    }
    const icon = oneOf(SERVICE_ICONS, input.icon, 'link', 'icon');
    const color = oneOf(SERVICE_COLORS, input.color, 'brown', 'color');
    const who = oneOf(['everyone', 'chosen', 'me'] as const, input.who, 'everyone', 'choice of who sees it');
    let order = input.order;
    if (order === undefined || order === null) order = before?.sort_order ?? ((await db.get<{ next: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM home_services'))!.next);
    if (!Number.isInteger(order) || order < 0 || order > 9999) throw new Problem(400, 'The order is a whole number from 0 to 9999');
    const people = who === 'chosen' ? [...new Set(input.people ?? [])] : [];
    for (const id of people) {
      if (!Number.isInteger(id) || !(await db.get('SELECT id FROM users WHERE id = ?', [id]))) throw new Problem(404, "That isn't one of the people here");
    }
    return { name, url, url_at, url2, url2_at, icon, color, grp: clean(input.group, 40), order, note: clean(input.note, 1000), who, people, guests: input.guests ? 1 : 0 };
  }

  async function savePeople(id: number, people: number[]): Promise<void> {
    await db.run('DELETE FROM home_service_people WHERE service_id = ?', [id]);
    for (const p of people) await db.run('INSERT INTO home_service_people (service_id, user_id) VALUES (?, ?)', [id, p]);
  }

  /** A link the person may see, or a "not found": a link hidden from someone does not exist for them. */
  async function seen(id: number): Promise<Row> {
    const row = (await servicesSeenBy(db, user)).find((s) => s.id === id);
    if (!row) throw new Problem(404, "That link isn't here anymore. It may have been deleted.");
    return row;
  }

  return {
    list,

    async create(input: ServiceInput): Promise<ServiceList> {
      await mustBeInCharge();
      const v = await checked(input);
      if ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM home_services'))!.n >= MAX_SERVICES) throw new Problem(400, `Home services holds ${MAX_SERVICES} links at most`);
      const made = await db.run(
        'INSERT INTO home_services (name, url, url_at, url2, url2_at, icon, color, grp, sort_order, note, who, guests, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [v.name, v.url, v.url_at, v.url2, v.url2_at, v.icon, v.color, v.grp, v.order, v.note, v.who, v.guests, user, now(), now()]);
      await savePeople(made.lastId, v.people);
      return list();
    },

    async update(id: number, input: ServiceInput): Promise<ServiceList> {
      await mustBeInCharge();
      const before = await seen(id);
      const v = await checked(input, before);
      await db.run('UPDATE home_services SET name = ?, url = ?, url_at = ?, url2 = ?, url2_at = ?, icon = ?, color = ?, grp = ?, sort_order = ?, note = ?, who = ?, guests = ?, updated_at = ? WHERE id = ?',
        [v.name, v.url, v.url_at, v.url2, v.url2_at, v.icon, v.color, v.grp, v.order, v.note, v.who, v.guests, now(), id]);
      await savePeople(id, v.people);
      // A link no longer for someone is no longer pinned by them either.
      if (v.who !== 'everyone') {
        await db.run(`DELETE FROM home_service_pins WHERE service_id = ? AND user_id IN (SELECT id FROM users WHERE is_admin = 0)
          AND user_id NOT IN (SELECT user_id FROM home_service_people WHERE service_id = ?)`, [id, id]);
      }
      return list();
    },

    async remove(id: number): Promise<ServiceList> {
      await mustBeInCharge();
      await seen(id);
      await db.run('DELETE FROM home_services WHERE id = ?', [id]);
      return list();
    },

    /** Put a link on the person's own Home page. */
    async pin(id: number): Promise<ServiceList> {
      await seen(id);
      await db.run('INSERT OR IGNORE INTO home_service_pins (user_id, service_id, created_at) VALUES (?, ?, ?)', [user, id, now()]);
      return list();
    },

    async unpin(id: number): Promise<ServiceList> {
      await db.run('DELETE FROM home_service_pins WHERE user_id = ? AND service_id = ?', [user, id]);
      return list();
    },

    /** The links the person pinned and may still see, for the Home card. */
    async pinned(): Promise<ServiceView[]> {
      return (await list()).services.filter((s) => s.pinned);
    },
  };
}
