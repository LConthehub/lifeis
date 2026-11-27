// The house manual: written from ideas, with a private entry, and read by its link without signing in.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

await page.evaluate(() => fetch('/api/things/pets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rex', species: 'dog', food: 'Two cups, twice a day', vet_name: 'Oak Lane Vets', vet_phone: '555 0100' }) }));

await page.goto(`${base}/manual`); await page.waitForTimeout(1200);
check('the manual has its parts, each with ideas to start from', (await page.getByRole('group', { name: 'Ideas for In an emergency' }).innerText()).includes('Breaker box'));
check('pets are there by themselves, with food and vet', (await page.getByRole('region', { name: 'Pets' }).innerText()).replace(/\s+/g, ' ').includes('Food: Two cups, twice a day Vet: Oak Lane Vets · 555 0100'));

const add = async (group, idea, fill) => {
  await page.getByRole('group', { name: `Ideas for ${group}` }).getByRole('button', { name: `+ ${idea}` }).click(); await page.waitForTimeout(400);
  const form = page.getByRole('dialog');
  await fill(form);
  await form.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1000);
};
await add('In an emergency', 'Breaker box', async (form) => {
  await form.getByLabel('What to know').fill('Gray panel on the back wall.\nEach switch is labeled.');
  await form.getByLabel('Where it is').selectOption('new');
  await form.getByLabel('The new place').fill('Garage › Back wall');
  await form.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
});
await add('Who to call', 'Plumber', async (form) => { await form.getByLabel('A phone number').fill('555 0142'); await form.getByLabel('Anything to know about them').fill('Ask for Dana'); });
await add('How the house works', 'Alarm', async (form) => { await form.getByLabel('What to know').fill('Code 4821'); await form.getByLabel(/Private/).check(); });

const emergency = (await page.getByRole('region', { name: 'In an emergency' }).innerText()).replace(/\s+/g, ' ');
check('an entry says what to know and where it is', emergency.includes('Breaker box') && emergency.includes('Garage › Back wall') && emergency.includes('Each switch is labeled'), emergency.slice(0, 160));
check('an idea that is written is no longer offered', !(await page.getByRole('group', { name: 'Ideas for In an emergency' }).innerText()).includes('Breaker box'));
check('a phone number can be tapped', await page.locator('a[href="tel:5550142"]').isVisible());
check('a private entry says it stays off the link', (await page.getByRole('region', { name: 'How the house works' }).innerText()).includes('private: not on the shared link'));
await page.screenshot({ path: `${shots}/manual.png`, fullPage: true });

// Choosing someone from the phone's own contacts, with navigator.contacts standing in for the phone.
const withContacts = async (stub) => {
  const p = await context.newPage();
  p.on('pageerror', (e) => check('no page errors', false, e.message));
  p.on('dialog', (d) => d.accept());
  if (stub) await p.addInitScript(stub);
  await p.goto(`${base}/manual`); await p.waitForTimeout(1200);
  await p.getByRole('region', { name: 'Who to call' }).getByRole('button', { name: '+ Add' }).click(); await p.waitForTimeout(400);
  return p;
};
const pick = 'Choose from your contacts';
const sure = await withContacts(() => {
  window.__asked = [];
  navigator.contacts = { select: async (props, opts) => { window.__asked.push({ props, opts }); return [{ name: ['Dana Brooks'], tel: ['555 0111', '555 0199'] }]; } };
});
let form = sure.getByRole('dialog');
const button = form.getByRole('button', { name: pick });
check('with a contact picker, the form offers to choose from contacts, at a tappable size', await button.isVisible() && (await button.boundingBox()).height >= 44);
check('and says what is read and where it goes', (await form.innerText()).replace(/\s+/g, ' ').includes('Only the one contact you choose is read, on this device. It is not sent anywhere unless your house manual is one you share.'));
await button.click(); await sure.waitForTimeout(400);
check('with two numbers it asks which one, and fills nothing yet', await form.getByText('Dana Brooks has more than one number').isVisible() && (await form.getByLabel('A phone number').inputValue()) === '');
check('only a name and a number were asked for, one contact', JSON.stringify(await sure.evaluate(() => window.__asked)) === JSON.stringify([{ props: ['name', 'tel'], opts: { multiple: false } }]));
await form.getByRole('button', { name: '555 0199' }).click(); await sure.waitForTimeout(300);
check('the chosen name and number fill the form', (await form.getByLabel('Who *').inputValue()) === 'Dana Brooks' && (await form.getByLabel('A phone number').inputValue()) === '555 0199');
check('nothing is saved until Save', !(await sure.getByRole('region', { name: 'Who to call' }).innerText()).includes('Dana Brooks'));
await form.getByRole('button', { name: 'Save' }).click(); await sure.waitForTimeout(1000);
const dana = (await sure.getByRole('region', { name: 'Who to call' }).innerText()).replace(/\s+/g, ' ');
check('saved, the entry shows that name and number', dana.includes('Dana Brooks') && dana.includes('555 0199') && !dana.includes('555 0111') && await sure.locator('a[href="tel:5550199"]').isVisible(), dana.slice(0, 120));
await sure.close();

const nobody = async (name, stub, wanted) => {
  const p = await withContacts(stub);
  const f = p.getByRole('dialog');
  await f.getByLabel('Who *').fill('Sam'); await f.getByLabel('A phone number').fill('555 0123');
  await f.getByRole('button', { name: pick }).click(); await p.waitForTimeout(400);
  const said = (await f.innerText()).replace(/\s+/g, ' ');
  check(name, (await f.getByLabel('Who *').inputValue()) === 'Sam' && (await f.getByLabel('A phone number').inputValue()) === '555 0123' && await f.isVisible() && wanted(said), said.slice(0, 160));
  await p.close();
};
await nobody('cancelling the picker leaves the form as it was, with no scolding', () => { navigator.contacts = { select: async () => { throw new DOMException('closed', 'AbortError'); } }; }, (said) => !said.includes("Couldn't"));
await nobody('an empty choice leaves the form as it was', () => { navigator.contacts = { select: async () => [] }; }, (said) => !said.includes("Couldn't"));
await nobody('a failure leaves the form as it was and says so in plain words', () => { navigator.contacts = { select: async () => { throw new Error('boom'); } }; }, (said) => said.includes("Couldn't open your contacts. You can type the name and number instead."));

const nameOnly = await withContacts(() => { navigator.contacts = { select: async () => [{ name: ['Lee Park'], tel: [] }] }; });
form = nameOnly.getByRole('dialog');
await form.getByRole('button', { name: pick }).click(); await nameOnly.waitForTimeout(400);
check('a contact with no number fills the name and says there was none', (await form.getByLabel('Who *').inputValue()) === 'Lee Park' && (await form.getByLabel('A phone number').inputValue()) === '' && (await form.innerText()).includes('Lee Park has no phone number saved'));
await nameOnly.close();

const plain = await withContacts(null);
check('without a contact picker, no button and no promise about contacts', (await plain.getByRole('button', { name: pick }).count()) === 0 && !(await plain.getByRole('dialog').innerText()).includes('contact you choose'));
await plain.close();

const sharing = page.getByRole('region', { name: 'Sharing' });
check('sharing is off until asked for', (await sharing.innerText()).includes('Off'));
await sharing.getByLabel('How long the link works').selectOption('3');
await sharing.getByRole('button', { name: 'Make the link' }).click(); await page.waitForTimeout(1200);
const link = await sharing.getByLabel('The link').inputValue();
check('a link is made, saying what is left out', /\/m\/[0-9a-f]{64}$/.test(link) && (await sharing.innerText()).includes('1 private entry is left out'), link.slice(0, 40));

// Someone with the link, and no sign-in at all.
const guest = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
const answer = await guest.goto(link); await guest.waitForTimeout(600);
const seen = (await guest.locator('body').innerText()).replace(/\s+/g, ' ');
check('the link opens with no sign-in', answer.status() === 200 && seen.includes('House Manual') && seen.includes('Breaker box') && seen.includes('Where: Garage › Back wall'), seen.slice(0, 140));
check('it has the plumber and the pets, and not the alarm code', seen.includes('555 0142') && seen.includes('Rex') && seen.includes('Two cups, twice a day') && !seen.includes('4821') && !seen.includes('Alarm'));
check('nothing else of Life Is opens for them', (await guest.request.get(`${base}/api/manual`)).status() === 401);
check('and the page itself can fetch nothing', await guest.evaluate(() => fetch('/api/health').then(() => false).catch(() => true)));
check('it has the quiet credit with a plain link to lifeis.living', seen.includes('Made with Life Is, a private home organizer you run yourself.') && await guest.locator('a[href="https://lifeis.living"][rel="noopener noreferrer"]').count() === 1);
check('it still says nothing can be changed, and loads fonts and the mark from here', seen.includes('Nothing on this page can be changed from here.') && await guest.evaluate(() => document.fonts.check('16px "Fraunces Variable"') && document.querySelector('img').naturalWidth > 0));
check('the page does not scroll sideways at phone width', await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('the setting to show the credit is on in Sharing', await sharing.getByLabel("Show 'Made with Life Is' on the shared page").isChecked());
const untilBox = sharing.getByLabel("Show 'Available until' on the shared page");
check('the setting to show the last day is on too', await untilBox.isChecked());
await untilBox.click(); await page.waitForTimeout(800);
await guest.goto(link); await guest.waitForTimeout(400);
check('turned off, guests do not see the last day', !(await guest.locator('body').innerText()).includes('Available until'));
await untilBox.click(); await page.waitForTimeout(800);
await sharing.getByLabel("Show 'Made with Life Is' on the shared page").click(); await page.waitForTimeout(800);
await guest.goto(link); await guest.waitForTimeout(400);
const quiet = (await guest.locator('body').innerText()).replace(/\s+/g, ' ');
check('turned off, the credit and its link are gone, the old line stays', !quiet.includes('Made with Life Is') && await guest.locator('a[href="https://lifeis.living"]').count() === 0 && quiet.includes('Nothing on this page can be changed from here.'));
await sharing.getByLabel("Show 'Made with Life Is' on the shared page").click(); await page.waitForTimeout(800);
await guest.goto(link); await guest.waitForTimeout(400);
await guest.screenshot({ path: `${shots}/manual-shared.png`, fullPage: true });
// Phone pictures of the shared page, light and dark, with a link on it (the owner looks at these).
await page.evaluate(() => fetch('/api/home-services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Jellyfin', address: 'https://watch.example.com', guests: true, note: 'Films and shows, ask for the login' }) }));
for (const scheme of ['light', 'dark']) {
  const phone = await (await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, colorScheme: scheme })).newPage();
  await phone.goto(link); await phone.waitForTimeout(800);
  check(`the shared page fits 375px with no sideways scroll (${scheme})`, await phone.evaluate(() => document.documentElement.scrollWidth <= 375));
  await phone.screenshot({ path: `${shots}/guest-manual-${scheme}.png`, fullPage: true });
  await phone.context().close();
}

await sharing.getByRole('button', { name: 'Turn it off' }).click(); await page.waitForTimeout(1000);
check('turned off, the link stops working', (await guest.goto(link)).status() === 404);
await browser.close();
