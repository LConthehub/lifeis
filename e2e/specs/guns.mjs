// Guns and ammunition, on a 375px phone: a person adds the Hunting and shooting set, a rifle with its serial number, a photo and
// some ammunition; the serial number stays hidden until tapped; nobody else (another member, the person in charge) sees any of
// it in Things, search, a sticker address, the Home page or the inventory; sharing the rifle with one person shows it to them
// only, read-only; the printable list has the person's own guns, and a gun sold stays in it. Pictures at 375px, light and dark,
// of the rifle's page and of the printable list.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8051';
const SERIAL = 'ZX-90417-Q';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
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
const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
  const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}, [method, url, body]);

// ---- the person in charge, and two other people ----
const chiefContext = await phone();
const chief = await chiefContext.newPage();
watch(chief, 'in charge');
await signIn(chief, 'boss', true);
for (const name of ['ana', 'bob']) await api(chief, 'POST', '/api/users', { username: name, password: PASS });

// ---- ana adds the set, a rifle and some ammunition ----
const anaContext = await phone();
const ana = await anaContext.newPage();
watch(ana, 'ana');
await signIn(ana, 'ana', false);
await ana.goto(base + '/things'); await wait(1200);
const section = ana.locator('section').filter({ has: ana.getByRole('heading', { name: 'Hunting and shooting' }) });
check('the Hunting and shooting set is listed, off until added', (await section.count()) > 0 && /Firearms/.test(await section.first().innerText()) && /private to you/i.test(await section.first().innerText()));
check('nothing is added before it is picked', (await api(ana, 'GET', '/api/things/kinds')).json.length === 0);
await section.first().getByRole('button', { name: 'Add' }).click(); await wait(1200);
await ana.getByRole('button', { name: '+ Add' }).click(); await wait(600);
let form = ana.getByRole('dialog');
await form.getByLabel('Kind of thing').selectOption({ index: (await form.getByLabel('Kind of thing').locator('option').allInnerTexts()).findIndex((t) => /Firearms/.test(t)) }); await wait(300);
await form.getByLabel('What *').fill('Deer rifle');
await form.getByLabel(/^Type/).selectOption('Rifle');
await form.getByLabel('Maker').fill('Ruger');
await form.getByLabel('Caliber or gauge').fill('.308 Win');
await form.getByLabel('Model', { exact: true }).fill('American');
await form.getByLabel('Serial number').fill(SERIAL);
await form.getByLabel('Bought on').fill('2040-11-02');
await form.getByLabel('Bought from').fill('Hill Sports');
await form.getByLabel('What it cost').fill('649.00');
await form.getByRole('button', { name: 'Save' }).click(); await wait(1800);
check('saving a gun opens its page', /\/things\/\d+$/.test(ana.url()), ana.url());
const rifleId = Number(ana.url().split('/').pop());
let main = await ana.locator('main').innerText();
check('the serial number is hidden on the gun\'s page', !main.includes(SERIAL) && /••••••••/.test(main));
await ana.getByRole('button', { name: 'Show' }).click(); await wait(300);
check('tapping Show shows the serial number', (await ana.locator('main').innerText()).includes(SERIAL));
await ana.getByRole('button', { name: 'Hide' }).click(); await wait(300);
check('tapping Hide hides it again', !(await ana.locator('main').innerText()).includes(SERIAL));
await ana.locator('input[type=file]').first().setInputFiles({ name: 'rifle.png', mimeType: 'image/png', buffer: PNG }); await wait(1800);
check('the photo is kept', (await api(ana, 'GET', `/api/things/items/${rifleId}`)).json.photo === true);
check('the page says who can see it: only her', /Only you\./.test(await ana.locator('main').innerText()));
check('no horizontal scroll on the gun\'s page', (await sideways(ana)) <= 0);
const showHeight = await ana.getByRole('button', { name: 'Show' }).evaluate((e) => e.getBoundingClientRect().height);
check('the Show button for the serial number is 44px or taller: ' + showHeight, showHeight >= 44);
await ana.screenshot({ path: `${shots}/guns-gun-375-light.png`, fullPage: true });
// Ammunition running low, by the web address (the form is the same one).
const kinds = (await api(ana, 'GET', '/api/things/kinds')).json;
const ammoKind = kinds.find((k) => k.name === 'Ammunition');
const caliberField = ammoKind.fields.find((f) => f.name === 'Caliber or gauge').id;
const ammo = (await api(ana, 'POST', '/api/things/items', { kind_id: ammoKind.id, name: 'Soft point 150 grain', quantity: 5, low_at: 10, values: { [caliberField]: '.308 Win' } })).json;

// ---- her own pages: the list has no serial, Home has a private card, the general search leaves it out ----
await ana.goto(base + '/things'); await wait(1200);
main = await ana.locator('main').innerText();
check('the Things page lists the gun and the ammunition, marked private, with no serial number', /Deer rifle/.test(main) && /Soft point/.test(main) && /Private to you/.test(main) && !main.includes(SERIAL));
check('the list data has no serial number', !(await api(ana, 'GET', '/api/things/items?guarded=1')).text.includes(SERIAL));
await ana.goto(base + '/'); await wait(1500);
main = await ana.locator('main').innerText();
check('her Home page has a private Ammunition running low card', /Ammunition running low/.test(main) && /Soft point 150 grain/.test(main) && /Only you see this/.test(main));
check('her Home page does not show the rifle, and the Things card does not count it', !/Deer rifle/.test(main));
check('the general search leaves guns out', (await api(ana, 'GET', '/api/search?q=rifle')).json.length === 0 && (await api(ana, 'GET', `/api/search?q=${SERIAL}`)).json.length === 0);
check('the home inventory leaves them out', !(await api(ana, 'GET', '/api/things/report')).text.includes('Deer rifle') && !(await api(ana, 'GET', '/api/things/report.csv')).text.includes(SERIAL));

// ---- nobody else sees any of it ----
const bobContext = await phone();
const bob = await bobContext.newPage();
watch(bob, 'bob');
await signIn(bob, 'bob', false);
async function sees(page, who) {
  for (const word of ['rifle', 'ruger', SERIAL, 'soft point', '.308']) {
    const found = (await api(page, 'GET', `/api/search?q=${encodeURIComponent(word)}`)).json;
    if (found.length) check(`${who}: search for ${word} finds nothing`, false, JSON.stringify(found));
  }
  const all = [(await api(page, 'GET', '/api/things/items?guarded=1')).text, (await api(page, 'GET', '/api/things/report')).text, (await api(page, 'GET', '/api/home')).text,
    (await api(page, 'GET', '/api/things/shared')).text, (await api(page, 'GET', '/api/things/guns')).text].join(' ');
  check(`${who}: no list, report, Home, shared list or guns list mentions it`, !/Deer rifle|Soft point|ZX-90417|Ruger/.test(all));
  const routes = [`/api/things/items/${rifleId}`, `/api/things/items/${rifleId}/photo`, `/api/things/items/${rifleId}/documents`, `/api/things/items/${rifleId}/history`, `/api/things/items/${rifleId}/sharing`,
    `/api/things/items/${ammo.id}`, `/api/things/shared/${rifleId}`, `/api/things/shared/${rifleId}/photo`];
  const codes = [];
  for (const url of routes) codes.push((await api(page, 'GET', url)).status);
  check(`${who}: every address for the rifle or the ammunition says not found: ${codes.join(' ')}`, codes.every((c) => c === 404));
  check(`${who}: a sticker for it cannot be printed`, (await api(page, 'POST', '/api/things/stickers', { ids: [rifleId] })).status === 404);
  check(`${who}: its page leads back to Things`, await (async () => { await page.goto(base + `/things/${rifleId}`); await wait(1200); return /\/things$/.test(page.url()); })());
  await page.goto(base + '/things'); await wait(1200);
  check(`${who}: the Things page shows none of it`, !/Deer rifle|Soft point|Private to you|Shared with you/.test(await page.locator('main').innerText()));
  await page.goto(base + '/'); await wait(1200);
  check(`${who}: Home shows none of it`, !/Deer rifle|Soft point|Ammunition running low/.test(await page.locator('main').innerText()));
}
await sees(bob, 'bob');
await sees(chief, 'the person in charge');

// ---- sharing with bob only ----
await ana.goto(base + `/things/${rifleId}`); await wait(1200);
const sharing = ana.getByRole('region', { name: 'Who can see this' }).or(ana.locator('[data-sharing]'));
check('her gun page offers the other people, and the person in charge is only one of them', /bob/.test(await sharing.first().innerText()) && /boss/.test(await sharing.first().innerText()));
await sharing.first().getByLabel('bob').click(); await wait(1200);
const mine = (await api(ana, 'GET', `/api/things/items/${rifleId}/sharing`)).json;
check('ticking bob keeps him on the list', mine.people.length === 1 && mine.choices.find((c) => c.id === mine.people[0])?.name === 'bob', JSON.stringify(mine));
check('sharing is kept and the page says who sees it', /You, and the people ticked below/.test(await ana.locator('main').innerText()));
await bob.goto(base + '/things'); await wait(1500);
const shared = bob.locator('[data-shared]');
check('bob sees a Shared with you card with the rifle, from ana', (await shared.count()) > 0 && /Deer rifle/.test(await shared.innerText()) && /from ana/.test(await shared.innerText()));
check('the shared list has no serial number', !(await shared.innerText()).includes(SERIAL) && !(await api(bob, 'GET', '/api/things/shared')).text.includes(SERIAL));
await shared.getByRole('link', { name: /Deer rifle/ }).click(); await wait(1500);
main = await bob.locator('main').innerText();
check('bob\'s page for it is read-only, says who shared it, and hides the serial until tapped', /ana shared this with you/.test(main) && !/Change|No longer have it|I used it/.test(main) && !main.includes(SERIAL));
await bob.getByRole('button', { name: 'Show' }).click(); await wait(300);
check('bob can tap to see the serial number and sees the model', (await bob.locator('main').innerText()).includes(SERIAL) && /American/.test(await bob.locator('main').innerText()));
check('bob sees its photo', await bob.locator('main img').count() > 0);
check('bob cannot change it', (await api(bob, 'PUT', `/api/things/items/${rifleId}`, { name: 'Mine' })).status === 404 && (await api(bob, 'GET', '/api/things/guns')).json.length === 0);
check('the ammunition was not shared with bob', (await api(bob, 'GET', `/api/things/shared/${ammo.id}`)).status === 404);
check('the person in charge still sees nothing of it', (await api(chief, 'GET', '/api/things/shared')).json.length === 0);
check('no horizontal scroll on the shared page', (await sideways(bob)) <= 0);
const smallShared = await short(bob);
check('every control on the shared page is 44px or taller: ' + smallShared.join(' | '), smallShared.length === 0);
await bob.screenshot({ path: `${shots}/guns-shared-375-light.png`, fullPage: true });

// ---- the printable list, with a gun sold ----
await api(ana, 'POST', '/api/things/items', { kind_id: kinds.find((k) => k.name === 'Firearms').id, name: 'Old shotgun', records: { serial: 'S-77', model: 'Pump' } });
const old = (await api(ana, 'GET', '/api/things/guns')).json.find((g) => g.name === 'Old shotgun');
await ana.goto(base + `/things/${old.id}`); await wait(1200);
await ana.getByRole('button', { name: 'No longer have it' }).click(); await wait(600);
const gone = ana.getByRole('dialog');
await gone.getByLabel('Sold for (dollars)').fill('250');
await gone.getByLabel(/Who to/).fill('A friend at the club');
await gone.getByRole('button', { name: 'Keep it' }).click(); await wait(1200);
check('a gun marked as gone keeps its record and its serial', (await api(ana, 'GET', '/api/things/guns')).json.some((g) => g.name === 'Old shotgun' && g.serial === 'S-77' && g.gone?.how === 'sold'));
await ana.goto(base + '/things'); await wait(1200);
await ana.getByRole('link', { name: 'List of guns' }).click(); await wait(1500);
main = await ana.locator('main').innerText();
check('the printable list has her rifle with its serial, maker, caliber, the day bought and the price', /Deer rifle/.test(main) && main.includes(SERIAL) && /Ruger/.test(main) && /\.308 Win/.test(main) && /November 2, 2040/.test(main) && /\$649\.00/.test(main));
check('the sold gun is under No longer owned, with its serial', /No longer owned[\s\S]*Old shotgun[\s\S]*S-77/.test(main) && /No longer have it: Sold/.test(main));
check('the list says it is not for other people\'s guns, and is made here', /not on it/.test(main) && /goes nowhere unless you send it/.test(main));
check('the list has no ammunition', !/Soft point/.test(main));
check('the list has the rifle\'s photo', (await ana.locator('[data-gun] img').count()) > 0);
check('no horizontal scroll on the list at 375px', (await sideways(ana)) <= 0);
const smallList = await short(ana);
check('every control on the list page is 44px or taller: ' + smallList.join(' | '), smallList.length === 0);
await ana.screenshot({ path: `${shots}/guns-list-375-light.png`, fullPage: true });
const bobList = await api(bob, 'GET', '/api/things/guns');
check('bob\'s own list is empty: the rifle shared with him is not his to list', bobList.json.length === 0);

// ---- dark pictures ----
for (const [file, url] of [['guns-gun-375-dark', `/things/${rifleId}`], ['guns-list-375-dark', '/things/guns/print']]) {
  const page = await anaContext.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(base + url); await wait(1800);
  check(`${file}: no horizontal scroll`, (await sideways(page)) <= 0);
  await page.screenshot({ path: `${shots}/${file}.png`, fullPage: true });
}
await browser.close();
