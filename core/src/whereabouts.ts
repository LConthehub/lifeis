/**
 * What a scan was, wherever it was made: a place's sticker, a thing's sticker (or a blank one, waiting to be
 * put on something new), or a barcode already kept on one of your things or copies. Anything else is
 * unknown, and whether it looks like a book's ISBN is said, so it can be looked up the right way.
 *
 * Only ever the person's own: a sticker or barcode of someone else's reads as unknown.
 */
import type { Db } from './db.ts';
import { inventory, plainBarcode, stickerCode, thingStickerCode, type Item } from './inventory.ts';
import { isbnOf } from './lookups.ts';
import { barcodeKey } from './media.ts';
import { Problem } from './problem.ts';
import { dayNumber, labelKey, todayOf, type Clock } from './small.ts';

export type FoundCopy = { copy_id: number; media_id: number; title: string; type: string; format: string; place_id: number | null; place: string | null };
export type ScanWhat =
  | { kind: 'place'; place: { id: number; name: string; path: string } }
  | { kind: 'thing'; item: Item }
  | { kind: 'copies'; copies: FoundCopy[] }
  | { kind: 'new-sticker'; code: string }
  | { kind: 'unknown'; barcode: string; isbn: boolean };

export async function whatIsThis(db: Db, owner: number, read: string, clock: Clock = () => new Date()): Promise<ScanWhat> {
  const text = read.trim();
  if (!text) throw new Problem(400, 'Scan a code or type a name first.');
  const things = inventory(db, owner, clock);

  // A thing's sticker: the thing it's on, or a blank one not on anything yet.
  const thingCode = thingStickerCode(text);
  if (thingCode) {
    const row = await db.get<{ id: number; owner_id: number }>('SELECT id, owner_id FROM items WHERE code = ?', [thingCode]);
    if (!row) return { kind: 'new-sticker', code: thingCode };
    if (row.owner_id !== owner) return { kind: 'unknown', barcode: thingCode, isbn: false };
    return { kind: 'thing', item: await things.getItem(row.id) };
  }

  // A place's sticker, or its code typed in.
  const code = stickerCode(text);
  if (code) {
    const place = await db.get<{ id: number }>('SELECT id FROM places WHERE owner_id = ? AND code = ?', [owner, code]);
    if (place) return { kind: 'place', place: await things.placeForSticker(code) };
    const item = await db.get<{ id: number }>('SELECT id FROM items WHERE owner_id = ? AND code = ?', [owner, code]);
    if (item) return { kind: 'thing', item: await things.getItem(item.id) };
    if (/\/p\//.test(text)) throw new Problem(404, "That isn't the sticker of one of your places");
  }

  // A barcode: on one of your things, or on copies in your collection.
  const barcode = plainBarcode(text);
  if (!barcode) return { kind: 'unknown', barcode: text.slice(0, 40), isbn: false };
  const thing = await db.get<{ id: number }>('SELECT id FROM items WHERE owner_id = ? AND barcode = ? ORDER BY id LIMIT 1', [owner, barcode]);
  if (thing) return { kind: 'thing', item: await things.getItem(thing.id) };
  const wanted = barcodeKey(barcode);
  const copies = (await db.all<FoundCopy & { barcode: string }>(
    `SELECT c.id AS copy_id, c.media_id, m.title, m.type, c.format, c.place_id, NULL AS place, c.barcode
     FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ? AND c.barcode IS NOT NULL ORDER BY c.id`, [owner]))
    .filter((row) => barcodeKey(row.barcode) === wanted);
  if (copies.length) {
    const paths = new Map((await things.listPlaces()).map((p) => [p.id, p.path]));
    return { kind: 'copies', copies: copies.map(({ barcode: _b, ...c }) => ({ ...c, place: c.place_id !== null ? (paths.get(c.place_id) ?? null) : null })) };
  }
  return { kind: 'unknown', barcode, isbn: isbnOf(barcode) !== null };
}

// ---------- saying where things are, by voice ----------

type Named = { id: number; names: string[]; shown: string };
type Found<T> = { is: 'one'; one: T } | { is: 'many'; many: T[] } | { is: 'none'; near: T[] };

const STOP = /^(?:the|my|our|a|an|that|this|your)\s+/i;
const plainKey = (said: string) => labelKey(said).replace(/[.!?,]+$/g, '').replace(STOP, '').trim();
const stem = (word: string) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
const wordsOf = (key: string) => key.split(/[\s,›]+/).filter((w) => w.length > 1).map(stem);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What was said, matched to what is kept: one exact or complete match, several that fit, or none (with the closest). */
function closest<T extends Named>(said: string, all: T[]): Found<T> {
  const key = plainKey(said);
  if (!key) return { is: 'none', near: [] };
  const exact = all.filter((c) => c.names.some((n) => plainKey(n) === key));
  if (exact.length === 1) return { is: 'one', one: exact[0]! };
  if (exact.length > 1) return { is: 'many', many: exact.slice(0, 4) };
  const wanted = wordsOf(key);
  const fits = (c: T) => { const own = c.names.map((n) => wordsOf(labelKey(n))); return own.some((w) => wanted.every((x) => w.some((y) => y.includes(x) || x.includes(y)))); };
  const whole = all.filter(fits);
  if (whole.length === 1) return { is: 'one', one: whole[0]! };
  if (whole.length > 1) return { is: 'many', many: whole.slice(0, 4) };
  const score = (c: T) => Math.max(...c.names.map((n) => { const own = wordsOf(labelKey(n)); return wanted.filter((x) => own.some((y) => y.includes(x) || x.includes(y))).length; }));
  const near = all.map((c) => ({ c, n: score(c) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.c);
  return { is: 'none', near };
}

/** "the egg cooker": with "the" and a small first letter, unless it is somebody's ("Charlie's drill") or already has one. */
function spoken(name: string): string {
  if (/['’]s\b/.test(name) || STOP.test(name)) return name;
  const rest = name.slice(1);
  return `the ${rest === rest.toLowerCase() ? name.charAt(0).toLowerCase() + rest : name}`;
}
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const either = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`);

/** A day that has gone by, as people say it after "since": "yesterday", "Tuesday", "March 5". */
export function sinceDay(day: string, today: string): string {
  const ago = dayNumber(today) - dayNumber(day);
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 7) return DAYS[(dayNumber(day) + 4) % 7]!;
  const base = `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
  return ago > 300 ? `${base}, ${day.slice(0, 4)}` : base;
}

/** Where a thing is, and moving it, said and heard in plain sentences. Only the person's own things and places; never a gun or ammunition. */
export function whereabouts(db: Db, owner: number, clock: Clock = () => new Date()) {
  async function things(): Promise<(Named & { place_id: number | null })[]> {
    const rows = await db.all<{ id: number; name: string; place_id: number | null }>(
      'SELECT i.id, i.name, i.place_id FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? AND i.gone_on IS NULL AND k.guard IS NULL ORDER BY i.name COLLATE NOCASE, i.id', [owner]);
    return rows.map((r) => ({ id: r.id, names: [r.name], shown: r.name, place_id: r.place_id }));
  }
  async function places(): Promise<(Named & { leaf: string })[]> {
    return (await inventory(db, owner, clock).listPlaces()).map((p) => ({ id: p.id, names: [p.name, p.path], shown: p.path, leaf: p.name }));
  }
  const leafOf = async (id: number | null) => (id === null ? null : (await places()).find((p) => p.id === id)?.leaf ?? null);
  /** Two things with one name are told apart by where each is. */
  async function told(list: (Named & { place_id?: number | null })[]): Promise<string[]> {
    const there = new Map((await places()).map((p) => [p.id, p.leaf]));
    return list.map((c) => {
      const same = list.filter((o) => o.shown === c.shown).length > 1;
      const at = same && c.place_id != null ? there.get(c.place_id) : null;
      return spoken(c.shown) + (at ? ` in ${spoken(at)}` : '');
    });
  }
  async function since(itemId: number): Promise<string | null> {
    const row = await db.get<{ day: string }>("SELECT day FROM item_history WHERE item_id = ? AND what IN ('moved', 'added') ORDER BY day DESC, id DESC LIMIT 1", [itemId]);
    return row ? sinceDay(row.day, todayOf(clock)) : null;
  }
  const notKnown = (kind: string, said: string, near: string[], tail: string) =>
    near.length ? `I don't know ${kind} called "${said}". Did you mean ${either(near)}?${tail}` : `I don't know ${kind} called "${said}".${tail}`;

  return {
    /** "I put the egg cooker in the hall closet": moves it, or asks which one when it is not clear. Nothing changes until it is. */
    async put(thingSaid: string, placeSaid: string): Promise<string> {
      const found = closest(thingSaid, await things());
      if (found.is === 'none') return notKnown('a thing', thingSaid, found.near.map((c) => spoken(c.shown)), ' Nothing was moved.');
      if (found.is === 'many') return `Which one do you mean: ${either(await told(found.many))}? Nothing was moved.`;
      const where = closest(placeSaid, await places());
      if (where.is === 'none') return notKnown('a place', placeSaid, where.near.map((c) => spoken(c.leaf)), ' Nothing was moved.');
      if (where.is === 'many') return `Which place do you mean: ${either(where.many.map((c) => spoken(c.shown)))}? Nothing was moved.`;
      const thing = found.one;
      const subject = upperFirst(spoken(thing.shown));
      if (thing.place_id === where.one.id) return `${subject} is already in ${spoken(where.one.leaf)}.`;
      await inventory(db, owner, clock).moveItem(thing.id, where.one.id);
      return `${subject} is in ${spoken(where.one.leaf)} now.`;
    },

    /** "Where's the egg cooker?": the place and since when, or plainly that it is not known. */
    async where(thingSaid: string): Promise<string> {
      const found = closest(thingSaid, await things());
      if (found.is === 'none') return notKnown('a thing', thingSaid, found.near.map((c) => spoken(c.shown)), '');
      const lines: string[] = [];
      for (const t of found.is === 'one' ? [found.one] : found.many.slice(0, 3)) {
        const place = await leafOf(t.place_id);
        const subject = upperFirst(spoken(t.shown));
        if (!place) { lines.push(`${subject} has no place yet.`); continue; }
        const when = await since(t.id);
        lines.push(`${subject} is in ${spoken(place)}${when ? `, since ${when}` : ''}.`);
      }
      return lines.join(' ');
    },
  };
}
