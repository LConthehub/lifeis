/**
 * A busy-times link: something to give a person who is planning around the household. The page behind it shows
 * blocks of busy and free time for the next four weeks and nothing else: no titles, names, places, notes or
 * kinds, and nothing that tells one busy block from another (blocks that touch or overlap run together).
 *
 * It is built like the shared house manual's link (manual.ts): a long random address is the only key, it
 * stops working on a day the person picks, and the person can end it at any time. What the page is sent holds
 * minutes of the day and nothing more, so there is nothing private to find in it, not merely hidden on screen.
 */
import type { Db } from './db.ts';
import { MONTHS, WEEKDAY_NAMES, weekdayOf } from './holidayDates.ts';
import { Problem } from './problem.ts';
import { addDays, stamp, todayOf, type Clock } from './small.ts';

/** How many days the page looks ahead: four weeks. */
export const BUSY_DAYS = 28;
/** An event with a start time and no end is taken to last this long. */
const ASSUMED_MINUTES = 60;
const DAY_MINUTES = 1440;

/** One day on the shared page. Each block is [from, to) in minutes after midnight; a whole day is [0, 1440]. */
export type BusyDay = { day: string; busy: [number, number][] };
/** All the shared page holds. */
export type SharedBusy = { days: BusyDay[]; expires_on: string | null; credit: boolean };
export type BusyLink = { on: boolean; token: string | null; expires_on: string | null; credit: boolean };

function newToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CREDIT = 'busy_credit';
/** The quiet "Made with Life Is" line on the shared page: on unless the person turned it off. Kept with their other settings. */
async function creditOf(db: Db, owner: number): Promise<boolean> {
  return (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, CREDIT]))?.value !== '0';
}

const minutes = (time: string | null): number | null => (time && /^\d{2}:\d{2}$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null);

/** Overlapping and touching blocks, run together, so no block can be told from another. */
export function joined(blocks: [number, number][]): [number, number][] {
  const sorted = blocks.filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * The busy time of each of the next `BUSY_DAYS` days from `start`, taken from the calendar: dates that are not
 * yearly, plans, and the other calendars a person follows. Meals, chores and the like are not busy time.
 */
export async function busyBlocks(db: Db, owner: number, start: string): Promise<BusyDay[]> {
  const last = addDays(start, BUSY_DAYS - 1);
  const per = new Map<string, [number, number][]>();
  for (let n = 0; n < BUSY_DAYS; n += 1) per.set(addDays(start, n), []);
  /** A span of days where the first may start at a time and the last may end at one; the days between are whole. */
  const spread = (first: string, end: string, from: number | null, to: number | null) => {
    for (let day = first < start ? start : first; day <= end && day <= last; day = addDays(day, 1)) {
      const one = first === end;
      const a = day === first ? from : null;
      const b = day === end ? to : null;
      let block: [number, number];
      if (one) block = a === null ? [0, DAY_MINUTES] : [a, b ?? Math.min(DAY_MINUTES, a + ASSUMED_MINUTES)];
      else if (day === first) block = [a ?? 0, DAY_MINUTES];
      else if (day === end) block = [0, b ?? DAY_MINUTES];
      else block = [0, DAY_MINUTES];
      per.get(day)!.push(block);
    }
  };
  for (const e of await db.all<{ day: string; end_day: string | null; time: string | null }>(
    'SELECT day, end_day, time FROM events WHERE owner_id = ? AND yearly = 0 AND day <= ? AND COALESCE(end_day, day) >= ?', [owner, last, start])) {
    spread(e.day, e.end_day ?? e.day, minutes(e.time), null);
  }
  for (const p of await db.all<{ start_day: string; end_day: string }>('SELECT start_day, end_day FROM plans WHERE owner_id = ? AND start_day <= ? AND end_day >= ?', [owner, last, start])) {
    spread(p.start_day, p.end_day, null, null);
  }
  for (const o of await db.all<{ day: string; end_day: string | null; time: string | null; end_time: string | null }>(
    `SELECT e.day, e.end_day, e.time, e.end_time FROM followed_events e JOIN followed_calendars f ON f.id = e.calendar_id
     WHERE f.owner_id = ? AND e.day <= ? AND COALESCE(e.end_day, e.day) >= ?`, [owner, last, start])) {
    spread(o.day, o.end_day ?? o.day, minutes(o.time), minutes(o.end_time));
  }
  return [...per].map(([day, blocks]) => ({ day, busy: joined(blocks) }));
}

export function busyLink(db: Db, owner: number, clock: Clock = () => new Date()) {
  async function get(): Promise<BusyLink> {
    const row = await db.get<{ token: string; expires_on: string | null }>('SELECT token, expires_on FROM busy_shares WHERE owner_id = ?', [owner]);
    const credit = await creditOf(db, owner);
    // A link past its day is as good as off.
    if (!row || (row.expires_on !== null && row.expires_on < todayOf(clock))) return { on: false, token: null, expires_on: null, credit };
    return { on: true, token: row.token, expires_on: row.expires_on, credit };
  }
  return {
    get,

    /** Turn the link on (a new address each time, so an old one stops working), for so many days. A day to end on is always chosen. */
    async shareFor(days: number): Promise<BusyLink> {
      if (!(Number.isInteger(days) && days >= 1 && days <= 365)) throw new Problem(400, 'A link lasts 1 to 365 days');
      await db.run(`INSERT INTO busy_shares (owner_id, token, expires_on, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET token = excluded.token, expires_on = excluded.expires_on, created_at = excluded.created_at`,
      [owner, newToken(), addDays(todayOf(clock), days), stamp(clock())]);
      return get();
    },

    async setCredit(on: boolean): Promise<BusyLink> {
      await db.run('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value', [owner, CREDIT, on ? '1' : '0']);
      return get();
    },

    async stopSharing(): Promise<BusyLink> {
      await db.run('DELETE FROM busy_shares WHERE owner_id = ?', [owner]);
      return get();
    },
  };
}

/** What a shared link shows, or null when there is no such link or its day has passed. */
export async function busyFor(db: Db, token: string, clock: Clock = () => new Date()): Promise<SharedBusy | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db.get<{ owner_id: number; expires_on: string | null }>('SELECT owner_id, expires_on FROM busy_shares WHERE token = ?', [token]);
  if (!row || (row.expires_on !== null && row.expires_on < todayOf(clock))) return null;
  return { days: await busyBlocks(db, row.owner_id, todayOf(clock)), expires_on: row.expires_on, credit: await creditOf(db, row.owner_id) };
}

const words = (day: string) => `${WEEKDAY_NAMES[weekdayOf(day)]}, ${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
const clockWords = (mins: number) => {
  const h = Math.floor(mins / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** "Busy from 9:00 AM to 10:30 AM", or "Busy all day". */
export function blockWords([from, to]: [number, number]): string {
  if (from === 0 && to >= DAY_MINUTES) return 'Busy all day';
  if (from === 0) return `Busy until ${clockWords(to)}`;
  return to >= DAY_MINUTES ? `Busy from ${clockWords(from)} to the end of the day` : `Busy from ${clockWords(from)} to ${clockWords(to)}`;
}
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The shared page, in Life Is's look (like the house manual's), readable on a phone, with no scripts. Each day has a bar
 * (flat color, no pictures) and, for people who can't see it, the same time in words.
 */
export function busyHtml(b: SharedBusy): string {
  const day = (d: BusyDay) => {
    const bar = d.busy.map(([from, to]) => `<i style="left:${(from / DAY_MINUTES * 100).toFixed(2)}%;width:${((Math.min(to, DAY_MINUTES) - from) / DAY_MINUTES * 100).toFixed(2)}%"></i>`).join('');
    return `<div class="d"><h3>${esc(words(d.day))}</h3><div class="bar24" aria-hidden="true">${bar}</div>${
      d.busy.length ? `<ul>${d.busy.map((blk) => `<li>${esc(blockWords(blk))}</li>`).join('')}</ul>` : '<p class="free">Free all day</p>'}</div>`;
  };
  const weeks: BusyDay[][] = [];
  for (let at = 0; at < b.days.length; at += 7) weeks.push(b.days.slice(at, at + 7));
  const credit = b.credit ? ` Made with Life Is, a private home organizer you run yourself. <a href="https://lifeis.living" rel="noopener noreferrer">lifeis.living</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark"><title>Busy and free times</title><style>
@font-face{font-family:"Fraunces Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(/fonts/fraunces-soft.woff2) format("woff2-variations")}
@font-face{font-family:"Nunito Variable";font-style:normal;font-display:swap;font-weight:200 1000;src:url(/fonts/nunito.woff2) format("woff2-variations")}
:root{--paper:#f1e5c8;--card:#fbf3e0;--ink:#422a17;--soft:#6f5a44;--line:#e4cfa4;--accent:#734825;--rule:#e7602b;--busy:#933f1d;--shadow:0 1px 3px rgba(66,42,23,.14)}
@media (prefers-color-scheme:dark){:root{--paper:#2a190d;--card:#3a2412;--ink:#fbf4e4;--soft:#d2b184;--line:#533519;--accent:#eead3e;--rule:#eead3e;--busy:#eead3e;--shadow:none}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font-family:"Nunito Variable",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-weight:600;margin:0;background:var(--paper);color:var(--ink);line-height:1.5;overflow-wrap:anywhere}
.bar{background:linear-gradient(100deg,#4a2f1a 0%,#5f361b 55%,#933f1d 100%);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.bar div{max-width:40rem;margin:0 auto;padding:.6rem 1rem;display:flex;align-items:center;gap:.5rem}
.bar img{width:2.25rem;height:2.25rem;display:block}
.bar span{font-family:"Fraunces Variable",Georgia,Cambria,serif;font-variation-settings:"SOFT" 100;font-size:1.2rem;font-weight:700;line-height:1}
main{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 3rem}
h1,h2{font-family:"Fraunces Variable",Georgia,Cambria,serif;font-variation-settings:"SOFT" 100;letter-spacing:-.005em}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 .25rem}
h2{font-size:1.25rem;margin:1.75rem 0 .5rem;border-bottom:3px solid var(--rule);padding-bottom:.2rem}
h3{font-size:1rem;font-weight:850;margin:0}
.d{background:var(--card);border:1px solid var(--line);border-radius:1.25rem;padding:.8rem 1rem;margin:.6rem 0;box-shadow:var(--shadow);break-inside:avoid}
.bar24{position:relative;height:.75rem;margin:.5rem 0;border-radius:.4rem;background:var(--paper);border:1px solid var(--line);overflow:hidden}
.bar24 i{position:absolute;top:0;bottom:0;background:var(--busy);display:block}
.d ul{list-style:none;margin:0;padding:0}
.d li{font-weight:850;margin:.15rem 0}
.free{margin:0;color:var(--soft)}
.lead,.foot{color:var(--soft);font-size:.9rem}
.foot{margin-top:2rem}
a{color:var(--accent)}
@media print{body{background:#fff;color:#000}.bar{background:none;color:#000;box-shadow:none;border-bottom:2px solid #000}.d{box-shadow:none;border:1px solid #999;background:#fff}.bar24 i{background:#000}a,.free,.lead,.foot{color:#000}h2{border-bottom-color:#000}}
</style></head><body><header class="bar"><div><img src="/mark-192.png" alt="" width="36" height="36"><span>Life is</span></div></header><main><h1>Busy and free times</h1><p class="lead">The next four weeks. Only whether the time is busy or free is shown, nothing about what it is for.${b.expires_on ? ` Available until ${esc(words(b.expires_on))}.` : ''}</p>
${weeks.map((w) => `<h2>Week of ${esc(words(w[0]!.day))}</h2>${w.map(day).join('')}`).join('')}
<p class="foot">Nothing on this page can be changed from here.${credit}</p></main></body></html>`;
}
