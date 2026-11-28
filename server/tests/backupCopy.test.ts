/**
 * The second backup copy over HTTP: only the person in charge may change it, a copy is locked before it leaves,
 * it goes to a WebDAV folder (a small stand-in server started here, never a real one) or to a second drive's
 * folder, the newest three are kept, and a failure shows on the card and in the morning reminder.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { reminders } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { copyTools } from '../src/backupCopyRoutes.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
const PASSPHRASE = 'a long unlikely phrase';
const MAGIC = 'LIFEIS-BACKUP-1\n';

let folder: string;
let drive: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time = new Date(2046, 2, 5, 10, 0, 0);
let standIn: Server;
let dav: { files: Map<string, Buffer>; seen: { method: string; url: string; auth: string | undefined }[]; refuse: number | null };
let davBase: string;
const errors: unknown[] = [];

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown) {
    const response = await fetch(base + address, { method, headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const text = await response.text();
    return { status: response.status, json: response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : undefined, text };
  }
  return { get: (a: string) => ask('GET', a), post: (a: string, b?: unknown) => ask('POST', a, b), put: (a: string, b?: unknown) => ask('PUT', a, b), delete: (a: string) => ask('DELETE', a) };
}

async function start(withDrive: boolean) {
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  const sealers = { passphrase: vault(path.join(folder, 'keys'), 'backup_copy_passphrase'), secret: vault(path.join(folder, 'keys'), 'backup_copy_secret') };
  const tools = copyTools(sealers, withDrive ? drive : undefined);
  server = createServer(createApp({ db: database.db, backupCopy: tools, clock: () => time, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return tools;
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-copy-'));
  drive = path.join(folder, 'second-drive');
  time = new Date(2046, 2, 5, 10, 0, 0);
  errors.length = 0;
  dav = { files: new Map(), seen: [], refuse: null };
  // A small stand-in for a WebDAV folder: PUT, PROPFIND and DELETE on /backups/, with a user name and password.
  standIn = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      dav.seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization });
      if (dav.refuse) { res.writeHead(dav.refuse).end(); return; }
      if (req.headers.authorization !== `Basic ${Buffer.from('dana:app-password-1234').toString('base64')}`) { res.writeHead(401).end(); return; }
      const name = decodeURIComponent((req.url ?? '').replace(/^\/backups\/?/, ''));
      if (req.method === 'PUT') { dav.files.set(name, Buffer.concat(chunks)); res.writeHead(201).end(); }
      else if (req.method === 'DELETE') { dav.files.delete(name); res.writeHead(204).end(); }
      else if (req.method === 'PROPFIND') {
        const entries = ['/backups/', ...[...dav.files.keys()].map((n) => `/backups/${encodeURIComponent(n)}`)];
        res.writeHead(207, { 'Content-Type': 'application/xml' }).end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.map((e) => `<d:response><d:href>${e}</d:href></d:response>`).join('')}</d:multistatus>`);
      } else res.writeHead(405).end();
    });
  });
  await new Promise<void>((resolve) => standIn.listen(0, '127.0.0.1', resolve));
  davBase = `http://127.0.0.1:${(standIn.address() as AddressInfo).port}/backups`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => standIn.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

async function setup(withDrive = false) {
  const tools = await start(withDrive);
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  expect((await admin.post('/api/users', { username: 'partner', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  expect((await other.post('/api/auth/login', { username: 'partner', password: PASSWORD })).status).toBe(200);
  return { admin, other, tools };
}
const webdav = { place: 'webdav', address: undefined as string | undefined, username: 'dana', password: 'app-password-1234', passphrase: PASSPHRASE };

it('only the person in charge sees or changes it, it is off to begin with, and the drive is offered only when named', async () => {
  const { admin, other } = await setup(false);
  expect((await admin.get('/api/backup-copy')).json).toMatchObject({ available: true, admin: true, on: false, folder_offered: false, place: null, keep: 3 });
  expect((await other.get('/api/backup-copy')).json).toEqual({ available: true, admin: false });
  expect((await other.put('/api/backup-copy', { ...webdav, address: davBase })).status).toBe(403);
  expect((await other.post('/api/backup-copy/send')).status).toBe(403);
  expect((await admin.put('/api/backup-copy', { place: 'folder', passphrase: PASSPHRASE })).status).toBe(422); // no BACKUP_COPY_DIR
  expect((await admin.put('/api/backup-copy', { ...webdav, address: davBase, passphrase: 'short' })).status).toBe(422);
  expect((await admin.put('/api/backup-copy', { ...webdav, address: 'http://cloud.example.com/dav' })).status).toBe(422); // not https
  expect((await admin.put('/api/backup-copy', { ...webdav, address: 'not an address' })).status).toBe(422);
  expect((await admin.put('/api/backup-copy', { ...webdav, address: davBase, password: '' })).status).toBe(422);
  expect((await admin.get('/api/backup-copy')).json.on).toBe(false);
  expect(dav.seen).toEqual([]); // nothing reached out
});

it('a copy is locked, sent to the WebDAV folder with the user name and password, and the newest three are kept', async () => {
  const { admin, tools } = await setup(false);
  const on = (await admin.put('/api/backup-copy', { ...webdav, address: davBase })).json;
  expect(on).toMatchObject({ on: true, place: 'webdav', address: davBase, username: 'dana', has_password: true, last_at: null, last_ok: null });
  expect(JSON.stringify(on)).not.toContain('app-password-1234');
  expect(JSON.stringify(on)).not.toContain(PASSPHRASE);
  expect(on.sends).toContain(`WebDAV folder at ${new URL(davBase).host}`);
  expect(on.sends).toContain('locked with your passphrase');
  expect(dav.seen).toEqual([]); // turning it on sends nothing

  // The passphrase and the app password are kept sealed, never as typed.
  const stored = (await database.db.get<{ secret: string; passphrase: string }>('SELECT secret, passphrase FROM backup_copy'))!;
  expect([stored.secret.startsWith('sealed:v1:'), stored.passphrase.startsWith('sealed:v1:')]).toEqual([true, true]);

  await admin.post('/api/calendar/events', { title: 'Charlie dentist', day: '2046-03-06' });
  const sent = (await admin.post('/api/backup-copy/send')).json;
  expect([sent.last_ok, sent.last_note, sent.last_at]).toEqual([true, expect.stringMatching(/^Sent life-is-backup-\d{4}-\d{2}-\d{2}-\d{4}\.lifeis\.$/), expect.any(String)]);
  expect(dav.seen.every((s) => s.auth === `Basic ${Buffer.from('dana:app-password-1234').toString('base64')}`)).toBe(true);
  expect(dav.files.size).toBe(1);
  const file = [...dav.files.values()][0]!;
  expect(file.subarray(0, MAGIC.length).toString('latin1')).toBe(MAGIC); // locked the way the app's backups are
  expect(file.toString('latin1')).not.toContain('Charlie'); // and nothing readable in it

  for (const minute of [11, 12, 13, 14]) { time = new Date(2046, 2, 5, 10, minute, 0); expect((await admin.post('/api/backup-copy/send')).json.last_ok).toBe(true); }
  // Times are the moment in UTC, the way the names sort: the newest three of the five stay.
  expect([...dav.files.keys()].sort().map((n) => n.slice(-11, -7))).toEqual(['1012', '1013', '1014'].map((m) => m));
  void tools;
});

it('the nightly copy goes once a day from 3 in the morning, and a copy that fails is shown on the card and in the morning reminder, without stopping Life Is', async () => {
  const { admin, other, tools } = await setup(false);
  const { copyDue } = await import('../../core/src/index.ts');
  await admin.put('/api/backup-copy', { ...webdav, address: davBase });
  expect(await copyDue(database.db, new Date(2046, 2, 5, 2, 30), tools)).toBeNull(); // before 3
  expect((await copyDue(database.db, new Date(2046, 2, 5, 3, 0), tools))!.last_ok).toBe(true);
  expect(await copyDue(database.db, new Date(2046, 2, 5, 9, 0), tools)).toBeNull(); // already today
  expect(dav.files.size).toBe(1);

  dav.refuse = 403;
  const failed = (await copyDue(database.db, new Date(2046, 2, 6, 3, 1), tools))!;
  expect([failed.last_ok, failed.last_note]).toEqual([false, expect.stringContaining('refused')]);
  expect(failed.last_note).not.toContain('app-password-1234');
  expect((await admin.get('/api/backup-copy')).json).toMatchObject({ last_ok: false });
  expect((await admin.get('/api/health')).status).toBe(200); // Life Is carries on

  const lines = async (who: 'admin' | 'other') => {
    const id = who === 'admin' ? 1 : 2;
    return (await reminders(database.db, id, () => time).digest()).lines.filter((l) => l.title.includes('second backup copy'));
  };
  expect((await lines('admin')).map((l) => [l.title, l.urgent, l.detail])).toEqual([["The second backup copy didn't go", true, expect.stringContaining('refused')]]);
  expect(await lines('other')).toEqual([]); // only the person in charge hears it
  void other;

  dav.refuse = null;
  expect((await admin.post('/api/backup-copy/send')).json.last_ok).toBe(true);
  expect(await lines('admin')).toEqual([]);
});

it('a wrong password is said plainly, and turning it off stops everything', async () => {
  const { admin } = await setup(false);
  await admin.put('/api/backup-copy', { ...webdav, address: davBase, password: 'not-the-password' });
  const bad = (await admin.post('/api/backup-copy/send')).json;
  expect([bad.last_ok, bad.last_note]).toEqual([false, expect.stringContaining('refused the user name or app password')]);
  // Changing it keeps the saved passphrase when none is typed.
  await admin.put('/api/backup-copy', { ...webdav, address: davBase, passphrase: '' });
  expect((await admin.post('/api/backup-copy/send')).json.last_ok).toBe(true);
  expect((await admin.delete('/api/backup-copy')).json.on).toBe(false);
  expect((await admin.post('/api/backup-copy/send')).status).toBe(409);
  const before = dav.seen.length;
  const { copyDue } = await import('../../core/src/index.ts');
  expect(await copyDue(database.db, new Date(2046, 2, 9, 4, 0), (await setupTools()))).toBeNull();
  expect(dav.seen.length).toBe(before);
});
async function setupTools() { return copyTools({ passphrase: vault(path.join(folder, 'keys'), 'backup_copy_passphrase'), secret: vault(path.join(folder, 'keys'), 'backup_copy_secret') }, undefined); }

it('a second drive named by BACKUP_COPY_DIR is offered, and takes the same locked copy, newest three kept', async () => {
  const { admin } = await setup(true);
  expect((await admin.get('/api/backup-copy')).json.folder_offered).toBe(true);
  const on = (await admin.put('/api/backup-copy', { place: 'folder', passphrase: PASSPHRASE })).json;
  expect([on.place, on.sends]).toEqual(['folder', expect.stringContaining('second drive')]);
  for (const minute of [1, 2, 3, 4]) { time = new Date(2046, 2, 5, 10, minute, 0); expect((await admin.post('/api/backup-copy/send')).json.last_ok).toBe(true); }
  const names = readdirSync(drive).sort();
  expect(names).toHaveLength(3);
  expect(names.map((n) => n.slice(-11, -7))).toEqual(['1002', '1003', '1004']);
  expect(readFileSync(path.join(drive, names[2]!)).subarray(0, MAGIC.length).toString('latin1')).toBe(MAGIC);
  expect(dav.seen).toEqual([]); // the web was not touched
});
