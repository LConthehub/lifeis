// Medicines, on a 375px phone: a person adds one with refills, a photo and a routine step; checking the step in the routine counts the number left
// down; the refill reminder comes a week before it would run out and says no name; a reminder with a medicine in it says only "Morning routine"
// until that person switches names on; sharing it with one person shows it to them only, read-only; a pet's medicine is kept for whoever keeps the
// pet. Pictures at 375px of the list, the form and the routine.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8051';
const NAME = 'Zorbex';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const phone = (look = 'light') => browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: look, hasTouch: true, deviceScaleFactor: 2 });
const watch = (page, who) => {
  page.on('pageerror', (e) => check(`${who}: no page errors`, false, e.message));
  page.on('dialog', (d) => d.accept());
};
async function signIn(page, name, make) {
  await page.goto(base + '/'); await wait(1000);
  await page.getByRole('textbox').first().fill(name);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: make ? /Make my account|Sign in/ : /Sign in/ }).click(); await wait(2000);
  const first = page.getByRole('dialog');
  if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const short = (page, scope = 'main') => page.locator(`${scope} button, ${scope} a, ${scope} input, ${scope} select`).evaluateAll((els) => els.filter((e) => !e.closest('[data-demo-banner]') && e.type !== 'file' && e.type !== 'checkbox' && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent || e.getAttribute('aria-label') || e.type).trim().slice(0, 30)));
const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
  const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}, [method, url, body]);

// ---- the person in charge, and three people ----
const chiefContext = await phone();
const chief = await chiefContext.newPage();
watch(chief, 'in charge');
await signIn(chief, 'boss', true);
for (const name of ['ana', 'bob', 'cy']) await api(chief, 'POST', '/api/users', { username: name, password: PASS });

// ---- ana adds a medicine with refills, a photo and a morning step ----
const anaContext = await phone();
const ana = await anaContext.newPage();
watch(ana, 'ana');
await signIn(ana, 'ana', false);
await ana.goto(base + '/medicines'); await wait(1500);
let main = await ana.locator('main').innerText();
check('the page says it keeps a list and reminds, and gives no medical advice', /does not give medical advice/.test(main) && /Only you see your list/.test(main), main.slice(0, 200));
check('the names switch is off, and says what a reminder says', !(await ana.getByLabel('Show medicine names in my reminders').isChecked()) && /Morning routine: 1 step/.test(main));
check('an empty list says what to do', /Nothing here yet/.test(main));
await ana.getByRole('button', { name: '+ Add a medicine' }).click(); await wait(600);
const form = ana.getByRole('dialog');
await form.getByLabel('Name *').fill(NAME);
await form.getByLabel('Dose, in your own words').fill('5 mg, one tablet');
await form.getByLabel('When it is taken, in your own words').fill('With breakfast');
await form.getByLabel('How many are left').fill('4');
await form.getByLabel('A refill adds').fill('30');
await form.getByLabel('Prescriber', { exact: true }).fill('Dr. Ames');
await form.getByLabel("Prescriber's phone").fill('555-0100');
await form.getByLabel('Pharmacy', { exact: true }).fill('Main Street Pharmacy');
await form.getByLabel("Pharmacy's phone").fill('555-0101');
await form.getByLabel('What it is for').fill('Blood pressure');
await form.getByLabel('Notes').fill('Keep it in the kitchen drawer');
await form.getByLabel('Morning, in a routine called Medicines').check();
await form.locator('input[type=file]').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: PNG });
await ana.screenshot({ path: `${shots}/medicines-form-375.png` });
check('the form fits 375px with no sideways scroll', (await sideways(ana)) <= 0);
const formShort = await short(ana, '[role=dialog]');
check('the form controls are 44px tall or more', formShort.length === 0, formShort.join(', '));
await form.getByRole('button', { name: 'Save' }).click(); await wait(1800);
let list = (await api(ana, 'GET', '/api/medicines')).json;
const med = list.mine.find((m) => m.name === NAME);
check('it is kept with its words, refills, prescriber, pharmacy and photo', med && med.dose === '5 mg, one tablet' && med.left === 4 && med.fill_size === 30 && med.prescriber_phone === '555-0100' && med.pharmacy_name === 'Main Street Pharmacy' && med.photo === true && med.reason === 'Blood pressure', JSON.stringify(med));
check('it is a step in a Medicines routine, Morning', med && med.times.map((t) => t.title).join() === 'Medicines: Morning');
main = await ana.locator('main').innerText();
check('the card shows how many are left and says a refill is due', /4 left, about 4 days/.test(main) && /time to ask for a refill/.test(main), main.slice(0, 400));
await ana.getByRole('button', { name: 'More' }).click(); await wait(500);
main = await ana.locator('main').innerText();
check('More shows the prescriber, pharmacy, reason, notes and who can see it (only her)', /Dr\. Ames/.test(main) && /555-0101/.test(main) && /Blood pressure/.test(main) && /kitchen drawer/.test(main) && /Only you\./.test(main));
check('the phone numbers are links to call', (await ana.locator('a[href="tel:5550100"]').count()) === 1);
check('no horizontal scroll on the list', (await sideways(ana)) <= 0);
const listShort = await short(ana);
check('the controls on the list are 44px tall or more', listShort.length === 0, listShort.join(', '));
await ana.screenshot({ path: `${shots}/medicines-list-375.png`, fullPage: true });

// ---- the routine: one tap for Taken counts the number left down ----
await ana.goto(base + '/'); await wait(1800);
const card = ana.locator('[data-routine-time="Medicines: Morning"]');
check('the Medicines routine shows on the front page with the medicine as a step', (await card.count()) === 1 && /Zorbex, 5 mg/.test(await card.innerText()) && (await card.locator('[data-taken]').count()) === 1, await ana.locator('main').innerText());
await ana.screenshot({ path: `${shots}/medicines-routine-375.png`, fullPage: true });
await card.getByRole('checkbox', { name: /Zorbex/ }).click(); await wait(1000);
const folded = ana.locator('[data-routine-done="Medicines: Morning"]');
check('checking it finishes the time, which folds to one line', (await folded.count()) === 1);
let now = (await api(ana, 'GET', `/api/medicines/${med.id}`)).json;
check('the number left came down by one, and the dose is in the history', now.left === 3 && now.taken_today === 1 && now.doses.length === 1, JSON.stringify([now.left, now.taken_today, now.doses]));
await folded.getByRole('button', { name: /Show/ }).click(); await wait(600);
check('shown again, the step says Taken', (await card.locator('[data-taken]').innerText()) === 'Taken');
await card.getByRole('checkbox', { name: /Zorbex/ }).click(); await wait(1000);
now = (await api(ana, 'GET', `/api/medicines/${med.id}`)).json;
check('taking it back counts it back up', now.left === 4 && now.taken_today === 0);
check('no horizontal scroll on the front page with it', (await sideways(ana)) <= 0);

// ---- the refill reminder, and the discreet line ----
// 4 left at one a day is under a week, so the refill reminder is already here.
let digest = (await api(ana, 'GET', '/api/reminders/digest')).json;
const refill = digest.lines.filter((l) => l.link === '/medicines');
check('the refill reminder is in the morning digest, and says no name', refill.length === 1 && refill[0].title === 'A refill is coming up' && !JSON.stringify(digest).includes(NAME), JSON.stringify(refill));
// Give the Morning time a clock time, and see what the phone would be told to schedule.
const people = (await api(ana, 'GET', '/api/routines/people')).json;
const routine = (await api(ana, 'GET', '/api/routines')).json.find((r) => r.name === 'Medicines');
await api(ana, 'PUT', `/api/routines/${routine.id}`, { name: 'Medicines', for_user: people.me, times: routine.times.map((t) => ({ id: t.id, name: t.name, at: '08:00', steps: t.steps.map((s) => ({ id: s.id, words: s.words })) })) });
const kept = (await api(ana, 'GET', `/api/medicines/${med.id}`)).json;
check('saving the routine from its own page keeps the medicine as it was', kept.name === NAME && kept.times.length === 1 && kept.left === 4, JSON.stringify([kept.name, kept.times, kept.left]));
let coming = (await api(ana, 'GET', '/api/routines/coming?days=1')).json;
check('a reminder with a medicine in it says only "Morning routine" and 1 step', coming.length === 1 && coming[0].title === 'Morning routine' && coming[0].steps === 1 && !JSON.stringify(coming).includes(NAME) && !/Medicines/.test(JSON.stringify(coming)), JSON.stringify(coming));
// The one switch, on the page itself.
await ana.goto(base + '/medicines'); await wait(1200);
await ana.getByLabel('Show medicine names in my reminders').check(); await wait(800);
coming = (await api(ana, 'GET', '/api/routines/coming?days=1')).json;
digest = (await api(ana, 'GET', '/api/reminders/digest')).json;
check('with names switched on, the reminder names it', coming[0].title === 'Medicines: Morning' && digest.lines.some((l) => l.title === `Refill: ${NAME}`), JSON.stringify([coming, digest.lines.filter((l) => l.link === '/medicines')]));
check('the switch is only hers', (await api(chief, 'GET', '/api/medicines')).json.show_names === false);
await ana.getByLabel('Show medicine names in my reminders').uncheck(); await wait(800);
check('switching it off again goes back to no name', (await api(ana, 'GET', '/api/routines/coming?days=1')).json[0].title === 'Morning routine');

// ---- private, then shared with bob only ----
const bobContext = await phone();
const bob = await bobContext.newPage();
watch(bob, 'bob');
await signIn(bob, 'bob', false);
const cyContext = await phone();
const cy = await cyContext.newPage();
watch(cy, 'cy');
await signIn(cy, 'cy', false);
async function sees(page, who, expected) {
  const everything = [(await api(page, 'GET', '/api/medicines')).text, (await api(page, 'GET', '/api/routine-day')).text, (await api(page, 'GET', '/api/routines')).text, (await api(page, 'GET', `/api/search?q=${NAME}`)).text,
    (await api(page, 'GET', '/api/reminders/digest')).text].join(' ');
  check(`${who}: ${expected ? 'sees' : 'does not see'} the medicine anywhere`, everything.includes(NAME) === expected, expected ? 'not found' : 'it was found');
}
for (const [page, who] of [[chief, 'the person in charge'], [bob, 'bob'], [cy, 'cy']]) await sees(page, who, false);
check('the others cannot open it, its photo or share it', [(await api(bob, 'GET', `/api/medicines/${med.id}`)).status, (await api(bob, 'GET', `/api/medicines/${med.id}/photo`)).status, (await api(cy, 'PUT', `/api/medicines/${med.id}/sharing`, { people: [] })).status].join() === '404,404,404');
await ana.goto(base + '/medicines'); await wait(1200);
await ana.getByRole('button', { name: 'More' }).click(); await wait(500);
await ana.locator('[data-sharing]').getByLabel('bob').check(); await wait(900);
check('sharing with bob is kept: only bob', JSON.stringify((await api(ana, 'GET', `/api/medicines/${med.id}`)).json.people) === JSON.stringify([(await api(ana, 'GET', '/api/medicines')).json.people.find((p) => p.name === 'bob').id]));
await sees(bob, 'bob, once shared,', true);
await sees(cy, 'cy, still,', false);
await sees(chief, 'the person in charge, still,', false);
await bob.goto(base + '/medicines'); await wait(1500);
main = await bob.locator('main').innerText();
check('bob reads it under Shared with you, with the keeper, and has no Change button', /Shared with you/.test(main) && /Kept by ana/.test(main) && (await bob.getByRole('button', { name: 'Change' }).count()) === 0 && (await bob.getByRole('button', { name: 'Got a refill' }).count()) === 0);
check('bob\'s own list is empty, and his names switch is off', /Nothing here yet/.test(main) && !(await bob.getByLabel('Show medicine names in my reminders').isChecked()));
check('bob cannot change it', (await api(bob, 'PUT', `/api/medicines/${med.id}`, { name: 'x' })).status === 404 && (await api(bob, 'DELETE', `/api/medicines/${med.id}`)).status === 404);
check('bob\'s front page has no routine with it', !(await api(bob, 'GET', '/api/routine-day')).text.includes(NAME));
check('no horizontal scroll for bob', (await sideways(bob)) <= 0);
await bob.screenshot({ path: `${shots}/medicines-shared-375.png`, fullPage: true });

// ---- a pet's medicine: kept by ana, in the pet's own routine, and not shown to anyone else ----
const george = (await api(ana, 'POST', '/api/things/pets', { name: 'George', species: 'dog' })).json;
await ana.goto(`${base}/things/pets/${george.id}`); await wait(1500);
check('the pet page links to its medicines', (await ana.locator('[data-medicines-link]').innerText()) === 'Medicines for George');
await ana.locator('[data-medicines-link]').click(); await wait(1200);
check('the link opens George\'s list', ana.url().endsWith(`/medicines?pet=${george.id}`) && /Nothing here yet for George/.test(await ana.locator('main').innerText()));
await ana.getByRole('button', { name: '+ Add a medicine' }).click(); await wait(600);
const petForm = ana.getByRole('dialog');
check('the form is for George', (await petForm.getByRole('combobox').first().inputValue()) === `pet-${george.id}`);
await petForm.getByLabel('Name *').fill('Heart pill');
await petForm.getByLabel('Dose, in your own words').fill('Half a tablet');
await petForm.getByLabel('How many are left').fill('20');
await petForm.getByLabel('Morning, in a routine called Medicines').check();
await petForm.getByRole('button', { name: 'Save' }).click(); await wait(1800);
main = await ana.locator('main').innerText();
check('George\'s list shows it, and hers does not', /Heart pill/.test(main) && !new RegExp(NAME).test(main));
await ana.goto(`${base}/things/pets/${george.id}`); await wait(1500);
check('the pet\'s own routine shows the medicine for ana', /Heart pill, Half a tablet/.test(await ana.locator('main').innerText()));
await ana.screenshot({ path: `${shots}/medicines-pet-375.png`, fullPage: true });
check('bob, who was shown only the first one, cannot see the pet\'s routine step', !(await api(bob, 'GET', `/api/routine-day?pet=${george.id}`)).text.includes('Heart pill') && !(await api(bob, 'GET', '/api/routine-day')).text.includes('Heart pill'));
check('cy cannot either', !(await api(cy, 'GET', `/api/routine-day?pet=${george.id}`)).text.includes('Heart pill') && !(await api(cy, 'GET', '/api/medicines')).text.includes('Heart pill'));
const petList = (await api(ana, 'GET', '/api/medicines')).json;
check('it is for George, and in the Medicines routine for George', petList.mine.find((m) => m.name === 'Heart pill')?.for_name === 'George' && petList.subjects.find((s) => s.name === 'George').times.length === 1);

// ---- the download carries it ----
const zip = await api(ana, 'GET', '/api/export/everything.zip');
check('the download can be made with the medicines in it', zip.status === 200);
await browser.close();
