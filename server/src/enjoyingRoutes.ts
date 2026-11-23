/**
 * The addresses for the calendar (/api/calendar) and the collection of films, shows, music, books and games
 * (/api/media). What they do is core/'s calendar.ts and media.ts; this only reads what was sent and passes it on.
 */
import { calendar, calendarFeed, followedCalendars, importBookList, media, readBookList, FOLLOW_SERVICE, type Db, type Fetcher, type Sealer } from '../../core/src/index.ts';
import { importMediaList, readMediaList } from '../../core/src/bookList.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

const eventFrom = (body: Body) => ({
  title: read.text(body, 'title'), day: read.text(body, 'day'), end_day: read.maybeText(body, 'end_day'),
  time: read.maybeText(body, 'time'), note: read.maybeText(body, 'note'), yearly: read.yesNo(body, 'yearly', false),
});

/** Whether a field was sent at all: left out means "leave it as it is". */
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

function titleFrom(body: Body) {
  const ids: Record<string, string> = {};
  for (const [name, value] of Object.entries(read.record(body, 'ids'))) if (typeof value === 'string' || typeof value === 'number') ids[name] = String(value);
  return {
    type: read.text(body, 'type'), title: read.text(body, 'title'), creator: read.maybeText(body, 'creator'), year: read.maybeWhole(body, 'year'),
    summary: read.maybeText(body, 'summary'), genres: read.texts(body, 'genres'), minutes: read.maybeWhole(body, 'minutes'),
    cover: read.maybeText(body, 'cover'), wanted: read.yesNo(body, 'wanted', false), note: read.maybeText(body, 'note'),
    ...(sent(body, 'ids') ? { ids } : {}),
  };
}

const copyFrom = (body: Body) => ({
  format: read.text(body, 'format'), place_id: read.maybeWhole(body, 'place_id'), barcode: read.maybeText(body, 'barcode'),
  lent_to: read.maybeText(body, 'lent_to'), lent_on: read.maybeText(body, 'lent_on'), note: read.maybeText(body, 'note'),
  ...(Object.hasOwn(body, 'link') ? { link: read.maybeText(body, 'link') } : {}),
  ...(Object.hasOwn(body, 'pieces') ? { pieces: read.maybeWhole(body, 'pieces') } : {}),
  // What it cost and is worth, in cents, typed by the person. Left out: unchanged.
  ...(Object.hasOwn(body, 'cost_cents') ? { cost_cents: read.maybeWhole(body, 'cost_cents') } : {}),
  ...(Object.hasOwn(body, 'bought_on') ? { bought_on: read.maybeText(body, 'bought_on') } : {}),
  ...(Object.hasOwn(body, 'value_cents') ? { value_cents: read.maybeWhole(body, 'value_cents') } : {}),
  ...(Object.hasOwn(body, 'valued_on') ? { valued_on: read.maybeText(body, 'valued_on') } : {}),
});

export type FollowTools = { fetcher: Fetcher; sealer: Sealer };

export function enjoyingRoutes(db: Db, follow?: FollowTools): Route[] {
  const dates = (c: Context) => calendar(db, c.user.id, c.clock);
  const others = (c: Context) => followedCalendars(db, c.user.id, c.clock, follow);
  const followed = async (c: Context, calendars: Awaited<ReturnType<ReturnType<typeof followedCalendars>['list']>>) =>
    ({ available: others(c).available(), service: FOLLOW_SERVICE, calendars });
  const shelf = (c: Context) => media(db, c.user.id, c.clock);

  return [
    // ==================== THE CALENDAR ====================

    ['GET', at('calendar'), async (c) => {
      const start = c.query.get('start');
      if (!start) throw notUnderstood('start');
      return { json: await dates(c).between(start, queryNumber(c.query, 'days') ?? 7) };
    }],
    // Other calendars followed by their link: off until one is added. The link itself is never sent back.
    ['GET', at('calendar/others'), async (c) => ({ json: await followed(c, await others(c).list()) })],
    ['POST', at('calendar/others'), async (c) => ({
      status: 201,
      json: await followed(c, await others(c).add({ name: read.text(c.body, 'name'), url: read.text(c.body, 'url'), show: read.maybeText(c.body, 'show'), zone: read.maybeText(c.body, 'zone') })),
    })],
    ['PUT', at('calendar/others/:id'), async (c) => ({ json: await followed(c, await others(c).update(c.id, { name: read.text(c.body, 'name'), show: read.maybeText(c.body, 'show') })) })],
    ['POST', at('calendar/others/:id/refresh'), async (c) => ({ json: await followed(c, await others(c).refresh(c.id)) })],
    ['DELETE', at('calendar/others/:id'), async (c) => ({ json: await followed(c, await others(c).remove(c.id)) })],
    // The link a calendar app follows: off until made, and what it answers with is in app.ts (/cal/….ics).
    ['GET', at('calendar/link'), async (c) => ({ json: await calendarFeed(db, c.user.id, c.clock).status() })],
    ['PUT', at('calendar/link'), async (c) => ({ json: await calendarFeed(db, c.user.id, c.clock).turnOn(Object.hasOwn(c.body, 'kinds') ? read.texts(c.body, 'kinds') : null) })],
    ['POST', at('calendar/link/renew'), async (c) => ({ json: await calendarFeed(db, c.user.id, c.clock).renew() })],
    ['DELETE', at('calendar/link'), async (c) => ({ json: await calendarFeed(db, c.user.id, c.clock).turnOff() })],
    ['POST', at('calendar/events'), async (c) => ({ status: 201, json: await dates(c).createEvent(eventFrom(c.body)) })],
    ['GET', at('calendar/events/:id'), async (c) => ({ json: await dates(c).getEvent(c.id) })],
    ['PUT', at('calendar/events/:id'), async (c) => ({ json: await dates(c).updateEvent(c.id, eventFrom(c.body)) })],
    ['DELETE', at('calendar/events/:id'), async (c) => (await dates(c).deleteEvent(c.id), { status: 204 })],

    // ==================== FILMS, SHOWS, MUSIC, BOOKS AND GAMES ====================

    ['GET', at('media'), async (c) => {
      const q = c.query.get('q');
      if ((q?.length ?? 0) > 100) throw notUnderstood('q');
      return {
        json: await shelf(c).list({
          type: c.query.get('type'), q, format: c.query.get('format'), place_id: queryNumber(c.query, 'place_id'),
          wanted: c.query.get('wanted') === '1', lent: c.query.get('lent') === '1',
        }),
      };
    }],
    ['GET', at('media/barcode'), async (c) => ({ json: await shelf(c).findBarcode(c.query.get('code') ?? '') })],
    ['POST', at('media'), async (c) => {
      const copy = read.record(c.body, 'copy');
      return { status: 201, json: await shelf(c).create(titleFrom(c.body), Object.keys(copy).length ? copyFrom(copy) : null) };
    }],
    ['GET', at('media/formats'), async (c) => ({ json: await shelf(c).formats(c.query.get('type') ?? 'other') })],
    ['GET', at('media/:id'), async (c) => ({ json: await shelf(c).get(c.id) })],
    ['PUT', at('media/:id'), async (c) => ({ json: await shelf(c).update(c.id, titleFrom(c.body)) })],
    ['DELETE', at('media/:id'), async (c) => (await shelf(c).remove(c.id), { status: 204 })],

    ['POST', at('media/:id/copies'), async (c) => ({ status: 201, json: await shelf(c).addCopy(c.id, copyFrom(c.body)) })],
    ['PUT', at('media/copies/:id'), async (c) => ({ json: await shelf(c).updateCopy(c.id, copyFrom(c.body)) })],
    ['POST', at('media/copies/:id/move'), async (c) => ({ json: await shelf(c).moveCopy(c.id, read.maybeWhole(c.body, 'place_id')) })],
    ['GET', at('media/copies/:id/history'), async (c) => ({ json: await shelf(c).copyHistory(c.id) })],
    ['DELETE', at('media/copies/:id'), async (c) => ({ json: await shelf(c).removeCopy(c.id) })],

    // A list of books brought in at once (from Goodreads, a spreadsheet, or typed). Nothing is looked up. See bookList.ts.
    // With "any": true, a list of anything (films, music, games, books), with its columns told back. See bookList.ts.
    ['POST', at('media/list/read'), async (c) => {
      if (c.body.any === true) {
        const list = readMediaList(typeof c.body.text === 'string' ? c.body.text : '', read.maybeText(c.body, 'type') ?? 'film');
        return { json: { count: list.items.length, skipped: list.skipped, first: list.items.slice(0, 8), columns: list.columns, types: list.types, says_format: list.says_format, wanted: list.wanted } };
      }
      const { books, skipped } = readBookList(typeof c.body.text === 'string' ? c.body.text : '');
      return { json: { count: books.length, skipped, first: books.slice(0, 8), to_read: books.filter((b) => b.shelf === 'to-read').length, dated: books.filter((b) => b.read_on).length, says_format: books.filter((b) => b.format).length } };
    }],
    ['POST', at('media/list'), async (c) => ({
      status: 201,
      json: c.body.any === true
        ? await importMediaList(db, c.user.id, c.clock, readMediaList(typeof c.body.text === 'string' ? c.body.text : '', read.maybeText(c.body, 'type') ?? 'film').items, {
          format: read.maybeText(c.body, 'format'), otherwise: read.maybeText(c.body, 'otherwise'), wanted_as_wanted: read.yesNo(c.body, 'wanted_as_wanted', true),
        })
        : await importBookList(db, c.user.id, c.clock, readBookList(typeof c.body.text === 'string' ? c.body.text : '').books, {
        format: read.maybeText(c.body, 'format'), otherwise: read.maybeText(c.body, 'otherwise'),
        to_read_as_wanted: read.yesNo(c.body, 'to_read_as_wanted', true), log_read: read.yesNo(c.body, 'log_read', true),
      }),
    })],

    ['POST', at('media/:id/log'), async (c) => ({
      status: 201,
      json: await shelf(c).log(c.id, { day: read.text(c.body, 'day'), note: read.maybeText(c.body, 'note'), session_id: read.maybeWhole(c.body, 'session_id') }),
    })],
    ['DELETE', at('media/log/:id'), async (c) => (await shelf(c).removeLog(c.id), { status: 204 })],
  ];
}
