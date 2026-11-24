/**
 * The addresses for prices, the running total and coupons (/api/shopping). What they do is core/'s
 * shopping.ts; this reads what was sent and passes it on. Money is always whole cents.
 */
import { shopping, trips, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, Refusal, type Body, type Context, type Route } from './http.ts';
import { MAX_THING_PHOTO } from '../../core/src/index.ts';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** A receipt's photo, sent as base64 text by the page after it made it small. Too large or damaged: refused. */
function receiptPhoto(text: string | null): Uint8Array | null {
  if (!text) return null;
  if (text.length > MAX_THING_PHOTO * 1.4 || !BASE64.test(text)) throw new Refusal(400, 'That picture is too large to keep, or was damaged on the way');
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/shopping${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

const couponFrom = (body: Body) => ({
  label: read.text(body, 'label'), grocery_id: read.maybeWhole(body, 'grocery_id'), cents_off: read.maybeWhole(body, 'cents_off'), percent_off: read.maybeNumber(body, 'percent_off'),
  store: read.maybeText(body, 'store'), code: read.maybeText(body, 'code'), expires_on: read.maybeText(body, 'expires_on'), note: read.maybeText(body, 'note'),
});

export function shoppingRoutes(db: Db): Route[] {
  const mine = (c: Context) => shopping(db, c.user.id, c.clock);
  return [
    ['GET', at(''), async (c) => ({ json: await mine(c).summary() })],
    ['PUT', at('/settings'), async (c) => {
      if (sent(c.body, 'currency')) await mine(c).setCurrency(read.text(c.body, 'currency'));
      if (sent(c.body, 'store')) await mine(c).setStore(read.maybeText(c.body, 'store'));
      return { json: await mine(c).summary() };
    }],
    ['PUT', at('/prices/:id'), async (c) => {
      if (!sent(c.body, 'cents')) throw notUnderstood('cents');
      return { json: await mine(c).setPrice(c.id, read.maybeWhole(c.body, 'cents'), read.yesNo(c.body, 'assumed', false), read.maybeText(c.body, 'barcode'), read.maybeText(c.body, 'size'), read.maybeWhole(c.body, 'saved_cents') ?? 0) };
    }],
    // A grocery's barcode: what it is, teaching it, and forgetting it.
    ['GET', at('/scan'), async (c) => ({ json: await mine(c).scan(c.query.get('code') ?? '') })],
    ['PUT', at('/scan'), async (c) => {
      const line = read.maybeWhole(c.body, 'grocery_id');
      if (line === null) throw notUnderstood('grocery_id');
      return { json: await mine(c).learn(read.text(c.body, 'code'), line, read.maybeText(c.body, 'product'), read.maybeText(c.body, 'size')) };
    }],
    ['DELETE', at('/scan'), async (c) => (await mine(c).forget(c.query.get('code') ?? ''), { status: 204 })],
    // Moving a line to another store for this trip (only when the person asks), and done shopping at a store.
    ['PUT', at('/move/:id'), async (c) => ({ json: await mine(c).moveLine(c.id, read.maybeText(c.body, 'store')) })],
    ['GET', at('/trip'), async (c) => ({ json: await trips(db, c.user.id, c.clock).plan(c.query.get('store')) })],
    ['POST', at('/trip'), async (c) => ({ status: 201, json: await trips(db, c.user.id, c.clock).finish({
      store: read.maybeText(c.body, 'store'), ...(sent(c.body, 'from') ? { from: read.maybeText(c.body, 'from') } : {}), total_cents: read.maybeNumber(c.body, 'total_cents'), saved_cents: sent(c.body, 'saved_cents') ? read.maybeNumber(c.body, 'saved_cents') : undefined, photo: receiptPhoto(read.maybeText(c.body, 'photo')), day: read.maybeText(c.body, 'day'),
      parts: sent(c.body, 'parts') ? read.records(c.body, 'parts').map((p) => ({ label: read.maybeText(p, 'label'), cents: read.maybeNumber(p, 'cents'), category_id: read.maybeWhole(p, 'category_id'), project_id: read.maybeWhole(p, 'project_id') })) : undefined,
    }) })],
    // A photo of the receipt, already read into words on the device: its lines, tied to what is in the buggy for the store. Nothing is saved.
    ['POST', at('/receipt'), async (c) => ({ json: await trips(db, c.user.id, c.clock).readReceipt(read.text(c.body, 'text'), read.maybeText(c.body, 'from')) })],
    ['GET', at('/trips/:id/receipt'), async (c) => {
      const photo = await trips(db, c.user.id, c.clock).receipt(c.id);
      if (!photo) return { status: 404, json: { detail: 'Not found' } };
      return { body: photo.bytes, headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } };
    }],
    ['GET', at('/savings'), async (c) => ({ json: await mine(c).savings(c.query.get('month')) })],
    ['GET', at('/drops'), async (c) => ({ json: { currency: (await mine(c).summary()).currency, drops: await mine(c).drops() } })],
    ['POST', at('/drops/:id/claim'), async (c) => ({ json: await mine(c).claimDrop(c.id) })],
    // A store's monthly savings book, typed in a line to a thing.
    ['POST', at('/book'), async (c) => ({ status: 201, json: await mine(c).addBook({ store: read.maybeText(c.body, 'store'), text: read.text(c.body, 'text'), starts_on: read.maybeText(c.body, 'starts_on'), expires_on: read.maybeText(c.body, 'expires_on') }) })],
    ['PUT', at('/usual/:id'), async (c) => ({ json: await mine(c).setUsual(c.id, { store: read.maybeText(c.body, 'store'), size: read.maybeText(c.body, 'size') }) })],
    // Your shops.
    ['GET', at('/stores'), async (c) => ({ json: await mine(c).stores() })],
    ['POST', at('/stores'), async (c) => ({ status: 201, json: await mine(c).addStore({ name: read.text(c.body, 'name'), note: read.maybeText(c.body, 'note'), adjust_days: read.maybeWhole(c.body, 'adjust_days') }) })],
    ['PUT', at('/stores/:id'), async (c) => ({ json: await mine(c).updateStore(c.id, { name: read.text(c.body, 'name'), note: read.maybeText(c.body, 'note'), adjust_days: read.maybeWhole(c.body, 'adjust_days') }) })],
    ['DELETE', at('/stores/:id'), async (c) => ({ json: await mine(c).removeStore(c.id) })],
    // The order a shop's aisles run in, kept in the person's settings (an empty list forgets it).
    ['GET', at('/stores/:id/aisles'), async (c) => ({ json: { aisles: await mine(c).aisles(c.id) } })],
    ['PUT', at('/stores/:id/aisles'), async (c) => ({ json: await mine(c).setAisles(c.id, read.texts(c.body, 'aisles')) })],
    // Prices over time.
    ['GET', at('/trends'), async (c) => ({ json: { currency: (await mine(c).summary()).currency, trends: await mine(c).trends(), spending: await mine(c).spending() } })],
    ['GET', at('/prices/:id/history'), async (c) => ({ json: await mine(c).history(c.id) })],
    ['POST', at('/coupons'), async (c) => ({ status: 201, json: await mine(c).addCoupon(couponFrom(c.body)) })],
    ['PUT', at('/coupons/:id'), async (c) => ({ json: await mine(c).updateCoupon(c.id, couponFrom(c.body)) })],
    ['DELETE', at('/coupons/:id'), async (c) => ({ json: await mine(c).removeCoupon(c.id) })],
    ['POST', at('/coupons/:id/use'), async (c) => ({ json: await mine(c).useCoupon(c.id, read.yesNo(c.body, 'using')) })],
  ];
}
