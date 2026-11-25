// Pet routines: a dog's morning routine shows on every person's Home, anyone can tick a step, and everyone then reads who did it and when.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8021';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const bad = [];
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => bad.push(`${who}: page error ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) bad.push(`${who}: ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  return page;
}
const send = (page, method, address, body) => page.evaluate(async ([m, a, b]) => {
  const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return r.status === 204 ? null : r.json();
}, [method, address, body]);
async function signIn(page, name, password) {
  await page.goto(base + '/'); await wait(1000);
  await page.getByRole('textbox').first().fill(name);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click(); await wait(2000);
  const first = page.getByRole('dialog');
  if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click().catch(() => {}); await wait(1500); }
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label'))); } }
  return small;
};

// ---------- the first person, with a dog and the dog food ----------
const ana = await open('ana');
await signIn(ana, 'trial', PASS);
await send(ana, 'POST', '/api/things/starters', { slug: 'clothing' });
const kind = (await send(ana, 'GET', '/api/things/kinds'))[0];
await send(ana, 'POST', '/api/things/items', { kind_id: kind.id, name: 'Dog food', quantity: 3, low_at: 1 });
const biscuit = await send(ana, 'POST', '/api/things/pets', { name: 'Biscuit', species: 'dog' });
await send(ana, 'POST', '/api/users', { username: 'sam', password: PASS });
await send(ana, 'POST', '/api/routines', { name: 'Skincare', for_user: (await send(ana, 'GET', '/api/routines/people')).me, times: [{ name: 'Morning', steps: [{ words: 'Wash your face' }] }] });

// ---------- adding the ready-made routine from the pet's page ----------
await ana.goto(`${base}/things/pets/${biscuit.id}`); await wait(1200);
const section = ana.locator('[data-pet-routines]');
let t = await section.innerText();
check('the pet page offers a routine for the dog, and points to the meds in Care', /Add a routine for Biscuit/.test(t) && /Dog, daily/.test(t) && !/Cat, daily/.test(t) && /Monthly meds/.test(t), t.slice(0, 200));
await section.getByLabel('Food').selectOption({ label: 'Dog food' });
await section.getByRole('button', { name: 'Add Dog, daily for Biscuit' }).click(); await wait(1200);
check('after adding it, the dog routine is listed for change and is no longer offered', await ana.locator('[data-routine="Dog, daily"]').isVisible() && !(await section.innerText()).includes('Add a routine for Biscuit'));
const morningCard = ana.locator('[data-routine-time="Biscuit: Morning"]');
check('the pet page shows Biscuit: Morning to tick, with the feed step', (await morningCard.innerText()).includes('0 of 3 done') && (await morningCard.innerText()).includes('Feed'));
const petSmall = await tooSmall([ana.locator('[data-pet-routines] button'), ana.locator('[data-pet-routines] select'), morningCard.locator('button')]);
check('on the pet page the controls are 44px tall and nothing scrolls sideways' + (petSmall.length ? ` (too small: ${petSmall})` : ''), petSmall.length === 0 && await noSideways(ana));

// ---------- the first person ticks Feed ----------
await ana.goto(base + '/'); await wait(1500);
const home = ana.locator('[data-routine-time="Biscuit: Morning"]');
check('Home shows Biscuit: Morning', await home.isVisible());
await home.getByRole('checkbox').first().click(); await wait(800);
let line = await home.locator('[data-done-by]').first().innerText();
check('the ticked step says when and who ("Done at 7:10 AM by you")', /^Done at \d{1,2}:\d{2}\s?(AM|PM)? by you$/i.test(line.trim()), line);

// ---------- the second person sees it, and does the next step ----------
const sam = await open('sam');
await signIn(sam, 'sam', PASS);
await sam.goto(base + '/'); await wait(1500);
const samHome = sam.locator('[data-routine-time="Biscuit: Morning"]');
check('the second person sees Biscuit: Morning on their own Home', await samHome.isVisible());
line = await samHome.locator('[data-done-by]').first().innerText().catch(() => '');
check('and reads who fed Biscuit, and when ("Done at 7:10 AM by trial")', /^Done at \d{1,2}:\d{2}\s?(AM|PM)? by trial$/i.test(line.trim()), line);
check('the first person\'s own skincare routine is not on the second person\'s Home', (await sam.locator('main').innerText()).includes('Skincare') === false);
await samHome.getByRole('checkbox').nth(1).click(); await wait(800);
check('the second person ticks Fresh water, which says "by you" to them', (await samHome.locator('[data-done-by]').nth(1).innerText()).trim().endsWith('by you'));
await samHome.getByRole('button', { name: 'Dog food running low' }).click(); await wait(900);
check('Dog food can be marked running low from the step', (await samHome.innerText()).includes('Dog food is on the grocery list'));
const samSmall = await tooSmall([samHome.locator('button')]);
check('the second person\'s Home fits 375px with 44px buttons' + (samSmall.length ? ` (too small: ${samSmall})` : ''), samSmall.length === 0 && await noSideways(sam));

// ---------- the first person reads what the second did ----------
await ana.reload(); await wait(1500);
const second = await ana.locator('[data-routine-time="Biscuit: Morning"] [data-done-by]').nth(1).innerText();
check('the first person reads "by sam" on the step the second person ticked', /by sam$/.test(second.trim()), second);
check('the gentle history is there, with no streak', /of the last 7 days/.test(await ana.locator('[data-routine-time="Biscuit: Morning"]').innerText()) && !/streak/i.test(await ana.locator('main').innerText()));

// ---------- pictures: Home and the pet page, light and dark ----------
for (const look of ['light', 'dark']) {
  await ana.emulateMedia({ colorScheme: look });
  await ana.goto(base + '/'); await wait(1500);
  await ana.locator('[data-routine-time="Biscuit: Morning"]').scrollIntoViewIfNeeded();
  await ana.screenshot({ path: `${shots}/pet-routines-home-375-${look}.png`, fullPage: true });
  await ana.goto(`${base}/things/pets/${biscuit.id}`); await wait(1500);
  await ana.screenshot({ path: `${shots}/pet-routines-page-375-${look}.png`, fullPage: true });
}
await ana.emulateMedia({ colorScheme: 'light' });

// ---------- changing it: link the evening feed step, and take it away with the pet ----------
await ana.goto(`${base}/things/pets/${biscuit.id}`); await wait(1200);
await ana.getByRole('button', { name: 'Change Dog, daily' }).click(); await wait(600);
const form = ana.getByRole('dialog');
check('the routine form says whose it is: Biscuit (pet)', (await form.getByLabel('Whose is it').evaluate((s) => s.options[s.selectedIndex].text)).startsWith('Biscuit (pet)'));
await form.getByRole('button', { name: 'Save' }).click(); await wait(1000);
const routines = await send(ana, 'GET', '/api/routines');
check('saving keeps it a pet routine', routines.some((r) => r.name === 'Dog, daily' && r.for_pet === biscuit.id && r.who_kind === 'pet'));
await ana.getByRole('button', { name: 'Remove Biscuit' }).click(); await wait(1200);
check('removing the pet takes its routine with it', !(await send(ana, 'GET', '/api/routines')).some((r) => r.name === 'Dog, daily'));

check('no failed requests or page errors', bad.length === 0, bad.join('; '));
await browser.close();
