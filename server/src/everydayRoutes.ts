/**
 * Everything a signed-in person does, as addresses: the front page, the kitchen, things, projects, the
 * calendar, the collection, plans, shopping, mail, and the outside services each can turn on.
 *
 * Nothing here knows how a request arrived or who checked the sign-in. The server puts these behind its
 * front door (app.ts); the phone app hands the pages' requests straight to them (frontend/src/device). So
 * this file, and the ones it gathers, must run anywhere: no files, no network of their own, nothing from Node.
 * What reaches outside is handed in (`fetcher`, and the tools for each service), and is left out where
 * Life Is can't or shouldn't reach out.
 */
import { home, life, lookups, recipeFromWeb, recipeText, weather, BOOK_SERVICE, GROCERY_SERVICE, RECIPE_WEB_SERVICE, WEATHER_SERVICE, type Db, type Fetcher } from '../../core/src/index.ts';
import { connectionRoutes, type Reach } from './connectionRoutes.ts';
import { enjoyingRoutes } from './enjoyingRoutes.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';
import { mailRoutes, type MailTools } from './mailRoutes.ts';
import { makingRoutes } from './makingRoutes.ts';
import { planRoutes } from './planRoutes.ts';
import { shoppingRoutes } from './shoppingRoutes.ts';

export type Outside = {
  /** How the weather and the barcode lookups are asked. Left out: they can't be turned on. */
  fetcher?: Fetcher;
  /** How a media server is reached and its key locked. Left out: none can be connected. */
  reach?: Reach;
  mail?: MailTools;
  photos?: Reach;
  calendars?: Reach;
};

function recipeFrom(body: Body) {
  return {
    title: read.text(body, 'title'),
    description: read.maybeText(body, 'description'),
    servings: read.maybeNumber(body, 'servings'),
    prep_minutes: read.maybeWhole(body, 'prep_minutes'),
    cook_minutes: read.maybeWhole(body, 'cook_minutes'),
    source_url: read.maybeText(body, 'source_url'),
    ingredients_text: read.maybeText(body, 'ingredients_text'),
    steps_text: read.maybeText(body, 'steps_text'),
    notes: read.maybeText(body, 'notes'),
    tags: read.texts(body, 'tags'),
    original_text: read.maybeText(body, 'original_text'),
    // What it's cooked in. Left out altogether, a recipe being changed keeps what it had.
    ...(Object.hasOwn(body, 'equipment') ? {
      equipment: read.records(body, 'equipment').map((one) => ({
        item_id: read.maybeWhole(one, 'item_id'), label: read.maybeText(one, 'label'), quantity: read.maybeNumber(one, 'quantity'), note: read.maybeText(one, 'note'),
      })),
    } : {}),
  };
}

export function everydayRoutes(db: Db, options: Outside = {}): Route[] {
  const outside = options.fetcher;
  const skies = (c: Context) => weather(db, c.user.id, c.clock, outside);
  const finder = (c: Context) => lookups(db, c.user.id, c.clock, outside);

  return [
    // The front page: what today holds, gathered from every section the person uses.
    ['GET', /^\/api\/home$/, async (c) => ({ json: await home(db, c.user.id, c.clock, outside).summary() })],
    ['PUT', /^\/api\/home\/cards$/, async (c) => {
      if (!Array.isArray(c.body.hidden)) throw notUnderstood('hidden');
      return { json: await home(db, c.user.id, c.clock, outside).hideCards(read.texts(c.body, 'hidden')) };
    }],

    // The weather: an outside service, off until the person turns it on. See core/'s weather.ts for what it sends.
    ['GET', /^\/api\/weather$/, async (c) => ({ json: { ...await skies(c).status(), service: WEATHER_SERVICE } })],
    ['GET', /^\/api\/weather\/places$/, async (c) => ({ json: await skies(c).findPlaces(c.query.get('q') ?? '') })],
    ['PUT', /^\/api\/weather$/, async (c) => {
      const [latitude, longitude] = [read.maybeNumber(c.body, 'latitude'), read.maybeNumber(c.body, 'longitude')];
      if (latitude === null || longitude === null) throw notUnderstood('latitude');
      return { json: { ...await skies(c).turnOn({ name: read.text(c.body, 'name'), latitude, longitude, units: read.maybeText(c.body, 'units') }), service: WEATHER_SERVICE } };
    }],
    // Looking a book up from its barcode: an outside service too, off until turned on. See core/'s lookups.ts.
    ['GET', /^\/api\/lookups$/, async (c) => ({ json: { ...await finder(c).status(), service: BOOK_SERVICE, grocery_service: GROCERY_SERVICE } })],
    ['PUT', /^\/api\/lookups$/, async (c) => {
      if (!Object.hasOwn(c.body, 'books') && !Object.hasOwn(c.body, 'groceries')) throw notUnderstood('books');
      if (Object.hasOwn(c.body, 'books')) await finder(c).setBooks(read.yesNo(c.body, 'books'));
      if (Object.hasOwn(c.body, 'groceries')) await finder(c).setGroceries(read.yesNo(c.body, 'groceries'));
      return { json: { ...await finder(c).status(), service: BOOK_SERVICE, grocery_service: GROCERY_SERVICE } };
    }],
    ['GET', /^\/api\/lookups\/product$/, async (c) => ({ json: { product: await finder(c).product(c.query.get('code') ?? '') } })],
    ['GET', /^\/api\/lookups\/book$/, async (c) => ({ json: { book: await finder(c).book(c.query.get('code') ?? '') } })],
    ['DELETE', /^\/api\/weather$/, async (c) => ({ json: { ...await skies(c).turnOff(), service: WEATHER_SERVICE } })],

    // What the person wants Life Is to look after: asked once, theirs to change.
    ['GET', /^\/api\/life$/, async (c) => ({ json: await life(db, c.user.id, c.clock).getProfile() })],
    ['PUT', /^\/api\/life$/, async (c) => {
      if (!Array.isArray(c.body.areas)) throw notUnderstood('areas');
      return { json: await life(db, c.user.id, c.clock).saveProfile(read.texts(c.body, 'areas')) };
    }],

    // ==================== THE KITCHEN ====================

    ['GET', /^\/api\/kitchen\/ingredients$/, async (c) => ({ json: await c.kitchen.listIngredients() })],
    ['PUT', /^\/api\/kitchen\/ingredients\/(\d{1,15})$/, async (c) =>
      ({ json: await c.kitchen.updateIngredient(c.id, { name: read.maybeText(c.body, 'name'), aisle: read.maybeText(c.body, 'aisle') }) })],

    ['GET', /^\/api\/kitchen\/recipes$/, async (c) => {
      const q = c.query.get('q');
      const tag = c.query.get('tag');
      if ((q?.length ?? 0) > 100) throw notUnderstood('q');
      if ((tag?.length ?? 0) > 40) throw notUnderstood('tag');
      return { json: await c.kitchen.listRecipes({ q, tag }) };
    }],
    ['POST', /^\/api\/kitchen\/recipes$/, async (c) => ({ status: 201, json: await c.kitchen.createRecipe(recipeFrom(c.body)) })],
    // A recipe read from text (typed, pasted, or read off a photo) or from a web page, given back as a draft
    // to look over. Nothing is saved by these two.
    ['POST', /^\/api\/kitchen\/recipes\/read$/, async (c) => ({ json: recipeText.readImport(read.text(c.body, 'text'))[0] })],
    ['POST', /^\/api\/kitchen\/recipes\/from-web$/, async (c) => ({ json: await recipeFromWeb(outside, read.text(c.body, 'url')) })],
    ['GET', /^\/api\/kitchen\/recipes\/from-web$/, async () => ({ json: { available: Boolean(outside), service: RECIPE_WEB_SERVICE } })],
    ['POST', /^\/api\/kitchen\/recipes\/import$/, async (c) => ({ status: 201, json: await c.kitchen.importRecipes(read.text(c.body, 'text')) })],
    ['GET', /^\/api\/kitchen\/recipes\/(\d{1,15})$/, async (c) => ({ json: await c.kitchen.getRecipe(c.id, queryNumber(c.query, 'servings')) })],
    ['PUT', /^\/api\/kitchen\/recipes\/(\d{1,15})$/, async (c) => ({ json: await c.kitchen.updateRecipe(c.id, recipeFrom(c.body)) })],
    ['DELETE', /^\/api\/kitchen\/recipes\/(\d{1,15})$/, async (c) => (await c.kitchen.deleteRecipe(c.id), { status: 204 })],

    ['GET', /^\/api\/kitchen\/pantry$/, async (c) => ({ json: await c.kitchen.listPantry() })],
    ['PUT', /^\/api\/kitchen\/pantry$/, async (c) => ({
      json: await c.kitchen.savePantry({
        name: read.text(c.body, 'name'), quantity: read.maybeNumber(c.body, 'quantity'), unit: read.maybeText(c.body, 'unit'),
        location: read.maybeText(c.body, 'location'), expires_on: read.maybeText(c.body, 'expires_on'), low_at: read.maybeNumber(c.body, 'low_at'),
      }),
    })],
    ['DELETE', /^\/api\/kitchen\/pantry\/(\d{1,15})$/, async (c) => (await c.kitchen.deletePantry(c.id), { status: 204 })],

    ['GET', /^\/api\/kitchen\/plan$/, async (c) => {
      const start = c.query.get('start');
      if (!start) throw notUnderstood('start');
      return { json: await c.kitchen.listPlan(start, queryNumber(c.query, 'days') ?? 7) };
    }],
    ['GET', /^\/api\/kitchen\/equipment$/, async (c) => {
      const start = c.query.get('start');
      if (!start) throw notUnderstood('start');
      return { json: await c.kitchen.equipmentCheck(start, queryNumber(c.query, 'days') ?? 7) };
    }],
    ['POST', /^\/api\/kitchen\/plan$/, async (c) => ({
      status: 201,
      json: await c.kitchen.addPlan({
        day: read.text(c.body, 'day'), meal: read.maybeText(c.body, 'meal') ?? 'dinner', recipe_id: read.maybeWhole(c.body, 'recipe_id'),
        title: read.maybeText(c.body, 'title'), servings: read.maybeNumber(c.body, 'servings'),
      }),
    })],
    ['DELETE', /^\/api\/kitchen\/plan\/(\d{1,15})$/, async (c) => (await c.kitchen.deletePlan(c.id), { status: 204 })],
    ['POST', /^\/api\/kitchen\/plan\/(\d{1,15})\/cooked$/, async (c) => ({ json: await c.kitchen.cooked(c.id) })],

    ['GET', /^\/api\/kitchen\/grocery$/, async (c) => ({ json: await c.kitchen.listGrocery() })],
    ['POST', /^\/api\/kitchen\/grocery$/, async (c) => ({
      status: 201,
      json: await c.kitchen.addGrocery({ label: read.text(c.body, 'label'), quantity: read.maybeNumber(c.body, 'quantity'), unit: read.maybeText(c.body, 'unit') }),
    })],
    ['POST', /^\/api\/kitchen\/grocery\/from-plan$/, async (c) =>
      ({ json: await c.kitchen.groceryFromPlan(read.text(c.body, 'start'), read.maybeWhole(c.body, 'days') ?? 7) })],
    ['POST', /^\/api\/kitchen\/grocery\/clear-done$/, async (c) => ({ json: await c.kitchen.clearDone() })],
    ['POST', /^\/api\/kitchen\/grocery\/from-pantry-low$/, async (c) => ({ json: await c.kitchen.groceryFromLow() })],
    ['POST', /^\/api\/kitchen\/grocery\/(\d{1,15})\/tick$/, async (c) =>
      ({ json: await c.kitchen.tickGrocery(c.id, { done: read.yesNo(c.body, 'done'), put_away: read.yesNo(c.body, 'put_away', true) }) })],
    ['DELETE', /^\/api\/kitchen\/grocery\/(\d{1,15})$/, async (c) => (await c.kitchen.deleteGrocery(c.id), { status: 204 })],

    ...makingRoutes(db),
    ...(options.reach ? connectionRoutes(db, options.reach) : []),
    ...enjoyingRoutes(db, options.calendars),
    ...mailRoutes(db, options.mail),
    ...planRoutes(db, options.photos),
    ...shoppingRoutes(db),
  ];
}
