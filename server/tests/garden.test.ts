/** The garden over the web addresses: plants in places, watering with rain, frost dates, harvests to the pantry, photos, and the download. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { vault } from '../src/vault.ts';
import { isPaidPath, splitDownload } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';

const PASSWORD = 'correct-horse-battery';
// 2046-03-05 is a Monday.
const MONDAY = new Date(2046, 2, 5, 10, 0, 0);
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time: Date;
const errors: unknown[] = [];

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + address, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, json: type.startsWith('application/json') ? JSON.parse(text) : undefined, text, bytes };
  }
  return {
    get: (address: string, headers?: Record<string, string>) => ask('GET', address, undefined, headers),
    post: (address: string, body?: unknown, headers?: Record<string, string>) => ask('POST', address, body, headers),
    put: (address: string, body?: unknown) => ask('PUT', address, body),
    delete: (address: string) => ask('DELETE', address),
  };
}
type Someone = ReturnType<typeof visitor>;

async function owner() {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  return admin;
}
async function member(admin: Someone, username: string) {
  expect((await admin.post('/api/users', { username, password: PASSWORD })).status).toBe(201);
  const someone = visitor();
  expect((await someone.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return someone;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const asked: string[] = [];
const fetcher = async (url: string) => {
  asked.push(url);
  let data: unknown;
  if (url.startsWith('https://archive-api.open-meteo.com/')) {
    const time: string[] = [];
    const low: number[] = [];
    for (let year = 2035; year <= 2044; year += 1) { time.push(`${year}-03-20`, `${year}-11-05`); low.push(-1, -1); }
    data = { daily: { time, temperature_2m_min: low } };
  } else if (url.includes('daily=precipitation_sum')) data = { daily: { time: ['2046-03-02', '2046-03-03', '2046-03-04', '2046-03-05'], precipitation_sum: [0.7, 0, 0, 0] } };
  else data = { current: { temperature_2m: 40, weather_code: 0 }, daily: { time: ['2046-03-05', '2046-03-06', '2046-03-07'], weather_code: [0, 0, 0], temperature_2m_max: [50, 52, 55], temperature_2m_min: [30, 36, 40], precipitation_probability_max: [0, 0, 0] } };
  return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
};

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  asked.length = 0;
  time = MONDAY;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => time, reach: { fetcher, sealer: vault(path.join(folder, 'keys'), 'media_source') }, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

it('the garden is a paid part, and a plant is a thing in a place that is watered with one tap, with rain counting', async () => {
  expect(isPaidPath('/api/garden/plants')).toBe(true);
  const admin = await owner();
  expect((await admin.put('/api/life', { areas: ['gardening'] })).status).toBe(200);
  const places = (await admin.post('/api/things/places', { name: 'Back bed' })).json;
  const bed = places.find((p: { name: string }) => p.name === 'Back bed').id;

  // Frost dates, typed by hand while the weather is off. Nothing is asked of the outside.
  expect((await admin.post('/api/garden/frost/work-out', {})).status).toBe(400);
  const typed = await admin.put('/api/garden/frost', { last_spring: '2046-03-20', first_fall: '11-05' });
  expect([typed.status, typed.json.last_spring, typed.json.first_fall, typed.json.how]).toEqual([200, '03-20', '11-05', 'typed']);
  expect((await admin.put('/api/garden/frost', { last_spring: 'later' })).status).toBe(400);
  expect(asked).toEqual([]);

  // A plant in the bed.
  expect((await admin.post('/api/garden/plants', { place_id: bed })).status).toBe(422);
  const made = await admin.post('/api/garden/plants', { name: 'Collards', place_id: bed, planted_on: '2046-02-26', water_every: 4 });
  expect(made.status).toBe(201);
  expect([made.json.place, made.json.kind_name, made.json.water.due]).toEqual(['Back bed', 'Vegetables and herbs', true]);
  const id: number = made.json.id;
  expect((await admin.get('/api/things/items')).json.map((t: { name: string; place: string }) => [t.name, t.place])).toEqual([['Collards', 'Back bed']]);

  // Weather on: 0.7 in of rain on Friday counts as watered, and the card says so, and warns of frost tonight.
  expect((await admin.put('/api/weather', { name: 'Springfield', latitude: 37.2153, longitude: -93.2982, units: 'f' })).status).toBe(200);
  const card = (await admin.get('/api/garden/card')).json;
  expect(card.water.due).toEqual([]);
  expect(card.water.skipped.map((p: { name: string; water: { rain: { says: string } } }) => [p.name, p.water.rain.says])).toEqual([['Collards', 'Rain on Friday: 0.7 in']]);
  expect(card.warnings.map((w: { says: string }) => w.says)).toEqual(['Frost tonight: low 30°']);
  expect((await admin.get('/api/home')).json.cards).toContain('garden');

  // Frost dates worked out from the town's past years, asking only for the same rounded place.
  const worked = await admin.post('/api/garden/frost/work-out', {});
  expect([worked.json.last_spring, worked.json.first_fall, worked.json.how]).toEqual(['03-20', '11-05', 'weather']);
  const archive = new URL(asked.find((u) => u.startsWith('https://archive-api.open-meteo.com/'))!);
  expect([archive.searchParams.get('latitude'), archive.searchParams.get('longitude')]).toEqual(['37.22', '-93.3']);

  // Weather off again: the same plant is simply due, and one tap waters it.
  expect((await admin.delete('/api/weather')).status).toBe(200);
  expect((await admin.get('/api/garden/card')).json.water.due.map((p: { name: string }) => p.name)).toEqual(['Collards']);
  const watered = await admin.post(`/api/garden/plants/${id}/water`, {});
  expect([watered.status, watered.json.water.due, watered.json.water.last_done, watered.json.water.due_on]).toEqual([200, false, '2046-03-05', '2046-03-09']);
});

it('a harvest goes to the pantry, how it did is kept, a photo is kept, and the garden is in the download', async () => {
  const admin = await owner();
  expect((await admin.put('/api/life', { areas: ['gardening'] })).status).toBe(200);
  const made = await admin.post('/api/garden/plants', { name: 'Okra', planted_on: '2046-03-01' });
  const id: number = made.json.id;
  const harvest = await admin.post(`/api/garden/plants/${id}/harvests`, { amount: 2, unit: 'lb', pantry: true });
  expect([harvest.status, harvest.json.pantry]).toEqual([201, 'okra is in your pantry']);
  expect((await admin.get('/api/kitchen/pantry')).json.items.map((p: { name: string; quantity: number }) => [p.name, p.quantity])).toEqual([['okra', 2]]);
  expect((await admin.put(`/api/garden/plants/${id}/how-it-did`, { text: 'Loved the heat' })).json.how_it_did).toBe('Loved the heat');
  const again = await admin.post(`/api/garden/plants/${id}/planted`, { day: '2046-04-01' });
  expect([again.json.last_time, again.json.plant.planted_on]).toEqual(['Loved the heat', '2046-04-01']);
  const photo = await admin.post(`/api/garden/plants/${id}/photos`, { data: PNG.toString('base64'), caption: 'June' });
  expect([photo.status, photo.json.photos]).toEqual([201, 1]);
  const shown = await admin.get(`/api/garden/photos/${photo.json.photos_list[0].id}`);
  expect([shown.status, shown.bytes.length]).toEqual([200, PNG.length]);
  const garden = (await admin.get('/api/garden')).json;
  expect([garden.plants.length, garden.crops.length > 20, garden.harvests.totals]).toEqual([1, true, [{ unit: 'lb', amount: 2 }]]);

  const zip = await admin.get('/api/export/everything.zip');
  expect(zip.status).toBe(200);
  const parts = await splitDownload(new Uint8Array(zip.bytes));
  expect(parts.files['garden.csv']).toContain('Okra');
  expect(parts.files['garden-harvests.csv']).toContain('2,lb');

  // Someone else in the house cannot reach it.
  const other = await member(admin, 'partner');
  expect((await other.get(`/api/garden/plants/${id}`)).status).toBe(404);
  expect((await other.post(`/api/garden/plants/${id}/water`, {})).status).toBe(404);
  expect((await other.get(`/api/garden/photos/${photo.json.photos_list[0].id}`)).status).toBe(404);
  expect((await other.get('/api/garden')).json.plants).toEqual([]);
});
