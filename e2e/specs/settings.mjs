import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const browser = await chromium.launch({ ...browserChoice, headless: true });
const bad = [];
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const EXPECTED = ['life', 'reminders', 'calendar-link', 'other-calendars', 'assistant', 'weather', 'mail', 'lookups', 'photos', 'media', 'recipe-web', 'idle', 'password', 'people', 'sign-out', 'recipes-out'];

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
say('the first group shows by itself, not the whole long page', (await wide.locator('[data-settings-group] > div[id]').count()) === 1);
const found = [];
for (let i = 0; i < groups.length; i += 1) {
  await menu.getByRole('link').nth(i).click(); await wide.waitForTimeout(1200);
  found.push(...await wide.locator('[data-settings-group] > div[id]').evaluateAll((all) => all.map((d) => d.id)));
}
say('every setting from the old page is still there: ' + found.length, EXPECTED.every((id) => found.includes(id)) && found.length === EXPECTED.length);
await menu.getByRole('link', { name: /Connections/ }).click(); await wide.waitForTimeout(1500);
await wide.screenshot({ path: shots + '/settings-wide.png', fullPage: true });
await menu.getByLabel('Find a setting').fill('ollama');
const hit = menu.getByRole('button', { name: /AI assistant/ });
say('the search finds a setting by what it is about', await hit.isVisible());
await hit.click(); await wide.waitForTimeout(1500);
say('and goes to it: ' + new URL(wide.url()).pathname + new URL(wide.url()).hash, wide.url().endsWith('/settings/connections#assistant'));
await wide.goto(base + '/settings#calendar-link'); await wide.waitForTimeout(1500);
say('an old link to a section still finds it: ' + new URL(wide.url()).pathname, wide.url().includes('/settings/calendars#calendar-link') && await wide.locator('#calendar-link').isVisible());

// ---------- a phone ----------
const phone = await signedIn(390, 844);
await phone.goto(base + '/settings'); await phone.waitForTimeout(1500);
const list = phone.locator('[data-settings-groups]');
say('on a phone, a list of groups to tap into', (await list.getByRole('link').count()) === 6 && (await phone.locator('[data-settings-group] > div[id]').isVisible().catch(() => false)) === false);
await phone.screenshot({ path: shots + '/settings-phone-list.png' });
await list.getByRole('link', { name: /Account/ }).click(); await phone.waitForTimeout(1500);
say('tapping one opens it, with a way back', /Password/.test(await phone.locator('main').innerText()) && await phone.getByRole('link', { name: '‹ All settings' }).isVisible());
await phone.screenshot({ path: shots + '/settings-phone-group.png' });
const width = await phone.evaluate(() => document.documentElement.scrollWidth);
say('nothing runs off the side of the phone: ' + width, width <= 390);
await phone.getByRole('link', { name: '‹ All settings' }).click(); await phone.waitForTimeout(800);
say('and back to the list', await list.isVisible());
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
