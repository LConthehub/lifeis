/**
 * Email: read your inbox and answer it, with any provider that speaks the ordinary mail languages (IMAP to
 * read, SMTP to send). An outside service, and so off until a person adds an account.
 *
 * What is kept here is only the account: the address, where its servers are, and its password, locked. No
 * message is ever stored: the inbox is read from the provider when it's looked at. Opening a message doesn't
 * mark it read; that is done only when asked. A reply goes out through the provider, and a copy is put in
 * its Sent folder, as a mail program would.
 *
 * Two things differ by where Life Is runs, so they are handed in: `postbox` talks to the mail servers, and
 * `sealer` locks the password before it is stored.
 */
import type { Sealer } from './connections.ts';
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { clean, stamp, type Clock } from './small.ts';

export const MAIL_SERVICE = {
  sends: 'Life Is signs in to your mail provider from this computer, with the address and password you give. Nothing goes anywhere else. ' +
    'Messages are read from your provider when you look and are never kept here; only the account details are, with the password locked.',
};

export type Who = { name: string | null; address: string };
/** Everything needed to sign in to one account. */
export type MailServer = {
  address: string; name: string | null; username: string; password: string;
  imap_host: string; imap_port: number; smtp_host: string; smtp_port: number;
  /** A server on the person's own computer or network: it may have a certificate nobody else vouches for. */
  local: boolean;
};
export type MailAccount = Omit<MailServer, 'password'> & { id: number };
export type MailAccountInput = {
  address: string; name?: string | null; username?: string | null; password?: string | null;
  imap_host?: string | null; imap_port?: number | null; smtp_host?: string | null; smtp_port?: number | null; local?: boolean;
};
export type MailSummary = { uid: number; from: Who | null; subject: string; date: string | null; unread: boolean; flagged: boolean };
export type MailMessage = MailSummary & {
  to: Who[]; cc: Who[]; reply_to: Who | null; text: string; attachments: string[];
  message_id: string | null; references: string[];
};
export type Outgoing = { from: Who; to: Who[]; cc: Who[]; subject: string; text: string; in_reply_to: string | null; references: string[] };
export type Inbox = { messages: MailSummary[]; unread: number };

/** Talks to the mail servers. Each call signs in, does its one thing, and signs out. Says what went wrong as a Problem. */
export type Postbox = {
  /** Signs in for reading and for sending, to show the details work. */
  check(server: MailServer): Promise<void>;
  /** The newest messages in the inbox, newest first, and how many are unread in all. */
  list(server: MailServer, limit: number): Promise<Inbox>;
  /** One message, without marking it read. Null when it's gone. */
  read(server: MailServer, uid: number): Promise<MailMessage | null>;
  mark(server: MailServer, uid: number, seen: boolean): Promise<void>;
  /** Sends it, keeps a copy in Sent, and marks the message it answers as answered. */
  send(server: MailServer, message: Outgoing, answers: number | null): Promise<void>;
};

/** Whether a host is on the person's own computer or network, going by its name. */
export function isNearby(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === 'host.docker.internal' || h === '::1' || /\.(local|lan|internal|home\.arpa|localhost)$/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const called = (who: Who | null) => (who ? (who.name ? `${who.name} <${who.address}>` : who.address) : 'someone');

/** The reply to a message: who it goes to, its subject, and the original quoted beneath what was written. */
export function buildReply(account: Pick<MailServer, 'address' | 'name'>, original: MailMessage, text: string, all: boolean): Outgoing {
  const first = original.reply_to ?? original.from;
  if (!first) throw new Problem(400, "That message doesn't say who it's from, so it can't be answered");
  const seen = new Set<string>([first.address.toLowerCase(), account.address.toLowerCase()]);
  const others = (list: Who[]) => list.filter((who) => !seen.has(who.address.toLowerCase()) && Boolean(seen.add(who.address.toLowerCase())));
  const to = [first, ...(all ? others(original.to) : [])];
  const cc = all ? others(original.cc) : [];
  const subject = original.subject.replace(/[\r\n]+/g, ' ').trim();
  const when = original.date ? ` on ${original.date.slice(0, 10)}` : '';
  const quoted = original.text.replace(/\r\n/g, '\n').trimEnd().split('\n').map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`)).join('\n');
  return {
    from: { name: account.name, address: account.address }, to, cc,
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject || '(no subject)'}`,
    text: `${text.replace(/\r\n/g, '\n').trimEnd()}\n\n${called(original.from)} wrote${when}:\n${quoted}\n`,
    in_reply_to: original.message_id,
    references: original.message_id ? [...original.references.filter((id) => id !== original.message_id), original.message_id] : original.references,
  };
}

type Row = Omit<MailAccount, 'local'> & { password: string; local: number };
type Glance = { id: number; address: string; unread: number; newest: MailSummary[]; problem: string | null };
/** What the front page was last told, for a couple of minutes, so it doesn't sign in on every look. */
const glances = new WeakMap<Db, Map<number, { at: number; glance: Glance }>>();
const GLANCE_MINUTES = 2;

export function mail(db: Db, owner: number, clock: Clock = () => new Date(), tools?: { postbox: Postbox; sealer: Sealer }) {
  const COLUMNS = 'id, address, name, username, password, imap_host, imap_port, smtp_host, smtp_port, local';
  const open = (row: Row): MailAccount => ({ id: row.id, address: row.address, name: row.name, username: row.username,
    imap_host: row.imap_host, imap_port: row.imap_port, smtp_host: row.smtp_host, smtp_port: row.smtp_port, local: row.local === 1 });
  const need = () => {
    if (!tools) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    return tools;
  };
  const forget = (id: number) => glances.get(db)?.delete(id);

  async function row(id: number): Promise<Row> {
    const found = await db.get<Row>(`SELECT ${COLUMNS} FROM mail_accounts WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }
  async function server(id: number): Promise<MailServer> {
    const found = await row(id);
    const password = need().sealer.unseal(found.password);
    if (password === null) throw new Problem(400, "This account's password can't be opened any more. Enter it again in Settings.");
    return { ...open(found), password };
  }

  function checked(input: MailAccountInput, password: string): MailServer {
    const address = clean(input.address, 200);
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Problem(400, 'Give the email address');
    const host = (text: string | null | undefined, what: string) => {
      const value = clean(text, 200)?.toLowerCase();
      if (!value || !/^[a-z0-9.:-]+$/.test(value)) throw new Problem(400, `Give the ${what} server's name, like imap.example.com`);
      return value;
    };
    const port = (value: number | null | undefined, what: string) => {
      if (!(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535)) throw new Problem(400, `Give the ${what} port, a number like 993`);
      return value;
    };
    const made: MailServer = {
      address, name: clean(input.name, 100), username: clean(input.username, 200) ?? address, password,
      imap_host: host(input.imap_host, 'incoming (IMAP)'), imap_port: port(input.imap_port ?? 993, 'incoming'),
      smtp_host: host(input.smtp_host, 'outgoing (SMTP)'), smtp_port: port(input.smtp_port ?? 465, 'outgoing'),
      local: input.local === true,
    };
    // A password is only ever sent without a vouched-for, encrypted line to a server on the person's own network.
    if (made.local && !(isNearby(made.imap_host) && isNearby(made.smtp_host))) {
      throw new Problem(400, '"On my own computer or network" is only for servers there (like localhost or 192.168…). Untick it for a mail provider on the internet.');
    }
    return made;
  }

  return {
    available: () => Boolean(tools),

    async accounts(): Promise<MailAccount[]> {
      return (await db.all<Row>(`SELECT ${COLUMNS} FROM mail_accounts WHERE owner_id = ? ORDER BY id`, [owner])).map(open);
    },

    /** Add an account. It is only saved once signing in has worked, for reading and for sending. */
    async addAccount(input: MailAccountInput): Promise<MailAccount> {
      const { postbox, sealer } = need();
      if (!input.password) throw new Problem(400, 'Give the password (for many providers, an "app password" made for this)');
      if ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mail_accounts WHERE owner_id = ?', [owner]))!.n >= 10) throw new Problem(400, 'Ten accounts at most');
      const s = checked(input, input.password);
      await postbox.check(s);
      const made = await db.run(
        `INSERT INTO mail_accounts (owner_id, address, name, username, password, imap_host, imap_port, smtp_host, smtp_port, local, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner, s.address, s.name, s.username, sealer.seal(s.password), s.imap_host, s.imap_port, s.smtp_host, s.smtp_port, s.local ? 1 : 0, stamp(clock())]);
      return open(await row(made.lastId));
    },

    /** Change an account. A password left out stays as it is. */
    async updateAccount(id: number, input: MailAccountInput): Promise<MailAccount> {
      const { postbox, sealer } = need();
      const s = checked(input, input.password || (await server(id)).password);
      await postbox.check(s);
      await db.run(
        `UPDATE mail_accounts SET address = ?, name = ?, username = ?, password = ?, imap_host = ?, imap_port = ?, smtp_host = ?, smtp_port = ?, local = ?
         WHERE id = ? AND owner_id = ?`,
        [s.address, s.name, s.username, sealer.seal(s.password), s.imap_host, s.imap_port, s.smtp_host, s.smtp_port, s.local ? 1 : 0, id, owner]);
      forget(id);
      return open(await row(id));
    },

    /** Take an account away. Its details and password are forgotten; nothing at the provider changes. */
    async removeAccount(id: number): Promise<void> {
      await db.run('DELETE FROM mail_accounts WHERE id = ? AND owner_id = ?', [id, owner]);
      forget(id);
    },

    async inbox(id: number, limit = 30): Promise<Inbox> {
      if (!(Number.isInteger(limit) && limit >= 1 && limit <= 100)) throw new Problem(400, '1 to 100 messages');
      return need().postbox.list(await server(id), limit);
    },

    async message(id: number, uid: number): Promise<MailMessage> {
      const found = await need().postbox.read(await server(id), uid);
      if (!found) throw new Problem(404, "That message isn't in the inbox any more");
      return found;
    },

    async mark(id: number, uid: number, seen: boolean): Promise<void> {
      await need().postbox.mark(await server(id), uid, seen);
      forget(id);
    },

    /** Answer a message: to its sender, or to everyone it went to. The original is quoted beneath. */
    async reply(id: number, uid: number, input: { text: string; all?: boolean }): Promise<{ sent: true; to: Who[]; cc: Who[] }> {
      const { postbox } = need();
      if (!input.text.trim()) throw new Problem(400, 'Write the reply first');
      if (input.text.length > 100_000) throw new Problem(400, "That's too long to send from here");
      const s = await server(id);
      const original = await postbox.read(s, uid);
      if (!original) throw new Problem(404, "That message isn't in the inbox any more");
      const out = buildReply(s, original, input.text, input.all === true);
      await postbox.send(s, out, uid);
      forget(id);
      return { sent: true, to: out.to, cc: out.cc };
    },

    /** For the front page: each account's unread count and its newest unread few. An account that can't be read says why. */
    async glance(): Promise<Glance[]> {
      const { postbox } = need();
      const kept = glances.get(db) ?? glances.set(db, new Map()).get(db)!;
      const out: Glance[] = [];
      for (const account of await this.accounts()) {
        const had = kept.get(account.id);
        const age = had ? (clock().getTime() - had.at) / 60_000 : Infinity;
        if (had && age >= 0 && age < GLANCE_MINUTES) { out.push(had.glance); continue; }
        let glance: Glance;
        try {
          const inbox = await postbox.list(await server(account.id), 30);
          glance = { id: account.id, address: account.address, unread: inbox.unread, newest: inbox.messages.filter((m) => m.unread).slice(0, 5), problem: null };
        } catch (problem) {
          glance = { id: account.id, address: account.address, unread: 0, newest: [], problem: problem instanceof Problem ? problem.message : "Couldn't be read just now" };
        }
        kept.set(account.id, { at: clock().getTime(), glance });
        out.push(glance);
      }
      return out;
    },
  };
}

export type Mail = ReturnType<typeof mail>;
export { sameAddress };
