// Splitting a bill or a purchase, and savings pots: Ana splits a purchase three ways (Ben signs in, Hank is only a typed name),
// splits something unevenly, sees who owes whom boiled down to the fewest payments, taps Settled, and Cat, who is in none of it,
// sees nothing. A bill in Upkeep starts a split too. Ana keeps a savings pot beside her goals. Pictures at 375 wide.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8041';
const bad = [];
const say = (what, ok, extra = '') => console.log((ok ? 'ok   ' : 'FAIL ') + what + (!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''));

const browser = await chromium.launch({ ...browserChoice, headless: true });
async function signedIn(name, first) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) bad.push(`${name}: ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  await page.goto(base + '/'); await page.waitForTimeout(1200);
  await page.getByRole('textbox').first().fill(name);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: first ? /Make my account|Sign in/ : 'Sign in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 6000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click().catch(() => {}); await page.waitForTimeout(1500); }
  if (await dialog.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  return page;
}
const wait = (page, ms = 800) => page.waitForTimeout(ms);
const send = (page, method, address, body) => page.evaluate(async ([m, a, b]) => {
  const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* no body */ }
  return { status: r.status, json };
}, [method, address, body]);
const text = async (page, selector = 'main') => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const short = (page, inside) => page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((box) => [...box.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])')])
  .filter((e) => !e.closest('p') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5)
  .map((e) => `${(e.textContent || e.getAttribute('aria-label') || e.type || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`), inside);
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const ana = await signedIn('ana', true);
for (const who of ['ben', 'cat']) await send(ana, 'POST', '/api/users', { username: who, password: PASS });
const ben = await signedIn('ben');
const cat = await signedIn('cat');

// ---- a purchase split three ways: Ana, Ben, and Hank, who is only a name ----
await send(ana, 'POST', '/api/money/entries', { label: 'Pizza night', cents: 6000, day });
await ana.goto(base + '/money'); await wait(ana, 1200);
await ana.getByRole('link', { name: 'Split Pizza night' }).click(); await wait(ana, 1200);
let form = ana.getByRole('dialog');
say('the Split button on a purchase opens the form with nothing typed twice', (await form.getByLabel('What it was *').inputValue()) === 'Pizza night' && (await form.getByLabel('The whole thing came to *').inputValue()) === '60.00', await text(ana, '[role=dialog]'));
await form.locator('[data-person="ben"] input[type=checkbox]').check();
await form.getByLabel('A name to type in').fill('Hank');
await form.getByRole('button', { name: 'Add', exact: true }).click(); await wait(ana, 900);
const previewed = await text(ana, '[role=dialog]');
say('shares start equal and add up to the whole', (await form.locator('[data-share-preview]').allInnerTexts()).join(',') === '$20.00,$20.00,$20.00' && /add up to the whole/.test(previewed), previewed);
say('the form says a typed name is only a label', /only a label: that person cannot sign in or see anything/.test(previewed), previewed);
await ana.screenshot({ path: `${shots}/splits-form-375.png`, fullPage: true });
say('the form fits 375 wide with tall enough controls', !(await sideways(ana)) && (await short(ana, '[role=dialog]')).length === 0, (await short(ana, '[role=dialog]')).join(' | '));
await form.getByRole('button', { name: 'Save' }).click(); await wait(ana, 1200);
let main = await text(ana);
say('the split is kept, with who paid and each share', /Pizza night \$60\.00/.test(main) && /You paid/.test(main) && (await ana.locator('[data-split="Pizza night"] [data-share]').count()) === 3, main);
say('a typed name is marked as a name only', /Hank \(a name only\)/.test(main), main);

// ---- an uneven split: an amount for Ben, a percent for Hank, equal for Ana ----
await ana.getByRole('button', { name: '+ A split' }).click(); await wait(ana, 500);
form = ana.getByRole('dialog');
await form.getByLabel('What it was *').fill('Cabin weekend');
await form.getByLabel('The whole thing came to *').fill('300');
await form.locator('[data-person="ben"] input[type=checkbox]').check();
await form.getByLabel('A name to type in').fill('Hank');
await form.getByRole('button', { name: 'Add', exact: true }).click(); await wait(ana, 300);
await form.getByLabel('How ben shares').selectOption('amount');
await form.getByLabel('Amount for ben').fill('50');
await form.getByLabel('How Hank shares').selectOption('percent');
await form.getByLabel('Percent for Hank').fill('20'); await wait(ana, 900);
say('an amount and a percent are taken first, and the rest goes to the equal share', (await form.locator('[data-share-preview]').allInnerTexts()).join(',') === '$190.00,$50.00,$60.00', await text(ana, '[role=dialog]'));
await form.getByLabel('Amount for ben').fill('250'); await wait(ana, 900);
say('shares that do not add up are refused in plain words', /more than the whole/.test(await text(ana, '[data-split-words]')), await text(ana, '[data-split-words]'));
await form.getByLabel('Amount for ben').fill('50'); await wait(ana, 700);
await form.getByRole('button', { name: 'Save' }).click(); await wait(ana, 1200);
const cabin = await text(ana, '[data-split="Cabin weekend"]');
say('the uneven split is kept to the cent', /You \$190\.00/.test(cabin) && /ben \$50\.00/.test(cabin) && /Hank \(a name only\) \$60\.00/.test(cabin), cabin);

// ---- Ben pays for gas and splits it with Ana: the balances boil down ----
const people = (await send(ben, 'GET', '/api/splits')).json;
const anaId = people.people.find((p) => p.name === 'ana').id;
await send(ben, 'POST', '/api/splits', { what: 'Gas', total_cents: 4000, day, people: [{ user_id: people.me.id, paid: true }, { user_id: anaId }] });
await ana.goto(base + '/money/splits'); await wait(ana, 1200);
const pays = await ana.locator('[data-payment]').allInnerTexts();
say('who owes whom is the fewest payments: Hank 80 and Ben 50, not four lines', pays.length === 2 && pays.some((p) => /Hank pays you\s+\$80\.00/.test(p.replace(/\s+/g, ' '))) && pays.some((p) => /ben pays you\s+\$50\.00/.test(p.replace(/\s+/g, ' '))), pays.join(' | '));
say('it says what is owed to Ana in all and that Life Is never moves money', /You are owed \$130\.00 in all/.test(await text(ana)) && /never moves money/.test(await text(ana)), await text(ana));
await ana.screenshot({ path: `${shots}/splits-page-375.png`, fullPage: true });
say('the Splits page fits 375 wide with tall enough controls', !(await sideways(ana)) && (await short(ana, 'main')).length === 0, (await short(ana, 'main')).join(' | '));

// ---- Settled ----
await ana.getByRole('button', { name: 'Settled: Hank, Pizza night' }).click(); await wait(ana, 1000);
const after = await ana.locator('[data-payment]').allInnerTexts();
say('Settled takes a line out of the balance', after.some((p) => /Hank pays you\s+\$60\.00/.test(p.replace(/\s+/g, ' '))), after.join(' | '));
say('and it lands in a short history', /Settled lately/.test(await text(ana)) && /Pizza night: Hank paid/.test(await text(ana, '[data-history]')), await text(ana));
// Ben marks his own part of the pizza as paid.
await ben.goto(base + '/money/splits'); await wait(ben, 1200);
say('Ben sees the splits he is in, and Gas that he paid for', /Pizza night/.test(await text(ben)) && /Cabin weekend/.test(await text(ben)) && /Gas/.test(await text(ben)), await text(ben));
say('Ben cannot change or remove what Ana made', (await ben.locator('[data-split="Pizza night"]').getByRole('button', { name: /Change|Remove/ }).count()) === 0 && (await ben.locator('[data-split="Gas"]').getByRole('button', { name: 'Change Gas' }).count()) === 1);
await ben.getByRole('button', { name: 'Settled: You, Pizza night' }).click(); await wait(ben, 1000);
say('Ben marks his own part settled', /settled/.test(await text(ben, '[data-split="Pizza night"]')), await text(ben, '[data-split="Pizza night"]'));
await ben.screenshot({ path: `${shots}/splits-ben-375.png`, fullPage: true });

// ---- Cat is in none of it ----
await cat.goto(base + '/money/splits'); await wait(cat, 1200);
const catText = await text(cat);
const catApi = (await send(cat, 'GET', '/api/splits')).json;
say('a person outside every split sees none of it', /No splits yet/.test(catText) && !/Pizza|Cabin|Gas|Hank/.test(catText) && catApi.splits.length === 0 && catApi.payments.length === 0, catText);
const anaPizza = (await send(ana, 'GET', '/api/splits')).json.splits.find((s) => s.what === 'Pizza night');
say('and cannot settle, change or remove one', (await send(cat, 'POST', `/api/splits/shares/${anaPizza.shares[1].id}/settle`, { settled: true })).status === 404
  && (await send(cat, 'DELETE', `/api/splits/${anaPizza.id}`)).status === 404 && (await send(cat, 'PUT', `/api/splits/${anaPizza.id}`, { what: 'x', total_cents: 100, people: [] })).status === 404);

// ---- a bill in Upkeep starts a split ----
const bill = await send(ana, 'POST', '/api/things/upkeep', { name: 'Electric', kind: 'bill', amount_cents: 12000, every_n: 1, every_unit: 'month', first_due: day });
await ana.goto(base + `/things/upkeep/${bill.json.id}`); await wait(ana, 1200);
await ana.getByRole('link', { name: 'Split', exact: true }).click(); await wait(ana, 1200);
form = ana.getByRole('dialog');
say('the Split button on a bill opens the form with its name and amount', (await form.getByLabel('What it was *').inputValue()) === 'Electric' && (await form.getByLabel('The whole thing came to *').inputValue()) === '120.00', await text(ana, '[role=dialog]'));
await ana.keyboard.press('Escape'); await wait(ana, 400);

// ---- savings pots, beside the goals ----
await ana.goto(base + '/money/goals'); await wait(ana, 1200);
await ana.getByRole('button', { name: '+ A pot' }).click(); await wait(ana, 400);
form = ana.getByRole('dialog');
await form.getByLabel('What it is for *').fill('The car');
await form.getByRole('button', { name: 'Save' }).click(); await wait(ana, 900);
await ana.getByRole('button', { name: 'Put money in The car' }).click(); await wait(ana, 400);
form = ana.getByRole('dialog');
await form.getByLabel('How much *').fill('200');
await form.getByLabel('A note').fill('Tax refund');
await form.getByRole('button', { name: 'Put it in' }).click(); await wait(ana, 900);
await ana.getByRole('button', { name: 'Take money out of The car' }).click(); await wait(ana, 400);
form = ana.getByRole('dialog');
await form.getByLabel('How much *').fill('45.50');
await form.getByLabel('A note').fill('New tires');
await form.getByRole('button', { name: 'Take it out' }).click(); await wait(ana, 900);
let pot = await text(ana, '[data-pot="The car"]');
say('a pot shows what is in it, with a dated line for each time', /\$154\.50/.test(pot) && /Tax refund/.test(pot) && /New tires/.test(pot) && /out \$45\.50/.test(pot) && /Only you see this/.test(pot), pot);
say('it sits beside the goals', /Savings pots/.test(await text(ana)) && /\$154\.50 in pots/.test(await text(ana, '[data-pots]')), await text(ana));
await ana.getByRole('button', { name: 'Take money out of The car' }).click(); await wait(ana, 400);
form = ana.getByRole('dialog');
await form.getByLabel('How much *').fill('500');
await form.getByRole('button', { name: 'Take it out' }).click(); await wait(ana, 900);
say('a pot cannot go below nothing', /only \$154\.50 in The car/.test(await text(ana, '[role=dialog]')), await text(ana, '[role=dialog]'));
await ana.keyboard.press('Escape'); await wait(ana, 400);
await ana.screenshot({ path: `${shots}/pots-375.png`, fullPage: true });
say('the goals page with pots fits 375 wide with tall enough controls', !(await sideways(ana)) && (await short(ana, '[data-pots]')).length === 0, (await short(ana, '[data-pots]')).join(' | '));
// Private to Ana, until she shares it.
await ben.goto(base + '/money/goals'); await wait(ben, 1200);
say('another person does not see a private pot', !/The car/.test(await text(ben)), await text(ben));
await ana.getByRole('button', { name: 'Change The car' }).click(); await wait(ana, 400);
form = ana.getByRole('dialog');
await form.getByLabel('ben').check();
await form.getByLabel('What it is for *').fill('The car fund');
await form.getByRole('button', { name: 'Save' }).click(); await wait(ana, 900);
await ben.goto(base + '/money/goals'); await wait(ben, 1200);
say('a shared pot shows to the person it is shared with, renamed', /The car fund/.test(await text(ben)) && /Shared with you by ana/.test(await text(ben)), await text(ben));
await ana.getByRole('button', { name: 'Change The car fund' }).click(); await wait(ana, 400);
await ana.getByRole('dialog').getByRole('button', { name: 'Close it' }).click(); await wait(ana, 900);
pot = await text(ana, '[data-pot="The car fund"]');
say('a closed pot says so and takes no new lines', /closed/.test(pot) && (await ana.getByRole('button', { name: 'Put money in The car fund' }).count()) === 0, pot);

say('no server error or page error along the way', bad.length === 0, bad.join(' | '));
await browser.close();
