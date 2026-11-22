// Upkeep, clicked through as a person would: a starter job, its tools and supplies, done, a job by miles.
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
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

const ids = await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await post('/api/things/kinds', { name: 'Household', icon: '🏠' }))[0].id;
  const garage = (await post('/api/things/places', { name: 'Garage' }))[0].id;
  const thing = (body) => post('/api/things/items', { kind_id: kind, place_id: garage, ...body });
  const ladder = await thing({ name: 'Step ladder' });
  await thing({ name: 'Furnace filter 16x25', quantity: 2, low_at: 1 });
  const car = await thing({ name: 'The car' });
  await thing({ name: 'Filter wrench' });
  await thing({ name: 'Motor oil', quantity: 10, unit: 'qt', low_at: 6 });
  await post('/api/money/categories', { name: 'House', monthly_cents: 20000 });
  return { ladder: ladder.id, car: car.id };
});

await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
check('Upkeep explains itself and offers common jobs', await page.getByText('Everything that comes round again').isVisible() && await page.getByRole('region', { name: 'Common jobs' }).isVisible());
await page.getByRole('region', { name: 'Common jobs' }).getByRole('listitem').filter({ hasText: 'Change the furnace filter' }).getByRole('button', { name: 'Add' }).click();
await page.waitForTimeout(1000);
const due = await page.getByRole('region', { name: 'Late or due' }).innerText().catch(() => '');
check('a new job never done is due now', due.includes('Change the furnace filter') && due.includes('due today'), due.replace(/\s+/g, ' '));
await page.getByRole('link', { name: 'Change the furnace filter' }).click(); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Change' }).click(); await page.waitForTimeout(800);
const form = page.getByRole('dialog');
await form.getByLabel('Add a tool').selectOption({ label: 'Step ladder' });
await form.getByLabel('Add a supply').selectOption({ label: 'Furnace filter 16x25 (2)' });
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1200);
const needs = await page.getByRole('region', { name: 'What it needs' }).innerText();
check('the job lists its tools and supplies, and where they are', needs.includes('Step ladder') && needs.includes('📍 Garage') && needs.includes('uses 1') && needs.includes('have 2'), needs.replace(/\s+/g, ' '));
check('the steps came with the starter', await page.getByRole('region', { name: 'Steps' }).isVisible());

await page.getByRole('button', { name: '✓ Done' }).click(); await page.waitForTimeout(700);
const done = page.getByRole('dialog');
await done.getByLabel('What it cost').fill('18.99');
await done.getByLabel("Put it in this month's spending").check();
await done.getByLabel('Spending category').selectOption({ label: 'House' });
await done.getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1500);
const said = await page.getByRole('status').innerText().catch(() => '');
check('a supply running low goes on the shopping list', said.includes('Added to the shopping list: Furnace filter 16x25'), said);
const times = await page.getByRole('region', { name: 'Each time it was done' }).innerText();
check('the time it was done is kept, with its cost', times.includes('ana') && times.includes('$18.99'), times.replace(/\s+/g, ' '));
check('the next one is months off', (await page.locator('[data-state]').first().getAttribute('data-state')) === 'later');
const spent = await page.evaluate(() => fetch('/api/money').then((r) => r.json()).then((m) => m.categories.find((c) => c.name === 'House')?.spent));
check('the cost went into spending, in its category', spent === 1899, String(spent));
await page.screenshot({ path: `${shots}/upkeep-job.png`, fullPage: true });

// A job by miles, made from scratch.
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(800);
await page.getByRole('button', { name: '+ New', exact: true }).click(); await page.waitForTimeout(600);
const make = page.getByRole('dialog');
await make.getByLabel('Its name *').fill('Change the oil');
await make.getByLabel('Part of (an activity)').fill('Car');
await make.getByLabel("It's for").selectOption({ label: 'The car (Garage)' });
await make.getByLabel('How many').fill('6');
await make.getByLabel('Days, weeks, months or years').selectOption('month');
await make.locator('label').filter({ hasText: 'or every' }).locator('input[type=checkbox]').check();
await make.getByLabel('How far between').fill('5000');
await make.getByLabel('Measured in').fill('miles');
await make.getByLabel('Last done').fill('2026-09-01');
await make.getByLabel('The reading then').fill('40000');
await make.getByLabel('Add a tool').selectOption({ label: 'Filter wrench' });
await make.getByLabel('Add a supply').selectOption({ label: 'Motor oil (10 quart)' });
await make.getByLabel('How much').fill('5');
await make.getByLabel('Unit').fill('qt');
await make.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1500);
check('a new job opens on its own page', /\/things\/upkeep\/\d+$/.test(page.url()), page.url());
check('it says how often, whichever first', await page.getByText('every 6 months, or every 5,000 miles, whichever comes first').isVisible());
await page.getByRole('button', { name: 'Note the miles' }).click(); await page.waitForTimeout(500);
await page.getByRole('dialog').getByRole('spinbutton').fill('44700');
await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click(); await page.waitForTimeout(1000);
const badge = await page.locator('[data-state]').first().innerText();
check('the miles bring it close', badge.includes('in 300 miles'), badge);

await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await page.screenshot({ path: `${shots}/upkeep-list.png`, fullPage: true });
const coming = await page.getByRole('region', { name: 'Coming up' }).innerText().catch(() => '');
check('the list puts it under coming up', coming.includes('Change the oil'), coming.replace(/\s+/g, ' '));

await page.goto(`${base}/`); await page.waitForTimeout(1500);
check('the home page has an upkeep card with it', await page.getByRole('link', { name: 'Change the oil' }).first().isVisible().catch(() => false));
await page.goto(`${base}/things/${ids.ladder}`); await page.waitForTimeout(1000);
const hist = await page.getByRole('list', { name: 'History' }).innerText();
check("the ladder's history says what it was used for", hist.includes('Used for Change the furnace filter'), hist.split('\n').slice(0, 2).join(' | '));
check('the ladder lists the job that needs it', (await page.getByRole('region', { name: 'Upkeep' }).innerText()).includes('needs this'));
await page.goto(`${base}/things/activities?name=Car`); await page.waitForTimeout(1000);
check('the activity lists its upkeep', (await page.getByRole('region', { name: 'Its upkeep' }).innerText().catch(() => '')).includes('Change the oil'));
await browser.close();
