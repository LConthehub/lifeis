// The two-minute start: a family with two children and a dog is set up in four short steps, with a sample to look
// at; the front page then helps them get going; clearing the examples keeps one they changed; a household that
// skips, or closes it part way, gets what it asked for.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8041';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const wait = (page, ms = 700) => page.waitForTimeout(ms);
const flat = (s) => s.replace(/\s+/g, ' ');
const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const bad = [];
const watch = (page) => {
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  page.on('dialog', (d) => d.accept());
};
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
}, [method, path, body]);
const signUp = async (page, name, makeIt) => {
  await page.goto(base + '/'); await wait(page, 1000);
  await page.getByRole('textbox').first().fill(name);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: makeIt ? /Make my account/ : /Sign in/ }).click(); await wait(page, 2000);
};
/** On the phone: nothing sideways, and every control in the dialog at least 44px tall. */
const fits = async (page, label) => {
  const r = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]');
    const small = [];
    for (const el of d.querySelectorAll('button, select, a, input:not([type=checkbox]):not([type=radio])')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height < 43.5) small.push(`${el.tagName} "${(el.innerText || el.getAttribute('aria-label') || el.placeholder || '').slice(0, 30)}" ${Math.round(b.height)}px`);
    }
    for (const el of d.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      const b = (el.closest('label') ?? el).getBoundingClientRect();
      if (b.height < 43.5) small.push(`${el.type} ${Math.round(b.height)}px`);
    }
    return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1 || d.scrollWidth > d.clientWidth + 1, small };
  });
  check(`${label}: nothing scrolls sideways at 375px and every control is at least 44px tall`, !r.sideways && r.small.length === 0, r.sideways ? 'sideways scroll' : r.small.join('; '));
};

// ---------- a family, all four steps, with the sample ----------
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const page = await context.newPage();
watch(page);
await signUp(page, 'ana', true);
const dlg = page.getByRole('dialog');
check('a brand-new household is asked the short start, a dialog with a name', await dlg.isVisible() && (await dlg.getAttribute('aria-label')) === 'A two-minute start');
let t = flat(await dlg.innerText());
check('step 1 says which step it is, asks who lives here, and says the adults get no sign-ins', /Step 1 of 4/.test(t) && /Who lives here\?/.test(t) && /This only names them; it does not make sign-ins/.test(t), t.slice(0, 120));
check('"Skip, show me everything" is there, once', await dlg.getByRole('button', { name: 'Skip, show me everything' }).count() === 1);
check('Back is out of reach on the first step', await dlg.getByRole('button', { name: 'Back' }).isDisabled());
await fits(page, 'step 1');

await dlg.getByLabel('Adults').fill('Sam, Alex');
await dlg.getByLabel('Children').fill('Mia, Leo');
await dlg.getByLabel('How many pets?').selectOption('1');
await dlg.getByLabel('Pet 1 name').fill('Biscuit');
await fits(page, 'step 1 with a pet');
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 900);

t = flat(await dlg.innerText());
check('step 2 asks what they would like help with', /Step 2 of 4/.test(t) && /What would you like help with\?/.test(t), t.slice(0, 100));
check('the first three are checked, and the rest are not', await dlg.getByLabel('Meals and groceries').isChecked() && await dlg.getByLabel('What we own and where it is').isChecked()
  && await dlg.getByLabel('Keeping up the house and car').isChecked() && !(await dlg.getByLabel('Money for the month').isChecked()) && !(await dlg.getByLabel('Books, films and music').isChecked()));
check('the old long checklist is one tap away', await dlg.getByRole('button', { name: 'Choose everything myself' }).isVisible());
await dlg.getByLabel('Projects and hobbies').check(); await wait(page, 300);
check('choosing projects lists the hobbies beneath', await dlg.getByRole('group', { name: 'What do you make or do?' }).isVisible());
await fits(page, 'step 2');
await page.screenshot({ path: shots + '/start-phone.png' });
await page.setViewportSize({ width: 1000, height: 900 }); await wait(page, 300);
await page.screenshot({ path: shots + '/start-step2.png' });
await page.setViewportSize({ width: 375, height: 812 }); await wait(page, 300);
await dlg.getByLabel('Projects and hobbies').uncheck();
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 900);

t = flat(await dlg.innerText());
check('step 3 offers the ready-made upkeep, with each set\'s jobs counted', /Step 3 of 4/.test(t) && /Around the house · \d+ jobs/.test(t) && /Papers and money · \d+ jobs/.test(t), t.slice(0, 160));
check('"Around the house" is checked, the car set is not until there is a car, and any job can go later',
  await dlg.getByLabel(/^Around the house/).isChecked() && !(await dlg.getByLabel(/^Car · \d+ jobs/).isChecked()) && /You can remove any job later/.test(t));
await dlg.getByLabel('Yes', { exact: true }).check(); await wait(page, 200);
check('saying there is a car checks the car set', await dlg.getByLabel(/^Car · \d+ jobs/).isChecked());
await fits(page, 'step 3');
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 1200);

t = flat(await dlg.innerText());
check('step 4 offers a sample, off by default, and says it clears with one tap', /Step 4 of 4/.test(t) && !(await dlg.getByLabel('Put a few examples in').isChecked()) && /clear them all with one tap/.test(t), t.slice(0, 160));
await fits(page, 'step 4');
await dlg.getByLabel('Put a few examples in').check();
await dlg.getByRole('button', { name: 'Finish' }).click(); await wait(page, 1800);

t = flat(await dlg.innerText());
check('the end says what was set up in a sentence', /2 people added for chores/.test(t) && /1 pet/.test(t) && /upkeep jobs/.test(t) && /3 example recipes/.test(t), t.slice(0, 260));
check('and says outside services are off until Settings turns them on', /turned on in Settings/.test(t) && /Nothing reaches outside Life Is until you do/.test(t));
await fits(page, 'the last screen');
const go = dlg.getByRole('button', { name: 'Open your recipes' });
check('and a button goes to the page they will use first', await go.isVisible());
await go.click(); await wait(page, 1500);
check('the dialog is gone and the recipes page is open', !(await dlg.isVisible().catch(() => false)) && new URL(page.url()).pathname === '/recipes', page.url());
const recipes = flat(await page.locator('main').innerText());
check('three recipes are there', ['Sheet-pan sausage and vegetables', 'Slow-cooker beef chili', 'Baked macaroni and cheese'].every((r) => recipes.includes(r)));

// What was made, as the rest of Life Is sees it.
const members = (await api(page, 'GET', '/api/things/upkeep/members')).json.map((m) => m.name).sort();
const dogs = (await api(page, 'GET', '/api/things/pets')).json;
const jobs = (await api(page, 'GET', '/api/things/upkeep')).json;
const sets = (await api(page, 'GET', '/api/things/upkeep/sets')).json;
const wanted = sets.filter((s) => ['house', 'car'].includes(s.slug)).reduce((n, s) => n + s.jobs.length, 0);
const dinners = (await api(page, 'GET', `/api/kitchen/plan?start=${day(0)}&days=7`)).json;
const list = (await api(page, 'GET', '/api/kitchen/grocery')).json;
check('the children are household members, with no sign-ins for anyone', members.join(',') === 'Leo,Mia' && (await api(page, 'GET', '/api/things/upkeep/people')).json.length === 1, members.join(','));
check('the dog is a pet', dogs.length === 1 && dogs[0].name === 'Biscuit' && dogs[0].species === 'dog');
check('the upkeep jobs of the two sets are there', jobs.length === wanted && jobs.some((j) => j.name === 'Change the furnace filter') && jobs.some((j) => j.name === 'Change the oil'), `${jobs.length} of ${wanted}`);
check('three dinners are planned, from the recipes', dinners.length === 3 && dinners.every((m) => m.meal === 'dinner' && m.recipe_id), dinners.map((m) => `${m.day} ${m.recipe_title}`).join('; '));
check('six lines are on the grocery list', list.length === 6, String(list.length));
await page.goto(base + '/week'); await wait(page, 1200);
check('the week page shows tonight\'s dinner', /Sheet-pan sausage and vegetables/.test(await page.locator('main').innerText()));
await page.goto(base + '/things/pets'); await wait(page, 1000);
check('the pets page has the dog', /Biscuit/.test(await page.locator('main').innerText()));
await page.goto(base + '/things/upkeep/chart'); await wait(page, 1200);
check('the chore chart lists the children', /Mia/.test(await page.locator('main').innerText()) && /Leo/.test(await page.locator('main').innerText()));

// The front page: the getting-started card.
await page.goto(base + '/'); await wait(page, 1500);
const card = page.getByRole('region', { name: 'Getting started' });
t = flat(await card.innerText());
check('the front page has a getting-started card with up to four things to do', await card.isVisible() && /Add your first recipe/.test(t) && /Scan a shelf/.test(t) && /Add your car to get recall alerts/.test(t) && /Print a chore chart/.test(t), t.slice(0, 200));
check('and a way to clear the examples', await card.getByRole('button', { name: 'Clear the examples' }).isVisible());
check('no dialog and no "Finish setting up" card, as it was finished', !(await dlg.isVisible().catch(() => false)) && (await page.getByRole('region', { name: 'Finish setting up' }).count()) === 0);
await page.screenshot({ path: shots + '/start-card.png', fullPage: true });
// A thing is done when its data exists: a recipe of their own makes its tip go.
await api(page, 'POST', '/api/kitchen/recipes', { title: 'Our pancakes', ingredients_text: '2 cups flour\n2 eggs', steps_text: 'Mix.\nFry.' });
await page.reload(); await wait(page, 1500);
t = flat(await card.innerText());
check('"Add your first recipe" goes once they have one of their own', !/Add your first recipe/.test(t) && /Scan a shelf/.test(t), t.slice(0, 160));

// Edit one example, then clear: that one stays, and is said to.
const chili = (await api(page, 'GET', '/api/kitchen/recipes')).json.find((r) => r.title === 'Slow-cooker beef chili');
const whole = (await api(page, 'GET', `/api/kitchen/recipes/${chili.id}`)).json;
await api(page, 'PUT', `/api/kitchen/recipes/${chili.id}`, { title: whole.title, servings: 8, ingredients_text: `${whole.ingredients_text}\n1 tsp oregano`, steps_text: whole.steps_text, tags: whole.tags });
await card.getByRole('button', { name: 'Clear the examples' }).click(); await wait(page, 1500);
t = flat(await card.innerText());
check('clearing says what went and what was kept', /Cleared the examples: 2 recipes, 3 dinners and 6 grocery lines/.test(t) && /Kept “Slow-cooker beef chili” because you have changed it/.test(t), t.slice(0, 260));
const left = (await api(page, 'GET', '/api/kitchen/recipes')).json.map((r) => r.title).sort();
check('the edited example and their own recipe stay, nothing else', left.join('|') === 'Our pancakes|Slow-cooker beef chili', left.join('|'));
check('no examples are on offer any more', (await card.getByRole('button', { name: 'Clear the examples' }).count()) === 0);
await page.reload(); await wait(page, 1500);
check('after a reload, the start does not come back', (await dlg.count()) === 0 && (await page.getByRole('region', { name: 'Finish setting up' }).count()) === 0);
check('and the chosen parts are what shows', (await page.locator('nav[aria-label=Sections] a').allInnerTexts()).join(',') === 'delicious,organized', (await page.locator('nav[aria-label=Sections] a').allInnerTexts()).join(','));

// ---------- someone else: skip on step 1 ----------
await api(page, 'POST', '/api/users', { username: 'ben', password: PASS });
await api(page, 'POST', '/api/users', { username: 'cora', password: PASS });
const second = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
watch(second);
await signUp(second, 'ben', false);
const d2 = second.getByRole('dialog');
check('a second new household is asked too', await d2.isVisible());
await d2.getByRole('button', { name: 'Skip, show me everything' }).click(); await wait(second, 1500);
check('skipping on the first step closes it', (await d2.count()) === 0);
const life = (await api(second, 'GET', '/api/life')).json;
check('everything shows, as it always did', life.sections.length === 6 && (await second.locator('nav[aria-label=Sections] a').count()) === 6, JSON.stringify(life.sections));
check('and no sample was made', (await api(second, 'GET', '/api/kitchen/recipes')).json.length === 0 && (await api(second, 'GET', '/api/kitchen/grocery')).json.length === 0);
await second.reload(); await wait(second, 1500);
check('nor any card, nor the dialog again', (await d2.count()) === 0 && (await second.getByRole('region', { name: /Getting started|Finish setting up/ }).count()) === 0);

// ---------- someone else: close it part way ----------
const third = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
watch(third);
await signUp(third, 'cora', false);
const d3 = third.getByRole('dialog');
await d3.getByLabel('Children').fill('Zed');
await d3.getByRole('button', { name: 'Next' }).click(); await wait(third, 900);
check('they reach step 2', /Step 2 of 4/.test(flat(await d3.innerText())));
await third.keyboard.press('Escape'); await wait(third, 900);
check('Escape closes it', (await d3.count()) === 0);
await third.reload(); await wait(third, 1500);
check('it does not come back on its own', (await d3.count()) === 0);
const finish = third.getByRole('region', { name: 'Finish setting up' });
check('the front page offers to finish setting up, and what they did is kept', await finish.isVisible() && (await api(third, 'GET', '/api/things/upkeep/members')).json.map((m) => m.name).join() === 'Zed');
await finish.getByRole('button', { name: 'Pick up where you left off' }).click(); await wait(third, 1000);
check('it reopens at the step they left', /Step 2 of 4/.test(flat(await d3.innerText())) && await d3.getByLabel('Meals and groceries').isVisible());
await d3.getByRole('button', { name: 'Back' }).click(); await wait(third, 400);
check('and Back shows what they put in', (await d3.getByLabel('Children').inputValue()) === 'Zed');
await d3.getByRole('button', { name: 'Skip, show me everything' }).click(); await wait(third, 1800);
check('skipping from there ends it, with no card left', (await third.getByRole('region', { name: /Getting started|Finish setting up/ }).count()) === 0 && (await d3.count()) === 0);

console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no failed requests, no page errors');
check('no failed requests', bad.length === 0, [...new Set(bad)].join('; '));
await browser.close();
