// A thing's pieces: adding them, a check with one missing, add to shopping, a replace-every job, the check when a lent thing comes back,
// and search. At phone width.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8041';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
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
  const kind = (await post('/api/things/kinds', { name: 'Kitchen', icon: '🍳', fields: [{ name: 'Lent to', type: 'text' }] }))[0];
  const cooker = (await post('/api/things/items', { kind_id: kind.id, name: 'Egg cooker' })).id;
  await post('/api/things/items', { kind_id: kind.id, name: 'Toaster' });
  return { cooker, field: kind.fields[0].id, kind: kind.id };
});
const noSideways = async (what) => check(`${what} fits 375px wide with no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
const section = () => page.locator('[data-pieces]');
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ');
const dialog = () => page.getByRole('dialog');

await page.goto(`${base}/things/${ids.cooker}`); await page.waitForTimeout(1200);
check('a thing with no pieces offers to add one', await page.getByRole('button', { name: 'Add a piece' }).isVisible() && (await page.getByRole('button', { name: 'Check the pieces' }).count()) === 0);

// Add five pieces, the first two with more said about them.
const add = async (name, extra = async () => {}) => {
  await page.getByRole('button', { name: 'Add a piece' }).click(); await page.waitForTimeout(400);
  await dialog().getByLabel('What it is').fill(name);
  await extra();
  await dialog().getByRole('button', { name: 'Keep it' }).click(); await page.waitForTimeout(700);
};
await add('Piercing pin', async () => { await dialog().getByLabel('Where it is kept (if you want to say)').fill('Under the tray'); });
await add('Lid', async () => { await dialog().getByLabel('How many').fill('2'); });
for (const name of ['Tray', 'Measuring cup', 'Base']) await add(name);
await page.waitForTimeout(500);
const listed = await text(section());
check('the five pieces are listed, with how many and where kept', ['Piercing pin', 'Lid × 2', 'Tray', 'Measuring cup', 'Base', 'Under the tray'].every((t) => listed.includes(t)), listed);
check('before a check, it says Not checked yet', listed.includes('Not checked yet'));
await noSideways('the thing page with pieces');

// The pieces never fill the Things list.
await page.goto(`${base}/things`); await page.waitForTimeout(1200);
const listText = await text(page.locator('main'));
check('the Things list holds the two things and none of the pieces', listText.includes('Egg cooker') && listText.includes('Toaster') && !listText.includes('Piercing pin') && !listText.includes('Measuring cup'), listText.slice(0, 200));

// A check with everything found.
await page.goto(`${base}/things/${ids.cooker}`); await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Check the pieces' }).click(); await page.waitForTimeout(500);
const boxes = dialog().getByRole('checkbox');
check('the check has a check box for each piece', (await boxes.count()) === 5);
const tall = await dialog().locator('label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
check('each check box line is at least 44px tall', tall.length === 5 && tall.every((h) => h >= 44), tall.join(','));
await dialog().getByRole('button', { name: /Mark 5 missing and save/ }).waitFor();
for (let i = 0; i < 5; i += 1) await boxes.nth(i).check();
check('with every box checked it says All 5 pieces here', (await text(dialog().locator('[data-check-status]'))) === 'All 5 pieces here');
await dialog().getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(900);
const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
check('the thing then shows Last checked today: all here', (await text(section())).includes(`Last checked ${today}: all here`), await text(section()));

// A check with one missing.
await page.getByRole('button', { name: 'Check the pieces' }).click(); await page.waitForTimeout(500);
for (const i of [1, 2, 3, 4]) await dialog().getByRole('checkbox').nth(i).check();
check('with one unchecked it says 4 of 5 here', (await text(dialog().locator('[data-check-status]'))) === '4 of 5 here');
await page.screenshot({ path: `${shots}/things-pieces-check.png` });
await dialog().getByRole('button', { name: 'Mark 1 missing and save' }).click(); await page.waitForTimeout(900);
const missingText = await text(section());
check('the thing shows 1 piece missing, and the check says 1 missing', missingText.includes('1 piece missing') && missingText.includes(`Last checked ${today}: 1 missing`), missingText);
check('only the missing piece offers Add to shopping', (await section().getByRole('button', { name: 'Add to shopping' }).count()) === 1);

// Add to shopping.
await section().getByRole('button', { name: 'Add to shopping' }).click(); await page.waitForTimeout(900);
check('Add to shopping says it is on the shopping list', (await text(section())).includes('Piercing pin is on your shopping list'));
const grocery = await page.evaluate(async () => (await fetch('/api/kitchen/grocery').then((r) => r.json())).map((g) => g.label));
check('the shopping list has the piece', grocery.includes('Piercing pin'), JSON.stringify(grocery));
await section().getByRole('button', { name: 'Add to shopping' }).click(); await page.waitForTimeout(900);
const twice = await page.evaluate(async () => (await fetch('/api/kitchen/grocery').then((r) => r.json())).filter((g) => g.label === 'Piercing pin').length);
check('asking twice does not put it on the list twice', twice === 1, String(twice));

// Replace every: its own Upkeep job.
await section().getByRole('button', { name: 'Change Piercing pin' }).click(); await page.waitForTimeout(500);
await dialog().getByLabel('Replace it every so often').check();
await dialog().getByLabel('Replace every', { exact: true }).fill('6');
await dialog().getByLabel('Days, weeks, months or years').selectOption('month');
await dialog().getByLabel('Is it here?').selectOption('missing');
await page.screenshot({ path: `${shots}/things-pieces-form.png` });
await dialog().getByRole('button', { name: 'Keep it' }).click(); await page.waitForTimeout(1000);
const jobs = await page.evaluate(async () => (await fetch('/api/things/upkeep').then((r) => r.json())).map((j) => [j.name, j.item?.name, j.every?.n, j.every?.unit]));
check('a job called "Egg cooker: new Piercing pin" is made, every 6 months', JSON.stringify(jobs) === JSON.stringify([['Egg cooker: new Piercing pin', 'Egg cooker', 6, 'month']]), JSON.stringify(jobs));
check('the piece says Replace every 6 months and links to its job', (await text(section())).includes('Replace every 6 months') && (await section().getByRole('link', { name: 'Its Upkeep job' }).count()) === 1);
check('the job shows on the thing too', (await text(page.locator('main'))).includes('Egg cooker: new Piercing pin'));
await page.screenshot({ path: `${shots}/things-pieces-375.png`, fullPage: true });
await noSideways('the thing page after a check');
const small = await section().locator('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
check('every button in the pieces section is at least 44px tall', small.length === 0, small.join(' | '));
check('the page never says tick', !/\btick/i.test(await text(page.locator('main'))));

// Search finds the thing by a piece; the piece has no line of its own.
const found = await page.evaluate(async () => (await fetch('/api/search?q=measuring').then((r) => r.json())).map((r) => [r.kind, r.title, r.detail]));
check('search finds the Egg cooker by a piece, as one answer', found.length === 1 && found[0][0] === 'thing' && found[0][1] === 'Egg cooker' && found[0][2].includes('piece: Measuring cup'), JSON.stringify(found));

// A lent thing comes back: the check is offered.
await page.evaluate(async ({ id, field }) => {
  const item = await fetch(`/api/things/items/${id}`).then((r) => r.json());
  const put = await fetch(`/api/things/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: item.name, values: { [field]: 'Sam next door' } }) });
  return put.status;
}, { id: ids.cooker, field: ids.field }).then((status) => check('a thing is lent out', status === 200, String(status)));
await page.reload(); await page.waitForTimeout(1300);
check('a lent thing says who has it', (await text(page.locator('[data-lent]'))).includes('Lent to Sam next door'));
await page.getByRole('button', { name: "It's back: check the pieces" }).click(); await page.waitForTimeout(1200);
check('when it comes back, the check opens', (await dialog().count()) === 1 && (await text(dialog())).includes('Check the pieces of Egg cooker'));
for (let i = 0; i < 5; i += 1) await dialog().getByRole('checkbox').nth(i).check();
await dialog().getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(900);
check('after the check nothing is missing, and it is no longer lent', (await text(section())).includes('all here') && (await page.locator('[data-lent]').count()) === 0 && !(await text(section())).includes('piece missing'), await text(section()));

// Taking a piece off the list takes its job.
await section().getByRole('button', { name: 'Change Piercing pin' }).click(); await page.waitForTimeout(500);
await dialog().getByRole('button', { name: 'Take it off the list' }).click(); await page.waitForTimeout(900);
const after = await page.evaluate(async () => (await fetch('/api/things/upkeep').then((r) => r.json())).length);
check('taking the piece off the list also takes its Upkeep job', after === 0 && !(await text(section())).includes('Piercing pin'), String(after));

await browser.close();
