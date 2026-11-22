import { browserChoice } from '../browser.mjs';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'a trial passphrase 4179';

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const bad = [];
const elsewhere = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.host !== new URL(base).host) elsewhere.push(u.host); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = () => page.locator('body').innerText();
const firstRun = async (patience = 6000) => {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: patience }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByText('Cooking and groceries', { exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2000);
  }
};
const addRecipe = async (name) => {
  await page.goto(base + '/recipes'); await wait(1200);
  await firstRun(2500);
  await page.getByRole('button', { name: '+ New' }).click(); await wait(400);
  const form = page.getByRole('dialog');
  await form.getByLabel('Name *').fill(name);
  await form.getByLabel(/^Ingredients/).fill('2 eggs');
  await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
};

await page.goto(base + '/'); await wait(1500);
await page.getByRole('button', { name: /On this phone/ }).click(); await wait(2500);
await firstRun();
await addRecipe('Kept omelette');

// ---------- making one ----------
await page.goto(base + '/settings/data'); await wait(1200);
say('settings offer a backup, and say no copies are made otherwise', /A backup you hold/.test(await text()) && /makes no copies of itself/.test(await text()));
await page.getByRole('button', { name: 'Make a backup' }).click(); await wait(300);
await page.getByLabel('A passphrase for this backup').fill(PASS);
await page.getByLabel('The same passphrase again').fill(PASS + 'x');
await page.getByRole('button', { name: 'Make the backup' }).click(); await wait(500);
say('two passphrases that differ are refused', /aren't the same/.test(await text()));
await page.getByLabel('The same passphrase again').fill(PASS);
await page.screenshot({ path: shots + '/app-backup.png', fullPage: true });
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Make the backup' }).click()]);
const file = shots + '/' + download.suggestedFilename();
await download.saveAs(file);
const bytes = readFileSync(file);
const seen = bytes.toString('latin1');
say(`a file is handed over: ${download.suggestedFilename()}, ${bytes.length} bytes`, /^life-is-backup-\d{4}-\d\d-\d\d\.lifeis$/.test(download.suggestedFilename()) && bytes.length > 200);
say('and nothing in it can be read', seen.startsWith('LIFEIS-BACKUP-1\n') && !/omelette|eggs|recipes/i.test(seen));

// ---------- bringing it back ----------
await addRecipe('Written afterwards');
await page.goto(base + '/settings/data'); await wait(1200);
await page.getByRole('button', { name: 'Bring a backup back' }).click(); await wait(300);
say('it warns that what is here will be replaced', /replaces everything on this device/.test(await text()));
await page.getByLabel('The backup file').setInputFiles(file);
await page.getByLabel('Its passphrase').fill('not the passphrase');
await page.getByRole('button', { name: 'Replace what is here' }).click(); await wait(2500);
say('the wrong passphrase is refused in words', /doesn't open this backup/.test(await text()));
await page.goto(base + '/recipes'); await wait(1200);
say('and nothing was changed by the refusal', /Written afterwards/.test(await text()) && /Kept omelette/.test(await text()));
await page.goto(base + '/settings/data'); await wait(1200);
await page.getByRole('button', { name: 'Bring a backup back' }).click(); await wait(300);
await page.getByLabel('The backup file').setInputFiles(file);
await page.getByLabel('Its passphrase').fill(PASS);
await page.getByRole('button', { name: 'Replace what is here' }).click(); await wait(4000);
await page.goto(base + '/recipes'); await wait(1500);
let t = await text();
say('with the right one, the device holds what the backup held', /Kept omelette/.test(t) && !/Written afterwards/.test(t));
await page.reload(); await wait(1500);
t = await text();
say('and still does after closing and opening', /Kept omelette/.test(t) && !/Written afterwards/.test(t));
say('none of it asked anywhere else for anything: ' + JSON.stringify([...new Set(elsewhere)]), elsewhere.length === 0);
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
