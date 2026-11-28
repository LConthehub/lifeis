import { browserChoice } from '../browser.mjs';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'a trial passphrase 4179';

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const bad = [];
const elsewhere = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.host !== new URL(base).host) elsewhere.push(u.host); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = () => page.locator('body').innerText();
const firstRun = async (patience = 6000) => {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: patience }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    // A brand-new person is met by the two-minute start; the full checklist is one step in.
    // The first question (what bugs you most) comes before the steps: Next passes it by.
    for (let i = 0; i < 3 && await dialog.getByRole('button', { name: 'Choose everything myself' }).isVisible().catch(() => false) === false && await dialog.getByRole('button', { name: 'Next', exact: true }).isVisible().catch(() => false); i += 1) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click(); await wait(800);
    }
    if (await dialog.getByRole('button', { name: 'Choose everything myself' }).isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Choose everything myself' }).click(); await wait(800); }
    await dialog.getByText('Cooking and groceries', { exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Set up Life Is', exact: true }).click(); await wait(2000);
  }
};
const addRecipe = async (name) => {
  await page.goto(base + '/recipes'); await wait(1200);
  await firstRun(2500);
  await page.getByRole('button', { name: '+ New' }).click(); await wait(400);
  const form = page.getByRole('dialog');
  await form.getByLabel('Name *').fill(name);
  await form.getByLabel(/^Ingredients/).fill('2 eggs');
  await form.getByRole('button', { name: 'Save' }).click(); await wait(1500);
};

await page.goto(base + '/'); await wait(1500);
// ---------- the first screen ----------
{
  const first = await text();
  say('the first screen starts on the phone, with a backup and a hosted Life Is as the other ways', /Start on this phone/.test(first) && /I have a backup/.test(first) && /I host my own Life Is/.test(first) && !/address of your Life Is/i.test(first));
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const tall = await page.getByRole('button').evaluateAll((all) => all.every((b) => b.getBoundingClientRect().height >= 44));
  say('it fits the screen, and every button is at least 44px tall', fits && tall);
  await page.screenshot({ path: shots + '/app-first-screen.png' });
  await page.getByRole('button', { name: 'I host my own Life Is' }).click(); await wait(300);
  say('hosting your own asks for its address, and Back returns', /The address of your Life Is/.test(await text()));
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await wait(300);
}
await page.getByRole('button', { name: /Start on this phone/ }).click(); await wait(2500);
await firstRun();
await addRecipe('Kept omelette');

// ---------- making one ----------
await page.goto(base + '/settings/data'); await wait(1200);
say('settings offer a backup, and say no copies are made otherwise', /A backup you hold/.test(await text()) && /makes no copies of itself/.test(await text()));
say('before any backup, it says no copy was made', /No copy made yet/.test(await text()));
await page.getByRole('button', { name: 'Make a backup' }).click(); await wait(300);
await page.getByLabel('A passphrase for this backup').fill(PASS);
await page.getByLabel('The same passphrase again').fill(PASS + 'x');
await page.getByRole('button', { name: 'Make the backup' }).click(); await wait(500);
say('two passphrases that differ are refused', /aren't the same/.test(await text()));
await page.getByLabel('The same passphrase again').fill(PASS);
await page.screenshot({ path: shots + '/app-backup.png', fullPage: true });
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Make the backup' }).click()]);
const file = shots + '/' + download.suggestedFilename();
await download.saveAs(file);
const bytes = readFileSync(file);
const seen = bytes.toString('latin1');
say(`a file is handed over: ${download.suggestedFilename()}, ${bytes.length} bytes`, /^life-is-backup-\d{4}-\d\d-\d\d\.lifeis$/.test(download.suggestedFilename()) && bytes.length > 200);
say('and nothing in it can be read', seen.startsWith('LIFEIS-BACKUP-1\n') && !/omelette|eggs|recipes/i.test(seen));

await wait(1000);
say('and afterwards, that the last copy was made today', /Last copy made: today/.test(await text()) && !/No copy made yet/.test(await text()));

// ---------- bringing it back ----------
await addRecipe('Written afterwards');
await page.goto(base + '/settings/data'); await wait(1200);
await page.getByRole('button', { name: 'Bring a backup back' }).click(); await wait(300);
say('it warns that what is here will be replaced', /replaces everything on this device/.test(await text()));
await page.getByLabel('The backup file').setInputFiles(file);
await page.getByLabel('Its passphrase').fill('not the passphrase');
await page.getByRole('button', { name: 'Replace what is here' }).click(); await wait(2500);
say('the wrong passphrase is refused in words', /doesn't open this backup/.test(await text()));
await page.goto(base + '/recipes'); await wait(1200);
say('and nothing was changed by the refusal', /Written afterwards/.test(await text()) && /Kept omelette/.test(await text()));
await page.goto(base + '/settings/data'); await wait(1200);
await page.getByRole('button', { name: 'Bring a backup back' }).click(); await wait(300);
await page.getByLabel('The backup file').setInputFiles(file);
await page.getByLabel('Its passphrase').fill(PASS);
await page.getByRole('button', { name: 'Replace what is here' }).click(); await wait(4000);
await page.goto(base + '/recipes'); await wait(1500);
let t = await text();
say('with the right one, the device holds what the backup held', /Kept omelette/.test(t) && !/Written afterwards/.test(t));
await page.reload(); await wait(1500);
t = await text();
say('and still does after closing and opening', /Kept omelette/.test(t) && !/Written afterwards/.test(t));

// ---------- a backup every week, by itself ----------
{
  const WEEKLY = 'a weekly passphrase 5521';
  const part = page.locator('[data-auto-backup]');
  await page.goto(base + '/settings/data'); await wait(1500);
  say('weekly backups are off until turned on, and say the file is sent nowhere', (await part.getAttribute('data-auto-backup')) === 'off' && /sends it nowhere/.test(await part.innerText()));
  await part.getByRole('button', { name: 'Turn on weekly backups' }).click(); await wait(300);
  await part.getByLabel('A passphrase for your weekly backups').fill(WEEKLY);
  await part.getByLabel('The same passphrase once more').fill(WEEKLY);
  await part.getByRole('button', { name: 'Turn on', exact: true }).click(); await wait(6000);
  let words = await part.innerText();
  say('turned on, the first one is made at once and it says where it is kept', (await part.getAttribute('data-auto-backup')) === 'on' && /Last one made today/.test(words) && /on this phone/i.test(words) && /lost if the phone is/.test(words));
  await page.locator('#backup').screenshot({ path: shots + '/app-weekly-backup.png' });
  await part.getByRole('button', { name: 'Show the passphrase' }).click(); await wait(500);
  say('the phone can show the passphrase it remembers, to write down', (await part.locator('[data-auto-passphrase]').innerText()) === WEEKLY);
  await part.getByRole('button', { name: 'Hide the passphrase' }).click(); await wait(300);
  const [copy] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), part.getByRole('button', { name: 'Save a copy somewhere else' }).click()]);
  const copied = shots + '/weekly-' + copy.suggestedFilename();
  await copy.saveAs(copied);
  say('a copy goes somewhere else with one tap and nothing typed: ' + copy.suggestedFilename(), readFileSync(copied).toString('latin1').startsWith('LIFEIS-BACKUP-1\n'));
  // Eight days on: the app makes a fresh one by itself when it is opened.
  const moved = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key.includes('auto_backup')) continue;
      const held = JSON.parse(localStorage.getItem(key));
      const inner = typeof held === 'string' ? JSON.parse(held) : held;
      inner.last = new Date(Date.now() - 8 * 86400000).toISOString();
      localStorage.setItem(key, typeof held === 'string' ? JSON.stringify(JSON.stringify(inner)) : JSON.stringify(inner));
      return true;
    }
    return false;
  });
  await page.reload(); await wait(1200);
  const stale = await part.innerText();
  await wait(9000);
  await page.reload(); await wait(1500);
  say('after a week it makes a fresh one by itself when the app is opened', moved && /8 days ago/.test(stale) && /Last one made today/.test(await part.innerText()));

  // The phone's own backup may carry it, only once that is checked; a new phone then finds it on the first screen.
  const carry = part.locator('[data-carry]');
  say('the phone\'s own backup carrying it is off unless checked, and says what goes and to whom', (await carry.getAttribute('data-carry')) === 'off' && /Off unless you check it/.test(await carry.innerText()) && /That one file is all it takes/.test(await carry.innerText()) && /Google/.test(await carry.innerText()));
  await carry.getByRole('checkbox').click(); await wait(6000);
  say('checked, it says the newest weekly backup is where the phone\'s backup picks it up', (await part.locator('[data-carry]').getAttribute('data-carry')) === 'on' && /picks it up/.test(await part.innerText()));
  await part.locator('[data-carry]').screenshot({ path: shots + '/app-weekly-backup-carried.png' });
  await page.evaluate(() => window.lifeisApp.chooseAgain()); await wait(2500);
  say('the first screen finds the carried backup and offers to bring it back first', await page.locator('[data-carried]').isVisible() && /came across with this phone's own backup/.test(await text()) && /Start fresh on this phone/.test(await text()));
  await page.screenshot({ path: shots + '/app-first-screen-carried.png' });
  await page.locator('[data-carried]').getByRole('button', { name: 'Bring it back' }).click(); await wait(400);
  await page.getByLabel('Its passphrase').fill(WEEKLY);
  await page.getByRole('button', { name: 'Bring it back', exact: true }).click(); await wait(3000);
  await page.getByRole('button', { name: 'Replace what is here' }).click(); await wait(6000);
  await page.goto(base + '/recipes'); await wait(1500);
  const back = /Kept omelette/.test(await text());
  await page.goto(base + '/settings/data'); await wait(1500);
  say('only the passphrase is asked, what it held is back, and weekly backups carry on', back && (await part.getAttribute('data-auto-backup')) === 'on' && (await part.locator('[data-carry]').getAttribute('data-carry')) === 'on');
  await part.locator('[data-carry]').getByRole('checkbox').click(); await wait(2500);
  say('unchecked, the file is taken back out', (await part.locator('[data-carry]').getAttribute('data-carry')) === 'off' && /taken back out/.test(await part.innerText()));
  await part.getByRole('button', { name: 'Turn off' }).click(); await wait(1500);
  say('turned off, the phone forgets the passphrase and says the backups made are still there', (await part.getAttribute('data-auto-backup')) === 'off' && /forgotten the passphrase/.test(await part.innerText()));
}

// ---------- a new phone: the backup brought back from the first screen ----------
{
  const fresh = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await fresh.newPage();
  phone.on('pageerror', (e) => bad.push('page error (new phone): ' + e.message));
  const words = () => phone.locator('body').innerText();
  await phone.goto(base + '/'); await phone.waitForTimeout(1500);
  await phone.getByRole('button', { name: 'I have a backup' }).click(); await phone.waitForTimeout(300);
  await phone.screenshot({ path: shots + '/app-first-screen-backup.png' });
  await phone.getByLabel('The backup file').setInputFiles(file);
  await phone.getByLabel('Its passphrase').fill('not the passphrase');
  await phone.getByRole('button', { name: 'Bring it back' }).click(); await phone.waitForTimeout(4000);
  say('on a new phone, the wrong passphrase is refused in words and the first screen stays', /doesn't open this backup/.test(await words()) && /Bring a backup back/.test(await words()));
  await phone.getByLabel('Its passphrase').fill(PASS);
  await phone.getByRole('button', { name: 'Bring it back' }).click(); await phone.waitForTimeout(5000);
  await phone.goto(base + '/recipes'); await phone.waitForTimeout(1500);
  const there = await words();
  say('with the right one, the new phone holds what the backup held, with no setting up again', /Kept omelette/.test(there) && !/Written afterwards/.test(there) && !(await phone.getByRole('dialog').isVisible().catch(() => false)));
  await fresh.close();
}

// ---------- a phone that already holds a Life Is is warned before it is replaced ----------
await addRecipe('Only on this phone');
await page.evaluate(() => window.lifeisApp.chooseAgain()); await wait(2000);
await page.getByRole('button', { name: 'I have a backup' }).click(); await wait(300);
await page.getByLabel('The backup file').setInputFiles(file);
await page.getByLabel('Its passphrase').fill(PASS);
await page.getByRole('button', { name: 'Bring it back' }).click(); await wait(3000);
say('it says the phone already holds a Life Is, and changes nothing yet', /already holds a Life Is/.test(await text()) && await page.getByRole('button', { name: 'Replace what is here' }).isVisible());
await page.getByRole('button', { name: 'Back', exact: true }).click(); await wait(300);
await page.getByRole('button', { name: /Start on this phone/ }).click(); await wait(2500);
await page.goto(base + '/recipes'); await wait(1500);
say('and going back keeps what was here', /Only on this phone/.test(await text()));
say('none of it asked anywhere else for anything: ' + JSON.stringify([...new Set(elsewhere)]), elsewhere.length === 0);
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
