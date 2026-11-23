// Two people in one Life Is: Ana keeps a shared House category and a private one for Ben's present.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const bad = [];
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);

const browser = await chromium.launch({ ...browserChoice, headless: true });
async function signedIn(name, first) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push(`${name}: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/money') && r.status() >= 400) bad.push(`${name}: ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  await page.goto(base + '/'); await page.waitForTimeout(1200);
  await page.getByRole('textbox').first().fill(name);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: first ? /Make my account|Sign in/ : 'Sign in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 6000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click().catch(() => {}); await page.waitForTimeout(1500); }
  if (await dialog.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  return page;
}
const wait = (page, ms = 800) => page.waitForTimeout(ms);
const category = async (page, name, amount, share) => {
  await page.getByRole('button', { name: '+ Add' }).click(); await wait(page, 400);
  const form = page.getByRole('dialog');
  await form.getByLabel('Name *').fill(name);
  await form.getByLabel('Amount for each month').fill(amount);
  if (share) await form.getByLabel(share).check();
  await form.getByRole('button', { name: 'Save' }).click(); await wait(page);
};
const spent = async (page, what, amount, where) => {
  await page.getByRole('button', { name: '+ Spent' }).click(); await wait(page, 400);
  const form = page.getByRole('dialog');
  await form.getByLabel('What on *').fill(what);
  await form.getByLabel('How much *').fill(amount);
  if (where) await form.getByLabel('Category').selectOption({ label: where });
  await form.getByRole('button', { name: 'Save' }).click(); await wait(page);
};

const ana = await signedIn('ana', true);
// Ana makes Ben an account, the way Settings does.
const made = await ana.evaluate(async (password) => (await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ben', password }) })).status, PASS);
console.log('   ben has an account: ' + made);

await ana.goto(base + '/money'); await wait(ana, 1200);
say('a section called budgeted is there, with nothing in it yet', /None yet/.test(await ana.locator('main').innerText()) && (await ana.getByRole('link', { name: 'budgeted' }).count()) > 0);
await category(ana, 'House', '500', 'ben');
await category(ana, "Ben's birthday", '200');
await spent(ana, 'Paint', '40', 'House (shared)');
await spent(ana, 'Watch', '150', "Ben's birthday");
await spent(ana, 'Coffee', '4');
let t = (await ana.locator('main').innerText()).replace(/\s+/g, ' ');
say('Ana sees both categories, what is left in each, and who sees them', /House \$40\.00 of \$500\.00 \$460\.00 left/.test(t) && /Shared with ben/.test(t) && /Ben's birthday \$150\.00 of \$200\.00 \$50\.00 left/.test(t) && /Only you see this/.test(t));
const totals = (await ana.locator('[data-month-totals]').innerText()).replace(/\s+/g, ' ');
say('and the month as a whole: ' + totals, /Planned \$700\.00/.test(totals) && /Spent \$194\.00/.test(totals) && /Left \$506\.00/.test(totals));
await ana.screenshot({ path: shots + '/money-ana.png', fullPage: true });

const ben = await signedIn('ben', false);
await ben.goto(base + '/money'); await wait(ben, 1500);
t = (await ben.locator('main').innerText()).replace(/\s+/g, ' ');
say('Ben sees the house and its paint', /House \$40\.00 of \$500\.00/.test(t) && /Shared with you by ana/.test(t) && /Paint/.test(t));
say('and nothing of his present, or of Ana\'s coffee', !/birthday|Watch|Coffee/i.test(t));
const raw = await ben.evaluate(async () => (await fetch('/api/money')).text());
say('not in what the page was sent, either', !/birthday|Watch|Coffee/i.test(raw));
await spent(ben, 'Brushes', '12', 'House (shared by ana)');
await ben.screenshot({ path: shots + '/money-ben.png', fullPage: true });
await ana.reload(); await wait(ana, 1500);
t = (await ana.locator('main').innerText()).replace(/\s+/g, ' ');
say('what Ben adds to the house, Ana sees, with his name on it', /House \$52\.00 of \$500\.00/.test(t) && /Brushes · House · ben/.test(t));
say('Ben is not offered a way to change the house\'s amount', (await ben.getByRole('button', { name: 'House', exact: true }).count()) === 0);

// A paid project line shows in the month without being typed again.
const project = await ana.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const made = await post('/api/projects', { name: 'Shirt dress' });
  const withCost = await post(`/api/projects/${made.id}/costs`, { label: 'Linen', planned_cents: 4500 });
  await post(`/api/projects/costs/${withCost.costs[0].id}/pay`, { actual_cents: 5200 });
  return made.id;
});
await ana.reload(); await wait(ana, 1500);
t = (await ana.locator('main').innerText()).replace(/\s+/g, ' ');
say('what was paid on a project is counted in the month: project ' + project, /Paid on projects: \$52\.00/.test(t) && /Linen · Shirt dress/.test(t) && /Spent \$258\.00/.test((await ana.locator('[data-month-totals]').innerText()).replace(/\s+/g, ' ')));
// A statement downloaded from a bank is pasted, looked over, trimmed and brought in, once.
const nowDay = new Date();
const stamp = (day) => `${String(nowDay.getMonth() + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}/${nowDay.getFullYear()}`;
const statement = `Account summary,,\nDate,Description,Amount\n${stamp(1)},"Corner Market, Main St",12.50\n${stamp(2)},Pharmacy,7.25\n${stamp(2)},Gas Station,30.00\n${stamp(2)},Payment thank you,-100.00\n`;
const dialogOf = () => ana.getByRole('dialog');
const openStatement = async () => {
  await ana.getByRole('button', { name: 'Import a statement' }).click(); await wait(ana, 400);
  await dialogOf().getByLabel('Or paste it here').fill(statement);
  await dialogOf().getByRole('button', { name: 'Look it over' }).click(); await wait(ana, 900);
};
await openStatement();
let box = (await dialogOf().innerText()).replace(/\s+/g, ' ');
say('looking it over says how many lines, the dates and the total, without adding anything', /4 lines/.test(box) && /Spent: \$49\.75/.test(box) && /Money that came in \(1\)/.test(box) && /sent nowhere/.test(box));
say('and that it assumed which sign is spending, with a way to switch', /took amounts with no minus sign/.test(box) && (await dialogOf().getByRole('button', { name: 'Switch it around' }).count()) === 1);
say('the money that came in is unchecked', !(await dialogOf().getByLabel('Import Payment thank you').isChecked()));
await dialogOf().getByLabel('Category for Pharmacy').selectOption({ label: 'House (shared)' });
await dialogOf().getByLabel('Import Gas Station').uncheck();
say('the button counts what will be brought in', (await dialogOf().getByRole('button', { name: 'Import 2', exact: true }).count()) === 1);
await ana.setViewportSize({ width: 1000, height: 900 }); await wait(ana, 400);
await ana.screenshot({ path: shots + '/statement.png' });
await ana.setViewportSize({ width: 375, height: 800 }); await wait(ana, 500);
const fit = await ana.evaluate(() => {
  const dialog = document.querySelector('[role=dialog]');
  const small = [...dialog.querySelectorAll('select, button, label, input[type=file]')].filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 43.5 && el.tagName !== 'INPUT').map((el) => `${el.tagName} ${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}`);
  return { sideways: document.documentElement.scrollWidth > window.innerWidth, small };
});
say('at 375px nothing scrolls sideways' + (fit.small.length ? ' (short controls: ' + fit.small.join('; ') + ')' : ''), !fit.sideways);
say('and every control in it is at least 44px tall', fit.small.filter((s) => !/^BUTTON ×|Close/.test(s)).length === 0);
await ana.screenshot({ path: shots + '/statement-phone.png' });
await ana.setViewportSize({ width: 420, height: 900 }); await wait(ana, 300);
await dialogOf().getByRole('button', { name: 'Import 2', exact: true }).click(); await wait(ana, 1000);
say('it says what was imported', /Imported 2 lines/.test((await dialogOf().innerText()).replace(/\s+/g, ' ')));
await dialogOf().getByRole('button', { name: 'Done' }).click(); await wait(ana, 1200);
t = (await ana.locator('main').innerText()).replace(/\s+/g, ' ');
const after = (await ana.locator('[data-month-totals]').innerText()).replace(/\s+/g, ' ');
say('the month now includes them, the unchecked one left out: ' + after, /Spent \$277\.75/.test(after) && /Corner Market, Main St/.test(t) && /Pharmacy · House/.test(t) && !/Gas Station/.test(t));
say('and the shared House category took the one that was put in it', /House \$59\.25 of \$500\.00/.test(t));
await openStatement();
box = (await dialogOf().innerText()).replace(/\s+/g, ' ');
say('looking at the same statement again shows the two as already there', /Already in Life Is \(2\)/.test(box) && /2 already in Life Is/.test(box) && (await dialogOf().getByLabel('Import Corner Market, Main St').count()) === 0);
await dialogOf().getByLabel('Import Gas Station').uncheck();
say('so there is nothing new to bring in', await dialogOf().getByRole('button', { name: 'Import 0', exact: true }).isDisabled());
const replay = await ana.evaluate(async (text) => (await fetch('/api/money/statement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, keep: [0, 1] }) })).json(), statement);
say('and asking for them again adds nothing: ' + JSON.stringify(replay), replay.added === 0 && replay.already === 2);
await dialogOf().getByRole('button', { name: 'Close' }).click(); await wait(ana, 600);
say('the totals did not move', /Spent \$277\.75/.test((await ana.locator('[data-month-totals]').innerText()).replace(/\s+/g, ' ')));

await ana.getByRole('button', { name: 'The month before' }).click(); await wait(ana, 1000);
say('last month is its own page, with nothing spent', /Spent \$0\.00/.test((await ana.locator('[data-month-totals]').innerText()).replace(/\s+/g, ' ')));
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no failed requests, no page errors');
await browser.close();
