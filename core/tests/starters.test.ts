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

// The pages are built into the Docker image from frontend/ alone, so a page that reaches into core/ builds on
// a developer's computer and fails in the image. Only the phone app's own code (frontend/src/device) may.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

it('no page reaches into core: what a page needs from core comes through the API', () => {
  const pages = path.resolve(import.meta.dirname, '..', '..', 'frontend', 'src');
  const reaching: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const at = path.join(dir, name);
      if (statSync(at).isDirectory()) { if (name !== 'device') walk(at); } else if (/\.(jsx?|tsx?)$/.test(name) && /from ['"][./]+\/core\//.test(readFileSync(at, 'utf8'))) reaching.push(path.relative(pages, at));
    }
  };
  walk(pages);
  expect(reaching).toEqual([]);
});
