/**
 * Media servers, tried against a stand-in Jellyfin: a small web server here that answers the way Jellyfin's
 * published API says it does (the Authorization header, /Items in pages, pictures without a key).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { syncDue, webFetcher } from '../src/connectionRoutes.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
const KEY = 'a-jellyfin-key-for-testing';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

type Item = Record<string, unknown> & { Id: string; Name: string; Type: string };
let library: Item[];
let pictureAsks: number;
let shortPages = false;
let itemAsks: number;
let jellyfin: Server;
let jellyfinUrl: string;

let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time: Date | null;
let reach: { fetcher: typeof webFetcher; sealer: ReturnType<typeof vault> };

const movie = (n: number): Item => ({ Id: `filler-${n}`, Name: `Filler film ${String(n).padStart(3, '0')}`, Type: 'Movie', ProductionYear: 2000, ImageTags: {} });

function startJellyfin(): Promise<void> {
  jellyfin = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://jellyfin');
    const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    if (url.pathname === '/System/Info/Public') return json(200, { ServerName: 'LC Media', ProductName: 'Jellyfin Server', Version: '10.11.11' });
    const picture = /^\/Items\/([^/]+)\/Images\/Primary$/.exec(url.pathname);
    if (picture) {
      pictureAsks += 1;
      return res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
    }
    if (url.pathname === '/Items') {
      if (req.headers.authorization !== `MediaBrowser Token="${KEY}"`) return json(401, {});
      itemAsks += 1;
      const start = Number(url.searchParams.get('startIndex') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      // As Jellyfin does: a film that belongs to a collection is hidden behind it unless the request says not to.
      const shown = url.searchParams.get('collapseBoxSetItems') === 'false' ? library : library.filter((item) => !item.InCollection);
      // And a page may come back shorter than asked for, with the count still saying how many there are.
      const page = shown.slice(start, start + limit).filter((item) => !shortPages || item.Id !== shown[start]?.Id || start === 0);
      return json(200, { Items: page, TotalRecordCount: shown.length, StartIndex: start });
    }
    return json(404, {});
  });
  return new Promise((resolve) => jellyfin.listen(0, '127.0.0.1', () => {
    jellyfinUrl = `http://127.0.0.1:${(jellyfin.address() as AddressInfo).port}`;
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
  library = [
    { Id: 'a1', Name: 'Alien', Type: 'Movie', ProductionYear: 1979, RunTimeTicks: 70_200_000_000, Overview: 'In space no one can hear you scream.',
      Genres: ['Horror', 'Science Fiction'], ProviderIds: { Tmdb: '348', Imdb: 'tt0078748' }, ImageTags: { Primary: 'abc' } },
    { Id: 's1', Name: 'Twin Peaks', Type: 'Series', ProductionYear: 1990, ImageTags: { Primary: 'def' } },
    { Id: 'm1', Name: 'Blue', Type: 'MusicAlbum', ProductionYear: 1971, AlbumArtist: 'Joni Mitchell', ImageTags: {} },
    { Id: 'b1', Name: 'Dune', Type: 'Book', ProductionYear: 1965, ImageTags: {} },
    { Id: 'e1', Name: 'Not kept: an episode', Type: 'Episode' },
    ...[...Array(450)].map((_, n) => movie(n)), // more than two pages
  ];
  pictureAsks = 0;
  itemAsks = 0;
  shortPages = false;
  time = null;
  await startJellyfin();
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  reach = { fetcher: webFetcher, sealer: vault(path.join(folder, 'keys'), 'media_source') };
  server = createServer(createApp({ db: database.db, clock: () => time ?? new Date(), reach }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => jellyfin.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

async function owner() {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  return admin;
}

const titles = async (who: ReturnType<typeof visitor>, query = '') =>
  (await who.get(`/api/media${query}`)).json.map((m: { title: string; formats: string[] }) => `${m.title} [${m.formats.join(', ')}]`);

it('a server is only saved when its address and key work, and its key is stored locked', async () => {
  const admin = await owner();
  const nowhere = await admin.post('/api/connections', { kind: 'jellyfin', url: 'http://127.0.0.1:9', secret: KEY });
  expect([nowhere.status, nowhere.json.detail]).toEqual([400, expect.stringContaining("Couldn't reach Jellyfin")]);
  expect(nowhere.json.detail).toContain('host.docker.internal');
  expect((await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl, secret: 'wrong' })).json.detail).toBe("Jellyfin didn't accept that key");
  expect((await admin.post('/api/connections', { kind: 'jellyfin', url: base, secret: KEY })).status).toBe(400); // an address that isn't a Jellyfin
  expect((await admin.post('/api/connections', { kind: 'jellyfin', url: 'ftp://x', secret: KEY })).status).toBe(400);
  expect((await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl })).status).toBe(400);
  expect((await admin.post('/api/connections', { kind: 'plex', url: jellyfinUrl, secret: KEY })).status).toBe(400);
  expect((await admin.get('/api/connections')).json).toEqual([]);

  const made = await admin.post('/api/connections', { kind: 'jellyfin', url: `${jellyfinUrl}/`, secret: ` ${KEY} `, every_hours: 6 });
  expect(made.status).toBe(201);
  expect(made.json).toEqual([{ id: 1, kind: 'jellyfin', name: 'LC Media', url: jellyfinUrl, every_hours: 6, last_sync_at: null, last_ok: null, last_message: null, copies: 0 }]);
  expect(JSON.stringify(made.json)).not.toContain(KEY); // the key is never given back
  const stored = (await database.db.get<{ secret: string }>('SELECT secret FROM media_sources'))!.secret;
  expect(stored).toMatch(/^sealed:v1:/);
  expect(stored).not.toContain(KEY);
  expect(reach.sealer.unseal(stored)).toBe(KEY);
  expect(vault(path.join(folder, 'keys'), 'something else').unseal(stored)).toBeNull(); // locked for this purpose only
  expect(vault(path.join(folder, 'other-keys'), 'media_source').unseal(stored)).toBeNull(); // and for this computer's key only
});

it('syncing brings the library in, joins what you already have, and keeps the covers here', async () => {
  const admin = await owner();
  // Already in the collection: Alien on VHS (known by its TMDB number), and a wanted album.
  const vhs = (await admin.post('/api/media', { type: 'film', title: 'Alien (my tape)', ids: { tmdb: '348' }, copy: { format: 'VHS' } })).json;
  const wanted = (await admin.post('/api/media', { type: 'music', title: 'blue', year: 1971, wanted: true })).json;
  const id = (await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl, secret: KEY })).json[0].id;

  const first = await admin.post(`/api/connections/${id}/sync`);
  expect(first.status).toBe(200);
  expect(first.json).toMatchObject({ total: 454, added: 454, titles_added: 452, removed: 0, covers: 2 });
  expect(first.json.connections[0]).toMatchObject({ copies: 454, last_ok: true, last_message: '454 on the server, 454 added' });
  expect(itemAsks).toBe(1 + 3); // the check when connecting, then three pages
  expect((await titles(admin, '?q=alien'))).toEqual(['Alien (my tape) [VHS, Jellyfin]']); // one film, two copies
  expect((await admin.get(`/api/media/${wanted.id}`)).json).toMatchObject({ wanted: false, formats: ['Jellyfin'] });
  expect(await titles(admin, '?type=show')).toEqual(['Twin Peaks [Jellyfin]']);
  expect(await titles(admin, '?type=book')).toEqual(['Dune [Jellyfin]']);
  expect(await titles(admin, '?q=episode')).toEqual([]);
  const peaks = (await admin.get('/api/media?type=show')).json[0];
  expect(peaks.cover).toBe(`/api/media/${peaks.id}/cover`);
  const cover = await admin.get(peaks.cover);
  expect([cover.status, cover.headers.get('content-type'), cover.headers.get('cache-control'), cover.bytes.equals(PNG)]).toEqual([200, 'image/png', 'private, max-age=604800', true]);
  expect((await admin.get(`/api/media/${wanted.id}/cover`)).status).toBe(404);

  // Again, with nothing changed: nothing is added, and no picture is fetched twice.
  const again = (await admin.post(`/api/connections/${id}/sync`)).json;
  expect([again.added, again.removed, again.covers, pictureAsks]).toEqual([0, 0, 0, 2]);
  expect((await admin.get('/api/media')).json).toHaveLength(454); // 452 new titles, and the two that were already here

  // Things leave the server: a filler film nobody touched, one that was watched, Alien, and the album.
  const watched = (await admin.get('/api/media?q=Filler film 001')).json[0];
  await admin.post(`/api/media/${watched.id}/log`, { day: '2046-03-05' });
  library = library.filter((item) => !['filler-0', 'filler-1', 'a1', 'm1'].includes(item.Id));
  library.push({ Id: 'new-1', Name: 'Arrival', Type: 'Movie', ProductionYear: 2016, ImageTags: {} });
  const later = (await admin.post(`/api/connections/${id}/sync`)).json;
  expect([later.total, later.added, later.removed, later.connections[0].last_message]).toEqual([451, 1, 4, '451 on the server, 1 added, 4 gone']);
  expect(await titles(admin, '?q=Filler film 000')).toEqual([]); // only ever there for the server: gone with it
  expect(await titles(admin, '?q=Filler film 001')).toEqual(['Filler film 001 []']); // watched: stays
  expect(await titles(admin, '?q=alien')).toEqual(['Alien (my tape) [VHS]']); // the tape is still yours
  expect(await titles(admin, '?q=arrival')).toEqual(['Arrival [Jellyfin]']);
  expect((await admin.get(`/api/media/${vhs.id}`)).json.copies).toHaveLength(1);

  // Someone else in the house sees none of it, and can't sync or reach the covers.
  expect((await admin.post('/api/users', { username: 'partner', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  await other.post('/api/auth/login', { username: 'partner', password: PASSWORD });
  expect([(await other.get('/api/connections')).json, (await other.get('/api/media')).json]).toEqual([[], []]);
  expect([(await other.post(`/api/connections/${id}/sync`)).status, (await other.get(peaks.cover)).status, (await other.delete(`/api/connections/${id}`)).status]).toEqual([404, 404, 404]);
});

it('a server set to sync by itself is synced when its time comes, and says so when it can\'t be reached', async () => {
  const admin = await owner();
  const id = (await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl, secret: KEY, every_hours: 6 })).json[0].id;
  await admin.put('/api/account', { idle_minutes: 0 }); // stay signed in while the test moves the clock on by hours
  const clock = () => time ?? new Date();
  expect(await syncDue(database.db, clock, reach)).toBe(1); // never synced: due straight away
  expect((await admin.get('/api/media')).json).toHaveLength(454);
  expect(await syncDue(database.db, clock, reach)).toBe(0); // not due again yet
  library.push({ Id: 'new-1', Name: 'Arrival', Type: 'Movie', ProductionYear: 2016 });
  time = new Date(Date.now() + 5 * 3_600_000);
  expect(await syncDue(database.db, clock, reach)).toBe(0);
  time = new Date(Date.now() + 7 * 3_600_000);
  expect(await syncDue(database.db, clock, reach)).toBe(1);
  expect(await titles(admin, '?q=arrival')).toEqual(['Arrival [Jellyfin]']);

  // Changing it to "only when I ask" takes it off the schedule; the saved key stays when none is sent.
  expect((await admin.put(`/api/connections/${id}`, { url: jellyfinUrl, name: 'The media box', every_hours: 0 })).json[0]).toMatchObject({ name: 'The media box', every_hours: 0 });
  time = new Date(Date.now() + 30 * 3_600_000);
  expect(await syncDue(database.db, clock, reach)).toBe(0);
  expect((await admin.post(`/api/connections/${id}/sync`)).status).toBe(200);

  // The server goes away: nothing in the collection is touched, and the connection says what happened.
  await new Promise((resolve) => jellyfin.close(resolve));
  const failed = await admin.post(`/api/connections/${id}/sync`);
  expect([failed.status, failed.json.detail]).toEqual([400, expect.stringContaining("Couldn't reach Jellyfin")]);
  expect((await admin.get('/api/connections')).json[0]).toMatchObject({ last_ok: false, copies: 455 });
  expect((await admin.get('/api/media')).json).toHaveLength(455);
  await startJellyfin(); // for afterEach to close
});

it('films inside a collection come in too, and a short page does not end the sync early', async () => {
  const admin = await owner();
  // Nearly half the films sit in collections, as in a real library with collections set up.
  library = library.map((item, n) => (item.Type === 'Movie' && n % 2 === 0 ? { ...item, InCollection: true } : item));
  const films = library.filter((item) => item.Type === 'Movie').length;
  const id = (await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl, secret: KEY })).json[0].id;
  const synced = (await admin.post(`/api/connections/${id}/sync`)).json;
  expect(synced.total).toBe(454);
  expect((await admin.get('/api/media?type=film')).json).toHaveLength(films);

  // The server starts giving pages one short of what was asked: every title still arrives, none is dropped as gone.
  shortPages = true;
  const again = (await admin.post(`/api/connections/${id}/sync`)).json;
  expect([again.total, again.removed]).toEqual([452, 2]); // each later page drops its first item: two pages, two items
  expect((await admin.get('/api/media?type=film')).json.length).toBeGreaterThan(films - 3);
});

it('removing a server keeps what it brought in, unless asked to take it too', async () => {
  const admin = await owner();
  await admin.post('/api/media', { type: 'film', title: 'Alien', year: 1979, copy: { format: 'VHS' } }); // joined by title and year
  library = library.slice(0, 4);
  const first = (await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl, secret: KEY })).json[0].id;
  await admin.post(`/api/connections/${first}/sync`);
  expect(await titles(admin)).toEqual(['Alien [VHS, Jellyfin]', 'Blue [Jellyfin]', 'Dune [Jellyfin]', 'Twin Peaks [Jellyfin]']);
  expect((await admin.delete(`/api/connections/${first}`)).json).toEqual([]);
  expect(await titles(admin)).toEqual(['Alien [VHS, Jellyfin]', 'Blue [Jellyfin]', 'Dune [Jellyfin]', 'Twin Peaks [Jellyfin]']); // kept, as ordinary copies

  // Connected again, the same library comes in beside them; removing "with what it brought in" takes only its own.
  const second = (await admin.post('/api/connections', { kind: 'jellyfin', url: jellyfinUrl, secret: KEY })).json[0].id;
  expect((await admin.post(`/api/connections/${second}/sync`)).json).toMatchObject({ added: 4, titles_added: 0 });
  expect((await admin.get('/api/media?q=alien')).json[0].formats).toEqual(['VHS', 'Jellyfin']);
  expect((await admin.delete(`/api/connections/${second}?with_copies=1`)).json).toEqual([]);
  expect((await admin.get('/api/media?q=alien')).json).toHaveLength(1);
  expect(((await admin.get(`/api/media/${(await admin.get('/api/media?q=alien')).json[0].id}`)).json.copies as unknown[]).length).toBe(2); // the tape, and the first server's copy
});
