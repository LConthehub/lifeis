/** Email, with a pretend postbox standing in for the mail provider. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { home } from '../src/home.ts';
import { buildReply, isNearby, mail, type MailMessage, type MailServer, type Outgoing, type Postbox } from '../src/mail.ts';
import { migrate } from '../src/migrations.ts';
import { Problem } from '../src/problem.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time: Date;
const clock = () => time;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

const letter = (uid: number, more: Partial<MailMessage> = {}): MailMessage => ({
  uid, from: { name: 'Sam Doe', address: 'sam@example.com' }, subject: 'Saturday?', date: '2046-03-04T09:00:00.000Z', unread: true, flagged: false,
  to: [{ name: null, address: 'me@example.org' }, { name: 'Alex', address: 'alex@example.com' }], cc: [{ name: null, address: 'pat@example.com' }], reply_to: null,
  text: 'Are you free Saturday?\n> earlier words', attachments: [], message_id: '<m1@example.com>', references: ['<m0@example.com>'], ...more,
});

const sealer = { seal: (plain: string) => `locked(${[...plain].reverse().join('')})`, unseal: (sealed: string) => (sealed.startsWith('locked(') ? [...sealed.slice(7, -1)].reverse().join('') : null) };

/** A stand-in provider: one inbox, and a record of everything asked of it. */
function pretend() {
  const world = {
    box: [letter(7), letter(5, { subject: 'Old news', unread: false })] as MailMessage[],
    password: 'app-password-123', calls: [] as string[], sent: [] as { server: MailServer; message: Outgoing; answers: number | null }[], down: false,
    postbox: {} as Postbox, sealer,
  };
  const enter = (s: MailServer, what: string) => {
    world.calls.push(what);
    if (world.down) throw new Problem(400, "Couldn't reach imap.example.org for reading. Check the server's name and port.");
    if (s.password !== world.password) throw new Problem(400, "imap.example.org didn't accept that username and password.");
  };
  world.postbox = {
    check: async (s) => enter(s, 'check'),
    list: async (s, limit) => { enter(s, 'list'); return { messages: world.box.slice(0, limit).map(({ uid, from, subject, date, unread, flagged }) => ({ uid, from, subject, date, unread, flagged })), unread: world.box.filter((m) => m.unread).length }; },
    read: async (s, uid) => { enter(s, 'read'); return world.box.find((m) => m.uid === uid) ?? null; },
    mark: async (s, uid, seen) => { enter(s, 'mark'); world.box.find((m) => m.uid === uid)!.unread = !seen; },
    send: async (s, message, answers) => { enter(s, 'send'); world.sent.push({ server: s, message, answers }); },
  };
  return world;
}

const ACCOUNT = { address: 'me@example.org', name: 'Me', password: 'app-password-123', imap_host: 'imap.example.org', smtp_host: 'smtp.example.org' };

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

it('an account is saved only when signing in works, and its password is stored locked', async () => {
  const world = pretend();
  const post = mail(db, owner, clock, world);
  expect([post.available(), await post.accounts()]).toEqual([true, []]);
  expect((await home(db, owner, clock).summary()).choices.some((c) => c.key === 'mail')).toBe(false); // no card until there's an account

  await expect(post.addAccount({ ...ACCOUNT, password: 'wrong' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("didn't accept") });
  await expect(post.addAccount({ ...ACCOUNT, password: null })).rejects.toEqual(problem(400));
  await expect(post.addAccount({ ...ACCOUNT, address: 'not an address' })).rejects.toEqual(problem(400));
  await expect(post.addAccount({ ...ACCOUNT, imap_port: 70000 })).rejects.toEqual(problem(400));
  expect(await post.accounts()).toEqual([]);

  const made = await post.addAccount(ACCOUNT);
  expect(made).toEqual({ id: made.id, address: 'me@example.org', name: 'Me', username: 'me@example.org', imap_host: 'imap.example.org', imap_port: 993, smtp_host: 'smtp.example.org', smtp_port: 465, local: false });
  expect(JSON.stringify(await post.accounts())).not.toContain('app-password');
  const kept = (await db.get<{ password: string }>('SELECT password FROM mail_accounts WHERE id = ?', [made.id]))!.password;
  expect([kept.includes('app-password-123'), sealer.unseal(kept)]).toEqual([false, 'app-password-123']);
  expect((await home(db, owner, clock).summary()).cards).toContain('mail');

  // The password stays when it isn't given again; a new one is checked before it's kept.
  world.password = 'a-newer-password';
  await expect(post.updateAccount(made.id, { ...ACCOUNT, password: null, name: 'Me again' })).rejects.toEqual(problem(400));
  expect((await post.updateAccount(made.id, { ...ACCOUNT, password: 'a-newer-password', name: 'Me again' })).name).toBe('Me again');
  expect((await post.updateAccount(made.id, { ...ACCOUNT, password: '', smtp_port: 587 })).smtp_port).toBe(587);

  // Someone else in the house sees none of it and can't read it.
  const other = mail(db, await person('other'), clock, world);
  expect(await other.accounts()).toEqual([]);
  await expect(other.inbox(made.id)).rejects.toEqual(problem(404));
  await expect(other.removeAccount(made.id)).resolves.toBeUndefined();
  expect(await post.accounts()).toHaveLength(1);

  await post.removeAccount(made.id);
  expect([await post.accounts(), (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mail_accounts'))!.n]).toEqual([[], 0]);
});

it('a password only travels without a trusted line to a server on your own network', async () => {
  const world = pretend();
  const post = mail(db, owner, clock, world);
  await expect(post.addAccount({ ...ACCOUNT, local: true })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('only for servers there') });
  expect(world.calls).toEqual([]); // refused before anything was sent
  const bridge = await post.addAccount({ ...ACCOUNT, imap_host: '127.0.0.1', imap_port: 1143, smtp_host: 'host.docker.internal', smtp_port: 1025, local: true });
  expect([bridge.local, bridge.imap_port]).toEqual([true, 1143]);
  expect(['localhost', '192.168.1.20', '10.0.0.5', '172.20.0.2', '100.101.1.1', 'nas.local', 'mail.lan'].map(isNearby)).toEqual(Array(7).fill(true));
  expect(['imap.gmail.com', '8.8.8.8', '172.32.0.1', '192.169.1.1', 'local.example.com'].map(isNearby)).toEqual(Array(5).fill(false));
});

it('the inbox is read when looked at, opening does not mark read, and a reply quotes the original', async () => {
  const world = pretend();
  const post = mail(db, owner, clock, world);
  const { id } = await post.addAccount(ACCOUNT);

  const inbox = await post.inbox(id);
  expect([inbox.unread, inbox.messages.map((m) => [m.uid, m.subject, m.unread])]).toEqual([1, [[7, 'Saturday?', true], [5, 'Old news', false]]]);
  expect((await post.message(id, 7)).text).toContain('free Saturday');
  expect((await post.inbox(id)).unread).toBe(1); // still unread
  await expect(post.message(id, 99)).rejects.toEqual(problem(404));
  await post.mark(id, 7, true);
  expect((await post.inbox(id)).unread).toBe(0);

  await expect(post.reply(id, 7, { text: '   ' })).rejects.toEqual(problem(400));
  const done = await post.reply(id, 7, { text: 'Yes, see you then.\n' });
  expect(done).toEqual({ sent: true, to: [{ name: 'Sam Doe', address: 'sam@example.com' }], cc: [] });
  const { message, answers, server } = world.sent[0]!;
  expect([answers, server.password, message.from]).toEqual([7, 'app-password-123', { name: 'Me', address: 'me@example.org' }]);
  expect(message).toMatchObject({ subject: 'Re: Saturday?', in_reply_to: '<m1@example.com>', references: ['<m0@example.com>', '<m1@example.com>'] });
  expect(message.text).toBe('Yes, see you then.\n\nSam Doe <sam@example.com> wrote on 2046-03-04:\n> Are you free Saturday?\n>> earlier words\n');

  // To everyone: the others it went to, but never back to yourself, and nobody twice.
  const all = await post.reply(id, 7, { text: 'All good.', all: true });
  expect([all.to.map((w) => w.address), all.cc.map((w) => w.address)]).toEqual([['sam@example.com', 'alex@example.com'], ['pat@example.com']]);
});

it('a reply goes where the sender asked, and keeps a subject that already says Re', () => {
  const out = buildReply({ address: 'me@example.org', name: null }, letter(1, { subject: 'RE: Saturday?', reply_to: { name: null, address: 'list@example.com' }, message_id: null, references: [] }), 'ok', false);
  expect([out.to, out.subject, out.in_reply_to, out.references]).toEqual([[{ name: null, address: 'list@example.com' }], 'RE: Saturday?', null, []]);
  expect(() => buildReply({ address: 'me@example.org', name: null }, letter(1, { from: null }), 'ok', false)).toThrow(Problem);
});

it('the front page gets a glance: unread and the newest few, kept for a couple of minutes', async () => {
  const world = pretend();
  const post = mail(db, owner, clock, world);
  const { id } = await post.addAccount(ACCOUNT);
  world.calls.length = 0;
  expect(await post.glance()).toEqual([{ id, address: 'me@example.org', unread: 1, newest: [expect.objectContaining({ uid: 7, subject: 'Saturday?' })], problem: null }]);
  await post.glance();
  expect(world.calls).toEqual(['list']); // the second look didn't sign in again
  await post.mark(id, 7, true); // doing something makes the next look fresh
  expect((await post.glance())[0]!.unread).toBe(0);

  time = new Date(time.getTime() + 3 * 60_000);
  world.down = true;
  expect((await post.glance())[0]).toMatchObject({ unread: 0, newest: [], problem: expect.stringContaining("Couldn't reach") });
});

it('without a postbox, email says it is not available', async () => {
  const post = mail(db, owner, clock);
  expect([post.available(), await post.accounts()]).toEqual([false, []]);
  await expect(post.addAccount(ACCOUNT)).rejects.toEqual(problem(400));
});
