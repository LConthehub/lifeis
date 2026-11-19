import { describe, expect, it } from 'vitest';
import golden from './units.golden.json';
import { amount, canonical, convert, kindOf, nameKey, nice, parseLine } from '../src/units';

describe('reading an ingredient line', () => {
  it.each([
    ['1 1/2 cups flour, sifted', 1.5, 'cup', 'flour', 'sifted'],
    ['½ tsp salt', 0.5, 'tsp', 'salt', null],
    ['1½ tbsp butter', 1.5, 'tbsp', 'butter', null],
    ['2-3 cloves garlic', 3, 'clove', 'garlic', null],
    ['1 (28 oz) can crushed tomatoes', 1, 'can', 'crushed tomatoes', null],
    ['200 g dark chocolate', 200, 'g', 'dark chocolate', null],
    ['3 eggs', 3, null, 'eggs', null],
    ['2 fl oz cream', 2, 'fl oz', 'cream', null],
    ['Salt to taste', null, null, 'Salt', 'to taste'],
    ['2 tomatoes', 2, null, 'tomatoes', null],
    ['1 large onion', 1, null, 'large onion', null],
  ])('%s', (line, quantity, unit, name, note) => {
    expect(parseLine(line)).toEqual({ quantity, unit, name, note });
  });
});

it('units convert only within their kind', () => {
  expect(convert(1, 'lb', 'g')).toBeCloseTo(453.592);
  expect(convert(3, 'tsp', 'tbsp')).toBeCloseTo(1, 3);
  expect(convert(1, 'cup', 'g')).toBeNull(); // volume and weight never mix
  expect(convert(2, 'clove', 'clove')).toBe(2);
  expect(convert(2, 'clove', 'can')).toBeNull();
  expect(nameKey('Tomatoes')).toBe(nameKey('tomato'));
  expect(nameKey('Berries')).toBe('berry');
  expect(nameKey('glass')).toBe('glass');
  expect(nameKey('Hummus')).toBe('hummus');
  expect([1.5, 1 / 3, 2.0, 0.25, 2.999, 1.37].map(nice)).toEqual(['1 1/2', '1/3', '2', '1/4', '3', '1.37']);
});

// The answers backend/units.py gives (python core/tests/golden.py writes them). Both must read amounts alike.
describe('the same answers as backend/units.py', () => {
  it('ingredient lines', () => {
    for (const [line, expected] of golden.lines as [string, unknown][]) {
      expect(parseLine(line), line).toEqual(expected);
    }
  });
  it('ingredient names', () => {
    for (const [name, key] of golden.names as [string, string][]) expect(nameKey(name), name).toBe(key);
  });
  it('friendly numbers and amounts', () => {
    for (const [n, text] of golden.nice as [number, string][]) expect(nice(n), String(n)).toBe(text);
    for (const [n, unit, text] of golden.amounts as [number, string | null, string][]) {
      expect(amount(n, unit), `${n} ${unit}`).toBe(text);
    }
  });
  it('units and conversions', () => {
    for (const [unit, name, kind] of golden.units as [string | null, string | null, string][]) {
      expect(canonical(unit), String(unit)).toBe(name);
      expect(kindOf(unit), String(unit)).toBe(kind);
    }
    for (const [from, to, expected] of golden.convert as [string | null, string | null, number | null][]) {
      const got = convert(2.5, from, to);
      if (expected === null) expect(got, `${from} -> ${to}`).toBeNull();
      else expect(got, `${from} -> ${to}`).toBeCloseTo(expected, 9);
    }
  });
});
