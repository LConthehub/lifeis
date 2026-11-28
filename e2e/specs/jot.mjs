import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
// Jottings: a private scratch list. The "Jot it down" line on Home, the Jottings page, the voice path with a personal
// key, a second person who sees none of it, and the minutes-to-get-there field on the event form.
// Pictures at 375px of Home and the page: e2e/shots/jot-home-375.png and jot-page-375.png.
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8021';
const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/api/voice/')) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5 && (await el.getAttribute('type')) !== 'checkbox') small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || '?'); } }
  return small;
};
const voice = async (method, path, key, body) => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, text: await response.text() };
};
const send = (who, method, address, body) => who.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; }, [method, address, body]);

await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---------- Home: one line, type and Enter ----------
await page.goto(base + '/'); await wait(1200);
const line = page.locator('[data-card="jot"]');
say('Home has a "Jot it down" line', await line.isVisible() && await page.getByLabel('Jot it down').first().isVisible());
await page.locator('#jot-line').fill('call the vet about Hank');
await page.locator('#jot-line').press('Enter'); await wait(900);
say('Enter adds it in one step, and the line clears', (await page.locator('#jot-line').inputValue()) === '' && (await line.innerText()).includes('call the vet about Hank'));
await page.locator('#jot-line').fill('the blue pen is in the car');
await page.locator('#jot-line').press('Enter'); await wait(900);
const latest = await page.locator('[data-jot-latest] li').allInnerTexts();
say('the line shows only the latest, newest first', latest[0] === 'the blue pen is in the car' && latest[1] === 'call the vet about Hank');
const homeSmall = await tooSmall([line.locator('input'), line.locator('a'), line.locator('button')]);
say('the line has 44px controls and nothing scrolls sideways' + (homeSmall.length ? ` (too small: ${homeSmall})` : ''), homeSmall.length === 0 && await noSideways());
await line.scrollIntoViewIfNeeded();
await page.evaluate(() => { for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && !e.closest('[data-card="jot"]')) e.style.visibility = 'hidden'; } });
await line.screenshot({ path: `${shots}/jot-home-375.png` });
await page.reload(); await wait(1000);

// ---------- the page ----------
await page.locator('[data-card="jot"]').getByRole('link', { name: /All your jottings/ }).click(); await wait(1000);
say('the link opens the Jottings page', new URL(page.url()).pathname === '/jottings' && await page.getByRole('heading', { name: 'Jottings' }).isVisible());
say('it says only you can see them, not even the person in charge', (await page.locator('[data-jottings-private]').innerText()).includes('not even the person in charge'));
const rows = page.locator('li[data-jotting]:visible');
say('they are listed newest first, each with its date', await rows.count() === 2 && (await rows.nth(0).innerText()).includes('the blue pen is in the car') && /\d{4}/.test(await rows.nth(0).innerText()));
await page.getByLabel('Jot it down', { exact: true }).fill('buy a stamp');
await page.getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
say('a jotting added here comes first', (await rows.nth(0).innerText()).includes('buy a stamp') && await rows.count() === 3);
await rows.nth(0).getByRole('button', { name: 'Reword' }).click(); await wait(300);
await page.getByLabel('Reword this jotting').fill('buy two stamps');
await page.getByRole('button', { name: 'Save' }).click(); await wait(800);
say('a jotting can be reworded', (await rows.nth(0).innerText()).includes('buy two stamps'));
await page.getByLabel('Check off: buy two stamps').click(); await wait(800);
say('a checked jotting folds away', await rows.count() === 2 && await page.locator('[data-checked-jottings] summary').isVisible() && /Checked off \(1\)/.test(await page.locator('[data-checked-jottings] summary').innerText()));
await page.locator('[data-checked-jottings] summary').click(); await wait(300);
say('open, the fold holds it, struck through', (await page.locator('[data-checked-jottings] [data-done="true"]').innerText()).includes('buy two stamps'));
await page.getByLabel('Check off: buy two stamps').click(); await wait(800);
say('it can be brought back', await rows.count() === 3 && await page.locator('[data-checked-jottings]').count() === 0);
const pageSmall = await tooSmall([page.locator('main button'), page.locator('main input'), page.locator('main summary')]);
say('the page has 44px controls and nothing scrolls sideways' + (pageSmall.length ? ` (too small: ${pageSmall})` : ''), pageSmall.length === 0 && await noSideways());
await page.evaluate(() => { for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && !e.closest('main')) e.style.visibility = 'hidden'; } });
await page.locator('main').screenshot({ path: `${shots}/jot-page-375.png` });
await page.reload(); await wait(800);
await rows.filter({ hasText: 'the blue pen' }).getByRole('button', { name: 'Remove' }).click(); await wait(300);
await rows.filter({ hasText: 'the blue pen' }).getByRole('button', { name: 'Yes, remove it' }).click(); await wait(800);
say('a jotting is removed after a question', await rows.count() === 2 && !(await page.locator('main').innerText()).includes('blue pen'));

// ---------- the voice path, with a personal key ----------
const made = await send(page, 'POST', '/api/keys', { name: 'Siri on my iPhone', can: ['jotting_add'], password: PASS });
const key = made.json.key;
say('a key can be made that may add a jotting', made.status === 201 && made.json.made.says[0] === 'Add a jotting to your private list');
const spoken = await voice('POST', '/api/voice/jottings', key, { text: 'the spare key is in the blue bowl' });
say('the voice path adds it and says so', spoken.status === 200 && spoken.text === 'Jotted down.', spoken.text);
const plain = await send(page, 'POST', '/api/keys', { name: 'Reader', can: ['groceries_read'], password: PASS });
say('a key without that permission is refused', (await voice('POST', '/api/voice/jottings', plain.json.key, { text: 'no' })).status === 403);
await page.goto(base + '/jottings'); await wait(1000);
say('the spoken jotting is on the page', (await page.locator('main').innerText()).includes('the spare key is in the blue bowl'));

// ---------- a second person sees none of it ----------
const other = await browser.newContext({ viewport: { width: 375, height: 812 } });
const second = await other.newPage();
await send(page, 'POST', '/api/users', { username: 'hank', password: PASS });
await second.goto(base + '/'); await second.waitForTimeout(800);
await second.getByRole('textbox').first().fill('hank');
await second.locator('input[type=password]').fill(PASS);
await second.getByRole('button', { name: 'Sign in' }).click(); await second.waitForTimeout(1500);
const theirs = await send(second, 'GET', '/api/jottings');
say('a second person has no jottings of the first', theirs.status === 200 && theirs.json.length === 0);
await second.goto(base + '/jottings'); await second.waitForTimeout(1000);
say('and the page shows them none', !(await second.locator('main').innerText()).includes('spare key') && /Nothing jotted yet/.test(await second.locator('main').innerText()));
const mineNow = await send(page, 'GET', '/api/jottings');
const aJotting = mineNow.json[0].id;
say('they cannot change or remove one of the first person', (await send(second, 'PUT', `/api/jottings/${aJotting}`, { done: true })).status === 404);
await send(second, 'DELETE', `/api/jottings/${aJotting}`);
say('the first person still has theirs', (await send(page, 'GET', '/api/jottings')).json.length === mineNow.json.length);
await send(second, 'POST', '/api/jottings', { text: 'hank only' });
say('what the second person jots is not in the first person list', !(await send(page, 'GET', '/api/jottings')).json.some((j) => j.text === 'hank only'));
await other.close();

// ---------- the event form: minutes to get there ----------
await page.goto(base + '/calendar'); await wait(1200);
await page.getByRole('button', { name: '+ Add' }).click(); await wait(500);
const form = page.getByRole('dialog');
const minutes = form.getByLabel('Minutes to get there');
say('the event form has a Minutes to get there field, off until there is a time', await minutes.isVisible() && await minutes.isDisabled());
await form.getByLabel('What *').fill('Dentist');
await form.locator('input[type=time]').fill('15:00');
say('with a time, the field can be typed in', await minutes.isEnabled());
await minutes.fill('25');
await form.getByRole('button', { name: 'Save' }).click(); await wait(1000);
const events = await send(page, 'GET', `/api/calendar?start=${new Date().toLocaleDateString('en-CA')}&days=1`);
const dentist = events.json.find((e) => e.title === 'Dentist');
const saved = dentist ? (await send(page, 'GET', `/api/calendar/events/${dentist.id}`)).json : null;
say('the minutes are kept on the event', saved !== null && saved.travel_minutes === 25);
say('no failed requests or page errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
