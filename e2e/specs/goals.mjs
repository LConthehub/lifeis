// Goals on plans and the safe number: a plan with its own goal that adds up its cost (typed lines, a gift's price, no-price counts),
// a holiday with a goal, the budget's safe-to-spend number (tap for the four lines), a month's ask to check off, the flat bar with its
// words, and the question asked once when a plan is over. Pictures at 375 wide, light and dark.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }, [method, address, body]);
const text = async (selector = 'main') => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shoot = async (name) => {
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark); await wait(300);
    await page.screenshot({ path: `${shots}/goals-${name}-${dark ? 'dark' : 'light'}-375.png`, fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
};
const short = (inside) => page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((box) => [...box.querySelectorAll('button, a, select')])
  .filter((e) => !e.closest('p') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5)
  .map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`), inside);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const first = `${iso(now).slice(0, 7)}-01`;
const planDay = iso(new Date(now.getFullYear(), now.getMonth() + 4, 10)); // five months to put money by, this one counted
const goneDay = iso(new Date(now.getFullYear(), now.getMonth() - 1, 3));
const goneEnd = iso(new Date(now.getFullYear(), now.getMonth() - 1, 5));

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

await send('POST', '/api/money/income', { name: 'Paycheck', cents: 400000, every: 'monthly', start_day: first });
await send('POST', '/api/money/bills', { name: 'Rent', cents: 120000, every_n: 1, every_unit: 'month', first_due: first });
const plan = await send('POST', '/api/plans', { name: 'Beach week', start_day: planDay, end_day: planDay });
const gone = await send('POST', '/api/plans', { name: 'Lake day', start_day: goneDay, end_day: goneEnd });

// ---- a plan with its own goal ----
await page.goto(base + `/plans/${plan.id}`); await wait(1200);
let box = page.locator('[data-plan-goal]');
check('a plan shows Goal and cost, with no goal yet', (await box.count()) === 1 && /Goal and cost/.test(await text('[data-plan-goal]')) && (await page.locator('[data-start-goal]').count()) === 1, await text());
check('it says what is safe to spend, with the tap hint', /Safe to spend/.test(await text('[data-safe]')) && /Tap to see how it adds up/.test(await text('[data-safe]')), await text('[data-safe]'));
await page.getByLabel('Goal amount').fill('1000');
await page.locator('[data-start-goal]').click(); await wait(1000);
check('starting a goal shows its bar with the words under it', /\$0 of \$1,000, on track/.test(await text('[data-progress]')), await text('[data-plan-goal]'));
check('the month asks for a fifth of it, to set aside', /Set aside \$200\.00 this month/.test(await text('[data-goal-ask]')), await text('[data-plan-goal]'));
await page.getByLabel('A cost of your own').fill('Cabin');
await page.getByLabel('Price', { exact: true }).fill('500');
await page.locator('[data-plan-goal]').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await page.getByLabel('A cost of your own').fill('Ferry');
await page.locator('[data-plan-goal]').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
let goalText = await text('[data-plan-goal]');
check('typed lines add up, and the line with no price says so', /Cabin \$500\.00/.test(goalText) && /Ferry no price yet/.test(goalText) && /It adds up to \$500\.00\. 1 thing has no price yet\./.test(goalText), goalText);
await page.locator('[data-goal-ask] button').click(); await wait(900);
check('setting it aside checks it off and the bar moves', /Set aside this month: \$200\.00/.test(await text('[data-goal-ask]')) && /\$200 of \$1,000, on track/.test(await text('[data-progress]')), await text('[data-plan-goal]'));
await page.locator('[data-safe] button').click(); await wait(300);
const lines = await text('[data-safe-lines]');
check('tapping the safe number shows the four lines', /Income this month \+ \$4,000\.00/.test(lines) && /Bills − \$1,200\.00/.test(lines) && /Goals ask this month − \$200\.00/.test(lines) && /Spent so far − \$0\.00/.test(lines) && /Safe to spend \$2,600\.00/.test(lines), lines);
check('the plan page fits 375 wide and its controls are tall enough', !(await sideways()) && (await short('[data-plan-goal]')).length === 0, await short('[data-plan-goal]'));

// ---- spending tagged to the plan comes out of its goal, not the month ----
const tag = await send('POST', '/api/tags', { name: 'Beach' });
await send('PUT', `/api/tags/on/plan/${plan.id}`, { tag_ids: [tag.id] });
const entry = await send('POST', '/api/money/entries', { label: 'Beach umbrella', cents: 8000, day: iso(now) });
await send('PUT', `/api/tags/on/spending/${entry.id}`, { tag_ids: [tag.id] });
const month = await send('GET', '/api/money/budget');
check('plan spending is in the goal and not counted twice in the month', month.spent === 0 && month.goals_spent === 8000 && month.safe.spent === 0, JSON.stringify([month.spent, month.goals_spent, month.safe.spent]));

// ---- the budget page ----
await page.goto(base + '/money'); await wait(1200);
const budgetText = await text('[data-budget-month]');
check('the budget page has the safe number and the goal asking this month', /Safe to spend \$2,600\.00/.test(budgetText) && /Goals ask this month/.test(budgetText) && /Beach week/.test(budgetText), budgetText);
check('the plan spending shows as spent from the goal', /Spent from plans' goals/.test(await text('[data-goals-spent]')) && /\$80\.00/.test(await text('[data-goals-spent]')), await text('[data-budget-month]'));
check('the budget page fits 375 wide with tall controls', !(await sideways()) && (await short('[data-budget-month]')).length === 0, await short('[data-budget-month]'));
await shoot('budget');

// ---- a holiday with a goal ----
const holiday = await send('POST', '/api/plans/holidays', { name: 'Winter gathering', rule: 'manual', day: planDay });
const year = holiday.years[0];
const gifts = [['Maya', 'A warm scarf', 3500], ['Sam', 'A chess clock', null]];
for (const [who, idea, cents] of gifts) {
  const made = await send('POST', `/api/plans/holidays/years/${year.plan_id}/gifts`, { who, idea });
  if (cents !== null) { const g = made.gifts.find((x) => x.idea === idea); await send('PUT', `/api/plans/holidays/gifts/${g.id}`, { cents }); }
}
await page.goto(base + `/plans/holidays/${holiday.id}/${year.plan_id}`); await wait(1500);
box = page.locator('[data-plan-goal]');
goalText = await text('[data-plan-goal]');
check('a holiday adds up its gifts, and says one has no price yet', /Gift for Maya: A warm scarf \$35\.00/.test(goalText) && /Gift for Sam: A chess clock no price yet/.test(goalText) && /1 thing has no price yet/.test(goalText), goalText);
check('a holiday with no goal offers one, with what it would do to the month', /would be safe to spend/.test(goalText) && (await page.locator('[data-start-goal]').count()) === 1, goalText);
await page.locator('[data-start-goal]').click(); await wait(1000);
check('the holiday goal starts at its cost, with the bar and its words', /\$0 of \$35, on track/.test(await text('[data-plan-goal] [data-progress]')), await text('[data-plan-goal]'));
check('the holiday page fits 375 wide with tall controls', !(await sideways()) && (await short('[data-plan-goal]')).length === 0, await short('[data-plan-goal]'));
await box.scrollIntoViewIfNeeded();
await shoot('holiday');

// ---- when a plan is over it asks once, and nothing moves by itself ----
const lake = await send('POST', '/api/money/goals/start', { plan_id: gone.id, target_cents: 20000, by_day: goneDay });
await send('POST', `/api/money/goals/${lake.id}/saved`, { cents: 12000, day: goneDay });
await page.goto(base + `/plans/${gone.id}`); await wait(1200);
check('an ended plan asks where the leftover goes', /Where should it go\?/.test(await text('[data-goal-question]')) && /\$120 is left/.test(await text('[data-goal-question]')), await text('[data-plan-goal]'));
const before = (await send('GET', `/api/money/goals/${lake.id}`)).saved;
await page.goto(base + '/money'); await wait(1000);
check('the budget page asks it too, and nothing moved by asking', (await page.locator('[data-goal-question]').count()) === 1 && (await send('GET', `/api/money/goals/${lake.id}`)).saved === before, await text());
await page.getByRole('button', { name: 'Leave it in the goal' }).click(); await wait(900);
check('answering asks no more, and the money stays', (await page.locator('[data-goal-question]').count()) === 0 && (await send('GET', `/api/money/goals/${lake.id}`)).saved === 12000);

// ---- the Goals page ----
await page.goto(base + '/money/goals'); await wait(1200);
const goalsPage = await text();
check('the Goals page says Goals, shows each plan, and words under each bar', /^Goals/.test(goalsPage) && !/envelope/i.test(goalsPage) && /for Beach week/.test(goalsPage) && /\$200 of \$1,000, on track/.test(goalsPage) && !(await sideways()), goalsPage);
check('the Goals page controls are tall enough', (await short('[data-goal]')).length === 0, await short('[data-goal]'));

check('no failed requests or page errors', bad.length === 0, bad.join('; '));
await browser.close();
