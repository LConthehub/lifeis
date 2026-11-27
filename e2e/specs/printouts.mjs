// Printouts that match the site: one frame (stripe band, mushroom, phrase, title), three print styles, recipes on a page and on
// 4 x 6 cards, the house manual three ways (full, fridge sheet, pocket zine), and the other printouts wearing the same frame.
// The browser is made to print (emulated print media) and the sheets are measured. PDFs and pictures of each go to e2e/shots/print.
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const out = `${shots}/print`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 1056, height: 816 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const bad = [];
page.on('pageerror', (e) => bad.push(`page error ${e.message}`));
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('dialog', (d) => d.accept());
// The print box cannot be seen here: remember that it was asked for instead.
await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => {
  const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return r.status === 204 ? null : r.json();
}, [method, address, body]);

await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(2000);

// ---------- what there is to print ----------
await send('POST', '/api/things/starters', { slug: 'clothing' });
const kind = (await send('GET', '/api/things/kinds'))[0];
await send('POST', '/api/things/items', { kind_id: kind.id, name: 'Dog food', quantity: 3, low_at: 1 });
const biscuit = await send('POST', '/api/things/pets', { name: 'Biscuit', species: 'dog', food: 'One cup, twice a day', vet_name: 'Oak Lane Vets', vet_phone: '555 0100' });
await send('POST', '/api/routines/starters', { slug: 'dog-daily', for_pet: biscuit.id, food: (await send('GET', '/api/things/items')).find((i) => i.name === 'Dog food')?.id });
const entry = (section, title, body, phone, extra = {}) => send('POST', '/api/manual/entries', { section, title, body, phone, ...extra });
await entry('emergency', 'Water shut-off', 'Red lever behind the boiler. Turn it a quarter.');
await entry('emergency', 'Fire extinguisher', 'Under the sink, left side.');
await entry('contacts', 'Plumber', 'Ask for Dana. Has a key and knows the house.', '555 0142');
for (const [i, who] of ['Neighbor with a key', 'Doctor', 'Electrician', 'Landlord', 'School office', 'Dentist', 'Vet after hours', 'Grandma', 'Poison control', 'Car repair', 'Cousin Lee'].entries()) await entry('contacts', who, i % 3 === 0 ? 'Calls back within the hour, usually before noon and never on Sundays.' : null, `555 02${String(i).padStart(2, '0')}`);
await entry('house', 'Wi-Fi', 'Network: SampleHome\nPassword: made-up-for-the-test');
await entry('house', 'Thermostat', 'Hold the button for three seconds to wake it. 68 is fine.');
await entry('house', 'Alarm', 'Code 4821', null, { private: true });
await entry('routines', 'Trash and recycling days', 'Trash Tuesday night. Recycling every other Thursday morning, bins at the end of the drive.');
await send('POST', '/api/home-services', { name: 'Family photos', address: 'https://photos.home.example/', address_at: 'any', guests: true, note: 'Look, do not change.' });
await send('POST', '/api/home-services', { name: 'Router', address: 'http://192.168.1.1/', address_at: 'home', guests: false });
const lemon = await send('POST', '/api/kitchen/recipes', { title: 'Lemon Pasta', description: 'Bright and quick: dinner in twenty-five minutes.', servings: 4, prep_minutes: 10, cook_minutes: 15, ingredients_text: '12 oz spaghetti\n2 lemons, zest and juice\n3 tbsp olive oil\n2 cloves garlic, minced\n1/2 cup grated parmesan\nSalt and black pepper\nParsley, a handful', steps_text: 'Boil the spaghetti in well salted water until just tender.\nWarm the oil with the garlic for one minute.\nAdd the lemon zest and juice.\nToss with the drained pasta and a splash of the pasta water.\nFinish with parmesan, pepper and parsley.', notes: 'Good cold the next day. Double the lemon for a sharper dish.' });
// A small flat-color picture for it, made in the page.
const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#f4d35e'; x.fillRect(0, 0, 240, 160); x.fillStyle = '#ee964b'; x.fillRect(0, 100, 240, 60); return c.toDataURL('image/png').split(',')[1]; });
await send('PUT', `/api/kitchen/recipes/${lemon.id}/photo`, { data: png });
const longSteps = Array.from({ length: 11 }, (_, i) => `Step number ${i + 1}: combine the layers in the order given, pressing each one down gently with the back of a spoon so the sauce reaches the corners, then rest it for ${5 + i} minutes before moving on to the next.`).join('\n');
const lasagna = await send('POST', '/api/kitchen/recipes', { title: 'Sunday Lasagna', servings: 8, prep_minutes: 40, cook_minutes: 60, ingredients_text: Array.from({ length: 14 }, (_, i) => `${i + 1} cup of ingredient ${i + 1}`).join('\n'), steps_text: longSteps, notes: 'Freezes well, wrapped twice.' });

// ---------- measuring what printed ----------
const asPaper = async () => { await page.emulateMedia({ media: 'print' }); await wait(500); };
const asScreen = async () => { await page.emulateMedia({ media: 'screen' }); await wait(200); };
const pdf = async (name) => {
  const bytes = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${out}/${name}.pdf`, bytes);
  return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
};
const picture = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const setStyle = async (label) => { if (!(await page.getByLabel('Print style').count())) { await page.getByRole('button', { name: 'Print', exact: true }).click(); await wait(200); } await page.getByLabel('Print style').selectOption({ label }); await wait(150); };
const open = async (url) => { await asScreen(); await page.goto(base + url); await wait(1800); };

// ---- the shared frame and the three styles, on the recipe page ----
await open(`/recipes/${lemon.id}?print=page`);
await page.evaluate(() => localStorage.removeItem('lifeis.printStyle'));
await page.reload(); await wait(1500);
await page.getByRole('button', { name: 'Print', exact: true }).click(); await wait(300);
check('Print style says "Life Is look" first, with plain chocolate and plain black after it',
  (await page.getByLabel('Print style').locator('option').allInnerTexts()).join('|') === 'Life Is look|Plain chocolate|Plain black' && (await page.getByLabel('Print style').inputValue()) === 'life');
await page.getByRole('button', { name: 'Recipe page (letter)' }).click(); await wait(500);
check('Print asks the browser to print', (await page.evaluate(() => window.__printed)) === 1);
await asPaper();
const sheet = page.locator('[data-sheet="page"]');
const frame = await sheet.evaluate((el) => {
  const bands = [...el.querySelectorAll('.pf-bands > i')].map((b) => getComputedStyle(b).backgroundColor);
  const strip = el.querySelector('.pf-bands').getBoundingClientRect();
  const mark = el.querySelector('.pf-mark').getBoundingClientRect();
  const phrase = el.querySelector('.pf-phrase');
  const title = el.querySelector('.pf-title');
  return { bands, bandHeight: strip.height, markSize: [mark.width, mark.height], markLoaded: el.querySelector('.pf-mark').naturalWidth > 0, phrase: phrase.textContent, phraseAbove: phrase.getBoundingClientRect().top > strip.bottom,
    titleFont: getComputedStyle(title).fontFamily, titleColor: getComputedStyle(title).color, titleAbove: title.getBoundingClientRect().top >= mark.bottom - 2, title: title.textContent, headings: [...el.querySelectorAll('h3')].map((h) => getComputedStyle(h).color) };
});
check('the stripe band is 3/8 in tall with plum, green, gold, orange and cream', frame.bandHeight === 36 && frame.bands.join(' ') === 'rgb(96, 48, 79) rgb(58, 116, 47) rgb(242, 206, 71) rgb(231, 96, 44) rgb(245, 232, 205)', JSON.stringify(frame));
check('the mushroom is 1/2 in, beside "Life is cooking", under the stripe, above the title', frame.markSize.join('x') === '48x48' && frame.markLoaded && frame.phrase === 'Life is cooking' && frame.phraseAbove && frame.titleAbove, JSON.stringify(frame));
check('the title is in Fraunces and chocolate', /Fraunces/.test(frame.titleFont) && frame.titleColor === 'rgb(66, 42, 23)' && frame.title === 'Lemon Pasta' && frame.headings.every((c) => c === 'rgb(66, 42, 23)'), JSON.stringify(frame));
const layout = await sheet.evaluate((el) => ({ photo: !!el.querySelector('.pr-photo'), photoLoaded: el.querySelector('.pr-photo')?.naturalWidth > 0, ing: el.querySelector('.pr-ing').getBoundingClientRect().left, steps: el.querySelector('.pr-steps').getBoundingClientRect().left, ingTop: el.querySelector('.pr-ing').getBoundingClientRect().top, stepsTop: el.querySelector('.pr-steps').getBoundingClientRect().top,
  text: el.innerText.replace(/\s+/g, ' '), box: el.querySelector('.pf-titlebox') ? getComputedStyle(el.querySelector('.pf-titlebox')).borderTopStyle : 'none', height: el.getBoundingClientRect().height }));
check('the recipe page has the picture, and the ingredients in a column beside the steps', layout.photo && layout.photoLoaded && layout.steps > layout.ing + 150 && Math.abs(layout.ingTop - layout.stepsTop) < 3, JSON.stringify({ ...layout, text: '' }));
check('it says servings and time, the ingredients, the steps and the notes', /Serves 4 · prep 10 min · cook 15 min/.test(layout.text) && /12 oz spaghetti/.test(layout.text) && /1 Boil the spaghetti/.test(layout.text) && /Good cold the next day/.test(layout.text), layout.text.slice(0, 200));
check('the title has the thin line frame in the Life Is look', layout.box === 'solid', layout.box);
await picture('recipe-page-life');
const lifeHeight = layout.height;
const lifePages = await pdf('recipe-page-life');
check('the recipe page is one letter page', lifePages === 1, `${lifePages} pages`);
const plainOf = (el) => {
  const all = [el, ...el.querySelectorAll('*')];
  const colors = new Set(); const fills = new Set(); const hidden = el.querySelector('.pf-bands');
  for (const e of all) { const s = getComputedStyle(e); if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) colors.add(s.color); const bg = s.backgroundColor; if (bg !== 'rgba(0, 0, 0, 0)' && e !== el) fills.add(bg); }
  return { colors: [...colors], fills: [...fills], stripe: getComputedStyle(hidden).visibility, mark: getComputedStyle(el.querySelector('.pf-mark')).visibility, box: getComputedStyle(el.querySelector('.pf-titlebox')).borderTopColor, height: el.getBoundingClientRect().height, bandHeight: hidden.getBoundingClientRect().height };
};
for (const [label, ink, file] of [['Plain chocolate', 'rgb(66, 42, 23)', 'chocolate'], ['Plain black', 'rgb(0, 0, 0)', 'black']]) {
  await asScreen(); await setStyle(label); await asPaper();
  const got = await sheet.evaluate(plainOf);
  check(`${label}: every word is ${file}, no color fills, no stripe, no mushroom, no title frame`, got.colors.length === 1 && got.colors[0] === ink && got.fills.length === 0 && got.stripe === 'hidden' && got.mark === 'hidden' && got.box === 'rgba(0, 0, 0, 0)', JSON.stringify(got));
  check(`${label}: the layout is the same as the Life Is look (same height, the stripe's room kept)`, Math.abs(got.height - lifeHeight) < 1 && got.bandHeight === 36, `${got.height} against ${lifeHeight}`);
  if (file === 'black') { await picture('recipe-page-black'); await pdf('recipe-page-black'); }
}
await asScreen();
check('the choice is remembered on this device', (await page.evaluate(() => localStorage.getItem('lifeis.printStyle'))) === 'black');
await page.reload(); await wait(1500);
await page.getByRole('button', { name: 'Print', exact: true }).click();
check('and is still there after the page is opened again', (await page.getByLabel('Print style').inputValue()) === 'black');
await setStyle('Life Is look');

// ---- recipe cards ----
await open(`/recipes/${lemon.id}?print=card`);
await asPaper();
const cardInfo = async () => page.locator('[data-sheet="card"]').evaluate((root) => ({
  sheets: root.querySelectorAll('[data-card-page]').length,
  cards: [...root.querySelectorAll('.rc-card')].map((c) => {
    const r = c.getBoundingClientRect(); const body = c.querySelector('.rc-body');
    return { w: Math.round(r.width), h: Math.round(r.height), fits: body.scrollWidth <= body.clientWidth + 2 && body.scrollHeight <= body.clientHeight + 2, title: c.querySelector('.rc-title, .rc-title-more').textContent, text: c.innerText.replace(/\s+/g, ' '),
      cut: getComputedStyle(c, '::after').borderTopStyle, frame: getComputedStyle(c.querySelector('.pf-card-frame')).display, frameInset: getComputedStyle(c.querySelector('.pf-card-frame')).top,
      bodyBox: [Math.round(body.getBoundingClientRect().left - r.left), Math.round(body.getBoundingClientRect().top - r.top)] };
  }),
}));
let cards = await cardInfo();
check('a short recipe is one 4 x 6 inch card (landscape, 6 x 4 in)', cards.cards.length === 1 && cards.cards[0].w === 576 && cards.cards[0].h === 384 && cards.cards[0].fits, JSON.stringify(cards.cards.map((c) => ({ ...c, text: '' }))));
check('the card has a dashed cut line, a line frame inset 1/4 in, and the words 1/2 in in', cards.cards[0].cut === 'dashed' && cards.cards[0].frame === 'block' && cards.cards[0].frameInset === '24px' && cards.cards[0].bodyBox[0] === 48 && cards.cards[0].bodyBox[1] >= 48, JSON.stringify(cards.cards[0].bodyBox));
check('it holds the title, time, ingredients and method', /Lemon Pasta/.test(cards.cards[0].text) && /Serves 4/.test(cards.cards[0].text) && /12 oz spaghetti/.test(cards.cards[0].text) && /5\. Finish with parmesan/.test(cards.cards[0].text), cards.cards[0].text.slice(0, 160));
await picture('recipe-card-short');
await open(`/recipes/${lasagna.id}?print=card`);
await asPaper();
cards = await cardInfo();
check('a long recipe runs on to more cards, each "continued", all inside their card', cards.cards.length >= 3 && cards.cards.slice(1).every((c) => /\(continued\)$/.test(c.title)) && cards.cards.every((c) => c.fits && c.w === 576 && c.h === 384), `${cards.cards.length} cards: ` + cards.cards.map((c) => c.title).join(' | '));
check('two cards to a letter sheet, so a third starts the second sheet', cards.sheets === Math.ceil(cards.cards.length / 2), `${cards.sheets} sheets`);
const allText = cards.cards.map((c) => c.text).join(' ');
check('every step and every ingredient is on some card', Array.from({ length: 11 }, (_, i) => `Step number ${i + 1}`).every((s) => allText.includes(s)) && Array.from({ length: 14 }, (_, i) => `ingredient ${i + 1}`).every((s) => allText.includes(s)));
await picture('recipe-cards-long');
const cardPages = await pdf('recipe-cards-long');
check('the cards print on that many letter sheets', cardPages === cards.sheets, `${cardPages} pages`);
await open(`/recipes/${lemon.id}?print=card`);
await asPaper();
await pdf('recipe-card-sheet');
await asScreen(); await setStyle('Plain black'); await asPaper();
cards = await cardInfo();
check('the plain styles drop the card frame', cards.cards[0].frame === 'none');
await asScreen(); await setStyle('Life Is look');

// ---- the house manual, three ways ----
await open('/manual');
await page.getByRole('button', { name: 'Print', exact: true }).click(); await wait(200);
check('the manual offers the full manual, a fridge sheet and a pocket zine', (await page.getByRole('group', { name: 'How to print' }).getByRole('button').allInnerTexts()).join('|') === 'Full manual|Fridge sheet|Pocket zine');
await page.evaluate(() => { window.__printed = 0; });
await page.getByRole('button', { name: 'Fridge sheet' }).click(); await wait(600);
check('choosing one asks the browser to print', (await page.evaluate(() => window.__printed)) === 1);
await page.getByRole('button', { name: 'Full manual' }).click(); await wait(600);
await asPaper();
const full = await page.locator('[data-sheet="full"]').evaluate((el) => ({
  parts: [...el.querySelectorAll('[data-part]')].map((p) => p.dataset.part), text: el.innerText.replace(/\s+/g, ' '),
  qr: el.querySelector('[data-wifi] img')?.naturalWidth > 0, head: el.querySelector('.pf-phrase').textContent, title: el.querySelector('.pf-title').textContent,
  services: [...el.querySelectorAll('[data-service]')].map((s) => s.dataset.service),
}));
check('the full manual: emergencies and contacts first, then Wi-Fi, pets, how the house works, Home lab (not "Home services")', full.parts.join(',') === 'emergencies,contacts,wifi,pets,quirks,services' && /Home lab/.test(full.text) && !/Home services/.test(full.text), full.parts.join(','));
check('it has the Wi-Fi code (drawn on this device) and the password in words, the pet, and no private entry', full.qr && /SampleHome/.test(full.text) && /made-up-for-the-test/.test(full.text) && /Biscuit/.test(full.text) && !/4821/.test(full.text));
check('it has "Life is in order" and the title, and the links this person can see', full.head === 'Life is in order' && full.title === 'House Manual' && full.services.join(',') === 'Family photos,Router', full.services.join(','));
await picture('manual-full');
const fullPages = await pdf('manual-full');
check('the full manual is on letter pages', fullPages >= 1, `${fullPages} pages`);
const pageNumbers = await page.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).filter((t) => /@bottom-center/.test(t) && /counter\(page\)/.test(t)).length);
check('and numbers its pages', pageNumbers >= 1);
await asScreen();
await page.getByLabel('Put private entries on the paper too').check(); await wait(300);
await asPaper();
check('private entries come only when asked for', /4821/.test(await page.locator('[data-sheet="full"]').innerText()));
await asScreen(); await page.getByLabel('Put private entries on the paper too').uncheck();

await open('/manual?sheet=fridge');
await asPaper();
const fridge = await page.locator('[data-sheet="fridge"]').evaluate((el) => ({ text: el.innerText.replace(/\s+/g, ' '), qr: el.querySelector('[data-wifi] img')?.naturalWidth > 0, height: el.getBoundingClientRect().height, phrase: el.querySelector('.pf-phrase').textContent }));
check('the fridge sheet has emergency numbers, the Wi-Fi with its code, and how to feed the pet', /911/.test(fridge.text) && /555 0142/.test(fridge.text) && fridge.qr && /SampleHome/.test(fridge.text) && /Feed \(Dog food\)/.test(fridge.text) && /Biscuit/.test(fridge.text), fridge.text.slice(0, 300));
const fridgePages = await pdf('manual-fridge');
check('and is one page', fridge.height < 9.8 * 96 && fridgePages === 1, `${fridge.height}px, ${fridgePages} pages`);
await picture('manual-fridge');

await open('/manual?sheet=zine');
await asPaper();
const zine = await page.locator('[data-zine]').evaluate((root) => {
  const panels = [...root.querySelectorAll('.zine-panel')].map((p) => {
    const r = p.getBoundingClientRect(); const m = new DOMMatrix(getComputedStyle(p).transform === 'none' ? undefined : getComputedStyle(p).transform);
    const kids = [...p.children]; const last = kids[kids.length - 1];
    return { page: Number(p.dataset.page), content: p.dataset.content, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), turn: Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI), text: p.innerText.replace(/\s+/g, ' '),
      fits: p.scrollHeight <= p.clientHeight + 1 && (!last || last.getBoundingClientRect().bottom <= r.bottom + 1) };
  });
  return { panels, grid: root.querySelector('.zine-grid').getBoundingClientRect().toJSON(), cut: !!root.querySelector('[data-cut-line]'), folds: root.querySelectorAll('.zine-fold-v, .zine-fold-h').length, qr: root.querySelector('[data-wifi] img')?.naturalWidth > 0 };
});
const byPlace = [...zine.panels].sort((a, b) => a.y - b.y || a.x - b.x);
check('the zine is 8 panels, 4 across and 2 down: top row 5 4 3 2, bottom row 6 7 8 1', byPlace.map((p) => p.page).join(',') === '5,4,3,2,6,7,8,1', byPlace.map((p) => p.page).join(','));
check('the top row is upside down, the bottom row is upright', byPlace.slice(0, 4).every((p) => Math.abs(p.turn) === 180) && byPlace.slice(4).every((p) => p.turn === 0), byPlace.map((p) => p.turn).join(','));
const inBook = [...zine.panels].sort((a, b) => a.page - b.page).map((p) => p.content);
check('read in page order: cover, emergencies, contacts, Wi-Fi, pets, quirks, services, back cover', inBook.join(',') === 'cover,emergencies,contacts,wifi,pets,quirks,services,back', inBook.join(','));
check('every panel is 2 5/8 x 4 in, and the sheet is 10 1/2 x 8 in', zine.panels.every((p) => p.w === 252 && p.h === 383 || p.w === 252 && p.h === 384) && Math.round(zine.grid.width) === 1008, JSON.stringify(zine.grid));
check('nothing is cut off at the foot of a panel', zine.panels.every((p) => p.fits), zine.panels.filter((p) => !p.fits).map((p) => p.content).join(','));
check('there are light dashed fold lines and a cut line between the middle four panels, and the back cover says "fold and cut"', zine.folds === 4 && zine.cut && /Fold and cut/.test(zine.panels.find((p) => p.content === 'back').text));
check('too much for a panel is shortened with "more in the full manual"', /More in the full manual/.test(zine.panels.find((p) => p.content === 'contacts').text), zine.panels.find((p) => p.content === 'contacts').text.slice(-80));
check('the Wi-Fi panel has the code, and the cover is "Life is in order" House Manual', zine.qr && /SampleHome/.test(zine.panels.find((p) => p.content === 'wifi').text) && /Life is in order/.test(zine.panels.find((p) => p.content === 'cover').text) && /House Manual/.test(zine.panels.find((p) => p.content === 'cover').text));
await picture('manual-zine');
const zinePages = await pdf('manual-zine');
const zineDebug = await page.evaluate(() => { const z = document.querySelector('[data-zine]').getBoundingClientRect(); const chain = []; for (let e = document.querySelector('[data-zine]'); e; e = e.parentElement) { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); chain.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)} top${Math.round(r.top)} h${Math.round(r.height)} pad${s.paddingTop}/${s.paddingBottom} mar${s.marginTop}/${s.marginBottom} min${s.minHeight}`); } return `zine top ${Math.round(z.top)} h ${Math.round(z.height)}; ` + chain.join(' < '); });
check('the zine is ONE sheet, one side', zinePages === 1, `${zinePages} pages; ${zineDebug}`);

// ---- the other printouts wear the frame and the style ----
const frames = async (url, label, sheetSelector, phrase, title) => {
  await open(url);
  const choice = await page.getByLabel('Print style').count();
  await asPaper();
  const got = await page.locator(sheetSelector).first().evaluate((el) => ({ phrase: el.querySelector('.pf-phrase')?.textContent, title: el.querySelector('.pf-title')?.textContent, bands: el.querySelectorAll('.pf-bands > i').length, color: getComputedStyle(el).color }));
  check(`${label} wears the frame (stripe, mushroom, "${phrase}", "${title}") and has Print style`, choice === 1 && got.phrase === phrase && got.title === title && got.bands === 5 && got.color === 'rgb(0, 0, 0)', JSON.stringify(got));
  await picture(label.toLowerCase().replace(/\W+/g, '-'));
};
await open('/media');
await send('POST', '/api/media', { type: 'film', title: 'Heat', creator: 'Michael Mann', year: 1995, genres: ['Crime'], copy: { format: 'DVD' } });
await frames('/media/print', 'The collection list', '.list-sheet', 'Life is full', 'Collection');
await send('POST', '/api/things/items', { kind_id: kind.id, name: 'Television' });
await frames('/things/report', 'The home inventory', '.report-sheet', 'Life is covered', 'Home inventory');
await open('/things/places/stickers');
check('the stickers have only the style choice, no stripe band', (await page.getByLabel('Print style').count()) === 1 && (await page.locator('.sticker-sheet .pf-bands').count()) === 0 && (await page.locator('.sticker-sheet.pf').count()) === 1);
await open('/things/stickers?blank=2');
check('the thing stickers too', (await page.getByLabel('Print style').count()) === 1 && (await page.locator('.sticker-sheet .pf-bands').count()) === 0);
await asScreen();

check('no page errors and no failed requests', bad.length === 0, bad.slice(0, 4).join(' | '));
await browser.close();
