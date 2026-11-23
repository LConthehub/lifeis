// The budget: income and a bill added from the budget (which is an upkeep job), a savings goal with money put in,
// the month's figures, the year, spending by tag, and the total on a tag's own page. At phone and desktop widths.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(r.status() === 422 && r.url().includes('/saved'))) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const dialog = page.getByRole('dialog');
const text = async (selector = 'main') => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shoot = async (name) => {
  await page.setViewportSize({ width: 375, height: 812 }); await wait(500);
  await page.screenshot({ path: `${shots}/budget-${name}-375.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 }); await wait(500);
  await page.screenshot({ path: `${shots}/budget-${name}-1280.png`, fullPage: true });
};
/** Controls inside the budget's own parts that are shorter than 44px (links inside a sentence do not count). */
const short = (inside) => page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((box) => [...box.querySelectorAll('button, a, select, input[type=checkbox]')])
  .filter((e) => !e.closest('p') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5)
  .map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`), inside);

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const year = now.getFullYear();
const monthIndex = now.getMonth();
const month = `${year}-${pad(monthIndex + 1)}`;
const first = `${month}-01`;
const monthsLeft = 12 - monthIndex; // this month to December
const end = new Date(year, monthIndex + 6, 0); // the last day of the month five months on: six months to put money in
const goalBy = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
const lastYear = `${year - 1}-06-10`;

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---- the section has its pages ----
await page.goto(base + '/money'); await wait(1000);
const tabs = await page.getByRole('navigation').allInnerTexts();
check('the money section has This month, Year, Goals and Income and bills', ['This month', 'Year', 'Goals', 'Income and bills'].every((t) => tabs.join(' ').includes(t)), tabs.join(' | '));

// ---- income, from its form ----
await page.goto(base + '/money/income'); await wait(1000);
check('with nothing yet, income and bills say so', /Nothing yet/.test(await text()) && /No bills yet/.test(await text()));
await page.getByRole('button', { name: '+ Income' }).click(); await wait(400);
await dialog.getByLabel('What *').fill('Paycheck');
await dialog.getByLabel('How much *').fill('2000');
await dialog.getByLabel('How often').selectOption({ label: 'Every month' });
await dialog.getByLabel('First day').fill(first);
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
check('income is kept and shown as an amount a month', /Paycheck/.test(await text('[data-income]')) && /\$2,000\.00 a month/.test(await text('[data-income]')), await text('[data-income]'));
await page.getByRole('button', { name: '+ Income' }).click(); await wait(400);
await dialog.getByLabel('How often').selectOption({ label: 'One time, on a date' });
check('a one-time amount asks for its day, and has no last day', (await dialog.getByLabel('The day it comes in *').count()) === 1 && (await dialog.getByLabel('Last day (if it ends)').count()) === 0);
await dialog.getByRole('button', { name: 'Close' }).click(); await wait(400);

// ---- a bill from the budget is an upkeep job ----
await page.getByRole('button', { name: '+ Bill' }).click(); await wait(400);
await dialog.getByLabel('Which bill *').fill('Rent');
await dialog.getByLabel('How much each time *').fill('900');
await dialog.getByLabel('Next due on').fill(first);
await dialog.getByRole('button', { name: 'Add the bill' }).click(); await wait(1000);
check('the bill shows with its amount a month, and a way to open it', /Rent/.test(await text('[data-bills]')) && /\$900\.00 a month/.test(await text('[data-bills]')), await text('[data-bills]'));
const jobs = await send('GET', '/api/things/upkeep');
const rent = jobs.find((j) => j.name === 'Rent');
check('and it is an upkeep bill job, not a second list', rent && rent.kind === 'bill' && rent.amount_cents === 90000, JSON.stringify(rent));
await page.getByRole('link', { name: /Rent/ }).click(); await wait(1000);
check('opening it goes to the job in upkeep', page.url().endsWith(`/things/upkeep/${rent.id}`), page.url());

// ---- a savings goal, with money put in ----
await page.goto(base + '/money/goals'); await wait(1000);
check('with no goals, the page says so', /No goals yet/.test(await text()));
await page.getByRole('button', { name: '+ A goal' }).click(); await wait(400);
await dialog.getByLabel('What for *').fill('Trip');
await dialog.getByLabel('How much it takes *').fill('1200');
await dialog.getByLabel('Reach it by (if there is a day)').fill(goalBy);
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
check('a new goal has nothing saved and says what a month takes', /\$0\.00 of \$1,200\.00/.test(await text('[data-goal="Trip"]')) && /\$200\.00 a month/.test(await text('[data-goal="Trip"]')), await text('[data-goal="Trip"]'));
await page.getByRole('button', { name: 'Put money in' }).click(); await wait(400);
await dialog.getByLabel('How much *').fill('200');
await dialog.getByRole('button', { name: 'Put it in' }).click(); await wait(900);
const goalText = await text('[data-goal="Trip"]');
check('after putting 200 in: saved so far, what is left, and the new amount a month', /\$200\.00 of \$1,200\.00/.test(goalText) && /\$1,000\.00 left/.test(goalText) && /\$166\.67 a month/.test(goalText), goalText);
await page.getByRole('button', { name: 'Take money out' }).click(); await wait(400);
await dialog.getByLabel('How much *').fill('5000');
await dialog.getByRole('button', { name: 'Take it out' }).click(); await wait(700);
check('taking out more than is in it is refused, with the reason', /isn't that much in it/.test(await dialog.innerText()));
await dialog.getByLabel('How much *').fill('50');
await dialog.getByRole('button', { name: 'Take it out' }).click(); await wait(900);
check('taking some out counts down what is saved', /\$150\.00 of \$1,200\.00/.test(await text('[data-goal="Trip"]')) && /out \$50\.00/.test(await text('[data-goal="Trip"]')), await text('[data-goal="Trip"]'));
await page.getByRole('button', { name: 'Put money in' }).click(); await wait(400);
await dialog.getByLabel('How much *').fill('50');
await dialog.getByRole('button', { name: 'Put it in' }).click(); await wait(900);
check('put back to 200, in this month', /\$200\.00 of \$1,200\.00/.test(await text('[data-goal="Trip"]')));
await shoot('goal');

// ---- spending, tagged, in a category ----
await page.goto(base + '/money'); await wait(1000);
await page.getByRole('button', { name: '+ Add' }).click(); await wait(400);
await dialog.getByLabel('Name *').fill('Groceries');
await dialog.getByLabel('Amount for each month').fill('300');
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
await page.getByRole('button', { name: '+ Spent' }).click(); await wait(400);
await dialog.getByLabel('What on *').fill('Market');
await dialog.getByLabel('How much *').fill('50');
await dialog.getByLabel('Category').selectOption({ label: 'Groceries' });
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1000);
const food = await send('POST', '/api/tags', { name: 'Food' });
const snacks = await send('POST', '/api/tags', { name: 'Snacks', parent_id: food.id });
const market = (await send('GET', '/api/money')).entries.find((e) => e.label === 'Market');
const chips = await send('POST', '/api/money/entries', { label: 'Chips', cents: 2500 });
const dinner = await send('POST', '/api/money/entries', { label: 'Old dinner', cents: 1000, day: lastYear });
await send('PUT', `/api/tags/on/spending/${market.id}`, { tag_ids: [food.id] });
await send('PUT', `/api/tags/on/spending/${chips.id}`, { tag_ids: [snacks.id] });
await send('PUT', `/api/tags/on/spending/${dinner.id}`, { tag_ids: [food.id] });

// ---- the month ----
await page.goto(base + '/money'); await wait(1200);
const card = await text('[data-budget-month]');
check('the month shows income, bills due, planned spending and what went into goals', /Income \+ \$2,000\.00/.test(card) && /Bills due − \$900\.00/.test(card) && /Planned spending − \$300\.00/.test(card) && /Put into goals − \$200\.00/.test(card), card);
check('and what is left over', /Left over \$600\.00/.test(card), card);
check('the bill is listed with its day and the goal with its amount', /Rent/.test(card) && /Trip \$200\.00/.test(card), card);
check('spending by tag nests Snacks under Food, children counted in the parent', /Food \$75\.00/.test(card) && /Snacks \$25\.00/.test(card) && !/\$85\.00/.test(card), card);
check('the existing month view still works: categories and totals', /Groceries \$50\.00 of \$300\.00/.test(await text()) && /Planned \$300\.00/.test(await text('[data-month-totals]')), await text('[data-month-totals]'));
await shoot('month');

// ---- the year ----
await page.goto(base + '/money/year'); await wait(1200);
const cells = await page.locator('[data-year-table] tbody tr').first().locator('td').allInnerTexts();
check('the year table has twelve months and a total, side by side', cells.length === 13, cells.join(' | '));
check('this month has its income, and the months before it have none', cells[monthIndex] === '$2,000' && (monthIndex === 0 || cells[monthIndex - 1] === '$0'), cells.join(' | '));
const totals = await text('[data-year-totals]');
check(`the whole year adds up: ${monthsLeft} months of pay and rent, 200 saved`, totals.includes(`Income, whole year $${(2000 * monthsLeft).toLocaleString()}.00`) && totals.includes(`Bills, whole year $${(900 * monthsLeft).toLocaleString()}.00`) && /Saving, whole year \$200\.00/.test(totals), totals);
const left = await page.locator('[data-year-table] tbody tr').last().locator('td').allInnerTexts();
check('left over is 600 this month and 800 in the months to come, and nothing in months gone by', left[monthIndex] === '$600' && (monthIndex === 11 || left[11] === '$800') && (monthIndex === 0 || left[0] === '$0'), left.join(' | '));
check('spending by tag is there for the year, without last year\'s', /Food \$75\.00/.test(await text()), await text());
await page.getByRole('button', { name: 'The year before' }).click(); await wait(900);
check('the year before shows only last year\'s tagged spending', /Food \$10\.00/.test(await text()) && /\$0\.00/.test(await text('[data-year-totals]')), await text());
await page.getByRole('button', { name: 'The year after' }).click(); await wait(900);
await page.setViewportSize({ width: 375, height: 812 }); await wait(500);
check('on a phone the year is a list of months', (await page.locator('[data-year-list] li').count()) === 12 && !(await page.locator('[data-year-table]').isVisible()));
const row = await text(`[data-year-month="${month}"]`);
check('and this month in it has its figures', /Income \$2,000/.test(row) && /Bills \$900/.test(row) && /Saving \$200/.test(row) && /Left over \$600/.test(row), row);
await shoot('year');

// ---- the tag's own page ----
await page.goto(base + `/tags/${food.id}`); await wait(1200);
const spend = await text('[data-tag-spending]');
check('the tag page shows its spending for this month, this year and all time, children included', /This month \$75\.00/.test(spend) && /This year \$75\.00/.test(spend) && /All time \$85\.00/.test(spend), spend);
await page.goto(base + `/tags/${snacks.id}`); await wait(1000);
check('a tag inside it counts only its own', /This month \$25\.00/.test(await text('[data-tag-spending]')) && /All time \$25\.00/.test(await text('[data-tag-spending]')));
await page.goto(base + `/tags/${food.id}`); await wait(1000);
await shoot('tag');

// ---- phone width ----
await page.setViewportSize({ width: 375, height: 812 });
for (const path of ['/money', '/money/year', '/money/goals', '/money/income', `/tags/${food.id}`]) {
  await page.goto(base + path); await wait(1000);
  check(`${path} does not scroll sideways at 375px`, !(await sideways()));
  const small = await short('[data-budget-month], [data-income], [data-bills], [data-goal], [data-year-list], [data-by-tag], [data-tag-spending]');
  check(`${path}: the budget's own controls are at least 44px tall` + (small.length ? ': ' + small.join('; ') : ''), small.length === 0);
}
await page.setViewportSize({ width: 1280, height: 1000 });

// ---- the trial and the device: the same addresses ----
const status = await page.evaluate(async () => (await fetch('/api/money/year')).status);
check('the year answers under /api/money', status === 200);

if (bad.length) check('no failed requests or page errors', false, [...new Set(bad)].join('; '));
await browser.close();
