/**
 * A photo library, tried against a stand-in Immich: a small web server here that answers the way Immich's
 * published API description says it does (the x-api-key header, POST /api/search/metadata, and
 * GET /api/assets/{id}/thumbnail).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { webFetcher } from '../src/connectionRoutes.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
const KEY = 'an-immich-key-for-testing';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const VIDEO = '33333333-3333-4333-8333-333333333333';
const LATE = '44444444-4444-4444-8444-444444444444';
const ODD = '55555555-5555-4555-8555-555555555555';

let immich: Server;
let immichUrl: string;
let asked: string[];
let changed: string[];
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;

function startImmich(): Promise<void> {
  immich = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://immich');
    const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    asked.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/api/search/metadata')) changed.push(`${req.method} ${url.pathname}`);
    if (req.headers['x-api-key'] === 'a-key-with-no-permissions') return json(403, { message: 'Missing required permission: asset.read' });
    if (req.headers['x-api-key'] !== KEY) return json(401, { message: 'Invalid API key' });
    if (req.method === 'POST' && url.pathname === '/api/search/metadata') {
      return json(200, { albums: { items: [] }, assets: { nextPage: null, items: [
        { id: B, type: 'IMAGE', originalFileName: 'IMG_0002.jpg', fileCreatedAt: '2046-03-03T20:30:00.000Z', localDateTime: '2046-03-03T14:30:00.000Z' },
        { id: A, type: 'IMAGE', originalFileName: 'IMG_0001.jpg', fileCreatedAt: '2046-03-03T16:00:00.000Z', localDateTime: '2046-03-03T10:00:00.000Z' },
        { id: VIDEO, type: 'VIDEO', originalFileName: 'MOV_0003.mp4', fileCreatedAt: '2046-03-03T17:00:00.000Z', localDateTime: '2046-03-03T11:00:00.000Z' },
        // Taken late on the 2nd where the person was, though the library files it under the 3rd.
        { id: LATE, type: 'IMAGE', originalFileName: 'IMG_0000.jpg', fileCreatedAt: '2046-03-03T04:00:00.000Z', localDateTime: '2046-03-02T22:00:00.000Z' },
      ] } });
    }
    const thumb = /^\/api\/assets\/([^/]+)\/thumbnail$/.exec(url.pathname);
    if (thumb && thumb[1] === ODD) return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end('<html><script>alert(1)</script></html>');
    if (thumb && [A, B].includes(thumb[1]!)) return res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(Buffer.concat([JPEG, Buffer.from(url.searchParams.get('size') ?? '')]));
    return json(404, { message: 'Not found' });
  });
  return new Promise((resolve) => immich.listen(0, '127.0.0.1', () => {
    immichUrl = `http://127.0.0.1:${(immich.address() as AddressInfo).port}`;
    resolve();
  }));
}

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown) {
    const response = await fetch(base + address, {
      method, headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const bytes = Buffer.from(await response.arrayBuffer());
    const json = response.headers.get('content-type') === 'application/json' ? JSON.parse(bytes.toString('utf8')) : undefined;
    return { status: response.status, json, bytes, headers: response.headers };
  }
  return {
    get: (address: string) => ask('GET', address), post: (address: string, body?: unknown) => ask('POST', address, body),
    put: (address: string, body?: unknown) => ask('PUT', address, body), delete: (address: string) => ask('DELETE', address),
  };
}

beforeEach(async () => {
  asked = [];
  changed = [];
  await startImmich();
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, photos: { fetcher: webFetcher, sealer: vault(path.join(folder, 'keys'), 'photo_library') } }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => immich.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

it('a photo library is connected only when its key works, and photos are linked, never copied', async () => {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  const off = (await admin.get('/api/photos')).json;
  expect([off.available, off.connected, off.url, off.service.name, off.service.needs.includes('asset.read and asset.view')]).toEqual([true, false, null, 'Immich', true]);
  expect(asked).toEqual([]);

  const wrong = await admin.put('/api/photos', { url: immichUrl, key: 'not-the-key' });
  expect([wrong.status, wrong.json.detail]).toEqual([400, "Immich didn't accept that key"]);
  expect((await admin.put('/api/photos', { url: immichUrl, key: 'a-key-with-no-permissions' })).json.detail).toContain('asset.read and asset.view');
  expect((await admin.put('/api/photos', { url: 'http://127.0.0.1:1', key: KEY })).json.detail).toContain("Couldn't reach Immich");
  expect((await admin.put('/api/photos', { url: 'ftp://somewhere', key: KEY })).status).toBe(400);
  expect((await admin.get('/api/photos')).json.connected).toBe(false);

  // The address may be given with or without the /api on the end.
  const on = (await admin.put('/api/photos', { url: `${immichUrl}/api/`, key: KEY })).json;
  expect([on.connected, on.url]).toEqual([true, immichUrl]);
  const stored = JSON.parse((await database.db.get<{ value: string }>("SELECT value FROM user_settings WHERE key = 'photo_library'"))!.value);
  expect([stored.key.startsWith('sealed:v1:'), JSON.stringify(stored).includes(KEY), JSON.stringify((await admin.get('/api/photos')).json).includes(KEY)]).toEqual([true, false, false]);

  // A memory of Saturday the 3rd: the library is asked what was taken that day.
  const plan = (await admin.post('/api/plans', { name: 'Saturday sewing', start_day: '2046-03-03' })).json;
  const offered = (await admin.get(`/api/plans/${plan.id}/library`)).json;
  expect(offered).toEqual([
    { id: A, name: 'IMG_0001.jpg', taken: '2046-03-03T10:00', linked: false }, { id: B, name: 'IMG_0002.jpg', taken: '2046-03-03T14:30', linked: false },
  ]); // pictures only, oldest first, and not the one taken the evening before
  const thumb = await admin.get(`/api/photos/thumb?id=${A}`);
  expect([thumb.status, thumb.headers.get('content-type'), thumb.bytes.toString('latin1').endsWith('thumbnail')]).toEqual([200, 'image/jpeg', true]);
  expect((await admin.get('/api/photos/thumb?id=../../etc/passwd')).status).toBe(400);
  // Whatever the library calls it, something that isn't a picture is never passed on as one.
  expect((await admin.get(`/api/photos/thumb?id=${ODD}`)).status).toBe(400);

  const linked = await admin.post(`/api/plans/${plan.id}/photos/linked`, { ids: [A, B, A] });
  expect([linked.status, linked.json.photos_list.map((p: { source: string }) => p.source)]).toEqual([201, ['immich', 'immich']]);
  expect((await admin.get(`/api/plans/${plan.id}/library`)).json.map((p: { linked: boolean }) => p.linked)).toEqual([true, true]);
  const shown = await admin.get(`/api/plans/photos/${linked.json.photos_list[0].id}`);
  expect([shown.status, shown.headers.get('content-type'), shown.bytes.toString('latin1').endsWith('preview')]).toEqual([200, 'image/jpeg', true]);
  // Only which photo it is was kept: no picture is in the database.
  expect(await database.db.all('SELECT source, asset_id, bytes FROM plan_photos ORDER BY id')).toEqual([{ source: 'immich', asset_id: A, bytes: null }, { source: 'immich', asset_id: B, bytes: null }]);

  // Someone else in the house has no library, and can't see these photos through Life Is.
  expect((await admin.post('/api/users', { username: 'other', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  await other.post('/api/auth/login', { username: 'other', password: PASSWORD });
  expect([(await other.get('/api/photos')).json.connected, (await other.get(`/api/photos/thumb?id=${A}`)).status, (await other.get(`/api/plans/photos/${linked.json.photos_list[0].id}`)).status]).toEqual([false, 400, 404]);
  expect((await visitor().get(`/api/photos/thumb?id=${A}`)).status).toBe(401);

  // Disconnecting forgets the key. The links stay, and simply can't be shown until it's connected again.
  expect((await admin.delete('/api/photos')).json.connected).toBe(false);
  expect((await database.db.get("SELECT value FROM user_settings WHERE key = 'photo_library'"))).toBeUndefined();
  expect((await admin.get(`/api/plans/photos/${linked.json.photos_list[0].id}`)).status).toBe(400);
  expect((await admin.get(`/api/plans/${plan.id}`)).json.photos).toBe(2);

  // Through all of it, nothing in the library was changed.
  expect(changed).toEqual([]);
});

it('without a way to reach outside, no library can be connected', async () => {
  await new Promise((resolve) => server.close(resolve));
  server = createServer(createApp({ db: database.db }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  expect((await admin.get('/api/photos')).json.available).toBe(false);
  expect((await admin.put('/api/photos', { url: immichUrl, key: KEY })).status).toBe(400);
  expect(asked).toEqual([]);
});

it('a project keeps pictures kept here and linked from the library, and shows them to its person only', async () => {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  const project = (await admin.post('/api/projects', { name: 'Bookshelf', status: 'active' })).json;
  expect(project.pictures).toEqual([]);

  const kept = await admin.post(`/api/projects/${project.id}/pictures`, { data: JPEG.toString('base64'), kind: 'idea', caption: 'Oak' });
  expect([kept.status, kept.json.pictures.map((p: { kind: string; caption: string; source: string }) => [p.kind, p.caption, p.source])]).toEqual([201, [['idea', 'Oak', 'kept']]]);
  expect((await admin.post(`/api/projects/${project.id}/pictures`, { data: JPEG.toString('base64'), kind: 'both' })).status).toBe(400);
  expect((await admin.post(`/api/projects/${project.id}/pictures`, { data: 'AAAA', kind: 'idea' })).status).toBe(400);
  const shown = await admin.get(`/api/projects/pictures/${kept.json.pictures[0].id}`);
  expect([shown.status, shown.headers.get('content-type'), shown.headers.get('cache-control')]).toEqual([200, 'image/jpeg', 'private, max-age=604800']);

  // Nothing is asked of the library until it is connected.
  expect((await admin.get(`/api/projects/${project.id}/library?start=2046-03-03&end=2046-03-03`)).status).toBe(400);
  expect((await admin.put('/api/photos', { url: immichUrl, key: KEY })).json.connected).toBe(true);
  expect((await admin.get(`/api/projects/${project.id}/library?start=2046-03-03&end=2046-03-03`)).json.map((p: { id: string; linked: boolean }) => [p.id, p.linked])).toEqual([[A, false], [B, false]]);
  const linked = await admin.post(`/api/projects/${project.id}/pictures/linked`, { ids: [A, A, B], kind: 'mine' });
  expect([linked.status, linked.json.pictures.map((p: { kind: string; source: string }) => `${p.kind}:${p.source}`)]).toEqual([201, ['idea:kept', 'mine:immich', 'mine:immich']]);
  expect((await admin.get(`/api/projects/${project.id}/library?start=2046-03-03&end=2046-03-03`)).json.map((p: { linked: boolean }) => p.linked)).toEqual([true, true]);
  const far = await admin.get(`/api/projects/pictures/${linked.json.pictures[1].id}`);
  expect([far.status, far.headers.get('content-type'), far.bytes.toString('latin1').endsWith('preview')]).toEqual([200, 'image/jpeg', true]);
  expect(await database.db.all('SELECT source, kind, asset_id, bytes FROM project_pictures WHERE source = ? ORDER BY id', ['immich'])).toEqual([{ source: 'immich', kind: 'mine', asset_id: A, bytes: null }, { source: 'immich', kind: 'mine', asset_id: B, bytes: null }]);

  const changed1 = await admin.put(`/api/projects/pictures/${kept.json.pictures[0].id}`, { caption: null, kind: 'mine' });
  expect(changed1.json.pictures[0]).toMatchObject({ caption: null, kind: 'mine' });
  expect((await admin.put(`/api/projects/pictures/${kept.json.pictures[0].id}`, { caption: 'Again' })).json.pictures[0]).toMatchObject({ caption: 'Again', kind: 'mine' });

  // Someone else in the house can't see or change them.
  expect((await admin.post('/api/users', { username: 'other', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  await other.post('/api/auth/login', { username: 'other', password: PASSWORD });
  const id = kept.json.pictures[0].id;
  expect([(await other.get(`/api/projects/pictures/${id}`)).status, (await other.put(`/api/projects/pictures/${id}`, { caption: 'x' })).status, (await other.delete(`/api/projects/pictures/${id}`)).status,
    (await other.post(`/api/projects/${project.id}/pictures`, { data: JPEG.toString('base64'), kind: 'idea' })).status]).toEqual([404, 404, 404, 404]);
  expect((await visitor().get(`/api/projects/pictures/${id}`)).status).toBe(401);

  // Taking one off; the linked ones stay in the library.
  expect((await admin.delete(`/api/projects/pictures/${id}`)).json.pictures).toHaveLength(2);
  expect((await admin.get(`/api/projects/pictures/${id}`)).status).toBe(404);
  expect(changed).toEqual([]);
});
