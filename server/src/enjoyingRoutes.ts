/**
 * The addresses for the calendar (/api/calendar) and the collection of films, shows, music, books and games
 * (/api/media). What they do is core/'s calendar.ts and media.ts; this only reads what was sent and passes it on.
 */
import { calendar, media, type Db } from '../../core/src/index.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

const eventFrom = (body: Body) => ({
  title: read.text(body, 'title'), day: read.text(body, 'day'), end_day: read.maybeText(body, 'end_day'),
  time: read.maybeText(body, 'time'), note: read.maybeText(body, 'note'),
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
});

export function enjoyingRoutes(db: Db): Route[] {
  const dates = (c: Context) => calendar(db, c.user.id, c.clock);
  const shelf = (c: Context) => media(db, c.user.id, c.clock);

  return [
    // ==================== THE CALENDAR ====================

    ['GET', at('calendar'), async (c) => {
      const start = c.query.get('start');
      if (!start) throw notUnderstood('start');
      return { json: await dates(c).between(start, queryNumber(c.query, 'days') ?? 7) };
    }],
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
    ['DELETE', at('media/copies/:id'), async (c) => ({ json: await shelf(c).removeCopy(c.id) })],

    ['POST', at('media/:id/log'), async (c) => ({
      status: 201,
      json: await shelf(c).log(c.id, { day: read.text(c.body, 'day'), note: read.maybeText(c.body, 'note'), session_id: read.maybeWhole(c.body, 'session_id') }),
    })],
    ['DELETE', at('media/log/:id'), async (c) => (await shelf(c).removeLog(c.id), { status: 204 })],
  ];
}
