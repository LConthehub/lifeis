// Makes the public website (docs/site) from the words in this folder: a front page, the privacy policy, and
// the guides in docs/guide (one text file each), with a setup builder on the install page. Plain pages with nothing loaded from anywhere else, so they can be put on any web host as they are.
//   node docs/build-site.mjs
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART } from '../frontend/src/art.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'site');
mkdirSync(out, { recursive: true });

// The look, shared by every page: the colours of a 1970s kitchen (cream, harvest gold, burnt orange, a tomato cap, chocolate
// brown), light or dark following the device, and the display face Fraunces (SIL Open Font License), served from this site.
const LIGHT = '--ink: #33291f; --soft: #5a4e40; --paper: #f1e5c8; --card: #f6ead0; --line: #dfcb9f; --deep: #422a17; --teal: #734825; --btn: #734825; --btn-ink: #ffffff;';
const DARK = '--ink: #fbf4e4; --soft: #d2b184; --paper: #2a190d; --card: #422a17; --line: #5a3a20; --deep: #f2ce47; --teal: #eead3e; --btn: #eead3e; --btn-ink: #2a190d;';
const fontFace = (url) => `@font-face { font-family: "Fraunces Variable"; font-style: normal; font-display: swap; font-weight: 100 900; src: url(${url}) format("woff2-variations"); }`;
const DISPLAY = 'font-family: "Fraunces Variable", Georgia, Cambria, serif; font-variation-settings: "SOFT" 100;';
// The stripe: straight flat bands in the artwork's order until the owner's hand-made wave is added (frontend/src/art.js), then that picture, tiled.
const bands = (up) => (ART.wave ? `.bands { height: 1rem; background: url(${up}art/${ART.wave}) repeat-x; background-size: auto 100%; }` : '.bands { height: .6rem; background: linear-gradient(180deg, #60304f 0 20%, #3a742f 20% 40%, #f2ce47 40% 60%, #e7602c 60% 80%, #f5e8cd 80% 100%); }');
if (ART.wave) { mkdirSync(path.join(out, 'art'), { recursive: true }); copyFileSync(path.join(here, '..', 'frontend', 'public', 'art', ART.wave), path.join(out, 'art', ART.wave)); }
const HEADER_BROWN = 'linear-gradient(100deg, #4a2f1a 0%, #5f361b 55%, #933f1d 100%)';
copyFileSync(path.join(here, 'site-src', 'fraunces-soft.woff2'), path.join(out, 'fraunces-soft.woff2'));
copyFileSync(path.join(here, 'site-src', 'fraunces-OFL.txt'), path.join(out, 'fraunces-OFL.txt'));

const safe = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A bit of code in a sentence gets a Copy button only when it is a whole command or address to type or paste on its own.
const SHELL = /^(docker|sudo|cd|curl|npm|git|ssh|brew|winget|apt|apt-get|systemctl|bash|sh|wsl|powershell|python|pip)\s+\S/;
const ADDRESS = /^https?:\/\/[^\s/]+\S*$/;
const codeSpan = (code) => (SHELL.test(code) ? `<code class="cmd" data-what="command">${code}</code>`
  : ADDRESS.test(code) ? `<code class="cmd" data-what="address">${code}</code>` : `<code>${code}</code>`);
// What a fenced block holds, so its button can say what it copies: "Copy this command", "Copy this file", "Copy this code".
const whatIs = (lang) => (/^(bash|sh|shell|console|cmd|powershell|ps1|zsh|terminal)?$/i.test(lang) ? 'command' : /^(ya?ml|env|ini|toml|json|conf)$/i.test(lang) ? 'file' : 'code');
const inline = (text) => safe(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, (m, code) => codeSpan(code))
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  .replace(/([A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,})/g, '<a href="mailto:$1">$1</a>');

/** The little of Markdown these pages use: headings, paragraphs, bullets and tables. */
function html(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const id = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      parts.push(`<h${heading[1].length}${id ? ` id="${id}"` : ''}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    // A fenced block of code: shown as written, and given a Copy button by copy.js. A leading "$ " prompt is not part of the command.
    const fence = /^(\s*)```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const block = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { block.push(lines[i].startsWith(fence[1]) ? lines[i].slice(fence[1].length) : lines[i]); i += 1; }
      while (block.length && !block[block.length - 1].trim()) block.pop();
      const lone = block.filter((l) => l.trim());
      const shown = lone.length && lone.every((l) => /^\$ /.test(l)) ? block.map((l) => l.replace(/^\$ /, '')) : block;
      parts.push(`<div class="code" data-what="${whatIs(fence[2])}"><pre tabindex="0"><code>${safe(shown.join('\n'))}</code></pre></div>`);
      continue;
    }
    // A line that is only {{name}} is a place for something made elsewhere (the setup builder).
    if (/^\{\{\w+\}\}$/.test(line.trim())) { parts.push(line.trim()); continue; }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^\d+\. /, ''))}</li>`); i += 1; }
      i -= 1;
      parts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(`<li>${inline(lines[i].slice(2))}</li>`); i += 1; }
      i -= 1;
      parts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((cell) => cell.trim())); i += 1; }
      i -= 1;
      const [head, , ...body] = rows;
      parts.push(`<div class="wide"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const words = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|- |\||\d+\. |\{\{|\s*```)/.test(lines[i + 1])) { i += 1; words.push(lines[i]); }
    parts.push(`<p>${inline(words.join(' '))}</p>`);
  }
  return parts.join('\n');
}

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${safe(title)}</title>
<style>
  ${fontFace('fraunces-soft.woff2')}
  :root { ${LIGHT} --accent: #422a17; }
  @media (prefers-color-scheme: dark) { :root { ${DARK} --accent: #f2ce47; } }
  h1, h2 { ${DISPLAY} }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2rem 1.1rem 4rem; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .4rem; color: var(--accent); }
  p, ul { margin: .6rem 0; } ul { padding-left: 1.2rem; }
  a { color: var(--accent); }
  ${bands("")}
  .wide { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .93rem; }
  th, td { text-align: left; vertical-align: top; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
  nav { font-size: .9rem; margin-bottom: 1.5rem; } footer { margin-top: 3rem; font-size: .85rem; color: var(--soft); }
</style>
</head>
<body>
<div class="bands" aria-hidden="true"></div>
<main>
${body}
</main>
</body>
</html>
`;

const policy = readFileSync(path.join(here, 'privacy.md'), 'utf8');
writeFileSync(path.join(out, 'privacy.html'), page('Life Is privacy policy', `<nav><a href="./">Life Is</a></nav>\n${html(policy)}`));
// The front page has a layout of its own: wider, with pictures of the demo and a way into it.
const DEMO = 'https://demo.lifeis.living';
// One card for each section of the app, in the app's order and by the app's names (frontend/src/App.jsx).
// Each name finishes the sentence "Life is…".
const FEATURES = [
  ['🍳', 'delicious', 'Food. Recipes kept exactly as you wrote them, the meals for the week, a grocery list that knows your pantry, and what things cost at each store.'],
  ['🏠', 'organized', 'Home. Everything you own, room by room, with its receipt, manual and warranty. Upkeep that comes due: the furnace filter, the oil change, the bills, the chores. Care for your pets. And a house manual to hand a sitter.'],
  ['💵', 'budgeted', 'Money. A plan for the month by category, private unless you share it. Bills you pay go straight in.'],
  ['📅', 'planned', 'Calendar. One calendar for your dates, the meals for the week and what is due. Plans for a trip or a party, with their food, their packing and their photos.'],
  ['🧵', 'projects', 'Anything you make or do. Projects with what they use, what they cost and the time on them, tied to the things and tools you already have.'],
  ['📚', 'entertaining', 'Media. Books, films, music and games on every format, on the shelf or on your own server. Who has borrowed what, and what you watched or read and when.'],
];
const SHOTS = [['demo-home.png', 'The front page: today, tomorrow and what needs you'], ['demo-upkeep.png', 'Upkeep: jobs, bills, renewals and chores, by how soon they are due'],
  ['demo-inventory.png', 'The home inventory, room by room'], ['demo-pets.png', 'Pets, with what is next for each']];
mkdirSync(path.join(out, 'img'), { recursive: true });
const shots = SHOTS.filter(([file]) => {
  const from = path.join(here, '..', 'e2e', 'shots', file);
  if (existsSync(from)) copyFileSync(from, path.join(out, 'img', file));
  return existsSync(path.join(out, 'img', file));
});

writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Life Is: a home organizer that keeps your household on your own device. Recipes, things, upkeep, pets, records and more. No account, no ads, no subscription.">
<title>Life Is: Home Organizer</title>
<link rel="icon" href="icon.png" media="(prefers-color-scheme: light)">
<link rel="icon" href="icon-dark.png" media="(prefers-color-scheme: dark)">
<style>
  ${fontFace('fraunces-soft.woff2')}
  :root { ${LIGHT} --sand: #eead3e; --coral: #e7602b; }
  @media (prefers-color-scheme: dark) { :root { ${DARK} } }
  h1, h2, .bar strong { ${DISPLAY} }
  ${bands("")}
  .hero .bands { position: absolute; left: 0; right: 0; bottom: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  a { color: var(--teal); }
  .hero { position: relative; background: ${HEADER_BROWN}; color: #fff; padding: 1rem 1.1rem 3.5rem; }
  .bar, .wrap { max-width: 64rem; margin: 0 auto; }
  .bar { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .bar strong { font-size: 1.15rem; margin-right: auto; display: flex; align-items: center; gap: .5rem; }
  .bar img { width: 2rem; height: 2rem; border-radius: .5rem; }
  .bar a { color: #fff; text-decoration: none; font-size: .95rem; opacity: .9; }
  .pill, .button { display: inline-block; border-radius: 999px; text-decoration: none; font-weight: 600; }
  .pill { background: rgba(255,255,255,.2); padding: .3rem .9rem; }
  .hero h1 { font-size: clamp(1.9rem, 5vw, 3rem); line-height: 1.15; margin: 3rem 0 1rem; max-width: 22ch; }
  .hero p { font-size: 1.15rem; max-width: 46ch; margin: 0 0 1.6rem; opacity: .95; }
  .button { background: #f6ead0; color: #422a17; padding: .7rem 1.4rem; margin: 0 .5rem .5rem 0; }
  .button.quiet { background: rgba(255,255,255,.18); color: #fff; }
  .wrap { padding: 0 1.1rem; }
  .shot { margin: -2.2rem auto 0; display: block; width: 100%; height: auto; border-radius: 1rem; box-shadow: 0 12px 40px rgba(0,0,0,.25); border: 1px solid var(--line); }
  h2 { font-size: 1.5rem; margin: 3.5rem 0 .4rem; }
  .lede { color: var(--soft); margin: 0 0 1.4rem; max-width: 60ch; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 1.25rem; padding: 1.1rem 1.2rem; }
  .card h3 { margin: 0 0 .3rem; font-size: 1.05rem; } .card p { margin: 0; color: var(--soft); font-size: .95rem; }
  .card .icon { font-size: 1.5rem; } .card h3 .lifeis { font-weight: 400; color: var(--soft); }
  .shots { display: grid; gap: 1.2rem; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); }
  figure { margin: 0; } figure img { width: 100%; height: auto; border-radius: .8rem; border: 1px solid var(--line); display: block; } figcaption { font-size: .9rem; color: var(--soft); margin-top: .4rem; }
  .price { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .price b { font-size: 1.6rem; display: block; margin: .2rem 0; }
  ul.plain { padding-left: 1.1rem; margin: .4rem 0 0; color: var(--soft); font-size: .95rem; }
  .center { text-align: center; margin: 2.5rem 0; }
  .center .button { background: var(--btn); color: var(--btn-ink); }
  footer { border-top: 1px solid var(--line); margin-top: 4rem; padding: 1.5rem 1.1rem 3rem; font-size: .9rem; color: var(--soft); text-align: center; }
</style>
</head>
<body>
<header class="hero">
  <div class="bar">
    <strong><img src="icon.png" alt=""> Life Is</strong>
    <a href="#what">What it does</a>
    <a href="#yours">Your data</a>
    <a href="#price">Price</a>
    <a href="docs/">Guides</a>
    <a class="pill" href="${DEMO}">Try the demo</a>
  </div>
  <div class="wrap" style="padding:0">
    <h1>Your whole home, in one place that is yours.</h1>
    <p>Life Is links what you own to when and how you use it: meals, things, upkeep, pets, records and plans. It lives on your own device. No account, no ads, no subscription.</p>
    <a class="button" href="${DEMO}">Try the demo</a>
    <a class="button quiet" href="#what">See what it does</a>
  </div>
  <div class="bands" aria-hidden="true"></div>
</header>
<div class="wrap">
${shots[0] ? `<img class="shot" src="img/${shots[0][0]}" alt="${safe(shots[0][1])}" width="1280" height="900">` : ''}

<h2 id="what">What it does</h2>
<p class="lede">Six parts, and each finishes the sentence "Life is…". Use one, or all of them. They know about each other: a tool you scan into the garage is the same tool a job needs and a project uses.</p>
<div class="grid">
${FEATURES.map(([icon, title, text]) => `  <div class="card"><div class="icon" aria-hidden="true">${icon}</div><h3><span class="lifeis">Life is</span> ${safe(title)}.</h3><p>${safe(text)}</p></div>`).join('\n')}
</div>

<h2>One search, and reminders that reach you</h2>
<p class="lede">Type "kettle" and Life Is says which box it's in. Type a serial number, a recipe, a pet's name. Each morning it tells you what needs you today, the ways you choose, and only on days there is something to say.</p>
${shots.length > 1 ? `<div class="shots">\n${shots.slice(1).map(([file, caption]) => `  <figure><img src="img/${file}" alt="${safe(caption)}" loading="lazy" width="1280" height="900"><figcaption>${safe(caption)}</figcaption></figure>`).join('\n')}\n</div>` : ''}

<h2 id="yours">Your data stays yours</h2>
<p class="lede">Life Is is built so that nobody else holds your household.</p>
<div class="grid">
  <div class="card"><h3>On your device, encrypted</h3><p>Everything is kept in an encrypted database on your phone, or on a computer you run yourself. There is no Life Is account and no Life Is cloud.</p></div>
  <div class="card"><h3>Nothing leaves unless you say</h3><p>Looking up a barcode, the weather, email: each is off until you turn it on, and each says exactly what it sends before you do.</p></div>
  <div class="card"><h3>No ads, no tracking</h3><p>This website loads nothing from anywhere else and sets no cookies. Neither does the app. Read the <a href="privacy">privacy policy</a>: it's short.</p></div>
</div>

<h2 id="price">One fair price</h2>
<p class="lede">No subscription, and nothing you entered is ever held hostage.</p>
<div class="price">
  <div class="card"><h3>The phone app</h3><b>Free to download</b>
    <ul class="plain"><li>The kitchen, backups, and connecting to your own server: free for good</li><li>Everything else: free for 7 days, then a single payment of $14.99</li><li>After the trial, nothing is hidden or deleted</li></ul></div>
  <div class="card"><h3>On your own computer</h3><b>Free</b>
    <ul class="plain"><li>Run Life Is at home and open it from any browser</li><li>Every part included</li><li>Share it with the people you live with, each with their own sign-in</li></ul></div>
</div>
<p class="center"><a class="button" href="${DEMO}">Try the demo</a><br><span style="color:var(--soft);font-size:.95rem">A made-up household, reset every night. No sign-up.</span></p>
<p class="lede" style="text-align:center;margin:0 auto">The app is on its way to the app stores. <a href="docs/">Read the guides</a> to see how it all works.</p>
</div>
<footer>
  <a href="docs/">Guides</a> · <a href="privacy">Privacy policy</a> · Questions: <a href="mailto:hello@lifeis.living">hello@lifeis.living</a>
</footer>
</body>
</html>
`);

// ---------- the guides ----------

/** Whether Life Is for your own computer can be downloaded yet. Until it can, the install page says so. */
const RELEASED = false;
const IMAGE = 'ghcr.io/lconthehub/lifeis:latest';
// The order the guides are listed in.
const GUIDES = ['getting-started', 'install', 'home', 'upkeep', 'kitchen', 'collection', 'phone', 'your-data', 'troubleshooting'];
// Pages that were folded into another guide. Each old address stays, as a small page that sends the reader on.
const MOVED = { records: ['home', 'receipts-serial-numbers-and-warranties'], 'pets-and-manual': ['home', 'pets'], reminders: ['upkeep', 'what-comes-due'] };

const guideDir = path.join(here, 'guide');
const guides = GUIDES.filter((slug) => existsSync(path.join(guideDir, `${slug}.md`))).map((slug) => {
  const text = readFileSync(path.join(guideDir, `${slug}.md`), 'utf8').replace(/\r\n/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  const meta = Object.fromEntries(front.split('\n').map((l) => /^(\w+):\s*(.+)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  return { slug, title: meta.title ?? slug, blurb: meta.blurb ?? '', body: html(text) };
});
for (const file of readdirSync(guideDir)) {
  if (file.endsWith('.md') && !GUIDES.includes(file.slice(0, -3))) console.warn(`docs/guide/${file} is not listed in GUIDES, so it has no page`);
}

const BUILDER = `<p id="no-script" class="note">This builder needs JavaScript. Without it, copy the file below as it is: it works without any changes.</p>
<form id="setup" class="builder" data-image="${IMAGE}" onsubmit="return false">
  <fieldset><legend>Where your records are kept</legend>
    <label><input type="radio" name="store" value="docker" checked> Kept by Docker (simplest)</label>
    <label><input type="radio" name="store" value="folders"> In folders I choose</label>
    <div data-when="store=folders" hidden>
      <label class="field">Folder for your records <input name="data_folder" placeholder="D:/lifeis/data or /home/me/lifeis/data" autocomplete="off"></label>
      <label class="field">Folder for the keys <input name="keys_folder" placeholder="D:/lifeis/keys or /home/me/lifeis/keys" autocomplete="off"></label>
    </div>
  </fieldset>
  <fieldset><legend>Who can open it</legend>
    <label><input type="radio" name="reach" value="computer" checked> This computer only</label>
    <label><input type="radio" name="reach" value="network"> Other devices on my home network</label>
    <label><input type="radio" name="reach" value="web"> A web address of its own (https)</label>
    <div data-when="reach=web" hidden>
      <label class="field">The address, already pointing at this computer <input name="web_address" placeholder="home.example.com" autocomplete="off" inputmode="url"></label>
    </div>
  </fieldset>
  <fieldset><legend>The rest</legend>
    <label class="field">Port on this computer <input name="port" type="number" min="1" max="65535" value="8020"></label>
    <label class="field">Sign out after this many minutes unused (0: never) <input name="idle" type="number" min="0" max="1440" value="15"></label>
    <label><input type="checkbox" name="media"> I run Jellyfin, Emby or Immich on this same computer</label>
  </fieldset>
</form>
<h2>Your setup file</h2>
<div class="file">
  <textarea id="compose" readonly rows="22" spellcheck="false" aria-label="docker-compose.yml"># Made with the setup builder at lifeis.living/docs/install
name: lifeis

services:
  lifeis:
    image: ${IMAGE}
    ports:
      - "127.0.0.1:8020:8008"     # this computer only
    volumes:
      - lifeis_data:/data        # your records, encrypted
      - lifeis_keys:/keys        # the key that opens them, kept apart
    environment:
      - SESSION_IDLE_MINUTES=15
    restart: unless-stopped

volumes:
  lifeis_data:
  lifeis_keys:
</textarea>
  <p><button type="button" class="copy" id="copy-compose" aria-label="Copy the setup file" hidden>Copy</button> <button type="button" id="download-compose">Download docker-compose.yml</button></p>
</div>`;
const STEPS = `<ol id="steps"><li>Save the file above as <code>docker-compose.yml</code> in your Life Is folder.</li><li>Open a terminal in that folder and run <code class="cmd" data-what="command">docker compose up -d</code>.</li><li>On this computer, open <a href="http://localhost:8020">http://localhost:8020</a> and make your account.</li></ol>`;
const NOT_YET = RELEASED ? '' : `<p class="note"><strong>Not released yet.</strong> Life Is for your own computer comes out with the app. This page already makes the file you will use, so you can see what is involved; it will not start until then. Meanwhile, <a href="https://demo.lifeis.living">try the demo</a>.</p>`;

const docPage = (guide) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="description" content="${safe(guide.blurb)}">
<title>${safe(guide.title)} · Life Is</title>
<link rel="icon" href="../icon.png" media="(prefers-color-scheme: light)">
<link rel="icon" href="../icon-dark.png" media="(prefers-color-scheme: dark)">
<link rel="stylesheet" href="docs.css">
</head>
<body>
<header class="top">
  <a class="brand" href="../"><img src="../icon.png" alt=""> Life Is</a>
  <a href="./">Guides</a>
  <a class="pill" href="https://demo.lifeis.living">Try the demo</a>
</header>
<div class="bands" aria-hidden="true"></div>
<div class="layout">
<nav class="menu" aria-label="Guides">
${guides.map((g) => `  <a href="${g.slug}.html"${g.slug === guide.slug ? ' aria-current="page"' : ''}>${safe(g.title)}</a>`).join('\n')}
</nav>
<main>
${guide.body.replace('{{builder}}', BUILDER).replace('{{steps}}', STEPS).replace('{{released}}', NOT_YET)}
<script src="copy.js"></script>
${guide.slug === 'install' ? '<script src="setup.js"></script>' : ''}
<p class="next">${(() => { const next = guides[guides.indexOf(guide) + 1]; return next && guide.slug !== 'index' ? `Next: <a href="${next.slug}.html">${safe(next.title)}</a>` : ''; })()}</p>
</main>
</div>
<footer><a href="../">Life Is</a> · <a href="../privacy">Privacy policy</a> · <a href="mailto:hello@lifeis.living">hello@lifeis.living</a></footer>
</body>
</html>
`;

const docsOut = path.join(out, 'docs');
mkdirSync(docsOut, { recursive: true });
for (const guide of guides) writeFileSync(path.join(docsOut, `${guide.slug}.html`), docPage(guide));
writeFileSync(path.join(docsOut, 'index.html'), docPage({ slug: 'index', title: 'Guides', blurb: 'How Life Is works, part by part.',
  body: `<h1>Guides</h1>\n<p>How Life Is works, part by part. New here? Start with the first one, or <a href="https://demo.lifeis.living">try the demo</a> and come back when you have a question.</p>\n<div class="cards">\n${
    guides.map((g) => `  <a href="${g.slug}.html"><b>${safe(g.title)}</b><span>${safe(g.blurb)}</span></a>`).join('\n')}\n</div>` }));
for (const [old, [slug, section]] of Object.entries(MOVED)) {
  const to = `${slug}.html#${section}`;
  writeFileSync(path.join(docsOut, `${old}.html`), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0; url=${to}">
<meta name="robots" content="noindex">
<title>This page has moved · Life Is</title>
</head>
<body>
<p>This page has moved. <a href="${to}">Go on to the new page</a>.</p>
</body>
</html>
`);
}
copyFileSync(path.join(here, 'site-src', 'setup.js'),path.join(docsOut, 'setup.js'));
copyFileSync(path.join(here, 'site-src', 'copy.js'), path.join(docsOut, 'copy.js'));
// docs.css sits one folder down from the font, so it names the font from there.
writeFileSync(path.join(docsOut, 'docs.css'), `${fontFace('../fraunces-soft.woff2')}
:root { ${LIGHT} }
@media (prefers-color-scheme: dark) { :root { ${DARK} } }
h1, h2, .brand { ${DISPLAY} }
${bands("../")}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--teal); }
.top { background: ${HEADER_BROWN}; color: #fff; padding: .7rem 1.1rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.top a { color: #fff; text-decoration: none; opacity: .92; } .top .brand { font-weight: 700; font-size: 1.1rem; margin-right: auto; display: flex; align-items: center; gap: .5rem; opacity: 1; }
.top img { width: 1.8rem; height: 1.8rem; border-radius: .45rem; } .pill { background: rgba(255,255,255,.2); border-radius: 999px; padding: .25rem .9rem; font-weight: 600; }
.layout { max-width: 64rem; margin: 0 auto; padding: 1.5rem 1.1rem 3rem; display: grid; gap: 2rem; grid-template-columns: 14rem minmax(0, 1fr); }
.menu { display: flex; flex-direction: column; gap: .15rem; align-self: start; position: sticky; top: 1rem; font-size: .95rem; }
.menu a { padding: .3rem .7rem; border-radius: .5rem; text-decoration: none; color: var(--ink); }
.menu a[aria-current] { background: var(--btn); color: var(--btn-ink); font-weight: 600; } .menu a:hover { background: var(--line); } .menu a[aria-current]:hover { background: var(--btn); }
@media (max-width: 46rem) { .layout { grid-template-columns: 1fr; gap: 1rem; } .menu { position: static; flex-direction: row; flex-wrap: wrap; } .menu a { background: var(--card); border: 1px solid var(--line); } }
main { min-width: 0; }
h1 { font-size: 1.8rem; line-height: 1.2; margin: 0 0 .8rem; } h2 { font-size: 1.25rem; margin: 2.2rem 0 .4rem; color: var(--deep); } h3 { font-size: 1.05rem; margin: 1.5rem 0 .3rem; }
p, ul, ol { margin: .6rem 0; } ul, ol { padding-left: 1.3rem; } li { margin: .25rem 0; }
code { background: var(--line); border-radius: .3rem; padding: .05rem .35rem; font-size: .92em; }
.wide { overflow-x: auto; } table { border-collapse: collapse; width: 100%; font-size: .94rem; }
th, td { text-align: left; vertical-align: top; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
.cards { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); margin-top: 1.2rem; }
.cards a { background: var(--card); border: 1px solid var(--line); border-radius: 1.1rem; padding: .9rem 1rem; text-decoration: none; color: var(--ink); display: block; }
.cards a:hover { border-color: var(--teal); } .cards b { display: block; color: var(--teal); } .cards span { font-size: .92rem; color: var(--soft); }
.note { background: #fbe9bd; color: #422a17; border-radius: .7rem; padding: .7rem .9rem; }
.builder { background: var(--card); border: 1px solid var(--line); border-radius: .9rem; padding: .4rem 1rem 1rem; }
.builder fieldset { border: 0; padding: 0; margin: 1rem 0 0; } .builder legend { font-weight: 700; padding: 0; }
.builder label { display: block; margin: .35rem 0; } .builder .field { font-size: .92rem; color: var(--soft); }
.builder input:not([type=radio]):not([type=checkbox]) { display: block; width: 100%; max-width: 30rem; margin-top: .2rem; padding: .45rem .6rem; border: 1px solid var(--line); border-radius: .5rem; font: inherit; background: var(--paper); color: var(--ink); }
.builder input[type=number] { max-width: 9rem; } .builder [data-when] { margin: .3rem 0 .3rem 1.6rem; }
.file textarea { width: 100%; font: 13.5px/1.5 ui-monospace, Consolas, monospace; padding: .8rem; border: 1px solid var(--line); border-radius: .7rem; background: #14201f; color: #e9efee; white-space: pre; overflow-x: auto; resize: vertical; }
button { font: inherit; font-weight: 600; background: var(--btn); color: var(--btn-ink); border: 0; border-radius: 999px; padding: .5rem 1.1rem; min-height: 44px; cursor: pointer; margin-right: .4rem; }
.copy { background: var(--card); color: var(--ink); border: 1px solid var(--soft); }
.copy:hover { border-color: var(--teal); } .copy:focus-visible, .code pre:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.copy.inline { margin: .1rem 0 .1rem .4rem; padding: .3rem .9rem; }
.code { margin: .9rem 0; border: 1px solid var(--line); border-radius: .7rem; background: var(--card); overflow: hidden; }
.code .copy { display: block; margin: .4rem .5rem .1rem auto; }
.code pre { margin: 0; padding: .6rem .9rem .9rem; overflow-x: auto; font: 13.5px/1.5 ui-monospace, Consolas, monospace; }
.code code { background: none; padding: 0; font: inherit; }
code.cmd { overflow-wrap: anywhere; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.next { margin-top: 2.5rem; font-weight: 600; }
footer { border-top: 1px solid var(--line); padding: 1.3rem 1.1rem 2.5rem; font-size: .9rem; color: var(--soft); text-align: center; }
`);
console.log(`The website is in docs/site: a front page, the privacy policy and ${guides.length} guides`);
