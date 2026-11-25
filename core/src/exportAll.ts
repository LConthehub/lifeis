/**
 * Everything a person keeps, taken out in open files, and brought back in part by part.
 *
 * "Download everything" is one zip: a README in plain words, a spreadsheet (CSV) for each kind of record, the
 * recipes in the open recipe format other recipe apps read, and every picture and paper in a folder named for
 * what it belongs to. It is made here, from the database, so the phone makes the very same file; it is held
 * in memory while it is made (see MAX_EXPORT_BYTES) and goes nowhere but to the person's own device.
 *
 * "Bring it in" reads such a zip back and MERGES it into the Life Is that is open. It never overwrites and
 * never deletes: a record that matches one already kept (the matches are listed in `KINDS`) is left exactly as
 * it is and counted as already there; a new one is added. Each kind is brought in in its own transaction, so
 * one that fails undoes only itself. Links between kinds are rebuilt by the names in the files (a thing's place
 * by its path, a meal's recipe by its title); a link that can't be rebuilt leaves the record without it and is
 * counted. Reading the same zip twice adds nothing the second time. Restoring a whole Life Is exactly is the
 * encrypted backup's job (backup.ts); this is for the open files.
 *
 * What is never in the zip: a password or its hash, two-step sign-in, passkeys, recovery codes, sessions, and
 * anything locked with a key (the key of a media server, an email password, the assistant's key). See `LEFT_OUT`.
 */
import { csvRows } from './bookList.ts';
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { noteHistory } from './history.ts';
import { assetLabel, assetNumber, GONE_HOW, placePaths } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import { BUILT_IN_NAMES, LIST_TYPES, TO_WATCH } from './mediaLists.ts';
import { Problem } from './problem.ts';
import { prepAsText, prepFromText, type PrepRule } from './prep.ts';
import { recipeKey } from './recipeFiles.ts';
import { daysAsText, daysFromText, MAX_STEPS, MAX_TIMES, type StepRule } from './routines.ts';
import { cut, linesAsText, splitLines } from './recipeText.ts';
import { clean, dayNumber, labelKey, pictureType, stamp, todayOf, type Clock } from './small.ts';
import { ensurePath, exportRows, setByPaths, tagKindOfLabel, tagsOnto, targetsByTitle, type TagKind } from './tags.ts';
import * as units from './units.ts';
import { dueOf } from './upkeep.ts';

// ==================== limits ====================

/**
 * The most the pictures and papers in one download may add up to. The zip is built in memory (the pictures
 * are read from the database, then copied into the zip), so a household with a great many large photos could
 * otherwise exhaust a small computer or a phone. Pictures are shrunk when they are added, so this is a very
 * large household's worth.
 */
export const MAX_EXPORT_BYTES = 300 * 1024 * 1024;
/** A zip file's own limit on how many files it holds. */
const MAX_FILES = 60_000;
/** The most that is sent to be brought in at one time (the server reads 8 MB of JSON at once). */
export const MAX_SENT_BYTES = 5 * 1024 * 1024;

// ==================== the kinds of record, in the order they are brought in ====================

export type KindInfo = {
  key: string;
  label: string;
  /** The file whose rows are counted. */
  file: string;
  /** Whether it can be brought back in. */
  importable: boolean;
  /** How a record is matched against what is already kept, in words. */
  matched: string;
};

export const KINDS: KindInfo[] = [
  { key: 'places', label: 'Places', file: 'places.csv', importable: true, matched: 'by its full path' },
  { key: 'things', label: 'Things, with their photos and papers', file: 'things.csv', importable: true, matched: 'by name and place' },
  { key: 'recipes', label: 'Recipes', file: 'recipes.csv', importable: true, matched: 'by title and first ingredient' },
  { key: 'meals', label: "The week's meals", file: 'meal-plan.csv', importable: true, matched: 'by day, meal and recipe' },
  { key: 'grocery', label: 'Grocery list', file: 'grocery-list.csv', importable: true, matched: 'by what it is' },
  { key: 'pantry', label: 'Pantry', file: 'pantry.csv', importable: true, matched: 'by what it is' },
  { key: 'household', label: 'People in the household (for chores)', file: 'household.csv', importable: true, matched: 'by name' },
  { key: 'pets', label: 'Pets, with their weights and photos', file: 'pets.csv', importable: true, matched: 'by name' },
  { key: 'upkeep', label: 'Upkeep jobs, bills, renewals and chores, with when each was done', file: 'upkeep.csv', importable: true, matched: 'by name (and pet)' },
  { key: 'routines', label: 'Routines, with their times and steps, and the days each time was finished', file: 'routines.csv', importable: true, matched: 'by name' },
  { key: 'manual', label: 'The house manual', file: 'house-manual.csv', importable: true, matched: 'by part and title' },
  { key: 'licenses', label: 'Licenses and permits', file: 'licenses.csv', importable: true, matched: 'by name and holder' },
  { key: 'collection', label: 'The collection: titles, copies and what was watched or read', file: 'collection.csv', importable: true, matched: 'by title and type' },
  { key: 'lists', label: 'Lists of titles: To watch, read or hear, and the ones you made, in their order and whether they are shared', file: 'lists.csv', importable: true, matched: 'a list by its name; a title on it by title and type' },
  { key: 'events', label: 'Calendar events', file: 'events.csv', importable: true, matched: 'by title and day' },
  { key: 'money', label: 'Spending: categories and entries', file: 'money-entries.csv', importable: true, matched: 'by day, amount, label and category' },
  { key: 'budget', label: 'Income and savings goals, with the money put toward each', file: 'money-income.csv', importable: true, matched: 'income by name, amount and how often; goals by name' },
  { key: 'stores', label: 'Your stores', file: 'stores.csv', importable: true, matched: 'by name' },
  { key: 'barcodes', label: 'Barcodes taught for groceries', file: 'barcodes.csv', importable: true, matched: 'by barcode' },
  { key: 'prices', label: 'Prices paid', file: 'prices.csv', importable: true, matched: 'by day, price, what and store' },
  { key: 'coupons', label: 'Coupons', file: 'coupons.csv', importable: true, matched: 'by name, store and code' },
  { key: 'projects', label: 'Projects, with their lines, time and costs', file: 'projects.csv', importable: true, matched: 'by name' },
  { key: 'plans', label: 'Plans, with their things to do and photos', file: 'plans.csv', importable: true, matched: 'by name and first day' },
  { key: 'holidays', label: 'Holidays: how each finds its day, and what each year kept (guests, cards, gifts, decorations, countdown)', file: 'holidays.csv', importable: true, matched: 'by name; a year by its plan' },
  { key: 'trips', label: 'Outdoor trips: the parts each has on, and what each year kept (bring list, seasons, catch and harvest logs, site booking)', file: 'outdoor-trips.csv', importable: true, matched: 'by name; a year by its plan' },
  { key: 'tags', label: 'Tags, and what carries them', file: 'tags.csv', importable: true, matched: 'by path; a tag on something by that thing’s name' },
  { key: 'connections', label: 'Servers and accounts you connected (names and addresses only)', file: 'connections.csv', importable: false, matched: '' },
  { key: 'settings', label: 'Preferences', file: 'settings.csv', importable: false, matched: '' },
];

/** What is left out of a download, and why. Shown in the README; the tests look for none of it in the zip. */
export const LEFT_OUT: { what: string; why: string }[] = [
  { what: 'Your password', why: 'It is kept only as a scrambled form that cannot be turned back into it, and it is the one thing a download must never carry.' },
  { what: 'Two-step sign-in, passkeys and recovery codes', why: 'They are the keys to your account, so they stay where they were made. Set them up again on the new Life Is.' },
  { what: 'Who is signed in where', why: 'Sign-ins belong to the place they were made.' },
  { what: 'The key of a media server, a book server or the photo library, an email password, and the assistant’s key', why: 'They are kept locked with a key that stays on this Life Is, so they could not be read anywhere else, and they should not travel in a file. Only the name and address of each is listed.' },
  { what: 'The access address of a bank connection (SimpleFIN)', why: 'It is a key to read your bank accounts, kept locked on this Life Is. Spending entries you brought in from the bank are in money-entries.csv like any other.' },
  { what: 'The link of a calendar you follow, your phone-calendar link, and the link of the shared house manual', why: 'Each link is a key: anyone holding it can use it.' },
  { what: 'Browsers set up for reminders, and the reminder settings (the topic, the addresses reminders are sent to)', why: 'They name where reminders are sent, and belong to this Life Is.' },
  { what: 'Stickers’ codes', why: 'Each printed sticker’s code can belong to one place or thing in one Life Is only. The things themselves are all here.' },
  { what: 'What was last read from outside (the forecast, recall look-ups, followed calendars’ events)', why: 'It is copied from elsewhere, not yours, and is read again when needed.' },
  { what: 'Categories of spending that another person shared with you, and their entries', why: 'They belong to the person who made them. Your own entries in them are here, with the category’s name.' },
];

// ==================== CSV ====================

/** Cents as plain dollars for a spreadsheet: 79900 is 799.00. Whole-number arithmetic, so nothing drifts. */
const plainDollars = (cents: number | null): string => (cents === null ? '' : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);

/**
 * One spreadsheet field: quoted when it holds a comma, a quote or a line break; a leading = + @ (or - before a
 * letter) is defused so Excel doesn't run it. The same rule as the home inventory's (inventory.ts), which keeps
 * its own copy private; a test holds the two to the same answers.
 */
export function csvField(text: string): string {
  const safe = /^[=+@\t\r]|^-[^0-9.]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

type Cell = string | number | null | undefined;
const cellText = (cell: Cell): string => (cell === null || cell === undefined ? '' : String(cell));

/** A table as a CSV file: a byte-order mark so Excel reads it as UTF-8, and CRLF line ends. */
export function csvText(headers: string[], rows: Cell[][]): string {
  return '﻿' + [headers, ...rows].map((row) => row.map((cell) => csvField(cellText(cell))).join(',')).join('\r\n') + '\r\n';
}

// ==================== a zip, with room for pictures ====================

export type ZipFile = { path: string; bytes: Uint8Array };

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}
async function deflated(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try { return await through(bytes, new CompressionStream('deflate-raw')); } catch { return null; }
}

const TEXTUAL = /\.(csv|txt|json)$/i;

/**
 * A zip file. Text files are deflated; pictures and papers (which are already packed) are stored as they are,
 * which is also what lets any bytes go in. Names are UTF-8. Nothing here needs a Node module.
 */
export async function makeZip(files: ZipFile[], at: Date): Promise<Uint8Array> {
  if (files.length > MAX_FILES) throw new Problem(422, `A download holds ${MAX_FILES.toLocaleString('en-US')} files at most, and this one would hold ${files.length.toLocaleString('en-US')}.`);
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((Math.max(at.getFullYear(), 1980) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const file of files) {
    const name = encoder.encode(file.path);
    const packed = TEXTUAL.test(file.path) ? await deflated(file.bytes) : null;
    const body = packed && packed.length < file.bytes.length ? packed : file.bytes;
    const method = body === file.bytes ? 0 : 8;
    const shared = new DataView(new ArrayBuffer(26));
    shared.setUint16(0, 20, true);
    shared.setUint16(2, 0x0800, true);
    shared.setUint16(4, method, true);
    shared.setUint16(6, time, true);
    shared.setUint16(8, date, true);
    shared.setUint32(10, crc32(file.bytes), true);
    shared.setUint32(14, body.length, true);
    shared.setUint32(18, file.bytes.length, true);
    shared.setUint16(22, name.length, true);
    shared.setUint16(24, 0, true);
    const sharedBytes = new Uint8Array(shared.buffer);
    const local = new Uint8Array(4 + 26 + name.length);
    local.set([0x50, 0x4b, 0x03, 0x04], 0);
    local.set(sharedBytes, 4);
    local.set(name, 30);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    new Uint8Array(entry.buffer).set(sharedBytes, 6);
    entry.setUint32(42, offset, true);
    directory.push(new Uint8Array(entry.buffer), name);
    parts.push(local, body);
    offset += local.length + body.length;
  }
  const size = directory.reduce((n, d) => n + d.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...directory, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let place = 0;
  for (const part of all) { out.set(part, place); place += part.length; }
  return out;
}

/** The files inside a zip (stored or deflated). The pages read a zip themselves; this is for the tests and for anywhere else that holds one. */
export async function readZip(bytes: Uint8Array): Promise<ZipFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Problem(400, "That isn't a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: ZipFile[] = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Problem(400, 'That zip file is damaged');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const rest = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const packed = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Problem(400, 'It is packed in a way that is not supported');
    if (!path.endsWith('/')) files.push({ path, bytes: method === 0 ? packed : await through(packed, new DecompressionStream('deflate-raw')) });
    at += 46 + nameLength + rest;
  }
  return files;
}

// ==================== the zip, being made ====================

class Out {
  files: ZipFile[] = [];
  counts = new Map<string, number>();
  pictures = 0;
  private used = new Set<string>();
  private encoder = new TextEncoder();

  /** A CSV file. Returns the path it was written at. */
  csv(path: string, headers: string[], rows: Cell[][]): void {
    this.files.push({ path, bytes: this.encoder.encode(csvText(headers, rows)) });
    this.counts.set(path, rows.length);
  }
  text(path: string, text: string): void { this.files.push({ path, bytes: this.encoder.encode(text) }); }
  /** A picture or paper, in a folder named for what it belongs to. Returns the path it is at. */
  binary(folder: string, name: string, type: string, bytes: Uint8Array): string {
    const ext = EXTENSIONS[type] ?? 'bin';
    let path = `${folder}/${name}.${ext}`;
    for (let n = 2; this.used.has(path.toLowerCase()); n += 1) path = `${folder}/${name}-${n}.${ext}`;
    this.used.add(path.toLowerCase());
    this.files.push({ path, bytes });
    this.pictures += 1;
    return path;
  }
}
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** A name that is safe as a file or folder name anywhere, kept readable. */
const plainName = (name: string) => name.normalize('NFKD').replace(/[^A-Za-z0-9._ -]+/g, '').trim().replace(/\s+/g, '-').replace(/^[.-]+/, '').slice(0, 40);
const slug = (name: string, id: number): string => `${plainName(name) || 'item'}-${id}`;

type R = Record<string, Value>;
const str = (v: Value | undefined): string => (v === null || v === undefined ? '' : String(v));
const num = (v: Value | undefined): number | null => (typeof v === 'number' ? v : null);
const yes = (v: Value | undefined): string => (v ? 'yes' : 'no');
const bytesOf = (v: Value | undefined): Uint8Array | null => (v instanceof Uint8Array ? v : null);
const dollars = (v: Value | undefined): string => plainDollars(num(v));
const signedDollars = (v: Value | undefined): string => ((num(v) ?? 0) < 0 ? '-' : '') + plainDollars(Math.abs(num(v) ?? 0));

async function hasTable(q: Queries, table: string): Promise<boolean> {
  return Boolean(await q.get("SELECT 1 AS there FROM sqlite_master WHERE type = 'table' AND name = ?", [table]));
}

/** Preferences that are plain choices (nothing secret), by their name in the database, and what they are called in the download. */
const PLAIN_SETTINGS: Record<string, string> = {
  life_areas: 'Parts of Life Is you chose to show',
  home_hidden_cards: 'Cards hidden on the front page',
  lookup_books: 'Look books up from a barcode',
  lookup_groceries: 'Look groceries up from a barcode',
  lookup_titles: 'Look films, music and games up from a barcode',
  shopping_currency: 'Money sign',
  shopping_store: 'Shop the grocery list is read by',
  chore_point_cents: 'What a chore point is worth, in cents',
  allowance_paid: 'Allowance paid up to',
  recalls_on: 'Car recall alerts',
  display_name: 'The name Life Is calls you',
  idle_minutes: 'Sign out after being idle, in minutes',
  weather_place: 'Town for the weather',
};

/** The preferences that are left out, in words (a name not listed here is shown as it is). */
const LEFT_SETTINGS: Record<string, string> = {
  assistant: 'the assistant’s settings and key',
  photo_library: 'the photo library’s address and key',
  reminders: 'where your reminders are sent',
  weather_forecast: 'the forecast kept from the last look',
  start_setup: 'what the two-minute start made',
  recalls_checked_at: 'when car recalls were last checked',
  license_lead_: 'how long before each license runs out you are reminded',
};

/** A server's address without anything that could be a sign-in in it (a name and password in the address, or a key after the ?). */
function plainAddress(address: string): string {
  try {
    const url = new URL(address);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}

async function gather(q: Queries, owner: number, today: string, out: Out): Promise<string[]> {
  const all = (sql: string, params: Value[] = [owner]) => q.all<R>(sql, params);
  const missing: string[] = [];

  // ---------- places ----------
  const placeRows = await all('SELECT id, parent_id, name, note, box_state, box_destination FROM places WHERE owner_id = ?');
  const paths = placePaths(placeRows.map((p) => ({ id: p.id as number, parent_id: num(p.parent_id), name: str(p.name), note: null })));
  const where = (id: Value | undefined): string => (typeof id === 'number' ? paths.get(id) ?? '' : '');
  const inPlace = new Map((await all('SELECT place_id, COUNT(*) AS n FROM items WHERE owner_id = ? AND place_id IS NOT NULL GROUP BY place_id')).map((r) => [r.place_id as number, r.n as number]));
  out.csv('places.csv', ['Place', 'Note', 'Box packed', 'Box is going to', 'Things in it'],
    placeRows.map((p) => [where(p.id), str(p.note), str(p.box_state), str(p.box_destination), inPlace.get(p.id as number) ?? 0])
      .sort((a, b) => String(a[0]).toLowerCase() < String(b[0]).toLowerCase() ? -1 : 1));

  // ---------- recipes, the week's meals, the grocery list, the pantry ----------
  const recipes = await all('SELECT id, title, description, servings, prep_minutes, cook_minutes, source_url, notes FROM recipes WHERE owner_id = ? ORDER BY title COLLATE NOCASE, id');
  const recipeTags = await tagsOnto(q, owner, 'recipe', recipes.map((r) => r.id as number));
  const recipeLines = await all('SELECT l.recipe_id, l.part, l.is_heading, l.text FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id WHERE r.owner_id = ? ORDER BY l.recipe_id, l.part, l.sort_order, l.id');
  const prepOf = (column: 'recipe_id' | 'meal_plan_id') =>
    all(`SELECT ${column} AS parent, words, rule, at_time, hours FROM prep_steps WHERE owner_id = ? AND ${column} IS NOT NULL ORDER BY ${column}, sort_order, id`);
  const prepText = (rows: R[], parent: Value | undefined) => prepAsText(rows.filter((p) => p.parent === parent)
    .map((p) => ({ words: str(p.words), rule: str(p.rule) as PrepRule, at: p.at_time === null || p.at_time === undefined ? null : str(p.at_time), hours: num(p.hours) || null })));
  const recipePrep = await prepOf('recipe_id');
  const equipment = await all('SELECT e.recipe_id, e.label, e.quantity FROM recipe_equipment e JOIN recipes r ON r.id = e.recipe_id WHERE r.owner_id = ? ORDER BY e.recipe_id, e.sort_order, e.id');
  const linesOf = (id: Value | undefined) => recipeLines.filter((l) => l.recipe_id === id).map((l) => ({ part: l.part as 'ingredients' | 'steps', text: str(l.text), is_heading: Boolean(l.is_heading) }));
  out.csv('recipes.csv', ['Title', 'Description', 'Servings', 'Prep minutes', 'Cook minutes', 'Tags', 'Ingredients', 'Steps', 'Source address', 'Notes', 'Cooked in', 'Prep reminders'],
    recipes.map((r) => [
      str(r.title), str(r.description), str(r.servings), str(r.prep_minutes), str(r.cook_minutes), (recipeTags.get(r.id as number) ?? []).map((t) => t.path).join(', '),
      linesAsText(linesOf(r.id), 'ingredients'), linesAsText(linesOf(r.id), 'steps'), str(r.source_url), str(r.notes),
      equipment.filter((e) => e.recipe_id === r.id).map((e) => (num(e.quantity) !== 1 ? `${str(e.label)} x${str(e.quantity)}` : str(e.label))).join('; '),
      prepText(recipePrep, r.id),
    ]));
  if (await hasTable(q, 'tags')) out.csv('tags.csv', ['Tag', 'Used on', 'Name'], await exportRows(q, owner));
  if (await hasTable(q, 'recipe_photos')) {
    for (const p of await all('SELECT r.id, r.title, p.type, p.bytes FROM recipe_photos p JOIN recipes r ON r.id = p.recipe_id WHERE r.owner_id = ?')) {
      const bytes = bytesOf(p.bytes);
      if (bytes) out.binary('pictures/recipes', slug(str(p.title), p.id as number), str(p.type), bytes);
    }
  }

  const mealPrep = await prepOf('meal_plan_id');
  out.csv('meal-plan.csv', ['Day', 'Meal', 'Recipe', 'Or something else', 'Servings', 'Cooked on', 'Eat at', 'Prep reminders'],
    (await all(`SELECT m.id, m.day, m.meal, r.title AS recipe, m.title, m.servings, m.cooked_on, m.eat_time FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.owner_id = ? ORDER BY m.day, m.id`))
      .map((m) => [str(m.day), str(m.meal), str(m.recipe), str(m.title), str(m.servings), str(m.cooked_on), str(m.eat_time), prepText(mealPrep, m.id)]));
  out.csv('grocery-list.csv', ['What', 'Amount', 'Unit', 'Notes', 'From the week’s meals', 'Got it'],
    (await all('SELECT label, quantity, unit, note, from_plan, done FROM grocery WHERE owner_id = ? ORDER BY done, id'))
      .map((g) => [str(g.label), str(g.quantity), str(g.unit), str(g.note), yes(g.from_plan), yes(g.done)]));
  out.csv('pantry.csv', ['What', 'Amount', 'Unit', 'Where', 'Use by', 'Running low at'],
    (await all('SELECT i.name, p.quantity, p.unit, p.location, p.expires_on, p.low_at FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id WHERE p.owner_id = ? ORDER BY i.name COLLATE NOCASE'))
      .map((p) => [str(p.name), str(p.quantity), str(p.unit), str(p.location), str(p.expires_on), str(p.low_at)]));
  // "Price" is what was paid; "Saved" is what was taken off it (the full price is the two together).
  out.csv('prices.csv', ['What', 'Price', 'Amount', 'Unit', 'Shop', 'Day', 'A guess, not a receipt', 'Barcode', 'Saved'],
    (await all('SELECT label, cents, quantity, unit, store, day, assumed, barcode, saved_cents FROM prices WHERE owner_id = ? ORDER BY day, id'))
      .map((p) => [str(p.label), dollars(p.cents), str(p.quantity), str(p.unit), str(p.store), str(p.day), yes(p.assumed), str(p.barcode), num(p.saved_cents) ? dollars(p.saved_cents) : '']));
  out.csv('coupons.csv', ['Coupon', 'What it is for', 'Dollars off', 'Percent off', 'Shop', 'Code', 'Runs out on', 'Used on', 'Notes', 'From the shop’s savings book', 'Starts on'],
    (await all('SELECT c.label, i.name AS what, c.cents_off, c.percent_off, c.store, c.code, c.expires_on, c.used_on, c.note, c.book, c.starts_on FROM coupons c LEFT JOIN ingredients i ON i.id = c.ingredient_id WHERE c.owner_id = ? ORDER BY c.id'))
      .map((c) => [str(c.label), str(c.what), dollars(c.cents_off), str(c.percent_off), str(c.store), str(c.code), str(c.expires_on), str(c.used_on), str(c.note), yes(c.book), str(c.starts_on)]));
  out.csv('stores.csv', ['Store', 'Notes', 'Price adjustment days'],
    (await all('SELECT name, note, adjust_days FROM stores WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id')).map((s) => [str(s.name), str(s.note), str(s.adjust_days)]));
  if (await hasTable(q, 'trip_receipts')) {
    for (const p of await all('SELECT t.id, t.store, t.day, r.type, r.bytes FROM trip_receipts r JOIN shopping_trips t ON t.id = r.trip_id WHERE t.owner_id = ? ORDER BY t.day, t.id')) {
      const bytes = bytesOf(p.bytes);
      if (bytes) out.binary('pictures/receipts', slug(`${str(p.store)} ${str(p.day)}`, p.id as number), str(p.type), bytes);
    }
  }
  out.csv('barcodes.csv', ['Barcode', 'What it is', 'Product name', 'Size amount', 'Size unit'],
    (await all('SELECT b.barcode, i.name, b.label, b.size_quantity, b.size_unit FROM ingredient_barcodes b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.owner_id = ? ORDER BY b.barcode'))
      .map((b) => [str(b.barcode), str(b.name), str(b.label), str(b.size_quantity), str(b.size_unit)]));

  // ---------- things ----------
  const kinds = await all('SELECT id, name, icon, unit, activity FROM kinds WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id');
  const fields = await all('SELECT f.id, f.kind_id, f.name, f.type, f.unit, f.choices FROM kind_fields f JOIN kinds k ON k.id = f.kind_id WHERE k.owner_id = ? ORDER BY f.kind_id, f.sort_order, f.id');
  const kindRows: Cell[][] = [];
  for (const k of kinds) {
    const mine = fields.filter((f) => f.kind_id === k.id);
    const choices = (f: R) => { try { return (JSON.parse(str(f.choices) || '[]') as string[]).join('; '); } catch { return ''; } };
    if (mine.length === 0) kindRows.push([str(k.name), str(k.icon), str(k.unit), str(k.activity), '', '', '', '']);
    for (const f of mine) kindRows.push([str(k.name), str(k.icon), str(k.unit), str(k.activity), str(f.name), str(f.type), str(f.unit), choices(f)]);
  }
  out.csv('kinds.csv', ['Kind', 'Icon', 'Usual unit', 'For activity', 'Field', 'Field is', 'Field unit', 'Choices'], kindRows);

  const items = await all(`SELECT i.id, i.name, i.kind_id, k.name AS kind, i.quantity, i.unit, i.place_id, i.low_at, i.note, i.barcode, i.model, i.serial,
      i.bought_on, i.bought_at, i.price_cents, i.value_cents, i.warranty_until,
      i.asset_no, i.insured, i.gone_on, i.gone_how, i.gone_to, i.gone_cents
    FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? ORDER BY i.name COLLATE NOCASE, i.id`);
  const values = new Map<string, string>();
  for (const v of await all('SELECT v.item_id, v.field_id, v.value FROM item_values v JOIN items i ON i.id = v.item_id WHERE i.owner_id = ?')) values.set(`${v.item_id}:${v.field_id}`, str(v.value));
  const doing = new Map<number, string[]>();
  for (const a of await all('SELECT a.item_id, a.activity FROM item_activities a JOIN items i ON i.id = a.item_id WHERE i.owner_id = ? ORDER BY a.activity COLLATE NOCASE')) {
    doing.set(a.item_id as number, [...(doing.get(a.item_id as number) ?? []), str(a.activity)]);
  }
  const fieldColumns = fields.map((f) => ({ field: f, heading: `${str(kinds.find((k) => k.id === f.kind_id)?.name)}: ${str(f.name)}` }));
  const photoPath = new Map<number, string>();
  for (const p of await all('SELECT p.item_id, p.type, p.bytes, i.name FROM item_photos p JOIN items i ON i.id = p.item_id WHERE i.owner_id = ?')) {
    const bytes = bytesOf(p.bytes);
    if (bytes) photoPath.set(p.item_id as number, out.binary('pictures/things', slug(str(p.name), p.item_id as number), str(p.type), bytes));
  }
  const shownValue = (f: R, stored: string | undefined) => (stored === undefined ? '' : f.type === 'yesno' ? (stored === '1' ? 'yes' : 'no') : stored);
  out.csv('things.csv',
    ['Name', 'Kind', 'Place', 'Amount', 'Unit', 'Running low at', 'Notes', 'For activities', 'Barcode', 'Make or model', 'Serial number', 'Bought on', 'Bought at', 'Cost', 'Worth now', 'Warranty until', 'Photo file',
      'Asset number', 'Insured', 'No longer have', 'Gone on', 'Gone to', 'Gone price', ...fieldColumns.map((c) => c.heading)],
    items.map((i) => [
      str(i.name), str(i.kind), where(i.place_id), str(i.quantity), str(i.unit), str(i.low_at), str(i.note), (doing.get(i.id as number) ?? []).join('; '), str(i.barcode),
      str(i.model), str(i.serial), str(i.bought_on), str(i.bought_at), dollars(i.price_cents), dollars(i.value_cents), str(i.warranty_until), photoPath.get(i.id as number) ?? '',
      assetLabel(num(i.asset_no) ?? 0), i.insured ? 'yes' : 'no', str(i.gone_how), str(i.gone_on), str(i.gone_to), dollars(i.gone_cents),
      ...fieldColumns.map((c) => (c.field.kind_id === i.kind_id ? shownValue(c.field, values.get(`${i.id}:${c.field.id}`)) : '')),
    ]));
  const itemName = new Map(items.map((i) => [i.id as number, i]));
  const paperRows: Cell[][] = [];
  const documents = await all('SELECT d.id, d.item_id, d.kind, d.name, d.type, d.bytes FROM item_documents d JOIN items i ON i.id = d.item_id WHERE i.owner_id = ? ORDER BY d.item_id, d.id');
  for (const d of documents) {
    const thing = itemName.get(d.item_id as number)!;
    const bytes = bytesOf(d.bytes);
    if (!bytes) continue;
    const file = out.binary(`papers/${slug(str(thing.name), thing.id as number)}`, plainName(str(d.name)) || 'paper', str(d.type), bytes);
    paperRows.push([str(thing.name), where(thing.place_id), str(d.kind), str(d.name), file]);
  }
  out.csv('thing-papers.csv', ['Thing', 'Place', 'Kind of paper', 'Name', 'File'], paperRows);
  const ownRows: Cell[][] = [];
  for (const f of await all('SELECT f.item_id, f.name, f.value FROM item_fields f JOIN items i ON i.id = f.item_id WHERE i.owner_id = ? ORDER BY f.item_id, f.sort_order, f.id')) {
    const thing = itemName.get(f.item_id as number)!;
    ownRows.push([str(thing.name), where(thing.place_id), str(f.name), str(f.value)]);
  }
  out.csv('thing-own-fields.csv', ['Thing', 'Place', 'Field', 'Value'], ownRows);
  out.csv('thing-history.csv', ['Thing', 'Place now', 'What happened', 'Day', 'From', 'To', 'For project', 'For job', 'For activity', 'Notes'],
    (await all("SELECT h.item_id, h.what, h.day, h.from_place, h.to_place, h.project, h.job, h.activity, h.note FROM item_history h JOIN items i ON i.id = h.item_id WHERE h.owner_id = ? AND i.owner_id = ? ORDER BY h.item_id, h.day, h.id", [owner, owner]))
      .map((h) => { const t = itemName.get(h.item_id as number)!; return [str(t.name), where(t.place_id), str(h.what), str(h.day), str(h.from_place), str(h.to_place), str(h.project), str(h.job), str(h.activity), str(h.note)]; }));

  // ---------- upkeep ----------
  const readingOf = new Map<string, number>();
  for (const r of await all('SELECT item_id, job_id, value FROM readings WHERE owner_id = ? ORDER BY day, id')) {
    if (r.item_id !== null) readingOf.set(`i${r.item_id}`, r.value as number);
    if (r.job_id !== null) readingOf.set(`j${r.job_id}`, r.value as number);
  }
  const done = await all(`SELECT d.job_id, d.day, d.reading, d.minutes, d.cost_cents, d.points, d.note, COALESCE(d.done_name, u.username) AS who
    FROM upkeep_done d JOIN upkeep_jobs j ON j.id = d.job_id LEFT JOIN users u ON u.id = d.done_by WHERE j.owner_id = ? ORDER BY d.job_id, d.day, d.id`);
  const tools = await all('SELECT t.job_id, i.name FROM upkeep_tools t JOIN items i ON i.id = t.item_id JOIN upkeep_jobs j ON j.id = t.job_id WHERE j.owner_id = ? ORDER BY t.job_id, t.sort_order');
  const supplies = await all('SELECT s.job_id, i.name, s.quantity, s.unit FROM upkeep_supplies s JOIN items i ON i.id = s.item_id JOIN upkeep_jobs j ON j.id = s.job_id WHERE j.owner_id = ? ORDER BY s.job_id, s.sort_order, s.id');
  const jobs = await all(`SELECT j.*, it.name AS thing, it.place_id AS thing_place, p.name AS pet, u.username AS signin, m.name AS member
    FROM upkeep_jobs j LEFT JOIN items it ON it.id = j.item_id LEFT JOIN pets p ON p.id = j.pet_id LEFT JOIN users u ON u.id = j.assigned_to
    LEFT JOIN household_members m ON m.id = j.assigned_member WHERE j.owner_id = ? ORDER BY j.name COLLATE NOCASE, j.id`);
  const jobName = new Map(jobs.map((j) => [j.id as number, j]));
  out.csv('upkeep.csv',
    ['Job', 'Kind', 'Activity', 'For this thing', 'Its place', 'For this pet', 'Repeats every', 'Repeats every (unit)', 'Or every (miles, hours)', 'Counted in', 'First due', 'Last done', 'Next due', 'Amount', 'Points', 'Pays by itself', 'Assigned to (sign-in)', 'Assigned to (household)', 'Steps', 'Notes', 'Tools', 'Supplies'],
    jobs.map((j) => {
      const mine = done.filter((d) => d.job_id === j.id);
      const last = mine.length ? { day: str(mine[mine.length - 1]!.day), reading: num(mine[mine.length - 1]!.reading) } : null;
      const latest = readingOf.get(j.item_id !== null ? `i${j.item_id}` : `j${j.id}`) ?? null;
      let next = '';
      try { next = dueOf(j as unknown as Parameters<typeof dueOf>[0], last, latest, today).next_day ?? ''; } catch { next = ''; }
      return [
        str(j.name), str(j.kind), str(j.activity), str(j.thing), where(j.thing_place), str(j.pet), str(j.every_n), str(j.every_unit), str(j.every_reading), str(j.reading_unit),
        str(j.first_due), last?.day ?? '', next, dollars(j.amount_cents), str(j.points), yes(j.autopay), str(j.signin), str(j.member), str(j.steps), str(j.note),
        tools.filter((t) => t.job_id === j.id).map((t) => str(t.name)).join('; '),
        supplies.filter((s) => s.job_id === j.id).map((s) => `${str(s.name)} | ${str(s.quantity)} | ${str(s.unit)}`).join('\n'),
      ];
    }));
  out.csv('upkeep-history.csv', ['Job', 'For this pet', 'Done on', 'Done by', 'Reading', 'Minutes', 'Cost', 'Points', 'Notes'],
    done.map((d) => { const j = jobName.get(d.job_id as number)!; return [str(j.name), str(j.pet), str(d.day), str(d.who), str(d.reading), str(d.minutes), dollars(d.cost_cents), str(d.points), str(d.note)]; }));
  const earned = new Map((await all(`SELECT d.done_member AS id, COUNT(*) AS n, COALESCE(SUM(d.points), 0) AS points FROM upkeep_done d
    JOIN upkeep_jobs j ON j.id = d.job_id WHERE j.owner_id = ? AND d.done_member IS NOT NULL GROUP BY d.done_member`)).map((r) => [r.id as number, r]));
  out.csv('household.csv', ['Name', 'Chores done', 'Points earned'],
    (await all('SELECT id, name FROM household_members WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id')).map((m) => [str(m.name), str(earned.get(m.id as number)?.n ?? 0), str(earned.get(m.id as number)?.points ?? 0)]));

  // ---------- routines ----------
  const routineRows = await all('SELECT r.id, r.name, r.cycle_length, r.points, r.note, u.username AS signin, m.name AS member FROM routines r LEFT JOIN users u ON u.id = r.for_user LEFT JOIN household_members m ON m.id = r.for_member WHERE r.owner_id = ? ORDER BY r.sort_order, r.id');
  const routineSteps = await all(`SELECT t.routine_id, t.name AS time_name, t.at_time, s.words, s.rule, s.weekdays, s.night, i.name AS thing, s.wait_seconds
    FROM routine_steps s JOIN routine_times t ON t.id = s.time_id JOIN routines r ON r.id = t.routine_id LEFT JOIN items i ON i.id = s.item_id
    WHERE r.owner_id = ? ORDER BY r.sort_order, r.id, t.sort_order, t.id, s.sort_order, s.id`);
  const routineById = new Map(routineRows.map((r) => [r.id as number, r]));
  out.csv('routines.csv', ['Routine', 'For (sign-in)', 'For (household)', 'Cycle nights', 'Points', 'Notes', 'Time', 'At', 'Step', 'Days', 'Thing', 'Wait (seconds)'],
    routineSteps.map((s) => {
      const r = routineById.get(s.routine_id as number)!;
      const weekdays = str(s.weekdays).split(',').map(Number).filter((n) => n >= 1 && n <= 7);
      return [str(r.name), str(r.signin), str(r.member), str(r.cycle_length), str(r.points), str(r.note), str(s.time_name), str(s.at_time), str(s.words),
        daysAsText({ rule: str(s.rule) as StepRule, weekdays, night: num(s.night) }), str(s.thing), str(s.wait_seconds)];
    }));
  out.csv('routine-history.csv', ['Routine', 'Time', 'Day finished', 'Night of the cycle', 'Points'],
    (await all(`SELECT r.name, t.name AS time_name, f.day, f.night, f.points FROM routine_finished f JOIN routine_times t ON t.id = f.time_id JOIN routines r ON r.id = t.routine_id
      WHERE r.owner_id = ? ORDER BY r.id, t.id, f.day`)).map((f) => [str(f.name), str(f.time_name), str(f.day), str(f.night), str(f.points)]));

  // ---------- pets ----------
  const pets = await all('SELECT id, name, species, breed, born_on, microchip, vet_name, vet_phone, food, note, photo_type, photo FROM pets WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id');
  const petPhoto = new Map<number, string>();
  for (const p of pets) {
    const bytes = bytesOf(p.photo);
    if (bytes && p.photo_type) petPhoto.set(p.id as number, out.binary('pictures/pets', slug(str(p.name), p.id as number), str(p.photo_type), bytes));
  }
  out.csv('pets.csv', ['Name', 'Kind of animal', 'Breed', 'Born on', 'Microchip number', 'Vet', 'Vet phone', 'Food', 'Notes', 'Photo file'],
    pets.map((p) => [str(p.name), str(p.species), str(p.breed), str(p.born_on), str(p.microchip), str(p.vet_name), str(p.vet_phone), str(p.food), str(p.note), petPhoto.get(p.id as number) ?? '']));
  out.csv('pet-weights.csv', ['Pet', 'Day', 'Weight', 'Unit'],
    (await all('SELECT p.name, w.day, w.value, w.unit FROM pet_weights w JOIN pets p ON p.id = w.pet_id WHERE p.owner_id = ? ORDER BY p.id, w.day, w.id')).map((w) => [str(w.name), str(w.day), str(w.value), str(w.unit)]));

  // ---------- the house manual, licenses ----------
  const sections: Record<string, string> = { emergency: 'In an emergency', contacts: 'Who to call', house: 'How the house works', routines: 'Day to day' };
  out.csv('house-manual.csv', ['Part', 'Title', 'Details', 'Phone', 'Place', 'Private', 'Order'],
    (await all('SELECT section, title, body, phone, place_id, private, sort_order FROM manual_entries WHERE owner_id = ? ORDER BY sort_order, id'))
      .map((m) => [sections[str(m.section)] ?? str(m.section), str(m.title), str(m.body), str(m.phone), where(m.place_id), yes(m.private), str(m.sort_order)]));
  out.csv('licenses.csv', ['License', 'Kind', 'Whose it is', 'Number', 'Issued by', 'Issued on', 'Runs out on', 'Notes'],
    (await all('SELECT name, category, holder, number, issuer, issued_on, expires_on, note FROM licenses WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id'))
      .map((l) => [str(l.name), str(l.category), str(l.holder), str(l.number), str(l.issuer), str(l.issued_on), str(l.expires_on), str(l.note)]));

  // ---------- the collection ----------
  const titles = await all('SELECT id, type, title, creator, year, summary, genres, minutes, wanted, listed_only, note FROM media WHERE owner_id = ? ORDER BY title COLLATE NOCASE, id');
  const titleOf = new Map(titles.map((t) => [t.id as number, t]));
  const covers = new Map<number, string>();
  for (const c of await all('SELECT c.media_id, c.type, c.bytes FROM media_covers c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ?')) {
    const bytes = bytesOf(c.bytes);
    if (bytes) covers.set(c.media_id as number, out.binary('pictures/covers', slug(str(titleOf.get(c.media_id as number)?.title), c.media_id as number), str(c.type), bytes));
  }
  // A title only on a list, or wanted, with no copy yet is in this file too (Not owned yet: yes), so it comes back; it is not part of what the collection counts.
  out.csv('collection.csv', ['Title', 'Type', 'By', 'Year', 'About it', 'Genres', 'Minutes', 'On the wish list', 'Notes', 'Cover file', 'Not owned yet'],
    titles.map((t) => [str(t.title), str(t.type), str(t.creator), str(t.year), str(t.summary), str(t.genres).split(',').filter(Boolean).join(', '), str(t.minutes), yes(t.wanted), str(t.note), covers.get(t.id as number) ?? '', yes(t.listed_only)]));
  out.csv('copies.csv', ['Title', 'Type', 'Format', 'Place', 'Discs or tapes', 'Barcode', 'Lent to', 'Lent on', 'Link', 'Notes', 'Kept in step with this server'],
    (await all(`SELECT c.media_id, c.format, c.place_id, c.pieces, c.barcode, c.lent_to, c.lent_on, c.link, c.note, COALESCE(ms.name, ls.name) AS server
      FROM media_copies c JOIN media m ON m.id = c.media_id LEFT JOIN media_sources ms ON ms.id = c.connection_id LEFT JOIN library_sources ls ON ls.id = c.library_source_id
      WHERE m.owner_id = ? ORDER BY c.media_id, c.id`)).map((c) => { const t = titleOf.get(c.media_id as number)!; return [str(t.title), str(t.type), str(c.format), where(c.place_id), str(c.pieces), str(c.barcode), str(c.lent_to), str(c.lent_on), str(c.link), str(c.note), str(c.server)]; }));
  out.csv('collection-log.csv', ['Title', 'Type', 'Day', 'Notes'],
    (await all('SELECT l.media_id, l.day, l.note FROM media_log l JOIN media m ON m.id = l.media_id WHERE m.owner_id = ? ORDER BY l.day, l.id'))
      .map((l) => { const t = titleOf.get(l.media_id as number)!; return [str(t.title), str(t.type), str(l.day), str(l.note)]; }));
  // The lists the person made, and To watch, read or hear: one row for each title on a list, in its order. (Wanted is the "On the wish list" column above.)
  // A list with nothing on it has one row with no title, so its name and whether it is shared are kept.
  const titleListRows: Cell[][] = [];
  for (const l of await all("SELECT id, name, builtin, shared FROM media_lists WHERE owner_id = ? AND (builtin IS NULL OR builtin = 'to_watch') ORDER BY sort_order, id")) {
    const items = await all('SELECT i.media_id, i.note, u.username AS by FROM media_list_items i LEFT JOIN users u ON u.id = i.added_by WHERE i.list_id = ? ORDER BY i.sort_order, i.id', [l.id as number]);
    if (!items.length && (l.builtin && !l.shared)) continue;
    const base = [str(l.name), yes(l.builtin), yes(l.shared)];
    if (!items.length) titleListRows.push([...base, '', '', '', '', '']);
    for (const [n, i] of items.entries()) { const t = titleOf.get(i.media_id as number)!; titleListRows.push([...base, str(n + 1), str(t.title), str(t.type), str(i.by), str(i.note)]); }
  }
  out.csv('lists.csv', ['List', 'Built in', 'Shared with everyone', 'Order', 'Title', 'Type', 'Added by', 'Notes'], titleListRows);

  // ---------- the calendar, projects, plans ----------
  out.csv('events.csv', ['Title', 'Day', 'Ends on', 'Time', 'Every year', 'Notes'],
    (await all('SELECT title, day, end_day, time, yearly, note FROM events WHERE owner_id = ? ORDER BY day, time, id')).map((e) => [str(e.title), str(e.day), str(e.end_day), str(e.time), yes(e.yearly), str(e.note)]));
  const projects = await all('SELECT id, name, activity, status, due_on, started_on, finished_on, notes FROM projects WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id');
  const projectOf = new Map(projects.map((p) => [p.id as number, p]));
  out.csv('projects.csv', ['Project', 'Activity', 'Status', 'Due on', 'Started on', 'Finished on', 'Notes'],
    projects.map((p) => [str(p.name), str(p.activity), str(p.status), str(p.due_on), str(p.started_on), str(p.finished_on), str(p.notes)]));
  out.csv('project-lines.csv', ['Project', 'What it uses', 'Amount', 'Unit', 'Used on', 'Notes'],
    (await all('SELECT pi.project_id, pi.label, pi.quantity, pi.unit, pi.used_on, pi.note FROM project_items pi JOIN projects p ON p.id = pi.project_id WHERE p.owner_id = ? ORDER BY pi.project_id, pi.sort_order, pi.id'))
      .map((l) => [str(projectOf.get(l.project_id as number)?.name), str(l.label), str(l.quantity), str(l.unit), str(l.used_on), str(l.note)]));
  out.csv('project-time.csv', ['Project', 'Day', 'Minutes', 'Notes'],
    (await all('SELECT s.project_id, s.day, s.minutes, s.note FROM project_sessions s JOIN projects p ON p.id = s.project_id WHERE p.owner_id = ? ORDER BY s.day, s.id'))
      .map((s) => [str(projectOf.get(s.project_id as number)?.name), str(s.day), str(s.minutes), str(s.note)]));
  out.csv('project-costs.csv', ['Project', 'What', 'Planned', 'Spent', 'Paid on', 'Notes'],
    (await all('SELECT c.project_id, c.label, c.planned_cents, c.actual_cents, c.paid_on, c.note FROM project_costs c JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ? ORDER BY c.project_id, c.sort_order, c.id'))
      .map((c) => [str(projectOf.get(c.project_id as number)?.name), str(c.label), dollars(c.planned_cents), dollars(c.actual_cents), str(c.paid_on), str(c.note)]));
  const plans = await all('SELECT id, name, start_day, end_day, note, story FROM plans WHERE owner_id = ? ORDER BY start_day, id');
  const planOf = new Map(plans.map((p) => [p.id as number, p]));
  out.csv('plans.csv', ['Plan', 'Starts', 'Ends', 'Notes', 'The story'], plans.map((p) => [str(p.name), str(p.start_day), str(p.end_day), str(p.note), str(p.story)]));
  out.csv('plan-items.csv', ['Plan', 'Kind', 'What', 'Amount', 'Done', 'Notes'],
    (await all('SELECT i.plan_id, i.kind, i.label, i.quantity, i.done, i.note FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE p.owner_id = ? ORDER BY i.plan_id, i.sort_order, i.id'))
      .map((i) => [str(planOf.get(i.plan_id as number)?.name), str(i.kind), str(i.label), str(i.quantity), yes(i.done), str(i.note)]));
  const planPhotos: Cell[][] = [];
  for (const p of await all('SELECT p.id, p.plan_id, p.source, p.type, p.bytes, p.caption, p.spot FROM plan_photos p JOIN plans pl ON pl.id = p.plan_id WHERE pl.owner_id = ? ORDER BY p.plan_id, p.sort_order, p.id')) {
    const plan = planOf.get(p.plan_id as number)!;
    const bytes = bytesOf(p.bytes);
    const file = bytes && p.type ? out.binary(`pictures/plans/${slug(str(plan.name), plan.id as number)}`, `photo-${p.id}`, str(p.type), bytes) : '';
    planPhotos.push([str(plan.name), str(p.caption), p.source === 'immich' ? 'In your photo library, not copied here' : 'Kept here', file, str(p.spot)]);
  }
  out.csv('plan-photos.csv', ['Plan', 'Caption', 'Where the photo is', 'File', 'Decoration spot'], planPhotos);

  // ---------- holidays: how each finds its day, and what each year keeps ----------
  const holidayRows = await all('SELECT id, name, rule, month, day_of_month, weekday, nth, lead_weeks, first_year FROM holidays WHERE owner_id = ? ORDER BY id');
  const holidayOf = new Map(holidayRows.map((h) => [h.id as number, h]));
  out.csv('holidays.csv', ['Holiday', 'How it finds its day', 'Month', 'Day of the month', 'Weekday (0 is Sunday)', 'Which one (1 to 4, or -1 for the last)', 'Start planning (weeks ahead)', 'First year of the date'],
    holidayRows.map((h) => [str(h.name), str(h.rule), str(h.month), str(h.day_of_month), str(h.weekday), str(h.nth), str(h.lead_weeks), str(h.first_year)]));
  const yearRows = await all(`SELECT y.plan_id, y.holiday_id, y.year, y.dinner_time, y.turkey_pounds, y.put_up_on, y.take_down_on, y.taken_down_on, y.budget_cents, y.notes_next, y.notes_done
    FROM holiday_years y JOIN plans p ON p.id = y.plan_id WHERE p.owner_id = ? ORDER BY y.holiday_id, y.year`);
  out.csv('holiday-years.csv', ['Holiday', 'Plan', 'Starts', 'Dinner at', 'Turkey (pounds)', 'Put up on', 'Take down on', 'Taken down on', 'Budget', 'Notes for next year', 'Notes for next year asked for'],
    yearRows.map((y) => [str(holidayOf.get(y.holiday_id as number)?.name), str(planOf.get(y.plan_id as number)?.name), str(planOf.get(y.plan_id as number)?.start_day), str(y.dinner_time), str(y.turkey_pounds),
      str(y.put_up_on), str(y.take_down_on), str(y.taken_down_on), dollars(y.budget_cents), str(y.notes_next), yes(y.notes_done)]));
  const listRows: Cell[][] = [];
  const planCells = (planId: Value | undefined) => [str(planOf.get(planId as number)?.name), str(planOf.get(planId as number)?.start_day)];
  for (const p of await all(`SELECT h.plan_id, h.role, h.name, h.done, h.note, u.username AS signin, m.name AS member FROM holiday_people h JOIN plans pl ON pl.id = h.plan_id
    LEFT JOIN users u ON u.id = h.user_id LEFT JOIN household_members m ON m.id = h.member_id WHERE pl.owner_id = ? ORDER BY h.plan_id, h.role, h.sort_order, h.id`)) {
    listRows.push([...planCells(p.plan_id), str(p.role), str(p.name), '', '', '', yes(p.done), str(p.note), str(p.signin ?? p.member)]);
  }
  for (const g of await all(`SELECT g.plan_id, g.who, g.idea, g.status, g.cents, g.note, u.username AS signin, m.name AS member FROM holiday_gifts g JOIN plans pl ON pl.id = g.plan_id
    LEFT JOIN users u ON u.id = g.for_user LEFT JOIN household_members m ON m.id = g.for_member WHERE pl.owner_id = ? ORDER BY g.plan_id, g.sort_order, g.id`)) {
    listRows.push([...planCells(g.plan_id), 'gift', str(g.idea), str(g.who), str(g.status), dollars(g.cents), '', str(g.note), str(g.signin ?? g.member)]);
  }
  for (const d of await all(`SELECT d.plan_id, d.spot, d.label, d.put_up, d.taken_down, d.boxed, d.fix, d.need, d.need_done, d.note, i.name AS thing FROM holiday_decor d JOIN plans pl ON pl.id = d.plan_id
    LEFT JOIN items i ON i.id = d.thing_id WHERE pl.owner_id = ? ORDER BY d.plan_id, d.sort_order, d.id`)) {
    const status = [d.put_up ? 'put up' : '', d.taken_down ? 'taken down' : '', d.boxed ? 'boxed' : '', d.fix ? `found ${d.fix}` : '', d.need ? `need ${d.need}` : '', d.need && d.need_done ? 'bought' : ''].filter(Boolean).join('; ');
    listRows.push([...planCells(d.plan_id), 'decoration', str(d.label), str(d.spot), status, '', '', str(d.note), str(d.thing)]);
  }
  for (const s of await all(`SELECT s.plan_id, s.words, s.rule, s.at_time, s.hours, s.done FROM holiday_steps s JOIN plans pl ON pl.id = s.plan_id WHERE pl.owner_id = ? ORDER BY s.plan_id, s.sort_order, s.id`)) {
    listRows.push([...planCells(s.plan_id), 'countdown step', str(s.words), '', str(s.rule), str(s.hours), yes(s.done), '', str(s.at_time)]);
  }
  out.csv('holiday-lists.csv', ['Plan', 'Starts', 'List', 'Name', 'Where, or who it is for', 'Status', 'Amount', 'Done', 'Note', 'Also'], listRows);

  // ---------- outdoor trips: the parts each has on, and what each year kept ----------
  const tripRows = await all('SELECT id, name, camping, fishing, hunting, private FROM outdoor_trips WHERE owner_id = ? ORDER BY id');
  const tripOf = new Map(tripRows.map((t) => [t.id as number, t]));
  out.csv('outdoor-trips.csv', ['Trip', 'Camping', 'Fishing', 'Hunting', 'Private'],
    tripRows.map((t) => [str(t.name), yes(t.camping), yes(t.fishing), yes(t.hunting), yes(t.private)]));
  const tripYears = await all(`SELECT y.plan_id, y.trip_id, y.water, y.campground, y.site, y.confirmation, y.check_in, y.check_out, y.budget_cents, y.notes_next, y.notes_done
    FROM outdoor_trip_years y JOIN plans p ON p.id = y.plan_id WHERE p.owner_id = ? ORDER BY y.trip_id, y.year`);
  out.csv('outdoor-trip-years.csv', ['Trip', 'Plan', 'Starts', 'Water', 'Campground', 'Site', 'Confirmation', 'Check in', 'Check out', 'Budget', 'Notes for next year', 'Notes for next year asked for'],
    tripYears.map((y) => [str(tripOf.get(y.trip_id as number)?.name), str(planOf.get(y.plan_id as number)?.name), str(planOf.get(y.plan_id as number)?.start_day), str(y.water), str(y.campground), str(y.site),
      str(y.confirmation), str(y.check_in), str(y.check_out), dollars(y.budget_cents), str(y.notes_next), yes(y.notes_done)]));
  // One list file for what a year keeps. After the plan and its first day come: list, name, part, day, place or water, length, weight, amount, status, also, note, tag number or caliber.
  const tripList: Cell[][] = [];
  for (const g of await all(`SELECT g.plan_id, g.part, g.label, g.quantity, g.caliber, g.packed, g.returned, g.after_trip, g.after_done, g.note, i.name AS thing FROM outdoor_gear g JOIN plans pl ON pl.id = g.plan_id
    LEFT JOIN items i ON i.id = g.thing_id WHERE pl.owner_id = ? ORDER BY g.plan_id, g.sort_order, g.id`)) {
    const status = [g.packed ? 'packed' : '', g.returned ? 'returned' : '', g.after_trip ? `after ${g.after_trip}` : '', g.after_trip && g.after_done ? 'after done' : ''].filter(Boolean).join('; ');
    tripList.push([...planCells(g.plan_id), 'gear', str(g.label), str(g.part), '', '', '', '', str(g.quantity), status, str(g.thing), str(g.note), str(g.caliber)]);
  }
  for (const s of await all(`SELECT s.plan_id, s.part, s.label, s.opens_on, s.closes_on, s.remind_days, s.note FROM outdoor_seasons s JOIN plans pl ON pl.id = s.plan_id WHERE pl.owner_id = ? ORDER BY s.plan_id, s.opens_on, s.id`)) {
    tripList.push([...planCells(s.plan_id), 'season', str(s.label), str(s.part), str(s.opens_on), str(s.closes_on), '', '', str(s.remind_days), '', '', str(s.note), '']);
  }
  for (const c of await all(`SELECT c.plan_id, c.fish, c.day, c.water, c.length_inches, c.weight_lb, c.kept, c.lure, c.frozen, c.note, i.name AS thing FROM outdoor_catch c JOIN plans pl ON pl.id = c.plan_id
    LEFT JOIN items i ON i.id = c.lure_thing_id WHERE pl.owner_id = ? ORDER BY c.plan_id, c.day, c.id`)) {
    tripList.push([...planCells(c.plan_id), 'catch', str(c.fish), 'fishing', str(c.day), str(c.water), str(c.length_inches), str(c.weight_lb), '', [c.kept ? 'kept' : 'released', c.frozen ? 'frozen' : ''].filter(Boolean).join('; '), str(c.thing ?? c.lure), str(c.note), '']);
  }
  for (const h of await all(`SELECT h.plan_id, h.animal, h.day, h.place, h.tag_number, h.weight_lb, h.frozen, h.note FROM outdoor_harvest h JOIN plans pl ON pl.id = h.plan_id WHERE pl.owner_id = ? ORDER BY h.plan_id, h.day, h.id`)) {
    tripList.push([...planCells(h.plan_id), 'harvest', str(h.animal), 'hunting', str(h.day), str(h.place), '', str(h.weight_lb), '', h.frozen ? 'frozen' : '', '', str(h.note), str(h.tag_number)]);
  }
  out.csv('outdoor-trip-lists.csv', ['Plan', 'Starts', 'List', 'Name', 'Part', 'Day', 'Place or water', 'Length (inches)', 'Weight (pounds)', 'Amount', 'Status', 'Also', 'Note', 'Tag number or caliber'], tripList);

  // ---------- spending ----------
  const categories = await all('SELECT id, name, monthly_cents FROM money_categories WHERE owner_id = ? ORDER BY sort_order, id');
  const sharedWith = await all('SELECT s.category_id, u.username FROM money_shares s JOIN users u ON u.id = s.user_id JOIN money_categories c ON c.id = s.category_id WHERE c.owner_id = ? ORDER BY u.username');
  out.csv('money-categories.csv', ['Category', 'Each month', 'Shared with'],
    categories.map((c) => [str(c.name), dollars(c.monthly_cents), sharedWith.filter((s) => s.category_id === c.id).map((s) => str(s.username)).join('; ')]));
  // What was paid on a project is an entry too, but it is in project-costs.csv (with the project), so it is not listed twice.
  out.csv('money-entries.csv', ['What', 'Amount', 'Day', 'Category', 'Category shared with you by', 'Notes'],
    (await all(`SELECT e.label, e.cents, e.day, e.note, c.name AS category, c.owner_id AS category_owner, cu.username AS category_by
      FROM money_entries e LEFT JOIN money_categories c ON c.id = e.category_id LEFT JOIN users cu ON cu.id = c.owner_id WHERE e.owner_id = ? AND e.project_id IS NULL ORDER BY e.day, e.id`))
      .map((e) => [str(e.label), dollars(e.cents), str(e.day), str(e.category), e.category !== null && e.category_owner !== owner ? str(e.category_by) : '', str(e.note)]));

  // Income and savings goals (bills are upkeep jobs, in upkeep.csv).
  if (await hasTable(q, 'money_income')) {
    out.csv('money-income.csv', ['What', 'Amount', 'How often', 'First day', 'Last day'],
      (await all('SELECT name, cents, every, start_day, end_day FROM money_income WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id'))
        .map((i) => [str(i.name), dollars(i.cents), str(i.every).replace('_', ' '), str(i.start_day), str(i.end_day)]));
    out.csv('money-goals.csv', ['Goal', 'Target', 'Reach it by', 'Saved so far', 'For project'],
      (await all(`SELECT g.name, g.target_cents, g.by_day, COALESCE((SELECT SUM(s.cents) FROM money_goal_saved s WHERE s.goal_id = g.id), 0) AS saved,
          (SELECT p.name FROM projects p WHERE p.id = g.project_id AND p.owner_id = g.owner_id) AS project FROM money_goals g WHERE g.owner_id = ? ORDER BY g.id`))
        .map((g) => [str(g.name), dollars(g.target_cents), str(g.by_day), signedDollars(g.saved), str(g.project)]));
    out.csv('money-goal-saved.csv', ['Goal', 'Day', 'Amount (below zero is taken out)'],
      (await all('SELECT g.name, s.day, s.cents FROM money_goal_saved s JOIN money_goals g ON g.id = s.goal_id WHERE g.owner_id = ? ORDER BY s.day, s.id'))
        .map((s) => [str(s.name), str(s.day), signedDollars(s.cents)]));
  }

  // ---------- servers and accounts: names and addresses only ----------
  const connections: Cell[][] = [];
  for (const s of await all('SELECT kind, name, url, every_hours, last_sync_at FROM media_sources WHERE owner_id = ? ORDER BY id')) connections.push([str(s.kind) === 'emby' ? 'Emby server' : 'Jellyfin server', str(s.name), plainAddress(str(s.url)), str(s.every_hours), str(s.last_sync_at)]);
  for (const s of await all('SELECT kind, name, url, every_hours, last_sync_at FROM library_sources WHERE owner_id = ? ORDER BY id')) connections.push([`Book server (${str(s.kind)})`, str(s.name), plainAddress(str(s.url)), str(s.every_hours), str(s.last_sync_at)]);
  for (const m of await all('SELECT address, name FROM mail_accounts WHERE owner_id = ? ORDER BY id')) connections.push(['Email account', str(m.name), str(m.address), '', '']);
  for (const c of await all('SELECT name, show, zone FROM followed_calendars WHERE owner_id = ? ORDER BY id')) connections.push(['Calendar you follow', str(c.name), '', '', `${str(c.show) === 'titles' ? 'titles shown' : 'busy times only'}; ${str(c.zone)}`]);
  out.csv('connections.csv', ['What it is', 'Name', 'Address', 'Read every (hours)', 'Last read or note'], connections);

  // ---------- preferences ----------
  const settingRows: Cell[][] = [];
  for (const s of await all('SELECT key, value FROM user_settings WHERE user_id = ? ORDER BY key')) {
    const key = str(s.key);
    if (PLAIN_SETTINGS[key]) settingRows.push([PLAIN_SETTINGS[key], str(s.value)]);
    else missing.push(LEFT_SETTINGS[key] ?? (key.startsWith('license_lead_') ? LEFT_SETTINGS.license_lead_! : key));
  }
  out.csv('settings.csv', ['Preference', 'Value'], settingRows);
  return missing;
}

export type Everything = {
  filename: string;
  bytes: Uint8Array;
  /** The files in it. */
  files: number;
  /** How many of them are pictures and papers. */
  pictures: number;
  /** Records in each spreadsheet, by file name. */
  counts: Record<string, number>;
};

/**
 * One person's own data as a zip. Never anyone else's: everything is read by that person's id. Held in memory
 * while it is made; refused, in plain words, when the pictures and papers alone would pass MAX_EXPORT_BYTES.
 */
export async function exportEverything(db: Db, owner: number, clock: Clock = () => new Date(), most = MAX_EXPORT_BYTES): Promise<Everything> {
  const at = clock();
  const today = todayOf(clock);
  const out = new Out();
  let leftOut: string[] = [];
  const person = await db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [owner]);
  if (!person) throw new Problem(404, 'Not found');
  await atomic(db, async (tx) => {
    // The pictures are the weight: counted first, so a download too large is refused before any is read.
    let weight = 0;
    for (const sql of [
      'SELECT COALESCE(SUM(LENGTH(p.bytes)), 0) AS n FROM item_photos p JOIN items i ON i.id = p.item_id WHERE i.owner_id = ?',
      'SELECT COALESCE(SUM(LENGTH(d.bytes)), 0) AS n FROM item_documents d JOIN items i ON i.id = d.item_id WHERE i.owner_id = ?',
      'SELECT COALESCE(SUM(LENGTH(photo)), 0) AS n FROM pets WHERE owner_id = ?',
      'SELECT COALESCE(SUM(LENGTH(p.bytes)), 0) AS n FROM plan_photos p JOIN plans l ON l.id = p.plan_id WHERE l.owner_id = ?',
      'SELECT COALESCE(SUM(LENGTH(c.bytes)), 0) AS n FROM media_covers c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ?',
    ]) weight += (await tx.get<{ n: number }>(sql, [owner]))?.n ?? 0;
    if (await hasTable(tx, 'trip_receipts')) weight += (await tx.get<{ n: number }>('SELECT COALESCE(SUM(LENGTH(bytes)), 0) AS n FROM trip_receipts WHERE owner_id = ?', [owner]))?.n ?? 0;
    if (await hasTable(tx, 'recipe_photos')) weight += (await tx.get<{ n: number }>('SELECT COALESCE(SUM(LENGTH(p.bytes)), 0) AS n FROM recipe_photos p JOIN recipes r ON r.id = p.recipe_id WHERE r.owner_id = ?', [owner]))?.n ?? 0;
    if (weight > most) {
      const mb = (n: number) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) / 1024 : Math.round(n / (1024 * 1024))).toLocaleString('en-US');
      throw new Problem(422, `Your pictures and papers add up to ${mb(weight)} MB, which is more than one download can hold (${mb(most)} MB). Make an encrypted backup instead, which keeps everything, or remove some large pictures and try again.`);
    }
    leftOut = await gather(tx, owner, today, out);
  });

  // The recipes again, in the open format other recipe apps read (one folder for each, a recipe.json inside).
  const open = await kitchen(db, owner, clock).exportRecipes();
  for (const file of open) out.text(`recipes-open-format/${file.path}`, file.text);

  const counts = Object.fromEntries(out.counts);
  out.files.unshift({ path: 'README.txt', bytes: new TextEncoder().encode(readme(at, today, counts, out.pictures, open.length, leftOut)) });
  const bytes = await makeZip(out.files, at);
  return { filename: `lifeis-everything-${today}.zip`, bytes, files: out.files.length, pictures: out.pictures, counts };
}

const FILE_ABOUT: [string, string][] = [
  ['recipes.csv', 'Your recipes: title, servings, times, tags, ingredients and steps as text, where it came from, notes.'],
  ['tags.csv', 'Your tags as paths such as Kitchen > Appliances, and each thing, recipe, project, plan, spending line, title, pet, job or date that carries them.'],
  ['recipes-open-format/', 'The same recipes in the open format other recipe apps read (a folder each, with a recipe.json). Put the Recipes folder into a Nextcloud Cookbook.'],
  ['meal-plan.csv', 'The meals planned on the week.'],
  ['grocery-list.csv', 'The grocery list, with what is already checked off.'],
  ['pantry.csv', 'What you have in the pantry, fridge and freezer.'],
  ['prices.csv', 'Prices you paid.'],
  ['coupons.csv', 'Coupons.'],
  ['stores.csv', 'The stores you use, to choose from.'],
  ['barcodes.csv', 'The barcodes you taught Life Is for groceries: which ingredient each is, its product name and its size.'],
  ['places.csv', 'Every place (a room, a shelf, a box) as its full path, such as Sewing room › Shelf 2.'],
  ['kinds.csv', 'The kinds of thing you made (Fabric, Seeds) and the fields each has.'],
  ['things.csv', 'Everything you keep: where it is, how many, what it cost and is worth, model and serial number, warranty, asset number, whether it is insured, whether it has gone (sold, given away, thrown out or stolen), and a column for each field of its kind.'],
  ['thing-own-fields.csv', 'The fields you added to one thing yourself: a name and a value for each.'],
  ['thing-papers.csv', 'The receipts, manuals and warranty cards kept with things, and the file each is in.'],
  ['thing-history.csv', 'Where each thing has been and what it was used for.'],
  ['upkeep.csv', 'Jobs that come round again, bills, renewals and chores: how often, when last done and next due.'],
  ['upkeep-history.csv', 'Each time each job was done.'],
  ['household.csv', 'People in the household, and the chore points each has earned.'],
  ['routines.csv', 'Routines: one row for each step, with its time of day, which days it falls on and the thing it uses. routine-history.csv has the days each time was finished.'],
  ['pets.csv', 'Your pets.'],
  ['pet-weights.csv', 'Your pets’ weights over time. Their care is in upkeep.csv, with the pet’s name.'],
  ['house-manual.csv', 'The house manual. Entries marked private in the Private column are included: this is your own copy.'],
  ['licenses.csv', 'Licenses and permits, with their numbers. The numbers are included because this file is yours alone; keep it as carefully as the license itself.'],
  ['collection.csv', 'The titles in your collection (films, shows, music, books, games).'],
  ['copies.csv', 'Each copy of a title: format, place, discs, who it is lent to, and its link.'],
  ['collection-log.csv', 'When you watched, read, listened to or played something.'],
  ['lists.csv', 'Your lists of titles (To watch, read or hear, and the ones you made): each title on each list, in order, and whether the list is shared. Titles you do not own yet are in collection.csv, marked Not owned yet.'],
  ['events.csv', 'Calendar events you wrote.'],
  ['projects.csv', 'Projects, and project-lines.csv, project-time.csv and project-costs.csv for what they use, the time spent and what they cost.'],
  ['plans.csv', 'Plans, and plan-items.csv and plan-photos.csv for what belongs to each.'],
  ['holidays.csv', 'Holidays: how each finds its day. holiday-years.csv has each year (its plan, dinner time, turkey, days to put up and take down, notes for next year) and holiday-lists.csv has what each year keeps: guests, cards, gifts, decorations and countdown steps.'],
  ['outdoor-trips.csv', 'Outdoor trips: the parts each has on. outdoor-trip-years.csv has each year (its plan, the water, the site booking, notes for next year) and outdoor-trip-lists.csv has what each year kept: the bring list, seasons, the catch log and the harvest log.'],
  ['money-categories.csv', 'Your spending categories and what each is for a month.'],
  ['money-entries.csv', 'What you wrote down as spent.'],
  ['money-income.csv', 'What comes in, and how often; money-goals.csv and money-goal-saved.csv for savings goals and what was put toward each. Bills are in upkeep.csv.'],
  ['connections.csv', 'Servers and accounts you connected: names and addresses only, never a key or a password.'],
  ['settings.csv', 'Your plain preferences.'],
  ['pictures/ and papers/', 'Every photo, cover and paper, in a folder named for what it belongs to. The spreadsheets say which file is whose.'],
];

function readme(at: Date, today: string, counts: Record<string, number>, pictures: number, recipes: number, leftOut: string[]): string {
  const importable = KINDS.filter((k) => k.importable).map((k) => `  - ${k.label} (matched ${k.matched})`).join('\n');
  const notYet = KINDS.filter((k) => !k.importable).map((k) => `  - ${k.label}`).join('\n');
  const rows = Object.entries(counts).filter(([, n]) => n > 0).map(([file, n]) => `  ${file}: ${n}`).join('\n') || '  (nothing was kept yet)';
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const ignored = [...new Set(leftOut)];
  return [
    'Everything you keep in Life Is',
    '==============================',
    '',
    `Made on ${today} at ${clock}, on your own Life Is. It was made on your own computer or phone and sent nowhere: no one else has it, and Life Is did not copy it anywhere.`,
    'This is the whole of your own data, in files you can open in a spreadsheet or another app. Nothing in it belongs to anyone else in your household.',
    '',
    'WHAT IS IN IT',
    ...FILE_ABOUT.map(([file, about]) => `  ${file}\n      ${about}`),
    '',
    'HOW MUCH',
    rows,
    `  ${recipes} recipes in the open recipe format, ${pictures} pictures and papers.`,
    '',
    'ABOUT THE FILES',
    '  The spreadsheets are plain CSV in UTF-8. Dates are year-month-day (2026-11-22). Money is in dollars with cents (12.50).',
    '  A cell that begins with a = + @ or - has a single quote put in front of it so a spreadsheet does not try to run it as a formula. Life Is takes the quote off when it reads the file back.',
    '',
    'WHAT IS LEFT OUT, AND WHY',
    ...LEFT_OUT.map((l) => `  - ${l.what}: ${l.why}`),
    ...(ignored.length ? ['', '  Also left out of settings.csv, because they are not plain preferences or are tied to this Life Is: ' + ignored.join(', ') + '.'] : []),
    '  settings.csv holds only plain preferences (which parts of Life Is you show, a money sign, and the like).',
    '',
    'IMPORTING IT BACK',
    '  To put everything back exactly as it was, into an empty Life Is, use the encrypted backup (Settings, Your data): it holds everything, including what is left out here, and only your passphrase opens it.',
    '  To import these open files into a Life Is that is already in use (a second copy, or after starting fresh), open Settings, Your data, "Import from a download", and choose this zip. You choose which kinds to import. The kinds that can be imported:',
    importable,
    '  Nothing is ever overwritten or deleted. A record that matches one already kept (by what is in brackets above) is left as it is; a new one is added; importing the same file twice adds nothing the second time.',
    '  Links are rebuilt by name: a thing’s place by its path (a missing place is made), a meal’s recipe by its title, a pet’s care by the pet’s name. Where a link cannot be rebuilt the record still comes in, without it, and the report says how many. A license’s reminder is not recreated, only the license.',
    '  Not yet able to be imported (they are here for you to read and keep):',
    notYet,
    '',
  ].join('\r\n');
}

// ==================== reading a download ====================

type Table = { headers: string[]; rows: Record<string, string>[] };
export type Files = Record<string, string>;

/** What the spreadsheet cell holds, with the quote that protected it from a spreadsheet taken off. */
const unguarded = (cell: string) => (/^'(?:[=+@\t\r]|-[^0-9.])/.test(cell) ? cell.slice(1) : cell);

function tableOf(files: Files, name: string): Table | null {
  const key = Object.keys(files).find((k) => k.toLowerCase() === name) ?? Object.keys(files).find((k) => k.toLowerCase().replace(/^[^/]*\//, '') === name && k.split('/').length === 2);
  if (key === undefined) return null;
  const rows = csvRows((files[key] ?? '').replace(/\r\n?/g, '\n'));
  const headers = (rows[0] ?? []).map((h) => unguarded(h).trim().toLowerCase());
  return { headers, rows: rows.slice(1).map((cells) => Object.fromEntries(headers.map((h, at) => [h, unguarded(cells[at] ?? '')]))) };
}

const cellOf = (row: Record<string, string>, heading: string): string => (row[heading.toLowerCase()] ?? '').trim();
const numberOf = (text: string): number | null => { const n = Number(text.replace(/[$,\s]/g, '')); return text.trim() !== '' && Number.isFinite(n) ? n : null; };
const wholeOf = (text: string): number | null => { const n = numberOf(text); return n !== null && Number.isInteger(n) ? n : null; };
const centsOf = (text: string): number | null => { const n = numberOf(text); return n !== null && n >= 0 && n < 1e10 ? Math.round(n * 100) : null; };
/** Dollars that may be below zero (money taken back out of a goal), as whole cents. */
const signedCentsOf = (text: string): number | null => { const n = numberOf(text); return n !== null && Math.abs(n) < 1e10 ? Math.round(n * 100) : null; };
/** A barcode as it is kept: letters and digits only, upper case; null when it is not one. */
const barcodeOf = (text: string): string | null => { const code = text.replace(/[^0-9A-Za-z]/g, '').toUpperCase(); return /^[0-9A-Z]{4,40}$/.test(code) ? code : null; };
const dayOf = (text: string): string | null => { if (!text.trim()) return null; try { dayNumber(text.trim()); return text.trim(); } catch { return null; } };
const yesOf = (text: string): boolean => /^(yes|y|true|1)$/i.test(text.trim());
const listOf = (text: string): string[] => text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);

// ---------- what a download holds ----------

export type KindReport = {
  key: string;
  label: string;
  /** Whether it can be brought in. */
  importable: boolean;
  /** Records in its spreadsheet. */
  found: number;
  /** New records (what choosing it would add). */
  fresh: number;
  /** Records that match what is already kept, which are left as they are. */
  already: number;
  /** Records brought in without a link that could not be rebuilt, or with a part that could not be kept. */
  unlinked: number;
  /** Records that could not be read, with why (the first few). */
  skipped: string[];
  /** Pictures and papers to follow. */
  pictures: number;
  /** In a real import: whether the kind came in, and if not why not. */
  ok?: boolean;
  problem?: string;
  /** Anything else worth saying in a sentence. */
  note?: string;
};
export type Pending = { file: string; as: 'thing-photo' | 'thing-paper' | 'pet-photo' | 'cover' | 'plan-photo'; id: number; kind?: string; name?: string; spot?: string };
export type Brought = { kinds: KindReport[]; pending: Pending[] };

type Ctx = { tx: Queries; owner: number; today: string; at: string; files: Files };
type Done = { found: number; fresh: number; already: number; unlinked: number; skipped: string[]; pending: Pending[]; note?: string };
const blank = (): Done => ({ found: 0, fresh: 0, already: 0, unlinked: 0, skipped: [], pending: [] });
const MAX_NOTED = 5;
const skip = (d: Done, row: number, why: string) => { if (d.skipped.length < MAX_NOTED) d.skipped.push(`Row ${row + 2}: ${why}`); };

/** Matching with room for twins: the nth identical record in a file is "already there" only if that many are already kept. */
class Seen {
  private kept = new Map<string, number>();
  private met = new Map<string, number>();
  constructor(keys: string[]) { for (const k of keys) this.kept.set(k, (this.kept.get(k) ?? 0) + 1); }
  /** True when this one is already kept. */
  take(key: string): boolean {
    const met = (this.met.get(key) ?? 0) + 1;
    this.met.set(key, met);
    return met <= (this.kept.get(key) ?? 0);
  }
}

/** The person's places, in memory, so a path can be found or made. */
class PlaceBook {
  private ids = new Map<string, number>();
  private rows: { id: number; parent_id: number | null; name: string }[] = [];
  made = 0;
  private tx: Queries;
  private owner: number;
  private at: string;
  constructor(tx: Queries, owner: number, at: string) { this.tx = tx; this.owner = owner; this.at = at; }
  static async load(tx: Queries, owner: number, at: string): Promise<PlaceBook> {
    const book = new PlaceBook(tx, owner, at);
    for (const p of await tx.all<{ id: number; parent_id: number | null; name: string }>('SELECT id, parent_id, name FROM places WHERE owner_id = ? ORDER BY id', [owner])) {
      book.rows.push(p);
      const key = `${p.parent_id ?? 0}|${labelKey(p.name)}`;
      if (!book.ids.has(key)) book.ids.set(key, p.id);
    }
    return book;
  }
  private names(path: string): string[] { return path.split(/\s*[›>]\s*/).map((n) => n.trim()).filter(Boolean).slice(0, 10); }
  /** A path written one way, whatever way it was typed ("Sewing room>Shelf 2" is "Sewing room › Shelf 2"). */
  normal(path: string): string { return this.names(path).join(' › '); }
  private cache: Map<number, string> | null = null;
  find(path: string): number | null {
    let parent = 0;
    for (const name of this.names(path)) {
      const id = this.ids.get(`${parent}|${labelKey(name)}`);
      if (id === undefined) return null;
      parent = id;
    }
    return parent || null;
  }
  async ensure(path: string): Promise<number | null> {
    let parent = 0;
    for (const name of this.names(path)) {
      const key = `${parent}|${labelKey(name)}`;
      let id = this.ids.get(key);
      if (id === undefined) {
        id = (await this.tx.run('INSERT INTO places (owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?)', [this.owner, parent || null, cut(name, 80), this.at])).lastId;
        this.ids.set(key, id);
        this.rows.push({ id, parent_id: parent || null, name });
        this.cache = null;
        this.made += 1;
      }
      parent = id;
    }
    return parent || null;
  }
  pathOf(id: number | null): string { return id === null ? '' : this.all().get(id) ?? ''; }
  all(): Map<number, string> {
    this.cache ??= placePaths(this.rows.map((r) => ({ ...r, note: null })));
    return this.cache;
  }
}

async function ingredientFor(tx: Queries, owner: number, name: string): Promise<number | null> {
  const key = units.nameKey(name);
  if (!key) return null;
  const found = await tx.get<{ id: number }>('SELECT id FROM ingredients WHERE owner_id = ? AND key = ?', [owner, key]);
  if (found) return found.id;
  return (await tx.run('INSERT INTO ingredients (owner_id, name, key) VALUES (?, ?, ?)', [owner, cut(name.trim(), 120), key])).lastId;
}

type Importer = (c: Ctx) => Promise<Done>;

const importers: Record<string, Importer> = {
  async places(c) {
    const d = blank();
    const t = tableOf(c.files, 'places.csv');
    if (!t) return d;
    const book = await PlaceBook.load(c.tx, c.owner, c.at);
    for (const [at, row] of t.rows.entries()) {
      const path = cellOf(row, 'Place');
      if (!path) { skip(d, at, 'it has no place'); continue; }
      d.found += 1;
      if (book.find(path)) { d.already += 1; continue; }
      const id = await book.ensure(path);
      const state = cellOf(row, 'Box packed');
      await c.tx.run('UPDATE places SET note = ?, box_state = ?, box_destination = ? WHERE id = ?',
        [clean(row.note, 500), ['packing', 'packed', 'moved', 'unpacked'].includes(state) ? state : null, clean(cellOf(row, 'Box is going to'), 200), id]);
      d.fresh += 1;
    }
    return d;
  },

  async things(c) {
    const d = blank();
    const t = tableOf(c.files, 'things.csv');
    if (!t) return d;
    const book = await PlaceBook.load(c.tx, c.owner, c.at);
    // Kinds: the ones that are not kept are made, with the fields kinds.csv lists. One that is kept is left as it is.
    const kinds = new Map<string, { id: number; fields: Map<string, { id: number; type: string; choices: string[] }> }>();
    for (const k of await c.tx.all<{ id: number; key: string }>('SELECT id, key FROM kinds WHERE owner_id = ?', [c.owner])) kinds.set(k.key, { id: k.id, fields: new Map() });
    for (const f of await c.tx.all<{ kind_id: number; key: string; id: number; type: string; choices: string | null }>('SELECT f.kind_id, f.key, f.id, f.type, f.choices FROM kind_fields f JOIN kinds k ON k.id = f.kind_id WHERE k.owner_id = ?', [c.owner])) {
      for (const k of kinds.values()) if (k.id === f.kind_id) k.fields.set(f.key, { id: f.id, type: f.type, choices: f.choices ? (JSON.parse(f.choices) as string[]) : [] });
    }
    let madeKinds = 0;
    const madeNow = new Set<number>();
    for (const row of tableOf(c.files, 'kinds.csv')?.rows ?? []) {
      const name = clean(cellOf(row, 'Kind'), 80);
      if (!name) continue;
      let kind = kinds.get(labelKey(name));
      if (!kind) {
        const id = (await c.tx.run('INSERT INTO kinds (owner_id, name, key, icon, unit, activity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [c.owner, name, labelKey(name), clean(cellOf(row, 'Icon'), 16), units.canonical(clean(cellOf(row, 'Usual unit'), 20)), clean(cellOf(row, 'For activity'), 60), c.at])).lastId;
        kind = { id, fields: new Map() };
        kinds.set(labelKey(name), kind);
        madeNow.add(id);
        madeKinds += 1;
      }
      // Fields are added only to a kind made here; a kind that was already kept keeps the fields it has.
      const fieldName = clean(cellOf(row, 'Field'), 60);
      const type = cellOf(row, 'Field is');
      if (madeNow.has(kind.id) && fieldName && ['text', 'number', 'choice', 'yesno', 'date', 'link'].includes(type) && !kind.fields.has(labelKey(fieldName))) {
        const choices = type === 'choice' ? listOf(cellOf(row, 'Choices')) : [];
        if (type !== 'choice' || choices.length) {
          const id = (await c.tx.run('INSERT INTO kind_fields (kind_id, name, key, type, unit, choices, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [kind.id, fieldName, labelKey(fieldName), type, type === 'number' ? clean(cellOf(row, 'Field unit'), 20) : null, choices.length ? JSON.stringify(choices) : null, kind.fields.size])).lastId;
          kind.fields.set(labelKey(fieldName), { id, type, choices });
        }
      }
    }

    // The columns that are one kind's own field ("Fabric: Width").
    const base = new Set(['name', 'kind', 'place', 'amount', 'unit', 'running low at', 'notes', 'for activities', 'barcode', 'make or model', 'serial number', 'bought on', 'bought at', 'cost', 'worth now', 'warranty until', 'photo file', 'asset number', 'insured', 'no longer have', 'gone on', 'gone to', 'gone price']);
    const own = t.headers.filter((h) => !base.has(h) && h.includes(': ')).map((h) => ({ heading: h, kind: labelKey(h.slice(0, h.indexOf(': '))), field: labelKey(h.slice(h.indexOf(': ') + 2)) }));

    const kept = await c.tx.all<{ name: string; place_id: number | null }>('SELECT name, place_id FROM items WHERE owner_id = ?', [c.owner]);
    // Asset numbers: one given in the file is kept when nothing has it; otherwise the next one in order.
    const taken = new Set((await c.tx.all<{ n: number }>('SELECT asset_no AS n FROM items WHERE owner_id = ?', [c.owner])).map((r) => r.n));
    let nextAsset = Math.max(0, ...taken);
    const seen = new Seen(kept.map((i) => `${labelKey(i.name)}\n${labelKey(i.place_id === null ? '' : book.pathOf(i.place_id))}`));
    const fresh = new Map<string, number>();
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Name'), 200);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      const placeText = cellOf(row, 'Place');
      const key = `${labelKey(name)}\n${labelKey(book.normal(placeText))}`;
      if (seen.take(key)) { d.already += 1; continue; }
      const kindName = clean(cellOf(row, 'Kind'), 80) ?? 'Things';
      let kind = kinds.get(labelKey(kindName));
      if (!kind) {
        const id = (await c.tx.run('INSERT INTO kinds (owner_id, name, key, created_at) VALUES (?, ?, ?, ?)', [c.owner, kindName, labelKey(kindName), c.at])).lastId;
        kind = { id, fields: new Map() };
        kinds.set(labelKey(kindName), kind);
        madeKinds += 1;
      }
      const placeId = placeText ? await book.ensure(placeText) : null;
      const quantity = numberOf(cellOf(row, 'Amount'));
      const price = centsOf(cellOf(row, 'Cost'));
      const worth = centsOf(cellOf(row, 'Worth now'));
      let assetNo = assetNumber(cellOf(row, 'Asset number'));
      if (assetNo === null || assetNo < 1 || taken.has(assetNo)) { do nextAsset += 1; while (taken.has(nextAsset)); assetNo = nextAsset; }
      taken.add(assetNo);
      const goneOn = dayOf(cellOf(row, 'Gone on')) ? cellOf(row, 'Gone on') : '';
      const goneHow = (GONE_HOW as readonly string[]).includes(labelKey(cellOf(row, 'No longer have'))) ? labelKey(cellOf(row, 'No longer have')) : 'thrown';
      const made = await c.tx.run(
        `INSERT INTO items (owner_id, kind_id, name, quantity, unit, place_id, low_at, note, barcode, bought_on, bought_at, price_cents, value_cents, serial, model, warranty_until,
           asset_no, insured, gone_on, gone_how, gone_to, gone_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.owner, kind.id, name, quantity !== null && quantity >= 0 ? quantity : null, units.canonical(clean(cellOf(row, 'Unit'), 20)), placeId,
          numberOf(cellOf(row, 'Running low at')), clean(row.notes, 5000), clean(cellOf(row, 'Barcode').replace(/[^0-9A-Za-z]/g, '').toUpperCase(), 40),
          dayOf(cellOf(row, 'Bought on')), clean(cellOf(row, 'Bought at'), 120), price, worth, clean(cellOf(row, 'Serial number'), 120), clean(cellOf(row, 'Make or model'), 120),
          dayOf(cellOf(row, 'Warranty until')), assetNo, yesOf(cellOf(row, 'Insured')) ? 1 : 0,
          goneOn ? dayOf(goneOn) : null, goneOn ? goneHow : null, goneOn ? clean(cellOf(row, 'Gone to'), 200) : null, goneOn ? centsOf(cellOf(row, 'Gone price')) : null, c.at, c.at]);
      const id = made.lastId;
      fresh.set(key, fresh.get(key) ?? id);
      d.fresh += 1;
      for (const [n, activity] of [...new Map(listOf(cellOf(row, 'For activities')).map((a) => [labelKey(a), a])).entries()].slice(0, 20).entries()) {
        void n;
        await c.tx.run('INSERT INTO item_activities (item_id, activity, key) VALUES (?, ?, ?)', [id, cut(activity[1], 60), activity[0]]);
      }
      let lost = false;
      for (const column of own) {
        if (column.kind !== labelKey(kindName)) continue;
        const text = (row[column.heading] ?? '').trim();
        if (!text) continue;
        const field = kind.fields.get(column.field);
        if (!field) { lost = true; continue; }
        let stored: string | null = null;
        if (field.type === 'number') stored = numberOf(text) === null ? null : String(numberOf(text));
        else if (field.type === 'yesno') stored = yesOf(text) ? '1' : /^(no|n|false|0)$/i.test(text) ? '0' : null;
        else if (field.type === 'date') stored = dayOf(text);
        else if (field.type === 'choice') stored = field.choices.find((choice) => labelKey(choice) === labelKey(text)) ?? null;
        else stored = clean(text, 2000);
        if (stored === null) lost = true;
        else await c.tx.run('INSERT INTO item_values (item_id, field_id, value) VALUES (?, ?, ?)', [id, field.id, stored]);
      }
      if (lost) d.unlinked += 1;
      await noteHistory(c.tx, c.owner, { item_id: id }, { what: 'added', to_place: placeId ? book.pathOf(placeId) : null, day: c.today, at: c.at });
      const photo = cellOf(row, 'Photo file');
      if (photo) d.pending.push({ file: photo, as: 'thing-photo', id });
    }
    // The fields of their own that people gave the things that came in now.
    const ownSeen = new Map<number, Set<string>>();
    for (const row of tableOf(c.files, 'thing-own-fields.csv')?.rows ?? []) {
      const id = fresh.get(`${labelKey(cellOf(row, 'Thing'))}\n${labelKey(book.normal(cellOf(row, 'Place')))}`);
      const name = clean(cellOf(row, 'Field'), 60);
      const value = clean(cellOf(row, 'Value'), 2000);
      if (id === undefined || !name || !value) continue;
      const have = ownSeen.get(id) ?? new Set<string>();
      if (have.has(labelKey(name)) || have.size >= 30) continue;
      have.add(labelKey(name));
      ownSeen.set(id, have);
      await c.tx.run('INSERT INTO item_fields (item_id, name, value, sort_order) VALUES (?, ?, ?, ?)', [id, name, value, have.size]);
    }
    // The papers of the things that came in now.
    for (const row of tableOf(c.files, 'thing-papers.csv')?.rows ?? []) {
      const key = `${labelKey(cellOf(row, 'Thing'))}\n${labelKey(book.normal(cellOf(row, 'Place')))}`;
      const id = fresh.get(key);
      const file = cellOf(row, 'File');
      if (id !== undefined && file) d.pending.push({ file, as: 'thing-paper', id, kind: cellOf(row, 'Kind of paper'), name: cellOf(row, 'Name') });
    }
    const extra = [madeKinds ? `${madeKinds} kind${madeKinds === 1 ? '' : 's'} of thing made` : '', book.made ? `${book.made} place${book.made === 1 ? '' : 's'} made` : ''].filter(Boolean).join(', ');
    if (extra) d.note = extra;
    return d;
  },

  async recipes(c) {
    const d = blank();
    const t = tableOf(c.files, 'recipes.csv');
    if (!t) return d;
    const kept = await c.tx.all<{ title: string; first: string | null }>(
      `SELECT r.title, (SELECT l.text FROM recipe_lines l WHERE l.recipe_id = r.id AND l.part = 'ingredients' AND l.is_heading = 0 ORDER BY l.sort_order LIMIT 1) AS first FROM recipes r WHERE r.owner_id = ?`, [c.owner]);
    const seen = new Seen(kept.map((r) => recipeKey(r.title, r.first)));
    for (const [at, row] of t.rows.entries()) {
      const title = clean(cellOf(row, 'Title'), 200);
      if (!title) { skip(d, at, 'it has no title'); continue; }
      d.found += 1;
      const ingredients = (row.ingredients ?? '').replace(/\r/g, '');
      const steps = (row.steps ?? '').replace(/\r/g, '');
      if (seen.take(recipeKey(title, ingredients))) { d.already += 1; continue; }
      const servings = numberOf(cellOf(row, 'Servings'));
      const minutes = (text: string) => { const n = wholeOf(text); return n !== null && n >= 0 && n <= 100_000 ? n : null; };
      const tags = [...new Set(cellOf(row, 'Tags').split(/[,;]/).map((s) => s.trim()).filter(Boolean))].sort();
      const made = await c.tx.run(
        `INSERT INTO recipes (title, description, servings, prep_minutes, cook_minutes, source_url, original_text, notes, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [title, clean(row.description, 5000), servings !== null && servings > 0 && servings <= 1000 ? servings : null, minutes(cellOf(row, 'Prep minutes')), minutes(cellOf(row, 'Cook minutes')),
          clean(cellOf(row, 'Source address'), 1000), row.notes?.trim() || null, c.owner, c.at, c.at]);
      await setByPaths(c.tx, c.owner, 'recipe', made.lastId, tags, c.at);
      const parts: ['ingredients' | 'steps', ReturnType<typeof splitLines>][] = [['ingredients', splitLines(ingredients, 'ingredients')], ['steps', splitLines(steps, 'steps')]];
      for (const [part, lines] of parts) {
        for (const [i, line] of lines.entries()) {
          let quantity: number | null = null;
          let unit: string | null = null;
          let ingredient: number | null = null;
          if (part === 'ingredients' && !line.is_heading) {
            const parsed = units.parseLine(line.text);
            quantity = parsed.quantity;
            unit = parsed.unit;
            ingredient = await ingredientFor(c.tx, c.owner, parsed.name);
          }
          await c.tx.run('INSERT INTO recipe_lines (recipe_id, part, is_heading, text, quantity, unit, ingredient_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [made.lastId, part, line.is_heading ? 1 : 0, cut(line.text, 5000), quantity, unit, ingredient, i]);
        }
      }
      for (const [i, one] of listOf(cellOf(row, 'Cooked in')).slice(0, 40).entries()) {
        const m = /^(.*?)\s+x(\d+(?:\.\d+)?)$/.exec(one);
        const count = m ? Number(m[2]) : 1;
        await c.tx.run('INSERT INTO recipe_equipment (recipe_id, item_id, label, quantity, note, sort_order) VALUES (?, NULL, ?, ?, NULL, ?)', [made.lastId, cut(m ? m[1]! : one, 200), count > 0 && count <= 1000 ? count : 1, i]);
      }
      for (const [i, step] of prepFromText(cellOf(row, 'Prep reminders')).entries()) {
        await c.tx.run('INSERT INTO prep_steps (owner_id, recipe_id, words, rule, at_time, hours, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [c.owner, made.lastId, step.words, step.rule, step.at ?? null, step.hours ?? null, i]);
      }
      d.fresh += 1;
    }
    return d;
  },

  async meals(c) {
    const d = blank();
    const t = tableOf(c.files, 'meal-plan.csv');
    if (!t) return d;
    const recipes = new Map<string, number>();
    for (const r of await c.tx.all<{ id: number; title: string }>('SELECT id, title FROM recipes WHERE owner_id = ? ORDER BY id DESC', [c.owner])) recipes.set(labelKey(r.title), r.id);
    const kept = await c.tx.all<{ day: string; meal: string; recipe: string | null; title: string | null }>(
      'SELECT m.day, m.meal, r.title AS recipe, m.title FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((m) => `${m.day}\n${m.meal}\n${labelKey(m.recipe ?? m.title ?? '')}`));
    for (const [at, row] of t.rows.entries()) {
      const day = dayOf(cellOf(row, 'Day'));
      const meal = cellOf(row, 'Meal').toLowerCase();
      const recipe = cellOf(row, 'Recipe');
      const other = clean(cellOf(row, 'Or something else'), 200);
      if (!day) { skip(d, at, 'its day is not a day'); continue; }
      if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(meal)) { skip(d, at, 'it is not breakfast, lunch, dinner or a snack'); continue; }
      if (!recipe && !other) { skip(d, at, 'it says no recipe and no meal'); continue; }
      d.found += 1;
      if (seen.take(`${day}\n${meal}\n${labelKey(recipe || other || '')}`)) { d.already += 1; continue; }
      const id = recipe ? recipes.get(labelKey(recipe)) ?? null : null;
      if (recipe && id === null) d.unlinked += 1;
      const servings = numberOf(cellOf(row, 'Servings'));
      const eatAt = cellOf(row, 'Eat at');
      const made = await c.tx.run('INSERT INTO meal_plan (owner_id, day, meal, recipe_id, title, servings, cooked_on, eat_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, day, meal, id, id === null ? clean(recipe || other, 200) : clean(other, 200), servings !== null && servings > 0 && servings <= 1000 ? servings : null, dayOf(cellOf(row, 'Cooked on')),
          /^([01]\d|2[0-3]):[0-5]\d$/.test(eatAt) ? eatAt : null, c.at]);
      for (const [i, step] of prepFromText(cellOf(row, 'Prep reminders')).entries()) {
        await c.tx.run('INSERT INTO prep_steps (owner_id, meal_plan_id, words, rule, at_time, hours, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [c.owner, made.lastId, step.words, step.rule, step.at ?? null, step.hours ?? null, i]);
      }
      d.fresh += 1;
    }
    return d;
  },

  async grocery(c) {
    const d = blank();
    const t = tableOf(c.files, 'grocery-list.csv');
    if (!t) return d;
    const kept = await c.tx.all<{ label: string; done: number }>('SELECT label, done FROM grocery WHERE owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((g) => `${labelKey(g.label)}\n${g.done}`));
    for (const [at, row] of t.rows.entries()) {
      const label = clean(cellOf(row, 'What'), 200);
      if (!label) { skip(d, at, 'it says nothing'); continue; }
      d.found += 1;
      const done = yesOf(cellOf(row, 'Got it')) ? 1 : 0;
      if (seen.take(`${labelKey(label)}\n${done}`)) { d.already += 1; continue; }
      const quantity = numberOf(cellOf(row, 'Amount'));
      await c.tx.run('INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, from_plan, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, await ingredientFor(c.tx, c.owner, label), label, quantity, units.canonical(clean(cellOf(row, 'Unit'), 20)), clean(row.notes, 500), yesOf(cellOf(row, 'From the week’s meals')) ? 1 : 0, done, c.at]);
      d.fresh += 1;
    }
    return d;
  },

  async pantry(c) {
    const d = blank();
    const t = tableOf(c.files, 'pantry.csv');
    if (!t) return d;
    const kept = await c.tx.all<{ key: string }>('SELECT i.key FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id WHERE p.owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((p) => p.key));
    const here = ['fridge', 'freezer', 'pantry', 'spices', 'other'];
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'What'), 120);
      const key = name ? units.nameKey(name) : '';
      if (!key) { skip(d, at, 'it says nothing'); continue; }
      d.found += 1;
      if (seen.take(key)) { d.already += 1; continue; }
      const quantity = numberOf(cellOf(row, 'Amount'));
      const place = cellOf(row, 'Where').toLowerCase();
      await c.tx.run('INSERT INTO pantry (owner_id, ingredient_id, quantity, unit, location, expires_on, low_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, await ingredientFor(c.tx, c.owner, name!), quantity !== null && quantity >= 0 ? quantity : null, units.canonical(clean(cellOf(row, 'Unit'), 20)), here.includes(place) ? place : null,
          dayOf(cellOf(row, 'Use by')), numberOf(cellOf(row, 'Running low at')), c.at]);
      d.fresh += 1;
    }
    return d;
  },

  async household(c) {
    const d = blank();
    const t = tableOf(c.files, 'household.csv');
    if (!t) return d;
    const seen = new Seen((await c.tx.all<{ name: string }>('SELECT name FROM household_members WHERE owner_id = ?', [c.owner])).map((m) => labelKey(m.name)));
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Name'), 80);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      if (seen.take(labelKey(name))) { d.already += 1; continue; }
      await c.tx.run('INSERT INTO household_members (owner_id, name, created_at) VALUES (?, ?, ?)', [c.owner, name, c.at]);
      d.fresh += 1;
    }
    return d;
  },

  async pets(c) {
    const d = blank();
    const t = tableOf(c.files, 'pets.csv');
    if (!t) return d;
    const seen = new Seen((await c.tx.all<{ name: string }>('SELECT name FROM pets WHERE owner_id = ?', [c.owner])).map((p) => labelKey(p.name)));
    const weights = tableOf(c.files, 'pet-weights.csv')?.rows ?? [];
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Name'), 80);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      if (seen.take(labelKey(name))) { d.already += 1; continue; }
      const made = await c.tx.run(
        'INSERT INTO pets (owner_id, name, species, breed, born_on, microchip, vet_name, vet_phone, food, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, name, clean(cellOf(row, 'Kind of animal'), 40), clean(cellOf(row, 'Breed'), 80), dayOf(cellOf(row, 'Born on')), clean(cellOf(row, 'Microchip number'), 40),
          clean(cellOf(row, 'Vet'), 100), clean(cellOf(row, 'Vet phone'), 40), clean(row.food, 300), clean(row.notes, 2000), c.at, c.at]);
      for (const w of weights) {
        const value = numberOf(cellOf(w, 'Weight'));
        const day = dayOf(cellOf(w, 'Day'));
        const unit = clean(cellOf(w, 'Unit'), 10);
        if (labelKey(cellOf(w, 'Pet')) === labelKey(name) && value !== null && value > 0 && day && unit) {
          await c.tx.run('INSERT INTO pet_weights (pet_id, day, value, unit) VALUES (?, ?, ?, ?)', [made.lastId, day, value, unit]);
        }
      }
      d.fresh += 1;
      const photo = cellOf(row, 'Photo file');
      if (photo) d.pending.push({ file: photo, as: 'pet-photo', id: made.lastId });
    }
    return d;
  },

  async upkeep(c) {
    const d = blank();
    const t = tableOf(c.files, 'upkeep.csv');
    if (!t) return d;
    const things = new Map<string, number>();
    const book = await PlaceBook.load(c.tx, c.owner, c.at);
    for (const i of await c.tx.all<{ id: number; name: string; place_id: number | null }>('SELECT id, name, place_id FROM items WHERE owner_id = ? ORDER BY id DESC', [c.owner])) {
      things.set(`${labelKey(i.name)}\n${labelKey(i.place_id === null ? '' : book.pathOf(i.place_id))}`, i.id);
      things.set(labelKey(i.name), i.id);
    }
    const pets = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM pets WHERE owner_id = ? ORDER BY id DESC', [c.owner])).map((p) => [labelKey(p.name), p.id]));
    const people = new Map((await c.tx.all<{ id: number; username: string }>('SELECT id, username FROM users')).map((u) => [u.username.toLowerCase(), u.id]));
    const members = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM household_members WHERE owner_id = ?', [c.owner])).map((m) => [labelKey(m.name), m.id]));
    const kept = await c.tx.all<{ name: string; pet: string | null }>('SELECT j.name, p.name AS pet FROM upkeep_jobs j LEFT JOIN pets p ON p.id = j.pet_id WHERE j.owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((j) => `${labelKey(j.name)}\n${labelKey(j.pet ?? '')}`));
    const history = tableOf(c.files, 'upkeep-history.csv')?.rows ?? [];
    let membersMade = 0;
    const memberFor = async (name: string): Promise<number> => {
      let id = members.get(labelKey(name));
      if (id === undefined) { id = (await c.tx.run('INSERT INTO household_members (owner_id, name, created_at) VALUES (?, ?, ?)', [c.owner, name, c.at])).lastId; members.set(labelKey(name), id); membersMade += 1; }
      return id;
    };
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Job'), 200);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      const petName = cellOf(row, 'For this pet');
      const key = `${labelKey(name)}\n${labelKey(petName)}`;
      if (seen.take(key)) { d.already += 1; continue; }
      let lost = false;
      const thing = cellOf(row, 'For this thing');
      const itemId = thing ? things.get(`${labelKey(thing)}\n${labelKey(book.normal(cellOf(row, 'Its place')))}`) ?? things.get(labelKey(thing)) ?? null : null;
      if (thing && itemId === null) lost = true;
      const petId = petName ? pets.get(labelKey(petName)) ?? null : null;
      // A care job is about its pet: without the pet it is not brought in as a job of its own.
      if (petName && petId === null) { d.found -= 1; skip(d, at, `its pet ${petName} is not kept here, so its care was left out`); continue; }
      const kind = ['job', 'bill', 'renewal', 'chore'].includes(cellOf(row, 'Kind')) ? cellOf(row, 'Kind') : 'job';
      const everyN = wholeOf(cellOf(row, 'Repeats every'));
      const everyUnit = cellOf(row, 'Repeats every (unit)');
      const reading = numberOf(cellOf(row, 'Or every (miles, hours)'));
      const repeats = everyN !== null && everyN > 0 && ['day', 'week', 'month', 'year'].includes(everyUnit);
      const signin = cellOf(row, 'Assigned to (sign-in)');
      const assignedTo = signin ? people.get(signin.toLowerCase()) ?? null : null;
      if (signin && assignedTo === null) lost = true;
      const member = cellOf(row, 'Assigned to (household)');
      const points = wholeOf(cellOf(row, 'Points'));
      const made = await c.tx.run(
        `INSERT INTO upkeep_jobs (owner_id, name, activity, item_id, every_n, every_unit, every_reading, reading_unit, first_due, assigned_to, steps, note, created_at, updated_at, kind, amount_cents, points, autopay, pet_id, assigned_member)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.owner, name, clean(cellOf(row, 'Activity'), 80), itemId, repeats ? everyN : null, repeats ? everyUnit : null, reading !== null && reading > 0 ? reading : null, clean(cellOf(row, 'Counted in'), 20),
          dayOf(cellOf(row, 'First due')), assignedTo, clean(row.steps, 5000), clean(row.notes, 2000), c.at, c.at, kind, centsOf(cellOf(row, 'Amount')),
          points !== null && points >= 0 ? points : null, yesOf(cellOf(row, 'Pays by itself')) ? 1 : 0, petId, member ? await memberFor(member) : null]);
      const id = made.lastId;
      for (const [i, tool] of listOf(cellOf(row, 'Tools')).entries()) {
        const toolId = things.get(labelKey(tool));
        if (toolId === undefined) { lost = true; continue; }
        await c.tx.run('INSERT OR IGNORE INTO upkeep_tools (job_id, item_id, sort_order) VALUES (?, ?, ?)', [id, toolId, i]);
      }
      for (const [i, line] of (row.supplies ?? '').split('\n').map((s) => s.trim()).filter(Boolean).entries()) {
        const [supply, quantity, unit] = line.split('|').map((s) => s.trim());
        const supplyId = things.get(labelKey(supply ?? ''));
        if (supplyId === undefined) { lost = true; continue; }
        const q = numberOf(quantity ?? '');
        await c.tx.run('INSERT INTO upkeep_supplies (job_id, item_id, quantity, unit, sort_order) VALUES (?, ?, ?, ?, ?)', [id, supplyId, q !== null && q > 0 ? q : null, units.canonical(clean(unit, 20)), i]);
      }
      // When it was done: with the job that is new, never added to one already kept.
      for (const h of history) {
        if (labelKey(cellOf(h, 'Job')) !== labelKey(name) || labelKey(cellOf(h, 'For this pet')) !== labelKey(petName)) continue;
        const day = dayOf(cellOf(h, 'Done on'));
        if (!day) continue;
        const who = clean(cellOf(h, 'Done by'), 80);
        const minutes = wholeOf(cellOf(h, 'Minutes'));
        const hp = wholeOf(cellOf(h, 'Points'));
        await c.tx.run('INSERT INTO upkeep_done (job_id, day, done_member, done_name, reading, minutes, cost_cents, points, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, day, who ? members.get(labelKey(who)) ?? null : null, who, numberOf(cellOf(h, 'Reading')), minutes !== null && minutes >= 0 ? minutes : null, centsOf(cellOf(h, 'Cost')), hp, clean(h.notes, 1000), c.at]);
      }
      if (lost) d.unlinked += 1;
      d.fresh += 1;
    }
    if (membersMade) d.note = `${membersMade} household member${membersMade === 1 ? '' : 's'} added for the chores`;
    return d;
  },

  async routines(c) {
    const d = blank();
    const t = tableOf(c.files, 'routines.csv');
    if (!t) return d;
    const things = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM items WHERE owner_id = ? ORDER BY id DESC', [c.owner])).map((i) => [labelKey(i.name), i.id]));
    const people = new Map((await c.tx.all<{ id: number; username: string }>('SELECT id, username FROM users')).map((u) => [u.username.toLowerCase(), u.id]));
    const members = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM household_members WHERE owner_id = ?', [c.owner])).map((m) => [labelKey(m.name), m.id]));
    const kept = new Set((await c.tx.all<{ name: string }>('SELECT name FROM routines WHERE owner_id = ?', [c.owner])).map((r) => labelKey(r.name)));
    const history = tableOf(c.files, 'routine-history.csv')?.rows ?? [];
    // One row for each step: the steps of a routine are the rows that share its name, in the order they come.
    const groups = new Map<string, { name: string; at: number; rows: Record<string, string>[] }>();
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Routine'), 80);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      const g = groups.get(labelKey(name)) ?? { name, at, rows: [] };
      g.rows.push(row);
      groups.set(labelKey(name), g);
    }
    let membersMade = 0;
    let next = (await c.tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM routines WHERE owner_id = ?', [c.owner]))?.n ?? -1;
    for (const [key, g] of groups) {
      d.found += 1;
      if (kept.has(key)) { d.already += 1; continue; }
      const first = g.rows[0]!;
      let lost = false;
      const signin = cellOf(first, 'For (sign-in)');
      let forUser = signin ? people.get(signin.toLowerCase()) ?? null : null;
      // A routine for someone who isn't here stays the importer's own, rather than becoming everyone's.
      if (signin && forUser === null) { forUser = c.owner; lost = true; }
      const memberName = clean(cellOf(first, 'For (household)'), 60);
      let forMember: number | null = null;
      if (memberName && forUser === null) {
        forMember = members.get(labelKey(memberName)) ?? null;
        if (forMember === null) {
          forMember = (await c.tx.run('INSERT INTO household_members (owner_id, name, created_at) VALUES (?, ?, ?)', [c.owner, memberName, c.at])).lastId;
          members.set(labelKey(memberName), forMember);
          membersMade += 1;
        }
      }
      const cycleSaid = wholeOf(cellOf(first, 'Cycle nights'));
      const cycle = cycleSaid !== null && cycleSaid >= 2 && cycleSaid <= 14 ? cycleSaid : null;
      const pointsSaid = wholeOf(cellOf(first, 'Points'));
      next += 1;
      const made = await c.tx.run('INSERT INTO routines (owner_id, name, for_user, for_member, cycle_length, points, note, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, g.name, forUser, forMember, cycle, forMember !== null && pointsSaid !== null && pointsSaid >= 0 && pointsSaid <= 1000 ? pointsSaid : null, clean(cellOf(first, 'Notes'), 1000), next, c.at, c.at]);
      const timeIds = new Map<string, number>();
      const perTime = new Map<number, number>();
      for (const row of g.rows) {
        const timeName = clean(cellOf(row, 'Time'), 40);
        const words = clean(cellOf(row, 'Step'), 200);
        if (!timeName || !words) { lost = true; continue; }
        let timeId = timeIds.get(labelKey(timeName));
        if (timeId === undefined) {
          if (timeIds.size >= MAX_TIMES) { lost = true; continue; }
          const at = cellOf(row, 'At');
          timeId = (await c.tx.run('INSERT INTO routine_times (routine_id, name, at_time, sort_order) VALUES (?, ?, ?, ?)',
            [made.lastId, timeName, /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? at : null, timeIds.size])).lastId;
          timeIds.set(labelKey(timeName), timeId);
        }
        const count = perTime.get(timeId) ?? 0;
        if (count >= MAX_STEPS) { lost = true; continue; }
        perTime.set(timeId, count + 1);
        let days = daysFromText(cellOf(row, 'Days'));
        if (days.rule === 'cycle' && (!cycle || (days.night ?? 0) > cycle)) { days = { rule: 'daily' }; lost = true; }
        const thing = cellOf(row, 'Thing');
        const itemId = thing ? things.get(labelKey(thing)) ?? null : null;
        if (thing && itemId === null) lost = true;
        const wait = wholeOf(cellOf(row, 'Wait (seconds)'));
        await c.tx.run('INSERT INTO routine_steps (time_id, words, rule, weekdays, night, item_id, wait_seconds, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [timeId, words, days.rule ?? 'daily', days.rule === 'weekdays' ? days.weekdays!.join(',') : null, days.rule === 'cycle' ? days.night! : null, itemId, wait !== null && wait >= 1 && wait <= 3600 ? wait : null, count]);
      }
      // The days each time was finished come with a routine that is new, never added to one already kept.
      for (const h of history) {
        if (labelKey(cellOf(h, 'Routine')) !== key) continue;
        const timeId = timeIds.get(labelKey(cellOf(h, 'Time')));
        const day = dayOf(cellOf(h, 'Day finished'));
        if (timeId === undefined || !day) continue;
        const night = wholeOf(cellOf(h, 'Night of the cycle'));
        const hp = wholeOf(cellOf(h, 'Points'));
        await c.tx.run('INSERT OR IGNORE INTO routine_finished (time_id, day, night, points) VALUES (?, ?, ?, ?)',
          [timeId, day, night !== null && night >= 1 && night <= 14 ? night : null, hp !== null && hp >= 0 && forMember !== null ? hp : null]);
      }
      if (timeIds.size === 0) { skip(d, g.at, `"${g.name}" has no steps`); d.found -= 1; await c.tx.run('DELETE FROM routines WHERE id = ?', [made.lastId]); continue; }
      if (lost) d.unlinked += 1;
      d.fresh += 1;
    }
    if (membersMade) d.note = `${membersMade} household member${membersMade === 1 ? '' : 's'} added for the routines`;
    return d;
  },

  async manual(c) {
    const d = blank();
    const t = tableOf(c.files, 'house-manual.csv');
    if (!t) return d;
    const parts: Record<string, string> = { emergency: 'emergency', contacts: 'contacts', house: 'house', routines: 'routines', 'in an emergency': 'emergency', 'who to call': 'contacts', 'how the house works': 'house', 'day to day': 'routines' };
    const book = await PlaceBook.load(c.tx, c.owner, c.at);
    const seen = new Seen((await c.tx.all<{ section: string; title: string }>('SELECT section, title FROM manual_entries WHERE owner_id = ?', [c.owner])).map((m) => `${m.section}\n${labelKey(m.title)}`));
    let next = (await c.tx.get<{ next: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM manual_entries WHERE owner_id = ?', [c.owner]))?.next ?? 0;
    for (const [at, row] of t.rows.entries()) {
      const section = parts[cellOf(row, 'Part').toLowerCase()];
      const title = clean(cellOf(row, 'Title'), 120);
      if (!title) { skip(d, at, 'it has no title'); continue; }
      if (!section) { skip(d, at, `"${cellOf(row, 'Part')}" is not a part of the manual`); continue; }
      d.found += 1;
      if (seen.take(`${section}\n${labelKey(title)}`)) { d.already += 1; continue; }
      const placeText = cellOf(row, 'Place');
      const placeId = placeText ? book.find(placeText) : null;
      if (placeText && placeId === null) d.unlinked += 1;
      await c.tx.run('INSERT INTO manual_entries (owner_id, section, title, body, phone, place_id, private, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, section, title, clean(row.details, 3000), clean(cellOf(row, 'Phone'), 40), placeId, yesOf(cellOf(row, 'Private')) ? 1 : 0, next, c.at, c.at]);
      next += 1;
      d.fresh += 1;
    }
    return d;
  },

  async licenses(c) {
    const d = blank();
    const t = tableOf(c.files, 'licenses.csv');
    if (!t) return d;
    const seen = new Seen((await c.tx.all<{ name: string; holder: string | null }>('SELECT name, holder FROM licenses WHERE owner_id = ?', [c.owner])).map((l) => `${labelKey(l.name)}\n${labelKey(l.holder ?? '')}`));
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'License'), 120);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      if (seen.take(`${labelKey(name)}\n${labelKey(cellOf(row, 'Whose it is'))}`)) { d.already += 1; continue; }
      await c.tx.run('INSERT INTO licenses (owner_id, name, category, holder, number, issuer, issued_on, expires_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, name, clean(cellOf(row, 'Kind'), 40), clean(cellOf(row, 'Whose it is'), 80), clean(cellOf(row, 'Number'), 80), clean(cellOf(row, 'Issued by'), 120),
          dayOf(cellOf(row, 'Issued on')), dayOf(cellOf(row, 'Runs out on')), clean(row.notes, 2000), c.at, c.at]);
      d.fresh += 1;
    }
    return d;
  },

  async collection(c) {
    const d = blank();
    const t = tableOf(c.files, 'collection.csv');
    if (!t) return d;
    const book = await PlaceBook.load(c.tx, c.owner, c.at);
    const types = ['film', 'show', 'music', 'book', 'game', 'other'];
    const seen = new Seen((await c.tx.all<{ title: string; type: string }>('SELECT title, type FROM media WHERE owner_id = ?', [c.owner])).map((m) => `${labelKey(m.title)}\n${m.type}`));
    const copies = tableOf(c.files, 'copies.csv')?.rows ?? [];
    const log = tableOf(c.files, 'collection-log.csv')?.rows ?? [];
    let serverCopies = 0;
    for (const [at, row] of t.rows.entries()) {
      const title = clean(cellOf(row, 'Title'), 300);
      if (!title) { skip(d, at, 'it has no title'); continue; }
      d.found += 1;
      const type = types.includes(cellOf(row, 'Type').toLowerCase()) ? cellOf(row, 'Type').toLowerCase() : 'other';
      if (seen.take(`${labelKey(title)}\n${type}`)) { d.already += 1; continue; }
      const year = wholeOf(cellOf(row, 'Year'));
      const minutes = wholeOf(cellOf(row, 'Minutes'));
      const genres = [...new Set(cellOf(row, 'Genres').split(/[,;]/).map((g) => cut(g.trim(), 40)).filter(Boolean))].slice(0, 20);
      const made = await c.tx.run(
        `INSERT INTO media (owner_id, type, title, creator, year, summary, genres, minutes, cover, wanted, ids, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
        [c.owner, type, title, clean(cellOf(row, 'By'), 300), year !== null && year >= 0 && year <= 9999 ? year : null, clean(cellOf(row, 'About it'), 5000), genres.join(',') || null,
          minutes !== null && minutes >= 0 && minutes <= 100_000 ? minutes : null, yesOf(cellOf(row, 'On the wish list')) ? 1 : 0, clean(row.notes, 5000), c.at, c.at]);
      const same = (r: Record<string, string>) => labelKey(cellOf(r, 'Title')) === labelKey(title) && (types.includes(cellOf(r, 'Type').toLowerCase()) ? cellOf(r, 'Type').toLowerCase() : 'other') === type;
      let kept = 0;
      for (const copy of copies.filter(same)) {
        if (cellOf(copy, 'Kept in step with this server')) { serverCopies += 1; continue; }
        const format = clean(cellOf(copy, 'Format'), 40);
        if (!format) continue;
        const placeText = cellOf(copy, 'Place');
        const placeId = placeText ? await book.ensure(placeText) : null;
        const pieces = wholeOf(cellOf(copy, 'Discs or tapes'));
        const lentTo = clean(cellOf(copy, 'Lent to'), 100);
        const link = cellOf(copy, 'Link');
        const m = await c.tx.run('INSERT INTO media_copies (media_id, format, place_id, barcode, lent_to, lent_on, note, pieces, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [made.lastId, format, placeId, clean(cellOf(copy, 'Barcode'), 40), lentTo, lentTo ? dayOf(cellOf(copy, 'Lent on')) ?? c.today : null, clean(copy.notes, 1000),
            pieces !== null && pieces >= 1 && pieces <= 999 ? pieces : null, /^https?:\/\//i.test(link) || /^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? cut(link, 1000) : null, c.at]);
        await noteHistory(c.tx, c.owner, { copy_id: m.lastId }, { what: 'added', to_place: placeId ? book.pathOf(placeId) : null, day: c.today, at: c.at });
        kept += 1;
      }
      // Not owned yet (on a list, or wanted, with no copy): out of the collection until a copy is added.
      if (kept === 0 && (yesOf(cellOf(row, 'Not owned yet')) || yesOf(cellOf(row, 'On the wish list')))) await c.tx.run('UPDATE media SET listed_only = 1 WHERE id = ?', [made.lastId]);
      for (const entry of log.filter(same)) {
        const day = dayOf(cellOf(entry, 'Day'));
        if (day) await c.tx.run('INSERT INTO media_log (media_id, day, note, created_at) VALUES (?, ?, ?, ?)', [made.lastId, day, clean(entry.notes, 1000), c.at]);
      }
      d.fresh += 1;
      const cover = cellOf(row, 'Cover file');
      if (cover) d.pending.push({ file: cover, as: 'cover', id: made.lastId });
    }
    const notes = [book.made ? `${book.made} place${book.made === 1 ? '' : 's'} made` : '', serverCopies ? `${serverCopies} cop${serverCopies === 1 ? 'y' : 'ies'} that a media or book server keeps in step were left for that server to bring in again` : ''].filter(Boolean);
    if (notes.length) d.note = notes.join('; ');
    return d;
  },

  async lists(c) {
    const d = blank();
    const t = tableOf(c.files, 'lists.csv');
    if (!t) return d;
    const types: readonly string[] = LIST_TYPES;
    const people = new Map((await c.tx.all<{ id: number; username: string }>('SELECT id, username FROM users')).map((u) => [u.username.toLowerCase(), u.id]));
    // The lists already here: To watch by what it is, the others by name.
    const listIds = new Map<string, number>();
    for (const l of await c.tx.all<{ id: number; name: string; builtin: string | null }>('SELECT id, name, builtin FROM media_lists WHERE owner_id = ? ORDER BY id DESC', [c.owner])) listIds.set(l.builtin ? `#${l.builtin}` : labelKey(l.name), l.id);
    const titles = new Map<string, number>();
    for (const m of await c.tx.all<{ id: number; title: string; type: string }>('SELECT id, title, type FROM media WHERE owner_id = ? ORDER BY id DESC', [c.owner])) titles.set(`${labelKey(m.title)}
${m.type}`, m.id);
    const on = new Set((await c.tx.all<{ list_id: number; media_id: number }>('SELECT i.list_id, i.media_id FROM media_list_items i JOIN media_lists l ON l.id = i.list_id WHERE l.owner_id = ?', [c.owner])).map((i) => `${i.list_id}
${i.media_id}`));
    const last = new Map<number, number>();
    const lastOf = async (listId: number) => {
      if (!last.has(listId)) last.set(listId, (await c.tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM media_list_items WHERE list_id = ?', [listId]))!.n ?? 0);
      return last.get(listId)!;
    };
    for (const [at, row] of t.rows.entries()) {
      const builtIn = yesOf(cellOf(row, 'Built in'));
      const name = builtIn ? BUILT_IN_NAMES[TO_WATCH]! : clean(cellOf(row, 'List'), 80);
      if (!name) { skip(d, at, 'it has no list name'); continue; }
      d.found += 1;
      const key = builtIn ? `#${TO_WATCH}` : labelKey(name);
      let fresh = false;
      let listId = listIds.get(key);
      if (listId === undefined) {
        const order = builtIn ? -1 : (await c.tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM media_lists WHERE owner_id = ?', [c.owner]))!.n ?? 0;
        listId = (await c.tx.run('INSERT INTO media_lists (owner_id, name, builtin, shared, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [c.owner, name, builtIn ? TO_WATCH : null, !builtIn && yesOf(cellOf(row, 'Shared with everyone')) ? 1 : 0, builtIn ? -1 : Math.max(order, 0) + 1, c.at])).lastId;
        listIds.set(key, listId);
        fresh = true;
      }
      const title = clean(cellOf(row, 'Title'), 300);
      if (title) {
        const type = types.includes(cellOf(row, 'Type').toLowerCase()) ? cellOf(row, 'Type').toLowerCase() : 'other';
        let mediaId = titles.get(`${labelKey(title)}
${type}`);
        if (mediaId === undefined) {
          mediaId = (await c.tx.run('INSERT INTO media (owner_id, type, title, wanted, listed_only, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)', [c.owner, type, title, c.at, c.at])).lastId;
          titles.set(`${labelKey(title)}
${type}`, mediaId);
        }
        if (!on.has(`${listId}
${mediaId}`)) {
          const n = (await lastOf(listId)) + 1;
          last.set(listId, n);
          await c.tx.run('INSERT INTO media_list_items (list_id, media_id, sort_order, note, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [listId, mediaId, n, clean(cellOf(row, 'Notes'), 1000), people.get(cellOf(row, 'Added by').toLowerCase()) ?? null, c.at]);
          on.add(`${listId}
${mediaId}`);
          fresh = true;
        }
      }
      if (fresh) d.fresh += 1;
      else d.already += 1;
    }
    return d;
  },

  async events(c) {
    const d = blank();
    const t = tableOf(c.files, 'events.csv');
    if (!t) return d;
    const seen = new Seen((await c.tx.all<{ title: string; day: string }>('SELECT title, day FROM events WHERE owner_id = ?', [c.owner])).map((e) => `${labelKey(e.title)}\n${e.day}`));
    for (const [at, row] of t.rows.entries()) {
      const title = clean(cellOf(row, 'Title'), 200);
      const day = dayOf(cellOf(row, 'Day'));
      if (!title || !day) { skip(d, at, title ? 'its day is not a day' : 'it has no title'); continue; }
      d.found += 1;
      if (seen.take(`${labelKey(title)}\n${day}`)) { d.already += 1; continue; }
      const end = dayOf(cellOf(row, 'Ends on'));
      const time = /^\d{1,2}:\d{2}$/.test(cellOf(row, 'Time')) ? cellOf(row, 'Time') : null;
      await c.tx.run('INSERT INTO events (owner_id, title, day, end_day, time, note, yearly, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, title, day, end && end >= day ? end : null, time, clean(row.notes, 2000), yesOf(cellOf(row, 'Every year')) ? 1 : 0, c.at, c.at]);
      d.fresh += 1;
    }
    return d;
  },

  async money(c) {
    const d = blank();
    const cats = tableOf(c.files, 'money-categories.csv');
    const entries = tableOf(c.files, 'money-entries.csv');
    if (!cats && !entries) return d;
    const mine = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM money_categories WHERE owner_id = ? ORDER BY id DESC', [c.owner])).map((m) => [labelKey(m.name), m.id]));
    let next = (await c.tx.get<{ next: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM money_categories WHERE owner_id = ?', [c.owner]))?.next ?? 0;
    let madeCategories = 0;
    for (const row of cats?.rows ?? []) {
      const name = clean(cellOf(row, 'Category'), 80);
      if (!name || mine.has(labelKey(name))) continue;
      const id = (await c.tx.run('INSERT INTO money_categories (owner_id, name, monthly_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [c.owner, name, centsOf(cellOf(row, 'Each month')) ?? 0, next, c.at])).lastId;
      next += 1;
      madeCategories += 1;
      mine.set(labelKey(name), id);
    }
    const kept = await c.tx.all<{ label: string; cents: number; day: string; category: string | null }>(
      'SELECT e.label, e.cents, e.day, k.name AS category FROM money_entries e LEFT JOIN money_categories k ON k.id = e.category_id WHERE e.owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((e) => `${e.day}\n${e.cents}\n${labelKey(e.label)}\n${labelKey(e.category ?? '')}`));
    for (const [at, row] of (entries?.rows ?? []).entries()) {
      const label = clean(cellOf(row, 'What'), 200);
      const cents = centsOf(cellOf(row, 'Amount'));
      const day = dayOf(cellOf(row, 'Day'));
      if (!label || cents === null || !day) { skip(d, at, !label ? 'it says nothing' : cents === null ? 'its amount is not an amount of money' : 'its day is not a day'); continue; }
      d.found += 1;
      const category = cellOf(row, 'Category');
      if (seen.take(`${day}\n${cents}\n${labelKey(label)}\n${labelKey(category)}`)) { d.already += 1; continue; }
      // Only a category of your own is linked; one that was shared with the person who made the download is not yours.
      const id = category && !cellOf(row, 'Category shared with you by') ? mine.get(labelKey(category)) ?? null : null;
      if (category && id === null) d.unlinked += 1;
      await c.tx.run('INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [c.owner, id, label, cents, day, clean(row.notes, 1000), c.at]);
      d.fresh += 1;
    }
    if (madeCategories) d.note = `${madeCategories} categor${madeCategories === 1 ? 'y' : 'ies'} made`;
    return d;
  },

  async stores(c) {
    const d = blank();
    const t = tableOf(c.files, 'stores.csv');
    if (!t) return d;
    const have = new Set((await c.tx.all<{ name: string }>('SELECT name FROM stores WHERE owner_id = ?', [c.owner])).map((s) => labelKey(s.name)));
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Store'), 100);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      if (have.has(labelKey(name))) { d.already += 1; continue; }
      const days = numberOf(cellOf(row, 'Price adjustment days'));
      await c.tx.run('INSERT OR IGNORE INTO stores (owner_id, name, note, adjust_days, created_at) VALUES (?, ?, ?, ?, ?)', [c.owner, name, clean(row.notes, 300), days !== null && Number.isInteger(days) && days > 0 && days <= 365 ? days : null, c.at]);
      have.add(labelKey(name));
      d.fresh += 1;
    }
    return d;
  },

  async barcodes(c) {
    const d = blank();
    const t = tableOf(c.files, 'barcodes.csv');
    if (!t) return d;
    const have = new Set((await c.tx.all<{ barcode: string }>('SELECT barcode FROM ingredient_barcodes WHERE owner_id = ?', [c.owner])).map((b) => b.barcode));
    for (const [at, row] of t.rows.entries()) {
      const code = barcodeOf(cellOf(row, 'Barcode'));
      const what = clean(cellOf(row, 'What it is'), 120);
      if (!code) { skip(d, at, 'it is not a barcode'); continue; }
      if (!what) { skip(d, at, 'it does not say what it is'); continue; }
      d.found += 1;
      if (have.has(code)) { d.already += 1; continue; }
      const ingredient = await ingredientFor(c.tx, c.owner, what);
      if (ingredient === null) { d.found -= 1; skip(d, at, 'it does not say what it is'); continue; }
      const size = numberOf(cellOf(row, 'Size amount'));
      const sized = size !== null && size > 0;
      await c.tx.run('INSERT INTO ingredient_barcodes (owner_id, barcode, ingredient_id, label, size_quantity, size_unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [c.owner, code, ingredient, clean(cellOf(row, 'Product name'), 200), sized ? size : null, sized ? units.canonical(clean(cellOf(row, 'Size unit'), 20)) : null, c.at]);
      have.add(code);
      d.fresh += 1;
    }
    return d;
  },

  async prices(c) {
    const d = blank();
    const t = tableOf(c.files, 'prices.csv');
    if (!t) return d;
    const kept = await c.tx.all<{ label: string; cents: number; store: string | null; day: string }>('SELECT label, cents, store, day FROM prices WHERE owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((p) => `${p.day}\n${p.cents}\n${labelKey(p.label)}\n${labelKey(p.store ?? '')}`));
    let storesMade = 0;
    for (const [at, row] of t.rows.entries()) {
      const label = clean(cellOf(row, 'What'), 200);
      const cents = centsOf(cellOf(row, 'Price'));
      const day = dayOf(cellOf(row, 'Day'));
      if (!label || cents === null || !day) { skip(d, at, !label ? 'it says nothing' : cents === null ? 'its price is not an amount of money' : 'its day is not a day'); continue; }
      d.found += 1;
      const store = clean(cellOf(row, 'Shop'), 100);
      if (seen.take(`${day}\n${cents}\n${labelKey(label)}\n${labelKey(store ?? '')}`)) { d.already += 1; continue; }
      if (store) storesMade += (await c.tx.run('INSERT OR IGNORE INTO stores (owner_id, name, created_at) VALUES (?, ?, ?)', [c.owner, store, c.at])).changes;
      const quantity = numberOf(cellOf(row, 'Amount'));
      const saved = centsOf(cellOf(row, 'Saved'));
      await c.tx.run('INSERT INTO prices (owner_id, ingredient_id, grocery_id, label, cents, saved_cents, quantity, unit, store, day, assumed, barcode, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, await ingredientFor(c.tx, c.owner, label), label, cents, saved !== null && saved > 0 ? saved : 0, quantity !== null && quantity > 0 ? quantity : null, units.canonical(clean(cellOf(row, 'Unit'), 20)), store, day,
          yesOf(cellOf(row, 'A guess, not a receipt')) ? 1 : 0, barcodeOf(cellOf(row, 'Barcode')), c.at]);
      d.fresh += 1;
    }
    if (storesMade) d.note = `${storesMade} store${storesMade === 1 ? '' : 's'} added to your list from the prices`;
    return d;
  },

  async coupons(c) {
    const d = blank();
    const t = tableOf(c.files, 'coupons.csv');
    if (!t) return d;
    const kept = await c.tx.all<{ label: string; store: string | null; code: string | null }>('SELECT label, store, code FROM coupons WHERE owner_id = ?', [c.owner]);
    const seen = new Seen(kept.map((k) => `${labelKey(k.label)}\n${labelKey(k.store ?? '')}\n${labelKey(k.code ?? '')}`));
    let storesMade = 0;
    for (const [at, row] of t.rows.entries()) {
      const label = clean(cellOf(row, 'Coupon'), 200);
      if (!label) { skip(d, at, 'it has no name'); continue; }
      const off = centsOf(cellOf(row, 'Dollars off'));
      const percent = numberOf(cellOf(row, 'Percent off'));
      const money = off !== null && off > 0 ? off : null;
      // A coupon is money off or a percentage off, never both.
      const part = money === null && percent !== null && percent > 0 && percent <= 100 ? percent : null;
      if (money === null && part === null) { skip(d, at, 'it takes nothing off'); continue; }
      d.found += 1;
      const store = clean(cellOf(row, 'Shop'), 100);
      const code = clean(cellOf(row, 'Code'), 100);
      if (seen.take(`${labelKey(label)}\n${labelKey(store ?? '')}\n${labelKey(code ?? '')}`)) { d.already += 1; continue; }
      if (store) storesMade += (await c.tx.run('INSERT OR IGNORE INTO stores (owner_id, name, created_at) VALUES (?, ?, ?)', [c.owner, store, c.at])).changes;
      const what = clean(cellOf(row, 'What it is for'), 120);
      const fromBook = yesOf(cellOf(row, 'From the shop’s savings book'));
      await c.tx.run('INSERT INTO coupons (owner_id, label, ingredient_id, cents_off, percent_off, store, code, expires_on, used_on, note, created_at, book, item, starts_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, label, what ? await ingredientFor(c.tx, c.owner, what) : null, money, part, store, code, dayOf(cellOf(row, 'Runs out on')), dayOf(cellOf(row, 'Used on')), clean(row.notes, 500), c.at,
          fromBook ? 1 : 0, fromBook ? label : null, fromBook ? dayOf(cellOf(row, 'Starts on')) : null]);
      d.fresh += 1;
    }
    if (storesMade) d.note = `${storesMade} store${storesMade === 1 ? '' : 's'} added to your list from the coupons`;
    return d;
  },

  async projects(c) {
    const d = blank();
    const t = tableOf(c.files, 'projects.csv');
    if (!t) return d;
    const things = new Map<string, number>();
    for (const i of await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM items WHERE owner_id = ? ORDER BY id DESC', [c.owner])) things.set(labelKey(i.name), i.id);
    const seen = new Seen((await c.tx.all<{ name: string }>('SELECT name FROM projects WHERE owner_id = ?', [c.owner])).map((p) => labelKey(p.name)));
    const lines = tableOf(c.files, 'project-lines.csv')?.rows ?? [];
    const time = tableOf(c.files, 'project-time.csv')?.rows ?? [];
    const costs = tableOf(c.files, 'project-costs.csv')?.rows ?? [];
    // A project's lines, time and costs are told apart by its name: of two with one name, only the first is given them.
    const filled = new Set<string>();
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Project'), 200);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      const key = labelKey(name);
      if (seen.take(key)) { d.already += 1; continue; }
      const status = cellOf(row, 'Status').toLowerCase();
      const made = await c.tx.run('INSERT INTO projects (owner_id, name, activity, status, notes, due_on, started_on, finished_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, name, clean(cellOf(row, 'Activity'), 80), ['idea', 'planned', 'active', 'paused', 'done', 'dropped'].includes(status) ? status : 'idea', clean(row.notes, 5000),
          dayOf(cellOf(row, 'Due on')), dayOf(cellOf(row, 'Started on')), dayOf(cellOf(row, 'Finished on')), c.at, c.at]);
      d.fresh += 1;
      if (filled.has(key)) continue;
      filled.add(key);
      const mine = (r: Record<string, string>) => labelKey(cellOf(r, 'Project')) === key;
      let order = 0;
      for (const l of lines.filter(mine)) {
        const label = clean(cellOf(l, 'What it uses'), 200);
        if (!label) continue;
        const quantity = numberOf(cellOf(l, 'Amount'));
        const sized = quantity !== null && quantity > 0;
        await c.tx.run('INSERT INTO project_items (project_id, item_id, label, quantity, unit, used_on, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [made.lastId, things.get(labelKey(label)) ?? null, label, sized ? quantity : null, sized ? units.canonical(clean(cellOf(l, 'Unit'), 20)) : null, dayOf(cellOf(l, 'Used on')), clean(l.notes, 1000), order]);
        order += 1;
      }
      for (const s of time.filter(mine)) {
        const day = dayOf(cellOf(s, 'Day'));
        if (!day) continue;
        const minutes = wholeOf(cellOf(s, 'Minutes'));
        await c.tx.run('INSERT INTO project_sessions (project_id, day, minutes, note, created_at) VALUES (?, ?, ?, ?, ?)', [made.lastId, day, minutes !== null && minutes >= 0 ? minutes : null, clean(s.notes, 1000), c.at]);
      }
      order = 0;
      for (const m of costs.filter(mine)) {
        const label = clean(cellOf(m, 'What'), 200);
        if (!label) continue;
        const spent = centsOf(cellOf(m, 'Spent'));
        const paidOn = dayOf(cellOf(m, 'Paid on'));
        const cost = await c.tx.run('INSERT INTO project_costs (project_id, label, planned_cents, actual_cents, paid_on, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [made.lastId, label, centsOf(cellOf(m, 'Planned')), spent, paidOn, clean(m.notes, 1000), order]);
        // A paid cost is a spending entry too, tagged with the project, as when it was paid here.
        if (paidOn && spent !== null) {
          await c.tx.run('INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at, project_id, project_cost_id) VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?)',
            [c.owner, label, spent, paidOn, c.at, made.lastId, cost.lastId]);
        }
        order += 1;
      }
    }
    return d;
  },

  async plans(c) {
    const d = blank();
    const t = tableOf(c.files, 'plans.csv');
    if (!t) return d;
    // What a plan's thing to do points at, found again by its name.
    const byName = async (sql: string) => { const m = new Map<string, number>(); for (const r of await c.tx.all<{ id: number; name: string }>(sql, [c.owner])) m.set(labelKey(r.name), r.id); return m; };
    const pointed: Record<string, Map<string, number>> = {
      recipe: await byName('SELECT id, title AS name FROM recipes WHERE owner_id = ? ORDER BY id DESC'),
      thing: await byName('SELECT id, name FROM items WHERE owner_id = ? ORDER BY id DESC'),
      media: await byName('SELECT id, title AS name FROM media WHERE owner_id = ? ORDER BY id DESC'),
      project: await byName('SELECT id, name FROM projects WHERE owner_id = ? ORDER BY id DESC'),
    };
    const seen = new Seen((await c.tx.all<{ name: string; start_day: string }>('SELECT name, start_day FROM plans WHERE owner_id = ?', [c.owner])).map((p) => `${labelKey(p.name)}\n${p.start_day}`));
    const items = tableOf(c.files, 'plan-items.csv')?.rows ?? [];
    const photos = tableOf(c.files, 'plan-photos.csv')?.rows ?? [];
    const filled = new Set<string>();
    let library = 0;
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Plan'), 200);
      const start = dayOf(cellOf(row, 'Starts'));
      if (!name || !start) { skip(d, at, name ? 'its first day is not a day' : 'it has no name'); continue; }
      d.found += 1;
      const key = labelKey(name);
      if (seen.take(`${key}\n${start}`)) { d.already += 1; continue; }
      const end = dayOf(cellOf(row, 'Ends'));
      const made = await c.tx.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, story, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [c.owner, name, start, end && end >= start ? end : start, clean(row.notes, 5000),clean(cellOf(row, 'The story'), 20000), c.at, c.at]);
      d.fresh += 1;
      if (filled.has(key)) continue;
      filled.add(key);
      const mine = (r: Record<string, string>) => labelKey(cellOf(r, 'Plan')) === key;
      let lost = false;
      let order = 1;
      for (const i of items.filter(mine)) {
        const kind = cellOf(i, 'Kind').toLowerCase();
        const label = clean(cellOf(i, 'What'), 200);
        if (!label || !['task', 'recipe', 'thing', 'media', 'project'].includes(kind)) continue;
        const ref = kind === 'task' ? null : pointed[kind]!.get(labelKey(label)) ?? null;
        if (kind !== 'task' && ref === null) lost = true;
        const quantity = numberOf(cellOf(i, 'Amount'));
        await c.tx.run('INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order, meal_plan_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
          [made.lastId, kind, ref, label, quantity !== null && quantity > 0 ? quantity : null, clean(i.notes, 1000), yesOf(cellOf(i, 'Done')) ? 1 : 0, order]);
        order += 1;
      }
      for (const p of photos.filter(mine)) {
        const file = cellOf(p, 'File');
        if (file) d.pending.push({ file, as: 'plan-photo', id: made.lastId, name: cellOf(p, 'Caption'), spot: cellOf(p, 'Decoration spot') });
        else library += 1;
      }
      if (lost) d.unlinked += 1;
    }
    if (library) d.note = `${library} photo${library === 1 ? ' that is' : 's that are'} in your photo library, not in the download, ${library === 1 ? 'was' : 'were'} left out`;
    return d;
  },

  async holidays(c) {
    const d = blank();
    const t = tableOf(c.files, 'holidays.csv');
    if (!t) return d;
    const years = tableOf(c.files, 'holiday-years.csv')?.rows ?? [];
    const lists = tableOf(c.files, 'holiday-lists.csv')?.rows ?? [];
    const seen = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM holidays WHERE owner_id = ? ORDER BY id', [c.owner])).map((h) => [labelKey(h.name), h.id]));
    const planAt = async (name: string, day: string) => (await c.tx.get<{ id: number }>('SELECT id FROM plans WHERE owner_id = ? AND start_day = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1', [c.owner, day, name]))?.id ?? null;
    const tagFor = async (name: string) => {
      const key = labelKey(name);
      const have = await c.tx.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND key = ? ORDER BY parent_id IS NOT NULL, id LIMIT 1', [c.owner, key]);
      return have?.id ?? (await c.tx.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)', [c.owner, name.replace(/>/g, ' ').slice(0, 60), key, c.at])).lastId;
    };
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Holiday'), 100);
      const rule = cellOf(row, 'How it finds its day').toLowerCase();
      if (!name || !['fixed', 'weekday', 'manual'].includes(rule)) { skip(d, at, name ? 'it does not say how it finds its day' : 'it has no name'); continue; }
      const month = wholeOf(cellOf(row, 'Month'));
      const dayOfMonth = wholeOf(cellOf(row, 'Day of the month'));
      const weekday = wholeOf(cellOf(row, 'Weekday (0 is Sunday)'));
      const nth = wholeOf(cellOf(row, 'Which one (1 to 4, or -1 for the last)'));
      const lead = wholeOf(cellOf(row, 'Start planning (weeks ahead)'));
      const fine = rule === 'manual' || (month !== null && month >= 1 && month <= 12 && (rule === 'fixed' ? dayOfMonth !== null && dayOfMonth >= 1 && dayOfMonth <= 31 : weekday !== null && weekday >= 0 && weekday <= 6 && nth !== null && [1, 2, 3, 4, -1].includes(nth)));
      if (!fine) { skip(d, at, 'its date rule is not complete'); continue; }
      d.found += 1;
      const key = labelKey(name);
      let id = seen.get(key);
      if (id === undefined) {
        id = (await c.tx.run(`INSERT INTO holidays (owner_id, name, rule, month, day_of_month, weekday, nth, lead_weeks, event_id, first_year, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          [c.owner, name, rule, rule === 'manual' ? null : month, rule === 'fixed' ? dayOfMonth : null, rule === 'weekday' ? weekday : null, rule === 'weekday' ? nth : null,
            lead !== null && lead >= 1 && lead <= 26 ? lead : 6, wholeOf(cellOf(row, 'First year of the date')), await tagFor(name), c.at, c.at])).lastId;
        seen.set(key, id);
        d.fresh += 1;
      } else d.already += 1;
      for (const y of years.filter((r) => labelKey(cellOf(r, 'Holiday')) === key)) {
        const start = dayOf(cellOf(y, 'Starts'));
        const plan = start ? await planAt(cellOf(y, 'Plan'), start) : null;
        if (!start || plan === null) { if (start || cellOf(y, 'Plan')) d.unlinked += 1; continue; }
        if (await c.tx.get('SELECT 1 AS x FROM holiday_years WHERE plan_id = ?', [plan])) continue;
        const year = Number(start.slice(0, 4));
        if (await c.tx.get('SELECT 1 AS x FROM holiday_years WHERE holiday_id = ? AND year = ?', [id, year])) continue;
        const time = cellOf(y, 'Dinner at');
        const pounds = numberOf(cellOf(y, 'Turkey (pounds)'));
        await c.tx.run('INSERT INTO holiday_years (plan_id, holiday_id, year, dinner_time, turkey_pounds, put_up_on, take_down_on, taken_down_on, budget_cents, notes_next, notes_done) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [plan, id, year, /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null, pounds !== null && pounds > 0 ? pounds : null, dayOf(cellOf(y, 'Put up on')), dayOf(cellOf(y, 'Take down on')),
            dayOf(cellOf(y, 'Taken down on')), centsOf(cellOf(y, 'Budget')), clean(cellOf(y, 'Notes for next year'), 5000), yesOf(cellOf(y, 'Notes for next year asked for')) ? 1 : 0]);
        // What a year keeps comes with a year that is new, never added to one already kept.
        let order = 1;
        for (const l of lists.filter((r) => cellOf(r, 'Plan').toLowerCase() === cellOf(y, 'Plan').toLowerCase() && cellOf(r, 'Starts') === start)) {
          const list = cellOf(l, 'List').toLowerCase();
          const label = clean(cellOf(l, 'Name'), 300);
          const also = cellOf(l, 'Also');
          if (!label) continue;
          if (list === 'guest' || list === 'card') {
            const member = also ? await c.tx.get<{ id: number }>('SELECT id FROM household_members WHERE owner_id = ? AND name = ? COLLATE NOCASE LIMIT 1', [c.owner, also]) : undefined;
            await c.tx.run('INSERT INTO holiday_people (plan_id, role, name, user_id, member_id, done, note, sort_order) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
              [plan, list, label.slice(0, 100), member?.id ?? null, yesOf(cellOf(l, 'Done')) ? 1 : 0, clean(cellOf(l, 'Note'), 500), order]);
          } else if (list === 'gift') {
            const status = cellOf(l, 'Status').toLowerCase();
            const member = also ? await c.tx.get<{ id: number }>('SELECT id FROM household_members WHERE owner_id = ? AND name = ? COLLATE NOCASE LIMIT 1', [c.owner, also]) : undefined;
            const kept = ['idea', 'bought', 'wrapped', 'given'].includes(status) ? status : 'idea';
            const cents = kept === 'idea' ? null : centsOf(cellOf(l, 'Amount'));
            // The spending entry a bought gift made comes in with the spending; it is found again here so editing the gift does not make a second.
            const entry = cents === null ? undefined : await c.tx.get<{ id: number }>(
              `SELECT e.id FROM money_entries e WHERE e.owner_id = ? AND e.cents = ? AND e.label IN (?, ?) AND NOT EXISTS (SELECT 1 FROM holiday_gifts g WHERE g.entry_id = e.id) ORDER BY e.id LIMIT 1`,
              [c.owner, cents, `${name} gift: ${label}`.slice(0, 200), `${name} gift`]);
            // A gift for someone with a sign-in stays words only: the person is not looked up, so nothing links to another account.
            await c.tx.run('INSERT INTO holiday_gifts (plan_id, who, for_user, for_member, idea, status, cents, entry_id, note, sort_order) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)',
              [plan, (clean(cellOf(l, 'Where, or who it is for'), 100) ?? 'Someone'), member?.id ?? null, label, kept, cents, entry?.id ?? null, clean(cellOf(l, 'Note'), 500), order]);
          } else if (list === 'decoration') {
            const spot = clean(cellOf(l, 'Where, or who it is for'), 100);
            if (!spot) continue;
            const status = cellOf(l, 'Status').toLowerCase();
            const thing = also ? await c.tx.get<{ id: number }>('SELECT id FROM items WHERE owner_id = ? AND name = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1', [c.owner, also]) : undefined;
            const fix = /found (broke|out)/.exec(status)?.[1] ?? null;
            const need = /need (broke|out)/.exec(status)?.[1] ?? null;
            await c.tx.run('INSERT INTO holiday_decor (plan_id, spot, label, thing_id, box_id, put_up, taken_down, boxed, fix, need, need_done, note, sort_order) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
              [plan, spot, label.slice(0, 200), thing?.id ?? null, status.includes('put up') ? 1 : 0, status.includes('taken down') ? 1 : 0, status.includes('boxed') ? 1 : 0, fix, need, status.includes('bought') ? 1 : 0, clean(cellOf(l, 'Note'), 500), order]);
          } else if (list === 'countdown step') {
            const rule = cellOf(l, 'Status');
            if (!['night_before', 'morning_of', 'hours_before'].includes(rule)) continue;
            const at = cellOf(l, 'Also');
            const hours = wholeOf(cellOf(l, 'Amount'));
            await c.tx.run('INSERT INTO holiday_steps (plan_id, words, rule, at_time, hours, done, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [plan, label, rule, /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? at : null, hours !== null && hours >= 1 && hours <= 72 ? hours : null, yesOf(cellOf(l, 'Done')) ? 1 : 0, order]);
          } else continue;
          order += 1;
        }
      }
    }
    return d;
  },

  async trips(c) {
    const d = blank();
    const t = tableOf(c.files, 'outdoor-trips.csv');
    if (!t) return d;
    const years = tableOf(c.files, 'outdoor-trip-years.csv')?.rows ?? [];
    const lists = tableOf(c.files, 'outdoor-trip-lists.csv')?.rows ?? [];
    const seen = new Map((await c.tx.all<{ id: number; name: string }>('SELECT id, name FROM outdoor_trips WHERE owner_id = ? ORDER BY id', [c.owner])).map((h) => [labelKey(h.name), h.id]));
    const planAt = async (name: string, day: string) => (await c.tx.get<{ id: number }>('SELECT id FROM plans WHERE owner_id = ? AND start_day = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1', [c.owner, day, name]))?.id ?? null;
    const tagFor = async (name: string) => {
      const key = labelKey(name);
      const have = await c.tx.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND key = ? ORDER BY parent_id IS NOT NULL, id LIMIT 1', [c.owner, key]);
      return have?.id ?? (await c.tx.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)', [c.owner, name.replace(/>/g, ' ').slice(0, 60), key, c.at])).lastId;
    };
    const partOf = (text: string) => (['camping', 'fishing', 'hunting'].includes(text.toLowerCase()) ? text.toLowerCase() : null);
    const thingNamed = (name: string) => (name ? c.tx.get<{ id: number }>('SELECT id FROM items WHERE owner_id = ? AND name = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1', [c.owner, name]) : Promise.resolve(undefined));
    for (const [at, row] of t.rows.entries()) {
      const name = clean(cellOf(row, 'Trip'), 100);
      if (!name) { skip(d, at, 'it has no name'); continue; }
      d.found += 1;
      const key = labelKey(name);
      let id = seen.get(key);
      if (id === undefined) {
        id = (await c.tx.run('INSERT INTO outdoor_trips (owner_id, name, camping, fishing, hunting, private, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [c.owner, name, yesOf(cellOf(row, 'Camping')) ? 1 : 0, yesOf(cellOf(row, 'Fishing')) ? 1 : 0, yesOf(cellOf(row, 'Hunting')) ? 1 : 0, yesOf(cellOf(row, 'Private')) ? 1 : 0, await tagFor(name), c.at, c.at])).lastId;
        seen.set(key, id);
        d.fresh += 1;
      } else d.already += 1;
      for (const y of years.filter((r) => labelKey(cellOf(r, 'Trip')) === key)) {
        const start = dayOf(cellOf(y, 'Starts'));
        const plan = start ? await planAt(cellOf(y, 'Plan'), start) : null;
        if (!start || plan === null) { if (start || cellOf(y, 'Plan')) d.unlinked += 1; continue; }
        if (await c.tx.get('SELECT 1 AS x FROM outdoor_trip_years WHERE plan_id = ?', [plan])) continue;
        const year = Number(start.slice(0, 4));
        if (await c.tx.get('SELECT 1 AS x FROM outdoor_trip_years WHERE trip_id = ? AND year = ?', [id, year])) continue;
        await c.tx.run('INSERT INTO outdoor_trip_years (plan_id, trip_id, year, water, campground, site, confirmation, check_in, check_out, event_id, budget_cents, notes_next, notes_done) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
          [plan, id, year, clean(cellOf(y, 'Water'), 200), clean(cellOf(y, 'Campground'), 200), clean(cellOf(y, 'Site'), 100), clean(cellOf(y, 'Confirmation'), 100), dayOf(cellOf(y, 'Check in')), dayOf(cellOf(y, 'Check out')),
            centsOf(cellOf(y, 'Budget')), clean(cellOf(y, 'Notes for next year'), 5000), yesOf(cellOf(y, 'Notes for next year asked for')) ? 1 : 0]);
        // What a year keeps comes with a year that is new, never added to one already kept.
        let order = 1;
        for (const l of lists.filter((r) => cellOf(r, 'Plan').toLowerCase() === cellOf(y, 'Plan').toLowerCase() && cellOf(r, 'Starts') === start)) {
          const list = cellOf(l, 'List').toLowerCase();
          const label = clean(cellOf(l, 'Name'), 300);
          const part = partOf(cellOf(l, 'Part'));
          const day = dayOf(cellOf(l, 'Day'));
          const status = cellOf(l, 'Status').toLowerCase();
          const also = cellOf(l, 'Also');
          const note = clean(cellOf(l, 'Note'), 500);
          if (!label || !part) continue;
          if (list === 'gear') {
            const thing = await thingNamed(also);
            const after = /after (dry|clean|repair|replace)/.exec(status)?.[1] ?? null;
            const amount = numberOf(cellOf(l, 'Amount'));
            await c.tx.run('INSERT INTO outdoor_gear (plan_id, part, thing_id, label, quantity, caliber, packed, returned, after_trip, after_done, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [plan, part, thing?.id ?? null, label.slice(0, 200), amount !== null && amount > 0 ? amount : null, part === 'hunting' ? clean(cellOf(l, 'Tag number or caliber'), 40) : null, status.includes('packed') ? 1 : 0, status.includes('returned') ? 1 : 0,
                after, after && status.includes('after done') ? 1 : 0, note, order]);
          } else if (list === 'season' && part !== 'camping') {
            if (!day) continue;
            const remind = wholeOf(cellOf(l, 'Amount'));
            await c.tx.run('INSERT INTO outdoor_seasons (plan_id, part, label, opens_on, closes_on, remind_days, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [plan, part, label.slice(0, 100), day, dayOf(cellOf(l, 'Place or water')), remind !== null && remind >= 0 && remind <= 120 ? remind : 7, note]);
          } else if (list === 'catch') {
            if (!day) continue;
            const length = numberOf(cellOf(l, 'Length (inches)'));
            const weight = numberOf(cellOf(l, 'Weight (pounds)'));
            const lure = await thingNamed(also);
            await c.tx.run('INSERT INTO outdoor_catch (plan_id, fish, day, water, length_inches, weight_lb, kept, lure_thing_id, lure, frozen, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [plan, label.slice(0, 100), day, clean(cellOf(l, 'Place or water'), 200), length !== null && length >= 0 ? length : null, weight !== null && weight >= 0 ? weight : null, status.includes('kept') ? 1 : 0,
                lure?.id ?? null, clean(also, 100), status.includes('frozen') ? 1 : 0, note]);
          } else if (list === 'harvest') {
            if (!day) continue;
            const weight = numberOf(cellOf(l, 'Weight (pounds)'));
            await c.tx.run('INSERT INTO outdoor_harvest (plan_id, animal, day, place, tag_number, weight_lb, frozen, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [plan, label.slice(0, 100), day, clean(cellOf(l, 'Place or water'), 200), clean(cellOf(l, 'Tag number or caliber'), 60), weight !== null && weight >= 0 ? weight : null, status.includes('frozen') ? 1 : 0, note]);
          } else continue;
          order += 1;
        }
      }
    }
    return d;
  },

  async budget(c) {
    const d = blank();
    const income = tableOf(c.files, 'money-income.csv');
    const goals = tableOf(c.files, 'money-goals.csv');
    if (!income && !goals) return d;
    const every = ['weekly', 'biweekly', 'twice_monthly', 'monthly', 'yearly', 'once'];
    const incomeSeen = new Seen((await c.tx.all<{ name: string; cents: number; every: string; start_day: string | null }>('SELECT name, cents, every, start_day FROM money_income WHERE owner_id = ?', [c.owner]))
      .map((i) => `${labelKey(i.name)}\n${i.cents}\n${i.every}\n${i.start_day ?? ''}`));
    for (const [at, row] of (income?.rows ?? []).entries()) {
      const name = clean(cellOf(row, 'What'), 120);
      const cents = centsOf(cellOf(row, 'Amount'));
      const how = cellOf(row, 'How often').toLowerCase().replace(/\s+/g, '_');
      if (!name || cents === null || !every.includes(how)) { skip(d, at, !name ? 'it says nothing' : cents === null ? 'its amount is not an amount of money' : 'it does not say how often'); continue; }
      d.found += 1;
      const start = dayOf(cellOf(row, 'First day'));
      if (incomeSeen.take(`${labelKey(name)}\n${cents}\n${how}\n${start ?? ''}`)) { d.already += 1; continue; }
      const end = dayOf(cellOf(row, 'Last day'));
      await c.tx.run('INSERT INTO money_income (owner_id, name, cents, every, start_day, end_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [c.owner, name, cents, how, start, start && end && end < start ? null : end, c.at]);
      d.fresh += 1;
    }
    const goalSeen = new Seen((await c.tx.all<{ name: string }>('SELECT name FROM money_goals WHERE owner_id = ?', [c.owner])).map((g) => labelKey(g.name)));
    const saved = tableOf(c.files, 'money-goal-saved.csv')?.rows ?? [];
    const filled = new Set<string>();
    for (const [at, row] of (goals?.rows ?? []).entries()) {
      const name = clean(cellOf(row, 'Goal'), 120);
      const target = centsOf(cellOf(row, 'Target'));
      if (!name || target === null || target <= 0) { skip(d, at, !name ? 'it has no name' : 'its target is not an amount of money'); continue; }
      d.found += 1;
      const key = labelKey(name);
      if (goalSeen.take(key)) { d.already += 1; continue; }
      const forProject = cellOf(row, 'For project');
      const project = forProject ? await c.tx.get<{ id: number }>('SELECT id FROM projects WHERE owner_id = ? AND name = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1', [c.owner, forProject]) : undefined;
      const made = await c.tx.run('INSERT INTO money_goals (owner_id, name, target_cents, by_day, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [c.owner, name, target, dayOf(cellOf(row, 'Reach it by')), project?.id ?? null, c.at]);
      d.fresh += 1;
      // Each put-toward is told apart by the goal's name: of two goals with one name, only the first is given them.
      if (filled.has(key)) continue;
      filled.add(key);
      for (const s of saved.filter((r) => labelKey(cellOf(r, 'Goal')) === key)) {
        const day = dayOf(cellOf(s, 'Day'));
        const cents = signedCentsOf(cellOf(s, 'Amount (below zero is taken out)'));
        if (!day || cents === null || cents === 0) continue;
        await c.tx.run('INSERT INTO money_goal_saved (goal_id, day, cents, created_at) VALUES (?, ?, ?, ?)', [made.lastId, day, cents, c.at]);
      }
    }
    return d;
  },

  async tags(c) {
    const d = blank();
    const t = tableOf(c.files, 'tags.csv');
    if (!t) return d;
    const targets = new Map<TagKind, Map<string, number[]>>();
    const used = new Map<string, number>();
    const countTags = async () => (await c.tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE owner_id = ?', [c.owner]))?.n ?? 0;
    for (const [at, row] of t.rows.entries()) {
      const path = cellOf(row, 'Tag');
      if (!path) { skip(d, at, 'it has no tag'); continue; }
      const before = await countTags();
      const tag = await ensurePath(c.tx, c.owner, path, c.at);
      if (tag === null) { skip(d, at, 'it has no tag'); continue; }
      d.found += 1;
      let fresh = (await countTags()) > before;
      const label = cellOf(row, 'Used on');
      const title = cellOf(row, 'Name');
      if (label || title) {
        const kind = tagKindOfLabel(label);
        let id: number | undefined;
        if (kind && title) {
          if (!targets.has(kind)) targets.set(kind, await targetsByTitle(c.tx, c.owner, kind));
          // Of several with one name, the nth row for a tag goes to the nth of them, so twins are not all tagged.
          const same = `${tag}\n${kind}\n${labelKey(title)}`;
          const nth = used.get(same) ?? 0;
          used.set(same, nth + 1);
          id = targets.get(kind)!.get(labelKey(title))?.[nth];
        }
        if (id === undefined) d.unlinked += 1;
        else if ((await c.tx.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) VALUES (?, ?, ?)', [tag, kind!, id])).changes > 0) fresh = true;
      }
      if (fresh) d.fresh += 1;
      else d.already += 1;
    }
    return d;
  },
};
const ORDER = ['places', 'things', 'recipes', 'meals', 'grocery', 'pantry', 'household', 'pets', 'upkeep', 'routines', 'manual', 'licenses', 'collection', 'lists', 'events', 'money', 'stores', 'barcodes', 'prices', 'coupons', 'projects', 'plans', 'holidays', 'trips', 'budget', 'tags'];

function rowsIn(files: Files, info: KindInfo): number {
  return tableOf(files, info.file)?.rows.length ?? 0;
}

function asReport(info: KindInfo, d: Done | null, found: number, pictures: number): KindReport {
  return { key: info.key, label: info.label, importable: info.importable, found: d ? d.found : found, fresh: d?.fresh ?? 0, already: d?.already ?? 0, unlinked: d?.unlinked ?? 0, skipped: d?.skipped ?? [], pictures, note: d?.note };
}

function checkedFiles(files: Files): void {
  if (!files || typeof files !== 'object') throw new Problem(400, 'Choose the zip file you downloaded');
  const names = Object.keys(files).map((n) => n.toLowerCase());
  const known = KINDS.map((k) => k.file);
  if (!names.some((n) => known.includes(n) || known.includes(n.replace(/^[^/]*\//, '')) || n.endsWith('readme.txt'))) {
    throw new Problem(400, "That doesn't look like a download made by Life Is. Choose the zip you got from “Export everything”.");
  }
}

/**
 * What a download holds, kind by kind: how many records, how many of them are new, how many are already kept.
 * Nothing is kept: the whole import is tried inside one transaction that is then undone.
 */
export async function lookAtDownload(db: Db, owner: number, files: Files, clock: Clock = () => new Date()): Promise<{ kinds: KindReport[]; made_on: string | null }> {
  checkedFiles(files);
  const ctx = (tx: Queries): Ctx => ({ tx, owner, today: todayOf(clock), at: stamp(clock()), files });
  const results = new Map<string, Done>();
  const tx = await db.begin();
  try {
    for (const key of ORDER) {
      try { results.set(key, await importers[key]!(ctx(tx))); } catch { /* a kind that fails now is reported when it is really tried */ }
    }
  } finally {
    await tx.rollback();
  }
  const readme = Object.keys(files).find((n) => n.toLowerCase().endsWith('readme.txt'));
  const made = readme ? /Made on (\d{4}-\d{2}-\d{2})/.exec(files[readme] ?? '')?.[1] ?? null : null;
  return {
    made_on: made,
    kinds: KINDS.map((info) => {
      const d = results.get(info.key) ?? null;
      const pictures = d ? d.pending.length : 0;
      return asReport(info, info.importable ? d : null, rowsIn(files, info), pictures);
    }),
  };
}

/**
 * Brings the chosen kinds in. Each is its own transaction: one that fails is undone and reported, and the
 * others stand. Returns what each did, and the pictures and papers that belong to what was added (the page
 * sends those next, a few at a time, to `bringInPictures`).
 */
export async function bringInDownload(db: Db, owner: number, files: Files, chosen: string[], clock: Clock = () => new Date()): Promise<Brought> {
  checkedFiles(files);
  if (!Array.isArray(chosen) || chosen.some((k) => typeof k !== 'string')) throw new Problem(400, 'Choose what to import');
  const kinds: KindReport[] = [];
  const pending: Pending[] = [];
  for (const key of ORDER.filter((k) => chosen.includes(k))) {
    const info = KINDS.find((k) => k.key === key)!;
    try {
      const d = await atomic(db, (tx) => importers[key]!({ tx, owner, today: todayOf(clock), at: stamp(clock()), files }));
      pending.push(...d.pending);
      kinds.push({ ...asReport(info, d, rowsIn(files, info), d.pending.length), ok: true });
    } catch (problem) {
      const why = problem instanceof Problem ? problem.message : 'Something went wrong while reading it';
      kinds.push({ ...asReport(info, null, rowsIn(files, info), 0), ok: false, problem: `${why}. Nothing from ${info.label.toLowerCase()} was kept.` });
    }
  }
  return { kinds, pending };
}

export type PictureIn = { as: Pending['as']; id: number; kind?: string; name?: string; spot?: string; bytes: Uint8Array };
const PAPER_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/**
 * Keeps pictures and papers on records that came in (see `Pending`). Only ever one that has none yet, and only
 * the person's own: a thing that has a photo keeps it, and nothing is replaced.
 */
export async function bringInPictures(db: Db, owner: number, pictures: PictureIn[], clock: Clock = () => new Date()): Promise<{ kept: number; left: number }> {
  let kept = 0;
  let left = 0;
  const at = stamp(clock());
  await atomic(db, async (tx) => {
    for (const p of pictures) {
      const type = p.bytes.length > 4 && p.bytes[0] === 0x25 && p.bytes[1] === 0x50 && p.bytes[2] === 0x44 && p.bytes[3] === 0x46 ? 'application/pdf' : pictureType(p.bytes);
      if (!type || p.bytes.length > 12_000_000 || !Number.isInteger(p.id)) { left += 1; continue; }
      if (p.as === 'thing-photo') {
        const ok = await tx.get('SELECT i.id FROM items i WHERE i.id = ? AND i.owner_id = ? AND NOT EXISTS (SELECT 1 FROM item_photos x WHERE x.item_id = i.id)', [p.id, owner]);
        if (!ok || type === 'application/pdf' || p.bytes.length > 8_000_000) { left += 1; continue; }
        await tx.run('INSERT INTO item_photos (item_id, type, bytes) VALUES (?, ?, ?)', [p.id, type, p.bytes]);
      } else if (p.as === 'thing-paper') {
        const kind = ['receipt', 'manual', 'warranty', 'other'].includes(p.kind ?? '') ? p.kind! : 'other';
        const name = clean(p.name, 120) ?? (kind === 'other' ? 'Paper' : kind[0]!.toUpperCase() + kind.slice(1));
        const ok = await tx.get('SELECT i.id FROM items i WHERE i.id = ? AND i.owner_id = ? AND (SELECT COUNT(*) FROM item_documents d WHERE d.item_id = i.id) < 20 AND NOT EXISTS (SELECT 1 FROM item_documents d WHERE d.item_id = i.id AND d.name = ? AND d.kind = ?)', [p.id, owner, name, kind]);
        if (!ok || !PAPER_TYPES.includes(type)) { left += 1; continue; }
        await tx.run('INSERT INTO item_documents (item_id, kind, name, type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [p.id, kind, name, type, p.bytes, at]);
      } else if (p.as === 'pet-photo') {
        const ok = await tx.get('SELECT id FROM pets WHERE id = ? AND owner_id = ? AND photo IS NULL', [p.id, owner]);
        if (!ok || type === 'application/pdf' || p.bytes.length > 8_000_000) { left += 1; continue; }
        await tx.run('UPDATE pets SET photo_type = ?, photo = ? WHERE id = ?', [type, p.bytes, p.id]);
      } else if (p.as === 'plan-photo') {
        const ok = await tx.get<{ last: number | null }>(
          'SELECT (SELECT MAX(x.sort_order) FROM plan_photos x WHERE x.plan_id = l.id) AS last FROM plans l WHERE l.id = ? AND l.owner_id = ? AND (SELECT COUNT(*) FROM plan_photos x WHERE x.plan_id = l.id) < 80 AND NOT EXISTS (SELECT 1 FROM plan_photos x WHERE x.plan_id = l.id AND x.bytes = ?)',
          [p.id, owner, p.bytes]);
        if (!ok || type === 'application/pdf' || p.bytes.length > 3_000_000) { left += 1; continue; }
        await tx.run('INSERT INTO plan_photos (plan_id, source, type, bytes, caption, sort_order, created_at, spot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [p.id, 'kept', type, p.bytes, clean(p.name, 300), (ok.last ?? 0) + 1, at, clean(p.spot, 100)]);
      } else if (p.as === 'cover') {
        const ok = await tx.get('SELECT m.id FROM media m WHERE m.id = ? AND m.owner_id = ? AND NOT EXISTS (SELECT 1 FROM media_covers x WHERE x.media_id = m.id)', [p.id, owner]);
        if (!ok || type === 'application/pdf' || p.bytes.length > 8_000_000) { left += 1; continue; }
        await tx.run('INSERT INTO media_covers (media_id, type, bytes) VALUES (?, ?, ?)', [p.id, type, p.bytes]);
      } else { left += 1; continue; }
      kept += 1;
    }
  });
  return { kept, left };
}

/** A download's files, read from the zip: the spreadsheets and text as text, and the pictures and papers as bytes. For the tests and for anywhere that holds the whole zip. */
export async function splitDownload(zip: Uint8Array): Promise<{ files: Files; pictures: Map<string, Uint8Array> }> {
  const files: Files = {};
  const pictures = new Map<string, Uint8Array>();
  for (const f of await readZip(zip)) {
    if (/\.(csv|txt|json)$/i.test(f.path)) files[f.path] = new TextDecoder().decode(f.bytes).replace(/^﻿/, '');
    else pictures.set(f.path, f.bytes);
  }
  return { files, pictures };
}

