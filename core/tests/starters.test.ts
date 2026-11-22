/** The Things page files kinds under plain headings, worked out from a kind's name. */
import { expect, it } from 'vitest';
import { KIND_GROUPS, STARTERS, groupOfKind } from '../src/starters.ts';

it('a ready-made kind gives its heading, whatever its capitals or spacing', () => {
  expect(groupOfKind('Cast iron')).toBe('Cooking');
  expect(groupOfKind('  cast   IRON ')).toBe('Cooking');
  expect(groupOfKind('Fabric')).toBe('Crafts');
  expect(groupOfKind('Needles & hooks')).toBe('Crafts');
  expect(groupOfKind('WOOD')).toBe('Workshop');
  expect(groupOfKind('Seeds')).toBe('Garden');
  expect(groupOfKind('Tools')).toBe('Around the house');
  expect(groupOfKind('Bedding and linens')).toBe('Clothes and linens');
});

it('a kind no set has gives nothing, so it goes under Other', () => {
  expect(groupOfKind('Board games')).toBeNull();
  expect(groupOfKind('')).toBeNull();
});

it('every set has a heading the page knows, and no two sets share a kind name', () => {
  for (const starter of STARTERS) expect(KIND_GROUPS).toContain(starter.group);
  const names = STARTERS.flatMap((s) => s.kinds.map((k) => k.name.toLowerCase()));
  expect(new Set(names).size).toBe(names.length);
});
