import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base, shots] = process.argv.slice(2);
// Screenshots also go where HOLIDAY_SHOTS says, when it is set.
const extra = process.env.HOLIDAY_SHOTS;
if (extra) mkdirSync(extra, { recursive: true });
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const dialog = page.getByRole('dialog');
/** A field of the form, by the words above it (the label also holds what it shows, so its name is not exact). */
const pick = (words) => dialog.locator('label').filter({ has: page.locator('span', { hasText: new RegExp('^' + words + '$') }) }).locator('select, input');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const shot = async (name, options = {}) => { await page.screenshot({ path: `${shots}/${name}.png`, ...options }); if (extra) await page.screenshot({ path: `${extra}/${name}.png`, ...options }); };
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push(((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || 'a control')); } }
  return small;
};
/** A plain colored square, made in the browser. */
const square = (color) => page.evaluate((c) => { const k = document.createElement('canvas'); k.width = 400; k.height = 400; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 400, 400); return k.toDataURL('image/png').split(',')[1]; }, color)
  .then((b64) => ({ name: 'spot.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }));
const region = (name) => page.getByRole('region', { name, exact: true });

// The fourth Thursday of November, this year or the next one coming.
const thanksgiving = (year) => { const first = new Date(year, 10, 1).getDay(); return `${year}-11-${pad(1 + ((4 - first + 7) % 7) + 21)}`; };
const today = iso(new Date());
const year1 = thanksgiving(new Date().getFullYear()) >= today ? new Date().getFullYear() : new Date().getFullYear() + 1;
const day1 = thanksgiving(year1);
const day2 = thanksgiving(year1 + 1);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// What the holiday will use: a box in the attic with lights in it, a person in the household, a turkey recipe with a prep step.
const box = (await send('POST', '/api/things/places', { name: 'Attic box 3' })).find((p) => p.name === 'Attic box 3');
await send('POST', '/api/things/kinds', { name: 'Decor', icon: null, fields: [] });
const kind = (await send('GET', '/api/things/kinds')).find((k) => k.name === 'Decor');
await send('POST', '/api/things/items', { kind_id: kind.id, name: 'String lights', place_id: box.id });
await send('POST', '/api/things/upkeep/members', { name: 'Maya' });
const turkey = await send('POST', '/api/kitchen/recipes', { title: 'Roast turkey', ingredients_text: '1 turkey', cook_minutes: 180 });
await send('PUT', `/api/prep/recipes/${turkey.id}`, { steps: [{ words: 'Brine the turkey', rule: 'night_before', at: '20:00' }] });

// ---------- adding Thanksgiving ----------
await page.goto(base + '/plans/holidays'); await wait(1000);
let t = await text();
say('Holidays starts empty and says Life Is suggests none', /suggests none/.test(t) && !/Thanksgiving/.test(t));
say('Holidays is a tab under Plans', await page.getByRole('link', { name: 'Holidays' }).first().isVisible());
await page.getByRole('button', { name: '+ Add a holiday' }).click(); await wait(500);
await dialog.getByLabel('Name *').fill('Thanksgiving');
say('the form starts on the fourth Thursday of November', (await dialog.locator('select').nth(1).inputValue()) === '4' && (await dialog.locator('select').nth(2).inputValue()) === '4' && (await dialog.locator('select').nth(3).inputValue()) === '11');
await dialog.getByRole('button', { name: 'Add it' }).click(); await wait(1500);
t = await text();
say(`Thanksgiving ${year1} is made on ${day1}, on its plan page`, /\/plans\/\d+$/.test(page.url()) && t.includes(`Thanksgiving ${year1}`) && /Yearly · Fourth Thursday of November/.test(t));
const holiday = (await send('GET', '/api/plans/holidays'))[0];
say('its first year is the fourth Thursday', holiday.years[0].day === day1);
const planId = holiday.years[0].plan_id;

// ---------- dinner, a frozen turkey, the countdown ----------
const foodCard = region('Food');
say('the day card no longer asks for dinner or a turkey', !/Dinner is at|Frozen turkey/.test(await region('The day').innerText()));
await foodCard.getByLabel('Served at').fill('17:00'); await foodCard.getByLabel('Served at').blur(); await wait(900);
await foodCard.getByLabel('What is it').fill('Turkey'); await foodCard.getByLabel('Frozen, in pounds (if it is)').fill('16');
await foodCard.getByRole('button', { name: 'Add the food' }).click(); await wait(1200);
t = await text();
say('a 16 pound turkey asks for 4 days in the refrigerator, with its source', /needs 4 days in the refrigerator/.test(t) && /USDA: thawing in the refrigerator/.test(t));
// The menu is the plan's Food list.
await page.getByRole('button', { name: '+ Add a recipe' }).click(); await wait(600);
await dialog.getByLabel('Which *').selectOption({ label: 'Roast turkey' });
await dialog.getByLabel("Put it on that day's meals and the grocery list").uncheck();
await dialog.getByRole('button', { name: 'Add', exact: true }).click(); await wait(1500);
await page.getByLabel('Put the decorations up on').fill(iso(new Date(new Date(day1 + 'T12:00').getTime() - 7 * 86400000))); await page.getByLabel('Put the decorations up on').blur(); await wait(600);
const count = region('Dinner countdown');
t = await count.innerText();
say('the countdown works back from dinner: thaw, brine, start cooking', /Put the 16 lb Turkey in the refrigerator to thaw/.test(t) && /Brine the turkey/.test(t) && /Start cooking Roast turkey/.test(t) && /about 180 minutes to cook/.test(t));
const thawDay = new Date(new Date(day1 + 'T12:00').getTime() - 4 * 86400000);
say('the thaw is 4 days before dinner, at 9 am', (await send('GET', `/api/plans/holidays/years/${planId}`)).countdown.steps[0].due_day === iso(thawDay));
await count.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -130)); await wait(200);
await count.screenshot({ path: `${shots}/holidays-countdown-375.png` });
if (extra) await count.screenshot({ path: `${extra}/holidays-countdown-375.png` });
await page.getByRole('checkbox', { name: 'Brine the turkey is done' }).click(); await wait(700);
say('a step can be ticked off', await page.getByRole('checkbox', { name: 'Brine the turkey is done' }).isChecked());
const own = count.getByLabel('A step of your own');
await own.fill('Set the table'); await count.getByRole('button', { name: 'Add the step' }).click(); await wait(800);
say('a step of your own joins the countdown', /Set the table/.test(await count.innerText()));

// ---------- decorations by spot, with photos ----------
const up = region('Put up');
await up.getByLabel('Where it goes').fill('Front porch'); await up.getByLabel('What it is').fill('Wreath'); await up.getByRole('button', { name: 'Add it' }).click(); await wait(800);
await up.getByLabel('Where it goes').fill('Mantel'); await up.getByLabel('One of your things').selectOption({ label: 'String lights (Attic box 3)' }); await up.getByRole('button', { name: 'Add it' }).click(); await wait(800);
t = await up.innerText();
say('a decoration that is one of your things shows its box', /String lights/.test(t) && /Kept in Attic box 3/.test(t) && /Front porch/.test(t) && /Mantel/.test(t));
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), up.getByRole('button', { name: 'Add a photo of Mantel' }).click()]);
await chooser.setFiles(await square('#b45309')); await wait(1500);
say('a photo of the spot is kept this year', (await up.getByRole('img', { name: 'Mantel this year' }).count()) === 1);
await up.getByRole('checkbox', { name: 'Wreath is up' }).click(); await wait(600);
say('a decoration can be ticked as up', await up.getByRole('checkbox', { name: 'Wreath is up' }).isChecked());

// ---------- people, gifts, budget ----------
await region('Who came').getByLabel('Who came: a name').fill('Aunt June'); await region('Who came').getByRole('button', { name: 'Add', exact: true }).click(); await wait(700);
await region('Cards').getByLabel('Cards: a name').fill('Grandma'); await region('Cards').getByRole('button', { name: 'Add', exact: true }).click(); await wait(700);
await region('Who came').getByRole('checkbox', { name: 'Aunt June came' }).click(); await wait(500);
const gifts = region('Gifts');
await gifts.getByLabel('Who the gift is for', { exact: true }).selectOption({ label: 'Maya' });
await gifts.getByLabel('The gift idea').fill('A scarf'); await gifts.getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await gifts.getByLabel('Where the gift A scarf is').selectOption('bought'); await wait(800);
await gifts.getByLabel('What A scarf cost').fill('25'); await gifts.getByLabel('What A scarf cost').blur(); await wait(900);
say('a gift marked bought with its cost is counted in the budget', /\$25\.00/.test(await region('Budget').innerText()));
say('guests and cards are listed, and a guest is marked as come', /1 of 1 came/.test(await region('Who came').innerText()) && /Grandma/.test(await region('Cards').innerText()));
await page.goto(base + '/'); await wait(1500);
const homeCard = page.getByRole('region', { name: 'Coming up', exact: true });
if (Date.parse(day1 + 'T12:00') - Date.now() <= 42 * 86400000) {
  t = await homeCard.innerText();
  say('Home\'s Coming up card says what is next for the holiday', /Thanksgiving/.test(t) && /Next:/.test(t));
  await homeCard.scrollIntoViewIfNeeded();
  await homeCard.screenshot({ path: `${shots}/holidays-home-card-375.png` });
  if (extra) await homeCard.screenshot({ path: `${extra}/holidays-home-card-375.png` });
} else say('more than six weeks ahead, Coming up shows no step for the holiday yet', !/Next:/.test(await homeCard.innerText().catch(() => '')));
await page.goto(base + `/plans/holidays/${holiday.id}/${planId}`); await wait(1500);
say('the old holiday-year address opens the plan page', page.url().endsWith(`/plans/${planId}`));
await shot('holidays-year-375', { fullPage: true });
// The year's own sections (the rest of the plan page has its own checks).
const mine = ['The day', 'Food', 'Dinner countdown', 'Put up', 'Take down', 'Who came', 'Cards', 'Gifts', 'Budget', 'How it went'].map(region);
const small = await tooSmall(mine.flatMap((r) => [r.locator('button'), r.locator('select'), r.locator('input:not([type=checkbox]):not([type=file])'), r.locator('summary')]));
say('the year page has 44px controls' + (small.length ? ` (too small: ${small})` : ''), small.length === 0);
say('the year page does not scroll sideways', await noSideways());

// ---------- the take-down: mark what broke ----------
const down = region('Take down');
await down.getByRole('checkbox', { name: 'String lights is down' }).click(); await wait(500);
await down.getByRole('checkbox', { name: 'String lights is back in its box' }).click(); await wait(500);
await down.getByRole('group', { name: 'How String lights is' }).getByRole('button', { name: 'Broke' }).click(); await wait(700);
await down.getByRole('checkbox', { name: 'Wreath is down' }).click(); await wait(500);
await down.getByRole('checkbox', { name: 'Wreath is back in its box' }).click(); await wait(500);
say('what broke is marked, and says it goes on next year\'s shopping list', /On next year's shopping list/.test(await down.innerText()) && (await down.getByRole('group', { name: 'How String lights is' }).getByRole('button', { name: 'Broke' }).getAttribute('aria-pressed')) === 'true');
await down.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -130)); await wait(200);
await down.screenshot({ path: `${shots}/holidays-take-down-375.png` });
if (extra) await down.screenshot({ path: `${extra}/holidays-take-down-375.png` });

// ---------- finishing the year starts the next from it ----------
await page.getByLabel('What should next year remember?').fill('Brine the turkey a day earlier.');
await page.getByRole('button', { name: 'Finish this year' }).click(); await wait(1500);
const after = (await send('GET', `/api/plans/holidays/${holiday.id}`));
say('finishing started next year on its own day, the fourth Thursday', after.years.length === 2 && after.years[0].day === day2);
await page.goto(base + `/plans/${after.years[0].plan_id}`); await wait(1500);
t = await text();
say('next year keeps the notes, the guests and the cards, none ticked', /Brine the turkey a day earlier/.test(t) && /Aunt June/.test(t) && /0 of 1 came/.test(t) && /Grandma/.test(t));
say('what broke is on the shopping list', /To buy for this year/.test(t) && /String lights/.test(t) && /broke last year/.test(t));
say('the countdown carried over with nothing ticked', /Put the 16 lb Turkey/.test(t) && !(await page.getByRole('checkbox', { name: 'Brine the turkey is done' }).isChecked()));
const up2 = region('Put up');
say("last year's photo of the mantel is on the put-up list", (await up2.getByRole('img', { name: `Mantel in ${year1}` }).count()) === 1 && /Last year/.test(await up2.innerText()));
say('nothing is put up yet this year', !(await up2.getByRole('checkbox', { name: 'Wreath is up' }).isChecked()));
await up2.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -130)); await wait(200);
await up2.screenshot({ path: `${shots}/holidays-put-up-375.png` });
if (extra) await up2.screenshot({ path: `${extra}/holidays-put-up-375.png` });
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(400);
await up2.screenshot({ path: `${shots}/holidays-put-up-dark-375.png` });
if (extra) await up2.screenshot({ path: `${extra}/holidays-put-up-dark-375.png` });
await page.evaluate(() => document.documentElement.classList.remove('dark')); await wait(300);
await shot('holidays-next-year-375', { fullPage: true });

// ---------- a yearly date on the calendar becomes a holiday ----------
await send('POST', '/api/calendar/events', { title: "Grandma's birthday", day: '1950-12-02', yearly: true });
await page.goto(base + '/plans/holidays'); await wait(1200);
await page.getByRole('button', { name: "Make Grandma's birthday a holiday" }).click(); await wait(1500);
say('a birthday becomes a holiday in one tap, with its age', /Grandma's birthday/.test(await text()) && /\d+ years/.test(await text()));
await page.goto(base + '/plans/holidays'); await wait(1000);
t = await text();
say('both holidays are listed, and the date is off the "from your calendar" list', /Thanksgiving/.test(t) && /Grandma's birthday/.test(t) && !/From your calendar/.test(t));

// ---------- the newer ways to find its day ----------
await page.getByRole('button', { name: '+ Add a holiday' }).click(); await wait(500);
await dialog.getByLabel('Name *').fill('Lantern night at the lake');
await dialog.getByLabel('Its day').selectOption('after'); await wait(300);
await pick('The first').selectOption('2');
await pick('on or after').selectOption('11');
await pick('Day').fill('2');
const smallAdd = await tooSmall([dialog.locator('form button'), dialog.locator('form select'), dialog.locator('form input:not([type=checkbox])')]);
say('the weekday-on-or-after form has 44px controls and no sideways scroll' + (smallAdd.length ? ` (too small: ${smallAdd})` : ''), smallAdd.length === 0 && await noSideways());
await shot('holidays-after-375');
await dialog.getByRole('button', { name: 'Add it' }).click(); await wait(1500);
const lantern = (await send('GET', '/api/plans/holidays')).find((h) => h.name === 'Lantern night at the lake');
const firstTuesday = (y) => { const d = new Date(y, 10, 2); while (d.getDay() !== 2) d.setDate(d.getDate() + 1); return iso(d); };
say('The first Tuesday on or after November 2 reads back and starts on that Tuesday', lantern.rule_words === 'The first Tuesday on or after November 2' && [firstTuesday(year1), firstTuesday(year1 + 1)].includes(lantern.years[0].day));
await page.goto(base + '/plans/holidays'); await wait(1000);
await page.getByRole('button', { name: '+ Add a holiday' }).click(); await wait(500);
await dialog.getByLabel('Name *').fill('Block party');
await dialog.getByLabel('Its day').selectOption('calendar'); await wait(900);
await pick('Calendar').selectOption('hebrew'); await wait(500);
await pick('Month').selectOption('Tevet');
await pick('Day').fill('10');
await pick('Comes back').selectOption('3');
await shot('holidays-calendar-375');
say('the other-calendar form says the day is worked out and can be moved', /worked out from the calendar/.test(await dialog.innerText()) && /move it on that year's plan/.test(await dialog.innerText()) && await noSideways());
await dialog.getByRole('button', { name: 'Add it' }).click(); await wait(1500);
const party = (await send('GET', '/api/plans/holidays')).find((h) => h.name === 'Block party');
say('Day 10 of Tevet on the Hebrew calendar, every 3 years, reads back', party.rule_words === 'Day 10 of Tevet on the Hebrew calendar, every 3 years' && party.rule.every === 3 && party.years.length === 1);
await page.goto(base + '/plans/holidays'); await wait(1000);

// ---------- "Given to you": nothing before the day, the gift after it ----------
say('nothing is given to you before the day, so there is no such part', !/Given to you/.test(await text()));
await page.route('**/api/plans/holidays/given-to-me', (route) => route.fulfill({ json: [{ holiday: 'Thanksgiving', year: 2020, day: '2020-11-26', idea: 'A pair of binoculars' }] }));
await page.goto(base + '/plans/holidays'); await wait(1000);
t = await text();
say('after the day the holidays page shows what you were given: ' + t.replace(/\s+/g, ' ').slice(0, 120), /Given to you/.test(t) && /A pair of binoculars/.test(t) && /Thanksgiving 2020/.test(t));
await page.goto(base + `/plans/holidays/${holiday.id}`); await wait(1000);
say('and the holiday opens its plan page, which shows it too', /\/plans\/\d+$/.test(page.url()) && /A pair of binoculars/.test(await text()));
await page.unroute('**/api/plans/holidays/given-to-me');

// ---------- wide screen, and nothing broke ----------
await page.setViewportSize({ width: 1280, height: 900 }); await wait(500);
await page.goto(base + `/plans/${after.years[0].plan_id}`); await wait(1200);
say('at 1280px the year page has no sideways scroll', await noSideways());
await page.setViewportSize({ width: 375, height: 812 });
say('no request failed' + (bad.length ? `: ${bad.join(' | ')}` : ''), bad.length === 0);
await browser.close();
