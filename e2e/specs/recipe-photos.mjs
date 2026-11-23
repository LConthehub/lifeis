// A recipe's picture: added from the recipe's page with a small real image drawn in the page, seen on the
// recipe and in the list (at phone width too), changed, and taken away. (Pictures that come in with a Paprika
// file are checked in bring-in.mjs.)
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const bad = [];
// (This walk-through asks for a taken-away picture itself, to see it is gone: that one 404 is expected.)
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(r.status() === 404 && r.url().endsWith('/photo') && r.request().method() === 'GET' && r.request().resourceType() === 'fetch')) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const status = (address) => page.evaluate(async (a) => (await fetch(a)).status, address);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// A small real picture, drawn in the page.
const drawn = async (a, b) => Buffer.from(await page.evaluate(([from, to]) => {
  const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
  const ctx = canvas.getContext('2d'); const fill = ctx.createLinearGradient(0, 0, 240, 160); fill.addColorStop(0, from); fill.addColorStop(1, to);
  ctx.fillStyle = fill; ctx.fillRect(0, 0, 240, 160); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(120, 80, 40, 0, Math.PI * 2); ctx.fill();
  return canvas.toDataURL('image/png').split(',')[1];
}, [a, b]), 'base64');
const lemon = await drawn('#f4d35e', '#ee964b');
const green = await drawn('#2a9d8f', '#264653');

const pasta = await send('POST', '/api/kitchen/recipes', { title: 'Lemon Pasta', ingredients_text: '8 oz spaghetti\n1 lemon', steps_text: 'Boil.\n\nToss with lemon.', description: 'Bright and quick.' });
const toast = await send('POST', '/api/kitchen/recipes', { title: 'Plain Toast', ingredients_text: '1 slice bread' });

// ---- the recipe's page ----
await page.goto(`${base}/recipes/${pasta.id}`); await wait(1000);
check('a recipe with no picture offers a quiet "Add a picture" and shows none', await page.getByRole('button', { name: 'Add a picture' }).isVisible() && (await page.locator('main img').count()) === 0);
check('there is nothing to change or remove yet', (await page.getByRole('button', { name: 'Remove', exact: true }).count()) === 0 && (await page.getByRole('button', { name: 'Change the picture' }).count()) === 0);

// Not a picture: said in words, nothing kept.
await page.getByLabel('Choose or take a picture of the recipe').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is only some words, not a picture') }); await wait(1000);
check("a file that isn't a picture is refused in words", /couldn't be opened as a picture/.test(await page.locator('main').innerText()) && !(await send('GET', `/api/kitchen/recipes/${pasta.id}`)).has_photo);

await page.getByLabel('Choose or take a picture of the recipe').setInputFiles({ name: 'pasta.png', mimeType: 'image/png', buffer: lemon }); await wait(1500);
const shown = await page.locator('main img[src*="/photo"]').evaluate((img) => ({ ok: img.complete && img.naturalWidth > 0, alt: img.alt, loading: img.loading, w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height })).catch(() => null);
check("the picture shows on the recipe, with the recipe's name as its alt text, loaded lazily", shown && shown.ok && shown.alt === 'Lemon Pasta' && shown.loading === 'lazy', JSON.stringify(shown));
check('at a sensible size (not larger than the page, not tiny)', shown && shown.w >= 150 && shown.w <= 600 && shown.h >= 80 && shown.h <= 300, JSON.stringify(shown));
const above = await page.evaluate(() => { const img = document.querySelector('main img[src*="/photo"]'); const heading = [...document.querySelectorAll('main h2')].find((h) => h.textContent === 'Ingredients'); return img.getBoundingClientRect().bottom <= heading.getBoundingClientRect().top; });
check('it sits above the ingredients', above);
check('"Change the picture" and "Remove" now show, and "Add a picture" is gone', await page.getByRole('button', { name: 'Change the picture' }).isVisible() && await page.getByRole('button', { name: 'Remove', exact: true }).isVisible() && (await page.getByRole('button', { name: 'Add a picture' }).count()) === 0);
const kept = await page.evaluate(async (id) => { const r = await fetch(`/api/kitchen/recipes/${id}/photo`); return [r.status, r.headers.get('content-type'), r.headers.get('cache-control'), (await r.arrayBuffer()).byteLength]; }, pasta.id);
check('the server keeps it (made smaller, as a JPEG) and says the cache is private', kept[0] === 200 && kept[1] === 'image/jpeg' && kept[2] === 'private, max-age=60' && kept[3] > 100, JSON.stringify(kept));
check('the recipe still reads exactly as written', (await page.locator('main').innerText()).includes('8 oz spaghetti') && (await send('GET', `/api/kitchen/recipes/${pasta.id}`)).steps_text === 'Boil.\n\nToss with lemon.');
await page.screenshot({ path: shots + '/recipe-photo.png', fullPage: true });

// ---- the list ----
await page.goto(base + '/recipes'); await wait(1200);
const cards = await page.locator('main ul li a').evaluateAll((all) => all.map((a) => ({ title: a.querySelector('span.font-medium')?.textContent, img: a.querySelector('img') ? { alt: a.querySelector('img').alt, loading: a.querySelector('img').loading, w: Math.round(a.querySelector('img').getBoundingClientRect().width), h: Math.round(a.querySelector('img').getBoundingClientRect().height), ok: a.querySelector('img').complete && a.querySelector('img').naturalWidth > 0 } : null })));
const pastaCard = cards.find((c) => c.title === 'Lemon Pasta');
const toastCard = cards.find((c) => c.title === 'Plain Toast');
check('the list shows a small square picture beside the recipe that has one', pastaCard?.img && pastaCard.img.ok && pastaCard.img.w === pastaCard.img.h && pastaCard.img.w <= 80 && pastaCard.img.alt === 'Lemon Pasta' && pastaCard.img.loading === 'lazy', JSON.stringify(cards));
check('and keeps the current look for one without', toastCard && toastCard.img === null, JSON.stringify(cards));

// ---- at phone width ----
await page.setViewportSize({ width: 375, height: 812 });
await send('PUT', `/api/kitchen/recipes/${toast.id}/photo`, { data: green.toString('base64') });
await page.goto(base + '/recipes'); await wait(1200);
check('at 375px nothing scrolls sideways, and both pictures show', await page.evaluate(() => document.documentElement.scrollWidth <= 375 && document.body.scrollWidth <= 375) && (await page.locator('main ul li a img').count()) === 2);
await page.screenshot({ path: shots + '/recipe-list-phone.png', fullPage: true });
await page.goto(`${base}/recipes/${pasta.id}`); await wait(1200);
const small = await page.evaluate(() => [...document.querySelectorAll('[data-section="picture"] button')].map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
check('the picture controls are at least 44px tall at phone width' + (small.length ? ': ' + JSON.stringify(small) : ''), small.length === 0);
check('the recipe page does not scroll sideways at 375px', await page.evaluate(() => document.documentElement.scrollWidth <= 375));
await page.setViewportSize({ width: 1100, height: 1000 });

// ---- changing and removing it ----
const before = (await send('GET', `/api/kitchen/recipes/${pasta.id}`)).photo_added_at;
await wait(1100);
await page.getByLabel('Choose or take a picture of the recipe').setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: green }); await wait(1500);
const after = (await send('GET', `/api/kitchen/recipes/${pasta.id}`)).photo_added_at;
check('another picture takes the first one\'s place', before && after && before !== after && (await page.locator('main img[src*="/photo"]').count()) === 1);
await page.getByRole('button', { name: 'Remove', exact: true }).click(); await wait(1200);
check('"Remove" takes it away and "Add a picture" comes back', (await page.locator('main img').count()) === 0 && await page.getByRole('button', { name: 'Add a picture' }).isVisible());
check('it is gone from the server and the list', (await status(`/api/kitchen/recipes/${pasta.id}/photo`)) === 404 && !(await send('GET', '/api/kitchen/recipes')).find((r) => r.id === pasta.id).has_photo);
check('the other recipe keeps its own picture', (await status(`/api/kitchen/recipes/${toast.id}/photo`)) === 200);

if (bad.length) check('no failed requests or page errors', false, bad.join('; '));
await browser.close();
