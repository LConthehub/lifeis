// Filling a place by scanning and typing, then a thing's page: its history, a use, its activities, stickers.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

const setup = await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await post('/api/things/kinds', { name: 'Household', icon: '🏠' });
  const kinds = await fetch('/api/things/kinds').then((r) => r.json());
  let places = await post('/api/things/places', { name: "Son's room" });
  const room = places[0].id;
  places = await post('/api/things/places', { name: 'Bookshelf', parent_id: room });
  const shelf = places.find((p) => p.name === 'Bookshelf').id;
  places = await post('/api/things/places', { name: 'Living room' });
  const living = places.find((p) => p.name === 'Living room').id;
  const lamp = await post('/api/things/items', { kind_id: kinds[0].id, name: 'Reading lamp', barcode: '5012345678900', place_id: living, activities: ['Reading'] });
  const blanks = await fetch('/api/things/stickers/blank?count=2').then((r) => r.json());
  return { shelf, lamp: lamp.id, blank: blanks[0] };
});

await page.goto(`${base}/things/places/${setup.shelf}`); await page.waitForTimeout(800);
await page.getByRole('link', { name: 'Fill this place' }).click(); await page.waitForTimeout(1200);
check('the fill page opens for the shelf', await page.getByRole('heading', { name: 'Filling Bookshelf' }).isVisible());
const offer = page.getByRole('button', { name: 'Turn look-ups on' });
if (await offer.isVisible().catch(() => false)) { await offer.click(); await page.waitForTimeout(800); check('look-ups turned on from the page', !(await offer.isVisible().catch(() => false))); }

const scan = async (code, wait = 3500) => {
  const box = page.getByLabel('Or type the number under the bars');
  await box.waitFor({ timeout: 5000 });
  await box.fill(code);
  await page.getByRole('button', { name: 'Find' }).click();
  await page.waitForTimeout(wait);
};
const lines = () => page.locator('[aria-label="What happened"] li').allInnerTexts();
// A look-up on the internet can take a good while: wait until no line is still "looking it up".
const settled = async () => { for (let i = 0; i < 80 && (await lines()).some((l) => l.includes('looking it up')); i += 1) await page.waitForTimeout(500); };

await scan('9780441172719', 800);
check('a scan shows at once, while it is looked up', (await lines())[0]?.includes('looking it up') || (await lines())[0]?.includes('Dune'), (await lines())[0]);
await settled();
check('a book is looked up and added here', (await lines())[0]?.includes('Dune') && (await lines())[0]?.includes('Paperback'), (await lines())[0]);
await page.getByLabel('Something with no barcode').fill('Lego bin');
await page.getByLabel('Something with no barcode').press('Enter'); await page.waitForTimeout(1200);
check('typing a name adds a thing here', (await lines())[0]?.includes('Lego bin'), (await lines())[0]);
await scan('5012345678900');
check('something you have is moved here, saying from where', (await lines())[0]?.includes('moved here from Living room'), (await lines())[0]);
await scan(`${base}/t/${setup.blank}`);
check('a blank sticker asks what it is on', (await lines())[0]?.includes('A new sticker'), (await lines())[0]);
await page.getByLabel('Its name').first().fill('Kite');
await page.getByLabel('Its name').first().press('Enter'); await page.waitForTimeout(1200);
check('naming it adds the thing with that sticker', (await lines())[0]?.includes('Kite') && (await lines())[0]?.includes('added'), (await lines())[0]);
await scan('2000000000015', 5000);
check('an unknown barcode asks what it is', (await lines())[0]?.includes('not known'), (await lines())[0]);
await page.getByLabel('Its name').first().fill('Mystery box');
await page.getByLabel('Its name').first().press('Enter'); await page.waitForTimeout(1200);
await scan('9780441172719');
check('scanning it again says it is already here', (await lines())[0]?.includes('already here'), (await lines())[0]);
await page.screenshot({ path: `${shots}/fill-phone.png`, fullPage: true });

const inShelf = await page.evaluate((shelf) => fetch(`/api/things/items?place_id=${shelf}`).then((r) => r.json()).then((l) => l.map((t) => t.name).sort()), setup.shelf);
check('the shelf holds every thing', JSON.stringify(inShelf) === JSON.stringify(['Kite', 'Lego bin', 'Mystery box', 'Reading lamp']), inShelf.join(', '));
const kiteSticker = await page.evaluate((code) => fetch(`/api/things/scan?code=${encodeURIComponent('/t/' + code)}`).then((r) => r.json()), setup.blank);
check('the sticker now finds the kite', kiteSticker.kind === 'thing' && kiteSticker.item.name === 'Kite');

// The lamp's own page: its history, and a use.
await page.goto(`${base}/things/${setup.lamp}`); await page.waitForTimeout(1000);
const history = await page.getByRole('list', { name: 'History' }).innerText();
check("the lamp's history shows the move", history.includes("Moved from Living room to Son's room › Bookshelf") && history.includes('Added, in Living room'), history.replace(/\s+/g, ' '));
await page.getByRole('button', { name: 'I used it' }).click(); await page.waitForTimeout(500);
await page.getByRole('dialog').getByLabel('A note').fill('bedtime story');
await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click(); await page.waitForTimeout(1000);
const after = await page.getByRole('list', { name: 'History' }).innerText();
check('a use is added to its history, with its activity', after.includes('Used (Reading)') && after.includes('bedtime story'), after.split('\n').slice(0, 3).join(' | '));
await page.screenshot({ path: `${shots}/thing-phone.png`, fullPage: true });

await page.goto(`${base}/things/activities?name=Reading`); await page.waitForTimeout(1000);
check('the activity lists its gear', await page.getByText('Reading lamp').isVisible());

await page.goto(`${base}/things/stickers?blank=8`); await page.waitForTimeout(2500);
check('a sheet of blank stickers is drawn', (await page.locator('img[data-code]').count()) === 8);
await page.goto(`${base}/things`); await page.waitForTimeout(800);
await page.getByText('Kite').click(); await page.waitForTimeout(800);
check('a thing in the list opens its page', /\/things\/\d+$/.test(page.url()), page.url());

console.log(results.join('\n'));
await browser.close();
