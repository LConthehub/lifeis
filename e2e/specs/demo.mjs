// The demo: one tap in, a banner saying what it is, a household with something everywhere, and the few
// things a shared demo refuses said in words.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1200);
check('the sign-in page says it is a demo and offers it', (await page.locator('[data-demo]').innerText()).includes('made-up household'));
await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2500);
check('one tap opens it, with no welcome questions', await page.locator('[data-demo-banner]').isVisible() && !(await page.getByRole('dialog').isVisible().catch(() => false)));
const home = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
check('the front page greets the visitor as Charlie', /Good (morning|afternoon|evening), Charlie/.test(home), home.slice(0, 120));
check('the front page has things to show', ['Sheet-pan chicken tacos', 'Change the furnace filter', 'Dentist'].every((t) => home.includes(t)), home.slice(0, 200));
await page.screenshot({ path: `${shots}/demo-home.png` });

for (const [path, text, shot] of [['/things/upkeep', 'Car registration', 'demo-upkeep'], ['/things/pets', 'George', 'demo-pets'], ['/manual', 'Water shut-off', 'demo-manual'],
  ['/things/report', 'Television', 'demo-inventory'], ['/recipes', 'Leek and potato soup', 'demo-recipes'], ['/media', 'Spirited Away', 'demo-collection']]) {
  await page.goto(base + path); await page.waitForTimeout(1300);
  check(`${path} has the sample household on it`, (await page.locator('main').innerText()).includes(text));
  await page.screenshot({ path: `${shots}/${shot}.png` });
}

await page.goto(base + '/manual'); await page.waitForTimeout(1000);
await page.getByRole('region', { name: 'Sharing' }).getByRole('button', { name: 'Make the link' }).click(); await page.waitForTimeout(1000);
check('sharing the manual is refused, in words', (await page.getByRole('region', { name: 'Sharing' }).innerText()).includes("can't be shared by a link"));
await page.goto(base + '/settings/account'); await page.waitForTimeout(1200);
const form = page.locator('form').filter({ hasText: 'Current password' });
await form.locator('input[type=password]').nth(0).fill('whatever-it-was-123');
await form.locator('input[type=password]').nth(1).fill('a-new-long-password-1');
if (await form.locator('input[type=password]').count() > 2) await form.locator('input[type=password]').nth(2).fill('a-new-long-password-1');
await form.getByRole('button').last().click(); await page.waitForTimeout(1000);
check('changing the password is refused, in words', (await page.locator('main').innerText()).includes("can't be changed: everyone shares it"));
await browser.close();
