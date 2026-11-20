/**
 * The addresses for plans and their photos (/api/plans). What they do is core/'s plans.ts; this reads what
 * was sent and passes it on.
 */
import { plans, MAX_PHOTO_BYTES, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, Refusal, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/plans${path.replaceAll(':id', ID)}$`);

const planFrom = (body: Body) => ({
  name: read.text(body, 'name'), start_day: read.text(body, 'start_day'), end_day: read.maybeText(body, 'end_day'),
  note: read.maybeText(body, 'note'), story: read.maybeText(body, 'story'),
});
/** Whether a field was sent at all: left out means "leave it as it is". */
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

/** A picture sent as base64 text inside the request, turned back into its bytes. */
function pictureFrom(body: Body): Uint8Array {
  const text = read.text(body, 'data');
  if (text.length > MAX_PHOTO_BYTES * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Refusal(400, 'That photo is too large to keep, or was damaged on the way');
  return new Uint8Array(Buffer.from(text, 'base64'));
}

export function planRoutes(db: Db): Route[] {
  const mine = (c: Context) => plans(db, c.user.id, c.clock);
  return [
    ['GET', at(''), async (c) => ({ json: await mine(c).list() })],
    ['POST', at(''), async (c) => ({ status: 201, json: await mine(c).create(planFrom(c.body)) })],
    ['GET', at('/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('/:id'), async (c) => ({ json: await mine(c).update(c.id, planFrom(c.body)) })],
    ['DELETE', at('/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
    ['POST', at('/:id/copy'), async (c) => ({ status: 201, json: await mine(c).copy(c.id, { name: read.maybeText(c.body, 'name'), start_day: read.text(c.body, 'start_day') }) })],

    ['POST', at('/:id/items'), async (c) => ({
      status: 201,
      json: await mine(c).addItem(c.id, { kind: read.text(c.body, 'kind'), ref_id: read.maybeWhole(c.body, 'ref_id'), label: read.maybeText(c.body, 'label'),
        quantity: read.maybeNumber(c.body, 'quantity'), note: read.maybeText(c.body, 'note') }),
    })],
    ['PUT', at('/items/:id'), async (c) => ({
      json: await mine(c).updateItem(c.id, {
        ...(sent(c.body, 'label') ? { label: read.maybeText(c.body, 'label') } : {}), ...(sent(c.body, 'quantity') ? { quantity: read.maybeNumber(c.body, 'quantity') } : {}),
        ...(sent(c.body, 'note') ? { note: read.maybeText(c.body, 'note') } : {}), ...(sent(c.body, 'done') ? { done: read.yesNo(c.body, 'done') } : {}),
      }),
    })],
    ['DELETE', at('/items/:id'), async (c) => ({ json: await mine(c).removeItem(c.id) })],

    ['POST', at('/:id/photos'), async (c) => ({ status: 201, json: await mine(c).keepPhoto(c.id, pictureFrom(c.body), read.maybeText(c.body, 'caption')) })],
    ['GET', at('/photos/:id'), async (c) => {
      const photo = await mine(c).photo(c.id);
      // A linked photo is fetched from its library by the photo routes; this address only serves the kept ones.
      if (photo.source !== 'kept') throw notUnderstood('photo');
      return { body: Buffer.from(photo.bytes), headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' } };
    }],
    ['PUT', at('/photos/:id'), async (c) => ({ json: await mine(c).captionPhoto(c.id, read.maybeText(c.body, 'caption')) })],
    ['DELETE', at('/photos/:id'), async (c) => ({ json: await mine(c).removePhoto(c.id) })],
  ];
}
