/** Recall alerts for cars: tried against a stand-in for NHTSA, so these tests never reach outside. */
import { beforeEach, expect, it } from 'vitest';
import type { Answer, Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { RECALL_SERVICE, NOT_LISTED, recallAddress, recalls, recallsDue, reportedDay, vehiclesOf } from '../src/recalls.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let time: Date;
let asked: { url: string; headers: Record<string, string> }[];
let answers: Record<string, { status: number; body: unknown } | 'down'>;
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

const VIN = '4S4BTGPD5L3123456';
const recall = (campaign: string, extra: object = {}) => ({
  NHTSACampaignNumber: campaign, Manufacturer: 'Subaru of America, Inc.', Component: 'STRUCTURE', Summary: `Summary of ${campaign}.  Spot welds may be bad.`,
  Consequence: 'Risk of injury.', Remedy: 'Dealers will inspect, free of charge.', Notes: 'Call us.', ModelYear: '2019', Make: 'SUBARU', Model: 'OUTBACK',
  ReportReceivedDate: '26/06/2019', parkIt: false, parkOutSide: false, overTheAirUpdate: false, ...extra,
});
const OUTBACK_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle?make=Subaru&model=Outback&modelYear=2019';

const fetcher: Fetcher = async (url, headers) => {
  asked.push({ url, headers });
  const a = answers[url];
  if (a === 'down') throw new Error('socket hang up');
  const found = a ?? { status: 400, body: { Count: 0, Message: 'Results returned successfully', results: [] } };
  return { status: found.status, type: 'application/json', json: async () => found.body, bytes: async () => new Uint8Array() } satisfies Answer;
};
const mine = (who = owner) => recalls(db, who, clock, fetcher);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
async function carKind(inv: Inventory) {
  const kind = (await inv.createKind({ name: 'Vehicles', fields: [{ name: 'Make', type: 'text' }, { name: 'Model', type: 'text' }, { name: 'Year', type: 'number' }, { name: 'VIN', type: 'text' }] }))[0]!;
  const id = (name: string) => String(kind.fields.find((f) => f.name === name)!.id);
  return { kind, car: (name: string, v: { make?: string; model?: string; year?: string | number; vin?: string }) => inv.createItem({
    kind_id: kind.id, name,
    values: { ...(v.make && { [id('Make')]: v.make }), ...(v.model && { [id('Model')]: v.model }), ...(v.year !== undefined && { [id('Year')]: v.year }), ...(v.vin && { [id('VIN')]: v.vin }) },
  }) };
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2026, 10, 22, 10, 0, 0);
  things = inventory(db, owner, clock);
  asked = [];
  answers = {};
});

it('says what it sends, and is off until turned on, when nothing is asked', async () => {
  expect(RECALL_SERVICE.name).toBe('Recall alerts');
  expect(RECALL_SERVICE.site).toContain('nhtsa.gov');
  expect(RECALL_SERVICE.sends).toMatch(/make, model and year/);
  expect(RECALL_SERVICE.sends).toMatch(/No VIN, no name, no account, no key/);
  const { car } = await carKind(things);
  await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  expect(await mine().status()).toMatchObject({ available: true, on: false });
  await expect(mine().check({ force: true })).rejects.toEqual(problem(400));
  expect(asked).toEqual([]);
  expect(await mine().list()).toMatchObject({ on: false, vehicles: [] });
});

it('a copy that cannot reach outside refuses to turn it on', async () => {
  const none = recalls(db, owner, clock, undefined);
  expect((await none.status()).available).toBe(false);
  await expect(none.turn(true)).rejects.toEqual(expect.objectContaining({ status: 400, message: expect.stringContaining("isn't set up to reach outside") }));
});

it('a car with a make, model and year is asked about with those and nothing else', async () => {
  const { car } = await carKind(things);
  await car("Dad's wagon", { make: 'Subaru', model: 'Outback', year: 2019, vin: VIN });
  await mine().turn(true);
  answers[OUTBACK_URL] = { status: 200, body: { Count: 1, Message: 'ok', results: [recall('19V493000')] } };
  const done = await mine().check();
  expect(done).toMatchObject({ asked: 1, found: 1, not_listed: 0, failed: 0 });
  expect(asked.map((a) => a.url)).toEqual([OUTBACK_URL]);
  const everything = JSON.stringify(asked);
  for (const secret of [VIN, 'owner', "Dad's wagon", 'Dad']) expect(everything).not.toContain(secret);
  expect(Object.keys(asked[0]!.headers).sort()).toEqual(['Accept', 'User-Agent']);
  const [v] = (await mine().list()).vehicles;
  expect(v!.recalls[0]).toMatchObject({ campaign: '19V493000', component: 'STRUCTURE', remedy: 'Dealers will inspect, free of charge.', reported_on: '2019-06-26', park_it: false, park_outside: false });
  expect(v!.recalls[0]!.summary).toBe('Summary of 19V493000.  Spot welds may be bad.'); // NHTSA's own words, untouched
});

it('a make or model with spaces and odd characters is encoded in the address', () => {
  expect(recallAddress('https://api.nhtsa.gov/', { make: 'Land Rover', model: 'Range Rover & Sport', year: 2015 }))
    .toBe('https://api.nhtsa.gov/recalls/recallsByVehicle?make=Land%20Rover&model=Range%20Rover%20%26%20Sport&modelYear=2015');
});

it('a thing missing the year is not sent, and is listed as needing details; names are not guessed from', async () => {
  const { car } = await carKind(things);
  await car('Outback 2019', { make: 'Subaru', model: 'Outback' });
  await car('Nothing filled in', {});
  await car('Typo year', { make: 'Honda', model: 'Civic', year: 19 });
  await car('Far future', { make: 'Honda', model: 'Civic', year: 2099 });
  const found = await vehiclesOf(db, owner, clock);
  expect(found.vehicles).toEqual([]);
  expect(found.needs.map((n) => [n.name, n.missing])).toEqual([
    ['Far future', ['Year']], ['Nothing filled in', ['Make', 'Model', 'Year']], ['Outback 2019', ['Year']], ['Typo year', ['Year']],
  ]);
  await mine().turn(true);
  expect(await mine().check()).toMatchObject({ asked: 0 });
  expect(asked).toEqual([]);
  expect((await mine().status()).needs_details).toHaveLength(4);
});

it('a kind without Make, Model and Year is never a car, whatever its name says', async () => {
  const kind = (await things.createKind({ name: 'Garage', fields: [{ name: 'Make', type: 'text' }] }))[0]!;
  await things.createItem({ kind_id: kind.id, name: 'Honda Civic 2018', values: { [String(kind.fields[0]!.id)]: 'Honda' } });
  expect(await vehiclesOf(db, owner, clock)).toEqual({ vehicles: [], needs: [] });
});

it('field names are compared the way the rest of the code does', async () => {
  const kind = (await things.createKind({ name: 'Rides', fields: [{ name: ' make ', type: 'text' }, { name: 'MODEL', type: 'text' }, { name: 'year', type: 'number' }] }))[0]!;
  const v = Object.fromEntries(kind.fields.map((f) => [f.name.trim().toLowerCase(), String(f.id)]));
  await things.createItem({ kind_id: kind.id, name: 'Truck', values: { [v.make!]: 'Ford', [v.model!]: 'F-150', [v.year!]: 2016 } });
  expect((await vehiclesOf(db, owner, clock)).vehicles).toMatchObject([{ make: 'Ford', model: 'F-150', year: 2016 }]);
});

it('recalls are stored once across two checks, and one that is dismissed stays dismissed', async () => {
  const { car } = await carKind(things);
  await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  await mine().turn(true);
  answers[OUTBACK_URL] = { status: 200, body: { results: [recall('A1', { ReportReceivedDate: '01/01/2019' }), recall('B2', { parkOutSide: true }), recall('C3', { parkIt: true })] } };
  await mine().check();
  let [v] = (await mine().list()).vehicles;
  // Most serious first: do not drive, then park outside, then the rest.
  expect(v!.recalls.map((r) => [r.campaign, r.park_it, r.park_outside])).toEqual([['C3', true, false], ['B2', false, true], ['A1', false, false]]);
  const b2 = v!.recalls[1]!;
  const dismissed = await mine().dismiss(b2.id);
  expect(dismissed.dismissed_at).not.toBeNull();
  time = new Date(2026, 10, 22, 12, 30, 0); // more than an hour later
  await mine().check();
  expect(await db.get('SELECT COUNT(*) AS n FROM vehicle_recalls')).toEqual({ n: 3 });
  [v] = (await mine().list()).vehicles;
  expect(v!.recalls.map((r) => r.campaign)).toEqual(['C3', 'A1']);
  expect(v).toMatchObject({ open: 2, dismissed: 1 });
  const [put] = (await mine().list({ dismissed: true })).vehicles;
  expect(put!.recalls.map((r) => r.campaign)).toEqual(['B2']);
  expect((await mine().restore(b2.id)).dismissed_at).toBeNull();
  expect((await mine().list()).vehicles[0]!.recalls).toHaveLength(3);
});

it('a recall that disappears from the answer is kept, and can still be dismissed', async () => {
  const { car } = await carKind(things);
  const outback = await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  await mine().turn(true);
  answers[OUTBACK_URL] = { status: 200, body: { results: [recall('A1')] } };
  await mine().check();
  answers[OUTBACK_URL] = { status: 200, body: { results: [] } };
  time = new Date(2026, 10, 22, 12, 30, 0);
  await mine().check();
  const thing = await mine().forThing(outback.id);
  expect(thing.vehicle!.recalls.map((r) => r.campaign)).toEqual(['A1']);
  await mine().dismiss(thing.vehicle!.recalls[0]!.id);
  expect((await mine().forThing(outback.id)).vehicle!.recalls).toEqual([]);
});

it('a 400 is recorded as not listed, not as an error, and a recall already kept stays', async () => {
  const { car } = await carKind(things);
  await car('Mystery', { make: 'Zorg', model: 'Z1', year: 2020 });
  await mine().turn(true);
  const done = await mine().check();
  expect(done).toMatchObject({ asked: 1, found: 0, not_listed: 1, failed: 0 });
  const [v] = done.status.vehicles;
  expect(v).toMatchObject({ result: 'not_listed', message: NOT_LISTED, open: 0 });
});

it('one car failing does not stop another, and a failure keeps what was known', async () => {
  const { car } = await carKind(things);
  await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  await car('Civic', { make: 'Honda', model: 'Civic', year: 2018 });
  await mine().turn(true);
  answers[OUTBACK_URL] = { status: 200, body: { results: [recall('A1')] } };
  answers['https://api.nhtsa.gov/recalls/recallsByVehicle?make=Honda&model=Civic&modelYear=2018'] = 'down';
  const done = await mine().check();
  expect(done).toMatchObject({ asked: 2, found: 1, failed: 1 });
  expect(asked).toHaveLength(2);
  expect(done.status.vehicles.map((v) => [v.name, v.result, v.open])).toEqual([['Civic', 'failed', 0], ['Outback', 'ok', 1]]);
  // Later the Subaru answers badly: what was found before is still there.
  answers[OUTBACK_URL] = { status: 503, body: {} };
  time = new Date(2026, 10, 22, 12, 30, 0);
  const again = await mine().check();
  expect(again).toMatchObject({ failed: 2 });
  expect(again.status.vehicles.find((v) => v.name === 'Outback')).toMatchObject({ result: 'failed', open: 1 });
});

it('a second check within the hour is refused unless forced, and even forcing waits a few seconds', async () => {
  const { car } = await carKind(things);
  await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  await mine().turn(true);
  await mine().check();
  expect(asked).toHaveLength(1);
  time = new Date(2026, 10, 22, 10, 30, 0);
  await expect(mine().check()).rejects.toEqual(problem(400));
  expect(asked).toHaveLength(1);
  await mine().check({ force: true });
  expect(asked).toHaveLength(2);
  time = new Date(2026, 10, 22, 10, 30, 5);
  await expect(mine().check({ force: true })).rejects.toEqual(problem(400));
  expect(asked).toHaveLength(2);
  time = new Date(2026, 10, 22, 11, 31, 0);
  await mine().check();
  expect(asked).toHaveLength(3);
});

it("another person's cars are never sent or shown", async () => {
  const { car } = await carKind(things);
  await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  const other = await person('other');
  const theirs = await carKind(inventory(db, other, clock));
  const civic = await theirs.car('Civic', { make: 'Honda', model: 'Civic', year: 2018 });
  await mine().turn(true);
  await mine().check();
  expect(asked.map((a) => a.url)).toEqual([OUTBACK_URL]);
  // The other person hasn't turned it on: nothing of theirs is asked, and nothing of mine is theirs to see.
  await expect(mine(other).check({ force: true })).rejects.toEqual(problem(400));
  expect((await mine(other).list()).vehicles).toEqual([]);
  await expect(mine().forThing(civic.id)).rejects.toEqual(problem(404));
  answers[OUTBACK_URL] = { status: 200, body: { results: [recall('A1')] } };
  time = new Date(2026, 10, 22, 12, 30, 0);
  await mine().check();
  const id = (await mine().list()).vehicles[0]!.recalls[0]!.id;
  await expect(mine(other).dismiss(id)).rejects.toEqual(problem(404));
  await mine(other).turn(true);
  expect((await mine(other).status()).vehicles.map((v) => v.name)).toEqual(['Civic']);
  expect((await mine(other).list()).vehicles[0]!.recalls).toEqual([]);
});

it('changing a car so that it is another make, model or year forgets what was found for the old one', async () => {
  const { car, kind } = await carKind(things);
  const outback = await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  await mine().turn(true);
  answers[OUTBACK_URL] = { status: 200, body: { results: [recall('A1')] } };
  await mine().check();
  const year = String(kind.fields.find((f) => f.name === 'Year')!.id);
  await things.updateItem(outback.id, { name: 'Outback', values: { [String(kind.fields.find((f) => f.name === 'Make')!.id)]: 'Subaru', [String(kind.fields.find((f) => f.name === 'Model')!.id)]: 'Outback', [year]: 2020 } });
  expect((await mine().status()).vehicles[0]).toMatchObject({ year: 2020, result: null });
  time = new Date(2026, 10, 22, 12, 30, 0);
  await mine().check();
  expect(asked[1]!.url).toContain('modelYear=2020');
  expect((await mine().list()).vehicles[0]!.recalls).toEqual([]);
});

it('the weekly check is due for those with it on, never checked or last checked over a week ago', async () => {
  const { car } = await carKind(things);
  await car('Outback', { make: 'Subaru', model: 'Outback', year: 2019 });
  const other = await person('other');
  expect(await recallsDue(db, clock)).toEqual([]); // off
  await mine().turn(true);
  await mine(other).turn(true);
  expect(await recallsDue(db, clock)).toEqual([owner, other]);
  await mine().check();
  time = new Date(2026, 10, 28, 10, 0, 0);
  expect(await recallsDue(db, clock)).toEqual([other]);
  time = new Date(2026, 11, 1, 10, 0, 0);
  expect(await recallsDue(db, clock)).toEqual([owner, other]);
  await mine().turn(false);
  expect(await recallsDue(db, clock)).toEqual([other]);
});

it("NHTSA's day, written day first, is read as a day", () => {
  expect(reportedDay('28/05/2020')).toBe('2020-05-28');
  expect(reportedDay('31/02/2020')).toBeNull();
  expect(reportedDay('2020-05-28')).toBeNull();
  expect(reportedDay(undefined)).toBeNull();
});
