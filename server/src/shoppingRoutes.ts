/**
 * The addresses for prices, the running total and coupons (/api/shopping). What they do is core/'s
 * shopping.ts; this reads what was sent and passes it on. Money is always whole cents.
 */
import { shopping, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Context, type Route } from './http.ts';

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
      return { json: await mine(c).setPrice(c.id, read.maybeWhole(c.body, 'cents'), read.yesNo(c.body, 'assumed', false)) };
    }],
    ['GET', at('/prices/:id/history'), async (c) => ({ json: await mine(c).history(c.id) })],
    ['POST', at('/coupons'), async (c) => ({ status: 201, json: await mine(c).addCoupon(couponFrom(c.body)) })],
    ['PUT', at('/coupons/:id'), async (c) => ({ json: await mine(c).updateCoupon(c.id, couponFrom(c.body)) })],
    ['DELETE', at('/coupons/:id'), async (c) => ({ json: await mine(c).removeCoupon(c.id) })],
    ['POST', at('/coupons/:id/use'), async (c) => ({ json: await mine(c).useCoupon(c.id, read.yesNo(c.body, 'using')) })],
  ];
}
