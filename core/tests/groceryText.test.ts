import { describe, expect, it } from 'vitest';
// @ts-ignore: a plain .js file with no type declarations
import { groceryText, canNarrowToStore } from '../../frontend/src/components/groceryText.js';

type Item = { id: number; label: string; amount: string; done: boolean; aisle: string | null };
type Line = { id: number; likely_store: string | null; usual_size: string };
const item = (id: number, label: string, amount = '', aisle: string | null = null, done = false): Item => ({ id, label, amount, done, aisle });
const line = (id: number, likely_store: string | null = null, usual_size = ''): Line => ({ id, likely_store, usual_size });

const items = [
  item(1, 'chicken thighs', '2 lb', 'Meat'),
  item(2, 'leeks', '', 'Produce'),
  item(3, 'coffee', '', 'Pantry'),
  item(4, 'soap', '', null),
  item(5, 'milk', '1 gal', 'Dairy', true),
];
const lines = [line(1, 'Costco'), line(2, 'Aldi'), line(3, 'Costco', '30 oz'), line(4), line(5, 'Aldi')];

// The list's words are written once, in the page's own helper file, because pages cannot reach into core.
// It is plain JavaScript with no browser in it, so it is tried here.
describe('the grocery list as text', () => {
  it('groups by aisle, in the order the list has them, with amounts and usual sizes', () => {
    expect(groceryText({ items, lines, group: 'aisle' })).toBe([
      'Groceries (4 things)', '',
      'Meat', '- 2 lb chicken thighs', '',
      'Produce', '- leeks', '',
      'Pantry', '- coffee (30 oz)', '',
      'Everything else', '- soap',
    ].join('\n'));
  });

  it('groups by store: where you are first, "Any store" last, the rest A to Z', () => {
    expect(groceryText({ items, lines, group: 'store', store: 'costco' })).toBe([
      'Groceries (4 things)', '',
      'Costco', '- 2 lb chicken thighs', '- coffee (30 oz)', '',
      'Aldi', '- leeks', '',
      'Any store', '- soap',
    ].join('\n'));
    expect(groceryText({ items, lines, group: 'store' }).split('\n\n').slice(1).map((b: string) => b.split('\n')[0])).toEqual(['Aldi', 'Costco', 'Any store']);
  });

  it('can be one plain list with no headings', () => {
    expect(groceryText({ items, lines, group: 'none' })).toBe('Groceries (4 things)\n\n- 2 lb chicken thighs\n- leeks\n- coffee (30 oz)\n- soap');
  });

  it('leaves out what is in the buggy, or lists it apart, ticked, and counts it', () => {
    expect(groceryText({ items, lines, group: 'none' })).not.toMatch(/milk/);
    const withBought = groceryText({ items, lines, group: 'none', includeBought: true });
    expect(withBought.split('\n')[0]).toBe('Groceries (4 things, 1 in the buggy)');
    expect(withBought.endsWith('\n\nIn the buggy\n- 1 gal milk')).toBe(true);
    expect(groceryText({ items, lines, group: 'none', includeBought: true, boxes: true }).endsWith('In the buggy\n[x] 1 gal milk')).toBe(true);
  });

  it('narrows to the store you are at, keeping what can be got anywhere', () => {
    const text = groceryText({ items, lines, group: 'store', store: 'Aldi', justHere: true });
    expect(text).toBe(['Groceries for Aldi (2 things)', '', 'Aldi', '- leeks', '', 'Any store', '- soap'].join('\n'));
    expect(groceryText({ items, lines, group: 'none', store: 'Aldi', justHere: true, includeBought: true })).toMatch(/1 gal milk/);
    expect(groceryText({ items, lines, group: 'none', store: 'Costco', justHere: true, includeBought: true })).not.toMatch(/milk/);
    // With no store set there is nothing to narrow to.
    expect(groceryText({ items, lines, group: 'none', store: null, justHere: true }).split('\n')[0]).toBe('Groceries (4 things)');
    expect(canNarrowToStore(items, lines, 'aldi')).toBe(true);
    expect(canNarrowToStore(items, lines, 'Target')).toBe(false);
    expect(canNarrowToStore(items, lines, '')).toBe(false);
  });

  it('writes check boxes for notes apps', () => {
    expect(groceryText({ items, lines, group: 'none', boxes: true })).toBe('Groceries (4 things)\n\n[ ] 2 lb chicken thighs\n[ ] leeks\n[ ] coffee (30 oz)\n[ ] soap');
  });

  it('says so when there is nothing to get, and counts one thing in the singular', () => {
    expect(groceryText({ items: [], lines: [], group: 'aisle' })).toBe('Groceries (nothing to get)');
    expect(groceryText({ items: [item(5, 'milk', '1 gal', 'Dairy', true)], lines, group: 'aisle' })).toBe('Groceries (nothing to get)');
    expect(groceryText({ items: [item(1, 'eggs')], lines: [], group: 'none' })).toBe('Groceries (1 thing)\n\n- eggs');
  });

  it('keeps odd names on one line each, and never lets one pass for a heading or a prices line', () => {
    const odd = [item(1, 'jalapeño\npeppers\r\n- fake', '½ lb', 'Produce\nPantry'), item(2, '  "Ben & Jerry\'s"   <ice cream>\t', '', null), item(3, '🍌 bananas', '6')];
    const text = groceryText({ items: odd, lines: [], group: 'aisle' });
    expect(text).toBe(['Groceries (3 things)', '', 'Produce Pantry', '- ½ lb jalapeño peppers - fake', '', 'Everything else', '- "Ben & Jerry\'s" <ice cream>', '- 6 🍌 bananas'].join('\n'));
    expect(text.split('\n').every((l: string) => l === '' || !/^\s/.test(l))).toBe(true);
  });

  it('carries no prices, coupons or notes', () => {
    const priced = [{ ...item(1, 'coffee', '', 'Pantry'), note: 'ask about the deal', price_cents: 899 }];
    expect(groceryText({ items: priced, lines: [{ ...line(1, 'Costco'), price_cents: 899, coupons: [1] }], group: 'aisle' })).not.toMatch(/899|8\.99|deal|coupon/i);
  });
});
