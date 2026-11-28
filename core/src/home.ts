/**
 * The front page: what today holds, and what wants attention, gathered from every section.
 *
 * Nothing is kept here. Each card is read from where it lives (the calendar, the kitchen, your things, your
 * projects, your collection) and links back there. A person can put any card out of sight; that choice is
 * the only thing this saves.
 */
import { upkeep, type DueState } from './upkeep.ts';
import { calendar, type Entry } from './calendar.ts';
import { planList, PLAN_SOON_DAYS, type PlanLine } from './planList.ts';
import type { Fetcher } from './connections.ts';
import type { Db } from './db.ts';
import { homeServices, type ServiceView } from './homeServices.ts';
import { holidays, type HolidayCard } from './holidays.ts';
import { inventory } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import type { EquipmentShortage, PlannedMeal } from './kitchenTypes.ts';
import { life, type Section } from './life.ts';
import { media } from './media.ts';
import { Problem } from './problem.ts';
import { projects, type ProjectSummary } from './projects.ts';
import { problemCard } from './start.ts';
import { addDays, dayNumber, todayOf, type Clock } from './small.ts';
import { weather, type Forecast, type WeatherPlace } from './weather.ts';

/**
 * The cards, in the order they show, and the section each belongs to. A card with no section is for everyone.
 * The weather and email are only offered once they have been turned on (in Settings, under "Connections"),
 * and plans, coupons and routines only once there is one, so a card never sits there about something a person doesn't use.
 * The email card's messages aren't in the summary: the page asks for those apart (they come from the provider).
 */
export const CARDS = [
  { key: 'jot', label: 'Jot it down: one line for a stray thought', section: null },
  { key: 'days', label: 'Today and the next two days', section: 'planning' },
  { key: 'routines', label: 'Routines: today’s checklists to check off', section: null },
  { key: 'weather', label: 'The weather', section: null },
  { key: 'mail', label: 'Email: what’s unread', section: null },
  { key: 'coming', label: 'Coming up: plans, holidays, trips and birthdays', section: 'planning' },
  { key: 'kitchen', label: 'Cooking: today’s meals, the grocery list, pans you’re short of', section: 'eating' },
  { key: 'pantry', label: 'Pantry: running low and use soon', section: 'eating' },
  { key: 'coupons', label: 'Coupons about to run out', section: 'eating' },
  { key: 'projects', label: 'Projects', section: 'making' },
  { key: 'upkeep', label: 'Upkeep: jobs due around the home', section: 'keeping' },
  { key: 'things', label: 'Things running low', section: 'keeping' },
  { key: 'services', label: 'Home lab: the links you pinned', section: 'keeping' },
  { key: 'collection', label: 'Collection: what is new, lent out, and lately watched, read or heard', section: 'enjoying' },
  { key: 'week', label: 'This week in numbers', section: null },
] as const satisfies readonly { key: string; label: string; section: Section | null }[];
export type CardKey = (typeof CARDS)[number]['key'];

export type HomeSummary = {
  /** Today where the person is, as 2046-03-05. */
  day: string;
  /** The cards to show, in order: those of the sections the person uses, less the ones they put out of sight. */
  cards: CardKey[];
  /** The card to open on, for what bugs them most at home (their answer when they began), when it is showing. */
  first: CardKey | null;
  /** Every card they could show, for choosing. */
  choices: { key: CardKey; label: string; shown: boolean }[];
  days: { day: string; entries: Entry[] }[];
  /** `use_up` is null when nothing in the pantry is going off; else what is, and the best recipe for it. */
  kitchen: { meals: PlannedMeal[]; to_buy: number; short: EquipmentShortage[]; use_up: { soon: string[]; suggestion: { recipe_id: number; title: string; uses: string[] } | null } | null };
  pantry: { low: string[]; expiring: { name: string; days_left: number }[] };
  projects: ProjectSummary[];
  /** The home service links the person pinned, and may still see. */
  services: ServiceView[];
  things: { low: { id: number; name: string; amount: string; kind: string }[]; total: number };
  /** Ammunition running low: only on the person's own Home page, and only when they keep ammunition. Never in anything shared. */
  ammo: { id: number; name: string; amount: string; caliber: string | null }[];
  /** Upkeep late, due or coming up soon, most pressing first. */
  upkeep: { id: number; name: string; state: DueState; days_left: number | null; reading_left: number | null; reading_unit: string | null; who: string | null }[];
  collection: {
    total: number;
    wanted: number;
    lent: { id: number; title: string; to: string }[];
    lately: { id: number; title: string; type: string; day: string }[];
    /** Added in the last two weeks (by hand, a scan or a server sync), newest first: the first eight, and how many in all. */
    added: { id: number; title: string; type: string; cover: string | null }[];
    added_count: number;
  };
  /**
   * Plans, holiday and trip years, and birthdays under way or in the next sixty days, soonest first, each once;
   * and the holidays with something to say today (start planning, take-down, notes for next year), which the card
   * shows in place of that holiday's line. `upkeep` is the big things coming due in the same two months: a renewal,
   * or a job done once a year or less often (clean the gutters). Weekly chores and monthly bills stay on Upkeep.
   */
  coming: { lines: PlanLine[]; holidays: HolidayCard[]; upkeep: ComingUpkeep[] };
  /** Unused coupons with a week or less left, soonest first. */
  coupons: { currency: string; soon: { id: number; label: string; store: string | null; cents_off: number | null; percent_off: number | null; days_left: number }[] };
  weather: { place: WeatherPlace; forecast: Forecast | null } | null;
  /** Monday to Sunday of this week. A number is null when its section isn't one the person uses. */
  week: {
    start: string; end: string;
    events: number | null; meals_planned: number | null; meals_cooked: number | null;
    sessions: number | null; minutes: number | null; enjoyed: number | null;
  };
};

export type ComingUpkeep = { id: number; name: string; kind: 'renewal' | 'job'; day: string; /** Below 0 is late. */ days_until: number };

/** A renewal, or a job done once a year or less often. */
const bigUpkeep = (j: { kind: string; every: { n: number; unit: string } | null }) =>
  j.kind === 'renewal' || (j.kind === 'job' && j.every !== null && (j.every.unit === 'year' || (j.every.unit === 'month' && j.every.n >= 12)));

const SETTING = 'home_hidden_cards';

export function home(db: Db, owner: number, clock: Clock = () => new Date(), fetcher?: Fetcher) {
  async function hidden(): Promise<CardKey[]> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    try {
      const list: unknown = row?.value ? JSON.parse(row.value) : [];
      if (!Array.isArray(list)) return [];
      // Coming up took the place of three cards; it stays hidden for someone who had hidden all three.
      if (['dates', 'plans', 'holidays'].every((old) => list.includes(old))) list.push('coming');
      return CARDS.map((card) => card.key).filter((key) => list.includes(key));
    } catch {
      return [];
    }
  }

  return {
    async summary(): Promise<HomeSummary> {
      const day = todayOf(clock);
      dayNumber(day);
      const sections = (await life(db, owner, clock).getProfile()).sections;
      const out = await hidden();
      const skies = weather(db, owner, clock, fetcher);
      const place = await skies.place();
      const hasMail = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mail_accounts WHERE owner_id = ?', [owner]))!.n > 0;
      const any = async (sql: string) => Boolean(await db.get(sql, [owner]));
      const hasServices = (await homeServices(db, owner, clock).pinned()).length > 0;
      const hasCoupons = await any('SELECT 1 AS n FROM coupons WHERE owner_id = ? AND used_on IS NULL LIMIT 1');
      // Routines for this person (or for everyone); a household member's show on the chore chart instead.
      const hasRoutines = Boolean(await db.get('SELECT 1 AS n FROM routines WHERE for_member IS NULL AND (for_user = ? OR for_user IS NULL) AND (owner_id = ? OR for_user = ? OR for_user IS NULL) LIMIT 1', [owner, owner, owner]));
      const offered = CARDS.filter((card) => (card.key === 'weather' ? place !== null : card.key === 'mail' ? hasMail : card.key === 'routines' ? hasRoutines
        : (card.section === null || sections.includes(card.section)) && (card.key !== 'coupons' || hasCoupons) && (card.key !== 'services' || hasServices)));
      const cards = offered.map((card) => card.key).filter((key) => !out.includes(key));
      const shows = (key: CardKey) => cards.includes(key);
      const asked = await problemCard(db, owner);

      const summary: HomeSummary = {
        day, cards, first: cards.find((key) => key === asked) ?? null,
        choices: offered.map((card) => ({ key: card.key, label: card.label, shown: !out.includes(card.key) })),
        days: [], kitchen: { meals: [], to_buy: 0, short: [], use_up: null }, pantry: { low: [], expiring: [] }, projects: [],
        services: [], things: { low: [], total: 0 }, ammo: [], upkeep: [], collection: { total: 0, wanted: 0, lent: [], lately: [], added: [], added_count: 0 },
        coming: { lines: [], holidays: [], upkeep: [] }, coupons: { currency: '$', soon: [] }, weather: null,
        week: { start: day, end: day, events: null, meals_planned: null, meals_cooked: null, sessions: null, minutes: null, enjoyed: null },
      };
      // Only what will be shown is read, so a section put out of sight costs nothing.
      if (shows('days')) {
        const entries = await calendar(db, owner, clock).between(day, 3);
        summary.days = [0, 1, 2].map((n) => addDays(day, n)).map((d) => ({ day: d, entries: entries.filter((e) => e.day === d) }));
      }
      if (shows('kitchen') || shows('pantry')) {
        const k = kitchen(db, owner, clock);
        if (shows('kitchen')) {
          summary.kitchen = {
            meals: await k.listPlan(day, 1),
            to_buy: (await k.listGrocery()).filter((item) => !item.done).length,
            short: await k.equipmentCheck(day, 7),
            use_up: null,
          };
          // The same question the pantry page asks, with one answer: the best recipe for what is going off.
          const useUp = await k.useItUp(5, 1);
          if (useUp.soon.length > 0) {
            const best = useUp.suggestions[0];
            summary.kitchen.use_up = { soon: useUp.soon.map((item) => item.name), suggestion: best ? { recipe_id: best.recipe_id, title: best.title, uses: best.uses } : null };
          }
        }
        if (shows('pantry')) {
          const pantry = await k.listPantry();
          summary.pantry = {
            low: pantry.low,
            expiring: pantry.items.filter((item) => item.days_left !== null && item.days_left <= 3).map((item) => ({ name: item.name, days_left: item.days_left! })),
          };
        }
      }
      if (shows('projects')) {
        summary.projects = (await projects(db, owner, clock).listProjects()).filter((p) => ['active', 'paused', 'planned'].includes(p.status)).slice(0, 8);
      }
      if (shows('things')) {
        const all = await inventory(db, owner, clock).listItems();
        summary.things = { total: all.length, low: all.filter((item) => item.low).map(({ id, name, amount, kind }) => ({ id, name, amount, kind })).slice(0, 12) };
      }
      if (shows('things')) summary.ammo = await inventory(db, owner, clock).ammoLow();
      if (shows('services')) summary.services = await homeServices(db, owner, clock).pinned();
      if (shows('upkeep')) {
        summary.upkeep = (await upkeep(db, owner, clock).list()).filter((j) => ['overdue', 'due', 'soon'].includes(j.due.state)).slice(0, 8)
          .map((j) => ({ id: j.id, name: j.name, state: j.due.state, days_left: j.due.days_left, reading_left: j.due.reading_left, reading_unit: j.reading_unit,
            who: j.assigned_to && j.assigned_to.id !== owner ? j.assigned_to.name : null }));
      }
      if (shows('collection')) {
        const titles = await media(db, owner, clock).list();
        summary.collection = {
          total: titles.length,
          wanted: await media(db, owner, clock).wantedCount(),
          lent: titles.flatMap((t) => t.lent_to.map((to) => ({ id: t.id, title: t.title, to }))).slice(0, 12),
          lately: titles.filter((t) => t.last_on).sort((a, b) => (a.last_on! < b.last_on! ? 1 : -1)).slice(0, 5)
            .map((t) => ({ id: t.id, title: t.title, type: t.type, day: t.last_on! })),
          added: [], added_count: 0,
        };
        // New in the collection: owned titles added in the last 14 days (a wanted title is not new to the shelf).
        const since = addDays(day, -14);
        const fresh = titles.filter((t) => !t.wanted && !t.unowned && t.added_at.slice(0, 10) >= since).sort((a, b) => (a.added_at < b.added_at ? 1 : a.added_at > b.added_at ? -1 : b.id - a.id));
        summary.collection.added = fresh.slice(0, 8).map((t) => ({ id: t.id, title: t.title, type: t.type, cover: t.cover ?? null }));
        summary.collection.added_count = fresh.length;
      }
      if (shows('coming')) {
        const lines = (await planList(db, owner, clock).list()).filter((l) => l.band === 'soon').slice(0, 8);
        const soon = addDays(day, PLAN_SOON_DAYS);
        const big = (await upkeep(db, owner, clock).list())
          .filter((j) => bigUpkeep(j) && j.due.next_day !== null && j.due.next_day <= soon)
          .map((j) => ({ id: j.id, name: j.name, kind: j.kind === 'renewal' ? 'renewal' as const : 'job' as const, day: j.due.next_day!, days_until: j.due.days_left ?? 0 }))
          .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name)).slice(0, 4);
        summary.coming = { lines, holidays: await holidays(db, owner, clock).cards(), upkeep: big };
      }
      if (shows('coupons')) {
        const sign = await db.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'shopping_currency'", [owner]);
        summary.coupons = {
          currency: sign?.value ?? '$',
          soon: (await db.all<{ id: number; label: string; store: string | null; cents_off: number | null; percent_off: number | null; expires_on: string }>(
            `SELECT id, label, store, cents_off, percent_off, expires_on FROM coupons
             WHERE owner_id = ? AND used_on IS NULL AND expires_on >= ? AND expires_on <= ? ORDER BY expires_on, id LIMIT 8`, [owner, day, addDays(day, 7)]))
            .map(({ expires_on, ...c }) => ({ ...c, days_left: dayNumber(expires_on) - dayNumber(day) })),
        };
      }
      if (shows('weather') && place) summary.weather = { place, forecast: (await skies.status()).forecast };
      if (shows('week')) {
        // 1970-01-01 was a Thursday, so this counts back to Monday.
        const start = addDays(day, -((dayNumber(day) + 3) % 7));
        const end = addDays(start, 6);
        const count = async (sql: string) => (await db.get<{ n: number; total: number | null }>(sql, [owner, start, end]))!;
        const week: HomeSummary['week'] = { ...summary.week, start, end };
        if (sections.includes('planning')) {
          week.events = (await count('SELECT COUNT(*) AS n, 0 AS total FROM events WHERE owner_id = ? AND yearly = 0 AND COALESCE(end_day, day) >= ? AND day <= ?')).n
            + (await calendar(db, owner, clock).yearly(start, 7)).length;
        }
        if (sections.includes('eating')) {
          const meals = await count('SELECT COUNT(*) AS n, COUNT(cooked_on) AS total FROM meal_plan WHERE owner_id = ? AND day >= ? AND day <= ?');
          [week.meals_planned, week.meals_cooked] = [meals.n, meals.total ?? 0];
        }
        if (sections.includes('making')) {
          const worked = await count(`SELECT COUNT(*) AS n, SUM(s.minutes) AS total FROM project_sessions s JOIN projects p ON p.id = s.project_id
            WHERE p.owner_id = ? AND s.day >= ? AND s.day <= ?`);
          [week.sessions, week.minutes] = [worked.n, worked.total ?? 0];
        }
        if (sections.includes('enjoying')) {
          week.enjoyed = (await count('SELECT COUNT(DISTINCT l.media_id) AS n, 0 AS total FROM media_log l JOIN media m ON m.id = l.media_id WHERE m.owner_id = ? AND l.day >= ? AND l.day <= ?')).n;
        }
        summary.week = week;
      }
      return summary;
    },

    /** Choose which cards are out of sight. Cards not named are shown. */
    async hideCards(keys: string[]): Promise<HomeSummary> {
      if (keys.some((key) => !CARDS.some((card) => card.key === key))) throw new Problem(400, "One of those isn't a card on the front page");
      await db.run(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, SETTING, JSON.stringify([...new Set(keys)])]);
      return this.summary();
    },
  };
}

export type Home = ReturnType<typeof home>;
