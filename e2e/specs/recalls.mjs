// Recall alerts for cars: turned on in Settings (what it sends said plainly), a car with its make, model and year
// and a VIN, checked against a stand-in NHTSA, its recalls shown on its page, one dismissed and staying so, and
// the stand-in's own log showing that the VIN was never sent.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const NHTSA = 'http://127.0.0.1:8100';
const VIN = '4S4BTGPD5L3123456';
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const bad = [];
page.on('response', (r) => {
  if (!r.url().includes('/api/') || r.status() < 400) return;
  bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
});
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const text = async () => page.locator('main').innerText();
const wait = (ms = 700) => page.waitForTimeout(ms);
const dialog = () => page.getByRole('dialog');
const field = (label) => dialog().locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const flat = (s) => s.replace(/\s+/g, ' ');
const log = async () => (await fetch(`${NHTSA}/log`)).json();
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

await page.goto(base + '/');
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click();
await wait(1000);
{ const skip = dialog().getByRole('button', { name: 'Skip, show me everything' }); if (await skip.isVisible().catch(() => false)) { await skip.click(); await wait(900); } }

// ---- off, until turned on, saying what it sends ----
await page.goto(base + '/settings/connections#recalls'); await wait(1500);
const section = () => page.locator('#recalls');
let s = flat(await section().innerText());
say('recall alerts start off, and say exactly what is sent: ' + s.slice(0, 260),
  /Recall alerts for your cars/.test(s) && /Off/.test(s) && /What it's sent: The make, model and year of each car you have recorded \(for example Subaru, Outback, 2019\), and nothing else\. No VIN, no name, no account, no key\./.test(s));
const note = section().getByRole('link', { name: "NHTSA's own site" });
say('the VIN note is there, and its link opens a new tab telling the other site nothing',
  /This checks by make, model and year, so some recalls listed may not apply to your car\. For a certain answer, enter your VIN on NHTSA's own site\. Life Is never sends the VIN\./.test(s)
  && await note.getAttribute('href') === 'https://www.nhtsa.gov/recalls' && await note.getAttribute('target') === '_blank' && /noopener/.test(await note.getAttribute('rel')) && /noreferrer/.test(await note.getAttribute('rel')));
say('nothing has been asked of NHTSA', (await log()).length === 0);
await section().getByLabel('Turn on recall alerts').click(); await wait(900);
s = flat(await section().innerText());
say('turned on: it says so, and nothing is asked by that alone: ' + s.slice(0, 200), /On/.test(s) && /Not checked yet/.test(s) && /No car can be checked yet/.test(s) && (await log()).length === 0);

// ---- a car: the ready-made Vehicles kind, and a car with a make, model and year ----
await page.goto(base + '/things'); await wait(1200);
await page.locator('section').filter({ hasText: 'Car & garage' }).getByRole('button', { name: 'Add', exact: true }).click(); await wait(1200);
await page.getByRole('button', { name: '+ Add' }).click(); await wait(600);
await field('Kind of thing').selectOption({ label: '🚗 Vehicles' }); await wait(400);
await field('What *').fill('Family wagon');
await field('Make').fill('Subaru');
await field('Model').fill('Outback');
await field('Year').fill('2019');
await field('VIN').fill(VIN);
await dialog().getByRole('button', { name: 'Save' }).click(); await wait(1200);
// A second car that NHTSA has no table for, and one with no year.
await page.getByRole('button', { name: '+ Add' }).click(); await wait(600);
await field('Kind of thing').selectOption({ label: '🚗 Vehicles' }); await wait(400);
await field('What *').fill('Garage project');
await field('Make').fill('Zorg');
await field('Model').fill('Z1');
await field('Year').fill('2020');
await dialog().getByRole('button', { name: 'Save' }).click(); await wait(1200);
await page.getByRole('button', { name: '+ Add' }).click(); await wait(600);
await field('Kind of thing').selectOption({ label: '🚗 Vehicles' }); await wait(400);
await field('What *').fill('Old truck');
await field('Make').fill('Ford');
await field('Model').fill('F-150');
await dialog().getByRole('button', { name: 'Save' }).click(); await wait(1200);

// ---- check now ----
await page.goto(base + '/settings/connections#recalls'); await wait(1500);
s = flat(await section().innerText());
say('it knows which cars it can check and which need details: ' + s.slice(s.indexOf('It can check'), s.indexOf('It can check') + 260),
  /It can check 2 cars: Family wagon \(2019 Subaru Outback\), Garage project \(2020 Zorg Z1\)/.test(s)
  && /These need a make, model and year before they can be checked: Old truck \(needs year\)/.test(s));
await section().getByRole('button', { name: 'Check now' }).click(); await wait(2500);
s = flat(await section().innerText());
say('checking says what happened: ' + s.match(/Checked [^.]*\.[^.]*\./)?.[0], /Checked 2 cars\. 1 with nothing listed by NHTSA\./.test(s) && /Last checked/.test(s) && /2 open recalls/.test(s));
let asked = await log();
say('exactly one request for each car, and each carries only make, model and year: ' + asked.map((a) => a.url).join(' | '),
  asked.length === 2 && asked.every((a) => /^\/recalls\/recallsByVehicle\?make=[A-Za-z0-9]+&model=[A-Za-z0-9]+&modelYear=\d{4}$/.test(a.url)));

// ---- the car's page ----
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('link', { name: /Family wagon/ }).first().click(); await wait(1500);
const recalls = page.getByRole('region', { name: 'Recalls' });
let t = flat(await recalls.innerText());
say('the car shows both recalls in NHTSA\'s own words, with what to do: ' + t.slice(0, 300),
  /Recalls for this 2019 Subaru Outback/.test(t) && /STRUCTURE/.test(t) && /Spot welds located on the duct below the cowl panel may have been improperly applied, impacting the vehicle's body strength\./.test(t)
  && /What to do: Subaru will notify owners, and dealers will inspect and repair the welds, free of charge\./.test(t) && /Reported 26 Jun 2019|Reported Jun 26, 2019/.test(t));
const park = recalls.getByText('Park outside', { exact: true });
const before = await recalls.locator('li h3').allInnerTexts();
say('"Park outside" is shown prominently, and that recall comes first: ' + before.join(' | '),
  await park.isVisible() && /FUEL SYSTEM/.test(before[0]) && /STRUCTURE/.test(before[1]) && !/Do not drive/.test(t));
say('the VIN note is on the car too', /enter your VIN on NHTSA's own site\. Life Is never sends the VIN\./.test(t));
await page.screenshot({ path: shots + '/recalls.png', fullPage: true });

// ---- dismiss one, check again, and it stays dismissed ----
await recalls.locator('li').filter({ has: page.locator('h3', { hasText: /^STRUCTURE$/ }) }).getByRole('button', { name: 'Dismiss' }).click(); await wait(1000);
t = flat(await recalls.innerText());
say('a dismissed recall leaves the list, with a way back: ' + t.slice(0, 120), !/STRUCTURE/.test(t) && /FUEL SYSTEM/.test(t) && /Show dismissed \(1\)/.test(t));
await wait(11_000); // the button won't ask again within a few seconds
await page.goto(base + '/settings/connections#recalls'); await wait(1500);
await section().getByRole('button', { name: 'Check now' }).click(); await wait(2500);
s = flat(await section().innerText());
say('checking again asks again: ' + s.match(/Checked [^.]*\./)?.[0] + ' / ' + (await log()).length + ' requests', /Checked 2 cars/.test(s) && (await log()).length === 4);
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('link', { name: /Family wagon/ }).first().click(); await wait(1500);
t = flat(await recalls.innerText());
say('the dismissed one is still dismissed, and the other is not shown twice', !/STRUCTURE/.test(t) && (t.match(/FUEL SYSTEM/g) ?? []).length === 1 && /Show dismissed \(1\)/.test(t));
await recalls.getByRole('button', { name: /Show dismissed/ }).click(); await wait(900);
t = flat(await recalls.innerText());
say('"Show dismissed" brings it into view, and it can be brought back', /STRUCTURE/.test(t) && /Hide dismissed/.test(t) && await recalls.getByRole('button', { name: 'Bring it back' }).isVisible());
await recalls.getByRole('button', { name: 'Hide dismissed' }).click(); await wait(600);

// ---- the VIN never left ----
asked = await log();
const everything = JSON.stringify(asked);
say('no request carried the VIN, a name, or a cookie: ' + asked.map((a) => a.url).join(' | '),
  !everything.includes(VIN) && !/Family|wagon|trial|Garage|truck/i.test(everything) && asked.every((a) => !a.headers.includes('cookie') && !a.headers.includes('authorization')));

// ---- the other cars ----
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('link', { name: /Garage project/ }).first().click(); await wait(1500);
t = flat(await text());
say('a car NHTSA does not list says so plainly: ' + t.match(/NHTSA has nothing under[^.]*\./)?.[0], /NHTSA has nothing under this make, model and year\./.test(t));
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('link', { name: /Old truck/ }).first().click(); await wait(1500);
t = flat(await text());
say('a car missing its year says it needs one: ' + t.match(/Recall alerts need[^.]*\./)?.[0], /Recall alerts need this car's make, model and year \(it's missing the year\)/.test(t));

// ---- off: nothing but one quiet line ----
await page.goto(base + '/settings/connections#recalls'); await wait(1500);
await section().getByLabel('Turn on recall alerts').click(); await wait(900);
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('link', { name: /Family wagon/ }).first().click(); await wait(1500);
t = flat(await text());
say('with it off, the car shows no recalls, only a quiet line to turn it on', !/STRUCTURE|FUEL SYSTEM/.test(t) && /Recall alerts for this car can be turned on in Settings\./.test(t));
await page.goto(base + '/settings/connections#recalls'); await wait(1200);
await section().getByLabel('Turn on recall alerts').click(); await wait(900);

// ---- a phone: nothing runs off the side, and the buttons are big enough ----
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(base + '/settings/connections#recalls'); await wait(1500);
say('Settings fits a phone', await fits());
const small = await page.evaluate(() => [...document.querySelectorAll('#recalls button, #recalls a[href^="/things"]')].filter((b) => b.getBoundingClientRect().height < 43.5 && b.tagName === 'BUTTON').map((b) => b.textContent));
say('its buttons are at least 44px tall: ' + (small.join(', ') || 'all'), small.length === 0);
await page.goto(base + '/things'); await wait(1000);
await page.getByRole('link', { name: /Family wagon/ }).first().click(); await wait(1500);
say('the car fits a phone', await fits());
const smallOnCar = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Recalls"] button')].filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent));
say('its buttons are at least 44px tall: ' + (smallOnCar.join(', ') || 'all'), smallOnCar.length === 0);
await page.locator('section[aria-label="Recalls"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + '/recalls-phone.png', fullPage: true });

console.log(bad.length ? 'FAIL problems seen:\n' + bad.map((b) => 'FAIL ' + b).join('\n') : 'ok   no failed requests, no page errors');
await browser.close();
