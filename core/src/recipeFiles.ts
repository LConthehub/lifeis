/**
 * Recipes brought in from a file made by another app, and a grocery list pasted in from Notes or a message.
 *
 * Files read:
 *   - Paprika's export (.paprikarecipes): a zip of gzip-compressed JSON recipes. The unzipping and the gzip
 *     are done where the file is chosen (the page's own decompression, the same in a browser and on the
 *     phone), so this file only ever sees each recipe as a JSON object and needs no Node module.
 *   - schema.org Recipe JSON: one recipe, a list, or {"@graph": [...]}, as many apps export.
 *   - Life Is's own recipe export (a zip of Nextcloud Cookbook folders), so a person can move between two
 *     copies of Life Is. Each folder's recipe.json arrives as schema.org JSON, with its original.txt beside it.
 *
 * Promises kept: a recipe's words are never reworded, shortened or tidied (the same line-splitting as
 * everywhere else is all that touches them), the whole object it came as is kept as the recipe's original, and
 * nothing is looked up or sent anywhere. A Paprika recipe's picture does not stay inside its original (it is most of
 * a file's size); the page shrinks it and sends it beside the recipe as `photo`, and it is kept as the recipe's picture.
 *
 * Nothing here touches the database.
 */
import type { RecipeInput } from './kitchenTypes.ts';
import { Problem } from './problem.ts';
import { cut, minutes, readSchemaOrg, splitLines } from './recipeText.ts';
import { labelKey } from './small.ts';
import { parseLine } from './units.ts';

export const MAX_FILE_RECIPES = 2000;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PASTED_GROCERIES = 300;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** One thing found in a chosen file, as the page unpacked it. `original` is a Life Is export's original.txt. */
export type FileSource = {
  name: string;
  data: unknown;
  original?: string | null;
  /** The recipe's picture, shrunk by the page, when this is being brought in. */
  photo?: Uint8Array | null;
  /** When being looked over: the page has a picture for it (it isn't sent until the recipe is brought in). */
  has_photo?: boolean;
};
/** Something in the file that couldn't be opened at all (a damaged entry), and why. */
export type Unread = { name: string; why: string };
export type RecipeFile = { sources: FileSource[]; unreadable?: Unread[] };
/** `pictured`: it came with a picture; `photo` is the picture itself, when it was sent. */
export type FileRecipe = { name: string; input: RecipeInput; photo: Uint8Array | null; pictured: boolean };

// ---------- reading what another app wrote ----------

/**
 * A time the way apps write it, in minutes: "1 hr 15 min", "45 minutes", "1h", "1:15", "1 1/2 hours",
 * "PT1H15M", or a bare number (minutes). Null where no time can be read ("overnight").
 */
export function minutesFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100_000 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const given = value.trim().toLowerCase();
  if (!given) return null;
  const iso = minutes(given.toUpperCase());
  if (iso !== null) return iso <= 100_000 ? iso : null;
  const clock = /^(\d{1,3}):(\d{2})$/.exec(given);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+(?:\.\d+)?$/.test(given)) {
    const bare = Math.round(Number(given));
    return bare <= 100_000 ? bare : null;
  }
  const amount = (word: string) => {
    const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(word);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const fraction = /^(\d+)\/(\d+)$/.exec(word);
    return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(word);
  };
  let total = 0;
  let found = false;
  for (const m of given.matchAll(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/g)) {
    const unit = m[2]![0]!;
    total += amount(m[1]!) * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1);
    found = true;
  }
  return found && Number.isFinite(total) && total <= 100_000 ? Math.round(total) : null;
}

/** How many it serves, where a number can be read: 4, "4 servings", "Serves 6", "6-8" (6). */
function servingsFrom(value: unknown): number | null {
  const found = typeof value === 'number' ? value : Number(/\d+(?:\.\d+)?/.exec(text(value))?.[0]);
  return Number.isFinite(found) && found > 0 && found <= 1000 ? found : null;
}

function tagsFrom(...values: unknown[]): string[] {
  const tags: string[] = [];
  for (const value of values) {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    for (const one of list) if (typeof one === 'string' && one.trim() && !tags.some((t) => t.toLowerCase() === one.trim().toLowerCase())) tags.push(one.trim());
  }
  return tags.slice(0, 20);
}

// What a Paprika recipe carries that is too large to keep in a recipe's original: its pictures.
const PICTURES = ['photo_data', 'photo_large', 'photos'];

/** A recipe from Paprika's own JSON (the content of one .paprikarecipe). */
function fromPaprika(data: Json): RecipeInput {
  const title = text(data.name).trim();
  if (!title) throw new Problem(400, 'It has no name');
  const kept = Object.fromEntries(Object.entries(data).filter(([key]) => !PICTURES.includes(key)));
  return {
    title,
    description: text(data.description).trim() || null,
    servings: servingsFrom(data.servings),
    prep_minutes: minutesFrom(data.prep_time),
    cook_minutes: minutesFrom(data.cook_time),
    // The address when there is one; otherwise whatever the recipe says it came from ("Grandma", a book).
    source_url: text(data.source_url).trim() || text(data.source).trim() || null,
    ingredients_text: text(data.ingredients),
    steps_text: text(data.directions),
    notes: text(data.notes).trim() || null,
    tags: tagsFrom(data.categories),
    // Everything it said, as it said it (rating, nutrition, dates): nothing is dropped but the pictures.
    original_text: JSON.stringify(kept, null, 2),
  };
}

const isSchemaRecipe = (data: Json) => String(data['@type']).includes('Recipe') || 'recipeIngredient' in data || 'recipeInstructions' in data;

function toInput(data: unknown, original: string | null | undefined): RecipeInput {
  if (!isObject(data)) throw new Problem(400, "That isn't a recipe");
  if (!isSchemaRecipe(data) && ('ingredients' in data || 'directions' in data)) return fromPaprika(data);
  if (!text(data.name).trim() && typeof data.name !== 'number') throw new Problem(400, 'It has no name');
  const input = readSchemaOrg(data);
  // Life Is's own export keeps the original beside the recipe; what an app wrote is kept otherwise.
  if (original) input.original_text = original;
  const more = tagsFrom(input.tags, data.recipeCategory, data.recipeCuisine);
  input.tags = more;
  return input;
}

/** The recipes inside one thing found in a file: it may be one recipe, a list, or a graph holding them. */
function expand(data: unknown): unknown[] {
  if (Array.isArray(data)) return data.flatMap(expand);
  if (isObject(data)) {
    if (Array.isArray(data['@graph'])) {
      const graph = data['@graph'].filter((one) => isObject(one) && isSchemaRecipe(one));
      return graph.length ? graph : [data];
    }
    if (Array.isArray(data.recipes) && !('name' in data)) return data.recipes.flatMap(expand);
  }
  return [data];
}

/** The recipes in a file, read. Each that can't be read is named, with why, and doesn't stop the rest. */
export function readRecipeFile(file: RecipeFile): { recipes: FileRecipe[]; failed: Unread[] } {
  if (!file || !Array.isArray(file.sources)) throw new Problem(400, "There's nothing to read");
  if (file.sources.length === 0 && !file.unreadable?.length) throw new Problem(400, 'No recipes were found in that file');
  const recipes: FileRecipe[] = [];
  const failed: Unread[] = [...(file.unreadable ?? [])];
  for (const source of file.sources) {
    const found = expand(source.data);
    for (const one of found) {
      const name = (isObject(one) && text(one.name).trim()) || source.name || 'A recipe';
      try {
        // A picture belongs to a recipe only when the source holds just that one.
        const alone = found.length === 1;
        recipes.push({ name, input: toInput(one, source.original), photo: alone ? source.photo ?? null : null, pictured: alone && Boolean(source.photo?.length || source.has_photo) });
      } catch (problem) {
        failed.push({ name, why: problem instanceof Problem ? problem.message : "It couldn't be read" });
      }
    }
    if (recipes.length + failed.length > MAX_FILE_RECIPES) throw new Problem(400, `That's more than ${MAX_FILE_RECIPES.toLocaleString('en-US')} recipes. Import it as two files.`);
  }
  return { recipes, failed };
}

/**
 * What tells one recipe from another: its name and its first ingredient, each compared the way names are
 * everywhere (spacing and capitals don't matter). Two different "Pancakes" have different first ingredients.
 */
export function recipeKey(title: string, ingredientsText: string | null | undefined): string {
  const first = splitLines(ingredientsText, 'ingredients').find((line) => !line.is_heading)?.text ?? '';
  return `${labelKey(cut(title.trim(), 200))}\n${labelKey(cut(first, 5000))}`;
}

// ---------- a grocery list pasted in ----------

// What notes apps and messages put in front of a line: dashes, bullets, check boxes, "1." and "2)".
const MARK = /^(?:[-*•·▪◦‣–—]+|\[[ xX✓✔]?\]|\([ xX✓✔]?\)|[☐☑☒✓✔✅□■▢○●])\s*/u;
const NUMBER_MARK = /^\d{1,3}[.)]\s+/;

// Words that say how to prepare or choose a thing, not a thing of its own: "tomatoes, diced". A piece starting
// with one of the first kind is a note; a piece made only of words of either kind is too ("extra virgin").
const NOTE_STARTS = new Set(['optional', 'divided', 'plus', 'about', 'or', 'preferably', 'cut', 'at', 'to', 'for', 'if', 'not', 'any', 'a', 'the']);
const NOTE_WORDS = new Set([...NOTE_STARTS, 'fresh', 'frozen', 'canned', 'ripe', 'large', 'small', 'medium', 'extra', 'virgin', 'boneless', 'skinless',
  'and', 'into', 'pieces', 'room', 'temperature', 'taste', 'garnish', 'needed', 'finely', 'thinly', 'roughly', 'coarsely', 'very']);
const noteWord = (word: string) => NOTE_WORDS.has(word) || /^[a-z]{3,}(?:ed|ly)$/.test(word);

/** The pieces of a line between its commas, leaving alone commas in brackets. */
function commaPieces(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let piece = '';
  for (const ch of line) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(piece); piece = ''; } else piece += ch;
  }
  out.push(piece);
  return out.map((p) => p.trim());
}

const wordsOf = (piece: string) => piece.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, '')).filter(Boolean);
const looksLikeANote = (piece: string) => {
  const words = wordsOf(piece);
  if (words.length === 0 || NOTE_STARTS.has(words[0]!) || words.every(noteWord)) return true;
  // "2 lbs" or "1 large" after a name is an amount for it ("onions, 2 lbs"), where "2 eggs" is a thing.
  const parsed = parseLine(piece);
  return parsed.quantity !== null && wordsOf(parsed.name).every(noteWord);
};

/**
 * One line, as one thing to buy or several. Split on commas only when it plainly lists short things:
 * every piece is a few words and none is a note on the one before. "milk, eggs, bread" is three things;
 * "tomatoes, diced", "olive oil, extra virgin" and "1 cup flour, sifted" are one each.
 */
function splitThings(line: string): string[] {
  const pieces = commaPieces(line);
  if (pieces.length < 2) return [line.replace(/,+\s*$/, '').trim()];
  const last = pieces[pieces.length - 1]!.replace(/^(?:and|&)\s+/i, '');
  const all = [...pieces.slice(0, -1), last];
  const alone = all.filter(Boolean);
  const short = alone.every((p) => p.split(/\s+/).length <= 4);
  if (alone.length < 2 || !short || alone.slice(1).some(looksLikeANote)) return [alone.join(', ')];
  return alone;
}

/**
 * Lines from a pasted list, ready to go through the same path as one typed in: list marks and check boxes
 * stripped, blank lines and headings ("Produce:", "# Dairy") left out, a line of several short things split.
 */
export function readGroceryList(pasted: string): string[] {
  if (typeof pasted !== 'string' || !pasted.trim()) throw new Problem(400, 'Paste a list first');
  if (pasted.length > 100_000) throw new Problem(400, "That's too much to paste at once");
  const things: string[] = [];
  for (const raw of pasted.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.trim();
    for (let i = 0; i < 4; i += 1) {
      const before = line;
      line = line.replace(MARK, '').replace(NUMBER_MARK, '').trim();
      if (line === before) break;
    }
    if (!line || line.endsWith(':') || /^#+\s/.test(line)) continue;
    things.push(...splitThings(line).filter(Boolean));
  }
  if (things.length === 0) throw new Problem(400, 'There was nothing to buy in that');
  if (things.length > MAX_PASTED_GROCERIES) throw new Problem(400, `That's more than ${MAX_PASTED_GROCERIES} things. Paste it in two parts.`);
  return things;
}
