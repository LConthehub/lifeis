// The garden, at phone width: a plant in a bed, the Garden card on Home, watering done with one tap, rain counting as
// watered, a child's watering earning points, a harvest going to the pantry, and frost dates typed by hand (then
// worked out from the weather, with a stand-in for it). Needs the stand-in Open-Meteo (e2e/fixtures/openmeteo.mjs).
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8021';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const noSideways = async (what) => check(`${what} fits 375px wide with no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
const pad = (n) => String(n).padStart(2, '0');
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const weekday = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-US', { weekday: 'long' }); };

await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Sign in/ }).click(); await wait(1500);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: /Set up Life Is|Skip/ }).first().click(); await wait(1500); }

// The card is for people who check gardening.
await page.goto(base + '/'); await wait(1200);
check('no Garden card before gardening is checked', (await page.locator('[data-card=garden]').count()) === 0);
await send('PUT', '/api/life', { areas: ['eating', 'planning', 'keeping', 'making', 'enjoying', 'spending', 'gardening'] });
await page.goto(base + '/'); await wait(1500);
check('the Garden card shows once gardening is checked, asking for frost dates', (await page.locator('[data-card=garden]').count()) === 1 && /frost dates/.test(await page.locator('[data-card=garden]').innerText()));

// Frost dates, typed by hand, with the weather still off.
await send('POST', '/api/things/places', { name: 'Back bed' });
await page.goto(base + '/garden'); await wait(1200);
check('the Garden page says nothing is sent while the weather is off', /Nothing is sent anywhere/.test(await main()));
await page.getByLabel('Last spring frost').fill('2046-04-20');
await page.getByLabel('First fall frost').fill('2046-10-15');
await page.getByRole('button', { name: 'Save these dates' }).click(); await wait(1000);
let t = await main();
check('typed frost dates are kept and shown as April 20 and October 15', /Last spring frost \(April 20\)/.test(t) && /First fall frost \(October 15\)/.test(t) && /You typed these/.test(t), t.slice(0, 300));
await page.reload(); await wait(1200);
check('they are still there after reloading', /Last spring frost \(April 20\)/.test(await main()));

// A plant in a bed: a new place made right there.
await page.getByRole('button', { name: 'Add a plant' }).click(); await wait(500);
const form = page.getByRole('dialog');
await form.getByLabel('What is it?').selectOption({ label: 'Tomato' });
check('choosing Tomato fills the name, the kind and the usual watering', (await form.getByLabel('Its name').inputValue()) === 'Tomato' && (await form.getByLabel('Water every (days)').inputValue()) === '3');
await form.getByLabel('Its name').fill('Tomatoes');
await form.locator('select').nth(2).selectOption({ label: 'Back bed' });
await form.getByLabel('Planted on').fill(ago(10));
await form.getByRole('button', { name: 'Add the plant' }).click(); await wait(1200);
t = await main();
check('the plant is listed under Vegetables and herbs, in Back bed, due for water', /Vegetables and herbs[\s\S]*Tomatoes[\s\S]*Back bed/.test(t) && /Water now/.test(t), t.slice(0, 500));
const items = await send('GET', '/api/things/items');
check('the plant is an ordinary thing in the place', items.some((i) => i.name === 'Tomatoes' && i.place === 'Back bed' && i.kind === 'Vegetables and herbs'), JSON.stringify(items.map((i) => [i.name, i.place, i.kind])));
await noSideways('the Garden page');
await page.screenshot({ path: `${shots}/garden-page.png`, fullPage: true });

// The Home card: needs water, one tap.
await page.goto(base + '/'); await wait(1500);
const card = page.locator('[data-card=garden]');
t = (await card.innerText()).replace(/\s+/g, ' ');
check('the Garden card lists Tomatoes under Needs water', /needs water/i.test(t) && /Tomatoes/.test(t), t);
check('the card has a tip for the week from the typed frost dates, or says nothing is due', /this week|nothing to do in the garden this week|needs water/i.test(t));
await noSideways('the front page with the Garden card');
const tall = await card.getByRole('button', { name: /Done: water/ }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
check('the Done button is at least 44px tall', tall.length === 1 && tall[0] >= 44, tall.join(','));
await page.screenshot({ path: `${shots}/garden-card.png`, fullPage: true });
await card.getByRole('button', { name: 'Done: water Tomatoes' }).click(); await wait(1200);
t = (await page.locator('[data-card=garden]').innerText()).replace(/\s+/g, ' ');
check('one tap waters it: it leaves the list', !/needs water/i.test(t) && !/Tomatoes/.test(t), t);
const tomato = (await send('GET', '/api/garden')).plants.find((p) => p.name === 'Tomatoes');
check('it is watered today and next due in three days', tomato.water.last_done === ago(0) && tomato.water.due === false, JSON.stringify(tomato.water));

// Rain: the weather on (a stand-in answers), 0.7 inch three days ago. Outdoors counts it, indoors does not.
await send('PUT', '/api/weather', { name: 'Springfield', latitude: 37.2153, longitude: -93.2982, units: 'f' });
const collards = await send('POST', '/api/garden/plants', { name: 'Collards', planted_on: ago(10), water_every: 4 });
await send('POST', '/api/garden/plants', { name: 'Pothos', kind: 'house', planted_on: ago(10), water_every: 3 });
await page.goto(base + '/'); await wait(2200);
t = (await page.locator('[data-card=garden]').innerText()).replace(/\s+/g, ' ');
check('rain counts for the plant outdoors, and the card says why', new RegExp(`rain did it.*Collards.*Rain on ${weekday(3)}: 0\\.7 in`, 'i').test(t), t);
check('the houseplant is still due, rain or not', /needs water.*Pothos/i.test(t.split(/rain did it/i)[0]) && !/Collards/.test(t.split(/rain did it/i)[0]), t);
await page.screenshot({ path: `${shots}/garden-rain.png`, fullPage: true });

// A child's watering: given to Hank, with points; the tap goes to Hank.
await send('POST', '/api/things/upkeep/members', { name: 'Hank' });
const hank = (await send('GET', '/api/things/upkeep/members'))[0].id;
await send('POST', '/api/garden/plants', { name: 'Basil', planted_on: ago(10), water_every: 2, assigned_member: hank, points: 3 });
await page.goto(base + '/'); await wait(1800);
const picker = page.getByLabel('Who watered Basil');
check('a plant given to Hank offers Hank, with his points', (await picker.count()) === 1 && /Hank \(3 points\)/.test(await picker.innerText()));
await page.getByRole('button', { name: 'Done: water Basil' }).click(); await wait(1200);
const scores = await send('GET', '/api/things/upkeep/scores');
check('Hank earned the points for watering', scores.people.some((p) => p.name === 'Hank' && p.this_week === 3), JSON.stringify(scores.people));

// A harvest on a plant, put in the pantry.
await page.goto(`${base}/garden/${collards.id}`); await wait(1500);
await page.getByLabel('How much').fill('2');
await page.getByLabel('Unit').fill('lb');
await page.getByLabel('Put it in the pantry').check();
await page.getByRole('button', { name: 'Log the harvest' }).click(); await wait(1200);
t = await main();
check('the harvest is logged with a season total, and says it went to the pantry', /collards is in your pantry/.test(t) && new RegExp(`${new Date().getFullYear()}: 2 lb \\(1 time\\)`).test(t), t.slice(0, 600));
const pantry = await send('GET', '/api/kitchen/pantry');
check('the pantry has it', pantry.items.some((p) => p.name === 'collards' && p.quantity === 2 && p.unit === 'lb'), JSON.stringify(pantry.items.map((p) => [p.name, p.quantity])));
// How it did, and read again when it is planted again.
await page.locator('textarea[aria-label="How it did"]').fill('Slugs got the young leaves. Plant after the cool snap.');
await page.getByRole('button', { name: 'Save the note' }).click(); await wait(800);
await page.getByRole('button', { name: 'Planted today' }).click(); await wait(900);
check('planting again shows what was written last time', /Last time: Slugs got the young leaves/.test(await main()));
await noSideways('a plant page');
await page.screenshot({ path: `${shots}/garden-plant.png`, fullPage: true });

// Frost dates worked out from the weather: replaces the typed ones, and the page says what is sent.
await page.goto(base + '/garden'); await wait(1500);
t = await main();
check('with the weather on, the page says what working out the dates sends', /asks Open-Meteo for the lowest temperature of each day of the last ten years at Springfield/.test(t), t.slice(0, 400));
await page.getByRole('button', { name: 'Work them out from the weather' }).click(); await wait(1500);
t = await main();
check('the worked-out dates replace the typed ones (about April 12 and October 28)', /Last spring frost \(April 1[0-4]\)/.test(t) && /First fall frost \(October (2[6-9]|30)\)/.test(t) && /last ten years/.test(t), t.slice(0, 400));
await send('PUT', '/api/garden/frost', { last_spring: '04-20', first_fall: '10-15' });
await page.goto(base + '/'); await wait(1500);
check('frost dates keep the card from asking for them', !/Add your frost dates/.test(await page.locator('[data-card=garden]').innerText()));
await noSideways('the front page');
await browser.close();
