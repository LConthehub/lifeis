/** Small things every section needs: the time, days, and tidying what was typed. */
import { Problem } from './problem.ts';
import { cut } from './recipeText.ts';

/** What time it is. The tests give their own. */
export type Clock = () => Date;

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The moment, as the database keeps it: 2046-03-05T18:30:00+00:00. */
export const stamp = (at: Date) => at.toISOString().slice(0, 19) + '+00:00';

/** The day where the person is, as 2046-03-05. */
export const localDay = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** A day as a count of days, so two can be taken apart. Refuses anything that isn't a real day. */
export function dayNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const at = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== day) throw new Problem(400, 'A day is written like 2046-03-05');
  return at / DAY;
}

export const addDays = (day: string, days: number) => new Date((dayNumber(day) + days) * DAY).toISOString().slice(0, 10);

/** A day that was given, checked; or null when none was. */
export function dayOrNull(day: string | null | undefined): string | null {
  if (!day) return null;
  dayNumber(day);
  return day;
}

/** What was typed, without the space around it and no longer than `limit`; null when nothing is left. */
export const clean = (text: string | null | undefined, limit = 2000) => cut((text ?? '').trim(), limit) || null;

export const rounded = (n: number, places: number) => Number(n.toFixed(places));
export const inOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The form of a name used to tell whether two are the same: "Fabric", " fabric " and "FABRIC" are. Unlike an
 * ingredient's key, this keeps every alphabet as it is.
 */
export const labelKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
