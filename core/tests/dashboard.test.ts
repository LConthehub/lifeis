/** Yearly dates, the week in numbers, and the weather: the front page's newer cards. */
import { beforeEach, expect, it } from 'vitest';
import { calendar, type Calendar } from '../src/calendar.ts';
import type { Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { home } from '../src/home.ts';
import { kitchen } from '../src/kitchen.ts';
import { life } from '../src/life.ts';
import { media } from '../src/media.ts';
import { migrate } from '../src/migrations.ts';
import { projects } from '../src/projects.ts';
import { weather } from '../src/weather.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let dates: Calendar;
let time: Date;
const clock = () => time;
const MONDAY = '2046-03-05';

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  dates = calendar(db, owner, clock);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

// ---------- dates that come round every year ----------

it('a birthday is kept once and shows every year after, saying how many years', async () => {
  const mum = await dates.createEvent({ title: "Mum's birthday", day: '1958-03-07', yearly: true });
  expect([mum.yearly, mum.day]).toEqual([true, '1958-03-07']);
  await dates.createEvent({ title: 'Dentist', day: '2046-03-07' });
  await dates.createEvent({ title: 'Wedding day', day: '2046-03-09', yearly: true, note: 'book the table' });

  const week = await dates.between(MONDAY, 7);
  expect(week.map((e) => [e.day, e.title, e.detail, e.id])).toEqual([
    ['2046-03-07', 'Dentist', null, expect.any(Number)], ['2046-03-07', "Mum's birthday", '88 years', mum.id],
    ['2046-03-09', 'Wedding day', 'book the table', expect.any(Number)], // its first year: nothing to count yet
  ]);
  expect((await dates.between('2047-03-08', 3)).map((e) => [e.day, e.title, e.detail])).toEqual([['2047-03-09', 'Wedding day', '1 year · book the table']]);
  expect(await dates.between('2045-03-08', 3)).toEqual([]); // not before it first happened
  expect((await dates.getEvent(mum.id)).yearly).toBe(true);

  // Across the turn of a year, and the next ones coming.
  await dates.createEvent({ title: 'New Year', day: '2040-01-01', yearly: true });
  expect((await dates.yearly('2046-12-20', 30)).map((d) => [d.day, d.title, d.years])).toEqual([['2047-01-01', 'New Year', 7]]);
  expect((await dates.yearly(MONDAY, 30)).map((d) => d.title)).toEqual(["Mum's birthday", 'Wedding day']);

  // It stops being yearly when unticked, and can't run over several days.
  await dates.updateEvent(mum.id, { title: "Mum's birthday", day: '1958-03-07' });
  expect((await dates.between(MONDAY, 7)).map((e) => e.title)).toEqual(['Dentist', 'Wedding day']);
  await expect(dates.createEvent({ title: 'Holiday', day: MONDAY, end_day: '2046-03-08', yearly: true })).rejects.toEqual(problem(400));
});

it('the 29th of February is kept on the 28th in years without one', async () => {
  await dates.createEvent({ title: 'Leap day baby', day: '2044-02-29', yearly: true });
  expect((await dates.between('2046-02-27', 3)).map((e) => [e.day, e.detail])).toEqual([['2046-02-28', '2 years']]);
  expect((await dates.between('2048-02-27', 3)).map((e) => [e.day, e.detail])).toEqual([['2048-02-29', '4 years']]);
});

// ---------- the front page ----------

it('the front page shows the yearly dates coming, and the week in numbers', async () => {
  await dates.createEvent({ title: "Mum's birthday", day: '1958-03-07', yearly: true });
  await dates.createEvent({ title: 'Far off', day: '2040-09-01', yearly: true });
  await dates.createEvent({ title: 'Dentist', day: '2046-03-06' });
  await dates.createEvent({ title: 'Last week', day: '2046-03-04' });
  const k = kitchen(db, owner, clock);
  const soup = await k.addPlan({ day: MONDAY, meal: 'dinner', title: 'Soup' });
  await k.addPlan({ day: '2046-03-11', meal: 'dinner', title: 'Roast' });
  await k.addPlan({ day: '2046-03-12', meal: 'dinner', title: 'Next week' });
  await k.cooked(soup.id);
  const making = projects(db, owner, clock);
  const dress = await making.createProject({ name: 'Shirt dress', status: 'active' });
  const shelf = media(db, owner, clock);
  const alien = await shelf.create({ type: 'film', title: 'Alien' });
  await making.addSession(dress.id, { day: MONDAY, minutes: 90, media_ids: [alien.id] });
  await making.addSession(dress.id, { day: '2046-03-06', minutes: 45 });
  await shelf.log(alien.id, { day: '2046-03-06' });

  time = new Date(2046, 2, 7, 10, 0, 0); // Wednesday: the week is still Monday to Sunday
  const s = await home(db, owner, clock).summary();
  expect(s.coming.lines.filter((l) => l.kind === 'birthday').map((l) => [l.start_day, l.name, l.years])).toEqual([['2046-03-07', "Mum's birthday", 88]]);
  expect(s.week).toEqual({ start: MONDAY, end: '2046-03-11', events: 2, meals_planned: 2, meals_cooked: 1, sessions: 2, minutes: 135, enjoyed: 1 });

  // Numbers only for the sections a person uses.
  await life(db, owner, clock).saveProfile(['eating']);
  expect((await home(db, owner, clock).summary()).week).toEqual({ start: MONDAY, end: '2046-03-11', events: null, meals_planned: 2, meals_cooked: 1, sessions: null, minutes: null, enjoyed: null });
});

// ---------- the weather ----------

const FORECAST = {
  current: { time: '2046-03-05T10:00', temperature_2m: 44.6, weather_code: 0 },
  daily: { time: ['2046-03-05', '2046-03-06', '2046-03-07'], weather_code: [0, 3, 55], temperature_2m_max: [70.7, 71.2, 59.7],
    temperature_2m_min: [43.2, 45.2, 41.2], precipitation_probability_max: [0, 3, 82] },
};
const PLACES = { results: [{ name: 'Springfield', admin1: 'Missouri', country: 'United States', latitude: 37.21533, longitude: -93.29824, timezone: 'America/Chicago' }, { name: 'Nameless' }] };

/** A stand-in for the outside world: remembers every address asked. */
function pretend(): { fetcher: Fetcher; asked: string[]; down: boolean } {
  const world = {
    asked: [] as string[], down: false,
    fetcher: (async (url) => {
      world.asked.push(url);
      if (world.down) throw new Error('no network');
      const data = url.startsWith('https://geocoding-api.open-meteo.com/') ? PLACES : FORECAST;
      return { status: 200, type: 'application/json', json: async () => data, bytes: async () => new Uint8Array() };
    }) as Fetcher,
  };
  return world;
}

it('the weather is off until a place is chosen, and asks nothing until then', async () => {
  const world = pretend();
  const skies = weather(db, owner, clock, world.fetcher);
  expect(await skies.status()).toEqual({ available: true, place: null, saved: null, forecast: null });
  let s = await home(db, owner, clock, world.fetcher).summary();
  expect([s.cards.includes('weather'), s.choices.some((c) => c.key === 'weather'), s.weather]).toEqual([false, false, null]);
  expect(world.asked).toEqual([]);

  // Looking for the town sends only its name.
  expect(await skies.findPlaces(' Springfield ')).toEqual([{ name: 'Springfield', region: 'Missouri', country: 'United States', latitude: 37.21533, longitude: -93.29824 }]);
  expect(world.asked).toEqual(['https://geocoding-api.open-meteo.com/v1/search?name=Springfield&count=6&language=en&format=json']);
  await expect(skies.findPlaces(' ')).rejects.toEqual(problem(400));

  // Turning it on keeps the place, rounded; the forecast asks with that and nothing else.
  const on = await skies.turnOn({ name: 'Springfield, Missouri', latitude: 37.21533, longitude: -93.29824 });
  expect(on.place).toEqual({ name: 'Springfield, Missouri', latitude: 37.22, longitude: -93.3, units: 'f' });
  expect(on.forecast).toEqual({
    now: { temperature: 45, words: 'Clear', icon: '☀️' }, at: time.toISOString(),
    days: [{ day: '2046-03-05', words: 'Clear', icon: '☀️', high: 71, low: 43, wet: 0 }, { day: '2046-03-06', words: 'Overcast', icon: '☁️', high: 71, low: 45, wet: 3 },
      { day: '2046-03-07', words: 'Drizzle', icon: '🌦', high: 60, low: 41, wet: 82 }],
  });
  const asked = new URL(world.asked[1]!);
  expect([asked.origin + asked.pathname, Object.fromEntries(asked.searchParams)]).toEqual(['https://api.open-meteo.com/v1/forecast', {
    latitude: '37.22', longitude: '-93.3', current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto', forecast_days: '3', temperature_unit: 'fahrenheit' }]);

  s = await home(db, owner, clock, world.fetcher).summary();
  expect([s.cards.slice(0, 2), s.weather!.place.name, s.weather!.forecast!.now.temperature]).toEqual([['days', 'weather'], 'Springfield, Missouri', 45]);
  expect(world.asked).toHaveLength(2); // the forecast is kept for half an hour, not asked for on every look

  // Later it is asked again; if the service is away, the last forecast stands in.
  time = new Date(time.getTime() + 31 * 60_000);
  world.down = true;
  expect((await skies.status()).forecast!.now.temperature).toBe(45);
  expect(world.asked).toHaveLength(3);

  // Someone else in the house has their own choice, and theirs is off.
  expect((await weather(db, await person('other'), clock, world.fetcher).status()).place).toBeNull();

  // Off forgets the place and the forecast, and nothing more is asked.
  expect(await skies.turnOff()).toEqual({ available: true, place: null, saved: null, forecast: null });
  expect((await db.all('SELECT key FROM user_settings WHERE user_id = ?', [owner])).map((r) => r.key).filter((key) => String(key).startsWith('weather'))).toEqual([]);
  expect((await home(db, owner, clock, world.fetcher).summary()).weather).toBeNull();
  expect(world.asked).toHaveLength(3);
});

it('weather needs a real place, and a copy of Life Is that can reach outside', async () => {
  const world = pretend();
  const skies = weather(db, owner, clock, world.fetcher);
  await expect(skies.turnOn({ name: 'Nowhere', latitude: 123, longitude: 0 })).rejects.toEqual(problem(400));
  await expect(skies.turnOn({ name: 'Paris', latitude: 48.85, longitude: 2.35, units: 'kelvin' })).rejects.toEqual(problem(400));
  expect((await skies.turnOn({ name: 'Paris', latitude: 48.85, longitude: 2.35, units: 'c' })).place!.units).toBe('c');
  expect(new URL(world.asked[0]!).searchParams.get('temperature_unit')).toBe('celsius');

  const cut = weather(db, owner, clock);
  expect((await cut.status()).available).toBe(false);
  await expect(cut.findPlaces('Paris')).rejects.toEqual(problem(400));
});
