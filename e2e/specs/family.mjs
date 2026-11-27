// Chores for someone without a sign-in: a child is added, given a chore, and collects points worth money.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: /Chores/ }).click(); await page.waitForTimeout(500);
const board = page.getByRole('region', { name: 'Chores this week' });
check('the chores view has a place for the household, before anyone has done anything', (await board.innerText()).includes('Nobody has done one yet') && (await board.innerText()).includes('without a sign-in of their own'));

await board.getByLabel('Their name').fill('Leo'); await board.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(800);
await board.getByLabel('Their name').fill('Mia'); await board.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(800);
check('children are added without a sign-in', (await board.getByRole('list', { name: 'In the household' }).innerText()).replace(/\s+/g, ' ').includes('Leo') && (await board.getByRole('list', { name: 'In the household' }).innerText()).includes('Mia'));
await board.getByLabel('Their name').fill('leo'); await board.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(800);
check('the same name twice is refused, in words', (await board.getByRole('alert').innerText()).includes('already in your household'));
await board.getByLabel('What a point is worth').fill('0.50'); await board.getByLabel('What a point is worth').blur(); await page.waitForTimeout(800);

// A chore of Leo's own.
await page.getByRole('button', { name: '+ New', exact: true }).click(); await page.waitForTimeout(500);
const form = page.getByRole('dialog');
await form.getByLabel('Its name *').fill('Tidy your room');
await form.getByLabel('Points for doing it').fill('4');
await form.getByLabel('How many').fill('1');
await form.getByLabel('Days, weeks, months or years').selectOption('week');
await form.getByLabel('Usually done by').selectOption({ label: 'Leo' });
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1500);
check('the chore says whose it is', (await page.locator('main').innerText()).includes('4 points'));
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
check('the list says who does it', (await page.locator('main').innerText()).includes('Leo does it'));

await page.getByRole('button', { name: 'Tidy your room done' }).click(); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Add details to Tidy your room' }).click(); await page.waitForTimeout(600);
const done = page.getByRole('dialog');
check('marking it done starts with the child whose chore it is', (await done.getByLabel('Who did it').evaluate((s) => s.options[s.selectedIndex].text)) === 'Leo');
await done.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(1200);
// Mia does it too, the next time it's marked.
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Tidy your room done' }).click(); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Add details to Tidy your room' }).click(); await page.waitForTimeout(600);
await page.getByRole('dialog').getByLabel('Who did it').selectOption({ label: 'Mia' });
await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(1200);

await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: /Chores/ }).click(); await page.waitForTimeout(600);
const scores = (await board.innerText()).replace(/\s+/g, ' ');
check('each child has their points, and what they are worth', /Leo 1 done 4 points · \$2\.00/.test(scores) && /Mia 1 done 4 points · \$2\.00/.test(scores), scores.slice(0, 200));
await page.screenshot({ path: `${shots}/family.png`, fullPage: true });

await page.getByRole('link', { name: /Tidy your room/ }).click(); await page.waitForTimeout(1000);
const times = (await page.getByRole('region', { name: 'Each time it was done' }).innerText()).replace(/\s+/g, ' ');
check('the chore remembers who did it each time', times.includes('Leo · 4 points') && times.includes('Mia · 4 points'), times);

// More chores, and a known set of things done, for the chart and the allowance.
const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const today = dayOf(now);
const lastMonth = dayOf(new Date(now.getFullYear(), now.getMonth() - 1, 15));
await page.evaluate(async ([today, lastMonth]) => {
  const send = (method, url, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const members = await fetch('/api/things/upkeep/members').then((r) => r.json());
  const id = (name) => members.find((m) => m.name === name).id;
  const dishes = await send('POST', '/api/things/upkeep', { name: 'Do the dishes after supper, including the pots and pans and wiping down the stove', kind: 'chore', points: 1, assigned_member: id('Mia'), every_n: 1, every_unit: 'day' });
  await send('POST', '/api/things/upkeep', { name: 'Water the plants', kind: 'chore', points: 2, every_n: 1, every_unit: 'week' });
  await send('POST', `/api/things/upkeep/${dishes.id}/done`, { day: today, by_member: id('Mia') });
  await send('POST', `/api/things/upkeep/${dishes.id}/done`, { day: today, by_member: id('Mia') });
  const room = (await fetch('/api/things/upkeep').then((r) => r.json())).find((j) => j.name === 'Tidy your room');
  await send('POST', `/api/things/upkeep/${room.id}/done`, { day: lastMonth, by_member: id('Leo') });
}, [today, lastMonth]);

// The allowance: Leo has 4 points this week and 4 last month, Mia 6 this week (4 and 2), at 50 cents a point.
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: /Chores/ }).click(); await page.waitForTimeout(800);
const allowance = page.getByRole('region', { name: 'Allowance' });
const child = async (name) => (await allowance.locator(`[data-child="${name}"]`).innerText()).replace(/\s+/g, ' ');
check('the chores view has an allowance summary for each child', await allowance.isVisible() && (await child('Leo')).includes('4 points = $2.00') && (await child('Mia')).includes('6 points = $3.00'), `${await child('Leo')} | ${await child('Mia')}`);
check('it says what is still to pay, and that nobody has been paid yet', (await child('Leo')).includes('Still to pay: 4 points = $2.00') && (await child('Leo')).includes('Not paid yet'), await child('Leo'));
await allowance.getByLabel('Period').selectOption({ label: 'This month' }); await page.waitForTimeout(700);
check('this month, the same', (await child('Leo')).includes('4 points = $2.00') && (await child('Mia')).includes('6 points = $3.00'), await child('Leo'));
await allowance.getByLabel('Period').selectOption({ label: 'Last month' }); await page.waitForTimeout(700);
check('last month is Leo\'s one chore, and Mia has none', (await child('Leo')).includes('4 points = $2.00') && (await child('Mia')).includes('0 points = $0.00') && (await child('Mia')).includes('Nothing to pay'), `${await child('Leo')} | ${await child('Mia')}`);
await allowance.getByLabel('Period').selectOption({ label: 'A range of days' }); await page.waitForTimeout(500);
await allowance.getByLabel('From').fill(lastMonth); await allowance.getByLabel('To').fill(lastMonth); await page.waitForTimeout(800);
check('a range of days adds up only those days', (await child('Leo')).includes('4 points = $2.00') && (await child('Mia')).includes('0 points'), await child('Leo'));
await allowance.getByLabel('Period').selectOption({ label: 'This week' }); await page.waitForTimeout(700);

await allowance.getByRole('button', { name: /Mark Leo as paid/ }).click(); await page.waitForTimeout(1200);
check('marking Leo as paid records the day, and everything up to it is paid', /Leo is marked as paid through/.test(await allowance.getByRole('status').innerText()) && (await child('Leo')).includes('Nothing to pay') && (await child('Leo')).includes('Paid through'), await child('Leo'));
const payments = (await allowance.getByRole('list', { name: 'Payments' }).innerText()).replace(/\s+/g, ' ');
check('a line says what was paid: this week and last month\'s are both Leo\'s', payments.includes('Leo was paid $4.00 for 8 points') && !payments.includes('Mia'), payments);
check('Mia is not paid by it', (await child('Mia')).includes('Still to pay: 6 points = $3.00'), await child('Mia'));
await allowance.getByRole('button', { name: /Undo the payment to Leo/ }).click(); await page.waitForTimeout(2000);
check('a payment can be taken back', (await child('Leo')).includes('Still to pay: 4 points = $2.00') && (await allowance.getByRole('list', { name: 'Payments' }).count()) === 0, (await allowance.innerText()).replace(/\s+/g, ' '));
await allowance.getByRole('button', { name: /Mark Leo as paid/ }).click(); await page.waitForTimeout(1200);
await allowance.getByLabel('Period').selectOption({ label: 'Last month' }); await page.waitForTimeout(700);
check('after a payment the next tally starts after it: last month shows paid', (await child('Leo')).includes('Nothing to pay') && (await child('Leo')).includes('4 points = $2.00'), await child('Leo'));
await allowance.getByLabel('Period').selectOption({ label: 'This week' }); await page.waitForTimeout(700);

await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(500);
await allowance.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/allowance-phone.png`, fullPage: true });
check('at phone width nothing scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
const short = await allowance.locator('button, select, input').evaluateAll((els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.getAttribute('aria-label') || e.innerText.slice(0, 20)));
check('the allowance controls are at least 44px tall', short.length === 0, short.join(' | '));

// The chore chart, from the household part of the chores view.
await page.setViewportSize({ width: 393, height: 852 });
await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: /Chores/ }).click(); await page.waitForTimeout(600);
await page.getByRole('link', { name: 'Print a chore chart' }).click(); await page.waitForTimeout(1500);
check('the household part links to the chore chart', /\/things\/upkeep\/chart$/.test(page.url()) && await page.getByRole('heading', { name: 'Chore chart', level: 1 }).isVisible(), page.url());
const tables = page.getByRole('table');
check('each person is a real table with headings, Leo, Mia and then anyone', (await tables.count()) === 3 && (await page.getByRole('columnheader', { name: 'Chore' }).count()) === 3 && (await page.getByRole('columnheader', { name: /^Sun/ }).count()) === 3, String(await tables.count()));
const long = 'Do the dishes after supper, including the pots and pans and wiping down the stove';
const boxes = (name) => page.locator('[data-chore="' + name + '"] [data-box]');
check('a daily chore has a box in each of the seven days', (await boxes(long).count()) === 7);
const room = await boxes('Tidy your room').evaluateAll((els) => els.map((e) => e.dataset.box));
check('a weekly chore has one box, on the day it falls due', room.length === 1 && room[0] === today, room.join());
const plants = await boxes('Water the plants').evaluateAll((els) => els.map((e) => e.dataset.box));
check('a weekly chore with no particular day has one box for the week', plants.length === 1 && plants[0] === 'week' && (await page.locator('[data-chore="Water the plants"]').innerText()).includes('any day this week'), plants.join());
const leoPart = (await page.locator('[data-part="Leo"]').innerText()).replace(/\s+/g, ' ');
check('a row shows its points, and a child\'s part ends with a line for the week\'s points and what they are worth', await page.locator('[data-chore="Tidy your room"] td').first().innerText() === '4' && leoPart.includes('Points this week:') && leoPart.includes('× $0.50 = $'), leoPart);
check('a long chore name is whole on the sheet', (await page.locator(`[data-chore="${long}"] th`).innerText()) === long);
const thisWeek = await page.locator('[data-sheet]').first().getAttribute('aria-label');

await page.getByRole('button', { name: 'Next week' }).click(); await page.waitForTimeout(1000);
const nextWeek = await page.locator('[data-sheet]').first().getAttribute('aria-label');
check('next week is one tap away and changes the days', nextWeek !== thisWeek && (await boxes(long).count()) === 7 && (await boxes('Tidy your room').count()) === 1, `${thisWeek} -> ${nextWeek}`);
const nextRoom = await boxes('Tidy your room').evaluateAll((els) => els.map((e) => e.dataset.box));
check('the weekly chore falls a week later', nextRoom[0] > today && new Date(`${nextRoom[0]}T12:00:00`).getDay() === new Date(`${today}T12:00:00`).getDay(), nextRoom.join());

await page.getByRole('button', { name: 'One page per child' }).click(); await page.waitForTimeout(600);
check('one page per child makes a sheet for each', (await page.locator('[data-sheet]').count()) === 3 && (await page.getByRole('heading', { name: "Leo's chore chart" }).isVisible()));
await page.getByRole('checkbox', { name: 'Mia' }).uncheck(); await page.waitForTimeout(500);
check('a child can be left out', (await page.locator('[data-sheet]').count()) === 2 && (await page.locator('[data-part="Mia"]').count()) === 0);
await page.getByRole('checkbox', { name: 'Mia' }).check();
await page.getByRole('button', { name: 'Everyone on one page' }).click(); await page.waitForTimeout(500);
check('everyone on one page is one sheet', (await page.locator('[data-sheet]').count()) === 1);

await page.getByLabel('Week starts on').selectOption('monday'); await page.waitForTimeout(800);
const monday = await page.locator('[data-sheet]').first().getAttribute('aria-label');
check('the week can start on Monday, and that is remembered on this device', monday.startsWith('Chore chart, Monday') && await page.evaluate(() => localStorage.getItem('lifeis.weekStartsOn')) === 'monday', monday);
await page.reload(); await page.waitForTimeout(1500);
check('and still Monday after a reload', (await page.getByLabel('Week starts on').inputValue()) === 'monday');
await page.getByLabel('Week starts on').selectOption('sunday'); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'This week' }).click(); await page.waitForTimeout(800);
check('weeks start on Sunday unless asked', (await page.locator('[data-sheet]').first().getAttribute('aria-label')).startsWith('Chore chart, Sunday'));

// On a phone: nothing scrolls sideways, and the choices are easy to press.
await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(500);
check('the chart at phone width does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
const small = await page.locator('main button, main select, main label').evaluateAll((els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && !e.closest('table')).map((e) => e.innerText.slice(0, 24)));
check('its controls are at least 44px tall', small.length === 0, small.join(' | '));

// Printed: the sheet alone.
await page.setViewportSize({ width: 1056, height: 816 });
await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(500);
const hidden = async (selector) => (await page.locator(`${selector}:visible`).count()) === 0;
check('printing hides the header and the tabs', await hidden('header') && await hidden('nav'), `${await page.locator('header:visible').count()} headers, ${await page.locator('nav:visible').count()} navs`);
check('printing hides every button, link and choice', await hidden('button') && await hidden('a') && await hidden('select') && await hidden('input'), `${await page.locator('button:visible, a:visible, select:visible, input:visible').count()} left`);
check('printing leaves the sheet, black on white', await page.locator('[data-sheet]').first().isVisible() && await page.locator('[data-sheet]').first().evaluate((el) => getComputedStyle(el).color === 'rgb(0, 0, 0)' && getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)'));
await page.screenshot({ path: `${shots}/chore-chart.png`, fullPage: true });
await page.emulateMedia({ media: null });
await browser.close();
