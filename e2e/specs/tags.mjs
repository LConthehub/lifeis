// Tags: made and nested on their page, put on a thing and a recipe from their forms, used to filter a list,
// put on several things at once, merged, and followed from a chip to the tag's own page.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const dialog = page.getByRole('dialog');
const text = () => page.locator('main').innerText();
const flat = (s) => s.replace(/\s+/g, ' ');
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
/** Both sizes of the same screen. */
const shoot = async (name) => {
  await page.setViewportSize({ width: 375, height: 812 }); await wait(500);
  await page.screenshot({ path: `${shots}/tags-${name}-375.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 }); await wait(500);
  await page.screenshot({ path: `${shots}/tags-${name}-1280.png`, fullPage: true });
};

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// Some things to tag.
const kinds = await send('POST', '/api/things/kinds', { name: 'Gadgets', icon: '🔌', fields: [] });
const kind = kinds.find((k) => k.name === 'Gadgets');
const blender = await send('POST', '/api/things/items', { kind_id: kind.id, name: 'Blender' });
const kettle = await send('POST', '/api/things/items', { kind_id: kind.id, name: 'Kettle' });
const drill = await send('POST', '/api/things/items', { kind_id: kind.id, name: 'Drill' });

// ---- the tags page: make a tag, then one inside it ----
await page.goto(base + '/tags'); await wait(1000);
check('with no tags the page says so and offers to make one', /No tags yet/.test(await text()));
await page.getByLabel('A new tag').fill('Kitchen');
await page.getByRole('button', { name: 'Add the tag' }).click(); await wait(800);
await page.getByLabel('A new tag').fill('Appliances');
await page.getByLabel('Inside').selectOption({ label: 'Kitchen' });
await page.getByRole('button', { name: 'Add the tag' }).click(); await wait(800);
let tree = await send('GET', '/api/tags');
check('a tag is made, and another nested inside it', tree.map((t) => t.path).join('|') === 'Kitchen|Kitchen > Appliances', JSON.stringify(tree));
const rows = await page.locator('[data-tag-tree] li').allInnerTexts();
check('the tree shows the nested one under its parent', rows.length === 2 && /Kitchen/.test(rows[0]) && /Appliances/.test(rows[1]) && /nothing yet/.test(rows[1]), rows.join(' / '));
const kitchen = tree[0];

// ---- tag a thing from its form: type to find, the path shows ----
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('button', { name: '+ Add' }).click(); await wait(500);
await dialog.getByLabel('What *').fill('Toaster');
await dialog.getByLabel('Add to tags').fill('appl'); await wait(300);
check('typing finds the tag and shows where it sits', (await dialog.getByRole('button', { name: 'Kitchen > Appliances' }).count()) === 1);
await shoot('picker');
await dialog.getByRole('button', { name: 'Kitchen > Appliances' }).click();
await dialog.getByLabel('Add to tags').fill('Garden > Tools'); await wait(300);
check('a tag that is not there can be made, with its path', await dialog.getByRole('button', { name: 'Make the tag "Garden > Tools"' }).isVisible());
await dialog.getByLabel('Add to tags').press('Enter'); await wait(300);
check('both are on the form as removable tags', (await dialog.getByRole('list', { name: 'Tags on this' }).innerText()).replace(/\s+/g, ' ').includes('Kitchen > Appliances') && (await dialog.getByRole('button', { name: 'Take off Garden > Tools' }).count()) === 1);
const crossHeight = await dialog.getByRole('button', { name: 'Take off Garden > Tools' }).evaluate((b) => b.getBoundingClientRect().height);
check('the take-off button is at least 44px tall', crossHeight >= 44, crossHeight);
await dialog.getByRole('button', { name: 'Take off Garden > Tools' }).click();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
const toaster = (await send('GET', '/api/things/items')).find((i) => i.name === 'Toaster');
check('saving keeps the tag on the thing, and a tag taken off is not made', toaster.tag_list.map((t) => t.path).join() === 'Kitchen > Appliances' && !(await send('GET', '/api/tags')).some((t) => t.name === 'Tools'), JSON.stringify(toaster.tag_list));
check('the row shows it as a chip', (await page.locator('main [data-tag-chips] a', { hasText: 'Appliances' }).count()) === 1);

// ---- a recipe from its form ----
await page.goto(base + '/recipes'); await wait(1000);
await page.getByRole('button', { name: '+ New recipe' }).click(); await wait(500);
await dialog.getByLabel('Name *').fill('Leek soup');
await dialog.getByLabel('Add to tags').fill('Kitchen'); await wait(300);
await dialog.getByRole('button', { name: 'Kitchen', exact: true }).click();
await dialog.getByLabel('Add to tags').fill('winter');
await dialog.getByLabel('Add to tags').press('Enter'); await wait(200);
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1500);
const soup = (await send('GET', '/api/kitchen/recipes')).find((r) => r.title === 'Leek soup');
check('a recipe keeps tags found and made in its form', soup.tags.slice().sort().join() === 'Kitchen,winter', JSON.stringify(soup.tags));

// ---- filter a list: a parent includes what is inside it ----
await page.goto(base + '/things'); await wait(1000);
check('before filtering, all four things show', /Blender/.test(await text()) && /Toaster/.test(await text()) && /Drill/.test(await text()));
await page.getByLabel('Tag', { exact: true }).selectOption({ label: 'Kitchen (2)' }); await wait(1000);
let t = await text();
check('filtering by Kitchen shows the thing tagged Kitchen > Appliances and nothing else', /Toaster/.test(t) && !/Blender|Kettle|Drill/.test(t), flat(t).slice(0, 200));
await page.goto(base + '/recipes'); await wait(1000);
await page.getByLabel('Tag', { exact: true }).selectOption({ label: 'winter (1)' }); await wait(1000);
check('the recipe list filters by a tag too', /Leek soup/.test(await text()));

// ---- choose several and tag them together ----
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('button', { name: 'Choose several' }).click(); await wait(300);
const box = await page.getByLabel('Choose Blender').evaluate((b) => b.closest('label').getBoundingClientRect().height);
check('the boxes are 44px tall', box >= 44, box);
await page.getByLabel('Choose Blender').check();
await page.getByLabel('Choose Kettle').check(); await wait(200);
check('the bar says how many are chosen', /2 chosen/.test(await page.locator('[data-bulk-bar]').innerText()));
await shoot('things-bulk-open');
await page.getByRole('button', { name: 'Add a tag' }).click(); await wait(400);
check('the dialog names how many it tags', /Add tags to 2 things/.test(await dialog.innerText()));
await dialog.getByLabel('Add to tags').fill('Appliances'); await wait(300);
await dialog.getByRole('button', { name: 'Kitchen > Appliances' }).click();
await shoot('things-bulk-picker');
await dialog.getByRole('button', { name: 'Add them' }).click(); await wait(1200);
let all = await send('GET', '/api/things/items');
check('both are tagged at once, and the one not chosen is not', ['Blender', 'Kettle', 'Toaster'].every((n) => all.find((i) => i.name === n).tag_list.length === 1) && all.find((i) => i.name === 'Drill').tag_list.length === 0);
check('choosing ends after the change', (await page.locator('[data-bulk-bar]').count()) === 0);
// And take one off again.
await page.getByRole('button', { name: 'Choose several' }).click();
await page.getByLabel('Choose Kettle').check();
await page.getByRole('button', { name: 'Take a tag off' }).click(); await wait(300);
await dialog.getByLabel('Add to tags').fill('Appliances'); await wait(300);
await dialog.getByRole('button', { name: 'Kitchen > Appliances' }).click();
await dialog.getByRole('button', { name: 'Take them off' }).click(); await wait(1000);
all = await send('GET', '/api/things/items');
check('a tag is taken off one thing without touching the others', all.find((i) => i.name === 'Kettle').tag_list.length === 0 && all.find((i) => i.name === 'Blender').tag_list.length === 1);

// ---- the tag's page, reached from a chip ----
await page.goto(base + '/things'); await wait(1000);
await page.locator('main [data-tag-chips] a', { hasText: 'Appliances' }).first().click(); await wait(1200);
t = await text();
check('a chip leads to the tag, with what has it grouped by kind and linked', /Appliances/.test(t) && /Things/.test(t) && /Toaster/.test(t) && /Blender/.test(t) && !/Kettle/.test(t), flat(t).slice(0, 300));
await page.goto(`${base}/tags/${kitchen.id}`); await wait(1200);
t = await text();
check("the parent's page includes what is in the tag inside it, with a recipe in its own group", /Things\s*2/.test(t) && /Recipes\s*1/.test(t) && /Leek soup/.test(t) && /Inside it:/.test(t), flat(t).slice(0, 300));
await shoot('page');
await page.getByRole('link', { name: 'Leek soup' }).click(); await wait(1000);
check('each one leads to the thing itself', /\/recipes\/\d+$/.test(page.url()));

// ---- merge, rename, nest, delete ----
await page.goto(base + '/tags'); await wait(1000);
await page.getByLabel('A new tag').fill('Gadgets');
await page.getByRole('button', { name: 'Add the tag' }).click(); await wait(800);
await send('POST', '/api/tags/bulk', { kind: 'thing', ids: [drill.id, blender.id], add: [(await send('GET', '/api/tags')).find((x) => x.name === 'Gadgets').id], remove: [] });
await page.goto(base + '/tags'); await wait(1000);
await page.getByRole('button', { name: 'Change Gadgets' }).click(); await wait(400);
await dialog.getByLabel('Name').fill('Machines'); await dialog.getByLabel('Inside').selectOption({ label: 'Kitchen' });
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1000);
tree = await send('GET', '/api/tags');
check('a tag is renamed and put inside another', tree.some((x) => x.path === 'Kitchen > Machines'), JSON.stringify(tree.map((x) => x.path)));
await page.getByRole('button', { name: 'Change Kitchen > Machines' }).click(); await wait(400);
await dialog.getByLabel('Merge into another tag').selectOption({ label: 'Kitchen > Appliances' });
await dialog.getByRole('button', { name: 'Merge them' }).click(); await wait(1200);
tree = await send('GET', '/api/tags');
all = await send('GET', '/api/things/items');
check('merging moves what was tagged onto the other tag, once, and the merged tag goes', !tree.some((x) => x.name === 'Machines') && all.find((i) => i.name === 'Blender').tag_list.map((x) => x.path).join() === 'Kitchen > Appliances' && all.find((i) => i.name === 'Drill').tag_list.map((x) => x.path).join() === 'Kitchen > Appliances', JSON.stringify(all.map((i) => [i.name, i.tag_list.map((x) => x.path)])));
await page.goto(base + '/tags'); await wait(800);
await shoot('list');
await page.getByRole('button', { name: 'Change Kitchen', exact: true }).click(); await wait(400);
await dialog.getByRole('button', { name: 'Delete this tag' }).click(); await wait(1200);
tree = await send('GET', '/api/tags');
all = await send('GET', '/api/things/items');
check('deleting a tag takes it off everything and moves what was inside it up', tree.some((x) => x.path === 'Appliances') && !tree.some((x) => x.name === 'Kitchen') && all.find((i) => i.name === 'Toaster').tag_list.map((x) => x.path).join() === 'Appliances', JSON.stringify(tree.map((x) => x.path)));

// ---- search finds a tag and what has it ----
const found = await send('GET', '/api/search?q=appliances');
check('search finds the tag and the things that have it', found[0].kind === 'tag' && found.some((r) => r.title === 'Toaster'), JSON.stringify(found.map((r) => r.title)));

// ---- phone width ----
await page.setViewportSize({ width: 375, height: 812 });
for (const path of ['/tags', `/tags/${tree.find((x) => x.name === 'Appliances').id}`, '/things', '/recipes']) {
  await page.goto(base + path); await wait(1000);
  check(`${path} does not scroll sideways at 375px`, !(await sideways()));
  const small = await page.evaluate(() => [...document.querySelectorAll('main button, main select, main [data-tag-tree] a')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => [(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 40));
  check(`${path}: its tag controls are tall enough to press` + (small.length ? ': ' + JSON.stringify(small) : ''), small.filter(([n]) => /tag|Choose|chosen|Change|Add the|Appliances|Nothing:/i.test(n) && !/^\+ /.test(n)).length === 0);
}
await page.setViewportSize({ width: 1280, height: 1000 });

if (bad.length) check('no failed requests or page errors', false, bad.join('; '));
await browser.close();
