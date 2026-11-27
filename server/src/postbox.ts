/**
 * The real postbox: where Life Is talks to a person's mail provider. IMAP to read (imapflow), SMTP to send
 * (nodemailer), and mailparser to turn a message into plain words. It talks only to the two servers named
 * on the account. What it does and when is core/'s mail.ts.
 *
 * The line is always encrypted: straight away on the usual secure ports (993, 465), otherwise by upgrading
 * (STARTTLS), which is insisted on. Only a server marked as being on the person's own network may have a
 * certificate nobody vouches for, or no encryption at all.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { Problem, type MailMessage, type MailServer, type MailSummary, type Outgoing, type Postbox, type Who } from '../../core/src/index.ts';

const MAX_TEXT = 200_000;

function reader(s: MailServer): ImapFlow {
  const secure = s.imap_port === 993;
  const client = new ImapFlow({
    host: s.imap_host, port: s.imap_port, secure, auth: { user: s.username, pass: s.password }, logger: false,
    ...(secure || s.local ? {} : { doSTARTTLS: true }),
    ...(s.local ? { tls: { rejectUnauthorized: false } } : {}),
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  });
  client.on('error', () => {}); // a dropped line is reported by whatever was waiting on it
  return client;
}

function sender(s: MailServer) {
  const secure = s.smtp_port === 465;
  return nodemailer.createTransport({
    host: s.smtp_host, port: s.smtp_port, secure, auth: { user: s.username, pass: s.password },
    ...(secure || s.local ? {} : { requireTLS: true }),
    ...(s.local ? { tls: { rejectUnauthorized: false } } : {}),
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  });
}

/** Says what went wrong in words a person can act on. Never repeats the password. */
function explain(problem: unknown, what: 'reading' | 'sending', s: MailServer): Problem {
  if (problem instanceof Problem) return problem;
  const e = problem as { authenticationFailed?: boolean; code?: string; responseCode?: number; message?: string };
  const host = what === 'reading' ? s.imap_host : s.smtp_host;
  if (e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535) {
    return new Problem(400, `${host} didn't accept that username and password. Many providers (Gmail, iCloud, Yahoo, Fastmail) need an "app password" made in your account's security settings, not your everyday one.`);
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ESOCKET', 'ECONNECTION', 'ETIMEOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT'].includes(e.code ?? '')) {
    return new Problem(400, `Couldn't reach ${host} for ${what}. Check the server's name and port.`);
  }
  if (/certificate|self.signed|SSL|TLS/i.test(e.message ?? '')) {
    return new Problem(400, `${host} couldn't be reached over an encrypted line that can be trusted. If it's a server on your own network, check "On my own computer or network".`);
  }
  return new Problem(400, `${host} answered with an error while ${what}${e.message ? `: ${String(e.message).slice(0, 160)}` : ''}`);
}

async function reading<T>(s: MailServer, work: (client: ImapFlow) => Promise<T>, box: string | null = 'INBOX'): Promise<T> {
  const client = reader(s);
  try {
    await client.connect();
    if (box === null) return await work(client);
    const lock = await client.getMailboxLock(box);
    try {
      return await work(client);
    } finally {
      lock.release();
    }
  } catch (problem) {
    throw explain(problem, 'reading', s);
  } finally {
    await client.logout().catch(() => {});
  }
}

const who = (entry: { name?: string | undefined; address?: string | undefined } | undefined): Who | null =>
  (entry?.address ? { name: entry.name?.trim() || null, address: entry.address } : null);
const people = (list: AddressObject | AddressObject[] | undefined): Who[] =>
  [list ?? []].flat().flatMap((group) => group.value).map(who).filter((w): w is Who => w !== null);
const iso = (date: Date | string | undefined | null): string | null => {
  const at = date ? new Date(date) : null;
  return at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
};

export const realPostbox: Postbox = {
  async check(s) {
    await reading(s, async () => {}, null);
    try {
      await sender(s).verify();
    } catch (problem) {
      throw explain(problem, 'sending', s);
    }
  },

  list: (s, limit) => reading(s, async (client) => {
    const total = client.mailbox ? client.mailbox.exists : 0;
    const messages: MailSummary[] = [];
    if (total > 0) {
      for await (const m of client.fetch(`${Math.max(1, total - limit + 1)}:*`, { uid: true, envelope: true, flags: true, internalDate: true })) {
        messages.push({
          uid: m.uid, from: who(m.envelope?.from?.[0]), subject: m.envelope?.subject?.trim() || '(no subject)',
          date: iso(m.envelope?.date ?? m.internalDate), unread: !m.flags?.has('\\Seen'), flagged: Boolean(m.flags?.has('\\Flagged')),
        });
      }
    }
    const status = await client.status('INBOX', { unseen: true });
    return { messages: messages.sort((a, b) => b.uid - a.uid), unread: (status ? status.unseen : undefined) ?? messages.filter((m) => m.unread).length };
  }),

  read: (s, uid) => reading(s, async (client): Promise<MailMessage | null> => {
    // Asking for the source peeks: the provider doesn't count it as having been read.
    const m = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, internalDate: true }, { uid: true });
    if (!m || !m.source) return null;
    const parsed = await simpleParser(m.source, { skipImageLinks: true });
    const references = [parsed.references ?? []].flat();
    return {
      uid, from: people(parsed.from)[0] ?? null, subject: parsed.subject?.trim() || '(no subject)', date: iso(parsed.date ?? m.internalDate),
      unread: !m.flags?.has('\\Seen'), flagged: Boolean(m.flags?.has('\\Flagged')),
      to: people(parsed.to), cc: people(parsed.cc), reply_to: people(parsed.replyTo)[0] ?? null,
      text: (parsed.text ?? '').slice(0, MAX_TEXT), attachments: parsed.attachments.map((a) => a.filename ?? 'unnamed').slice(0, 50),
      message_id: parsed.messageId ?? null, references,
    };
  }),

  mark: (s, uid, seen) => reading(s, async (client) => {
    if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
  }),

  async send(s, message: Outgoing, answers) {
    const named = (w: Who) => (w.name ? { name: w.name, address: w.address } : w.address);
    const raw = await new MailComposer({
      from: named(message.from), to: message.to.map(named), cc: message.cc.map(named), subject: message.subject, text: message.text,
      ...(message.in_reply_to ? { inReplyTo: message.in_reply_to } : {}), ...(message.references.length ? { references: message.references } : {}),
    }).compile().build();
    try {
      await sender(s).sendMail({ envelope: { from: message.from.address, to: [...message.to, ...message.cc].map((w) => w.address) }, raw });
    } catch (problem) {
      throw explain(problem, 'sending', s);
    }
    // It has gone. Filing the copy and marking the original are niceties: if they fail, the reply was still sent.
    await reading(s, async (client) => {
      if (answers !== null) await client.messageFlagsAdd(String(answers), ['\\Answered'], { uid: true }).catch(() => {});
      const sent = (await client.list()).find((box) => box.specialUse === '\\Sent');
      // Gmail files a copy of everything sent through it by itself; a second would show twice.
      if (sent && !/(^|\.)(gmail|googlemail)\.com$/.test(s.smtp_host)) await client.append(sent.path, raw, ['\\Seen']);
    }).catch(() => {});
  },
};
