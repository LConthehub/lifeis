// Films and shows from TMDB, against a stand-in for it: turn it on with a key, look a film up by its title, choose
// it, see the fields and the poster, see the notice TMDB's terms ask for, and read the stand-in's own log to
// confirm that only the title, the year and the key were sent.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const KEY = 'tmdb-stand-in-read-access-token-0123456789';
const NOT_THE_KEY = 'a-wrong-key-that-tmdb-will-refuse-1234';
const stand = 'http://127.0.0.1:8101';
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const bad = [];
const expected400 = [];
page.on('response', (r) => {
  if (!r.url().includes('/api/') || r.status() < 400) return;
  const line = `${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`;
  (r.status() === 400 && r.url().includes('/api/lookups/films/test') ? expected400 : bad).push(line);
});
page.on('console', (m) => { if (m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const flat = (s) => s.replace(/\s+/g, ' ');

await page.goto(base + '/');
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click();
await wait(1000);
{ const skip = page.getByRole('dialog').getByRole('button', { name: 'Skip, show me everything' }); if (await skip.isVisible().catch(() => false)) { await skip.click(); await wait(900); } }

// ---- Settings: off, then on with a key
await page.goto(base + '/settings/connections'); await wait(1000);
const block = page.locator('[data-tmdb]');
await block.scrollIntoViewIfNeeded();
let t = flat(await block.innerText());
say('it starts off, says what it sends, and carries the notice: ' + t.slice(0, 120),
  /Off/.test(t) && /sent to themoviedb\.org with your own key; nothing else/.test(t) && /image\.tmdb\.org/.test(t) && /not endorsed, certified, or otherwise approved by TMDB/.test(t));
say('unchecked, the key field is hidden', (await block.locator('input[type=password]').count()) === 0);
await block.getByLabel('Turn on TMDB film lookups').click(); await wait(300);
say('Save and turn on needs a key first', await block.getByRole('button', { name: 'Save and turn on' }).isDisabled());
await block.locator('input[type=password]').fill(KEY);
await block.getByRole('button', { name: 'Save and turn on' }).click(); await wait(900);
t = flat(await block.innerText());
say('on with a key, and the field is empty again (the key is not shown): ' + t.slice(0, 60), /On/.test(t) && (await block.locator('input[type=password]').inputValue()) === '' && /one is saved/.test(t));
say('the key is nowhere on the page', !(await page.content()).includes(KEY));
await block.getByRole('button', { name: 'Test it' }).click(); await wait(900);
say('Test it: TMDB accepted the key', /TMDB accepted the key/.test(await block.innerText()));
// A wrong key is refused in plain words.
await block.locator('input[type=password]').fill(NOT_THE_KEY);
await block.getByRole('button', { name: 'Keep this key' }).click(); await wait(700);
await block.getByRole('button', { name: 'Test it' }).click(); await wait(900);
t = flat(await block.innerText());
say('a wrong key is refused plainly: ' + (t.match(/TMDB didn.t accept that key[^.]*\./)?.[0] ?? t.slice(-160)), /TMDB didn.t accept that key/.test(t));
await block.locator('input[type=password]').fill(KEY);
await block.getByRole('button', { name: 'Keep this key' }).click(); await wait(700);
await block.getByRole('button', { name: 'Test it' }).click(); await wait(900);
say('the right key again', /TMDB accepted the key/.test(await block.innerText()));
// Unchecking turns it off at once and keeps the key; Forget it removes the key after asking.
await block.getByLabel('Turn on TMDB film lookups').click(); await wait(800);
t = flat(await block.innerText());
say('unchecked: off, key hidden, kept for later with Forget it', /Off/.test(t) && /kept for later/.test(t) && (await block.locator('input[type=password]').count()) === 0 && await block.getByRole('button', { name: 'Forget it' }).isVisible());
await block.getByLabel('Turn on TMDB film lookups').click(); await wait(800);
say('checked again: on with the kept key, no typing', /On/.test(flat(await block.innerText())) && /one is saved/.test(flat(await block.innerText())));

// ---- The add form: look a film up by title and year
await page.goto(base + '/media'); await wait(900);
await page.getByRole('button', { name: '+ Add' }).click(); await wait(500);
const form = page.getByRole('dialog');
const field = (label) => form.locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
await field('Title').fill('Alien'); await field('Year').fill('1979'); await field('Director').fill('R. Scott');
await form.getByRole('button', { name: 'Look it up' }).click();
await form.locator('[data-matches] li').first().waitFor({ timeout: 10000 });
const matches = await form.locator('[data-matches] li').allInnerTexts();
say('the matches show the title and year: ' + flat(matches.join(' | ')), matches.length >= 1 && /Alien \(1979\)/.test(matches[0]));
await wait(500);
const thumbs = await form.locator('[data-matches] img').evaluateAll((imgs) => imgs.map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]));
say('the small poster comes from Life Is itself, and loaded: ' + JSON.stringify(thumbs), thumbs.length === 1 && thumbs[0][0].startsWith('/api/lookups/films/poster') && thumbs[0][1]);
await form.getByRole('button', { name: 'Use this' }).first().click(); await wait(1200);
const picked = flat(await form.locator('[data-picked]').innerText());
say('it fills what was empty, and keeps what was typed: ' + picked, /Filled in: length, genres, summary, poster\./.test(picked) && /Kept what you typed: director/.test(picked));
say('the fields: ' + [await field('Director').inputValue(), await field('Runs for').inputValue(), await field('Genres').inputValue()].join(' / '),
  (await field('Director').inputValue()) === 'R. Scott' && (await field('Runs for').inputValue()) === '117' && (await field('Genres').inputValue()) === 'Horror, Science Fiction');
say('the summary is filled in', /Nostromo/.test(await field("What it's about").inputValue()));
await form.getByRole('button', { name: 'Use all of it' }).click(); await wait(1200);
say('"Use all of it" takes the director too', (await field('Director').inputValue()) === 'Ridley Scott');
await form.locator('[data-film-finder]').scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + '/film-lookup.png' });
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForURL(/media\/[0-9]+/, { timeout: 15000 }).catch(() => {}); await wait(1200);

// ---- The film's own page
const id = page.url().match(/media\/(\d+)/)?.[1];
const main = flat(await page.locator('main').innerText());
say('the film page: ' + main.slice(0, 160), /Alien/.test(main) && /Ridley Scott/.test(main) && /1 h 57 min/.test(main) && /Nostromo/.test(main));
const cover = await page.locator('main img').first().evaluate((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]);
say('the poster is its cover, kept by Life Is: ' + JSON.stringify(cover), cover[0] === `/api/media/${id}/cover` && cover[1]);
const notice = flat(await page.locator('[data-tmdb-notice]').innerText());
say('the title page carries the notice: ' + notice, /Details from TMDB/.test(notice) && /not endorsed, certified, or otherwise approved by TMDB/.test(notice));
const ids = await page.evaluate(async (n) => (await fetch(`/api/media/${n}`)).json().then((m) => m.ids), id);
say('the TMDB number is kept in the title: ' + JSON.stringify(ids), ids.tmdb === '348' && ids.tmdb_kind === 'movie');

// ---- What the stand-in was sent
const log = await (await fetch(stand + '/log')).json();
const paths = log.map((r) => r.url.split('?')[0]);
say('only these were asked: ' + [...new Set(paths)].join(', '),
  paths.every((p) => ['/3/configuration', '/3/search/movie', '/3/movie/348', '/t/p/w92/alien-poster.jpg', '/t/p/w342/alien-poster.jpg'].includes(p)));
const search = log.filter((r) => r.url.startsWith('/3/search/movie'));
say('a search sent the title and the year: ' + search.map((r) => r.url).join(' ; '), search.length === 1 && search[0].url === '/3/search/movie?query=Alien&year=1979');
say('the details asked for the credits: ' + log.filter((r) => r.url.startsWith('/3/movie/')).map((r) => r.url).join(' ; '), log.filter((r) => r.url.startsWith('/3/movie/')).every((r) => r.url === '/3/movie/348?append_to_response=credits'));
const api = log.filter((r) => r.url.startsWith('/3/'));
say('every request carried the key as a header, never in the address, with no cookie and no referer',
  api.length >= 4 && api.every((r) => /^Bearer /.test(r.authorization ?? '') && !r.url.includes('api_key') && !r.url.includes(KEY) && r.cookie === null && r.referer === null));
const everything = JSON.stringify(log.map((r) => r.url));
say('nothing else about you was in any address (not the director typed, the account, or the notes)', !/Scott|trial|Ridley|note/i.test(everything.replace('/alien-poster', '')));
say('the poster for the cover was fetched once: ' + paths.filter((p) => p.includes('w342')).length, paths.filter((p) => p.includes('w342')).length === 1);

console.log(expected400.length === 1 ? 'one refusal seen, the wrong key, as intended' : 'UNEXPECTED refusals: ' + expected400.join(' | '));
console.log(bad.length ? 'FAIL problems seen:\n' + bad.join('\n') : 'ok   no other failed requests, no page errors');
await browser.close();
