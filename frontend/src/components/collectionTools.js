/**
 * The small rules the collection page follows: how titles are put in order, how money is read and shown, what a
 * set of titles cost and are worth, and when a typed name is one you already have.
 *
 * Pages cannot import from core/, so these are copies of the functions of the same names in core/src/media.ts,
 * where they are tested. core/tests/enjoying.test.ts loads this file and checks both give the same answers:
 * change one and the other has to change with it. This file imports nothing, so that test can load it alone.
 */

export const labelKey = (name) => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** A title as it is put in order: without a leading "The", "A" or "An". Only for sorting, never for showing. */
export function sortWords(title) {
  return labelKey(title).replace(/^(the|an|a)\s+(?=\S)/, '');
}

export const MAX_CENTS = 1_000_000_000;

/** Dollars as typed ("12.99", "$1,200", "5") in cents, or null when it isn't an amount with at most two decimals. */
export function centsFromDollars(text) {
  const t = String(text ?? '').trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, part = ''] = t.split('.');
  const cents = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** Cents as dollars with two decimals: 123456 is "$1,234.56". */
export function dollarsText(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(abs % 100).padStart(2, '0')}`;
}

/** Cents as the plain number a price field holds: 1299 is "12.99". */
export const dollarsField = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

export const SORTS = [
  ['title', 'Title, A to Z'], ['creator', 'Creator, A to Z'], ['year', 'Year, newest first'],
  ['added', 'Recently added'], ['recent', 'Recently watched, read or played'], ['value', 'Value, highest first'], ['rating', 'My rating, highest first'],
];

const inOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The titles in the order chosen. Ties fall back to title, then year, then id. Nothing is changed in the titles. */
export function sortTitles(titles, how) {
  const byTitle = (a, b) => inOrder(sortWords(a.title), sortWords(b.title)) || (a.year ?? 0) - (b.year ?? 0) || a.id - b.id;
  // Missing values always come last, whichever way the rest runs.
  const by = (value, down) => (a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return byTitle(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (down ? -1 : 1) || byTitle(a, b);
  };
  const compare = {
    title: byTitle,
    creator: by((t) => (t.creator ? sortWords(t.creator) : null), false),
    year: by((t) => t.year ?? null, true),
    added: by((t) => t.added_at ?? null, true),
    recent: by((t) => t.last_on ?? null, true),
    value: by((t) => t.worth_cents ?? null, true),
    rating: by((t) => t.stars ?? null, true),
  }[how] ?? byTitle;
  return [...titles].sort(compare);
}

/** What a set of titles cost and are worth, in cents; `unvalued` counts the copies with neither a cost nor a value. */
export function collectionTotals(titles) {
  const total = { titles: titles.length, copies: 0, cost_cents: 0, worth_cents: 0, unvalued: 0, difference_cents: 0 };
  for (const t of titles) {
    total.copies += t.copy_count ?? 0;
    total.cost_cents += t.cost_cents ?? 0;
    total.worth_cents += t.worth_cents ?? 0;
    total.unvalued += t.unvalued ?? 0;
    total.difference_cents += t.gain_cents ?? 0;
  }
  return total;
}

/** The titles of this type that have the typed name (case and spacing don't matter). */
export function sameTitles(titles, type, typed) {
  const key = labelKey(typed);
  return key ? titles.filter((t) => t.type === type && labelKey(t.title) === key) : [];
}

/** Half stars as plain text: 3.5 is "★★★½", 4 is "★★★★". Nothing for no rating. */
export function starsText(stars) {
  if (stars == null) return '';
  const whole = Math.floor(stars);
  return '★'.repeat(whole) + (stars - whole >= 0.5 ? '½' : '');
}

/** What the rating choices say: "Not rated", "½ star", "1 star", "1½ stars" ... "5 stars". Value is the number of stars, or '' for none. */
export const STAR_CHOICES = [['', 'Not rated'], ...Array.from({ length: 10 }, (_, i) => {
  const v = (i + 1) / 2;
  const whole = Math.floor(v);
  const words = `${whole === 0 ? '' : whole}${v % 1 ? '½' : ''}`;
  return [String(v), `${words} ${v <= 1 ? 'star' : 'stars'}`];
})];

/** The decade a year is in, as 1980. */
export const decadeOf = (year) => Math.floor(year / 10) * 10;
