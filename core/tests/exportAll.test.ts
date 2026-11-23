/** Download everything, and bring it back in part by part: open files, only the person's own, nothing secret, never overwriting. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, bringInPictures, csvField, csvText, exportEverything, KINDS, lookAtDownload, makeZip, readZip, splitDownload, type PictureIn } from '../src/exportAll.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { calendar } from '../src/calendar.ts';
import { licenses } from '../src/licenses.ts';
import { manual } from '../src/manual.ts';
import { media } from '../src/media.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { budget } from '../src/budget.ts';
import { money } from '../src/money.ts';
import { pets } from '../src/pets.ts';
import { prep } from '../src/prep.ts';
import { plans } from '../src/plans.ts';
import { projects } from '../src/projects.ts';
import { tags as tagsOf } from '../src/tags.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = Object.assign(() => time, { today: () => '2046-03-05' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 9, 9, 9]);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

/** Some of every kind of record, made with the real functions. */
async function fill(owner: number, tag = '') {
  const cook = kitchen(db, owner, clock);
  const stuff = inventory(db, owner, clock);
  const jobs = upkeep(db, owner, clock);
  const soup = await cook.createRecipe({ title: `Leek soup${tag}`, description: 'Warm', servings: 4, prep_minutes: 10, cook_minutes: 30, tags: ['winter', 'soup'], source_url: 'https://example.org/soup',
    ingredients_text: `# Base\n3 leeks\n1 lb potatoes${tag}`, steps_text: 'Chop it all.\n\nSimmer for half an hour, then, if you like, blend.', notes: 'Better the next day', equipment: [{ label: 'Big pot', quantity: 1 }] });
  await cook.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: soup.id, servings: 4 });
  await cook.addPlan({ day: '2046-03-07', meal: 'lunch', title: 'Leftovers' });
  await cook.addGrocery({ label: `Milk${tag}`, quantity: 2, unit: 'l' });
  await cook.savePantry({ name: `Flour${tag}`, quantity: 2, unit: 'kg', location: 'pantry', expires_on: '2047-01-01' });

  await stuff.createPlace({ name: `Sewing room${tag}` });
  const room = (await stuff.createPlace({ name: `Hall${tag}` })).find((p) => p.name === `Sewing room${tag}`)!;
  const shelf = (await stuff.createPlace({ name: 'Shelf 2', parent_id: room.id })).find((p) => p.name === 'Shelf 2')!;
  const kinds = await stuff.createKind({ name: `Fabric${tag}`, icon: '🧵', unit: 'yd', activity: 'Sewing', fields: [{ name: 'Width', type: 'number', unit: 'in' }, { name: 'Color', type: 'choice', choices: ['Red', 'Blue'] }, { name: 'Washed', type: 'yesno' }] });
  const fabric = kinds.find((k) => k.name === `Fabric${tag}`)!;
  const thing = await stuff.createItem({ kind_id: fabric.id, name: `Blue linen${tag}`, quantity: 3, unit: 'yd', place_id: shelf.id, note: 'For the curtains, "lined"', activities: ['Sewing', 'Home'],
    values: { [String(fabric.fields[0]!.id)]: 54, [String(fabric.fields[1]!.id)]: 'Blue', [String(fabric.fields[2]!.id)]: true },
    records: { bought_on: '2045-12-24', bought_at: 'Fabric Barn', price_cents: 4599, value_cents: 5000, model: 'L-54', serial: 'SN-1', warranty_until: '2047-12-24' }, barcode: '012345678905' });
  await stuff.setPhoto(thing.id, PNG);
  await stuff.addDocument(thing.id, { kind: 'receipt', name: 'Receipt', bytes: PDF });
  const wrench = await stuff.createItem({ kind_id: fabric.id, name: `Wrench${tag}`, quantity: 1 });

  const dog = await pets(db, owner, clock).create({ name: `Rex${tag}`, species: 'Dog', breed: 'Lab', born_on: '2040-05-01', microchip: '9851', vet_name: 'Dr. Ames', vet_phone: '555-0100', food: 'Kibble' });
  await pets(db, owner, clock).addWeight(dog.id, { value: 60, unit: 'lb', day: '2046-01-01' });
  await pets(db, owner, clock).addCare(dog.id, { name: `Heartworm pill${tag}`, every_n: 1, every_unit: 'month', last_done: '2046-02-01' });
  await db.run('UPDATE pets SET photo_type = ?, photo = ? WHERE id = ?', ['image/png', PNG, dog.id]);

  await jobs.addMember(`Dana${tag}`);
  const members = await db.all<{ id: number }>('SELECT id FROM household_members WHERE owner_id = ?', [owner]);
  const job = await jobs.create({ name: `Oil the machine${tag}`, activity: 'Sewing', item_id: thing.id, every_n: 3, every_unit: 'month', steps: 'Open the cover', tools: [wrench.id], supplies: [{ item_id: wrench.id, quantity: 2, unit: 'oz' }], last_done: { day: '2045-12-01' } });
  await jobs.done(job.id, { day: '2046-02-01', minutes: 15, note: 'Smooth' });
  await jobs.create({ name: `Take out the trash${tag}`, kind: 'chore', points: 3, every_n: 1, every_unit: 'week', assigned_member: members[0]!.id });
  await jobs.create({ name: `Electric bill${tag}`, kind: 'bill', amount_cents: 12050, every_n: 1, every_unit: 'month', first_due: '2046-03-20' });

  await manual(db, owner, clock).addEntry({ section: 'emergency', title: `Water shut-off${tag}`, body: 'Under the sink', place_id: room.id, private: true });
  await licenses(db, owner, clock).create({ name: `Driver's license${tag}`, category: 'Driving', holder: 'Dana', number: `D123-4567-${tag || '0'}`, issuer: 'DMV', issued_on: '2042-04-04', expires_on: '2050-04-04' });

  const film = await media(db, owner, clock).create({ type: 'film', title: `Alien${tag}`, creator: 'Ridley Scott', year: 1979, genres: ['Horror', 'Sci-Fi'], minutes: 117, note: 'Watch in the dark' },
    { format: 'Blu-ray', place_id: shelf.id, pieces: 2, lent_to: 'Sam', lent_on: '2046-02-02', link: 'https://example.org/alien' });
  await media(db, owner, clock).log(film.id, { day: '2046-01-10', note: 'With Sam' });
  await db.run("INSERT INTO media_covers (media_id, type, bytes) VALUES (?, 'image/png', ?)", [film.id, PNG]);

  await calendar(db, owner, clock).createEvent({ title: `Dentist${tag}`, day: '2046-03-09', time: '09:30', note: 'Bring the card' });
  await calendar(db, owner, clock).createEvent({ title: `Mom's birthday${tag}`, day: '2046-04-01', yearly: true } as never);

  const spend = money(db, owner, clock);
  const groceries = await spend.addCategory({ name: `Groceries${tag}`, monthly_cents: 40000 });
  await spend.addEntry({ label: `Corner shop${tag}`, cents: 1234, day: '2046-03-02', category_id: groceries.id, note: 'Milk & eggs' });
  await spend.addEntry({ label: `Mystery${tag}`, cents: 500, day: '2046-03-03' });
  await budget(db, owner, clock).addIncome({ name: `Paycheck${tag}`, cents: 150000, every: 'biweekly', start_day: '2046-03-02' });
  const rainy = await budget(db, owner, clock).addGoal({ name: `Rainy day${tag}`, target_cents: 100000, by_day: '2046-12-31' });
  await budget(db, owner, clock).putAside(rainy.id, { day: '2046-03-04', cents: 20000 });
  await budget(db, owner, clock).putAside(rainy.id, { day: '2046-03-05', cents: -2550 });

  // The parts that are only written out: projects, plans, prices and coupons.
  const project = await projects(db, owner, clock).createProject({ name: `Curtains${tag}`, activity: 'Sewing', status: 'active' });
  await projects(db, owner, clock).addLine(project.id, { item_id: thing.id, quantity: 2 });
  await projects(db, owner, clock).addSession(project.id, { day: '2046-03-01', minutes: 90, note: 'Cut' });
  await projects(db, owner, clock).addCost(project.id, { label: 'Thread', planned_cents: 500, actual_cents: 450 });
  const plan = await plans(db, owner, clock).create({ name: `Beach week${tag}`, start_day: '2046-07-01', end_day: '2046-07-07', note: 'Pack sunscreen' });
  await plans(db, owner, clock).addItem(plan.id, { kind: 'task', label: 'Book the car' });
  await db.run("INSERT INTO plan_photos (plan_id, source, type, bytes, caption, sort_order, created_at) VALUES (?, 'kept', 'image/png', ?, 'Us', 0, 'now')", [plan.id, PNG]);
  await db.run("INSERT INTO prices (owner_id, label, cents, store, day, created_at) VALUES (?, ?, 349, 'Corner shop', '2046-03-02', 'now')", [owner, `Eggs${tag}`]);
  const flour = (await db.get<{ id: number }>("SELECT id FROM ingredients WHERE owner_id = ? AND name LIKE 'Flour%'", [owner]))!;
  await db.run("INSERT INTO prices (owner_id, ingredient_id, label, cents, quantity, unit, store, day, assumed, barcode, created_at) VALUES (?, ?, ?, 479, 5, 'lb', 'Bakery', '2046-03-03', 1, '0123456789012', 'now')", [owner, flour.id, `Flour${tag}`]);
  await db.run("INSERT INTO coupons (owner_id, label, cents_off, store, code, created_at) VALUES (?, ?, 100, 'Corner shop', 'SAVE1', 'now')", [owner, `One dollar off${tag}`]);
  await db.run("INSERT INTO coupons (owner_id, label, ingredient_id, percent_off, expires_on, note, created_at) VALUES (?, ?, ?, 20, '2046-12-01', 'Members only', 'now')", [owner, `Flour sale${tag}`, flour.id]);
  await db.run("INSERT INTO stores (owner_id, name, note, created_at) VALUES (?, 'Corner shop', 'Open late', 'now')", [owner]);
  await db.run("INSERT INTO stores (owner_id, name, created_at) VALUES (?, 'Bakery', 'now')", [owner]);
  await db.run("INSERT INTO ingredient_barcodes (owner_id, barcode, ingredient_id, label, size_quantity, size_unit, created_at) VALUES (?, '0123456789012', ?, 'Mill flour', 5, 'lb', 'now')", [owner, flour.id]);
  await db.run("UPDATE project_costs SET actual_cents = 450, paid_on = '2046-03-02' WHERE project_id = ?", [project.id]);
  await db.run("UPDATE project_items SET used_on = '2046-03-01' WHERE project_id = ?", [project.id]);
  await plans(db, owner, clock).addItem(plan.id, { kind: 'thing', ref_id: thing.id, quantity: 2 });
  await plans(db, owner, clock).addItem(plan.id, { kind: 'recipe', ref_id: soup.id });
  const tagged = await tagsOf(db, owner, clock).create('Kitchen > Appliances');
  await tagsOf(db, owner, clock).set('thing', thing.id, [tagged.id]);
  await tagsOf(db, owner, clock).set('project', project.id, [tagged.id]);
  await tagsOf(db, owner, clock).set('plan', plan.id, [tagged.id]);
  await tagsOf(db, owner, clock).create('Unused');
  await db.run("INSERT INTO media_sources (owner_id, kind, name, url, secret, every_hours, created_at) VALUES (?, 'jellyfin', 'Basement server', 'http://user:hunter2@10.0.0.5:8096/?api_key=KEYINURL', 'SEALED-SERVER-KEY-777', 6, 'now')", [owner]);
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'shopping_currency', '$')", [owner]);
  return { soup, thing, dog, shelf, room };
}

const names = (zip: Awaited<ReturnType<typeof splitDownload>>) => [...Object.keys(zip.files), ...zip.pictures.keys()];
const allText = (zip: Awaited<ReturnType<typeof splitDownload>>) => Object.values(zip.files).join('\n');
const rowsOf = (zip: Awaited<ReturnType<typeof splitDownload>>, file: string) => zip.files[file]!.split(/\r?\n/).filter(Boolean);

let ana: number;
let bob: number;
beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  time = new Date(2046, 2, 5, 10, 0, 0);
  ana = await person('ana');
  bob = await person('bob');
});

it('spreadsheets are quoted, begin with a byte-order mark, end lines with CRLF, and defuse formulas the way the home inventory does', async () => {
  expect(csvField('plain')).toBe('plain');
  expect(csvField('a, b')).toBe('"a, b"');
  expect(csvField('say "hi"')).toBe('"say ""hi"""');
  expect(csvField('two\nlines')).toBe('"two\nlines"');
  expect(csvField('=1+1')).toBe("'=1+1");
  expect(csvField('+cmd')).toBe("'+cmd");
  expect(csvField('@sum')).toBe("'@sum");
  expect(csvField('-cmd')).toBe("'-cmd");
  expect(csvField('-5')).toBe('-5');
  const text = csvText(['A', 'B'], [['x', '=2'], ['1,5', null]]);
  expect(text.startsWith('﻿A,B\r\n')).toBe(true);
  expect(text).toBe("﻿A,B\r\nx,'=2\r\n\"1,5\",\r\n");

  // The same answers as the home inventory's own guard, on the same words.
  const stuff = inventory(db, ana, clock);
  const kind = (await stuff.createKind({ name: 'Odd' })).find((k) => k.name === 'Odd')!;
  const words = ['=SUM(A1)', '+1', '@x', '-minus', '-5', 'a "q", b', 'plain'];
  for (const word of words) await stuff.createItem({ kind_id: kind.id, name: word });
  const csv = (await stuff.homeReportCsv()).text;
  for (const word of words) expect(csv).toContain(csvField(word));
});

it('holds every kind of record for a person with some of each, in plain headings, dates, dollars', async () => {
  await fill(ana);
  const made = await exportEverything(db, ana, clock);
  expect(made.filename).toBe('lifeis-everything-2046-03-05.zip');
  const zip = await splitDownload(made.bytes);
  const present = names(zip);
  for (const file of ['README.txt', 'recipes.csv', 'meal-plan.csv', 'grocery-list.csv', 'pantry.csv', 'prices.csv', 'coupons.csv', 'places.csv', 'kinds.csv', 'things.csv', 'thing-papers.csv', 'thing-history.csv',
    'upkeep.csv', 'upkeep-history.csv', 'household.csv', 'pets.csv', 'pet-weights.csv', 'house-manual.csv', 'licenses.csv', 'collection.csv', 'copies.csv', 'collection-log.csv', 'events.csv',
    'projects.csv', 'project-lines.csv', 'project-time.csv', 'project-costs.csv', 'plans.csv', 'plan-items.csv', 'plan-photos.csv', 'money-categories.csv', 'money-entries.csv', 'money-income.csv', 'money-goals.csv', 'money-goal-saved.csv', 'connections.csv', 'settings.csv', 'stores.csv', 'barcodes.csv', 'tags.csv']) {
    expect(present, file).toContain(file);
  }
  // Every spreadsheet has a row for what was made.
  for (const file of ['recipes.csv', 'meal-plan.csv', 'grocery-list.csv', 'pantry.csv', 'prices.csv', 'coupons.csv', 'places.csv', 'kinds.csv', 'things.csv', 'thing-papers.csv', 'thing-history.csv', 'upkeep.csv', 'upkeep-history.csv',
    'household.csv', 'pets.csv', 'pet-weights.csv', 'house-manual.csv', 'licenses.csv', 'collection.csv', 'copies.csv', 'collection-log.csv', 'events.csv', 'projects.csv', 'project-lines.csv', 'project-time.csv',
    'project-costs.csv', 'plans.csv', 'plan-items.csv', 'plan-photos.csv', 'money-categories.csv', 'money-entries.csv', 'money-income.csv', 'money-goals.csv', 'money-goal-saved.csv', 'connections.csv', 'settings.csv', 'stores.csv', 'barcodes.csv', 'tags.csv']) {
    expect(rowsOf(zip, file).length, file).toBeGreaterThan(1);
  }
  expect(made.counts['things.csv']).toBe(2);
  // Pictures and papers, in folders named for what they belong to, and the recipes in the open format.
  expect(present.some((p) => /^pictures\/things\/Blue-linen-\d+\.png$/.test(p))).toBe(true);
  expect(present.some((p) => /^papers\/Blue-linen-\d+\/Receipt\.pdf$/.test(p))).toBe(true);
  expect(present.some((p) => /^pictures\/pets\/Rex-\d+\.png$/.test(p))).toBe(true);
  expect(present.some((p) => /^pictures\/covers\/Alien-\d+\.png$/.test(p))).toBe(true);
  expect(present.some((p) => /^pictures\/plans\/Beach-week-\d+\/photo-\d+\.png$/.test(p))).toBe(true);
  expect(present).toContain('recipes-open-format/Recipes/Leek soup/recipe.json');
  expect(made.pictures).toBe(5);
  const paper = [...zip.pictures.entries()].find(([p]) => p.endsWith('Receipt.pdf'))!;
  expect([...paper[1]]).toEqual([...PDF]);

  const recipes = zip.files['recipes.csv']!;
  expect(recipes).toContain('Title,Description,Servings,Prep minutes,Cook minutes,Tags,Ingredients,Steps,Source address,Notes,Cooked in');
  expect(recipes).toContain('Leek soup,Warm,4,10,30,"soup, winter"');
  expect(recipes).toContain('"# Base\n3 leeks\n1 lb potatoes"');
  expect(recipes).toContain('Big pot');
  expect(zip.files['things.csv']).toContain('Fabric: Width,Fabric: Color,Fabric: Washed');
  expect(zip.files['things.csv']).toContain('Sewing room › Shelf 2');
  expect(zip.files['things.csv']).toContain(',45.99,50.00,2047-12-24,');
  expect(zip.files['things.csv']).toContain(',54,Blue,yes');
  expect(zip.files['upkeep.csv']).toContain('120.50');
  expect(zip.files['upkeep.csv']).toContain('2046-03-20');
  expect(zip.files['upkeep.csv']).toContain('Oil the machine,job,Sewing,Blue linen,Sewing room › Shelf 2,,3,month,,,,2046-02-01,2046-05-01');
  expect(zip.files['upkeep.csv']).toContain('Rex');
  expect(zip.files['house-manual.csv']).toContain('In an emergency,Water shut-off,Under the sink,,Sewing room,yes');
  expect(zip.files['licenses.csv']).toContain('D123-4567-0');
  expect(zip.files['money-entries.csv']).toContain('Corner shop,12.34,2046-03-02,Groceries');
  expect(zip.files['money-income.csv']).toContain('Paycheck,1500.00,biweekly,2046-03-02');
  expect(zip.files['money-goals.csv']).toContain('Rainy day,1000.00,2046-12-31,174.50');
  expect(zip.files['money-goal-saved.csv']).toContain('Rainy day,2046-03-05,-25.50');
  expect(zip.files['copies.csv']).toContain('Blu-ray,Sewing room › Shelf 2,2,');
  expect(zip.files['connections.csv']).toContain('Jellyfin server,Basement server,http://10.0.0.5:8096');
  expect(zip.files['settings.csv']).toContain('Money sign,$');
  const readme = zip.files['README.txt']!;
  expect(readme).toContain('Made on 2046-03-05');
  expect(readme).toContain('sent nowhere');
  expect(readme).toContain('license numbers'.slice(0, 0) + 'The numbers are included');
  expect(readme).toContain('Nothing is ever overwritten or deleted');
});

it("never holds another person's data, and shared spending only as your own entries", async () => {
  await fill(ana);
  await fill(bob, ' (Bob)');
  const theirs = await money(db, bob, clock).addCategory({ name: 'Bob and Ana trip', monthly_cents: 9999, shared_with: [ana] });
  await money(db, bob, clock).addEntry({ label: 'Bob paid the hotel', cents: 77700, day: '2046-03-04', category_id: theirs.id });
  await money(db, ana, clock).addEntry({ label: 'Ana paid for gas', cents: 4000, day: '2046-03-04', category_id: theirs.id });
  const zip = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  const text = allText(zip) + [...zip.pictures.keys()].join('\n');
  expect(text).not.toContain('(Bob)');
  expect(text).not.toContain('Bob paid the hotel');
  expect(text).not.toContain('777.00');
  expect(text).not.toContain('99.99');
  // What Ana wrote herself is hers, with the name of the category and who shared it.
  expect(zip.files['money-entries.csv']).toContain('Ana paid for gas,40.00,2046-03-04,Bob and Ana trip,bob');
  expect(zip.files['money-categories.csv']).not.toContain('Bob and Ana trip');
  expect(zip.files['things.csv']!.split('\n').filter((l) => l.startsWith('Blue linen')).length).toBe(1);
  // Nor in the open recipe folders.
  for (const [path, file] of Object.entries(zip.files)) if (path.startsWith('recipes-open-format/')) expect(file).not.toContain('Bob');
});

it('holds no secret: no two-step key, passkey, recovery code, session, or sealed server key, by value or by column name', async () => {
  await fill(ana);
  await db.run("INSERT INTO user_security (user_id, totp_secret, webauthn_handle, notice, updated_at) VALUES (?, 'TOTP-SEED-KEY-1234', 'HANDLE-5678', 'NOTICE-TEXT', 'now')", [ana]);
  await db.run("INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, 'RECOVERY-HASH-ABCD', 'now')", [ana]);
  await db.run("INSERT INTO passkeys (user_id, credential_id, public_key, rp_id, name, created_at) VALUES (?, 'CREDENTIAL-ID-EFGH', 'PUBLIC-KEY-IJKL', 'life.example', 'My phone', 'now')", [ana]);
  await db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES ('SESSION-TOKEN-MNOP', ?, 'now', 'later', '203.0.113.7', 'Agent/9')", [ana]);
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'assistant', ?)", [ana, JSON.stringify({ url: 'http://x', key: 'SEALED-ASSISTANT-KEY-QRST' })]);
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'reminders', ?)", [ana, JSON.stringify({ topic: 'TOPIC-UVWX', email: 'ana@home.example' })]);
  await db.run("INSERT INTO mail_accounts (owner_id, address, name, username, password, imap_host, imap_port, smtp_host, smtp_port, created_at) VALUES (?, 'ana@home.example', 'Ana', 'ana-login', 'SEALED-MAIL-PASSWORD-YZ', 'imap.example', 993, 'smtp.example', 587, 'now')", [ana]);
  await db.run("INSERT INTO followed_calendars (owner_id, name, url, created_at) VALUES (?, 'Work', 'https://cal.example/KEY-IN-CALENDAR-LINK.ics', 'now')", [ana]);
  await db.run("INSERT INTO calendar_feeds (owner_id, token, kinds, created_at) VALUES (?, 'FEED-TOKEN-1111', 'a', 'now')", [ana]);
  await db.run("INSERT INTO manual_shares (owner_id, token, created_at) VALUES (?, 'MANUAL-TOKEN-2222', 'now')", [ana]);
  await db.run("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, 'https://push.example/ENDPOINT-3333', 'P256-4444', 'AUTH-5555', 'now')", [ana]);
  await db.run("INSERT INTO simplefin_connections (owner_id, access, host, connected_at) VALUES (?, 'https://SFUSER:SIMPLEFIN-ACCESS-SECRET@bridge.example/simplefin', 'bridge.example', 'now')", [ana]);
  const zip = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  const text = allText(zip) + [...zip.pictures.keys()].join('\n');
  for (const secret of ['SIMPLEFIN-ACCESS-SECRET', 'SFUSER', 'TOTP-SEED-KEY-1234', 'HANDLE-5678', 'RECOVERY-HASH-ABCD', 'CREDENTIAL-ID-EFGH', 'PUBLIC-KEY-IJKL', 'SESSION-TOKEN-MNOP', '203.0.113.7', 'SEALED-SERVER-KEY-777', 'hunter2', 'KEYINURL',
    'SEALED-ASSISTANT-KEY-QRST', 'TOPIC-UVWX', 'SEALED-MAIL-PASSWORD-YZ', 'ana-login', 'KEY-IN-CALENDAR-LINK', 'FEED-TOKEN-1111', 'MANUAL-TOKEN-2222', 'ENDPOINT-3333', 'P256-4444', 'AUTH-5555', 'NOTICE-TEXT']) {
    expect(text, secret).not.toContain(secret);
  }
  for (const column of ['password_hash', 'totp_secret', 'totp_last_step', 'webauthn_handle', 'code_hash', 'credential_id', 'public_key', 'token_hash', 'device_hash', 'p256dh']) expect(text, column).not.toContain(column);
  expect(zip.files['settings.csv']).not.toMatch(/assistant|reminders/i);
  // What is left out is said, in words, in the README.
  const readme = zip.files['README.txt']!;
  expect(readme).toContain('WHAT IS LEFT OUT, AND WHY');
  expect(readme).toContain('Your password');
  expect(readme).toContain('Two-step sign-in, passkeys and recovery codes');
  expect(readme).toContain('the assistant’s settings and key');
  expect(readme).toContain('where your reminders are sent');
});

it('is refused in plain words when the pictures are more than one download can hold', async () => {
  await fill(ana);
  await expect(exportEverything(db, ana, clock, 8)).rejects.toEqual(expect.objectContaining({ name: 'Problem', status: 422, message: expect.stringMatching(/more than one download can hold/) }));
});

it('makes a zip that holds any bytes, and reads it back', async () => {
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
  const zip = await makeZip([{ path: 'a/ünï.csv', bytes: new TextEncoder().encode('x,y\r\n'.repeat(500)) }, { path: 'pictures/p.png', bytes }, { path: 'empty.txt', bytes: new Uint8Array() }], new Date(2046, 2, 5, 10, 0, 0));
  const back = await readZip(zip);
  expect(back.map((f) => f.path)).toEqual(['a/ünï.csv', 'pictures/p.png', 'empty.txt']);
  expect([...back[1]!.bytes]).toEqual([...bytes]);
  expect(new TextDecoder().decode(back[0]!.bytes)).toBe('x,y\r\n'.repeat(500));
  expect(zip.length).toBeLessThan(5000 + 2500);
  await expect(readZip(new Uint8Array(40))).rejects.toEqual(problem(400));
});

// The fields that matter, for comparing what went out with what came in.
async function shape(owner: number) {
  const s = async (sql: string) => (await db.all(sql, [owner])).map((r) => JSON.stringify(Object.values(r))).sort();
  return {
    places: await s('SELECT name FROM places WHERE owner_id = ? ORDER BY name'),
    things: await s('SELECT i.name, k.name AS kind, i.quantity, i.unit, i.note, i.barcode, i.bought_on, i.bought_at, i.price_cents, i.value_cents, i.model, i.serial, i.warranty_until FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ?'),
    values: await s('SELECT i.name, f.name AS field, v.value FROM item_values v JOIN items i ON i.id = v.item_id JOIN kind_fields f ON f.id = v.field_id WHERE i.owner_id = ?'),
    activities: await s('SELECT i.name, a.activity FROM item_activities a JOIN items i ON i.id = a.item_id WHERE i.owner_id = ?'),
    photos: await s('SELECT i.name, p.type, LENGTH(p.bytes) FROM item_photos p JOIN items i ON i.id = p.item_id WHERE i.owner_id = ?'),
    papers: await s('SELECT i.name, d.kind, d.name, d.type, LENGTH(d.bytes) FROM item_documents d JOIN items i ON i.id = d.item_id WHERE i.owner_id = ?'),
    recipes: await s('SELECT title, description, servings, prep_minutes, cook_minutes, source_url, notes, tags FROM recipes WHERE owner_id = ?'),
    lines: await s('SELECT r.title, l.part, l.is_heading, l.text, l.sort_order FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id WHERE r.owner_id = ?'),
    gear: await s('SELECT r.title, e.label, e.quantity FROM recipe_equipment e JOIN recipes r ON r.id = e.recipe_id WHERE r.owner_id = ?'),
    meals: await s('SELECT m.day, m.meal, r.title, m.title, m.servings FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.owner_id = ?'),
    grocery: await s('SELECT label, quantity, unit, done FROM grocery WHERE owner_id = ?'),
    pantry: await s('SELECT i.name, p.quantity, p.unit, p.location, p.expires_on FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id WHERE p.owner_id = ?'),
    household: await s('SELECT name FROM household_members WHERE owner_id = ?'),
    pets: await s('SELECT name, species, breed, born_on, microchip, vet_name, vet_phone, food, photo_type, LENGTH(photo) FROM pets WHERE owner_id = ?'),
    weights: await s('SELECT p.name, w.day, w.value, w.unit FROM pet_weights w JOIN pets p ON p.id = w.pet_id WHERE p.owner_id = ?'),
    jobs: await s('SELECT j.name, j.kind, j.activity, it.name, j.every_n, j.every_unit, j.first_due, j.amount_cents, j.points, p.name, m.name, j.steps FROM upkeep_jobs j LEFT JOIN items it ON it.id = j.item_id LEFT JOIN pets p ON p.id = j.pet_id LEFT JOIN household_members m ON m.id = j.assigned_member WHERE j.owner_id = ?'),
    done: await s('SELECT j.name, d.day, d.minutes, d.note FROM upkeep_done d JOIN upkeep_jobs j ON j.id = d.job_id WHERE j.owner_id = ?'),
    tools: await s('SELECT j.name, i.name FROM upkeep_tools t JOIN upkeep_jobs j ON j.id = t.job_id JOIN items i ON i.id = t.item_id WHERE j.owner_id = ?'),
    manual: await s('SELECT section, title, body, private FROM manual_entries WHERE owner_id = ?'),
    licenses: await s('SELECT name, category, holder, number, issuer, issued_on, expires_on FROM licenses WHERE owner_id = ?'),
    media: await s('SELECT type, title, creator, year, genres, minutes, note FROM media WHERE owner_id = ?'),
    copies: await s('SELECT m.title, c.format, c.pieces, c.lent_to, c.lent_on, c.link FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ?'),
    log: await s('SELECT m.title, l.day, l.note FROM media_log l JOIN media m ON m.id = l.media_id WHERE m.owner_id = ?'),
    covers: await s('SELECT m.title, c.type, LENGTH(c.bytes) FROM media_covers c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ?'),
    events: await s('SELECT title, day, end_day, time, note, yearly FROM events WHERE owner_id = ?'),
    categories: await s('SELECT name, monthly_cents FROM money_categories WHERE owner_id = ?'),
    entries: await s('SELECT e.label, e.cents, e.day, e.note, c.name FROM money_entries e LEFT JOIN money_categories c ON c.id = e.category_id WHERE e.owner_id = ?'),
    stores: await s('SELECT name, note FROM stores WHERE owner_id = ?'),
    barcodes: await s('SELECT b.barcode, i.name, b.label, b.size_quantity, b.size_unit FROM ingredient_barcodes b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.owner_id = ?'),
    prices: await s('SELECT p.label, p.cents, p.quantity, p.unit, p.store, p.day, p.assumed, p.barcode FROM prices p WHERE p.owner_id = ?'),
    coupons: await s('SELECT c.label, i.name, c.cents_off, c.percent_off, c.store, c.code, c.expires_on, c.used_on, c.note FROM coupons c LEFT JOIN ingredients i ON i.id = c.ingredient_id WHERE c.owner_id = ?'),
    projects: await s('SELECT name, activity, status, due_on, notes FROM projects WHERE owner_id = ?'),
    projectLines: await s('SELECT p.name, l.label, l.quantity, l.unit, l.used_on, l.sort_order, i.name FROM project_items l JOIN projects p ON p.id = l.project_id LEFT JOIN items i ON i.id = l.item_id WHERE p.owner_id = ?'),
    projectTime: await s('SELECT p.name, t.day, t.minutes, t.note FROM project_sessions t JOIN projects p ON p.id = t.project_id WHERE p.owner_id = ?'),
    projectCosts: await s('SELECT p.name, c.label, c.planned_cents, c.actual_cents, c.paid_on FROM project_costs c JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ?'),
    plans: await s('SELECT name, start_day, end_day, note, story FROM plans WHERE owner_id = ?'),
    planItems: await s('SELECT p.name, i.kind, i.label, i.quantity, i.done, i.sort_order, i.ref_id IS NOT NULL FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE p.owner_id = ?'),
    planPhotos: await s('SELECT p.name, f.source, f.type, LENGTH(f.bytes), f.caption FROM plan_photos f JOIN plans p ON p.id = f.plan_id WHERE p.owner_id = ?'),
    income: await s('SELECT name, cents, every, start_day, end_day FROM money_income WHERE owner_id = ?'),
    goals: await s('SELECT name, target_cents, by_day FROM money_goals WHERE owner_id = ?'),
    goalSaved: await s('SELECT g.name, s.day, s.cents FROM money_goal_saved s JOIN money_goals g ON g.id = s.goal_id WHERE g.owner_id = ?'),
    tags: await s('SELECT t.name, pt.name AS parent FROM tags t LEFT JOIN tags pt ON pt.id = t.parent_id WHERE t.owner_id = ?'),
    tagLinks: await s(`SELECT t.name, l.kind, COALESCE(i.name, r.title, pr.name, pl.name) FROM tag_links l JOIN tags t ON t.id = l.tag_id
      LEFT JOIN items i ON l.kind = 'thing' AND i.id = l.target_id LEFT JOIN recipes r ON l.kind = 'recipe' AND r.id = l.target_id
      LEFT JOIN projects pr ON l.kind = 'project' AND pr.id = l.target_id LEFT JOIN plans pl ON l.kind = 'plan' AND pl.id = l.target_id WHERE t.owner_id = ?`),
  };
}

/** What the page does: reads the zip, sends the spreadsheets, then the pictures a few at a time. */
async function bringIn(owner: number, zipBytes: Uint8Array, chosen: string[]) {
  const { files, pictures } = await splitDownload(zipBytes);
  const done = await bringInDownload(db, owner, files, chosen, clock);
  const sent: PictureIn[] = done.pending.filter((p) => pictures.has(p.file)).map((p) => ({ as: p.as, id: p.id, kind: p.kind, name: p.name, bytes: pictures.get(p.file)! }));
  const kept = await bringInPictures(db, owner, sent, clock);
  return { ...done, kept };
}

it('brings what went out into a fresh person, kind by kind, and a second time adds nothing', async () => {
  await fill(ana);
  const zip = (await exportEverything(db, ana, clock)).bytes;
  const importable = KINDS.filter((k) => k.importable).map((k) => k.key);
  const first = await bringIn(bob, zip, importable);
  for (const kind of first.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  const byKey = Object.fromEntries(first.kinds.map((k) => [k.key, k]));
  expect(byKey.recipes).toMatchObject({ found: 1, fresh: 1, already: 0 });
  expect(byKey.things).toMatchObject({ found: 2, fresh: 2, already: 0, pictures: 2 });
  expect(byKey.upkeep).toMatchObject({ found: 4, fresh: 4 });
  expect(byKey.meals).toMatchObject({ found: 2, fresh: 2, unlinked: 0 });
  expect(first.kept).toEqual({ kept: 5, left: 0 });
  expect(byKey).toMatchObject({
    budget: { found: 2, fresh: 2 }, stores: { found: 2, fresh: 2 }, barcodes: { found: 1, fresh: 1 }, prices: { found: 2, fresh: 2 }, coupons: { found: 2, fresh: 2 },
    projects: { found: 1, fresh: 1 }, plans: { found: 1, fresh: 1, unlinked: 0, pictures: 1 },
  });
  expect(byKey.tags!.found).toBeGreaterThan(3);

  const out = await shape(ana);
  const into = await shape(bob);
  // Bob's Life Is now holds what Ana's did, field by field. (A thing's kind and fields were made for him too.)
  for (const key of Object.keys(out) as (keyof typeof out)[]) expect(into[key], key).toEqual(out[key]);
  // Links were rebuilt by name: the tool, the care for the pet, the meal's recipe, the manual entry's place.
  expect(into.tools).toEqual(out.tools);
  expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM meal_plan WHERE owner_id = ? AND recipe_id IS NOT NULL", [bob]))!.n).toBe(1);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM manual_entries WHERE owner_id = ? AND place_id IS NOT NULL', [bob]))!.n).toBe(1);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM upkeep_jobs WHERE owner_id = ? AND pet_id IS NOT NULL', [bob]))!.n).toBe(1);
  // The place's path was rebuilt for the thing.
  expect((await inventory(db, bob, clock).listItems()).find((i) => i.name === 'Blue linen')!.place).toBe('Sewing room › Shelf 2');
  // The newer parts' links: a price's ingredient, a project's gear from things, a plan's recipe and thing, a tag on a thing.
  expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM prices WHERE owner_id = ? AND ingredient_id IS NOT NULL", [bob]))!.n).toBe(2);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM project_items l JOIN projects p ON p.id = l.project_id WHERE p.owner_id = ? AND l.item_id IS NOT NULL', [bob]))!.n).toBe(1);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE p.owner_id = ? AND i.ref_id IS NOT NULL', [bob]))!.n).toBe(2);
  expect(into.tagLinks).toEqual(expect.arrayContaining([JSON.stringify(['Appliances', 'thing', 'Blue linen']), JSON.stringify(['Appliances', 'project', 'Curtains']), JSON.stringify(['Appliances', 'plan', 'Beach week'])]));
  expect(into.tags).toEqual(expect.arrayContaining([JSON.stringify(['Appliances', 'Kitchen']), JSON.stringify(['Unused', null])]));
  // The renewal of a license is not recreated; nobody else's data moved.
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM upkeep_jobs WHERE owner_id = ? AND kind = ?', [bob, 'renewal']))!.n).toBe(0);
  expect(await shape(ana)).toEqual(out);

  // The same file again: nothing new, everything already there, and no pictures to send.
  const second = await bringIn(bob, zip, importable);
  for (const kind of second.kinds.filter((k) => k.found > 0)) expect(kind, kind.key).toMatchObject({ ok: true, fresh: 0, already: kind.found });
  expect(second.pending).toEqual([]);
  expect(await shape(bob)).toEqual(into);
});

it('shows what a download holds before anything is brought in, and keeps nothing doing so', async () => {
  await fill(ana);
  const { files } = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  const before = await shape(bob);
  const looked = await lookAtDownload(db, bob, files, clock);
  expect(looked.made_on).toBe('2046-03-05');
  const kinds = Object.fromEntries(looked.kinds.map((k) => [k.key, k]));
  expect(kinds.recipes).toMatchObject({ found: 1, fresh: 1, already: 0, importable: true });
  expect(kinds.things).toMatchObject({ found: 2, fresh: 2 });
  expect(kinds.projects).toMatchObject({ found: 1, importable: true, fresh: 1 });
  expect(kinds.connections).toMatchObject({ importable: false });
  expect(await shape(bob)).toEqual(before);
  expect(await db.get('SELECT 1 AS n FROM recipes WHERE owner_id = ?', [bob])).toBeUndefined();
  // Once Bob has the recipes, a look says so.
  await bringInDownload(db, bob, files, ['recipes'], clock);
  const again = await lookAtDownload(db, bob, files, clock);
  expect(again.kinds.find((k) => k.key === 'recipes')).toMatchObject({ found: 1, fresh: 0, already: 1 });
  await expect(lookAtDownload(db, bob, { 'notes.txt': 'hello' }, clock)).rejects.toEqual(problem(400));
});

it('only the chosen kinds come in, and nothing already kept is changed or removed', async () => {
  await fill(ana);
  const zip = (await exportEverything(db, ana, clock)).bytes;
  // Bob already has a recipe with the same name and first ingredient, written differently, and a thing in the same place.
  await kitchen(db, bob, clock).createRecipe({ title: 'leek  SOUP', ingredients_text: '3 leeks', steps_text: 'Bob’s own way', tags: [] });
  const room = (await inventory(db, bob, clock).createPlace({ name: 'sewing room' })).find((p) => p.name === 'sewing room')!;
  const shelf = (await inventory(db, bob, clock).createPlace({ name: 'shelf 2', parent_id: room.id })).find((p) => p.name === 'shelf 2')!;
  const kind = (await inventory(db, bob, clock).createKind({ name: 'Cloth' })).find((k) => k.name === 'Cloth')!;
  await inventory(db, bob, clock).createItem({ kind_id: kind.id, name: 'BLUE LINEN', quantity: 99, place_id: shelf.id });
  const brought = await bringIn(bob, zip, ['recipes', 'things']);
  expect(brought.kinds.map((k) => k.key)).toEqual(['things', 'recipes']);
  expect(brought.kinds.find((k) => k.key === 'recipes')).toMatchObject({ found: 1, fresh: 0, already: 1 });
  expect(brought.kinds.find((k) => k.key === 'things')).toMatchObject({ found: 2, fresh: 1, already: 1 });
  // What was there is as it was.
  expect((await db.get<{ steps: string }>("SELECT l.text AS steps FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id WHERE r.owner_id = ? AND l.part = 'steps'", [bob]))!.steps).toBe('Bob’s own way');
  expect((await db.get<{ quantity: number }>("SELECT quantity FROM items WHERE owner_id = ? AND name = 'BLUE LINEN'", [bob]))!.quantity).toBe(99);
  // Nothing of the other kinds came.
  expect(await db.get('SELECT 1 AS n FROM pets WHERE owner_id = ?', [bob])).toBeUndefined();
  expect(await db.get('SELECT 1 AS n FROM meal_plan WHERE owner_id = ?', [bob])).toBeUndefined();
  // The photo of the one that was already there was not put on it.
  expect(await db.get("SELECT 1 AS n FROM item_photos p JOIN items i ON i.id = p.item_id WHERE i.owner_id = ? AND i.name = 'BLUE LINEN'", [bob])).toBeUndefined();
});

it('a kind that fails is undone alone and said so, the others stand; a link that cannot be rebuilt comes in without it', async () => {
  await fill(ana);
  const { files } = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  // Meals pointing at a recipe that is not here come in as plain meals; a pet that is not here leaves its care out.
  const lonely = { 'meal-plan.csv': files['meal-plan.csv']!, 'upkeep.csv': files['upkeep.csv']!, 'README.txt': files['README.txt']! };
  const done = await bringInDownload(db, bob, lonely, ['meals', 'upkeep'], clock);
  const meals = done.kinds.find((k) => k.key === 'meals')!;
  expect(meals).toMatchObject({ ok: true, found: 2, fresh: 2, unlinked: 1 });
  expect((await db.get<{ title: string }>("SELECT title FROM meal_plan WHERE owner_id = ? AND day = '2046-03-06'", [bob]))!.title).toBe('Leek soup');
  const upkeepReport = done.kinds.find((k) => k.key === 'upkeep')!;
  expect(upkeepReport.found).toBe(3);
  expect(upkeepReport.skipped.join(' ')).toContain('Rex');
  expect(upkeepReport.unlinked).toBeGreaterThan(0); // the machine's thing and tools are not here

  // A kind that cannot be kept at all: the database refuses it, and only that kind is undone.
  await db.run('CREATE TRIGGER refuse_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, \'no events today\'); END');
  const both = await bringInDownload(db, bob, files, ['licenses', 'events'], clock);
  expect(both.kinds.find((k) => k.key === 'licenses')).toMatchObject({ ok: true, fresh: 1 });
  expect(both.kinds.find((k) => k.key === 'events')).toMatchObject({ ok: false, problem: expect.stringMatching(/Nothing from calendar events was kept/) });
  expect(await db.get('SELECT 1 AS n FROM events WHERE owner_id = ?', [bob])).toBeUndefined();
  expect(await db.get('SELECT 1 AS n FROM licenses WHERE owner_id = ?', [bob])).toBeDefined();
});

it('pictures only go to a record of the person that has none, and never replace one', async () => {
  const { thing } = await fill(ana);
  const mine = await bringInPictures(db, ana, [{ as: 'thing-photo', id: thing.id, bytes: PNG }], clock);
  expect(mine).toEqual({ kept: 0, left: 1 }); // it has one
  const stranger = await bringInPictures(db, bob, [{ as: 'thing-photo', id: thing.id, bytes: PNG }, { as: 'pet-photo', id: 1, bytes: PNG }, { as: 'thing-photo', id: thing.id, bytes: Uint8Array.from([1, 2, 3, 4, 5]) }], clock);
  expect(stranger).toEqual({ kept: 0, left: 3 });
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM item_photos'))!.n).toBe(1);
});

it('an older download without the newer files still comes in, those parts simply skipped', async () => {
  await fill(ana);
  const { files } = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  for (const name of ['stores.csv', 'barcodes.csv', 'tags.csv', 'plan-photos.csv', 'plan-items.csv', 'project-lines.csv', 'money-goal-saved.csv']) delete files[name];
  const done = await bringInDownload(db, bob, files, KINDS.filter((k) => k.importable).map((k) => k.key), clock);
  for (const kind of done.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  const byKey = Object.fromEntries(done.kinds.map((k) => [k.key, k]));
  expect(byKey.stores).toMatchObject({ found: 0, fresh: 0 });
  expect(byKey.tags).toMatchObject({ found: 0, fresh: 0 });
  expect(byKey.projects).toMatchObject({ found: 1, fresh: 1 });
  expect(byKey.plans).toMatchObject({ found: 1, fresh: 1, pictures: 0 });
  // The shops named on the prices still make the start of the stores list.
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stores WHERE owner_id = ?', [bob]))!.n).toBe(2);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM project_items l JOIN projects p ON p.id = l.project_id WHERE p.owner_id = ?', [bob]))!.n).toBe(0);
});

it('twins that cannot be told apart are tagged one for one, and a tag on something that is not here comes in as the tag alone', async () => {
  const spend = money(db, ana, clock);
  const one = await spend.addEntry({ label: 'Coffee', cents: 300, day: '2046-03-01' });
  await spend.addEntry({ label: 'Coffee', cents: 300, day: '2046-03-02' });
  const tag = await tagsOf(db, ana, clock).create('Treats');
  await tagsOf(db, ana, clock).set('spending', (one as { id: number }).id, [tag.id]);
  const { files } = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  const done = await bringInDownload(db, bob, files, ['money', 'tags'], clock);
  expect(done.kinds.find((k) => k.key === 'tags')).toMatchObject({ ok: true, found: 1, fresh: 1, unlinked: 0 });
  expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE t.owner_id = ? AND l.kind = 'spending'", [bob]))!.n).toBe(1);
  // Without the spending, the tag still comes in, and the link is counted as one that could not be rebuilt.
  const carol = await person('carol');
  const alone = await bringInDownload(db, carol, files, ['tags'], clock);
  expect(alone.kinds.find((k) => k.key === 'tags')).toMatchObject({ ok: true, found: 1, fresh: 1, unlinked: 1 });
  expect(await db.get('SELECT 1 AS n FROM tags WHERE owner_id = ? AND name = ?', [carol, 'Treats'])).toBeDefined();
});

it('a plan photo goes only to a plan of the person, once, and never twice the same picture', async () => {
  const plan = await plans(db, ana, clock).create({ name: 'Trip', start_day: '2046-08-01', end_day: '2046-08-02' });
  const other = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
  const sent: PictureIn[] = [{ as: 'plan-photo', id: plan.id, name: 'Day one', bytes: PNG }, { as: 'plan-photo', id: plan.id, name: 'Day one again', bytes: PNG }, { as: 'plan-photo', id: plan.id, name: 'Day two', bytes: other }];
  expect(await bringInPictures(db, bob, sent, clock)).toEqual({ kept: 0, left: 3 });
  expect(await bringInPictures(db, ana, sent, clock)).toEqual({ kept: 2, left: 1 });
  expect((await db.all<{ caption: string; sort_order: number }>('SELECT caption, sort_order FROM plan_photos WHERE plan_id = ? ORDER BY sort_order', [plan.id])).map((p) => `${p.caption}:${p.sort_order}`)).toEqual(['Day one:1', 'Day two:2']);
});

it('after the trial, everything can still be downloaded and looked over, but not brought in', async () => {
  const { decide, isPaidPath } = await import('../src/access.ts');
  expect([isPaidPath('/api/export/everything.zip'), isPaidPath('/api/export/look'), isPaidPath('/api/export/bring-in'), isPaidPath('/api/export/pictures')]).toEqual([false, false, true, true]);
  const ended = { state: 'ended' } as Parameters<typeof decide>[0];
  expect([decide(ended, 'GET', '/api/export/everything.zip'), decide(ended, 'POST', '/api/export/look'), decide(ended, 'POST', '/api/export/bring-in')]).toEqual(['go', 'go', 'read_only']);
});

it('takes prep reminders and a time to eat along with the recipe and the meal', async () => {
  const k = kitchen(db, ana, clock);
  const recipe = (await k.createRecipe({ title: 'Roast chicken', ingredients_text: '1 chicken' })).id;
  await prep(db, ana, clock).setRecipeSteps(recipe, [{ words: 'Thaw the chicken', rule: 'night_before', at: '20:00' }, { words: 'Salt it', rule: 'hours_before', hours: 3 }]);
  const meal = (await k.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: recipe })).id;
  await prep(db, ana, clock).setMeal(meal, { eat_time: '19:30', steps: [{ words: 'Make the stock', rule: 'morning_of', at: '09:00' }] });
  const zip = (await exportEverything(db, ana, clock)).bytes;
  const done = await bringIn(bob, zip, ['recipes', 'meals']);
  for (const kind of done.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  const [r] = await k.listRecipes();
  const theirs = (await kitchen(db, bob, clock).listRecipes()).find((x) => x.title === 'Roast chicken')!;
  expect((await prep(db, bob, clock).recipeSteps(theirs.id)).map((s) => s.when)).toEqual((await prep(db, ana, clock).recipeSteps(r!.id)).map((s) => s.when));
  const bobMeal = (await kitchen(db, bob, clock).listPlan('2046-03-06', 1))[0]!;
  const bobPrep = await prep(db, bob, clock).meal(bobMeal.id);
  expect([bobPrep.eat_time, bobPrep.steps.map((s) => s.words), bobPrep.recipe_steps.length]).toEqual(['19:30', ['Make the stock'], 2]);
});
