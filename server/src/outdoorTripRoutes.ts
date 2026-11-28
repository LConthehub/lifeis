/**
 * The addresses for outdoor trips (/api/plans/trips): a trip is a plan that comes back each year, so these sit
 * under plans, beside holidays. What they do is core/'s outdoorTrips.ts; this reads what was sent and passes it on.
 */
import { outdoorTrips, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/plans/trips${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);
/** A field that was sent, even if empty (so it can be cleared); left out means leave it. */
const maybe = <T>(body: Body, name: string, get: () => T) => (sent(body, name) ? { [name]: get() } : {});
const yes = (body: Body, name: string) => (sent(body, name) ? { [name]: read.yesNo(body, name) } : {});

export function outdoorTripRoutes(db: Db): Route[] {
  const mine = (c: Context) => outdoorTrips(db, c.user.id, c.clock);
  return [
    ['GET', at(''), async (c) => ({ json: await mine(c).list() })],
    ['POST', at(''), async (c) => ({
      status: 201,
      json: await mine(c).create({ name: read.text(c.body, 'name'), parts: read.texts(c.body, 'parts'), private: read.yesNo(c.body, 'private', false), day: read.maybeText(c.body, 'day'), end_day: read.maybeText(c.body, 'end_day') }),
    })],
    ['GET', at('/options'), async (c) => ({ json: await mine(c).options() })],
    ['GET', at('/shared'), async (c) => ({ json: await mine(c).shared() })],
    ['GET', at('/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('/:id'), async (c) => ({
      json: await mine(c).update(c.id, {
        ...(sent(c.body, 'name') ? { name: read.maybeText(c.body, 'name') } : {}), ...(sent(c.body, 'parts') ? { parts: read.texts(c.body, 'parts') } : {}), ...yes(c.body, 'private'),
      }),
    })],
    ['DELETE', at('/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
    ['POST', at('/:id/years'), async (c) => ({ status: 201, json: await mine(c).startYear(c.id, { day: read.maybeText(c.body, 'day'), end_day: read.maybeText(c.body, 'end_day') }) })],

    // Seasons, licenses, the harvest log and After the trip of any plan (a camping weekend, a lunch at the lake); a trip's year gives the whole year.
    ['GET', at('/outdoor/:id'), async (c) => ({ json: await mine(c).outdoor(c.id) })],
    ['PUT', at('/plan-things/:id'), async (c) => ({ json: await mine(c).updateBring(c.id, { ...yes(c.body, 'returned'), ...yes(c.body, 'after_done'), ...maybe(c.body, 'after_trip', () => read.maybeText(c.body, 'after_trip')) }) })],

    ['GET', at('/years/:id'), async (c) => ({ json: await mine(c).year(c.id) })],
    ['PUT', at('/years/:id'), async (c) => ({
      json: await mine(c).setYear(c.id, {
        ...maybe(c.body, 'day', () => read.maybeText(c.body, 'day')), ...maybe(c.body, 'end_day', () => read.maybeText(c.body, 'end_day')),
        ...maybe(c.body, 'water', () => read.maybeText(c.body, 'water')), ...maybe(c.body, 'campground', () => read.maybeText(c.body, 'campground')),
        ...maybe(c.body, 'site', () => read.maybeText(c.body, 'site')), ...maybe(c.body, 'confirmation', () => read.maybeText(c.body, 'confirmation')),
        ...maybe(c.body, 'check_in', () => read.maybeText(c.body, 'check_in')), ...maybe(c.body, 'check_out', () => read.maybeText(c.body, 'check_out')),
        ...maybe(c.body, 'budget_cents', () => read.maybeWhole(c.body, 'budget_cents')), ...maybe(c.body, 'notes_next', () => read.maybeText(c.body, 'notes_next')),
      }),
    })],
    ['POST', at('/years/:id/finish'), async (c) => ({ json: await mine(c).finish(c.id, read.maybeText(c.body, 'notes')) })],

    ['POST', at('/years/:id/gear'), async (c) => ({
      status: 201,
      json: await mine(c).addGear(c.id, {
        part: read.maybeText(c.body, 'part'), thing_id: read.maybeWhole(c.body, 'thing_id'), label: read.maybeText(c.body, 'label'),
        quantity: read.maybeNumber(c.body, 'quantity'), caliber: read.maybeText(c.body, 'caliber'), note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['POST', at('/years/:id/fill-gear'), async (c) => ({ json: await mine(c).fillGear(c.id, read.text(c.body, 'part')) })],
    ['POST', at('/years/:id/tackle-to-list'), async (c) => ({ json: await mine(c).tackleToList(c.id) })],
    ['PUT', at('/gear/:id'), async (c) => ({
      json: await mine(c).updateGear(c.id, {
        ...yes(c.body, 'packed'), ...yes(c.body, 'returned'), ...yes(c.body, 'after_done'), ...maybe(c.body, 'after_trip', () => read.maybeText(c.body, 'after_trip')),
        ...maybe(c.body, 'quantity', () => read.maybeNumber(c.body, 'quantity')), ...maybe(c.body, 'note', () => read.maybeText(c.body, 'note')),
      }),
    })],
    ['DELETE', at('/gear/:id'), async (c) => ({ json: await mine(c).removeGear(c.id) })],

    ['POST', at('/years/:id/meals'), async (c) => ({
      status: 201,
      json: await mine(c).addMeal(c.id, {
        recipe_id: read.maybeWhole(c.body, 'recipe_id') ?? (() => { throw notUnderstood('recipe_id'); })(), day: read.maybeText(c.body, 'day'), meal: read.maybeText(c.body, 'meal'), servings: read.maybeNumber(c.body, 'servings'),
      }),
    })],
    ['DELETE', at('/meals/:id'), async (c) => ({ json: await mine(c).removeMeal(c.id) })],
    ['POST', at('/years/:id/groceries'), async (c) => ({ json: await mine(c).menuToGroceries(c.id) })],

    ['POST', at('/years/:id/seasons'), async (c) => ({
      status: 201,
      json: await mine(c).addSeason(c.id, {
        part: read.maybeText(c.body, 'part'), label: read.maybeText(c.body, 'label'), opens_on: read.maybeText(c.body, 'opens_on'), closes_on: read.maybeText(c.body, 'closes_on'),
        remind_days: read.maybeWhole(c.body, 'remind_days') ?? undefined, note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['DELETE', at('/seasons/:id'), async (c) => ({ json: await mine(c).removeSeason(c.id) })],

    ['POST', at('/years/:id/catches'), async (c) => ({
      status: 201,
      json: await mine(c).addCatch(c.id, {
        fish: read.maybeText(c.body, 'fish'), day: read.maybeText(c.body, 'day'), water: read.maybeText(c.body, 'water'), length_inches: read.maybeNumber(c.body, 'length_inches'),
        weight_lb: read.maybeNumber(c.body, 'weight_lb'), kept: read.yesNo(c.body, 'kept', false), lure_thing_id: read.maybeWhole(c.body, 'lure_thing_id'),
        lure: read.maybeText(c.body, 'lure'), note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['PUT', at('/catches/:id'), async (c) => ({
      json: await mine(c).updateCatch(c.id, {
        ...maybe(c.body, 'fish', () => read.maybeText(c.body, 'fish')), ...maybe(c.body, 'day', () => read.maybeText(c.body, 'day')), ...maybe(c.body, 'water', () => read.maybeText(c.body, 'water')),
        ...maybe(c.body, 'length_inches', () => read.maybeNumber(c.body, 'length_inches')), ...maybe(c.body, 'weight_lb', () => read.maybeNumber(c.body, 'weight_lb')),
        ...yes(c.body, 'kept'), ...maybe(c.body, 'lure', () => read.maybeText(c.body, 'lure')), ...maybe(c.body, 'note', () => read.maybeText(c.body, 'note')),
      }),
    })],
    ['POST', at('/catches/:id/freezer'), async (c) => ({ json: await mine(c).freezeCatch(c.id) })],
    ['DELETE', at('/catches/:id'), async (c) => ({ json: await mine(c).removeCatch(c.id) })],

    ['POST', at('/years/:id/harvest'), async (c) => ({
      status: 201,
      json: await mine(c).addHarvest(c.id, {
        animal: read.maybeText(c.body, 'animal'), day: read.maybeText(c.body, 'day'), place: read.maybeText(c.body, 'place'), tag_number: read.maybeText(c.body, 'tag_number'),
        weight_lb: read.maybeNumber(c.body, 'weight_lb'), note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['POST', at('/harvest/:id/freezer'), async (c) => ({ json: await mine(c).freezeHarvest(c.id) })],
    ['DELETE', at('/harvest/:id'), async (c) => ({ json: await mine(c).removeHarvest(c.id) })],
  ];
}
