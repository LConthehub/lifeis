// Makes the GitHub wiki from the same guides the website uses (docs/guide), so the guides are written in one place.
//
//   node scripts/wiki.mjs <folder>
//
// <folder> is a clone of the wiki (https://github.com/LConthehub/lifeis.wiki.git), such as private/wiki. Every
// page there is written again from docs/guide; pages the guides no longer have are removed. Then commit and push
// the wiki clone as usual. Edit the guides in docs/guide, never the wiki itself: the next run writes over it.
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out || !existsSync(out)) {
  console.error('Give the wiki clone folder: node scripts/wiki.mjs private/wiki');
  process.exit(1);
}

const SITE = 'https://lifeis.living';
const DEMO = 'https://demo.lifeis.living';
const site = readFileSync(path.join(root, 'docs', 'build-site.mjs'), 'utf8');
// The guide order, the guides kept out of the menu, and whether the download is out, all as the website has them.
const listOf = (name) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(site)[1].replace(/'/g, '"'));
const GUIDES = listOf('GUIDES');
const QUIET = listOf('QUIET');
const RELEASED = /const RELEASED = true/.test(site);
const IMAGE = /const IMAGE = '([^']+)'/.exec(site)[1];

const guideDir = path.join(root, 'docs', 'guide');
const pageName = (title) => title.replace(/[\\/:*?"<>|#%,]/g, '').trim().replace(/\s+/g, '-');
const guides = GUIDES.filter((slug) => existsSync(path.join(guideDir, `${slug}.md`))).map((slug) => {
  const text = readFileSync(path.join(guideDir, `${slug}.md`), 'utf8').replace(/\r\n/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta = Object.fromEntries((front?.[1] ?? '').split('\n').map((l) => /^(\w+):\s*(.+)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  const title = meta.title ?? slug;
  return { slug, title, page: pageName(title), blurb: meta.blurb ?? '', body: front ? text.slice(front[0].length) : text };
});
const pageOf = Object.fromEntries(guides.map((g) => [g.slug, g.page]));

const COMPOSE = `\`\`\`yaml
services:
  lifeis:
    image: ${IMAGE}
    ports: ["127.0.0.1:8020:8008"]
    volumes: [lifeis_data:/data, lifeis_keys:/keys]
    restart: unless-stopped
volumes:
  lifeis_data:
  lifeis_keys:
\`\`\``;
const PARTS = {
  released: RELEASED ? '' : `> **Not released yet.** Life Is for your own computer comes out with the app. Meanwhile, [try the demo](${DEMO}).`,
  builder: `The [setup builder on the website](${SITE}/docs/install) writes this file for you from your choices. The simplest setup, kept by Docker and open on this computer only, is:\n\n${COMPOSE}`,
  steps: '1. Save the file above as `docker-compose.yml` in your Life Is folder.\n2. Open a terminal in that folder and run `docker compose up -d`.\n3. On this computer, open http://localhost:8020 and make your account.',
};

const wikiText = (g) => {
  let body = g.body.replace(/^# .*\n+/, ''); // the wiki shows the page name as its title
  // The website's builder changes as you type; the wiki has a plain file instead, so the line about typing goes.
  body = body.replace(' Fill in what you want; the file below changes as you type. Nothing you type here is sent anywhere.', '');
  body = body.replace('Pick your options, copy one file, start it. This page writes the setup file for you.', 'Copy one file, start it.');
  body = body.replace(/^\{\{(\w+)\}\}$/gm, (whole, name) => PARTS[name] ?? whole);
  // Links between guides go to wiki pages; links to the rest of the website go to the website.
  body = body.replace(/\]\(([a-z-]+)\.html(#[^)\s]*)?\)/g, (whole, slug, hash = '') => (pageOf[slug] ? `](${pageOf[slug]}${hash})` : `](${SITE}/docs/${slug}${hash})`));
  body = body.replace(/\]\(\.\.\/([a-z-]*)(#[^)\s]*)?\)/g, (whole, p, hash = '') => `](${SITE}/${p}${hash ?? ''})`);
  const unknown = /\{\{\w+\}\}/.exec(body);
  if (unknown) throw new Error(`${g.slug}.md has ${unknown[0]}, which the wiki has nothing for`);
  return `${g.blurb ? `*${g.blurb}*\n\n` : ''}${body.trim()}\n`;
};

const listed = guides.filter((g) => !QUIET.includes(g.slug));
const files = {
  'Home.md': `Life Is is a private home organizer: meals and groceries, the things you keep, upkeep and chores, routines, plans, money and your collection. It runs on your phone or on a computer you run at home, and nothing leaves it unless you turn that on.\n\nThese are the same guides as on the [website](${SITE}/docs/). To see it first, [try the demo](${DEMO}).\n\n${listed.map((g) => `- **[${g.title}](${g.page})**${g.blurb ? `: ${g.blurb}` : ''}`).join('\n')}\n`,
  '_Sidebar.md': `**[Life Is](Home)**\n\n${listed.map((g) => `- [${g.title}](${g.page})`).join('\n')}\n`,
  '_Footer.md': `These pages are made from \`docs/guide\` in the [Life Is code](https://github.com/LConthehub/lifeis). A change made here is written over on the next update. Questions: [${SITE}](${SITE}).\n`,
};
for (const g of guides) files[`${g.page}.md`] = wikiText(g);

for (const file of readdirSync(out)) {
  if (file.endsWith('.md') && !files[file]) rmSync(path.join(out, file));
}
for (const [file, text] of Object.entries(files)) writeFileSync(path.join(out, file), text);
console.log(`Wrote ${Object.keys(files).length} wiki pages to ${out}${RELEASED ? '' : ' (the install page says "Not released yet", as the website does)'}`);
