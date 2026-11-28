import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
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
const later = (days) => iso(new Date(Date.now() + days * 86400000));
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const shot = async (name, options = {}) => { await page.screenshot({ path: `${shots}/${name}.png`, ...options }); };
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push(((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || 'a control')); } }
  return small;
};
const region = (name) => page.getByRole('region', { name, exact: true });

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// A family with a tent, and a plain plan for a camping weekend with only its Bring list to begin with.
await send('POST', '/api/things/kinds', { name: 'Camping gear', icon: null, fields: [] });
const camping = (await send('GET', '/api/things/kinds')).find((k) => k.name === 'Camping gear').id;
await send('POST', '/api/things/items', { kind_id: camping, name: 'Family tent' });
const tent = (await send('GET', '/api/things/items')).find((i) => i.name === 'Family tent');
const plan = await send('POST', '/api/plans', { name: 'Camping weekend', start_day: later(20), end_day: later(22), parts: ['bring'] });
await send('POST', `/api/plans/${plan.id}/items`, { kind: 'thing', ref_id: tent.id });
// A second plan with nothing on its Bring list, to see what After the trip says then.
const bare = await send('POST', '/api/plans', { name: 'Lake picnic', start_day: later(30), parts: ['bring', 'after_trip'] });

// ---------- checking the parts ----------
await page.goto(base + `/plans/${plan.id}`); await wait(1200);
let t = await text();
say('the plan starts with only its Bring list', /Bring list/.test(t) && !/Seasons|Harvest log|After the trip|Guests/.test(t));
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
for (const part of ['Guests', 'Cards', 'Gifts', 'Decorations', 'Seasons and licenses', 'Harvest log', 'After the trip']) await dialog.getByRole('checkbox', { name: part, exact: true }).check();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1500);
for (const name of ['Guests', 'Cards', 'Gifts', 'Put up', 'Seasons', 'Harvest log', 'After the trip']) say(`${name} shows on the plan`, await region(name).isVisible());

// ---------- one line in each ----------
await region('Guests').getByLabel('Guests: a name').fill('Cousin Jo');
await region('Guests').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await region('Cards').getByLabel('Cards: a name').fill('Grandma');
await region('Cards').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await region('Gifts').getByLabel('Who the gift is for, by name').fill('Hank');
await region('Gifts').getByLabel('The gift idea').fill('A lantern');
await region('Gifts').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await region('Put up').getByLabel('Where it goes').fill('Picnic table');
await region('Put up').getByLabel('What it is').fill('Paper lanterns');
await region('Put up').getByRole('button', { name: 'Add it' }).click(); await wait(800);
await region('Seasons').getByLabel('Season name').fill('Deer season');
await region('Seasons').getByLabel('Season for').selectOption('hunting');
await region('Seasons').locator('input[type=date]').first().fill(later(60));
await region('Seasons').getByRole('button', { name: 'Add the season' }).click(); await wait(800);
await region('Harvest log').getByLabel('Animal', { exact: true }).fill('Deer');
await region('Harvest log').getByLabel('Place, in words').fill('By the lake');
await region('Harvest log').getByRole('button', { name: 'Log the harvest' }).click(); await wait(800);
// These tick boxes follow what the server says, so they are clicked and then looked at.
await page.getByLabel('Family tent is back').click(); await wait(800);
await page.getByLabel('What Family tent needs after the trip').selectOption('dry'); await wait(800);
await page.getByLabel('Family tent is dry').click(); await wait(800);

t = await text();
say('the guest, the card and the gift are on the plan', /Cousin Jo/.test(t) && /Grandma/.test(t) && /A lantern/.test(t));
say('the decoration is on the plan', /Paper lanterns/.test(t) && /Picnic table/.test(t));
say('the season and the harvest are on the plan', /Deer season/.test(t) && /By the lake/.test(t));
say('the hunting license check says none is kept yet', /No hunting license is kept/.test(await region('License check').innerText()));
say('the tent is back, dry and done', await page.getByLabel('Family tent is back').isChecked() && (await page.getByLabel('What Family tent needs after the trip').inputValue()) === 'dry' && await page.getByLabel('Family tent is dry').isChecked());

// ---------- it all stays ----------
await page.reload(); await wait(1500);
t = await text();
say('after a reload every line is still there', ['Cousin Jo', 'Grandma', 'A lantern', 'Paper lanterns', 'Deer season', 'By the lake'].every((w) => t.includes(w)) && await page.getByLabel('Family tent is dry').isChecked());
const outdoor = await send('GET', `/api/plans/trips/outdoor/${plan.id}`);
say('the server has the season, the harvest line and the tent', outdoor.seasons.length === 1 && outdoor.harvest.length === 1 && outdoor.gear[0].returned && outdoor.gear[0].after_trip === 'dry' && outdoor.gear[0].after_done);
const people = await send('GET', `/api/plans/holidays/gathering/${plan.id}`);
say('the server has the guest, the card, the gift and the decoration', people.guests.length === 1 && people.cards.length === 1 && people.gifts.length === 1 && people.spots.length === 1);
await shot('plan-parts', { fullPage: true });

// ---------- taking a part off keeps what is in it ----------
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
await dialog.getByRole('checkbox', { name: 'Harvest log', exact: true }).uncheck();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
say('with Harvest log off it is hidden', (await region('Harvest log').count()) === 0);
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
await dialog.getByRole('checkbox', { name: 'Harvest log', exact: true }).check();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
say('with Harvest log back on, its line is still there', /By the lake/.test(await text()));

// ---------- controls and width ----------
// The controls of these parts (the rest of the plan page was there before and has its own checks).
const mine = ['Guests', 'Cards', 'Gifts', 'Put up', 'Seasons', 'License check', 'Harvest log', 'After the trip'].map(region);
const small = await tooSmall(mine.flatMap((r) => [r.locator('button, a'), r.locator('select'), r.locator('input:not([type=checkbox]):not([type=file])'), r.locator('label:has(input[type=checkbox])')]));
say('the plan has 44px controls' + (small.length ? ` (too small: ${small})` : ''), small.length === 0);
say('the plan does not scroll sideways', await noSideways());

// ---------- nothing on the Bring list ----------
await page.goto(base + `/plans/${bare.id}`); await wait(1200);
say('After the trip with an empty Bring list says to add things first', /Add things to the Bring list first/.test(await region('After the trip').innerText()));
const smallBare = await tooSmall([region('After the trip').locator('button, select, a')]);
say('the empty plan has 44px controls' + (smallBare.length ? ` (too small: ${smallBare})` : ''), smallBare.length === 0);
say('the empty plan does not scroll sideways', await noSideways());

// ---------- starting points ----------
await page.goto(base + '/plans'); await wait(1200);
await page.getByRole('button', { name: '+ New' }).click(); await wait(600);
const kinds = dialog.getByRole('group', { name: 'What kind of plan' });
say('a new plan offers four starting points, Something else picked', (await kinds.getByRole('radio').count()) === 4 && await kinds.getByRole('radio', { name: 'Something else' }).isChecked());
const smallKinds = await tooSmall([kinds.locator('label')]);
say('the starting points are 44px tall' + (smallKinds.length ? ` (too small: ${smallKinds})` : ''), smallKinds.length === 0);
await kinds.getByRole('radio', { name: 'A trip' }).check(); await wait(300);
say('A trip turns on More than one day and says what it starts with', await dialog.getByRole('checkbox', { name: 'More than one day' }).isChecked() && /Starts with: Food, Budget, More than one day, Bring list, After the trip/.test(await dialog.innerText()));
await kinds.getByRole('radio', { name: 'A birthday' }).check(); await wait(300);
say('A birthday turns More than one day back off', !(await dialog.getByRole('checkbox', { name: 'More than one day' }).isChecked()));
await dialog.getByLabel('What it is *').fill("Hank's birthday");
await shot('plan-starts');
say('the new plan form does not scroll sideways', await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1800);
say('a birthday starts with Guests and Gifts, and no Bring list', await region('Guests').isVisible() && await region('Gifts').isVisible() && !/Bring list/.test(await text()));

// ---------- a one-time plan comes back every year ----------
const cookout = await send('POST', '/api/plans', { name: 'Summer cookout', start_day: later(45), parts: ['food', 'guests'] });
await page.goto(base + `/plans/${cookout.id}`); await wait(1200);
say('a one-time plan is not yearly, and offers Do it again and Every year', !/Yearly/.test(await text()) && await page.getByRole('button', { name: 'Do it again' }).isVisible() && await page.getByRole('button', { name: 'Every year' }).isVisible());
await page.getByRole('button', { name: 'Every year' }).click(); await wait(600);
const smallYearly = await tooSmall([dialog.locator('form button'), dialog.locator('form select'), dialog.locator('form input:not([type=checkbox])')]);
say('the Every year form has 44px controls' + (smallYearly.length ? ` (too small: ${smallYearly})` : ''), smallYearly.length === 0);
say('the Every year form does not scroll sideways', await noSideways());
say('the Every year form offers the three ways to find its day, and the weeks ahead', (await dialog.getByLabel('Its day').locator('option').count()) === 5 && await dialog.getByLabel('Start planning this many weeks ahead').isVisible());
// The newer ways: a weekday on or after a date, a day on another calendar, and coming back every few years.
const smallNow = () => tooSmall([dialog.locator('form button'), dialog.locator('form select'), dialog.locator('form input:not([type=checkbox])')]);
await dialog.getByLabel('Its day').selectOption('after'); await wait(300);
const smallAfter = await smallNow();
say('A weekday on or after a date shows the weekday, month and day, at 44px, without scrolling sideways' + (smallAfter.length ? ` (too small: ${smallAfter})` : ''),
  await pick('The first').isVisible() && await pick('on or after').isVisible() && smallAfter.length === 0 && await noSideways());
await dialog.getByLabel('Its day').selectOption('calendar'); await wait(900);
const smallCal = await smallNow();
say('A date on another calendar lists the calendars and the months the platform names, with the plain line about moving the day',
  (await pick('Calendar').locator('option').allInnerTexts()).join() === 'Chinese,Hebrew,Islamic' && (await pick('Month').locator('option').count()) === 12
  && /worked out from the calendar/.test(await dialog.innerText()) && smallCal.length === 0 && await noSideways());
await pick('Calendar').selectOption('hebrew'); await wait(600);
say('picking the Hebrew calendar swaps in its months, with its leap Adar', (await pick('Month').locator('option').count()) === 13 && (await pick('Month').locator('option').allInnerTexts()).includes('Adar I (leap years)') && await noSideways());
say('there is no Hindu calendar', !/Hindu/.test(await dialog.innerText()));
const everyBox = pick('Comes back');
say('Comes back offers every year and every 2 to 10 years', (await everyBox.locator('option').count()) === 10 && (await smallNow()).length === 0);
await dialog.getByLabel('Its day').selectOption('fixed'); await wait(300);
await dialog.getByRole('button', { name: 'Make it yearly' }).click(); await wait(1800);
t = await text();
say('the plan says it is yearly, with its rule', /Yearly · /.test(t) && !(await page.getByRole('button', { name: 'Do it again' }).count()));
say('the server knows it as the first year of a yearly plan', (await send('GET', `/api/plans/${cookout.id}`)).yearly?.years.length === 1);
await shot('plan-yearly', { fullPage: true });
say('the yearly plan does not scroll sideways', await noSideways());
await page.getByRole('button', { name: 'Every year' }).click(); await wait(600);
const smallEdit = await tooSmall([dialog.locator('form button'), dialog.locator('form select'), dialog.locator('form input:not([type=checkbox])')]);
say('the form to change or stop it has 44px controls' + (smallEdit.length ? ` (too small: ${smallEdit})` : ''), smallEdit.length === 0);
page.once('dialog', (d) => d.accept());
await dialog.getByRole('button', { name: 'Stop coming back every year' }).click(); await wait(1800);
say('stopping it takes Yearly off, and brings Do it again back', !/Yearly/.test(await text()) && await page.getByRole('button', { name: 'Do it again' }).isVisible());
// A weekday on or after a date, every 5 years, reads back in plain words and starts on the right day.
await page.getByRole('button', { name: 'Every year' }).click(); await wait(600);
await dialog.getByLabel('Its day').selectOption('after'); await wait(300);
await pick('The first').selectOption('2');
await pick('on or after').selectOption('11');
await pick('Day').fill('2');
await pick('Comes back').selectOption('5');
await dialog.getByRole('button', { name: 'Make it yearly' }).click(); await wait(1800);
t = await text();
say('the plan reads back The first Tuesday on or after November 2, every 5 years', /The first Tuesday on or after November 2, every 5 years/.test(t) && !/Yearly · /.test(t));
const everyFive = (await send('GET', `/api/plans/${cookout.id}`)).yearly;
say('the server keeps it counted from the plan own year', everyFive?.rule.every === 5 && everyFive.rule.from === Number(cookout.start_day.slice(0, 4)));
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Every year' }).click(); await wait(600);
await dialog.getByRole('button', { name: 'Stop coming back every year' }).click(); await wait(1800);

// ---------- food on a plain plan ----------
const supper = await send('POST', '/api/plans', { name: 'Backyard supper', start_day: later(10), parts: ['food'] });
await page.goto(base + `/plans/${supper.id}`); await wait(1200);
const food = region('Food');
say('a plain plan has a Food card with a time and a choice of a meal or refreshments', await food.isVisible() && await food.getByLabel('Served at').isVisible() && (await food.getByLabel('A meal or refreshments').inputValue()) === 'meal');
say('with no time yet there is no countdown', (await region('Dinner countdown').count()) === 0);
await food.getByLabel('Served at').fill('18:00'); await food.getByLabel('Served at').blur(); await wait(1200);
await food.getByLabel('What is it').fill('Ham');
await food.getByLabel('Who brings it (if anyone)').fill('Aunt June');
await food.getByLabel('Frozen, in pounds (if it is)').fill('8');
await food.getByRole('button', { name: 'Add the food' }).click(); await wait(1500);
t = await food.innerText();
say('the line says who brings it and that it is frozen', /Ham/.test(t) && /Aunt June brings it/.test(t) && /8 lb, frozen/.test(t));
const count = region('Dinner countdown');
say('once a time is set the countdown has a step to thaw the ham', /Put the 8 lb Ham in the refrigerator to thaw/.test(await count.innerText()));
say('8 pounds thaws 2 days ahead', (await send('GET', `/api/plans/holidays/gathering/${supper.id}`)).countdown.steps[0].due_day === later(8));
await page.getByRole('checkbox', { name: 'Put the 8 lb Ham in the refrigerator to thaw is done' }).click(); await wait(800);
say('the thaw step can be ticked', await page.getByRole('checkbox', { name: 'Put the 8 lb Ham in the refrigerator to thaw is done' }).isChecked());
await food.getByRole('checkbox', { name: 'Ham is here' }).click(); await wait(900);
say('the line can be checked off when it is here', await food.getByRole('checkbox', { name: 'Ham is here' }).isChecked());
await page.reload(); await wait(1500);
say('after a reload the time, the line and its check are still there', (await region('Food').getByLabel('Served at').inputValue()) === '18:00' && await region('Food').getByRole('checkbox', { name: 'Ham is here' }).isChecked());
await region('Food').getByLabel('A meal or refreshments').selectOption('refreshments'); await wait(1200);
say('refreshments say served, not dinner', await region('Countdown').isVisible() && (await region('Countdown').getByLabel('When').locator('option').allInnerTexts()).includes('Hours before it is served'));
await region('Food').scrollIntoViewIfNeeded(); await wait(300);
const foodBox = await region('Food').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; });
await shot('plan-food', { fullPage: true, clip: foodBox });
const smallFood = await tooSmall([region('Food').locator('button'), region('Food').locator('select'), region('Food').locator('input:not([type=checkbox])'), region('Countdown').locator('button, select, input:not([type=checkbox])')]);
say('the Food card and countdown have 44px controls' + (smallFood.length ? ` (too small: ${smallFood})` : ''), smallFood.length === 0);
say('the food plan does not scroll sideways', await noSideways());

// ---------- a yearly date on the calendar opens as a plan ----------
const born = new Date(Date.now() + 40 * 86400000);
const kid = await send('POST', '/api/calendar/events', { title: "Mina's birthday", day: `${born.getFullYear() - 8}-${pad(born.getMonth() + 1)}-${pad(born.getDate())}`, yearly: true });
await page.goto(base + '/plans'); await wait(1200);
const dateLine = page.getByRole('link', { name: /Mina's birthday/ });
say('a calendar date with no plan shows as a small line on Plans', await dateLine.isVisible());
await dateLine.click(); await wait(1200);
t = await text();
say('the small line opens a plan page with the date, its age and the starting points', page.url().includes('/plans/date-') && /Mina's birthday/.test(t) && /turning 8/.test(t) && await region('Starting points').isVisible() && await region('Parts of this plan').isVisible());
say('looking saves nothing', (await send('GET', '/api/plans/holidays')).every((h) => h.name !== "Mina's birthday"));
say('the date page fits the phone with 44px controls', await noSideways() && (await tooSmall([region('Starting points').locator('button'), region('Parts of this plan').locator('label'), region('Something to do').locator('button, input')])).length === 0);
await region('Parts of this plan').getByRole('checkbox', { name: 'Gifts', exact: true }).click(); await wait(1800);
say('checking a part makes it a yearly plan and moves to its page', /\/plans\/\d+$/.test(page.url()) && /Gifts/.test(await text()) && /Yearly/.test(await text()));
say('the date is now a yearly plan whose plan has only that part', (await send('GET', '/api/plans/holidays')).some((h) => h.name === "Mina's birthday") && (await send('GET', page.url().replace(base, '/api'))).parts.join() === 'gifts');
await page.goto(base + '/plans/date-' + kid.id); await wait(1500);
say('opening the date again goes to the plan', /\/plans\/\d+$/.test(page.url()));

// ---------- traditions ----------
await page.goto(base + `/plans/${bare.id}`); await wait(1200);
say('a plan without the part has no Traditions card', (await region('Traditions').count()) === 0);
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
await dialog.getByRole('checkbox', { name: 'Traditions', exact: true }).check();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
const trad = region('Traditions');
say('checking the part shows a Traditions card', await trad.isVisible());
for (const words of ['Grandpa carves', 'Kids pick the movie', 'Everyone says one thing they are glad of']) {
  await trad.getByLabel('Something you always do').fill(words);
  await trad.getByRole('button', { name: 'Add', exact: true }).click(); await wait(700);
}
await wait(800);
say('three lines are added', (await trad.locator('[data-tradition]').count()) === 3);
await trad.getByLabel('Reword Kids pick the movie').fill('Kids pick the film');
await trad.getByLabel('Reword Kids pick the movie').blur(); await wait(900);
say('a line can be reworded', await trad.getByLabel('Reword Kids pick the film').isVisible());
await trad.getByRole('button', { name: 'Move Everyone says one thing they are glad of up' }).click(); await wait(900);
say('a line can be moved up', (await trad.locator('[data-tradition] input:not([type=checkbox])').first().inputValue()) === 'Grandpa carves' && (await trad.locator('[data-tradition] input:not([type=checkbox])').nth(1).inputValue()) === 'Everyone says one thing they are glad of');
await trad.getByRole('checkbox', { name: 'Grandpa carves is done' }).click(); await wait(800);
say('a line can be checked off', await trad.getByRole('checkbox', { name: 'Grandpa carves is done' }).isChecked() && /1 of 3/.test(await trad.innerText()));
await page.reload(); await wait(1400);
say('after a reload the order, the words and the check are kept', (await region('Traditions').locator('[data-tradition] input:not([type=checkbox])').nth(2).inputValue()) === 'Kids pick the film' && await region('Traditions').getByRole('checkbox', { name: 'Grandpa carves is done' }).isChecked());
const smallTrad = await tooSmall([region('Traditions').locator('button'), region('Traditions').locator('input:not([type=checkbox])')]);
say('the Traditions card has 44px controls and fits the phone' + (smallTrad.length ? ` (too small: ${smallTrad})` : ''), smallTrad.length === 0 && await noSideways());
await region('Traditions').getByRole('button', { name: 'Remove Kids pick the film' }).click(); await wait(800);
say('a line can be removed', (await region('Traditions').locator('[data-tradition]').count()) === 2);
const again = await send('POST', `/api/plans/${bare.id}/copy`, { start_day: later(400) });
say('doing the plan again carries the lines over unchecked', again.traditions.length === 2 && again.traditions.every((l) => !l.done));

// ---------- when and where ----------
await page.goto(base + `/plans/${bare.id}`); await wait(1200);
say('a plan without the part has no When and where card', (await region('When and where').count()) === 0);
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
await dialog.getByRole('checkbox', { name: 'When and where', exact: true }).check();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
const when = region('When and where');
say('checking the part shows the card', await when.isVisible());
await when.getByLabel('Starts at').fill('15:30'); await when.getByLabel('Starts at').blur(); await wait(1000);
await when.getByLabel('Ends at (if you know)').fill('18:00'); await when.getByLabel('Ends at (if you know)').blur(); await wait(1000);
await when.getByLabel('Where').fill("Aunt Ruth's back yard"); await when.getByLabel('Where').blur(); await wait(1000);
say('the plan page shows the times and the place', /15:30 to 18:00 · Aunt Ruth's back yard/.test(await text()));
await page.reload(); await wait(1400);
say('after a reload they are kept', (await region('When and where').getByLabel('Starts at').inputValue()) === '15:30' && (await region('When and where').getByLabel('Where').inputValue()) === "Aunt Ruth's back yard");
const smallWhen = await tooSmall([region('When and where').locator('input')]);
say('the card has 44px controls and fits the phone' + (smallWhen.length ? ` (too small: ${smallWhen})` : ''), smallWhen.length === 0 && await noSideways());
const dayOfBare = (await send('GET', `/api/plans/${bare.id}`)).start_day;
await page.goto(base + `/calendar?day=${dayOfBare}`); await wait(1200);
say('the calendar line for the plan shows its time and place', /15:30\s*Lake picnic\s*until 18:00 · Aunt Ruth's back yard/.test(await text()));

say('no request failed' + (bad.length ? `: ${bad.join(' | ')}` : ''), bad.length === 0);
await browser.close();
