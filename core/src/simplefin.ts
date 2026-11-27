/**
 * Reading bank accounts into spending, through SimpleFIN. An outside service, and so off until a person turns it on.
 *
 * SimpleFIN (simplefin.org) is a service a person signs up for themselves. It gives out a one-time "setup token".
 * The token is a web address, hidden in base64, that can be used once: claiming it (an empty POST) answers with a
 * private "access address" that reads that person's accounts. Life Is keeps the access address sealed (see
 * `Sealer`) and never gives it to a page, a log or the export. Only its host name and the time it was connected are
 * ever shown.
 *
 * It only reads. Money out that has settled becomes a spending entry in whole cents, in no category unless the
 * person picked one for that account; money in and pending items are left out. A transaction already brought in
 * is never brought in twice (its SimpleFIN account and transaction id stay on the entry), and nor is one that
 * looks like an entry already written by hand or by a statement import (the same rule as bankStatement.ts).
 *
 * There is no schedule: SimpleFIN limits how often an account may be read, so it is read only when asked.
 *
 * `fetcher` and `sealer` differ by where Life Is runs, so they are handed in. Where there is no fetcher (the phone
 * app keeping everything on the phone), this cannot be turned on.
 */
import type { Fetcher, Sealer } from './connections.ts';
import { atomic, type Db } from './db.ts';
import { money, type StatementItem } from './money.ts';
import { Problem } from './problem.ts';
import { clean, localDay, stamp, todayOf, type Clock } from './small.ts';

export const SIMPLEFIN_SERVICE = {
  name: 'SimpleFIN',
  site: 'https://www.simplefin.org/',
  bridge: 'https://bridge.simplefin.org/',
  sends: 'Your setup token is used once: Life Is sends an empty request to the SimpleFIN server the token names, which answers with a private access address. After that, only when you press "Read now", Life Is asks that same server, using the access address, for your accounts and their transactions for the dates you choose. Nothing from Life Is is sent to it: none of your entries, categories or notes. It can only read; it cannot move money.',
};
/** The most days back a reading can go, and what it goes back when nothing is said. */
export const SIMPLEFIN_MAX_DAYS = 90;
export const SIMPLEFIN_DEFAULT_DAYS = 30;

const ON = 'simplefin_on';
const DAY = 86_400_000;

/** One account SimpleFIN lists, as kept so the person can choose it. `id` is Life Is's own number for it. */
export type BankAccount = { id: number; name: string; org: string | null; currency: string | null; balance_cents: number | null; chosen: boolean; category_id: number | null };
export type SimplefinState = {
  /** Whether this copy of Life Is can reach outside and keep a secret. False in the phone app that keeps everything on the phone. */
  available: boolean;
  on: boolean;
  service: typeof SIMPLEFIN_SERVICE;
  /** Only the bank server's host name and when it was connected. The access address itself is never given out. */
  connection: { host: string; connected_at: string; last_read_at: string | null } | null;
  accounts: BankAccount[];
  max_days: number;
  default_days: number;
};
/** What a reading did. `errors` are the words SimpleFIN itself returned, shown as they are. */
export type SimplefinRead = {
  from_day: string;
  listed: number;
  added: number;
  already: number;
  left_out: number;
  /** Of those left out: money that came in, items still pending, and anything else (such as an amount of nothing). */
  money_in: number;
  pending: number;
  other: number;
  months: { month: string; added: number }[];
  errors: string[];
  state: SimplefinState;
};

/** What a test may change: allow a stand-in on this computer. Real use never sets it. */
export type SimplefinTools = { sealer?: Sealer; allowLocal?: boolean };

// ---------- addresses ----------

/**
 * Whether a host is this computer, a private or local network, or has no real internet name. A SimpleFIN address
 * must be none of those: it would let a pasted token make Life Is ask something on the person's own network.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (['localhost', 'host.docker.internal', 'gateway.docker.internal'].includes(h) || /\.(local|lan|home\.arpa|ts\.net|localhost|internal|intranet|corp|home|private)$/.test(h)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) {
    // An address in the shape of IPv6: only a public one outside these ranges would do, and none is ever needed here.
    return h === '::' || h === '::1' || h.startsWith('::ffff:') || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h) || /^(0{1,4}:){5,7}/.test(h) || !/^2[0-3][0-9a-f]{2}:/.test(h);
  }
  // A name with no dot ("intranet", "nas") is on someone's own network.
  return !h.includes('.');
}

const REFUSE_ADDRESS = (what: string) => new Problem(400, `That ${what} isn't one Life Is will use. A SimpleFIN address starts with https:// and names a server on the internet, not one on this computer or network.`);

function checkedAddress(url: URL, what: string, allowLocal: boolean): void {
  if (allowLocal ? !/^https?:$/.test(url.protocol) : url.protocol !== 'https:') throw REFUSE_ADDRESS(what);
  if (!allowLocal && isPrivateHost(url.hostname)) throw REFUSE_ADDRESS(what);
}

/** The claim address inside a setup token (base64 of a web address), refused unless it is a public https one. */
export function claimAddress(token: string, allowLocal = false): URL {
  const text = token.replace(/\s+/g, '');
  if (!text || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(text) || text.length > 4000) {
    throw new Problem(400, "That doesn't look like a SimpleFIN setup token. It is one long run of letters and numbers: copy it whole from your SimpleFIN account.");
  }
  let decoded: string;
  try {
    const plain = text.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(plain + '='.repeat((4 - (plain.length % 4)) % 4)), (c) => c.charCodeAt(0));
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Problem(400, "That doesn't look like a SimpleFIN setup token. It is one long run of letters and numbers: copy it whole from your SimpleFIN account.");
  }
  let url: URL;
  try { url = new URL(decoded.trim()); } catch { throw new Problem(400, "That doesn't look like a SimpleFIN setup token. It doesn't hold a web address."); }
  if (url.username || url.password) throw REFUSE_ADDRESS('token');
  checkedAddress(url, 'token', allowLocal);
  return url;
}

// ---------- amounts and answers ----------

/** An amount as SimpleFIN writes it ("-12.30", "5", "1234.5") in whole cents; null when it is not a plain decimal. Halves round away from zero. */
export function centsOf(text: unknown): number | null {
  const s = typeof text === 'number' && Number.isFinite(text) ? String(text) : text;
  if (typeof s !== 'string') return null;
  const m = /^\s*([+-]?)(\d{1,13})(?:\.(\d*))?\s*$/.exec(s) ?? /^\s*([+-]?)()\.(\d+)\s*$/.exec(s);
  if (!m) return null;
  const fraction = (m[3] ?? '').padEnd(3, '0');
  let value = Number(m[2] || '0') * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) value += 1;
  return m[1] === '-' ? (value === 0 ? 0 : -value) : value;
}

type Seen = { account_id: string; name: string; org: string | null; currency: string | null; balance_cents: number | null; transactions: Txn[] };
type Txn = { id: string; day: string | null; cents: number | null; label: string; pending: boolean };
type Reading = { errors: string[]; accounts: Seen[] };

const words = (value: unknown, most: number) => (typeof value === 'string' ? clean(value.replace(/\s+/g, ' '), most) : null);
// The day the person saw it happen, in their own time zone (a purchase at 8 pm is not tomorrow). `behind` is how many
// minutes their clock is behind UTC, as a browser's getTimezoneOffset() gives it; without it, this computer's zone.
const dayOfUnix = (seconds: number, behind: number | null) => (behind === null ? localDay(new Date(seconds * 1000))
  : new Date(seconds * 1000 - behind * 60_000).toISOString().slice(0, 10));

/** What SimpleFIN answered, read carefully: anything of the wrong shape is passed over, never trusted. */
export function readAnswer(body: unknown, behind: number | null = null): Reading {
  const top = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: string[] = [];
  for (const list of [top.errors, top.errlist]) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const text = typeof e === 'string' ? e : e && typeof e === 'object' ? (e as Record<string, unknown>).msg ?? (e as Record<string, unknown>).message : null;
      const said = words(text, 300);
      if (said && !errors.includes(said) && errors.length < 20) errors.push(said);
    }
  }
  const accounts: Seen[] = [];
  for (const a of Array.isArray(top.accounts) ? top.accounts.slice(0, 200) : []) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim().slice(0, 200) : '';
    if (!id) continue;
    const org = r.org && typeof r.org === 'object' ? r.org as Record<string, unknown> : {};
    const transactions: Txn[] = [];
    for (const t of Array.isArray(r.transactions) ? r.transactions.slice(0, 5000) : []) {
      if (!t || typeof t !== 'object') continue;
      const x = t as Record<string, unknown>;
      const tid = typeof x.id === 'string' ? x.id.trim().slice(0, 200) : '';
      if (!tid) continue;
      const posted = typeof x.posted === 'number' && Number.isFinite(x.posted) && x.posted > 0 ? x.posted : null;
      transactions.push({
        id: tid,
        day: posted !== null && posted < 8_640_000_000_000 ? dayOfUnix(posted, behind) : null,
        cents: centsOf(x.amount),
        label: words(x.payee, 200) ?? words(x.description, 200) ?? words(x.memo, 200) ?? '(no description)',
        pending: x.pending === true || posted === null,
      });
    }
    accounts.push({
      account_id: id, name: words(r.name, 120) ?? 'Account', org: words(org.name, 120) ?? words(org.domain, 120),
      currency: words(r.currency, 40), balance_cents: centsOf(r.balance), transactions,
    });
  }
  return { errors, accounts };
}

const utf8Base64 = (text: string) => btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));

export function simplefin(db: Db, owner: number, clock: Clock = () => new Date(), fetcher?: Fetcher, tools: SimplefinTools = {}) {
  const allowLocal = tools.allowLocal === true;
  const available = Boolean(fetcher && tools.sealer);
  const isOn = async () => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, ON]))?.value === '1';
  const held = () => db.get<{ id: number; access: string; host: string; connected_at: string; last_read_at: string | null }>(
    'SELECT id, access, host, connected_at, last_read_at FROM simplefin_connections WHERE owner_id = ?', [owner]);

  const state = async (): Promise<SimplefinState> => {
    const c = await held();
    const accounts = c ? (await db.all<{ id: number; name: string; org: string | null; currency: string | null; balance_cents: number | null; chosen: number; category_id: number | null }>(
      'SELECT id, name, org, currency, balance_cents, chosen, category_id FROM simplefin_accounts WHERE connection_id = ? ORDER BY org, name, id', [c.id]))
      .map((a) => ({ ...a, chosen: a.chosen === 1 })) : [];
    return {
      available, on: available && await isOn(), service: SIMPLEFIN_SERVICE, max_days: SIMPLEFIN_MAX_DAYS, default_days: SIMPLEFIN_DEFAULT_DAYS,
      connection: c ? { host: c.host, connected_at: c.connected_at, last_read_at: c.last_read_at } : null, accounts,
    };
  };
  const mustBeOn = async () => {
    if (!fetcher || !tools.sealer) throw new Problem(400, "This copy of Life Is isn't set up to read bank accounts");
    if (!(await isOn())) throw new Problem(400, 'Reading bank accounts through SimpleFIN is turned off. Turn it on first, in Settings, under "Connections".');
  };

  /** The access address, opened and taken apart: where to ask, and how to sign in. Never leaves this file. */
  const access = async (): Promise<{ connection: number; base: string; auth: string }> => {
    const c = await held();
    if (!c) throw new Problem(400, 'Connect SimpleFIN first.');
    const plain = tools.sealer!.unseal(c.access);
    if (!plain) throw new Problem(400, "The saved SimpleFIN connection can't be opened here any more. Disconnect, and connect again with a new setup token.");
    let url: URL;
    try { url = new URL(plain); } catch { throw new Problem(400, 'The saved SimpleFIN connection is damaged. Disconnect, and connect again with a new setup token.'); }
    checkedAddress(url, 'connection', allowLocal);
    const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
    return { connection: c.id, base: (url.origin + url.pathname).replace(/\/+$/, ''), auth: `Basic ${utf8Base64(`${decode(url.username)}:${decode(url.password)}`)}` };
  };

  /** Asks the bank server for accounts, signed in as the access address says. Plain words for anything that goes wrong. */
  const ask = async (params: Record<string, string>, behind: number | null = null): Promise<{ connection: number; reading: Reading }> => {
    const a = await access();
    const query = new URLSearchParams(params);
    let answer;
    try {
      answer = await fetcher!(`${a.base}/accounts?${query}`, { Accept: 'application/json', Authorization: a.auth }, { method: 'GET', body: '', noRedirect: true });
    } catch {
      throw new Problem(400, "SimpleFIN's server couldn't be reached just now. Try again in a little while.");
    }
    if (answer.status === 402) throw new Problem(400, "SimpleFIN says this connection isn't paid up. Check your account at bridge.simplefin.org.");
    if (answer.status === 401 || answer.status === 403) throw new Problem(400, 'SimpleFIN no longer accepts this connection. It may have been turned off at SimpleFIN. Disconnect, and connect again with a new setup token.');
    if (answer.status === 429) throw new Problem(400, 'SimpleFIN asks for fewer readings. Try again later: a bank connection can only be read so many times a day.');
    if (answer.status !== 200) throw new Problem(400, "SimpleFIN couldn't answer just now. Try again in a moment.");
    try { return { connection: a.connection, reading: readAnswer(await answer.json(), behind) }; } catch { throw new Problem(400, "SimpleFIN's answer couldn't be read."); }
  };

  /** Keeps what SimpleFIN says about each account (a new one is not chosen), leaving what the person chose alone. */
  const remember = async (connection: number, seen: Seen[]) => {
    for (const a of seen) {
      await db.run(
        `INSERT INTO simplefin_accounts (connection_id, account_id, name, org, currency, balance_cents) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, account_id) DO UPDATE SET name = excluded.name, org = excluded.org, currency = excluded.currency, balance_cents = excluded.balance_cents`,
        [connection, a.account_id, a.name, a.org, a.currency, a.balance_cents]);
    }
  };

  return {
    state,

    /** Turn reading on or off. Off, nothing is ever asked of SimpleFIN. A connection already made stays, sealed, for next time. */
    async turn(wanted: boolean): Promise<SimplefinState> {
      if (wanted && !available) throw new Problem(400, "This copy of Life Is isn't set up to read bank accounts");
      if (wanted) await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, '1') ON CONFLICT(user_id, key) DO UPDATE SET value = '1'`, [owner, ON]);
      else await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, ON]);
      return state();
    },

    /**
     * Claim a setup token. It can be claimed once: if SimpleFIN refuses, nothing is kept and the person is told the
     * token was used already or is wrong. On success the access address is sealed and kept, and the accounts are listed
     * (balances only) so they can be chosen. If listing fails, the connection stays and `problem` says why.
     */
    async connect(token: string): Promise<SimplefinState & { problem: string | null }> {
      await mustBeOn();
      if (await held()) throw new Problem(409, 'SimpleFIN is connected already. Disconnect it first to use a different setup token.');
      const claim = claimAddress(typeof token === 'string' ? token : '', allowLocal);
      let answer;
      try {
        answer = await fetcher!(claim.href, { Accept: 'text/plain' }, { method: 'POST', body: '', noRedirect: true });
      } catch {
        throw new Problem(400, "The SimpleFIN server named by that token couldn't be reached. Nothing was kept. Try again in a little while: the token is still good if it was never claimed.");
      }
      let given = '';
      if (answer.status === 200) { try { given = new TextDecoder().decode(await answer.bytes()).trim(); } catch { given = ''; } }
      const wrong = () => new Problem(400, 'SimpleFIN did not accept that token. A setup token can be used only once, so it has been used already, or it is wrong. Nothing was kept. Make a new token at SimpleFIN and try again.');
      if (answer.status !== 200) throw wrong();
      let url: URL;
      try { url = new URL(given); } catch { throw wrong(); }
      if (!url.username || !url.password) throw wrong();
      checkedAddress(url, 'connection', allowLocal);
      await db.run('INSERT INTO simplefin_connections (owner_id, access, host, connected_at) VALUES (?, ?, ?, ?)', [owner, tools.sealer!.seal(url.href), url.hostname, stamp(clock())]);
      let problem: string | null = null;
      try {
        const got = await ask({ 'balances-only': '1' });
        await remember(got.connection, got.reading.accounts);
        if (got.reading.errors.length) problem = got.reading.errors.join(' ');
      } catch (p) { problem = p instanceof Problem ? p.message : "The accounts couldn't be listed just now."; }
      return { ...(await state()), problem };
    },

    /** Ask SimpleFIN which accounts there are (balances only, no transactions), to choose from. */
    async refresh(): Promise<SimplefinState & { errors: string[] }> {
      await mustBeOn();
      const got = await ask({ 'balances-only': '1' });
      await remember(got.connection, got.reading.accounts);
      return { ...(await state()), errors: got.reading.errors };
    },

    /** Choose which accounts are brought in, and the category (if any) for each. Accounts not named are left as they are. */
    async choose(choices: { id: number; chosen: boolean; category_id?: number | null }[]): Promise<SimplefinState> {
      const c = await held();
      if (!c) throw new Problem(400, 'Connect SimpleFIN first.');
      await atomic(db, async (tx) => {
        for (const choice of choices) {
          const mine = await tx.get('SELECT 1 AS x FROM simplefin_accounts WHERE id = ? AND connection_id = ?', [choice.id, c.id]);
          if (!mine) throw new Problem(404, "That account isn't here anymore. It may have been deleted.");
          const category = choice.category_id ?? null;
          if (category !== null && !(await tx.get(
            'SELECT 1 AS x FROM money_categories k WHERE k.id = ? AND (k.owner_id = ? OR EXISTS (SELECT 1 FROM money_shares s WHERE s.category_id = k.id AND s.user_id = ?))', [category, owner, owner]))) {
            throw new Problem(404, "That account isn't here anymore. It may have been deleted.");
          }
          await tx.run('UPDATE simplefin_accounts SET chosen = ?, category_id = ? WHERE id = ?', [choice.chosen ? 1 : 0, category, choice.id]);
        }
      });
      return state();
    },

    /**
     * Read the chosen accounts from `from_day` (the last 30 days when left out; never more than 90 back) and bring in
     * what was spent. One change to the entries: all of it or none.
     */
    async read(input: { from_day?: string | null; minutes_behind_utc?: number | null } = {}): Promise<SimplefinRead> {
      const behind = typeof input.minutes_behind_utc === 'number' && Number.isInteger(input.minutes_behind_utc) && Math.abs(input.minutes_behind_utc) <= 14 * 60 ? input.minutes_behind_utc : null;
      await mustBeOn();
      const today = todayOf(clock);
      const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - SIMPLEFIN_MAX_DAYS * DAY).toISOString().slice(0, 10);
      const from = input.from_day ? input.from_day : new Date(Date.parse(`${today}T00:00:00Z`) - SIMPLEFIN_DEFAULT_DAYS * DAY).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) throw new Problem(400, 'Choose the day to read from.');
      if (from < earliest) throw new Problem(400, `SimpleFIN readings go back ${SIMPLEFIN_MAX_DAYS} days at most. Choose a day on or after ${earliest}.`);
      if (from > today) throw new Problem(400, 'Choose a day that is today or before.');
      const chosen = await db.all<{ account_id: string; category_id: number | null }>(
        `SELECT a.account_id, a.category_id FROM simplefin_accounts a JOIN simplefin_connections c ON c.id = a.connection_id WHERE c.owner_id = ? AND a.chosen = 1`, [owner]);
      if (chosen.length === 0) throw new Problem(400, 'Choose at least one account to bring in first.');

      const start = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
      const end = Math.floor(clock().getTime() / 1000) + 86_400;
      const got = await ask({ 'start-date': String(start), 'end-date': String(end), pending: '1' }, behind);
      await remember(got.connection, got.reading.accounts);

      // A category that is no longer one the person can use is dropped, not allowed to refuse the whole reading.
      const usable = new Set((await db.all<{ id: number }>(
        'SELECT k.id FROM money_categories k WHERE k.owner_id = ? OR EXISTS (SELECT 1 FROM money_shares s WHERE s.category_id = k.id AND s.user_id = ?)', [owner, owner])).map((k) => k.id));
      const result: SimplefinRead = { from_day: from, listed: 0, added: 0, already: 0, left_out: 0, money_in: 0, pending: 0, other: 0, months: [], errors: got.reading.errors, state: undefined as unknown as SimplefinState };
      const items: StatementItem[] = [];
      let byId = 0;
      for (const account of got.reading.accounts) {
        const want = chosen.find((c) => c.account_id === account.account_id);
        if (!want) continue;
        for (const t of account.transactions) {
          if (t.day !== null && t.day < from) continue; // a bank may answer with more than was asked for
          result.listed += 1;
          if (t.pending) { result.pending += 1; continue; }
          if (t.cents === null || t.cents === 0) { result.other += 1; continue; }
          if (t.cents > 0) { result.money_in += 1; continue; }
          if (await db.get('SELECT 1 AS x FROM money_entries WHERE owner_id = ? AND bank_account = ? AND bank_txn = ?', [owner, account.account_id, t.id])) { byId += 1; continue; }
          items.push({ label: t.label, cents: -t.cents, day: t.day!, keep: true, category_id: want.category_id !== null && usable.has(want.category_id) ? want.category_id : null, bank: { account: account.account_id, txn: t.id } });
        }
      }
      result.left_out = result.pending + result.money_in + result.other;
      const done = await money(db, owner, clock).bringIn(items);
      result.added = done.added;
      result.already = done.already + byId;
      result.months = done.months;
      await db.run('UPDATE simplefin_connections SET last_read_at = ? WHERE owner_id = ?', [stamp(clock()), owner]);
      result.state = await state();
      return result;
    },

    /** Forget the connection and the chosen accounts. What was already brought in as spending stays. */
    async disconnect(): Promise<SimplefinState> {
      await db.run('DELETE FROM simplefin_connections WHERE owner_id = ?', [owner]);
      return state();
    },
  };
}
