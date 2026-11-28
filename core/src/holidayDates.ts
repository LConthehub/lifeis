/**
 * When a holiday falls, year after year, and how long to thaw a turkey. Pure functions: no clock, no database.
 *
 * A day here is the person's own day, written 2046-11-27. It is never turned into a moment in time, so no
 * time zone can move it: the arithmetic is on the calendar date alone (see `dayNumber` in small.ts).
 *
 * Three ways a holiday finds its day:
 *   - the same date every year (December 25; the 29th of February is kept on the 28th in years without one),
 *   - a weekday rule (the fourth Thursday of November, the last Monday of May),
 *   - the person sets it each year ("manual"): nothing is worked out, so nothing here can say.
 */
import { Problem } from './problem.ts';
import { addDays, dayNumber } from './small.ts';

/** The calendars a day can be given on, worked out with the platform's own `Intl` calendars. */
export const CALENDARS = ['chinese', 'hebrew', 'islamic'] as const;
export type CalendarName = (typeof CALENDARS)[number];
const CALENDAR_WORDS: Record<CalendarName, string> = { chinese: 'Chinese', hebrew: 'Hebrew', islamic: 'Islamic' };
const INTL_CALENDAR: Record<CalendarName, string> = { chinese: 'chinese', hebrew: 'hebrew', islamic: 'islamic-umalqura' };

/** Any rule can come back only every few years, counted from its first year (`from`). */
export const EVERY_YEARS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
export type Every = { every?: number; from?: number };

export type DateRule = (
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'weekday'; month: number; weekday: number; nth: number }
  /** The first `weekday` on or after the date (the first Tuesday on or after November 2). */
  | { kind: 'after'; month: number; day: number; weekday: number }
  /** A month and day on another calendar. `month` is the calendar's own month, as `calendarMonths` lists it. */
  | { kind: 'calendar'; calendar: CalendarName; month: string; day: number }
  | { kind: 'manual' }
) & Every;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Which one of the month's weekdays: 1 to 4, or -1 for the last. */
export const NTHS = [1, 2, 3, 4, -1];
const NTH_WORDS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

const pad = (n: number) => String(n).padStart(2, '0');
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysIn = (year: number, month: number) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
/** 0 for Sunday, as `Date#getUTCDay` says; worked out from the day number so no local time is involved. */
export const weekdayOf = (day: string) => (((dayNumber(day) + 4) % 7) + 7) % 7;

// ---------- other calendars ----------

const formatters = new Map<CalendarName, Intl.DateTimeFormat>();
function formatter(cal: CalendarName): Intl.DateTimeFormat {
  let f = formatters.get(cal);
  if (!f) {
    f = new Intl.DateTimeFormat(`en-u-ca-${INTL_CALENDAR[cal]}-nu-latn`, { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
    formatters.set(cal, f);
  }
  return f;
}
const DAY_MS = 86400000;
/** A day as the calendar says it: its year, its month (a number, or a name for the Hebrew calendar) and its day. */
function onCalendar(cal: CalendarName, ms: number): { y: string; m: string; d: number } {
  const p = Object.fromEntries(formatter(cal).formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: String(p.relatedYear ?? p.year), m: String(p.month), d: Number(p.day) };
}
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The months a person can pick on a calendar, as the platform names them. A Chinese leap month and a Hebrew leap
 * Adar are not listed apart: a rule for "Adar" lands in the second Adar of a leap year, and a Chinese month's day
 * stays in the regular month. Names are read once, from the platform, and kept.
 */
const monthLists = new Map<CalendarName, { key: string; label: string }[]>();
export function calendarMonths(cal: CalendarName): { key: string; label: string }[] {
  const kept = monthLists.get(cal);
  if (kept) return kept;
  const names = new Intl.DateTimeFormat(`en-u-ca-${INTL_CALENDAR[cal]}-nu-latn`, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
  // Hebrew year 5784 (it starts September 16, 2023) has the leap Adar; two Gregorian years hold every Chinese and Islamic month.
  const from = cal === 'hebrew' ? Date.UTC(2023, 8, 16) : Date.UTC(2023, 0, 1);
  const found = new Map<string, string>();
  for (let t = from; t < from + (cal === 'hebrew' ? 386 : 760) * DAY_MS; t += DAY_MS) {
    const { m } = onCalendar(cal, t);
    if (found.has(m) || m.endsWith('bis')) continue;
    found.set(m, String(names.formatToParts(t).find((x) => x.type === 'month')?.value ?? m));
  }
  let list = [...found].map(([key, label]) => ({ key, label }));
  if (cal === 'hebrew') list = list.map((m) => (m.key === 'Adar I' ? { key: m.key, label: 'Adar I (leap years)' } : m.key === 'Adar II' ? { key: 'Adar', label: 'Adar' } : m));
  else list.sort((x, y) => Number(x.key) - Number(y.key));
  monthLists.set(cal, list);
  return list;
}
const monthLabel = (cal: CalendarName, key: string) => calendarMonths(cal).find((m) => m.key === key)?.label ?? key;

/** Does the calendar's month, as it fell on a day, count as the rule's month? */
function sameMonth(cal: CalendarName, wanted: string, got: string): boolean {
  if (cal === 'hebrew') return wanted === 'Adar' ? got === 'Adar' || got === 'Adar II' : wanted === 'Adar I' ? got === 'Adar I' || got === 'Adar' : got === wanted;
  return got === wanted;
}

const calendarKept = new Map<string, string | null>();
/**
 * The one day of `year` that is this month and day on the calendar; null if the calendar's day never falls in that
 * year. A day the month does not have (the 30th of a 29-day month) is the month's last day, the way the 29th of
 * February is kept on the 28th.
 */
function calendarDate(rule: { calendar: CalendarName; month: string; day: number }, year: number): string | null {
  const id = `${rule.calendar}|${rule.month}|${rule.day}|${year}`;
  if (calendarKept.has(id)) return calendarKept.get(id)!;
  // Read from the December before to the January after, so a month cut by the new year is still whole.
  const stretches: { key: string; month: string; days: { ms: number; d: number }[] }[] = [];
  for (let t = Date.UTC(year - 1, 11, 1); t <= Date.UTC(year + 1, 0, 31); t += DAY_MS) {
    const { y, m, d } = onCalendar(rule.calendar, t);
    const key = `${y}|${m}`;
    const now = stretches[stretches.length - 1];
    if (now && now.key === key) now.days.push({ ms: t, d });
    else stretches.push({ key, month: m, days: [{ ms: t, d }] });
  }
  let found: string | null = null;
  for (const s of stretches) {
    if (!sameMonth(rule.calendar, rule.month, s.month)) continue;
    const hit = s.days.find((x) => x.d === rule.day) ?? (s.days[s.days.length - 1]!.d < rule.day ? s.days[s.days.length - 1]! : null);
    if (hit && isoOf(hit.ms).slice(0, 4) === String(year)) { found = isoOf(hit.ms); break; }
  }
  if (calendarKept.size > 2000) calendarKept.clear();
  calendarKept.set(id, found);
  return found;
}

// ---------- checking a rule ----------

/** Checks a rule that came from a form or a file and gives it back tidy. */
export function checkedRule(rule: DateRule): DateRule {
  if (rule.kind === 'manual') return { kind: 'manual' };
  const base = checkedKind(rule);
  const every = rule.every ?? 1;
  if (!Number.isInteger(every) || every < 1 || every > 10) throw new Problem(400, 'Come back every year, or every 2 to 10 years');
  if (every === 1) return base;
  return { ...base, every, ...(rule.from !== undefined && Number.isInteger(rule.from) ? { from: rule.from } : {}) };
}
function checkedKind(rule: Exclude<DateRule, { kind: 'manual' }>): DateRule {
  if (rule.kind === 'calendar') {
    if (!(CALENDARS as readonly string[]).includes(rule.calendar)) throw new Problem(400, 'Pick the Chinese, Hebrew or Islamic calendar');
    if (!calendarMonths(rule.calendar).some((m) => m.key === rule.month)) throw new Problem(400, `The ${CALENDAR_WORDS[rule.calendar]} calendar has no month like that`);
    if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 30) throw new Problem(400, 'Pick a day from 1 to 30');
    return { kind: 'calendar', calendar: rule.calendar, month: rule.month, day: rule.day };
  }
  if (!Number.isInteger(rule.month) || rule.month < 1 || rule.month > 12) throw new Problem(400, 'Pick a month');
  if (rule.kind === 'fixed' || rule.kind === 'after') {
    // Any year that has the day will do; the 29th of February is allowed.
    if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > daysIn(2044, rule.month)) throw new Problem(400, `${MONTHS[rule.month - 1]} has no day ${rule.day}`);
    if (rule.kind === 'fixed') return { kind: 'fixed', month: rule.month, day: rule.day };
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) throw new Problem(400, 'Pick a weekday');
    return { kind: 'after', month: rule.month, day: rule.day, weekday: rule.weekday };
  }
  if (rule.kind !== 'weekday') throw new Problem(400, 'Pick the same date each year, a weekday rule, a day on another calendar, or setting it each year');
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) throw new Problem(400, 'Pick a weekday');
  if (!NTHS.includes(rule.nth)) throw new Problem(400, 'Pick the first, second, third, fourth or last');
  return { kind: 'weekday', month: rule.month, weekday: rule.weekday, nth: rule.nth };
}

/**
 * A rule as the database keeps it, one column for each piece. `rule` stays one of the three the table allows: a
 * weekday on or after a date and a day on another calendar are kept as 'manual' there, with `rule_kind` saying
 * which they really are, so an older Life Is reading the row only asks for the day each year.
 */
export type RuleColumns = {
  rule: 'fixed' | 'weekday' | 'manual'; month: number | null; day_of_month: number | null; weekday: number | null; nth: number | null;
  rule_kind?: 'after' | 'calendar' | null; calendar?: string | null; cal_month?: string | null; cal_day?: number | null; every_years?: number | null; every_from?: number | null;
};
export const RULE_COLUMN_NAMES = 'rule, month, day_of_month, weekday, nth, rule_kind, calendar, cal_month, cal_day, every_years, every_from';
export function ruleFromColumns(h: RuleColumns): DateRule {
  const every: Every = h.every_years && h.every_years > 1 ? { every: h.every_years, ...(h.every_from != null ? { from: h.every_from } : {}) } : {};
  if (h.rule_kind === 'after') return { kind: 'after', month: h.month!, day: h.day_of_month!, weekday: h.weekday!, ...every };
  if (h.rule_kind === 'calendar') return { kind: 'calendar', calendar: h.calendar as CalendarName, month: h.cal_month!, day: h.cal_day!, ...every };
  if (h.rule === 'fixed') return { kind: 'fixed', month: h.month!, day: h.day_of_month!, ...every };
  if (h.rule === 'weekday') return { kind: 'weekday', month: h.month!, weekday: h.weekday!, nth: h.nth!, ...every };
  return { kind: 'manual' };
}
/** The values for `RULE_COLUMN_NAMES`. */
export function columnsFromRule(rule: DateRule): (string | number | null)[] {
  const every = rule.kind !== 'manual' && rule.every && rule.every > 1 ? [rule.every, rule.from ?? null] : [null, null];
  if (rule.kind === 'manual') return ['manual', null, null, null, null, null, null, null, null, null, null];
  if (rule.kind === 'fixed') return ['fixed', rule.month, rule.day, null, null, null, null, null, null, ...every];
  if (rule.kind === 'weekday') return ['weekday', rule.month, null, rule.weekday, rule.nth, null, null, null, null, ...every];
  if (rule.kind === 'after') return ['manual', rule.month, rule.day, rule.weekday, null, 'after', null, null, null, ...every];
  return ['manual', null, null, null, null, 'calendar', rule.calendar, rule.month, rule.day, ...every];
}
/** Does the rule come with a day worked out, rather than set each year? */
export const isWorkedOut = (rule: DateRule) => rule.kind !== 'manual';

/** The holiday's day in the rule's year `year`; null for a rule the person sets each year, for a year it skips, or a day the calendar never has that year. */
export function dateInYear(rule: DateRule, year: number): string | null {
  if (rule.kind === 'manual') return null;
  if (rule.every && rule.every > 1 && ((((year - (rule.from ?? 0)) % rule.every) + rule.every) % rule.every) !== 0) return null;
  if (rule.kind === 'calendar') return calendarDate(rule, year);
  if (rule.kind === 'fixed' || rule.kind === 'after') {
    const day = rule.month === 2 && rule.day === 29 && !leap(year) ? 28 : rule.day;
    const date = `${year}-${pad(rule.month)}-${pad(day)}`;
    return rule.kind === 'fixed' ? date : addDays(date, (rule.weekday - weekdayOf(date) + 7) % 7);
  }
  const first = weekdayOf(`${year}-${pad(rule.month)}-01`);
  if (rule.nth > 0) return `${year}-${pad(rule.month)}-${pad(1 + ((rule.weekday - first + 7) % 7) + (rule.nth - 1) * 7)}`;
  const last = daysIn(year, rule.month);
  const lastWeekday = weekdayOf(`${year}-${pad(rule.month)}-${pad(last)}`);
  return `${year}-${pad(rule.month)}-${pad(last - ((lastWeekday - rule.weekday + 7) % 7))}`;
}

/** The first of the rule's days that is `ok`, looking from the year before `year` (a weekday after a date late in December can land in January). */
function firstWhere(rule: DateRule, year: number, ok: (day: string) => boolean): string | null {
  if (rule.kind === 'manual') return null;
  for (let y = year - 1; y <= year + 60; y++) {
    const day = dateInYear(rule, y);
    if (day !== null && ok(day)) return day;
  }
  return null;
}

/** The first day of the holiday on or after `from`; null for a rule the person sets each year. */
export function nextDate(rule: DateRule, from: string): string | null {
  dayNumber(from);
  return firstWhere(rule, Number(from.slice(0, 4)), (day) => day >= from);
}

/** The first day of the holiday that falls in `year` or later: the next year's day once this year's is done. */
export function dateFromYear(rule: DateRule, year: number): string | null {
  return firstWhere(rule, year, (day) => Number(day.slice(0, 4)) >= year);
}

/** "Every 5 years" for a rule that skips years; null for one that comes every year. */
export const everyWords = (rule: DateRule): string | null => (rule.kind !== 'manual' && rule.every && rule.every > 1 ? `Every ${rule.every} years` : null);

/**
 * "Fourth Thursday of November", "Last Monday of May", "December 25", "The first Tuesday on or after November 2",
 * "Day 3 of Tevet on the Hebrew calendar", "set each year". A rule that skips years ends ", every 5 years".
 */
export function ruleWords(rule: DateRule): string {
  if (rule.kind === 'manual') return 'Set each year';
  const every = everyWords(rule);
  const tail = every ? `, ${every.toLowerCase()}` : '';
  if (rule.kind === 'fixed') return `${MONTHS[rule.month - 1]} ${rule.day}${tail}`;
  if (rule.kind === 'after') return `The first ${WEEKDAY_NAMES[rule.weekday]} on or after ${MONTHS[rule.month - 1]} ${rule.day}${tail}`;
  if (rule.kind === 'calendar') return `Day ${rule.day} of ${monthLabel(rule.calendar, rule.month)} on the ${CALENDAR_WORDS[rule.calendar]} calendar${tail}`;
  const nth = NTH_WORDS[rule.nth]!;
  return `${nth[0]!.toUpperCase()}${nth.slice(1)} ${WEEKDAY_NAMES[rule.weekday]} of ${MONTHS[rule.month - 1]}${tail}`;
}

/** How many whole days to thaw a frozen turkey in the refrigerator: 24 hours for each 4 pounds, rounded up. */
export function thawDays(pounds: number): number {
  if (!Number.isFinite(pounds) || pounds <= 0 || pounds > 60) throw new Problem(400, 'A turkey weighs between 1 and 60 pounds');
  return Math.max(1, Math.ceil(pounds / 4));
}

/** Where the thaw rule comes from. Plain text: nothing is looked up. */
export const THAW_SOURCE = 'USDA: thawing in the refrigerator';
