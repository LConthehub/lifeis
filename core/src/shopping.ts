/**
 * Shopping: what things cost, the total as the trolley fills, and coupons.
 *
 * This sits beside the grocery list (kitchen.ts) and changes nothing in it. As you shop, a line on the list can
 * be given the price you paid. That does two jobs: it counts towards today's total, and it is kept as a
 * price for that ingredient, with the shop and the day, so next time the list can say what it cost last
 * time and guess the trip before you start.
 *
 * A price is what you paid for the line as it's written ("2 lb chicken thighs": 6.98), in whole cents, so
 * adding up never drifts. A line ticked off without a price takes last time's as a stand-in, marked as
 * assumed: it counts in the total, but isn't remembered as a price anyone actually saw.
 *
 * A coupon is money or a percentage off, for one thing on the list or for the whole shop, perhaps only at one
 * shop and until a day. Saying you're using it takes it off today's total, and it isn't offered again.
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
  /** True when the price is last time's, standing in until the real one is typed. */
  assumed: boolean;
  last: LastPrice | null;
  /** Coupons that could be used on this line. */
  coupons: number[];
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
  /** What it takes off today's shop, in cents, as the trolley stands. */
  worth_cents: number;
};
export type Shopping = {
  currency: string;
  /** Where today's shop is, kept with each price. */
  store: string | null;
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
  latest: PricePoint;
  lowest: PricePoint;
  highest: PricePoint;
  /** The latest less the one before, on the basis above; null with only one price. */
  change_cents: number | null;
};
export type MonthSpend = { /** 2046-03 */ month: string; cents: number; lines: number };
/** What a scanned grocery barcode turned out to be. */
export type Scanned = {
  barcode: string;
  /** The ingredient this product has been taught as; null the first time it's seen. */
  ingredient: { id: number; name: string; product: string | null } | null;
  /** The line of the list it is, if it's on it. */
  line: { id: number; label: string; amount: string; done: boolean } | null;
  last: LastPrice | null;
};

const CURRENCY = 'shopping_currency';
const STORE = 'shopping_store';
const MAX_CENTS = 100_000_000;

type CouponRow = Omit<Coupon, 'days_left' | 'worth_cents' | 'ingredient'> & { ingredient: string | null };
type Line = { id: number; ingredient_id: number | null; label: string; quantity: number | null; unit: string | null; done: number };
const valueOf = (p: { cents: number; per_cents: number | null }, basis: 'per' | 'line') => (basis === 'per' ? p.per_cents! : p.cents);
type PriceRow = { grocery_id: number | null; ingredient_id: number | null; label: string; cents: number; quantity: number | null; unit: string | null; store: string | null; day: string; assumed: number };

const keyOf = (line: { ingredient_id: number | null; label: string }) => (line.ingredient_id !== null ? `#${line.ingredient_id}` : `~${line.label.trim().toLowerCase()}`);

export function shopping(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const setting = async (key: string) => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]))?.value ?? null;
  const keep = (key: string, value: string | null) => (value === null
    ? db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, key])
    : db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, key, value]));

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
    const done = lines.filter((l) => l.done === 1);
    const trolley = done.reduce((sum, l) => sum + (onLine.get(l.id)?.cents ?? 0), 0);
    const worth = (c: CouponRow): number => {
      const target = c.ingredient_id !== null ? done.find((l) => l.ingredient_id === c.ingredient_id) : undefined;
      const base = c.ingredient_id !== null ? (target ? onLine.get(target.id)?.cents ?? 0 : 0) : trolley;
      if (c.percent_off !== null) return Math.round(base * c.percent_off / 100);
      // Money off one thing can't be more than the thing cost; before it's in the trolley, the coupon's own figure stands.
      return c.ingredient_id !== null && target && onLine.has(target.id) ? Math.min(c.cents_off!, base) : c.cents_off!;
    };
    const coupons = rows
      .map((c): Coupon => ({ ...c, days_left: c.expires_on ? dayNumber(c.expires_on) - dayNumber(day) : null, worth_cents: worth(c) }))
      // One that ran out more than a fortnight ago, unused, is no longer worth showing.
      .filter((c) => c.used_on !== null || c.days_left === null || c.days_left >= -14);
    const couponsCents = Math.min(trolley, coupons.filter((c) => c.used_on === day).reduce((sum, c) => sum + c.worth_cents, 0));

    const left = lines.filter((l) => l.done === 0);
    return {
      currency: (await setting(CURRENCY)) ?? '$',
      store: await setting(STORE),
      lines: lines.map((l) => ({
        id: l.id, price_cents: onLine.get(l.id)?.cents ?? null, assumed: onLine.get(l.id)?.assumed === 1, last: lastFor(l),
        coupons: coupons.filter((c) => c.used_on === null && (c.days_left === null || c.days_left >= 0) && c.ingredient_id !== null && c.ingredient_id === l.ingredient_id).map((c) => c.id),
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

    /** Where today's shop is. Kept with each price from now on. */
    async setStore(name: string | null): Promise<Shopping> {
      await keep(STORE, clean(name, 100));
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
    async setPrice(groceryId: number, price: number | null, assumed = false, barcode?: string | null): Promise<Shopping> {
      const l = await line(db, groceryId);
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
      const known = await db.get<{ id: number; name: string; product: string | null }>(
        'SELECT i.id, i.name, b.label AS product FROM ingredient_barcodes b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.owner_id = ? AND b.barcode = ?', [owner, barcode]);
      if (!known) return { barcode, ingredient: null, line: null, last: null };
      // On the list: the line still to get if there is one, else the one already in the trolley.
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

    /** Teach a barcode: this product is the thing on that line of the list. Taught again, it's simply changed. */
    async learn(code: string, groceryId: number, product?: string | null): Promise<Scanned> {
      const barcode = barcodeKey(code);
      if (!/^[0-9A-Z]{4,40}$/.test(barcode)) throw new Problem(400, "That isn't a barcode");
      const l = await line(db, groceryId);
      if (l.ingredient_id === null) throw new Problem(400, "That line isn't an ingredient Life Is knows, so a barcode can't be tied to it");
      await db.run(
        `INSERT INTO ingredient_barcodes (owner_id, barcode, ingredient_id, label, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, barcode) DO UPDATE SET ingredient_id = excluded.ingredient_id, label = COALESCE(excluded.label, label)`,
        [owner, barcode, l.ingredient_id, clean(product, 200), stamp(clock())]);
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
      const groups = new Map<string, { name: string; points: PricePoint[] }>();
      for (const p of rows) {
        const group = groups.get(keyOf(p)) ?? groups.set(keyOf(p), { name: p.name ?? p.label, points: [] }).get(keyOf(p))!;
        const known = p.quantity !== null && p.quantity > 0;
        group.points.push({ cents: p.cents, amount: units.amount(p.quantity, p.unit), store: p.store, day: p.day,
          per_cents: known ? Math.round(p.cents / p.quantity!) : null, per: known ? (p.unit ?? 'each') : null });
      }
      return [...groups.values()].map(({ name, points }): Trend => {
        const per = points[0]!.per;
        const basis = per !== null && points.every((p) => p.per === per) ? 'per' : 'line';
        const by = (pick: (a: number, b: number) => boolean) => points.reduce((best, p) => (pick(valueOf(p, basis), valueOf(best, basis)) ? p : best));
        const latest = points[points.length - 1]!;
        return {
          name, times: points.length, basis, per: basis === 'per' ? per : null, points, latest, lowest: by((a, b) => a < b), highest: by((a, b) => a > b),
          change_cents: points.length > 1 ? valueOf(latest, basis) - valueOf(points[points.length - 2]!, basis) : null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
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
      if (target && target.ingredient_id === null) throw new Problem(400, "That line isn't an ingredient Life Is knows, so a coupon can't be tied to it. Leave it for the whole shop and say what it's for.");
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
