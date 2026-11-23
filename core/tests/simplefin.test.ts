/** Reading bank accounts through SimpleFIN, against a fake fetch. Nothing here ever reaches a real network. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Answer, Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { centsOf, claimAddress, isPrivateHost, readAnswer, simplefin } from '../src/simplefin.ts';
import { memoryDb } from './memoryDb.ts';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const CLAIM = 'https://bridge.example.org/simplefin/claim/ABC123';
const TOKEN = b64(CLAIM);
const ACCESS = 'https://user%40x:s3cret-pass@bridge.example.org/simplefin';
const unix = (day: string, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`) / 1000;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 15, 10, 0, 0)), { today: () => '2046-03-15' });
const sealer: Sealer = { seal: (p) => `sealed:v1:${Buffer.from(p).toString('base64')}`, unseal: (s) => (s.startsWith('sealed:v1:') ? Buffer.from(s.slice(10), 'base64').toString() : null) };

type Asked = { url: string; headers: Record<string, string>; send?: { method: string; body: string; noRedirect?: boolean } };
let db: Db;
let me: number;
let other: number;
let asked: Asked[];
let claimStatus: number;
let claimBody: string;
let accountsStatus: number;
let accountsBody: unknown;
const reply = (status: number, body: unknown): Answer => ({
  status, type: 'application/json', json: async () => body, bytes: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
});
const fetcher: Fetcher = async (url, headers, send) => {
  asked.push({ url, headers, send });
  if (send?.method === 'POST') return reply(claimStatus, claimBody);
  return reply(accountsStatus, accountsBody);
};

const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const bank = (who = me, tools: Parameters<typeof simplefin>[4] = { sealer }) => simplefin(db, who, clock, fetcher, tools);
const txn = (id: string, day: string, amount: string, description: string, extra: Record<string, unknown> = {}) => ({ id, posted: unix(day), amount, description, ...extra });
const answerWith = (transactions: unknown[], extra: Record<string, unknown> = {}) => ({
  errors: [],
  accounts: [
    { id: 'ACT-1', name: 'Everyday Checking', currency: 'USD', balance: '1234.50', 'balance-date': unix('2046-03-15'), org: { name: 'Example Credit Union', domain: 'example.org' }, transactions, ...extra },
    { id: 'ACT-2', name: 'Savings', currency: 'USD', balance: '10.00', org: { domain: 'example.org' }, transactions: [txn('S-1', '2046-03-10', '-5.00', 'Should not come in')] },
  ],
});
const entries = () => db.all<{ label: string; cents: number; day: string; category_id: number | null; bank_account: string | null; bank_txn: string | null }>(
  'SELECT label, cents, day, category_id, bank_account, bank_txn FROM money_entries WHERE owner_id = ? ORDER BY day, id', [me]);
/** On, connected, and the first account chosen. */
const ready = async (category: number | null = null) => {
  const b = bank();
  await b.turn(true);
  await b.connect(TOKEN);
  const state = await b.state();
  await b.choose([{ id: state.accounts.find((a) => a.name === 'Everyday Checking')!.id, chosen: true, category_id: category }]);
  return b;
};

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  me = await person('ana'); other = await person('ben');
  asked = [];
  claimStatus = 200; claimBody = ACCESS; accountsStatus = 200;
  accountsBody = answerWith([]);
});

describe('a setup token', () => {
  it('is base64 of an https claim address, in either alphabet, with or without padding', () => {
    expect(claimAddress(TOKEN).href).toBe(CLAIM);
    expect(claimAddress(TOKEN.replace(/=+$/, '')).href).toBe(CLAIM);
    expect(claimAddress(`  ${TOKEN.slice(0, 8)}\n${TOKEN.slice(8)} `).href).toBe(CLAIM);
    const odd = 'https://bridge.example.org/simplefin/claim/a~b?x=>>>';
    const plain = b64(odd);
    expect(claimAddress(plain.replaceAll('+', '-').replaceAll('/', '_')).href).toBe(new URL(odd).href);
  });
  it('is refused when it is junk, not a web address, or not https', () => {
    for (const bad of ['', 'not a token!', '%%%%', b64('just some words'), b64('ftp://bridge.example.org/x'), b64('http://bridge.example.org/claim/x'), b64('javascript:alert(1)'), 'a'.repeat(5000)]) {
      expect(() => claimAddress(bad), bad.slice(0, 20)).toThrow(/token|SimpleFIN address|doesn't hold/);
    }
    expect(() => claimAddress(b64('http://bridge.example.org/claim/x'))).toThrow(/starts with https/);
  });
  it('is refused when it points at this computer or a private network', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.0.1', '169.254.169.254', '100.64.0.1', '[::1]', '[fd00::1]', '[::ffff:7f00:1]', 'nas', 'printer.local', 'router.lan', 'x.internal', 'host.docker.internal', '0.0.0.0', '2130706433']) {
      expect(() => claimAddress(b64(`https://${host}/claim/x`)), host).toThrow(/starts with https/);
    }
    expect(isPrivateHost('bridge.example.org')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
  });
  it('is refused when it carries a name and password of its own', () => {
    expect(() => claimAddress(b64('https://u:p@bridge.example.org/claim/x'))).toThrow(/starts with https/);
  });
});

describe('amounts', () => {
  it('become whole cents from the strings SimpleFIN writes', () => {
    expect([centsOf('-12.30'), centsOf('5'), centsOf('1234.5'), centsOf('0.07'), centsOf('-0.005'), centsOf('.5'), centsOf('+3.10'), centsOf('-0'), centsOf('12.')]).toEqual([-1230, 500, 123450, 7, -1, 50, 310, 0, 1200]);
    expect([centsOf('abc'), centsOf(''), centsOf('1e5'), centsOf('1,000.00'), centsOf(null), centsOf({})]).toEqual([null, null, null, null, null, null]);
  });
});

describe('claiming', () => {
  it('needs it turned on, and nothing is asked while it is off', async () => {
    await expect(bank().connect(TOKEN)).rejects.toThrow(/turned off/);
    expect(asked).toEqual([]);
    expect((await bank().state()).on).toBe(false);
    await bank().turn(true);
    expect((await bank().state()).on).toBe(true);
    await bank().turn(false);
    await expect(bank().read()).rejects.toThrow(/turned off/);
    expect(asked).toEqual([]);
  });
  it('cannot be turned on where nothing can be fetched or locked', async () => {
    await expect(simplefin(db, me, clock, undefined, { sealer }).turn(true)).rejects.toThrow(/isn't set up/);
    await expect(simplefin(db, me, clock, fetcher, {}).turn(true)).rejects.toThrow(/isn't set up/);
    const state = await simplefin(db, me, clock, undefined, {}).state();
    expect([state.available, state.on]).toEqual([false, false]);
  });
  it('is one empty POST to the address the token names, and keeps the access address sealed', async () => {
    const b = bank();
    await b.turn(true);
    const done = await b.connect(TOKEN);
    expect(asked[0]).toMatchObject({ url: CLAIM, send: { method: 'POST', body: '', noRedirect: true } });
    expect(done.connection).toMatchObject({ host: 'bridge.example.org', last_read_at: null });
    expect(done.accounts.map((a) => [a.name, a.org, a.balance_cents, a.chosen])).toEqual([['Everyday Checking', 'Example Credit Union', 123450, false], ['Savings', 'example.org', 1000, false]]);
    const row = (await db.get<{ access: string }>('SELECT access FROM simplefin_connections'))!;
    expect(row.access.startsWith('sealed:v1:')).toBe(true);
    expect(row.access).not.toContain('s3cret');
    // The state a page gets has the host and the time, and not the address.
    const shown = JSON.stringify(await b.state());
    for (const secret of ['s3cret', 'user%40x', ACCESS, 'sealed:v1', 'ABC123']) expect(shown).not.toContain(secret);
  });
  it('lists the accounts with the access address moved into an Authorization header, never left in the address', async () => {
    const b = bank();
    await b.turn(true);
    await b.connect(TOKEN);
    const list = asked[1]!;
    expect(list.url).toBe('https://bridge.example.org/simplefin/accounts?balances-only=1');
    expect(list.url).not.toMatch(/@|s3cret/);
    expect(list.headers.Authorization).toBe(`Basic ${Buffer.from('user@x:s3cret-pass').toString('base64')}`);
    expect(list.send).toMatchObject({ method: 'GET', noRedirect: true });
  });
  it('keeps nothing when SimpleFIN refuses (the token was used already or is wrong), and says so plainly', async () => {
    const b = bank();
    await b.turn(true);
    for (const [status, body] of [[403, 'no'], [404, ''], [500, 'oops'], [200, 'not an address'], [200, 'https://bridge.example.org/no-credentials'], [200, '']] as const) {
      claimStatus = status; claimBody = body;
      await expect(b.connect(TOKEN)).rejects.toThrow(/used already, or it is wrong.*Nothing was kept/);
    }
    expect((await b.state()).connection).toBeNull();
    expect(await db.get('SELECT 1 AS x FROM simplefin_connections')).toBeUndefined();
    expect(asked.every((a) => a.send?.method === 'POST')).toBe(true);
  });
  it('keeps nothing when the server cannot be reached', async () => {
    const down: Fetcher = async () => { throw new Error('connect ECONNREFUSED'); };
    const b = simplefin(db, me, clock, down, { sealer });
    await b.turn(true);
    await expect(b.connect(TOKEN)).rejects.toThrow(/couldn't be reached.*Nothing was kept/);
    expect(await db.get('SELECT 1 AS x FROM simplefin_connections')).toBeUndefined();
  });
  it('refuses an access address that is private, even from the real server', async () => {
    claimBody = 'https://u:p@192.168.1.5/simplefin';
    const b = bank();
    await b.turn(true);
    await expect(b.connect(TOKEN)).rejects.toThrow();
    expect(await db.get('SELECT 1 AS x FROM simplefin_connections')).toBeUndefined();
  });
  it('refuses a refused address before it asks anything at all', async () => {
    const b = bank();
    await b.turn(true);
    await expect(b.connect(b64('https://127.0.0.1/claim/x'))).rejects.toThrow(/starts with https/);
    expect(asked).toEqual([]);
  });
  it('keeps the connection, with the reason, when only listing the accounts fails', async () => {
    accountsStatus = 500;
    const b = bank();
    await b.turn(true);
    const done = await b.connect(TOKEN);
    expect(done.connection).not.toBeNull();
    expect(done.problem).toMatch(/error \(500\)/);
    expect(done.accounts).toEqual([]);
    accountsStatus = 200;
    expect((await b.refresh()).accounts).toHaveLength(2);
  });
  it('is claimed once: a second connect is refused until it is disconnected', async () => {
    const b = await ready();
    await expect(b.connect(TOKEN)).rejects.toThrow(/connected already/);
    expect(asked.filter((a) => a.send?.method === 'POST')).toHaveLength(1);
  });
  it('is shown only to the person who made it', async () => {
    await ready();
    expect((await bank(other).state()).connection).toBeNull();
  });
  it('allows a stand-in on this computer only when a test says so', async () => {
    const local = b64('http://127.0.0.1:8102/claim/x');
    claimBody = 'http://u:p@127.0.0.1:8102/simplefin';
    const strict = bank();
    await strict.turn(true);
    await expect(strict.connect(local)).rejects.toThrow(/starts with https/);
    const loose = bank(me, { sealer, allowLocal: true });
    expect((await loose.connect(local)).connection?.host).toBe('127.0.0.1');
  });
});

describe('reading', () => {
  it('asks for the dates as unix times, signed in, for the last 30 days by default', async () => {
    const b = await ready();
    asked = [];
    const done = await b.read();
    expect(done.from_day).toBe('2046-02-13');
    expect(asked).toHaveLength(1);
    const url = new URL(asked[0]!.url);
    expect(url.origin + url.pathname).toBe('https://bridge.example.org/simplefin/accounts');
    expect(url.searchParams.get('start-date')).toBe(String(unix('2046-02-13', 0)));
    expect(Number(url.searchParams.get('end-date'))).toBeGreaterThan(unix('2046-03-15', 10));
    expect(asked[0]!.headers.Authorization).toMatch(/^Basic /);
    await b.read({ from_day: '2046-03-01' });
    expect(new URL(asked[1]!.url).searchParams.get('start-date')).toBe(String(unix('2046-03-01', 0)));
  });
  it('goes back 90 days at most, and not into the future or nonsense', async () => {
    const b = await ready();
    await expect(b.read({ from_day: '2045-12-01' })).rejects.toThrow(/90 days at most/);
    await expect(b.read({ from_day: '2046-03-16' })).rejects.toThrow(/today or before/);
    await expect(b.read({ from_day: 'last week' })).rejects.toThrow(/Choose the day/);
    await expect(b.read({ from_day: '2045-12-15' })).resolves.toMatchObject({ from_day: '2045-12-15' });
  });
  it('needs an account chosen', async () => {
    const b = bank();
    await b.turn(true);
    await b.connect(TOKEN);
    await expect(b.read()).rejects.toThrow(/Choose at least one account/);
  });
  it('brings in money out that has settled, in cents, on its posted day, and only from chosen accounts', async () => {
    accountsBody = answerWith([
      txn('T1', '2046-03-10', '-12.30', 'KROGER #123', { payee: 'Kroger' }),
      txn('T2', '2046-03-11', '-5', '  Coffee   shop  '),
      txn('T3', '2046-03-12', '-1234.5', 'Furnace repair', { memo: 'invoice 9' }),
      txn('T4', '2046-03-12', '-0.99', '', { memo: 'App store' }),
    ]);
    const b = await ready();
    const done = await b.read();
    expect([done.listed, done.added, done.already, done.left_out]).toEqual([4, 4, 0, 0]);
    expect(done.months).toEqual([{ month: '2046-03', added: 4 }]);
    expect(await entries()).toEqual([
      { label: 'Kroger', cents: 1230, day: '2046-03-10', category_id: null, bank_account: 'ACT-1', bank_txn: 'T1' },
      { label: 'Coffee shop', cents: 500, day: '2046-03-11', category_id: null, bank_account: 'ACT-1', bank_txn: 'T2' },
      { label: 'Furnace repair', cents: 123450, day: '2046-03-12', category_id: null, bank_account: 'ACT-1', bank_txn: 'T3' },
      { label: 'App store', cents: 99, day: '2046-03-12', category_id: null, bank_account: 'ACT-1', bank_txn: 'T4' },
    ]);
    expect(await db.get('SELECT 1 AS x FROM money_entries WHERE bank_account = ?', ['ACT-2'])).toBeUndefined();
    expect((await b.state()).connection?.last_read_at).toBe('2046-03-15T10:00:00+00:00');
  });
  it('leaves out money in and what is still pending, and says how many of each', async () => {
    accountsBody = answerWith([
      txn('P1', '2046-03-10', '3000.00', 'PAYROLL'),
      txn('P2', '2046-03-11', '-20.00', 'Pending purchase', { pending: true }),
      { id: 'P3', posted: 0, amount: '-7.00', description: 'No posted time' },
      txn('P4', '2046-03-11', '0.00', 'Zero'),
      txn('P5', '2046-03-12', 'not-a-number', 'Odd'),
      txn('P6', '2046-03-13', '-8.00', 'Real one'),
    ]);
    const b = await ready();
    const done = await b.read();
    expect([done.listed, done.added, done.left_out, done.money_in, done.pending, done.other]).toEqual([6, 1, 5, 1, 2, 2]);
    expect((await entries()).map((e) => e.label)).toEqual(['Real one']);
  });
  it('uses the category chosen for the account, and none otherwise', async () => {
    const category = (await money(db, me, clock).addCategory({ name: 'Everyday' })).id;
    accountsBody = answerWith([txn('C1', '2046-03-10', '-4.00', 'Bakery')]);
    const b = await ready(category);
    await b.read();
    expect((await entries())[0]!.category_id).toBe(category);
  });
  it('refuses a category that is not the person\'s to use', async () => {
    const theirs = (await money(db, other, clock).addCategory({ name: 'Secret' })).id;
    const b = bank();
    await b.turn(true);
    const done = await b.connect(TOKEN);
    await expect(b.choose([{ id: done.accounts[0]!.id, chosen: true, category_id: theirs }])).rejects.toThrow(/Not found/);
    await expect(b.choose([{ id: 999999, chosen: true }])).rejects.toThrow(/Not found/);
  });
  it('never brings the same transaction in twice, even when it is read again', async () => {
    accountsBody = answerWith([txn('D1', '2046-03-10', '-12.00', 'Pharmacy'), txn('D2', '2046-03-11', '-3.00', 'Bus')]);
    const b = await ready();
    expect((await b.read()).added).toBe(2);
    const again = await b.read();
    expect([again.added, again.already]).toEqual([0, 2]);
    // Even when it has been edited by hand since, or its words have changed at the bank.
    await db.run("UPDATE money_entries SET label = 'Chemist', cents = 1201 WHERE bank_txn = 'D1'");
    accountsBody = answerWith([txn('D1', '2046-03-10', '-12.00', 'PHARMACY #55'), txn('D2', '2046-03-11', '-3.00', 'Bus')]);
    expect((await b.read()).already).toBe(2);
    expect(await entries()).toHaveLength(2);
  });
  it('skips what looks like an entry written by hand, by the statement rule: same day, amount and label', async () => {
    await money(db, me, clock).addEntry({ label: 'kroger', cents: 1230, day: '2046-03-10' });
    accountsBody = answerWith([txn('E1', '2046-03-10', '-12.30', 'Kroger'), txn('E2', '2046-03-10', '-12.31', 'Kroger'), txn('E3', '2046-03-11', '-12.30', 'Kroger')]);
    const b = await ready();
    const done = await b.read();
    expect([done.added, done.already]).toEqual([2, 1]);
    expect((await entries()).filter((e) => e.bank_txn).map((e) => e.bank_txn)).toEqual(['E2', 'E3']);
  });
  it('treats one hand entry as only one of two like purchases', async () => {
    await money(db, me, clock).addEntry({ label: 'Coffee', cents: 450, day: '2046-03-10' });
    accountsBody = answerWith([txn('F1', '2046-03-10', '-4.50', 'Coffee'), txn('F2', '2046-03-10', '-4.50', 'Coffee')]);
    const done = await (await ready()).read();
    expect([done.added, done.already]).toEqual([1, 1]);
  });
  it('keeps two like purchases from the bank as two, now or on a later reading', async () => {
    accountsBody = answerWith([txn('G1', '2046-03-10', '-4.50', 'Coffee')]);
    const b = await ready();
    expect((await b.read()).added).toBe(1);
    accountsBody = answerWith([txn('G1', '2046-03-10', '-4.50', 'Coffee'), txn('G2', '2046-03-10', '-4.50', 'Coffee')]);
    const later = await b.read();
    expect([later.added, later.already]).toEqual([1, 1]);
    expect(await entries()).toHaveLength(2);
  });
  it('skips what a bank statement import already wrote', async () => {
    const { importStatement } = await import('../src/bankStatement.ts');
    await importStatement(db, me, clock, [{ day: '2046-03-10', label: 'Hardware Store', cents: 4999, kind: 'spent', hint: null }], { suggest: false });
    accountsBody = answerWith([txn('H1', '2046-03-10', '-49.99', 'HARDWARE STORE')]);
    const done = await (await ready()).read();
    expect([done.added, done.already]).toEqual([0, 1]);
  });
  it('shows the errors SimpleFIN returns, as text, in either shape', async () => {
    accountsBody = { ...answerWith([txn('X1', '2046-03-10', '-1.00', 'One')]), errors: ['Connection to Example Credit Union may need attention', { code: 'gen.auth', msg: 'Sign in again at the bank' }, '', 42, null] };
    const done = await (await ready()).read();
    expect(done.errors).toEqual(['Connection to Example Credit Union may need attention', 'Sign in again at the bank']);
    expect(done.added).toBe(1);
  });
  it('says plainly what went wrong, and never shows the access address', async () => {
    const b = await ready();
    const said: string[] = [];
    for (const status of [402, 403, 429, 500]) {
      accountsStatus = status;
      try { await b.read(); } catch (e) { said.push((e as Error).message); }
    }
    expect(said).toHaveLength(4);
    expect(said[0]).toMatch(/isn't paid up/);
    expect(said[1]).toMatch(/no longer accepts/);
    expect(said[2]).toMatch(/fewer readings/);
    expect(said[3]).toMatch(/error \(500\)/);
    for (const text of said) for (const secret of ['s3cret', 'user', 'ABC123', 'bridge.example.org/simplefin']) expect(text).not.toContain(secret);
    const down: Fetcher = async () => { throw new Error('connect ECONNREFUSED https://user:s3cret-pass@bridge.example.org'); };
    await expect(simplefin(db, me, clock, down, { sealer }).read()).rejects.toThrow(/couldn't be reached just now. Try again/);
    accountsStatus = 200; accountsBody = '<html>';
    await expect(b.read()).resolves.toMatchObject({ listed: 0 });
  });
  it('ignores anything of the wrong shape in the answer', () => {
    expect(readAnswer(null)).toEqual({ errors: [], accounts: [] });
    expect(readAnswer({ accounts: [null, 5, { name: 'no id' }, { id: 'A', transactions: [null, { amount: '1' }, { id: 'T', posted: 'soon', amount: '-2' }] }] }))
      .toMatchObject({ accounts: [{ account_id: 'A', name: 'Account', transactions: [{ id: 'T', day: null, pending: true, cents: -200 }] }] });
  });
  it('does nothing to anything else: the one account list stays as chosen across readings', async () => {
    const b = await ready();
    await b.read();
    const after = await b.state();
    expect(after.accounts.map((a) => [a.name, a.chosen])).toEqual([['Everyday Checking', true], ['Savings', false]]);
  });
});

describe('disconnecting', () => {
  it('removes the sealed address and the chosen accounts, and leaves the spending it brought in', async () => {
    accountsBody = answerWith([txn('K1', '2046-03-10', '-9.00', 'Lunch')]);
    const b = await ready();
    await b.read();
    const gone = await b.disconnect();
    expect(gone.connection).toBeNull();
    expect(gone.accounts).toEqual([]);
    expect(await db.get('SELECT 1 AS x FROM simplefin_connections')).toBeUndefined();
    expect(await db.get('SELECT 1 AS x FROM simplefin_accounts')).toBeUndefined();
    expect(await entries()).toHaveLength(1);
    // Connecting again later does not bring that one back a second time.
    await b.connect(TOKEN);
    const state = await b.state();
    await b.choose([{ id: state.accounts[0]!.id, chosen: true }]);
    expect((await b.read()).already).toBe(1);
  });
});
