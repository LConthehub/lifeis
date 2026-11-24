import { describe, expect, it } from 'vitest';
import { likeness, readBook, readReceipt, savingsSentence, tieToList } from '../src/receipt.ts';

// Made-up receipts, written the way the stores print them. No real people, addresses or items.
const COSTCO = `
COSTCO WHOLESALE
#9999 SAMPLETOWN
Member 111222333444
E 1234567 KS ORG COFFEE 3LB    18.99 A
  1234567 /1234567 INSTANT SAVINGS    4.00-
E 7654321 ROTISSERIE CHICKEN    4.99 A
E 2223334 KS ORG BANANAS 3LB    1.99 A
  1112223 TPD/2223334    0.50-
E 5556667 PAPER TOWELS 12CT     21.99 A
SUBTOTAL     43.46
TAX           0.00
**** TOTAL   43.46
AMOUNT: $43.46
11/03/2046 14:32
TOTAL NUMBER OF ITEMS SOLD = 4
YOU SAVED 4.50
`;

const KROGER = `
KROGER
123 EXAMPLE ST
GROCERY
GALLON MILK                 3.49 B
EGGS LARGE 18CT             4.29 B
BANANAS
 1.52 lb @ 0.59/lb          0.90 B
SOUR CREAM                  2.19 B
 CARD SAVINGS               0.50-
BLACK BEANS                 3.98 B
2 @ 1.99
SUBTOTAL                   14.35
TAX                         0.00
BALANCE                    14.35
YOU SAVED 0.50
2046-03-05
`;

const ALDI = `
ALDI
Store 42
Bananas 0.49 FA
Whole Milk 2.29 FA
Butter Salted 3.19 FA
Frozen Peas 1.15 FA
SUBTOTAL 7.12
TAX 0.00
TOTAL 7.12
Debit Card 7.12
03/05/46
`;

describe('reading a Costco receipt', () => {
  const r = readReceipt(COSTCO);
  it('finds the store, the day, the total and the tax', () => {
    expect(r.store).toBe('Costco');
    expect(r.day).toBe('2046-11-03');
    expect(r.total_cents).toBe(4346);
    expect(r.subtotal_cents).toBe(4346);
    expect(r.tax_cents).toBe(0);
    expect(r.said_saved_cents).toBe(450);
  });
  it('finds each thing with its number and full price', () => {
    expect(r.items.map((i) => [i.code, i.text, i.cents])).toEqual([
      ['1234567', 'KS ORG COFFEE 3LB', 1899], ['7654321', 'ROTISSERIE CHICKEN', 499], ['2223334', 'KS ORG BANANAS 3LB', 199], ['5556667', 'PAPER TOWELS 12CT', 2199],
    ]);
  });
  it('ties each savings line to its item, by the number it gives when it gives one', () => {
    expect(r.items.map((i) => i.saved_cents)).toEqual([400, 0, 50, 0]);
    expect(r.items[0]!.saving_notes[0]).toMatch(/instant savings/i);
    expect(r.loose_saved_cents).toBe(0);
  });
  it('says the lines add up to the subtotal', () => {
    expect(r.adds_up).toBe(true); // 47.96 in full prices, less 4.50 saved, is the 43.46 subtotal
  });
});

describe('reading a Kroger receipt', () => {
  const r = readReceipt(KROGER);
  it('reads the total, weighed things and a quantity line', () => {
    expect(r.store).toBe('Kroger');
    expect(r.day).toBe('2046-03-05');
    expect(r.total_cents).toBe(1435);
    expect(r.items.map((i) => [i.text, i.cents])).toEqual([['GALLON MILK', 349], ['EGGS LARGE 18CT', 429], ['BANANAS', 90], ['SOUR CREAM', 219], ['BLACK BEANS', 398]]);
    expect(r.items[4]!.quantity).toBe(2);
  });
  it('ties a card saving to the item above it, and the lines add up', () => {
    expect(r.items[3]!.saved_cents).toBe(50);
    expect(r.adds_up).toBe(true);
  });
});

describe('reading an Aldi receipt', () => {
  const r = readReceipt(ALDI);
  it('reads plain lines with tax flags and a short year', () => {
    expect(r.store).toBe('Aldi');
    expect(r.day).toBe('2046-03-05');
    expect(r.items.map((i) => [i.text, i.cents])).toEqual([['Bananas', 49], ['Whole Milk', 229], ['Butter Salted', 319], ['Frozen Peas', 115]]);
    expect(r.total_cents).toBe(712);
    expect(r.adds_up).toBe(true);
  });
  it('does not take the card line for an item', () => {
    expect(r.items.some((i) => /debit/i.test(i.text))).toBe(false);
  });
});

it('a negative amount right under an item is a saving, and one with nothing above it is loose', () => {
  const r = readReceipt('PASTA SAUCE 3.00\n-0.75\nSUBTOTAL 2.25\nTOTAL 2.25');
  expect(r.items[0]!.saved_cents).toBe(75);
  expect(readReceipt('COUPON 1.00-\nTOTAL 0.00').loose_saved_cents).toBe(100);
});

describe('tying receipt items to the list', () => {
  const list = [{ id: 1, label: 'coffee' }, { id: 2, label: 'bananas' }, { id: 3, label: 'paper towels' }, { id: 4, label: 'eggs' }];
  it('matches by words, ignoring store words like KS and ORG, and plurals', () => {
    const ties = tieToList(readReceipt(COSTCO).items, list);
    expect(ties.map((t) => t.id)).toEqual([1, null, 2, 3]);
  });
  it('uses each line of the list once', () => {
    const ties = tieToList([{ text: 'COFFEE BEANS' }, { text: 'COFFEE FILTERS' }], [{ id: 1, label: 'coffee' }]);
    expect(ties.filter((t) => t.id === 1)).toHaveLength(1);
  });
  it('does not match unlike things', () => {
    expect(likeness('PAPER TOWELS 12CT', 'eggs')).toBe(0);
    expect(likeness('milk', 'almond milk')).toBeGreaterThan(0);
  });
});

describe('a savings book typed in', () => {
  it('reads money off and percentages, and lists what it could not read', () => {
    const { lines, skipped } = readBook('Coffee 4.00\nEggs $1 off\nCereal 20%\nOrange juice: 1.50\n\nSomething with no amount');
    expect(lines).toEqual([
      { item: 'Coffee', cents_off: 400, percent_off: null }, { item: 'Eggs', cents_off: 100, percent_off: null },
      { item: 'Cereal', cents_off: null, percent_off: 20 }, { item: 'Orange juice', cents_off: 150, percent_off: null },
    ]);
    expect(skipped).toEqual(['Something with no amount']);
  });
});

describe('saying when a thing was on savings', () => {
  it('groups by amount and names the months', () => {
    const times = [{ day: '2046-03-04', cents: 400 }, { day: '2046-07-20', cents: 400 }, { day: '2046-11-03', cents: 400 }];
    expect(savingsSentence('$', times)).toBe('$4 off in March, July and November');
  });
  it('shows cents, and adds the year when it spans more than one', () => {
    expect(savingsSentence('$', [{ day: '2045-12-01', cents: 150 }, { day: '2046-03-04', cents: 400 }])).toBe('$1.50 off in December 2045; $4 off in March 2046');
  });
});
