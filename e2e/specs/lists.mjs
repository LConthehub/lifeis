// Lists in the entertaining section: the Lists tab, the built-in lists, a title that is not owned (kept off the
// collection until a copy is added), order with up and down, a shared list, "I have it now", and pictures at
// phone width. Runs on the demo household, which has a To watch list, a Wanted list and a shared list.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const browser = await chromium.launch({ ...browserChoice, headless: true });
const bad = [];
const watch = (page) => {
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
  page.on('pageerror', (e) => bad.push('page error: ' + e.message));
  page.on('dialog', (d) => d.accept());
};
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

async function signIn(page) {
  await page.goto(base + '/'); await wait(1000);
  await page.getByRole('button', { name: 'Try the demo' }).click(); await wait(2500);
}

// ---- pictures at phone width, light and dark (first, while the demo's lists are as made) ----
for (const look of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: look, hasTouch: true, deviceScaleFactor: 2 });
  const phone = await context.newPage();
  watch(phone);
  await signIn(phone);
  await phone.goto(base + '/media/lists'); await wait(1200);
  await phone.screenshot({ path: `${shots}/lists-375-${look}.png`, fullPage: true });
  say(`${look} 375px: the Lists tab does not scroll sideways`, (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await phone.getByRole('link', { name: /^To watch, read or hear/ }).click(); await wait(1000);
  await phone.screenshot({ path: `${shots}/list-open-375-${look}.png`, fullPage: true });
  await phone.evaluate(() => window.scrollTo(0, 0));
  await phone.getByRole('button', { name: /^More for / }).first().click(); await wait(400);
  await phone.screenshot({ path: `${shots}/list-more-375-${look}.png`, fullPage: true });
  const smallMore = await phone.locator('main [data-more] button, main [data-more] a').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim()));
  say(`${look} 375px: the More choices are 44px tall or more: ` + smallMore.join(' | '), smallMore.length === 0);
  await phone.keyboard.press('Escape'); await wait(300);
  await phone.getByRole('button', { name: 'Change order' }).click(); await wait(400);
  await phone.screenshot({ path: `${shots}/list-change-order-375-${look}.png`, fullPage: true });
  await phone.getByRole('button', { name: 'Done' }).click(); await wait(300);
  say(`${look} 375px: an open list does not scroll sideways`, (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  const small = await phone.locator('main button, main a').evaluateAll((els) => els.filter((e) => !e.closest('[data-demo-banner]') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim().slice(0, 30)));
  say(`${look} 375px: every control on the open list is 44px tall or more: ` + small.join(' | '), small.length === 0);
  await context.close();
}

// ---- the walk-through, on a wide screen ----
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
watch(page);
const text = async () => page.locator('main').innerText();
const field = (label) => page.locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const entries = async () => page.locator('[data-entry]').evaluateAll((els) => els.map((e) => e.querySelector('a, span.font-medium')?.textContent?.trim()));
await signIn(page);

await page.goto(base + '/media'); await wait(900);
let t = await text();
const tabs = flat(await page.locator('nav[aria-label="Life is entertaining"]').innerText());
say('the tabs are Collection, Lists, Connections: ' + tabs, /Collection\s+Lists\s+Connections/.test(tabs));
say('a title only on a list is not in the collection: ' + flat(t).slice(0, 90), !/Lantern Festival|Harbor Lights|Pip and the Paper Boat/.test(t) && /Spirited Away/.test(t));
say('the Wanted chip is gone, and a link to the Wanted list is there', !(await page.getByRole('button', { name: /^Wanted/ }).count()) && await page.locator('[data-wanted-list]').isVisible());
await page.getByRole('link', { name: 'Lists', exact: true }).click(); await wait(900);
t = await text();
say('the Lists tab shows Wanted, To watch, read or hear and the shared list: ' + flat(t).slice(0, 200), /Wanted\s+1 title/.test(t) && /To watch, read or hear\s+3 titles/.test(t) && /Family movie night\s+3 titles · shared with the household/.test(t));

// ---- To watch: in order, up and down ----
await page.getByRole('link', { name: /^To watch, read or hear/ }).click(); await wait(900);
say('To watch holds a film, a show and a book in the order they were put there', JSON.stringify(await entries()) === JSON.stringify(['The Lantern Festival', 'Pip and the Paper Boat', 'A Map of Small Places']));
say('the arrows are hidden until Change order is on', !(await page.getByRole('button', { name: /^Move .* up$/ }).count()));
await page.getByRole('button', { name: 'Change order' }).click(); await wait(400);
await page.getByRole('button', { name: 'Move A Map of Small Places up' }).click(); await wait(700);
say('up moves a title one place', JSON.stringify(await entries()) === JSON.stringify(['The Lantern Festival', 'A Map of Small Places', 'Pip and the Paper Boat']));
await page.getByRole('button', { name: 'Move The Lantern Festival down' }).click(); await wait(700);
say('down moves a title one place', JSON.stringify(await entries()) === JSON.stringify(['A Map of Small Places', 'The Lantern Festival', 'Pip and the Paper Boat']));
await page.getByRole('button', { name: 'Done' }).click(); await wait(400);
say('Done turns the arrows off again', !(await page.getByRole('button', { name: /^Move .* up$/ }).count()));
const tall = await page.locator('main button, main a').evaluateAll((els) => els.filter((e) => !e.closest('[data-demo-banner]') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim().slice(0, 30)));
say('every button and link on the list is at least 44px tall: ' + tall.join(' | '), tall.length === 0);

// ---- typing a title straight onto a list ----
await field('Kind').selectOption('show'); await field('Title').fill('The Quiet Orchard'); await field('Note').fill('start with the pilot');
await page.getByRole('button', { name: 'Add to the list' }).click(); await wait(800);
say('a typed title is added, with its note, marked as not owned yet: ' + flat(await text()).slice(0, 80), JSON.stringify(await entries()).includes('The Quiet Orchard') && /start with the pilot/.test(await text()) && /not owned yet/.test(await text()));
await page.getByRole('button', { name: 'More for The Quiet Orchard' }).click(); await wait(300);
say('each title has one main button and More', await page.locator('[data-entry]').filter({ hasText: 'The Quiet Orchard' }).getByRole('button', { name: 'Watched today' }).count() === 1);
await page.locator('[data-entry]').filter({ hasText: 'The Quiet Orchard' }).getByRole('button', { name: /Take The Quiet Orchard off/ }).click(); await wait(800);
say('and it can be taken off again', !JSON.stringify(await entries()).includes('Quiet Orchard'));

// ---- watched takes it off To watch ----
await page.locator('[data-entry]').filter({ hasText: 'A Map of Small Places' }).getByRole('button', { name: 'Read today' }).click(); await wait(900);
say('marking a book read takes it off To watch', !JSON.stringify(await entries()).includes('A Map of Small Places'));

// ---- "I have it now" leads to adding a copy; then it is in the collection ----
await page.getByRole('button', { name: 'More for Pip and the Paper Boat' }).click(); await wait(300);
await page.locator('[data-entry]').filter({ hasText: 'Pip and the Paper Boat' }).getByRole('link', { name: 'I have it now' }).click(); await wait(1000);
say('"I have it now" opens the title with the copy form ready', await page.getByRole('dialog').isVisible());
await page.getByPlaceholder(/VHS, DVD, Blu-ray/).fill('DVD');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('with a copy the "not yet" notice is gone', !/You don.t have this one yet/.test(await text()) && /DVD/.test(await text()));
await page.goto(base + '/media'); await wait(900);
say('and the show is in the collection now, the other not-owned titles still are not', /Pip and the Paper Boat/.test(await text()) && !/Lantern Festival/.test(await text()));

// ---- a list of your own, private, then shared ----
await page.goto(base + '/media/lists'); await wait(800);
await page.getByRole('button', { name: '+ New list' }).click();
await field('Name of the list').fill('Gift ideas'); await page.getByRole('button', { name: 'Make the list' }).click(); await wait(1000);
say('a new list is private: ' + flat(await text()).slice(0, 100), /Gift ideas/.test(await text()) && /only you see it/.test(await text()));
await field('Title').fill('A Surprise Film'); await page.getByRole('button', { name: 'Add to the list' }).click(); await wait(800);
await field('Title').fill('Rumours'); await field('Kind').selectOption('music'); await page.getByRole('button', { name: 'Add to the list' }).click(); await wait(800);
say('any kinds mix on a list', JSON.stringify(await entries()) === JSON.stringify(['A Surprise Film', 'Rumours']));
const asked = async (q) => page.evaluate(async (q) => (await (await fetch('/api/search?q=' + encodeURIComponent(q))).json()), q);
const found = await asked('surprise');
say('search finds it, marked as on a list: ' + JSON.stringify(found).slice(0, 120), found.length === 1 && /On a list: Gift ideas/.test(found[0].detail));
await page.getByLabel('Share with the household').click(); await wait(900);
say('sharing says who can see it', /shared with the household/.test(await text()));
await page.getByRole('button', { name: 'Delete this list' }).click(); await wait(900);
say('a list can be deleted, and its titles stay findable', /Lists/.test(await text()) && !/Gift ideas/.test(await text()) && (await asked('surprise')).length === 1);

// ---- Wanted is drawn from the wanted mark ----
await page.getByRole('link', { name: /^Wanted/ }).click(); await wait(800);
say('Wanted shows what is wanted, with no up and down: ' + flat(await text()).slice(0, 100), /Harbor Lights/.test(await text()) && !(await page.getByRole('button', { name: /up$/ }).count()));

console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await page.close();

await browser.close();
