/** The Things page files kinds under plain headings, worked out from a kind's name. */
import { expect, it } from 'vitest';
import { inventory } from '../src/inventory.ts';
import { AREAS, life } from '../src/life.ts';
import { migrate } from '../src/migrations.ts';
import { KIND_GROUPS, STARTERS, groupOfKind } from '../src/starters.ts';
import { memoryDb } from './memoryDb.ts';

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

it('every interest that names a set names one that exists, and each set can be ticked', () => {
  for (const area of AREAS) if (area.starter) expect(STARTERS.map((s) => s.slug)).toContain(area.starter);
  for (const starter of STARTERS) expect(AREAS.some((a) => a.starter === starter.slug)).toBe(true);
  expect(new Set(STARTERS.map((s) => s.slug)).size).toBe(STARTERS.length);
});

it('the car, art, electronics, music and outdoors sets each add their kinds, with their fields, to a fresh database', async () => {
  const expected: Record<string, [string, string][]> = {
    car: [['Vehicles', 'VIN'], ['Fluids and filters', 'Fits'], ['Car parts and spares', 'Part number'], ['Car tools', 'Size']],
    art: [['Paints and inks', 'Color'], ['Paper and canvas', 'Size'], ['Brushes and art tools', 'Size'], ['Craft supplies', 'Type']],
    electronics: [['Devices', 'Warranty until'], ['Cables and adapters', 'Length'], ['Components', 'Value'], ['Batteries and chargers', 'Type']],
    music: [['Instruments', 'Serial number'], ['Strings, reeds and supplies', 'Fits'], ['Sheet music and books', 'Composer'], ['Audio gear', 'Model']],
    outdoors: [['Camping gear', 'Type'], ['Fishing tackle', 'Type'], ['Sports gear', 'Whose'], ['Bikes', 'Frame size']],
  };
  for (const [slug, kinds] of Object.entries(expected)) {
    const db = memoryDb();
    await migrate(db);
    const owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
    const added = await inventory(db, owner).addStarter(slug);
    expect(added.map((k) => k.name).sort()).toEqual(kinds.map(([name]) => name).sort());
    for (const [name, field] of kinds) {
      const kind = added.find((k) => k.name === name)!;
      expect(kind.fields.length).toBeGreaterThanOrEqual(3);
      expect(kind.fields.map((f) => f.name)).toContain(field);
    }
    const saved = await life(db, owner).saveProfile([slug]);
    expect(saved.sections).toEqual(['keeping', 'making']);
    expect(saved.added).toEqual([]); // already added just above
  }
});

it('a fresh person ticking each new interest gets its kinds', async () => {
  const db = memoryDb();
  await migrate(db);
  const owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
  const saved = await life(db, owner).saveProfile(['car', 'art', 'electronics', 'music', 'outdoors']);
  expect(saved.added).toEqual(expect.arrayContaining(['Vehicles', 'Paints and inks', 'Devices', 'Instruments', 'Bikes']));
  expect(new Set(saved.added).size).toBe(saved.added.length);
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
