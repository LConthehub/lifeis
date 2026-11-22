/**
 * The addresses for the things you keep (/api/things) and the projects that use them (/api/projects).
 * What they do is core/'s inventory.ts and projects.ts; this only reads what was sent and passes it on.
 */
import { inventory, projects, whatIsThis, MAX_THING_PHOTO, type Db, type FieldInput, type FieldType } from '../../core/src/index.ts';
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
});

/** A photo sent as base64 text (the "data" field), as the pages send them. */
function photoFrom(body: Body): Uint8Array {
  const text = read.text(body, 'data');
  if (text.length > MAX_THING_PHOTO * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Refusal(400, 'That photo is too large to keep, or was damaged on the way');
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

/** Whether a field was sent at all: left out means "leave it as it is", where null means "clear it". */
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

export function makingRoutes(db: Db): Route[] {
  const things = (c: Context) => inventory(db, c.user.id, c.clock);
  const making = (c: Context) => projects(db, c.user.id, c.clock);

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
