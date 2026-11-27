/**
 * A statement from a bank or card, brought in as spending.
 *
 * Life Is never connects to a bank and never asks for a login. The person downloads the CSV their bank or card
 * offers on its own website, chooses it (or pastes it) here, and it is read on their own Life Is. It is looked
 * over first; the lines they keep become entries in the month each one fell in. Nothing is sent anywhere.
 *
 * What banks export varies a great deal, so this reads by what the columns are called, not where they are:
 *   - A summary block above the table is passed over; the table starts at the first row that names a date
 *     column and an amount column (Date, Posting Date, Transaction Date; Amount, or Debit and Credit).
 *   - The sign differs. Checking exports write spending as negative; many cards write purchases as positive and
 *     payments as negative. Separate Debit and Credit columns say it outright; so does a Type column (DEBIT,
 *     Sale, Payment, Return) or a trailing CR/DR. Failing those, the commoner sign is taken to be spending, and
 *     `spending_is` says which, so the person can flip it.
 *   - Dates as 03/05/2046, 3/5/46, 2046-03-05 or Mar 5, 2046. Amounts with $, thousands commas, a minus,
 *     (parentheses) or a trailing CR/DR.
 * OFX/QFX files are not read: the CSV version of the same download is.
 *
 * A line already written down (same day, same amount, same label) is never added twice, so the same statement
 * can be brought in again, or one that overlaps it. That lives in money.ts, beside the other ways of adding an entry.
 */
import { csvRows } from './bookList.ts';
import type { Db } from './db.ts';
import { money } from './money.ts';
import { Problem } from './problem.ts';
import { clean, dayOrNull, labelKey, type Clock } from './small.ts';

export type StatementRow = {
  day: string;
  label: string;
  /** Always above zero: how much it was, in whichever direction. */
  cents: number;
  /** Money spent, or money that came in (a deposit, a refund, a payment on a card). */
  kind: 'spent' | 'received';
  /** What the bank's own Category column said, when it had one. */
  hint: string | null;
};
export type Statement = {
  rows: StatementRow[];
  /**
   * Which sign means spending, when that was what decided it: 'negative' or 'positive'. null when the file
   * said so itself, in separate Debit and Credit columns.
   */
  spending_is: 'negative' | 'positive' | null;
  /** What decided which lines are spending: the columns, a Type column (or CR/DR), or the sign alone. */
  decided_by: 'columns' | 'type' | 'sign';
  /** True when the sign was assumed rather than stated, so it is worth the person's glance. */
  guessed: boolean;
  first_day: string;
  last_day: string;
  /** Lines in the table that weren't transactions (no date, or no amount) and were passed over. */
  skipped: number;
};
export type ReadOptions = { spending_is?: 'negative' | 'positive' | null };

const MAX_ROWS = 5000;
const MAX_CHARS = 5_000_000;

/** A header as it is compared: lower case, brackets and punctuation gone. */
const named = (cell: string | undefined) => labelKey((cell ?? '').replace(/\([^)]*\)/g, ' ')).replace(/[^a-z0-9]+/g, ' ').trim();

// What each column is called, in the order of preference.
const DATE = ['transaction date', 'trans date', 'date', 'posting date', 'post date', 'posted date', 'posted', 'settlement date', 'booking date', 'effective date'];
const LABEL = ['description', 'original description', 'transaction description', 'payee', 'merchant', 'merchant name', 'name'];
const MEMO = ['memo', 'notes', 'extended details'];
const AMOUNT = ['amount', 'transaction amount', 'amt'];
const DEBIT = ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'amount debit'];
const CREDIT = ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'amount credit'];
const KIND = ['type', 'transaction type', 'trans type', 'details', 'debit credit', 'dr cr', 'cr dr'];
const HINT = ['category', 'transaction category'];

const first = (heads: string[], names: string[]) => names.map((n) => heads.indexOf(n)).find((i) => i >= 0) ?? -1;

type Columns = { date: number; label: number; memo: number; amount: number; debit: number; credit: number; kind: number; hint: number };
function columnsOf(row: string[]): Columns | null {
  const heads = row.map(named);
  const found: Columns = {
    date: first(heads, DATE), label: first(heads, LABEL), memo: first(heads, MEMO), amount: first(heads, AMOUNT),
    debit: first(heads, DEBIT), credit: first(heads, CREDIT), kind: first(heads, KIND), hint: first(heads, HINT),
  };
  return found.date >= 0 && (found.amount >= 0 || found.debit >= 0 || found.credit >= 0) ? found : null;
}

/** A day however a bank wrote it. null when it isn't one. */
function dayOf(cell: string | undefined): string | null {
  const text = (cell ?? '').trim();
  const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D|$)/.exec(text);
  const mdy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?:\D|$)/.exec(text);
  const words = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\D|$)/.exec(text);
  let y: string | undefined;
  let m: string | undefined;
  let d: string | undefined;
  if (ymd) [, y, m, d] = ymd;
  else if (mdy) { [, m, d, y] = mdy; if (y!.length === 2) y = `20${y}`; } else if (words) {
    const at = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(words[1]!.toLowerCase());
    if (at < 0) return null;
    [, , d, y] = words; m = String(at + 1);
  } else return null;
  try { return dayOrNull(`${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`); } catch { return null; }
}

type Amount = { cents: number; negative: boolean; said: 'spent' | 'received' | null };
/** An amount however a bank wrote it: $1,234.50, -12.00, (12.00), 12.00-, 12.00 CR. null when it is no amount. */
function amountOf(cell: string | undefined): Amount | null {
  let text = (cell ?? '').trim().replace(/[−–]/g, '-');
  if (!text) return null;
  let said: Amount['said'] = null;
  const mark = /\s*(CR|DR)\.?$/i.exec(text);
  if (mark) { said = mark[1]!.toUpperCase() === 'CR' ? 'received' : 'spent'; text = text.slice(0, mark.index); }
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  text = text.replace(/[$\s,+]/g, '');
  if (text.startsWith('-')) { negative = !negative; text = text.slice(1); }
  if (text.endsWith('-')) { negative = !negative; text = text.slice(0, -1); }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Math.round(Number(text) * 100);
  return Number.isFinite(value) && value <= 100_000_000_00 ? { cents: value, negative, said } : null;
}

/** What a Type column says of a line, when it says. */
function saidBy(cell: string | undefined): 'spent' | 'received' | null {
  const words = (cell ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1 && words[0]!.length === 1) return words[0] === 'd' ? 'spent' : words[0] === 'c' ? 'received' : null;
  if (words.some((w) => ['debit', 'dr', 'sale', 'purchase', 'withdrawal', 'fee', 'charge', 'check', 'atm', 'pos'].includes(w))) return 'spent';
  if (words.some((w) => ['credit', 'cr', 'deposit', 'refund', 'return', 'payment', 'reversal', 'dividend', 'interest', 'rebate', 'cashback'].includes(w))) return 'received';
  return null;
}

/** The rows of a pasted table: commas as a bank saves it, or tabs as a spreadsheet copies it. */
function tableOf(text: string): string[][] {
  const head = text.replace(/^﻿/, '').split(/\r?\n/).slice(0, 8).join('\n');
  const tabs = (head.match(/\t/g) ?? []).length;
  if (tabs > (head.match(/,/g) ?? []).length) {
    return text.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1'))).filter((r) => r.some((c) => c));
  }
  return csvRows(text);
}

/** A statement, read. Refuses, in words a person can act on, what it can't make sense of. */
export function readStatement(text: string, options: ReadOptions = {}): Statement {
  if (typeof text !== 'string' || !text.trim()) throw new Problem(400, 'That is empty. Choose the CSV file you downloaded from your bank or card, or paste its lines.');
  if (text.length > MAX_CHARS) throw new Problem(400, 'That file is larger than 5 MB, which is more than a statement should be. Download a shorter stretch of time (a month or a year) and try again.');
  const start = text.replace(/^﻿/, '').trimStart();
  if (/^(OFXHEADER|<\?OFX|<OFX>)/i.test(start) || /^<\?xml[^]{0,400}<OFX>/i.test(start)) throw new Problem(400, 'That is a Quicken/OFX file. Download the CSV version from your bank instead.');
  const table = tableOf(text);
  let at = -1;
  let cols: Columns | null = null;
  for (const [i, row] of table.entries()) {
    cols = columnsOf(row);
    if (cols) { at = i; break; }
  }
  if (!cols) {
    throw new Problem(400, "No columns of a statement were found. Life Is looks for a heading line with a date (Date, Posting Date or Transaction Date) and an amount (Amount, or Debit and Credit). Check that this is the CSV from your bank's download or export, not a PDF or a summary.");
  }
  const lines = table.slice(at + 1);
  if (lines.length > MAX_ROWS) throw new Problem(400, `That has more than ${MAX_ROWS.toLocaleString('en-US')} lines. Download a shorter stretch of time (a month or a year) and import it as more than one.`);

  // Each line, as the file wrote it, before anyone decides which sign is spending.
  type Raw = { day: string; label: string; hint: string | null; amount: Amount; said: 'spent' | 'received' | null };
  const split = cols.debit >= 0 || cols.credit >= 0;
  const raw: Raw[] = [];
  let skipped = 0;
  for (const row of lines) {
    const day = dayOf(row[cols.date]);
    let amount: Amount | null;
    let said: Raw['said'] = null;
    if (split) {
      const out = cols.debit >= 0 ? amountOf(row[cols.debit]) : null;
      const inn = cols.credit >= 0 ? amountOf(row[cols.credit]) : null;
      if (out && out.cents > 0) { amount = out; said = 'spent'; } else if (inn && inn.cents > 0) { amount = inn; said = 'received'; } else amount = null;
    } else {
      amount = amountOf(row[cols.amount]);
      said = (amount?.said ?? null) ?? (cols.kind >= 0 ? saidBy(row[cols.kind]) : null);
    }
    if (!day || !amount || amount.cents === 0) { skipped += 1; continue; }
    const label = clean((row[cols.label] ?? '').replace(/\s+/g, ' '), 200) ?? clean((row[cols.memo] ?? '').replace(/\s+/g, ' '), 200) ?? '(no description)';
    raw.push({ day, label, hint: cols.hint >= 0 ? clean((row[cols.hint] ?? '').replace(/\s+/g, ' '), 80) : null, amount, said });
  }
  if (raw.length === 0) throw new Problem(400, 'The columns were there, but no line had both a date and an amount that could be read. Dates should look like 03/05/2046 or 2046-03-05.');

  // Which sign is spending, for the lines the file doesn't say outright: the commoner one.
  const negatives = raw.filter((r) => !r.said && r.amount.negative).length;
  const positives = raw.filter((r) => !r.said && !r.amount.negative).length;
  const assumed: 'negative' | 'positive' = negatives >= positives ? 'negative' : 'positive';
  const told = raw.filter((r) => r.said).length;
  const decided_by: Statement['decided_by'] = split ? 'columns' : told * 2 >= raw.length ? 'type' : 'sign';
  const chosen = options.spending_is === 'negative' || options.spending_is === 'positive' ? options.spending_is : null;
  const spending_is = split ? null : chosen ?? assumed;
  const rows: StatementRow[] = raw.map((r) => ({
    day: r.day, label: r.label, cents: r.amount.cents, hint: r.hint,
    kind: r.said ?? ((spending_is === 'negative') === r.amount.negative ? 'spent' : 'received'),
  }));
  const days = rows.map((r) => r.day).sort();
  return { rows, spending_is, decided_by, guessed: decided_by !== 'columns' && !chosen && told !== raw.length, first_day: days[0]!, last_day: days[days.length - 1]!, skipped };
}

export type LookedOver = Omit<Statement, 'rows'> & {
  rows: (StatementRow & { already: boolean; suggested_category_id: number | null })[];
  spent_cents: number;
  received_cents: number;
  already: number;
};

/** A read statement set beside what is already written down: which lines are already there, and what category each might go in. */
export async function lookOverStatement(db: Db, owner: number, clock: Clock, statement: Statement): Promise<LookedOver> {
  const marks = await money(db, owner, clock).lookOver(statement.rows);
  const rows = statement.rows.map((r, i) => ({ ...r, already: marks[i]!.already, suggested_category_id: marks[i]!.suggested }));
  return {
    ...statement, rows,
    spent_cents: rows.filter((r) => r.kind === 'spent').reduce((sum, r) => sum + r.cents, 0),
    received_cents: rows.filter((r) => r.kind === 'received').reduce((sum, r) => sum + r.cents, 0),
    already: rows.filter((r) => r.already).length,
  };
}

export type StatementChoices = {
  /** The lines to bring in, by their place in the statement (0 is the first). Left out: every line of money spent. */
  keep?: number[];
  /** A category for a line, by its place: a category's id, or null for none. A line not mentioned gets `suggest`'s answer. */
  categories?: Record<string, number | null>;
  /** Lines with no category named go in the one an earlier entry with the same label was in. On unless said otherwise. */
  suggest?: boolean;
};
export type StatementResult = { listed: number; added: number; already: number; left_out: number; months: { month: string; added: number }[] };

/**
 * Bring a read statement in. One change: a statement that can't all be brought in changes nothing. A line already
 * written down is skipped, a line not kept is left out, and `listed = added + already + left_out`.
 */
export async function importStatement(db: Db, owner: number, clock: Clock, rows: StatementRow[], choices: StatementChoices = {}): Promise<StatementResult> {
  const keep = new Set(choices.keep ?? rows.flatMap((r, i) => (r.kind === 'spent' ? [i] : [])));
  const suggest = choices.suggest !== false;
  const items = rows.map((r, i) => {
    const named = choices.categories && Object.hasOwn(choices.categories, String(i)) ? choices.categories[String(i)] ?? null : undefined;
    return { label: r.label, cents: r.cents, day: r.day, keep: keep.has(i), category_id: named === undefined && !suggest ? null : named };
  });
  const done = await money(db, owner, clock).bringIn(items);
  return { listed: rows.length, ...done };
}
