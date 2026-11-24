// Books kept elsewhere: a list brought in, book servers connected (against stand-ins), and a link on a copy.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const bad = [];
const expected400 = [];
page.on('response', (r) => {
  if (!r.url().includes('/api/') || r.status() < 400) return;
  const line = `${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`;
  (r.status() === 400 && /\/api\/(libraries|media\/copies)/.test(r.url()) ? expected400 : bad).push(line);
});
page.on('console', (m) => { if (m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const text = async () => page.locator('main').innerText();
const wait = (ms = 700) => page.waitForTimeout(ms);
const dialog = () => page.getByRole('dialog');
const field = (label) => dialog().locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const flat = (s) => s.replace(/\n/g, ' ');

await page.goto(base + '/');
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click();
await wait(1000);
{ const skip = dialog().getByRole('button', { name: 'Skip, show me everything' }); if (await skip.isVisible().catch(() => false)) { await skip.click(); await wait(900); } }

// ---- a list, for the libraries nothing can read ----
await page.locator('header button[aria-haspopup]').click(); await page.locator('nav[aria-label="Sections"]').getByRole('link', { name: 'fun', exact: true }).click(); await wait();
await page.getByRole('link', { name: 'eBooks' }).first().click(); await wait();
await page.getByRole('button', { name: 'Import a list' }).click();
await field('Or the list itself').fill('Title,Author,ISBN13,Exclusive Shelf,Date Read,Binding\n"Dune (Dune Chronicles, #1)",Frank Herbert,"=""9780441172719""",read,2024/03/05,Kindle Edition\nThe Left Hand of Darkness,Ursula K. Le Guin,,to-read,,Paperback\n"Piranesi",Susanna Clarke,,read,,Kindle Edition\n');
await dialog().getByRole('button', { name: 'Look it over' }).click(); await wait(900);
let d = flat(await dialog().innerText());
say('the list is looked over before anything is added: ' + d.match(/3 books found[^.]*\./)?.[0], /3 books found/.test(d) && /Dune \(Dune Chronicles, #1\), Frank Herbert · eBook/.test(d) && /The 1 on the to-read shelf/.test(d) && /1 have one/.test(d));
await field('They are on').selectOption('Kindle');
await dialog().getByRole('button', { name: 'Import 3' }).click(); await wait(1200);
d = flat(await dialog().innerText());
say('bringing it in says what happened: ' + d.match(/Imported:[^.]*\./)?.[0], /Imported: 3 new books, 1 wanted, 1 read on their day\./.test(d));
await dialog().getByRole('button', { name: 'Done' }).click(); await wait(900);
let t = await text();
say('the Kindle books are under eBooks, and the wanted one is not: ' + flat(t).slice(0, 200), /Dune/.test(t) && /Piranesi/.test(t) && /Kindle/.test(t) && !/Left Hand/.test(t));
await page.getByRole('link', { name: 'Books', exact: true }).first().click(); await wait(900);
say('the one on the to-read shelf is a book that is wanted', /The Left Hand of Darkness[\s\S]*wanted/.test(await text()));

// ---- a link on a copy ----
await page.getByRole('link', { name: 'eBooks' }).first().click(); await wait();
await page.getByRole('link', { name: /Dune/ }).first().click(); await wait(900);
say('the day the list said it was read is in its log', /2024-03-05/.test(await text()));
await page.getByRole('button', { name: /^Kindle/ }).first().click(); await wait();
await field('A link that opens it').fill('javascript:alert(1)');
await dialog().getByRole('button', { name: 'Save' }).click(); await wait(700);
say('something that is not a link is refused: ' + (await dialog().locator('p.text-red-600').innerText().catch(() => '')), /A link starts with https/.test(await dialog().innerText()));
await field('A link that opens it').fill('https://read.amazon.com/?asin=B00B7NPRY8');
await dialog().getByRole('button', { name: 'Save' }).click(); await wait(900);
const open = page.getByRole('link', { name: 'Open in Kindle' });
say('the copy opens in Kindle, in a new tab, telling the other site nothing', await open.getAttribute('href') === 'https://read.amazon.com/?asin=B00B7NPRY8' && await open.getAttribute('target') === '_blank' && /noreferrer/.test(await open.getAttribute('rel')));

// ---- book servers ----
await page.getByRole('link', { name: 'Servers' }).first().click(); await wait();
say('book servers start empty, and say what cannot be read', /No book servers connected/.test(await text()) && /Kindle, Apple Books and Google Play Books can't be read this way/.test(await text()));
const connect = async (kind, fill) => {
  await page.getByRole('button', { name: '+ Connect a book server' }).click();
  await field('What it is').selectOption(kind);
  await field('Its address').fill('http://127.0.0.1:8099');
  await fill();
  await dialog().getByRole('button', { name: 'Connect', exact: true }).click(); await wait(1500);
};
await connect('audiobookshelf', () => field('Its API token').fill('wrong-token'));
say('a wrong token is refused in plain words: ' + (await dialog().locator('p.text-red-600').innerText().catch(() => '')), /Audiobookshelf didn.t accept that sign-in/.test(await dialog().innerText()));
await field('Its API token').fill('trial-abs-token');
await dialog().getByRole('button', { name: 'Connect', exact: true }).click(); await wait(1500);
await connect('calibre-web', async () => { await field('Username').fill('reader'); await field('Password').fill('trial-calibre-pass'); });
await connect('kavita', () => field('Its API key').fill('trial-kavita-key'));
t = await text();
say('all three are connected: ' + flat(t).match(/Book servers[\s\S]*/)?.[0].slice(380, 620), /Audiobookshelf/.test(t) && /Calibre-Web/.test(t) && /Kavita/.test(t) && (t.match(/Not synced yet/g) ?? []).length === 3);
const content = await page.content();
say('no sign-in is anywhere on the page', !/trial-abs-token|trial-calibre-pass|trial-kavita-key/.test(content));
for (const [n, want] of [[0, /In step: 2 on Audiobookshelf, 2 added, 2 covers kept\./], [1, /In step: 3 on Calibre-Web, 3 added(, \d covers? kept)?\./], [2, /In step: 1 on Kavita, 1 added\./]]) {
  await page.getByRole('button', { name: 'Sync now' }).nth(n).click(); await wait(2500);
  const said = flat(await text()).match(/In step:[^.]*\./)?.[0];
  say('syncing says what it did: ' + said, want.test(said ?? ''));
}
await page.screenshot({ path: shots + '/book-servers.png', fullPage: true });

await page.getByRole('link', { name: 'Audiobooks' }).first().click(); await wait(1000);
t = await text();
say('audiobooks from Audiobookshelf are under Audiobooks: ' + flat(t).slice(0, 160), /Dune/.test(t) && /Project Hail Mary/.test(t) && !/Kindred/.test(t));
await page.getByRole('link', { name: 'eBooks' }).first().click(); await wait(1000);
t = await text();
say('eBooks holds the list and both servers, with Dune once: ' + flat(t).slice(0, 220), (t.match(/Frank Herbert/g) ?? []).length === 1 && /Kindred/.test(t) && /Emma/.test(t) && /Bone/.test(t) && /Piranesi/.test(t));
await page.screenshot({ path: shots + '/ebooks.png' });
await page.getByRole('link', { name: /Dune/ }).first().click(); await wait(900);
t = await text();
say('Dune is one book with three copies, each opening where it lives: ' + flat(t).match(/Your copies[\s\S]{0,260}/)?.[0],
  /Kindle/.test(t) && /Audiobook/.test(t) && /from Calibre-Web/.test(t) && /from Audiobookshelf/.test(t)
  && await page.getByRole('link', { name: 'Open in Calibre-Web' }).getAttribute('href') === 'http://127.0.0.1:8099/book/11'
  && await page.getByRole('link', { name: 'Open in Audiobookshelf' }).getAttribute('href') === 'http://127.0.0.1:8099/audiobookshelf/item/li_dune');
await page.screenshot({ path: shots + '/book-three-copies.png' });

// Narrow, like a phone: nothing runs off the side.
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('link', { name: 'Servers' }).first().click(); await wait(900);
say('the Servers page fits a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.setViewportSize({ width: 1100, height: 900 });

await page.getByRole('button', { name: 'Edit Calibre-Web' }).click();
await page.getByLabel(/take what it imported/).check();
await dialog().getByRole('button', { name: 'Disconnect' }).click(); await wait(1200);
await page.getByRole('link', { name: 'eBooks' }).first().click(); await wait(1000);
t = await text();
say('disconnecting Calibre-Web with its copies takes its books, and leaves Dune: ' + flat(t).slice(0, 160), /Dune/.test(t) && !/Kindred/.test(t) && !/Emma/.test(t) && /Bone/.test(t));
console.log(expected400.length === 2 ? 'two refusals seen, the bad link and the wrong token, as intended' : 'UNEXPECTED refusals: ' + expected400.join(' | '));
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no other failed requests, no page errors');
await browser.close();
