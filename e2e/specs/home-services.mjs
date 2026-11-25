// Home services, on a 375px phone: the person in charge adds Jellyfin (a home and an away address, an icon and a color, for
// everyone) and the router (for only them); a second person sees Jellyfin but not the router, in the tab or in search, and pins
// Jellyfin to their Home page; a link marked for guests shows on the shared House Manual with only its away address.
// Pictures at 375px, light and dark, of the tab and the Home card.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8051';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const phone = (look = 'light') => browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: look, hasTouch: true, deviceScaleFactor: 2 });
const watch = (page, who) => {
  page.on('pageerror', (e) => check(`${who}: no page errors`, false, e.message));
  page.on('dialog', (d) => d.accept());
};
async function signIn(page, name, make) {
  await page.goto(base + '/'); await wait(1000);
  await page.getByRole('textbox').first().fill(name);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: make ? /Make my account|Sign in/ : /Sign in/ }).click(); await wait(2000);
  const first = page.getByRole('dialog');
  if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const short = (page) => page.locator('main button, main a, [role=dialog] button').evaluateAll((els) => els.filter((e) => !e.closest('[data-demo-banner]') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim().slice(0, 30)));

// ---- the person in charge ----
const chiefContext = await phone();
const chief = await chiefContext.newPage();
watch(chief, 'in charge');
await signIn(chief, 'ana', true);
await chief.goto(base + '/manual'); await wait(1000);
const tabs = flat(await chief.locator('nav[aria-label="Life is tidy"]').innerText());
check('the tidy tabs end with House Manual and Home services: ' + tabs, /House Manual\s+Home services$/.test(tabs));
await chief.getByRole('link', { name: 'Home services', exact: true }).click(); await wait(900);
check('the page starts empty and says what to add', /No links yet/.test(await chief.locator('main').innerText()));

async function add(fields, { who, icon, color, guests } = {}) {
  await chief.getByRole('button', { name: '+ Add a link' }).click(); await wait(500);
  const form = chief.getByRole('dialog');
  await form.getByLabel('What it is called *').fill(fields.name);
  await form.getByLabel('Address *').fill(fields.address);
  if (fields.at) await form.getByLabel('This address works').selectOption(fields.at);
  if (fields.address2) { await form.getByLabel('Another address (optional)').fill(fields.address2); await form.getByLabel('The other address works').selectOption(fields.at2); }
  if (fields.group) await form.getByLabel('Group (optional)').fill(fields.group);
  if (fields.note) await form.getByLabel('A note').fill(fields.note);
  if (icon) await form.getByRole('radio', { name: icon, exact: true }).click();
  if (color) await form.getByRole('radio', { name: color, exact: true }).click();
  if (who) await form.getByRole('radio', { name: who, exact: true }).check();
  if (guests) await form.getByLabel(/Show to guests/).check();
  return form;
}

// Jellyfin: two addresses, an icon and a color, for everyone, and for guests.
let form = await add({ name: 'Jellyfin', address: 'http://192.168.1.20:8096', at: 'home', address2: 'https://watch.example.com', at2: 'away', group: 'Watch', note: 'Films and shows' }, { icon: 'Media', color: 'Plum', guests: true });
check('the form says not to put passwords here', /Do not put a password here/.test(await form.innerText()));
check('every control in the form is 44px or taller: ' + (await short(chief)).join(' | '), (await short(chief)).length === 0);
await chief.screenshot({ path: `${shots}/home-services-form-375.png`, fullPage: false });
await form.getByRole('button', { name: 'Save' }).click(); await wait(1200);
// A bad one is refused, in words.
form = await add({ name: 'Sneaky', address: 'http://me:secret@nas.local' });
await form.getByRole('button', { name: 'Save' }).click(); await wait(800);
check('an address with a password in it is refused', /Leave passwords out/.test(await chief.getByRole('dialog').innerText()));
await chief.getByRole('dialog').getByRole('button', { name: 'Close' }).click(); await wait(300);
// The router: only me.
form = await add({ name: 'Router', address: '192.168.1.1', group: 'House' }, { icon: 'Settings', color: 'Rust', who: 'Only me' });
await form.getByRole('button', { name: 'Save' }).click(); await wait(1200);

let main = await chief.locator('main').innerText();
check('the person in charge sees both, in their groups', /Watch[\s\S]*Jellyfin[\s\S]*House[\s\S]*Router/.test(main), flat(main).slice(0, 160));
check('Jellyfin offers an at-home button and an away button', (await chief.getByRole('link', { name: 'At home: Jellyfin' }).getAttribute('href')) === 'http://192.168.1.20:8096' && (await chief.getByRole('link', { name: 'Away: Jellyfin' }).getAttribute('href')) === 'https://watch.example.com');
check('the buttons open in a new tab', (await chief.getByRole('link', { name: 'At home: Jellyfin' }).getAttribute('target')) === '_blank');
check('the router is marked as only for them', /Only you see it/.test(main) && /Everyone sees it · on the guest link/.test(main));
check('no horizontal scroll at 375px', (await sideways(chief)) <= 0);
const small = await short(chief);
check('every control on the page is 44px or taller: ' + small.join(' | '), small.length === 0);
await chief.screenshot({ path: `${shots}/home-services-375-light.png`, fullPage: true });

// ---- a second person ----
await chief.evaluate(async (pass) => { await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bob', password: pass }) }); }, PASS);
const bobContext = await phone();
const bob = await bobContext.newPage();
watch(bob, 'second person');
await signIn(bob, 'bob', false);
await bob.goto(base + '/manual/services'); await wait(1200);
main = await bob.locator('main').innerText();
check('the second person sees Jellyfin and not the router', /Jellyfin/.test(main) && !/Router/.test(main) && !/192\.168\.1\.1\b/.test(await bob.content()));
check('the second person has no add button and is told who changes links', !(await bob.getByRole('button', { name: '+ Add a link' }).count()) && /Only the person in charge adds and changes them/.test(main));
await bob.getByRole('button', { name: /Pin Jellyfin to Home/ }).click(); await wait(800);
check('pinning turns the button to "Pinned to Home"', /Pinned to Home/.test(await bob.locator('main').innerText()));
// Search: the router is nowhere for them; Jellyfin is.
const found = (page, q) => page.evaluate((word) => fetch('/api/search?q=' + word).then((r) => r.json()).then((l) => l.map((x) => x.title)), q);
check('search finds Jellyfin for them', JSON.stringify(await found(bob, 'jelly')) === JSON.stringify(['Jellyfin']));
check('search does not find the router for them', (await found(bob, 'router')).length === 0);
check('search finds the router for the person in charge', JSON.stringify(await found(chief, 'router')) === JSON.stringify(['Router']));
await bob.locator('header button[aria-label="Search everything in Life Is"]').click(); await wait(400);
await bob.getByLabel('Search everything', { exact: true }).fill('router'); await wait(1200);
check('typing "router" into the search window shows nothing for them', (await bob.getByRole('dialog', { name: 'Search' }).getByText('Router').count()) === 0 && /Nothing found/i.test(await bob.getByRole('dialog', { name: 'Search' }).innerText()));
await bob.getByLabel('Search everything', { exact: true }).fill('jelly'); await wait(1200);
check('typing "jelly" finds Jellyfin for them', (await bob.getByRole('dialog', { name: 'Search' }).getByText('Jellyfin').count()) > 0);
await bob.keyboard.press('Escape'); await wait(300);
// The Home card.
await bob.goto(base + '/'); await wait(1500);
const card = bob.getByRole('region', { name: 'Home services' }).or(bob.locator('section').filter({ has: bob.getByRole('heading', { name: 'Home services' }) }));
check('their Home page has a Home services card with Jellyfin', (await card.count()) > 0 && /Jellyfin/.test(await card.first().innerText()) && !/Router/.test(await card.first().innerText()));
check('no horizontal scroll on Home at 375px', (await sideways(bob)) <= 0);
await bob.screenshot({ path: `${shots}/home-card-375-light.png`, fullPage: true });
await card.first().scrollIntoViewIfNeeded();
await card.first().screenshot({ path: `${shots}/home-card-only-375-light.png` });
// The card can be hidden.
await bob.getByRole('button', { name: /Choose what shows|What shows/ }).first().click().catch(() => {}); await wait(500);
check('the Home services card is in the list of cards to show or hide', /Home services: the links you pinned/.test(await bob.locator('body').innerText()));
await bob.keyboard.press('Escape'); await wait(300);

// ---- the shared House Manual: guests ----
const share = await chief.evaluate(() => fetch('/api/manual/share', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 2 }) }).then((r) => r.json()));
const guest = await (await phone()).newPage();
await guest.goto(`${base}/m/${share.share.token}`); await wait(800);
const html = await guest.content();
check('the shared manual shows Jellyfin with only its away address', /Jellyfin/.test(html) && html.includes('https://watch.example.com') && !html.includes('192.168.1.20'));
check('the shared manual has no router', !/Router/.test(html) && !html.includes('192.168.1.1'));
await guest.screenshot({ path: `${shots}/home-services-guest-375.png`, fullPage: true });

// ---- dark pictures ----
for (const [who, context, file, url] of [['in charge', chiefContext, 'home-services-375-dark', '/manual/services'], ['second person', bobContext, 'home-card-375-dark', '/']]) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(base + url); await wait(1500);
  check(`${who}: dark picture has no horizontal scroll`, (await sideways(page)) <= 0);
  await page.screenshot({ path: `${shots}/${file}.png`, fullPage: true });
}
await browser.close();
