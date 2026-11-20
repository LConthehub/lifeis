/**
 * The front page: what today holds, and what wants attention, gathered from every section.
 *
 * Nothing is kept here. Each card is read from where it lives (the calendar, the kitchen, your things, your
 * projects, your collection) and links back there. A person can put any card out of sight; that choice is
 * the only thing this saves.
 */
import { calendar, type Entry } from './calendar.ts';
import type { Db } from './db.ts';
import { inventory } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import type { EquipmentShortage, PlannedMeal } from './kitchenTypes.ts';
import { life, type Section } from './life.ts';
import { media } from './media.ts';
import { Problem } from './problem.ts';
import { projects, type ProjectSummary } from './projects.ts';
import { addDays, dayNumber, todayOf, type Clock } from './small.ts';

/** The cards, in the order they show, and the section each belongs to. */
export const CARDS = [
  { key: 'days', label: 'Today and the next two days', section: 'planning' },
  { key: 'kitchen', label: 'Cooking: today’s meals, the grocery list, pans you’re short of', section: 'eating' },
  { key: 'pantry', label: 'Pantry: running low and use soon', section: 'eating' },
  { key: 'projects', label: 'Projects in hand', section: 'making' },
  { key: 'things', label: 'Things running low', section: 'keeping' },
  { key: 'collection', label: 'Collection: lent out, and lately watched, read or heard', section: 'enjoying' },
] as const satisfies readonly { key: string; label: string; section: Section }[];
export type CardKey = (typeof CARDS)[number]['key'];

export type HomeSummary = {
  /** Today where the person is, as 2046-03-05. */
  day: string;
  /** The cards to show, in order: those of the sections the person uses, less the ones they put out of sight. */
  cards: CardKey[];
  /** Every card they could show, for choosing. */
  choices: { key: CardKey; label: string; shown: boolean }[];
  days: { day: string; entries: Entry[] }[];
  kitchen: { meals: PlannedMeal[]; to_buy: number; short: EquipmentShortage[] };
  pantry: { low: string[]; expiring: { name: string; days_left: number }[] };
  projects: ProjectSummary[];
  things: { low: { id: number; name: string; amount: string; kind: string }[]; total: number };
  collection: {
    total: number;
    wanted: number;
    lent: { id: number; title: string; to: string }[];
    lately: { id: number; title: string; type: string; day: string }[];
  };
};

const SETTING = 'home_hidden_cards';

export function home(db: Db, owner: number, clock: Clock = () => new Date()) {
  async function hidden(): Promise<CardKey[]> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    try {
      const list: unknown = row?.value ? JSON.parse(row.value) : [];
      return Array.isArray(list) ? CARDS.map((card) => card.key).filter((key) => list.includes(key)) : [];
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
      const offered = CARDS.filter((card) => sections.includes(card.section));
      const cards = offered.map((card) => card.key).filter((key) => !out.includes(key));
      const shows = (key: CardKey) => cards.includes(key);

      const summary: HomeSummary = {
        day, cards,
        choices: offered.map((card) => ({ key: card.key, label: card.label, shown: !out.includes(card.key) })),
        days: [], kitchen: { meals: [], to_buy: 0, short: [] }, pantry: { low: [], expiring: [] }, projects: [],
        things: { low: [], total: 0 }, collection: { total: 0, wanted: 0, lent: [], lately: [] },
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
          };
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
      if (shows('collection')) {
        const titles = await media(db, owner, clock).list();
        summary.collection = {
          total: titles.length,
          wanted: titles.filter((t) => t.wanted).length,
          lent: titles.flatMap((t) => t.lent_to.map((to) => ({ id: t.id, title: t.title, to }))).slice(0, 12),
          lately: titles.filter((t) => t.last_on).sort((a, b) => (a.last_on! < b.last_on! ? 1 : -1)).slice(0, 5)
            .map((t) => ({ id: t.id, title: t.title, type: t.type, day: t.last_on! })),
        };
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
