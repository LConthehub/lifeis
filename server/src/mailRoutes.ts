/**
 * The addresses for email (/api/mail). What they do is core/'s mail.ts; this reads what was sent and passes
 * it on. The mail servers themselves are only ever reached through the postbox handed in.
 */
import { mail, MAIL_SERVICE, type Db, type Postbox, type Sealer } from '../../core/src/index.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/mail${path.replaceAll(':id', ID).replaceAll(':uid', ID)}$`);

export type MailTools = { postbox: Postbox; sealer: Sealer };

const accountFrom = (body: Body) => ({
  address: read.text(body, 'address'), name: read.maybeText(body, 'name'), username: read.maybeText(body, 'username'), password: read.maybeText(body, 'password'),
  imap_host: read.maybeText(body, 'imap_host'), imap_port: read.maybeWhole(body, 'imap_port'),
  smtp_host: read.maybeText(body, 'smtp_host'), smtp_port: read.maybeWhole(body, 'smtp_port'), local: read.yesNo(body, 'local', false),
});

export function mailRoutes(db: Db, tools: MailTools | undefined): Route[] {
  const post = (c: Context) => mail(db, c.user.id, c.clock, tools);
  /** The message's number: the second one in the address. */
  const uid = (c: Context, pattern: RegExp) => Number(pattern.exec(c.path)![2]);
  const one = at('/accounts/:id/messages/:uid');
  const seen = at('/accounts/:id/messages/:uid/seen');
  const reply = at('/accounts/:id/messages/:uid/reply');

  return [
    ['GET', at(''), async (c) => ({ json: { available: post(c).available(), accounts: await post(c).accounts(), service: MAIL_SERVICE } })],
    ['GET', at('/glance'), async (c) => ({ json: await post(c).glance() })],
    ['POST', at('/accounts'), async (c) => ({ status: 201, json: await post(c).addAccount(accountFrom(c.body)) })],
    ['PUT', at('/accounts/:id'), async (c) => ({ json: await post(c).updateAccount(c.id, accountFrom(c.body)) })],
    ['DELETE', at('/accounts/:id'), async (c) => (await post(c).removeAccount(c.id), { status: 204 })],
    ['GET', at('/accounts/:id/messages'), async (c) => ({ json: await post(c).inbox(c.id, queryNumber(c.query, 'limit') ?? 30) })],
    ['GET', one, async (c) => ({ json: await post(c).message(c.id, uid(c, one)) })],
    ['PUT', seen, async (c) => {
      if (typeof c.body.seen !== 'boolean') throw notUnderstood('seen');
      await post(c).mark(c.id, uid(c, seen), c.body.seen);
      return { status: 204 };
    }],
    ['POST', reply, async (c) => ({ json: await post(c).reply(c.id, uid(c, reply), { text: read.text(c.body, 'text'), all: read.yesNo(c.body, 'all', false) }) })],
  ];
}
