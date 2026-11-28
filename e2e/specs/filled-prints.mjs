// Four pages printed filled in from the person's own data, each on ONE letter page, each from a Print button on its own screen:
// the week (Calendar), meals with the grocery list (The week), morning and evening (Routines), Don't forget (Home).
// Too much for one sheet says "and N more"; empty parts are blank lines. The page count comes from the print layout (a PDF made
// with the browser in print mode), and every screen is checked at 375 wide before printing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join('\n')));
const out = `${shots}/print`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
const wait = (ms = 900) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const dayOf = (n) => { const d = new Date(monday); d.setDate(d.getDate() + n); return iso(d); };
const pagesOf = async (name) => {
  const bytes = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${out}/${name}.pdf`, bytes);
  return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
};
/** Print from the screen's own button, then look at the sheet as paper. */
async function printIt(url, way, label, shot) {
  await page.emulateMedia({ media: 'screen' });
  await page.goto(base + url); await wait(1500);
  const fits = await noSideways();
  const tall = await page.getByRole('button', { name: 'Print', exact: true }).evaluate((b) => b.getBoundingClientRect().height);
  const before = await page.evaluate(() => window.__printed);
  await page.getByRole('button', { name: 'Print', exact: true }).click(); await wait(300);
  await page.getByRole('button', { name: label }).click(); await wait(400);
  const asked = (await page.evaluate(() => window.__printed)) === before + 1;
  const screenFits = fits && await noSideways();
  await page.emulateMedia({ media: 'print' }); await wait(500);
  const sheet = page.locator(`[data-way="${way}"]`);
  const info = await sheet.evaluate((el) => {
    const body = el.querySelector('.fp-body');
    return { text: el.innerText.replace(/\s+/g, ' '), clipped: body.scrollHeight > body.clientHeight + 1, more: [...el.querySelectorAll('[data-more]')].map((m) => m.textContent), blanks: el.querySelectorAll('[data-blank]').length,
      head: !!el.querySelector('.pf-bands') && !!el.querySelector('.pf-title'), title: el.querySelector('.pf-title').textContent, screenHidden: getComputedStyle(document.querySelector('main')).display === 'none' };
  });
  const pages = await pagesOf(way);
  await page.screenshot({ path: `${out}/${shot}.png`, fullPage: true });
  return { fits: screenFits, tall, asked, pages, ...info };
}

await page.goto(base + '/'); await wait(1200);
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1800);

// ---------- empty first: blank lines to write on ----------
let got = await printIt('/calendar', 'week', 'Print the week', 'week-empty');
check('the week: Print is on the Calendar screen, at least 44px tall, and the screen fits 375', got.tall >= 43.5 && got.fits, `${got.tall}px`);
check('the week: Print asks the browser to print, and only the sheet is on paper', got.asked && got.screenHidden && got.head && got.title === 'The week');
check('the week with nothing on it is blank lines to write on, on one letter page', got.blanks >= 14 && got.pages === 1 && !got.clipped, `${got.blanks} blank, ${got.pages} page`);
got = await printIt('/week', 'meals', 'Print meals and groceries', 'meals-empty');
check('the meal week: nothing planned prints blank lines, on one page', got.blanks >= 14 && got.pages === 1 && !got.clipped && got.asked && got.fits, `${got.blanks} blank, ${got.pages} page`);
got = await printIt('/routines', 'routines', 'Print morning and evening', 'routines-empty');
check('the routine sheet with no routine prints empty boxes to write beside, on one page', got.blanks >= 16 && got.pages === 1 && !got.clipped && got.asked && got.fits, `${got.blanks} blank, ${got.pages} page`);

// ---------- now more than will fit ----------
const event = (title, day, time) => send('POST', '/api/calendar/events', { title, day, time: time ?? null });
for (let i = 1; i <= 9; i += 1) await event(`Appointment number ${i}`, dayOf(2), `${String(7 + i).padStart(2, '0')}:00`);
await event('Soccer practice', dayOf(0), '16:30');
await event('Library hold pickup', dayOf(4));
await send('POST', '/api/kitchen/plan', { day: dayOf(0), meal: 'dinner', title: 'Tacos' });
await send('POST', '/api/kitchen/plan', { day: dayOf(1), meal: 'dinner', title: 'Soup and bread' });
await send('POST', '/api/kitchen/plan', { day: dayOf(1), meal: 'breakfast', title: 'Oatmeal' });
for (let i = 1; i <= 7; i += 1) await send('POST', '/api/things/upkeep', { name: `Job due Friday ${i}`, kind: 'chore', every_n: 1, every_unit: 'week', first_due: dayOf(4) });
for (let i = 1; i <= 36; i += 1) await send('POST', '/api/kitchen/grocery', { label: `Grocery item ${i}` });
const steps = (n, word) => Array.from({ length: n }, (_, i) => ({ words: `${word} step ${i + 1}` }));
await send('POST', '/api/routines', { name: 'My day', times: [{ name: 'Morning', steps: steps(24, 'Morning') }, { name: 'Evening', steps: steps(5, 'Evening') }] });

got = await printIt('/calendar', 'week', 'Print the week', 'week-full');
check('the week: a day with too much says "and N more", and nothing spills', got.more.some((m) => /^and \d+ more$/.test(m)) && got.pages === 1 && !got.clipped, `${got.more.join(' | ')}; ${got.pages} page`);
check('the week holds each day\'s calendar, dinner and what is due', /Soccer practice/.test(got.text) && /4:30 pm/.test(got.text) && /Library hold pickup/.test(got.text) && /Tacos/.test(got.text) && /Soup and bread/.test(got.text) && /Job due Friday 1/.test(got.text), got.text.slice(0, 200));
check('the week is Monday to Sunday', /Mon\s*\d+\/\d+.*Tue.*Wed.*Thu.*Fri.*Sat.*Sun/.test(got.text), got.text.slice(0, 160));
got = await printIt('/week', 'meals', 'Print meals and groceries', 'meals-full');
check('the meal week: the meals are on it with the grocery list beside them', /Dinner: Tacos/.test(got.text) && /Breakfast: Oatmeal/.test(got.text) && /Groceries/.test(got.text) && /Grocery item 1,|Grocery item 1\b/.test(got.text));
check('36 groceries do not fit, so it says "and N more", on one page', got.more.some((m) => /^and \d+ more$/.test(m)) && got.pages === 1 && !got.clipped, `${got.more.join(' | ')}; ${got.pages} page`);
got = await printIt('/routines', 'routines', 'Print morning and evening', 'routines-full');
check('the routine sheet has both parts with a box on each line', /Morning/.test(got.text) && /Evening/.test(got.text) && /Morning step 1/.test(got.text) && /Evening step 5/.test(got.text));
check('24 morning steps do not fit, so it says "and N more", on one page', got.more.some((m) => /^and \d+ more$/.test(m)) && got.pages === 1 && !got.clipped, `${got.more.join(' | ')}; ${got.pages} page`);

// Don't forget: chores not done for a long while make the lines (with the cards that already say them hidden, as in the Don't forget walk-through).
const old = new Date(); old.setDate(old.getDate() - 70);
for (const name of ['Wipe the counters', 'Water the plants', 'Clean the filter', 'Sweep the porch']) {
  const job = await send('POST', '/api/things/upkeep', { name, kind: 'chore', every_n: 1, every_unit: 'week' });
  await send('POST', `/api/things/upkeep/${job.id}/done`, { day: iso(old) });
}
const hidden = await page.evaluate(async () => (await (await fetch('/api/home')).json()).choices.filter((c) => !c.shown || ['days', 'upkeep', 'pantry'].includes(c.key)).map((c) => c.key));
await send('PUT', '/api/home/cards', { hidden });
await page.emulateMedia({ media: 'screen' });
await page.goto(base + '/'); await wait(1800);
const card = page.locator('[data-card="dont-forget"]');
check('Home shows the Don\'t forget card, and fits 375 wide', (await card.count()) === 1 && await noSideways());
if (await card.count()) {
  got = await printIt('/', 'forget', "Print today's Don't forget", 'forget');
  check('Don\'t forget prints its lines with a box each and blank lines after, on one page', /Wipe the counters|Water the plants|Clean the filter|Sweep the porch/.test(got.text) && got.blanks >= 5 && got.pages === 1 && !got.clipped && got.asked && got.title === "Don't forget", `${got.blanks} blank, ${got.pages} page`);
}
const words = JSON.stringify(results);
check('nothing on the sheets scolds or counts', !/overdue|late|streak|missed|behind/i.test(words));
await browser.close();
