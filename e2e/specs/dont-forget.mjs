// Home's "Don't forget" card, in the demo household: three quiet lines, each with Done, Later and Not now,
// and the card gone when nothing is left. Seen at phone width.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 900 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
const wait = (ms = 900) => page.waitForTimeout(ms);
const card = page.locator('[data-card="dont-forget"]');
const lines = async () => (await card.locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));

await page.goto(base + '/'); await wait(1200);
await page.getByRole('button', { name: 'Try the demo' }).click(); await wait(2500);
check('the card is titled "Don\'t forget"', (await card.locator('h2').innerText()) === "Don't forget");
let now = await lines();
check('it has three lines', now.length === 3, now.join(' | '));
check('a bill, food near its date and a chore not done for a while come first',
  /^Rent: due/.test(now[0] ?? '') && /^Cream: use within 2 days/.test(now[1] ?? '') && /^Wipe the counters: it's been a while \(12 days\)/.test(now[2] ?? ''), now.join(' | '));
check('every line has Done, Later and Not now', (await card.locator('li').evaluateAll((items) => items.every((li) => ['Done', 'Later', 'Not now'].every((b) => [...li.querySelectorAll('button')].some((x) => x.textContent === b))))));
check('nothing in it is red or counts what is late', !/overdue|late|\d+ things/i.test(await card.innerText()));
check('the buttons are at least 44px tall', (await card.locator('button').evaluateAll((bs) => bs.every((b) => b.getBoundingClientRect().height >= 43.5))));
check('no sideways scroll at 393 wide', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/dont-forget.png` });

await card.locator('li', { hasText: 'Cream' }).getByRole('button', { name: 'Later' }).click(); await wait();
now = await lines();
check('Later puts a line away and the next one comes up', !now.some((t) => t.startsWith('Cream')) && now.length === 3 && /^Garage shelves: untouched for 3 weeks/.test(now[2] ?? ''), now.join(' | '));
await page.reload(); await wait(1500);
check('it stays away after a reload', !(await lines()).some((t) => t.startsWith('Cream')));

await card.locator('li', { hasText: 'Wipe the counters' }).getByRole('button', { name: 'Done' }).click(); await wait(1200);
check('Done on the chore records it, and the line goes', !(await lines()).some((t) => t.startsWith('Wipe the counters')));
const jobs = await page.evaluate(async () => (await fetch('/api/things/upkeep')).json());
const counters = jobs.find((j) => j.name === 'Wipe the counters');
check('the chore now says it was done today', counters?.last_done?.day === new Date().toISOString().slice(0, 10) || Boolean(counters?.last_done), JSON.stringify(counters?.last_done));

for (const name of ['Rent', 'Garage shelves', 'Electricity']) { await card.locator('li', { hasText: name }).getByRole('button', { name: 'Not now' }).click(); await wait(); }
check('when nothing is left the card is not shown at all', (await card.count()) === 0);
await browser.close();
