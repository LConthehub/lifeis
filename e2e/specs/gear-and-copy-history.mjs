// A project shows the gear for its activity; a copy in the collection shows where it has been.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);

const ids = await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const project = await post('/api/projects', { name: 'Bedtime reading', activity: 'reading' });
  const media = await fetch('/api/media').then((r) => r.json());
  const dune = await fetch(`/api/media/${media.find((m) => m.title.startsWith('Dune')).id}`).then((r) => r.json());
  const places = await fetch('/api/things/places').then((r) => r.json());
  await post(`/api/media/copies/${dune.copies[0].id}/move`, { place_id: places.find((p) => p.name === 'Living room').id });
  return { project: project.id, dune: dune.id };
});
await page.goto(`${base}/projects/${ids.project}`); await page.waitForTimeout(1000);
const gear = await page.getByRole('region', { name: 'Gear for reading' }).innerText().catch(() => '');
check('a project lists the gear for its activity, whatever its case', gear.includes('Reading lamp') && gear.includes('Bookshelf'), gear.replace(/\s+/g, ' '));
await page.goto(`${base}/media/${ids.dune}`); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'History' }).first().click(); await page.waitForTimeout(800);
const copy = await page.getByRole('dialog').innerText();
check("a copy's history shows its moves", copy.includes("Moved from Son's room › Bookshelf to Living room") && copy.includes('Added, in'), copy.replace(/\s+/g, ' '));
await browser.close();
