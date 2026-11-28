/** The garden: plants in places, planting times from frost dates, watering (with rain), harvests, and the download. */
import { beforeEach, expect, it } from 'vitest';
import type { Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, bringInPictures, exportEverything, KINDS, splitDownload } from '../src/exportAll.ts';
import { frostDay, frostFromYears, garden, tasksThisWeek, waterState, warningsFrom, CROPS, cropFor, type Frost } from '../src/garden.ts';
import { home } from '../src/home.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { life } from '../src/life.ts';
import { migrate } from '../src/migrations.ts';
import { upkeep } from '../src/upkeep.ts';
import { weather } from '../src/weather.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time = new Date(2046, 4, 9, 10, 0, 0); // Wednesday, May 9, 2046
let day = '2046-05-09';
const clock = () => Object.assign(() => time, { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

beforeEach(async () => {
  time = new Date(2046, 4, 9, 10, 0, 0);
  day = '2046-05-09';
  db = memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
});

/** Ten past years: a last spring frost around April 12 and a first fall frost around October 28. */
function archive() {
  const time: string[] = [];
  const low: number[] = [];
  const springs = [10, 12, 14, 11, 13, 12, 9, 15, 12, 12];
  for (const [n, spring] of springs.entries()) {
    const year = 2036 + n;
    for (const [d, value] of [[`${year}-01-15`, -8], [`${year}-04-${String(spring).padStart(2, '0')}`, -1], [`${year}-05-01`, 6], [`${year}-10-${String(26 + (n % 5)).padStart(2, '0')}`, -2], [`${year}-12-01`, -5]] as [string, number][]) { time.push(d); low.push(value); }
  }
  return { daily: { time, temperature_2m_min: low } };
}

function pretend(rainInches: number[] = [0, 0, 0, 0, 0.7, 0, 0, 0]) {
  const world = {
    asked: [] as string[],
    fetcher: (async (url: string) => {
      world.asked.push(url);
      let data: unknown;
      if (url.startsWith('https://geocoding-api')) data = { results: [{ name: 'Springfield', latitude: 37.21, longitude: -93.29 }] };
      else if (url.startsWith('https://archive-api.open-meteo.com/')) data = archive();
      else if (url.includes('daily=precipitation_sum')) data = { daily: { time: rainInches.map((_, i) => `2046-05-${String(2 + i).padStart(2, '0')}`), precipitation_sum: rainInches } };
      else {
        data = { current: { temperature_2m: 50, weather_code: 0 }, daily: { time: ['2046-05-09', '2046-05-10', '2046-05-11'], weather_code: [0, 0, 0], temperature_2m_max: [70, 71, 97], temperature_2m_min: [31, 45, 60], precipitation_probability_max: [0, 0, 0] } };
      }
      return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
    }) as Fetcher,
  };
  return world;
}

const FROST: Frost = { last_spring: '04-12', first_fall: '10-28', how: 'typed', worked_out_on: null };

it('frost dates are typed as a month and day, and a whole day gives its month and day', () => {
  expect([frostDay('04-12', 'x'), frostDay('2046-10-28', 'x'), frostDay('', 'x'), frostDay(null, 'x')]).toEqual(['04-12', '10-28', null, null]);
  expect(() => frostDay('13-40', 'x')).toThrow();
  expect(() => frostDay('April', 'x')).toThrow();
});

it('the usual frost dates are the middle day of the past years, and a town with no frost has none', () => {
  const found = frostFromYears(archive().daily.time.map((d, i) => ({ day: d, low: archive().daily.temperature_2m_min[i]! })));
  expect(found).toEqual({ last_spring: '04-12', first_fall: '10-28' });
  expect(frostFromYears([{ day: '2040-01-02', low: -3 }, { day: '2041-01-02', low: -3 }])).toEqual({ last_spring: null, first_fall: null });
  expect(frostFromYears([{ day: '2040-04-02', low: 0.5 }])).toEqual({ last_spring: null, first_fall: null });
});

it('planting times are weeks from the frost: hardy before, tender after, bulbs and garlic after the fall frost', () => {
  const peas = { label: 'Peas', crop: CROPS.find((c) => c.key === 'pea')!, plant_id: null, seed: true, planted_on: null, link: null };
  const tomato = { label: 'Tomato', crop: CROPS.find((c) => c.key === 'tomato')!, plant_id: 1, seed: false, planted_on: null, link: null };
  const fig = { label: 'Fig', crop: CROPS.find((c) => c.key === 'fig')!, plant_id: 2, seed: false, planted_on: null, link: null };
  const garlic = { label: 'Garlic', crop: CROPS.find((c) => c.key === 'garlic')!, plant_id: 3, seed: false, planted_on: null, link: null };
  const all = [peas, tomato, fig, garlic];
  // Peas: sow 6 to 3 weeks before April 12 = Mar 1 to Mar 28 (the last week of that window ends Mar 28).
  expect(tasksThisWeek(all, FROST, '2046-03-01').map((t) => `${t.do} ${t.what}`)).toEqual(['sow Peas', 'prune Fig']);
  expect(tasksThisWeek(all, FROST, '2046-03-29')).toEqual([]);
  // Fig: prune 6 to 3 weeks before the last frost (Mar 1 to Mar 28, the same week as peas).
  expect(tasksThisWeek(all, FROST, '2046-03-10').map((t) => `${t.do} ${t.what}`)).toEqual(['sow Peas', 'prune Fig']);
  // Tomato: plant 1 to 3 weeks after April 12: Apr 19 to May 10.
  expect(tasksThisWeek(all, FROST, '2046-05-09').map((t) => `${t.do} ${t.what}`)).toEqual(['plant Tomato', 'feed Tomato']);
  expect(tasksThisWeek(all, FROST, '2046-05-11').map((t) => `${t.do} ${t.what}`)).toEqual(['feed Tomato']);
  // Planted already, in that window: nothing left to do.
  expect(tasksThisWeek([{ ...tomato, planted_on: '2046-05-01' }], FROST, '2046-05-09').map((t) => t.do)).toEqual(['feed']);
  // Garlic goes in 2 to 5 weeks after the first fall frost: Nov 11 to Dec 8.
  expect(tasksThisWeek(all, FROST, '2046-11-12').map((t) => `${t.do} ${t.what}`)).toEqual(['plant Garlic']);
  // Without frost dates there is nothing to say.
  expect(tasksThisWeek(all, { ...FROST, last_spring: null, first_fall: null }, '2046-05-09')).toEqual([]);
});

it('the built-in list is modest, names every plant once and finds a plant by its name', () => {
  expect(CROPS.length).toBeGreaterThanOrEqual(25);
  expect(CROPS.length).toBeLessThanOrEqual(40);
  expect(new Set(CROPS.map((c) => c.key)).size).toBe(CROPS.length);
  expect([cropFor('Cherokee tomatoes')?.key, cropFor('Collards, back bed')?.key, cropFor('Hydrangeas by the porch')?.key, cropFor('Old chair')?.key]).toEqual(['tomato', 'collards', 'hydrangea', undefined]);
});

it('half an inch of rain counts as watering a plant outdoors, less does not, and one indoors is never rained on', () => {
  const base = { every: 3, last_done: '2046-05-04', planted_on: null, started: '2046-05-01', outdoor: true, today: '2046-05-09' };
  // Without rain it is due: last done May 4, every 3 days.
  expect(waterState({ ...base, rain: [] })).toMatchObject({ due: true, due_on: '2046-05-07', days_late: 2, rain: null, skipped_for_rain: false });
  // 0.7 in on Monday May 7 counts: next watering Thursday May 10, so not due, and it says why.
  const wet = waterState({ ...base, rain: [{ day: '2046-05-07', inches: 0.7 }] });
  expect(wet).toMatchObject({ due: false, due_on: '2046-05-10', skipped_for_rain: true, rain: { day: '2046-05-07', inches: 0.7, says: 'Rain on Monday: 0.7 in' } });
  // Exactly half an inch counts; 0.4 does not.
  expect(waterState({ ...base, rain: [{ day: '2046-05-07', inches: 0.5 }] }).due).toBe(false);
  expect(waterState({ ...base, rain: [{ day: '2046-05-07', inches: 0.49 }] })).toMatchObject({ due: true, rain: null });
  // Rain from before the last watering is old news.
  expect(waterState({ ...base, rain: [{ day: '2046-05-03', inches: 2 }] }).rain).toBeNull();
  // Indoors, rain is nothing to it.
  expect(waterState({ ...base, outdoor: false, rain: [{ day: '2046-05-07', inches: 2 }] })).toMatchObject({ due: true, rain: null });
  // Rain today, in millimeters for a town that uses degrees C.
  expect(waterState({ ...base, rain: [{ day: '2046-05-09', inches: 1 }], metric: true }).rain?.says).toBe('Rain today: 25 mm');
  // Never watered: counted from planting, else from when the plant was added.
  expect(waterState({ every: 2, last_done: null, planted_on: '2046-05-08', started: '2046-05-01', outdoor: true, rain: [], today: '2046-05-09' })).toMatchObject({ due: false, due_on: '2046-05-10' });
  expect(waterState({ every: 2, last_done: null, planted_on: null, started: '2046-05-06', outdoor: true, rain: [], today: '2046-05-09' })).toMatchObject({ due: true, days_late: 1 });
});

it('frost and heat are warned of in the days the forecast covers', () => {
  const days = [{ day: '2046-05-09', high: 70, low: 31 }, { day: '2046-05-10', high: 71, low: 45 }, { day: '2046-05-11', high: 97, low: 60 }];
  expect(warningsFrom(days, 'f', '2046-05-09').map((w) => w.says)).toEqual(['Frost tonight: low 31°', 'Heat Friday: high 97°']);
  expect(warningsFrom([{ day: '2046-05-10', high: 20, low: -1 }], 'c', '2046-05-09').map((w) => w.says)).toEqual(['Frost tomorrow: low -1°']);
  expect(warningsFrom([{ day: '2046-05-10', high: 20, low: 1 }], 'c', '2046-05-09')).toEqual([]);
});

it('frost dates are worked out from ten past years through the weather already in use, or typed when it is off', async () => {
  const world = pretend();
  const mine = garden(db, owner, clock(), { fetcher: world.fetcher });
  // Weather off: nothing is asked, and it says to type them.
  await expect(mine.workOutFrost()).rejects.toEqual(problem(400));
  expect(world.asked).toEqual([]);
  expect(await mine.setFrost({ last_spring: '2046-04-20', first_fall: '10-15' })).toMatchObject({ last_spring: '04-20', first_fall: '10-15', how: 'typed' });
  await expect(mine.setFrost({ last_spring: 'soon' })).rejects.toEqual(problem(400));

  await weather(db, owner, clock(), world.fetcher).turnOn({ name: 'Springfield', latitude: 37.2153, longitude: -93.2982 });
  const found = await mine.workOutFrost();
  expect(found).toMatchObject({ last_spring: '04-12', first_fall: '10-28', how: 'weather', worked_out_on: '2046-05-09' });
  // The same rounded position as the forecast, the last ten whole years, and nothing else about anyone.
  const asked = new URL(world.asked.find((u) => u.startsWith('https://archive-api'))!);
  expect([asked.searchParams.get('latitude'), asked.searchParams.get('longitude'), asked.searchParams.get('start_date'), asked.searchParams.get('end_date'), asked.searchParams.get('daily')]).toEqual(['37.22', '-93.3', '2036-01-01', '2045-12-31', 'temperature_2m_min']);
  expect([...asked.searchParams.keys()].sort()).toEqual(['daily', 'end_date', 'latitude', 'longitude', 'start_date', 'temperature_unit', 'timezone']);
});

it('a plant is a thing in a place, watered as a chore a child can earn points for', async () => {
  const stuff = inventory(db, owner, clock());
  const bed = (await stuff.createPlace({ name: 'Back bed' })).find((p) => p.name === 'Back bed')!;
  const mine = garden(db, owner, clock());
  const jobs = upkeep(db, owner, clock());
  const kid = (await jobs.addMember('Charlie')).find((m) => m.name === 'Charlie')!;
  const tomatoes = await mine.addPlant({ name: 'Cherokee tomatoes', place_id: bed.id, planted_on: '2046-05-01', assigned_member: kid.id, points: 3 });
  // It is a thing, of the kind Vegetables and herbs, in the bed.
  const thing = await stuff.getItem(tomatoes.item_id);
  expect([thing.kind, thing.place, tomatoes.crop, tomatoes.crop_name, tomatoes.outdoor, tomatoes.water_every]).toEqual(['Vegetables and herbs', 'Back bed', 'tomato', 'Tomato', true, 3]);
  expect(tomatoes.member).toEqual({ id: kid.id, name: 'Charlie' });
  // Planted May 1, every 3 days: due since May 4.
  expect(tomatoes.water).toMatchObject({ due: true, due_on: '2046-05-04', days_late: 5 });
  // One tap. The child gets the chore's points, and it is not due again for three days.
  const done = await mine.water(tomatoes.id, { by_member: kid.id });
  expect(done.water).toMatchObject({ due: false, due_on: '2046-05-12', last_done: '2046-05-09' });
  expect(await db.all('SELECT done_member, points FROM upkeep_done')).toEqual([{ done_member: kid.id, points: 3 }]);
  expect((await jobs.get(done.water_job_id!)).kind).toBe('chore');
  // A houseplant is indoors and a plant with no rhythm has no chore.
  const pothos = await mine.addPlant({ name: 'Pothos', kind: 'house', water_every: 7 });
  expect([pothos.outdoor, pothos.kind, pothos.crop]).toEqual([false, 'house', 'pothos']);
  const weed = await mine.addPlant({ name: 'Mystery shrub', kind: 'flower', water_every: null });
  expect([weed.water, weed.water_job_id]).toEqual([null, null]);
  await expect(mine.water(weed.id)).rejects.toEqual(problem(400));
  await expect(mine.addPlant({ name: 'X', kind: 'tree' })).rejects.toEqual(problem(400));
  // Four kinds and the seed packets exist as ordinary kinds of things.
  expect((await stuff.listKinds()).map((k) => k.name).sort()).toEqual(['Flowers and shrubs', 'Fruit trees and berries', 'Houseplants', 'Seed packets', 'Vegetables and herbs']);
  // Taking the plant away takes its chore.
  await mine.removePlant(pothos.id);
  expect((await mine.list()).map((p) => p.name)).toEqual(['Cherokee tomatoes', 'Mystery shrub']);
  expect(await db.get("SELECT id FROM upkeep_jobs WHERE name = 'Water Pothos'")).toBeUndefined();
});

it('rain on the weather already in use counts as watered, and the card says why', async () => {
  const world = pretend();
  await weather(db, owner, clock(), world.fetcher).turnOn({ name: 'Springfield', latitude: 37.2153, longitude: -93.2982 });
  const mine = garden(db, owner, clock(), { fetcher: world.fetcher });
  const outside = await mine.addPlant({ name: 'Collards', planted_on: '2046-05-01', water_every: 4 }); // due since May 5
  const inside = await mine.addPlant({ name: 'Pothos', kind: 'house', planted_on: '2046-05-01', water_every: 3 });
  // The rain was 0.7 in on Sunday, May 6. Collards count it; the pothos does not.
  const card = await mine.card();
  expect(card.water.due.map((p) => p.name)).toEqual(['Pothos']);
  expect(card.water.skipped.map((p) => [p.name, p.water?.rain?.says])).toEqual([['Collards', 'Rain on Sunday: 0.7 in']]);
  expect((await mine.get(outside.id)).water?.due_on).toBe('2046-05-10');
  void inside;
  // The weather service was asked for the rain at the same rounded position as the forecast: the last week, nothing else.
  const asked = new URL(world.asked.find((u) => u.includes('daily=precipitation_sum'))!);
  expect([asked.searchParams.get('latitude'), asked.searchParams.get('longitude'), asked.searchParams.get('past_days')]).toEqual(['37.22', '-93.3', '7']);
  // Frost tonight and heat on Friday are on the card, from the forecast the front page already has.
  expect(card.warnings.map((w) => w.says)).toEqual(['Frost tonight: low 31°', 'Heat Friday: high 97°']);
  // Weather off: no rain is known, nothing is asked, and the plant is simply due.
  await weather(db, owner, clock(), world.fetcher).turnOff();
  const quiet = pretend();
  const dry = await garden(db, owner, clock(), { fetcher: quiet.fetcher }).card();
  expect([dry.water.due.map((p) => p.name), dry.water.skipped, dry.warnings, dry.weather, quiet.asked]).toEqual([['Collards', 'Pothos'], [], [], false, []]);
});

it('the card shows what to do this week for plants and seed packets, and only once gardening is checked', async () => {
  const mine = garden(db, owner, clock());
  const jobs = home(db, owner, clock());
  expect((await jobs.summary()).cards).not.toContain('garden');
  await life(db, owner, clock()).saveProfile(['keeping']);
  expect((await jobs.summary()).cards).not.toContain('garden');
  await life(db, owner, clock()).saveProfile(['keeping', 'gardening']);
  expect((await jobs.summary()).cards).toContain('garden');
  expect((await jobs.summary()).choices.some((c) => c.key === 'garden')).toBe(true);

  await mine.setFrost({ last_spring: '04-12', first_fall: '10-28' });
  await mine.addPlant({ name: 'Tomatoes', water_every: null });
  await mine.addSeeds({ name: 'Okra seeds', quantity: 1 });
  await mine.addSeeds({ name: 'Pea seeds' });
  const card = await mine.card();
  expect(card.week.map((w) => `${w.do} ${w.what}${w.seed ? ' (seeds)' : ''}`)).toEqual(['sow Okra seeds (seeds)', 'plant Tomatoes', 'feed Tomatoes']);
  expect([card.plants, card.seeds, (await mine.seeds()).map((s) => s.crop)]).toEqual([1, 2, ['Okra', 'Peas']]);
});

it('a harvest is logged with season totals, and can go into the pantry, adding to what is there', async () => {
  const mine = garden(db, owner, clock());
  const okra = await mine.addPlant({ name: 'Okra' });
  const first = await mine.harvest(okra.id, { amount: 2, unit: 'lb', note: 'First of the year', pantry: true });
  expect(first.pantry).toBe('okra is in your pantry');
  const second = await mine.harvest(okra.id, { day: '2046-05-10', amount: 1.5, unit: 'lb', pantry: true });
  expect(second.pantry).toBe('Added to the okra in your pantry');
  await mine.harvest(okra.id, { day: '2046-05-11', amount: 3, unit: 'pods' });
  await mine.harvest(okra.id, { day: '2045-09-01', amount: 4, unit: 'lb' });
  const shop = await kitchen(db, owner, clock()).listPantry();
  expect(shop.items.map((p) => [p.name, p.quantity, p.unit])).toEqual([['okra', 3.5, 'lb']]);
  const plant = await mine.get(okra.id);
  expect(plant.seasons.map((s) => [s.year, s.totals.map((t) => `${t.amount} ${t.unit} x${t.times}`)])).toEqual([[2046, ['3.5 lb x2', '3 pods x1']], [2045, ['4 lb x1']]]);
  expect(plant.harvested.totals).toEqual([{ unit: 'lb', amount: 3.5 }, { unit: 'pods', amount: 3 }]);
  expect(await mine.harvests()).toMatchObject({ year: 2046, totals: [{ unit: 'lb', amount: 3.5 }, { unit: 'pods', amount: 3 }], plants: [{ name: 'Okra' }] });
  await expect(mine.harvest(okra.id, { amount: -1 })).rejects.toEqual(problem(400));
  // Different units: the pantry's amount is left alone, and it says so.
  const odd = await mine.harvest(okra.id, { amount: 2, unit: 'bunches', pantry: true });
  expect(odd.pantry).toContain('already in your pantry');
  expect((await kitchen(db, owner, clock()).listPantry()).items[0]!.quantity).toBe(3.5);
});

it('how it did is kept and shown the next time it is planted; photos are kept here or linked, as plan photos are', async () => {
  const mine = garden(db, owner, clock());
  const fig = await mine.addPlant({ name: 'Fig tree', planted_on: '2045-03-01' });
  expect(fig.last_time).toBeNull();
  await mine.howItDid(fig.id, '  Too much shade by the fence. Try the sunny corner.  ');
  const again = await mine.planted(fig.id, '2046-03-20');
  expect([again.last_time, again.plant.planted_on]).toEqual(['Too much shade by the fence. Try the sunny corner.', '2046-03-20']);
  await expect(mine.planted(fig.id, 'someday')).rejects.toEqual(problem(400));

  const kept = await mine.keepPhoto(fig.id, PNG, 'In June');
  expect([kept.photos, kept.photos_list.map((p) => [p.source, p.caption])]).toEqual([1, [['kept', 'In June']]]);
  await expect(mine.keepPhoto(fig.id, Uint8Array.from([1, 2, 3]))).rejects.toEqual(problem(400));
  const linked = await mine.linkPhoto(fig.id, 'abc12345-def6');
  expect(linked.photos_list.map((p) => p.source)).toEqual(['kept', 'immich']);
  expect((await mine.linkPhoto(fig.id, 'abc12345-def6')).photos).toBe(2);
  await expect(mine.linkPhoto(fig.id, '../x')).rejects.toEqual(problem(400));
  expect(await mine.photo(kept.photos_list[0]!.id)).toMatchObject({ source: 'kept', type: 'image/png' });
  expect(await mine.photo(linked.photos_list[1]!.id)).toEqual({ source: 'immich', asset_id: 'abc12345-def6' });
  expect((await mine.captionPhoto(kept.photos_list[0]!.id, 'July')).photos_list[0]!.caption).toBe('July');
  expect((await mine.removePhoto(kept.photos_list[0]!.id)).photos).toBe(1);
});

it("nobody else's plants are reachable", async () => {
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')")).lastId;
  const plant = await garden(db, owner, clock()).addPlant({ name: 'Basil' });
  const theirs = garden(db, other, clock());
  await expect(theirs.get(plant.id)).rejects.toEqual(problem(404));
  await expect(theirs.water(plant.id)).rejects.toEqual(problem(404));
  await expect(theirs.harvest(plant.id, { amount: 1 })).rejects.toEqual(problem(404));
  await expect(theirs.keepPhoto(plant.id, PNG)).rejects.toEqual(problem(404));
  expect(await theirs.list()).toEqual([]);
});

it('plants, harvests, photos, how they did and frost dates go out in the download and come back, once', async () => {
  const mine = garden(db, owner, clock());
  const stuff = inventory(db, owner, clock());
  const bed = (await stuff.createPlace({ name: 'Back bed' })).find((p) => p.name === 'Back bed')!;
  const kid = (await upkeep(db, owner, clock()).addMember('Hank')).find((m) => m.name === 'Hank')!;
  const okra = await mine.addPlant({ name: 'Okra', place_id: bed.id, planted_on: '2046-05-01', assigned_member: kid.id, points: 2, water_every: 4 });
  await mine.harvest(okra.id, { day: '2046-06-01', amount: 2, unit: 'lb', note: 'Good' });
  await mine.howItDid(okra.id, 'Loved the heat');
  await mine.keepPhoto(okra.id, PNG, 'July');
  await mine.setFrost({ last_spring: '04-12', first_fall: '10-28' });

  const made = await exportEverything(db, owner, clock());
  const zip = await splitDownload(made.bytes);
  expect(zip.files['garden.csv']).toContain('Okra,Back bed,Vegetables and herbs,okra,outdoors,2046-05-01,4,Loved the heat');
  expect(zip.files['garden-harvests.csv']).toContain('Okra,Back bed,2046-06-01,2,lb,Good');
  expect(zip.files['garden-frost.csv']).toContain('04-12,10-28,typed');
  expect([...zip.pictures.keys()].some((p) => /^pictures\/garden\/Okra-\d+\/photo-\d+\.png$/.test(p))).toBe(true);
  expect(zip.files['README.txt']).toContain('garden.csv');

  // Into someone else, as a fresh Life Is: the plant comes back as a thing in its place with its watering, harvest, note and frost dates.
  const fresh = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('fresh', 'x', 'now')")).lastId;
  const keys = KINDS.filter((k) => k.importable).map((k) => k.key);
  const done = await bringInDownload(db, fresh, zip.files, keys, clock());
  for (const kind of done.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  expect(done.kinds.find((k) => k.key === 'garden')).toMatchObject({ found: 1, fresh: 1, pictures: 1 });
  const photos = [...zip.pictures.entries()].filter(([p]) => p.startsWith('pictures/garden/'));
  const sent = done.pending.filter((p) => p.as === 'plant-photo').map((p) => ({ as: 'plant-photo' as const, id: p.id, name: p.name, bytes: photos[0]![1] }));
  expect(await bringInPictures(db, fresh, sent, clock())).toEqual({ kept: 1, left: 0 });
  const theirs = garden(db, fresh, clock());
  const [back] = await theirs.list();
  expect(back).toMatchObject({ name: 'Okra', place: 'Back bed', crop: 'okra', planted_on: '2046-05-01', how_it_did: 'Loved the heat', water_every: 4, points: 2, photos: 1 });
  expect(back!.member?.name).toBe('Hank');
  expect(back!.water_job_id).not.toBeNull();
  expect((await theirs.get(back!.id)).harvests).toMatchObject([{ day: '2046-06-01', amount: 2, unit: 'lb', note: 'Good' }]);
  expect(await theirs.frost()).toMatchObject({ last_spring: '04-12', first_fall: '10-28', how: 'typed' });

  // A second time adds nothing.
  const again = await bringInDownload(db, fresh, zip.files, keys, clock());
  expect(again.kinds.find((k) => k.key === 'garden')).toMatchObject({ found: 1, fresh: 0, already: 1 });
  expect((await theirs.list()).length).toBe(1);
  expect((await theirs.get(back!.id)).harvests).toHaveLength(1);
  // The first person's own are untouched.
  expect((await mine.list()).map((p) => p.name)).toEqual(['Okra']);

  // An older download without the garden files still comes in.
  const old = { ...zip.files };
  for (const name of ['garden.csv', 'garden-harvests.csv', 'garden-frost.csv', 'garden-photos.csv']) delete old[name];
  const third = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('third', 'x', 'now')")).lastId;
  const older = await bringInDownload(db, third, old, keys, clock());
  for (const kind of older.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  expect(older.kinds.find((k) => k.key === 'garden')).toMatchObject({ found: 0, fresh: 0 });
});
