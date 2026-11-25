// The cooking view: "Start cooking" opens a big kitchen view of a recipe at the servings chosen; ingredients and
// steps tick off (and dim); ticks are gone after leaving; the screen is asked to stay on; it fits a phone.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
// Stand-ins for the beep and the buzz, which count what is asked of them.
await context.addInitScript(() => {
  window.__audio = { made: 0, tones: 0 };
  window.__vibes = 0;
  window.AudioContext = class {
    constructor() { window.__audio.made += 1; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { window.__audio.tones += 1; return { frequency: {}, connect: (x) => x, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x }; }
  };
  navigator.vibrate = () => { window.__vibes += 1; return true; };
});
// A stand-in for the screen lock that counts what is asked of it. (The page checks for navigator.wakeLock.)
await context.addInitScript(() => {
  window.__wake = { asked: 0, released: 0 };
  if (!window.__noWake) {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__wake.asked += 1;
      const lock = { released: false, release: async () => { lock.released = true; window.__wake.released += 1; } };
      return lock;
    } } });
  }
});
const page = await context.newPage();
// Time on the page can be moved forward, to see a timer end without waiting for it.
await page.clock.install();
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

const long = 'Simmer gently, stirring now and then, until the sauce coats the back of a spoon and the onions have gone soft and sweet, about twenty minutes.';
const stew = await send('POST', '/api/kitchen/recipes', {
  title: 'Slow Tomato Stew', servings: 4,
  ingredients_text: '# For the base\n2 cups diced tomatoes\n1 onion, chopped\n2 tbsp olive oil\n# To finish\n1 handful basil',
  steps_text: 'Warm the oil in a wide pan.\n\nAdd the onion and cook until soft.\n\nAdd the tomatoes.\n\n' + long,
});

await page.goto(`${base}/recipes/${stew.id}`); await wait(1000);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= 375 && document.body.scrollWidth <= 375);
const checks = () => page.locator('[data-cooking] [role=checkbox]');
const tickedCount = () => page.locator('[data-cooking] [role=checkbox][aria-checked=true]').count();

// Servings chosen on the recipe carry into the view.
await page.getByLabel('Serves').fill('8'); await wait(900);
await page.getByRole('button', { name: 'Start cooking' }).click(); await wait(800);
const view = page.locator('[data-cooking]');
check('"Start cooking" opens the cooking view', await view.isVisible());
const text = await view.innerText();
check('the view shows the ingredients and the steps', /onions?, chopped/.test(text) && text.includes('Warm the oil') && /for the base/i.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
check('it uses the servings chosen on the recipe (for 8, tomatoes doubled)', /for 8/.test(text) && /4/.test(text.split('2 cups diced tomatoes')[1] || ''), text.slice(0, 300));
check('nothing is ticked at first', (await tickedCount()) === 0 && (await checks().count()) === 8);

// Ticking.
await checks().nth(0).click(); await wait(300);
const first = checks().nth(0);
const dim = await first.evaluate((el) => Number(getComputedStyle(el).opacity));
check('a ticked ingredient is marked and dims', (await first.getAttribute('aria-checked')) === 'true' && dim < 0.6, dim);
await checks().nth(0).click(); await wait(200);
check('tapping again unticks it', (await tickedCount()) === 0);
await checks().nth(0).click();
const steps = page.locator('[data-cooking] ol [role=checkbox]');
await steps.nth(0).click(); await wait(800);
check('a ticked step is marked too (an ingredient and a step: 2 ticks)', (await tickedCount()) === 2 && (await steps.nth(0).getAttribute('aria-checked')) === 'true');
check('steps are one under another',
  (await steps.count()) === 4 && (await steps.evaluateAll((all) => all.every((el, i) => i === 0 || el.getBoundingClientRect().top > all[i - 1].getBoundingClientRect().top))));
// The next step is scrolled to the middle once one is done.
await steps.nth(1).click(); await wait(900);
await steps.nth(2).click(); await wait(1200);
const place = await steps.nth(3).evaluate((el) => { const b = el.getBoundingClientRect(); return [b.top >= 0, b.bottom <= window.innerHeight]; });
check('ticking a step brings the next one into view', place[0] && place[1], JSON.stringify(place));

// Timers. A step that names a time offers a one-tap timer; any step offers a typed one; several run at once.
const timerButtons = (await view.locator('ol button:not([role=checkbox])').allInnerTexts()).map((t) => t.trim());
check('the step that names "twenty minutes" offers "Start 20 min timer", and every step a "Timer" button', timerButtons.filter((t) => t === 'Start 20 min timer').length === 1 && timerButtons.filter((t) => t === 'Timer').length === 4, JSON.stringify(timerButtons));
await view.getByRole('button', { name: 'Start 20 min timer' }).click(); await wait(600);
const second = view.locator('ol li').nth(1);
await second.getByRole('button', { name: /Set a timer for step/ }).click();
await second.getByLabel('Minutes').fill('5');
await second.getByRole('button', { name: 'Start', exact: true }).click(); await wait(800);
const running = view.locator('[data-timer]');
check('two timers run at once, each with its step name and a countdown', (await running.count()) === 2 && /^\d+:\d\d$/.test((await running.first().locator('.font-mono').innerText()).trim()), (await view.locator('[data-timers]').innerText()).replace(/\s+/g, ' '));
check('the 5 minute timer counts down from 5:00 and is first (it ends first)', /Add the onion/.test(await running.first().innerText()) && /^[45]:\d\d$/.test((await running.first().locator('.font-mono').innerText()).trim()), await running.first().innerText());
const before = (await running.first().locator('.font-mono').innerText()).trim();
await running.first().getByRole('button', { name: /Add 1 minute/ }).click(); await wait(600);
const after = (await running.first().locator('.font-mono').innerText()).trim();
const secs = (t) => t.split(':').reduce((a, n) => a * 60 + Number(n), 0);
check('"+1 min" adds a minute', secs(after) - secs(before) >= 58 && secs(after) - secs(before) <= 62, `${before} -> ${after}`);
const mine = await send('GET', '/api/cooking/timers');
check('the server holds both timers', mine.length === 2 && mine.every((t) => t.seconds_left > 0), JSON.stringify(mine));
check('a line says running timers are lost if Life Is restarts', /Timers are kept in memory\. If Life Is restarts, running timers are lost\./.test(await view.locator('[data-timers]').innerText()));
check('with no reminder way on, a line points to Settings', (await view.locator('[data-timers] a[href="/settings/reminders#reminders"]').count()) === 1 && /phone and Watch/.test(await view.locator('[data-timers]').innerText()));

// Sizes and fit at 375px.
const small = await view.locator('button').evaluateAll((all) => all.map((b) => [b.textContent.trim().slice(0, 20), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
check('every tap target is at least 44px tall' + (small.length ? ': ' + JSON.stringify(small) : ''), small.length === 0);
check('nothing scrolls sideways at 375px', await overflow() && await view.evaluate((el) => el.scrollWidth <= el.clientWidth));
const fontSize = await steps.nth(0).evaluate((el) => parseFloat(getComputedStyle(el.querySelector('span:last-child')).fontSize));
check('the text is big (at least 20px)', fontSize >= 20, fontSize);

// The screen is asked to stay on, and asked again when the page comes back.
let wake = await page.evaluate(() => window.__wake);
check('the screen is asked to stay on while the view is open', wake.asked >= 1, JSON.stringify(wake));
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
await wait(300);
check('it is not an error to be hidden and shown again', bad.length === 0, bad.join('; '));
check('there is no "may dim" line while the lock works', !/may dim on its own/.test(await view.innerText()));
await page.screenshot({ path: shots + '/cooking-375.png' });

// Dark.
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(300);
const bg = await view.evaluate((el) => getComputedStyle(el).backgroundColor);
check('in dark the view has a dark background', (() => { const m = bg.match(/\d+/g).map(Number); return m[0] < 90 && m[1] < 90 && m[2] < 110; })(), bg);
await page.screenshot({ path: shots + '/cooking-dark-375.png' });
await page.evaluate(() => document.documentElement.classList.remove('dark'));

// Leaving clears everything and lets the screen go.
await page.getByRole('button', { name: 'Done cooking' }).first().click(); await wait(500);
wake = await page.evaluate(() => window.__wake);
check('"Done cooking" closes the view and the recipe is back', (await view.count()) === 0 && await page.getByRole('heading', { name: 'Slow Tomato Stew' }).isVisible());
check('leaving lets the screen go', wake.released >= 1, JSON.stringify(wake));
await page.getByRole('button', { name: 'Start cooking' }).click(); await wait(600);
check('coming back, nothing is ticked', (await tickedCount()) === 0 && (await checks().count()) === 8);
check('and nothing was kept on the server', (await send('GET', `/api/kitchen/recipes/${stew.id}`)).steps_text.startsWith('Warm the oil'));
await page.getByRole('button', { name: 'Done cooking' }).first().click(); await wait(300);

// The timers go on after leaving the view and after a reload: they are asked of the server.
await page.reload(); await wait(1200);
await page.getByRole('button', { name: 'Start cooking' }).click(); await wait(900);
check('after a reload the timers are still running', (await view.locator('[data-timer]').count()) === 2);
// The first tap in the view after a reload allows sound again.
await checks().nth(0).click(); await wait(200);
// A timer that ends: a notice on the page, a beep, a buzz. (Time on the page is moved forward.)
await view.locator('[data-timer]').first().getByRole('button', { name: /Stop the timer/ }).click(); await wait(500);
check('"Stop" ends a timer', (await view.locator('[data-timer]').count()) === 1 && (await send('GET', '/api/cooking/timers')).length === 1);
await page.clock.fastForward(21 * 60_000); await wait(1500);
const noticeText = await page.locator('[data-timer-done]').innerText().catch(() => '');
const heard = await page.evaluate(() => ({ audio: window.__audio, vibes: window.__vibes }));
check('when a timer ends the page shows "Timer done: <step>"', /Timer done: .*Simmer gently/.test(noticeText), noticeText);
check('and beeps (Web Audio) and buzzes', heard.audio.tones >= 3 && heard.vibes >= 1, JSON.stringify(heard));
await page.screenshot({ path: shots + '/cooking-timer-done-375.png' });
await page.locator('[data-timer-done]').getByRole('button', { name: 'OK' }).click(); await wait(300);
check('"OK" clears the notice', (await page.locator('[data-timer-done]').count()) === 0);
await page.getByRole('button', { name: 'Done cooking' }).first().click(); await wait(300);
for (const t of await send('GET', '/api/cooking/timers')) await send('DELETE', `/api/cooking/timers/${t.id}`);
check('the timers address needs a sign-in (who sees whose is in the server tests)', (await fetch(base + '/api/cooking/timers')).status === 401);

// At desktop width.
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole('button', { name: 'Start cooking' }).click(); await wait(600);
await checks().nth(1).click(); await steps.nth(0).click(); await wait(500);
await page.screenshot({ path: shots + '/cooking-1280.png' });
await page.keyboard.press('Escape'); await wait(300);
check('Escape also leaves the cooking view', (await view.count()) === 0);

// A browser with no screen lock: one quiet line, no error.
const plain = await browser.newPage({ viewport: { width: 375, height: 812 } });
await plain.addInitScript(() => { Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }); });
const plainBad = [];
plain.on('pageerror', (e) => plainBad.push(e.message));
await plain.goto(base + '/'); await plain.waitForTimeout(700);
const signedIn = await plain.getByRole('button', { name: 'Sign in' }).count();
if (signedIn) {
  await plain.getByRole('textbox').first().fill('trial');
  await plain.locator('input[type=password]').fill('trial-only-password-8021');
  await plain.getByRole('button', { name: 'Sign in' }).click(); await plain.waitForTimeout(1500);
}
await plain.goto(`${base}/recipes/${stew.id}`); await plain.waitForTimeout(1000);
await plain.getByRole('button', { name: 'Start cooking' }).click(); await plain.waitForTimeout(600);
check('without a screen lock, one quiet line says the screen may dim', (await plain.locator('[data-cooking]').innerText()).includes('This screen may dim on its own; tap now and then to keep it on.') && plainBad.length === 0, plainBad.join('; '));

if (bad.length) check('no failed requests or page errors', false, bad.join('; '));
await browser.close();
