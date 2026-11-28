/**
 * The addresses for the garden (/api/garden): plants kept in places, watering, planting times, harvests and photos.
 * What they do is core/'s garden.ts; this reads what was sent and passes it on.
 */
import { garden, photoLibrary, weather, WEATHER_SERVICE, type Db, type Fetcher, type PlantInput } from '../../core/src/index.ts';
import { read, queryNumber, type Body, type Context, type Route } from './http.ts';
import { pictureFrom, type PhotoTools } from './planRoutes.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/garden${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);
const picture = (found: { type: string; bytes: Uint8Array }, keepFor: number) =>
  ({ body: found.bytes, headers: { 'Content-Type': found.type, 'Cache-Control': `private, max-age=${keepFor}`, 'X-Content-Type-Options': 'nosniff' } });

/** A plant as a page sent it. A field left out is left as it is (or, on a new plant, the usual). */
function plantFrom(body: Body): PlantInput {
  const input: PlantInput = { name: read.text(body, 'name') };
  if (sent(body, 'kind')) input.kind = read.maybeText(body, 'kind');
  if (sent(body, 'crop')) input.crop = read.maybeText(body, 'crop');
  if (sent(body, 'place_id')) input.place_id = read.maybeWhole(body, 'place_id');
  if (sent(body, 'outdoor')) input.outdoor = read.yesNo(body, 'outdoor');
  if (sent(body, 'planted_on')) input.planted_on = read.maybeText(body, 'planted_on');
  if (sent(body, 'water_every')) input.water_every = read.maybeWhole(body, 'water_every');
  if (sent(body, 'assigned_member')) input.assigned_member = read.maybeWhole(body, 'assigned_member');
  if (sent(body, 'points')) input.points = read.maybeWhole(body, 'points');
  if (sent(body, 'note')) input.note = read.maybeText(body, 'note');
  return input;
}

export function gardenRoutes(db: Db, options: { fetcher?: Fetcher; photos?: PhotoTools } = {}): Route[] {
  const mine = (c: Context) => garden(db, c.user.id, c.clock, { fetcher: options.fetcher });
  const library = (c: Context) => photoLibrary(db, c.user.id, c.clock, options.photos);
  return [
    // Everything the garden page needs in one answer.
    ['GET', at(''), async (c) => {
      const g = mine(c);
      const place = await weather(db, c.user.id, c.clock, options.fetcher).place();
      return { json: {
        plants: await g.list(), seeds: await g.seeds(), frost: await g.frost(), crops: g.crops(), kinds: g.kinds, harvests: await g.harvests(queryNumber(c.query, 'year')),
        weather: { on: place !== null, available: Boolean(options.fetcher), place: place?.name ?? null, service: WEATHER_SERVICE },
        photos: Boolean(options.photos),
      } };
    }],
    ['GET', at('/card'), async (c) => ({ json: await mine(c).card() })],
    ['PUT', at('/frost'), async (c) => ({ json: await mine(c).setFrost({ last_spring: read.maybeText(c.body, 'last_spring'), first_fall: read.maybeText(c.body, 'first_fall') }) })],
    ['POST', at('/frost/work-out'), async (c) => ({ json: await mine(c).workOutFrost() })],
    ['POST', at('/seeds'), async (c) => ({ status: 201, json: await mine(c).addSeeds({ name: read.text(c.body, 'name'), place_id: read.maybeWhole(c.body, 'place_id'), quantity: read.maybeNumber(c.body, 'quantity'), note: read.maybeText(c.body, 'note') }) })],
    ['GET', at('/harvests'), async (c) => ({ json: await mine(c).harvests(queryNumber(c.query, 'year')) })],
    ['DELETE', at('/harvests/:id'), async (c) => ({ json: await mine(c).removeHarvest(c.id) })],

    ['POST', at('/plants'), async (c) => ({ status: 201, json: await mine(c).addPlant(plantFrom(c.body)) })],
    ['GET', at('/plants/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('/plants/:id'), async (c) => ({ json: await mine(c).updatePlant(c.id, plantFrom(c.body)) })],
    ['DELETE', at('/plants/:id'), async (c) => { await mine(c).removePlant(c.id); return { json: { removed: true } }; }],
    // One tap: watered. A child can be credited, and earns the points the chore carries.
    ['POST', at('/plants/:id/water'), async (c) => ({ json: await mine(c).water(c.id, { by_member: read.maybeWhole(c.body, 'by_member'), day: read.maybeText(c.body, 'day') }) })],
    ['POST', at('/plants/:id/planted'), async (c) => ({ json: await mine(c).planted(c.id, read.maybeText(c.body, 'day')) })],
    ['PUT', at('/plants/:id/how-it-did'), async (c) => ({ json: await mine(c).howItDid(c.id, read.maybeText(c.body, 'text')) })],
    ['POST', at('/plants/:id/harvests'), async (c) => ({ status: 201, json: await mine(c).harvest(c.id, {
      day: read.maybeText(c.body, 'day'), amount: read.maybeNumber(c.body, 'amount'), unit: read.maybeText(c.body, 'unit'), note: read.maybeText(c.body, 'note'),
      pantry: sent(c.body, 'pantry') ? read.yesNo(c.body, 'pantry') : false }) })],

    // Photos: kept here, or linked from a photo library, as a plan's are.
    ['POST', at('/plants/:id/photos'), async (c) => ({ status: 201, json: await mine(c).keepPhoto(c.id, pictureFrom(c.body), read.maybeText(c.body, 'caption')) })],
    ['POST', at('/plants/:id/photos/linked'), async (c) => {
      const ids = read.texts(c.body, 'ids');
      let plant = await mine(c).get(c.id);
      for (const id of ids.slice(0, 40)) plant = await mine(c).linkPhoto(c.id, id);
      return { status: 201, json: plant };
    }],
    // The library's photos taken between two days (the last two months when none are said), to choose from.
    ['GET', at('/plants/:id/library'), async (c) => {
      const plant = await mine(c).get(c.id);
      const to = c.query.get('to') || new Date(c.clock().getTime()).toISOString().slice(0, 10);
      const from = c.query.get('from') || plant.planted_on || new Date(c.clock().getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
      const linked = new Set<string>();
      for (const photo of plant.photos_list) if (photo.source === 'immich') { const p = await mine(c).photo(photo.id); if (p.source === 'immich') linked.add(p.asset_id); }
      return { json: (await library(c).taken(from, to)).map((photo) => ({ ...photo, linked: linked.has(photo.id) })) };
    }],
    ['GET', at('/photos/:id'), async (c) => {
      const photo = await mine(c).photo(c.id);
      return photo.source === 'kept' ? picture(photo, 604_800) : picture(await library(c).picture(photo.asset_id, 'preview'), 86_400);
    }],
    ['PUT', at('/photos/:id'), async (c) => ({ json: await mine(c).captionPhoto(c.id, read.maybeText(c.body, 'caption')) })],
    ['DELETE', at('/photos/:id'), async (c) => ({ json: await mine(c).removePhoto(c.id) })],
  ];
}
