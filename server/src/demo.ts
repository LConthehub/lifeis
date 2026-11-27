/**
 * Demo mode: a copy of Life Is filled with a made-up household, for anyone to try.
 *
 * Turned on with DEMO_MODE=1 (see docker-compose.demo.yml). Then:
 * - The database is emptied and refilled with sample recipes, things, upkeep, pets and the rest, dated around
 *   today, when it starts and again every night, so visitors can change anything.
 * - Visitors sign in as DEMO_USERNAME / DEMO_PASSWORD, an ordinary account; the sign-in page offers it. The
 *   admin account gets a random password nobody knows, so nobody can add people.
 * - Changing the demo password is refused, so one visitor can't lock the others out.
 * - Nothing reaches outside: no email, look-ups, weather, calendars to follow or reminders to send. And the
 *   house manual can't be shared by link, so the demo can't be used to put words on a public page.
 *
 * Never point DEMO_MODE at a real database: a reset deletes everything in it.
 */
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import {
  budget, calendar, displayName, goals, holidays, homeServices, inventory, kitchen, life, manual, media, mediaLists, money, outdoorTrips, packing, pets, projects, routines, upkeep, type Db,
} from '../../core/src/index.ts';
import { AREAS } from '../../core/src/life.ts';
import { addDays } from '../../core/src/small.ts';
import * as auth from './auth.ts';

export type Demo = { username: string; password: string };

/** The demo's sign-in, from the environment; null when this isn't a demo. Refuses to start one without a password. */
export function demoFromEnv(env: NodeJS.ProcessEnv = process.env): Demo | null {
  if (env.DEMO_MODE !== '1') return null;
  const username = (env.DEMO_USERNAME || 'demo').trim().toLowerCase();
  const password = env.DEMO_PASSWORD || '';
  if (password.length < auth.MIN_PASSWORD_LENGTH) throw new Error(`DEMO_PASSWORD must be set (at least ${auth.MIN_PASSWORD_LENGTH} characters) when DEMO_MODE=1`);
  return { username, password };
}

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Empty every table and fill the database with the sample household. */
export async function resetDemo(db: Db, demo: Demo): Promise<void> {
  const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((t) => t.name);
  await db.run('PRAGMA foreign_keys = OFF');
  try {
    for (const table of tables) await db.run(`DELETE FROM "${table}"`);
    await db.run('DELETE FROM sqlite_sequence').catch(() => {});
  } finally {
    await db.run('PRAGMA foreign_keys = ON');
  }
  const now = new Date().toISOString();
  await db.run('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)', ['demo-admin', await auth.hashPassword(randomBytes(24).toString('base64url')), now]);
  const made = await db.run('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)', [demo.username, await auth.hashPassword(demo.password), now]);
  await fill(db, made.lastId);
}

/** The sample household: a little of everything, so each page has something on it. */
async function fill(db: Db, me: number): Promise<void> {
  const day = (offset: number) => addDays(today(), offset);
  await life(db, me).saveProfile(AREAS.map((a) => a.key));
  await displayName(db, me).set('Charlie');

  // ---- eating ----
  const k = kitchen(db, me);
  const soup = await k.createRecipe({ title: 'Leek and potato soup', servings: 4, ingredients_text: '3 leeks, sliced\n2 large potatoes, diced\n1 onion\n4 cups vegetable broth\n1/2 cup heavy cream', steps_text: 'Soften the leeks and onion in butter.\nAdd the potatoes and broth; simmer 20 minutes.\nBlend, then stir in the cream.', tags: ['soup', 'winter'] });
  const tacos = await k.createRecipe({ title: 'Sheet-pan chicken tacos', servings: 4, ingredients_text: '1.5 lb chicken thighs\n2 bell peppers\n1 red onion\n2 tbsp taco seasoning\n8 tortillas\n1 lime', steps_text: 'Toss everything but the tortillas with the seasoning.\nRoast at 425°F for 25 minutes.\nServe in warm tortillas with lime.', tags: ['weeknight'] });
  const muffins = await k.createRecipe({ title: 'Blueberry muffins', servings: 12, ingredients_text: '2 cups flour\n3/4 cup sugar\n2 tsp baking powder\n1 egg\n1 cup milk\n1/3 cup oil\n1.5 cups blueberries', steps_text: 'Mix dry and wet separately, then fold together with the berries.\nBake at 400°F for 20 minutes.', tags: ['baking', 'breakfast'] });
  await k.createRecipe({ title: "Grandma's Sunday pot roast", servings: 6, ingredients_text: '3 lb chuck roast\n4 carrots\n3 potatoes\n1 onion\n2 cups beef broth\n2 sprigs rosemary', steps_text: 'Brown the roast on all sides.\nAdd everything else, cover, and cook low for 3 hours.', tags: ['sunday'] });
  await k.addPlan({ day: day(0), meal: 'dinner', recipe_id: tacos.id });
  await k.addPlan({ day: day(1), meal: 'dinner', recipe_id: soup.id });
  await k.addPlan({ day: day(2), meal: 'breakfast', recipe_id: muffins.id });
  for (const item of ['1 gallon milk', '1 dozen eggs', 'Tortillas', 'Limes', 'Dish soap', 'Cheerwine']) await k.addGrocery({ label: item });
  await k.savePantry({ name: 'Flour', quantity: 3, unit: 'lb', low_at: 1 });
  await k.savePantry({ name: 'Cream', quantity: 1, unit: 'cup', expires_on: day(2) });
  await k.savePantry({ name: 'Vegetable broth', quantity: 2, unit: 'cup', low_at: 4 });
  await k.savePantry({ name: "Duke's mayonnaise", quantity: 1, unit: 'jar', low_at: 1 });
  await k.savePantry({ name: 'Texas Pete hot sauce', quantity: 2, unit: 'bottle' });

  // ---- keeping: places, things with their records ----
  const things = inventory(db, me);
  await things.addStarter('home');
  await things.addStarter('sewing');
  const kinds = await things.listKinds();
  const kind = (name: string) => (kinds.find((x) => x.name === name) ?? kinds[0]!).id;
  const household = (kinds.find((x) => x.name === 'Tools') ?? kinds.find((x) => x.name === 'Household'))?.id ?? (await things.createKind({ name: 'Household', icon: '🏠' })).find((x) => x.name === 'Household')!.id;
  const place = async (name: string, parent: number | null = null) => (await things.createPlace({ name, parent_id: parent })).filter((p) => p.name === name && p.parent_id === parent).at(-1)!.id;
  const garage = await place('Garage');
  const toolShelf = await place('Tool shelf', garage);
  const living = await place('Living room');
  const kitchenRoom = await place('Kitchen');
  const sewing = await place('Sewing room');
  const fabricBin = await place('Fabric bin', sewing);
  const basement = await place('Basement');
  const kidsRoom = await place("Hank's room");
  const bookshelf = await place('Bookshelf', kidsRoom);

  const tv = await things.createItem({ kind_id: household, name: 'Television', place_id: living, insured: true, own_fields: [{ name: 'Remote', value: 'In the drawer' }], records: { bought_on: day(-400), bought_at: 'Costco', price_cents: 79900, value_cents: 55000, model: 'QN55', serial: 'SN-48213-A', warranty_until: day(30) } });
  await things.createItem({ kind_id: household, name: 'Stand mixer', place_id: kitchenRoom, records: { bought_on: day(-900), price_cents: 32900, serial: 'KM-77120' }, activities: ['Baking'] });
  const drill = await things.createItem({ kind_id: household, name: 'Cordless drill', place_id: toolShelf, records: { price_cents: 12900, model: 'DCD771' }, activities: ['Woodworking', 'Home maintenance'] });
  const ladder = await things.createItem({ kind_id: household, name: 'Step ladder', place_id: garage, activities: ['Home maintenance', 'Painting'] });
  const filters = await things.createItem({ kind_id: household, name: 'Furnace filter 16x25', quantity: 1, low_at: 1, place_id: basement });
  const car = await things.createItem({ kind_id: household, name: 'The car', place_id: garage, records: { model: 'Outback 2019' } });
  await things.createItem({ kind_id: household, name: 'Motor oil', quantity: 5, unit: 'qt', low_at: 5, place_id: garage });
  const machine = await things.createItem({ kind_id: household, name: 'Sewing machine', place_id: sewing, activities: ['Sewing'], records: { price_cents: 24900, serial: 'JN-20931' } });
  const fabric = kinds.find((x) => x.name === 'Fabric');
  const linen = await things.createItem({ kind_id: fabric?.id ?? kind('Fabric'), name: 'Blue linen', quantity: 4, unit: 'yd', place_id: fabricBin, activities: ['Sewing'] });
  await things.createItem({ kind_id: fabric?.id ?? kind('Fabric'), name: 'Striped cotton', quantity: 1.5, unit: 'yd', low_at: 2, place_id: fabricBin, activities: ['Sewing'] });
  await things.moveItem(drill.id, garage, 'left out after the shelf job');
  await things.moveItem(drill.id, toolShelf);

  // ---- enjoying ----
  const shelf = media(db, me);
  await shelf.create({ type: 'book', title: 'The Hobbit', creator: 'J.R.R. Tolkien', year: 1937, genres: ['Fantasy'] }, { format: 'Paperback', place_id: bookshelf });
  await shelf.create({ type: 'book', title: 'Salt, Fat, Acid, Heat', creator: 'Samin Nosrat', year: 2017, genres: ['Cooking'] }, { format: 'Hardcover', place_id: kitchenRoom });
  await shelf.create({ type: 'book', title: 'Project Hail Mary', creator: 'Andy Weir', year: 2021, genres: ['Science fiction'] }, { format: 'Audiobook' });
  await shelf.create({ type: 'film', title: 'Spirited Away', creator: 'Hayao Miyazaki', year: 2001, genres: ['Animation'] }, { format: 'Blu-ray', place_id: living });
  await shelf.create({ type: 'music', title: 'Rumours', creator: 'Fleetwood Mac', year: 1977 }, { format: 'Vinyl', place_id: living, lent_to: 'Sam', lent_on: day(-40) });
  await shelf.create({ type: 'music', title: 'John Prine', creator: 'John Prine', year: 1971 }, { format: 'Vinyl', place_id: living });
  await shelf.create({ type: 'music', title: 'Dust Bowl Ballads', creator: 'Woody Guthrie', year: 1940 }, { format: 'Vinyl', place_id: living });
  await shelf.create({ type: 'game', title: 'Ticket to Ride', year: 2004 }, { format: 'Board game', place_id: living });
  // Lists: something to watch, one thing wanted, and a list the household shares. Made-up titles, none of them owned.
  const lists = mediaLists(db, me);
  const toWatch = (await lists.all()).find((l) => l.builtin === 'to_watch')!;
  await lists.add(toWatch.id, { type: 'film', title: 'The Lantern Festival', year: 2019, note: 'Saturday, after dinner' });
  await lists.add(toWatch.id, { type: 'show', title: 'Pip and the Paper Boat' });
  await lists.add(toWatch.id, { type: 'book', title: 'A Map of Small Places', creator: 'Ines Calloway' });
  const wishes = (await lists.all()).find((l) => l.builtin === 'wanted')!;
  await lists.add(wishes.id, { type: 'music', title: 'Harbor Lights', creator: 'The Night Ferries' });
  const movieNight = await lists.create({ name: 'Family movie night', shared: true });
  await lists.add(movieNight.id, { type: 'film', title: 'The Lantern Festival', year: 2019 });
  await lists.add(movieNight.id, { type: 'film', title: 'Orchard Street', year: 2008 });
  await lists.add(movieNight.id, { type: 'show', title: 'Pip and the Paper Boat' });

  // ---- making ----
  const making = projects(db, me);
  const dress = await making.createProject({ name: 'Linen summer dress', activity: 'Sewing', status: 'active', due_on: day(21) });
  await making.addLine(dress.id, { item_id: linen.id, quantity: 3 });
  await making.addLine(dress.id, { label: '9 inch zipper', quantity: 1 });
  await making.addSession(dress.id, { day: day(-3), minutes: 90, note: 'Cut out the pieces (washed the linen first, finally)' });
  await things.logUse(machine.id, { project_id: dress.id, day: day(-3) });
  // Left alone for three weeks, so the front page's "Don't forget" has something to say about it.
  const shelves = await making.createProject({ name: 'Garage shelves', activity: 'Woodworking', status: 'planned' });
  await db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [`${day(-21)}T09:00:00+00:00`, shelves.id]);

  // ---- upkeep: jobs, bills, renewals, chores ----
  const jobs = upkeep(db, me);
  await jobs.create({ name: 'Change the furnace filter', activity: 'Home maintenance', every_n: 3, every_unit: 'month', tools: [ladder.id], supplies: [{ item_id: filters.id, quantity: 1 }],
    steps: 'Turn the system off.\nNote the size printed on the old filter.\nArrow on the new one points toward the furnace.', note: 'Buy the four-pack so we stop running out.', last_done: { day: day(-95) } });
  await jobs.create({ name: 'Change the oil', activity: 'Car', item_id: car.id, every_n: 6, every_unit: 'month', every_reading: 5000, reading_unit: 'miles', last_done: { day: day(-120), reading: 61200 } })
    .then((j) => jobs.reading(j.id, 65900));
  await jobs.create({ name: 'Clean the gutters', activity: 'Home maintenance', every_n: 6, every_unit: 'month', tools: [ladder.id], note: 'Not alone. Somebody holds the ladder.', last_done: { day: day(-150) } });
  await jobs.create({ name: 'Test the smoke alarms', activity: 'Home maintenance', every_n: 1, every_unit: 'month', note: 'The one in the hall chirps when the battery is low.', last_done: { day: day(-12) } });
  const june = `${Number(today().slice(0, 4)) + (today().slice(5) >= '06-01' ? 1 : 0)}-06-01`;
  await jobs.create({ name: 'Hurricane kit', activity: 'Home maintenance', every_n: 1, every_unit: 'year', first_due: june, steps: 'Check the generator.\nNew batteries in the flashlights and the radio.\nFill the water jugs.', note: 'Do it before the first storm is named, not after.' });
  await jobs.create({ name: 'Electricity', kind: 'bill', amount_cents: 8450, every_n: 1, every_unit: 'month', first_due: day(6) });
  await jobs.create({ name: 'Internet', kind: 'bill', amount_cents: 6000, every_n: 1, every_unit: 'month', first_due: day(14), autopay: true });
  await jobs.create({ name: 'Car registration', kind: 'renewal', activity: 'Car', item_id: car.id, amount_cents: 18000, every_n: 1, every_unit: 'year', first_due: day(48) });
  await jobs.create({ name: 'Passport', kind: 'renewal', activity: 'Papers', every_n: 10, every_unit: 'year', first_due: day(700) });
  await jobs.create({ name: 'Wipe the counters', kind: 'chore', every_n: 1, every_unit: 'day', note: 'Nobody thinks it is their job, which is why it never gets done.', last_done: { day: day(-12) } });
  const family = await jobs.addMember('Hank');
  const hank = family[0]!.id;
  const loretta = (await jobs.addMember('Loretta')).find((m) => m.name === 'Loretta')!.id;
  await jobs.setPointValue(50);
  const room = await jobs.create({ name: 'Clean your room', kind: 'chore', points: 2, every_n: 1, every_unit: 'week', assigned_member: hank, note: 'Hank swears he cleaned it.' });
  const dishes = await jobs.create({ name: 'Do the dishes', kind: 'chore', points: 1, every_n: 1, every_unit: 'day', note: 'Whoever cooked does not wash. House rule.' });
  const trash = await jobs.create({ name: 'Take out the trash', kind: 'chore', points: 2, every_n: 1, every_unit: 'week', assigned_member: loretta, note: 'Bins go to the curb Monday night.' });
  await jobs.done(room.id, { by_member: hank });
  await jobs.done(dishes.id, { by_member: loretta });
  await jobs.done(trash.id, { by_member: loretta });
  await jobs.done(dishes.id, { day: day(-8), by_member: hank });

  // ---- pets ----
  const animals = pets(db, me);
  const george = await animals.create({ name: 'George', species: 'dog', breed: 'Beagle mix', born_on: day(-365 * 4 - 60), vet_name: 'Oak Lane Veterinary Clinic', vet_phone: '555 0100', microchip: '985112004512345', food: 'One cup, morning and evening', note: 'Scared of fireworks, hides in the tub on the Fourth. No chicken treats, they upset his stomach.' });
  await animals.addCare(george.id, { name: 'Vaccinations', every_n: 1, every_unit: 'year', last_done: day(-340) });
  await animals.addCare(george.id, { name: 'Flea and tick treatment', every_n: 1, every_unit: 'month', last_done: day(-33) });
  // George's morning: anyone in the house can tick it, and the feed step uses the dog food, so it can be marked running low.
  const petSupplies = (await things.createKind({ name: 'Pet supplies', icon: '🐾' })).find((x) => x.name === 'Pet supplies')!.id;
  const dogFood = await things.createItem({ kind_id: petSupplies, name: 'Dog food', quantity: 3, unit: 'cup', low_at: 2, place_id: kitchenRoom });
  await routines(db, me).create({ name: 'Dog, daily', for_pet: george.id, times: [{ name: 'Morning', steps: [{ words: 'Feed 1 cup', item_id: dogFood.id }, { words: 'Walk' }] }] });
  // One made-up workout (it is the demo person's own), done two days ago so each numbered step has a "last time".
  const leg = await routines(db, me).create({ name: 'Leg day', kind: 'workout', times: [{ name: 'Workout', steps: [
    { words: 'Goblet squat', nums: { sets: 3, reps: 10, weight: 25, weight_unit: 'lb' } }, { words: 'Easy walk', nums: { minutes: 20, distance: 1, distance_unit: 'mi' } }, { words: 'Stretch' },
  ] }] });
  await routines(db, me).tick(leg.times[0]!.steps[0]!.id, true, day(-2));
  await routines(db, me).tick(leg.times[0]!.steps[1]!.id, true, day(-2), { minutes: 25, distance: 1.2, distance_unit: 'mi' });
  await animals.addWeight(george.id, { value: 27.5, unit: 'lb', day: day(-90) });
  await animals.addWeight(george.id, { value: 28.2, unit: 'lb', day: day(-5) });
  const pepper = await animals.create({ name: 'Pepper', species: 'cat', born_on: day(-365 * 7), vet_name: 'Oak Lane Veterinary Clinic', vet_phone: '555 0100', food: 'Half a can twice a day; dry food always out', note: 'Hates the carrier. The pill goes in a bit of tuna.' });
  await animals.addCare(pepper.id, { name: 'Vet check-up', every_n: 1, every_unit: 'year', last_done: day(-200) });

  // ---- the house manual ----
  const book = manual(db, me);
  await book.addEntry({ section: 'emergency', title: 'Water shut-off', body: 'Red lever behind the water heater.\nTurn it a quarter until it stops.', place_id: basement });
  await book.addEntry({ section: 'emergency', title: 'Breaker box', body: 'Gray panel by the side door. Each switch is labeled.', place_id: garage });
  await book.addEntry({ section: 'contacts', title: 'Plumber', phone: '555 0142', body: 'Ask for Dana. She came out on a Sunday once and did not charge extra.' });
  await book.addEntry({ section: 'contacts', title: 'A neighbor with a key', phone: '555 0177', body: 'The Okafors, two doors down. They water the plants when we are away.' });
  await book.addEntry({ section: 'house', title: 'Wi-Fi', body: 'Network: SampleHome\nPassword: made-up-for-the-demo' });
  await book.addEntry({ section: 'house', title: 'Alarm', body: 'A code would go here. It is marked private, so it never appears on a shared link.', private: true });
  await book.addEntry({ section: 'routines', title: 'Trash and recycling days', body: 'Trash on Tuesday. Recycling every other Friday.' });

  // ---- home services ----
  // The links belong to the person in charge (the demo's other account, which nobody signs in to), so the demo person sees them and pins one.
  const inCharge = (await db.get<{ id: number }>('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1'))!.id;
  const links = homeServices(db, inCharge);
  const watch = (await links.create({ name: 'Media server', address: 'http://192.168.1.20:8096', address_at: 'home', address2: 'https://media.example.com', address2_at: 'away', icon: 'media', color: 'plum', group: 'Watch', note: 'Films and shows for the house.', guests: true })).services[0]!;
  await links.create({ name: 'Photos', address: 'http://192.168.1.21:2283', icon: 'photo', color: 'green', group: 'Files', note: 'The family photo library.' });
  await links.create({ name: 'Router', address: 'http://192.168.1.1', icon: 'settings', color: 'rust', group: 'House', who: 'me' });
  await homeServices(db, me).pin(watch.id);

  // ---- packing ----
  const move = packing(db, me);
  const boxes = (await move.makeBoxes({ count: 3, destination: 'Storage', parent_id: garage })).boxes;
  await things.createItem({ kind_id: household, name: 'Holiday lights', place_id: boxes[0]!.id });
  await things.createItem({ kind_id: household, name: 'Camping stove', place_id: boxes[0]!.id, activities: ['Camping'] });
  await move.setBox(boxes[0]!.id, { state: 'packed' });

  // ---- spending ----
  const spend = money(db, me);
  const groceries = await spend.addCategory({ name: 'Groceries', monthly_cents: 60000 });
  const house = await spend.addCategory({ name: 'House', monthly_cents: 25000 });
  await spend.addCategory({ name: 'Fun', monthly_cents: 15000 });
  await spend.addEntry({ label: 'Farmers market', cents: 4250, category_id: groceries.id, day: day(-2) });
  await spend.addEntry({ label: 'Food Lion', cents: 11830, category_id: groceries.id, day: day(-5) });
  await spend.addEntry({ label: 'Harris Teeter', cents: 6475, category_id: groceries.id, day: day(-9) });
  await spend.addEntry({ label: 'Costco', cents: 14390, category_id: groceries.id, day: day(-13) });
  await spend.addEntry({ label: 'Furnace filters (pack of 4)', cents: 3999, category_id: house.id, day: day(-6) });

  // ---- income, a bill, and a holiday with its own goal ----
  const plan = budget(db, me);
  await plan.addIncome({ name: 'Paycheck', cents: 210000, every: 'twice_monthly' });
  await plan.addBill({ name: 'Rent', cents: 135000, every_n: 1, every_unit: 'month', first_due: `${today().slice(0, 7)}-01` });
  const winter = await holidays(db, me).create({ name: 'Winter gathering', rule: { kind: 'fixed', month: 12, day: 20 } });
  const winterPlan = winter.years[0]!.plan_id;
  const gifts = holidays(db, me);
  await gifts.addGift(winterPlan, { who: 'Maya', idea: 'A warm scarf' });
  await gifts.addGift(winterPlan, { who: 'Sam', idea: 'A chess clock' });
  await gifts.addGift(winterPlan, { who: 'Grandpa', idea: 'A photo book' });
  const wanted = (await gifts.year(winterPlan)).gifts;
  await gifts.updateGift(wanted[0]!.id, { cents: 3500 });
  await gifts.updateGift(wanted[1]!.id, { cents: 4800 });
  const winterGoal = await goals(db, me).start({ plan_id: winterPlan, target_cents: 60000 });
  await goals(db, me).addLine(winterGoal.id, { label: 'Wrapping paper and cards', cents: 2200 });
  await plan.putAside(winterGoal.id, { cents: 15000 });

  // ---- planning ----
  const cal = calendar(db, me);
  await cal.createEvent({ title: 'Dentist appointment', day: day(1), time: '15:30', note: 'Hank. Bring the form we keep forgetting.' });
  await cal.createEvent({ title: "Mom's birthday", day: `1958-${day(9).slice(5)}`, yearly: true });
  await cal.createEvent({ title: 'School concert', day: day(11), time: '18:00', note: 'Loretta plays second flute. Get there early for seats.' });
  // ---- an outdoor trip, the one that fits the season: deer in the cold months, spot in the fall, the beach the rest of the year ----
  await things.addStarter('outdoors');
  const outdoorKinds = await things.listKinds();
  const camping = outdoorKinds.find((x) => x.name === 'Camping gear')!;
  const tackle = outdoorKinds.find((x) => x.name === 'Fishing tackle')!;
  const typeOf = (kind: typeof camping) => String(kind.fields.find((f) => f.name === 'Type')!.id);
  const tent = await things.createItem({ kind_id: camping.id, name: 'Family tent', place_id: garage, values: { [typeOf(camping)]: 'Tent' }, activities: ['Camping'] });
  await things.createItem({ kind_id: camping.id, name: 'Sleeping bags (4)', quantity: 4, place_id: garage, values: { [typeOf(camping)]: 'Sleeping bag' }, activities: ['Camping'] });
  await things.createItem({ kind_id: camping.id, name: 'Two-burner stove', place_id: garage, values: { [typeOf(camping)]: 'Stove' }, activities: ['Camping'] });
  await things.createItem({ kind_id: camping.id, name: 'Big cooler', place_id: garage, values: { [typeOf(camping)]: 'Cooler' }, activities: ['Camping'] });
  await things.createItem({ kind_id: camping.id, name: 'Lantern', place_id: garage, values: { [typeOf(camping)]: 'Lantern' }, activities: ['Camping'] });
  await things.createItem({ kind_id: tackle.id, name: 'Rod and reel', place_id: garage, values: { [typeOf(tackle)]: 'Rod' }, activities: ['Fishing'] });
  const jigs = await things.createItem({ kind_id: tackle.id, name: 'Jig heads', quantity: 2, low_at: 4, place_id: garage, values: { [typeOf(tackle)]: 'Lures' }, activities: ['Fishing'] });
  await things.createItem({ kind_id: tackle.id, name: 'Spinners', quantity: 6, low_at: 2, place_id: garage, values: { [typeOf(tackle)]: 'Lures' }, activities: ['Fishing'] });
  await things.createItem({ kind_id: tackle.id, name: 'Fishing line', quantity: 1, low_at: 1, place_id: garage, values: { [typeOf(tackle)]: 'Line' }, activities: ['Fishing'] });
  const chili = await k.createRecipe({ title: 'Campfire chili', servings: 6, ingredients_text: '2 lb ground beef\n2 cans kidney beans\n1 can diced tomatoes\n1 onion\n2 tbsp chili powder', steps_text: 'Brown the beef and onion in a pot.\nAdd everything else and simmer for 30 minutes.' });
  const out = outdoorTrips(db, me);
  const month = new Date().getMonth() + 1;
  const season = month >= 11 || month <= 2 ? 'deer' : month >= 9 ? 'spot' : 'beach';
  const weekend = await out.create(season === 'deer' ? { name: 'Deer hunting trip', parts: ['hunting'], day: day(18), end_day: day(20) }
    : season === 'spot' ? { name: 'Spot fishing', parts: ['fishing'], day: day(18), end_day: day(19) }
    : { name: 'Outer Banks beach week', parts: ['camping'], day: day(18), end_day: day(25) });
  const weekendPlan = weekend.years[0]!.plan_id;
  if (season === 'deer') {
    for (const label of ['Blaze orange vest', 'Hand warmers', 'Tree stand harness', 'Thermos of coffee']) await out.addGear(weekendPlan, { part: 'hunting', label });
    await out.addSeason(weekendPlan, { part: 'hunting', label: 'Deer season opens', opens_on: day(12), remind_days: 5 });
    await out.setYear(weekendPlan, { notes_next: 'Check the stand straps before the first morning.' });
  } else if (season === 'spot') {
    for (const label of ['Bloodworms', 'A cooler', 'Sweet tea']) await out.addGear(weekendPlan, { part: 'fishing', label });
    await out.addSeason(weekendPlan, { part: 'fishing', label: 'The spots are running!', opens_on: day(12), remind_days: 5 });
    await out.setYear(weekendPlan, { water: 'The pier', notes_next: 'Get there before sunrise.' });
    await cal.createEvent({ title: 'Fish fry', day: day(26), time: '17:00', note: 'Whatever we catch. Bring a side.' });
  } else {
    await out.fillGear(weekendPlan, 'camping');
    await out.addGear(weekendPlan, { part: 'camping', label: 'Beach umbrella' });
    await out.addGear(weekendPlan, { part: 'camping', label: 'Sunscreen' });
    await out.addMeal(weekendPlan, { recipe_id: chili.id, day: day(18), meal: 'dinner' });
    await out.setYear(weekendPlan, { campground: 'Salty Pines Campground', site: '14', confirmation: 'SP-20418', check_in: day(18), check_out: day(25), notes_next: 'Bring a second tarp.' });
  }
  await out.addMeal(weekendPlan, { recipe_id: muffins.id, day: day(19), meal: 'breakfast' });
  void tent;
  void jigs;
  void tv;
}

/**
 * Keeps a demo fresh: reset when it starts, every night at `hour` UTC, and at once if visitors have filled
 * it past `maxBytes` (photos and papers are kept in the database).
 */
export function keepDemoFresh(db: Db, demo: Demo, file: string, options: { hour?: number; maxBytes?: number } = {}): { ready: Promise<void>; stop(): void } {
  const hour = options.hour ?? 9;      // 9:00 UTC is the middle of the night in the Americas
  const maxBytes = options.maxBytes ?? 200_000_000;
  let last = '';
  let busy = false;
  const reset = async (why: string) => {
    if (busy) return;
    busy = true;
    try { await resetDemo(db, demo); last = new Date().toISOString().slice(0, 10); console.log(`Demo data was reset (${why})`); } catch (problem) { console.error('The demo could not be reset:', problem); } finally { busy = false; }
  };
  const ready = reset('starting up');
  const timer = setInterval(() => {
    const now = new Date();
    const size = (() => { try { return statSync(file).size; } catch { return 0; } })();
    if (size > maxBytes) void reset('it had grown too large');
    else if (now.getUTCHours() === hour && now.toISOString().slice(0, 10) !== last) void reset('the nightly reset');
  }, 5 * 60_000);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
