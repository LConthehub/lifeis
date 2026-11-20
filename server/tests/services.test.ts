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
import type { Fetcher } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
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
  const data = url.includes('geocoding-api')
    ? { results: [{ name: 'Springfield', admin1: 'Missouri', country: 'United States', latitude: 37.21533, longitude: -93.29824 }] }
    : { current: { temperature_2m: 7.2, weather_code: 61 },
      daily: { time: ['2046-03-05'], weather_code: [61], temperature_2m_max: [9.4], temperature_2m_min: [3.1], precipitation_probability_max: [90] } };
  return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
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
  server = createServer(createApp({ db: database.db, reach }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  return admin;
}

beforeEach(async () => {
  asked = [];
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
