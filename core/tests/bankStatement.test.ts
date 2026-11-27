/** A statement downloaded from a bank or card, read on the device and brought in as spending. */
import { beforeEach, expect, it } from 'vitest';
import { importStatement, lookOverStatement, readStatement } from '../src/bankStatement.ts';
import { decide, accessNow } from '../src/access.ts';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { memoryDb } from './memoryDb.ts';

// A checking account: a summary above the table, spending written as negative.
const CHECKING = `Description,,Summary Amt.
Beginning balance as of 03/01/2046,,"2,500.00"
Total credits,,"3,000.00"
Total debits,,"-1,102.40"
Ending balance as of 03/31/2046,,"4,397.60"

Date,Description,Amount,Running Bal.
03/01/2046,"Beginning balance",,"2,500.00"
03/02/2046,"WHOLE FOODS #123   AUSTIN TX","-82.40","2,417.60"
03/03/2046,"ACME PAYROLL, INC DIRECT DEP","3,000.00","5,417.60"
03/04/2046,"Hardware, Paint & Co","-1,020.00","4,397.60"
`;
// A card: purchases positive, the payment negative, with the bank's own category.
const CARD = `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
03/05/2046,03/06/2046,KROGER   FUEL,Gas,Sale,-45.10,
03/06/2046,03/07/2046,AMAZON MKTPLACE,Shopping,Sale,-19.99,
03/09/2046,03/09/2046,Payment Thank You,,Payment,200.00,
03/10/2046,03/11/2046,AMAZON MKTPLACE,Shopping,Return,5.00,
`;
const CARD_PLAIN = `Date,Description,Amount
3/5/46,Kroger,45.10
3/6/46,Amazon,19.99
3/7/46,Coffee,4.50
3/9/46,"Payment, thank you",-200.00
`;
// Capital One style: separate Debit and Credit columns.
const SPLIT = `Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2046-03-02,2046-03-03,1234,Trader Joe's,Groceries,31.20,
2046-03-04,2046-03-05,1234,PAYMENT RECEIVED,Payment,,100.00
2046-03-06,2046-03-07,1234,Pharmacy,Health,"1,234.56",
`;
// A Type column and parentheses for negatives, with CR on a refund.
const TYPED = `Posting Date,Payee,Transaction Type,Amount
03/02/2046,Water Utility,DEBIT,($64.00)
03/03/2046,Employer,CREDIT,"$1,500.00"
03/04/2046,Shoe Store,DEBIT,($89.99)
`;

let db: Db;
let ana: number;
let ben: number;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 15, 10, 0, 0)), { today: () => '2046-03-15' });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
});

it('reads a checking export under a summary block: negative is spending, quoted commas stay in the label', () => {
  const s = readStatement(CHECKING);
  expect(s).toMatchObject({ spending_is: 'negative', decided_by: 'sign', guessed: true, first_day: '2046-03-02', last_day: '2046-03-04', skipped: 1 });
  expect(s.rows).toEqual([
    { day: '2046-03-02', label: 'WHOLE FOODS #123 AUSTIN TX', cents: 8240, kind: 'spent', hint: null },
    { day: '2046-03-03', label: 'ACME PAYROLL, INC DIRECT DEP', cents: 300000, kind: 'received', hint: null },
    { day: '2046-03-04', label: 'Hardware, Paint & Co', cents: 102000, kind: 'spent', hint: null },
  ]);
});

it('reads a card export where the Type says what is what, keeping the bank\'s category as a hint', () => {
  const s = readStatement(CARD);
  expect(s.decided_by).toBe('type');
  expect(s.rows.map((r) => [r.label, r.cents, r.kind, r.hint])).toEqual([
    ['KROGER FUEL', 4510, 'spent', 'Gas'], ['AMAZON MKTPLACE', 1999, 'spent', 'Shopping'], ['Payment Thank You', 20000, 'received', null], ['AMAZON MKTPLACE', 500, 'received', 'Shopping'],
  ]);
});

it('a card with positive purchases and no Type: the commoner sign is spending, and it can be flipped', () => {
  const s = readStatement(CARD_PLAIN);
  expect([s.spending_is, s.guessed]).toEqual(['positive', true]);
  expect(s.rows.map((r) => [r.day, r.kind])).toEqual([['2046-03-05', 'spent'], ['2046-03-06', 'spent'], ['2046-03-07', 'spent'], ['2046-03-09', 'received']]);
  const flipped = readStatement(CARD_PLAIN, { spending_is: 'negative' });
  expect([flipped.spending_is, flipped.guessed]).toEqual(['negative', false]);
  expect(flipped.rows.map((r) => r.kind)).toEqual(['received', 'received', 'received', 'spent']);
});

it('separate Debit and Credit columns say which is which, with thousands commas', () => {
  const s = readStatement(SPLIT);
  expect([s.decided_by, s.spending_is, s.guessed]).toEqual(['columns', null, false]);
  expect(s.rows.map((r) => [r.label, r.cents, r.kind, r.hint])).toEqual([
    ["Trader Joe's", 3120, 'spent', 'Groceries'], ['PAYMENT RECEIVED', 10000, 'received', 'Payment'], ['Pharmacy', 123456, 'spent', 'Health'],
  ]);
  // Flipping a file that states it changes nothing.
  expect(readStatement(SPLIT, { spending_is: 'positive' }).rows.map((r) => r.kind)).toEqual(['spent', 'received', 'spent']);
});

it('a Type column with parentheses for negatives, dollar signs and CR/DR', () => {
  const s = readStatement(TYPED);
  expect(s.decided_by).toBe('type');
  expect(s.rows.map((r) => [r.label, r.cents, r.kind])).toEqual([['Water Utility', 6400, 'spent'], ['Employer', 150000, 'received'], ['Shoe Store', 8999, 'spent']]);
  const marked = readStatement('Date,Description,Amount\n03/02/2046,Shop,12.50 DR\n03/03/2046,Refund,12.50 CR\n');
  expect(marked.rows.map((r) => [r.cents, r.kind])).toEqual([[1250, 'spent'], [1250, 'received']]);
  expect(readStatement('Date,Description,Amount\n03/02/2046,Shop,12.50-\n03/03/2046,Pay,100.00\n').rows.map((r) => r.kind)).toEqual(['spent', 'received']);
});

it('reads a table pasted from a spreadsheet, tab by tab, and days written as words', () => {
  const s = readStatement('Date\tDescription\tAmount\nMar 5, 2046\tLunch   out\t-12.30\n');
  expect(s.rows).toEqual([{ day: '2046-03-05', label: 'Lunch out', cents: 1230, kind: 'spent', hint: null }]);
});

it('refuses plainly: nothing there, no columns, OFX, too much', () => {
  expect(() => readStatement('   \n')).toThrow(/empty/);
  expect(() => readStatement('Name,Phone\nAna,555')).toThrow(/No columns of a statement/);
  expect(() => readStatement('Date,Description,Amount\nnot a day,Shop,12.00')).toThrow(/no line had both a date and an amount/);
  expect(() => readStatement('OFXHEADER:100\nDATA:OFXSGML\n<OFX>\n</OFX>')).toThrow('That is a Quicken/OFX file. Download the CSV version from your bank instead.');
  expect(() => readStatement('<OFX><BANKMSGSRSV1/></OFX>')).toThrow(/Quicken\/OFX/);
  expect(() => readStatement(`Date,Description,Amount\n${'03/02/2046,Shop,-1.00\n'.repeat(5001)}`)).toThrow(/more than 5,000 lines/);
  expect(() => readStatement(`Date,Description,Amount\n${'x'.repeat(5_000_001)}`)).toThrow(/larger than 5 MB/);
  expect(() => readStatement(`Date,Description,Amount\n${'03/02/2046,Shop,-1.00\n'.repeat(5000)}`)).not.toThrow();
});

it('bringing the same statement in twice adds nothing the second time, and entries land in their own month', async () => {
  const groceries = await money(db, ana, clock).addCategory({ name: 'Groceries', monthly_cents: 50000 });
  const s = readStatement(`Date,Description,Amount\n02/27/2046,Corner Store,-8.00\n03/02/2046,Market,-20.00\n03/02/2046,Pay,500.00\n`);
  const first = await importStatement(db, ana, clock, s.rows, { categories: { 0: groceries.id } });
  expect(first).toEqual({ listed: 3, added: 2, already: 0, left_out: 1, months: [{ month: '2046-02', added: 1 }, { month: '2046-03', added: 1 }] });
  const march = await money(db, ana, clock).month('2046-03');
  expect(march.entries.map((e) => [e.label, e.cents, e.category])).toEqual([['Market', 2000, null]]);
  expect((await money(db, ana, clock).month('2046-02')).categories[0]!.spent).toBe(800);
  const again = await importStatement(db, ana, clock, s.rows, { categories: { 0: groceries.id } });
  expect(again).toEqual({ listed: 3, added: 0, already: 2, left_out: 1, months: [] });
  expect((await money(db, ana, clock).month('2046-03')).entries).toHaveLength(1);
  // The look-over says the same before anything is written.
  const looked = await lookOverStatement(db, ana, clock, s);
  expect([looked.already, looked.spent_cents, looked.received_cents, looked.rows.map((r) => r.already)]).toEqual([2, 2800, 50000, [true, true, false]]);
});

it('a day entered by hand is not added again, and two real purchases that look alike both come in', async () => {
  await money(db, ana, clock).addEntry({ label: '  market ', cents: 2000, day: '2046-03-02' });
  const s = readStatement('Date,Description,Amount\n03/02/2046,MARKET,-20.00\n03/02/2046,Market,-20.00\n03/03/2046,Market,-20.00\n');
  expect(await importStatement(db, ana, clock, s.rows)).toMatchObject({ added: 2, already: 1 });
  // Run again: now all three are there.
  expect(await importStatement(db, ana, clock, s.rows)).toMatchObject({ added: 0, already: 3 });
});

it('suggests the category an earlier entry with the same label was in, and a person can say none', async () => {
  const fuel = await money(db, ana, clock).addCategory({ name: 'Fuel', monthly_cents: 10000 });
  await money(db, ana, clock).addEntry({ label: 'kroger fuel', cents: 3000, day: '2046-02-10', category_id: fuel.id });
  const s = readStatement('Date,Description,Amount\n03/05/2046,KROGER   FUEL,-45.10\n03/06/2046,Bakery,-6.00\n');
  const looked = await lookOverStatement(db, ana, clock, s);
  expect(looked.rows.map((r) => r.suggested_category_id)).toEqual([fuel.id, null]);
  await importStatement(db, ana, clock, s.rows);
  expect((await money(db, ana, clock).month('2046-03')).entries.map((e) => [e.label, e.category])).toEqual([['Bakery', null], ['KROGER FUEL', 'Fuel']]);
  // Said none, or the suggestions turned off: nothing is filled in.
  await db.run('DELETE FROM money_entries WHERE day >= ?', ['2046-03-01']);
  await importStatement(db, ana, clock, s.rows, { categories: { 0: null } });
  await importStatement(db, ana, clock, s.rows, { suggest: false });
  expect((await money(db, ana, clock).month('2046-03')).entries.map((e) => e.category)).toEqual([null, null]);
});

it('goes through the same checks as adding an entry: only your own categories, and nobody else sees them', async () => {
  const secret = await money(db, ana, clock).addCategory({ name: "Ben's present", monthly_cents: 20000 });
  const shared = await money(db, ana, clock).addCategory({ name: 'House', monthly_cents: 50000, shared_with: [ben] });
  const s = readStatement('Date,Description,Amount\n03/05/2046,Watch,-150.00\n03/06/2046,Paint,-40.00\n');
  // Ben can't put anything in Ana's private category, and a refused statement writes nothing at all.
  await expect(importStatement(db, ben, clock, s.rows, { categories: { 0: secret.id, 1: shared.id } })).rejects.toMatchObject({ status: 404 });
  expect((await money(db, ben, clock).month('2046-03')).entries).toEqual([]);
  // In the shared one he can, and Ana sees it with his name.
  await importStatement(db, ben, clock, s.rows, { keep: [1], categories: { 1: shared.id } });
  expect((await money(db, ana, clock).month('2046-03')).entries.map((e) => [e.label, e.by])).toEqual([['Paint', 'ben']]);
  // Ana's own entries are hers: Ben's look-over doesn't call a line "already there" because of them, nor suggest her category.
  await importStatement(db, ana, clock, s.rows, { categories: { 0: secret.id } });
  const looked = await lookOverStatement(db, ben, clock, s);
  expect(looked.rows.map((r) => [r.already, r.suggested_category_id])).toEqual([[false, null], [true, shared.id]]);
  expect(JSON.stringify(await money(db, ben, clock).month('2046-03'))).not.toMatch(/Watch|present/);
});

it('is refused like adding an entry once the trial has ended', () => {
  const ended = accessNow({ trial_started: '2040-01-01T00:00:00Z', unlocked: false }, new Date('2046-03-15T00:00:00Z'));
  expect(decide(ended, 'POST', '/api/money/entries')).toBe('read_only');
  expect(decide(ended, 'POST', '/api/money/statement')).toBe('read_only');
  expect(decide(ended, 'POST', '/api/money/statement/read')).toBe('read_only');
});
