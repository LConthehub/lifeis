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
import { dayNumber } from './small.ts';

export type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'weekday'; month: number; weekday: number; nth: number }
  | { kind: 'manual' };

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

/** Checks a rule that came from a form or a file and gives it back tidy. */
export function checkedRule(rule: DateRule): DateRule {
  if (rule.kind === 'manual') return { kind: 'manual' };
  if (!Number.isInteger(rule.month) || rule.month < 1 || rule.month > 12) throw new Problem(400, 'Pick a month');
  if (rule.kind === 'fixed') {
    // Any year that has the day will do; the 29th of February is allowed.
    if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > daysIn(2044, rule.month)) throw new Problem(400, `${MONTHS[rule.month - 1]} has no day ${rule.day}`);
    return { kind: 'fixed', month: rule.month, day: rule.day };
  }
  if (rule.kind !== 'weekday') throw new Problem(400, 'Pick the same date each year, a weekday rule, or setting it each year');
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) throw new Problem(400, 'Pick a weekday');
  if (!NTHS.includes(rule.nth)) throw new Problem(400, 'Pick the first, second, third, fourth or last');
  return { kind: 'weekday', month: rule.month, weekday: rule.weekday, nth: rule.nth };
}

/** The holiday's day in one year; null for a rule the person sets each year. */
export function dateInYear(rule: DateRule, year: number): string | null {
  if (rule.kind === 'manual') return null;
  if (rule.kind === 'fixed') {
    const day = rule.month === 2 && rule.day === 29 && !leap(year) ? 28 : rule.day;
    return `${year}-${pad(rule.month)}-${pad(day)}`;
  }
  const first = weekdayOf(`${year}-${pad(rule.month)}-01`);
  if (rule.nth > 0) return `${year}-${pad(rule.month)}-${pad(1 + ((rule.weekday - first + 7) % 7) + (rule.nth - 1) * 7)}`;
  const last = daysIn(year, rule.month);
  const lastWeekday = weekdayOf(`${year}-${pad(rule.month)}-${pad(last)}`);
  return `${year}-${pad(rule.month)}-${pad(last - ((lastWeekday - rule.weekday + 7) % 7))}`;
}

/** The first day of the holiday on or after `from`; null for a rule the person sets each year. */
export function nextDate(rule: DateRule, from: string): string | null {
  dayNumber(from);
  const year = Number(from.slice(0, 4));
  const here = dateInYear(rule, year);
  if (here === null) return null;
  return here >= from ? here : dateInYear(rule, year + 1);
}

/** "Fourth Thursday of November", "Last Monday of May", "December 25", "set each year". */
export function ruleWords(rule: DateRule): string {
  if (rule.kind === 'manual') return 'Set each year';
  if (rule.kind === 'fixed') return `${MONTHS[rule.month - 1]} ${rule.day}`;
  const nth = NTH_WORDS[rule.nth]!;
  return `${nth[0]!.toUpperCase()}${nth.slice(1)} ${WEEKDAY_NAMES[rule.weekday]} of ${MONTHS[rule.month - 1]}`;
}

/** How many whole days to thaw a frozen turkey in the refrigerator: 24 hours for each 4 pounds, rounded up. */
export function thawDays(pounds: number): number {
  if (!Number.isFinite(pounds) || pounds <= 0 || pounds > 60) throw new Problem(400, 'A turkey weighs between 1 and 60 pounds');
  return Math.max(1, Math.ceil(pounds / 4));
}

/** Where the thaw rule comes from. Plain text: nothing is looked up. */
export const THAW_SOURCE = 'USDA: thawing in the refrigerator';
