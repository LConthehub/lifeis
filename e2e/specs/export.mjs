// Download everything, and bring it back in: one person downloads a zip of their own, and a second, fresh account brings in recipes and things only, then the same file again to see nothing new. On a phone.
import { browserChoice } from '../browser.mjs';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8051';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const bad = [];
const elsewhere = [];
const say = (what, ok, extra = '') => console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || !extra ? '' : ' — ' + extra));
const wait = (page, ms = 700) => page.waitForTimeout(ms);
const watch = (page) => {
  page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.host !== new URL(base).host) elsewhere.push(u.host); });
  page.on('pageerror', (e) => bad.push('page error: ' + e.message));
};
const api = (page, method, address, body) => page.evaluate(async ([m, a, b]) => {
  const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return r.status === 204 ? null : r.json();
}, [method, address, body]);
// Set up for every part of Life Is, as if the person had already been welcomed.
const firstRun = async (page) => {
  await api(page, 'PUT', '/api/life', { areas: ['eating', 'planning', 'keeping', 'making', 'enjoying', 'spending'] });
  await page.reload(); await wait(page, 1000);
};
/** The files of a zip, read the way an unzipper does: the list at the end, then each file where the list says it is. */
function unzip(bytes) {
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('not a zip');
  const files = new Map();
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i += 1) {
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const rest = bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + packed);
    files.set(name, method === 0 ? body : inflateRawSync(body));
    at += 46 + nameLength + rest;
  }
  return files;
}

// ---------- the person whose data it is: some of several kinds ----------
const ana = await (await browser.newContext({ viewport: { width: 393, height: 852 }, acceptDownloads: true })).newPage();
watch(ana);
await ana.goto(base + '/'); await wait(ana, 1000);
await ana.getByRole('textbox').first().fill('ana');
await ana.locator('input[type=password]').fill(PASS);
await ana.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(ana, 2000);
await firstRun(ana);
await api(ana, 'POST', '/api/kitchen/recipes', { title: 'Leek soup', servings: 4, ingredients_text: '3 leeks\n1 lb potatoes', steps_text: 'Chop.\n\nSimmer.', tags: ['winter'], notes: 'Better tomorrow' });
await api(ana, 'POST', '/api/kitchen/recipes', { title: '=HYPERLINK("x")', ingredients_text: '1 egg', steps_text: 'Fry.', tags: [] });
const room = (await api(ana, 'POST', '/api/things/places', { name: 'Sewing room' })).find((p) => p.name === 'Sewing room');
const shelf = (await api(ana, 'POST', '/api/things/places', { name: 'Shelf 2', parent_id: room.id })).find((p) => p.name === 'Shelf 2');
const kind = (await api(ana, 'POST', '/api/things/kinds', { name: 'Fabric' })).find((k) => k.name === 'Fabric');
const thing = await api(ana, 'POST', '/api/things/items', { kind_id: kind.id, name: 'Blue linen', quantity: 3, unit: 'yd', place_id: shelf.id });
await api(ana, 'PUT', `/api/things/items/${thing.id}/photo`, { data: PNG.toString('base64') });
await api(ana, 'POST', '/api/things/pets', { name: 'Rex', species: 'Dog' });
await api(ana, 'POST', '/api/calendar/events', { title: 'Dentist', day: '2046-03-09' });
await api(ana, 'POST', '/api/users', { username: 'sam', password: PASS });

// ---------- downloading everything ----------
await ana.goto(base + '/settings/data'); await wait(ana, 1200);
let text = await ana.locator('main').innerText();
say('Settings, Your data, offers both, with what sets them apart', /Download everything/.test(text) && /Bring in from a download/.test(text) && /open files you can read anywhere/.test(text));
const [download] = await Promise.all([ana.waitForEvent('download', { timeout: 60000 }), ana.getByRole('button', { name: 'Download everything' }).click()]);
const file = shots + '/' + download.suggestedFilename();
await download.saveAs(file);
const zip = unzip(readFileSync(file));
say(`a zip with a dated name is handed over: ${download.suggestedFilename()}`, /^lifeis-everything-\d{4}-\d\d-\d\d\.zip$/.test(download.suggestedFilename()));
const readme = zip.get('README.txt')?.toString('utf8') ?? '';
const recipes = zip.get('recipes.csv')?.toString('utf8') ?? '';
say('it holds a README that says it was sent nowhere, and a recipes spreadsheet', /sent nowhere/.test(readme) && /BRINGING IT BACK/.test(readme) && recipes.startsWith('﻿Title,'));
say('with a known row, quoted properly', /Leek soup,,4,,,winter,"3 leeks\r?\n1 lb potatoes"/.test(recipes), recipes.slice(0, 300));
say('a spreadsheet cell that starts with = is made safe', recipes.includes(`'=HYPERLINK("x")`) || recipes.includes(`"'=HYPERLINK(""x"")"`), recipes.slice(0, 400));
say('the photo is in a folder named for the thing, and nobody else is in it', [...zip.keys()].some((n) => /^pictures\/things\/Blue-linen-\d+\.png$/.test(n)) && !/sam/i.test(readme));
say('the recipes are also in the open format', [...zip.keys()].some((n) => /^recipes-open-format\/Recipes\/.+\/recipe\.json$/.test(n)));

// ---------- a second, fresh account brings in recipes and things only ----------
const sam = await (await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true })).newPage();
watch(sam);
await sam.goto(base + '/'); await wait(sam, 1000);
await sam.getByRole('textbox').first().fill('sam');
await sam.locator('input[type=password]').fill(PASS);
await sam.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(sam, 2000);
await firstRun(sam);
say('the fresh account has no recipes and no things', (await api(sam, 'GET', '/api/kitchen/recipes')).length === 0 && (await api(sam, 'GET', '/api/things/items')).length === 0);
await sam.goto(base + '/settings/data'); await wait(sam, 1200);
await sam.getByLabel(/A download from Life Is/).setInputFiles(file); await wait(sam, 2500);
text = await sam.locator('main').innerText();
say('it shows what the file holds, per kind, with counts', /Recipes/.test(text) && /2 records: 2 new/.test(text) && /Things, with their photos and papers/.test(text) && /Pets/.test(text) && /Calendar events/.test(text), text.slice(0, 600));
say('and says nothing is overwritten or deleted', /ever overwritten or deleted/.test(text));
// Only recipes and things.
const only = async (page) => {
  for (const box of await page.getByRole('checkbox').all()) {
    const name = (await box.evaluate((e) => e.closest('label').innerText)) ?? '';
    if (/^(Recipes|Things)/.test(name)) await box.check(); else await box.uncheck();
  }
};
await only(sam);
await sam.screenshot({ path: shots + '/export-phone.png', fullPage: true });
const sideways = await sam.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const small = await sam.evaluate(() => [...document.querySelectorAll('main button, main label, main input[type=file]')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5 && !e.closest('nav')).map((e) => (e.innerText || e.tagName).slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().height)));
say('at 375 px wide nothing scrolls sideways', !sideways);
say('and every control is at least 44 px tall', small.filter((s) => /Download|Bring|Cancel|Recipes|Things|Pets|Places/.test(s)).length === 0, JSON.stringify(small));
await sam.getByRole('button', { name: /^Bring in 2 kinds$/ }).click(); await wait(sam, 3500);
text = await sam.locator('main').innerText();
say('it reports what came in, kind by kind', /Recipes: 2 added, 0 already here/.test(text) && /Things, with their photos and papers: 1 added, 0 already here/.test(text), text.slice(0, 700));
say('the pictures follow, and are counted', /Pictures and papers: 1 kept/.test(text), text.slice(0, 700));
const names = (await api(sam, 'GET', '/api/kitchen/recipes')).map((r) => r.title).sort();
const items = await api(sam, 'GET', '/api/things/items');
say('the recipes and the thing are there, the thing with its place and photo', names.includes('Leek soup') && items.length === 1 && items[0].name === 'Blue linen' && items[0].place === 'Sewing room › Shelf 2' && items[0].photo === true, JSON.stringify([names, items.map((i) => [i.name, i.place, i.photo])]));
await sam.goto(base + '/recipes'); await wait(sam, 1200);
say('and show on the recipes page', /Leek soup/.test(await sam.locator('main').innerText()));
say('what was not chosen did not come: no pets, no events', (await api(sam, 'GET', '/api/things/pets')).length === 0 && (await api(sam, 'GET', '/api/things/places')).length === 2);

// ---------- the same file again: nothing new ----------
await sam.goto(base + '/settings/data'); await wait(sam, 1200);
await sam.getByLabel(/A download from Life Is/).setInputFiles(file); await wait(sam, 2500);
text = await sam.locator('main').innerText();
say('the same file says it is already here', /2 records: 2 already here/.test(text) && /1 record: 1 already here/.test(text), text.slice(0, 500));
await only(sam);
await sam.getByRole('button', { name: /^Bring in 2 kinds$/ }).click(); await wait(sam, 2500);
text = await sam.locator('main').innerText();
say('bringing it in again adds nothing', /Recipes: 0 added, 2 already here/.test(text) && /Things, with their photos and papers: 0 added, 1 already here/.test(text) && /Nothing new/.test(text), text.slice(0, 500));
say('and the numbers did not change', (await api(sam, 'GET', '/api/kitchen/recipes')).length === 2 && (await api(sam, 'GET', '/api/things/items')).length === 1);
say('none of it asked anywhere else for anything: ' + JSON.stringify([...new Set(elsewhere)]), elsewhere.length === 0);
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
