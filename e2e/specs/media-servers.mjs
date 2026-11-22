import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
const bad = [];
const expected400 = [];
page.on('response', (r) => {
  if (!r.url().includes('/api/') || r.status() < 400) return;
  const line = `${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`;
  (r.status() === 400 && r.url().includes('/api/connections') ? expected400 : bad).push(line);
});
page.on('console', (m) => { if (m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const text = async () => page.locator('main').innerText();
const wait = (ms = 700) => page.waitForTimeout(ms);
const field = (label) => page.locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const flat = (s) => s.replace(/\n/g, ' ');

await page.goto(base + '/');
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click();
await wait(1000);
{ const skip = page.getByRole('dialog').getByRole('button', { name: 'Skip, show me everything' }); if (await skip.isVisible().catch(() => false)) { await skip.click(); await wait(900); } }

// A tape of Alien, typed in by hand first.
await page.getByRole('link', { name: 'entertaining' }).click(); await wait();
await page.getByRole('button', { name: '+ Add' }).click();
await field('Title').fill('Alien'); await field('Year').fill('1979'); await page.getByPlaceholder('VHS, DVD, Blu-ray').fill('VHS');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);

await page.getByRole('link', { name: 'Servers' }).first().click(); await wait();
say('the Servers page starts empty', /No servers connected/.test(await text()));
await page.getByRole('button', { name: '+ Connect a server' }).click();
await field('Its address').fill('http://127.0.0.1:8097');
await field('A key').fill('not-the-key');
await page.getByRole('button', { name: 'Connect', exact: true }).click(); await wait(1500);
say('a wrong key is refused in plain words: ' + (await page.getByRole('dialog').locator('p.text-red-600').innerText().catch(() => '')), /didn.t accept that key/.test(await page.getByRole('dialog').innerText()));
await field('A key').fill('trial-jellyfin-key');
await page.getByRole('button', { name: 'Connect', exact: true }).click(); await wait(1500);
let t = await text();
say('the right key connects, and the server names itself: ' + flat(t).slice(120, 330), /Trial media box/.test(t) && /Not synced yet/.test(t) && /every 6 hours/.test(t));
say('the key is nowhere on the page', !(await page.content()).includes('trial-jellyfin-key'));

await page.getByRole('button', { name: 'Sync now' }).click(); await wait(2500);
t = await text();
say('syncing says what it did: ' + flat(t).match(/In step:[^.]*\./)?.[0], /In step: 5 on Trial media box, 5 added, 3 covers kept\./.test(flat(t)) && /5 in the collection/.test(t));
await page.screenshot({ path: shots + '/servers.png' });

await page.getByRole('link', { name: 'Collection' }).first().click(); await wait(1200);
t = await text();
say('the library sits beside the tape, and Alien is one film with both: ' + flat(t).slice(0, 230), /Alien[\s\S]*VHS\s*Jellyfin/.test(t) && /Twin Peaks/.test(t) && /Joni Mitchell/.test(t) && /Everything 5/.test(flat(t)));
const covers = await page.locator('main img').evaluateAll((imgs) => imgs.map((img) => [img.getAttribute('src'), img.complete && img.naturalWidth > 0]));
say('covers are shown from Life Is itself: ' + JSON.stringify(covers), covers.length === 3 && covers.every(([src, loaded]) => src.startsWith('/api/media/') && loaded));
await page.screenshot({ path: shots + '/collection-with-server.png' });

await page.getByRole('link', { name: 'Servers' }).first().click(); await wait();
await page.getByRole('button', { name: 'Edit' }).click();
await page.getByLabel(/take what it brought in/).check();
await page.getByRole('button', { name: 'Disconnect' }).click(); await wait(1200);
await page.getByRole('link', { name: 'Collection' }).first().click(); await wait(1000);
t = await text();
say('disconnecting with its copies leaves only the tape: ' + flat(t).slice(0, 120), /Alien/.test(t) && /VHS/.test(t) && !/Jellyfin/.test(t) && !/Twin Peaks/.test(t));
console.log(expected400.length === 1 ? 'one refusal seen, the wrong key, as intended' : 'UNEXPECTED refusals: ' + expected400.join(' | '));
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no other failed requests, no page errors');
await browser.close();
