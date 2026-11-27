// Bills, renewals and chores beside upkeep jobs: a bill that stays on its date and goes into spending, a
// renewal from the common ones, and chores whose points are counted by the week.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const pad = (n) => String(n).padStart(2, '0');
const day = (ahead) => { const d = new Date(Date.now() + ahead * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

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

const show = (what) => page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: what });
const common = () => page.getByRole('region', { name: 'Common jobs' });

await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await show(/Bills/).click(); await page.waitForTimeout(400);
const offered = await common().innerText();
check('choosing Bills offers common bills, not jobs', offered.includes('Rent or mortgage') && !offered.includes('furnace'));

// A bill, made by hand: due three days ago, on a monthly round.
await page.getByRole('button', { name: '+ New', exact: true }).click(); await page.waitForTimeout(500);
const form = page.getByRole('dialog');
check('a new one here starts as a bill', (await form.getByLabel('What it is').inputValue()) === 'bill');
await form.getByLabel('Its name *').fill('Electricity');
await form.getByLabel('Next due on').fill(day(-3));
await form.getByLabel('What it costs each time').fill('84.50');
await form.getByLabel('How many').fill('1');
check('a bill asks for no tools or steps', !(await form.getByLabel('Add a tool').isVisible().catch(() => false)));
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1500);
const top = await page.locator('main').innerText();
check('it shows its amount and that it is late', top.includes('$84.50 each time') && (await page.locator('[data-state]').first().innerText()).includes('late by 3 days'), (await page.locator('[data-state]').first().innerText()));
await page.getByRole('button', { name: 'Paid', exact: true }).click(); await page.waitForTimeout(600);
const pay = page.getByRole('dialog');
check('paying starts with its amount, going into spending', (await pay.getByLabel('How much').inputValue()) === '84.50' && await pay.getByLabel("Put it in this month's spending").isChecked());
await pay.getByRole('button', { name: 'Paid', exact: true }).click(); await page.waitForTimeout(1500);
const next = await page.evaluate(() => fetch('/api/things/upkeep').then((r) => r.json()).then((l) => l[0].due.next_day));
const was = new Date(`${day(-3)}T12:00:00`);
const month = new Date(was.getFullYear(), was.getMonth() + 1, 1);
const expected = `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(Math.min(was.getDate(), new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()))}`;
check('paid late, the next is still due on its own date', next === expected, `${next} (expected ${expected})`);
const spent = await page.evaluate(() => fetch('/api/money').then((r) => r.json()).then((m) => m.entries.map((e) => [e.label, e.cents])));
check('the payment is in this month’s spending', JSON.stringify(spent) === JSON.stringify([['Electricity', 8450]]), JSON.stringify(spent));

// A renewal from the common ones opens straight to its form, to say when it runs out.
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await show(/Renewals/).click(); await page.waitForTimeout(400);
await common().getByRole('listitem').filter({ hasText: 'Car registration' }).getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(1500);
const renew = page.getByRole('dialog');
check('a common renewal opens ready to be filled in', await renew.getByLabel('Runs out on').isVisible());
await renew.getByLabel('Runs out on').fill(day(200));
await renew.getByLabel('What it costs each time').fill('180');
await renew.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1200);
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
const total = await page.locator('[data-monthly]').innerText();
check('the page says what bills and renewals come to a month', total.includes('$99.50'), total); // 84.50 + 180/12

// Chores: two from the common ones, done, and counted.
await show(/Chores/).click(); await page.waitForTimeout(400);
for (const chore of ['Take out the trash', 'Clean the bathroom']) {
  await common().getByRole('listitem').filter({ hasText: chore }).getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(900);
}
for (const chore of ['Take out the trash', 'Clean the bathroom']) {
  // Done is one tap: it records today, by me, with no form.
  await page.getByRole('button', { name: `${chore} done` }).click(); await page.waitForTimeout(1000);
}
const board = (await page.getByRole('region', { name: 'Chores this week' }).innerText()).replace(/\s+/g, ' ');
check('the week’s points are counted for whoever did them', board.includes('ana') && board.includes('2 done') && board.includes('7 points'), board);
await page.screenshot({ path: `${shots}/household-chores.png`, fullPage: true });
await show(/Everything/).click(); await page.waitForTimeout(400);
const everything = await page.locator('main').innerText();
check('everything together shows all the kinds', ['Electricity', 'Car registration', 'Take out the trash'].every((t) => everything.includes(t)));
await page.screenshot({ path: `${shots}/household-all.png`, fullPage: true });
await browser.close();
