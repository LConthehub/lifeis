// Signing in more safely: a code from an authenticator app as a second step, recovery codes, and passkeys.
// The authenticator app is a few lines of node:crypto here; the passkey device is Chromium's virtual authenticator.
import { createHmac } from 'node:crypto';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const home = new URL(base);
// Passkeys are tied to a name, never a number, so the passkey part is walked at localhost, the same Life Is.
const named = `http://localhost:${home.port}`;
const browser = await chromium.launch({ ...browserChoice, headless: true });
const bad = [];
const outside = [];
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));

// ---------- an authenticator app ----------
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const decode = (text) => {
  let bits = '';
  for (const ch of text.replace(/\s/g, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
};
const hotp = (key, counter) => {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const hash = createHmac('sha1', key).update(message).digest();
  const offset = hash[19] & 15;
  return String((((hash[offset] & 127) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3]) % 1_000_000).padStart(6, '0');
};
let secret = '';
let lastStep = 0;
/** A code Life Is has not seen yet: the next step if this one is spent (it allows one ahead), else it waits. */
async function freshCode() {
  for (;;) {
    const now = Math.floor(Date.now() / 30000);
    const step = Math.max(now, lastStep + 1);
    if (step <= now + 1) { lastStep = step; return hotp(decode(secret), step); }
    await wait(1000);
  }
}

async function open(width, height, origin) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push('console: ' + m.text().slice(0, 200)); });
  page.on('request', (r) => { const u = r.url(); if (!/^(data|blob):/.test(u) && !u.startsWith(origin)) outside.push(u); });
  return page;
}
const signOut = async (page, origin) => { await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' })); await page.goto(origin + '/'); await wait(800); };
const typePassword = async (page, origin) => {
  await page.goto(origin + '/'); await wait(1000);
  await page.getByRole('textbox').first().fill('ana');
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(1200);
};
const signedInNow = (page) => page.evaluate(async () => (await (await fetch('/api/auth/status')).json()).user?.username ?? null);
const tooSmall = (page, scope) => page.locator(scope).locator('button, input, select, a').evaluateAll((els) => els
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && getComputedStyle(e).visibility !== 'hidden'; })
  .map((e) => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('name') || e.tagName).slice(0, 40)));

// ---------- the first account, and turning two-step on ----------
const page = await open(1000, 900, base);
await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }

await page.goto(base + '/settings#security'); await wait(1500);
const section = page.locator('#security');
say('Settings has a "Sign-in security" section', await section.getByRole('heading', { name: 'Sign-in security' }).isVisible());
const said = (await section.locator('[data-passkeys-unavailable]').innerText().catch(() => '')).replace(/\s+/g, ' ');
say('at a number, passkeys are replaced by one plain sentence, and two-step is still offered: ' + said.slice(0, 60), /Passkeys need an address with a name/.test(said) && await section.getByRole('button', { name: 'Set up two-step sign-in' }).isVisible());

await section.getByRole('button', { name: 'Set up two-step sign-in' }).click(); await wait(300);
await section.getByLabel('Your password, to start').fill('not my password at all');
await section.getByRole('button', { name: 'Continue' }).click(); await wait(900);
say('a wrong password is refused in words', /That password is wrong/.test(await section.innerText()));
await section.getByLabel('Your password, to start').fill(PASS);
await section.getByRole('button', { name: 'Continue' }).click(); await wait(1500);
secret = (await section.locator('[data-two-step] code').innerText()).trim();
say('the secret is shown as text to type: ' + secret.replace(/./g, '•').slice(0, 4) + '… (' + secret.replace(/\s/g, '').length + ' characters)', /^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/.test(secret));
const qr = section.getByRole('img', { name: 'QR code for your authenticator app' });
await qr.waitFor({ timeout: 5000 });
say('and as a QR code Life Is drew itself', (await qr.getAttribute('src')).startsWith('data:image/png'));
await section.getByLabel('Then the 6-digit code the app shows').fill('000000');
await section.getByRole('button', { name: 'Turn on' }).click(); await wait(900);
say('a wrong code does not turn it on', /That code isn't right/.test(await section.innerText()));
await section.getByLabel('Then the 6-digit code the app shows').fill(await freshCode());
await section.getByRole('button', { name: 'Turn on' }).click(); await wait(1500);
const codes = (await section.locator('[data-recovery-codes] li').allInnerTexts()).map((t) => t.trim());
say('ten recovery codes are shown, once, with a warning: ' + codes.length, codes.length === 10 && /can't show them again/.test(await section.innerText()));
await section.getByRole('button', { name: 'I\'ve saved them' }).click(); await wait(500);
say('then they are gone from the page, and the count is kept', (await section.locator('[data-recovery-codes]').count()) === 0 && /10 recovery codes left/.test(await section.innerText()));

// ---------- signing in with the second step ----------
await signOut(page, base);
await typePassword(page, base);
say('after the password, a second screen asks for the code, and there is no session yet', /6-digit code/.test(await page.locator('body').innerText()) && (await signedInNow(page)) === null);
const field = page.getByLabel('6-digit code');
say('the code box is numeric and offered to the phone\'s code suggestions', (await field.getAttribute('inputmode')) === 'numeric' && (await field.getAttribute('autocomplete')) === 'one-time-code');
await field.fill('000000');
await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(900);
say('a wrong code is refused plainly', /That code isn't right/.test(await page.locator('body').innerText()) && (await signedInNow(page)) === null);
await page.getByLabel('6-digit code').fill(await freshCode());
await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(1500);
say('the right code signs in', (await signedInNow(page)) === 'ana');

await signOut(page, base);
await typePassword(page, base);
await page.getByRole('button', { name: 'Use a recovery code instead' }).click(); await wait(300);
await page.getByLabel('Recovery code').fill(codes[0]);
await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(1500);
say('a recovery code signs in', (await signedInNow(page)) === 'ana');
await signOut(page, base);
await typePassword(page, base);
await page.getByRole('button', { name: 'Use a recovery code instead' }).click(); await wait(300);
await page.getByLabel('Recovery code').fill(codes[0]);
await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(1200);
say('the same recovery code does not work twice', /That code isn't right/.test(await page.locator('body').innerText()) && (await signedInNow(page)) === null);
await page.getByRole('button', { name: 'Back' }).click(); await wait(300);
say('and there is a way back to the password', await page.getByLabel('Password').isVisible());

// ---------- passkeys, at a name (localhost), with a device that is Chromium's own virtual one ----------
const named1 = await open(1000, 900, named);
const cdp = await named1.context().newCDPSession(named1);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await typePassword(named1, named);
await named1.getByLabel('6-digit code').fill(await freshCode());
await named1.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(1500);
say('signed in again at localhost, with the app code', (await signedInNow(named1)) === 'ana');
await named1.goto(named + '/settings#security'); await wait(1500);
const here = named1.locator('#security');
say('at localhost, a passkey can be added', await here.getByRole('button', { name: 'Add a passkey on this device' }).isVisible());
await here.getByLabel('Name for this passkey').fill('Kitchen laptop');
await here.getByLabel('Your password, to add one').fill(PASS);
await here.getByRole('button', { name: 'Add a passkey on this device' }).click(); await wait(2500);
say('the passkey is added and listed by name', /Kitchen laptop/.test(await here.getByRole('list', { name: 'Your passkeys' }).innerText().catch(() => '')));
await here.getByRole('button', { name: 'Rename Kitchen laptop' }).click(); await wait(300);
await here.getByLabel('Passkey name').fill("Mom's iPhone");
await here.getByRole('button', { name: 'Save' }).click(); await wait(900);
const listed = (await here.getByRole('list', { name: 'Your passkeys' }).innerText()).replace(/\s+/g, ' ');
say('it can be renamed, and shows when it was added and that it is unused: ' + listed.slice(0, 70), /Mom's iPhone/.test(listed) && /not used yet/.test(listed));
await named1.screenshot({ path: shots + '/security-settings.png', fullPage: true });

await signOut(named1, named);
say('the sign-in page offers a passkey', await named1.getByRole('button', { name: 'Sign in with a passkey' }).isVisible());
await named1.getByRole('button', { name: 'Sign in with a passkey' }).click(); await wait(2500);
say('a passkey alone signs in, with no username, password or code', (await signedInNow(named1)) === 'ana');
await named1.goto(named + '/settings#security'); await wait(1500);
say('and it is marked as used', /last used/.test(await named1.locator('#security').getByRole('list', { name: 'Your passkeys' }).innerText()));

await signOut(named1, named);
await typePassword(named1, named);
await named1.getByRole('button', { name: 'Use a passkey instead' }).click(); await wait(2500);
say('a passkey can answer the second step instead of a code', (await signedInNow(named1)) === 'ana');

await named1.goto(named + '/settings#security'); await wait(1500);
await named1.locator('#security').getByRole('button', { name: "Remove Mom's iPhone" }).click(); await wait(300);
await named1.locator('#security').getByRole('button', { name: 'Yes, remove it' }).click(); await wait(1000);
say('a passkey can be removed', (await named1.locator('#security').getByRole('list', { name: 'Your passkeys' }).count()) === 0);
await signOut(named1, named);
await named1.getByRole('button', { name: 'Sign in with a passkey' }).click(); await wait(2500);
say('a removed passkey no longer signs in, and says so', (await signedInNow(named1)) === null && /didn't work/.test(await named1.locator('body').innerText()));

// ---------- a phone ----------
const phone = await open(375, 812, named);
await typePassword(phone, named);
say('on a phone, the second step does not run off the side: ' + await phone.evaluate(() => document.documentElement.scrollWidth), (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 375);
const smallStep = await tooSmall(phone, 'form[data-second-step]');
say('and every control on it is at least 44px tall' + (smallStep.length ? ': ' + smallStep.join(', ') : ''), smallStep.length === 0);
await phone.screenshot({ path: shots + '/second-step-phone.png' });
await phone.getByLabel('6-digit code').fill(await freshCode());
await phone.getByRole('button', { name: 'Sign in', exact: true }).click(); await wait(1500);
await phone.goto(named + '/settings#security'); await wait(1500);
await phone.locator('#security').getByRole('button', { name: 'Make new recovery codes' }).click(); await wait(300);
await phone.locator('#security').getByLabel('Your password', { exact: true }).fill(PASS);
await phone.locator('#security').getByRole('button', { name: 'Make new recovery codes' }).last().click(); await wait(2000);
say('new recovery codes need the password and replace the old', (await phone.locator('#security [data-recovery-codes] li').count()) === 10);
await phone.getByRole('button', { name: 'I\'ve saved them' }).click(); await wait(400);
const wideness = await phone.evaluate(() => document.documentElement.scrollWidth);
say('on a phone, the security section does not run off the side: ' + wideness, wideness <= 375);
const smallSettings = await tooSmall(phone, '#security');
say('and every control in it is at least 44px tall' + (smallSettings.length ? ': ' + smallSettings.join(', ') : ''), smallSettings.length === 0);

// ---------- turning it off ----------
await phone.locator('#security').getByRole('button', { name: 'Turn two-step off' }).click(); await wait(300);
await phone.locator('#security').getByLabel('Your password', { exact: true }).fill(PASS);
await phone.locator('#security').getByLabel('A code from your app, or a recovery code').fill(await freshCode());
await phone.locator('#security').getByRole('button', { name: 'Turn two-step off' }).last().click(); await wait(1500);
say('turning it off needs the password and a code, and then it is off', /Off\./.test(await phone.locator('#security').innerText()) && /Two-step sign-in is off/.test(await phone.locator('#security').innerText()));
await signOut(phone, named);
await typePassword(phone, named);
say('and the password alone signs in again', (await signedInNow(phone)) === 'ana');

say('Life Is made no request to anywhere else' + (outside.length ? ': ' + [...new Set(outside)].slice(0, 3).join(' ') : ''), outside.length === 0);
say('no page errors' + (bad.length ? ': ' + [...new Set(bad)].join(' | ') : ''), bad.length === 0);
await browser.close();
