/**
 * The addresses for plans and their photos (/api/plans). What they do is core/'s plans.ts; this reads what
 * was sent and passes it on.
 */
import { photoLibrary, plans, shopping, MAX_PHOTO_BYTES, PHOTO_SERVICE, type Db, type Fetcher, type Sealer } from '../../core/src/index.ts';
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

export type PhotoTools = { fetcher: Fetcher; sealer: Sealer };
const picture = (found: { type: string; bytes: Uint8Array }, keepFor: number) =>
  ({ body: Buffer.from(found.bytes), headers: { 'Content-Type': found.type, 'Cache-Control': `private, max-age=${keepFor}`, 'X-Content-Type-Options': 'nosniff' } });

export function planRoutes(db: Db, tools?: PhotoTools): Route[] {
  const mine = (c: Context) => plans(db, c.user.id, c.clock);
  const library = (c: Context) => photoLibrary(db, c.user.id, c.clock, tools);
  const described = async (c: Context) => ({ ...await library(c).status(), service: PHOTO_SERVICE });
  return [
    // ---------- a photo library of your own (Immich): off until connected ----------
    ['GET', /^\/api\/photos$/, async (c) => ({ json: await described(c) })],
    ['PUT', /^\/api\/photos$/, async (c) => (await library(c).connect({ url: read.text(c.body, 'url'), key: read.text(c.body, 'key') }), { json: await described(c) })],
    ['DELETE', /^\/api\/photos$/, async (c) => (await library(c).disconnect(), { json: await described(c) })],
    // The photos taken on a plan's days, to choose from, and each one's small picture.
    ['GET', at('/:id/library'), async (c) => {
      const plan = await mine(c).get(c.id);
      const linked = new Set<string>();
      for (const photo of plan.photos_list) if (photo.source === 'immich') { const p = await mine(c).photo(photo.id); if (p.source === 'immich') linked.add(p.asset_id); }
      return { json: (await library(c).taken(plan.start_day, plan.end_day)).map((photo) => ({ ...photo, linked: linked.has(photo.id) })) };
    }],
    ['GET', /^\/api\/photos\/thumb$/, async (c) => picture(await library(c).picture(c.query.get('id') ?? '', 'thumbnail'), 86_400)],
    ['POST', at('/:id/photos/linked'), async (c) => {
      const ids = read.texts(c.body, 'ids');
      if (ids.length === 0 || ids.length > 80) throw notUnderstood('ids');
      let plan = await mine(c).get(c.id);
      for (const id of ids) plan = await mine(c).linkPhoto(c.id, 'immich', id);
      return { status: 201, json: plan };
    }],

    ['GET', at(''), async (c) => ({ json: await mine(c).list() })],
    ['POST', at(''), async (c) => ({ status: 201, json: await mine(c).create(planFrom(c.body)) })],
    ['GET', at('/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('/:id'), async (c) => ({ json: await mine(c).update(c.id, planFrom(c.body)) })],
    ['DELETE', at('/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
    ['GET', at('/:id/cost'), async (c) => ({ json: await shopping(db, c.user.id, c.clock).planCost(c.id) })],
    ['POST', at('/:id/copy'), async (c) => ({ status: 201, json: await mine(c).copy(c.id, { name: read.maybeText(c.body, 'name'), start_day: read.text(c.body, 'start_day') }) })],

    ['POST', at('/:id/items'), async (c) => ({
      status: 201,
      json: await mine(c).addItem(c.id, { kind: read.text(c.body, 'kind'), ref_id: read.maybeWhole(c.body, 'ref_id'), label: read.maybeText(c.body, 'label'),
        quantity: read.maybeNumber(c.body, 'quantity'), note: read.maybeText(c.body, 'note'), day: read.maybeText(c.body, 'day'), meal: read.maybeText(c.body, 'meal'), servings: read.maybeNumber(c.body, 'servings') }),
    })],
    ['PUT', at('/items/:id'), async (c) => ({
      json: await mine(c).updateItem(c.id, {
        ...(sent(c.body, 'label') ? { label: read.maybeText(c.body, 'label') } : {}), ...(sent(c.body, 'quantity') ? { quantity: read.maybeNumber(c.body, 'quantity') } : {}),
        ...(sent(c.body, 'note') ? { note: read.maybeText(c.body, 'note') } : {}), ...(sent(c.body, 'done') ? { done: read.yesNo(c.body, 'done') } : {}),
        ...(sent(c.body, 'day') ? { day: read.maybeText(c.body, 'day'), meal: read.maybeText(c.body, 'meal'), servings: read.maybeNumber(c.body, 'servings') } : {}),
      }),
    })],
    ['DELETE', at('/items/:id'), async (c) => ({ json: await mine(c).removeItem(c.id) })],

    ['POST', at('/:id/photos'), async (c) => ({ status: 201, json: await mine(c).keepPhoto(c.id, pictureFrom(c.body), read.maybeText(c.body, 'caption')) })],
    ['GET', at('/photos/:id'), async (c) => {
      const photo = await mine(c).photo(c.id);
      // A kept photo is served from here; a linked one is fetched from its library now and passed straight on.
      return photo.source === 'kept' ? picture(photo, 604_800) : picture(await library(c).picture(photo.asset_id, 'preview'), 86_400);
    }],
    ['PUT', at('/photos/:id'), async (c) => ({ json: await mine(c).captionPhoto(c.id, read.maybeText(c.body, 'caption')) })],
    ['DELETE', at('/photos/:id'), async (c) => ({ json: await mine(c).removePhoto(c.id) })],
  ];
}
