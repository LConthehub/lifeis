import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const flat = (s) => s.replace(/\n/g, ' ');
const dialog = page.getByRole('dialog');
const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const addLine = async (what) => { await page.getByLabel('Add to the list').fill(what); await page.getByRole('button', { name: 'Add', exact: true }).click(); await wait(600); };
const usual = async (label, shop) => {
  await page.getByRole('button', { name: `${label}: where and what size` }).click(); await wait(400);
  await dialog.getByLabel('Usually bought at').fill(shop);
  await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);
};

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1200);
if (await dialog.isVisible().catch(() => false)) {
  for (const area of ['Cooking and groceries', 'The calendar']) await dialog.getByText(area, { exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2500);
}
say('with no plans or coupons, the front page has no card for them', !/Plans coming up|Coupons about to run out/.test(await text()));

// The list: three shops' worth, then just the one you're in.
await page.goto(base + '/groceries'); await wait(1000);
for (const what of ['leeks', 'potatoes', 'coffee', 'soap']) await addLine(what);
await usual('leeks', 'Aldi'); await usual('potatoes', 'Aldi'); await usual('coffee', 'Costco');
await page.getByRole('button', { name: 'by store' }).click(); await wait(400);
await page.getByLabel('Shopping at').fill('Aldi'); await page.getByLabel('Shopping at').blur(); await wait(800);
await page.getByLabel('Just Aldi').check(); await wait(500);
let t = await text();
say('"Just Aldi" leaves Aldi and what can be got anywhere, and says what is hidden', /ALDI[\s\S]*leeks[\s\S]*potatoes[\s\S]*ANY STORE[\s\S]*soap/i.test(t) && !/coffee/.test(t.split('Coupons')[0]) && /1 more for other stores/.test(t));
await page.screenshot({ path: shots + '/just-here.png', fullPage: true });
await page.getByLabel('Price of leeks').fill('2.49'); await page.getByLabel('Got leeks').click(); await wait(800);
await page.getByLabel('Price of potatoes').fill('3.99'); await page.getByLabel('Got potatoes').click(); await wait(800);

// A coupon about to run out, and a plan with food.
await send('POST', '/api/shopping/coupons', { label: 'Coffee', cents_off: 150, store: 'Costco', expires_on: day(1) });
const soup = await send('POST', '/api/kitchen/recipes', { title: 'Leek soup', ingredients_text: '3 leeks\n2 potatoes\n1 pinch saffron' });
const plan = await send('POST', '/api/plans', { name: 'Sunday lunch', start_day: day(9), end_day: day(9) });
await send('POST', `/api/plans/${plan.id}/items`, { kind: 'recipe', ref_id: soup.id });

await page.goto(base + `/plans/${plan.id}`); await wait(1500);
const cost = await page.locator('[data-plan-cost]').innerText().catch(() => '');
say('the plan says roughly what its food costs: ' + flat(cost).slice(0, 110), /about \$6\.48/.test(cost) && /2 of its 3 ingredients/.test(cost) && /saffron/.test(cost));
await page.locator('[data-plan-cost]').screenshot({ path: shots + '/plan-cost.png' });

await page.goto(base + '/'); await wait(1500);
t = await text();
say('the front page shows the plan coming up: ' + flat(t).match(/Sunday lunch.{0,40}/)?.[0], /Plans coming up[\s\S]*Sunday lunch[\s\S]*in 9 days/.test(t));
say('and the coupon about to run out: ' + flat(t).match(/Coffee.{0,40}/)?.[0], /Coupons about to run out[\s\S]*Coffee[\s\S]*\$1\.50 off · Costco[\s\S]*tomorrow/.test(t));
await page.screenshot({ path: shots + '/front-cards.png', fullPage: true });
await page.getByRole('button', { name: 'Choose what shows' }).click(); await wait(400);
say('both can be put out of sight like any card', /Plans coming up/.test(await dialog.innerText()) && /Coupons about to run out/.test(await dialog.innerText()));
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
