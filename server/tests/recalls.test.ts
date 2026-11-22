/** Recall alerts over the web addresses, tried against a stand-in for NHTSA, so these tests never reach outside. */
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
const VIN = '4S4BTGPD5L3123456';
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let asked: string[];

const outside: Fetcher = async (url) => {
  asked.push(url);
  const known = url.includes('make=Subaru&model=Outback&modelYear=2019');
  const body = known ? { Count: 2, Message: 'Results returned successfully', results: [
    { NHTSACampaignNumber: '19V493000', Component: 'STRUCTURE', Summary: 'Spot welds may be bad.', Consequence: 'Injury.', Remedy: 'Free inspection.', ReportReceivedDate: '26/06/2019', parkIt: false, parkOutSide: false, overTheAirUpdate: false },
    { NHTSACampaignNumber: '20V001000', Component: 'FUEL SYSTEM', Summary: 'Fuel may leak.', Consequence: 'Fire.', Remedy: 'Free repair.', ReportReceivedDate: '02/01/2020', parkIt: false, parkOutSide: true, overTheAirUpdate: false },
  ] } : { Count: 0, Message: 'Results returned successfully', results: [] };
  return { status: known ? 200 : 400, type: 'application/json', json: async () => body, bytes: async () => new Uint8Array() };
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

async function aCar(admin: ReturnType<typeof visitor>, make: string, model: string, year: number | null) {
  await admin.post('/api/things/starters', { slug: 'car' });
  const kind = (await admin.get('/api/things/kinds')).json.find((k: { name: string }) => k.name === 'Vehicles');
  const field = (name: string) => String(kind.fields.find((f: { name: string }) => f.name === name).id);
  const made = await admin.post('/api/things/items', { kind_id: kind.id, name: `${model} that is mine`, values: { [field('Make')]: make, [field('Model')]: model, ...(year ? { [field('Year')]: year } : {}), [field('VIN')]: VIN } });
  expect(made.status).toBe(201);
  return made.json;
}

it('recall alerts are off until turned on, say what they send, check, and keep a dismissal', async () => {
  const admin = await start(true);
  const car = await aCar(admin, 'Subaru', 'Outback', 2019);
  const off = (await admin.get('/api/recalls')).json;
  expect([off.available, off.on, off.service.name, off.vehicles.length]).toEqual([true, false, 'Recall alerts', 1]);
  expect(off.service.sends).toContain('No VIN');
  expect((await admin.post('/api/recalls/check', { force: true })).status).toBe(400); // off
  expect((await admin.get(`/api/recalls/items/${car.id}`)).json).toMatchObject({ on: false, is_vehicle: true, vehicle: null });
  expect(asked).toEqual([]); // nothing leaves until asked

  expect((await admin.put('/api/recalls', {})).status).toBe(422);
  expect((await admin.put('/api/recalls', { on: true })).json.on).toBe(true);
  expect(asked).toEqual([]); // turning it on asks nothing by itself
  const checked = (await admin.post('/api/recalls/check', { force: true })).json;
  expect([checked.asked, checked.found, checked.status.vehicles[0].open]).toEqual([1, 1, 2]);
  expect(asked).toEqual(['https://api.nhtsa.gov/recalls/recallsByVehicle?make=Subaru&model=Outback&modelYear=2019']);
  expect(asked.join()).not.toContain(VIN);

  const thing = (await admin.get(`/api/recalls/items/${car.id}`)).json;
  expect(thing.vehicle.recalls.map((r: { campaign: string; park_outside: boolean }) => [r.campaign, r.park_outside])).toEqual([['20V001000', true], ['19V493000', false]]);
  const one = thing.vehicle.recalls[0];
  expect((await admin.post(`/api/recalls/${one.id}/dismiss`)).json.dismissed_at).not.toBeNull();
  const after = (await admin.get(`/api/recalls/items/${car.id}?dismissed=1`)).json;
  expect([after.vehicle.recalls.length, after.dismissed_count, after.dismissed.map((r: { campaign: string }) => r.campaign)]).toEqual([1, 1, ['20V001000']]);
  expect((await admin.get('/api/recalls/list')).json.vehicles[0].recalls).toHaveLength(1);
  expect((await admin.post(`/api/recalls/${one.id}/restore`)).json.dismissed_at).toBeNull();
  expect((await admin.post('/api/recalls/999/dismiss')).status).toBe(404);

  expect((await admin.put('/api/recalls', { on: false })).json.on).toBe(false);
  expect((await admin.get(`/api/recalls/items/${car.id}`)).json.vehicle).toBeNull();
  expect((await visitor().get('/api/recalls')).status).toBe(401);
});

it('a car missing its year is listed as needing details and never sent; an unknown car is not listed', async () => {
  const admin = await start(true);
  const noYear = await aCar(admin, 'Honda', 'Civic', null);
  await aCar(admin, 'Zorg', 'Z1', 2020);
  await admin.put('/api/recalls', { on: true });
  const status = (await admin.get('/api/recalls')).json;
  expect(status.needs_details).toEqual([{ item_id: noYear.id, name: 'Civic that is mine', missing: ['Year'] }]);
  const done = (await admin.post('/api/recalls/check', { force: true })).json;
  expect([done.asked, done.not_listed]).toEqual([1, 1]);
  expect(asked).toEqual(['https://api.nhtsa.gov/recalls/recallsByVehicle?make=Zorg&model=Z1&modelYear=2020']);
  expect(done.status.vehicles[0]).toMatchObject({ result: 'not_listed', message: expect.stringContaining('NHTSA has nothing under this make, model and year') });
  expect((await admin.get(`/api/recalls/items/${noYear.id}`)).json).toMatchObject({ is_vehicle: true, needs: ['Year'] });
});

it('a copy of Life Is that cannot reach outside says so, and refuses to turn recall alerts on', async () => {
  const admin = await start(false);
  const status = (await admin.get('/api/recalls')).json;
  expect([status.available, status.on]).toEqual([false, false]);
  expect((await admin.put('/api/recalls', { on: true })).status).toBe(400);
  expect((await admin.post('/api/recalls/check', { force: true })).status).toBe(400);
  expect(asked).toEqual([]);
});
