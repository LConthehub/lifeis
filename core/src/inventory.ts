/**
 * The things you keep: fabric, yarn, tools, seeds, anything.
 *
 * Nothing here knows what a "fabric" is. A person makes their own kinds of things and gives each kind the
 * fields they care about (a fabric's width, a seed packet's sow-by date), or starts from a ready-made set
 * (starters.ts) and changes it. Each thing has a name, an amount if it has one (3 yd, 12, or just "some"), a
 * place (a room, a shelf in it, a bin on the shelf), and a value for each of its kind's fields.
 *
 * Projects (projects.ts) set amounts aside. What is "free" is what you have, less what unfinished projects
 * have set aside.
 *
 * `inventory(db, owner)` is one person's things: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { physicalCopies, type PhysicalCopy } from './collectionThings.ts';
import { shown } from './displayName.ts';
import { historyOf, noteHistory, noteMove, placePath, type HistoryEntry } from './history.ts';
import { Problem } from './problem.ts';
import { attachTags, onlyTagged, unlink, type TagRef } from './tags.ts';
import { clean, dayNumber, dayOrNull, inOrder, labelKey, pictureType, rounded, stamp, todayOf, type Clock } from './small.ts';
import { STARTERS, groupOfKind, guardOfKindName, type Starter } from './starters.ts';
import * as units from './units.ts';

export const FIELD_TYPES = ['text', 'number', 'choice', 'yesno', 'date', 'link'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** Projects in these states have their amounts set aside for them. */
export const HOLDING = ['planned', 'active', 'paused'] as const;

const MAX_FIELDS = 40;
const MAX_CHOICES = 60;
const MAX_DEPTH = 10;
const MAX_OWN_FIELDS = 30;

export type FieldInput = { name: string; type: FieldType; unit?: string | null; choices?: string[] };
export type Field = { id: number; kind_id: number; name: string; type: FieldType; unit: string | null; choices: string[]; sort_order: number };
/** What makes a kind private: guns ('firearm') and ammunition ('ammo'). Its things are the person's alone, and shared only with people they pick. */
export type Guard = 'firearm' | 'ammo';
export type Kind = {
  id: number; name: string; icon: string | null; unit: string | null; fields: Field[]; items: number;
  /** The heading it sits under on the things page ("Cooking", "Crafts"), worked out from its name; null for one of the person's own. */
  group: string | null;
  /** The activity its things are usually for ("Sewing"): a new thing of this kind starts out with it. Null when none. */
  activity: string | null;
  /** Set for a kind of private things (guns, ammunition); null for every other kind. */
  guard: Guard | null;
};
export type KindInput = { name: string; icon?: string | null; unit?: string | null; activity?: string | null; fields?: FieldInput[]; guard?: Guard | null };

export type Place = { id: number; parent_id: number | null; name: string; note: string | null; path: string; items: number };
export type PlaceInput = { name: string; parent_id?: number | null; note?: string | null };

export type FieldValue = string | number | boolean;
export type ItemInput = {
  kind_id: number;
  name: string;
  /** Left out: "I have some". */
  quantity?: number | null;
  unit?: string | null;
  place_id?: number | null;
  low_at?: number | null;
  note?: string | null;
  /** A value for each field, by the field's id. Left out or empty: no value. */
  values?: Record<string, unknown>;
  /** The barcode printed on it or its box. Left out: unchanged. */
  barcode?: string | null;
  /** A Life Is sticker's code, from a blank sticker scanned for a new thing. Only when making one. */
  code?: string | null;
  /** What it's for: Sewing, Camping. Left out: unchanged. */
  activities?: string[];
  /** Its home records. Left out: unchanged; a field left out of it: unchanged. */
  records?: RecordsInput;
  /** Whether it is insured. Left out: unchanged (a new thing is not). */
  insured?: boolean;
  /** The person's own fields on this thing, in order. Left out: unchanged; a list replaces the ones it had. */
  own_fields?: { name: string; value: string }[];
};
/** How a thing went: sold, given away, thrown out, stolen. A later feature (guns) may take more. */
export const GONE_HOW = ['sold', 'given', 'thrown', 'stolen'] as const;
export type GoneHow = (typeof GONE_HOW)[number];
export type Gone = { on: string; how: string; to: string | null; cents: number | null };
export type GoneInput = { how: string; day?: string | null; to?: string | null; price_cents?: number | null };
export type OwnField = { name: string; value: string };
/** An asset number as it is written: 1 is 000-001, 1234 is 001-234. */
export const assetLabel = (n: number): string => `${String(Math.floor(n / 1000)).padStart(3, '0')}-${String(n % 1000).padStart(3, '0')}`;
/** The number out of what was typed ("000-012", "0-12"), or null when it isn't one. */
export function assetNumber(read: string): number | null {
  const m = /^(\d{1,6})-(\d{1,3})$/.exec(read.trim());
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
}
/** What a thing cost and where it came from, the numbers that identify it, its warranty and what it's worth. */
export type Records = {
  bought_on: string | null; bought_at: string | null; price_cents: number | null; value_cents: number | null;
  serial: string | null; model: string | null; warranty_until: string | null;
};
export type RecordsInput = Partial<Records>;
export const DOCUMENT_KINDS = ['receipt', 'manual', 'warranty', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type ItemDocument = { id: number; item_id: number; kind: DocumentKind; name: string; type: string; size: number; created_at: string };
export const MAX_DOCUMENT = 12_000_000;
const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export type Item = {
  id: number;
  tag_list: TagRef[];
  kind_id: number;
  kind: string;
  icon: string | null;
  /** 'firearm' or 'ammo' when it is one of the person's private things; null otherwise. */
  guard: Guard | null;
  /** For a private thing: whether a serial number is kept. In a list it is never in `records`; it comes with the thing itself. */
  serial_kept: boolean;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** "3 yd", "12", or "some". */
  amount: string;
  place_id: number | null;
  /** "Sewing room › Shelf 2 › Bin A" */
  place: string | null;
  low_at: number | null;
  low: boolean;
  note: string | null;
  values: Record<string, FieldValue>;
  /** How much unfinished projects have set aside, in this thing's unit. */
  set_aside: number;
  /** What's left for something new: what you have, less what's set aside. Null when no amount is known. */
  free: number | null;
  /** Its Life Is sticker's code, once it has one. */
  code: string | null;
  barcode: string | null;
  /** Whether a photo of it is kept: /api/things/items/:id/photo. */
  photo: boolean;
  activities: string[];
  records: Records;
  /** How many papers (receipts, manuals) are kept with it. */
  documents: number;
  /** Days until its warranty ends: below 0, it has. Null without one. */
  warranty_days: number | null;
  /** Its asset number, given in order the first time it is kept: "000-001". */
  asset_no: string;
  insured: boolean;
  /** When and how it went, if it did: it is then left out of the lists, but kept. Null for a thing that is here. */
  gone: Gone | null;
  /** The person's own fields on this thing. */
  own_fields: OwnField[];
  created_at: string;
  updated_at: string;
};

type KindRow = { id: number; name: string; icon: string | null; unit: string | null; activity: string | null; guard: Guard | null };
type FieldRow = Omit<Field, 'choices'> & { choices: string | null };
type PlaceRow = { id: number; parent_id: number | null; name: string; note: string | null };
/** A place and what its sticker carries. */
export type PlaceSticker = { id: number; name: string; path: string; code: string };

// Letters and digits that can't be mistaken for each other when read off a sticker: no 0/O, 1/I/L.
const CODE_LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 10;
function newCode(): string {
  const picks = new Uint8Array(CODE_LENGTH * 2);
  let code = '';
  while (code.length < CODE_LENGTH) {
    globalThis.crypto.getRandomValues(picks);
    // Numbers past the last whole run of the alphabet are passed over, so every letter is as likely as any other.
    for (const n of picks) if (n < 248 && code.length < CODE_LENGTH) code += CODE_LETTERS[n % CODE_LETTERS.length];
  }
  return code;
}

/**
 * The code out of whatever a scanner read from a sticker: the code itself, or a web address ending in /p/ and
 * the code, whatever address Life Is had when the sticker was printed. Null when it isn't a sticker.
 */
export function stickerCode(read: string): string | null {
  const m = /(?:^|\/p\/)([2-9A-HJ-NP-Za-hj-np-z]{10})\/?$/.exec(read.trim());
  return m ? m[1]!.toUpperCase() : null;
}
type ItemRow = Omit<Item, 'tag_list' | 'amount' | 'place' | 'low' | 'values' | 'set_aside' | 'free' | 'photo' | 'activities' | 'records' | 'serial_kept' | 'warranty_days' | 'asset_no' | 'insured' | 'gone' | 'own_fields'> & { photo: number } & Records
  & { asset_n: number; insured: number; gone_on: string | null; gone_how: string | null; gone_to: string | null; gone_cents: number | null };

/** The code out of a scanned thing's sticker: a web address ending in /t/ and the code. Null when it isn't one. */
export function thingStickerCode(read: string): string | null {
  const m = /\/t\/([2-9A-HJ-NP-Za-hj-np-z]{10})\/?$/.exec(read.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/** A barcode as it's kept: the digits and letters only, so "0 12345-67890 5" and "012345678905" are one. */
export const plainBarcode = (read: string | null | undefined): string | null => clean(read?.replace(/[^0-9A-Za-z]/g, '').toUpperCase(), 40);

/** Activity names as given, each once, without empty ones. */
function activityList(names: string[] | undefined): { name: string; key: string }[] {
  const out: { name: string; key: string }[] = [];
  for (const raw of names ?? []) {
    const name = clean(String(raw), 60);
    if (name && !out.some((a) => a.key === labelKey(name))) out.push({ name, key: labelKey(name) });
  }
  return out.slice(0, 20);
}

/**
 * The one way to write an activity typed several ways ("Sewing", "sewing", "SEWING"): the most used, and among
 * those, one written like a name (a capital, then small letters).
 */
function bestSpelling(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const named = (n: string) => (/^\p{Lu}[^\p{Lu}]*$/u.test(n) ? 1 : 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || named(b[0]) - named(a[0]))[0]![0];
}

/** The "room" of things with no place: not a real place, so it has no id of a place's. */
export const NO_ROOM = 0;
export type ReportLine = {
  id: number; name: string; kind: string; place: string | null; amount: string; quantity: number | null; photo: boolean; receipt: boolean;
  /** The room it sits under (its place's top-level place, however deep), or 0 for no place. */
  room_id: number;
  /** Where in the room: "Shelf 2 › Bin A"; null when it is in the room itself or has no place. */
  where: string | null;
  serial: string | null; model: string | null; bought_on: string | null; bought_at: string | null;
  price_cents: number | null; value_cents: number | null; /** What it's worth now if said, else what it cost. */ worth_cents: number; warranty_until: string | null;
  asset_no: string; insured: boolean;
  /** Set on a physical copy kept in the Collection (a disc, a record, a printed book): `id` is then minus the copy's id, and the line leads to its title. */
  collection?: { media_id: number; format: string };
};
export type CollectionThing = PhysicalCopy & { place: string | null };
export type ReportRoom = {
  id: number; name: string; things: number;
  /** What the things shown cost, in cents (those with no price count nothing). */ price_cents: number;
  /** What they are worth now, in cents: the value given, else what it cost. */ worth_cents: number;
  /** How many were counted at what they cost because no worth-now value was given. */ at_cost: number;
  with_photo: number; with_serial: number; with_receipt: number;
  /** How many have neither a price nor a value. */ unvalued: number;
  lines: ReportLine[];
};
/** What to leave out of the report. Left out: nothing is. */
export type ReportOptions = {
  /** Only these rooms (their place ids; 0 is "No place yet"). Null or left out: all. */
  rooms?: number[] | null;
  /** Only things worth at least this many cents. */
  min_cents?: number | null;
  /** Whether to keep things with no price or value. Default yes. */
  unvalued?: boolean;
  /** Only the things that are insured. Default: all of them. */
  insured_only?: boolean;
  /** Add the person's own guns and ammunition, with their serial numbers. Default: left out. Never anyone else's. */
  guns?: boolean;
};
export type HomeReport = {
  day: string;
  /** All of the household's things and what they are worth, whatever was chosen to leave out. */
  things: number; worth_cents: number; price_cents: number; /** How many have a price or a value. */ valued: number; unvalued: number;
  with_photo: number; with_receipt: number; with_serial: number; at_cost: number;
  /** How many of `things` are physical copies kept in the Collection (discs, records, printed books, cartridges). */
  collection_copies: number;
  /** How many of all of them are insured. */
  insured: number;
  /** What is in the report as chosen. */
  shown: { things: number; worth_cents: number; price_cents: number };
  /** Every room, chosen or not, for choosing among: with how many things lack a photo or a value. */
  choices: { id: number; name: string; things: number; incomplete: number; gaps: number }[];
  /** The room with the most still missing (a photo, a value or a serial number), if any real room has something missing. */
  neediest: { id: number; name: string; gaps: number } | null;
  rooms: ReportRoom[];
  /** Warranties ending in the next ninety days, soonest first. */
  warranties: { id: number; name: string; until: string; days_left: number }[];
};

/** Cents as plain dollars for a spreadsheet: 79900 is 799.00. Whole-number arithmetic, so nothing drifts. */
const plainDollars = (cents: number | null): string => (cents === null ? '' : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);

/** One spreadsheet field: quoted when it holds a comma, a quote or a line break; a leading = + @ (or - before a letter) is defused so Excel doesn't run it. */
function csvField(text: string): string {
  const safe = /^[=+@\t\r]|^-[^0-9.]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
export const CSV_COLUMNS = ['Room', 'Where exactly', 'What it is', 'Kind', 'Quantity', 'Make/model', 'Serial number', 'Bought on', 'Bought at',
  'Cost', 'Worth now', 'Warranty until', 'Has photo', 'Has receipt', 'Asset number', 'Insured'] as const;

export type ThingSticker = { id: number; name: string; place: string | null; code: string; asset_no: string };
export type ActivitySummary = { name: string; things: number; projects: number; jobs: number };
export const MAX_THING_PHOTO = 8_000_000;

const asField = (row: FieldRow): Field => ({ ...row, choices: row.choices ? (JSON.parse(row.choices) as string[]) : [] });

/** Each place's full path ("Sewing room › Shelf 2"), from the flat list of places. */
export function placePaths(places: PlaceRow[]): Map<number, string> {
  const byId = new Map(places.map((place) => [place.id, place]));
  const paths = new Map<number, string>();
  for (const place of places) {
    const names: string[] = [];
    for (let at: PlaceRow | undefined = place, steps = 0; at && steps <= MAX_DEPTH; steps += 1) {
      names.unshift(at.name);
      at = at.parent_id === null ? undefined : byId.get(at.parent_id);
    }
    paths.set(place.id, names.join(' › '));
  }
  return paths;
}

/**
 * How much of each thing unfinished projects have set aside, in the thing's own unit. A line whose unit can't
 * be compared with the thing's (cups of something kept by weight) sets nothing aside: it can't be worked out.
 * `exceptLine` leaves one project line out, to ask "what's there for this one?".
 */
export async function setAsideByItem(q: Queries, owner: number, exceptLine?: number): Promise<Map<number, number>> {
  const rows = await q.all<{ id: number; item_id: number; quantity: number; unit: string | null; item_unit: string | null }>(
    `SELECT l.id, l.item_id, l.quantity, l.unit, i.unit AS item_unit
     FROM project_items l JOIN projects p ON p.id = l.project_id JOIN items i ON i.id = l.item_id
     WHERE p.owner_id = ? AND p.status IN ('planned', 'active', 'paused') AND l.used_on IS NULL AND l.quantity IS NOT NULL`, [owner]);
  const total = new Map<number, number>();
  for (const row of rows) {
    if (row.id === exceptLine) continue;
    const same = units.convert(row.quantity, row.unit, row.item_unit);
    if (same !== null) total.set(row.item_id, (total.get(row.item_id) ?? 0) + same);
  }
  return total;
}

export function inventory(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  // ==================== KINDS AND THEIR FIELDS ====================

  async function kindRow(q: Queries, id: number): Promise<KindRow> {
    const row = await q.get<KindRow>('SELECT id, name, icon, unit, activity, guard FROM kinds WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, "That kind of thing isn't here anymore. It may have been deleted.");
    return row;
  }

  async function fieldsOf(q: Queries, kindId: number): Promise<Field[]> {
    return (await q.all<FieldRow>('SELECT id, kind_id, name, type, unit, choices, sort_order FROM kind_fields WHERE kind_id = ? ORDER BY sort_order, id', [kindId])).map(asField);
  }

  async function kinds(q: Queries): Promise<Kind[]> {
    const rows = await q.all<KindRow & { items: number }>(
      `SELECT k.id, k.name, k.icon, k.unit, k.activity, k.guard, (SELECT COUNT(*) FROM items i WHERE i.kind_id = k.id AND i.gone_on IS NULL) AS items
       FROM kinds k WHERE k.owner_id = ? ORDER BY k.name COLLATE NOCASE`, [owner]);
    const out: Kind[] = [];
    for (const row of rows) out.push({ ...row, group: groupOfKind(row.name), fields: await fieldsOf(q, row.id) });
    return out;
  }

  /** A field as it will be stored, checked. */
  function checkedField(input: FieldInput) {
    const name = clean(input.name, 60);
    if (!name) throw new Problem(400, 'Give the field a name');
    if (!FIELD_TYPES.includes(input.type)) throw new Problem(400, 'A field is text, a number, a choice, yes or no, a date, or a link');
    let choices: string[] = [];
    if (input.type === 'choice') {
      const seen = new Set<string>();
      for (const choice of input.choices ?? []) {
        const one = clean(choice, 60);
        if (one && !seen.has(labelKey(one))) {
          seen.add(labelKey(one));
          choices.push(one);
        }
      }
      if (choices.length === 0) throw new Problem(400, `Give "${name}" at least one choice`);
      choices = choices.slice(0, MAX_CHOICES);
    }
    return { name, key: labelKey(name), type: input.type, unit: input.type === 'number' ? clean(input.unit, 20) : null, choices: choices.length ? JSON.stringify(choices) : null };
  }

  async function addFieldIn(q: Queries, kindId: number, input: FieldInput): Promise<void> {
    const field = checkedField(input);
    const there = await q.all<{ key: string; sort_order: number }>('SELECT key, sort_order FROM kind_fields WHERE kind_id = ?', [kindId]);
    if (there.some((f) => f.key === field.key)) throw new Problem(409, `There's already a field called "${field.name}"`);
    if (there.length >= MAX_FIELDS) throw new Problem(400, `A kind can have up to ${MAX_FIELDS} fields`);
    const next = there.reduce((most, f) => Math.max(most, f.sort_order + 1), 0);
    await q.run('INSERT INTO kind_fields (kind_id, name, key, type, unit, choices, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [kindId, field.name, field.key, field.type, field.unit, field.choices, next]);
  }

  async function createKindIn(q: Queries, input: KindInput): Promise<number> {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give it a name');
    if (await q.get('SELECT id FROM kinds WHERE owner_id = ? AND key = ?', [owner, labelKey(name)])) {
      throw new Problem(409, `You already have a kind called "${name}"`);
    }
    // A kind called "Firearms" or "Ammunition" is private however it was made (by hand, from a download or from HomeBox).
    const guard = input.guard ?? guardOfKindName(name);
    const made = await q.run('INSERT INTO kinds (owner_id, name, key, icon, unit, activity, guard, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [owner, name, labelKey(name), clean(input.icon, 16), units.canonical(clean(input.unit, 20)), clean(input.activity, 60), guard, now()]);
    for (const field of input.fields ?? []) await addFieldIn(q, made.lastId, field);
    return made.lastId;
  }

  async function fieldRow(q: Queries, id: number): Promise<Field> {
    const row = await q.get<FieldRow>(
      `SELECT f.id, f.kind_id, f.name, f.type, f.unit, f.choices, f.sort_order FROM kind_fields f JOIN kinds k ON k.id = f.kind_id
       WHERE f.id = ? AND k.owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, "That field isn't here anymore. It may have been deleted.");
    return asField(row);
  }

  // ==================== PLACES ====================

  const placeRows = (q: Queries) => q.all<PlaceRow>('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]);

  async function places(q: Queries): Promise<Place[]> {
    const rows = await placeRows(q);
    const paths = placePaths(rows);
    const counts = new Map((await q.all<{ place_id: number; n: number }>(
      'SELECT place_id, COUNT(*) AS n FROM items WHERE owner_id = ? AND place_id IS NOT NULL AND gone_on IS NULL GROUP BY place_id', [owner])).map((r) => [r.place_id, r.n]));
    return rows
      .map((row) => ({ ...row, path: paths.get(row.id)!, items: counts.get(row.id) ?? 0 }))
      .sort((a, b) => inOrder(a.path.toLowerCase(), b.path.toLowerCase()));
  }

  /** The place's own columns, checked: its parent is one of the person's places, and not inside itself. */
  async function checkedPlace(q: Queries, input: PlaceInput, self?: number) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give the place a name');
    const parent = input.parent_id ?? null;
    if (parent !== null) {
      const byId = new Map((await placeRows(q)).map((row) => [row.id, row]));
      if (!byId.has(parent)) throw new Problem(404, "That place isn't there to put it in");
      let depth = 1;
      for (let at = byId.get(parent); at; at = at.parent_id === null ? undefined : byId.get(at.parent_id)) {
        if (at.id === self) throw new Problem(400, "A place can't be inside itself");
        depth += 1;
        if (depth > MAX_DEPTH) throw new Problem(400, `Places can be ${MAX_DEPTH} deep at most`);
      }
    }
    return { name, parent, note: clean(input.note, 500) };
  }

  // ==================== THINGS ====================

  /** What to store for a field's value, or null for no value. Says what's wrong in the person's words. */
  function storedValue(field: Field, raw: unknown): string | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const wrong = (what: string) => new Problem(400, `"${field.name}" ${what}`);
    switch (field.type) {
      case 'number': {
        const value = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : raw;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw wrong('is a number');
        return String(value);
      }
      case 'yesno':
        if (typeof raw !== 'boolean') throw wrong('is yes or no');
        return raw ? '1' : '0';
      case 'date':
        if (typeof raw !== 'string') throw wrong('is a day');
        dayNumber(raw);
        return raw;
      case 'choice': {
        const chosen = typeof raw === 'string' ? field.choices.find((choice) => labelKey(choice) === labelKey(raw)) : undefined;
        if (!chosen) throw wrong(`is one of: ${field.choices.join(', ')}`);
        return chosen;
      }
      default:
        if (typeof raw !== 'string') throw wrong('is text');
        return clean(raw, 2000);
    }
  }

  const shownValue = (type: FieldType, stored: string): FieldValue => (type === 'number' ? Number(stored) : type === 'yesno' ? stored === '1' : stored);

  async function saveValues(q: Queries, itemId: number, kindId: number, values: Record<string, unknown> | undefined) {
    const fields = new Map((await fieldsOf(q, kindId)).map((field) => [String(field.id), field]));
    for (const id of Object.keys(values ?? {})) {
      if (!fields.has(id)) throw new Problem(400, "One of those fields isn't part of this kind of thing");
    }
    await q.run('DELETE FROM item_values WHERE item_id = ?', [itemId]);
    for (const [id, field] of fields) {
      const stored = storedValue(field, values?.[id]);
      if (stored !== null) await q.run('INSERT INTO item_values (item_id, field_id, value) VALUES (?, ?, ?)', [itemId, field.id, stored]);
    }
  }

  /** Which things: the ones that are here (the usual), only the ones that have gone, or both. */
  type Which = 'here' | 'gone' | 'any';
  const whichSql = (which: Which) => (which === 'here' ? ' AND i.gone_on IS NULL' : which === 'gone' ? ' AND i.gone_on IS NOT NULL' : '');

  /**
   * The things asked for. A private thing's serial number is left out of lists (`reveal` false) and given with the one thing:
   * it is shown only when the person taps for it.
   */
  async function items(q: Queries, where = '', args: Value[] = [], which: Which = 'here', reveal = false): Promise<Item[]> {
    const rows = await q.all<ItemRow>(
      `SELECT i.id, i.kind_id, k.name AS kind, k.icon, k.guard AS guard, i.name, i.quantity, i.unit, i.place_id, i.low_at, i.note, i.code, i.barcode,
              i.bought_on, i.bought_at, i.price_cents, i.value_cents, i.serial, i.model, i.warranty_until,
              i.asset_no AS asset_n, i.insured, i.gone_on, i.gone_how, i.gone_to, i.gone_cents,
              (SELECT COUNT(*) FROM item_documents d WHERE d.item_id = i.id) AS documents,
              EXISTS (SELECT 1 FROM item_photos ph WHERE ph.item_id = i.id) AS photo, i.created_at, i.updated_at
       FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ?${whichSql(which)} ${where} ORDER BY i.name COLLATE NOCASE, i.id`, [owner, ...args]);
    const doing = new Map<number, string[]>();
    for (const row of await q.all<{ item_id: number; activity: string }>(
      'SELECT a.item_id, a.activity FROM item_activities a JOIN items i ON i.id = a.item_id WHERE i.owner_id = ? ORDER BY a.activity COLLATE NOCASE', [owner])) {
      doing.set(row.item_id, [...(doing.get(row.item_id) ?? []), row.activity]);
    }
    const paths = placePaths(await placeRows(q));
    const aside = await setAsideByItem(q, owner);
    const values = new Map<number, Record<string, FieldValue>>();
    for (const row of await q.all<{ item_id: number; field_id: number; type: FieldType; value: string }>(
      `SELECT v.item_id, v.field_id, f.type, v.value FROM item_values v JOIN kind_fields f ON f.id = v.field_id
       JOIN items i ON i.id = v.item_id WHERE i.owner_id = ?`, [owner])) {
      if (!values.has(row.item_id)) values.set(row.item_id, {});
      values.get(row.item_id)![String(row.field_id)] = shownValue(row.type, row.value);
    }
    const own = new Map<number, OwnField[]>();
    for (const row of await q.all<{ item_id: number; name: string; value: string }>(
      'SELECT f.item_id, f.name, f.value FROM item_fields f JOIN items i ON i.id = f.item_id WHERE i.owner_id = ? ORDER BY f.sort_order, f.id', [owner])) {
      own.set(row.item_id, [...(own.get(row.item_id) ?? []), { name: row.name, value: row.value }]);
    }
    const today = todayOf(clock);
    const tagged = await attachTags(q, owner, 'thing', rows);
    return tagged.map(({ bought_on, bought_at, price_cents, value_cents, serial, model, warranty_until, asset_n, insured, gone_on, gone_how, gone_to, gone_cents, ...row }) => {
      const setAside = rounded(aside.get(row.id) ?? 0, 4);
      return {
        ...row,
        records: { bought_on, bought_at, price_cents, value_cents, serial: row.guard && !reveal ? null : serial, model, warranty_until },
        serial_kept: Boolean(serial),
        asset_no: assetLabel(asset_n),
        insured: Boolean(insured),
        gone: gone_on ? { on: gone_on, how: gone_how ?? 'thrown', to: gone_to, cents: gone_cents } : null,
        own_fields: own.get(row.id) ?? [],
        warranty_days: warranty_until ? dayNumber(warranty_until) - dayNumber(today) : null,
        amount: row.quantity !== null ? units.amount(row.quantity, row.unit) : 'some',
        place: row.place_id !== null ? (paths.get(row.place_id) ?? null) : null,
        low: row.low_at !== null && row.quantity !== null && row.quantity <= row.low_at,
        values: values.get(row.id) ?? {},
        set_aside: setAside,
        free: row.quantity !== null ? rounded(Math.max(0, row.quantity - setAside), 4) : null,
        photo: Boolean(row.photo),
        activities: doing.get(row.id) ?? [],
      };
    });
  }

  async function item(q: Queries, id: number): Promise<Item> {
    const found = (await items(q, 'AND i.id = ?', [id], 'any', true))[0];
    if (!found) throw new Problem(404, "That thing isn't here anymore. It may have been deleted.");
    return found;
  }

  const when = () => ({ day: todayOf(clock), at: now() });

  async function saveActivities(q: Queries, itemId: number, names: string[] | undefined) {
    if (names === undefined) return;
    await q.run('DELETE FROM item_activities WHERE item_id = ?', [itemId]);
    for (const a of activityList(names)) await q.run('INSERT INTO item_activities (item_id, activity, key) VALUES (?, ?, ?)', [itemId, a.name, a.key]);
  }

  /** A thing's home records, checked and kept. Only the fields given change. */
  async function saveRecords(q: Queries, itemId: number, input: RecordsInput | undefined) {
    if (!input) return;
    const sets: string[] = [];
    const args: Value[] = [];
    const put = (column: keyof Records, value: Value) => { sets.push(`${column} = ?`); args.push(value); };
    for (const day of ['bought_on', 'warranty_until'] as const) {
      if (input[day] === undefined) continue;
      if (input[day] !== null && !dayOrNull(input[day])) throw new Problem(400, day === 'bought_on' ? 'Pick the day it was bought' : 'Pick the day its warranty ends');
      put(day, dayOrNull(input[day]));
    }
    for (const money of ['price_cents', 'value_cents'] as const) {
      if (input[money] === undefined) continue;
      const cents = input[money];
      if (cents !== null && !(Number.isInteger(cents) && cents >= 0 && cents < 1e12)) throw new Problem(400, 'An amount of money is 0 or more');
      put(money, cents);
    }
    if (input.bought_at !== undefined) put('bought_at', clean(input.bought_at, 120));
    if (input.serial !== undefined) put('serial', clean(input.serial, 120));
    if (input.model !== undefined) put('model', clean(input.model, 120));
    if (sets.length) await q.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, [...args, itemId]);
  }

  /** The person's own fields on a thing, checked and kept in the order given. Blank ones are dropped. */
  async function saveOwnFields(q: Queries, itemId: number, input: { name: string; value: string }[] | undefined) {
    if (input === undefined) return;
    if (!Array.isArray(input)) throw new Problem(400, 'Your own fields are a list of names with values');
    const kept: OwnField[] = [];
    for (const one of input) {
      const name = clean(String(one?.name ?? ''), 60);
      const value = clean(String(one?.value ?? ''), 2000);
      if (!name && !value) continue;
      if (!name) throw new Problem(400, 'Give each of your own fields a name');
      if (!value) throw new Problem(400, `Give "${name}" a value, or take the field away`);
      if (kept.some((f) => labelKey(f.name) === labelKey(name))) throw new Problem(409, `There's already a field called "${name}" on this`);
      kept.push({ name, value });
    }
    if (kept.length > MAX_OWN_FIELDS) throw new Problem(400, `A thing can have ${MAX_OWN_FIELDS} fields of your own at most`);
    await q.run('DELETE FROM item_fields WHERE item_id = ?', [itemId]);
    for (const [n, f] of kept.entries()) await q.run('INSERT INTO item_fields (item_id, name, value, sort_order) VALUES (?, ?, ?, ?)', [itemId, f.name, f.value, n]);
  }

  async function ownedItem(q: Queries, id: number): Promise<{ id: number; place_id: number | null; code: string | null }> {
    const row = await q.get<{ id: number; place_id: number | null; code: string | null }>('SELECT id, place_id, code FROM items WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, "That thing isn't here anymore. It may have been deleted.");
    return row;
  }

  /** A thing of a private kind that is the person's own, or 404: only these can be shared. */
  async function privateItem(q: Queries, id: number): Promise<void> {
    const row = await q.get<{ guard: string | null }>('SELECT k.guard FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.id = ? AND i.owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, "That thing isn't here anymore. It may have been deleted.");
    if (!row.guard) throw new Problem(400, 'Only guns and ammunition can be shared this way: other things stay with you');
  }

  /** The caliber or gauge typed on each ammunition record, by the thing's id. */
  async function ammoCalibers(): Promise<Map<number, string>> {
    return new Map((await db.all<{ item_id: number; value: string }>(
      `SELECT v.item_id, v.value FROM item_values v JOIN kind_fields f ON f.id = v.field_id JOIN items i ON i.id = v.item_id JOIN kinds k ON k.id = i.kind_id
       WHERE i.owner_id = ? AND k.guard = 'ammo' AND f.key = 'caliber or gauge' AND v.value != ''`, [owner])).map((r) => [r.item_id, r.value.trim()]));
  }

  /** A thing's own columns, checked, in the order the SQL below names them (after the kind). */
  async function itemValues(q: Queries, input: ItemInput, kind: KindRow): Promise<Value[]> {
    const name = clean(input.name, 200);
    if (!name) throw new Problem(400, 'Give it a name');
    if (input.quantity != null && !(input.quantity >= 0 && input.quantity < 1e9)) throw new Problem(400, 'The amount is 0 or more');
    if (input.low_at != null && !(input.low_at >= 0 && input.low_at < 1e9)) throw new Problem(400, '"Running low" is an amount, 0 or more');
    if (input.place_id != null && !(await q.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [input.place_id, owner]))) {
      throw new Problem(404, "That place isn't there to put it in");
    }
    const unit = units.canonical(clean(input.unit, 20)) ?? kind.unit;
    return [name, input.quantity ?? null, unit, input.place_id ?? null, input.low_at ?? null, clean(input.note, 5000)];
  }

  /**
   * The home report. A thing's room is the top-level place above the place it sits in, however deep: a bin on a
   * shelf in the sewing room is in the sewing room. All money is whole cents added as whole numbers.
   */
  async function homeReportIn(options: ReportOptions): Promise<HomeReport> {
    // Guns and ammunition are left out unless the person asks for them. Then only their own (items() only ever reads
    // this person's things), with serial numbers, since the report goes to an insurer.
    const all = await items(db, options.guns ? '' : 'AND k.guard IS NULL', [], 'here', Boolean(options.guns));
    const rows = await placeRows(db);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const roomOfPlace = (placeId: number | null): PlaceRow | null => {
      let at = placeId === null ? undefined : byId.get(placeId);
      for (let steps = 0; at && at.parent_id !== null && byId.has(at.parent_id) && steps <= MAX_DEPTH; steps += 1) at = byId.get(at.parent_id);
      return at ?? null;
    };
    const receipts = new Set((await db.all<{ item_id: number }>(
      "SELECT DISTINCT d.item_id FROM item_documents d JOIN items i ON i.id = d.item_id WHERE i.owner_id = ? AND d.kind = 'receipt'", [owner])).map((r) => r.item_id));
    const worth = (t: Item) => t.records.value_cents ?? t.records.price_cents ?? 0;
    const recorded = (t: Item) => t.records.value_cents !== null || t.records.price_cents !== null;
    const roomNames = new Map<number, string>([[NO_ROOM, 'No place yet']]);
    const lineOf = (t: Item): ReportLine => {
      const room = roomOfPlace(t.place_id);
      if (room) roomNames.set(room.id, room.name);
      const roomName = room?.name ?? '';
      return {
        id: t.id, name: t.name, kind: t.kind, place: t.place, amount: t.amount, quantity: t.quantity, photo: t.photo, receipt: receipts.has(t.id),
        room_id: room?.id ?? NO_ROOM,
        where: room && t.place && t.place !== roomName ? t.place.slice(roomName.length + 3) : null,
        serial: t.records.serial, model: t.records.model, bought_on: t.records.bought_on, bought_at: t.records.bought_at,
        price_cents: t.records.price_cents, value_cents: t.records.value_cents, worth_cents: worth(t), warranty_until: t.records.warranty_until,
        asset_no: t.asset_no, insured: t.insured,
      };
    };
    // Physical copies kept in the Collection count as things, by the room of the place they are kept in. Copies only on a
    // server never get here (see collectionThings.ts). A copy has no photo, serial number or receipt, so it adds nothing to
    // "gaps": there is nothing to walk through a room to fill in for it.
    const copies = await physicalCopies(db, owner);
    const pathsOf = placePaths(rows);
    const copyAsItem = (c: Awaited<ReturnType<typeof physicalCopies>>[number]): Item => ({
      id: -c.copy_id, name: c.title, kind: c.format, place_id: c.place_id, place: c.place_id !== null ? (pathsOf.get(c.place_id) ?? null) : null,
      amount: '1', quantity: 1, photo: false, insured: false, warranty_days: null, asset_no: '',
      records: { price_cents: c.cost_cents, value_cents: c.value_cents, serial: null, model: null, bought_on: null, bought_at: null, warranty_until: null },
    }) as unknown as Item;
    const copyOf = new Map<number, (typeof copies)[number]>(copies.map((c) => [-c.copy_id, c]));
    const copyItems = copies.map(copyAsItem);
    const everything = [...all, ...copyItems];
    const lines = everything.map((t) => {
      const line = lineOf(t);
      const copy = copyOf.get(t.id);
      return { t, line: copy ? { ...line, collection: { media_id: copy.media_id, format: copy.format } } : line };
    });
    const sum = (list: Item[], pick: (t: Item) => number) => list.reduce((n, t) => n + pick(t), 0);
    const missing = (t: Item) => (t.id < 0 ? 0 : Number(!t.photo) + Number(!recorded(t)) + Number(!t.records.serial));

    const grouped = new Map<number, typeof lines>();
    for (const one of lines) grouped.set(one.line.room_id, [...(grouped.get(one.line.room_id) ?? []), one]);
    const inOrderOfName = (a: { id: number; name: string }, b: { id: number; name: string }) =>
      Number(a.id === NO_ROOM) - Number(b.id === NO_ROOM) || a.name.localeCompare(b.name) || a.id - b.id;
    const choices = [...grouped.entries()].map(([id, list]) => ({
      id, name: roomNames.get(id)!, things: list.length,
      incomplete: list.filter(({ t }) => t.id > 0 && (!t.photo || !recorded(t))).length, gaps: sum(list.map(({ t }) => t), missing),
    })).sort(inOrderOfName);
    const needy = choices.filter((c) => c.id !== NO_ROOM && c.gaps > 0).sort((a, b) => b.gaps - a.gaps || inOrderOfName(a, b))[0];

    const chosen = options.rooms ? new Set(options.rooms) : null;
    const least = options.min_cents && options.min_cents > 0 ? options.min_cents : 0;
    const keep = ({ t, line }: (typeof lines)[number]) =>
      (!chosen || chosen.has(line.room_id)) && (options.unvalued !== false || recorded(t)) && worth(t) >= least && (!options.insured_only || t.insured);
    const rooms: ReportRoom[] = choices.map((c) => {
      const list = grouped.get(c.id)!.filter(keep);
      const things = list.map(({ t }) => t);
      return {
        id: c.id, name: c.name, things: list.length,
        price_cents: sum(things, (t) => t.records.price_cents ?? 0), worth_cents: sum(things, worth),
        at_cost: things.filter((t) => t.records.value_cents === null && t.records.price_cents !== null).length,
        with_photo: things.filter((t) => t.photo).length, with_serial: things.filter((t) => t.records.serial).length,
        with_receipt: things.filter((t) => receipts.has(t.id)).length, unvalued: things.filter((t) => !recorded(t)).length,
        lines: list.map(({ line }) => line).sort((a, b) => b.worth_cents - a.worth_cents || a.name.localeCompare(b.name) || a.id - b.id),
      };
    }).filter((room) => room.things > 0);

    return {
      day: todayOf(clock),
      things: everything.length, worth_cents: sum(everything, worth), price_cents: sum(everything, (t) => t.records.price_cents ?? 0),
      valued: everything.filter(recorded).length, unvalued: everything.filter((t) => !recorded(t)).length,
      with_photo: everything.filter((t) => t.photo).length, with_receipt: everything.filter((t) => receipts.has(t.id)).length,
      with_serial: everything.filter((t) => t.records.serial).length, insured: everything.filter((t) => t.insured).length,
      at_cost: everything.filter((t) => t.records.value_cents === null && t.records.price_cents !== null).length,
      shown: { things: rooms.reduce((n, r) => n + r.things, 0), worth_cents: rooms.reduce((n, r) => n + r.worth_cents, 0), price_cents: rooms.reduce((n, r) => n + r.price_cents, 0) },
      collection_copies: copies.length,
      choices, neediest: needy ? { id: needy.id, name: needy.name, gaps: needy.gaps } : null,
      rooms,
      warranties: all.filter((t) => t.warranty_days !== null && t.warranty_days >= 0 && t.warranty_days <= 90)
        .sort((a, b) => a.warranty_days! - b.warranty_days!).map((t) => ({ id: t.id, name: t.name, until: t.records.warranty_until!, days_left: t.warranty_days! })),
    };
  }

  return {
    // ---------- kinds ----------

    listKinds: () => kinds(db),

    /** A new kind of thing, with the fields given. */
    createKind(input: KindInput): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        await createKindIn(tx, input);
        return kinds(tx);
      });
    },

    /** Rename a kind, or change its picture or the unit new things of it start with. */
    updateKind(id: number, input: { name?: string | null; icon?: string | null; unit?: string | null; activity?: string | null }): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        const row = await kindRow(tx, id);
        const name = clean(input.name, 80) ?? row.name;
        if (await tx.get('SELECT id FROM kinds WHERE owner_id = ? AND key = ? AND id != ?', [owner, labelKey(name), id])) {
          throw new Problem(409, `You already have a kind called "${name}"`);
        }
        await tx.run('UPDATE kinds SET name = ?, key = ?, icon = ?, unit = ?, activity = ? WHERE id = ?', [
          name, labelKey(name), input.icon !== undefined ? clean(input.icon, 16) : row.icon,
          input.unit !== undefined ? units.canonical(clean(input.unit, 20)) : row.unit,
          input.activity !== undefined ? clean(input.activity, 60) : row.activity, id]);
        return kinds(tx);
      });
    },

    /**
     * Add the kind's activity to the things of this kind that don't have it. Things already doing other
     * activities keep them; one that has it is left alone, so doing it twice changes nothing. Returns how many
     * things gained it.
     */
    applyKindActivity(id: number): Promise<{ added: number }> {
      return atomic(db, async (tx) => {
        const row = await kindRow(tx, id);
        const name = clean(row.activity, 60);
        if (!name) throw new Problem(400, "This kind of thing isn't set to be for an activity yet");
        const lacking = await tx.all<{ id: number }>(
          `SELECT i.id FROM items i WHERE i.kind_id = ? AND i.owner_id = ?
           AND NOT EXISTS (SELECT 1 FROM item_activities a WHERE a.item_id = i.id AND a.key = ?)
           AND (SELECT COUNT(*) FROM item_activities a WHERE a.item_id = i.id) < 20`, [id, owner, labelKey(name)]);
        for (const one of lacking) await tx.run('INSERT INTO item_activities (item_id, activity, key) VALUES (?, ?, ?)', [one.id, name, labelKey(name)]);
        return { added: lacking.length };
      });
    },

    /** Remove a kind. Its things have to be moved or removed first: a thing is never deleted behind your back. */
    deleteKind(id: number): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        await kindRow(tx, id);
        const count = (await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE kind_id = ?', [id]))!.n;
        if (count > 0) {
          const here = (await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE kind_id = ? AND gone_on IS NULL', [id]))!.n;
          throw new Problem(409, here === 0 ? 'Things of this kind that you no longer have are still kept. Remove them first'
            : `Remove ${count === 1 ? 'the one thing' : `the ${count} things`} of this kind first`);
        }
        await tx.run('DELETE FROM kinds WHERE id = ?', [id]);
        return kinds(tx);
      });
    },

    addField(kindId: number, input: FieldInput): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        await kindRow(tx, kindId);
        await addFieldIn(tx, kindId, input);
        return kinds(tx);
      });
    },

    /**
     * Rename a field, change its unit or choices, or move it (sort_order). What kind of field it is can't
     * change: the values already typed in wouldn't fit. Taking a choice away leaves things that had it as they are.
     */
    updateField(id: number, input: { name?: string | null; unit?: string | null; choices?: string[]; sort_order?: number | null }): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        const before = await fieldRow(tx, id);
        const field = checkedField({
          name: clean(input.name, 60) ?? before.name, type: before.type,
          unit: input.unit !== undefined ? input.unit : before.unit, choices: input.choices ?? before.choices,
        });
        if (await tx.get('SELECT id FROM kind_fields WHERE kind_id = ? AND key = ? AND id != ?', [before.kind_id, field.key, id])) {
          throw new Problem(409, `There's already a field called "${field.name}"`);
        }
        const order = input.sort_order != null && Number.isInteger(input.sort_order) ? input.sort_order : before.sort_order;
        await tx.run('UPDATE kind_fields SET name = ?, key = ?, unit = ?, choices = ?, sort_order = ? WHERE id = ?',
          [field.name, field.key, field.unit, field.choices, order, id]);
        return kinds(tx);
      });
    },

    /** Remove a field, and what was typed into it on every thing of its kind. */
    deleteField(id: number): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        await fieldRow(tx, id);
        await tx.run('DELETE FROM kind_fields WHERE id = ?', [id]);
        return kinds(tx);
      });
    },

    // ---------- starters ----------

    /** The ready-made sets, and for each of their kinds whether the person already has one by that name. */
    async listStarters(): Promise<(Omit<Starter, 'kinds'> & { kinds: { name: string; icon: string; fields: string[]; have: boolean }[] })[]> {
      const have = new Set((await db.all<{ key: string }>('SELECT key FROM kinds WHERE owner_id = ?', [owner])).map((row) => row.key));
      return STARTERS.map((starter) => ({
        ...starter,
        kinds: starter.kinds.map((kind) => ({ name: kind.name, icon: kind.icon, fields: kind.fields.map((f) => f.name), have: have.has(labelKey(kind.name)) })),
      }));
    },

    /** Add a ready-made set's kinds. Kinds the person already has by that name are left exactly as they are. */
    async addStarter(slug: string): Promise<Kind[]> {
      const starter = STARTERS.find((one) => one.slug === slug);
      if (!starter) throw new Problem(404, "That ready-made set isn't one Life Is has.");
      return atomic(db, async (tx) => {
        for (const kind of starter.kinds) {
          if (!(await tx.get('SELECT id FROM kinds WHERE owner_id = ? AND key = ?', [owner, labelKey(kind.name)]))) await createKindIn(tx, kind);
        }
        return kinds(tx);
      });
    },

    // ---------- places ----------

    listPlaces: () => places(db),

    createPlace(input: PlaceInput): Promise<Place[]> {
      return atomic(db, async (tx) => {
        const place = await checkedPlace(tx, input);
        await tx.run('INSERT INTO places (owner_id, parent_id, name, note, created_at) VALUES (?, ?, ?, ?, ?)', [owner, place.parent, place.name, place.note, now()]);
        return places(tx);
      });
    },

    /** Every place with the code its sticker carries. A place that has none yet is given one, and keeps it. */
    stickers(): Promise<PlaceSticker[]> {
      return atomic(db, async (tx) => {
        for (const row of await tx.all<{ id: number }>('SELECT id FROM places WHERE owner_id = ? AND code IS NULL', [owner])) {
          await tx.run('UPDATE places SET code = ? WHERE id = ?', [newCode(), row.id]);
        }
        const codes = new Map((await tx.all<{ id: number; code: string }>('SELECT id, code FROM places WHERE owner_id = ?', [owner])).map((r) => [r.id, r.code]));
        return (await places(tx)).map(({ id, name, path }) => ({ id, name, path, code: codes.get(id)! }));
      });
    },

    /** The place a scanned sticker belongs to. Only ever one of the person's own. */
    async placeForSticker(read: string): Promise<{ id: number; name: string; path: string }> {
      const code = stickerCode(read);
      const row = code ? await db.get<{ id: number }>('SELECT id FROM places WHERE owner_id = ? AND code = ?', [owner, code]) : undefined;
      const place = row ? (await places(db)).find((p) => p.id === row.id) : undefined;
      if (!place) throw new Problem(404, "That isn't the sticker of one of your places");
      return { id: place.id, name: place.name, path: place.path };
    },

    /** Rename a place, or move it (and everything in it) into another. */
    updatePlace(id: number, input: PlaceInput): Promise<Place[]> {
      return atomic(db, async (tx) => {
        if (!(await tx.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, "That place isn't here anymore. It may have been deleted.");
        const place = await checkedPlace(tx, input, id);
        await tx.run('UPDATE places SET parent_id = ?, name = ?, note = ? WHERE id = ?', [place.parent, place.name, place.note, id]);
        return places(tx);
      });
    },

    /** Remove a place. What was in it stays yours, with no place; places inside it move up to where it was. */
    deletePlace(id: number): Promise<Place[]> {
      return atomic(db, async (tx) => {
        const row = await tx.get<PlaceRow>('SELECT id, parent_id, name, note FROM places WHERE id = ? AND owner_id = ?', [id, owner]);
        if (row) {
          await tx.run('UPDATE places SET parent_id = ? WHERE parent_id = ?', [row.parent_id, id]);
          await tx.run('DELETE FROM places WHERE id = ?', [id]);
        }
        return places(tx);
      });
    },

    // ---------- things ----------

    /** The person's things: all of them, or of one kind, in one place (and the places inside it), or matching some words. */
    async listItems(find: { kind_id?: number | null; place_id?: number | null; q?: string | null; low?: boolean; tag?: number | null; gone?: boolean; guarded?: boolean } = {}): Promise<Item[]> {
      // Private things (guns, ammunition) are only here when asked for: the Things page asks, nothing else does.
      let where = find.guarded ? '' : ' AND k.guard IS NULL';
      const args: Value[] = [];
      if (find.kind_id != null) {
        where += ' AND i.kind_id = ?';
        args.push(find.kind_id);
      }
      if (find.q?.trim()) {
        const like = `%${find.q.trim()}%`;
        // The asset number is found as it is written (000-012), whole or in part.
        where += ` AND (i.name LIKE ? OR i.note LIKE ? OR i.id IN (SELECT item_id FROM item_values WHERE value LIKE ?)
          OR i.id IN (SELECT item_id FROM item_fields WHERE name LIKE ? OR value LIKE ?)
          OR printf('%03d-%03d', i.asset_no / 1000, i.asset_no % 1000) LIKE ?)`;
        args.push(like, like, like, like, like, like);
      }
      let found = await items(db, where, args, find.gone ? 'gone' : 'here');
      if (find.place_id != null) {
        const rows = await placeRows(db);
        const inside = new Set<number>([find.place_id]);
        for (let grew = true; grew;) {
          grew = false;
          for (const row of rows) {
            if (row.parent_id !== null && inside.has(row.parent_id) && !inside.has(row.id)) {
              inside.add(row.id);
              grew = true;
            }
          }
        }
        found = found.filter((one) => one.place_id !== null && inside.has(one.place_id));
      }
      found = await onlyTagged(db, owner, 'thing', found, find.tag);
      return find.low ? found.filter((one) => one.low) : found;
    },

    getItem: (id: number) => item(db, id),

    createItem(input: ItemInput): Promise<Item> {
      return atomic(db, async (tx) => {
        const kind = await kindRow(tx, input.kind_id);
        // A blank sticker scanned for something new: its code becomes this thing's, if nothing has it yet.
        let code: string | null = null;
        if (input.code != null) {
          code = thingStickerCode(`/t/${String(input.code).trim()}`);
          if (!code) throw new Problem(400, "That isn't a Life Is sticker's code");
          if (await tx.get('SELECT id FROM items WHERE code = ?', [code])) throw new Problem(409, 'That sticker is already on something');
        }
        const made = await tx.run(
          `INSERT INTO items (owner_id, kind_id, name, quantity, unit, place_id, low_at, note, code, barcode, insured, asset_no, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(asset_no), 0) + 1 FROM items WHERE owner_id = ?), ?, ?)`,
          [owner, kind.id, ...(await itemValues(tx, input, kind)), code, plainBarcode(input.barcode), input.insured ? 1 : 0, owner, now(), now()]);
        await saveValues(tx, made.lastId, kind.id, input.values);
        // Nothing said it's for: it's for what its kind is for.
        await saveActivities(tx, made.lastId, input.activities?.some((a) => clean(String(a), 60)) ? input.activities : kind.activity ? [kind.activity] : input.activities);
        await saveRecords(tx, made.lastId, input.records);
        await saveOwnFields(tx, made.lastId, input.own_fields);
        await noteHistory(tx, owner, { item_id: made.lastId }, { what: 'added', to_place: await placePath(tx, owner, input.place_id), ...when() });
        return item(tx, made.lastId);
      });
    },

    /** Change a thing. Its kind stays what it is: another kind has other fields. */
    updateItem(id: number, input: Omit<ItemInput, 'kind_id'>): Promise<Item> {
      return atomic(db, async (tx) => {
        const before = await item(tx, id);
        const kind = await kindRow(tx, before.kind_id);
        await tx.run('UPDATE items SET name = ?, quantity = ?, unit = ?, place_id = ?, low_at = ?, note = ?, updated_at = ? WHERE id = ?',
          [...(await itemValues(tx, { ...input, kind_id: kind.id }, kind)), now(), id]);
        if (input.barcode !== undefined) await tx.run('UPDATE items SET barcode = ? WHERE id = ?', [plainBarcode(input.barcode), id]);
        await saveValues(tx, id, kind.id, input.values);
        await saveActivities(tx, id, input.activities);
        await saveRecords(tx, id, input.records);
        if (input.insured !== undefined) await tx.run('UPDATE items SET insured = ? WHERE id = ?', [input.insured ? 1 : 0, id]);
        await saveOwnFields(tx, id, input.own_fields);
        await noteMove(tx, owner, { item_id: id }, before.place_id, input.place_id ?? null, when());
        return item(tx, id);
      });
    },

    /**
     * "No longer have it": sold, given away, thrown out or stolen, on a day, to whom (free words) and for how much.
     * The thing leaves the lists, the search and the totals but is kept, and can be taken back.
     */
    letGo(id: number, input: GoneInput): Promise<Item> {
      return atomic(db, async (tx) => {
        const before = await item(tx, id);
        if (before.gone) throw new Problem(409, 'That is already marked as gone');
        if (!GONE_HOW.includes(input.how as GoneHow)) throw new Problem(400, 'Pick one: sold, given away, thrown out or stolen.');
        if (input.day != null && input.day !== '' && !dayOrNull(input.day)) throw new Problem(400, 'Pick the day it went');
        const cents = input.price_cents ?? null;
        if (cents !== null && !(Number.isInteger(cents) && cents >= 0 && cents < 1e12)) throw new Problem(400, 'An amount of money is 0 or more');
        await tx.run('UPDATE items SET gone_on = ?, gone_how = ?, gone_to = ?, gone_cents = ?, updated_at = ? WHERE id = ?',
          [dayOrNull(input.day) ?? todayOf(clock), input.how, clean(input.to, 200), cents, now(), id]);
        return item(tx, id);
      });
    },

    /** Undo "no longer have it": the thing is back in the lists, where it was. */
    takeBack(id: number): Promise<Item> {
      return atomic(db, async (tx) => {
        await ownedItem(tx, id);
        await tx.run('UPDATE items SET gone_on = NULL, gone_how = NULL, gone_to = NULL, gone_cents = NULL, updated_at = ? WHERE id = ?', [now(), id]);
        return item(tx, id);
      });
    },

    /** Put a thing somewhere else (or nowhere), keeping where it was in its history. */
    moveItem(id: number, placeId: number | null, note?: string | null): Promise<Item> {
      return atomic(db, async (tx) => {
        const before = await ownedItem(tx, id);
        if (placeId !== null && !(await tx.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [placeId, owner]))) {
          throw new Problem(404, "That place isn't there to put it in");
        }
        if (await noteMove(tx, owner, { item_id: id }, before.place_id, placeId, when(), note)) {
          await tx.run('UPDATE items SET place_id = ?, updated_at = ? WHERE id = ?', [placeId, now(), id]);
        }
        return item(tx, id);
      });
    },

    /** Everything that happened to a thing, newest first. */
    async itemHistory(id: number): Promise<HistoryEntry[]> {
      await ownedItem(db, id);
      return historyOf(db, owner, { item_id: id });
    },

    /** A time it was used: on a day, for a project or an activity, with a note. */
    logUse(id: number, input: { day?: string | null; project_id?: number | null; activity?: string | null; note?: string | null }): Promise<HistoryEntry[]> {
      return atomic(db, async (tx) => {
        await ownedItem(tx, id);
        let project: { id: number; name: string; activity: string | null } | undefined;
        if (input.project_id != null) {
          project = await tx.get('SELECT id, name, activity FROM projects WHERE id = ? AND owner_id = ?', [input.project_id, owner]);
          if (!project) throw new Problem(404, "That project isn't there");
        }
        if (input.day != null && !dayOrNull(input.day)) throw new Problem(400, 'Pick a day');
        await noteHistory(tx, owner, { item_id: id }, {
          what: 'used', day: dayOrNull(input.day) ?? todayOf(clock), at: now(), project_id: project?.id ?? null, project: project?.name ?? null,
          activity: clean(input.activity, 60) ?? project?.activity ?? null, note: input.note,
        });
        return historyOf(tx, owner, { item_id: id });
      });
    },

    /** Take back one recorded use of a thing (only a "used" entry; moves and the rest stay). */
    undoUse(historyId: number): Promise<HistoryEntry[]> {
      return atomic(db, async (tx) => {
        const found = await tx.get<{ item_id: number }>("SELECT h.item_id FROM item_history h JOIN items i ON i.id = h.item_id WHERE h.id = ? AND h.owner_id = ? AND i.owner_id = ? AND h.what = 'used'", [historyId, owner, owner]);
        if (!found) throw new Problem(404, "That entry isn't here anymore. It may have been deleted.");
        await tx.run('DELETE FROM item_history WHERE id = ?', [historyId]);
        return historyOf(tx, owner, { item_id: found.item_id });
      });
    },

    /** Keep a photo of it (JPEG, PNG or WebP), in place of any before. */
    async setPhoto(id: number, bytes: Uint8Array): Promise<Item> {
      const type = pictureType(bytes);
      if (!type) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_THING_PHOTO) throw new Problem(400, 'That photo is too large to keep');
      return atomic(db, async (tx) => {
        await ownedItem(tx, id);
        await tx.run('INSERT INTO item_photos (item_id, type, bytes) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET type = excluded.type, bytes = excluded.bytes', [id, type, bytes]);
        return item(tx, id);
      });
    },

    async photo(id: number): Promise<{ type: string; bytes: Uint8Array } | null> {
      await ownedItem(db, id);
      return (await db.get<{ type: string; bytes: Uint8Array }>('SELECT type, bytes FROM item_photos WHERE item_id = ?', [id])) ?? null;
    },

    async removePhoto(id: number): Promise<Item> {
      await ownedItem(db, id);
      await db.run('DELETE FROM item_photos WHERE item_id = ?', [id]);
      return item(db, id);
    },

    // ---------- papers: receipts, manuals, warranty cards ----------

    async documents(itemId: number): Promise<ItemDocument[]> {
      await ownedItem(db, itemId);
      return db.all<ItemDocument>('SELECT id, item_id, kind, name, type, LENGTH(bytes) AS size, created_at FROM item_documents WHERE item_id = ? ORDER BY id', [itemId]);
    },

    /** Keep a paper with a thing: a PDF or a photo of it. */
    async addDocument(itemId: number, input: { kind: string; name: string; bytes: Uint8Array }): Promise<ItemDocument[]> {
      await ownedItem(db, itemId);
      if (!DOCUMENT_KINDS.includes(input.kind as DocumentKind)) throw new Problem(400, "Pick one: a receipt, a manual, a warranty or something else.");
      const starts = (...head: number[]) => head.every((b, i) => input.bytes[i] === b);
      const type = starts(0x25, 0x50, 0x44, 0x46) ? 'application/pdf' : pictureType(input.bytes);
      if (!type || !DOCUMENT_TYPES.includes(type)) throw new Problem(400, 'A paper is kept as a PDF or a photo (JPEG, PNG or WebP)');
      if (input.bytes.length > MAX_DOCUMENT) throw new Problem(400, 'That file is too large to keep (12 MB at most)');
      if ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM item_documents WHERE item_id = ?', [itemId]))!.n >= 20) throw new Problem(400, 'A thing can keep 20 papers at most');
      const name = clean(input.name, 120) ?? (input.kind === 'other' ? 'Paper' : input.kind[0]!.toUpperCase() + input.kind.slice(1));
      await db.run('INSERT INTO item_documents (item_id, kind, name, type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [itemId, input.kind, name, type, input.bytes, now()]);
      return this.documents(itemId);
    },

    async document(id: number): Promise<{ name: string; type: string; bytes: Uint8Array } | null> {
      return (await db.get<{ name: string; type: string; bytes: Uint8Array }>(
        'SELECT d.name, d.type, d.bytes FROM item_documents d JOIN items i ON i.id = d.item_id WHERE d.id = ? AND i.owner_id = ?', [id, owner])) ?? null;
    },

    async removeDocument(id: number): Promise<void> {
      await db.run('DELETE FROM item_documents WHERE id = ? AND item_id IN (SELECT id FROM items WHERE owner_id = ?)', [id, owner]);
    },

    /**
     * The home inventory, for an insurer or for peace of mind: everything kept, room by room, with what each
     * cost and is worth, its serial number, and whether there is a photo and a receipt to show for it.
     */
    homeReport: (options: ReportOptions = {}) => homeReportIn(options),

    /**
     * The physical copies in the Collection, as rows among things, for the Things page's Collection chip. A view: nothing is
     * copied out of the Collection. `total` is what the Things total adds with the chip on (copies, and what they are worth).
     */
    async collectionThings(): Promise<{ copies: CollectionThing[]; total: { copies: number; worth_cents: number; price_cents: number } }> {
      const paths = placePaths(await placeRows(db));
      const copies = (await physicalCopies(db, owner)).map((c) => ({ ...c, place: c.place_id !== null ? (paths.get(c.place_id) ?? null) : null }));
      return { copies, total: { copies: copies.length, worth_cents: copies.reduce((n, c) => n + c.worth_cents, 0), price_cents: copies.reduce((n, c) => n + (c.cost_cents ?? 0), 0) } };
    },

    /** The same, as a spreadsheet: one row for each thing, with a byte-order mark so Excel reads it as UTF-8. */
    async homeReportCsv(options: ReportOptions = {}): Promise<{ filename: string; text: string }> {
      const report = await homeReportIn(options);
      const rows: string[][] = [[...CSV_COLUMNS]];
      for (const room of report.rooms) {
        for (const l of room.lines) {
          rows.push([room.name, l.where ?? "", l.name, l.kind, l.amount, l.model ?? "", l.serial ?? "", l.bought_on ?? "", l.bought_at ?? "",
            plainDollars(l.price_cents), plainDollars(l.value_cents ?? l.price_cents), l.warranty_until ?? "", l.photo ? "yes" : "no", l.receipt ? "yes" : "no", l.asset_no, l.insured ? "yes" : "no"]);
        }
      }
      return { filename: `home-inventory-${report.day}.csv`, text: '\uFEFF' + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n' };
    },

    /** Stickers for these things: each given a code the first time, and keeping it. */
    thingStickers(ids: number[]): Promise<ThingSticker[]> {
      return atomic(db, async (tx) => {
        const out: ThingSticker[] = [];
        for (const id of ids.slice(0, 500)) {
          const row = await ownedItem(tx, id);
          let code = row.code;
          while (!code) {
            const fresh = newCode();
            if (!(await tx.get('SELECT id FROM items WHERE code = ?', [fresh]))) { code = fresh; await tx.run('UPDATE items SET code = ? WHERE id = ?', [code, id]); }
          }
          const thing = await item(tx, id);
          out.push({ id, name: thing.name, place: thing.place, code, asset_no: thing.asset_no });
        }
        return out;
      });
    },

    /** Codes for a sheet of blank stickers, to stick on first and say what each is on when it's scanned. */
    async blankCodes(count: number): Promise<string[]> {
      const out: string[] = [];
      while (out.length < Math.max(1, Math.min(count, 200))) {
        const code = newCode();
        if (!out.includes(code) && !(await db.get('SELECT id FROM items WHERE code = ?', [code]))) out.push(code);
      }
      return out;
    },

    /** The activities in use: those things are for, and those projects are, with how many of each. */
    async listActivities(): Promise<ActivitySummary[]> {
      const found = new Map<string, ActivitySummary & { spellings: string[] }>();
      const add = (name: string, which: 'things' | 'projects' | 'jobs') => {
        const key = labelKey(name);
        const one = found.get(key) ?? { name, things: 0, projects: 0, jobs: 0, spellings: [] };
        one[which] += 1;
        one.spellings.push(name);
        found.set(key, one);
      };
      for (const row of await db.all<{ activity: string }>('SELECT a.activity FROM item_activities a JOIN items i ON i.id = a.item_id WHERE i.owner_id = ?', [owner])) add(row.activity, 'things');
      for (const row of await db.all<{ activity: string }>("SELECT activity FROM projects WHERE owner_id = ? AND activity IS NOT NULL AND activity != ''", [owner])) add(row.activity, 'projects');
      for (const row of await db.all<{ activity: string }>("SELECT activity FROM upkeep_jobs WHERE owner_id = ? AND activity IS NOT NULL AND activity != ''", [owner])) add(row.activity, 'jobs');
      return [...found.values()].map(({ spellings, ...one }) => ({ ...one, name: bestSpelling(spellings) }))
        .sort((a, b) => inOrder(a.name.toLowerCase(), b.name.toLowerCase()));
    },

    /** One activity: the things for it, and its projects. */
    async activity(name: string): Promise<{ name: string; things: Item[]; projects: { id: number; name: string; status: string }[] }> {
      const key = labelKey(name);
      const things = await items(db, 'AND i.id IN (SELECT item_id FROM item_activities WHERE key = ?)', [key]);
      const projects = (await db.all<{ id: number; name: string; status: string; activity: string }>(
        "SELECT id, name, status, activity FROM projects WHERE owner_id = ? AND activity IS NOT NULL ORDER BY updated_at DESC", [owner])).filter((p) => labelKey(p.activity) === key);
      const spellings = [...things.flatMap((t) => t.activities.filter((a) => labelKey(a) === key)), ...projects.map((p) => p.activity)];
      const shown = spellings.length ? bestSpelling(spellings) : (clean(name, 60) ?? name);
      return { name: shown, things, projects: projects.map(({ id, name: n, status }) => ({ id, name: n, status })) };
    },

    // ---------- guns and ammunition: private things ----------

    /** Who a private thing is shared with, and who it could be shared with. Only for the person it belongs to. */
    async sharing(id: number): Promise<{ people: number[]; choices: { id: number; name: string }[] }> {
      await privateItem(db, id);
      return {
        people: (await db.all<{ user_id: number }>('SELECT user_id FROM item_shares WHERE item_id = ? ORDER BY user_id', [id])).map((r) => r.user_id),
        choices: await db.all<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM users u WHERE u.id != ? ORDER BY name COLLATE NOCASE, u.id`, [owner]),
      };
    },

    /** Share a private thing with exactly these people (an empty list: with nobody). */
    shareWith(id: number, people: number[]): Promise<{ people: number[] }> {
      return atomic(db, async (tx) => {
        await privateItem(tx, id);
        const wanted = [...new Set(people)];
        if (wanted.length > 50 || !wanted.every((p) => Number.isInteger(p) && p > 0)) throw new Problem(400, 'Pick people from the list');
        for (const person of wanted) {
          if (person === owner || !(await tx.get('SELECT id FROM users WHERE id = ?', [person]))) throw new Problem(400, 'Pick people from the list');
        }
        await tx.run('DELETE FROM item_shares WHERE item_id = ?', [id]);
        for (const person of wanted) await tx.run('INSERT INTO item_shares (item_id, user_id, created_at) VALUES (?, ?, ?)', [id, person, now()]);
        return { people: wanted.sort((a, b) => a - b) };
      });
    },

    /** The person's own guns, here and gone, with everything an insurer or the police ask for: for the printable list. */
    async guns(): Promise<GunLine[]> {
      const found = await items(db, "AND k.guard = 'firearm'", [], 'any', true);
      const names = new Map((await db.all<{ id: number; name: string }>('SELECT f.id, f.name FROM kind_fields f JOIN kinds k ON k.id = f.kind_id WHERE k.owner_id = ?', [owner])).map((f) => [f.id, labelKey(f.name)]));
      const receipts = new Set((await db.all<{ item_id: number }>(
        "SELECT DISTINCT d.item_id FROM item_documents d JOIN items i ON i.id = d.item_id WHERE i.owner_id = ? AND d.kind = 'receipt'", [owner])).map((r) => r.item_id));
      return found.map((t) => {
        const named = (key: string) => {
          const hit = Object.entries(t.values).find(([fieldId]) => names.get(Number(fieldId)) === key);
          return hit ? String(hit[1]) : null;
        };
        return {
          id: t.id, name: t.name, type: named('type'), maker: named('maker'), model: t.records.model, caliber: named('caliber or gauge'), serial: t.records.serial,
          bought_on: t.records.bought_on, bought_at: t.records.bought_at, price_cents: t.records.price_cents, place: t.place, photo: t.photo, receipt: receipts.has(t.id),
          note: t.note, asset_no: t.asset_no, gone: t.gone,
        };
      }).sort((a, b) => Number(Boolean(a.gone)) - Number(Boolean(b.gone)) || a.name.localeCompare(b.name) || a.id - b.id);
    },

    /** Ammunition that has reached its "running low" amount: the private card on the person's Home page. */
    async ammoLow(): Promise<{ id: number; name: string; amount: string; caliber: string | null }[]> {
      const caliberOf = await ammoCalibers();
      return (await items(db, "AND k.guard = 'ammo'")).filter((t) => t.low).map((t) => ({ id: t.id, name: t.name, amount: t.amount, caliber: caliberOf.get(t.id) ?? null }));
    },

    /** The rounds on hand for each caliber or gauge (one count for each way of writing it), from the ammunition records. */
    async ammoByCaliber(): Promise<{ caliber: string; rounds: number }[]> {
      const caliberOf = await ammoCalibers();
      const total = new Map<string, { caliber: string; rounds: number }>();
      for (const t of await items(db, "AND k.guard = 'ammo'")) {
        const caliber = caliberOf.get(t.id);
        if (!caliber || t.quantity === null) continue;
        const one = total.get(labelKey(caliber)) ?? { caliber, rounds: 0 };
        one.rounds += t.quantity;
        total.set(labelKey(caliber), one);
      }
      return [...total.values()].sort((a, b) => a.caliber.localeCompare(b.caliber));
    },

    /**
     * Things shared with someone, as they are shown to that person: read-only, with no serial number until it is asked for.
     * `ids` must already be known to be shared with the viewer (see sharedWithMe).
     */
    async sharedView(ids: number[], reveal: boolean): Promise<Item[]> {
      if (ids.length === 0) return [];
      return (await items(db, `AND i.id IN (${ids.map(() => '?').join(', ')})`, ids, 'any', reveal)).map((t) => ({ ...t, code: null, barcode: null, own_fields: [], tag_list: [], insured: false }));
    },

    /** Remove a thing. Projects that used it keep its name on their list. */
    async deleteItem(id: number): Promise<void> {
      await db.run('DELETE FROM items WHERE id = ? AND owner_id = ?', [id, owner]);
      await unlink(db, 'thing', id);
    },
  };
}

export type Inventory = ReturnType<typeof inventory>;

/** One gun as the printable list shows it. */
export type GunLine = {
  id: number; name: string; type: string | null; maker: string | null; model: string | null; caliber: string | null; serial: string | null;
  bought_on: string | null; bought_at: string | null; price_cents: number | null; place: string | null; photo: boolean; receipt: boolean;
  note: string | null; asset_no: string; gone: Gone | null;
};

/** A private thing as someone it was shared with sees it: read-only. */
export type SharedThing = {
  id: number; owner: string; name: string; kind: string; icon: string | null; guard: Guard; amount: string; place: string | null; note: string | null;
  fields: { name: string; value: string }[]; records: { model: string | null; serial: string | null; bought_on: string | null; bought_at: string | null; price_cents: number | null };
  serial_kept: boolean; photo: boolean; gone: Gone | null;
};

/**
 * What other people have shared with this person. Only the things chosen for them: nothing else of anyone's is reachable here.
 * With `id`, that one thing, with its serial number (asked for by tapping); in a list, never a serial number.
 */
export async function sharedWithMe(db: Db, viewer: number, clock: Clock = () => new Date(), id?: number): Promise<SharedThing[]> {
  const rows = await db.all<{ id: number; owner_id: number; owner: string }>(
    `SELECT i.id, i.owner_id, ${shown('o')} AS owner FROM item_shares s JOIN items i ON i.id = s.item_id JOIN users o ON o.id = i.owner_id
     WHERE s.user_id = ?${id === undefined ? '' : ' AND i.id = ?'} ORDER BY i.name COLLATE NOCASE, i.id`, id === undefined ? [viewer] : [viewer, id]);
  const out: SharedThing[] = [];
  for (const owner of new Set(rows.map((r) => r.owner_id))) {
    const inv = inventory(db, owner, clock);
    const fieldNames = new Map((await db.all<{ id: number; name: string }>('SELECT f.id, f.name FROM kind_fields f JOIN kinds k ON k.id = f.kind_id WHERE k.owner_id = ?', [owner])).map((f) => [f.id, f.name]));
    for (const t of await inv.sharedView(rows.filter((r) => r.owner_id === owner).map((r) => r.id), id !== undefined)) {
      if (!t.guard) continue;
      out.push({
        id: t.id, owner: rows.find((r) => r.id === t.id)!.owner, name: t.name, kind: t.kind, icon: t.icon, guard: t.guard, amount: t.amount, place: t.place, note: t.note,
        fields: Object.entries(t.values).map(([fid, value]) => ({ name: fieldNames.get(Number(fid)) ?? '', value: String(value) })).filter((f) => f.name),
        records: { model: t.records.model, serial: t.records.serial, bought_on: t.records.bought_on, bought_at: t.records.bought_at, price_cents: t.records.price_cents },
        serial_kept: t.serial_kept, photo: t.photo, gone: t.gone,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

/** The photo of a thing shared with this person, or null. Nothing of anyone else's can be reached through here. */
export async function sharedPhoto(db: Db, viewer: number, id: number): Promise<{ type: string; bytes: Uint8Array } | null> {
  return (await db.get<{ type: string; bytes: Uint8Array }>(
    'SELECT p.type, p.bytes FROM item_photos p JOIN item_shares s ON s.item_id = p.item_id WHERE p.item_id = ? AND s.user_id = ?', [id, viewer])) ?? null;
}
