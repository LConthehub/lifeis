/**
 * What a voice shortcut (Siri Shortcuts) asks of Life Is, and the short sentences it is answered with, ready to
 * be spoken. Everything is read or written through the same code the pages use (kitchen, shopping, calendar);
 * this file only decides which of it a voice may reach and how it is worded.
 *
 * What a voice can reach is deliberately small: the grocery list, the day's events and chores, the week's
 * meals, and a new reminder. It never reaches guns or ammunition, measures, gifts, money or mail.
 */
import { calendar, type Entry } from './calendar.ts';
import { kitchen } from './kitchen.ts';
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { shopping } from './shopping.ts';
import { addDays, clean, dayNumber, todayOf, type Clock } from './small.ts';

// ---------- what a key may do ----------

/** The things a personal key can be allowed to do. `says` is how the Settings page words each one. */
export const KEY_ACTIONS = [
  { id: 'groceries_read', says: 'Read your grocery list' },
  { id: 'groceries_add', says: 'Add things to your grocery list' },
  { id: 'today_read', says: 'Read what is on today: events and chores due' },
  { id: 'meals_read', says: "Read the week's meals (and what is for dinner)" },
  { id: 'reminder_add', says: 'Add a reminder to your calendar' },
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number]['id'];
export const isKeyAction = (value: unknown): value is KeyAction => KEY_ACTIONS.some((a) => a.id === value);

// ---------- saying things ----------

const FILLER = /^(?:and|also|then|plus|some|please|a|an|more)\s+/i;

/**
 * What was said, as the lines to buy: "milk, eggs and pie crust" is three. Split on commas, "and", "&", semicolons
 * and line breaks. "mac and cheese" is two as well: a voice cannot tell, and a name can be said as one thing
 * by leaving out the "and".
 */
export function splitGroceries(said: string): string[] {
  const things: string[] = [];
  for (const piece of said.split(/[,;\n\r]+|\s+(?:and|&)\s+/i)) {
    let line = piece.trim().replace(/[.!?]+$/, '').trim();
    for (let i = 0; i < 3 && FILLER.test(line); i += 1) line = line.replace(FILLER, '');
    if (line) things.push(line);
  }
  return things;
}

const MOST_SAID = 40;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Milk, eggs, pie crust, and 11 more." The first few, and how many are left. */
export function spokenList(names: string[], most = 3): string {
  const first = names.slice(0, most);
  const rest = names.length - first.length;
  if (rest > 0) return `${first.join(', ')}, and ${rest} more.`;
  if (first.length <= 1) return `${first.join('')}.`;
  if (first.length === 2) return `${first[0]} and ${first[1]}.`;
  return `${first.slice(0, -1).join(', ')}, and ${first[first.length - 1]}.`;
}

/** 15:30 as "3:30 PM", and 09:00 as "9 AM". */
export function spokenTime(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const weekdayOf = (day: string) => (dayNumber(day) + 4) % 7; // day 0 is 1970-01-01, a Thursday

/** A day as it is said: "today", "tomorrow", "Friday", or "March 5" for further off. */
export function spokenDay(day: string, today: string): string {
  const ahead = dayNumber(day) - dayNumber(today);
  if (ahead === 0) return 'today';
  if (ahead === 1) return 'tomorrow';
  if (ahead > 1 && ahead < 7) return upper(WEEKDAYS[weekdayOf(day)]!);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}

/**
 * When a reminder is for, as people say it: "tomorrow at 3pm", "friday 9:30 am", "2046-03-05", "noon", "in 3 days".
 * Nothing said means today with no time. What can't be understood is a Problem, with words to say back.
 */
export function readWhen(said: string | null | undefined, today: string): { day: string; time: string | null } {
  let words = (said ?? '').toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return { day: today, time: null };
  let day: string | null = null;
  let time: string | null = null;
  const take = (pattern: RegExp, use: (m: RegExpExecArray) => void) => {
    const m = pattern.exec(words);
    if (m) { use(m); words = words.replace(m[0], ' ').replace(/\s+/g, ' ').trim(); }
  };
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { day = m[0]; });
  take(/\bday after tomorrow\b/, () => { day = addDays(today, 2); });
  take(/\btomorrow\b/, () => { day = addDays(today, 1); });
  take(/\b(?:today|tonight|this evening|this afternoon|this morning)\b/, (m) => { day = today; if (/tonight|evening/.test(m[0]) && !time) time = '19:00'; });
  take(/\bin (\d{1,3}|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/, (m) => {
    const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 } as Record<string, number>)[m[1]!] ?? Number(m[1]);
    day = addDays(today, n * (m[2]!.startsWith('week') ? 7 : 1));
  });
  take(/\b(?:next |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, (m) => {
    let ahead = (WEEKDAYS.indexOf(m[1]!) - weekdayOf(today) + 7) % 7;
    if (ahead === 0) ahead = 7;
    day = addDays(today, ahead);
  });
  take(/\bnoon\b/, () => { time = '12:00'; });
  take(/\bmidnight\b/, () => { time = '00:00'; });
  take(/\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/, (m) => {
    const h = Number(m[1]); const min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) return;
    time = `${String(h % 12 + (m[3]!.startsWith('p') ? 12 : 0)).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  });
  take(/\b(?:at )?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { if (!time) time = `${m[1]!.padStart(2, '0')}:${m[2]}`; });
  take(/\bat (\d{1,2})\b/, (m) => { const h = Number(m[1]); if (!time && h >= 1 && h <= 12) time = `${String(h < 7 ? h + 12 : h).padStart(2, '0')}:00`; });
  words = words.replace(/\b(?:at|on|for|the|by|around|this|next)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (words) throw new Problem(400, `That time wasn't clear: "${said!.trim().slice(0, 40)}". Try tomorrow at 3 PM.`);
  return { day: day ?? today, time };
}

// ---------- the answers ----------

/** One person's voice: what each spoken request does for them, and the sentence that comes back. */
export function voice(db: Db, owner: number, clock: Clock = () => new Date()) {
  const kept = () => kitchen(db, owner, clock);
  const day = () => todayOf(clock);

  const wording = (item: { amount: string; label: string }) => upper([item.amount, item.label].filter(Boolean).join(' '));
  const openItems = async () => (await kept().listGrocery()).filter((g) => !g.done);

  /** Chores belonging to a gun or ammunition are left out of anything a voice says. */
  async function privateJobs(): Promise<Set<string>> {
    const rows = await db.all<{ id: number }>(
      'SELECT j.id FROM upkeep_jobs j JOIN items i ON i.id = j.item_id JOIN kinds k ON k.id = i.kind_id WHERE k.guard IS NOT NULL');
    return new Set(rows.map((r) => `/things/upkeep/${r.id}`));
  }

  /** Tonight's dinner by name, and what it still needs that the pantry doesn't cover. Null names: nothing planned. */
  async function dinnerParts(): Promise<{ names: string[]; need: string[] }> {
    const meals = (await kept().listPlan(day(), 1)).filter((m) => m.meal === 'dinner' && !m.cooked_on);
    const need = [...new Set((await Promise.all(meals.map((m) => kept().needsForMeal(m.id)))).flat())];
    return { names: meals.map((m) => m.recipe_title ?? m.title ?? 'A meal'), need };
  }
  const needText = (need: string[]) => (need.length ? ` You still need ${spokenList(need, 4)}` : '');

  return {
    /** "milk, eggs and pie crust": each put on the list as if typed, what is already there left alone. */
    async addGroceries(said: string): Promise<string> {
      const things = splitGroceries(clean(said, 2000) ?? '');
      if (things.length === 0) return "Nothing to add was heard.";
      if (things.length > MOST_SAID) throw new Problem(400, `That's more than ${MOST_SAID} things. Say it in two parts.`);
      const done = await kept().addGroceries(things);
      const onList = done.items.filter((g) => !g.done).length;
      const already = done.already ? ` ${done.already === 1 ? 'One was' : `${done.already} were`} already there.` : '';
      if (done.added === 0) return `${done.already === 1 ? 'That was' : 'Those were'} already on the list. That's ${count(onList, 'thing')} on the list.`;
      return `Added ${done.added}.${already} That's ${onList} on the list.`;
    },

    /** What is left to buy, and for one store when it is named. */
    async whatToBuy(store?: string | null): Promise<string> {
      const named = clean(store, 100);
      let items = await openItems();
      if (named) {
        const lines = (await shopping(db, owner, clock).summary()).lines;
        const at = new Map(lines.map((l) => [l.id, (l.store ?? '').toLowerCase()]));
        items = items.filter((g) => at.get(g.id) === named.toLowerCase());
        if (items.length === 0) return `Nothing to buy at ${named}.`;
        return `${count(items.length, 'thing')} at ${named}. ${spokenList(items.map(wording))}`;
      }
      if (items.length === 0) return 'Nothing on the list.';
      return `${count(items.length, 'thing')}. ${spokenList(items.map(wording))}`;
    },

    /** Tonight's dinner, and what is still missing for it. */
    async dinner(): Promise<string> {
      const { names, need } = await dinnerParts();
      if (names.length === 0) return 'Nothing planned for dinner.';
      return `${upper(spokenList(names, 5).replace(/\.$/, ''))}.${needText(need)}`;
    },

    /** Events, plans and chores due today; dinner as well when `withDinner`. */
    async today(withDinner = false): Promise<string> {
      const hidden = await privateJobs();
      const entries: Entry[] = (await calendar(db, owner, clock).between(day(), 1))
        .filter((e) => ['event', 'outside', 'plan', 'upkeep'].includes(e.kind) && !(e.link && hidden.has(e.link)));
      const timed = (e: Entry) => (e.time ? `${e.title} at ${spokenTime(e.time)}` : e.title);
      const events = entries.filter((e) => e.kind !== 'upkeep').map(timed);
      const chores = entries.filter((e) => e.kind === 'upkeep').map((e) => e.title);
      const parts: string[] = [];
      if (events.length) parts.push(`On today: ${spokenList(events, 5)}`);
      if (chores.length) parts.push(`Due today: ${spokenList(chores, 5)}`);
      if (withDinner) {
        const { names, need } = await dinnerParts();
        if (names.length) parts.push(`Dinner is ${spokenList(names, 5).replace(/\.$/, '')}.${needText(need)}`);
      }
      return parts.length ? parts.join(' ') : 'Nothing on today.';
    },

    /** The meals planned for the week ahead, a short line a day. */
    async week(): Promise<string> {
      const meals = await kept().listPlan(day(), 7);
      if (meals.length === 0) return 'Nothing planned for the week.';
      const today = day();
      const dinners = meals.filter((m) => m.meal === 'dinner');
      const shown = (dinners.length ? dinners : meals).slice(0, 7);
      return `${upper(dinners.length ? 'dinners' : 'meals')} this week: ${shown.map((m) => `${spokenDay(m.day, today)}, ${m.recipe_title ?? m.title ?? 'a meal'}`).join('. ')}.`;
    },

    /** A reminder: a dated line on the calendar, with a time when one was said. It shows in the morning reminders too. */
    async addReminder(text: string, when?: string | null): Promise<string> {
      const title = clean(text, 200);
      if (!title) return "No reminder was heard.";
      const today = day();
      const at = readWhen(when, today);
      await calendar(db, owner, clock).createEvent({ title, day: at.day, time: at.time });
      const where = `${spokenDay(at.day, today)}${at.time ? ` at ${spokenTime(at.time)}` : ''}`;
      return `Reminder added for ${where}: ${title}.`;
    },
  };
}
