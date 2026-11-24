// Budget with projects and grocery trips: a grocery list split across two stores with an estimate for each, a line
// moved with one tap, done shopping at a store (the receipt total, one spending entry), the bank's charge for the
// same trip not counted again; and a paid project cost counted once, over its plan, saved up for, in the budget.
// Pictures at phone width, light.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 500) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 900 }, colorScheme: 'light' });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const dialog = page.getByRole('dialog');
const text = async (selector = 'main') => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shoot = (name) => page.screenshot({ path: `${shots}/budget-trips-${name}-375.png`, fullPage: true });
const short = (inside) => page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((box) => [...box.querySelectorAll('button, select, input[type=checkbox]')])
  .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5)
  .map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`), inside);

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const month = today.slice(0, 7);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---- set up: a grocery budget, and what things cost at two stores last time ----
await send('POST', '/api/money/categories', { name: 'Groceries', monthly_cents: 60000 });
const bought = async (store, label, cents) => {
  await send('PUT', '/api/shopping/settings', { store });
  const list = await send('POST', '/api/kitchen/grocery', { label });
  const id = list.find((g) => g.label.toLowerCase() === label).id;
  await send('POST', `/api/kitchen/grocery/${id}/tick`, { done: true, put_away: false });
  await send('PUT', `/api/shopping/prices/${id}`, { cents });
  await send('POST', '/api/kitchen/grocery/clear-done');   // the price stays, as what it cost there
};
await bought('Kroger', 'milk', 349);
await bought('Kroger', 'coffee', 899);
await bought('Aldi', 'milk', 229);
await bought('Aldi', 'eggs', 300);
await send('PUT', '/api/shopping/settings', { store: null });
for (const label of ['milk', 'eggs', 'coffee']) await send('POST', '/api/kitchen/grocery', { label });
const list = await send('GET', '/api/kitchen/grocery');
const id = (label) => list.find((g) => g.label.toLowerCase() === label).id;
await send('PUT', `/api/shopping/usual/${id('milk')}`, { store: 'Kroger' });

// ---- the list split by store, with an estimate for each ----
await page.goto(base + '/groceries'); await wait(1200);
check('the list by store shows each store with an estimate from the last prices', await page.locator('[data-trip-card]').isVisible()
  && /about \$3\.00/.test(await text('[data-stop="Aldi"]')) && /about \$12\.48/.test(await text('[data-stop="Kroger"]')), await text('[data-trip-card]'));
check('the whole list is set against what is left in the grocery budget', /The whole list comes to about \$15\.48/.test(await text('[data-list-total]')) && /Groceries has \$600\.00 left this month, and \$584\.52 after this list/.test(await text('[data-list-total]')), await text('[data-list-total]'));
check('milk says it was less at Aldi, by $1.20', /\$1\.20 less at Aldi/.test(await text('[data-cheaper]')), await text('main'));
await shoot('groceries-split');

// ---- one tap moves it; nothing moves by itself ----
check('nothing was moved before the tap', (await page.locator('[data-moved]').count()) === 0);
await page.locator('[data-move]').click(); await wait(900);
check('the line moved to Aldi, and the stores add up again', (await page.locator('[data-moved]').count()) === 1 && /about \$5\.29/.test(await text('[data-stop="Aldi"]')) && /about \$8\.99/.test(await text('[data-stop="Kroger"]')), await text('[data-trip-card]'));

// ---- shopping at Aldi: prices typed on the way, then done ----
await send('PUT', '/api/shopping/settings', { store: 'Aldi' });
await page.reload(); await wait(1200);
await page.getByLabel('Price of milk').fill('2.41');
await page.getByLabel('Got milk').click(); await wait(900);
await page.getByLabel('Price of eggs').fill('3.10');
await page.getByLabel('Got eggs').click(); await wait(900);
check('Aldi now shows two things in the buggy at the prices typed', /about \$5\.51/.test(await text('[data-stop="Aldi"]')), await text('[data-stop="Aldi"]'));
await page.locator('[data-done-at="Aldi"]').click(); await wait(1000);
check('done at Aldi asks for the receipt total, with the estimate filled in', await dialog.isVisible() && (await dialog.getByLabel('Receipt total').inputValue()) === '5.51', await dialog.innerText());
await shoot('done-shopping');
await dialog.getByLabel('Receipt total').fill('5.83');
await dialog.locator('[data-trip-save]').click(); await wait(1200);
check('writing it down says what it did', /Wrote \$5\.83 for Aldi as one spending entry/.test(await text()), await text());
let spending = await send('GET', `/api/money?month=${month}`);
check('one spending entry for Aldi, in Groceries', spending.entries.filter((e) => e.label === 'Groceries at Aldi').length === 1 && spending.entries.find((e) => e.label === 'Groceries at Aldi').cents === 583 && spending.entries.find((e) => e.label === 'Groceries at Aldi').category === 'Groceries', JSON.stringify(spending.entries));
check('the two things are off the list, and Kroger is still to do', /about \$8\.99/.test(await text('[data-stop="Kroger"]')) && (await page.locator('[data-stop="Aldi"]').count()) === 0, await text('[data-trip-card]'));

// ---- the bank brings in the same charge ----
const csv = `Date,Description,Amount\n${today},ALDI 72 SPRINGFIELD,-5.83\n${today},HARDWARE STORE,-12.00`;
const looked = await send('POST', '/api/money/statement/read', { text: csv });
check('a statement line for the same store and amount is seen as the trip already written down', looked.rows[0].already === true && looked.rows[1].already === false, JSON.stringify(looked.rows));
const brought = await send('POST', '/api/money/statement', { text: csv });
check('bringing it in adds only the other purchase', brought.added === 1 && brought.already === 1, JSON.stringify(brought));
spending = await send('GET', `/api/money?month=${month}`);
check('the month has the Aldi trip once', spending.entries.filter((e) => /aldi/i.test(e.label)).length === 1 && spending.total.spent === 583 + 1200, JSON.stringify(spending.total));

// ---- a project over its plan, saved up for, counted once ----
const made = await send('POST', '/api/projects', { name: 'Garden bench', status: 'active' });
await send('POST', `/api/projects/${made.id}/costs`, { label: 'Wood', planned_cents: 10000 });
let bench = await send('POST', `/api/projects/${made.id}/costs`, { label: 'Stain', planned_cents: 2000 });
await page.goto(base + `/projects/${made.id}`); await wait(1200);
await page.getByRole('button', { name: 'Save up for this' }).click(); await wait(1000);
const goals = await send('GET', '/api/money/goals');
const goal = goals.find((g) => g.project_id === made.id);
check('saving up for the project makes a goal tied to it', Boolean(goal) && /Saved so far \$0\.00/.test(await text('[data-savings]')), await text('[data-savings]'));
await send('POST', `/api/money/goals/${goal.id}/saved`, { cents: 4000 });
await page.reload(); await wait(1200);
check('the project shows what is saved so far', /Saved so far \$40\.00/.test(await text('[data-savings]')), await text('[data-savings]'));
await page.getByRole('button', { name: 'Mark paid' }).first().click(); await wait(400);
await page.getByLabel('What Wood came to').fill('150');
check('paying offers to take it from the savings', await page.getByLabel(/Take it from the savings/).isChecked());
await page.getByRole('button', { name: 'Paid', exact: true }).click(); await wait(1200);
check('the cost shows what came from the savings', /\$40\.00 from the savings/.test(await text('[data-budget]')) && /Saved so far \$0\.00/.test(await text('[data-savings]')), await text('[data-budget]'));
check('the project says how far over its plan it is', /Over its plan by \$50\.00/.test(await text('[data-over]')), await text('[data-budget]'));
await shoot('project-over');

// counted once: the month's spending has the cost one time, in the Projects line
spending = await send('GET', `/api/money?month=${month}`);
check('the paid cost is one spending entry, in no plain list', spending.projects.lines.filter((l) => l.label === 'Wood').length === 1 && spending.entries.filter((e) => e.label === 'Wood').length === 0 && spending.total.spent === 583 + 1200 + 15000, JSON.stringify(spending.projects));
await page.goto(base + '/money'); await wait(1500);
const budgetText = await text('[data-budget-month]');
check('the budget month has a Projects line for it, and the stain is coming', /Projects paid, already in the spending; \$20\.00 coming \$150\.00/.test(budgetText), budgetText);
await page.locator('[data-budget-month]').scrollIntoViewIfNeeded();
await shoot('budget-projects');
const year = await send('GET', `/api/money/year?year=${month.slice(0, 4)}`);
check('the year counts it once too', year.totals.projects === 15000 && year.totals.spent === 583 + 1200 + 15000, JSON.stringify(year.totals));

await page.goto(base + '/'); await wait(1500);
check('Home says the project is over, and by how much', /over by \$50\.00/.test(await text()), await text());

// ---- phone width ----
for (const path of ['/groceries', `/projects/${made.id}`, '/money']) {
  await page.goto(base + path); await wait(1000);
  check(`${path} does not scroll sideways at 375px`, !(await sideways()));
}
await page.goto(base + '/groceries'); await wait(1000);
const small = await short('[data-trip-card], [data-cheaper], [data-moved]');
check('the by-store controls are at least 44px tall' + (small.length ? ': ' + small.join('; ') : ''), small.length === 0);

if (bad.length) check('no failed requests or page errors', false, [...new Set(bad)].join('; '));
await browser.close();
