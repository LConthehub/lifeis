// Makes the small public website (docs/site) from the words in this folder: a front page and the privacy
// policy. Plain pages with nothing loaded from anywhere else, so they can be put on any web host as they are.
//   node docs/build-site.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
writeFileSync(path.join(out, 'index.html'), page('Life Is', `<h1>Life Is</h1>
<p>A household organizer that links what you own to when and how you use it: recipes, the week's meals, groceries, the things you keep, projects, plans and spending.</p>
<p>It keeps everything on your own device, or on a computer you run yourself. No account, no advertising, no tracking. One payment, no subscription.</p>
<p>The app is on its way to the app stores.</p>
<p><a href="privacy.html">Privacy policy</a></p>
<footer>Questions: <a href="mailto:hello@lifeis.living">hello@lifeis.living</a></footer>`));
console.log('The website is in docs/site');
