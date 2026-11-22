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
import { historyOf, noteHistory, noteMove, placePath, type HistoryEntry } from './history.ts';
import { Problem } from './problem.ts';
import { clean, dayNumber, dayOrNull, inOrder, labelKey, pictureType, rounded, stamp, todayOf, type Clock } from './small.ts';
import { STARTERS, type Starter } from './starters.ts';
import * as units from './units.ts';

export const FIELD_TYPES = ['text', 'number', 'choice', 'yesno', 'date', 'link'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** Projects in these states have their amounts set aside for them. */
export const HOLDING = ['planned', 'active', 'paused'] as const;

const MAX_FIELDS = 40;
const MAX_CHOICES = 60;
const MAX_DEPTH = 10;

export type FieldInput = { name: string; type: FieldType; unit?: string | null; choices?: string[] };
export type Field = { id: number; kind_id: number; name: string; type: FieldType; unit: string | null; choices: string[]; sort_order: number };
export type Kind = { id: number; name: string; icon: string | null; unit: string | null; fields: Field[]; items: number };
export type KindInput = { name: string; icon?: string | null; unit?: string | null; fields?: FieldInput[] };

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
};
export type Item = {
  id: number;
  kind_id: number;
  kind: string;
  icon: string | null;
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
  created_at: string;
  updated_at: string;
};

type KindRow = { id: number; name: string; icon: string | null; unit: string | null };
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
type ItemRow = Omit<Item, 'amount' | 'place' | 'low' | 'values' | 'set_aside' | 'free' | 'photo' | 'activities'> & { photo: number };

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

export type ThingSticker = { id: number; name: string; place: string | null; code: string };
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
    const row = await q.get<KindRow>('SELECT id, name, icon, unit FROM kinds WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }

  async function fieldsOf(q: Queries, kindId: number): Promise<Field[]> {
    return (await q.all<FieldRow>('SELECT id, kind_id, name, type, unit, choices, sort_order FROM kind_fields WHERE kind_id = ? ORDER BY sort_order, id', [kindId])).map(asField);
  }

  async function kinds(q: Queries): Promise<Kind[]> {
    const rows = await q.all<KindRow & { items: number }>(
      `SELECT k.id, k.name, k.icon, k.unit, (SELECT COUNT(*) FROM items i WHERE i.kind_id = k.id) AS items
       FROM kinds k WHERE k.owner_id = ? ORDER BY k.name COLLATE NOCASE`, [owner]);
    const out: Kind[] = [];
    for (const row of rows) out.push({ ...row, fields: await fieldsOf(q, row.id) });
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
    const made = await q.run('INSERT INTO kinds (owner_id, name, key, icon, unit, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [owner, name, labelKey(name), clean(input.icon, 16), units.canonical(clean(input.unit, 20)), now()]);
    for (const field of input.fields ?? []) await addFieldIn(q, made.lastId, field);
    return made.lastId;
  }

  async function fieldRow(q: Queries, id: number): Promise<Field> {
    const row = await q.get<FieldRow>(
      `SELECT f.id, f.kind_id, f.name, f.type, f.unit, f.choices, f.sort_order FROM kind_fields f JOIN kinds k ON k.id = f.kind_id
       WHERE f.id = ? AND k.owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return asField(row);
  }

  // ==================== PLACES ====================

  const placeRows = (q: Queries) => q.all<PlaceRow>('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]);

  async function places(q: Queries): Promise<Place[]> {
    const rows = await placeRows(q);
    const paths = placePaths(rows);
    const counts = new Map((await q.all<{ place_id: number; n: number }>(
      'SELECT place_id, COUNT(*) AS n FROM items WHERE owner_id = ? AND place_id IS NOT NULL GROUP BY place_id', [owner])).map((r) => [r.place_id, r.n]));
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

  async function items(q: Queries, where = '', args: Value[] = []): Promise<Item[]> {
    const rows = await q.all<ItemRow>(
      `SELECT i.id, i.kind_id, k.name AS kind, k.icon, i.name, i.quantity, i.unit, i.place_id, i.low_at, i.note, i.code, i.barcode,
              EXISTS (SELECT 1 FROM item_photos ph WHERE ph.item_id = i.id) AS photo, i.created_at, i.updated_at
       FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? ${where} ORDER BY i.name COLLATE NOCASE, i.id`, [owner, ...args]);
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
    return rows.map((row) => {
      const setAside = rounded(aside.get(row.id) ?? 0, 4);
      return {
        ...row,
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
    const found = (await items(q, 'AND i.id = ?', [id]))[0];
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }

  const when = () => ({ day: todayOf(clock), at: now() });

  async function saveActivities(q: Queries, itemId: number, names: string[] | undefined) {
    if (names === undefined) return;
    await q.run('DELETE FROM item_activities WHERE item_id = ?', [itemId]);
    for (const a of activityList(names)) await q.run('INSERT INTO item_activities (item_id, activity, key) VALUES (?, ?, ?)', [itemId, a.name, a.key]);
  }

  async function ownedItem(q: Queries, id: number): Promise<{ id: number; place_id: number | null; code: string | null }> {
    const row = await q.get<{ id: number; place_id: number | null; code: string | null }>('SELECT id, place_id, code FROM items WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
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
    updateKind(id: number, input: { name?: string | null; icon?: string | null; unit?: string | null }): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        const row = await kindRow(tx, id);
        const name = clean(input.name, 80) ?? row.name;
        if (await tx.get('SELECT id FROM kinds WHERE owner_id = ? AND key = ? AND id != ?', [owner, labelKey(name), id])) {
          throw new Problem(409, `You already have a kind called "${name}"`);
        }
        await tx.run('UPDATE kinds SET name = ?, key = ?, icon = ?, unit = ? WHERE id = ?', [
          name, labelKey(name), input.icon !== undefined ? clean(input.icon, 16) : row.icon,
          input.unit !== undefined ? units.canonical(clean(input.unit, 20)) : row.unit, id]);
        return kinds(tx);
      });
    },

    /** Remove a kind. Its things have to be moved or removed first: a thing is never deleted behind your back. */
    deleteKind(id: number): Promise<Kind[]> {
      return atomic(db, async (tx) => {
        await kindRow(tx, id);
        const count = (await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE kind_id = ?', [id]))!.n;
        if (count > 0) throw new Problem(409, `Remove ${count === 1 ? 'the one thing' : `the ${count} things`} of this kind first`);
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
      if (!starter) throw new Problem(404, 'Not found');
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
        if (!(await tx.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
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
    async listItems(find: { kind_id?: number | null; place_id?: number | null; q?: string | null; low?: boolean } = {}): Promise<Item[]> {
      let where = '';
      const args: Value[] = [];
      if (find.kind_id != null) {
        where += ' AND i.kind_id = ?';
        args.push(find.kind_id);
      }
      if (find.q?.trim()) {
        const like = `%${find.q.trim()}%`;
        where += ' AND (i.name LIKE ? OR i.note LIKE ? OR i.id IN (SELECT item_id FROM item_values WHERE value LIKE ?))';
        args.push(like, like, like);
      }
      let found = await items(db, where, args);
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
          'INSERT INTO items (owner_id, kind_id, name, quantity, unit, place_id, low_at, note, code, barcode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [owner, kind.id, ...(await itemValues(tx, input, kind)), code, plainBarcode(input.barcode), now(), now()]);
        await saveValues(tx, made.lastId, kind.id, input.values);
        await saveActivities(tx, made.lastId, input.activities);
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
        await noteMove(tx, owner, { item_id: id }, before.place_id, input.place_id ?? null, when());
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
          out.push({ id, name: thing.name, place: thing.place, code });
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

    /** Remove a thing. Projects that used it keep its name on their list. */
    async deleteItem(id: number): Promise<void> {
      await db.run('DELETE FROM items WHERE id = ? AND owner_id = ?', [id, owner]);
    },
  };
}

export type Inventory = ReturnType<typeof inventory>;
