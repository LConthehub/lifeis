/**
 * Reading a receipt, from the words a photo of it was read into. Pure: text in, lines out. Nothing here looks anything up.
 *
 * A receipt has lines for things (a name and a price), lines for savings (Costco's INSTANT SAVINGS and TPD, a coupon, a
 * card discount, or just a negative amount) that belong to the thing above them, and a subtotal, tax and total. The reader finds
 * each, ties a saving to its item (by the item's number when the saving gives one, else to the line just above it), and says
 * whether the things, less the savings, come to the subtotal. A photo is read imperfectly, so everything it finds is only a
 * first guess for the person to check.
 *
 * Money is whole cents.
 */
import { clean, labelKey } from './small.ts';

export type ReceiptItem = {
  /** The name as the receipt prints it, without the item number or flags. */
  text: string;
  /** The item number, when the line has one (Costco prints one). */
  code: string | null;
  /** The full price printed on the line. */
  cents: number;
  /** What the savings under it came to; 0 when none. */
  saved_cents: number;
  /** What the savings lines said, for the person to see. */
  saving_notes: string[];
  quantity: number | null;
};
export type Receipt = {
  store: string | null;
  /** 2046-03-05 */
  day: string | null;
  items: ReceiptItem[];
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  /** What the receipt says in all was saved ("YOU SAVED 9.50"), when it says. */
  said_saved_cents: number | null;
  /** Savings found with no item to tie them to. */
  loose_saved_cents: number;
  /** True when the things, less their savings, come to the subtotal (within a few cents). Null when there is no subtotal. */
  adds_up: boolean | null;
};

const STORES: [RegExp, string][] = [
  [/costco/i, 'Costco'], [/kroger/i, 'Kroger'], [/\baldi\b/i, 'Aldi'], [/walmart|wal-mart/i, 'Walmart'], [/\btarget\b/i, 'Target'], [/safeway/i, 'Safeway'],
  [/publix/i, 'Publix'], [/trader joe/i, 'Trader Joe\'s'], [/whole foods/i, 'Whole Foods'], [/meijer/i, 'Meijer'], [/sam'?s club/i, 'Sam\'s Club'],
  [/albertsons/i, 'Albertsons'], [/\bh-?e-?b\b/i, 'H-E-B'], [/wegmans/i, 'Wegmans'], [/\blidl\b/i, 'Lidl'], [/food lion/i, 'Food Lion'], [/giant eagle/i, 'Giant Eagle'],
];

/** "4.00", "4,00", "$4.00", "4.00-", "-4.00", "(4.00)": the cents, and whether it was marked as a taking-off. */
function amountAt(text: string): { cents: number; negative: boolean; start: number } | null {
  const m = /(-)?\s*\$?\s*(\d{1,5})[.,](\d{2})\s*(-|CR)?(?=\s*[A-Za-z]{0,2}\s*$)/.exec(text);
  if (!m) return null;
  return { cents: Number(m[2]) * 100 + Number(m[3]), negative: Boolean(m[1] || m[4]), start: m.index };
}

const SAVING_WORDS = /instant\s*sav|\btpd\b|sav(?:ing|ed|e)s?\b|coupon|discount|\bmfr\b|manuf|club\s*special|e-?coupon|digital|rebate|\bdisc\b|\boff\b|markdown|\bsale\b/i;
const SAID_SAVED = /you\s*saved|total\s*sav|savings\s*total|sav(?:ings)?\s*today|total\s*discount/i;
const NOT_ITEMS = /\b(sub\s*-?\s*total|total|tax|balance|amount|change|cash|visa|master\s*card|mastercard|debit|credit|amex|discover|tend(?:er|ered)?|payment|approved|auth|ref|card|account|member|items?\s*sold|number of items|points|reward|fuel|gas)\b/i;

const dayOf = (text: string): string | null => {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  if (us) {
    const month = Number(us[1]);
    const date = Number(us[2]);
    const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    if (month >= 1 && month <= 12 && date >= 1 && date <= 31 && year >= 2000 && year <= 2099) return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  }
  return null;
};

/** Read the lines of a receipt. */
export function readReceipt(text: string): Receipt {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/[|_~]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const receipt: Receipt = { store: null, day: null, items: [], subtotal_cents: null, tax_cents: null, total_cents: null, said_saved_cents: null, loose_saved_cents: 0, adds_up: null };
  for (const line of lines.slice(0, 12)) {
    const found = STORES.find(([pattern]) => pattern.test(line));
    if (found) { receipt.store = found[1]; break; }
  }
  for (const line of lines) {
    const d = dayOf(line);
    if (d) { receipt.day = d; break; }
  }
  let pendingName: string | null = null;
  let tax = 0;
  let sawTax = false;
  for (const line of lines) {
    const amount = amountAt(line);
    const lower = line.toLowerCase();
    if (!amount) {
      // A name on a line of its own, its price on the weighed line that follows ("BANANAS" then "1.52 lb @ 0.59/lb 0.90").
      pendingName = /[a-z]{3}/i.test(line) && !NOT_ITEMS.test(line) && !/^\d/.test(line) && !SAVING_WORDS.test(line) ? line : null;
      continue;
    }
    if (SAID_SAVED.test(line)) { receipt.said_saved_cents = amount.cents; pendingName = null; continue; }
    if (/\bsub\s*-?\s*total\b/i.test(line)) { receipt.subtotal_cents = amount.cents; pendingName = null; continue; }
    if (/\btax\b/i.test(line) && !/\btaxable\b/i.test(line)) { tax += amount.cents; sawTax = true; pendingName = null; continue; }
    if (/\b(total|balance|amount due|grand total)\b/i.test(line) && !/items?|number|saving|saved|discount/i.test(line)) {
      if (receipt.total_cents === null) receipt.total_cents = amount.cents;
      pendingName = null;
      continue;
    }
    // A saving: it says so, or the amount is marked as taken off. It goes to the item it names (Costco: "1234567 /987654"), else the one above.
    const saving = amount.negative || (SAVING_WORDS.test(line) && !/\d\s*(?:lb|oz|kg|ct)\b/i.test(line) && !/\b\d+\s*@\s*\d/.test(line));
    if (saving) {
      const named = /(\d{4,8})\s*\/\s*(\d{4,8})/.exec(line) ?? /\/\s*(\d{4,8})/.exec(line);
      const refers = named ? named[named.length - 1]! : null;
      const target = (refers ? receipt.items.find((i) => i.code === refers) : undefined) ?? receipt.items[receipt.items.length - 1];
      const label = clean(line.slice(0, amount.start).replace(/\d{4,8}\s*\/?\s*\d{0,8}/g, ' ').replace(/\s+/g, ' '), 60);
      if (target) { target.saved_cents += amount.cents; if (label) target.saving_notes.push(label); } else receipt.loose_saved_cents += amount.cents;
      pendingName = null;
      continue;
    }
    if (NOT_ITEMS.test(line) && !/\d{4,8}\s+[a-z]/i.test(line)) { pendingName = null; continue; }
    // The quantity or weight line: no name of its own; it belongs to the name before it, or sets how many the item above was.
    const weigh = /^\s*(\d+(?:\.\d+)?)\s*(lb|lbs|oz|kg|g|ea|ct)?\s*(?:@|x|at)\s*\$?\s*(\d+[.,]?\d*)/i.exec(line);
    const body = line.slice(0, amount.start).trim();
    if (weigh && !/[a-z]{4,}/i.test(body.replace(/lbs?|oz|each|ea\b|@|\/lb|\/oz|\/kg|at\b/gi, ''))) {
      if (pendingName) {
        // "2 @ 1.99" prints the one price; the line came to two of them.
        const each = Math.round(Number(weigh[3]!.replace(',', '.')) * 100);
        const cents = !weigh[2] && Number(weigh[1]) > 1 && amount.cents === each ? Math.round(Number(weigh[1]) * each) : amount.cents;
        receipt.items.push({ text: tidyName(pendingName), code: null, cents, saved_cents: 0, saving_notes: [], quantity: Number(weigh[1]) });
        pendingName = null;
      } else if (receipt.items.length > 0 && !weigh[2]) receipt.items[receipt.items.length - 1]!.quantity = Number(weigh[1]);
      continue;
    }
    // A thing: an optional flag letter and item number, the name, the price, an optional tax flag.
    const m = /^(?:[A-Z]\s+)?(\d{4,8})?\s*(.*?)$/.exec(body);
    const name = tidyName(m?.[2] ?? body);
    if (!/[a-z]{2}/i.test(name)) { pendingName = null; continue; }
    receipt.items.push({ text: name, code: m?.[1] ?? null, cents: amount.cents, saved_cents: 0, saving_notes: [], quantity: null });
    pendingName = null;
  }
  receipt.tax_cents = sawTax ? tax : null;
  if (receipt.subtotal_cents !== null) {
    const sum = receipt.items.reduce((n, i) => n + i.cents - i.saved_cents, 0) - receipt.loose_saved_cents;
    receipt.adds_up = Math.abs(sum - receipt.subtotal_cents) <= 3;
  }
  return receipt;
}

function tidyName(text: string): string {
  return text.replace(/^[A-Z]\s+(?=\d)/, '').replace(/^\d{4,8}\s+/, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- matching to the list

const NOISE = new Set(['org', 'organic', 'ks', 'kirkland', 'signature', 'the', 'of', 'and', 'with', 'for', 'fresh', 'lg', 'sm', 'pk', 'ct', 'ea', 'oz', 'lb', 'lbs', 'gal', 'pkg', 'bag', 'box', 'can', 'jar', 'brand', 'store', 'value']);
const words = (text: string): string[] => labelKey(text).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w) && !NOISE.has(w));
const stem = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('es') && /(ch|sh|x|s|o)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const alike = (a: string, b: string) => { const x = stem(a); const y = stem(b); return x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))); };

/** How well one name fits another, 0 to 1: how many of the shorter name's words are in the longer one, a little less when most of the longer is left over. */
export function likeness(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const hit = short.filter((w) => long.some((v) => alike(w, v))).length;
  if (hit < short.length) return 0;
  return 0.6 + 0.4 * (short.length / long.length);
}
/** Whether two names are the same thing. */
export const sameThing = (a: string, b: string) => likeness(a, b) > 0;

export type Tie = { index: number; id: number | null; score: number };
/** Which line of the list each receipt item is, if any. A line is tied to one item only: the one it fits best. */
export function tieToList(items: { text: string }[], lines: { id: number; label: string }[]): Tie[] {
  const pairs: { index: number; id: number; score: number }[] = [];
  items.forEach((item, index) => { for (const l of lines) { const score = likeness(item.text, l.label); if (score > 0) pairs.push({ index, id: l.id, score }); } });
  pairs.sort((p, q) => q.score - p.score || p.index - q.index);
  const taken = new Set<number>();
  const used = new Set<number>();
  const result: Tie[] = items.map((_, index) => ({ index, id: null, score: 0 }));
  for (const p of pairs) {
    if (taken.has(p.index) || used.has(p.id)) continue;
    taken.add(p.index);
    used.add(p.id);
    result[p.index] = p;
  }
  return result;
}

// ---------------------------------------------------------------- the savings book, typed

export type BookLine = { item: string; cents_off: number | null; percent_off: number | null };
/**
 * A store's savings book typed in quickly, one thing to a line: "Coffee 4.00", "Eggs $1 off", "Cereal 20%". A line with no amount is
 * left out and listed in `skipped`.
 */
export function readBook(text: string): { lines: BookLine[]; skipped: string[] } {
  const lines: BookLine[] = [];
  const skipped: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const pct = /^(.*?)[\s:,-]+(\d{1,3}(?:\.\d+)?)\s*%(?:\s*off)?$/i.exec(line);
    const money = /^(.*?)[\s:,-]+\$?\s*(\d{1,4})(?:[.,](\d{1,2}))?(?:\s*(?:off|dollars?))?$/i.exec(line);
    const cleanItem = (t: string) => clean(t.replace(/[\s:,-]+$/, ''), 120);
    if (pct && cleanItem(pct[1]!) && Number(pct[2]) > 0 && Number(pct[2]) <= 100) lines.push({ item: cleanItem(pct[1]!)!, cents_off: null, percent_off: Number(pct[2]) });
    else if (money && cleanItem(money[1]!) && /[a-z]/i.test(money[1]!)) {
      const cents = Number(money[2]) * 100 + (money[3] ? Number(money[3].padEnd(2, '0')) : 0);
      if (cents > 0) lines.push({ item: cleanItem(money[1]!)!, cents_off: cents, percent_off: null }); else skipped.push(line);
    } else skipped.push(line);
  }
  return { lines, skipped };
}

// ---------------------------------------------------------------- saying savings in words

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const asMoney = (sign: string, cents: number) => `${sign}${cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)}`;
const inWords = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** "$4 off in March, July and November": when a thing was on savings, grouped by how much. Oldest first; the year is added when more than one is spanned. */
export function savingsSentence(sign: string, times: { day: string; cents: number }[]): string {
  if (times.length === 0) return '';
  const years = new Set(times.map((t) => t.day.slice(0, 4)));
  const by = new Map<number, string[]>();
  for (const t of [...times].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    const when = `${MONTHS[Number(t.day.slice(5, 7)) - 1]}${years.size > 1 ? ` ${t.day.slice(0, 4)}` : ''}`;
    const list = by.get(t.cents) ?? by.set(t.cents, []).get(t.cents)!;
    if (!list.includes(when)) list.push(when);
  }
  return [...by.entries()].map(([cents, months]) => `${asMoney(sign, cents)} off in ${inWords(months)}`).join('; ');
}
