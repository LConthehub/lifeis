/**
 * A recipe's words: splitting what was typed into lines and steps, and bringing recipes in and out.
 *
 * The promise about recipes: they are kept exactly as you wrote them. Every ingredient line and every step is
 * stored word for word, with section headings ("For the sauce") where you put them, and the original text of
 * an imported recipe is kept beside it. Nothing here shortens, summarises or rewrites a recipe. The one thing
 * left out is what a copied web page adds around a recipe (skip links, buttons, ratings, photo credits); the
 * pasted text is still kept whole as the original.
 *
 * Recipes come in as pasted text or as schema.org recipe JSON (what the Nextcloud Cookbook app and most
 * recipe sites use), and go out as schema.org JSON.
 *
 * Nothing here touches the database. It reads the same way backend/kitchen.py does, and
 * tests/recipeText.golden.json holds the Python answers it is checked against.
 */
import type { Part, Recipe, RecipeInput } from './kitchenTypes.ts';
import { Problem } from './problem.ts';
import { parseLine } from './units.ts';

export const TEXT_LIMIT = 200_000; // a recipe's text: long enough for anything real
export const MAX_LINES = 500;

export type TextLine = { text: string; is_heading: boolean };

/** The first `limit` characters, never cutting a character (an emoji, say) in half. */
export function cut(text: string, limit: number): string {
  return text.length <= limit ? text : Array.from(text).slice(0, limit).join('');
}

const unixLines = (text: string) => text.replace(/\r\n/g, '\n');
const withoutOuterNewlines = (text: string) => text.replace(/^\n+|\n+$/g, '');
const withoutLeadingHashes = (text: string) => text.replace(/^#+/, '');

/**
 * One line per ingredient, or one paragraph per step. A line starting with "#" (or ending in ":" on its own,
 * for ingredients) is a section heading. Text is kept exactly, apart from the "#" and blank lines.
 */
export function splitLines(text: string | null | undefined, part: Part): TextLine[] {
  if (!text) return [];
  let chunks: string[];
  if (part === 'steps') {
    chunks = unixLines(text).split(/\n\s*\n/).map(withoutOuterNewlines);
    // A pasted list with one step per line and no blank lines between: each line is a step.
    if (chunks.length === 1 && chunks[0]!.includes('\n')) chunks = chunks[0]!.split('\n');
    // A heading written straight above its first step ("# Layering" then the step on the next line).
    const split: string[] = [];
    for (const chunk of chunks) {
      const whole = withoutOuterNewlines(chunk);
      const at = whole.indexOf('\n');
      const first = at === -1 ? whole : whole.slice(0, at);
      const rest = at === -1 ? '' : whole.slice(at + 1);
      if (first.trim().startsWith('#') && rest.trim()) split.push(first, rest);
      else split.push(chunk);
    }
    chunks = split;
  } else {
    chunks = unixLines(text).split('\n');
  }
  const out: TextLine[] = [];
  for (const chunk of chunks) {
    const stripped = chunk.trim();
    if (!stripped) continue;
    if (stripped.startsWith('#')) {
      out.push({ text: withoutLeadingHashes(stripped).trim(), is_heading: true });
    } else if (part === 'ingredients' && stripped.endsWith(':') && stripped.length < 60 && !parseLine(stripped).quantity) {
      out.push({ text: stripped.slice(0, -1).trim(), is_heading: true });
    } else {
      out.push({ text: part === 'ingredients' ? stripped : chunk.trimEnd(), is_heading: false });
    }
  }
  return out.slice(0, MAX_LINES);
}

/** The editable text of a recipe's ingredients or steps, exactly as stored. */
export function linesAsText(lines: { part: Part; text: string; is_heading: boolean }[], part: Part): string {
  return lines
    .filter((line) => line.part === part)
    .map((line) => (line.is_heading ? '# ' + line.text : line.text))
    .join(part === 'ingredients' ? '\n' : '\n\n');
}

// ---------- bringing recipes in ----------

const INGREDIENT_HEADS = /^\s*#*\s*(ingredients?)\s*:?\s*$/i;
const STEP_HEADS = /^\s*#*\s*(instructions?|directions?|method|steps?|preparation)\s*:?\s*$/i;
const NOTE_HEADS = /^\s*#*\s*(notes?|tips?)\s*:?\s*$/i;

/** A star rating or a count of reviews, as a recipe page shows them: "4.8", "(4)", "1 REVIEW", "12 ratings". */
const RATING = /^\s*(\d\.\d|\(\d[\d,]*\)|\d[\d,]* (reviews?|ratings?))\s*$/i;
/**
 * Lines a web page adds around its recipe when the whole page is copied: skip links, buttons, ratings and
 * photo credits ("Credit: name; Food Stylist: name"). They are not part of the recipe, so they are left out.
 */
const PAGE_BITS = /^\s*(skip to (main )?content|jump to recipe|print( recipe)?|save|saved|rate|share|pin( it)?)\s*$/i;
const CREDIT = /^\s*(photo )?credits?\s*:|^\s*photo(graph)? by\b/i;
const pageBit = (line: string) => PAGE_BITS.test(line) || RATING.test(line) || CREDIT.test(line);

/**
 * A recipe from pasted text. The first line is the name; "Ingredients" and "Method" (or "Instructions",
 * "Directions", "Steps") headings split the rest. Without headings, lines that start with an amount are
 * ingredients and everything after the first line that doesn't is a step.
 *
 * A whole copied web page is read too. Its skip links, buttons, ratings and photo credits are left out, and
 * when the page starts with those, the name is the line just above the rating, with the page's header above
 * it left out. Nothing else is rewritten, and the text as pasted is kept as the original.
 */
export function readPasted(text: string): RecipeInput {
  const lines = unixLines(text).split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  if (!lines.length) throw new Problem(400, "There's nothing to read");
  // A copied page starts with its skip link or buttons, before the site's name and the recipe's.
  let copied = false;
  while (lines.length > 1 && (!lines[0]!.trim() || pageBit(lines[0]!))) {
    if (lines[0]!.trim()) copied = true;
    lines.shift();
  }
  if (copied) {
    const heading = lines.findIndex((line) => INGREDIENT_HEADS.test(line) || STEP_HEADS.test(line));
    const rating = lines.findIndex((line) => RATING.test(line));
    if (rating > 0 && (heading === -1 || rating < heading)) {
      let named = rating - 1;
      while (named > 0 && (!lines[named]!.trim() || pageBit(lines[named]!))) named -= 1;
      if (lines[named]!.trim()) lines.splice(0, named);
    }
  }
  const title = cut(withoutLeadingHashes(lines.shift()!.trim()).trim(), 200);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!pageBit(lines[i]!)) continue;
    // A page bit on its own between two blank lines takes one blank with it, so no wider gap is left.
    const alone = i > 0 && !lines[i - 1]!.trim() && i + 1 < lines.length && !lines[i + 1]!.trim();
    lines.splice(alone ? i - 1 : i, alone ? 2 : 1);
  }
  const sections = { intro: [] as string[], ingredients: [] as string[], steps: [] as string[], notes: [] as string[] };
  let current: 'ingredients' | 'steps' | 'notes' | null = null;
  for (const line of lines) {
    if (INGREDIENT_HEADS.test(line)) current = 'ingredients';
    else if (STEP_HEADS.test(line)) current = 'steps';
    else if (NOTE_HEADS.test(line)) current = 'notes';
    else sections[current ?? 'intro'].push(line);
  }
  if (current === null) {
    // No headings: amounts first, then steps.
    const body = sections.intro;
    sections.intro = [];
    let i = 0;
    while (i < body.length && (!body[i]!.trim() || parseLine(body[i]!).quantity !== null)) i += 1;
    sections.ingredients = body.slice(0, i);
    sections.steps = body.slice(i);
  }
  let servings: number | null = null;
  for (const line of sections.intro) {
    const m = /(?:serves|servings?|makes|yield)\s*:?\s*(\d+)/i.exec(line);
    if (m) {
      servings = Number(m[1]);
      break;
    }
  }
  return {
    title: title || 'Untitled recipe',
    description: sections.intro.join('\n').trim() || null,
    servings,
    // An ingredient is a line, so the gaps between them (text read off a photo is full of them) say nothing.
    ingredients_text: sections.ingredients.filter((line) => line.trim()).join('\n').trim(),
    steps_text: sections.steps.join('\n').trim(),
    notes: sections.notes.join('\n').trim() || null,
    original_text: text,
  };
}

/** ISO 8601 durations as recipe sites write them: PT1H30M -> 90. */
export function minutes(iso: unknown): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(iso.trim());
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isRecipe = (value: unknown): value is Json => isObject(value) && String(value['@type']).includes('Recipe');

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isObject(value)) {
    const text = value.text || value.name;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

/** A recipe from schema.org Recipe JSON: what the Nextcloud Cookbook app stores and most recipe sites publish. */
export function readSchemaOrg(given: unknown): RecipeInput {
  let data = given;
  if (Array.isArray(data)) data = data.find(isRecipe) ?? data[0] ?? {};
  if (isObject(data) && Array.isArray(data['@graph'])) data = data['@graph'].find(isRecipe) ?? {};
  if (!isObject(data) || !data.name) throw new Problem(400, "That doesn't look like a recipe");

  const steps: string[] = [];
  const given_steps = data.recipeInstructions || [];
  const instructions: unknown[] = Array.isArray(given_steps) ? given_steps : [given_steps];
  for (const item of instructions) {
    if (isObject(item) && String(item['@type']).includes('HowToSection')) {
      steps.push('# ' + (typeof item.name === 'string' ? item.name : '').trim());
      const inside = Array.isArray(item.itemListElement) ? item.itemListElement : [];
      for (const step of inside) steps.push(textOf(step).trim());
    } else {
      steps.push(textOf(item).trim());
    }
  }
  let servings = data.recipeYield;
  if (Array.isArray(servings)) servings = servings[0];
  const amount = /\d+(?:\.\d+)?/.exec(String(servings || ''));
  let keywords = data.keywords || [];
  if (typeof keywords === 'string') keywords = keywords.split(',');
  const ingredients = Array.isArray(data.recipeIngredient) ? data.recipeIngredient : [];
  return {
    title: cut(String(data.name), 200),
    description: textOf(data.description) || null,
    servings: amount && Number(amount[0]) > 0 ? Number(amount[0]) : null,
    prep_minutes: minutes(data.prepTime),
    cook_minutes: minutes(data.cookTime),
    source_url: typeof data.url === 'string' ? data.url : null,
    ingredients_text: ingredients.map((i) => String(i).trim()).filter(Boolean).join('\n'),
    steps_text: steps.filter((s) => s && s !== '#').join('\n\n'),
    tags: (Array.isArray(keywords) ? keywords : [])
      .filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      .map((k) => k.trim())
      .slice(0, 20),
    original_text: JSON.stringify(data, null, 2),
  };
}

/** What was pasted, as recipes: schema.org JSON (one recipe or a list), or plain text. */
export function readImport(text: string): RecipeInput[] {
  if (text.length > TEXT_LIMIT * 10) throw new Problem(400, "That's too much to import at once");
  const stripped = text.trim();
  if (!stripped.startsWith('{') && !stripped.startsWith('[')) return [readPasted(text)];
  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch {
    throw new Problem(400, "That looks like a data file, but it couldn't be read.");
  }
  const several = Array.isArray(data) && data.length > 0 && data.every((d) => isObject(d) && d.name);
  return (several ? (data as unknown[]) : [data]).map(readSchemaOrg);
}

// ---------- giving recipes back ----------

type Step = { '@type': 'HowToStep'; text: string };
type Section = { '@type': 'HowToSection'; name: string; itemListElement: Step[] };

/** A recipe as schema.org Recipe JSON, the way the Nextcloud Cookbook app keeps it (recipe.json). */
export function toSchemaOrg(r: Recipe): Json {
  const duration = (m: number | null) => (m ? `PT${Math.floor(m / 60)}H${m % 60}M` : '');
  const instructions: (Step | Section)[] = [];
  let section: Section | null = null;
  for (const step of r.steps) {
    if (step.is_heading) {
      section = { '@type': 'HowToSection', name: step.text, itemListElement: [] };
      instructions.push(section);
    } else if (section) {
      section.itemListElement.push({ '@type': 'HowToStep', text: step.text });
    } else {
      instructions.push({ '@type': 'HowToStep', text: step.text });
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.title,
    description: r.description || '',
    recipeYield: r.servings || '',
    prepTime: duration(r.prep_minutes),
    cookTime: duration(r.cook_minutes),
    url: r.source_url || '',
    // Section headings among the ingredients are kept as lines of their own, written as they were.
    recipeIngredient: r.ingredients.map((line) => (line.is_heading ? '# ' + line.text : line.text)),
    recipeInstructions: instructions,
    keywords: r.tags.join(','),
    dateCreated: r.created_at,
    dateModified: r.updated_at,
  };
}

/** A folder name for a recipe that every computer accepts, different from the ones already used. */
export function folderName(title: string, used: Set<string>): string {
  // eslint-disable-next-line no-control-regex
  const folder = cut(title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, ''), 100) || 'Recipe';
  let name = folder;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${folder} (${n})`;
  used.add(name.toLowerCase());
  return name;
}
