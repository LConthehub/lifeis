/** When a holiday falls: the same date, a weekday rule, or set each year; and how long a turkey takes to thaw. */
import { expect, it } from 'vitest';
import { checkedRule, dateInYear, nextDate, ruleWords, thawDays, THAW_SOURCE, weekdayOf, type DateRule } from '../src/holidayDates.ts';

const thanksgiving: DateRule = { kind: 'weekday', month: 11, weekday: 4, nth: 4 };
const memorial: DateRule = { kind: 'weekday', month: 5, weekday: 1, nth: -1 };

it('finds the fourth Thursday of November, year after year', () => {
  expect([2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => dateInYear(thanksgiving, y))).toEqual([
    '2024-11-28', '2025-11-27', '2026-11-26', '2027-11-25', '2028-11-23', '2029-11-22', '2030-11-28']);
});

it('finds the last Monday of May, including when the month ends on a Monday', () => {
  // 2021 and 2027: May 31 is a Monday. 2025: the 26th. 2026: the 25th.
  expect([2021, 2025, 2026, 2027].map((y) => dateInYear(memorial, y))).toEqual(['2021-05-31', '2025-05-26', '2026-05-25', '2027-05-31']);
});

it('finds the first, second and third of a weekday, and a weekday that is the first of the month', () => {
  expect(dateInYear({ kind: 'weekday', month: 9, weekday: 1, nth: 1 }, 2025)).toBe('2025-09-01'); // Labor Day: Sep 1 is a Monday
  expect(dateInYear({ kind: 'weekday', month: 5, weekday: 0, nth: 2 }, 2026)).toBe('2026-05-10'); // second Sunday of May
  expect(dateInYear({ kind: 'weekday', month: 1, weekday: 1, nth: 3 }, 2026)).toBe('2026-01-19');
  expect(dateInYear({ kind: 'weekday', month: 2, weekday: 1, nth: -1 }, 2028)).toBe('2028-02-28'); // a leap February ending on a Tuesday
  expect(dateInYear({ kind: 'weekday', month: 2, weekday: 2, nth: -1 }, 2028)).toBe('2028-02-29');
});

it('keeps the same date every year, and the 29th of February on the 28th in years without one', () => {
  const christmas: DateRule = { kind: 'fixed', month: 12, day: 25 };
  expect([2026, 2027].map((y) => dateInYear(christmas, y))).toEqual(['2026-12-25', '2027-12-25']);
  const leapDay: DateRule = { kind: 'fixed', month: 2, day: 29 };
  expect([2027, 2028, 2100].map((y) => dateInYear(leapDay, y))).toEqual(['2027-02-28', '2028-02-29', '2100-02-28']);
});

it('says nothing for a day the person sets each year', () => {
  expect(dateInYear({ kind: 'manual' }, 2026)).toBeNull();
  expect(nextDate({ kind: 'manual' }, '2026-01-01')).toBeNull();
});

it('finds the next one on or after a day, including the day itself and across the new year', () => {
  expect(nextDate(thanksgiving, '2026-10-01')).toBe('2026-11-26');
  expect(nextDate(thanksgiving, '2026-11-26')).toBe('2026-11-26');
  expect(nextDate(thanksgiving, '2026-11-27')).toBe('2027-11-25');
  expect(nextDate({ kind: 'fixed', month: 1, day: 1 }, '2026-12-31')).toBe('2027-01-01');
});

it('does not go by the clock: the day of the week comes from the date alone', () => {
  expect(weekdayOf('1970-01-01')).toBe(4); // a Thursday
  expect(weekdayOf('2026-11-26')).toBe(4);
  expect(weekdayOf('2026-11-29')).toBe(0);
  expect(weekdayOf('1969-12-31')).toBe(3); // before the epoch too
});

it('says a rule in words', () => {
  expect(ruleWords(thanksgiving)).toBe('Fourth Thursday of November');
  expect(ruleWords(memorial)).toBe('Last Monday of May');
  expect(ruleWords({ kind: 'fixed', month: 12, day: 25 })).toBe('December 25');
  expect(ruleWords({ kind: 'manual' })).toBe('Set each year');
});

it('refuses a rule that is not one', () => {
  const bad = (rule: unknown) => expect(() => checkedRule(rule as DateRule)).toThrow(expect.objectContaining({ status: 400 }));
  bad({ kind: 'fixed', month: 4, day: 31 });
  bad({ kind: 'fixed', month: 13, day: 1 });
  bad({ kind: 'weekday', month: 11, weekday: 7, nth: 4 });
  bad({ kind: 'weekday', month: 11, weekday: 4, nth: 5 });
  bad({ kind: 'sometimes' });
  expect(checkedRule({ kind: 'fixed', month: 2, day: 29 })).toEqual({ kind: 'fixed', month: 2, day: 29 });
});

it('thaws a turkey in the refrigerator for 24 hours for each 4 pounds, rounded up', () => {
  expect([4, 3, 8, 12, 13, 16, 20, 24, 25].map(thawDays)).toEqual([1, 1, 2, 3, 4, 4, 5, 6, 7]);
  expect(() => thawDays(0)).toThrow();
  expect(() => thawDays(200)).toThrow();
  expect(THAW_SOURCE).toBe('USDA: thawing in the refrigerator');
});
