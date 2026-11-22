// Reminders that reach you: off until turned on, what each way sends said plainly, a preview of this
// morning's digest, and ntfy turned on and tried against a stand-in ntfy server.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const NTFY = 'http://127.0.0.1:8098';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

// Something due, so the digest has a line.
await page.evaluate(() => fetch('/api/things/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test the smoke alarms', every_n: 1, every_unit: 'month' }) }));

await page.goto(`${base}/settings/reminders`); await page.waitForTimeout(1500);
const all = page.locator('[data-reminders]');
const text = async () => (await all.innerText()).replace(/\s+/g, ' ');
check('Reminders has its own group, everything off', /Nothing is turned on, so nothing is sent/.test(await text()));
check('each way says what it sends', /What it sends: Each morning's reminder, sent from the email account/.test(await text())
  && /aren't locked/.test(await text()) && /locked so only your browser can read it/.test(await text()));
check('email asks for an account first', await page.getByRole('link', { name: 'Connect your email first' }).isVisible());
await page.locator('[data-preview] summary').click();
check('the preview shows this morning’s digest', (await page.locator('[data-preview]').innerText()).includes('Test the smoke alarms'), (await page.locator('[data-preview]').innerText()).replace(/\s+/g, ' ').slice(0, 120));

await page.getByLabel('When').fill('06:15'); await page.waitForTimeout(800);
const saved = await page.evaluate(() => fetch('/api/reminders').then((r) => r.json()));
check('the time is kept, with this browser’s time zone', saved.settings.time === '06:15' && Boolean(saved.settings.zone), `${saved.settings.time} ${saved.settings.zone}`);
await page.locator('label').filter({ hasText: 'Running low, or food to use soon' }).locator('input').uncheck(); await page.waitForTimeout(800);
check('a kind of reminder can be left out', (await page.evaluate(() => fetch('/api/reminders').then((r) => r.json()))).settings.covers.low === false);

const ntfy = page.getByRole('region', { name: 'ntfy' });
await ntfy.getByLabel('ntfy server').fill(NTFY);
await ntfy.getByRole('button', { name: 'Turn on' }).click(); await page.waitForTimeout(1000);
const topic = (await page.evaluate(() => fetch('/api/reminders').then((r) => r.json()))).settings.ntfy?.topic ?? '';
check('ntfy is turned on with a long random topic to subscribe to', /^lifeis-[a-z2-9]{15}$/.test(topic) && (await ntfy.innerText()).includes(topic), topic);
await ntfy.getByRole('button', { name: 'Send one now' }).click(); await page.waitForTimeout(1500);
check('trying it says it went', (await ntfy.innerText()).includes('Sent.'));
const got = await (await fetch(`${NTFY}/_seen`)).json();
check('the ntfy server got only how many, not what', got.length === 1 && got[0].topic === topic && got[0].body === '1 thing needs you today. Open Life Is to see what.' && got[0].priority === 'high', JSON.stringify(got[0] ?? {}));
await ntfy.getByLabel(/Say what each thing is/).check(); await page.waitForTimeout(800);
await ntfy.getByRole('button', { name: 'Send one now' }).click(); await page.waitForTimeout(1500);
const again = await (await fetch(`${NTFY}/_seen`)).json();
check('asked to, it says what each thing is', again[1]?.body?.startsWith('! Test the smoke alarms — due today'), again[1]?.body?.split('\n')[0]);

const worker = await page.evaluate(() => fetch('/sw.js').then(async (r) => [r.status, r.headers.get('content-type'), (await r.text()).includes("addEventListener('push'")]));
check('the browser’s reminder helper is served', worker[0] === 200 && /javascript/.test(worker[1] ?? '') && worker[2], JSON.stringify(worker));
await browser.close();
