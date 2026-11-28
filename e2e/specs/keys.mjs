// Personal keys, on a 375px phone: make a key (shown once, with a copy button), use it the way a Siri Shortcut would
// (Authorization: Bearer), see its last-used day, turn it off and see it refused at once, make another and delete it.
// Pictures at 375px, light and dark, of the keys part of Settings with a key just made.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8071';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'light', hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const short = () => page.locator('#keys button, #keys input, #keys a').evaluateAll((els) => els
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && e.type !== 'checkbox'; })
  .map((e) => (e.getAttribute('aria-label') || e.textContent || e.name || e.tagName).trim().slice(0, 30)));
/** For a picture of one part: the bars that stay in place while scrolling are put aside, so they don't cover it. */
const aside = () => page.evaluate(() => { for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && !e.closest('#keys')) e.style.visibility = 'hidden'; } });
/** What a Shortcut does: Get Contents of URL, with the Authorization header. */
const voice = async (method, path, key, body) => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, text: await response.text(), type: response.headers.get('content-type') };
};

// ---- the first account ----
await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }

// ---- the section, empty ----
await page.goto(base + '/settings/account#keys'); await wait(1500);
const section = page.locator('#keys');
check('Settings has a Personal keys section', await section.getByRole('heading', { name: 'Personal keys' }).isVisible());
const empty = flat(await section.innerText());
check('it says there are no keys and that keys are off until made', /You have no keys\. Keys are off until you make one\./.test(empty));
check('it says what a key never reaches', /never reaches guns or ammunition, measures, hidden gifts, money or mail/.test(empty));

// ---- making one ----
await section.getByRole('button', { name: 'Make a key' }).click(); await wait(300);
const boxes = await section.getByRole('checkbox').count();
check('the form lists the eight things a key may do, each with a box', boxes === 8, `${boxes} boxes`);
check('the list is plain words', /Read your grocery list/.test(await section.innerText()) && /Add a reminder to your calendar/.test(await section.innerText()));
const offered = flat(await section.innerText());
check('it offers a jotting, putting a thing away and asking where it is', ['Add a jotting to your private list', 'Move a thing to a place', 'Say where a thing is kept'].every((w) => offered.includes(w)));
await section.getByLabel('What is it for? (a name)').fill('Siri on my iPhone');
await section.getByLabel('Your password, to make it').fill('the wrong password entirely');
await section.getByRole('button', { name: 'Make the key' }).click(); await wait(900);
check('a wrong password makes no key and says so', /That password is wrong/.test(await section.innerText()) && (await section.locator('[data-new-key]').count()) === 0);
await section.getByLabel('Your password, to make it').fill(PASS);
await section.getByRole('button', { name: 'Make the key' }).click(); await wait(1200);
const shown = section.locator('[data-new-key]');
check('the key is shown, with a copy button, once', await shown.isVisible() && await shown.getByRole('button', { name: 'Copy the key' }).isVisible());
const key = (await shown.locator('code').first().innerText()).trim();
check('the key looks like a Life Is key', /^lik_[\w-]{43}$/.test(key));
check('it says this is the only time', /only time Life Is shows it/.test(await shown.innerText()));
check('the list shows the new key, on, never used, with its last four letters and what it may do',
  /Siri on my iPhone/.test(await section.innerText()) && /Never used/.test(await section.innerText()) && (await section.innerText()).includes(`Ends in ${key.slice(-4)}`) && /Read your grocery list/.test(await section.innerText()));
check('no sideways scroll', (await sideways()) <= 0, String(await sideways()));
await section.scrollIntoViewIfNeeded();
await aside();
await section.screenshot({ path: `${shots}/keys-375-light.png` });
check('every control is at least 44px tall', (await short()).length === 0, (await short()).join(', '));

// ---- using it, the way a Shortcut does ----
const added = await voice('POST', '/api/voice/groceries', key, { text: 'milk, eggs and pie crust' });
check('adding "milk, eggs and pie crust" says Added 3', added.status === 200 && added.text === "Added 3. That's 3 on the list." && /text\/plain/.test(added.type), added.text);
const listed = await voice('GET', '/api/voice/groceries', key);
check('what do I need from the store speaks the list', /^3 things\. /.test(listed.text), listed.text);
const reminder = await voice('POST', '/api/voice/reminders', key, { text: 'Call the dentist', when: 'tomorrow at 3pm' });
check('a reminder is added', reminder.text === 'Reminder added for tomorrow at 3 PM: Call the dentist.', reminder.text);
// ---- the newer ones: a jotting, putting a thing away, asking where it is ----
const jot = await voice('POST', '/api/voice/jottings', key, { text: 'the blue pen is in the car' });
check('a jotting is added by voice', jot.status === 200 && jot.text === 'Jotted down.', jot.text);
const asAna = (method, path, body) => page.request.fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, data: body ? JSON.stringify(body) : undefined });
const mine = await (await asAna('GET', '/api/jottings')).json();
check('it is in the person own jottings', mine.length === 1 && mine[0].text === 'the blue pen is in the car');
const kinds = await (await asAna('POST', '/api/things/kinds', { name: 'Kitchen things' })).json();
await asAna('POST', '/api/things/places', { name: 'Kitchen cupboard' });
const places = await (await asAna('POST', '/api/things/places', { name: 'Hall closet' })).json();
await asAna('POST', '/api/things/items', { kind_id: kinds[0].id, name: 'Egg cooker', place_id: places.find((p) => p.name === 'Kitchen cupboard').id });
const unsure = await voice('POST', '/api/voice/put', key, { text: 'I put the whisk in the hall closet' });
check('a thing that is not known changes nothing and says so', unsure.text === `I don't know a thing called "the whisk". Nothing was moved.`, unsure.text);
const moved = await voice('POST', '/api/voice/put', key, { text: 'I put the egg cooker in the hall closet' });
check('"I put the egg cooker in the hall closet" moves it', moved.text === 'The egg cooker is in the hall closet now.', moved.text);
const whereIs = await voice('GET', '/api/voice/where?thing=egg%20cooker', key);
check('"Where is the egg cooker" says the place and since when', whereIs.text === 'The egg cooker is in the hall closet, since today.', whereIs.text);
const nowhere = await voice('GET', '/api/voice/where?thing=spatula', key);
check('a thing it does not know is said plainly', nowhere.text === `I don't know a thing called "spatula".`, nowhere.text);
check('the key cannot open anything else', (await voice('GET', '/api/kitchen/grocery', key)).status === 401 && (await voice('GET', '/api/things/guns', key)).status === 401 && (await voice('GET', '/api/keys', key)).status === 401);
check('a wrong key is refused', (await voice('GET', '/api/voice/groceries', 'lik_' + 'A'.repeat(43))).text === "That key isn't working.");

// ---- the used line, then off, then on ----
await page.reload(); await wait(1500);
check('after use, the list says when it was last used', /Last used/.test(await section.innerText()) && !/Never used/.test(await section.innerText()));
check('the key is not on the page any more', !(await page.locator('body').innerText()).includes(key));
await section.getByRole('button', { name: 'Turn off Siri on my iPhone' }).click(); await wait(800);
check('it shows as off', /\bOff\b/.test(await section.innerText()) && await section.getByRole('button', { name: 'Turn on Siri on my iPhone' }).isVisible());
check('a turned-off key is refused at once, with the same words as a wrong one', (await voice('GET', '/api/voice/groceries', key)).text === "That key isn't working.");
await section.getByRole('button', { name: 'Turn on Siri on my iPhone' }).click(); await wait(800);
check('turned on again, it works', (await voice('GET', '/api/voice/groceries', key)).status === 200);

// ---- delete it, with a question first ----
await section.getByRole('button', { name: 'Delete Siri on my iPhone' }).click(); await wait(400);
check('delete asks first', /Delete "Siri on my iPhone" for good\?/.test(await section.innerText()));
await section.getByRole('button', { name: 'Keep it' }).click(); await wait(300);
check('keeping it leaves it', /Siri on my iPhone/.test(await section.innerText()));
await section.getByRole('button', { name: 'Delete Siri on my iPhone' }).click(); await wait(300);
await section.getByRole('button', { name: 'Yes, delete it' }).click(); await wait(900);
check('a deleted key is gone from the list and refused at once', /You have no keys/.test(await section.innerText()) && (await voice('GET', '/api/voice/groceries', key)).status === 401);

// ---- the dark picture: a key just made ----
await page.emulateMedia({ colorScheme: 'dark' });
await page.reload(); await wait(1500);
await section.getByRole('button', { name: 'Make a key' }).click(); await wait(300);
await section.getByLabel('What is it for? (a name)').fill('Siri on my iPhone');
await section.getByLabel('Your password, to make it').fill(PASS);
await section.getByRole('button', { name: 'Make the key' }).click(); await wait(1200);
check('dark: the new key is shown, with no sideways scroll', await section.locator('[data-new-key]').isVisible() && (await sideways()) <= 0);
await section.scrollIntoViewIfNeeded();
await aside();
await section.screenshot({ path: `${shots}/keys-375-dark.png` });
await browser.close();
