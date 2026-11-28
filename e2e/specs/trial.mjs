import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 900 } });
const page = await context.newPage();
const bad = [];
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = () => page.locator('body').innerText();
const note = () => page.locator('[data-access]').first();
const firstRun = async (patience = 6000) => {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: patience }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    // A brand-new person is met by the two-minute start; the full checklist is one step in.
    // The first question (what bugs you most) comes before the steps: Next passes it by.
    for (let i = 0; i < 3 && await dialog.getByRole('button', { name: 'Choose everything myself' }).isVisible().catch(() => false) === false && await dialog.getByRole('button', { name: 'Next', exact: true }).isVisible().catch(() => false); i += 1) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click(); await wait(800);
    }
    if (await dialog.getByRole('button', { name: 'Choose everything myself' }).isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Choose everything myself' }).click(); await wait(800); }
    await dialog.getByText('Cooking and groceries', { exact: true }).first().click();
    await dialog.getByText('Projects', { exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Set up Life Is', exact: true }).click(); await wait(2000);
  }
};

await page.goto(base + '/'); await wait(1500);
await page.getByRole('button', { name: /Start on this phone/ }).click(); await wait(2500);
await firstRun();

// ---------- before anything is written ----------
await page.goto(base + '/recipes'); await wait(1200);
say('the kitchen carries no note about paying', (await page.locator('[data-access]').count()) === 0);
await page.goto(base + '/projects'); await wait(1200);
say('projects say they are free to try, from the first thing added: ' + (await note().getAttribute('data-access')), (await note().getAttribute('data-access')) === 'unstarted' && /free to try for 7 days/.test(await text()) && /\$14\.99, once/.test(await text()));

// ---------- a project and its budget ----------
await page.getByRole('button', { name: /\+ New/ }).click(); await wait(400);
let form = page.getByRole('dialog');
await form.getByLabel('What it is *').fill('Shirt dress');
await form.getByRole('button', { name: /Save|Add|Create/ }).first().click(); await wait(1800);
if (!/What it costs/.test(await text())) { await page.getByRole('link', { name: 'Shirt dress' }).first().click(); await wait(1200); }
say('writing the first thing starts the trial: ' + (await note().getAttribute('data-access')), (await note().getAttribute('data-access')) === 'trial' && /7 days left/.test(await text()));
const budget = page.locator('[data-budget]');
const add = async (what, cost) => {
  await budget.getByLabel('What the money is for').fill(what);
  await budget.getByLabel('Planned cost').fill(cost);
  await budget.getByRole('button', { name: 'Add' }).click(); await wait(700);
};
await add('Linen, 3 yd', '45');
await add('Buttons', '8.00');
let totals = (await page.locator('[data-budget-totals]').innerText()).replace(/\s+/g, ' ');
say('the budget adds up what is planned: ' + totals, /Planned \$53\.00/.test(totals) && /Spent so far \$0\.00/.test(totals) && /Left \$0\.00/.test(totals));
await budget.getByRole('button', { name: 'Mark paid' }).first().click(); await wait(300);
await budget.getByLabel('What Linen, 3 yd came to').fill('52');
await budget.getByRole('button', { name: 'Paid', exact: true }).click(); await wait(800);
totals = (await page.locator('[data-budget-totals]').innerText()).replace(/\s+/g, ' ');
say('paying more than planned shows it running over: ' + totals, /Spent so far \$52\.00/.test(totals) && /Over by \$7\.00/.test(totals) && /planned \$45\.00/.test(await budget.innerText()));
await page.screenshot({ path: shots + '/app-project-budget.png', fullPage: true });
await page.evaluate(() => window.lifeisDevice.saved());

// ---------- fifteen days later ----------
const moved = await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) if (key.includes('trial_started')) { localStorage.setItem(key, JSON.stringify(new Date(Date.now() - 15 * 86400000).toISOString())); return key; }
  return null;
});
console.log('   (the trial is made to have begun 15 days ago: ' + moved + ')');
await page.reload(); await wait(2500);
say('after the trial the project is all still there to read: ' + (await note().getAttribute('data-access')), (await note().getAttribute('data-access')) === 'ended' && /Linen, 3 yd/.test(await text()) && /Buttons/.test(await text()) && /still here to read/.test(await text()));
await add('Zip', '4');
say('but changing it is refused, in words', /free trial of this part of Life Is has ended/.test(await budget.innerText()) && !/Zip/.test(await page.locator('[data-budget] ul').innerText()));
await page.screenshot({ path: shots + '/app-trial-ended.png', fullPage: true });
await page.goto(base + '/recipes'); await wait(1200);
await page.getByRole('button', { name: '+ New' }).click(); await wait(400);
form = page.getByRole('dialog');
await form.getByLabel('Name *').fill('Still free soup');
await form.getByLabel(/^Ingredients/).fill('3 leeks');
await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
say('the kitchen still works as before', /Still free soup/.test(await text()));
await page.goto(base + '/settings/data'); await wait(1500);
const card = page.locator('[data-access]').filter({ hasText: 'Unlock' }).first();
say('settings say plainly where things stand', (await card.getAttribute('data-access')) === 'ended' && /Nothing you entered has been hidden or removed/.test(await card.innerText()) && /free for good/.test(await card.innerText()));
say('and a backup can still be made', await page.getByRole('button', { name: 'Make a backup' }).isVisible());
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
