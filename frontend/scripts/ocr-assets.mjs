// Puts the parts that read text off a photo where the pages can load them from Life Is itself
// (public/ocr), instead of from someone else's servers: the reader, its engine, and what it knows of English.
// Run before every build. The copies aren't kept in git; they come from node_modules.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, '..', 'node_modules');
const out = path.join(here, '..', 'public', 'ocr');
mkdirSync(out, { recursive: true });
const copy = (from, name = path.basename(from)) => copyFileSync(path.join(modules, from), path.join(out, name));

copy('tesseract.js/dist/worker.min.js');
// The engine comes in a few builds; the reader picks the fastest one the device can run.
for (const file of readdirSync(path.join(modules, 'tesseract.js-core'))) if (/-lstm\.wasm\.js$/.test(file)) copy(`tesseract.js-core/${file}`);
copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
console.log('The photo reader is in public/ocr');
