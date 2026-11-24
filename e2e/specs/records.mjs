// Home records: a thing's cost, serial and warranty, a receipt kept with it, and the home inventory.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const receipt = path.join(mkdtempSync(path.join(tmpdir(), 'lifeis-paper-')), 'Costco receipt.pdf');
writeFileSync(receipt, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

const soon = new Date(Date.now() + 20 * 86400000);
const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
const tv = await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await post('/api/things/kinds', { name: 'Appliances', icon: '📺' }))[0].id;
  const living = (await post('/api/things/places', { name: 'Living room' }))[0].id;
  await post('/api/things/items', { kind_id: kind, name: 'Old kettle' });
  return (await post('/api/things/items', { kind_id: kind, name: 'Television', place_id: living })).id;
});

await page.goto(`${base}/things/${tv}`); await page.waitForTimeout(1200);
const card = page.getByRole('region', { name: 'Records' });
check('a thing has a Records card that says what it is for', (await card.innerText()).includes('what an insurer or a repair shop asks for'));
await card.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(400);
await card.getByLabel('Bought at').fill('Costco');
await card.getByLabel('What it cost').fill('799');
await card.getByLabel('Worth now (if different)').fill('500');
await card.getByLabel('Model').fill('QN55');
await card.getByLabel('Serial number').fill('SN-12345');
await card.getByLabel('Warranty until').fill(day);
await card.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1200);
const shown = (await card.innerText()).replace(/\s+/g, ' ');
check('its records show: cost, worth, numbers and warranty', ['Costco', '$799.00', '$500.00', 'QN55', 'SN-12345', 'Warranty ends in 20 days'].every((t) => shown.includes(t)), shown.slice(0, 220));

await card.getByLabel("The paper's file").setInputFiles(receipt); await page.waitForTimeout(1500);
const papers = (await card.getByRole('list', { name: 'Papers' }).innerText().catch(() => '')).replace(/\s+/g, ' ');
check('a receipt is kept with it', papers.includes('Costco receipt.pdf'), papers);
const paper = await page.evaluate(async (id) => { const list = await fetch(`/api/things/items/${id}/documents`).then((r) => r.json()); const r = await fetch(`/api/things/documents/${list[0].id}`); return [r.status, r.headers.get('content-type'), (await r.text()).slice(0, 8)]; }, tv);
check('and comes back as it was sent', paper[0] === 200 && paper[1] === 'application/pdf' && paper[2] === '%PDF-1.4', JSON.stringify(paper));
await page.screenshot({ path: `${shots}/records-thing.png`, fullPage: true });

await page.goto(`${base}/things`); await page.waitForTimeout(1000);
await page.getByRole('link', { name: 'Home inventory' }).click(); await page.waitForTimeout(1500);
const sheet = (await page.getByLabel('The inventory').innerText()).replace(/\s+/g, ' ');
check('the inventory totals what is kept and what has proof', sheet.includes('2 things · worth $500.00 in all · 0 with a photo · 1 with a receipt'), (await page.locator('[data-totals]').innerText()));
check('it goes room by room, with the serial number', /Living room 1 thing · cost \$799\.00 · worth now \$500\.00/.test(sheet) && sheet.includes('S/N SN-12345') && sheet.includes('No place yet'), sheet.slice(0, 360));
check('it says how many things still need a value', (await page.locator('main').innerText()).includes('1 of your 2 things has no price or value yet'));
check('warranties ending soon are listed', (await page.getByRole('region', { name: 'Warranties ending soon' }).innerText()).includes('Television'));
await page.screenshot({ path: `${shots}/records-inventory.png`, fullPage: true });

// ---- The inventory by room: a house with two rooms, a shelf and a bin, and things with and without values and photos. ----
const house = await page.evaluate(async () => {
  const send = (method, url, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await send('GET', '/api/things/kinds'))[0].id;
  const places = await send('GET', '/api/things/places');
  const living = places.find((p) => p.name === 'Living room').id;
  const kitchen = (await send('POST', '/api/things/places', { name: 'Kitchen' })).find((p) => p.name === 'Kitchen').id;
  const shelf = (await send('POST', '/api/things/places', { name: 'Shelf', parent_id: living })).find((p) => p.name === 'Shelf').id;
  const bin = (await send('POST', '/api/things/places', { name: 'Bin', parent_id: shelf })).find((p) => p.name === 'Bin').id;
  const make = (name, place_id, records) => send('POST', '/api/things/items', { kind_id: kind, name, place_id, records });
  await make('Blender', kitchen, { price_cents: 12000, serial: 'BL-1' });
  await make('Toaster', kitchen);
  await make('Remote', bin, { price_cents: 2500, value_cents: 1500 });
  await make('Rug', shelf, { value_cents: 30000, serial: 'RG-7' });
  await make('Lamp', shelf);
  return { living, kitchen };
});
// A small real picture, drawn in the page and kept as a JPEG, for the television and for the walk-through below.
const drawn = async () => Buffer.from(await page.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
  const ctx = canvas.getContext('2d'); const fill = ctx.createLinearGradient(0, 0, 96, 64); fill.addColorStop(0, '#2a9d8f'); fill.addColorStop(1, '#e76f51');
  ctx.fillStyle = fill; ctx.fillRect(0, 0, 96, 64); ctx.fillStyle = '#fff'; ctx.fillRect(20, 16, 56, 32);
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}), 'base64');
const picture = await drawn();
await page.evaluate(async ({ id, data }) => { await fetch(`/api/things/items/${id}/photo`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }); }, { id: tv, data: picture.toString('base64') });

await page.setViewportSize({ width: 1100, height: 900 });
await page.goto(`${base}/things/report`); await page.waitForTimeout(1500);
let room = (name) => page.getByRole('region', { name, exact: true });
const roomText = async (name) => (await room(name).innerText()).replace(/\s+/g, ' ');
const headings = await page.locator('.report-room h3').allInnerTexts();
check('rooms come in name order with "No place yet" last', JSON.stringify(headings) === JSON.stringify(['Kitchen', 'Living room', 'No place yet']), headings.join(' | '));
check('a room says how many things, what they cost and are worth, and how many have proof', (await roomText('Living room')).includes('4 things · cost $824.00 · worth now $815.00 · 1 with a photo · 2 with a serial number · 1 with a receipt'), (await roomText('Living room')).slice(0, 200));
check('a thing on a shelf in a bin is in its room, with where', (await roomText('Living room')).includes('Remote') && (await roomText('Living room')).includes('Shelf › Bin'));
check('a room counted at cost says so, with a footnote', (await roomText('Kitchen')).includes('2 things · cost $120.00 · worth now $120.00 *') && (await page.locator('[data-footnote]').innerText()).includes('counted at what it cost'));
check('the top has the household totals and what they leave out', (await page.locator('[data-totals]').innerText()).includes('7 things · worth $935.00 in all') && (await page.locator('[data-unvalued]').innerText()).includes('3 things have no value recorded'), await page.locator('[data-totals]').innerText());
check('a photo has alt text naming the thing', await page.getByRole('img', { name: 'Photo of Television' }).isVisible());

await page.getByRole('radio', { name: 'Only the rooms I choose' }).check();
await page.getByRole('checkbox', { name: /^Kitchen/ }).uncheck(); await page.getByRole('checkbox', { name: /^No place yet/ }).uncheck(); await page.waitForTimeout(900);
const livingOnly = (await page.getByLabel('The inventory').innerText()).replace(/\s+/g, ' ');
check('choosing one room leaves only its things', livingOnly.includes('Rug') && !livingOnly.includes('Blender') && !livingOnly.includes('Kettle'), livingOnly.slice(0, 200));
await page.getByLabel('Only things worth at least (dollars)').fill('500'); await page.waitForTimeout(1000);
const dear = (await page.getByLabel('The inventory').innerText()).replace(/\s+/g, ' ');
check('a minimum worth narrows it to the dear things, and the household totals stay whole', dear.includes('Television') && !dear.includes('Remote') && !dear.includes('Rug') && dear.includes('This report shows 1 thing, worth $500.00') && dear.includes('7 things · worth $935.00 in all'), dear.slice(0, 300));

const [saved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click()]);
const csv = (await import('node:fs')).readFileSync(await saved.path(), 'utf8');
check('the spreadsheet downloads with the day in its name', /^home-inventory-\d{4}-\d{2}-\d{2}\.csv$/.test(saved.suggestedFilename()), saved.suggestedFilename());
check('it starts with a byte-order mark and has one row for the one thing chosen', csv.charCodeAt(0) === 0xfeff && csv.trim().split('\r\n').length === 2, JSON.stringify(csv.slice(0, 120)));
check('and that row has what an adjuster asks for', csv.includes(`Living room,,Television,Appliances,some,QN55,SN-12345,,Costco,799.00,500.00,${day},yes,yes\r\n`), JSON.stringify(csv.slice(-130)));

await page.getByLabel('Only things worth at least (dollars)').fill(''); await page.getByRole('radio', { name: 'All rooms' }).check();
await page.getByRole('checkbox', { name: 'One room per page' }).check(); await page.waitForTimeout(1000);
await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300);
check('printing hides the page header, the tabs and the buttons', !(await page.locator('header').first().isVisible()) && !(await page.getByLabel('Sections').first().isVisible())
  && !(await page.getByRole('button', { name: 'Print or save as PDF' }).isVisible()) && await page.getByLabel('The inventory').isVisible());
const printed = await page.evaluate(() => {
  const sheet = document.querySelector('.report-sheet'); const rooms = [...document.querySelectorAll('.report-room')];
  const style = (el) => getComputedStyle(el);
  return { colour: style(sheet).color, back: style(sheet).backgroundColor, second: style(rooms[1]).breakBefore, first: style(rooms[0]).breakBefore, head: style(rooms[0].querySelector('thead')).display,
    row: style(rooms[0].querySelector('tbody tr')).breakInside, serial: style(document.querySelector('.serial')).fontFamily };
});
check('printed black on white, one room to a page, headings repeating, rows whole, serials in monospace',
  printed.colour === 'rgb(0, 0, 0)' && printed.back === 'rgb(255, 255, 255)' && printed.second === 'page' && printed.first !== 'page' && printed.head === 'table-header-group' && printed.row === 'avoid' && /mono|Consolas|Menlo/i.test(printed.serial), JSON.stringify(printed));
await page.screenshot({ path: `${shots}/inventory-by-room.png`, fullPage: true });
await page.emulateMedia({ media: null });

// ---- Walking through a room with a phone: the kitchen has a blender (no photo) and a toaster (nothing yet). ----
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${base}/things/places/${house.kitchen}`); await page.waitForTimeout(1000);
await page.getByRole('link', { name: 'Walk through this room' }).click(); await page.waitForTimeout(1200);
const progress = async () => (await page.locator('[data-progress]').innerText()).replace(/\s+/g, ' ');
check('the walk-through counts what has a photo and a value', (await progress()) === '0 of 2 things in this room have a photo and a value.', await progress());
const marks = (await page.locator('li[data-thing="Toaster"] [data-missing]').innerText());
check('each thing says what it lacks', marks === 'No photo · No value · No serial number', marks);
check('"Add something else" goes to Fill a place', (await page.getByRole('link', { name: /Add something else in this room/ }).getAttribute('href')).endsWith(`/things/places/${house.kitchen}/fill`));
check('the photo button opens the phone camera', await page.locator('li[data-thing="Toaster"] input[type=file]').evaluate((el) => el.accept === 'image/*' && el.getAttribute('capture') === 'environment'));

// A failed save says so in plain words, and nothing is lost.
await page.route('**/api/things/items/*', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
await page.getByLabel('What Toaster is worth now, in dollars').fill('25'); await page.keyboard.press('Tab'); await page.waitForTimeout(700);
check('a save that fails says so', (await page.locator('li[data-thing="Toaster"] [role=alert]').innerText()).includes("didn't save"));
await page.unroute('**/api/things/items/*');

await page.getByLabel('What Toaster is worth now, in dollars').fill('25.50'); await page.keyboard.press('Tab'); await page.waitForTimeout(900);
await page.getByLabel('The serial number of Toaster').fill('TS-9'); await page.keyboard.press('Tab'); await page.waitForTimeout(900);
check('a value and a serial number are kept as they are typed', (await page.locator('li[data-thing="Toaster"]').innerText()).includes('Serial number saved.') && (await page.locator('li[data-thing="Toaster"] [data-missing]').innerText()) === 'No photo');
await page.locator('li[data-thing="Toaster"] input[type=file]').setInputFiles({ name: 'toaster.jpg', mimeType: 'image/jpeg', buffer: picture }); await page.waitForTimeout(1500);
check('a photo moves the running line', (await progress()) === '1 of 2 things in this room have a photo and a value.', await progress());
check('and is kept with a name for its alt text', await page.getByRole('img', { name: 'Photo of Toaster' }).isVisible());
await page.locator('li[data-thing="Blender"] input[type=file]').setInputFiles({ name: 'blender.jpg', mimeType: 'image/jpeg', buffer: picture }); await page.waitForTimeout(1500);
check('the room is done when every thing has a photo and a value', (await progress()) === '2 of 2 things in this room have a photo and a value.' && (await page.locator('[data-complete]').innerText()).includes('This room is done'), await progress());
check('and the next room that is not done is offered', (await page.locator('[data-complete] a').innerText()).startsWith('Next: Living room'), await page.locator('[data-complete]').innerText());
const kept = await page.evaluate(async (id) => (await fetch(`/api/things/items/${id}`).then((r) => r.json())), (await page.evaluate(async () => (await fetch('/api/things/items?q=Toaster').then((r) => r.json()))[0].id)));
check('all of it was kept on the server', kept.records.value_cents === 2550 && kept.records.serial === 'TS-9' && kept.photo === true, JSON.stringify(kept.records));
const sizes = await page.evaluate(() => [...document.querySelectorAll('main button, main input:not([type=file]), main a.inline-flex')].map((el) => Math.round(el.getBoundingClientRect().height)));
check('every control is at least 44px tall at phone width, and nothing scrolls sideways', sizes.every((h) => h >= 44) && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), sizes.join(','));
await page.screenshot({ path: `${shots}/walk-through-phone.png`, fullPage: true });

// ---- How ready the whole inventory is, and the way in to the room that needs most. ----
await page.setViewportSize({ width: 393, height: 852 });
await page.goto(`${base}/things/report`); await page.waitForTimeout(1500);
check('the inventory says how many things have a value, a photo and a serial number', (await page.locator('[data-ready]').innerText()).replace(/\s+/g, ' ') === 'Of 7 things: 5 have a value, 3 have a photo, 4 have a serial number.', await page.locator('[data-ready]').innerText());
await page.getByRole('link', { name: /^Walk through Living room/ }).click(); await page.waitForTimeout(1000);
check('and links into the room with the most missing', page.url().endsWith(`/things/places/${house.living}/walk`) && (await progress()).startsWith('1 of 4 things'), page.url() + ' ' + await progress());

await page.keyboard.press('/'); await page.waitForTimeout(300);
await page.getByLabel('Search everything', { exact: true }).fill('SN-12345'); await page.waitForTimeout(1200);
check('search finds a thing by its serial number', (await page.getByRole('list', { name: 'What was found' }).innerText()).includes('Television'));
await browser.close();
