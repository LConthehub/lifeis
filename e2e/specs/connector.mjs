// Use Life Is from your AI app, on a 375px phone: the person in charge turns it on behind More, an AI app (played here by
// this script) registers, sends the person to the approval page, gets a code, swaps it for a token, and reads and adds
// groceries through /mcp. Then the Settings card shows the connection and the log, the add is undone, the connection is
// cut off and the next call is refused. Pictures at 375px: the approval page, and the Settings card with a connection and the log.
import { createHash, randomBytes } from 'node:crypto';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8181';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'light', hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** For a picture of one part: the bars that stay in place while scrolling are put aside, so they don't cover it. */
const aside = (keep) => page.evaluate((selector) => { for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && !e.closest(selector)) e.style.visibility = 'hidden'; } }, keep);
const short = (selector) => page.locator(`${selector} button, ${selector} input:not([type=checkbox]), ${selector} a, ${selector} label`).evaluateAll((els) => els
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && !e.closest('[role=status]'); })
  .map((e) => (e.getAttribute('aria-label') || e.textContent || e.name || e.tagName).trim().slice(0, 30)));

// ---- the first account is the person in charge ----
await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }

// ---- Settings: behind More, off ----
await page.goto(base + '/settings/connections'); await wait(1500);
check('nothing about AI apps shows before More is pressed', (await page.locator('[data-connector]').count()) === 0 && !/AI app/.test(await page.locator('main').innerText()));
await page.locator('[data-settings-more]').click(); await wait(800);
const card = page.locator('[data-connector]');
check('behind More there is a card, off, that says what it sends and what is never included', await card.isVisible() && /What it does:/.test(await card.innerText()) && /Never included/.test(await card.innerText()) && /90 days/.test(await card.innerText()));
check('it says nothing is connected only once it is on', !/No AI app is connected/.test(await card.innerText()));
const words = flat(await card.innerText());
check('it never says OAuth, MCP, token or client', !/\b(OAuth|MCP|token|client)\b/i.test(words), words.slice(0, 80));
await card.getByLabel('Turn on use from an AI app').click(); await wait(1000);
check('turned on, it says no AI app is connected and shows how to connect', /No AI app is connected\./.test(await card.innerText()) && /Paste the address in your AI app/.test(await card.innerText()));
check('the address is shown, or the plain reason it cannot be reached', (await card.locator('[data-reach]').count()) === 1);

// ---- an AI app registers and sends the person to the approval page ----
const callback = base + '/walk-callback';
const registered = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Walk-through app', redirect_uris: [callback] }) });
const client = await registered.json();
check('the app registers', registered.status === 201 && Boolean(client.client_id), String(registered.status));
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'walk-state', resource: base + '/mcp' }).toString();

// Signing in first keeps the request.
const stranger = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
const other = await stranger.newPage();
await other.goto(`${base}/connect?${query}`); await wait(1200);
await other.getByRole('textbox').first().fill('ana');
await other.locator('input[type=password]').fill(PASS);
await other.getByRole('button', { name: /Sign in/ }).click(); await wait(2500);
check('signing in on the way keeps the request', new URL(other.url()).pathname === '/connect' && other.url().includes(client.client_id) && /Connect an AI app to your Life Is/.test(await other.locator('body').innerText()), other.url());
await stranger.close();

await page.route('**/walk-callback*', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'back in the app' }));
await page.goto(`${base}/connect?${query}`); await wait(1500);
const body = flat(await page.locator('body').innerText());
check('the page says who is asking and where you go back to', /Walk-through app is asking to use your Life Is/.test(body) && /you go back to 127\.0\.0\.1/.test(body), body.slice(0, 200));
check('it has no menu bar', (await page.locator('header').count()) === 0);
const ticks = page.locator('form input[type=checkbox]');
const count = await ticks.count();
const states = await ticks.evaluateAll((els) => els.map((e) => e.checked));
check('every tick starts unticked (six sections and the add tick)', count === 7 && states.every((x) => !x), `${count} boxes, ticked: ${states.filter(Boolean).length}`);
check('money shows its warning', (await page.locator('[data-warning]').count()) >= 1);
check('it names what is never included and the 90 days', /Never included/.test(body) && /90 days/.test(body));
check('the name starts filled in', (await page.locator('form input[type=text], form input:not([type])').first().inputValue()).length > 0);
check('no sideways scroll', (await sideways()) <= 0, String(await sideways()));
check('every control is at least 44px tall', (await short('form')).length === 0, (await short('form')).join(', '));
await page.screenshot({ path: `${shots}/connector-approve-375.png`, fullPage: true });

// ---- name it, tick Kitchen and "It may add things", Allow ----
await page.locator('form input[type=text], form input:not([type])').first().fill('Claude on my phone');
await page.getByLabel(/^Kitchen/).check();
await page.getByLabel(/It may add things/).check();
const landing = page.waitForRequest((r) => r.url().includes('/walk-callback'), { timeout: 15000 });
await page.getByRole('button', { name: 'Allow', exact: true }).click();
const landed = new URL((await landing).url());
const code = landed.searchParams.get('code');
check('Allow sends the person back with a code and the same state', Boolean(code) && landed.searchParams.get('state') === 'walk-state', landed.search.slice(0, 60));

// ---- the app swaps the code, then reads and adds ----
let swap; try { swap = await fetch(base + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: callback }) }); } catch (e) { check("the code is swapped", false, String(e.cause?.message ?? e.message)); process.exit(1); }
const tokens = await swap.json();
check('the code is swapped for a token', swap.status === 200 && /^lia_/.test(tokens.access_token ?? ''), String(swap.status));
const mcp = async (method, params, token = tokens.access_token) => {
  const response = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text };
};
const listed = await mcp('tools/list', {});
const names = (listed.json?.result?.tools ?? []).map((t) => t.name);
check('it sees the kitchen tools, including adding groceries, and nothing from other sections', names.includes('get_grocery_list') && names.includes('add_groceries') && !names.includes('get_spending'), names.join(', '));
const add = await mcp('tools/call', { name: 'add_groceries', arguments: { items: ['walk-through milk'] } });
check('it adds a grocery line', add.status === 200 && !add.json?.result?.isError, add.text.slice(0, 120));
const read = await mcp('tools/call', { name: 'get_grocery_list', arguments: {} });
check('it reads the list and sees the line', /walk-through milk/.test(read.text), read.text.slice(0, 120));
const denied = await mcp('tools/call', { name: 'get_spending', arguments: {} });
check('a section that was not ticked is refused', denied.json?.result?.isError === true || Boolean(denied.json?.error), denied.text.slice(0, 120));

// ---- Settings shows the connection and the log ----
await page.goto(base + '/settings/connections'); await wait(1800);
const opened = page.locator('[data-connector]');
check('More opens by itself now there is a connection', (await page.locator('[data-settings-more]').count()) === 0 && await opened.isVisible());
const shown = flat(await opened.innerText());
check('the card shows the connection: name, app, what it may see, adds, last used, when it ends',
  /Claude on my phone/.test(shown) && /Walk-through app/.test(shown) && /May see: Kitchen|May see: .*Kitchen/.test(shown) && /It may add things\./.test(shown) && /Last used/.test(shown) && /Ends by itself on .* if it isn't used/.test(shown), shown.slice(0, 300));
const lines = opened.locator('[data-log]');
check('the log has the read and the add, with the connection name', (await lines.count()) >= 2 && /Claude on my phone/.test(await lines.first().innerText()) && /walk-through milk/.test(await opened.innerText()));
check('the add has an Undo button', await opened.getByRole('button', { name: 'Undo' }).count() === 1);
check('no sideways scroll on the card', (await sideways()) <= 0, String(await sideways()));
check('every control on the card is at least 44px tall', (await short('[data-connector]')).length === 0, (await short('[data-connector]')).join(', '));
await opened.scrollIntoViewIfNeeded();
await aside('[data-connector]');
await opened.screenshot({ path: `${shots}/connector-settings-375.png` });
await page.reload(); await wait(1500);

// ---- undo the add ----
await page.locator('[data-connector]').getByRole('button', { name: 'Undo' }).click(); await wait(1200);
check('the add shows as Undone', /Undone/.test(await page.locator('[data-connector] [data-log]').first().innerText().catch(() => '')) || /Undone/.test(await page.locator('[data-connector]').innerText()));
const after = await mcp('tools/call', { name: 'get_grocery_list', arguments: {} });
check('the grocery line is gone', !/walk-through milk/.test(after.text), after.text.slice(0, 120));

// ---- cut it off ----
await page.locator('[data-connector]').getByRole('button', { name: 'Cut off Claude on my phone' }).click(); await wait(300);
await page.locator('[data-connector]').getByRole('button', { name: 'Yes, cut it off' }).click(); await wait(1200);
check('the card says no AI app is connected', /No AI app is connected\./.test(await page.locator('[data-connector]').innerText()));
const refused = await mcp('tools/list', {});
check('the next /mcp call is refused', refused.status === 401, String(refused.status));
check('and it cannot be renewed', (await fetch(base + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token ?? 'lir_none', client_id: client.client_id }) })).status === 400);

// ---- a refusal shows plain words, with no buttons ----
await page.goto(`${base}/connect?client_id=nobody&redirect_uri=${encodeURIComponent(callback)}&response_type=code`); await wait(1500);
check('a bad request shows plain words and no buttons', (await page.getByRole('button', { name: 'Allow', exact: true }).count()) === 0 && (await page.locator('[data-refusal]').count()) === 1, flat(await page.locator('main').innerText()).slice(0, 120));
await browser.close();
