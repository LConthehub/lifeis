// The Books tab, and making a place ("Bedroom › Bookshelf") from inside the form that needs it.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

// One place already there, so the new path has to reuse it rather than make a second "Bedroom".
await page.evaluate(() => fetch('/api/things/places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bedroom' }) }));

await page.goto(base + '/media/books'); await page.waitForTimeout(800);
check('Books page has its heading', await page.getByRole('heading', { name: 'Books' }).isVisible());
check('empty Books page explains scanning', await page.getByText('No books yet').isVisible());
await page.getByRole('button', { name: '+ Add' }).click(); await page.waitForTimeout(500);
const form = page.getByRole('dialog');
check('new title starts as a book', (await form.locator('select').first().inputValue()) === 'book');
await form.getByLabel('Title *').fill('The Hobbit');
await form.getByLabel("What it's on").fill('Paperback');
await form.locator('select').nth(1).selectOption('new');
await form.getByLabel('The new place').fill('Bedroom › Bookshelf');
await page.screenshot({ path: `${shots}/books-new-place.png` });
await form.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
const chosen = await form.locator('select').nth(1).evaluate((s) => s.options[s.selectedIndex].text);
check('the new place is chosen', chosen === 'Bedroom › Bookshelf', chosen);
await form.getByRole('button', { name: /Save|Add it/ }).last().click(); await page.waitForTimeout(1200);
check('the book shows where it is', await page.getByText('Bedroom › Bookshelf').first().isVisible().catch(() => false));
const places = await page.evaluate(() => fetch('/api/things/places').then((r) => r.json()));
check('Bedroom was reused, not made twice', places.filter((p) => p.name === 'Bedroom').length === 1 && places.length === 2, places.map((p) => p.path).join(', '));

await page.goto(base + '/media/books'); await page.waitForTimeout(800);
check('Books tab lists it', await page.getByText('The Hobbit').isVisible());
await page.screenshot({ path: `${shots}/books-tab.png` });

// The same picker on a thing (a fresh account has no kinds of thing yet, so one is made first).
await page.evaluate(() => fetch('/api/things/kinds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Toys', icon: '🧸' }) }));
await page.goto(base + '/things'); await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/books-things.png` });
await page.getByRole('button', { name: /\+ Add|Add a thing/ }).first().click(); await page.waitForTimeout(500);
const thing = page.getByRole('dialog');
await thing.getByLabel('What *').fill('Lego bin');
await thing.locator('select').filter({ has: page.locator('option[value="new"]') }).selectOption('new');
await thing.getByLabel('The new place').fill('Bedroom > Under the bed');
await thing.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
const placesAfter = await page.evaluate(() => fetch('/api/things/places').then((r) => r.json()));
check('a thing can make a place too', placesAfter.some((p) => p.path === 'Bedroom › Under the bed') && placesAfter.length === 3, placesAfter.map((p) => p.path).join(', '));

// Things are filed under a few plain headings: two ready-made sets and a kind of the person's own.
await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await post('/api/things/starters', { slug: 'cookware' });
  await post('/api/things/starters', { slug: 'sewing' });
  const kinds = await fetch('/api/things/kinds').then((r) => r.json());
  const id = (name) => kinds.find((k) => k.name === name).id;
  await post('/api/things/items', { kind_id: id('Cast iron'), name: 'Lodge skillet' });
  await post('/api/things/items', { kind_id: id('Cast iron'), name: 'Dutch oven' });
  await post('/api/things/items', { kind_id: id('Fabric'), name: 'Blue linen' });
  await post('/api/things/items', { kind_id: id('Toys'), name: 'Wooden train' });
});
await page.goto(base + '/things'); await page.waitForTimeout(1000);
const groupRow = page.getByRole('group', { name: 'Part of the house or hobby' });
const chips = (await groupRow.getByRole('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
check('the chips are the headings, in order, with counts', JSON.stringify(chips) === JSON.stringify(['Everything 4', 'Cooking 2', 'Crafts 1', 'Other 1']), chips.join(' | '));
const headings = await page.getByRole('heading', { level: 2 }).allInnerTexts();
check('each heading sits over its own things', headings.length === 3 && /^Cooking/.test(headings[0]) && /^Crafts/.test(headings[1]) && /^Other/.test(headings[2]), headings.join(' | '));
await page.screenshot({ path: `${shots}/things-grouped.png`, fullPage: true });
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(300);
const tall = await groupRow.getByRole('button').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
check('on a phone the chips are easy to tap and the page does not slide sideways', tall >= 44 && wide, `${tall}px, fits: ${wide}`);
await page.screenshot({ path: `${shots}/things-grouped-phone.png`, fullPage: true });
await groupRow.getByRole('button', { name: /^Cooking/ }).click(); await page.waitForTimeout(300);
const cooking = await page.locator('main').innerText();
check('choosing Cooking shows only its things', /Lodge skillet/.test(cooking) && /Dutch oven/.test(cooking) && !/Blue linen/.test(cooking) && !/Wooden train/.test(cooking));
check('Cooking can be narrowed to one of its kinds', await page.getByRole('group', { name: 'Kind of thing in Cooking' }).getByRole('button', { name: /Cast iron/ }).isVisible());
await page.getByRole('group', { name: 'Kind of thing in Cooking' }).getByRole('button', { name: /Pots and pans/ }).click(); await page.waitForTimeout(300);
check('narrowing to a kind with nothing in it shows nothing matches', /Nothing matches/.test(await page.locator('main').innerText()));
await groupRow.getByRole('button', { name: /^Other/ }).click(); await page.waitForTimeout(300);
const other = await page.locator('main').innerText();
check('Other holds the kind the person made', /Wooden train/.test(other) && !/Lodge skillet/.test(other));
check('a group with one kind has no second row of chips', (await page.getByRole('group', { name: /Kind of thing in/ }).count()) === 0);
await page.getByRole('link', { name: 'Manage kinds' }).click(); await page.waitForTimeout(800);
check('Manage kinds opens the kinds page, still in the tidy section', /\/things\/kinds$/.test(page.url()) && await page.getByRole('heading', { name: 'Kinds of things' }).isVisible() && await page.getByRole('link', { name: /Things/ }).first().isVisible());
await page.getByRole('link', { name: '← Things' }).click(); await page.waitForTimeout(800);
check('and there is a way back to Things', /\/things$/.test(page.url()));

// A kind's things are for an activity: set on the kind, a new thing starts out with it, and one button gives it to the things already there.
const api = (method, url, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, url, body ?? null]);
await page.goto(base + '/things/kinds'); await page.waitForTimeout(800);
await page.locator('section').filter({ has: page.getByRole('heading', { name: /Toys/ }) }).getByRole('button', { name: 'Edit' }).click(); await page.waitForTimeout(500);
const kindForm = page.getByRole('dialog');
check('the kind form has no button before it is for anything', await kindForm.getByRole('button', { name: /Add this to the/ }).count() === 0);
await kindForm.getByLabel('What its things are usually for').fill('woodworking');
const offered = await kindForm.locator('#kind-activities option').evaluateAll((os) => os.map((o) => o.value));
check('the known kinds of project are offered as suggestions', offered.includes('Woodworking') && offered.includes('Car & mechanics') && offered.length >= 12, offered.join(', '));
await kindForm.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(800);
check('the kind shows what it is for', /for woodworking/.test(await page.locator('main').innerText()));
const toys = (await api('GET', '/api/things/kinds')).find((k) => k.name === 'Toys');
const chest = await api('POST', '/api/things/items', { kind_id: toys.id, name: 'Toy chest', activities: [] });
check('a new thing of that kind starts out for it', JSON.stringify(chest.activities) === '["woodworking"]', JSON.stringify(chest.activities));
const lacking = (await api('GET', '/api/things/items')).filter((i) => i.kind_id === toys.id && !i.activities.some((a) => a.toLowerCase() === 'woodworking')).length;
await page.locator('section').filter({ has: page.getByRole('heading', { name: /Toys/ }) }).getByRole('button', { name: 'Edit' }).click(); await page.waitForTimeout(700);
const give = page.getByRole('dialog').getByRole('button', { name: /Add this to the \d+ things? of this kind/ });
check(`one button offers to add it to the ${lacking} things without it`, lacking >= 1 && await give.isVisible() && (await give.innerText()).includes(`the ${lacking} thing`), await give.innerText().catch(() => 'no button'));
check('the button is tall enough to tap', (await give.boundingBox()).height >= 44);
await page.screenshot({ path: `${shots}/kind-activity-phone.png` });
await give.click(); await page.waitForTimeout(900);
check('it says how many it was added to, and the button goes', await page.getByRole('dialog').getByText(`Added woodworking to ${lacking}`).isVisible() && await page.getByRole('dialog').getByRole('button', { name: /Add this to the/ }).count() === 0);
const train = (await api('GET', '/api/things/items')).find((i) => i.name === 'Wooden train');
check('things already there gained it', JSON.stringify(train.activities) === '["woodworking"]', JSON.stringify(train.activities));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const proj = await api('POST', '/api/projects', { name: 'Toy shelf', activity: 'Woodworking', status: 'active' });
await page.goto(base + `/projects/${proj.id}`); await page.waitForTimeout(1000);
const gear = await page.getByRole('region', { name: 'Gear for Woodworking' }).innerText().catch(() => '');
check('a Woodworking project lists the kind\'s things under "Your gear for"', /Your gear for Woodworking/.test(gear) && /Toy chest/.test(gear) && /Wooden train/.test(gear), gear.replace(/\s+/g, ' ').slice(0, 120));

console.log(results.join('\n'));
await browser.close();
