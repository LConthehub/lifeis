/**
 * The addresses for the things you keep (/api/things) and the projects that use them (/api/projects).
 * What they do is core/'s inventory.ts and projects.ts; this only reads what was sent and passes it on.
 */
import { inventory, packing, pets, projects, upkeep, whatIsThis, MAX_PET_PHOTO, MAX_DOCUMENT, MAX_THING_PHOTO, STARTER_JOBS, type Db, type FieldInput, type FieldType, type JobInput } from '../../core/src/index.ts';
import { notUnderstood, queryNumber, read, Refusal, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

const fieldFrom = (body: Body): FieldInput => ({
  name: read.text(body, 'name'), type: read.text(body, 'type') as FieldType, unit: read.maybeText(body, 'unit'), choices: read.texts(body, 'choices'),
});

const itemFrom = (body: Body) => ({
  name: read.text(body, 'name'), quantity: read.maybeNumber(body, 'quantity'), unit: read.maybeText(body, 'unit'),
  place_id: read.maybeWhole(body, 'place_id'), low_at: read.maybeNumber(body, 'low_at'), note: read.maybeText(body, 'note'),
  values: read.record(body, 'values'),
  // Left out: left as they are.
  ...(sent(body, 'barcode') ? { barcode: read.maybeText(body, 'barcode') } : {}),
  ...(sent(body, 'activities') ? { activities: read.texts(body, 'activities') } : {}),
  ...(sent(body, 'records') ? { records: recordsFrom(read.record(body, 'records')) } : {}),
});

/** A thing's home records as sent: only the fields that were sent, so the rest are left as they are. */
function recordsFrom(r: Body) {
  return {
    ...(sent(r, 'bought_on') ? { bought_on: read.maybeText(r, 'bought_on') } : {}),
    ...(sent(r, 'bought_at') ? { bought_at: read.maybeText(r, 'bought_at') } : {}),
    ...(sent(r, 'price_cents') ? { price_cents: read.maybeWhole(r, 'price_cents') } : {}),
    ...(sent(r, 'value_cents') ? { value_cents: read.maybeWhole(r, 'value_cents') } : {}),
    ...(sent(r, 'serial') ? { serial: read.maybeText(r, 'serial') } : {}),
    ...(sent(r, 'model') ? { model: read.maybeText(r, 'model') } : {}),
    ...(sent(r, 'warranty_until') ? { warranty_until: read.maybeText(r, 'warranty_until') } : {}),
  };
}

/** A photo or a paper sent as base64 text (the "data" field), as the pages send them. */
function photoFrom(body: Body, most = MAX_THING_PHOTO): Uint8Array {
  const text = read.text(body, 'data');
  if (text.length > most * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Refusal(400, 'That photo is too large to keep, or was damaged on the way');
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

const placeFrom = (body: Body) => ({ name: read.text(body, 'name'), parent_id: read.maybeWhole(body, 'parent_id'), note: read.maybeText(body, 'note') });

const projectFrom = (body: Body) => ({
  name: read.text(body, 'name'), activity: read.maybeText(body, 'activity'), status: read.maybeText(body, 'status'),
  notes: read.maybeText(body, 'notes'), due_on: read.maybeText(body, 'due_on'),
});

const lineFrom = (body: Body) => ({
  item_id: read.maybeWhole(body, 'item_id'), label: read.maybeText(body, 'label'), quantity: read.maybeNumber(body, 'quantity'),
  unit: read.maybeText(body, 'unit'), note: read.maybeText(body, 'note'),
});

const costFrom = (body: Body) => ({
  ...(sent(body, 'label') ? { label: read.maybeText(body, 'label') } : {}),
  ...(sent(body, 'planned_cents') ? { planned_cents: read.maybeNumber(body, 'planned_cents') } : {}),
  ...(sent(body, 'actual_cents') ? { actual_cents: read.maybeNumber(body, 'actual_cents') } : {}),
  ...(sent(body, 'note') ? { note: read.maybeText(body, 'note') } : {}),
});

/** An upkeep job as sent. Tools and supplies left out are left as they are. */
function jobFrom(body: Body): JobInput {
  const supplies = sent(body, 'supplies') ? body.supplies : undefined;
  if (supplies !== undefined && !(Array.isArray(supplies) && supplies.every((x) => x && typeof x === 'object' && !Array.isArray(x)))) throw notUnderstood('supplies');
  const tools = sent(body, 'tools') ? body.tools : undefined;
  if (tools !== undefined && !(Array.isArray(tools) && tools.every((id) => Number.isInteger(id) && (id as number) > 0))) throw notUnderstood('tools');
  const last = sent(body, 'last_done') && body.last_done !== null ? read.record(body, 'last_done') : null;
  return {
    name: read.text(body, 'name'), activity: read.maybeText(body, 'activity'), item_id: read.maybeWhole(body, 'item_id'),
    every_n: read.maybeWhole(body, 'every_n'), every_unit: read.maybeText(body, 'every_unit'),
    every_reading: read.maybeNumber(body, 'every_reading'), reading_unit: read.maybeText(body, 'reading_unit'),
    first_due: read.maybeText(body, 'first_due'), assigned_to: read.maybeWhole(body, 'assigned_to'),
    steps: read.maybeText(body, 'steps'), note: read.maybeText(body, 'note'),
    ...(sent(body, 'kind') ? { kind: read.maybeText(body, 'kind') } : {}),
    ...(sent(body, 'amount_cents') ? { amount_cents: read.maybeWhole(body, 'amount_cents') } : {}),
    ...(sent(body, 'points') ? { points: read.maybeWhole(body, 'points') } : {}),
    ...(sent(body, 'autopay') ? { autopay: read.yesNo(body, 'autopay') } : {}),
    ...(sent(body, 'pet_id') ? { pet_id: read.maybeWhole(body, 'pet_id') } : {}),
    ...(tools !== undefined ? { tools: tools as number[] } : {}),
    ...(supplies !== undefined ? { supplies: (supplies as Body[]).map((x) => ({ item_id: read.maybeWhole(x, 'item_id') ?? 0, quantity: read.maybeNumber(x, 'quantity'), unit: read.maybeText(x, 'unit') })) } : {}),
    ...(last ? { last_done: { day: read.text(last, 'day'), reading: read.maybeNumber(last, 'reading') } } : {}),
  };
}

/** Whether a field was sent at all: left out means "leave it as it is", where null means "clear it". */
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

export function makingRoutes(db: Db): Route[] {
  const things = (c: Context) => inventory(db, c.user.id, c.clock);
  const making = (c: Context) => projects(db, c.user.id, c.clock);
  const jobs = (c: Context) => upkeep(db, c.user.id, c.clock);
  const animals = (c: Context) => pets(db, c.user.id, c.clock);
  const boxes = (c: Context) => packing(db, c.user.id, c.clock);
  const petFrom = (body: Body) => ({
    name: read.text(body, 'name'), species: read.maybeText(body, 'species'), breed: read.maybeText(body, 'breed'), born_on: read.maybeText(body, 'born_on'),
    microchip: read.maybeText(body, 'microchip'), vet_name: read.maybeText(body, 'vet_name'), vet_phone: read.maybeText(body, 'vet_phone'),
    food: read.maybeText(body, 'food'), note: read.maybeText(body, 'note'),
  });

  return [
    // ==================== THE THINGS YOU KEEP ====================

    ['GET', at('things/kinds'), async (c) => ({ json: await things(c).listKinds() })],
    ['POST', at('things/kinds'), async (c) => ({
      status: 201,
      json: await things(c).createKind({
        name: read.text(c.body, 'name'), icon: read.maybeText(c.body, 'icon'), unit: read.maybeText(c.body, 'unit'),
        fields: read.records(c.body, 'fields').map(fieldFrom),
      }),
    })],
    ['PUT', at('things/kinds/:id'), async (c) => ({
      json: await things(c).updateKind(c.id, {
        name: read.maybeText(c.body, 'name'),
        ...(sent(c.body, 'icon') ? { icon: read.maybeText(c.body, 'icon') } : {}),
        ...(sent(c.body, 'unit') ? { unit: read.maybeText(c.body, 'unit') } : {}),
      }),
    })],
    ['DELETE', at('things/kinds/:id'), async (c) => ({ json: await things(c).deleteKind(c.id) })],
    ['POST', at('things/kinds/:id/fields'), async (c) => ({ status: 201, json: await things(c).addField(c.id, fieldFrom(c.body)) })],
    ['PUT', at('things/fields/:id'), async (c) => ({
      json: await things(c).updateField(c.id, {
        name: read.maybeText(c.body, 'name'),
        ...(sent(c.body, 'unit') ? { unit: read.maybeText(c.body, 'unit') } : {}),
        ...(sent(c.body, 'choices') ? { choices: read.texts(c.body, 'choices') } : {}),
        sort_order: read.maybeWhole(c.body, 'sort_order'),
      }),
    })],
    ['DELETE', at('things/fields/:id'), async (c) => ({ json: await things(c).deleteField(c.id) })],

    ['GET', at('things/starters'), async (c) => ({ json: await things(c).listStarters() })],
    ['POST', at('things/starters'), async (c) => ({ json: await things(c).addStarter(read.text(c.body, 'slug')) })],

    ['GET', at('things/places'), async (c) => ({ json: await things(c).listPlaces() })],
    ['GET', at('things/places/stickers'), async (c) => ({ json: await things(c).stickers() })],
    ['GET', at('things/places/sticker'), async (c) => ({ json: await things(c).placeForSticker(c.query.get('code') ?? '') })],
    ['POST', at('things/places'), async (c) => ({ status: 201, json: await things(c).createPlace(placeFrom(c.body)) })],
    ['PUT', at('things/places/:id'), async (c) => ({ json: await things(c).updatePlace(c.id, placeFrom(c.body)) })],
    ['DELETE', at('things/places/:id'), async (c) => ({ json: await things(c).deletePlace(c.id) })],

    ['GET', at('things/items'), async (c) => {
      const q = c.query.get('q');
      if ((q?.length ?? 0) > 100) throw notUnderstood('q');
      return {
        json: await things(c).listItems({
          kind_id: queryNumber(c.query, 'kind_id'), place_id: queryNumber(c.query, 'place_id'), q, low: c.query.get('low') === '1',
        }),
      };
    }],
    ['POST', at('things/items'), async (c) => {
      const kind = read.maybeWhole(c.body, 'kind_id');
      if (kind === null) throw notUnderstood('kind_id');
      return { status: 201, json: await things(c).createItem({ kind_id: kind, ...itemFrom(c.body), code: read.maybeText(c.body, 'code') }) };
    }],
    // What a scan is: a place, a thing, copies in the collection, a blank sticker, or unknown. See core/'s whereabouts.ts.
    ['GET', at('things/scan'), async (c) => {
      const code = c.query.get('code') ?? '';
      if (code.length > 300) throw notUnderstood('code');
      return { json: await whatIsThis(db, c.user.id, code, c.clock) };
    }],
    ['GET', at('things/activities'), async (c) => ({ json: await things(c).listActivities() })],
    ['GET', at('things/activity'), async (c) => {
      const name = c.query.get('name') ?? '';
      if (!name.trim() || name.length > 60) throw notUnderstood('name');
      return { json: await things(c).activity(name) };
    }],
    ['POST', at('things/stickers'), async (c) => {
      const ids = Array.isArray(c.body.ids) ? c.body.ids : null;
      if (!ids || !ids.every((id) => Number.isInteger(id) && (id as number) > 0)) throw notUnderstood('ids');
      return { json: await things(c).thingStickers(ids as number[]) };
    }],
    ['GET', at('things/stickers/blank'), async (c) => ({ json: await things(c).blankCodes(queryNumber(c.query, 'count') ?? 30) })],
    ['POST', at('things/items/:id/move'), async (c) => ({ json: await things(c).moveItem(c.id, read.maybeWhole(c.body, 'place_id'), read.maybeText(c.body, 'note')) })],
    ['GET', at('things/items/:id/history'), async (c) => ({ json: await things(c).itemHistory(c.id) })],
    ['POST', at('things/items/:id/uses'), async (c) => ({
      status: 201,
      json: await things(c).logUse(c.id, { day: read.maybeText(c.body, 'day'), project_id: read.maybeWhole(c.body, 'project_id'), activity: read.maybeText(c.body, 'activity'), note: read.maybeText(c.body, 'note') }),
    })],
    // Home records: a thing's papers, and the whole home inventory.
    ['GET', at('things/report'), async (c) => ({ json: await things(c).homeReport() })],
    ['GET', at('things/items/:id/documents'), async (c) => ({ json: await things(c).documents(c.id) })],
    ['POST', at('things/items/:id/documents'), async (c) => ({
      status: 201,
      json: await things(c).addDocument(c.id, { kind: read.text(c.body, 'kind'), name: read.maybeText(c.body, 'name') ?? '', bytes: photoFrom(c.body, MAX_DOCUMENT) }),
    })],
    ['GET', at('things/documents/:id'), async (c) => {
      const paper = await things(c).document(c.id);
      if (!paper) return { status: 404, json: { detail: 'Not found' } };
      // Shown, not run: a PDF opens in the browser's own reader, and nothing in it can act as Life Is.
      return { body: paper.bytes, headers: { 'Content-Type': paper.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `inline; filename="${paper.name.replace(/[^\w. -]/g, '_')}"` } };
    }],
    ['DELETE', at('things/documents/:id'), async (c) => (await things(c).removeDocument(c.id), { status: 204 })],
    ['PUT', at('things/items/:id/photo'), async (c) => ({ json: await things(c).setPhoto(c.id, photoFrom(c.body)) })],
    ['DELETE', at('things/items/:id/photo'), async (c) => ({ json: await things(c).removePhoto(c.id) })],
    ['GET', at('things/items/:id/photo'), async (c) => {
      const photo = await things(c).photo(c.id);
      if (!photo) return { status: 404, json: { detail: 'Not found' } };
      // The person's own picture: their browser may keep it for a while, nothing in between may.
      return { body: photo.bytes, headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } };
    }],
    ['GET', at('things/items/:id'), async (c) => ({ json: await things(c).getItem(c.id) })],
    ['PUT', at('things/items/:id'), async (c) => ({ json: await things(c).updateItem(c.id, itemFrom(c.body)) })],
    ['DELETE', at('things/items/:id'), async (c) => (await things(c).deleteItem(c.id), { status: 204 })],

    // ==================== UPKEEP ====================
    // Jobs that come round again. See core/'s upkeep.ts.

    ['GET', at('things/upkeep'), async (c) => ({ json: await jobs(c).list() })],
    ['GET', at('things/upkeep/people'), async (c) => ({ json: await jobs(c).people() })],
    ['GET', at('things/upkeep/scores'), async (c) => ({ json: await jobs(c).scores() })],
    ['GET', at('things/upkeep/starters'), async () => ({ json: STARTER_JOBS })],
    ['POST', at('things/upkeep'), async (c) => ({ status: 201, json: await jobs(c).create(jobFrom(c.body)) })],
    ['GET', at('things/upkeep/:id'), async (c) => ({ json: await jobs(c).get(c.id) })],
    ['PUT', at('things/upkeep/:id'), async (c) => ({ json: await jobs(c).update(c.id, jobFrom(c.body)) })],
    ['DELETE', at('things/upkeep/:id'), async (c) => (await jobs(c).remove(c.id), { status: 204 })],
    ['POST', at('things/upkeep/:id/done'), async (c) => {
      const spend = sent(c.body, 'spend') && c.body.spend !== null ? read.record(c.body, 'spend') : null;
      return {
        status: 201,
        json: await jobs(c).done(c.id, {
          day: read.maybeText(c.body, 'day'), reading: read.maybeNumber(c.body, 'reading'), minutes: read.maybeWhole(c.body, 'minutes'),
          cost_cents: read.maybeWhole(c.body, 'cost_cents'), note: read.maybeText(c.body, 'note'),
          spend: spend ? { category_id: read.maybeWhole(spend, 'category_id') } : null,
        }),
      };
    }],
    ['POST', at('things/upkeep/:id/reading'), async (c) => {
      const value = read.maybeNumber(c.body, 'value');
      if (value === null) throw notUnderstood('value');
      return { json: await jobs(c).reading(c.id, value, read.maybeText(c.body, 'day')) };
    }],
    ['DELETE', at('things/upkeep/done/:id'), async (c) => ({ json: await jobs(c).undo(c.id) })],

    // ==================== PACKING ====================
    // Boxes for moving or putting away: places that say how far along they are. See core/'s packing.ts.

    ['GET', at('things/packing'), async (c) => ({ json: await boxes(c).list() })],
    ['POST', at('things/packing/boxes'), async (c) => {
      const count = read.maybeWhole(c.body, 'count');
      if (count === null) throw notUnderstood('count');
      return { status: 201, json: await boxes(c).makeBoxes({ count, destination: read.maybeText(c.body, 'destination'), parent_id: read.maybeWhole(c.body, 'parent_id') }) };
    }],
    ['PUT', at('things/packing/boxes/:id'), async (c) => ({
      json: await boxes(c).setBox(c.id, { state: read.maybeText(c.body, 'state'), ...(sent(c.body, 'destination') ? { destination: read.maybeText(c.body, 'destination') } : {}) }),
    })],
    ['DELETE', at('things/packing/boxes/:id'), async (c) => ({ json: await boxes(c).notABox(c.id) })],
    ['POST', at('things/packing/boxes/:id/unpack'), async (c) => {
      const to = read.maybeWhole(c.body, 'place_id');
      if (to === null) throw notUnderstood('place_id');
      return { json: await boxes(c).unpack(c.id, to) };
    }],

    // ==================== PETS ====================
    // Who they are, how their weight goes, and their care (upkeep that is theirs). See core/'s pets.ts.

    ['GET', at('things/pets'), async (c) => ({ json: await animals(c).list() })],
    ['POST', at('things/pets'), async (c) => ({ status: 201, json: await animals(c).create(petFrom(c.body)) })],
    ['GET', at('things/pets/:id'), async (c) => ({ json: await animals(c).get(c.id) })],
    ['PUT', at('things/pets/:id'), async (c) => ({ json: await animals(c).update(c.id, petFrom(c.body)) })],
    ['DELETE', at('things/pets/:id'), async (c) => (await animals(c).remove(c.id), { status: 204 })],
    ['GET', at('things/pets/:id/care'), async (c) => ({ json: await animals(c).careOffered(c.id) })],
    ['POST', at('things/pets/:id/care'), async (c) => ({
      status: 201,
      json: await animals(c).addCare(c.id, {
        name: read.text(c.body, 'name'), every_n: read.maybeWhole(c.body, 'every_n'), every_unit: read.maybeText(c.body, 'every_unit'),
        kind: read.maybeText(c.body, 'kind'), last_done: read.maybeText(c.body, 'last_done'), first_due: read.maybeText(c.body, 'first_due'),
      }),
    })],
    ['POST', at('things/pets/:id/weights'), async (c) => {
      const value = read.maybeNumber(c.body, 'value');
      if (value === null) throw notUnderstood('value');
      return { status: 201, json: await animals(c).addWeight(c.id, { value, unit: read.text(c.body, 'unit'), day: read.maybeText(c.body, 'day') }) };
    }],
    ['DELETE', at('things/pets/weights/:id'), async (c) => (await animals(c).removeWeight(c.id), { status: 204 })],
    ['PUT', at('things/pets/:id/photo'), async (c) => ({ json: await animals(c).setPhoto(c.id, photoFrom(c.body, MAX_PET_PHOTO)) })],
    ['DELETE', at('things/pets/:id/photo'), async (c) => ({ json: await animals(c).removePhoto(c.id) })],
    ['GET', at('things/pets/:id/photo'), async (c) => {
      const photo = await animals(c).photo(c.id);
      if (!photo) return { status: 404, json: { detail: 'Not found' } };
      return { body: photo.bytes, headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } };
    }],

    // ==================== PROJECTS ====================

    ['GET', at('projects'), async (c) => ({ json: await making(c).listProjects({ status: c.query.get('status'), activity: c.query.get('activity') }) })],
    ['POST', at('projects'), async (c) => ({ status: 201, json: await making(c).createProject(projectFrom(c.body)) })],
    ['GET', at('projects/activities'), async (c) => ({ json: await making(c).listActivities() })],
    ['GET', at('projects/sessions'), async (c) => {
      const start = c.query.get('start');
      const end = c.query.get('end');
      if (!start) throw notUnderstood('start');
      if (!end) throw notUnderstood('end');
      return { json: await making(c).sessionsBetween(start, end) };
    }],
    ['GET', at('projects/:id'), async (c) => ({ json: await making(c).getProject(c.id) })],
    ['PUT', at('projects/:id'), async (c) => ({ json: await making(c).updateProject(c.id, projectFrom(c.body)) })],
    ['DELETE', at('projects/:id'), async (c) => (await making(c).deleteProject(c.id), { status: 204 })],

    ['POST', at('projects/:id/lines'), async (c) => ({ status: 201, json: await making(c).addLine(c.id, lineFrom(c.body)) })],
    ['PUT', at('projects/lines/:id'), async (c) => ({ json: await making(c).updateLine(c.id, lineFrom(c.body)) })],
    ['DELETE', at('projects/lines/:id'), async (c) => ({ json: await making(c).removeLine(c.id) })],
    // What it costs: planned, and once paid, what it came to.
    ['POST', at('projects/:id/costs'), async (c) => ({ status: 201, json: await making(c).addCost(c.id, costFrom(c.body)) })],
    ['PUT', at('projects/costs/:id'), async (c) => ({ json: await making(c).updateCost(c.id, costFrom(c.body)) })],
    ['DELETE', at('projects/costs/:id'), async (c) => ({ json: await making(c).removeCost(c.id) })],
    ['POST', at('projects/costs/:id/pay'), async (c) => ({ json: await making(c).payCost(c.id, read.maybeNumber(c.body, 'actual_cents')) })],
    ['POST', at('projects/costs/:id/unpay'), async (c) => ({ json: await making(c).unpayCost(c.id) })],
    ['POST', at('projects/lines/:id/use'), async (c) => ({ json: await making(c).useLine(c.id) })],

    ['POST', at('projects/:id/sessions'), async (c) => ({
      status: 201,
      json: await making(c).addSession(c.id, {
        day: read.text(c.body, 'day'), minutes: read.maybeWhole(c.body, 'minutes'), note: read.maybeText(c.body, 'note'), media_ids: read.wholes(c.body, 'media_ids'),
      }),
    })],
    ['DELETE', at('projects/sessions/:id'), async (c) => (await making(c).deleteSession(c.id), { status: 204 })],
  ];
}
