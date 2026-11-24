/**
 * Things brought in from HomeBox (the open source home inventory), from the CSV its own "export" gives.
 *
 * Read on this Life Is, sent nowhere. The file is read, looked over (how many things, which kinds, which places and
 * tags are new, which asset numbers had to change), and nothing is saved until the person says so.
 *
 * HomeBox's columns (checked against its source, backend/internal/core/services/reporting/io_row.go):
 *   HB.location (a place inside a place is written "Garage / Shelf 2"), HB.labels (also called HB.tags; several
 *   are joined by ";"), HB.asset_id ("000-001"), HB.name, HB.quantity, HB.description, HB.insured, HB.notes,
 *   HB.purchase_price, HB.purchase_from, HB.purchase_time (or HB.purchase_date), HB.manufacturer,
 *   HB.model_number, HB.serial_number, HB.lifetime_warranty, HB.warranty_expires, HB.warranty_details,
 *   HB.sold_to, HB.sold_price, HB.sold_time (or HB.sold_date), HB.sold_notes, HB.archived, HB.import_ref,
 *   HB.parent_import_ref, HB.url, and one HB.field.<Name> column for each custom field.
 * Small variants are accepted: any column order, missing columns, upper or lower case, no "HB." in front, Windows
 * line endings, quoted cells with commas and line breaks, and a cell a spreadsheet made safe with a leading '.
 *
 * Reading the same file twice adds nothing: a thing is "already here" when something has its HB.import_ref, else
 * when something with the same name has its asset number, else when something has the same name in the same place.
 */
import { csvRows } from './bookList.ts';
import { atomic, type Db, type Queries } from './db.ts';
import { noteHistory } from './history.ts';
import { assetLabel, assetNumber, type FieldInput } from './inventory.ts';
import { Problem } from './problem.ts';
import { clean, dayNumber, labelKey, stamp, todayOf, type Clock } from './small.ts';
import { setByNames } from './tags.ts';
import { STARTERS, type StarterKind } from './starters.ts';
import * as units from './units.ts';

const MAX_ROWS = 5000;
const MAX_CHARS = 5_000_000;
const MAX_DEPTH = 10;
const MAX_OWN_FIELDS = 30;

export type HomeboxThing = {
  name: string;
  quantity: number | null;
  note: string | null;
  insured: boolean;
  price_cents: number | null;
  bought_at: string | null;
  bought_on: string | null;
  model: string | null;
  serial: string | null;
  warranty_until: string | null;
  place: string[];
  labels: string[];
  asset: number | null;
  import_ref: string | null;
  own_fields: { name: string; value: string }[];
  gone: { on: string | null; to: string | null; cents: number | null } | null;
};
export type HomeboxSheet = { things: HomeboxThing[]; skipped: number };

// ---------- reading the file ----------

/** A header as it is compared: lower case, without the "HB." in front. */
const head = (cell: string) => cell.trim().replace(/^hb\./i, '').toLowerCase();

/** What a spreadsheet leaves in front of a cell that starts with = + - or @, taken off again. */
const restored = (cell: string | undefined) => (cell ?? '').replace(/^'(?=[=+\-@\t\r])/, '').trim();

const yes = (cell: string) => /^(true|yes|y|t|1)$/i.test(cell.trim());

/** A day out of what HomeBox writes (2024-03-05, or with a time), or 3/5/2024. HomeBox's empty date (year 1) is no day. */
function dayFrom(cell: string): string | null {
  const text = cell.trim();
  let day: string | null = null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
  if (iso) day = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (us) day = `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  }
  if (!day || Number(day.slice(0, 4)) < 1900) return null;
  try { dayNumber(day); } catch { return null; }
  return day;
}

/** Whole cents out of "12.50", "$1,200" or 12.5. Nothing, zero or a minus is no amount. */
function centsFrom(cell: string): number | null {
  const n = Number(cell.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 100) : null;
}

/** A number of things. Left blank, or not a number: none known. */
function amountFrom(cell: string): number | null {
  if (!cell.trim()) return null;
  const n = Number(cell.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
}

/** An asset number as HomeBox writes it (000-001), or plain digits. 0 means it has none. */
function assetFrom(cell: string): number | null {
  const text = cell.trim();
  if (!text) return null;
  const n = assetNumber(text) ?? (/^\d{1,9}$/.test(text) ? Number(text) : null);
  return n !== null && n >= 1 ? n : null;
}

const split = (cell: string, mark: string) => cell.split(mark).map((s) => s.trim()).filter(Boolean);

/** The place a location names, one name for each level ("Garage / Shelf 2"), no more than Life Is allows. */
function placeNames(cell: string): string[] {
  const names = split(cell, '/').map((n) => clean(n, 80)!).filter(Boolean);
  return names.length > MAX_DEPTH ? [...names.slice(0, MAX_DEPTH - 1), names.slice(MAX_DEPTH - 1).join(' - ')] : names;
}

/** HomeBox's CSV as things. Says plainly what is wrong when the file is not one. */
export function readHomebox(text: string): HomeboxSheet {
  if (typeof text !== 'string' || !text.trim()) throw new Problem(400, 'Choose the CSV file HomeBox exported');
  if (text.length > MAX_CHARS) throw new Problem(400, 'That file is larger than 5 MB. Export fewer things from HomeBox and try again.');
  const table = csvRows(text);
  const headers = (table[0] ?? []).map(head);
  const column = (...names: string[]) => { for (const n of names) { const at = headers.indexOf(n); if (at >= 0) return at; } return -1; };
  if (column('name') < 0) {
    throw new Problem(400, "That doesn't look like a HomeBox export. Life Is looks for the columns HomeBox writes, such as HB.name, HB.location and HB.labels. In HomeBox, use Tools, then Export Inventory, and choose that CSV.");
  }
  const own = (table[0] ?? []).map((h, at) => ({ at, h: h.trim() })).filter(({ h }) => /^(hb\.)?field\./i.test(h))
    .map(({ at, h }) => ({ at, name: clean(h.replace(/^(hb\.)?field\./i, ''), 60) })).filter((f): f is { at: number; name: string } => f.name !== null);
  const body = table.slice(1);
  if (body.length > MAX_ROWS) throw new Problem(400, `That file has more than ${MAX_ROWS} things. Export fewer from HomeBox and try again.`);
  const at = {
    location: column('location'), labels: column('labels', 'tags'), asset: column('asset_id'), quantity: column('quantity'), description: column('description'),
    insured: column('insured'), notes: column('notes'), price: column('purchase_price'), from: column('purchase_from'), bought: column('purchase_time', 'purchase_date'),
    maker: column('manufacturer'), model: column('model_number'), serial: column('serial_number'), lifetime: column('lifetime_warranty'),
    expires: column('warranty_expires'), details: column('warranty_details'), soldTo: column('sold_to'), soldPrice: column('sold_price'),
    soldOn: column('sold_time', 'sold_date'), soldNotes: column('sold_notes'), archived: column('archived'), ref: column('import_ref'), url: column('url'),
  };
  const things: HomeboxThing[] = [];
  let skipped = 0;
  for (const row of body) {
    const cell = (i: number) => (i < 0 ? '' : restored(row[i]));
    const name = clean(cell(column('name')), 200);
    if (!name) { skipped += 1; continue; }
    const extra: { name: string; value: string }[] = [];
    const add = (fieldName: string, value: string | null) => { if (value) extra.push({ name: fieldName, value: value.slice(0, 2000) }); };
    for (const f of own) add(f.name, restored(row[f.at]));
    const warranty = [yes(cell(at.lifetime)) ? 'Lifetime warranty' : '', cell(at.details)].filter(Boolean).join('. ');
    add('Warranty', warranty);
    add('Link', cell(at.url));
    if (yes(cell(at.archived))) add('Archived in HomeBox', 'yes');
    const soldTo = clean(cell(at.soldTo), 200);
    const soldOn = dayFrom(cell(at.soldOn));
    const soldCents = centsFrom(cell(at.soldPrice));
    const sold = soldTo !== null || soldOn !== null || soldCents !== null;
    if (sold) add('Sold notes', cell(at.soldNotes));
    const notes = [cell(at.description), cell(at.notes)].filter(Boolean).join('\n\n');
    const own_fields: { name: string; value: string }[] = [];
    for (const f of extra) if (!own_fields.some((o) => labelKey(o.name) === labelKey(f.name))) own_fields.push(f);
    things.push({
      name, quantity: amountFrom(cell(at.quantity)), note: clean(notes, 5000), insured: yes(cell(at.insured)), price_cents: centsFrom(cell(at.price)),
      bought_at: clean(cell(at.from), 120), bought_on: dayFrom(cell(at.bought)),
      model: clean([cell(at.maker), cell(at.model)].filter(Boolean).join(' '), 120), serial: clean(cell(at.serial), 120), warranty_until: dayFrom(cell(at.expires)),
      place: placeNames(cell(at.location)), labels: [...new Map(split(cell(at.labels), ';').map((l) => [labelKey(l), clean(l, 60)!] as const).filter(([, l]) => l)).values()],
      asset: assetFrom(cell(at.asset)), import_ref: clean(cell(at.ref), 200), own_fields: own_fields.slice(0, MAX_OWN_FIELDS),
      gone: sold ? { on: soldOn, to: soldTo, cents: soldCents } : null,
    });
  }
  if (things.length === 0) throw new Problem(400, 'There are no things in that file');
  return { things, skipped };
}

// ---------- which kind ----------

/** Words in a label and the ready-made kind they point to. The first label with a match decides. */
const KIND_WORDS: [RegExp, string][] = [
  [/\b(tools?|power tools?|hand tools?|drills?)\b/, 'Tools'],
  [/\b(electronics?|computers?|laptops?|phones?|tablets?|devices?|gadgets?|monitors?|consoles?)\b/, 'Devices'],
  [/\b(cables?|adapters?|chargers?|batter(y|ies))\b/, 'Cables and adapters'],
  [/\b(kitchen|cookware|appliances?|utensils?)\b/, 'Kitchen tools'],
  [/\b(clothes|clothing|apparel|jackets?|coats?)\b/, 'Clothes'],
  [/\b(shoes?|boots?|sneakers?)\b/, 'Shoes'],
  [/\b(bedding|linens?|towels?|blankets?)\b/, 'Bedding and linens'],
  [/\b(books?|journals?)\b/, 'Books and journals'],
  [/\b(bikes?|bicycles?)\b/, 'Bikes'],
  [/\b(camping|tents?)\b/, 'Camping gear'],
  [/\b(sports?)\b/, 'Sports gear'],
  [/\b(instruments?|guitars?|pianos?|keyboards?)\b/, 'Instruments'],
  [/\b(vehicles?|cars?|trucks?)\b/, 'Vehicles'],
  [/\b(paint)\b/, 'Paint'],
  [/\b(spares?)\b/, 'Spares'],
];
const OTHER: StarterKind = { name: 'Other', icon: '📦', fields: [] };
const READY = new Map<string, StarterKind>(STARTERS.flatMap((s) => s.kinds.map((k) => [k.name, k] as const)));

function kindOf(labels: string[]): StarterKind {
  for (const label of labels) {
    for (const [words, kind] of KIND_WORDS) if (words.test(labelKey(label))) return READY.get(kind) ?? OTHER;
  }
  return OTHER;
}

// ---------- looking it over ----------

export type HomeboxReview = {
  /** Things in the file with a name. */
  found: number;
  /** Rows with no name, passed over. */
  skipped: number;
  /** Already in Life Is (from an earlier reading of the same file, or the same thing by name and place). */
  already: number;
  /** What would be added. */
  fresh: number;
  kinds: { name: string; icon: string | null; things: number; is_new: boolean }[];
  places: { total: number; fresh: number };
  tags: { total: number; fresh: number };
  /** Asset numbers that could not be kept because another thing has them (or one in the file does), and the number given instead. */
  asset_changes: { name: string; wanted: string; given: string }[];
  asset_changed: number;
  gone: number;
  with_own_fields: number;
};
export type HomeboxResult = { found: number; added: number; already: number; skipped: number; kinds_made: number; places_made: number; tags_made: number; asset_changed: number };

type Planned = { thing: HomeboxThing; kind: StarterKind; asset: number | null };

/** The lists of what is kept, read once, so looking over and bringing in decide the same way. */
async function plan(q: Queries, owner: number, sheet: HomeboxSheet): Promise<{
  review: HomeboxReview; fresh: Planned[];
}> {
  const places = await q.all<{ id: number; parent_id: number | null; name: string }>('SELECT id, parent_id, name FROM places WHERE owner_id = ?', [owner]);
  const byPlace = new Map<string, number>();
  for (const p of [...places].sort((a, b) => a.id - b.id)) { const k = `${p.parent_id ?? 0}|${labelKey(p.name)}`; if (!byPlace.has(k)) byPlace.set(k, p.id); }
  const names = new Map(places.map((p) => [p.id, p]));
  const pathOf = (id: number | null): string => {
    const out: string[] = [];
    for (let at = id, n = 0; at !== null && n <= MAX_DEPTH; n += 1) { const p = names.get(at); if (!p) break; out.unshift(labelKey(p.name)); at = p.parent_id; }
    return out.join(' › ');
  };
  const kept = await q.all<{ name: string; place_id: number | null; asset_no: number | null; import_ref: string | null }>('SELECT name, place_id, asset_no, import_ref FROM items WHERE owner_id = ?', [owner]);
  const refs = new Set(kept.map((i) => i.import_ref).filter((r): r is string => !!r));
  const assets = new Map(kept.filter((i) => i.asset_no !== null).map((i) => [i.asset_no!, labelKey(i.name)]));
  const spots = new Set(kept.map((i) => `${labelKey(i.name)}\n${pathOf(i.place_id)}`));
  const kinds = new Map((await q.all<{ key: string; id: number }>('SELECT key, id FROM kinds WHERE owner_id = ?', [owner])).map((k) => [k.key, k.id]));
  const tagKeys = new Set((await q.all<{ key: string }>('SELECT key FROM tags WHERE owner_id = ?', [owner])).map((t) => t.key));

  const fresh: Planned[] = [];
  let already = 0;
  const seenRefs = new Set<string>();
  for (const thing of sheet.things) {
    const spot = `${labelKey(thing.name)}
${thing.place.map(labelKey).join(' › ')}`;
    const there = thing.import_ref ? refs.has(thing.import_ref) || seenRefs.has(thing.import_ref)
      : (thing.asset !== null && assets.get(thing.asset) === labelKey(thing.name)) || spots.has(spot);
    if (thing.import_ref) seenRefs.add(thing.import_ref);
    if (there) already += 1; else fresh.push({ thing, kind: kindOf(thing.labels), asset: null });
  }

  // Asset numbers: one HomeBox gave is kept when nothing has it; the rest, and the ones that clash, take the next free numbers.
  const taken = new Set(assets.keys());
  const changes: HomeboxReview['asset_changes'] = [];
  for (const p of fresh) {
    const wanted = p.thing.asset;
    if (wanted !== null && !taken.has(wanted)) { p.asset = wanted; taken.add(wanted); }
  }
  let next = Math.max(0, ...taken);
  for (const p of fresh) {
    if (p.asset !== null) continue;
    do next += 1; while (taken.has(next));
    p.asset = next; taken.add(next);
    if (p.thing.asset !== null) changes.push({ name: p.thing.name, wanted: assetLabel(p.thing.asset), given: assetLabel(next) });
  }

  const perKind = new Map<string, { icon: string | null; things: number }>();
  const wantedPlaces = new Set<string>();
  const wantedTags = new Map<string, string>();
  for (const p of fresh) {
    const k = perKind.get(p.kind.name) ?? { icon: p.kind.icon, things: 0 };
    k.things += 1; perKind.set(p.kind.name, k);
    for (let n = 1; n <= p.thing.place.length; n += 1) wantedPlaces.add(p.thing.place.slice(0, n).map(labelKey).join('\n'));
    for (const l of p.thing.labels) wantedTags.set(labelKey(l), l);
  }
  const placeKnown = (path: string) => {
    let parent = 0;
    for (const part of path.split('\n')) { const id = byPlace.get(`${parent}|${part}`); if (id === undefined) return false; parent = id; }
    return true;
  };
  const review: HomeboxReview = {
    found: sheet.things.length, skipped: sheet.skipped, already, fresh: fresh.length,
    kinds: [...perKind.entries()].map(([name, k]) => ({ name, icon: k.icon, things: k.things, is_new: !kinds.has(labelKey(name)) })).sort((a, b) => b.things - a.things || a.name.localeCompare(b.name)),
    places: { total: wantedPlaces.size, fresh: [...wantedPlaces].filter((p) => !placeKnown(p)).length },
    tags: { total: wantedTags.size, fresh: [...wantedTags.keys()].filter((k) => !tagKeys.has(k)).length },
    asset_changes: changes.slice(0, 10), asset_changed: changes.length,
    gone: fresh.filter((p) => p.thing.gone).length, with_own_fields: fresh.filter((p) => p.thing.own_fields.length > 0).length,
  };
  return { review, fresh };
}

/** What the file holds and what would change, without changing anything. */
export function lookOverHomebox(db: Db, owner: number, sheet: HomeboxSheet): Promise<HomeboxReview> {
  return plan(db, owner, sheet).then((p) => p.review);
}

// ---------- bringing it in ----------

/** Brings in what is new. Nothing here is overwritten or removed. */
export function importHomebox(db: Db, owner: number, clock: Clock, sheet: HomeboxSheet): Promise<HomeboxResult> {
  const at = stamp(clock());
  const today = todayOf(clock);
  return atomic(db, async (tx) => {
    const { review, fresh } = await plan(tx, owner, sheet);

    // Kinds the things need that are not kept yet, made as the ready-made kinds are (with their fields).
    const kindIds = new Map((await tx.all<{ key: string; id: number }>('SELECT key, id FROM kinds WHERE owner_id = ?', [owner])).map((k) => [k.key, k.id]));
    const activityOf = new Map<string, string | undefined>(STARTERS.flatMap((s) => s.kinds.map((k) => [k.name, k.activity] as const)));
    let kindsMade = 0;
    for (const kind of new Map(fresh.map((p) => [p.kind.name, p.kind])).values()) {
      if (kindIds.has(labelKey(kind.name))) continue;
      const made = await tx.run('INSERT INTO kinds (owner_id, name, key, icon, unit, activity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [owner, kind.name, labelKey(kind.name), kind.icon, units.canonical(clean(kind.unit, 20)), clean(activityOf.get(kind.name), 60), at]);
      kindIds.set(labelKey(kind.name), made.lastId);
      kindsMade += 1;
      for (const [order, f] of kind.fields.entries()) {
        const field: FieldInput = f;
        await tx.run('INSERT INTO kind_fields (kind_id, name, key, type, unit, choices, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [made.lastId, field.name, labelKey(field.name), field.type, field.type === 'number' ? clean(field.unit, 20) : null,
            field.type === 'choice' && field.choices?.length ? JSON.stringify(field.choices) : null, order]);
      }
    }

    // Places, one inside another as HomeBox had them.
    const placeIds = new Map<string, number>();
    for (const p of await tx.all<{ id: number; parent_id: number | null; name: string }>('SELECT id, parent_id, name FROM places WHERE owner_id = ? ORDER BY id', [owner])) {
      const key = `${p.parent_id ?? 0}|${labelKey(p.name)}`;
      if (!placeIds.has(key)) placeIds.set(key, p.id);
    }
    let placesMade = 0;
    const ensurePlace = async (names: string[]): Promise<number | null> => {
      let parent = 0;
      for (const name of names) {
        const key = `${parent}|${labelKey(name)}`;
        let id = placeIds.get(key);
        if (id === undefined) {
          id = (await tx.run('INSERT INTO places (owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?)', [owner, parent || null, name, at])).lastId;
          placeIds.set(key, id);
          placesMade += 1;
        }
        parent = id;
      }
      return parent || null;
    };

    for (const { thing, kind, asset } of fresh) {
      const kindId = kindIds.get(labelKey(kind.name))!;
      const placeId = await ensurePlace(thing.place);
      const gone = thing.gone;
      const made = await tx.run(
        `INSERT INTO items (owner_id, kind_id, name, quantity, unit, place_id, note, bought_on, bought_at, price_cents, serial, model, warranty_until,
           asset_no, insured, gone_on, gone_how, gone_to, gone_cents, import_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner, kindId, thing.name, thing.quantity, units.canonical(clean(kind.unit, 20)), placeId, thing.note, thing.bought_on, thing.bought_at, thing.price_cents, thing.serial, thing.model, thing.warranty_until,
          asset, thing.insured ? 1 : 0, gone ? gone.on ?? today : null, gone ? 'sold' : null, gone ? gone.to : null, gone ? gone.cents : null, thing.import_ref, at, at]);
      const id = made.lastId;
      const activity = clean(activityOf.get(kind.name), 60);
      if (activity) await tx.run('INSERT INTO item_activities (item_id, activity, key) VALUES (?, ?, ?)', [id, activity, labelKey(activity)]);
      for (const [order, f] of thing.own_fields.entries()) await tx.run('INSERT INTO item_fields (item_id, name, value, sort_order) VALUES (?, ?, ?, ?)', [id, f.name, f.value, order]);
      if (thing.labels.length) await setByNames(tx, owner, 'thing', id, thing.labels, at);
      await noteHistory(tx, owner, { item_id: id }, { what: 'added', to_place: thing.place.length ? thing.place.join(' › ') : null, day: today, at });
    }
    return {
      found: review.found, added: fresh.length, already: review.already, skipped: review.skipped, kinds_made: kindsMade, places_made: placesMade,
      tags_made: review.tags.fresh, asset_changed: review.asset_changed,
    };
  });
}
