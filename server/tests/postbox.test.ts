/**
 * The real postbox against a real mail server. Skipped unless one is named, because it needs a test mail
 * server running (GreenMail, which keeps mail only in memory):
 *
 *   docker run --rm -d --name lifeis-mailtest -p 127.0.0.1:3025:3025 -p 127.0.0.1:3143:3143 \
 *     -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=me:test-pw-one@example.org,sam:test-pw-two@example.com" \
 *     greenmail/standalone:2.1.2
 *   MAIL_TEST_HOST=127.0.0.1 npx vitest run tests/postbox.test.ts
 */
import { expect, it } from 'vitest';
import type { MailServer } from '../../core/src/index.ts';
import { realPostbox } from '../src/postbox.ts';

const host = process.env.MAIL_TEST_HOST;
const account = (user: string, address: string, password: string): MailServer => ({
  address, name: user === 'me' ? 'Me Myself' : 'Sam Doe', username: user, password,
  imap_host: host ?? '', imap_port: 3143, smtp_host: host ?? '', smtp_port: 3025, local: true,
});
const me = account('me', 'me@example.org', 'test-pw-one');
const sam = account('sam', 'sam@example.com', 'test-pw-two');

it.skipIf(!host)('reads an inbox without marking it read, marks when asked, and sends a reply that arrives', async () => {
  await realPostbox.check(me);
  await expect(realPostbox.check({ ...me, password: 'not-it' })).rejects.toMatchObject({ name: 'Problem', message: expect.stringContaining("didn't accept") });
  await expect(realPostbox.check({ ...me, imap_port: 3999 })).rejects.toMatchObject({ name: 'Problem', message: expect.stringContaining("Couldn't reach") });

  const subject = `Saturday? ${Date.now()}`;
  await realPostbox.send(sam, { from: { name: 'Sam Doe', address: sam.address }, to: [{ name: null, address: me.address }], cc: [], subject, text: 'Are you free Saturday?\nSam', in_reply_to: null, references: [] }, null);

  const inbox = await realPostbox.list(me, 30);
  const got = inbox.messages.find((m) => m.subject === subject)!;
  expect([got.unread, got.from, inbox.unread >= 1]).toEqual([true, { name: 'Sam Doe', address: 'sam@example.com' }, true]);

  const whole = (await realPostbox.read(me, got.uid))!;
  expect([whole.text.trim(), whole.to, whole.message_id !== null]).toEqual(['Are you free Saturday?\nSam', [{ name: null, address: 'me@example.org' }], true]);
  expect((await realPostbox.list(me, 30)).messages.find((m) => m.uid === got.uid)!.unread).toBe(true); // reading didn't mark it
  expect(await realPostbox.read(me, 999_999)).toBeNull();

  await realPostbox.mark(me, got.uid, true);
  expect((await realPostbox.list(me, 30)).messages.find((m) => m.uid === got.uid)!.unread).toBe(false);
  await realPostbox.mark(me, got.uid, false);
  expect((await realPostbox.list(me, 30)).messages.find((m) => m.uid === got.uid)!.unread).toBe(true);

  await realPostbox.send(me, { from: { name: 'Me Myself', address: me.address }, to: [{ name: 'Sam Doe', address: sam.address }], cc: [], subject: `Re: ${subject}`,
    text: 'Yes — see you then. ✓', in_reply_to: whole.message_id, references: [whole.message_id!] }, got.uid);
  const back = (await realPostbox.list(sam, 30)).messages.find((m) => m.subject === `Re: ${subject}`)!;
  const reply = (await realPostbox.read(sam, back.uid))!;
  expect([reply.from, reply.text.trim(), reply.references]).toEqual([{ name: 'Me Myself', address: 'me@example.org' }, 'Yes — see you then. ✓', [whole.message_id]]);
}, 60_000);
