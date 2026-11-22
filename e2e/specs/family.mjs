// Chores for someone without a sign-in: a child is added, given a chore, and collects points worth money.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

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

await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: /Chores/ }).click(); await page.waitForTimeout(500);
const board = page.getByRole('region', { name: 'Chores this week' });
check('the chores view has a place for the household, before anyone has done anything', (await board.innerText()).includes('Nobody has done one yet') && (await board.innerText()).includes('without a sign-in of their own'));

await board.getByLabel('Their name').fill('Leo'); await board.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(800);
await board.getByLabel('Their name').fill('Mia'); await board.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(800);
check('children are added without a sign-in', (await board.getByRole('list', { name: 'In the household' }).innerText()).replace(/\s+/g, ' ').includes('Leo') && (await board.getByRole('list', { name: 'In the household' }).innerText()).includes('Mia'));
await board.getByLabel('Their name').fill('leo'); await board.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(800);
check('the same name twice is refused, in words', (await board.getByRole('alert').innerText()).includes('already in your household'));
await board.getByLabel('What a point is worth').fill('0.50'); await board.getByLabel('What a point is worth').blur(); await page.waitForTimeout(800);

// A chore of Leo's own.
await page.getByRole('button', { name: '+ New', exact: true }).click(); await page.waitForTimeout(500);
const form = page.getByRole('dialog');
await form.getByLabel('Its name *').fill('Tidy your room');
await form.getByLabel('Points for doing it').fill('4');
await form.getByLabel('How many').fill('1');
await form.getByLabel('Days, weeks, months or years').selectOption('week');
await form.getByLabel('Usually done by').selectOption({ label: 'Leo' });
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1500);
check('the chore says whose it is', (await page.locator('main').innerText()).includes('4 points'));
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
check('the list says who does it', (await page.locator('main').innerText()).includes('Leo does it'));

await page.getByRole('button', { name: 'Tidy your room done' }).click(); await page.waitForTimeout(600);
const done = page.getByRole('dialog');
check('marking it done starts with the child whose chore it is', (await done.getByLabel('Who did it').evaluate((s) => s.options[s.selectedIndex].text)) === 'Leo');
await done.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(1200);
// Mia does it too, the next time it's marked.
await page.getByRole('button', { name: 'Tidy your room done' }).click(); await page.waitForTimeout(600);
await page.getByRole('dialog').getByLabel('Who did it').selectOption({ label: 'Mia' });
await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(1200);

await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: /Chores/ }).click(); await page.waitForTimeout(600);
const scores = (await board.innerText()).replace(/\s+/g, ' ');
check('each child has their points, and what they are worth', /Leo 1 done 4 points · \$2\.00/.test(scores) && /Mia 1 done 4 points · \$2\.00/.test(scores), scores.slice(0, 200));
await page.screenshot({ path: `${shots}/family.png`, fullPage: true });

await page.getByRole('link', { name: /Tidy your room/ }).click(); await page.waitForTimeout(1000);
const times = (await page.getByRole('region', { name: 'Each time it was done' }).innerText()).replace(/\s+/g, ' ');
check('the chore remembers who did it each time', times.includes('Leo · 4 points') && times.includes('Mia · 4 points'), times);
await browser.close();
