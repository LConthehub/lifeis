// The house manual: written from ideas, with a private entry, and read by its link without signing in.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

await page.evaluate(() => fetch('/api/things/pets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rex', species: 'dog', food: 'Two cups, twice a day', vet_name: 'Oak Lane Vets', vet_phone: '555 0100' }) }));

await page.goto(`${base}/manual`); await page.waitForTimeout(1200);
check('the manual has its parts, each with ideas to start from', (await page.getByRole('group', { name: 'Ideas for In an emergency' }).innerText()).includes('Water shut-off'));
check('pets are there by themselves, with food and vet', (await page.getByRole('region', { name: 'Pets' }).innerText()).replace(/\s+/g, ' ').includes('Food: Two cups, twice a day Vet: Oak Lane Vets · 555 0100'));

const add = async (group, idea, fill) => {
  await page.getByRole('group', { name: `Ideas for ${group}` }).getByRole('button', { name: `+ ${idea}` }).click(); await page.waitForTimeout(400);
  const form = page.getByRole('dialog');
  await fill(form);
  await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1000);
};
await add('In an emergency', 'Water shut-off', async (form) => {
  await form.getByLabel('What to know').fill('Red lever behind the boiler.\nTurn it a quarter.');
  await form.getByLabel('Where it is').selectOption('new');
  await form.getByLabel('The new place').fill('Basement › Boiler cupboard');
  await form.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
});
await add('Who to call', 'Plumber', async (form) => { await form.getByLabel('A phone number').fill('555 0142'); await form.getByLabel('Anything to know about them').fill('Ask for Dana'); });
await add('How the house works', 'Alarm', async (form) => { await form.getByLabel('What to know').fill('Code 4821'); await form.getByLabel(/Private/).check(); });

const emergency = (await page.getByRole('region', { name: 'In an emergency' }).innerText()).replace(/\s+/g, ' ');
check('an entry says what to know and where it is', emergency.includes('Water shut-off') && emergency.includes('Basement › Boiler cupboard') && emergency.includes('Turn it a quarter'), emergency.slice(0, 160));
check('an idea that is written is no longer offered', !(await page.getByRole('group', { name: 'Ideas for In an emergency' }).innerText()).includes('Water shut-off'));
check('a phone number can be tapped', await page.locator('a[href="tel:5550142"]').isVisible());
check('a private entry says it stays off the link', (await page.getByRole('region', { name: 'How the house works' }).innerText()).includes('private: not on the shared link'));
await page.screenshot({ path: `${shots}/manual.png`, fullPage: true });

const sharing = page.getByRole('region', { name: 'Sharing' });
check('sharing is off until asked for', (await sharing.innerText()).includes('Off'));
await sharing.getByLabel('How long the link works').selectOption('3');
await sharing.getByRole('button', { name: 'Make the link' }).click(); await page.waitForTimeout(1200);
const link = await sharing.getByLabel('The link').inputValue();
check('a link is made, saying what is left out', /\/m\/[0-9a-f]{64}$/.test(link) && (await sharing.innerText()).includes('1 private entry is left out'), link.slice(0, 40));

// Someone with the link, and no sign-in at all.
const guest = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
const answer = await guest.goto(link); await guest.waitForTimeout(600);
const seen = (await guest.locator('body').innerText()).replace(/\s+/g, ' ');
check('the link opens with no sign-in', answer.status() === 200 && seen.includes('House manual') && seen.includes('Water shut-off') && seen.includes('Where: Basement › Boiler cupboard'), seen.slice(0, 140));
check('it has the plumber and the pets, and not the alarm code', seen.includes('555 0142') && seen.includes('Rex') && seen.includes('Two cups, twice a day') && !seen.includes('4821') && !seen.includes('Alarm'));
check('nothing else of Life Is opens for them', (await guest.request.get(`${base}/api/manual`)).status() === 401);
check('and the page itself can fetch nothing', await guest.evaluate(() => fetch('/api/health').then(() => false).catch(() => true)));
await guest.screenshot({ path: `${shots}/manual-shared.png`, fullPage: true });

await sharing.getByRole('button', { name: 'Turn it off' }).click(); await page.waitForTimeout(1000);
check('turned off, the link stops working', (await guest.goto(link)).status() === 404);
await browser.close();
