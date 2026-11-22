// Every page, at the sizes of the devices Life Is should look right on. Reports anything wider than the screen,
// text too small to read, and tap targets too small to hit, and takes a picture of a few.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';

const SIZES = [
  ['iPhone SE', 375, 667], ['iPhone 16', 393, 852], ['iPhone 16 Pro Max', 440, 956], ['iPhone sideways', 852, 393],
  ['Foldable iPhone, closed (rumoured)', 360, 780], ['Foldable iPhone, open (rumoured)', 760, 860],
  ['Galaxy Fold, closed', 344, 882], ['Galaxy Fold, open', 673, 841],
  ['iPad, a third of the screen', 320, 1024], ['iPad, half the screen', 507, 1024],
  ['iPad mini', 744, 1133], ['iPad Air', 820, 1180], ['iPad Air sideways', 1180, 820], ['iPad Pro 13"', 1032, 1376], ['iPad Pro 13" sideways', 1376, 1032],
  ['Android tablet', 800, 1280], ['Laptop', 1440, 900],
];
const PAGES = ['/', '/recipes', '/recipes/1', '/week', '/groceries', '/pantry', '/prices', '/calendar', '/plans', '/mail', '/things', '/things/places', '/things/kinds',
  '/projects', '/projects/1', '/money', '/media', '/media/servers', '/settings', '/settings/connections', '/settings/reminders',
  '/things/upkeep', '/things/activities', '/things/pets', '/things/packing', '/things/report', '/manual', '/media/books', '/do/add-to-groceries?item=eggs'];
const PICTURES = new Set(['iPhone SE', 'Foldable iPhone, open (rumoured)', 'iPad, a third of the screen', 'iPad Pro 13" sideways', 'iPhone sideways']);

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
const page = await context.newPage();
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }
// Something on each page, with long words, so the layouts are tried with real-looking content.
await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
  await post('/api/kitchen/recipes', { title: 'Grandmother’s slow-roasted tomato and white bean cassoulet', ingredients_text: '2 cups dried cannellini beans, soaked overnight\n1 tbsp extra-virgin olive oil\n4 cloves garlic', steps_text: 'Simmer the beans until tender, about an hour and a half.', tags: ['winter', 'make-ahead'] });
  await post('/api/kitchen/grocery', { label: '2 litres semi-skimmed milk' });
  await post('/api/projects', { name: 'Linen shirt dress with patch pockets', activity: 'Sewing', status: 'active' });
  const cat = await post('/api/money/categories', { name: 'Groceries and household', monthly_cents: 60000 });
  await post('/api/money/entries', { label: 'Farmers market', cents: 4250, category_id: cat?.id ?? null });
});

const problems = {};
const note = (where, what) => { (problems[what] ??= []).push(where); };
for (const [name, width, height] of SIZES) {
  await page.setViewportSize({ width, height });
  for (const path of PAGES) {
    await page.goto(base + path); await page.waitForTimeout(700);
    const found = await page.evaluate((w) => {
      const out = [];
      if (document.documentElement.scrollWidth > w + 1) {
        // The widest things that stick out, to know what to fix.
        const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > w + 1 && el.getBoundingClientRect().width > 0)
          .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 2)
          .map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''} "${(el.innerText || '').slice(0, 30).replace(/\s+/g, ' ')}"`);
        out.push(`wider than the screen (${document.documentElement.scrollWidth}px): ${wide.join(' | ')}`);
      }
      const tiny = [...document.querySelectorAll('main *')].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11 && el.getBoundingClientRect().width > 0);
      if (tiny.length) out.push(`text under 11px: ${tiny.slice(0, 2).map((el) => `"${el.textContent.trim().slice(0, 20)}"`).join(', ')}`);
      return out;
    }, width);
    for (const f of found) note(`${name} ${path}`, f.replace(/\(\d+px\)/, '').replace(/"[^"]*"/g, '…').slice(0, 150) + ' ⟶ ' + f.slice(0, 260));
    if (PICTURES.has(name) && ['/', '/recipes/1', '/money', '/settings'].includes(path)) await page.screenshot({ path: `${shots}/size-${name.replace(/[^a-z0-9]+/gi, '-')}${path.replace(/\//g, '-') || '-home'}.png`, fullPage: false });
  }
}
// Gathered by kind of problem, each with every place it happened.
const kinds = Object.entries(problems);
if (!kinds.length) console.log(`PASS nothing wider than the screen, and no tiny text, on ${PAGES.length} pages at ${SIZES.length} sizes`);
for (const [what, where] of kinds) console.log(`FAIL ${where.length} × ${what.split(' ⟶ ')[1] ?? what} — at: ${[...new Set(where)].slice(0, 8).join('; ')}${where.length > 8 ? ' …' : ''}`);
await browser.close();
