// Pets: a profile, care picked from what suits them, done from their page, a weight, and found by search.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

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

await page.goto(`${base}/things/pets`); await page.waitForTimeout(1000);
check('Pets explains itself when empty', (await page.locator('main').innerText()).includes('their vet and microchip number'));
await page.getByRole('button', { name: '+ Add a pet' }).click(); await page.waitForTimeout(500);
const form = page.getByRole('dialog');
await form.getByLabel('Their name *').fill('Rex');
await form.getByLabel('What they are').fill('Dog');
await form.getByLabel('Breed').fill('Border collie');
await form.getByLabel('Born (a guess is fine)').fill('2021-06-01');
await form.getByLabel('Vet', { exact: true }).fill('Oak Lane Vets');
await form.getByLabel("Vet's phone").fill('555 0100');
await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1500);
check('a new pet opens on their own page', /\/things\/pets\/\d+$/.test(page.url()), page.url());
const top = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
check('it shows who they are and their vet, with a number to tap', top.includes('Border collie · Dog · 5 years') && top.includes('Oak Lane Vets') && await page.locator('a[href="tel:5550100"]').isVisible(), top.slice(0, 160));

const offered = (await page.getByRole('group', { name: 'Care to add' }).innerText()).replace(/\s+/g, ' ');
check('care suited to a dog is offered', offered.includes('Heartworm prevention') && !offered.includes('litter box'), offered.slice(0, 160));
await page.getByRole('group', { name: 'Care to add' }).getByRole('button', { name: '+ Vaccinations' }).click(); await page.waitForTimeout(500);
await page.getByRole('dialog').getByLabel(/Last done/).fill('2020-01-01');
await page.getByRole('dialog').getByRole('button', { name: 'Add it' }).click(); await page.waitForTimeout(1500);
const care = page.getByRole('region', { name: 'Care' });
check('the care is theirs, and late', (await care.innerText()).includes('Vaccinations') && (await care.locator('[data-state]').first().getAttribute('data-state')) === 'overdue');
check('it is not offered a second time', !(await page.getByRole('group', { name: 'Care to add' }).innerText()).includes('Vaccinations'));
await care.getByRole('button', { name: 'Vaccinations done' }).click(); await page.waitForTimeout(1500);
check('done from their page, the next is a year off', (await care.locator('[data-state]').first().getAttribute('data-state')) === 'later');

const weight = page.getByRole('region', { name: 'Weight' });
await weight.getByLabel('Weight today').fill('43'); await weight.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(900);
await weight.getByLabel('Weight today').fill('44.5'); await weight.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(900);
check('weights are kept, with the change since the last', (await weight.innerText()).replace(/\s+/g, ' ').includes('44.5 lb (up 1.5 since'), (await weight.innerText()).replace(/\s+/g, ' ').slice(0, 80));
await page.screenshot({ path: `${shots}/pet.png`, fullPage: true });

await page.goto(`${base}/things/upkeep`); await page.waitForTimeout(1000);
check('their care is in Upkeep with everything else', (await page.locator('main').innerText()).includes('Rex: Vaccinations'));
await page.goto(`${base}/things/pets`); await page.waitForTimeout(1000);
check('the list shows each pet and what is next', (await page.locator('main').innerText()).replace(/\s+/g, ' ').includes('Rex Border collie · 5 years Vaccinations: in 36'), (await page.locator('main li').first().innerText()).replace(/\s+/g, ' '));
await page.keyboard.press('/'); await page.waitForTimeout(300);
await page.getByLabel('Search everything', { exact: true }).fill('collie'); await page.waitForTimeout(1200);
check('search finds a pet by breed', (await page.getByRole('list', { name: 'What was found' }).innerText()).includes('Rex'));
await browser.close();
