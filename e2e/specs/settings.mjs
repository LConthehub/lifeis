import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const browser = await chromium.launch({ ...browserChoice, headless: true });
const bad = [];
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const EXPECTED = ['your-name', 'life', 'tags', 'mail-page', 'look', 'reminders', 'calendar-link', 'other-calendars', 'assistant', 'ai-apps', 'weather', 'mail', 'bank', 'lookups', 'recalls', 'photos', 'media', 'recipe-web', 'idle', 'password', 'security', 'keys', 'people', 'sign-out', 'last-copy', 'your-files', 'recipes-out'];

async function signedIn(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') bad.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(base + '/'); await page.waitForTimeout(1000);
  await page.getByRole('textbox').first().fill('ana');
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }
  return page;
}

// ---------- a wide screen ----------
const wide = await signedIn(1200, 900);
await wide.goto(base + '/settings'); await wide.waitForTimeout(1500);
const menu = wide.getByRole('navigation', { name: 'Settings' });
const groups = await menu.getByRole('link').allInnerTexts();
say('a menu of groups beside the settings: ' + groups.map((g) => g.trim()).join(' | '), groups.length === 6);
say('the menu never says AI', !/\bAI\b/.test(await menu.innerText()));
say('the first group shows by itself, not the whole long page', (await wide.locator('[data-settings-group] > div[id]').count()) === 5);
const found = [];
for (let i = 0; i < groups.length; i += 1) {
  await menu.getByRole('link').nth(i).click(); await wide.waitForTimeout(1200);
  if (await wide.locator('[data-settings-more]').isVisible()) { await wide.locator('[data-settings-more]').click(); await wide.waitForTimeout(800); }
  found.push(...await wide.locator('[data-settings-group] > div[id]').evaluateAll((all) => all.map((d) => d.id)));
}
say('every setting from the old page is still there: ' + found.length, EXPECTED.every((id) => found.includes(id)) && found.length === EXPECTED.length);
await wide.goto(base + '/settings/connections'); await wide.waitForTimeout(1500);
say('Connections ends with a More button, and says nothing of AI until it is pressed', await wide.locator('[data-settings-more]').isVisible() && !/\bAI\b/.test(await wide.locator('main').innerText()));
const jump = wide.locator('[data-settings-jump]');
say('a long group has links to its parts at the top', (await jump.getByRole('link').count()) === 7 && !/AI assistant/.test(await jump.innerText()));
await jump.getByRole('link', { name: 'Recall alerts' }).click(); await wide.waitForTimeout(1200);
say('a link there goes to that part', wide.url().endsWith('/settings/connections#recalls') && await wide.locator('#recalls').isVisible());
await wide.screenshot({ path: shots + '/settings-wide.png', fullPage: true });
await menu.getByLabel('Find a setting').fill('ollama');
const hit = menu.getByRole('button', { name: /AI assistant/ });
say('the search finds a setting by what it is about', await hit.isVisible());
await hit.click(); await wide.waitForTimeout(1500);
say('and goes to it: ' + new URL(wide.url()).pathname + new URL(wide.url()).hash, wide.url().endsWith('/settings/connections#assistant') && await wide.locator('[data-assistant-settings]').isVisible());
await wide.goto(base + '/settings#calendar-link'); await wide.waitForTimeout(1500);
say('an old link to a section still finds it: ' + new URL(wide.url()).pathname, wide.url().includes('/settings/calendars#calendar-link') && await wide.locator('#calendar-link').isVisible());

// A name of their own: kept, trimmed, limited to 40, and empty goes back to the sign-in name.
await wide.goto(base + '/settings'); await wide.waitForTimeout(1200);
const nameBox = wide.locator('#your-name');
await nameBox.locator('input').fill('  ' + 'x'.repeat(60) + '  ');
say('the name box stops at 40 characters', (await nameBox.locator('input').inputValue()).length === 40);
await nameBox.locator('input').fill('  Sam  ');
await nameBox.getByRole('button', { name: 'Save' }).click(); await wide.waitForTimeout(900);
say('a saved name is trimmed and kept: ' + await nameBox.locator('input').inputValue(), (await nameBox.locator('input').inputValue()) === 'Sam');
say('the sign-in name is still shown as it was', /Signed in as\s+ana/.test((await wide.locator('main').innerText()).replace(/\s+/g, ' ')));
await wide.reload(); await wide.waitForTimeout(1200);
say('it is still there after a reload', (await wide.locator('#your-name input').inputValue()) === 'Sam');
await wide.locator('#your-name input').fill('   ');
await wide.locator('#your-name').getByRole('button', { name: 'Save' }).click(); await wide.waitForTimeout(900);
say('empty goes back to the sign-in name', /uses your sign-in name/.test(await wide.locator('#your-name').innerText()));

// ---------- a phone ----------
const phone = await signedIn(390, 844);
await phone.goto(base + '/settings'); await phone.waitForTimeout(1500);
const list = phone.locator('[data-settings-groups]');
say('on a phone, a list of groups to tap into', (await list.getByRole('link').count()) === 6 && !/\bAI\b/.test(await phone.locator('main').innerText()) && (await phone.locator('[data-settings-group] > div[id]').isVisible().catch(() => false)) === false);
await phone.screenshot({ path: shots + '/settings-phone-list.png' });
await list.getByRole('link', { name: /Account/ }).click(); await phone.waitForTimeout(1500);
say('tapping one opens it, with a way back', /Password/.test(await phone.locator('main').innerText()) && await phone.getByRole('link', { name: '‹ All settings' }).isVisible());
await phone.screenshot({ path: shots + '/settings-phone-group.png' });
const width = await phone.evaluate(() => document.documentElement.scrollWidth);
say('nothing runs off the side of the phone: ' + width, width <= 390);
await phone.getByRole('link', { name: '‹ All settings' }).click(); await phone.waitForTimeout(800);
say('and back to the list', await list.isVisible());
await phone.goto(base + '/settings/connections'); await phone.waitForTimeout(1500);
const chips = await phone.locator('[data-settings-jump] a').evaluateAll((all) => all.map((a) => a.getBoundingClientRect().height));
say('on a phone the links to the parts are big enough to tap: ' + chips.join(','), chips.length === 7 && chips.every((h) => h >= 44));
say('and nothing runs off the side: ' + await phone.evaluate(() => document.documentElement.scrollWidth), (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390);
await phone.screenshot({ path: shots + '/settings-phone-connections.png' });
await phone.locator('[data-settings-more]').scrollIntoViewIfNeeded(); await phone.waitForTimeout(400);
await phone.screenshot({ path: shots + '/settings-phone-more.png' });
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
