// Opening a file of recipes from another app, here in the page, so that what reaches Life Is is plain JSON.
//
// Paprika's export (.paprikarecipes) is a zip whose entries are each one gzip-compressed JSON recipe. Life Is's
// own export is a zip of folders holding recipe.json and original.txt. A .json file is schema.org recipe JSON.
// The browser (and the phone's web view) decompress with DecompressionStream, so nothing from Node is needed
// and Life Is's core never has to know a binary format. Nothing is sent anywhere by opening a file.

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_RECIPES = 2000;
// The most the server (and the phone's own routes) are sent at once, with room to spare.
const MAX_SENT_BYTES = 7 * 1024 * 1024;
// Bringing recipes in is sent in batches of about this much, so a file with many pictures never goes past that.
const BATCH_BYTES = 3 * 1024 * 1024;
// A single recipe, unpacked, is never anywhere near this; a file that unpacks to more is not a recipe.
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

import axios from 'axios';
import { shrink } from './shrink';

const PICTURES = ['photo_data', 'photo_large', 'photos'];

async function inflate(bytes, format) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ENTRY_BYTES) { await reader.cancel(); throw new Error('It unpacks to far more than a recipe'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');

/** The files inside a zip: [{ name, read() }], read from its central directory. Stored and deflated entries only. */
export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("That isn't a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('That zip file is damaged');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({
      name,
      read: async () => {
        if (size === 0xffffffff || local === 0xffffffff) throw new Error('Zip files this large are not supported');
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('That entry is damaged');
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const packed = bytes.subarray(start, start + size);
        if (method === 0) return packed;
        if (method === 8) return inflate(packed, 'deflate-raw');
        throw new Error('It is packed in a way that is not supported');
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isGzip = (b) => b[0] === 0x1f && b[1] === 0x8b;
const baseName = (path) => path.split('/').pop();
const folderOf = (path) => path.slice(0, path.length - baseName(path).length);

/**
 * Paprika keeps each recipe's picture inside the recipe, as base64 (`photo_data`), which is most of a file's size.
 * It is taken out of the recipe here (the recipe's own words are kept whole) and handed back, so it can be shrunk
 * and sent beside its recipe, a few at a time. The other picture fields are links or file names, not pictures.
 */
function takePicture(data) {
  let picture = null;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of PICTURES) {
      if (key in data) {
        if (key === 'photo_data' && typeof data[key] === 'string' && data[key].trim()) picture = data[key].replace(/\s+/g, '');
        delete data[key];
      }
    }
  }
  return picture;
}

/**
 * A chosen file, unpacked: what the server's routes are sent. `sources` are the recipes' JSON (with an
 * `original` where a Life Is export has one), `unreadable` the entries that couldn't be opened and why.
 * Throws a plain sentence when the file is too large, isn't a recipe file, or has nothing in it.
 */
export async function unpackRecipeFile(file) {
  if (file.size > MAX_BYTES) throw new Error('That file is larger than 50 MB. Bring it in as two files.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sources = [];
  const unreadable = [];
  // Each recipe's picture as it came, by the number of its source. Kept here; only that there is one is said when looking over.
  const photos = new Map();
  const add = (name, text, original) => {
    const data = JSON.parse(text);
    // A list of recipes becomes one source each, so each can carry its own picture.
    const each = Array.isArray(data) && original == null && data.every((one) => one && typeof one === 'object' && !Array.isArray(one)) ? data : [data];
    for (const one of each) {
      const picture = takePicture(one);
      if (picture) photos.set(sources.length, picture);
      sources.push({ name, data: one, ...(original != null ? { original } : {}), ...(picture ? { has_photo: true } : {}) });
    }
  };
  if (isZip(bytes)) {
    const entries = zipEntries(bytes).filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/') && !baseName(e.name).startsWith('.'));
    const originals = new Map(entries.filter((e) => baseName(e.name) === 'original.txt').map((e) => [folderOf(e.name), e]));
    for (const entry of entries) {
      const name = baseName(entry.name);
      const lower = name.toLowerCase();
      if (!(lower.endsWith('.paprikarecipe') || lower.endsWith('.json'))) continue;
      try {
        const raw = await entry.read();
        const text = lower.endsWith('.paprikarecipe') ? decode(await inflate(raw, 'gzip')) : decode(raw);
        const original = lower === 'recipe.json' && originals.has(folderOf(entry.name)) ? decode(await originals.get(folderOf(entry.name)).read()) : null;
        add(lower === 'recipe.json' ? baseName(entry.name.slice(0, -1 - name.length)) || name : name.replace(/\.paprikarecipe$/i, ''), text, original);
      } catch (problem) {
        unreadable.push({ name: name.replace(/\.paprikarecipe$/i, ''), why: problem instanceof SyntaxError ? "It isn't a recipe Life Is can read" : problem.message || "It couldn't be opened" });
      }
      if (sources.length + unreadable.length > MAX_RECIPES) throw new Error('That file has more than 2,000 recipes. Bring it in as two files.');
    }
  } else if (isGzip(bytes)) {
    try { add(file.name.replace(/\.(paprikarecipe|gz)$/i, ''), decode(await inflate(bytes, 'gzip'))); } catch { unreadable.push({ name: file.name, why: "It isn't a recipe Life Is can read" }); }
  } else {
    try { add(file.name, decode(bytes)); } catch { throw new Error("That isn't a file of recipes. Life Is reads Paprika's export (.paprikarecipes), recipe JSON, and a zip made by Life Is."); }
  }
  if (sources.length + unreadable.length === 0) throw new Error('No recipes were found in that file.');
  const body = { sources, unreadable };
  if (new Blob([JSON.stringify(body)]).size > MAX_SENT_BYTES) throw new Error("That's more than can be brought in at once. Bring it in as two files.");
  return { body, pictures: photos.size, photos };
}

/** A Paprika picture (base64) shrunk to a size worth keeping, as base64 again; null when it can't be opened as a picture. */
async function shrunk(base64) {
  try {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const small = await shrink(new Blob([bytes]));
    return small.length <= 4 * 1024 * 1024 ? small : null;
  } catch {
    return null;
  }
}

/**
 * Bring the unpacked recipes in: sent in batches of about 3 MB, each recipe's picture shrunk just before it goes
 * (so the whole file's pictures are never held shrunk at once). A recipe already in Life Is is not given a picture.
 * Gives the totals; if a batch fails, says how far it got, since bringing the same file in again adds nothing twice.
 */
export async function bringRecipesIn(body, photos, onProgress = () => {}) {
  const total = { found: 0, added: 0, already: 0, pictures: 0, failed: [] };
  const batches = [];
  let batch = { sources: [], size: 0 };
  for (const [i, source] of body.sources.entries()) {
    const sent = { ...source };
    delete sent.has_photo;
    if (photos.has(i)) { const small = await shrunk(photos.get(i)); if (small) sent.photo = small; }
    const size = JSON.stringify(sent).length;
    if (batch.sources.length > 0 && batch.size + size > BATCH_BYTES) { batches.push(batch); batch = { sources: [], size: 0 }; }
    batch.sources.push(sent);
    batch.size += size;
  }
  batches.push(batch);
  let sentCount = 0;
  for (const [n, one] of batches.entries()) {
    try {
      const { data } = await axios.post('/api/kitchen/recipes/file', { sources: one.sources, unreadable: n === 0 ? body.unreadable : [] });
      total.found += data.found; total.added += data.added; total.already += data.already; total.pictures += data.pictures; total.failed.push(...data.failed);
    } catch (err) {
      const reason = err?.response?.data?.detail || err?.message || "Couldn't bring them in";
      throw new Error(total.added > 0 || sentCount > 0
        ? `${reason} ${total.added} recipes were brought in before it stopped. Choose the file again to bring in the rest: a recipe already in Life Is is not added twice.`
        : reason);
    }
    sentCount += one.sources.length;
    onProgress(sentCount);
  }
  return total;
}
