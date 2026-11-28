// A project's pictures, at phone width: two Idea pictures and one Mine added from files, shown in one row that
// scrolls sideways inside itself, one tapped to see it big with its caption (caption and Idea or Mine changed),
// one taken off, and a finished project showing its first Mine picture as its cover (page and list).
// The test pictures are plain flat colors drawn in the page.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const bad = [];
// (A refused upload and a look at a taken-off picture are made on purpose: that 400 and that 404 are expected.)
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(r.status() === 400 && r.request().method() === 'POST' && r.url().endsWith('/pictures')) && !(r.status() === 404 && r.request().method() === 'GET' && r.request().resourceType() === 'fetch' && /\/pictures\/\d+$/.test(r.url()))) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const status = (method, address, body) => page.evaluate(async ([m, a, b]) => (await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })).status, [method, address, body]);
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= 375 && document.body.scrollWidth <= 375);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// A small flat-color picture, drawn in the page.
const flat = async (color) => Buffer.from(await page.evaluate((c) => {
  const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = c; ctx.fillRect(0, 0, 240, 160);
  return canvas.toDataURL('image/png').split(',')[1];
}, color), 'base64');
const sand = await flat('#d9c7a0');
const sky = await flat('#8fb4d9');
const moss = await flat('#6d8f5e');
const clay = await flat('#b8735a');

const made = await send('POST', '/api/projects', { name: 'Bookshelf', activity: 'Woodwork', status: 'active' });
await page.goto(`${base}/projects/${made.id}`); await wait(1200);
check('a project with no pictures says so and offers to add one', (await page.locator('main').innerText()).includes('None yet') && await page.getByRole('button', { name: '+ Add a picture' }).isVisible());

// ---- adding from files: two ideas and one of my own ----
const addFromFiles = async (file, caption, kind) => {
  await page.getByRole('button', { name: '+ Add a picture' }).click(); await wait(400);
  if (kind === 'mine') await page.getByRole('radio', { name: /Mine/ }).click();
  if (caption) await page.getByLabel('A caption (you can leave it out)').fill(caption);
  await page.getByLabel('Choose pictures from your files').setInputFiles(file); await wait(1500);
};
await addFromFiles({ name: 'oak.png', mimeType: 'image/png', buffer: sand }, 'Oak shelves', 'idea');
await addFromFiles({ name: 'blue.png', mimeType: 'image/png', buffer: sky }, 'Painted blue', 'idea');
await addFromFiles({ name: 'mine.png', mimeType: 'image/png', buffer: moss }, 'My first shelf', 'mine');
let whole = await send('GET', `/api/projects/${made.id}`);
check('three pictures are kept, in the order added, as two Ideas and one Mine, with their captions',
  JSON.stringify(whole.pictures.map((p) => [p.kind, p.caption, p.source])) === JSON.stringify([['idea', 'Oak shelves', 'kept'], ['idea', 'Painted blue', 'kept'], ['mine', 'My first shelf', 'kept']]), JSON.stringify(whole.pictures));
check('the add dialog closed by itself and the row shows three pictures that loaded',
  (await page.getByRole('dialog').count()) === 0 && await page.evaluate(() => { const imgs = [...document.querySelectorAll('[data-testid="picture-row"] img')]; return imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0); }));
check('each picture says Idea or Mine', await page.evaluate(() => [...document.querySelectorAll('[data-testid="picture-row"] li span')].map((s) => s.textContent).join(',') === 'Idea,Idea,Mine'));
const refused = await status('POST', `/api/projects/${made.id}/pictures`, { data: Buffer.from('only some words, not a picture').toString('base64'), kind: 'idea' });
check('something that is not a picture is refused', refused === 400 && (await send('GET', `/api/projects/${made.id}`)).pictures.length === 3);
check('a picture must be an idea or mine', (await status('POST', `/api/projects/${made.id}/pictures`, { data: sand.toString('base64'), kind: 'other' })) === 400);

// ---- the row at 375px ----
// Two more are added by the address so the row has more than fits; they are taken off again below.
const extraA = (await send('POST', `/api/projects/${made.id}/pictures`, { data: clay.toString('base64'), kind: 'idea', caption: 'Extra one' })).pictures.at(-1);
const extraB = (await send('POST', `/api/projects/${made.id}/pictures`, { data: clay.toString('base64'), kind: 'idea', caption: 'Extra two' })).pictures.at(-1);
await page.reload(); await wait(1200);
const row = await page.evaluate(() => {
  const ul = document.querySelector('[data-testid="picture-row"]'); const r = ul.getBoundingClientRect();
  const heading = [...document.querySelectorAll('main h1')][0].getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), scrolls: ul.scrollWidth > ul.clientWidth, overflowX: getComputedStyle(ul).overflowX, top: Math.round(r.top), headingBottom: Math.round(heading.bottom), imgs: ul.querySelectorAll('img').length, flexRow: new Set([...ul.querySelectorAll('li')].map((li) => Math.round(li.getBoundingClientRect().top))).size };
});
check('the pictures sit in one row under the project name, inside the page width', row.top >= row.headingBottom && row.left >= 0 && row.right <= 375 && row.flexRow === 1, JSON.stringify(row));
check('the row scrolls sideways inside itself when there are more than fit', row.overflowX === 'auto' && row.scrolls, JSON.stringify(row));
check('the page itself does not scroll sideways at 375px', await noSideways());
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: shots + '/project-pictures-row-375.png' });
const small = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Pictures"] button')].map((b) => [b.getAttribute('aria-label') || b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
check('the picture buttons are at least 44px tall' + (small.length ? ': ' + JSON.stringify(small) : ''), small.length === 0);

// ---- one big, with its caption ----
await page.getByRole('button', { name: 'Idea: Oak shelves' }).click(); await wait(900);
const big = await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); const img = d.querySelector('img'); return { ok: img.complete && img.naturalWidth > 0, w: Math.round(img.getBoundingClientRect().width), caption: d.querySelector('[data-testid="picture-caption"]')?.textContent, over: d.scrollWidth > d.clientWidth }; });
check('a tap shows the picture big, with its caption', big.ok && big.w > 250 && big.caption === 'Oak shelves' && !big.over, JSON.stringify(big));
check('the page behind the dialog does not scroll sideways', await noSideways());
await page.screenshot({ path: shots + '/project-pictures-big-375.png' });
const dialogSmall = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].map((b) => [b.getAttribute('aria-label') || b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
check('the dialog buttons are at least 44px tall' + (dialogSmall.length ? ': ' + JSON.stringify(dialogSmall) : ''), dialogSmall.length === 0);

// Change the caption and switch it to Mine.
await page.getByRole('dialog').getByLabel('Caption', { exact: true }).fill('Oak, as a guide');
await page.getByRole('radio', { name: /Mine/ }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await wait(1000);
whole = await send('GET', `/api/projects/${made.id}`);
check('the caption and Idea or Mine can be changed', whole.pictures[0].caption === 'Oak, as a guide' && whole.pictures[0].kind === 'mine' && (await page.getByRole('dialog').count()) === 0, JSON.stringify(whole.pictures[0]));
check('the row shows the change', await page.getByRole('button', { name: 'Mine: Oak, as a guide' }).isVisible());
// ...and back, so the first Mine picture is the one made by hand.
await page.getByRole('button', { name: 'Mine: Oak, as a guide' }).click(); await wait(700);
await page.getByRole('radio', { name: /Idea/ }).click();
await page.getByRole('dialog').getByLabel('Caption', { exact: true }).fill('Oak shelves');
await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await wait(1000);

// Take one off.
await page.getByRole('button', { name: 'Idea: Extra one' }).click(); await wait(800);
await page.getByRole('button', { name: 'Delete this picture' }).click(); await wait(1000);
whole = await send('GET', `/api/projects/${made.id}`);
check('"Delete this picture" takes it off the project and away from the server', !whole.pictures.some((p) => p.id === extraA.id) && (await status('GET', `/api/projects/pictures/${extraA.id}`)) === 404);
await send('DELETE', `/api/projects/pictures/${extraB.id}`);
whole = await send('GET', `/api/projects/${made.id}`);
check('three pictures are left: two Ideas and one Mine, first of the Mine being the one made by hand', whole.pictures.length === 3 && whole.pictures.filter((p) => p.kind === 'mine').length === 1 && whole.pictures.find((p) => p.kind === 'mine').caption === 'My first shelf', JSON.stringify(whole.pictures));

// ---- the cover on a finished project ----
check('an unfinished project has no cover', whole.cover_picture === null && (await send('GET', '/api/projects')).find((p) => p.id === made.id).cover_picture === null);
await page.reload(); await wait(1000);
check('and none shows on its page', (await page.locator('[data-testid="project-cover"]').count()) === 0);
await send('PUT', `/api/projects/${made.id}`, { name: 'Bookshelf', activity: 'Woodwork', status: 'done' });
const mineFirst = (await send('GET', `/api/projects/${made.id}`)).pictures.find((p) => p.kind === 'mine').id;
check('once finished, its cover is the first Mine picture', (await send('GET', `/api/projects/${made.id}`)).cover_picture === mineFirst);
await page.reload(); await wait(1200);
const cover = await page.evaluate(() => { const i = document.querySelector('main [data-testid="project-cover"]'); return i ? { ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src'), w: Math.round(i.getBoundingClientRect().width) } : null; });
check("a finished project's page shows that picture as its cover", cover && cover.ok && cover.src.endsWith(`/pictures/${mineFirst}`) && cover.w > 250, JSON.stringify(cover));
check('the page does not scroll sideways with the cover', await noSideways());
await page.screenshot({ path: shots + '/project-pictures-cover-375.png' });
await page.goto(base + '/projects'); await wait(1200);
const listed = await page.evaluate(() => { const i = document.querySelector('main [data-testid="project-cover"]'); return i ? { ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src'), w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) } : null; });
check('the list of projects shows the cover beside the finished project', listed && listed.ok && listed.src.endsWith(`/pictures/${mineFirst}`) && listed.w === listed.h, JSON.stringify(listed));
check('the list does not scroll sideways', await noSideways());
await page.screenshot({ path: shots + '/project-pictures-list-375.png' });

// A project with only Ideas, once finished, has no cover.
const plain = await send('POST', '/api/projects', { name: 'Birdhouse', status: 'done' });
await send('POST', `/api/projects/${plain.id}/pictures`, { data: sky.toString('base64'), kind: 'idea', caption: 'Roof idea' });
check('a finished project with only Ideas has no cover', (await send('GET', `/api/projects/${plain.id}`)).cover_picture === null);

// ---- how it is served ----
check('the pictures can be asked for as pictures, privately', await page.evaluate(async (id) => { const r = await fetch(`/api/projects/pictures/${id}`); return r.status === 200 && ['image/png', 'image/jpeg'].includes(r.headers.get('content-type')) && r.headers.get('cache-control').startsWith('private'); }, mineFirst));

if (bad.length) check('no failed requests or page errors', false, bad.join('; '));
await browser.close();
