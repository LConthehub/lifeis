// "Just the first step" from a chore, a project and a routine, at phone width: the one step in large type, a timer the
// person starts, Done, "That's enough for today", and "Break it down for me" only once the assistant is on.
import { browserChoice } from '../browser.mjs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join('\n')));

// A stand-in model that gives three steps, and keeps what it was sent.
const received = [];
let mode = 'three';
const model = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/v1/chat/completions') {
      received.push(JSON.parse(body));
      const content = mode === 'three' ? '1. Clear a path to the door\n2. Put the bike on its hook\n3. Sweep the cleared floor' : 'Just start.';
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((resolve) => model.listen(4192, '127.0.0.1', resolve));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
const wait = (ms = 800) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const quiet = page.locator('[data-first-step]');
const words = async () => (await quiet.locator('[data-first-words]').innerText()).trim();
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const small = async () => (await quiet.locator('button').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim())));

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

const plain = await send('POST', '/api/things/upkeep', { name: 'Wipe the counters', kind: 'chore', every_n: 1, every_unit: 'week' });
const stepped = await send('POST', '/api/things/upkeep', { name: 'Change the furnace filter', every_n: 3, every_unit: 'month', steps: 'Turn the system off.\nNote the size on the old filter.' });
let shelf = await send('POST', '/api/projects', { name: 'Garage shelves' });
await send('POST', `/api/projects/${shelf.id}/lines`, { label: 'Cut the boards', note: 'Two long, four short' });
shelf = await send('POST', `/api/projects/${shelf.id}/lines`, { label: 'Sand the edges' });
const routine = await send('POST', '/api/routines', { name: 'Morning', times: [{ name: 'Morning', steps: [{ words: 'Make the bed' }, { words: 'Take the pills' }] }] });

// ---- a chore with no steps: the chore itself ----
await page.goto(base + `/things/upkeep/${plain.id}`); await wait(1200);
check('a chore has a "Just the first step" button', await page.getByRole('button', { name: 'Just the first step' }).count() === 1);
check('the chore page fits 375 wide before opening', await noSideways());
await page.getByRole('button', { name: 'Just the first step' }).click(); await wait();
check('with no steps, the step is the chore itself', (await words()) === 'Wipe the counters', await words());
const size = await quiet.locator('[data-first-words]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check('the step is in large type', size >= 24, `${size}px`);
check('the view fits 375 wide, and every button is at least 44px tall', (await noSideways()) && (await small()).length === 0, (await small()).join(', '));
check('Done, "That\'s enough for today" and a timer start are there', await quiet.getByRole('button', { name: 'Done', exact: true }).count() === 1 && await quiet.getByRole('button', { name: "That's enough for today" }).count() === 1 && await quiet.getByRole('button', { name: 'Start 5 minutes' }).count() === 1);
check('with the assistant off there is no "Break it down for me"', await quiet.getByText('Break it down for me').count() === 0);
await quiet.getByRole('button', { name: 'Start 5 minutes' }).click(); await wait(1500);
const timer = await quiet.locator('[role=timer]').innerText();
check('the timer starts only when asked, from 5:00', /^4:5\d$/.test(timer.trim()), timer);
await page.screenshot({ path: `${shots}/first-step-chore.png` });
await quiet.getByRole('button', { name: "That's enough for today" }).click(); await wait(500);
check('"That\'s enough for today" closes the view', await quiet.count() === 0);
let job = await send('GET', `/api/things/upkeep/${plain.id}`);
check('and records nothing: the chore is not marked done', !job.last_done);
await page.getByRole('button', { name: 'Just the first step' }).click(); await wait();
await quiet.getByRole('button', { name: 'Done', exact: true }).click(); await wait(1200);
job = await send('GET', `/api/things/upkeep/${plain.id}`);
check('Done checks the chore off the way it is checked elsewhere', Boolean(job.last_done));
check('then the view says so and has nothing nagging', /Checked off/.test(await quiet.innerText()) && !/overdue|late|streak|missed/i.test(await quiet.innerText()));
await quiet.getByRole('button', { name: 'Close' }).last().click(); await wait(400);

// ---- a chore with steps: its steps, one at a time ----
await page.goto(base + `/things/upkeep/${stepped.id}`); await wait(1200);
await page.getByRole('button', { name: 'Just the first step' }).click(); await wait();
check('a chore with steps shows its first step and where it is', (await words()) === 'Turn the system off.' && /Step 1 of 2/.test(await quiet.innerText()), await words());
await quiet.getByRole('button', { name: 'Done', exact: true }).click(); await wait(1000);
check('Done moves to the next step without marking the chore done', (await words()) === 'Note the size on the old filter.' && !(await send('GET', `/api/things/upkeep/${stepped.id}`)).last_done, await words());
await quiet.getByRole('button', { name: 'Done', exact: true }).click(); await wait(1200);
check('the last step done marks the chore done', Boolean((await send('GET', `/api/things/upkeep/${stepped.id}`)).last_done));
await page.keyboard.press('Escape'); await wait(400);

// ---- a project: its next unchecked line ----
await page.goto(base + `/projects/${shelf.id}`); await wait(1200);
check('the project page fits 375 wide', await noSideways());
await page.getByRole('button', { name: 'Just the first step' }).click(); await wait();
check('a project shows its next unchecked line', (await words()) === 'Cut the boards' && /Two long, four short/.test(await quiet.innerText()), await words());
await page.screenshot({ path: `${shots}/first-step-project.png` });
await quiet.getByRole('button', { name: 'Done', exact: true }).click(); await wait(1200);
const lines = (await send('GET', `/api/projects/${shelf.id}`)).lines;
check('Done marks that line used, and the next one shows', Boolean(lines[0].used_on) && !lines[1].used_on && (await words()) === 'Sand the edges', await words());
await page.keyboard.press('Escape'); await wait(400);

// ---- a routine: its next step not done today ----
await page.goto(base + '/routines'); await wait(1200);
check('the routines page fits 375 wide', await noSideways());
await page.locator('[data-routine="Morning"]').getByRole('button', { name: 'Just the first step' }).click(); await wait();
check('a routine shows its next step not done today', (await words()) === 'Make the bed', await words());
await quiet.getByRole('button', { name: 'Done', exact: true }).click(); await wait(1200);
check('Done checks it the way the front page does, and the next one shows', (await words()) === 'Take the pills', await words());
const day = await send('GET', '/api/routine-day');
check('the step shows as done on the front page checklist', day.find((t) => t.routine_id === routine.id).steps[0].ticked === true);
await page.keyboard.press('Escape'); await wait(400);

// ---- the assistant ----
await send('PUT', '/api/assistant', { enabled: true, url: 'http://127.0.0.1:4192/v1', areas: ['kitchen'] });
await page.goto(base + `/projects/${shelf.id}`); await wait(1200);
await page.getByRole('button', { name: 'Just the first step' }).click(); await wait();
check('with the assistant on, "Break it down for me" shows and says what it sends', await quiet.getByText('Break it down for me').count() === 1 && /Sends the words of this step/.test(await quiet.innerText()));
await quiet.getByText('Break it down for me').click(); await wait(1500);
const offered = await quiet.locator('[data-first-offer] button').allInnerTexts();
check('it offers three smaller steps', offered.length === 3 && offered[0] === 'Clear a path to the door', offered.join(' | '));
const sent = JSON.stringify(received.at(-1)?.messages ?? []);
check('only the step and its name went to the model', /Sand the edges/.test(sent) && /Garage shelves/.test(sent) && !/Facts/.test(sent));
check('the offered steps fit 375 wide and are 44px tall', (await noSideways()) && (await small()).length === 0, (await small()).join(', '));
await page.screenshot({ path: `${shots}/first-step-break-down.png` });
await quiet.locator('[data-first-offer] button').nth(1).click(); await wait(400);
check('choosing one shows it as the step', (await words()) === 'Put the bike on its hook');
await quiet.getByRole('button', { name: 'Done', exact: true }).click(); await wait(800);
check('Done on a smaller step leaves the real step unchecked', (await words()) === 'Sand the edges' && !(await send('GET', `/api/projects/${shelf.id}`)).lines[1].used_on);
mode = 'junk';
await quiet.getByText('Break it down for me').click(); await wait(1200);
check('when the assistant gives no clean three, it says so and changes nothing', /three clear steps/.test(await quiet.innerText()) && (await words()) === 'Sand the edges');
await browser.close();
model.close();
