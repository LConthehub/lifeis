/**
 * Every plan in one list by date: one-time plans, each year of a holiday or trip, and birthdays and other
 * yearly dates on the calendar that have no plan yet.
 *
 * This only reads. Holidays and trips keep their own pages; a year of one is an ordinary plan (plans.ts) with
 * a row in holiday_years or outdoor_trip_years, so here it is shown once, under its holiday or trip, and not
 * again as a plain plan. A holiday whose year has not been started yet still shows, on its next date, so it can
 * be started from last year's.
 */
import { calendar } from './calendar.ts';
import type { Db } from './db.ts';
import { nextDate } from './holidayDates.ts';
import { holidays } from './holidays.ts';
import { outdoorTrips } from './outdoorTrips.ts';
import { plans } from './plans.ts';
import { dayNumber, todayOf, type Clock } from './small.ts';

/** What sort of plan it is, for the chips on the Plans page. */
export type PlanKind = 'trip' | 'gathering' | 'birthday';
/** Where it goes on the page: under way or within the next two months, further off, or over. */
export type PlanBand = 'soon' | 'later' | 'past';
export type PlanLine = {
  /** Unique on the page, such as plan-4, holiday-2 or date-9. */
  key: string;
  name: string;
  kind: PlanKind;
  /** It comes back each year. */
  yearly: boolean;
  start_day: string;
  end_day: string;
  band: PlanBand;
  /** Days until it starts; 0 once it has begun; below 0 when over. */
  days_until: number;
  /** The page it opens. */
  link: string;
  /** What is next, in words, or null. */
  next: string | null;
  /** True for a birthday or yearly date with no plan: shown as a small line. */
  small: boolean;
  /** For a holiday not started this year: it can be started from last year's. */
  not_started: boolean;
  /** How many years since the first, for a birthday or anniversary. */
  years: number | null;
  cover_photo: number | null;
};

/** How far ahead counts as coming up. */
export const PLAN_SOON_DAYS = 60;

export function planList(db: Db, owner: number, clock: Clock = () => new Date()) {
  return {
    async list(): Promise<PlanLine[]> {
      const today = todayOf(clock);
      const until = (day: string) => dayNumber(day) - dayNumber(today);
      /** 0 while it is under way. */
      const daysUntil = (start: string, end: string) => (start <= today && end >= today ? 0 : until(start));
      const band = (start: string, end: string): PlanBand => (end < today ? 'past' : until(start) <= PLAN_SOON_DAYS ? 'soon' : 'later');
      const out: PlanLine[] = [];
      const yearPlans = new Set<number>();

      for (const h of await holidays(db, owner, clock).list()) {
        for (const y of h.years) yearPlans.add(y.plan_id);
        const ahead = h.latest && h.latest.when !== 'past' ? h.latest : null;
        for (const y of h.years) {
          if (ahead && y.plan_id === ahead.plan_id) continue;
          out.push({ key: `plan-${y.plan_id}`, name: `${h.name} ${y.year}`, kind: 'gathering', yearly: true, start_day: y.day, end_day: y.day,
            band: 'past', days_until: until(y.day), link: `/plans/${y.plan_id}`, next: null, small: false, not_started: false, years: null, cover_photo: null });
        }
        const day = ahead?.day ?? (h.rule.kind === 'manual' ? null : nextDate(h.rule, today));
        if (!day) continue;
        out.push({ key: `holiday-${h.id}`, name: h.name, kind: 'gathering', yearly: true, start_day: day, end_day: day, band: band(day, day),
          days_until: daysUntil(day, day), link: ahead ? `/plans/${ahead.plan_id}` : `/plans/holidays/${h.id}`,
          next: h.next, small: false, not_started: !ahead, years: null, cover_photo: null });
      }

      for (const t of await outdoorTrips(db, owner, clock).list()) for (const y of t.years) yearPlans.add(y.plan_id);

      for (const p of await plans(db, owner, clock).list()) {
        const trip = await db.get<{ trip_id: number; name: string }>(
          'SELECT y.trip_id, t.name FROM outdoor_trip_years y JOIN outdoor_trips t ON t.id = y.trip_id WHERE y.plan_id = ? AND t.owner_id = ?', [p.id, owner]);
        if (trip) {
          out.push({ key: `plan-${p.id}`, name: p.name, kind: 'trip', yearly: true, start_day: p.start_day, end_day: p.end_day, band: band(p.start_day, p.end_day),
            days_until: daysUntil(p.start_day, p.end_day), link: `/plans/trips/${trip.trip_id}/${p.id}`,
            next: p.when === 'past' ? null : p.tasks_left > 0 ? `${p.tasks_left} still to do` : null, small: false, not_started: false, years: null, cover_photo: p.cover_photo });
          continue;
        }
        if (yearPlans.has(p.id)) continue;
        out.push({ key: `plan-${p.id}`, name: p.name, kind: 'gathering', yearly: false, start_day: p.start_day, end_day: p.end_day, band: band(p.start_day, p.end_day),
          days_until: daysUntil(p.start_day, p.end_day), link: `/plans/${p.id}`,
          next: p.when === 'past' ? null : p.tasks_left > 0 ? `${p.tasks_left} still to do` : null, small: false, not_started: false, years: null, cover_photo: p.cover_photo });
      }

      // Birthdays and other yearly dates with no holiday made from them yet: the next time each comes round.
      const planned = new Set((await db.all<{ event_id: number }>('SELECT event_id FROM holidays WHERE owner_id = ? AND event_id IS NOT NULL', [owner])).map((r) => r.event_id));
      const seen = new Set<number>();
      for (const d of await calendar(db, owner, clock).yearly(today, 366)) {
        if (planned.has(d.id) || seen.has(d.id)) continue;
        seen.add(d.id);
        out.push({ key: `date-${d.id}`, name: d.title, kind: 'birthday', yearly: true, start_day: d.day, end_day: d.day, band: band(d.day, d.day),
          days_until: until(d.day), link: '/calendar', next: null, small: true, not_started: false, years: d.years > 0 ? d.years : null, cover_photo: null });
      }

      // Ahead: soonest first. Past: newest first.
      const order: Record<PlanBand, number> = { soon: 0, later: 1, past: 2 };
      return out.sort((a, b) => order[a.band] - order[b.band] || (a.band === 'past'
        ? b.start_day.localeCompare(a.start_day) || a.name.localeCompare(b.name)
        : a.start_day.localeCompare(b.start_day) || Number(a.small) - Number(b.small) || a.name.localeCompare(b.name)));
    },
  };
}
export type PlanList = ReturnType<typeof planList>;
