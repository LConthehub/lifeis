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
import { addDays, todayOf } from '../../core/src/small.ts';
import { search, type SearchKind } from '../../core/src/index.ts';
import { manual } from '../../core/src/index.ts';
import { reminders, COVERS, EMAIL_SERVICE, NTFY_SERVICE, PUSH_SERVICE, type PushSender, type ReminderSettings } from '../../core/src/index.ts';
import { home, life, lookups, MAX_THING_PHOTO, recipeFromWeb, recipeText, weather, BOOK_SERVICE, GROCERY_SERVICE, RECIPE_WEB_SERVICE, TITLE_SERVICES, WEATHER_SERVICE, type Db, type Fetcher } from '../../core/src/index.ts';
import { FILM_SERVICE, fillFrom, TMDB_API, TMDB_IMAGES } from '../../core/src/lookups.ts';
import { connectionRoutes, type Reach } from './connectionRoutes.ts';
import type { AssistantTools } from '../../core/src/index.ts';
import { enjoyingRoutes } from './enjoyingRoutes.ts';
import { notUnderstood, queryNumber, read, Refusal, type Body, type Context, type Route } from './http.ts';
import { mailRoutes, type MailTools } from './mailRoutes.ts';
import { makingRoutes } from './makingRoutes.ts';
import { moneyRoutes } from './moneyRoutes.ts';
import { assistantRoutes } from './assistantRoutes.ts';
import { actionRoutes } from './actionRoutes.ts';
import { planRoutes } from './planRoutes.ts';
import { shoppingRoutes } from './shoppingRoutes.ts';
import { recallRoutes } from './recallRoutes.ts';
import { startRoutes } from './startRoutes.ts';
import { licenseRoutes } from './licenseRoutes.ts';
import { exportRoutes } from './exportRoutes.ts';

export type Outside = {
  /** How the weather and the barcode lookups are asked. Left out: they can't be turned on. */
  fetcher?: Fetcher;
  /** How a media server is reached and its key locked. Left out: none can be connected. */
  reach?: Reach;
  mail?: MailTools;
  photos?: Reach;
  calendars?: Reach;
  /** How the assistant reaches a model (and locks its key), or the phone's own model. Left out: it can't be turned on. */
  assistant?: AssistantTools;
  /** How a browser is sent a reminder, and the key it checks them by. Left out: browsers can't be sent any. */
  push?: { publicKey: string; send: PushSender };
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** A picture sent as base64 text, as the pages send them. Too large or damaged: refused. */
function pictureFrom(text: string): Uint8Array {
  if (text.length > MAX_THING_PHOTO * 1.4 || !BASE64.test(text)) throw new Refusal(400, 'That picture is too large to keep, or was damaged on the way');
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

/** What a page unpacked from a file of recipes: each thing found in it as JSON, and any entry that couldn't be opened. */
function recipeFileFrom(body: Body) {
  return {
    sources: read.records(body, 'sources').map((one) => {
      // A recipe's picture comes beside it, already shrunk by the page (`photo`); looking over only hears that there is one.
      const photo = read.maybeText(one, 'photo');
      return {
        name: read.maybeText(one, 'name') ?? 'A recipe', data: one.data, original: read.maybeText(one, 'original'),
        photo: photo && BASE64.test(photo) && photo.length <= MAX_THING_PHOTO * 1.4 ? pictureFrom(photo) : null,
        has_photo: one.has_photo === true,
      };
    }),
    unreadable: read.records(body, 'unreadable').map((one) => ({ name: read.maybeText(one, 'name') ?? 'A recipe', why: read.maybeText(one, 'why') ?? "It couldn't be opened" })),
  };
}

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

/** Where TMDB and its pictures are asked. A walk-through can point them at a stand-in with TMDB_API and TMDB_IMAGES; nothing else changes them. */
const tmdbAddress = (name: 'TMDB_API' | 'TMDB_IMAGES', real: string): string => {
  const set = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return set && /^https?:\/\//.test(set) ? set : real;
};

/** A number a page sent for a field of a title, or null for none. */
const maybeCount = (v: unknown): number | null => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

export function everydayRoutes(db: Db, options: Outside = {}): Route[] {
  const outside = options.fetcher;
  const skies = (c: Context) => weather(db, c.user.id, c.clock, outside);
  // TMDB's key is locked with the same lock as the assistant's (or a media server's), and so is kept only where one of them is.
  const finder = (c: Context) => lookups(db, c.user.id, c.clock, outside, {
    sealer: options.assistant?.sealer ?? options.reach?.sealer, api: tmdbAddress('TMDB_API', TMDB_API), images: tmdbAddress('TMDB_IMAGES', TMDB_IMAGES),
  });
  const lookupState = async (c: Context) => ({ ...await finder(c).status(), service: BOOK_SERVICE, grocery_service: GROCERY_SERVICE, title_services: TITLE_SERVICES, film_service: FILM_SERVICE });
  const book = (c: Context) => manual(db, c.user.id, c.clock);
  const entryFrom = (body: Body) => ({
    section: read.text(body, 'section'), title: read.text(body, 'title'), body: read.maybeText(body, 'body'), phone: read.maybeText(body, 'phone'),
    place_id: read.maybeWhole(body, 'place_id'), private: Object.hasOwn(body, 'private') ? read.yesNo(body, 'private') : false,
  });
  const remind = (c: Context) => reminders(db, c.user.id, c.clock, { fetcher: outside, mail: options.mail, push: options.push?.send });
  /** The settings, with what each way sends and whether this Life Is can use it. */
  const reminderState = async (c: Context) => {
    const mine = remind(c);
    const hasMail = Boolean(await db.get('SELECT 1 AS yes FROM mail_accounts WHERE owner_id = ?', [c.user.id]));
    return {
      settings: await mine.settings(),
      browsers: (await mine.browsers()).map((b) => ({ endpoint: b.endpoint, label: b.label })),
      can: { email: Boolean(options.mail) && hasMail, mail_available: Boolean(options.mail), ntfy: Boolean(outside), push: Boolean(options.push) },
      push_key: options.push?.publicKey ?? null,
      services: { email: EMAIL_SERVICE, ntfy: NTFY_SERVICE, push: PUSH_SERVICE },
    };
  };

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
    ['GET', /^\/api\/lookups$/, async (c) => ({ json: await lookupState(c) })],
    ['PUT', /^\/api\/lookups$/, async (c) => {
      if (!['books', 'groceries', 'titles', 'films', 'forget_films_key'].some((k) => Object.hasOwn(c.body, k))) throw notUnderstood('books');
      if (Object.hasOwn(c.body, 'books')) await finder(c).setBooks(read.yesNo(c.body, 'books'));
      if (Object.hasOwn(c.body, 'groceries')) await finder(c).setGroceries(read.yesNo(c.body, 'groceries'));
      if (Object.hasOwn(c.body, 'titles')) await finder(c).setTitles(read.yesNo(c.body, 'titles'));
      // TMDB: the key typed here is locked and kept, and never sent back to the page.
      if (Object.hasOwn(c.body, 'films')) await finder(c).setFilms(read.yesNo(c.body, 'films'), read.maybeText(c.body, 'films_key'));
      if (read.yesNo(c.body, 'forget_films_key', false)) await finder(c).forgetFilmsKey();
      return { json: await lookupState(c) };
    }],
    // Films and shows from TMDB, with the person's own key. See core/'s lookups.ts for what is sent.
    ['POST', /^\/api\/lookups\/films\/test$/, async (c) => ({ json: await finder(c).testFilms() })],
    ['GET', /^\/api\/lookups\/films\/search$/, async (c) => ({ json: { matches: await finder(c).searchFilms({ title: c.query.get('q') ?? '', year: maybeCount(c.query.get('year')), kind: c.query.get('kind') ?? 'film' }) } })],
    // A title chosen from the matches: its details, set against what the form already says (the person's own words stay unless `all`).
    ['POST', /^\/api\/lookups\/films\/pick$/, async (c) => {
      const found = await finder(c).filmDetails(read.text(c.body, 'kind'), read.text(c.body, 'id'));
      if (!found) return { json: { found: null } };
      const mine = read.record(c.body, 'current');
      const current = { title: typeof mine.title === 'string' ? mine.title.trim() : '', year: maybeCount(mine.year), creator: typeof mine.creator === 'string' ? mine.creator.trim() : '', minutes: maybeCount(mine.minutes),
        genres: Array.isArray(mine.genres) ? mine.genres.filter((g): g is string => typeof g === 'string' && g.trim() !== '') : [], summary: typeof mine.summary === 'string' ? mine.summary.trim() : '' };
      return { json: { found, ...fillFrom(current, found, read.yesNo(c.body, 'all', false)) } };
    }],
    ['GET', /^\/api\/lookups\/films\/poster$/, async (c) => {
      const picture = await finder(c).poster(c.query.get('path') ?? '', c.query.get('size') ?? 'w92');
      return { body: picture.bytes, headers: { 'Content-Type': picture.type, 'Cache-Control': 'private, max-age=86400' } };
    }],
    ['POST', /^\/api\/lookups\/films\/cover$/, async (c) => ({ json: await finder(c).keepPoster(read.maybeWhole(c.body, 'media_id') ?? (() => { throw notUnderstood('media_id'); })(), read.text(c.body, 'path')) })],
    ['GET', /^\/api\/lookups\/product$/, async (c) => ({ json: { product: await finder(c).product(c.query.get('code') ?? '') } })],
    ['GET', /^\/api\/lookups\/book$/, async (c) => ({ json: { book: await finder(c).book(c.query.get('code') ?? '') } })],
    ['GET', /^\/api\/lookups\/title$/, async (c) => ({ json: { title: await finder(c).title(c.query.get('code') ?? '') } })],
    ['DELETE', /^\/api\/weather$/, async (c) => ({ json: { ...await skies(c).turnOff(), service: WEATHER_SERVICE } })],

    // The house manual, and the link it's shared by. See core/'s manual.ts.
    ['GET', /^\/api\/manual$/, async (c) => ({ json: await book(c).get() })],
    ['POST', /^\/api\/manual\/entries$/, async (c) => ({ status: 201, json: await book(c).addEntry(entryFrom(c.body)) })],
    ['PUT', /^\/api\/manual\/entries\/(\d{1,15})$/, async (c) => ({ json: await book(c).updateEntry(c.id, entryFrom(c.body)) })],
    ['DELETE', /^\/api\/manual\/entries\/(\d{1,15})$/, async (c) => ({ json: await book(c).removeEntry(c.id) })],
    ['PUT', /^\/api\/manual\/share$/, async (c) => ({ json: await book(c).shareFor(read.maybeWhole(c.body, 'days'), Object.hasOwn(c.body, 'pets') ? read.yesNo(c.body, 'pets') : true) })],
    ['DELETE', /^\/api\/manual\/share$/, async (c) => ({ json: await book(c).stopSharing() })],

    // One search across everything the person keeps. See core/'s search.ts.
    ['GET', /^\/api\/search$/, async (c) => ({ json: await search(db, c.user.id, c.query.get('q') ?? '', (c.query.get('kind') || null) as SearchKind | null) })],

    // Reminders that reach you: a morning digest, sent only the ways the person turns on. See core/'s reminders.ts.
    ['GET', /^\/api\/reminders$/, async (c) => ({ json: await reminderState(c) })],
    ['PUT', /^\/api\/reminders$/, async (c) => {
      const b = c.body;
      const input: Partial<ReminderSettings> = {};
      if (Object.hasOwn(b, 'time')) input.time = read.text(b, 'time');
      if (Object.hasOwn(b, 'zone')) input.zone = read.maybeText(b, 'zone');
      for (const k of ['email', 'push', 'phone'] as const) if (Object.hasOwn(b, k)) input[k] = read.yesNo(b, k);
      if (Object.hasOwn(b, 'covers')) {
        const covers = read.record(b, 'covers');
        input.covers = Object.fromEntries(COVERS.filter((k) => typeof covers[k] === 'boolean').map((k) => [k, covers[k] as boolean])) as ReminderSettings['covers'];
      }
      if (Object.hasOwn(b, 'ntfy')) {
        const n = b.ntfy === null ? null : read.record(b, 'ntfy');
        input.ntfy = n === null ? null : { server: read.maybeText(n, 'server') ?? '', topic: read.maybeText(n, 'topic') ?? '', detail: read.maybeText(n, 'detail') === 'full' ? 'full' : 'count' };
      }
      await remind(c).save(input, c.origin);
      return { json: await reminderState(c) };
    }],
    ['GET', /^\/api\/reminders\/digest$/, async (c) => {
      if (c.query.get('ahead') !== '1') return { json: await remind(c).digest() };
      // Tomorrow's, so the phone can have it waiting for tomorrow morning.
      const tomorrow = Object.assign(() => c.clock(), { today: () => addDays(todayOf(c.clock), 1) });
      return { json: await reminders(db, c.user.id, tomorrow, {}).digest() };
    }],
    ['POST', /^\/api\/reminders\/try$/, async (c) => {
      const channel = read.maybeText(c.body, 'channel');
      if (channel !== null && !['email', 'ntfy', 'push'].includes(channel)) throw notUnderstood('channel');
      const mine = remind(c);
      const d = await mine.digest();
      // A try always sends something, even on a quiet day, so the person sees it work.
      return { json: await mine.send(d, (channel ?? undefined) as 'email' | 'ntfy' | 'push' | undefined) };
    }],
    ['POST', /^\/api\/reminders\/browsers$/, async (c) => {
      const keys = read.record(c.body, 'keys');
      await remind(c).addBrowser({ endpoint: read.text(c.body, 'endpoint'), p256dh: read.text(keys, 'p256dh'), auth: read.text(keys, 'auth'), label: read.maybeText(c.body, 'label') });
      return { status: 201, json: await reminderState(c) };
    }],
    ['DELETE', /^\/api\/reminders\/browsers$/, async (c) => {
      await remind(c).removeBrowser(c.query.get('endpoint') ?? '');
      return { json: await reminderState(c) };
    }],

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
    // Recipes from another app's file (Paprika, schema.org JSON, a Life Is export), unpacked by the page and sent as
    // JSON: looked over first (nothing kept), then brought in as one change. See recipeFiles.ts.
    ['POST', /^\/api\/kitchen\/recipes\/file\/read$/, async (c) => ({ json: await c.kitchen.lookOverRecipeFile(recipeFileFrom(c.body)) })],
    ['POST', /^\/api\/kitchen\/recipes\/file$/, async (c) => ({ status: 201, json: await c.kitchen.bringInRecipeFile(recipeFileFrom(c.body)) })],
    ['POST', /^\/api\/kitchen\/recipes\/import$/, async (c) => ({ status: 201, json: await c.kitchen.importRecipes(read.text(c.body, 'text')) })],
    ['GET', /^\/api\/kitchen\/recipes\/(\d{1,15})$/, async (c) => ({ json: await c.kitchen.getRecipe(c.id, queryNumber(c.query, 'servings')) })],
    ['PUT', /^\/api\/kitchen\/recipes\/(\d{1,15})$/, async (c) => ({ json: await c.kitchen.updateRecipe(c.id, recipeFrom(c.body)) })],
    ['DELETE', /^\/api\/kitchen\/recipes\/(\d{1,15})$/, async (c) => (await c.kitchen.deleteRecipe(c.id), { status: 204 })],
    // A recipe's picture, sent as base64 text in "data" the way a thing's photo is.
    ['PUT', /^\/api\/kitchen\/recipes\/(\d{1,15})\/photo$/, async (c) => ({ json: await c.kitchen.setPhoto(c.id, pictureFrom(read.text(c.body, 'data'))) })],
    ['DELETE', /^\/api\/kitchen\/recipes\/(\d{1,15})\/photo$/, async (c) => ({ json: await c.kitchen.removePhoto(c.id) })],
    ['GET', /^\/api\/kitchen\/recipes\/(\d{1,15})\/photo$/, async (c) => {
      const photo = await c.kitchen.photo(c.id);
      if (!photo) return { status: 404, json: { detail: 'Not found' } };
      return { body: photo.bytes, headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } };
    }],

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
    // Copying a week onto another, and week templates (kept with the person's settings).
    ['POST', /^\/api\/kitchen\/plan\/copy$/, async (c) => ({ json: await c.kitchen.copyWeek(read.text(c.body, 'from'), read.text(c.body, 'to'), read.maybeWhole(c.body, 'days') ?? 7) })],
    ['GET', /^\/api\/kitchen\/plan\/templates$/, async (c) => ({ json: await c.kitchen.listTemplates() })],
    ['POST', /^\/api\/kitchen\/plan\/templates$/, async (c) => ({ status: 201, json: await c.kitchen.saveTemplate(read.text(c.body, 'start'), read.text(c.body, 'name')) })],
    ['PUT', /^\/api\/kitchen\/plan\/templates\/(\d{1,15})$/, async (c) => ({ json: await c.kitchen.renameTemplate(c.id, read.text(c.body, 'name')) })],
    ['DELETE', /^\/api\/kitchen\/plan\/templates\/(\d{1,15})$/, async (c) => ({ json: await c.kitchen.deleteTemplate(c.id) })],
    ['POST', /^\/api\/kitchen\/plan\/templates\/(\d{1,15})\/use$/, async (c) => ({ json: await c.kitchen.useTemplate(c.id, read.text(c.body, 'start')) })],
    // Recipes for what is about to run out, and putting something scanned in the pantry.
    ['GET', /^\/api\/kitchen\/use-it-up$/, async (c) => ({ json: await c.kitchen.useItUp(queryNumber(c.query, 'days') ?? 5) })],
    ['GET', /^\/api\/kitchen\/pantry\/scan$/, async (c) => ({ json: await c.kitchen.scanForPantry(c.query.get('code') ?? '') })],
    ['POST', /^\/api\/kitchen\/pantry\/scan$/, async (c) => ({
      json: await c.kitchen.addScanned({
        code: read.text(c.body, 'code'), quantity: Object.hasOwn(c.body, 'quantity') ? read.maybeNumber(c.body, 'quantity') : undefined, unit: read.maybeText(c.body, 'unit'),
        ingredient_id: read.maybeWhole(c.body, 'ingredient_id'), name: read.maybeText(c.body, 'name'), product: read.maybeText(c.body, 'product'), size: read.maybeText(c.body, 'size'),
      }),
    })],

    ['GET', /^\/api\/kitchen\/grocery$/, async (c) => ({ json: await c.kitchen.listGrocery() })],
    ['POST', /^\/api\/kitchen\/grocery$/, async (c) => ({
      status: 201,
      json: await c.kitchen.addGrocery({ label: read.text(c.body, 'label'), quantity: read.maybeNumber(c.body, 'quantity'), unit: read.maybeText(c.body, 'unit') }),
    })],
    // A list pasted in: looked over (nothing added), then added line by line as if typed.
    ['POST', /^\/api\/kitchen\/grocery\/paste\/read$/, async (c) => ({ json: await c.kitchen.lookOverGroceries(read.text(c.body, 'text')) })],
    ['POST', /^\/api\/kitchen\/grocery\/paste$/, async (c) => ({ status: 201, json: await c.kitchen.addGroceries(read.texts(c.body, 'lines')) })],
    ['POST', /^\/api\/kitchen\/grocery\/from-plan$/, async (c) =>
      ({ json: await c.kitchen.groceryFromPlan(read.text(c.body, 'start'), read.maybeWhole(c.body, 'days') ?? 7) })],
    ['POST', /^\/api\/kitchen\/grocery\/clear-done$/, async (c) => ({ json: await c.kitchen.clearDone() })],
    ['POST', /^\/api\/kitchen\/grocery\/from-pantry-low$/, async (c) => ({ json: await c.kitchen.groceryFromLow() })],
    ['POST', /^\/api\/kitchen\/grocery\/(\d{1,15})\/tick$/, async (c) =>
      ({ json: await c.kitchen.tickGrocery(c.id, { done: read.yesNo(c.body, 'done'), put_away: read.yesNo(c.body, 'put_away', true) }) })],
    ['DELETE', /^\/api\/kitchen\/grocery\/(\d{1,15})$/, async (c) => (await c.kitchen.deleteGrocery(c.id), { status: 204 })],

    ...makingRoutes(db),
    ...moneyRoutes(db),
    ...assistantRoutes(db, options.assistant),
    ...actionRoutes(db),
    ...(options.reach ? connectionRoutes(db, options.reach) : []),
    ...enjoyingRoutes(db, options.calendars),
    ...mailRoutes(db, options.mail),
    ...planRoutes(db, options.photos),
    ...shoppingRoutes(db),
    ...recallRoutes(db, outside),
    ...startRoutes(db),
    ...licenseRoutes(db),
    ...exportRoutes(db),
  ];
}
