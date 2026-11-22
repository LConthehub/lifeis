// Scanning fills in what it can: the offer to turn looking up on, then real answers from the services.
// Also the Ebooks and Audiobooks libraries.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

const scan = async (code) => {
  await page.goto(base + '/media'); await page.waitForTimeout(700);
  await page.getByRole('button', { name: '📷 Scan a barcode' }).click(); await page.waitForTimeout(600);
  const box = page.getByRole('dialog');
  await box.getByLabel('Or type the number under the bars').fill(code);
  await box.getByRole('button', { name: 'Find' }).click(); await page.waitForTimeout(2500);
  return box;
};

// A book, with looking books up still off: the offer is right there.
let box = await scan('9780441172719');
check('off: offers to turn book look-ups on', await box.getByRole('button', { name: 'Turn that on and look it up' }).isVisible());
await page.screenshot({ path: `${shots}/scan-offer.png` });
await box.getByRole('button', { name: 'Turn that on and look it up' }).click(); await page.waitForTimeout(4000);
const said = await box.locator('[data-found]').innerText().catch(() => '');
check('Open Library answered', said.includes('Dune'), said.replace(/\s+/g, ' '));
await page.screenshot({ path: `${shots}/scan-book.png` });
await box.getByRole('button', { name: 'Add it' }).click(); await page.waitForTimeout(700);
const form = page.getByRole('dialog');
check('the form starts filled in', (await form.getByLabel('Title *').inputValue()).includes('Dune') && (await form.getByLabel('Author').inputValue()).length > 0,
  `${await form.getByLabel('Title *').inputValue()} / ${await form.getByLabel('Author').inputValue()} / genres: ${await form.getByLabel('Genres, with commas between').inputValue()}`);
await form.getByLabel("What it's on *").fill('Paperback');
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1200);

// The same barcode again goes straight to it.
await scan('9780441172719');
check('scanning it again opens it', /\/media\/\d+$/.test(page.url()), page.url());

// An album and a film: off at first, turned on from the scan.
box = await scan('634904052126');
if (await box.getByRole('button', { name: 'Turn that on and look it up' }).isVisible().catch(() => false)) {
  check('off: offers to turn film, music and game look-ups on', true);
  await box.getByRole('button', { name: 'Turn that on and look it up' }).click(); await page.waitForTimeout(5000);
}
const album = (await box.locator('[data-found]').innerText().catch(() => '')) || (await box.innerText());
check('an album was looked up', /music|🎵/i.test(album) || album.includes('says'), album.replace(/\s+/g, ' ').slice(0, 160));
await page.screenshot({ path: `${shots}/scan-album.png` });

box = await scan('883929106509');
const film = (await box.locator('[data-found]').innerText().catch(() => '')) || (await box.innerText());
results.push(`INFO a film's barcode — ${film.replace(/\s+/g, ' ').slice(0, 160)}`);

// The libraries.
await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await post('/api/media', { type: 'book', title: 'Project Hail Mary', copy: { format: 'Audiobook' } });
  await post('/api/media', { type: 'book', title: 'The Martian', copy: { format: 'Kindle' } });
  const both = await post('/api/media', { type: 'book', title: 'Piranesi', copy: { format: 'Hardcover' } });
  await post(`/api/media/${both.id}/copies`, { format: 'Audiobook' });
});
const shelf = async (path) => { await page.goto(base + path); await page.waitForTimeout(800); return page.locator('main li').allInnerTexts(); };
const books = (await shelf('/media/books')).join('|');
const ebooks = (await shelf('/media/ebooks')).join('|');
const audio = (await shelf('/media/audiobooks')).join('|');
await page.screenshot({ path: `${shots}/library-audiobooks.png` });
check('Books has paper ones only', books.includes('Piranesi') && books.includes('Dune') && !books.includes('Hail Mary') && !books.includes('Martian'), books.replace(/\s+/g, ' '));
check('Ebooks has the Kindle one', ebooks.includes('Martian') && !ebooks.includes('Piranesi'), ebooks.replace(/\s+/g, ' '));
check('Audiobooks has both audio ones', audio.includes('Hail Mary') && audio.includes('Piranesi') && !audio.includes('Martian'), audio.replace(/\s+/g, ' '));
await page.getByRole('button', { name: '+ Add' }).click(); await page.waitForTimeout(500);
check('adding from Audiobooks starts as an audiobook', (await page.getByRole('dialog').getByLabel("What it's on").inputValue()) === 'Audiobook');

console.log(results.join('\n'));
await browser.close();
