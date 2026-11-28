/**
 * Wrong sign-in guesses are counted by visitor. Behind a proxy the person in charge names (TRUSTED_PROXY), the
 * visitor is the address the proxy passes along; from anyone else that header is ignored.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createApp, parseProxies, visitorIp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';

const fake = (remote: string, forwarded?: string | string[]) =>
  ({ socket: { remoteAddress: remote }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } }) as unknown as IncomingMessage;

it('with no setting, the connecting address is the visitor and the header is ignored', () => {
  const none = parseProxies(undefined);
  expect(visitorIp(fake('10.0.0.5', '203.0.113.7'), none)).toBe('10.0.0.5');
  expect(visitorIp(fake('::ffff:10.0.0.5'), none)).toBe('10.0.0.5');
});

it('from a trusted proxy, the visitor is the right-most address that is not a trusted proxy', () => {
  const proxies = parseProxies('10.0.0.5, 10.0.0.6');
  expect(visitorIp(fake('10.0.0.5', '203.0.113.7'), proxies)).toBe('203.0.113.7');
  expect(visitorIp(fake('::ffff:10.0.0.5', '198.51.100.9, 203.0.113.7, 10.0.0.6'), proxies)).toBe('203.0.113.7');
  // What a visitor typed in front of their own address is never reached.
  expect(visitorIp(fake('10.0.0.5', '1.2.3.4, 203.0.113.7'), proxies)).toBe('203.0.113.7');
  // No header, a muddled one, or only proxies: the proxy's own address, as before.
  expect(visitorIp(fake('10.0.0.5'), proxies)).toBe('10.0.0.5');
  expect(visitorIp(fake('10.0.0.5', 'not-an-address'), proxies)).toBe('10.0.0.5');
  expect(visitorIp(fake('10.0.0.5', '10.0.0.6'), proxies)).toBe('10.0.0.5');
});

it('from an address that is not trusted, the header is ignored', () => {
  const proxies = parseProxies('10.0.0.5');
  expect(visitorIp(fake('192.0.2.50', '203.0.113.7'), proxies)).toBe('192.0.2.50');
});

let folder = '';
let database: OpenDatabase | null = null;
let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  database?.close();
  server = null;
  database = null;
  if (folder) rmSync(folder, { recursive: true, force: true });
});

async function start(trustedProxy: string | undefined) {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-proxy-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  const held = new Date();
  server = createServer(createApp({ db: database.db, clock: () => held, trustedProxy: trustedProxy ?? '' }));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (from: string, username: string) => fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': from },
    body: JSON.stringify({ username, password: 'wrong-wrong-wrong' }),
  }).then((response) => response.status);
}

it('two visitors behind one proxy are counted apart', async () => {
  const guess = await start('127.0.0.1');
  for (let i = 0; i < 20; i += 1) expect(await guess('203.0.113.7', `nobody${i}`)).toBe(401);
  expect(await guess('203.0.113.7', 'nobody-new')).toBe(429);
  expect(await guess('198.51.100.4', 'someone-else')).toBe(401);
});

it('without a setting, a visitor cannot dodge the count by sending an address of their own', async () => {
  const guess = await start(undefined);
  for (let i = 0; i < 20; i += 1) expect(await guess(`203.0.113.${i + 1}`, `nobody${i}`)).toBe(401);
  expect(await guess('198.51.100.4', 'nobody-new')).toBe(429);
});
