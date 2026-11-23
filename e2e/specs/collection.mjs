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
say('the header has its sections: ' + header, /tasty\s+organized\s+budgeted\s+doing\s+entertaining/.test(header));

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

// ---- sorting, narrowing down, what it cost and is worth ----
await page.evaluate(async () => {
  const post = (body) => fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post({ type: 'film', title: 'The Thing', creator: 'John Carpenter', year: 1982, genres: ['Horror'], copy: { format: 'DVD' } });
  await post({ type: 'film', title: 'Blade Runner', creator: 'Ridley Scott', year: 1982, genres: ['Science fiction'], copy: { format: 'Blu-ray' } });
  await post({ type: 'film', title: 'Heat', creator: 'Michael Mann', year: 1995, genres: ['Crime'], copy: { format: 'DVD', barcode: '012569834521' } });
  await post({ type: 'film', title: 'An Education', creator: 'Lone Scherfig', year: 2009, genres: ['Drama'], copy: { format: 'DVD' } });
});
await page.goto(base + '/media'); await wait(900);
const order = async () => page.locator('main ul.grid li a').evaluateAll((as) => as.map((a) => a.querySelector('span.font-medium')?.childNodes[0]?.textContent?.trim()).filter(Boolean));
const sortBy = page.getByRole('combobox', { name: 'Sort by' });
let o = await order();
say('the list starts by title, ignoring a leading The, A or An, and still shows the titles as written: ' + o.join(' | '),
  JSON.stringify(o) === JSON.stringify(['Alien', 'Blade Runner', 'Dune', 'Dune on CD', 'An Education', 'Heat', 'Rumours', 'The Thing']));
await sortBy.selectOption('year'); await wait(300);
o = await order();
say('by year, newest first, with the ones that have none last: ' + o.join(' | '),
  JSON.stringify(o) === JSON.stringify(['An Education', 'Heat', 'Blade Runner', 'The Thing', 'Alien', 'Dune', 'Dune on CD', 'Rumours']));
await sortBy.selectOption('creator'); await wait(300);
o = await order();
say('by creator, A to Z: ' + o.join(' | '), JSON.stringify(o) === JSON.stringify(['Rumours', 'Dune', 'Dune on CD', 'The Thing', 'An Education', 'Heat', 'Alien', 'Blade Runner']));
await sortBy.selectOption('recent'); await wait(300);
say('by what was watched last, Alien (watched today) first: ' + (await order()).join(' | '), (await order())[0] === 'Alien');
await sortBy.selectOption('title'); await wait(300);

const genre = page.getByRole('combobox', { name: 'Genre' });
const decade = page.getByRole('combobox', { name: 'Decade' });
say('how many of how many are shown: ' + flat(await text()).match(/Showing \d+ of \d+/)?.[0], /Showing 8 of 8/.test(await text()) && !(await page.getByRole('button', { name: 'Clear filters' }).isVisible()));
await genre.selectOption('Horror'); await wait(300);
say('the genre picker offers what is in use and narrows the list: ' + (await order()).join(' | ') + ', ' + flat(await text()).match(/Showing \d+ of \d+/)?.[0],
  JSON.stringify(await order()) === JSON.stringify(['Alien', 'The Thing']) && /Showing 2 of 8/.test(await text()));
await decade.selectOption('1980'); await wait(300);
say('and a decade narrows it further: ' + (await order()).join(' | '), JSON.stringify(await order()) === JSON.stringify(['The Thing']) && /Showing 1 of 8/.test(await text()));
await page.getByRole('button', { name: 'Clear filters' }).click(); await wait(300);
say('"Clear filters" puts everything back, and goes away', /Showing 8 of 8/.test(await text()) && !(await page.getByRole('button', { name: 'Clear filters' }).isVisible()));
await page.getByLabel('Year from').fill('1990'); await wait(300);
say('a from-year narrows by year: ' + (await order()).join(' | '), JSON.stringify(await order()) === JSON.stringify(['An Education', 'Heat']));
await page.getByRole('button', { name: 'Clear filters' }).click(); await wait(300);

// What it cost and is worth: typed on a copy, then added up.
await page.getByRole('link', { name: /Alien/ }).first().click(); await wait(900);
await copies.getByRole('button', { name: /Blu-ray/ }).click();
await field('What it cost').fill('abc'); await page.getByRole('button', { name: 'Save' }).click(); await wait(400);
say('something that is not an amount is said so, and nothing is saved', /A price is dollars and cents/.test(await page.getByRole('dialog').innerText()));
await field('What it cost').fill('20.00'); await field('Worth now').fill('35.50');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('the copy shows what it cost and is worth, and the title adds up its copies: ' + flat(await copies.innerText()).slice(0, 200),
  /cost \$20\.00/.test(await copies.innerText()) && /worth \$35\.50 on \d{4}-/.test(await copies.innerText()) && /Together: cost \$20\.00, worth \$35\.50/.test(await copies.innerText()));
await page.goto(base + '/media'); await wait(800);
await page.getByRole('link', { name: /Heat/ }).first().click(); await wait(900);
await copies.getByRole('button', { name: /DVD/ }).click();
await field('What it cost').fill('7.50'); await field('Worth now').fill('$60'); await field('Worth noted on').fill('2046-01-02');
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('a day can be typed for the worth: ' + flat(await copies.innerText()).slice(0, 120), /worth \$60\.00 on 2046-01-02/.test(await copies.innerText()));
await page.goto(base + '/media'); await wait(900);
const summary = flat(await page.getByRole('region', { name: 'What it all comes to' }).innerText());
say('the collection adds up: ' + summary.slice(0, 230),
  /Titles 8 Copies 8 Cost \$27\.50 Worth now \$95\.50 Difference \+\$68\.00/.test(summary) && /6 copies have no cost or value typed/.test(summary));
await page.goto(base + '/media/audiobooks'); await wait(900);
say('each tab adds up what it shows: ' + flat(await page.getByRole('region', { name: 'What it all comes to' }).innerText()).slice(0, 120),
  /Titles 1 Copies 1/.test(flat(await page.getByRole('region', { name: 'What it all comes to' }).innerText())) && /No prices typed yet/.test(await text()));
await page.goto(base + '/media'); await wait(900);
await sortBy.selectOption('value'); await wait(300);
o = await order();
say('by value, highest first, the ones with none last: ' + o.join(' | '),
  JSON.stringify(o) === JSON.stringify(['Heat', 'Alien', 'Blade Runner', 'Dune', 'Dune on CD', 'An Education', 'Rumours', 'The Thing']));
await page.screenshot({ path: shots + '/collection-sorted.png', fullPage: true });
await page.reload(); await wait(900);
say('the sort is remembered on this device', (await sortBy.inputValue()) === 'value' && JSON.stringify(await order()).startsWith('["Heat","Alien"'));
await sortBy.selectOption('title'); await wait(300);

// ---- print or save a list: what the page was showing, as a plain sheet and a spreadsheet ----
await page.evaluate(async () => {
  const post = (body) => fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post({ type: 'film', title: '=SUM(1+1)', creator: '@someone', year: 1990, genres: ['Horror'], copy: { format: 'DVD' } });
  await post({ type: 'film', title: 'Hello, "World"', creator: 'Pat', year: 1991, genres: ['Horror'], copy: { format: 'DVD' } });
});
await page.goto(base + '/media'); await wait(900);
await genre.selectOption('Horror'); await wait(300);
await page.getByRole('link', { name: 'Print or save a list' }).click(); await wait(1200);
const sheet = page.locator('.list-sheet');
const sheetText = async () => flat(await sheet.innerText());
say('the print page carries the filter in the address: ' + page.url().replace(base, ''), /\/media\/print\?/.test(page.url()) && /genre=Horror/.test(page.url()) && /sort=title/.test(page.url()));
t = await sheetText();
say('and lists only the Horror titles, in the sort: ' + t.slice(0, 160), /Alien/.test(t) && /The Thing/.test(t) && /Hello, "World"/.test(t) && !/Heat|Rumours|Blade Runner|Dune/.test(t) && await sheet.locator('[data-row]').count() === 4);
for (let i = 0; i < 20 && await page.getByRole('button', { name: 'Save as spreadsheet' }).isDisabled(); i += 1) await wait(300);
say('where each is kept is looked up and shown: ' + t.match(/Alien[^]{0,80}/)?.[0], /Tape cabinet/.test(await sheetText()));
say('a total is at the bottom', /Total: 4 titles · cost \$20\.00 · worth \$35\.50/.test(await sheetText()));
await page.getByLabel('Where it is', { exact: true }).uncheck(); await wait(200);
say('a column can be left out', !/Where it is/.test(await sheetText()));
await page.getByLabel('Where it is', { exact: true }).check(); await wait(800);
await page.getByLabel('Where it is kept').check(); await wait(1000);
say('grouped by place, with a heading for it: ' + (await sheet.locator('h3').allInnerTexts()).join(' | '), /Tape cabinet/.test(await sheet.locator('h3').first().innerText()) && await sheet.locator('h3').count() >= 2);
await page.getByLabel('Nothing: one list').check(); await wait(300);
const [csvDownload] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save as spreadsheet' }).click()]);
const csvFile = shots + '/' + csvDownload.suggestedFilename();
await csvDownload.saveAs(csvFile);
const csv = (await import('node:fs')).readFileSync(csvFile);
const csvTextOut = csv.toString('utf8');
say('the spreadsheet is named for the day and begins with a byte-order mark: ' + csvDownload.suggestedFilename(), /^collection-list-\d{4}-\d\d-\d\d\.csv$/.test(csvDownload.suggestedFilename()) && csv[0] === 0xef && csv[1] === 0xbb && csv[2] === 0xbf);
say('with the header, and a known row: ' + csvTextOut.split('\r\n').slice(0, 3).join(' // '), csvTextOut.includes('Title,Creator,Year,Formats,Where it is,Lent to,Cost,Worth\r\n') && csvTextOut.includes('Alien,Ridley Scott,1979,VHS; Blu-ray,Tape cabinet,Sam,20.00,35.50\r\n'));
say('a cell with a comma and quotes is quoted, and one starting with = or @ is made safe', csvTextOut.includes('"Hello, ""World"""') && csvTextOut.includes("'=SUM(1+1),'@someone") && csvTextOut.includes('Total: 4 titles'));
// On paper: only the sheet prints.
await page.emulateMedia({ media: 'print' }); await wait(300);
const appHeader = page.locator('header.sticky');
say('printing hides the app header, the choices and the buttons',
  !(await appHeader.isVisible()) && !(await page.getByRole('button', { name: 'Print or save as PDF' }).isVisible()) && !(await page.getByRole('button', { name: 'Save as spreadsheet' }).isVisible()) && !(await page.getByLabel('Where it is kept').isVisible()));
say('and the sheet is there, black on white', await sheet.isVisible() && (await sheet.evaluate((e) => getComputedStyle(e).color + '|' + getComputedStyle(e).backgroundColor)) === 'rgb(0, 0, 0)|rgb(255, 255, 255)');
await page.screenshot({ path: shots + '/collection-print.png', fullPage: true });
await page.emulateMedia({ media: 'screen' });
// On a phone: nothing scrolls sideways, and every control is tall enough to tap.
await page.setViewportSize({ width: 375, height: 900 }); await wait(500);
const narrow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tiny = await page.locator('main button, main a, main label, main input:not([type=checkbox]):not([type=radio]), main select').evaluateAll((els) => els.filter((e) => !e.closest('.list-sheet') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent || e.tagName).slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height)));
say('at 375 px nothing scrolls sideways, and every control is at least 44 px tall: ' + (tiny.join(', ') || 'none smaller'), narrow <= 0 && tiny.length === 0);
await page.screenshot({ path: shots + '/collection-print-phone.png', fullPage: true });
await page.setViewportSize({ width: 1100, height: 860 });
await page.goto(base + '/media'); await wait(800);

// A name you already have is asked about, not blocked.
await page.getByRole('button', { name: '+ Add' }).click();
await field('Title').fill('alien'); await wait(300);
const asked = flat(await page.getByRole('dialog').innerText());
say('typing a title you have warns about it: ' + asked.match(/You already have[^.]*\./)?.[0],
  /You already have Alien \(VHS, Blu-ray\)/.test(asked) && await page.getByRole('link', { name: 'Open it' }).isVisible() && await page.getByRole('button', { name: 'Add as a new copy of it' }).isVisible());
await page.getByRole('button', { name: "It's a different one" }).click(); await wait(300);
say('"It\'s a different one" lets it be added as a title of its own', !/You already have/.test(await page.getByRole('dialog').innerText()));
await page.keyboard.press('Escape'); await wait(300);
await page.getByRole('button', { name: '+ Add' }).click();
await field('Title').fill('ALIEN'); await page.getByPlaceholder('VHS, DVD, Blu-ray').fill('LaserDisc');
await page.getByRole('button', { name: 'Add as a new copy of it' }).click(); await page.waitForURL(/media\/[0-9]+/, { timeout: 15000 }).catch(() => {}); await wait(900);
say('"Add as a new copy of it" puts a LaserDisc copy on the Alien already there: ' + flat(await copies.innerText()).slice(0, 100),
  /Alien/.test(await text()) && /LaserDisc/.test(await copies.innerText()) && /Blu-ray/.test(await copies.innerText()));

// Scan many, on a phone: the camera stays open (here, no camera, so the numbers are typed), and the lines gather below it.
await page.setViewportSize({ width: 375, height: 1100 });
await page.goto(base + '/media'); await wait(900);
await page.getByRole('button', { name: 'Scan many' }).click(); await wait(1200);
const bulk = page.getByRole('dialog', { name: 'Scan many' });
const typeCode = async (code) => { await bulk.getByLabel('Or type a barcode').fill(code); await bulk.getByLabel('Or type a barcode').press('Enter'); await wait(250); };
await typeCode('012569834521'); await typeCode('555000111222'); await typeCode('555000111339'); await wait(3500);
await typeCode('555000111222'); await wait(300);
let b = flat(await bulk.innerText()); 
say('three barcodes make three lines, one already in the collection: ' + b.match(/You have this:[^.]*/)?.[0], await bulk.locator('li[data-line]').count() === 3 && /You have this: Heat/.test(b));
say('a barcode scanned twice is there once, with a gentle note', /You already scanned 555000111222/.test(b));
say('one not found says so and asks for a title: ' + b.match(/Not found: barcode 555000111222[^.]*\./)?.[0], /Not found: barcode 555000111222/.test(b) && /Not found: barcode 555000111339/.test(b));
await bulk.getByLabel('Title for barcode 555000111222').fill('Tron');
await bulk.getByLabel('Title for barcode 555000111339').fill('Kind of Blue');
const lastLine = bulk.locator('li[data-line]').nth(2);
await lastLine.getByLabel('What it is').selectOption('music'); await lastLine.getByLabel("What it's on").fill('CD');
await bulk.getByLabel('They are all on').fill('DVD');
await bulk.getByLabel('Where they all go').selectOption({ label: 'Tape cabinet' }); await wait(300);
say('the one you have is not added unless asked: ' + (await bulk.getByRole('button', { name: /Add these/ }).innerText()), /Add these 2/.test(await bulk.getByRole('button', { name: /Add these/ }).innerText()));
await bulk.getByLabel('Add another copy of it').check(); await bulk.getByLabel('What the new copy is on').fill('Blu-ray'); await wait(300);
say('"add another copy" counts it: ' + (await bulk.getByRole('button', { name: /Add these/ }).innerText()), /Add these 3/.test(await bulk.getByRole('button', { name: /Add these/ }).innerText()));
const sideways = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth, dialog: (() => { const d = document.querySelector('[role=dialog]'); return d.scrollWidth - d.clientWidth; })() }));
say('no sideways scrolling at 375px: ' + JSON.stringify(sideways), sideways.page <= 0 && sideways.dialog <= 0);
const small = await bulk.locator('button, input:not([type=checkbox]), select').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5).map((e) => (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.tagName).slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height)));
say('every control is at least 44px tall: ' + (small.join(', ') || 'none smaller'), small.length === 0);
await bulk.locator('li[data-line]').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + '/bulk-scan-phone.png' });
await bulk.getByRole('button', { name: /Add these 3/ }).click(); await wait(2000);
say('adding them says how many went in: ' + flat(await bulk.innerText()).match(/Added \d+ to the collection\./)?.[0], /Added 3 to the collection\./.test(await bulk.innerText()));
await bulk.getByRole('button', { name: 'Done', exact: true }).click(); await wait(900);
await page.setViewportSize({ width: 1100, height: 860 });
await page.getByRole('link', { name: /Tron/ }).first().click(); await wait(900);
say('a scanned title keeps its barcode and place: ' + flat(await copies.innerText()).slice(0, 120), /DVD/.test(await copies.innerText()) && /Tape cabinet/.test(await copies.innerText()) && /barcode 555000111222/.test(await copies.innerText()));
await page.goto(base + '/media'); await wait(800);
await page.getByRole('link', { name: /Heat/ }).first().click(); await wait(900);
say('and the one you had gained a copy only because it was asked for: ' + flat(await copies.innerText()).slice(0, 100), /DVD/.test(await copies.innerText()) && /Blu-ray/.test(await copies.innerText()));

// A list of films and albums from another app: every column named, understood or ignored.
await page.goto(base + '/media'); await wait(900);
await page.getByRole('button', { name: 'Bring in a list' }).click();
await field('Or the list itself').fill('Title,Director,Media,Price Paid,Mood\nJaws,Steven Spielberg,DVD,9.99,tense\nAbbey Road,The Beatles,Vinyl,25,calm\n');
await page.getByRole('dialog').getByRole('button', { name: 'Look it over' }).click(); await wait(900);
const look = flat(await page.getByRole('dialog').innerText());
say('the look-over counts the kinds: ' + look.match(/\d+ titles found[^.]*\./)?.[0], /2 titles found \(1 film, 1 music\)/.test(look));
say('and lists the columns understood: ' + flat(await page.locator('[data-understood]').innerText()), /Title/.test(await page.locator('[data-understood]').innerText()) && /Director\s*→\s*(is read as\s*)?Creator/.test(await page.locator('[data-understood]').innerText()) && /Price Paid\s*→\s*(is read as\s*)?Price paid/.test(await page.locator('[data-understood]').innerText()));
say('and the column left out: ' + flat(await page.locator('[data-ignored]').innerText()), /Mood/.test(await page.locator('[data-ignored]').innerText()) && !/Director/.test(await page.locator('[data-ignored]').innerText()));
await page.getByRole('dialog').getByRole('button', { name: 'Bring in 2' }).click(); await wait(1200);
say('bringing it in says what happened: ' + flat(await page.getByRole('dialog').innerText()).match(/Brought in:[^.]*\./)?.[0], /Brought in: 2 new titles, 2 copies added\./.test(await page.getByRole('dialog').innerText()));
await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click(); await wait(900);
t = flat(await text());
say('the film and the album are in, with what they cost: ' + t.slice(0, 140), /Jaws/.test(t) && /Abbey Road/.test(t) && /cost \$9\.99/.test(t) && /Vinyl/.test(t));
await page.goto(base + '/media'); await wait(700);

// Watched while sewing.
await page.getByRole('link', { name: 'doing', exact: true }).click(); await wait();
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
await page.locator('nav[aria-label="Sections"]').getByRole('link', { name: 'organized' }).click(); await wait(600);
await page.getByRole('navigation', { name: 'Life is organized' }).getByRole('link', { name: 'Calendar' }).click(); await wait(900);
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
