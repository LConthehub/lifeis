/**
 * Life Is's pages, served by the same program as the API: the built files from frontend/dist, and index.html
 * for every other address (the pages work out which one to show themselves).
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Only Life Is's own scripts may run, the page can't be framed, and no address leaks to other sites.
// 'wasm-unsafe-eval' lets Life Is's own compiled code run (reading the text off a photo of a recipe, on the
// person's own device); it does not allow scripts written as text to be run.
const PAGE_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  // The camera is for Life Is's own pages only (scanning a barcode); the browser still asks the person each time.
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/octet-stream',
};

export type Page = { headers: Record<string, string>; body: Buffer };

export function pages(folder: string) {
  const root = realpathSync(folder);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`No built pages in ${root}: run the frontend build first`);

  /** The file for `asked` inside the pages folder, or null. Never anything outside it. */
  function fileFor(asked: string): string | null {
    if (!asked || asked.includes('\0')) return null;
    const wanted = path.join(root, asked);
    if (!existsSync(wanted)) return null;
    const full = realpathSync(wanted);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    return statSync(full).isFile() ? full : null;
  }

  return async function page(pathname: string, https: boolean): Promise<Page> {
    let asked = '';
    try {
      asked = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      // An address that can't be read gets the front page, like any other unknown one.
    }
    const found = fileFor(asked);
    const headers = { ...PAGE_HEADERS };
    if (https) headers['Strict-Transport-Security'] = 'max-age=31536000';
    // Files under assets/ have fingerprinted names: safe to keep.
    headers['Cache-Control'] = found && asked.startsWith('assets/') ? 'public, max-age=2592000, immutable' : 'no-store';
    const file = found ?? index;
    headers['Content-Type'] = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return { headers, body: await readFile(file) };
  };
}
