/**
 * The addresses for the things you keep (/api/things) and the projects that use them (/api/projects).
 * What they do is core/'s inventory.ts and projects.ts; this only reads what was sent and passes it on.
 */
import { inventory, projects, type Db, type FieldInput, type FieldType } from '../../core/src/index.ts';
import type * as auth from './auth.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

const fieldFrom = (body: Body): FieldInput => ({
  name: read.text(body, 'name'), type: read.text(body, 'type') as FieldType, unit: read.maybeText(body, 'unit'), choices: read.texts(body, 'choices'),
});

const itemFrom = (body: Body) => ({
  name: read.text(body, 'name'), quantity: read.maybeNumber(body, 'quantity'), unit: read.maybeText(body, 'unit'),
  place_id: read.maybeWhole(body, 'place_id'), low_at: read.maybeNumber(body, 'low_at'), note: read.maybeText(body, 'note'),
  values: read.record(body, 'values'),
});

const placeFrom = (body: Body) => ({ name: read.text(body, 'name'), parent_id: read.maybeWhole(body, 'parent_id'), note: read.maybeText(body, 'note') });

const projectFrom = (body: Body) => ({
  name: read.text(body, 'name'), activity: read.maybeText(body, 'activity'), status: read.maybeText(body, 'status'),
  notes: read.maybeText(body, 'notes'), due_on: read.maybeText(body, 'due_on'),
});

const lineFrom = (body: Body) => ({
  item_id: read.maybeWhole(body, 'item_id'), label: read.maybeText(body, 'label'), quantity: read.maybeNumber(body, 'quantity'),
  unit: read.maybeText(body, 'unit'), note: read.maybeText(body, 'note'),
});

/** Whether a field was sent at all: left out means "leave it as it is", where null means "clear it". */
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

export function makingRoutes(db: Db, clock: auth.Clock): Route[] {
  const things = (c: Context) => inventory(db, c.user.id, clock);
  const making = (c: Context) => projects(db, c.user.id, clock);

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
      return { status: 201, json: await things(c).createItem({ kind_id: kind, ...itemFrom(c.body) }) };
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
