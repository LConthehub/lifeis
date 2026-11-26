import { browserChoice } from '../browser.mjs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';

// A stand-in model server, speaking the OpenAI-style language Ollama and LM Studio speak. It keeps what it is sent.
const received = [];
const model = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'llama3.2' }, { id: 'qwen3' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      received.push(JSON.parse(body));
      // A photo to copy out: the message holds a picture, and the model answers with the words on it.
      const first = received.at(-1).messages[0].content;
      if (Array.isArray(first)) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: "Nana's buttermilk biscuits\n2 cups flour\n1 stick butter\n3/4 cup buttermilk\nCut the butter into the flour.\nBake at 450°F for 12 minutes." } }] }));
        return;
      }
      const said = received.at(-1).messages[1].content;
      const answer = /Omelette/.test(said) ? '<think>eggs are in the pantry</think>You could make the Omelette: you have eggs and butter.' : "I don't see that in your records.";
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((resolve) => model.listen(4191, '127.0.0.1', resolve));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
const bad = [];
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') bad.push('console: ' + m.text().slice(0, 300)); });
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 800) => page.waitForTimeout(ms);
const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

await page.goto(base + '/'); await wait(1200);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2500);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }
// Something to ask about, and something private that must not be sent.
await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/kitchen/recipes', { title: 'Omelette', ingredients_text: '3 eggs\n1 tbsp butter', steps_text: 'Whisk and fry.', tags: [] });
  const cat = await (await post('/api/money/categories', { name: 'Secret gift', monthly_cents: 20000 })).json();
  await post('/api/money/entries', { label: 'Necklace', cents: 15000, category_id: cat.id });
});

await page.goto(base + '/'); await wait(1500);
say('nothing to ask on the front page while the assistant is off', (await page.locator('[data-ask]').count()) === 0);
await page.goto(base + '/settings/connections'); await wait(1500);
say('Connections keeps the assistant out of sight behind More', (await page.locator('[data-assistant-settings]').count()) === 0 && !/\bAI\b/.test(await page.locator('main').innerText()));
await page.locator('[data-settings-more]').click(); await wait(800);
const card = page.locator('[data-assistant-settings]');
say('Settings lists the assistant as off, and says what it sends', /Off/.test(await card.innerText()) && /Only when you ask a question/.test(await card.innerText()));
await card.getByRole('button', { name: 'Set it up' }).click(); await wait(400);

// A cloud address is refused without the tick.
await card.getByLabel("The model's address *").fill('https://api.example-ai.com/v1');
await wait(300);
say('a cloud address is refused until allowed', /isn't on this computer or your own network/.test(await card.innerText()) && await card.getByRole('button', { name: 'Save and turn on' }).isDisabled());
say('and the warning says plainly what leaves', /would leave this computer/.test(await card.innerText()));
await page.screenshot({ path: shots + '/assistant-cloud-warning.png', fullPage: true });

// A model at home is fine.
await card.getByLabel("The model's address *").fill('http://127.0.0.1:4191/v1');
await card.getByRole('button', { name: /Check it answers/ }).click();
const picker = card.getByRole('combobox', { name: 'Model' });
await picker.waitFor({ timeout: 10000 }).catch(async () => console.log('   settings said: ' + (await card.innerText()).replace(/\s+/g, ' ').slice(0, 600)));
await picker.selectOption('llama3.2');
say('it reaches the model and lists what it has', (await picker.locator('option').count()) === 3);
await card.getByRole('button', { name: 'Save and turn on' }).click(); await wait(1200);
say('saved, it shows as on, at home', /On, at home/.test(await card.innerText()) && /llama3\.2/.test(await card.innerText()));

await page.goto(base + '/'); await wait(1500);
const ask = page.locator('[data-ask]');
say('the front page now offers to ask, and says nothing leaves home', /nothing leaves home/.test(await ask.innerText()));
await ask.getByLabel('Ask about your household').fill('What can I make for dinner?');
await ask.getByRole('button', { name: 'Ask' }).click();
await page.locator('[data-answer]').waitFor({ timeout: 15000 });
const answer = await page.locator('[data-answer]').innerText();
say('it answers, without the model\'s thinking: ' + answer, /Omelette/.test(answer) && !/think|eggs are in the pantry/.test(answer));
await ask.getByText('What was sent to the model').click(); await wait(300);
say('what was sent can be seen', /"Omelette"/.test(await ask.innerText()));
await page.screenshot({ path: shots + '/assistant-answer.png', fullPage: true });
const sent = JSON.stringify(received.at(-1));
say('the model got the kitchen and the question', received.at(-1).model === 'llama3.2' && /Omelette/.test(sent) && /What can I make for dinner/.test(sent));
say('and nothing from the parts not ticked', !/Secret gift|Necklace/.test(sent));

// Where the Ask box shows: Home only at first, then every page, then nowhere.
await page.goto(base + '/money'); await wait(1500);
say('at first the Ask box is on Home only', (await page.locator('[data-ask]').count()) === 0);
await page.goto(base + '/settings/connections'); await wait(1500);
const placing = page.locator('[data-ask-place]');
say('once on, the assistant is open without pressing More, with where the Ask box shows', await placing.isVisible() && (await page.locator('[data-settings-more]').count()) === 0);
await placing.getByRole('radio', { name: 'On every page' }).click(); await wait(800);
await page.goto(base + '/money'); await wait(1500);
say('on every page: it shows on another page too', await page.locator('[data-ask="everywhere"]').isVisible());
await page.screenshot({ path: shots + '/assistant-every-page.png' });
await page.goto(base + '/settings/connections'); await wait(1500);
await page.locator('[data-ask-place]').getByRole('radio', { name: /^Nowhere/ }).click(); await wait(800);
await page.goto(base + '/'); await wait(1500);
say('nowhere: not even on Home', (await page.locator('[data-ask]').count()) === 0);

// A handwritten card: the model copies it out, and the person checks it before it becomes a recipe.
await page.locator('header button[aria-haspopup]').click(); await page.locator('nav[aria-label="Sections"]').getByRole('link', { name: 'cooking', exact: true }).click(); await wait(); await page.getByRole('navigation', { name: 'Life is cooking' }).getByRole('link', { name: 'Recipes' }).click(); await wait();
await page.getByRole('button', { name: 'Import one' }).click();
await page.getByRole('button', { name: 'From a photo or a book' }).click(); await wait(600);
const importing = page.getByRole('dialog');
say('handwriting is offered, and says where the photo goes', /It's handwritten/.test(await importing.innerText()) && /on your own computer or network, so the photo doesn't leave home/.test(await importing.innerText()));
// A real picture, drawn in the page: a white card with a line on it.
const PNG = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 320, 200); x.fillStyle = '#000'; x.fillRect(20, 40, 200, 4); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
await importing.getByLabel('Choose or take a photo of a handwritten recipe').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: PNG });
await importing.locator('textarea').waitFor({ timeout: 15000 }).catch(async () => { console.log('FAIL no copy appeared; the page says: ' + (await importing.innerText()).replace(/\s+/g, ' ').slice(-400) + ' || ' + bad.join(' ; ')); });
const copied = await importing.locator('textarea').inputValue();
say('the model\'s copy is shown to be checked: ' + copied.split('\n')[0], /^Nana's buttermilk biscuits\n2 cups flour/.test(copied));
const picture = received.at(-1).messages[0].content;
say('the model was sent the photo and the instruction to copy, and none of the records', picture[1].type === 'image_url' && /^data:image\/jpeg;base64,/.test(picture[1].image_url.url) && /Copy out exactly/.test(picture[0].text) && !/Omelette|Necklace/.test(JSON.stringify(received.at(-1))));
await importing.getByRole('button', { name: 'Make it a recipe' }).click(); await wait(1200);
const draft = await page.getByRole('dialog').innerHTML();
say('it becomes a recipe to look over, in the words on the importing', /Nana&#x27;s buttermilk biscuits|Nana's buttermilk biscuits/.test(draft) && /1 stick butter/.test(draft));
await page.screenshot({ path: shots + '/handwritten-recipe.png' });
console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no page errors');
await browser.close();
model.close();
