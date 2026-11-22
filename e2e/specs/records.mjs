// Home records: a thing's cost, serial and warranty, a receipt kept with it, and the home inventory.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const receipt = path.join(mkdtempSync(path.join(tmpdir(), 'lifeis-paper-')), 'Costco receipt.pdf');
writeFileSync(receipt, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

const soon = new Date(Date.now() + 20 * 86400000);
const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
const tv = await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await post('/api/things/kinds', { name: 'Appliances', icon: '📺' }))[0].id;
  const living = (await post('/api/things/places', { name: 'Living room' }))[0].id;
  await post('/api/things/items', { kind_id: kind, name: 'Old kettle' });
  return (await post('/api/things/items', { kind_id: kind, name: 'Television', place_id: living })).id;
});

await page.goto(`${base}/things/${tv}`); await page.waitForTimeout(1200);
const card = page.getByRole('region', { name: 'Records' });
check('a thing has a Records card that says what it is for', (await card.innerText()).includes('what an insurer or a repair shop asks for'));
await card.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(400);
await card.getByLabel('Bought at').fill('Costco');
await card.getByLabel('What it cost').fill('799');
await card.getByLabel('Worth now (if different)').fill('500');
await card.getByLabel('Model').fill('QN55');
await card.getByLabel('Serial number').fill('SN-12345');
await card.getByLabel('Warranty until').fill(day);
await card.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1200);
const shown = (await card.innerText()).replace(/\s+/g, ' ');
check('its records show: cost, worth, numbers and warranty', ['Costco', '$799.00', '$500.00', 'QN55', 'SN-12345', 'Warranty ends in 20 days'].every((t) => shown.includes(t)), shown.slice(0, 220));

await card.getByLabel("The paper's file").setInputFiles(receipt); await page.waitForTimeout(1500);
const papers = (await card.getByRole('list', { name: 'Papers' }).innerText().catch(() => '')).replace(/\s+/g, ' ');
check('a receipt is kept with it', papers.includes('Costco receipt.pdf'), papers);
const paper = await page.evaluate(async (id) => { const list = await fetch(`/api/things/items/${id}/documents`).then((r) => r.json()); const r = await fetch(`/api/things/documents/${list[0].id}`); return [r.status, r.headers.get('content-type'), (await r.text()).slice(0, 8)]; }, tv);
check('and comes back as it was sent', paper[0] === 200 && paper[1] === 'application/pdf' && paper[2] === '%PDF-1.4', JSON.stringify(paper));
await page.screenshot({ path: `${shots}/records-thing.png`, fullPage: true });

await page.goto(`${base}/things`); await page.waitForTimeout(1000);
await page.getByRole('link', { name: '🏠 Home inventory' }).click(); await page.waitForTimeout(1500);
const sheet = (await page.getByLabel('The inventory').innerText()).replace(/\s+/g, ' ');
check('the inventory totals what is kept and what has proof', sheet.includes('2 things · worth $500.00 in all · 0 with a photo · 1 with a receipt'), (await page.locator('[data-totals]').innerText()));
check('it goes room by room, with the serial number', /Living room \$500\.00/.test(sheet) && sheet.includes('S/N SN-12345') && sheet.includes('No place yet'), sheet.slice(0, 260));
check('it says how many things still need a value', (await page.locator('main').innerText()).includes('1 of your 2 things has no price or value yet'));
check('warranties ending soon are listed', (await page.getByRole('region', { name: 'Warranties ending soon' }).innerText()).includes('Television'));
await page.screenshot({ path: `${shots}/records-inventory.png`, fullPage: true });

await page.keyboard.press('/'); await page.waitForTimeout(300);
await page.getByLabel('Search everything', { exact: true }).fill('SN-12345'); await page.waitForTimeout(1200);
check('search finds a thing by its serial number', (await page.getByRole('list', { name: 'What was found' }).innerText()).includes('Television'));
await browser.close();
