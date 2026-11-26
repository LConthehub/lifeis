import { expect, it } from 'vitest';
import { Problem } from '../src/problem.ts';
import { minutes, readPasted, readSchemaOrg, splitLines } from '../src/recipeText.ts';
import golden from './recipeText.golden.json';

// The answers the first, Python version gave (written once into recipeText.golden.json; that version is in git history).

/** What reading gave, or the words of the problem it raised. */
function answer<T>(read: () => T): T | { problem: string } {
  try {
    return read();
  } catch (problem) {
    if (problem instanceof Problem) return { problem: problem.message };
    throw problem;
  }
}

/** The original is kept as JSON text; Python and JavaScript space it alike but write 2.0 and 2 differently. */
function comparable(recipe: unknown): unknown {
  const r = recipe as { original_text?: string };
  if (typeof r.original_text === 'string' && r.original_text.trim().startsWith('{')) {
    return { ...r, original_text: JSON.parse(r.original_text) };
  }
  return recipe;
}

it('ingredients split into lines and headings as backend/kitchen.py splits them', () => {
  for (const [text, lines] of golden.ingredients as [string, unknown][]) {
    expect(splitLines(text, 'ingredients'), JSON.stringify(text)).toEqual(lines);
  }
});

it('steps split into paragraphs and headings as backend/kitchen.py splits them', () => {
  for (const [text, lines] of golden.steps as [string, unknown][]) {
    expect(splitLines(text, 'steps'), JSON.stringify(text)).toEqual(lines);
  }
});

it('pasted text is read as backend/kitchen.py reads it', () => {
  for (const [text, recipe] of golden.pasted as [string, unknown][]) {
    expect(answer(() => readPasted(text)), JSON.stringify(text)).toEqual(recipe);
  }
});

it('schema.org recipes are read as backend/kitchen.py reads them', () => {
  for (const [data, recipe] of golden.schema as [unknown, unknown][]) {
    expect(comparable(answer(() => readSchemaOrg(data))), JSON.stringify(data)).toEqual(comparable(recipe));
  }
});

it('durations are read as backend/kitchen.py reads them', () => {
  for (const [iso, expected] of golden.minutes as [unknown, number | null][]) {
    expect(minutes(iso), String(iso)).toBe(expected);
  }
});

// A whole recipe page copied from a site, header, buttons, rating and photo credits included.
const COPIED_PAGE = [
  'SKIP TO CONTENT', 'A Food Site', '', 'Save', 'Rate', '', 'Big Sale Starts Early! Get $59 Off', '', '',
  'HOLIDAYS & OCCASIONS', 'THANKSGIVING RECIPES', 'Spatchcocked Turkey', '4.8', '(4)', '1 REVIEW',
  'Faster cook time and crispy skin.', '', 'Ingredients', '2 1/2 Tbsp. kosher salt', '1 Tbsp. smoked paprika', '',
  'Directions', 'Make spice blend:', 'Combine the salt and paprika.', '',
  'Credit: A Photographer; Food Stylist: A Stylist', 'Remove giblets and neck:', 'Dry the skin. Do not rinse.', '',
  'Credit: A Photographer', '', 'Roast turkey:', 'Bake 70 minutes at 450°F.',
].join('\n');

it('a copied recipe page is read without its header, buttons, rating or photo credits', () => {
  const read = readPasted(COPIED_PAGE);
  expect(read.title).toBe('Spatchcocked Turkey');
  expect(read.description).toBe('Faster cook time and crispy skin.');
  expect(read.ingredients_text).toBe('2 1/2 Tbsp. kosher salt\n1 Tbsp. smoked paprika');
  expect(read.steps_text).toBe('Make spice blend:\nCombine the salt and paprika.\n\nRemove giblets and neck:\nDry the skin. Do not rinse.\n\nRoast turkey:\nBake 70 minutes at 450°F.');
  expect(read.original_text).toBe(COPIED_PAGE);
});

it('a recipe typed by hand keeps a first line that looks like a page button only when it is all there is', () => {
  expect(readPasted('Save').title).toBe('Save');
  expect(readPasted('Rice\n4.8\n1 cup rice').title).toBe('Rice');
});
