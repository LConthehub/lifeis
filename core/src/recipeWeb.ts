/**
 * A recipe from a web page a person names.
 *
 * Most recipe sites publish each recipe twice: once to read, and once in a standard form meant for search
 * engines (schema.org "Recipe", inside the page as JSON). Life Is reads that second form, so it gets the
 * ingredients and steps exactly as the site gives them, with none of the page's story or adverts, and
 * without guessing. A page that doesn't publish it is refused in words, and the person can paste the text.
 *
 * This reaches outside, but only when asked and only to the one address given: Life Is fetches that page, as
 * a browser would, and nothing about the person or their kitchen is sent with the request. What comes back is
 * a draft for the person to look over; nothing is saved here.
 */
import type { Fetcher } from './connections.ts';
import type { RecipeInput } from './kitchenTypes.ts';
import { Problem } from './problem.ts';
import { readSchemaOrg } from './recipeText.ts';

export const RECIPE_WEB_SERVICE = {
  name: 'Recipes from a website',
  sends: 'Only when you paste an address under "Import a recipe": Life Is fetches that one page from that site, as a browser would. The site sees a request from where Life Is runs, ' +
    'and nothing about you or your recipes is sent. Nothing is fetched at any other time.',
};

const MAX_PAGE = 5_000_000;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', eacute: 'é', egrave: 'è', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×' };

/** Text as a person reads it: without the page's tags, and with its coded letters (&amp;, &#39;) turned back. */
export function plain(text: string): string {
  return text
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]{0,2000}>/g, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,10});/gi, (whole, code: string) => {
      if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
      const point = code[1]!.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const typeOf = (value: Record<string, unknown>) => (Array.isArray(value['@type']) ? value['@type'].map(String) : [String(value['@type'])]);

/** The first Recipe anywhere inside what a page published: on its own, in a list, or inside a "@graph". */
function findRecipe(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findRecipe(item, depth + 1); if (found) return found; }
    return null;
  }
  if (!isObject(value)) return null;
  if (typeOf(value).includes('Recipe') && value.name) return value;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const found = findRecipe(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const NOT_PUBLISHED = "That page doesn't give its recipe in the form Life Is can read. Copy the recipe's text from the page and paste it in instead.";

/** The recipe a page's own text holds, as a draft. `address` is where the page came from. */
export function recipeFromPage(html: string, address: string): RecipeInput {
  let found: Record<string, unknown> | null = null;
  for (const block of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      found = findRecipe(JSON.parse(block[1]!.trim()));
    } catch {
      // A block that isn't valid JSON is passed over; a page may have several.
    }
    if (found) break;
  }
  if (!found) throw new Problem(400, NOT_PUBLISHED);
  const read = readSchemaOrg({ ...found, '@type': 'Recipe' });
  const lines = (text: string | null | undefined) => (text ?? '').split('\n').map((line) => plain(line)).filter((line, i, all) => line || (i > 0 && all[i - 1])).join('\n').trim();
  if (!read.ingredients_text && !read.steps_text) throw new Problem(400, NOT_PUBLISHED);
  return {
    ...read,
    title: plain(read.title),
    description: read.description ? plain(read.description) : null,
    ingredients_text: lines(read.ingredients_text),
    steps_text: (read.steps_text ?? '').split('\n\n').map((step) => plain(step)).filter(Boolean).join('\n\n'),
    tags: (read.tags ?? []).map((tag) => plain(tag)).filter(Boolean),
    source_url: address,
  };
}

/** The address, checked: a web page, with no name or password in it. */
function pageAddress(given: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(given.trim()) ? given.trim() : `https://${given.trim()}`);
  } catch {
    throw new Problem(400, "That isn't a web address. It looks like https://example.com/a-recipe");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Problem(400, "That web address needs to start with https://.");
  if (url.username || url.password) throw new Problem(400, 'Leave any name and password out of the address');
  return url.href;
}

/** Fetches the page at an address and reads its recipe. Nothing is saved. */
export async function recipeFromWeb(fetcher: Fetcher | undefined, given: string): Promise<RecipeInput> {
  if (!fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside, so it can't fetch a page. Copy the recipe's text and paste it in instead.");
  const address = pageAddress(given);
  let html: string;
  try {
    // Said plainly what is asking; some sites only answer something that looks like a browser.
    const answer = await fetcher(address, { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0 (compatible; LifeIs recipe reader)' });
    if (answer.status === 404 || answer.status === 410) throw new Problem(400, "There's no page at that address");
    if ([401, 403, 429, 451, 503].includes(answer.status)) throw new Problem(400, "That site wouldn't give the page to Life Is (many sites turn away anything that isn't a person's browser). Copy the recipe's text from the page and paste it in instead.");
    if (answer.status !== 200) throw new Problem(400, "That site couldn't answer just now. Try again in a moment.");
    const bytes = await answer.bytes();
    if (bytes.length > MAX_PAGE) throw new Problem(400, 'That page is too large to read');
    html = new TextDecoder().decode(bytes);
  } catch (problem) {
    if (problem instanceof Problem) throw problem;
    throw new Problem(400, "Couldn't reach that address");
  }
  return recipeFromPage(html, address);
}
