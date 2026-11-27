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
import type { Clock } from './small.ts';

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
