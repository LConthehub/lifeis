/**
 * What a person wants Life Is to look after.
 *
 * Asked once, the first time they sign in, and theirs to change whenever they like. Their answer does two
 * things: it decides which sections show ("eating", "planning", "keeping", "making", "enjoying"), and for the
 * things they make and do
 * (sewing, the garden) it adds the ready-made kinds of things to start from.
 *
 * Nothing is ever taken away by unticking: a section is only put out of sight, and what is in it stays.
 * Until the question is answered, and if it is skipped, everything shows.
 */
import type { Db } from './db.ts';
import { inventory } from './inventory.ts';
import { Problem } from './problem.ts';
import type { Clock } from './small.ts';
import { STARTERS } from './starters.ts';

export const SECTIONS = ['eating', 'planning', 'keeping', 'making', 'enjoying'] as const;
export type Section = (typeof SECTIONS)[number];

export type Area = {
  key: string;
  label: string;
  about: string;
  group: 'home' | 'doing';
  /** The sections this area needs showing. */
  sections: Section[];
  /** The ready-made set of kinds it adds (starters.ts), if any. */
  starter?: string;
};

const doing = (slug: string): Area => {
  const starter = STARTERS.find((one) => one.slug === slug)!;
  return { key: slug, label: starter.name, about: starter.about, group: 'doing', sections: ['keeping', 'making'], starter: slug };
};

export const AREAS: Area[] = [
  { key: 'eating', label: 'Cooking and groceries', about: 'Recipes, the week’s meals, the pantry and the grocery list.', group: 'home', sections: ['eating'] },
  { key: 'keeping', label: 'What we own and where it is', about: 'Anything you keep, in kinds of your own, by room, shelf and bin.', group: 'home', sections: ['keeping'] },
  { key: 'making', label: 'Projects', about: 'Anything made or done over more than a day, what it uses, and the time on it.', group: 'home', sections: ['making'] },
  { key: 'planning', label: 'The calendar', about: 'Your own dates, with the week’s meals and the time on projects alongside.', group: 'home', sections: ['planning'] },
  { key: 'enjoying', label: 'Films, shows, music, books and games', about: 'What you own on every format, where it is, and what you’ve watched, read or heard.', group: 'home', sections: ['enjoying'] },
  ...['sewing', 'knitting', 'woodworking', 'gardening', 'home'].map(doing),
];

export type LifeProfile = {
  /** What the person ticked. Null: they haven't been asked yet. */
  areas: string[] | null;
  /** The sections to show, in order. */
  sections: Section[];
  options: Pick<Area, 'key' | 'label' | 'about' | 'group'>[];
};

const SETTING = 'life_areas';

/** The sections a set of ticks shows. Nothing ticked (not asked, or skipped) shows everything. */
export function sectionsFor(areas: string[] | null): Section[] {
  if (!areas || areas.length === 0) return [...SECTIONS];
  const wanted = new Set(AREAS.filter((area) => areas.includes(area.key)).flatMap((area) => area.sections));
  return SECTIONS.filter((section) => wanted.has(section));
}

export function life(db: Db, owner: number, clock: Clock = () => new Date()) {
  async function stored(): Promise<string[] | null> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    if (!row?.value) return null;
    try {
      const areas: unknown = JSON.parse(row.value);
      return Array.isArray(areas) ? areas.filter((key): key is string => AREAS.some((area) => area.key === key)) : null;
    } catch {
      return null;
    }
  }

  const profile = (areas: string[] | null): LifeProfile => ({
    areas, sections: sectionsFor(areas), options: AREAS.map(({ key, label, about, group }) => ({ key, label, about, group })),
  });

  return {
    async getProfile(): Promise<LifeProfile> {
      return profile(await stored());
    },

    /**
     * Save what the person ticked (an empty list: "skip, show me everything"). Adds the ready-made kinds for
     * each thing they make and do, leaving alone any kind they already have, and says which kinds were added.
     */
    async saveProfile(ticked: string[]): Promise<LifeProfile & { added: string[] }> {
      const unknown = ticked.find((key) => !AREAS.some((area) => area.key === key));
      if (unknown !== undefined) throw new Problem(400, "One of those isn't something Life Is looks after");
      const areas = AREAS.filter((area) => ticked.includes(area.key));
      const things = inventory(db, owner, clock);
      const before = new Set((await things.listKinds()).map((kind) => kind.id));
      let kinds = null;
      for (const area of areas) if (area.starter) kinds = await things.addStarter(area.starter);
      const keys = areas.map((area) => area.key);
      await db.run(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, SETTING, JSON.stringify(keys)]);
      return { ...profile(keys), added: (kinds ?? []).filter((kind) => !before.has(kind.id)).map((kind) => kind.name) };
    },
  };
}

export type Life = ReturnType<typeof life>;
