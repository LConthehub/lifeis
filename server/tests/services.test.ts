/**
 * Outside services over the web addresses: the weather, tried against a stand-in for the weather service, so
 * these tests never reach outside themselves. Also dates that come round every year.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Problem, type Fetcher, type MailMessage, type Outgoing, type Postbox } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { webFetcher } from '../src/connectionRoutes.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let asked: string[];

const outside: Fetcher = async (url) => {
  asked.push(url);
  if (url.includes('openfoodfacts.org')) {
    const data = url.includes('/3017620422003.json') ? { code: '3017620422003', status: 1, product: { product_name: 'Nutella', brands: 'Ferrero', quantity: '400 g' } } : { status: 0, status_verbose: 'product not found' };
    return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
  }
  if (url.includes('openlibrary.org')) {
    const known = url.includes('ISBN:9780441172719');
    const data = known ? { 'ISBN:9780441172719': { title: 'Dune', authors: [{ name: 'Frank Herbert' }], publish_date: 'June 2020', number_of_pages: 896 } } : {};
    return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
  }
  const data = url.includes('geocoding-api')
    ? { results: [{ name: 'Springfield', admin1: 'Missouri', country: 'United States', latitude: 37.21533, longitude: -93.29824 }] }
    : { current: { temperature_2m: 7.2, weather_code: 61 },
      daily: { time: ['2046-03-05'], weather_code: [61], temperature_2m_max: [9.4], temperature_2m_min: [3.1], precipitation_probability_max: [90] } };
  return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
};

let letters: MailMessage[];
let sent: Outgoing[];
const postbox: Postbox = {
  check: async (s) => { if (s.password !== 'an-app-password') throw new Problem(400, "imap.example.org didn't accept that username and password."); },
  list: async () => ({ messages: letters.map(({ uid, from, subject, date, unread, flagged }) => ({ uid, from, subject, date, unread, flagged })), unread: letters.filter((m) => m.unread).length }),
  read: async (_s, uid) => letters.find((m) => m.uid === uid) ?? null,
  mark: async (_s, uid, seen) => { letters.find((m) => m.uid === uid)!.unread = !seen; },
  send: async (_s, message) => { sent.push(message); },
};

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown) {
    const response = await fetch(base + address, {
      method, headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const text = await response.text();
    return { status: response.status, json: response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : undefined };
  }
  return {
    get: (address: string) => ask('GET', address), post: (address: string, body?: unknown) => ask('POST', address, body),
    put: (address: string, body?: unknown) => ask('PUT', address, body), delete: (address: string) => ask('DELETE', address),
  };
}

async function start(withReach: boolean) {
  const reach = withReach ? { fetcher: outside, sealer: vault(path.join(folder, 'keys'), 'media_source') } : undefined;
  server = createServer(createApp({ db: database.db, reach, mail: withReach ? { postbox, sealer: vault(path.join(folder, 'keys'), 'mail_account') } : undefined }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  return admin;
}

beforeEach(async () => {
  asked = [];
  sent = [];
  letters = [{ uid: 7, from: { name: 'Sam Doe', address: 'sam@example.com' }, subject: 'Saturday?', date: '2046-03-04T09:00:00.000Z', unread: true, flagged: false,
    to: [{ name: null, address: 'me@example.org' }], cc: [], reply_to: null, text: 'Are you free Saturday?', attachments: ['map.pdf'], message_id: '<m1@example.com>', references: [] }];
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

it('the weather is off until turned on, says what it sends, and is forgotten when turned off', async () => {
  const admin = await start(true);
  const off = (await admin.get('/api/weather')).json;
  expect([off.available, off.place, off.forecast, off.service.name]).toEqual([true, null, null, 'Open-Meteo']);
  expect(off.service.sends).toContain('No account');
  expect((await admin.get('/api/home')).json.cards).not.toContain('weather');
  expect(asked).toEqual([]); // nothing leaves until asked

  expect((await admin.get('/api/weather/places?q=Springfield')).json[0]).toMatchObject({ name: 'Springfield', region: 'Missouri' });
  expect((await admin.get('/api/weather/places?q=')).status).toBe(400);
  expect((await admin.put('/api/weather', { name: 'Springfield' })).status).toBe(422);
  const on = (await admin.put('/api/weather', { name: 'Springfield, Missouri', latitude: 37.21533, longitude: -93.29824, units: 'c' })).json;
  expect([on.place, on.forecast.now]).toEqual([{ name: 'Springfield, Missouri', latitude: 37.22, longitude: -93.3, units: 'c' }, { temperature: 7, words: 'Rain', icon: '🌧' }]);

  const front = (await admin.get('/api/home')).json;
  expect([front.cards.includes('weather'), front.weather.forecast.days[0]]).toEqual([true, { day: '2046-03-05', words: 'Rain', icon: '🌧', high: 9, low: 3, wet: 90 }]);
  expect(asked).toHaveLength(2); // one search, one forecast: the front page used the kept one

  expect((await admin.delete('/api/weather')).json.place).toBeNull();
  expect((await admin.get('/api/home')).json.weather).toBeNull();
  expect((await visitor().get('/api/weather')).status).toBe(401);
});

it('a copy of Life Is that cannot reach outside says so, and refuses to turn the weather on', async () => {
  const admin = await start(false);
  expect((await admin.get('/api/weather')).json.available).toBe(false);
  expect((await admin.put('/api/weather', { name: 'Paris', latitude: 48.85, longitude: 2.35 })).status).toBe(400);
});

it('a yearly date is saved and shown through the calendar addresses', async () => {
  const admin = await start(false);
  const made = await admin.post('/api/calendar/events', { title: "Mum's birthday", day: '1958-03-07', yearly: true });
  expect([made.status, made.json.yearly]).toEqual([201, true]);
  const week = (await admin.get('/api/calendar?start=2046-03-05&days=7')).json;
  expect(week.map((e: { day: string; title: string; detail: string }) => [e.day, e.title, e.detail])).toEqual([['2046-03-07', "Mum's birthday", '88 years']]);
  expect((await admin.post('/api/calendar/events', { title: 'x', day: '2046-03-07', yearly: 'yes' })).status).toBe(422);
});

it('email is set up, read and answered over the web addresses, and the password never comes back', async () => {
  const admin = await start(true);
  const none = (await admin.get('/api/mail')).json;
  expect([none.available, none.accounts, none.service.sends.includes('never kept here')]).toEqual([true, [], true]);
  expect((await admin.get('/api/home')).json.choices.map((c: { key: string }) => c.key)).not.toContain('mail');

  const account = { address: 'me@example.org', name: 'Me', password: 'an-app-password', imap_host: 'imap.example.org', imap_port: 993, smtp_host: 'smtp.example.org', smtp_port: 465 };
  const refused = await admin.post('/api/mail/accounts', { ...account, password: 'everyday-password' });
  expect([refused.status, refused.json.detail]).toEqual([400, expect.stringContaining("didn't accept")]);
  expect((await admin.post('/api/mail/accounts', { ...account, imap_port: '993' })).status).toBe(422);
  const made = await admin.post('/api/mail/accounts', account);
  expect([made.status, made.json.address, 'password' in made.json]).toEqual([201, 'me@example.org', false]);
  const id = made.json.id;
  expect(JSON.stringify((await admin.get('/api/mail')).json)).not.toContain('an-app-password');
  const kept = (await database.db.get<{ password: string }>('SELECT password FROM mail_accounts WHERE id = ?', [id]))!.password;
  expect([kept.startsWith('sealed:v1:'), kept.includes('an-app-password')]).toEqual([true, false]);
  // A password locked for one purpose can't be opened as another.
  expect(vault(path.join(folder, 'keys'), 'media_source').unseal(kept)).toBeNull();

  expect((await admin.get('/api/home')).json.cards).toContain('mail');
  expect((await admin.get('/api/mail/glance')).json).toEqual([{ id, address: 'me@example.org', unread: 1, newest: [expect.objectContaining({ uid: 7, subject: 'Saturday?' })], problem: null }]);
  expect((await admin.get(`/api/mail/accounts/${id}/messages`)).json).toMatchObject({ unread: 1, messages: [{ uid: 7, unread: true }] });
  expect((await admin.get(`/api/mail/accounts/${id}/messages/7`)).json).toMatchObject({ text: 'Are you free Saturday?', attachments: ['map.pdf'], unread: true });
  expect((await admin.get(`/api/mail/accounts/${id}/messages/8`)).status).toBe(404);

  expect((await admin.put(`/api/mail/accounts/${id}/messages/7/seen`, { seen: true })).status).toBe(204);
  expect((await admin.put(`/api/mail/accounts/${id}/messages/7/seen`, {})).status).toBe(422);
  expect(letters[0]!.unread).toBe(false);

  const answer = await admin.post(`/api/mail/accounts/${id}/messages/7/reply`, { text: 'Yes!' });
  expect([answer.status, answer.json]).toEqual([200, { sent: true, to: [{ name: 'Sam Doe', address: 'sam@example.com' }], cc: [] }]);
  expect([sent[0]!.subject, sent[0]!.text.startsWith(['Yes!', '', 'Sam Doe <sam@example.com> wrote'].join(String.fromCharCode(10)))]).toEqual(['Re: Saturday?', true]);
  expect((await admin.post(`/api/mail/accounts/${id}/messages/7/reply`, { text: ' ' })).status).toBe(400);

  // Nobody else, signed in or not, reaches the account.
  expect((await admin.post('/api/users', { username: 'other', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  await other.post('/api/auth/login', { username: 'other', password: PASSWORD });
  expect([(await other.get('/api/mail')).json.accounts, (await other.get(`/api/mail/accounts/${id}/messages`)).status]).toEqual([[], 404]);
  expect((await visitor().get('/api/mail')).status).toBe(401);

  expect((await admin.delete(`/api/mail/accounts/${id}`)).status).toBe(204);
  expect((await admin.get('/api/mail')).json.accounts).toEqual([]);
});

it('without a way to reach mail providers, email says so', async () => {
  const admin = await start(false);
  expect((await admin.get('/api/mail')).json.available).toBe(false);
  expect((await admin.post('/api/mail/accounts', { address: 'me@example.org', password: 'x', imap_host: 'a.example.org', smtp_host: 'b.example.org' })).status).toBe(400);
});

it('books are looked up by barcode only once that is turned on, and only the number is sent', async () => {
  const admin = await start(true);
  const off = (await admin.get('/api/lookups')).json;
  expect([off.available, off.books, off.service.name]).toEqual([true, false, 'Open Library']);
  expect((await admin.get('/api/lookups/book?code=9780441172719')).status).toBe(400); // off: refused, and nothing asked
  expect(asked).toEqual([]);

  expect((await admin.put('/api/lookups', { books: true })).json.books).toBe(true);
  expect((await admin.put('/api/lookups', { books: 'yes' })).status).toBe(422);
  expect((await admin.get('/api/lookups/book?code=978-0-441-17271-9')).json).toEqual({ book: { isbn: '9780441172719', title: 'Dune', creator: 'Frank Herbert', edition_year: 2020, pages: 896 } });
  expect(asked).toEqual(['https://openlibrary.org/api/books?bibkeys=ISBN:9780441172719&format=json&jscmd=data']);
  expect((await admin.get('/api/lookups/book?code=9791234567896')).json).toEqual({ book: null }); // a book it doesn't know
  expect((await admin.get('/api/lookups/book?code=024543213465')).status).toBe(400); // a film's barcode isn't a book's
  expect(asked).toHaveLength(2);

  expect((await admin.put('/api/lookups', { books: false })).json.books).toBe(false);
  expect((await admin.get('/api/lookups/book?code=9780441172719')).status).toBe(400);
  expect((await visitor().get('/api/lookups')).status).toBe(401);
});

it('groceries are looked up by barcode only once that is turned on, apart from books', async () => {
  const admin = await start(true);
  const off = (await admin.get('/api/lookups')).json;
  expect([off.groceries, off.books, off.grocery_service.name]).toEqual([false, false, 'Open Food Facts']);
  expect((await admin.get('/api/lookups/product?code=3017620422003')).status).toBe(400);
  expect(asked).toEqual([]);

  const on = (await admin.put('/api/lookups', { groceries: true })).json;
  expect([on.groceries, on.books]).toEqual([true, false]); // one doesn't turn the other on
  expect((await admin.put('/api/lookups', {})).status).toBe(422);
  expect((await admin.get('/api/lookups/product?code=3017620422003')).json).toEqual({ product: { barcode: '3017620422003', name: 'Nutella', brand: 'Ferrero', size: '400 g' } });
  expect(asked).toEqual(['https://world.openfoodfacts.org/api/v2/product/3017620422003.json?fields=product_name,brands,quantity']);
  expect((await admin.get('/api/lookups/product?code=0025500000276')).json).toEqual({ product: null });
  expect((await admin.get('/api/lookups/product?code=abc')).status).toBe(400);
  expect((await admin.put('/api/lookups', { groceries: false })).json.groceries).toBe(false);
});

it('the calendar link answers a calendar app without signing in, and only while it exists', async () => {
  const admin = await start(false);
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await admin.post('/api/calendar/events', { title: 'Book club', day, time: '19:00' });
  expect((await admin.get('/api/calendar/link')).json).toMatchObject({ on: false, token: null });
  expect((await visitor().get('/api/calendar/link')).status).toBe(401);

  const on = (await admin.put('/api/calendar/link', {})).json;
  expect([on.on, on.kinds]).toEqual([true, ['event', 'plan', 'meal', 'due']]);
  const fetched = await fetch(`${base}/cal/${on.token}.ics`); // no cookie: the address is the key
  const file = await fetched.text();
  expect([fetched.status, fetched.headers.get('content-type'), fetched.headers.get('cache-control')]).toEqual([200, 'text/calendar; charset=utf-8', 'private, no-store']);
  expect(file).toContain('SUMMARY:Book club');
  expect(file).toContain(`DTSTART:${day.replaceAll('-', '')}T190000`);
  expect((await admin.get('/api/calendar/link')).json.read_at).not.toBeNull();
  expect((await fetch(`${base}/cal/${'0'.repeat(64)}.ics`)).status).toBe(404);
  expect((await fetch(`${base}/cal/${on.token}.ics`, { method: 'POST' })).status).toBe(404);

  expect((await admin.put('/api/calendar/link', { kinds: ['nonsense'] })).status).toBe(400);
  const renewed = (await admin.post('/api/calendar/link/renew')).json;
  expect([(await fetch(`${base}/cal/${on.token}.ics`)).status, (await fetch(`${base}/cal/${renewed.token}.ics`)).status]).toEqual([404, 200]);
  expect((await admin.delete('/api/calendar/link')).json.on).toBe(false);
  expect((await fetch(`${base}/cal/${renewed.token}.ics`)).status).toBe(404);
});

it('another calendar is followed over the web addresses, busy only, and its link never comes back', async () => {
  const admin = await start(true);
  // A stand-in calendar somewhere else: a small server of its own, answering with one booking.
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  const other = createServer((req, res) => {
    if (req.url !== '/busy/key123.ics') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `DTSTART:${day}T140000`, `DTEND:${day}T160000`, 'SUMMARY:Client: A. Person', 'LOCATION:Hotel Grand', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  });
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  const link = `http://127.0.0.1:${(other.address() as AddressInfo).port}/busy/key123.ics`;
  try {
    const off = (await admin.get('/api/calendar/others')).json;
    expect([off.available, off.calendars, off.service.name]).toEqual([false, [], 'Other calendars']); // this test's Life Is has no way out for calendars
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  server = createServer(createApp({ db: database.db, calendars: { fetcher: webFetcher, sealer: vault(path.join(folder, 'keys'), 'calendar_source') } }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const again = visitor();
  expect((await again.post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(200);
  try {
    expect((await again.post('/api/calendar/others', { name: 'Work', url: link.replace('key123', 'wrong') })).status).toBe(400);
    const made = await again.post('/api/calendar/others', { name: 'Work', url: link, zone: 'America/Chicago' });
    expect([made.status, made.json.calendars[0]]).toEqual([201, expect.objectContaining({ name: 'Work', show: 'busy', events: 1, problem: null })]);
    expect(JSON.stringify(made.json)).not.toContain('key123');
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
    const seen = (await again.get(`/api/calendar?start=${iso}&days=1`)).json;
    expect(seen).toEqual([{ kind: 'outside', day: iso, time: '14:00', title: 'Work', detail: 'until 16:00', link: null, id: null }]);
    const id = made.json.calendars[0].id;
    expect((await again.post(`/api/calendar/others/${id}/refresh`)).json.calendars[0].problem).toBeNull();
    expect((await again.delete(`/api/calendar/others/${id}`)).json.calendars).toEqual([]);
    expect((await visitor().get('/api/calendar/others')).status).toBe(401);
  } finally {
    await new Promise((resolve) => other.close(resolve));
  }
});

it('a recipe is read from a page or from text into a draft, and nothing is saved until asked', async () => {
  const site = createServer((req, res) => {
    if (req.url !== '/soup') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<html><script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Leek soup', recipeIngredient: ['3 leeks'], recipeInstructions: 'Simmer.' })}</script></html>`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const at = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  // This test's Life Is is given the real way out, to reach the stand-in site above.
  server = createServer(createApp({ db: database.db, reach: { fetcher: webFetcher, sealer: vault(path.join(folder, 'keys'), 'media_source') } }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  try {
    expect((await admin.get('/api/kitchen/recipes/from-web')).json).toMatchObject({ available: true, service: { name: 'Recipes from a website' } });
    const draft = await admin.post('/api/kitchen/recipes/from-web', { url: `${at}/soup` });
    expect([draft.status, draft.json]).toEqual([200, expect.objectContaining({ title: 'Leek soup', ingredients_text: '3 leeks', steps_text: 'Simmer.', source_url: `${at}/soup` })]);
    expect((await admin.post('/api/kitchen/recipes/from-web', { url: `${at}/nothing` })).status).toBe(400);
    expect((await admin.post('/api/kitchen/recipes/from-web', {})).status).toBe(422);
    const read = await admin.post('/api/kitchen/recipes/read', { text: 'Toast\n\nIngredients\n2 slices bread\n\nMethod\nToast it.' });
    expect(read.json).toMatchObject({ title: 'Toast', ingredients_text: '2 slices bread', steps_text: 'Toast it.' });
    expect((await admin.get('/api/kitchen/recipes')).json).toEqual([]); // drafts only
    const saved = await admin.post('/api/kitchen/recipes', { ...draft.json, tags: [] });
    expect([saved.status, saved.json.source_url, saved.json.original_text.includes('recipeIngredient')]).toEqual([201, `${at}/soup`, true]);
    expect((await visitor().post('/api/kitchen/recipes/from-web', { url: `${at}/soup` })).status).toBe(401);
  } finally {
    await new Promise((resolve) => site.close(resolve));
  }
});
