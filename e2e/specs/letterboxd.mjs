// Letterboxd files both ways and half-star ratings, on a 375px phone: a person picks a Letterboxd download (a zip, made here),
// sees the counts before anything is saved, brings it in, brings it in again and nothing is added; the lists, watched days,
// ratings and a review are there; the titles are not counted in the Collection; a star rating is set and shown; a list is
// made into a file for Letterboxd (only films); another person sees none of it. Pictures at 375px, light and dark, of the
// review screen and of a title with a 3.5-star rating.
import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8061';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

/** A zip of files, deflated, with the list at the end (the way Letterboxd's download is). */
function zip(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { path, text } of files) {
    const name = Buffer.from(path, 'utf8');
    const plain = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(plain);
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0); shared.writeUInt16LE(0x0800, 2); shared.writeUInt16LE(8, 4);
    shared.writeUInt32LE(crc32(plain), 10); shared.writeUInt32LE(packed.length, 14); shared.writeUInt32LE(plain.length, 18); shared.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), shared, name, packed]);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); shared.copy(entry, 6); entry.writeUInt32LE(offset, 42);
    directory.push(entry, name); parts.push(local); offset += local.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const REVIEW = 'Cold, grey and "quiet".\n\nThe second paragraph keeps its words.';
const download = zip([
  { path: 'letterboxd-someone/watched.csv', text: 'Date,Name,Year,Letterboxd URI\n2024-01-05,The Lantern Keepers,1971,https://boxd.it/aaa1\n2024-02-10,Salt Harbor,1988,https://boxd.it/bbb2\n2024-03-01,Quiet Orchard,2003,https://boxd.it/ccc3\n' },
  { path: 'letterboxd-someone/diary.csv', text: 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/e1,4.5,,,2024-01-05\n2024-02-11,Salt Harbor,1988,https://boxd.it/e2,3.5,,,2024-02-10\n2024-05-01,Salt Harbor,1988,https://boxd.it/e3,,Yes,,2024-04-30\n' },
  { path: 'letterboxd-someone/ratings.csv', text: 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/aaa1,4.5\n2024-02-11,Salt Harbor,1988,https://boxd.it/bbb2,3.5\n2024-03-02,Quiet Orchard,2003,https://boxd.it/ccc3,0.5\n' },
  { path: 'letterboxd-someone/reviews.csv', text: `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-02-11,Salt Harbor,1988,https://boxd.it/e2,3.5,,"${REVIEW.replaceAll('"', '""')}",,2024-02-10\n` },
  { path: 'letterboxd-someone/watchlist.csv', text: 'Date,Name,Year,Letterboxd URI\n2024-04-01,Marsh Lights,1994,https://boxd.it/ddd4\n2024-04-02,Paper Moons,2011,https://boxd.it/eee5\n' },
  { path: 'letterboxd-someone/lists/rainy-day-picks.csv', text: 'Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2024-06-01,Rainy Day Picks,,https://boxd.it/L1,Slow ones\n\nPosition,Name,Year,URL,Description\n2,Salt Harbor,1988,https://letterboxd.com/film/salt-harbor/,Second one\n1,Marsh Lights,1994,https://letterboxd.com/film/marsh-lights/,First one\n3,Glass Tide,1999,,\n' },
  { path: 'letterboxd-someone/profile.csv', text: 'Date Joined,Username\n2020-01-01,someone\n' },
]);

const browser = await chromium.launch({ ...browserChoice, headless: true });
const phone = (look = 'light') => browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: look, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
const watch = (page, who) => {
  page.on('pageerror', (e) => check(`${who}: no page errors`, false, e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 404) check(`${who}: no failed request`, false, `${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
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
const short = (page) => page.locator('main button, main a, main select, main label').evaluateAll((els) => els.filter((e) => !e.closest('[data-demo-banner]') && !e.closest('label')?.querySelector('input.sr-only') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44 && e.tagName !== 'LABEL').map((e) => e.textContent.trim().slice(0, 30)));
const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
  const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}, [method, url, body]);

const context = await phone();
const page = await context.newPage();
watch(page, 'boss');
await signIn(page, 'boss', true);
await api(page, 'POST', '/api/users', { username: 'ana', password: PASS });

// ---- pick the download: the review screen shows counts and nothing is saved ----
await page.goto(base + '/media/lists'); await wait(1000);
await page.getByRole('button', { name: 'From Letterboxd' }).click(); await wait(400);
await page.getByLabel('Letterboxd files').setInputFiles({ name: 'letterboxd-someone.zip', mimeType: 'application/zip', buffer: download });
await page.locator('[data-letterboxd-review]').waitFor({ timeout: 10000 });
let review = flat(await page.locator('[data-letterboxd-review]').innerText());
check('the review shows the film count', /6 films: 6 new, 0 already here/.test(review), review.slice(0, 120));
check('the review shows days, ratings, reviews and the watchlist', /4 days watched: 4 new/.test(review) && /3 ratings: 3 new/.test(review) && /1 review: 1 new/.test(review) && /2 films on your watchlist: 2 new/.test(review));
check('the review names the list, and says none is owned', /List Rainy Day Picks: 3 films, 3 new \(a new list\)/.test(review) && /you do not own them/.test(review));
check('the review says a film had no diary day, and what was left alone', /1 film has no day in your diary/.test(review) && /Left alone: .*profile\.csv/.test(review));
check('nothing is saved yet', (await api(page, 'GET', '/api/media/lists')).json.every((l) => l.count === 0));
check('the review screen does not scroll sideways', (await sideways(page)) <= 0);
check('review screen: every control is 44px tall or more', (await short(page)).length === 0, (await short(page)).join(' | '));
await page.locator('[data-letterboxd-in]').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/letterboxd-review-375-light.png`, fullPage: true });

// ---- bring it in ----
await page.getByRole('button', { name: 'Bring it in' }).click(); await wait(1500);
const done = flat(await page.locator('[data-letterboxd-done]').innerText());
check('it says what came in', /6 new films, 4 days watched, 3 ratings, 1 review, 1 new list/.test(done), done);
check('the Collection stays empty: nothing is owned', (await api(page, 'GET', '/api/media')).json.length === 0);
const own = (await api(page, 'POST', '/api/media', { type: 'film', title: 'A Film I Own', year: 1990 })).json;
await api(page, 'POST', `/api/media/${own.id}/copies`, { format: 'DVD' });
const own2 = (await api(page, 'POST', '/api/media', { type: 'book', title: 'A Book I Own' })).json;
await api(page, 'POST', `/api/media/${own2.id}/copies`, { format: 'Paperback' });
await page.goto(base + '/media'); await wait(1200);
check('the Collection page has a sort by rating', (await page.locator('select option', { hasText: 'My rating, highest first' }).count()) > 0);

// ---- bring it in again: nothing is added ----
await page.goto(base + '/media/lists'); await wait(1000);
await page.getByRole('button', { name: 'From Letterboxd' }).click(); await wait(400);
await page.getByLabel('Letterboxd files').setInputFiles({ name: 'letterboxd-someone.zip', mimeType: 'application/zip', buffer: download });
await page.locator('[data-letterboxd-review]').waitFor({ timeout: 10000 });
review = flat(await page.locator('[data-letterboxd-review]').innerText());
check('the same download again: nothing is new', /6 films: 0 new, 6 already here/.test(review) && /3 days watched: 0 new/.test(review) && /2 films on your watchlist: 0 new, 2 already/.test(review), review.slice(0, 200));
await page.getByRole('button', { name: 'Cancel' }).click(); await wait(300);

// ---- the lists ----
await page.goto(base + '/media/lists'); await wait(1000);
const names = flat(await page.locator('main').innerText());
check('Rainy Day Picks and To watch are on the Lists tab', /Rainy Day Picks\s+3 titles/.test(names) && /To watch, read or hear\s+2 titles/.test(names), names.slice(0, 200));
await page.getByRole('link', { name: /^Rainy Day Picks/ }).click(); await wait(1000);
const order = await page.locator('[data-entry] a').evaluateAll((els) => els.map((e) => e.textContent.trim()));
check('the list is in the same order as on Letterboxd', JSON.stringify(order) === JSON.stringify(['Marsh Lights', 'Salt Harbor', 'Glass Tide']), order.join(' | '));
check('a list entry shows its stars', flat(await page.locator('main').innerText()).includes('★★★½'));
check('the list does not scroll sideways', (await sideways(page)) <= 0);

// ---- the file for Letterboxd: films only ----
await api(page, 'POST', `/api/media/lists/${page.url().split('/').pop()}/titles`, { type: 'book', title: 'A Book Not A Film' });
await page.reload(); await wait(1000);
const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Make a Letterboxd file' }).click()]);
const csv = readFileSync(await file.path(), 'utf8');
check('the file is named for the list', file.suggestedFilename() === 'rainy-day-picks-for-letterboxd.csv', file.suggestedFilename());
check('the file has the right columns and only the films', csv.startsWith('LetterboxdURI,Title,Year,Directors,Rating,WatchedDate,Rewatch,Review') && csv.includes('Salt Harbor,1988,,3.5,2024-02-10') && csv.includes('Glass Tide') && !csv.includes('A Book Not A Film'));
check('the review is in the file word for word', csv.includes(REVIEW.replaceAll('"', '""')));
await wait(500);
const said = flat(await page.locator('[data-letterboxd-said]').innerText());
check('it says how many films were saved and how many were left out', /Saved 3 films as rainy-day-picks-for-letterboxd\.csv\. 1 other title was left out/.test(said), said);

// ---- sort by rating ----
await page.getByRole('button', { name: 'Sort by my rating' }).click(); await wait(500);
const byRating = await page.locator('[data-entry] a').evaluateAll((els) => els.map((e) => e.textContent.trim()));
check('sorting by my rating puts the rated film first and the unrated last', byRating[0] === 'Salt Harbor' && byRating.at(-1) !== 'Salt Harbor', byRating.join(' | '));

// ---- a title with a 3.5-star rating ----
await page.getByRole('link', { name: 'Salt Harbor' }).first().click(); await wait(1200);
check('the title shows 3.5 stars as plain text', flat(await page.locator('[data-stars]').innerText()).startsWith('★★★½'));
const select = page.getByLabel('Your rating');
check('the rating choices run from not rated to 5 stars in halves', (await select.locator('option').count()) === 11 && (await select.locator('option').nth(1).innerText()) === '½ star');
await select.focus();
await page.keyboard.press('ArrowDown'); await wait(800);
check('the keyboard changes the rating', (await api(page, 'GET', `/api/media/${page.url().split('/').pop()}`)).json.stars === 4);
await select.selectOption('3.5'); await wait(800);
check('3.5 is kept', (await api(page, 'GET', `/api/media/${page.url().split('/').pop()}`)).json.stars === 3.5);
const body = flat(await page.locator('main').innerText());
check('the review is on the title as that day\'s note, and the Letterboxd link is there', body.includes('Cold, grey and "quiet".') && body.includes('The second paragraph keeps its words.') && body.includes('2024-02-10') && (await page.getByRole('link', { name: 'On Letterboxd' }).count()) === 1);
check('the title page does not scroll sideways', (await sideways(page)) <= 0);
check('title page: the rating controls are 44px tall or more', (await page.locator('[data-rating] select').evaluate((e) => e.getBoundingClientRect().height)) >= 44);
const titleAddress = page.url();
await page.screenshot({ path: `${shots}/title-3-5-stars-375-light.png`, fullPage: true });

// ---- another person sees none of it ----
const anaContext = await phone('dark');
const ana = await anaContext.newPage();
watch(ana, 'ana');
await signIn(ana, 'ana', false);
const id = titleAddress.split('/').pop();
check('another person cannot see the title or its rating', (await api(ana, 'GET', `/api/media/${id}`)).status === 404 && (await api(ana, 'PUT', `/api/media/${id}/stars`, { stars: 1 })).status === 404);
const theirs = (await api(ana, 'GET', '/api/media/lists')).json.map((l) => l.name);
check('another person sees none of the lists', JSON.stringify(theirs) === JSON.stringify(['Wanted', 'To watch, read or hear']), theirs.join(' | '));

// ---- dark pictures: the same person, in a dark window ----
const darkContext = await phone('dark');
const dark = await darkContext.newPage();
watch(dark, 'boss dark');
await signIn(dark, 'boss', false);
await dark.goto(titleAddress); await wait(1200);
await dark.screenshot({ path: `${shots}/title-3-5-stars-375-dark.png`, fullPage: true });
await dark.goto(base + '/media/lists'); await wait(1000);
await dark.getByRole('button', { name: 'From Letterboxd' }).click(); await wait(400);
await dark.getByLabel('Letterboxd files').setInputFiles({ name: 'letterboxd-someone.zip', mimeType: 'application/zip', buffer: download });
await dark.locator('[data-letterboxd-review]').waitFor({ timeout: 10000 });
await dark.locator('[data-letterboxd-in]').scrollIntoViewIfNeeded();
await dark.screenshot({ path: `${shots}/letterboxd-review-375-dark.png`, fullPage: true });
check('dark: the review screen does not scroll sideways', (await sideways(dark)) <= 0);

await browser.close();
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
