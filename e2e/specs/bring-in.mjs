// Bringing many things in at once: recipes from another app's file (a real .paprikarecipes zip is built here,
// opened by the page, looked over, brought in, and brought in again), and a grocery list pasted in on a phone.
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const say = (what, ok, extra = '') => console.log((ok ? 'ok   ' : 'FAIL ') + what + (!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''));

// ---- the files, made the way the apps make them ----

/** A zip of files: each entry's bytes deflated (or stored, where asked), with the list at the end. */
function zip(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { path, bytes, stored } of files) {
    const name = Buffer.from(path, 'utf8');
    const plain = Buffer.from(bytes);
    const packed = stored ? plain : deflateRawSync(plain);
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0); shared.writeUInt16LE(0x0800, 2); shared.writeUInt16LE(stored ? 0 : 8, 4);
    shared.writeUInt32LE(crc32(plain), 10); shared.writeUInt32LE(packed.length, 14); shared.writeUInt32LE(plain.length, 18); shared.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), shared, name, packed]);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); shared.copy(entry, 6); entry.writeUInt32LE(offset, 42);
    directory.push(entry, name); parts.push(local); offset += local.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const PANCAKES = {
  name: 'Buttermilk  Pancakes', ingredients: '1 1/2 cups   all-purpose flour\n2 TBSP sugar\n1 egg, beaten\n1 1/4 cups buttermilk',
  directions: 'Whisk the dry things together.\n\nAdd the egg & buttermilk;  stir until just combined.\n\nCook on a hot griddle.',
  notes: 'Grandma said: never overmix.', description: 'Fluffy.  Really.', servings: 'Serves 4', prep_time: '10 min', cook_time: '1 hr 15 min',
  source: 'Grandma', source_url: 'https://example.com/pancakes', categories: ['Breakfast', 'Kid Friendly'], rating: 5, photo_data: Buffer.alloc(30_000, 7).toString('base64'),
};
const SOUP = { name: 'Tomato Soup', ingredients: '1 can tomatoes\n1 cup stock', directions: 'Simmer for twenty minutes.', servings: '6', categories: ['Soup'] };
const CHILI = { name: 'Weeknight Chili', ingredients: '1 lb ground beef\n1 can kidney beans\n2 tbsp chili powder', directions: 'Brown the beef.\n\nAdd everything else and simmer.', total_time: '45 min' };
const entry = (recipe) => ({ path: `${recipe.name}.paprikarecipe`, bytes: gzipSync(Buffer.from(JSON.stringify(recipe))) });
const paprika = zip([entry(PANCAKES), entry(SOUP), entry(CHILI)]);
const named = (name, buffer, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer });

// ---- the page ----

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const dialog = page.getByRole('dialog');
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// One of the three is in Life Is already: the same name and the same first ingredient, written a little differently.
await send('POST', '/api/kitchen/recipes', { title: 'tomato  soup', ingredients_text: '1 CAN Tomatoes\n2 cups water', steps_text: 'My own method.' });
// And a different Pancakes: the same name, another recipe.
await send('POST', '/api/kitchen/recipes', { title: 'Buttermilk Pancakes (spelt)', ingredients_text: '2 cups spelt flour', steps_text: 'Mix.' });

const bringInWay = async () => {
  await page.goto(base + '/recipes'); await wait(900);
  await page.getByRole('button', { name: 'Bring one in' }).click(); await wait(400);
  await dialog.getByRole('button', { name: 'Many, from another app' }).click(); await wait(300);
};
await bringInWay();
say('the way says where Pinterest recipes go', /open the pin's website[\s\S]*From a website/.test(await dialog.innerText()) && /AnyList has no way to export/.test(await dialog.innerText()));
await dialog.getByLabel('Choose a file of recipes').setInputFiles(named('My Recipes.paprikarecipes', paprika)); await wait(1200);
const look = await dialog.innerText();
say('the look-over counts them: ' + look.match(/\d+ recipes found[^\n]*/)?.[0], /3 recipes found, 1 already in Life Is\./.test(look));
say('it names them, and says the pictures are left out', /Buttermilk\s+Pancakes/.test(look) && /Tomato Soup/.test(look) && /Weeknight Chili/.test(look) && /1 picture left out/.test(look));
say('nothing is kept by looking', (await send('GET', '/api/kitchen/recipes')).length === 2);
await page.screenshot({ path: shots + '/bring-in-recipes.png' });
await dialog.getByRole('button', { name: 'Bring in 2' }).click(); await wait(1200);
const done = await dialog.innerText();
say('it reports added, already there and could not be read: ' + done.match(/Brought in:[^\n]*/)?.[0], /Brought in: 2 recipes added, 1 already there, 0 could not be read\./.test(done));
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);
const titles = await page.locator('main ul li a span.font-medium').evaluateAll((all) => all.map((n) => n.textContent));
say('they are in the recipe box: ' + titles.join(' | '), titles.length === 4 && titles.includes('Weeknight Chili') && titles.includes('Buttermilk  Pancakes'));
say('the same name with another first ingredient came in as its own recipe', titles.includes('Buttermilk Pancakes (spelt)') && titles.includes('Buttermilk  Pancakes'));
say('the soup already kept was left as it was', (await send('GET', '/api/kitchen/recipes')).filter((r) => /tomato\s+soup/i.test(r.title)).length === 1);

await page.goto(base + '/recipes/' + (await send('GET', '/api/kitchen/recipes')).find((r) => r.title === 'Buttermilk  Pancakes').id); await wait(1000);
const main = await page.locator('main').innerText();
const lis = await page.locator('main section ul li').evaluateAll((all) => all.map((n) => n.textContent));
say('its ingredients are exactly as written, one a line', JSON.stringify(lis.slice(0, 4)) === JSON.stringify(PANCAKES.ingredients.split('\n')), JSON.stringify(lis));
const steps = await page.locator('main ol li span.whitespace-pre-wrap').evaluateAll((all) => all.map((n) => n.textContent));
say('its directions are exactly as written', JSON.stringify(steps) === JSON.stringify(PANCAKES.directions.split('\n\n')), JSON.stringify(steps));
say('its notes, description, times, servings and source are kept', /Grandma said: never overmix\./.test(main) && /Fluffy\.\s+Really\./.test(main) && /prep 10 min/.test(main) && /cook 1 h 15 min/.test(main) && /https:\/\/example\.com\/pancakes/.test(main), main);
const kept = (await send('GET', '/api/kitchen/recipes')).find((r) => r.title === 'Buttermilk  Pancakes');
say('its categories are tags and it serves 4', JSON.stringify(kept.tags) === JSON.stringify(['breakfast', 'kid friendly']) && kept.servings === 4);

// The same file again: nothing new.
await bringInWay();
await dialog.getByLabel('Choose a file of recipes').setInputFiles(named('My Recipes.paprikarecipes', paprika)); await wait(1200);
const again = await dialog.innerText();
say('the same file again finds all three already here', /3 recipes found, 3 already in Life Is\./.test(again));
say('and offers nothing to bring in', await dialog.getByRole('button', { name: 'Nothing new to bring in' }).isDisabled());
await dialog.getByRole('button', { name: 'Close' }).click().catch(() => page.keyboard.press('Escape')); await wait(300);
say('still four recipes', (await send('GET', '/api/kitchen/recipes')).length === 4);

// A zip made by Life Is itself, and a JSON recipe, and a file with a damaged entry.
const exported = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch('/api/kitchen/recipes-export.zip')).arrayBuffer())));
await bringInWay();
await dialog.getByLabel('Choose a file of recipes').setInputFiles(named('lifeis-recipes.zip', Buffer.from(exported), 'application/zip')); await wait(1200);
say("Life Is's own export is read: all four are already here", /4 recipes found, 4 already in Life Is\./.test(await dialog.innerText()));
const flapjacks = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Flapjacks', recipeIngredient: ['2 cups oats', '1 cup butter'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Melt.' }, { '@type': 'HowToStep', text: 'Bake.' }], prepTime: 'PT10M', recipeYield: '12 bars', keywords: 'snack' };
const mixed = zip([entry(CHILI), { path: 'Broken.paprikarecipe', bytes: Buffer.from('this is not gzip') }, { path: 'Flapjacks.json', bytes: Buffer.from(JSON.stringify(flapjacks)), stored: true }]);
await dialog.getByLabel('Choose a file of recipes').setInputFiles(named('mixed.paprikarecipes', mixed)); await wait(1200);
const mixedLook = await dialog.innerText();
say('a damaged entry is named and the rest is read', /3 recipes found, 1 already in Life Is, 1 that can't be read\./.test(mixedLook) && /Broken: .+/.test(mixedLook));
await dialog.getByRole('button', { name: 'Bring in 1' }).click(); await wait(1200);
say('and the report says so', /Brought in: 1 recipe added, 1 already there, 1 could not be read\./.test(await dialog.innerText()));
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(600);
say('the JSON recipe came in', (await send('GET', '/api/kitchen/recipes')).some((r) => r.title === 'Flapjacks' && r.servings === 12));

// ---- a grocery list pasted in, on a phone ----

await send('POST', '/api/kitchen/grocery', { label: 'Eggs' });
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(base + '/groceries'); await wait(1200);
await page.getByRole('button', { name: 'Paste a list' }).click(); await wait(500);
await dialog.getByLabel('The list').fill('Produce:\n- apples\n- 2 lb chicken thighs\n[ ] milk, eggs, bread\n\n1. rice\n☐ tomatoes, diced\n');
await dialog.getByRole('button', { name: 'Look it over' }).click(); await wait(900);
const preview = await dialog.innerText();
say('the preview counts what will be added and what is there: ' + preview.match(/\d+ to add[^\n]*/)?.[0], /6 to add, 1 already on your list\./.test(preview));
say('marks, the heading and the blank lines are gone; the commas split only where they list things', /apples/.test(preview) && !/Produce/.test(preview) && !/\[ \]/.test(preview) && /tomatoes\s*diced/.test(preview) && /chicken thighs\s*2 lb/.test(preview), preview);
await dialog.getByRole('button', { name: 'Leave off apples' }).click(); await wait(300);
const tooSmall = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button:not([aria-label=Close]), [role=dialog] textarea')].map((b) => [b.textContent.trim().slice(0, 20), b.getBoundingClientRect().height]).filter(([, h]) => h > 0 && h < 43.5));
say('buttons in it are at least 44px tall' + (tooSmall.length ? ': ' + JSON.stringify(tooSmall) : ''), tooSmall.length === 0);
say('nothing scrolls sideways at 375px', await page.evaluate(() => document.documentElement.scrollWidth <= 375 && document.body.scrollWidth <= 375));
await page.screenshot({ path: shots + '/paste-list-phone.png' });
await dialog.getByRole('button', { name: 'Add 5' }).click(); await wait(1200);
const listText = await page.locator('main').innerText();
say('it says how many were added and how many were there', /Added 5 things, and 1 was already on the list\./.test(listText), listText);
say('the right lines are on the list', ['chicken thighs', 'milk', 'bread', 'rice', 'tomatoes', 'diced', 'Eggs'].every((w) => listText.includes(w)) && !/apples/.test(listText) && /2 lb/.test(listText), listText);
const items = (await send('GET', '/api/kitchen/grocery')).map((g) => g.label);
say('Eggs is there once', items.filter((l) => /^eggs$/i.test(l)).length === 1 && items.length === 6, items.join(', '));

console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
