/**
 * Shopping: what things cost, the total as the cart fills, and coupons.
 *
 * This sits beside the grocery list (kitchen.ts) and changes nothing in it. As you shop, a line on the list can
 * be given the price you paid. That does two jobs: it counts towards today's total, and it is kept as a
 * price for that ingredient, with the store and the day, so next time the list can say what it cost last
 * time and guess the trip before you start.
 *
 * A price is what you paid, in whole cents, so adding up never drifts. With it goes the size you bought: the
 * amount on the list ("2 lb chicken thighs"), or, when the list only says "coffee", the size on the packet
 * ("30 oz"). Sizes are what let two stores, or a small bag and a big tin, be compared for one ounce.
 *
 * Stores are a list of your own to choose from, so a store is spelled one way and prices can be set side by side.
 * Each thing can have a usual store and a usual size ("coffee: Costco, 3 lb"). The usual store lets the list be
 * read store by store; the usual size shows on a line that gives no amount, and is the size a price is taken
 * to be for unless another is typed. A line ticked off without a price takes last time's as a stand-in, marked as
 * assumed: it counts in the total, but isn't remembered as a price anyone actually saw.
 *
 * A coupon is money or a percentage off, for one thing on the list or for the whole shop, perhaps only at one
 * store and until a day. Saying you're using it takes it off today's total, and it isn't offered again.
 */
import type { Db, Queries } from './db.ts';
import { barcodeKey } from './media.ts';
import { Problem } from './problem.ts';
import { clean, dayNumber, dayOrNull, stamp, todayOf, type Clock } from './small.ts';
import * as units from './units.ts';

export type LastPrice = { cents: number; /** "2 lb", as it was bought. */ amount: string; store: string | null; day: string };
export type ShoppingLine = {
  /** The grocery line's id. */
  id: number;
  price_cents: number | null;
  /** The size that price was for ("30 oz"); empty when none is known. */
  size: string;
  /** True when the price is last time's, standing in until the real one is typed. */
  assumed: boolean;
  last: LastPrice | null;
  /** Coupons that could be used on this line. */
  coupons: number[];
  /** The store this is usually bought at, when one has been said. */
  usual_store: string | null;
  /** The size it's usually bought in ("30 oz"); empty when none has been said. */
  usual_size: string;
  /** Where it will most likely be bought: the usual store, or else where it was bought last. */
  likely_store: string | null;
};
export type CouponInput = {
  label: string;
  /** The line on the list it's for. Left out: it's for the whole shop. */
  grocery_id?: number | null;
  /** Money off, in cents, or a percentage: one or the other. */
  cents_off?: number | null;
  percent_off?: number | null;
  store?: string | null;
  code?: string | null;
  expires_on?: string | null;
  note?: string | null;
};
export type Coupon = {
  id: number; label: string; ingredient_id: number | null; /** What it's for, by name; null for the whole shop. */ ingredient: string | null;
  cents_off: number | null; percent_off: number | null; store: string | null; code: string | null; expires_on: string | null; note: string | null;
  used_on: string | null;
  /** Days until it runs out; 0 is today, below 0 it has. Null when it doesn't. */
  days_left: number | null;
  /** What it takes off today's shop, in cents, as the cart stands. */
  worth_cents: number;
};
export type Shopping = {
  currency: string;
  /** Where today's shop is, kept with each price. */
  store: string | null;
  /** Your stores, to choose from, by name. */
  stores: string[];
  /** The id of the store today's shop is, when it is one on your list. */
  store_id: number | null;
  /** The order the aisles run in at today's shop; null when none has been set, and the list keeps its usual order. */
  aisle_order: string[] | null;
  lines: ShoppingLine[];
  coupons: Coupon[];
  totals: {
    /** What's ticked off and priced. */
    trolley_cents: number;
    /** Ticked off with no price at all. */
    trolley_unpriced: number;
    /** A guess at what's still to get, from last time's prices. */
    left_cents: number;
    /** Still to get, and never priced. */
    left_unknown: number;
    coupons_cents: number;
    to_pay_cents: number;
  };
};

/** A price with what it comes to for one of whatever it was bought by ("349 per lb"), when an amount is known. */
export type PricePoint = LastPrice & { per_cents: number | null; per: string | null };
/** How one ingredient's price has gone. */
export type Trend = {
  name: string;
  times: number;
  /** What the figures compare: the price for one unit (`per` says which), or the price of the line as bought. */
  basis: 'per' | 'line';
  per: string | null;
  /** Oldest first. */
  points: PricePoint[];
  /** The latest price at each store, cheapest first. */
  shops: PricePoint[];
  latest: PricePoint;
  lowest: PricePoint;
  highest: PricePoint;
  /** The latest less the one before, on the basis above; null with only one price. */
  change_cents: number | null;
};
export type Store = { id: number; name: string; note: string | null; /** How many prices were seen there, and when last. */ prices: number; last_on: string | null };
/** A rough cost for a plan's food, going by the last price seen for each ingredient its recipes call for. */
export type PlanCost = {
  currency: string;
  /** How many different ingredients the plan's recipes name. */
  ingredients: number;
  /** How many of those have a price to go by, and what they come to. */
  priced: number;
  cents: number;
  /** The ones with no price yet, by name. */
  unpriced: string[];
};
export type MonthSpend = { /** 2046-03 */ month: string; cents: number; lines: number };
/** What a scanned grocery barcode turned out to be. */
export type Scanned = {
  barcode: string;
  /** The ingredient this product has been taught as; null the first time it's seen. */
  ingredient: { id: number; name: string; product: string | null; /** The size on the packet, when taught: "30 oz". */ size: string } | null;
  /** The line of the list it is, if it's on it. */
  line: { id: number; label: string; amount: string; done: boolean } | null;
  last: LastPrice | null;
};

const CURRENCY = 'shopping_currency';
const STORE = 'shopping_store';
/** Each store's aisle order is kept in the person's settings under this key plus the store's id (no table of its own). */
const AISLES = (storeId: number) => `shopping_aisles_${storeId}`;
const MAX_AISLES = 100;
const MAX_CENTS = 100_000_000;

type CouponRow = Omit<Coupon, 'days_left' | 'worth_cents' | 'ingredient'> & { ingredient: string | null };
type Line = { id: number; ingredient_id: number | null; label: string; quantity: number | null; unit: string | null; done: number };
type Habit = { id: number; usual_store: string | null; usual_size_quantity: number | null; usual_size_unit: string | null };
const valueOf = (p: { cents: number; per_cents: number | null }, basis: 'per' | 'line') => (basis === 'per' ? p.per_cents! : p.cents);

/** A size as it's typed ("30 oz", "2 lb", "6"): how much, and of what. Null when nothing was typed. */
export function sizeOf(text: string | null | undefined): { quantity: number; unit: string | null } | null {
  const tidy = clean(text, 40);
  if (!tidy) return null;
  const read = units.parseLine(tidy);
  if (read.quantity === null || !(read.quantity > 0)) throw new Problem(400, 'A size is written like 30 oz, 2 lb or 6');
  return { quantity: read.quantity, unit: read.unit };
}
/** What kind of measure a size is, so only like is compared with like: weight, volume, or a count. */
const family = (unit: string | null) => (unit === null ? 'count' : units.kindOf(unit));
/** What one "per" is for a unit: a pound, an ounce, each; but 100 g and 100 ml, since one gram costs next to nothing. */
const perOf = (unit: string | null): { label: string; of: number } => (unit === null ? { label: 'each', of: 1 } : ['g', 'ml'].includes(unit) ? { label: `100 ${unit}`, of: 100 } : { label: unit, of: 1 });
type PriceRow = { grocery_id: number | null; ingredient_id: number | null; label: string; cents: number; quantity: number | null; unit: string | null; store: string | null; day: string; assumed: number };

const keyOf = (line: { ingredient_id: number | null; label: string }) => (line.ingredient_id !== null ? `#${line.ingredient_id}` : `~${line.label.trim().toLowerCase()}`);

export function shopping(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const setting = async (key: string) => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]))?.value ?? null;
  const keep = (key: string, value: string | null) => (value === null
    ? db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, key])
    : db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, key, value]));

  /** The aisles of a store in the order its person walks them; null when none has been set. */
  const aisleOrder = async (storeId: number): Promise<string[] | null> => {
    try {
      const list = JSON.parse((await setting(AISLES(storeId))) ?? 'null') as unknown;
      return Array.isArray(list) && list.length > 0 ? list.filter((a): a is string => typeof a === 'string') : null;
    } catch {
      return null;
    }
  };
  const storeRow = async (id: number) => {
    const row = await db.get<{ id: number; name: string }>('SELECT id, name FROM stores WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  };

  const line = async (q: Queries, id: number): Promise<Line> => {
    const found = await q.get<Line>('SELECT id, ingredient_id, label, quantity, unit, done FROM grocery WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, "That isn't on the list");
    return found;
  };
  const cents = (value: number | null | undefined, what: string): number => {
    if (!(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CENTS)) throw new Problem(400, `${what} is an amount of money, like 3.49`);
    return value;
  };

  function couponValues(input: CouponInput) {
    const label = clean(input.label, 200);
    if (!label) throw new Problem(400, "Say what the coupon is for");
    const money = input.cents_off ?? null;
    const percent = input.percent_off ?? null;
    if ((money === null) === (percent === null)) throw new Problem(400, 'A coupon is either money off or a percentage off');
    if (money !== null && cents(money, 'Money off') === 0) throw new Problem(400, 'Money off is more than nothing');
    if (percent !== null && !(percent > 0 && percent <= 100)) throw new Problem(400, 'A percentage off is between 1 and 100');
    return { label, money, percent, store: clean(input.store, 100), code: clean(input.code, 100), expires: dayOrNull(input.expires_on), note: clean(input.note, 500) };
  }

  async function summary(): Promise<Shopping> {
    const day = today();
    const lines = await db.all<Line>('SELECT id, ingredient_id, label, quantity, unit, done FROM grocery WHERE owner_id = ? ORDER BY id', [owner]);
    const prices = await db.all<PriceRow>(
      'SELECT grocery_id, ingredient_id, label, cents, quantity, unit, store, day, assumed FROM prices WHERE owner_id = ? ORDER BY day DESC, id DESC', [owner]);
    const onLine = new Map(prices.filter((p) => p.grocery_id !== null).map((p) => [p.grocery_id!, p]));
    // Last time's price: the newest one somebody actually saw, for the same ingredient, on some other line.
    const lastFor = (l: Line): LastPrice | null => {
      const found = prices.find((p) => p.assumed === 0 && p.grocery_id !== l.id && keyOf(p) === keyOf(l));
      return found ? { cents: found.cents, amount: units.amount(found.quantity, found.unit), store: found.store, day: found.day } : null;
    };

    const rows = await db.all<CouponRow>(
      `SELECT c.id, c.label, c.ingredient_id, i.name AS ingredient, c.cents_off, c.percent_off, c.store, c.code, c.expires_on, c.note, c.used_on
       FROM coupons c LEFT JOIN ingredients i ON i.id = c.ingredient_id
       WHERE c.owner_id = ? AND (c.used_on IS NULL OR c.used_on = ?) ORDER BY COALESCE(c.expires_on, '9999'), c.id`, [owner, day]);
    const habits = new Map((await db.all<Habit>(
      'SELECT id, usual_store, usual_size_quantity, usual_size_unit FROM ingredients WHERE owner_id = ? AND (usual_store IS NOT NULL OR usual_size_quantity IS NOT NULL)', [owner])).map((h) => [h.id, h]));
    const habitOf = (l: Line) => (l.ingredient_id !== null ? habits.get(l.ingredient_id) : undefined);
    const storeNames = (await db.all<{ name: string }>('SELECT name FROM stores WHERE owner_id = ? ORDER BY name COLLATE NOCASE', [owner])).map((r) => r.name);
    const done = lines.filter((l) => l.done === 1);
    const trolley = done.reduce((sum, l) => sum + (onLine.get(l.id)?.cents ?? 0), 0);
    const worth = (c: CouponRow): number => {
      const target = c.ingredient_id !== null ? done.find((l) => l.ingredient_id === c.ingredient_id) : undefined;
      const base = c.ingredient_id !== null ? (target ? onLine.get(target.id)?.cents ?? 0 : 0) : trolley;
      if (c.percent_off !== null) return Math.round(base * c.percent_off / 100);
      // Money off one thing can't be more than the thing cost; before it's in the cart, the coupon's own figure stands.
      return c.ingredient_id !== null && target && onLine.has(target.id) ? Math.min(c.cents_off!, base) : c.cents_off!;
    };
    const coupons = rows
      .map((c): Coupon => ({ ...c, days_left: c.expires_on ? dayNumber(c.expires_on) - dayNumber(day) : null, worth_cents: worth(c) }))
      // One that ran out more than two weeks ago, unused, is no longer worth showing.
      .filter((c) => c.used_on !== null || c.days_left === null || c.days_left >= -14);
    const couponsCents = Math.min(trolley, coupons.filter((c) => c.used_on === day).reduce((sum, c) => sum + c.worth_cents, 0));

    const left = lines.filter((l) => l.done === 0);
    const here = await setting(STORE);
    const hereRow = here ? await db.get<{ id: number }>('SELECT id FROM stores WHERE owner_id = ? AND name = ? COLLATE NOCASE', [owner, here]) : undefined;
    return {
      currency: (await setting(CURRENCY)) ?? '$',
      store: here,
      stores: storeNames,
      store_id: hereRow?.id ?? null,
      aisle_order: hereRow ? await aisleOrder(hereRow.id) : null,
      lines: lines.map((l) => ({
        id: l.id, price_cents: onLine.get(l.id)?.cents ?? null, size: onLine.has(l.id) ? units.amount(onLine.get(l.id)!.quantity, onLine.get(l.id)!.unit) : '',
        assumed: onLine.get(l.id)?.assumed === 1, last: lastFor(l),
        coupons: coupons.filter((c) => c.used_on === null && (c.days_left === null || c.days_left >= 0) && c.ingredient_id !== null && c.ingredient_id === l.ingredient_id).map((c) => c.id),
        usual_store: habitOf(l)?.usual_store ?? null, usual_size: units.amount(habitOf(l)?.usual_size_quantity, habitOf(l)?.usual_size_unit),
        likely_store: habitOf(l)?.usual_store ?? lastFor(l)?.store ?? null,
      })),
      coupons,
      totals: {
        trolley_cents: trolley, trolley_unpriced: done.filter((l) => !onLine.has(l.id)).length,
        left_cents: left.reduce((sum, l) => sum + (lastFor(l)?.cents ?? 0), 0), left_unknown: left.filter((l) => !lastFor(l)).length,
        coupons_cents: couponsCents, to_pay_cents: trolley - couponsCents,
      },
    };
  }

  const coupon = async (id: number) => {
    if (!(await db.get('SELECT id FROM coupons WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
  };

  return {
    summary,

    /** Where today's shop is. Kept with each price from now on. A store not seen before joins your list. */
    async setStore(name: string | null): Promise<Shopping> {
      const tidy = clean(name, 100);
      if (tidy) await db.run('INSERT OR IGNORE INTO stores (owner_id, name, created_at) VALUES (?, ?, ?)', [owner, tidy, stamp(clock())]);
      // Kept as the list spells it, however it was typed this time.
      const listed = tidy ? await db.get<{ name: string }>('SELECT name FROM stores WHERE owner_id = ? AND name = ? COLLATE NOCASE', [owner, tidy]) : undefined;
      await keep(STORE, listed?.name ?? tidy);
      return summary();
    },

    /**
     * Say where the thing on a line is usually bought, and in what size. Either can be left empty to forget
     * it. It's kept for the ingredient, so it holds every time that thing is on the list.
     */
    async setUsual(groceryId: number, input: { store?: string | null; size?: string | null }): Promise<Shopping> {
      const l = await line(db, groceryId);
      if (l.ingredient_id === null) throw new Problem(400, "That line isn't an ingredient Life Is knows, so nothing can be remembered about it");
      const store = clean(input.store, 100);
      if (store) await db.run('INSERT OR IGNORE INTO stores (owner_id, name, created_at) VALUES (?, ?, ?)', [owner, store, stamp(clock())]);
      const listed = store ? await db.get<{ name: string }>('SELECT name FROM stores WHERE owner_id = ? AND name = ? COLLATE NOCASE', [owner, store]) : undefined;
      const size = sizeOf(input.size);
      await db.run('UPDATE ingredients SET usual_store = ?, usual_size_quantity = ?, usual_size_unit = ? WHERE id = ? AND owner_id = ?',
        [listed?.name ?? store, size?.quantity ?? null, size?.unit ?? null, l.ingredient_id, owner]);
      return summary();
    },

    // ---------- stores ----------

    /** Your stores, with how many prices were seen at each. */
    stores(): Promise<Store[]> {
      return db.all<Store>(
        `SELECT s.id, s.name, s.note,
           (SELECT COUNT(*) FROM prices p WHERE p.owner_id = s.owner_id AND p.store = s.name COLLATE NOCASE AND p.assumed = 0) AS prices,
           (SELECT MAX(p.day) FROM prices p WHERE p.owner_id = s.owner_id AND p.store = s.name COLLATE NOCASE) AS last_on
         FROM stores s WHERE s.owner_id = ? ORDER BY s.name COLLATE NOCASE`, [owner]);
    },

    async addStore(input: { name: string; note?: string | null }): Promise<Store[]> {
      const name = clean(input.name, 100);
      if (!name) throw new Problem(400, 'Give the store a name');
      if (await db.get('SELECT id FROM stores WHERE owner_id = ? AND name = ? COLLATE NOCASE', [owner, name])) throw new Problem(409, "That store is already on your list");
      await db.run('INSERT INTO stores (owner_id, name, note, created_at) VALUES (?, ?, ?, ?)', [owner, name, clean(input.note, 300), stamp(clock())]);
      return this.stores();
    },

    /** Rename a store, or change its note. Its prices and coupons follow the new name. */
    async updateStore(id: number, input: { name: string; note?: string | null }): Promise<Store[]> {
      const name = clean(input.name, 100);
      if (!name) throw new Problem(400, 'Give the store a name');
      const old = await db.get<{ name: string }>('SELECT name FROM stores WHERE id = ? AND owner_id = ?', [id, owner]);
      if (!old) throw new Problem(404, 'Not found');
      if (await db.get('SELECT id FROM stores WHERE owner_id = ? AND name = ? COLLATE NOCASE AND id != ?', [owner, name, id])) throw new Problem(409, "Another store already has that name");
      await db.run('UPDATE stores SET name = ?, note = ? WHERE id = ?', [name, clean(input.note, 300), id]);
      await db.run('UPDATE prices SET store = ? WHERE owner_id = ? AND store = ? COLLATE NOCASE', [name, owner, old.name]);
      await db.run('UPDATE coupons SET store = ? WHERE owner_id = ? AND store = ? COLLATE NOCASE', [name, owner, old.name]);
      await db.run('UPDATE ingredients SET usual_store = ? WHERE owner_id = ? AND usual_store = ? COLLATE NOCASE', [name, owner, old.name]);
      if (((await setting(STORE)) ?? '').toLowerCase() === old.name.toLowerCase()) await keep(STORE, name);
      return this.stores();
    },

    /** Take a store off your list. What you paid there stays in the prices, under its name. */
    async removeStore(id: number): Promise<Store[]> {
      await db.run('DELETE FROM stores WHERE id = ? AND owner_id = ?', [id, owner]);
      await keep(AISLES(id), null);
      return this.stores();
    },

    /** The order a store's aisles run in, or null when none has been set. */
    async aisles(storeId: number): Promise<string[] | null> {
      await storeRow(storeId);
      return aisleOrder(storeId);
    },

    /**
     * Say the order the aisles run in at a store, first to last. The list grouped by aisle then follows it when you
     * shop there. Aisles left out of the order come after those named, in the usual order. An empty order forgets it.
     */
    async setAisles(storeId: number, aisles: string[]): Promise<Shopping> {
      await storeRow(storeId);
      const seen = new Set<string>();
      const tidy: string[] = [];
      for (const a of aisles) {
        const name = clean(a, 60);
        if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); tidy.push(name); }
      }
      if (tidy.length > MAX_AISLES) throw new Problem(400, `Up to ${MAX_AISLES} aisles`);
      await keep(AISLES(storeId), tidy.length ? JSON.stringify(tidy) : null);
      return summary();
    },

    /** The sign prices are shown with: $, £, €, kr. Nothing is converted. */
    async setCurrency(sign: string): Promise<Shopping> {
      const tidy = clean(sign, 4);
      if (!tidy) throw new Problem(400, 'Give the sign prices are shown with, like $');
      await keep(CURRENCY, tidy);
      return summary();
    },

    /**
     * What a line on the list cost, in cents; null takes the price away again. `assumed` marks last time's
     * price standing in. The line's price is replaced, never added to.
     */
    async setPrice(groceryId: number, price: number | null, assumed = false, barcode?: string | null, size?: string | null): Promise<Shopping> {
      const l = await line(db, groceryId);
      // The size bought: what was typed; else the amount on the list; else the packet's own; else the usual size; else what it was last time.
      const habit = l.ingredient_id !== null ? await db.get<Habit>('SELECT id, usual_store, usual_size_quantity, usual_size_unit FROM ingredients WHERE id = ? AND owner_id = ?', [l.ingredient_id, owner]) : undefined;
      const typed = sizeOf(size);
      const packet = barcode ? await db.get<{ size_quantity: number | null; size_unit: string | null }>(
        'SELECT size_quantity, size_unit FROM ingredient_barcodes WHERE owner_id = ? AND barcode = ?', [owner, barcodeKey(barcode)]) : undefined;
      const before = await db.get<{ quantity: number | null; unit: string | null }>(
        `SELECT quantity, unit FROM prices WHERE owner_id = ? AND assumed = 0 AND quantity IS NOT NULL AND (grocery_id IS NULL OR grocery_id != ?)
         AND ${l.ingredient_id !== null ? 'ingredient_id = ?' : 'ingredient_id IS NULL AND LOWER(TRIM(label)) = ?'} ORDER BY day DESC, id DESC LIMIT 1`,
        [owner, groceryId, l.ingredient_id ?? l.label.trim().toLowerCase()]);
      const bought = typed ?? (l.quantity !== null ? { quantity: l.quantity, unit: l.unit }
        : packet?.size_quantity != null ? { quantity: packet.size_quantity, unit: packet.size_unit }
        : habit?.usual_size_quantity != null ? { quantity: habit.usual_size_quantity, unit: habit.usual_size_unit }
        : before?.quantity != null ? { quantity: before.quantity, unit: before.unit } : { quantity: null, unit: null });
      l.quantity = bought.quantity;
      l.unit = bought.unit;
      await db.run('DELETE FROM prices WHERE owner_id = ? AND grocery_id = ?', [owner, groceryId]);
      if (price !== null) {
        await db.run(
          'INSERT INTO prices (owner_id, ingredient_id, grocery_id, label, cents, quantity, unit, store, day, assumed, barcode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [owner, l.ingredient_id, groceryId, l.label, cents(price, 'A price'), l.quantity, l.unit, await setting(STORE), today(), assumed ? 1 : 0, barcode ? barcodeKey(barcode) : null, stamp(clock())]);
      }
      return summary();
    },

    // ---------- barcodes ----------

    /** What a scanned barcode is: the ingredient it was taught as, the line of the list it is, and its last price. */
    async scan(code: string): Promise<Scanned> {
      const barcode = barcodeKey(code);
      if (!/^[0-9A-Z]{4,40}$/.test(barcode)) throw new Problem(400, "That isn't a barcode");
      const found = await db.get<{ id: number; name: string; product: string | null; size_quantity: number | null; size_unit: string | null }>(
        `SELECT i.id, i.name, b.label AS product, b.size_quantity, b.size_unit FROM ingredient_barcodes b JOIN ingredients i ON i.id = b.ingredient_id
         WHERE b.owner_id = ? AND b.barcode = ?`, [owner, barcode]);
      if (!found) return { barcode, ingredient: null, line: null, last: null };
      const known = { id: found.id, name: found.name, product: found.product, size: units.amount(found.size_quantity, found.size_unit) };
      // On the list: the line still to get if there is one, else the one already in the cart.
      const onList = await db.get<Line>('SELECT id, ingredient_id, label, quantity, unit, done FROM grocery WHERE owner_id = ? AND ingredient_id = ? ORDER BY done, id LIMIT 1', [owner, known.id]);
      const before = await db.get<PriceRow>(
        `SELECT grocery_id, ingredient_id, label, cents, quantity, unit, store, day, assumed FROM prices
         WHERE owner_id = ? AND ingredient_id = ? AND assumed = 0 AND (grocery_id IS NULL OR grocery_id != ?) ORDER BY day DESC, id DESC LIMIT 1`, [owner, known.id, onList?.id ?? 0]);
      return {
        barcode, ingredient: known,
        line: onList ? { id: onList.id, label: onList.label, amount: units.amount(onList.quantity, onList.unit), done: onList.done === 1 } : null,
        last: before ? { cents: before.cents, amount: units.amount(before.quantity, before.unit), store: before.store, day: before.day } : null,
      };
    },

    /** Teach a barcode: this product is the thing on that line of the list, and comes in this size. Taught again, it's simply changed. */
    async learn(code: string, groceryId: number, product?: string | null, size?: string | null): Promise<Scanned> {
      const barcode = barcodeKey(code);
      if (!/^[0-9A-Z]{4,40}$/.test(barcode)) throw new Problem(400, "That isn't a barcode");
      const l = await line(db, groceryId);
      if (l.ingredient_id === null) throw new Problem(400, "That line isn't an ingredient Life Is knows, so a barcode can't be tied to it");
      const packet = sizeOf(size);
      await db.run(
        `INSERT INTO ingredient_barcodes (owner_id, barcode, ingredient_id, label, size_quantity, size_unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, barcode) DO UPDATE SET ingredient_id = excluded.ingredient_id, label = COALESCE(excluded.label, label),
           size_quantity = COALESCE(excluded.size_quantity, size_quantity), size_unit = CASE WHEN excluded.size_quantity IS NULL THEN size_unit ELSE excluded.size_unit END`,
        [owner, barcode, l.ingredient_id, clean(product, 200), packet?.quantity ?? null, packet?.unit ?? null, stamp(clock())]);
      return this.scan(barcode);
    },

    /** Forget what a barcode is. */
    async forget(code: string): Promise<void> {
      await db.run('DELETE FROM ingredient_barcodes WHERE owner_id = ? AND barcode = ?', [owner, barcodeKey(code)]);
    },

    // ---------- over time ----------

    /**
     * How each thing's price has gone, by name. Only prices somebody saw. Where every price of a thing has an
     * amount in the same unit, they are compared for one of that unit, so 2 lb and 5 lb can be set side by
     * side; otherwise by the price of the line as it was bought.
     */
    async trends(): Promise<Trend[]> {
      const rows = await db.all<PriceRow & { name: string | null }>(
        `SELECT p.grocery_id, p.ingredient_id, p.label, p.cents, p.quantity, p.unit, p.store, p.day, p.assumed, i.name
         FROM prices p LEFT JOIN ingredients i ON i.id = p.ingredient_id WHERE p.owner_id = ? AND p.assumed = 0 ORDER BY p.day, p.id`, [owner]);
      const groups = new Map<string, { name: string; rows: typeof rows }>();
      for (const p of rows) (groups.get(keyOf(p)) ?? groups.set(keyOf(p), { name: p.name ?? p.label, rows: [] }).get(keyOf(p))!).rows.push(p);
      return [...groups.values()].map(({ name, rows: bought }): Trend => {
        // Like with like: every price has a size, and the sizes are all weights, or all volumes, or all counts.
        const newest = bought[bought.length - 1]!;
        const sized = bought.every((p) => p.quantity !== null && p.quantity > 0);
        const basis = sized && bought.every((p) => family(p.unit) === family(newest.unit)) && family(newest.unit) !== 'other' ? 'per' : 'line';
        // Each price is worked out for one of the newest price's measure: a 12 oz bag and a 2 lb tin, both per lb.
        const per = perOf(newest.unit);
        const points = bought.map((p): PricePoint => {
          const inNewest = basis !== 'per' ? null : p.unit === newest.unit ? p.quantity : p.unit === null || newest.unit === null ? null : units.convert(p.quantity!, p.unit, newest.unit);
          return { cents: p.cents, amount: units.amount(p.quantity, p.unit), store: p.store, day: p.day,
            per_cents: inNewest ? Math.round(p.cents / inNewest * per.of) : null, per: inNewest ? per.label : null };
        });
        const usable = basis === 'per' && points.every((p) => p.per_cents !== null) ? 'per' : 'line';
        const by = (pick: (a: number, b: number) => boolean) => points.reduce((best, p) => (pick(valueOf(p, usable), valueOf(best, usable)) ? p : best));
        const latest = points[points.length - 1]!;
        const atShop = new Map<string, PricePoint>();
        for (const p of points) if (p.store) atShop.set(p.store.toLowerCase(), p); // oldest first, so the last one kept is the latest there
        return {
          name, times: points.length, basis: usable, per: usable === 'per' ? per.label : null, points, latest, lowest: by((a, b) => a < b), highest: by((a, b) => a > b),
          shops: [...atShop.values()].sort((a, b) => valueOf(a, usable) - valueOf(b, usable)),
          change_cents: points.length > 1 ? valueOf(latest, usable) - valueOf(points[points.length - 2]!, usable) : null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },

    /**
     * Roughly what a plan's food will cost: one of each ingredient its recipes call for, at the last price
     * somebody saw. It doesn't know how much of a packet a recipe uses, or what's already in the pantry.
     */
    async planCost(planId: number): Promise<PlanCost> {
      if (!(await db.get('SELECT id FROM plans WHERE id = ? AND owner_id = ?', [planId, owner]))) throw new Problem(404, 'Not found');
      const needed = await db.all<{ id: number; name: string }>(
        `SELECT DISTINCT i.id, i.name FROM plan_items p JOIN recipe_lines l ON l.recipe_id = p.ref_id AND l.part = 'ingredients'
         JOIN ingredients i ON i.id = l.ingredient_id
         WHERE p.plan_id = ? AND p.kind = 'recipe' AND i.owner_id = ? ORDER BY i.name COLLATE NOCASE`, [planId, owner]);
      const last = new Map<number, number>();
      for (const p of await db.all<{ ingredient_id: number; cents: number }>(
        'SELECT ingredient_id, cents FROM prices WHERE owner_id = ? AND assumed = 0 AND ingredient_id IS NOT NULL ORDER BY day DESC, id DESC', [owner])) {
        if (!last.has(p.ingredient_id)) last.set(p.ingredient_id, p.cents);
      }
      const known = needed.filter((i) => last.has(i.id));
      return {
        currency: (await setting(CURRENCY)) ?? '$', ingredients: needed.length, priced: known.length,
        cents: known.reduce((sum, i) => sum + last.get(i.id)!, 0), unpriced: needed.filter((i) => !last.has(i.id)).map((i) => i.name),
      };
    },

    /** What was spent, month by month, newest first: everything priced, stand-ins included (the money was still spent). */
    async spending(months = 12): Promise<MonthSpend[]> {
      if (!(Number.isInteger(months) && months >= 1 && months <= 120)) throw new Problem(400, '1 to 120 months');
      return db.all<MonthSpend>(
        'SELECT SUBSTR(day, 1, 7) AS month, SUM(cents) AS cents, COUNT(*) AS lines FROM prices WHERE owner_id = ? GROUP BY month ORDER BY month DESC LIMIT ?', [owner, months]);
    },

    /** What the thing on this line has cost before, newest first: only prices somebody saw. */
    async history(groceryId: number): Promise<LastPrice[]> {
      const l = await line(db, groceryId);
      const rows = await db.all<PriceRow>(
        `SELECT grocery_id, ingredient_id, label, cents, quantity, unit, store, day, assumed FROM prices
         WHERE owner_id = ? AND assumed = 0 AND ${l.ingredient_id !== null ? 'ingredient_id = ?' : 'ingredient_id IS NULL AND LOWER(TRIM(label)) = ?'}
         ORDER BY day DESC, id DESC LIMIT 50`, [owner, l.ingredient_id ?? l.label.trim().toLowerCase()]);
      return rows.map((p) => ({ cents: p.cents, amount: units.amount(p.quantity, p.unit), store: p.store, day: p.day }));
    },

    // ---------- coupons ----------

    async addCoupon(input: CouponInput): Promise<Shopping> {
      const v = couponValues(input);
      const target = input.grocery_id != null ? await line(db, input.grocery_id) : null;
      if (target && target.ingredient_id === null) throw new Problem(400, "That line isn't an ingredient Life Is knows, so a coupon can't be tied to it. Leave it for the whole trip and say what it's for.");
      await db.run(
        'INSERT INTO coupons (owner_id, label, ingredient_id, cents_off, percent_off, store, code, expires_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, v.label, target?.ingredient_id ?? null, v.money, v.percent, v.store, v.code, v.expires, v.note, stamp(clock())]);
      return summary();
    },

    /** Change a coupon's details. What it's tied to stays. */
    async updateCoupon(id: number, input: CouponInput): Promise<Shopping> {
      const v = couponValues(input);
      await coupon(id);
      await db.run('UPDATE coupons SET label = ?, cents_off = ?, percent_off = ?, store = ?, code = ?, expires_on = ?, note = ? WHERE id = ?',
        [v.label, v.money, v.percent, v.store, v.code, v.expires, v.note, id]);
      return summary();
    },

    async removeCoupon(id: number): Promise<Shopping> {
      await db.run('DELETE FROM coupons WHERE id = ? AND owner_id = ?', [id, owner]);
      return summary();
    },

    /** Say you're using a coupon on today's shop (it comes off the total), or that you aren't after all. */
    async useCoupon(id: number, using: boolean): Promise<Shopping> {
      await coupon(id);
      await db.run('UPDATE coupons SET used_on = ? WHERE id = ?', [using ? today() : null, id]);
      return summary();
    },
  };
}

export type ShoppingOf = ReturnType<typeof shopping>;
