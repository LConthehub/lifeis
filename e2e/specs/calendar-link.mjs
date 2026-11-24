import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const dialog = page.getByRole('dialog');
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1200);
if (await dialog.isVisible().catch(() => false)) {
  await dialog.getByText('Cooking and groceries').first().click();
  await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2500);
}
// Something to show: a date with a time, a birthday, a meal.
const post = (address, body) => page.evaluate(async ([a, b]) => (await fetch(a, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, [address, body]);
await post('/api/calendar/events', { title: 'Book club', day: day(3), time: '19:00' });
await post('/api/calendar/events', { title: "Mom's birthday", day: '1958-03-07', yearly: true });
await post('/api/kitchen/plan', { day: day(1), meal: 'dinner', title: 'Stew' });

await page.goto(base + '/calendar'); await wait(900);
await page.getByRole('link', { name: "See this on your phone's calendar" }).click(); await wait(1200);
const part = page.locator('#calendar-link');
say('the calendar page leads to the link in Settings', await part.isVisible());
say('it starts off, with the usual things ticked', await part.getByRole('button', { name: 'Make a link' }).isVisible() && await part.getByLabel('Plans').isChecked() && !(await part.getByLabel('Food to use up').isChecked()));
await part.getByRole('button', { name: 'Make a link' }).click(); await wait(900);
const address = await part.getByLabel('Your link').inputValue();
say('making it gives an address: ' + address.replace(/[0-9a-f]{56}\.ics/, '….ics'), /\/cal\/[0-9a-f]{64}\.ics$/.test(address));
say('the button for this device uses the calendar kind of link', (await part.getByRole('link', { name: "Add to this device's calendar" }).getAttribute('href')).startsWith('webcal://'));
say('on the computer itself it says the link only works here', /only works here/.test(await part.innerText()));

// What a calendar app would get: no cookie, just the address.
const fresh = await browser.newContext();
const got = await fresh.request.get(address);
let file = await got.text();
say('a calendar app gets the file without signing in', got.status() === 200 && got.headers()['content-type'].startsWith('text/calendar') && /SUMMARY:Book club/.test(file) && /RRULE:FREQ=YEARLY/.test(file) && /SUMMARY:Dinner: Stew/.test(file));
await page.reload(); await wait(1200);
say('Settings says when it was last fetched', /Last fetched/.test(await part.innerText()));
await page.screenshot({ path: shots + '/calendar-link.png', fullPage: false });
await part.screenshot({ path: shots + '/calendar-link-part.png' });

await part.getByLabel("The week's meals").uncheck(); await wait(900);
file = await (await fresh.request.get(address)).text();
say('unticking meals takes them out, at the same address', !/Stew/.test(file) && /Book club/.test(file));
await part.getByRole('button', { name: 'Make a new link' }).click(); await wait(900);
const second = await part.getByLabel('Your link').inputValue();
say('a new link stops the old one', second !== address && (await fresh.request.get(address)).status() === 404 && (await fresh.request.get(second)).status() === 200);
await part.getByRole('button', { name: 'Turn it off' }).click(); await wait(900);
say('turning it off forgets it', (await fresh.request.get(second)).status() === 404 && await part.getByRole('button', { name: 'Make a link' }).isVisible());
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
console.log('---- the file ----\n' + file.split('\r\n').slice(0, 24).join('\n'));
await browser.close();
