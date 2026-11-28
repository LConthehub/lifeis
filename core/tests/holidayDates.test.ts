/** When a holiday falls: the same date, a weekday rule, or set each year; and how long a turkey takes to thaw. */
import { expect, it } from 'vitest';
import { calendarMonths, checkedRule, columnsFromRule, dateFromYear, dateInYear, everyWords, nextDate, ruleFromColumns, ruleWords, thawDays, THAW_SOURCE, weekdayOf, type DateRule } from '../src/holidayDates.ts';

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

const lanterns: DateRule = { kind: 'after', month: 11, day: 2, weekday: 2 };

it('finds the first weekday on or after a date, including the date itself and a start late in December', () => {
  // November 2 is a Monday in 2026 (the Tuesday is the 3rd), a Tuesday in 2027 (that day itself), a Wednesday in 2028.
  expect([2025, 2026, 2027, 2028].map((y) => dateInYear(lanterns, y))).toEqual(['2025-11-04', '2026-11-03', '2027-11-02', '2028-11-07']);
  expect(ruleWords(lanterns)).toBe('The first Tuesday on or after November 2');
  // From December 30 the weekday can land in the next January: the plan's year is the day's own.
  const late: DateRule = { kind: 'after', month: 12, day: 30, weekday: 5 };
  expect(dateInYear(late, 2026)).toBe('2027-01-01');
  expect(nextDate(late, '2027-01-01')).toBe('2027-01-01');
  expect(dateFromYear(late, 2027)).toBe('2027-01-01');
  expect(dateFromYear(late, 2028)).toBe('2029-01-05'); // December 30, 2028 is a Saturday
  // February 29 as the date: the 28th in years without one.
  expect(dateInYear({ kind: 'after', month: 2, day: 29, weekday: 0 }, 2027)).toBe('2027-02-28');
});

it('finds a Chinese month and day, using the regular month in a year that has a leap one', () => {
  const second: DateRule = { kind: 'calendar', calendar: 'chinese', month: '2', day: 15 };
  // 2023 has a leap second month: the rule keeps to the regular one, which began on February 20.
  expect([2022, 2023, 2024, 2025, 2026].map((y) => dateInYear(second, y))).toEqual(['2022-03-17', '2023-03-06', '2024-03-24', '2025-03-14', '2026-04-02']);
  expect(ruleWords(second)).toBe('Day 15 of Second Month on the Chinese calendar');
  expect(dateInYear({ kind: 'calendar', calendar: 'chinese', month: '1', day: 1 }, 2026)).toBe('2026-02-17');
});

it('finds a Hebrew month and day, with the leap Adar kept apart from the plain one', () => {
  const adar: DateRule = { kind: 'calendar', calendar: 'hebrew', month: 'Adar', day: 14 };
  const adarOne: DateRule = { kind: 'calendar', calendar: 'hebrew', month: 'Adar I', day: 14 };
  // 2024 is a leap year: Adar means the second one, and Adar I is the month before it. Other years have one Adar.
  expect([2023, 2024, 2025, 2026].map((y) => dateInYear(adar, y))).toEqual(['2023-03-07', '2024-03-24', '2025-03-14', '2026-03-03']);
  expect([2023, 2024, 2025].map((y) => dateInYear(adarOne, y))).toEqual(['2023-03-07', '2024-02-23', '2025-03-14']);
  expect(calendarMonths('hebrew').map((m) => m.key)).toEqual(['Tishri', 'Heshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar I', 'Adar', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul']);
  expect(ruleWords({ kind: 'calendar', calendar: 'hebrew', month: 'Tevet', day: 10 })).toBe('Day 10 of Tevet on the Hebrew calendar');
});

it('finds an Islamic month and day, which moves about eleven days earlier each year', () => {
  const first: DateRule = { kind: 'calendar', calendar: 'islamic', month: '1', day: 1 };
  expect([2023, 2024, 2025, 2026, 2027].map((y) => dateInYear(first, y))).toEqual(['2023-07-19', '2024-07-07', '2025-06-26', '2026-06-16', '2027-06-06']);
  expect(calendarMonths('islamic')).toHaveLength(12);
  expect(calendarMonths('chinese').map((m) => m.label).slice(0, 2)).toEqual(['First Month', 'Second Month']);
});

it('keeps a day a calendar month does not have to the last day of that month', () => {
  // The 30th of Heshvan: a 29-day month in 2023, a 30-day month in 2024.
  const thirtieth: DateRule = { kind: 'calendar', calendar: 'hebrew', month: 'Heshvan', day: 30 };
  expect([2023, 2024, 2025].map((y) => dateInYear(thirtieth, y))).toEqual(['2023-11-13', '2024-12-01', '2025-11-20']);
});

it('skips years for a rule that comes back every few years, counted from its first year', () => {
  const reunion: DateRule = { kind: 'fixed', month: 7, day: 4, every: 5, from: 2026 };
  expect([2026, 2027, 2030, 2031, 2036].map((y) => dateInYear(reunion, y))).toEqual(['2026-07-04', null, null, '2031-07-04', '2036-07-04']);
  expect(nextDate(reunion, '2026-07-05')).toBe('2031-07-04');
  expect(dateFromYear(reunion, 2027)).toBe('2031-07-04');
  expect(dateFromYear(reunion, 2031)).toBe('2031-07-04');
  expect(ruleWords(reunion)).toBe('July 4, every 5 years');
  expect(everyWords(reunion)).toBe('Every 5 years');
  expect(everyWords({ kind: 'fixed', month: 7, day: 4 })).toBeNull();
  // It works the same for the weekday rules and the other calendars, and counts back before its first year too.
  const weekdays: DateRule = { kind: 'weekday', month: 11, weekday: 4, nth: 4, every: 2, from: 2026 };
  expect([2024, 2025, 2026, 2028].map((y) => dateInYear(weekdays, y))).toEqual(['2024-11-28', null, '2026-11-26', '2028-11-23']);
  const hebrew: DateRule = { kind: 'calendar', calendar: 'hebrew', month: 'Tevet', day: 10, every: 3, from: 2025 };
  expect([2025, 2026, 2027, 2028].map((y) => dateInYear(hebrew, y) !== null)).toEqual([true, false, false, true]);
  expect(ruleWords(weekdays)).toBe('Fourth Thursday of November, every 2 years');
});

it('checks the new rules and keeps them as the database has them', () => {
  const bad = (rule: unknown) => expect(() => checkedRule(rule as DateRule)).toThrow(expect.objectContaining({ status: 400 }));
  bad({ kind: 'after', month: 11, day: 31, weekday: 2 });
  bad({ kind: 'after', month: 11, day: 2, weekday: 9 });
  bad({ kind: 'calendar', calendar: 'hindu', month: '1', day: 1 });
  bad({ kind: 'calendar', calendar: 'hebrew', month: 'Nowhere', day: 1 });
  bad({ kind: 'calendar', calendar: 'chinese', month: '3', day: 31 });
  bad({ kind: 'fixed', month: 7, day: 4, every: 11 });
  bad({ kind: 'fixed', month: 7, day: 4, every: 0 });
  expect(checkedRule({ kind: 'fixed', month: 7, day: 4, every: 1 })).toEqual({ kind: 'fixed', month: 7, day: 4 });
  expect(checkedRule({ kind: 'manual', every: 4 } as DateRule)).toEqual({ kind: 'manual' });
  const rules = [lanterns, { kind: 'calendar', calendar: 'hebrew', month: 'Adar I', day: 3, every: 4, from: 2026 }, { kind: 'weekday', month: 5, weekday: 1, nth: -1, every: 2, from: 2026 }, { kind: 'fixed', month: 12, day: 25 }, { kind: 'manual' }] as DateRule[];
  for (const rule of rules) {
    const [kind, month, day, weekday, nth, other, calendar, calMonth, calDay, every, from] = columnsFromRule(rule);
    expect(['fixed', 'weekday', 'manual']).toContain(kind); // the table's own check allows only these
    const back = ruleFromColumns({ rule: kind as 'fixed', month: month as number, day_of_month: day as number, weekday: weekday as number, nth: nth as number, rule_kind: other as 'after', calendar: calendar as string, cal_month: calMonth as string, cal_day: calDay as number, every_years: every as number, every_from: from as number });
    expect(back).toEqual(rule);
  }
  // A row from before the new columns reads just as it did.
  expect(ruleFromColumns({ rule: 'weekday', month: 11, day_of_month: null, weekday: 4, nth: 4 })).toEqual({ kind: 'weekday', month: 11, weekday: 4, nth: 4 });
});

it('thaws a turkey in the refrigerator for 24 hours for each 4 pounds, rounded up', () => {
  expect([4, 3, 8, 12, 13, 16, 20, 24, 25].map(thawDays)).toEqual([1, 1, 2, 3, 4, 4, 5, 6, 7]);
  expect(() => thawDays(0)).toThrow();
  expect(() => thawDays(200)).toThrow();
  expect(THAW_SOURCE).toBe('USDA: thawing in the refrigerator');
});
