// The public website (docs/site), opened from the files themselves: the front page and guides fit a phone,
// every link between them leads somewhere, and the setup builder writes a file that matches the choices.
//   node docs/build-site.mjs && node e2e/site.mjs
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
// Pages opened from files cannot be granted the clipboard, so the page's clipboard is a recorder. A test can make it refuse.
await context.addInitScript(() => {
  window.__copied = [];
  window.__refuse = false;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => (window.__refuse ? Promise.reject(new Error('refused')) : (window.__copied.push(t), Promise.resolve())) } });
  const exec = document.execCommand ? document.execCommand.bind(document) : null;
  document.execCommand = (...a) => (window.__refuse && a[0] === 'copy' ? false : exec ? exec(...a) : false);
});
const page = await context.newPage();
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

// Copy buttons. The page's clipboard is a recorder (see above), so what was copied can be read back exactly.
const pressed = async (button) => {
  await page.evaluate(() => { window.__copied = []; });
  await button.click(); await page.waitForTimeout(80);
  return { copied: await page.evaluate(() => window.__copied[window.__copied.length - 1]), label: (await button.textContent()).trim() };
};
const contrastOK = (button) => button.evaluate((el) => {
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const s = getComputedStyle(el); const a = lum(s.color) + 0.05; const b = lum(s.backgroundColor) + 0.05;
  return Math.max(a, b) / Math.min(a, b) >= 4.5;
});
await page.setViewportSize({ width: 390, height: 844 });

// 1. Every guide that has a block of code: one real button per block, and it copies exactly that block.
const docsDir = path.join(site, 'docs');
const bad = [];
let blocks = 0; let blockPages = 0;
for (const f of readdirSync(docsDir).filter((n) => n.endsWith('.html') && n !== 'index.html')) {
  await page.goto(at(`docs/${f}`)); await page.waitForTimeout(100);
  const n = await page.locator('.code').count();
  if (!n) continue;
  blockPages += 1; blocks += n;
  if ((await page.locator('.code > button.copy').count()) !== n) { bad.push(`${f}: ${n} blocks, not one button each`); continue; }
  for (let i = 0; i < n; i += 1) {
    const button = page.locator('.code').nth(i).locator('> button.copy');
    const shown = await page.locator('.code').nth(i).locator('pre').textContent();
    const box = await button.boundingBox();
    const real = await button.evaluate((el) => el.tagName === 'BUTTON' && el.type === 'button' && /^Copy this \w+/.test(el.getAttribute('aria-label')));
    const got = await pressed(button);
    if (!real || box.height < 43.5 || got.copied !== shown || got.label !== 'Copied' || /^\$ |\n$/.test(got.copied)) bad.push(`${f} block ${i + 1}: ${JSON.stringify({ real, h: box?.height, label: got.label })}`);
  }
}
check(blocks ? `${blocks} code blocks on ${blockPages} guide pages each have a Copy button that copies exactly the block, says Copied, and is 44px tall` : 'no guide has a fenced code block yet (the fixture below covers the button)', bad.length === 0, bad.join('; '));

// 2. A page made of the same pieces, so the button is tested whatever the guides hold today.
const dir = mkdtempSync(path.join(tmpdir(), 'lifeis-copy-'));
const fixture = path.join(dir, 'blocks.html');
writeFileSync(fixture, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(path.join(docsDir, 'docs.css')).href}"></head><body><main>
<p>Run <code class="cmd" data-what="command">docker compose up -d</code> now, and not <code>this one</code>.</p>
<div class="code" data-what="command"><pre tabindex="0"><code>docker compose pull\ndocker compose up -d --remove-orphans --some-very-long-option-that-goes-past-the-edge-of-a-phone-screen-for-sure</code></pre></div>
<div class="code" data-what="file"><pre tabindex="0"><code>name: lifeis\nnote: "two &amp; three &lt;ok&gt;"</code></pre></div>
<script src="${pathToFileURL(path.join(docsDir, 'copy.js')).href}"></script></main></body></html>`);
await page.goto(pathToFileURL(fixture).href); await page.waitForTimeout(100);
check('a block gets one button, a command in a sentence gets one, other bits of code do not', (await page.locator('button.copy').count()) === 3 && (await page.locator('code:not(.cmd):not(pre code)').evaluateAll((l) => l.every((c) => !c.nextElementSibling))));
const blockButton = page.locator('.code').nth(1).locator('button.copy');
let got = await pressed(blockButton);
check('it copies the text as shown: no extra characters, "&" and "<" as typed', got.copied === 'name: lifeis\nnote: "two & three <ok>"' && got.label === 'Copied', JSON.stringify(got));
check('the word Copied is also announced to screen readers', (await page.locator('[role=status][aria-live=polite]').first().textContent()) === 'Copied');
await page.waitForTimeout(2300);
check('after two seconds it says Copy again', (await blockButton.textContent()).trim() === 'Copy');
got = await pressed(page.locator('p button.copy'));
check('a command in a sentence copies just the command', got.copied === 'docker compose up -d' && got.label === 'Copied', JSON.stringify(got));
await blockButton.focus();
await page.evaluate(() => { window.__copied = []; });
await page.keyboard.press('Enter'); await page.waitForTimeout(80);
check('the button can be used from the keyboard alone', (await page.evaluate(() => document.activeElement.className)) === 'copy' && (await page.evaluate(() => window.__copied.length)) === 1);
check('on a phone nothing is wider than the screen (the long command scrolls inside its own box)', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  const ok = [];
  for (const b of await page.locator('button.copy').all()) ok.push(await contrastOK(b));
  check(`the buttons can be read in ${scheme} colors`, ok.every(Boolean));
}
await page.emulateMedia({ colorScheme: 'light' });
await page.evaluate(() => { window.__refuse = true; });
await blockButton.click(); await page.waitForTimeout(80);
check('when the browser refuses, the text is selected and the button says to press Ctrl+C', (await blockButton.textContent()).trim() === 'Press Ctrl+C to copy' && (await page.evaluate(() => window.getSelection().toString().trim())) === 'name: lifeis\nnote: "two & three <ok>"');
await page.evaluate(() => { window.__refuse = false; });

// 3. The setup page: the file and the commands.
await page.goto(at('docs/install.html')); await page.waitForTimeout(400);
const composeButton = page.locator('#copy-compose');
got = await pressed(composeButton);
check('the setup file copies exactly as shown', got.copied === (await file()) && got.copied.includes('image: ghcr.io/') && got.label === 'Copied', got.label);
await page.getByLabel('Port on this computer').fill('9100');
await page.getByLabel('Other devices on my home network').check();
got = await pressed(composeButton);
check('after a change, it copies the new file', got.copied === (await file()) && got.copied.includes('- "9100:8008"'));
const cmd = page.locator('#steps code.cmd');
check('the step that says to run a command has one button, still there after a change', (await cmd.count()) === 1 && (await page.locator('#steps button.copy').count()) === 1);
got = await pressed(page.locator('#steps button.copy'));
check('the command copies exactly as shown', got.copied === (await cmd.textContent()) && got.copied === 'docker compose up -d' && got.label === 'Copied', JSON.stringify(got));
await page.evaluate(() => { window.__refuse = true; });
await composeButton.click(); await page.waitForTimeout(80);
check('the setup file is selected when copying is refused', (await composeButton.textContent()).trim() === 'Press Ctrl+C to copy' && (await page.locator('#compose').evaluate((t) => t.selectionStart === 0 && t.selectionEnd === t.value.length)));
await page.evaluate(() => { window.__refuse = false; });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByLabel('A web address of its own (https)').check();
await page.getByLabel(/The address, already pointing/).fill('a-very-long-name-for-a-home-computer.some-long-domain-name.example.com');
await page.waitForTimeout(100);
const heights = await page.locator('#copy-compose, #steps button.copy').evaluateAll((l) => l.map((b) => b.getBoundingClientRect().height));
check('on a phone the setup page is no wider than the screen, and its buttons are 44px tall', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) && heights.length >= 2 && heights.every((h) => h >= 43.5), heights.join(','));

// 4. With JavaScript off, the file is still there to read and select, and there is no button that does nothing.
const plain = await (await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })).newPage();
await plain.goto(at('docs/install.html'));
check('without JavaScript the file can be read and there is no dead Copy button', (await plain.locator('#compose').inputValue()).includes('image: ghcr.io/') && !(await plain.locator('#copy-compose').isVisible()) && (await plain.locator('button.copy:visible').count()) === 0);
await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
