/**
 * Things you can ask Life Is to do, or tell you, in one short request: "add eggs to groceries", "I spent $12
 * on lunch", "where are the baking dishes?".
 *
 * This is the one list that every way of asking from outside Life Is maps onto: Siri and the Shortcuts app on
 * Apple devices (App Intents), Google's assistant and long-pressing the app icon on Android (shortcuts), and a
 * link that opens the app at the action (living.lifeis.home://do/add-to-groceries?item=eggs). Each of those
 * is a thin wrapper that names an action and passes its few words; what the action does, and what it may
 * touch, is decided here once.
 *
 * Rules every action keeps:
 *   - Small and plain: one thing, with no more than two or three words to fill in.
 *   - It answers in a sentence that can be read out loud.
 *   - Asking (`reads`) never changes anything. Doing (`writes`) only adds; nothing here removes or overwrites.
 *   - The same permissions as the pages: your own things, and categories shared with you.
 */
import type { Db } from './db.ts';
import { kitchen } from './kitchen.ts';
import { inventory } from './inventory.ts';
import { money } from './money.ts';
import { Problem } from './problem.ts';
import { clean, labelKey, todayOf, type Clock } from './small.ts';

export type ActionParam = { name: string; label: string; kind: 'text' | 'money'; required: boolean };
export type ActionInfo = {
  id: string;
  title: string;
  /** What someone might say, for Siri, Google and the Shortcuts app to learn from. */
  says: string[];
  /** 'reads' only answers; 'writes' adds something. */
  does: 'reads' | 'writes';
  /** Which part of Life Is it belongs to, for the free and paid parts of the app. */
  part: 'kitchen' | 'money' | 'things';
  params: ActionParam[];
};
export type ActionResult = { say: string; /** Where in Life Is to look, if the person opens it. */ open: string | null };

type Params = Record<string, string | undefined>;
type Action = ActionInfo & { run(db: Db, owner: number, clock: Clock, given: Params): Promise<ActionResult> };

const text = (given: Params, name: string, label: string) => {
  const value = clean(given[name], 200);
  if (!value) throw new Problem(400, `Say ${label}`);
  return value;
};
/** "12", "$12.50", "12,50" → cents. */
export function centsFrom(said: string | undefined): number {
  const plain = String(said ?? '').replace(/[^\d.,]/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const value = Number(plain);
  if (!plain || !Number.isFinite(value) || value < 0) throw new Problem(400, 'Say how much, as an amount of money');
  return Math.round(value * 100);
}
const money$ = (cents: number, sign: string) => `${cents < 0 ? 'minus ' : ''}${sign}${(Math.abs(cents) / 100).toFixed(2)}`;

const ACTIONS: Action[] = [
  {
    id: 'add-to-groceries', title: 'Add to the grocery list', does: 'writes', part: 'kitchen',
    says: ['Add eggs to my groceries', 'Put milk on the grocery list'],
    params: [{ name: 'item', label: 'what to buy', kind: 'text', required: true }],
    async run(db, owner, clock, given) {
      const item = text(given, 'item', 'what to buy');
      const list = await kitchen(db, owner, clock).addGrocery({ label: item });
      const open = list.filter((g) => !g.done).length;
      return { say: `Added ${item} to your grocery list. ${open === 1 ? 'It is the only thing on it.' : `There are ${open} things on it.`}`, open: '/groceries' };
    },
  },
  {
    id: 'whats-for-dinner', title: "What's for dinner", does: 'reads', part: 'kitchen',
    says: ["What's for dinner?", 'What are we eating tonight?'],
    params: [],
    async run(db, owner, clock) {
      const today = todayOf(clock);
      const meals = (await kitchen(db, owner, clock).listPlan(today, 1)).filter((m) => m.day === today);
      const dinner = meals.find((m) => m.meal === 'dinner') ?? null;
      const name = (m: (typeof meals)[number]) => m.recipe_title ?? m.title ?? 'something';
      if (dinner) return { say: `Dinner tonight is ${name(dinner)}.`, open: '/week' };
      if (meals.length) return { say: `No dinner is planned for today. Planned today: ${meals.map((m) => `${m.meal}, ${name(m)}`).join('; ')}.`, open: '/week' };
      return { say: 'Nothing is planned for today yet.', open: '/week' };
    },
  },
  {
    id: 'record-spending', title: 'Write down something spent', does: 'writes', part: 'money',
    says: ['I spent $12 on lunch', 'Record $40 for groceries'],
    params: [
      { name: 'amount', label: 'how much', kind: 'money', required: true },
      { name: 'what', label: 'what it was for', kind: 'text', required: true },
      { name: 'category', label: 'which category', kind: 'text', required: false },
    ],
    async run(db, owner, clock, given) {
      const cents = centsFrom(given.amount);
      const what = text(given, 'what', 'what it was for');
      const spending = money(db, owner, clock);
      const month = await spending.month();
      // A category named, or one whose name is what it was for ("groceries"); otherwise none.
      const wanted = labelKey(clean(given.category, 80) ?? what);
      const category = month.categories.find((c) => labelKey(c.name) === wanted) ?? null;
      if (given.category && !category) throw new Problem(400, `There's no category called ${clean(given.category, 80)}`);
      await spending.addEntry({ label: what, cents, category_id: category?.id ?? null });
      if (!category) return { say: `Written down: ${money$(cents, month.currency)} for ${what}.`, open: '/money' };
      const left = category.left - cents;
      return { say: `Written down: ${money$(cents, month.currency)} for ${what}, in ${category.name}. ${left < 0 ? `${category.name} is over by ${money$(-left, month.currency)} this month.` : `${money$(left, month.currency)} left in it this month.`}`, open: '/money' };
    },
  },
  {
    id: 'whats-left', title: "What's left to spend", does: 'reads', part: 'money',
    says: ["How much is left in groceries?", "What's left to spend this month?"],
    params: [{ name: 'category', label: 'which category', kind: 'text', required: false }],
    async run(db, owner, clock, given) {
      const month = await money(db, owner, clock).month();
      const asked = clean(given.category, 80);
      if (asked) {
        const category = month.categories.find((c) => labelKey(c.name) === labelKey(asked));
        if (!category) return { say: `There's no category called ${asked}.`, open: '/money' };
        return { say: category.left < 0 ? `${category.name} is over by ${money$(-category.left, month.currency)} this month.` : `${money$(category.left, month.currency)} left in ${category.name} this month.`, open: '/money' };
      }
      if (!month.categories.length) return { say: `No amounts are planned this month. ${money$(month.total.spent, month.currency)} has been spent.`, open: '/money' };
      return { say: month.total.left < 0 ? `This month is over plan by ${money$(-month.total.left, month.currency)}.` : `${money$(month.total.left, month.currency)} left this month, of ${money$(month.total.planned, month.currency)} planned.`, open: '/money' };
    },
  },
  {
    id: 'where-is', title: 'Where is something', does: 'reads', part: 'things',
    says: ['Where are the baking dishes?', 'Where did I put the sewing scissors?'],
    params: [{ name: 'thing', label: 'what you are looking for', kind: 'text', required: true }],
    async run(db, owner, clock, given) {
      const thing = text(given, 'thing', 'what you are looking for');
      const found = (await inventory(db, owner, clock).listItems({ q: thing })).slice(0, 3);
      if (!found.length) return { say: `I couldn't find ${thing} in your things.`, open: '/things' };
      const one = (i: (typeof found)[number]) => `${i.name}${i.place ? `: ${i.place}` : ', with no place written down'}`;
      return { say: found.length === 1 ? `${one(found[0]!)}.` : `Found ${found.length}. ${found.map(one).join('. ')}.`, open: '/things' };
    },
  },
];

/** Every action, as the outside world is told about them. */
export const ACTION_LIST: ActionInfo[] = ACTIONS.map(({ run: _run, ...info }) => info);

export function actions(db: Db, owner: number, clock: Clock = () => new Date()) {
  return {
    list: () => ACTION_LIST,
    async run(id: string, given: Params, how: 'GET' | 'POST'): Promise<ActionResult> {
      const action = ACTIONS.find((a) => a.id === id);
      if (!action) throw new Problem(404, "Life Is doesn't know how to do that");
      // Asking is a look (GET); doing is a change (POST). Mixing them up would let a change slip past a read-only rule.
      if ((action.does === 'reads') !== (how === 'GET')) throw new Problem(400, action.does === 'reads' ? 'That only answers: ask for it, don\'t send it' : 'That changes something: send it, don\'t just ask for it');
      return action.run(db, owner, clock, given);
    },
  };
}
