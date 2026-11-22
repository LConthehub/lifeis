// The public website (docs/site), opened from the files themselves: the front page and guides fit a phone,
// every link between them leads somewhere, and the setup builder writes a file that matches the choices.
//   node docs/build-site.mjs && node e2e/site.mjs
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { browserChoice } from './browser.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'site');
const shots = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const at = (file) => pathToFileURL(path.join(site, file)).href;
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
const outside = new Set();
page.on('request', (r) => { if (/^https?:/.test(r.url())) outside.add(new URL(r.url()).host); });

// Every page fits a phone, and every link to another page of the site leads to a file that exists.
const pages = ['index.html', 'privacy.html', 'docs/index.html'];
const seen = new Set();
const broken = [];
const wide = [];
while (pages.length) {
  const file = pages.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  await page.goto(at(file)); await page.waitForTimeout(150);
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) wide.push(file);
  for (const href of await page.locator('a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')))) {
    if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
    let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), href.split('#')[0]));
    // The web server finds privacy.html for /privacy, and index.html for a folder.
    if (target.endsWith('/') || target === '.' || target === '') target = path.posix.join(target === '.' ? '' : target, 'index.html');
    else if (!path.posix.extname(target)) target = existsSync(path.join(site, `${target}.html`)) ? `${target}.html` : path.posix.join(target, 'index.html');
    if (!existsSync(path.join(site, target))) broken.push(`${file} → ${href}`);
    else if (target.endsWith('.html')) pages.push(target);
  }
}
check(`${seen.size} pages, none wider than a phone`, wide.length === 0, wide.join(', '));
check('every link between pages leads somewhere', broken.length === 0, broken.join('; '));
check('the site loads nothing from anywhere else', outside.size === 0, [...outside].join(', '));

// The setup builder.
await page.setViewportSize({ width: 1100, height: 900 });
await page.goto(at('docs/install.html')); await page.waitForTimeout(400);
const file = () => page.locator('#compose').inputValue();
let y = await file();
check('it starts with the simplest setup', y.includes('"127.0.0.1:8020:8008"') && y.includes('lifeis_data:/data') && y.includes('volumes:\n  lifeis_data:\n  lifeis_keys:') && !y.includes('caddy'));
await page.getByLabel('In folders I choose').check();
await page.getByLabel('Folder for your records').fill('D:\\My Files\\lifeis\\data\\');
await page.getByLabel('Folder for the keys').fill('D:\\My Files\\lifeis\\keys');
await page.getByLabel('Port on this computer').fill('9000');
await page.getByLabel(/Sign out after/).fill('0');
y = await file();
check('folders with spaces are quoted and written the way Docker wants', y.includes('- "D:/My Files/lifeis/data:/data"') && y.includes('- "D:/My Files/lifeis/keys:/keys"') && !/^volumes:/m.test(y), y.split('\n').filter((l) => l.includes(':/')).join(' | '));
check('the port and never signing out are in it', y.includes('"127.0.0.1:9000:8008"') && y.includes('SESSION_IDLE_MINUTES=0'));
check('the steps use the port chosen', (await page.locator('#steps').innerText()).includes('http://localhost:9000'));
await page.getByLabel('Other devices on my home network').check();
check('home network: it answers other devices', (await file()).includes('- "9000:8008"'));
await page.getByLabel('A web address of its own (https)').check();
await page.getByLabel(/The address, already pointing/).fill('https://Home.Example.com/anything');
await page.getByLabel(/I run Jellyfin/).check();
y = await file();
check('a web address adds the small web server, and Life Is answers this computer alone', y.includes('caddy reverse-proxy --from home.example.com --to lifeis:8008') && y.includes('"127.0.0.1:9000:8008"') && y.includes('- "443:443"') && y.includes('volumes:\n  caddy_data:'));
check('a media server on the same computer can be reached', y.includes('host.docker.internal:host-gateway'));
writeFileSync(path.join(shots, 'compose-from-builder.yml'), y);
check('the steps name the address', (await page.locator('#steps').innerText()).includes('https://home.example.com'));
await page.screenshot({ path: path.join(shots, 'site-install.png'), fullPage: true });
await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
