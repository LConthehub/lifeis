/**
 * Book servers and a list of books, over the web, against stand-ins: a small web server here that answers the
 * way Calibre-Web's OPDS catalogue and Audiobookshelf's API are documented to (not the real programs).
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
const JPEG = Buffer.from('ffd8ffe000104a46494600', 'hex');
let standIn: Server;
let standInUrl: string;
let titles: string[];
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let reach: { fetcher: typeof webFetcher; sealer: ReturnType<typeof vault> };

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
    return { status: response.status, json: response.headers.get('content-type') === 'application/json' ? JSON.parse(bytes.toString('utf8')) : undefined, headers: response.headers };
  }
  return {
    get: (address: string) => ask('GET', address), post: (address: string, body?: unknown) => ask('POST', address, body),
    put: (address: string, body?: unknown) => ask('PUT', address, body), delete: (address: string) => ask('DELETE', address),
  };
}
async function owner() {
  const me = visitor();
  await me.post('/api/auth/setup', { username: 'owner', password: PASSWORD });
  return me;
}

beforeEach(async () => {
  titles = ['Dune', 'Emma', 'Kindred'];
  standIn = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://books');
    if (url.pathname === '/opds/books/letter/00') {
      if (req.headers.authorization !== `Basic ${Buffer.from('reader:s3cret words').toString('base64')}`) return res.writeHead(401).end();
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const entries = titles.slice(offset, offset + 2).map((title, i) => `<entry><title>${title}</title><id>urn:uuid:${title}</id><author><name>Someone</name></author>
        <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/opds/download/${offset + i + 1}/epub/"/>
        <link rel="http://opds-spec.org/image" type="image/jpeg" href="/opds/cover/${offset + i + 1}"/></entry>`).join('');
      const next = offset + 2 < titles.length ? `<link rel="next" href="/opds/books/letter/00?offset=${offset + 2}" type="application/atom+xml;profile=opds-catalog"/>` : '';
      return res.writeHead(200, { 'Content-Type': 'application/atom+xml;profile=opds-catalog;charset=utf-8' }).end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${next}${entries}</feed>`);
    }
    if (url.pathname.startsWith('/opds/cover/')) return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
    if (url.pathname === '/api/libraries') {
      if (req.headers.authorization !== 'Bearer abs-token') return res.writeHead(401).end();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ libraries: [{ id: 'main', mediaType: 'book' }] }));
    }
    if (url.pathname === '/api/libraries/main/items') {
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ total: 1, results: [
        { id: 'li_1', media: { metadata: { title: 'Dune', authorName: 'Frank Herbert' }, numAudioFiles: 20, duration: 76000 } }] }));
    }
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => standIn.listen(0, '127.0.0.1', resolve));
  standInUrl = `http://127.0.0.1:${(standIn.address() as AddressInfo).port}`;
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  reach = { fetcher: webFetcher, sealer: vault(path.join(folder, 'keys'), 'media_source') };
  server = createServer(createApp({ db: database.db, reach }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => standIn.close(resolve));
  await database.close();
  rmSync(folder, { recursive: true, force: true });
});

it('Calibre-Web is connected, synced over its pages, and never sends its sign-in back', async () => {
  const me = await owner();
  expect((await me.post('/api/libraries', { kind: 'calibre-web', url: standInUrl, username: 'reader', password: 'wrong' })).json.detail).toBe("Calibre-Web didn't accept that sign-in");
  const made = await me.post('/api/libraries', { kind: 'calibre-web', url: standInUrl, username: 'reader', password: 's3cret words', every_hours: 6 });
  expect(made.status).toBe(201);
  expect(JSON.stringify(made.json)).not.toContain('s3cret');
  const id = made.json[0].id;
  const synced = (await me.post(`/api/libraries/${id}/sync`)).json;
  expect(synced).toMatchObject({ total: 3, added: 3, covers: 3 });
  expect(synced.libraries[0]).toMatchObject({ copies: 3, last_ok: true });
  const books = (await me.get('/api/media?type=book')).json;
  expect(books.map((b: { title: string }) => b.title)).toEqual(['Dune', 'Emma', 'Kindred']);
  expect((await me.get(`/api/media/${books[2].id}`)).json.copies[0]).toMatchObject({ format: 'eBook', link: `${standInUrl}/book/3` });
  expect((await me.get(`/api/media/${books[0].id}/cover`)).headers.get('content-type')).toBe('image/jpeg');

  // The same book on Audiobookshelf is a second copy of the one title; and both sync by themselves when due.
  const abs = (await me.post('/api/libraries', { kind: 'audiobookshelf', url: standInUrl, key: 'abs-token', every_hours: 1 })).json;
  expect(abs.map((s: { name: string }) => s.name)).toEqual(['Audiobookshelf', 'Calibre-Web']);
  titles.push('Persuasion');
  expect(await syncDue(database.db, () => new Date(Date.now() + 7 * 3_600_000), reach)).toBe(2);
  const dune = (await me.get(`/api/media/${books[0].id}`)).json;
  expect(dune.copies.map((c: { format: string }) => c.format).sort()).toEqual(['Audiobook', 'eBook']);
  expect((await me.get('/api/media?type=book')).json).toHaveLength(4);

  // Someone else sees none of it.
  await me.post('/api/users', { username: 'partner', password: PASSWORD });
  const partner = visitor();
  await partner.post('/api/auth/login', { username: 'partner', password: PASSWORD });
  expect((await partner.get('/api/libraries')).json).toEqual([]);
  expect((await partner.post(`/api/libraries/${id}/sync`)).status).toBe(404);
  expect((await me.delete(`/api/libraries/${id}?with_copies=1`)).json).toHaveLength(1);
  expect((await me.get('/api/media?type=book')).json.map((b: { title: string }) => b.title)).toEqual(['Dune']);
});

it('a list of books is looked over first, then brought in; a copy keeps a link', async () => {
  const me = await owner();
  const text = 'Title,Author,Exclusive Shelf,Date Read,Binding\nDune,Frank Herbert,read,2024/03/05,Kindle Edition\n"Emma",Jane Austen,to-read,,Paperback\n';
  expect((await me.post('/api/media/list/read', { text })).json).toMatchObject({ count: 2, to_read: 1, dated: 1, says_format: 2, first: [{ title: 'Dune', format: 'eBook' }, { title: 'Emma' }] });
  expect((await me.post('/api/media/list/read', { text: '' })).status).toBe(400);
  expect((await me.post('/api/media/list', { text })).json).toEqual({ listed: 2, added: 2, copies: 1, already: 0, wanted: 1, logged: 1 });
  const dune = (await me.get('/api/media?q=Dune')).json[0];
  const copy = (await me.get(`/api/media/${dune.id}`)).json.copies[0];
  const linked = await me.put(`/api/media/copies/${copy.id}`, { format: 'eBook', link: 'https://read.amazon.com/?asin=B00B7NPRY8' });
  expect(linked.json.copies[0].link).toBe('https://read.amazon.com/?asin=B00B7NPRY8');
  expect((await me.put(`/api/media/copies/${copy.id}`, { format: 'eBook', link: 'javascript:alert(1)' })).status).toBe(400);
});
