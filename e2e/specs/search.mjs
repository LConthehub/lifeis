// One search across everything, opened from the header or with "/", each answer leading to its page.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await post('/api/things/kinds', { name: 'Tools', icon: '🧰' }))[0].id;
  const garage = (await post('/api/things/places', { name: 'Garage' }))[0].id;
  const ladder = await post('/api/things/items', { kind_id: kind, name: 'Step ladder', place_id: garage });
  await post('/api/kitchen/recipes', { title: 'Ladder-rung flatbread', ingredients_text: '2 cups flour' });
  await post('/api/media', { type: 'book', title: "Jacob's Ladder", copy: { format: 'Paperback', place_id: garage } });
  await post('/api/things/upkeep', { name: 'Check the ladder feet', every_n: 1, every_unit: 'year', tools: [ladder.id] });
  await post('/api/projects', { name: 'Paint the hall', activity: 'Decorating' });
});

await page.reload(); await page.waitForTimeout(1200);
await page.keyboard.press('/'); await page.waitForTimeout(400);
const win = page.getByRole('dialog', { name: 'Search' });
check('"/" opens search from anywhere', await win.isVisible());
await win.getByLabel('Search everything', { exact: true }).fill('ladder'); await page.waitForTimeout(1200);
const found = (await win.getByRole('list', { name: 'What was found' }).innerText()).replace(/\s+/g, ' ');
check('one search finds a recipe, a thing, a book and an upkeep job', ['Ladder-rung flatbread', 'Step ladder', "Jacob's Ladder", 'Check the ladder feet'].every((t) => found.includes(t)) && !found.includes('Paint the hall'), found.slice(0, 200));
check('a thing says where it is', found.includes('Tools · 📍 Garage'));
await page.screenshot({ path: `${shots}/search.png` });
await win.getByRole('button', { name: 'Upkeep', exact: true }).click(); await page.waitForTimeout(900);
const jobs = (await win.getByRole('list', { name: 'What was found' }).innerText()).replace(/\s+/g, ' ');
check('it can be narrowed to one kind', jobs.includes('Check the ladder feet') && !jobs.includes('Step ladder'), jobs);
await win.getByLabel('Search everything', { exact: true }).press('Enter'); await page.waitForTimeout(1000);
check('Enter opens the first answer', /\/things\/upkeep\/\d+$/.test(page.url()), page.url());

// On a phone: the magnifying glass in the header.
await page.setViewportSize({ width: 375, height: 667 }); await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Search everything in Life Is' }).click(); await page.waitForTimeout(400);
await page.getByLabel('Search everything', { exact: true }).fill('garage'); await page.waitForTimeout(1200);
await page.getByRole('list', { name: 'What was found' }).getByRole('button').first().click(); await page.waitForTimeout(1000);
check('on a phone, tapping an answer opens it', /\/things\/places\/\d+$/.test(page.url()), page.url());
await page.getByRole('button', { name: 'Search everything in Life Is' }).click();
await page.getByLabel('Search everything', { exact: true }).fill('zzzz'); await page.waitForTimeout(1200);
check('nothing found says so', (await page.getByRole('list', { name: 'What was found' }).innerText()).includes('Nothing found'));
await browser.close();
