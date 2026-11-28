// Renting: a landlord's job that says Ask the landlord, writes a dated note that is copied and kept, and shows how long ago the landlord was asked; the lease and its reminders; and a room recorded at move-in and move-out with a photo each, side by side and printed on letter paper. At 375px.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8061';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// A real one-pixel picture, so the page can shrink it the way it does a photo from a phone.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
await context.addInitScript(() => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
});
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
const api = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const small = (selector) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button:not([aria-label=Close]), ${sel} input:not([type=hidden]):not([type=checkbox]), ${sel} select, ${sel} textarea, ${sel} a.min-h-\\[44px\\]`)]
  .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0)
  .filter((el) => el.getBoundingClientRect().height < 43.5).map((el) => `${el.tagName} ${(el.getAttribute('aria-label') || el.innerText || el.name || '').slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}`), selector);
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }

// ---------- the landlord's job ----------
await page.goto(`${base}/things/renting`); await wait(1000);
check('Renting is a chip on Things', await page.getByRole('navigation', { name: 'Things' }).getByRole('link', { name: 'Renting' }).isVisible());
check('it says nothing is sent to the landlord', (await main()).includes('Life Is sends nothing to your landlord'));
await page.getByRole('button', { name: 'Add a repair' }).click(); await wait(500);
await page.getByRole('dialog').getByLabel('What needs fixing *').fill('Leaking kitchen tap');
await page.getByRole('dialog').getByLabel('What is wrong, in your words').fill('It drips all night');
await page.getByRole('dialog').getByRole('button', { name: 'Next: write the note' }).click(); await wait(1500);
const ask = page.getByRole('dialog', { name: 'Ask the landlord' });
check('the note opens, ready to write', await ask.isVisible());
await ask.getByLabel('Since when').fill(day(-6));
await ask.getByLabel('The place').fill('Kitchen sink');
await wait(900);
const note = await ask.getByLabel('The note', { exact: true }).inputValue();
check('the note says what is wrong, since when and where, with its date', note.includes('Repair needed: Leaking kitchen tap') && note.includes('What is wrong: It drips all night') && note.includes('Where: Kitchen sink') && /Date: [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(note) && /Since: [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(note), note.replace(/\n/g, ' | '));
check('nothing is kept until it is copied', (await api('GET', '/api/things/upkeep')).every((j) => j.asked_on === null));
await ask.getByRole('button', { name: 'Copy the note' }).click(); await wait(1200);
check('one tap copies exactly the note', (await page.evaluate(() => window.__copied)).join('||') === note);
check('and says a copy is kept with the date', (await ask.innerText()).includes('A copy is kept with'));
const jobs = await api('GET', '/api/things/upkeep');
const job = jobs.find((j) => j.name === 'Leaking kitchen tap');
check('the job keeps when the landlord was asked, and Life Is keeps the note', job.landlord === true && job.asked_on === day(0) && (await api('GET', `/api/things/renting/jobs/${job.id}/notes`)).length === 1, JSON.stringify({ asked: job.asked_on }));
await ask.getByRole('button', { name: 'Close' }).first().click(); await wait(500);
check('the job says Asked today until it is fixed', (await main()).includes('Asked today'));
check('the job page has no Done button, and a note to copy again', (await page.getByRole('button', { name: /^Done$/ }).count()) === 0 && (await page.getByRole('region', { name: 'Notes to the landlord' }).getByRole('button', { name: /Copy/ }).count()) === 1);
// Twelve days on: the server's days are real, so show how it reads by changing what the page is told.
await page.route(`**/api/things/upkeep/${job.id}`, async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: { ...j, asked_days: 12 } }); });
await page.reload(); await wait(1200);
check('it reads Asked 12 days ago', (await main()).includes('Asked 12 days ago'));
await page.unroute(`**/api/things/upkeep/${job.id}`);
await page.goto(`${base}/things/upkeep`); await wait(1200);
const row = page.getByRole('listitem').filter({ hasText: 'Leaking kitchen tap' }).first();
check('in the Upkeep list it says Ask the landlord in place of Done, and Asked today', (await row.innerText()).includes('Ask the landlord') && (await row.innerText()).includes('Asked today') && (await row.getByRole('button', { name: 'Leaking kitchen tap done' }).count()) === 0, (await row.innerText()).replace(/\s+/g, ' '));
check('375px: Upkeep does not scroll sideways', await noSideways());
await page.goto(`${base}/things/upkeep/${job.id}`); await wait(1000);
await page.getByRole('button', { name: 'It was fixed' }).click(); await wait(1200);
check('fixed: it keeps the day and stops saying Asked', (await main()).includes('Fixed ') && !(await main()).includes('Asked today'));
const after = (await api('GET', `/api/things/upkeep/${job.id}`));
check('the job keeps both days', after.asked_on === day(0) && after.fixed_on === day(0));
// (The page's older small controls, Change, Add tools and supplies, Undo and Remove this, were there before and are left alone.)
const tooSmall = (await small('main')).filter((t) => !/^BUTTON (Change|Add tools and supplies|Undo|Remove this)/.test(t.replace(/\s+/, ' ')));
check('375px: the job page fits, and its landlord controls are 44px tall', (await noSideways()) && tooSmall.length === 0, tooSmall.join(', '));
await page.screenshot({ path: `${shots}/renters-job.png`, fullPage: true });
// Any job can be marked the landlord's, and unmarked.
await page.getByRole('button', { name: 'Change' }).click(); await wait(500);
check('the job form has the landlord checkbox', await page.getByRole('dialog').getByLabel(/This is the landlord's to fix/).isChecked());
await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click(); await wait(300);

// ---------- the lease and its reminders ----------
await page.goto(`${base}/things/renting`); await wait(1000);
check('the repair is listed with when it was fixed', (await main()).includes('Leaking kitchen tap Fixed '));
await page.getByRole('button', { name: 'Add the lease' }).click(); await wait(500);
const lease = page.getByRole('dialog', { name: 'The lease' });
await lease.getByLabel('The lease starts').fill(day(-335));
await lease.getByLabel('The lease ends').fill(day(30));
await lease.getByLabel('Rent is due on day (1 to 31)').fill('3');
await lease.getByLabel('Deposit').fill('1500.50');
await lease.getByLabel("Landlord's name").fill('Loretta');
await lease.getByLabel('How to reach them (as you would type it)').fill('555-0100');
await lease.getByLabel('A notice is due on').fill(day(7));
await lease.getByLabel('What the notice is for').fill('Say if we are staying');
check('375px: the lease form fits and its controls are 44px tall', await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d.scrollWidth <= d.clientWidth; }) && (await small('[role=dialog]')).length === 0, (await small('[role=dialog]')).join(', '));
await lease.getByRole('button', { name: 'Keep the lease' }).click(); await wait(1200);
let text = await main();
check('the lease shows its days, rent day, deposit in dollars and landlord', text.includes('the 3rd of the month') && text.includes('$1,500.50') && text.includes('Loretta') && text.includes('555-0100') && text.includes('in 30 days') && text.includes('Say if we are staying'), text.slice(0, 400));
const kept = await api('GET', '/api/things/renting');
check('the deposit is kept in cents', kept.lease.deposit_cents === 150050);
const digest = await api('GET', '/api/reminders/digest');
const lines = digest.lines.filter((l) => l.link === '/things/renting').map((l) => `${l.title}: ${l.detail}`);
check('the morning reminder says the notice is a week away', lines.some((l) => l.startsWith('Notice due: Say if we are staying: in 7 days')), lines.join(' | '));
const later = await api('GET', '/api/reminders/digest?ahead=7');
check('and a week on, the lease is 23 days off, so it is not said yet; at 30 days it is', !later.lines.some((l) => l.title === 'Your lease ends') && digest.lines.some((l) => l.title === 'Your lease ends' && l.detail.startsWith('in 30 days')), digest.lines.map((l) => l.title).join(' | '));
check('375px: Renting fits', (await noSideways()) && (await small('main')).length === 0, (await small('main')).join(', '));

// ---------- the move-in and move-out record ----------
await page.getByRole('button', { name: 'Kitchen', exact: true }).click(); await wait(1000);
const room = page.getByRole('region', { name: 'Kitchen' });
check('a room was added', await room.isVisible());
const inNote = room.getByLabel('Kitchen: how it looked at move-in');
await inNote.fill('Small chip in the sink'); await inNote.blur(); await wait(900);
await room.locator('input[type=file]').first().setInputFiles({ name: 'in.png', mimeType: 'image/png', buffer: PIXEL }); await wait(1800);
const outNote = room.getByLabel('Kitchen: how it looked at move-out');
await outNote.fill('The same chip, nothing new'); await outNote.blur(); await wait(900);
await room.locator('input[type=file]').nth(1).setInputFiles({ name: 'out.png', mimeType: 'image/png', buffer: PIXEL }); await wait(1800);
const rooms = (await api('GET', '/api/things/renting')).rooms;
check('the room keeps both notes and one photo for each visit, each dated today', rooms.length === 1 && rooms[0].in_note === 'Small chip in the sink' && rooms[0].out_note === 'The same chip, nothing new'
  && rooms[0].photos.length === 2 && rooms[0].photos.every((p) => p.day === day(0)) && rooms[0].photos.map((p) => p.phase).sort().join() === 'in,out', JSON.stringify(rooms[0]));
const pos = await page.evaluate(() => ['in', 'out'].map((p) => { const r = document.querySelector(`[data-visit=${p}]`).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
check('move-in and move-out sit side by side', pos[0][0] < pos[1][0] && Math.abs(pos[0][1] - pos[1][1]) < 4, JSON.stringify(pos));
check('both photos are shown', (await page.locator('[data-visit] img').count()) === 2 && await page.locator('[data-visit] img').evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0)));
check('375px: the record fits, its controls are 44px tall', (await noSideways()) && (await small('main')).length === 0, (await small('main')).join(', '));
await page.screenshot({ path: `${shots}/renters-record.png`, fullPage: true });

// ---------- the printout ----------
await page.getByRole('link', { name: 'Print the record' }).click(); await wait(1500);
check('the print page offers it, and says it goes nowhere', (await main()).includes('goes nowhere unless you send it') && await page.getByRole('button', { name: 'Print or save as PDF' }).isEnabled());
check('the sheet holds the room, both notes and both photos', await page.evaluate(() => { const s = document.querySelector('.rent-sheet'); return s.innerText.includes('Kitchen') && s.innerText.includes('Small chip in the sink') && s.innerText.includes('The same chip, nothing new') && s.querySelectorAll('img.rent-photo').length === 2; }));
check('375px: the print page fits', (await noSideways()) && (await small('main')).length === 0, (await small('main')).join(', '));
await page.emulateMedia({ media: 'print' }); await wait(400);
check('printing hides the controls and keeps the sheet', !(await page.getByRole('button', { name: 'Print or save as PDF' }).isVisible()) && await page.locator('.rent-sheet').isVisible());
const pdf = await page.pdf({ preferCSSPageSize: true });
const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
check('it is one record on letter paper', box && Math.round(Number(box[1])) === 612 && Math.round(Number(box[2])) === 792, box ? `${box[1]} x ${box[2]}` : 'no page size found');
await page.emulateMedia({ media: 'screen' });
await browser.close();
