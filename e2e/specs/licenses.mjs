// Licenses and permits: one added with its number hidden until asked for, a reminder that is a renewal in Upkeep and follows the expiry day, a passport from the ready-made list, removing one with its reminder, and a phone.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const NUMBER = 'D123-4567-8901';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** A day some months before another, the 31st a month back being that month's last day. */
const monthsBefore = (text, months) => {
  const [y, m, d] = text.split('-').map(Number);
  const total = m - 1 - months;
  const year = y + Math.floor(total / 12); const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
await context.addInitScript(() => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
});
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
const api = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }
await api('POST', '/api/things/upkeep/members', { name: 'Dana' });

await page.goto(`${base}/things/licenses`); await wait(1000);
check('Licenses is a tab of the organized section, after Upkeep', (await page.locator('nav a').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).join('|').includes('Upkeep|🪪 Licenses'), (await page.locator('nav a').allInnerTexts()).join('|').replace(/\s+/g, ' ').slice(0, 160));
check('it says what belongs here when empty', (await main()).includes("Driver's licenses, passports, fishing and professional licenses"));

// A driver's license for someone in the household, with a number, running out in 20 days.
await page.getByRole('button', { name: '+ Add a license' }).click(); await wait(500);
const form = page.getByRole('dialog');
await form.getByRole('group', { name: 'Ready-made licenses' }).getByRole('button', { name: "Driver's license" }).click();
check('a ready-made one fills what is the same everywhere and leaves the term to the state', (await form.getByLabel('Kind').inputValue()) === 'Driving' && (await form.getByLabel('Issued by').inputValue()) === 'Your state DMV' && (await form.getByLabel('Term in years').inputValue()) === '' && (await form.getByLabel('Notes').inputValue()).includes('Your state sets how long it lasts'));
await form.getByLabel('Whose it is').fill('Dana');
await form.getByLabel('Number').fill(NUMBER);
await form.getByLabel('Issued by').fill('State DMV');
await form.getByLabel('Runs out on').fill(day(20));
await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
let text = await main();
const banner = page.getByRole('status', { name: 'Licenses running out' });
check('a banner says it runs out soon', (await banner.innerText()).replace(/\s+/g, ' ').includes("Dana's driver's license runs out in 20 days"), (await banner.innerText()).replace(/\s+/g, ' '));
check('it is listed under Dana, with when it runs out', /Dana Driver's license Driving Runs out in 20 days/.test(text), text.slice(0, 200));
check('the number is hidden', !text.includes(NUMBER) && !(await page.content()).includes(NUMBER));
await page.getByRole('button', { name: "Show the number for Dana's driver's license" }).click(); await wait(600);
check('Show number shows it', (await page.locator('[data-license-number]').innerText()) === NUMBER);
await page.getByRole('button', { name: "Copy the number for Dana's driver's license" }).click(); await wait(400);
check('and Copy copies exactly it', (await page.evaluate(() => window.__copied)).join() === NUMBER);
await page.getByRole('button', { name: "Hide the number for Dana's driver's license" }).click(); await wait(300);
check('Hide puts it away again', !(await main()).includes(NUMBER));

// "Remind me to renew": a renewal in Upkeep, 30 days before.
await page.getByRole('button', { name: "Remind me to renew Dana's driver's license" }).click(); await wait(700);
check('the button opens it with the reminder ticked, 30 days before', (await form.getByLabel('Remind me to renew').isChecked()) && (await form.getByLabel('How long before it runs out').inputValue()) === '30');
await form.getByLabel('Term in years').fill('4');
await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
text = await main();
check('a reminder is set, first due 30 days before it runs out', text.includes('Reminder set') && (await api('GET', '/api/things/licenses'))[0].reminder.due_on === day(-10), text.slice(0, 260));
await page.goto(`${base}/things/upkeep`); await wait(1200);
const upkeepText = await main();
check('it is in Upkeep as a renewal, late because 30 days before is already past', upkeepText.includes("Renew Dana's driver's license"), upkeepText.slice(0, 200));
const job = (await api('GET', '/api/things/licenses'))[0].reminder;
const detail = await api('GET', `/api/things/upkeep/${job.job_id}`);
check('with the right day, a term of 4 years and no number in it', detail.first_due === day(-10) && detail.kind === 'renewal' && detail.every.n === 4 && !JSON.stringify(detail).includes(NUMBER), `${detail.first_due} ${JSON.stringify(detail.every)}`);

// The expiry day changes; the reminder follows.
await page.goto(`${base}/things/licenses`); await wait(1000);
await page.getByRole('button', { name: "Change Dana's driver's license" }).click(); await wait(800);
check('the form says the reminder follows the expiry day', (await form.innerText()).includes('its due day follows this expiry day'));
check('the number is loaded to change it', (await form.getByLabel('Number').inputValue()) === NUMBER);
await form.getByLabel('Runs out on').fill(day(100));
await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
const moved = (await api('GET', '/api/things/licenses'))[0];
check('the reminder moved with it', moved.reminder.due_on === day(70) && (await main()).includes('Runs out in 3 months'), `${moved.reminder.due_on} (wanted ${day(70)})`);
check('and the banner is gone, as nothing is running out now', (await banner.count()) === 0);

// A passport from the ready-made list: 6 months of lead, and why.
await page.getByRole('button', { name: '+ Add a license' }).click(); await wait(500);
await form.getByRole('button', { name: 'Passport', exact: true }).click();
check('a passport is a Travel one from the State Department, 10 years', (await form.getByLabel('Kind').inputValue()) === 'Travel' && (await form.getByLabel('Issued by').inputValue()) === 'U.S. Department of State' && (await form.getByLabel('Term in years').inputValue()) === '10');
await form.getByLabel('Whose it is').fill('Dana');
await form.getByLabel('Runs out on').fill(day(400));
await form.getByLabel('Remind me to renew').check(); await wait(300);
check('the lead starts at 6 months, and the form says why', (await form.getByLabel('How long before it runs out').inputValue()) === '6' && (await form.getByLabel('Days, weeks or months').inputValue()) === 'month' && (await form.locator('[data-why]').innerText()).includes('6 months'));
await form.getByRole('button', { name: 'Save' }).click(); await wait(1800);
const passport = (await api('GET', '/api/things/licenses')).find((l) => l.name === 'Passport');
check('its renewal is first due 6 months before it runs out, then every 10 years', passport.reminder.due_on === monthsBefore(day(400), 6) && passport.reminder.term_years === 10 && passport.reminder.lead.n === 6, JSON.stringify(passport.reminder));
check('it is listed with Dana', /Dana[\s\S]*Passport/.test(await page.locator('main').innerText()));

// A license that already ran out is warned about in the banner.
await api('POST', '/api/things/licenses', { name: 'Fishing license', category: 'Outdoors', expires_on: day(-12) });
await page.reload(); await wait(1200);
check('one that ran out says so', (await banner.innerText()).replace(/\s+/g, ' ').includes('Fishing license ran out 12 days ago') && (await main()).includes('Ran out 12 days ago'), (await banner.innerText()).replace(/\s+/g, ' '));
check('the household list comes after the named ones', /Dana[\s\S]*Household[\s\S]*Fishing license/.test(await page.locator('main').innerText()));
await page.setViewportSize({ width: 1280, height: 900 }); await wait(500);
await page.screenshot({ path: `${shots}/licenses.png`, fullPage: true });

// Renewing in Upkeep does not change the license; it says to update the day.
await page.setViewportSize({ width: 393, height: 852 });
await api('POST', `/api/things/upkeep/${job.job_id}/done`, {});
await page.reload(); await wait(1200);
check('a renewal done in Upkeep leaves the license alone and asks for the new expiry day', (await main()).includes('Renewed? Update the new expiry day.') && (await api('GET', '/api/things/licenses')).find((l) => l.name === "Driver's license").expires_on === day(100));
await page.getByRole('button', { name: 'Change it' }).click(); await wait(600);
await form.getByLabel('Runs out on').fill(day(100 + 1461));
await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
check('moving the day clears it', !(await main()).includes('Renewed? Update'));

// Removing one, with its reminder.
await page.getByRole('button', { name: "Remove Dana's driver's license" }).click(); await wait(500);
check('it asks about the reminder', (await form.innerText()).includes('reminder to renew in Upkeep'));
await form.getByRole('button', { name: 'Remove both' }).click(); await wait(1500);
check('the license is gone', !(await main()).includes("Driver's license"));
check('and so is its renewal in Upkeep', (await page.evaluate(async (id) => (await fetch(`/api/things/upkeep/${id}`)).status, job.job_id)) === 404);
await page.getByRole('button', { name: "Remove Dana's passport" }).click(); await wait(500);
await form.getByRole('button', { name: 'Remove it, keep the reminder' }).click(); await wait(1500);
check('the other way, the reminder stays in Upkeep', !(await main()).includes('Passport') && (await api('GET', '/api/things/upkeep')).some((j) => j.name === "Renew Dana's passport"));

// A phone: no sideways scroll, and every control big enough for a thumb.
await api('POST', '/api/things/licenses', { name: "Driver's license", category: 'Driving', holder: 'Dana', number: NUMBER, issuer: 'State DMV', expires_on: day(20) });
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${base}/things/licenses`); await wait(1200);
await page.getByRole('button', { name: "Show the number for Dana's driver's license" }).click(); await wait(500);
// (The dialog's own ✕ close button belongs to the shared dialog, not to this page, and is left out.)
const small = (selector) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button:not([aria-label=Close]), ${sel} input:not([type=hidden]):not([type=checkbox]), ${sel} select, ${sel} textarea`)]
  .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0)
  .filter((el) => el.getBoundingClientRect().height < 43.5).map((el) => `${el.tagName} ${(el.getAttribute('aria-label') || el.innerText || el.name || '').slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}`), selector);
check('375px: the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
check('375px: every control on the page is at least 44px tall', (await small('main')).length === 0, (await small('main')).join(', '));
await page.screenshot({ path: `${shots}/licenses-phone.png`, fullPage: true });
await page.getByRole('button', { name: '+ Add a license' }).click(); await wait(600);
check('375px: the form does not scroll sideways, and its controls are 44px tall too', await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d.scrollWidth <= d.clientWidth; }) && (await small('[role=dialog]')).length === 0, (await small('[role=dialog]')).join(', '));
await browser.close();
