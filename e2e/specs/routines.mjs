import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
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
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label'))); } }
  return small;
};
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// A thing the evening step will name.
await send('POST', '/api/things/starters', { slug: 'clothing' });
const kind = (await send('GET', '/api/things/kinds'))[0];
const serum = await send('POST', '/api/things/items', { kind_id: kind.id, name: 'Retinoid serum', quantity: 2, low_at: 1 });

// ---------- making the routines from the ready-made ones ----------
await page.goto(base + '/routines'); await wait(1200);
say('the Routines page is under busy, beside Calendar', await page.getByRole('link', { name: /Routines/ }).first().isVisible());
await page.getByRole('button', { name: 'Add Skincare' }).click(); await wait(900);
say('the ready-made list stays open while adding', await page.getByRole('button', { name: 'Add 4-night skin cycle' }).isVisible());
await page.getByRole('button', { name: 'Add 4-night skin cycle' }).click(); await wait(900);
let t = await text();
say('both ready-made routines are kept, Skincare with Morning and Evening', /Skincare/.test(t) && /Morning: 3 steps/.test(t) && /Evening: 2 steps/.test(t) && /4-night skin cycle/.test(t) && /4-night cycle/.test(t));

// Change Skincare: a retinoid step in the evening on Monday and Thursday, naming the serum, with a wait; the evening has a clock time.
await page.getByRole('button', { name: 'Change Skincare' }).click(); await wait(600);
const evening = dialog.locator('[data-routine-time]').nth(1);
await evening.getByLabel('Clock time (optional)').fill('21:00');
await evening.getByRole('button', { name: '+ Add a step' }).click();
const added = evening.locator('[data-routine-step]').last();
await added.getByLabel('Step', { exact: true }).fill('Retinoid');
await added.getByLabel('Days', { exact: true }).selectOption('weekdays');
await added.getByRole('button', { name: 'Monday' }).click();
await added.getByRole('button', { name: 'Thursday' }).click();
await added.getByLabel('A thing it uses').selectOption({ label: 'Retinoid serum' });
await added.getByLabel('Wait after this step').selectOption('60');
const formSmall = await tooSmall([dialog.locator('button'), dialog.locator('select'), dialog.locator('input:not([type=checkbox])')]);
say('at 375px the routine form has 44px controls and nothing scrolls sideways' + (formSmall.length ? ` (too small: ${formSmall})` : ''), formSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/routines-form-375.png' });
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1000);
t = await text();
say('Skincare now says its evening has 3 steps and a clock time', /Evening at 9 pm: 3 steps/.test(t));

const listSmall = await tooSmall([page.getByRole('button', { name: /^(Change|Add)/ }), page.locator('summary')]);
say('the list has 44px buttons and fits 375px' + (listSmall.length ? ` (too small: ${listSmall})` : ''), listSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/routines-page-375.png', fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 }); await wait(500);
say('at 1280px the Routines page has no sideways scroll', await noSideways());
await page.screenshot({ path: shots + '/routines-page-1280.png', fullPage: true });
await page.setViewportSize({ width: 375, height: 812 }); await wait(300);

// ---------- ticking on Home ----------
await page.goto(base + '/'); await wait(1500);
const day = new Date().getDay();
const retinoidToday = day === 1 || day === 4;
const morning = page.locator('[data-routine-time="Skincare: Morning"]');
const eve = page.locator('[data-routine-time="Skincare: Evening"]');
const cycle = page.locator('[data-routine-time="4-night skin cycle: Evening"]');
say('Home shows each time as a checklist, 0 of 3 for the morning', (await morning.innerText()).includes('0 of 3 done'));
say(`the evening has ${retinoidToday ? 'the retinoid step today (Monday or Thursday)' : 'no retinoid step today (not Monday or Thursday)'}`, retinoidToday
  ? (await eve.innerText()).includes('0 of 3 done') && (await eve.innerText()).includes('Retinoid')
  : (await eve.innerText()).includes('0 of 2 done') && !(await eve.innerText()).includes('Retinoid'));
await morning.getByRole('checkbox').first().click(); await wait(600);
say('ticking one step says 1 of 3 done', (await morning.innerText()).includes('1 of 3 done'));
await morning.getByRole('button', { name: 'Tick them all' }).click(); await wait(700);
say('ticking them all finishes it, and it counts the day: 1 of the last 7 days', (await morning.innerText()).includes('3 of 3 done') && (await morning.innerText()).includes('1 of the last 7 days'));
await page.reload(); await wait(1500);
say('the ticks are still there after reloading', (await morning.innerText()).includes('3 of 3 done'));
say('the cycle starts on night 1: exfoliate, not the retinoid', (await cycle.innerText()).includes('night 1 of 4') && (await cycle.innerText()).includes('Exfoliate') && !(await cycle.innerText()).includes('Retinoid'));
const homeSmall = await tooSmall([page.locator('[data-section="routines"], [data-routine-time]').locator('button')]);
say('Home\'s routines have 44px buttons and fit 375px' + (homeSmall.length ? ` (too small: ${homeSmall})` : ''), homeSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/routines-home-375.png', fullPage: true });

// ---------- going through the cycle one step at a time ----------
await cycle.getByRole('button', { name: 'Go through it' }).click(); await wait(600);
const go = page.locator('[data-go-through]');
say('Go through it shows one big step at a time, starting with step 1 of 3', (await go.locator('[data-step-count]').innerText()).startsWith('Step 1 of 3') && (await go.locator('[data-step]').innerText()).includes('Wash your face'));
await go.getByRole('button', { name: 'Done', exact: true }).click(); await wait(500);
say('Done ticks the step and moves to exfoliating, which has a wait', (await go.locator('[data-step]').innerText()).includes('Exfoliate') && (await go.locator('[data-wait]').innerText()).includes('Wait 1 min'));
await go.getByRole('button', { name: 'Start the timer' }).click(); await wait(1500);
say('the timer counts down', /^(1:00|0:5\d)/.test((await go.locator('[data-timer]').innerText()).trim()));
const goSmall = await tooSmall([go.locator('button')]);
say('every button in Go through it is 44px or more, and nothing scrolls sideways' + (goSmall.length ? ` (too small: ${goSmall})` : ''), goSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/routines-go-375.png' });
await go.getByRole('button', { name: 'Done', exact: true }).click(); await wait(500);
say('then the last step, moisturizer', (await go.locator('[data-step-count]').innerText()).startsWith('Step 3 of 3'));
await go.getByRole('button', { name: 'Done', exact: true }).click(); await wait(500);
say('and it ends on All done', (await go.innerText()).includes('All done'));
await go.getByRole('button', { name: 'Close' }).last().click(); await wait(600);
say('closing leaves the checklist at 3 of 3', (await cycle.innerText()).includes('3 of 3 done'));

// ---------- the cycle waits ----------
const night = async (n) => (await send('GET', `/api/routine-day?day=${inDays(n)}`)).find((x) => x.title === '4-night skin cycle: Evening')?.night;
say('tomorrow is night 2, the retinoid night', await night(1) === 2);
say('and skipping days keeps it night 2: three days on is still night 2', await night(3) === 2);

// ---------- running low, from the step to the grocery list ----------
const routines = await send('GET', '/api/routines');
const retinoid = routines.find((r) => r.name === 'Skincare').times[1].steps.find((s) => s.words === 'Retinoid');
const low = await send('POST', `/api/routine-day/steps/${retinoid.id}/low`);
const groceries = await send('GET', '/api/kitchen/grocery');
say('marking the serum running low puts it on the grocery list', low.added === true && groceries.some((g) => g.label === 'Retinoid serum'));
await page.goto(base + `/things/${serum.id}`); await wait(1200);
say('the thing\'s page says where it is used', /Used in/.test(await text()) && /Skincare: Evening/.test(await text()));
say('the thing\'s page fits 375px', await noSideways());

// ---------- search finds a routine ----------
const found = await send('GET', '/api/search?q=retinoid');
say('search finds the routine by a step in it', found.some((r) => r.kind === 'routine' && r.title === 'Skincare'));

say('nothing was asked of another address' + (outside.size ? ` (${[...outside]})` : ''), outside.size === 0);
say('no failed requests or errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
