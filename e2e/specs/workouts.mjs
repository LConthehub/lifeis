import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
// A workout: a routine whose steps carry numbers, "last time" on each, and a plain look back.
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const dialog = page.getByRole('dialog');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || '?'); } }
  return small;
};
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---------- making a workout ----------
await page.goto(base + '/routines'); await wait(1200);
await page.getByRole('button', { name: '+ New workout' }).click(); await wait(600);
say('a new workout says what it is, and that it starts as yours alone', (await dialog.innerText()).includes('A workout') && (await dialog.innerText()).includes('yours alone'));
say('it starts as Mine', (await dialog.getByLabel('Whose is it').inputValue()) === 'me');
await dialog.getByLabel('Name of the routine').fill('Leg day');
await dialog.getByLabel('Name of the time').fill('Workout');
const stepBox = (n) => dialog.locator('[data-routine-step]').nth(n);
const first = stepBox(0);
await first.getByLabel('Step', { exact: true }).fill('Goblet squat');
await first.getByLabel('Sets', { exact: true }).fill('3');
await first.getByLabel('Reps', { exact: true }).fill('10');
await first.getByLabel('Weight', { exact: true }).fill('25');
await dialog.getByRole('button', { name: '+ Add a step' }).click();
const second = stepBox(1);
await second.getByLabel('Step', { exact: true }).fill('Easy walk');
await second.getByLabel('Minutes', { exact: true }).fill('20');
await second.getByLabel('Distance', { exact: true }).fill('1');
await second.getByLabel('Distance unit').selectOption('km');
await dialog.getByRole('button', { name: '+ Add a step' }).click();
await stepBox(2).getByLabel('Step', { exact: true }).fill('Stretch');
const formSmall = await tooSmall([dialog.locator('button'), dialog.locator('select'), dialog.locator('input:not([type=checkbox])')]);
say('at 375px the workout form has 44px controls and nothing scrolls sideways' + (formSmall.length ? ` (too small: ${formSmall})` : ''), formSmall.length === 0 && await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1000);
let t = await text();
say('the list shows it as a workout, for you', /Leg day/.test(t) && /Workout · For you/.test(t) && /Workout: 3 steps/.test(t));
await page.getByRole('button', { name: 'Change Leg day' }).click(); await wait(600);
say('the numbers were kept on the steps, and the plain step has none', (await stepBox(0).getByLabel('Weight', { exact: true }).inputValue()) === '25' && (await stepBox(1).getByLabel('Distance unit').inputValue()) === 'km' && (await stepBox(2).getByLabel('Sets', { exact: true }).inputValue()) === '');
await dialog.getByRole('button', { name: 'Close' }).click(); await wait(400);

// ---------- last time ----------
const routines = await send('GET', '/api/routines');
const w = routines.find((r) => r.name === 'Leg day');
const steps = w.times[0].steps;
say('the workout is a workout, mine, and two of its three steps carry numbers', w.kind === 'workout' && w.who_kind === 'me' && steps.filter((s) => s.tracks).length === 2);
await send('PUT', `/api/routine-day/steps/${steps[0].id}`, { done: true, day: inDays(-2), nums: { sets: 3, reps: 10, weight: 25, weight_unit: 'lb' } });
await send('PUT', `/api/routine-day/steps/${steps[1].id}`, { done: true, day: inDays(-2), nums: { minutes: 25, distance: 1.2, distance_unit: 'km' } });
await page.goto(base + '/'); await wait(1500);
const card = page.locator('[data-routine-time="Leg day: Workout"]');
let c = await card.innerText();
say('Home shows each step\'s last time', /Last time: 3 x 10 at 25 lb, \w{3}/.test(c) && /Last time: 25 min, 1\.2 km, \w{3}/.test(c));
say('the plain step shows no numbers and no last time', (await card.locator('[data-numbers]').count()) === 2 && (c.match(/Last time/g) ?? []).length === 2);
say('the boxes start as last time was', (await card.getByLabel('Weight for Goblet squat').inputValue()) === '25' && (await card.getByLabel('Minutes for Easy walk').inputValue()) === '25');
const homeSmall = await tooSmall([card.locator('button'), card.locator('input'), card.locator('select')]);
say('the workout card has 44px controls and fits 375px' + (homeSmall.length ? ` (too small: ${homeSmall})` : ''), homeSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/workouts-home-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(300);
await page.screenshot({ path: shots + '/workouts-home-dark-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.remove('dark'));

// Change a number with a tap before checking it off: 30 lb today.
await card.getByLabel('Weight for Goblet squat').fill('30');
await card.getByRole('checkbox').first().click(); await wait(800);
c = await card.innerText();
say('checking it off keeps the changed numbers', c.includes('Done: 3 x 10 at 30 lb') && c.includes('1 of 3 done'));
await page.reload(); await wait(1500);
say('they are still there after reloading', (await card.innerText()).includes('Done: 3 x 10 at 30 lb'));
await card.getByRole('checkbox').nth(1).click(); await wait(800);
say('the other numbered step keeps what it started as', (await card.innerText()).includes('Done: 25 min, 1.2 km'));
await card.getByRole('checkbox').nth(2).click(); await wait(800);
say('with every step checked, the workout folds to one line on Home', (await page.locator('[data-routine-done="Leg day: Workout"]').innerText()).includes('all done'));
await page.getByRole('button', { name: 'Show Leg day: Workout again' }).click(); await wait(500);
say('the plain step is just ticked', (await card.innerText()).includes('3 of 3 done') && (await card.locator('[data-numbers]').count()) === 0);

// ---------- going through it ----------
await card.getByRole('button', { name: 'Start over' }).click(); await wait(800);
await card.getByRole('button', { name: 'Step by step' }).click(); await wait(600);
const go = page.locator('[data-go-through]');
say('Step by step shows last time and the boxes on a numbered step', (await go.locator('[data-step]').innerText()).includes('Goblet squat') && (await go.locator('[data-last-time]').innerText()).startsWith('Last time:') && (await go.locator('[data-numbers] input').count()) === 3);
const goSmall = await tooSmall([go.locator('button'), go.locator('input'), go.locator('select')]);
say('every control in Step by step is 44px or more, and nothing scrolls sideways' + (goSmall.length ? ` (too small: ${goSmall})` : ''), goSmall.length === 0 && await noSideways());
await go.getByRole('button', { name: 'Close' }).last().click(); await wait(500);

// ---------- looking back ----------
await page.goto(base + '/routines'); await wait(1200);
await page.getByRole('button', { name: 'Look back at Leg day' }).click(); await wait(800);
const back = await dialog.innerText();
say('looking back says how many of the last 7 days', /\d of the last 7 days/.test(back));
say('it shows a month of dots, and the last times of each numbered step', (await dialog.locator('[data-dots] li').count()) === 30 && /Goblet squat/.test(back) && /3 x 10 at 25 lb/.test(back) && /Easy walk/.test(back));
say('it does not count streaks, points or misses', !/streak|point|badge|missed|miss/i.test(back));
await page.screenshot({ path: shots + '/workouts-history-375.png' });
await dialog.getByRole('button', { name: 'Close' }).first().click(); await wait(400);

// ---------- shared like any routine ----------
await page.getByRole('button', { name: 'Change Leg day' }).click(); await wait(600);
const whose = await dialog.getByLabel('Whose is it').locator('option').allInnerTexts();
say('it can be shared like any routine: everyone, or a person', whose.some((o) => o.startsWith("Everyone's")));
await dialog.getByRole('button', { name: 'Close' }).click(); await wait(300);

say('nothing was asked of another address' + (outside.size ? ` (${[...outside]})` : ''), outside.size === 0);
say('no failed requests or errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
