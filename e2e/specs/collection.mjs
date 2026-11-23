import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
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
const header = flat(await page.locator('nav[aria-label="Sections"]').innerText());
say('the header has its sections: ' + header, /delicious\s+organized\s+budgeted\s+planned\s+projects\s+entertaining/.test(header));

// A place for the tapes, then the collection.
await page.goto(base + '/things/places'); await wait();
await page.getByRole('button', { name: '+ New place' }).click();
await field('called').fill('Tape cabinet'); await page.getByRole('button', { name: 'Save' }).click(); await wait();

await page.getByRole('link', { name: 'entertaining' }).click(); await wait();
say('an empty collection says what to do', /Nothing here yet/.test(await text()));
await page.getByRole('button', { name: '+ Add' }).click();
await field('Title').fill('Alien'); await field('Director').fill('Ridley Scott'); await field('Year').fill('1979');
await page.getByPlaceholder('VHS, DVD, Blu-ray').fill('VHS'); await field('Where it is').selectOption({ label: 'Tape cabinet' });
await field('Genres').fill('Horror, Science fiction'); await field('Runs for').fill('117');
// Saving opens the film's own page; on a busy computer that can take longer than any fixed wait.
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForURL(/media\/[0-9]+/, { timeout: 15000 }).catch(() => {}); await wait(600);
let t = await text();
say('a film opens on its own page with its VHS copy in the cabinet: ' + flat(t).slice(0, 110), page.url().includes('/media/') && /VHS/.test(t) && /Tape cabinet/.test(t) && /1 h 57 min/.test(t));

const copies = page.locator('section').filter({ hasText: 'Your copies' });
await copies.getByRole('button', { name: '+ Add' }).click();
await page.getByPlaceholder('VHS, DVD, Blu-ray').fill('Blu-ray'); await field('Lent to').fill('Sam');
await page.getByRole('button', { name: 'Save' }).click(); await wait();
say('a second copy on Blu-ray, lent to Sam: ' + flat(await copies.innerText()).slice(0, 120), /Blu-ray/.test(await copies.innerText()) && /with Sam since/.test(await copies.innerText()));
await page.getByRole('button', { name: 'Watched today' }).click(); await wait();
say('watched today is one tap', /Watched\s+Watched today/.test(flat(await text())) && new RegExp(new Date().getFullYear() + '-').test(await page.locator('section').filter({ hasText: 'Another day' }).innerText()));
await page.screenshot({ path: shots + '/media-title.png' });

await page.getByRole('link', { name: '← Collection' }).click(); await wait();
await page.getByRole('button', { name: '+ Add' }).click();
await field('What it is').selectOption('music'); await field('Title').fill('Rumours'); await field('Artist').fill('Fleetwood Mac');
await page.getByPlaceholder('Vinyl, CD, Cassette').fill('Vinyl');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
await page.getByRole('link', { name: '← Collection' }).click(); await wait();
await page.getByRole('button', { name: '+ Add' }).click();
await field('What it is').selectOption('book'); await field('Title').fill('Dune'); await field('Author').fill('Frank Herbert');
await page.getByLabel(/I don.t have it yet/).check();
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
await page.getByRole('link', { name: '← Collection' }).click(); await wait();
t = await text();
say('films, music and books sit together, with formats, wanted and lent: ' + flat(t).slice(0, 200), /Alien/.test(t) && /Rumours/.test(t) && /Vinyl/.test(t) && /wanted/.test(t) && /with Sam/.test(t) && /Lent out/.test(t));
await page.getByRole('button', { name: /Music/ }).click(); await wait(300);
say('the music chip shows only music', /Rumours/.test(await text()) && !/Alien/.test(await text()));
await page.getByRole('button', { name: /Everything/ }).click(); await wait(300);
await page.screenshot({ path: shots + '/media.png' });

// A book on CD that is twelve discs: the copy form asks for discs, and "12 discs" shows on the page and in Audiobooks.
await page.getByRole('button', { name: '+ Add' }).click();
await field('What it is').selectOption('book'); await field('Title').fill('Dune on CD'); await field('Author').fill('Frank Herbert');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForURL(/media\/[0-9]+/, { timeout: 15000 }).catch(() => {}); await wait(600);
const cdCopies = page.locator('section').filter({ hasText: 'Your copies' });
await cdCopies.getByRole('button', { name: '+ Add' }).click();
say('a format with no pieces word offers a small link, not a number', await page.getByRole('button', { name: 'It comes in several pieces' }).isVisible() && !(await field('How many').isVisible().catch(() => false)));
await page.getByPlaceholder(/Hardcover/).fill('Book on CD');
say('Book on CD asks how many discs, and the field is tall enough to tap', /How many discs/.test(await page.getByRole('dialog').innerText()) && (await field('How many discs').boundingBox()).height >= 44);
await field('How many discs').fill('12');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('the copy says "Book on CD · 12 discs": ' + flat(await cdCopies.innerText()).slice(0, 80), /Book on CD · 12 discs/.test(await cdCopies.innerText()));
await page.goto(base + '/media/audiobooks'); await wait(900);
say('and so does the Audiobooks tab: ' + flat(await text()).slice(0, 120), /Dune on CD/.test(await text()) && /Book on CD · 12 discs/.test(await text()));
await page.goto(base + '/media'); await wait(700);
await page.getByRole('link', { name: /Dune on CD/ }).click(); await wait(800);
await cdCopies.getByRole('button', { name: /Book on CD/ }).click();
await field('How many discs').fill('1');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('one disc is not shown: ' + flat(await cdCopies.innerText()).slice(0, 60), !/disc/.test(await cdCopies.innerText().then((s) => s.replace(/Add a copy|Your copies/g, ''))));
await page.goto(base + '/media'); await wait(700);

// Watched while sewing.
await page.getByRole('link', { name: 'projects' }).click(); await wait();
await page.getByRole('button', { name: '+ New project' }).click();
await field('What it is').fill('Shirt dress'); await field('Where it').selectOption('active');
await page.getByRole('button', { name: 'Save' }).click(); await wait(1000);
const time = page.locator('section').filter({ hasText: 'Time on it' });
await time.getByRole('button', { name: '+ Add' }).click();
await field('Hours').fill('2'); await field('What you did').fill('Cut out');
await field('Watched or listened').fill('ali'); await wait(300);
await page.getByRole('button', { name: '+ Alien (1979)' }).click();
await field('Watched or listened').fill('rum'); await wait(300);
await page.getByRole('button', { name: '+ Rumours' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click(); await wait(900);
say('the session names what kept it company: ' + flat(await time.innerText()).slice(0, 120), /with Alien, Rumours/.test(flat(await time.innerText())));
await time.getByRole('link', { name: 'Alien' }).click(); await wait(900);
say('and the film says it was watched while working on the dress', /while working on Shirt dress/.test(await text()));

// The calendar gathers it all.
await page.getByRole('link', { name: 'planned' }).click(); await wait(900);
await page.getByRole('button', { name: '+ Add' }).first().click();
await field('What').fill('Dentist'); await field('Time').fill('14:30');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
t = await text();
say('today shows the dentist, the sewing and what was watched: ' + flat(t).replace(/Nothing on\./g, '').slice(0, 260),
  /14:30\s*Dentist/.test(flat(t)) && /Shirt dress/.test(t) && /2 h · Cut out/.test(t) && /while working on Shirt dress/.test(t));
await page.screenshot({ path: shots + '/calendar.png', fullPage: true });
await page.getByRole('button', { name: /Dentist/ }).click(); await wait(400);
await field('What').fill('Dentist, moved'); await page.getByRole('button', { name: 'Save' }).click(); await wait(800);
say('an event is changed by tapping it', /Dentist, moved/.test(await text()));
await page.getByRole('link', { name: /Shirt dress/ }).first().click(); await wait(800);
say('and a project line on the calendar leads to the project', page.url().includes('/projects/'));

await page.setViewportSize({ width: 390, height: 780 });
await page.goto(base + '/calendar'); await wait(900);
await page.screenshot({ path: shots + '/calendar-phone.png' });
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
