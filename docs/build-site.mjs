// Makes the small public website (docs/site) from the words in this folder: a front page and the privacy
// policy. Plain pages with nothing loaded from anywhere else, so they can be put on any web host as they are.
//   node docs/build-site.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'site');
mkdirSync(out, { recursive: true });

const safe = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (text) => safe(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/([A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,})/g, '<a href="mailto:$1">$1</a>');

/** The little of Markdown these pages use: headings, paragraphs, bullets and tables. */
function html(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) { parts.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
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
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|- |\|)/.test(lines[i + 1])) { i += 1; words.push(lines[i]); }
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
  :root { --ink: #1f2d33; --soft: #5b6b72; --paper: #fbfaf7; --line: #dfe5e3; --accent: #264653; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e9efee; --soft: #a3b3b5; --paper: #14201f; --line: #2b3b3c; --accent: #9ed0c8; } }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2rem 1.1rem 4rem; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .4rem; color: var(--accent); }
  p, ul { margin: .6rem 0; } ul { padding-left: 1.2rem; }
  a { color: var(--accent); }
  .wide { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .93rem; }
  th, td { text-align: left; vertical-align: top; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
  nav { font-size: .9rem; margin-bottom: 1.5rem; } footer { margin-top: 3rem; font-size: .85rem; color: var(--soft); }
</style>
</head>
<body>
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
const FEATURES = [
  ['🍳', 'Eating', 'Recipes kept exactly as you wrote them, the week\'s meals, a grocery list that knows your pantry, and what things cost.'],
  ['📦', 'Keeping', 'Everything you own, room by room. Scan a shelf to fill it in. Each thing remembers where it has been and what it was used for.'],
  ['🔧', 'Upkeep', 'The furnace filter, the oil change, the rent, the passport, the chores. Each comes due, reminds you, and keeps every time it was done.'],
  ['🏠', 'Home records', 'Receipts, manuals, serial numbers and warranties beside each thing, and a home inventory to print for your insurer.'],
  ['🐾', 'Pets', 'Their vet, microchip, food and weight, and care that comes round: vaccinations, flea treatment, the check-up.'],
  ['📒', 'House manual', 'Where the water shuts off, the Wi-Fi, who to call. Print it, or share it with a sitter by a link that stops working when you say.'],
  ['🧵', 'Making', 'Projects with what they use, what they cost and the time on them, tied to the things and tools you already have.'],
  ['📚', 'Enjoying', 'Books, films, music and games on every format, who has borrowed what, and what you watched or read and when.'],
  ['💵', 'Spending', 'A plan for the month by category, private unless you share it. Bills you pay go straight in.'],
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
<link rel="icon" href="icon.png">
<style>
  :root { --ink: #1f2d33; --soft: #5b6b72; --paper: #fbfaf7; --card: #ffffff; --line: #dfe5e3; --deep: #264653; --teal: #2a9d8f; --sand: #e9c46a; --coral: #e76f51; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e9efee; --soft: #a3b3b5; --paper: #14201f; --card: #1b2b2b; --line: #2b3b3c; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  a { color: var(--teal); }
  .hero { background: linear-gradient(135deg, var(--deep) 0%, var(--teal) 45%, var(--sand) 82%, var(--coral) 100%); color: #fff; padding: 1rem 1.1rem 3.5rem; }
  .bar, .wrap { max-width: 64rem; margin: 0 auto; }
  .bar { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .bar strong { font-size: 1.15rem; margin-right: auto; display: flex; align-items: center; gap: .5rem; }
  .bar img { width: 2rem; height: 2rem; border-radius: .5rem; }
  .bar a { color: #fff; text-decoration: none; font-size: .95rem; opacity: .9; }
  .pill, .button { display: inline-block; border-radius: 999px; text-decoration: none; font-weight: 600; }
  .pill { background: rgba(255,255,255,.2); padding: .3rem .9rem; }
  .hero h1 { font-size: clamp(1.9rem, 5vw, 3rem); line-height: 1.15; margin: 3rem 0 1rem; max-width: 22ch; }
  .hero p { font-size: 1.15rem; max-width: 46ch; margin: 0 0 1.6rem; opacity: .95; }
  .button { background: #fff; color: var(--deep); padding: .7rem 1.4rem; margin: 0 .5rem .5rem 0; }
  .button.quiet { background: rgba(255,255,255,.18); color: #fff; }
  .wrap { padding: 0 1.1rem; }
  .shot { margin: -2.2rem auto 0; display: block; width: 100%; height: auto; border-radius: 1rem; box-shadow: 0 12px 40px rgba(0,0,0,.25); border: 1px solid var(--line); }
  h2 { font-size: 1.5rem; margin: 3.5rem 0 .4rem; }
  .lede { color: var(--soft); margin: 0 0 1.4rem; max-width: 60ch; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 1.1rem 1.2rem; }
  .card h3 { margin: 0 0 .3rem; font-size: 1.05rem; } .card p { margin: 0; color: var(--soft); font-size: .95rem; }
  .card .icon { font-size: 1.5rem; }
  .shots { display: grid; gap: 1.2rem; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); }
  figure { margin: 0; } figure img { width: 100%; height: auto; border-radius: .8rem; border: 1px solid var(--line); display: block; } figcaption { font-size: .9rem; color: var(--soft); margin-top: .4rem; }
  .price { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .price b { font-size: 1.6rem; display: block; margin: .2rem 0; }
  ul.plain { padding-left: 1.1rem; margin: .4rem 0 0; color: var(--soft); font-size: .95rem; }
  .center { text-align: center; margin: 2.5rem 0; }
  .center .button { background: var(--teal); color: #fff; }
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
    <a class="pill" href="${DEMO}">Try the demo</a>
  </div>
  <div class="wrap" style="padding:0">
    <h1>Your whole home, in one place that is yours.</h1>
    <p>Life Is links what you own to when and how you use it: meals, things, upkeep, pets, records and plans. It lives on your own device. No account, no ads, no subscription.</p>
    <a class="button" href="${DEMO}">Try the demo</a>
    <a class="button quiet" href="#what">See what it does</a>
  </div>
</header>
<div class="wrap">
${shots[0] ? `<img class="shot" src="img/${shots[0][0]}" alt="${safe(shots[0][1])}" width="1280" height="900">` : ''}

<h2 id="what">What it does</h2>
<p class="lede">Each part finishes the sentence "Life is…". Use one, or all of them. They know about each other: a tool you scan into the garage is the same tool a job needs and a project uses.</p>
<div class="grid">
${FEATURES.map(([icon, title, text]) => `  <div class="card"><div class="icon" aria-hidden="true">${icon}</div><h3>${safe(title)}</h3><p>${safe(text)}</p></div>`).join('\n')}
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
<p class="lede" style="text-align:center;margin:0 auto">The app is on its way to the app stores.</p>
</div>
<footer>
  <a href="privacy">Privacy policy</a> · Questions: <a href="mailto:hello@lifeis.living">hello@lifeis.living</a>
</footer>
</body>
</html>
`);
console.log('The website is in docs/site');
