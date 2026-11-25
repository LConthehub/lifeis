/**
 * Reminders that reach you: each morning, at a time the person picks and in their own time zone, a digest of
 * what needs them. Upkeep due, things and food running low or about to go off, the day's dates and plans,
 * coupons about to run out and things lent a long time.
 *
 * It goes only where the person has said, each way off until turned on:
 *   - the phone app's own notifications (made on the phone from what's on it: nothing leaves it),
 *   - an email to themselves, from their own email account already connected to Life Is,
 *   - ntfy, a push service (their own server or ntfy.sh); its messages aren't locked, so by default it says
 *     only how many things there are, not what,
 *   - their browser, locked so that only that browser can read it.
 *
 * The digest is worked out here; how each message is carried is handed in (`tools`), as it differs by where
 * Life Is runs.
 */
import type { Fetcher, Sealer } from './connections.ts';
import { calendar } from './calendar.ts';
import type { Db } from './db.ts';
import { holidays } from './holidays.ts';
import { outdoorTrips } from './outdoorTrips.ts';
import { inventory } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import { mail, type Postbox } from './mail.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, todayOf, type Clock } from './small.ts';
import { upkeep } from './upkeep.ts';

export const COVERS = ['upkeep', 'low', 'dates', 'coupons', 'copy'] as const;
export type Cover = (typeof COVERS)[number];
export type NtfySettings = { server: string; topic: string; detail: 'full' | 'count' };
export type ReminderSettings = {
  /** When the morning digest goes, as 07:30, in `zone`. */
  time: string;
  /** The person's time zone (Europe/London), from their browser. Null: the server's own. */
  zone: string | null;
  covers: Record<Cover, boolean>;
  email: boolean;
  ntfy: NtfySettings | null;
  push: boolean;
  phone: boolean;
  /** The address the person reaches Life Is at, for links in a reminder. */
  origin: string | null;
  /** The last day a digest went, so it goes once a day. */
  last_sent: string | null;
  /** The last day the line about making a copy was said, so it comes at most once a week. */
  copy_nudged: string | null;
};
/** Where a person stands on having a copy of their data kept somewhere else. */
export type CopyState = {
  /** The day they last made a backup or a download, or null. */
  last: string | null;
  /** Days since then; null when never. */
  days: number | null;
  /** Whether they keep anything in Life Is yet. */
  records: boolean;
  /** Days since they began. */
  started_days: number;
  /** Whether the gentle line in Your data is shown: records, and a copy more than 30 days old (or none, after a week of use). */
  stale: boolean;
  /** Whether the morning digest has this line in it as the state stands, apart from how recently it was said. */
  nudge: boolean;
  /** Whether the morning digest line is turned on. */
  remind: boolean;
};
export type DigestLine = { kind: Cover; icon: string; title: string; detail: string | null; link: string; urgent: boolean };
/** One message sent as it stands, not as a list of things for the day (a finished cooking timer). `hidden` is what an ntfy server is told when the person chose to send only counts. */
export type Single = { title: string; body: string; link: string; hidden: { title: string; body: string } };
export type Digest = { day: string; lines: DigestLine[]; title: string; text: string; single?: Single };
export type Channel = 'email' | 'ntfy' | 'push';
export type PushSubscription = { endpoint: string; p256dh: string; auth: string };
/** Carries a message to one browser. 'gone' when the browser has stopped listening, so it's forgotten. */
export type PushSender = (to: PushSubscription, message: { title: string; body: string; url: string }) => Promise<'sent' | 'gone'>;
export type ReminderTools = { fetcher?: Fetcher; mail?: { postbox: Postbox; sealer: Sealer }; push?: PushSender };

export const NTFY_SERVICE = {
  name: 'ntfy', site: 'https://ntfy.sh',
  sends: "Each morning's reminder, to the ntfy server you choose, for the ntfy app on your phone. ntfy messages aren't locked: whoever runs the server can read them, so unless you say otherwise only how many things there are is sent, not what they are. Anyone who knows your topic's name can read it too, so it's made long and random.",
};
export const PUSH_SERVICE = {
  name: 'Browser notifications',
  sends: "Each morning's reminder, locked so only your browser can read it, carried by your browser maker's push service (Google for Chrome and Edge, Apple for Safari, Mozilla for Firefox). They see that a message went, not what it says.",
};
export const EMAIL_SERVICE = {
  name: 'Email to yourself',
  sends: "Each morning's reminder, sent from the email account you connected to Life Is, to that same address. No one new is involved.",
};

const SETTING = 'reminders';
const DEFAULTS: ReminderSettings = {
  time: '07:30', zone: null, covers: { upkeep: true, low: true, dates: true, coupons: true, copy: true },
  email: false, ntfy: null, push: false, phone: false, origin: null, last_sent: null, copy_nudged: null,
};
const COPY_KEY = 'last_copy_made';
/** What a person keeps in Life Is: any one of these having a row means there is something to lose. */
const KEPT_IN = ['recipes', 'items', 'media', 'events', 'pets', 'upkeep_jobs', 'plans', 'money_entries', 'projects'];
const pad = (n: number) => String(n).padStart(2, '0');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The day and time it is now in a time zone (or here, without one). */
export function zoneNow(now: Date, zone: string | null): { day: string; time: string } {
  if (!zone) return { day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Whether a time zone is one this computer knows. */
function knownZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}

/** A long, random ntfy topic: anyone who knows the name can read it. */
export function newTopic(): string {
  const bytes = new Uint8Array(15);
  globalThis.crypto.getRandomValues(bytes);
  return `lifeis-${[...bytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')}`;
}

/** The digest as plain text, for an email or a push: a line each, the urgent first, and where to see it all. */
export function digestText(digest: Digest, origin: string | null): string {
  if (!digest.lines.length) return 'Nothing needs you today.';
  const lines = digest.lines.map((l) => `${l.urgent ? '!' : '•'} ${l.title}${l.detail ? ` — ${l.detail}` : ''}`);
  return [...lines, '', origin ? `See it all: ${origin}/` : 'Open Life Is to see it all.'].join('\n');
}

export function reminders(db: Db, owner: number, clock: Clock = () => new Date(), tools: ReminderTools = {}) {
  async function settings(): Promise<ReminderSettings> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    if (!row?.value) return { ...DEFAULTS, covers: { ...DEFAULTS.covers } };
    try {
      const kept = JSON.parse(row.value) as Partial<ReminderSettings>;
      return { ...DEFAULTS, ...kept, covers: { ...DEFAULTS.covers, ...(kept.covers ?? {}) } };
    } catch { return { ...DEFAULTS, covers: { ...DEFAULTS.covers } }; }
  }
  async function keep(s: ReminderSettings): Promise<void> {
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      [owner, SETTING, JSON.stringify(s)]);
  }

  const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

  /** Where the person stands on a copy kept elsewhere. Nothing about it leaves here. */
  async function copyState(): Promise<CopyState> {
    const s = await settings();
    const day = todayOf(clock);
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, COPY_KEY]);
    const last = isDay(row?.value) ? row!.value : null;
    const days = last ? Math.max(0, dayNumber(day) - dayNumber(last)) : null;
    const began = await db.get<{ created_at: string | null }>('SELECT created_at FROM users WHERE id = ?', [owner]);
    const startDay = (began?.created_at ?? '').slice(0, 10);
    const started_days = isDay(startDay) ? Math.max(0, dayNumber(day) - dayNumber(startDay)) : 0;
    let records = false;
    for (const table of KEPT_IN) {
      if (await db.get(`SELECT 1 AS one FROM ${table} WHERE owner_id = ? LIMIT 1`, [owner])) { records = true; break; }
    }
    const stale = records && (days === null ? started_days > 7 : days > 30);
    const nudge = records && (days === null ? started_days : days) > 30;
    return { last, days, records, started_days, stale, nudge, remind: s.covers.copy };
  }

  /** What needs the person today. `day` is their today. */
  async function digest(): Promise<Digest> {
    const s = await settings();
    const day = todayOf(clock);
    const lines: DigestLine[] = [];
    if (s.covers.upkeep) {
      for (const j of await upkeep(db, owner, clock).list()) {
        const d = j.due;
        const near = d.state === 'overdue' || d.state === 'due' || (d.state === 'soon' && ((d.days_left !== null && d.days_left <= 3) || d.reading_left !== null));
        if (!near) continue;
        const when = d.state === 'overdue' ? (d.days_left !== null && d.days_left < 0 ? `late by ${plural(-d.days_left, 'day')}` : 'past its reading')
          : d.state === 'due' ? 'due today' : d.days_left !== null && d.days_left <= 3 ? `due in ${plural(d.days_left, 'day')}` : `due in ${d.reading_left!.toLocaleString('en')}${j.reading_unit ? ` ${j.reading_unit}` : ''}`;
        const who = j.assigned_to && j.assigned_to.id !== owner ? `${j.assigned_to.name} usually does it` : null;
        lines.push({ kind: 'upkeep', icon: '🔧', title: j.name, detail: [when, who].filter(Boolean).join(' · '), link: `/things/upkeep/${j.id}`, urgent: d.state !== 'soon' });
      }
    }
    if (s.covers.upkeep) {
      // A warranty about to end is said a month ahead, a week ahead, the day before and on the day: not every morning.
      for (const t of await inventory(db, owner, clock).listItems()) {
        if (t.warranty_days === null || ![30, 7, 1, 0].includes(t.warranty_days)) continue;
        const when = t.warranty_days === 0 ? 'ends today' : t.warranty_days === 1 ? 'ends tomorrow' : `ends in ${t.warranty_days} days`;
        lines.push({ kind: 'upkeep', icon: '🛡', title: `Warranty: ${t.name}`, detail: `${when} · anything wrong with it?`, link: `/things/${t.id}`, urgent: t.warranty_days <= 1 });
      }
    }
    if (s.covers.low) {
      for (const t of await inventory(db, owner, clock).listItems({ low: true })) {
        lines.push({ kind: 'low', icon: '📦', title: t.name, detail: `running low: ${t.amount} left`, link: `/things/${t.id}`, urgent: false });
      }
      const pantry = await kitchen(db, owner, clock).listPantry();
      for (const p of pantry.items) {
        if (p.days_left === null || p.days_left > 2) continue;
        lines.push({ kind: 'low', icon: '🥫', title: p.name, detail: p.days_left < 0 ? 'past its date' : p.days_left === 0 ? 'use it today' : `use within ${plural(p.days_left, 'day')}`, link: '/pantry', urgent: p.days_left <= 0 });
      }
      for (const name of pantry.low) lines.push({ kind: 'low', icon: '🛒', title: name, detail: 'running low in the pantry', link: '/pantry', urgent: false });
    }
    if (s.covers.dates) {
      const cal = calendar(db, owner, clock);
      for (const d of await cal.yearly(day, 2)) {
        const years = d.years > 0 ? ` (${d.years} years)` : '';
        lines.push({ kind: 'dates', icon: '🎂', title: d.title, detail: `${d.day === day ? 'today' : 'tomorrow'}${years}`, link: '/calendar', urgent: d.day === day });
      }
      for (const e of (await cal.between(day, 1)).filter((x) => x.kind === 'event' || x.kind === 'outside')) {
        lines.push({ kind: 'dates', icon: '📌', title: e.title, detail: e.time ? `today at ${e.time}` : 'today', link: e.link ?? '/calendar', urgent: false });
      }
      for (const p of await db.all<{ id: number; name: string; start_day: string }>(
        'SELECT id, name, start_day FROM plans WHERE owner_id = ? AND start_day IN (?, ?) ORDER BY start_day, id', [owner, day, addDays(day, 1)])) {
        lines.push({ kind: 'dates', icon: '✨', title: p.name, detail: p.start_day === day ? 'starts today' : 'starts tomorrow', link: `/plans/${p.id}`, urgent: false });
      }
      // A holiday: the day to start planning, to put the decorations up, to take them down.
      for (const h of await holidays(db, owner, clock).digestLines()) lines.push({ kind: 'dates', icon: '✨', title: h.title, detail: h.detail, link: h.link, urgent: h.urgent });
      // An outdoor trip: opening day coming, a trip tomorrow with things left to pack.
      for (const h of await outdoorTrips(db, owner, clock).digestLines()) lines.push({ kind: 'dates', icon: '✨', title: h.title, detail: h.detail, link: h.link, urgent: h.urgent });
    }
    if (s.covers.coupons) {
      for (const c of await db.all<{ id: number; label: string; store: string | null; expires_on: string }>(
        'SELECT id, label, store, expires_on FROM coupons WHERE owner_id = ? AND used_on IS NULL AND expires_on >= ? AND expires_on <= ? ORDER BY expires_on, id', [owner, day, addDays(day, 2)])) {
        const left = dayNumber(c.expires_on) - dayNumber(day);
        lines.push({ kind: 'coupons', icon: '🏷', title: `Coupon: ${c.label}`, detail: [c.store, left === 0 ? 'last day today' : `${plural(left, 'day')} left`].filter(Boolean).join(' · '), link: '/prices', urgent: left === 0 });
      }
      for (const m of await db.all<{ id: number; title: string; lent_to: string; lent_on: string }>(
        `SELECT m.id, m.title, c.lent_to, c.lent_on FROM media_copies c JOIN media m ON m.id = c.media_id
         WHERE m.owner_id = ? AND c.lent_to IS NOT NULL AND c.lent_on IS NOT NULL AND c.lent_on <= ? ORDER BY c.lent_on`, [owner, addDays(day, -30)])) {
        lines.push({ kind: 'coupons', icon: '🤝', title: m.title, detail: `with ${m.lent_to} for ${plural(dayNumber(day) - dayNumber(m.lent_on), 'day')}`, link: `/media/${m.id}`, urgent: false });
      }
    }
    if (s.covers.copy) {
      // A copy kept somewhere else: said when it has been over a month, and then at most once a week.
      const c = await copyState();
      const saidAgo = isDay(s.copy_nudged) ? dayNumber(day) - dayNumber(s.copy_nudged) : null;
      if (c.nudge && (saidAgo === null || saidAgo >= 7)) {
        const n = c.days ?? c.started_days;
        lines.push({ kind: 'copy', icon: '💾', title: `Make a copy of your Life Is: it's been ${n} days.`, detail: null, link: '/settings/data', urgent: false });
      }
    }
    lines.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    const urgent = lines.filter((l) => l.urgent).length;
    const title = !lines.length ? 'Nothing needs you today'
      : `${plural(lines.length, 'thing')} for today${urgent ? `, ${urgent} pressing` : ''}`;
    const out: Digest = { day, lines, title, text: '' };
    out.text = digestText(out, s.origin);
    return out;
  }

  /** Send a digest the ways asked for (or one way). Says which went, and what went wrong with any that didn't. */
  async function send(d: Digest, only?: Channel): Promise<{ sent: Channel[]; problems: string[] }> {
    const s = await settings();
    const sent: Channel[] = [];
    const problems: string[] = [];
    const wants = (c: Channel) => (only ? only === c : c === 'email' ? s.email : c === 'ntfy' ? s.ntfy !== null : s.push);
    const link = s.origin ? `${s.origin}/` : '';
    if (wants('email')) {
      try {
        if (!tools.mail) throw new Problem(400, "This copy of Life Is can't send email");
        const to = await mail(db, owner, clock, tools.mail).noteToSelf(`Life Is: ${d.title}`, d.text);
        if (!to) throw new Problem(400, 'Connect an email account first (Settings, Connections, Email)');
        sent.push('email');
      } catch (problem) { problems.push(`Email: ${(problem as Error).message}`); }
    }
    if (wants('ntfy')) {
      try {
        if (!s.ntfy) throw new Problem(400, 'Choose an ntfy server and topic first');
        if (!tools.fetcher) throw new Problem(400, "This copy of Life Is can't reach outside services");
        const body = d.single ? (s.ntfy.detail === 'count' ? d.single.hidden.body : d.single.body) : s.ntfy.detail === 'count'
          ? (d.lines.length ? `${plural(d.lines.length, 'thing needs', 'things need')} you today. Open Life Is to see what.` : 'Nothing needs you today.')
          : d.text;
        // Header values are kept to plain letters: the title says only how many.
        const title = d.single ? (s.ntfy.detail === 'count' ? d.single.hidden.title : d.single.title).replace(/[^ -~]/g, '').trim() || 'Timer done' : `Life Is: ${d.lines.length ? plural(d.lines.length, 'thing') : 'nothing'} today`;
        const headers: Record<string, string> = { Title: title, Tags: d.single ? 'alarm_clock' : 'house', 'Content-Type': 'text/plain; charset=utf-8' };
        if (link) headers.Click = d.single ? `${s.origin}${d.single.link}` : link;
        if (d.single || d.lines.some((l) => l.urgent)) headers.Priority = 'high';
        const answer = await tools.fetcher(`${s.ntfy.server.replace(/\/+$/, '')}/${encodeURIComponent(s.ntfy.topic)}`, headers, { method: 'POST', body });
        if (answer.status >= 300) throw new Problem(400, `the ntfy server answered with an error (${answer.status})`);
        sent.push('ntfy');
      } catch (problem) { problems.push(`ntfy: ${(problem as Error).message}`); }
    }
    if (wants('push')) {
      try {
        if (!tools.push) throw new Problem(400, "This copy of Life Is can't send browser notifications (it needs to be opened over https)");
        const browsers = await db.all<PushSubscription & { id: number }>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [owner]);
        if (!browsers.length) throw new Problem(400, 'No browser has said yes yet: turn them on from the browser that should get them');
        const body = d.lines.length ? d.lines.slice(0, 6).map((l) => `${l.title}${l.detail ? ` — ${l.detail}` : ''}`).join('\n') + (d.lines.length > 6 ? `\n…and ${d.lines.length - 6} more` : '') : 'Nothing needs you today.';
        let reached = 0;
        for (const b of browsers) {
          if ((await tools.push(b, d.single ? { title: d.single.title, body: d.single.body, url: d.single.link } : { title: `Life Is: ${d.title}`, body, url: d.lines.length === 1 ? d.lines[0]!.link : '/' })) === 'gone') {
            await db.run('DELETE FROM push_subscriptions WHERE id = ?', [b.id]);
          } else reached += 1;
        }
        if (!reached) throw new Problem(400, 'Every browser that said yes has since stopped listening');
        sent.push('push');
      } catch (problem) { problems.push(`Browser: ${(problem as Error).message}`); }
    }
    return { sent, problems };
  }

  return {
    settings,
    digest,
    send,
    copyState,

    /** Note that the person has just made a backup or a download: today is the day of their last copy. */
    async copyMade(): Promise<CopyState> {
      await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
        [owner, COPY_KEY, todayOf(clock)]);
      return copyState();
    },

    /** Change the settings. A new ntfy topic is made when none is given. `origin` is where the person reached Life Is. */
    async save(input: Partial<Omit<ReminderSettings, 'last_sent' | 'copy_nudged' | 'covers'>> & { covers?: Partial<Record<Cover, boolean>> }, origin?: string | null): Promise<ReminderSettings> {
      const s = await settings();
      if (input.time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time))) throw new Problem(400, 'Pick a time of day, like 07:30');
        s.time = String(input.time);
      }
      if (input.zone !== undefined) {
        if (input.zone !== null && !knownZone(String(input.zone))) throw new Problem(400, "That time zone isn't one this computer knows");
        s.zone = input.zone === null ? null : String(input.zone);
      }
      if (input.covers) for (const c of COVERS) if (typeof input.covers[c] === 'boolean') s.covers[c] = input.covers[c];
      if (typeof input.email === 'boolean') s.email = input.email;
      if (typeof input.push === 'boolean') s.push = input.push;
      if (typeof input.phone === 'boolean') s.phone = input.phone;
      if (input.ntfy !== undefined) {
        if (input.ntfy === null) s.ntfy = null;
        else {
          const server = clean(input.ntfy.server, 300) ?? 'https://ntfy.sh';
          let url: URL;
          try { url = new URL(server); } catch { throw new Problem(400, "That isn't a web address for an ntfy server"); }
          if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|.*\.(local|lan|internal|home\.arpa))$/.test(url.hostname))) {
            throw new Problem(400, 'An ntfy server is reached over https (plain http only on your own network)');
          }
          const topic = clean(input.ntfy.topic, 64) ?? newTopic();
          if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic)) throw new Problem(400, 'A topic is 6 to 64 letters, numbers, - or _');
          s.ntfy = { server: url.origin + url.pathname.replace(/\/+$/, ''), topic, detail: input.ntfy.detail === 'full' ? 'full' : 'count' };
        }
      }
      if (origin) s.origin = origin;
      await keep(s);
      return s;
    },

    /** Note that a browser wants reminders. */
    async addBrowser(sub: PushSubscription & { label?: string | null }): Promise<void> {
      if (!/^https:\/\/[^\s]{10,1000}$/.test(sub.endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(sub.p256dh) || !/^[A-Za-z0-9_-]{10,100}$/.test(sub.auth)) {
        throw new Problem(400, "That isn't a browser's push address");
      }
      await db.run(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
      [owner, sub.endpoint, sub.p256dh, sub.auth, clean(sub.label, 100), new Date(clock().getTime()).toISOString()]);
    },
    async removeBrowser(endpoint: string): Promise<void> {
      await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [owner, endpoint]);
    },
    async browsers(): Promise<{ endpoint: string; label: string | null }[]> {
      return db.all('SELECT endpoint, label FROM push_subscriptions WHERE user_id = ? ORDER BY id', [owner]);
    },

    /** Mark today's digest as gone (and, when it held the line about a copy, that it was said today). */
    async markSent(day: string, sent?: Digest): Promise<void> {
      const s = await settings();
      s.last_sent = day;
      if (sent?.lines.some((l) => l.kind === 'copy')) s.copy_nudged = day;
      await keep(s);
    },
  };
}

/**
 * The morning round, looked at every minute: for each person whose time has come today (in their own time
 * zone) and who hasn't had today's digest, work it out and send it the ways they asked. A day with nothing
 * needing them sends nothing. Returns who was sent what, for the log.
 */
export async function remindersDue(db: Db, now: Date, tools: ReminderTools): Promise<{ user: number; sent: Channel[]; problems: string[] }[]> {
  const out: { user: number; sent: Channel[]; problems: string[] }[] = [];
  for (const row of await db.all<{ user_id: number; value: string }>("SELECT user_id, value FROM user_settings WHERE key = ? AND value IS NOT NULL", [SETTING])) {
    let s: ReminderSettings;
    try { s = { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<ReminderSettings>) }; } catch { continue; }
    if (!s.email && !s.ntfy && !s.push) continue;
    let here: { day: string; time: string };
    try { here = zoneNow(now, s.zone); } catch { continue; }
    if (here.time < s.time || s.last_sent === here.day) continue;
    const clock: Clock = Object.assign(() => now, { today: () => here.day });
    const theirs = reminders(db, row.user_id, clock, tools);
    const d = await theirs.digest();
    const result = d.lines.length ? await theirs.send(d) : { sent: [] as Channel[], problems: [] as string[] };
    await theirs.markSent(here.day, d);
    out.push({ user: row.user_id, ...result });
  }
  return out;
}

export type Reminders = ReturnType<typeof reminders>;
