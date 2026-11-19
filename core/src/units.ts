/**
 * Amounts in recipes: reading "1 1/2 cups flour, sifted", and converting between units of the same kind.
 *
 * Reading a line never changes it. The line is always kept exactly as written; this only works out the number,
 * the unit and the ingredient's name from it, so the pantry and the grocery list can be linked to it. When the
 * reading is wrong, the words are still right.
 *
 * Units of weight (g, kg, oz, lb) convert to each other, and so do units of volume (ml, l, tsp, tbsp, cup, fl oz,
 * pint, quart, gallon). Weight and volume never convert to each other: a cup of flour and a cup of honey weigh
 * different amounts. Anything else (a clove, a can, a pinch) only adds up with the same word.
 *
 * This is the same reading as backend/units.py, and must stay so while both exist: nameKey() is what links an
 * ingredient everywhere, and it is stored. tests/units.golden.json holds the Python answers this is checked against.
 */

export type UnitInfo = {
  canonical: string;
  /** "mass", "volume", or "own:<word>" for a unit that only adds up with itself. */
  kind: string;
  /** How many of the kind's base unit (grams or millilitres) one of this is. */
  factor: number;
};

export type ParsedLine = { quantity: number | null; unit: string | null; name: string; note: string | null };

const TABLE = new Map<string, UnitInfo>();
const unit = (canonical: string, kind: string, factor: number, ...aliases: string[]) => {
  for (const alias of [canonical, ...aliases]) TABLE.set(alias, { canonical, kind, factor });
};
unit('g', 'mass', 1, 'gram', 'grams', 'gr');
unit('kg', 'mass', 1000, 'kilogram', 'kilograms', 'kgs');
unit('oz', 'mass', 28.3495, 'ounce', 'ounces');
unit('lb', 'mass', 453.592, 'lbs', 'pound', 'pounds');
unit('ml', 'volume', 1, 'milliliter', 'milliliters', 'millilitre', 'millilitres');
unit('l', 'volume', 1000, 'liter', 'liters', 'litre', 'litres');
unit('tsp', 'volume', 4.92892, 'teaspoon', 'teaspoons', 't');
unit('tbsp', 'volume', 14.7868, 'tablespoon', 'tablespoons', 'tbs', 'tbl');
unit('cup', 'volume', 236.588, 'cups', 'c');
unit('fl oz', 'volume', 29.5735, 'floz', 'fluid ounce', 'fluid ounces');
unit('pint', 'volume', 473.176, 'pints', 'pt');
unit('quart', 'volume', 946.353, 'quarts', 'qt');
unit('gallon', 'volume', 3785.41, 'gallons', 'gal');

// Words that are units of their own: they only add up with the same word.
const OWN = new Map<string, string>([
  ['clove', 'clove'], ['cloves', 'clove'], ['can', 'can'], ['cans', 'can'], ['tin', 'tin'], ['tins', 'tin'],
  ['jar', 'jar'], ['jars', 'jar'], ['pinch', 'pinch'], ['pinches', 'pinch'], ['dash', 'dash'], ['dashes', 'dash'],
  ['slice', 'slice'], ['slices', 'slice'], ['stick', 'stick'], ['sticks', 'stick'], ['sprig', 'sprig'],
  ['sprigs', 'sprig'], ['bunch', 'bunch'], ['bunches', 'bunch'], ['head', 'head'], ['heads', 'head'],
  ['package', 'package'], ['packages', 'package'], ['pkg', 'package'], ['packet', 'packet'], ['packets', 'packet'],
  ['bag', 'bag'], ['bags', 'bag'], ['box', 'box'], ['boxes', 'box'], ['handful', 'handful'], ['handfuls', 'handful'],
  ['piece', 'piece'], ['pieces', 'piece'], ['stalk', 'stalk'], ['stalks', 'stalk'], ['leaf', 'leaf'], ['leaves', 'leaf'],
]);

const FRACTIONS = new Map<string, number>([
  ['½', 0.5], ['⅓', 1 / 3], ['⅔', 2 / 3], ['¼', 0.25], ['¾', 0.75], ['⅕', 0.2], ['⅖', 0.4], ['⅗', 0.6], ['⅘', 0.8],
  ['⅙', 1 / 6], ['⅚', 5 / 6], ['⅛', 0.125], ['⅜', 0.375], ['⅝', 0.625], ['⅞', 0.875],
]);

const F = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const NUMBER = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?\\s*[${F}]|\\d+(?:[.,]\\d+)?|[${F}])`;
const AMOUNT = new RegExp(`^\\s*(?<a>${NUMBER})(?:\\s*(?:-|–|to)\\s*(?<b>${NUMBER}))?\\s*`);

// The unit words a line is tried against, longest first, so "fl oz" is found before "oz" and "cups" before "c".
const CANDIDATES = [...TABLE.keys(), ...OWN.keys()]
  .sort((x, y) => y.length - x.length)
  .map((word) => ({ word, starts: new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?(?=\\s|$|,)`) }));

/** The number in "1 1/2", "½", "1½", "2,5". Throws on a fraction over zero. */
function number(text: string): number {
  let total = 0;
  for (const part of text.trim().replace(',', '.').split(/\s+/).filter(Boolean)) {
    if (part.includes('/')) {
      const [top, bottom] = part.split('/');
      if (Number(bottom) === 0) throw new RangeError('a fraction over zero');
      total += Number(top) / Number(bottom);
    } else {
      const last = part.slice(-1);
      const fraction = FRACTIONS.get(last);
      if (fraction !== undefined) {
        const head = part.slice(0, -1);
        total += (head ? Number(head) : 0) + fraction;
      } else {
        total += Number(part);
      }
    }
  }
  return total;
}

/** What a unit is, or null for no unit. A unit of its own is its own kind. */
export function unitInfo(unitName: string | null | undefined): UnitInfo | null {
  if (!unitName) return null;
  const u = unitName.trim().toLowerCase().replace(/\.+$/, '');
  const known = TABLE.get(u);
  if (known) return known;
  const own = OWN.get(u) ?? u;
  return { canonical: own, kind: `own:${own}`, factor: 1 };
}

export function canonical(unitName: string | null | undefined): string | null {
  return unitInfo(unitName)?.canonical ?? null;
}

export function kindOf(unitName: string | null | undefined): string {
  return unitInfo(unitName)?.kind ?? 'count';
}

/** The same amount in another unit, or null when the two can't be compared. */
export function convert(quantity: number, fromUnit: string | null | undefined, toUnit: string | null | undefined): number | null {
  const a = unitInfo(fromUnit);
  const b = unitInfo(toUnit);
  if (a === null && b === null) return quantity;
  if (a === null || b === null || a.kind !== b.kind) return null;
  return (quantity * a.factor) / b.factor;
}

export function toBase(quantity: number, unitName: string | null | undefined): number {
  const info = unitInfo(unitName);
  return info ? quantity * info.factor : quantity;
}

export function fromBase(quantity: number, unitName: string | null | undefined): number {
  const info = unitInfo(unitName);
  return info ? quantity / info.factor : quantity;
}

/** The form of an ingredient's name used to match it everywhere: "Tomatoes" and "tomato" are the same thing. */
export function nameKey(name: string): string {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return '';
  let last = words[words.length - 1]!;
  if (last.length > 4 && last.endsWith('ies')) last = last.slice(0, -3) + 'y';
  else if (last.length > 4 && last.endsWith('oes')) last = last.slice(0, -2);
  else if (last.length > 3 && last.endsWith('s') && !/(ss|us|is)$/.test(last)) last = last.slice(0, -1);
  return [...words.slice(0, -1), last].join(' ');
}

/**
 * The amount, unit, name and note read from an ingredient line. Anything not understood is left out:
 * "Salt to taste" has no quantity and the name "Salt".
 */
export function parseLine(line: string): ParsedLine {
  let rest = line.trim();
  let quantity: number | null = null;
  const m = AMOUNT.exec(rest);
  if (m?.groups) {
    try {
      // A range ("2-3 cloves") shops for the larger amount.
      const a = number(m.groups.a!);
      quantity = m.groups.b ? Math.max(a, number(m.groups.b)) : a;
      rest = rest.slice(m[0].length);
    } catch {
      quantity = null;
    }
  }
  let unitName: string | null = null;
  if (quantity !== null) {
    // A size in brackets after the number ("1 (14 oz) can tomatoes") belongs to the note.
    const size = /^\(([^)]*)\)\s*/.exec(rest);
    const bracket = size ? size[1]! : null;
    if (size) rest = rest.slice(size[0].length);
    const lowered = rest.toLowerCase();
    for (const { word, starts } of CANDIDATES) {
      if (starts.test(lowered)) {
        unitName = canonical(word);
        rest = rest.slice(word.length).replace(/^[. ]+/, '');
        break;
      }
    }
    if (bracket) rest = `${rest} (${bracket})`;
  }
  rest = rest.trim().replace(/^of\s+/i, '');
  const comma = rest.indexOf(',');
  let name = comma === -1 ? rest : rest.slice(0, comma);
  let note = comma === -1 ? '' : rest.slice(comma + 1);
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  for (const tail of [' to taste', ' as needed', ' for serving', ' for garnish', ' optional']) {
    if (name.toLowerCase().endsWith(tail)) {
      note = (tail.trim() + (note ? ', ' + note : '')).trim();
      name = name.slice(0, -tail.length).trim();
    }
  }
  return { quantity, unit: unitName, name, note: note.trim() || null };
}

/** Two decimal places, with an exact half going to the even digit, as Python's does (0.625 -> "0.62"). */
function twoPlaces(quantity: number): string {
  const hundredths = quantity * 100;
  const floor = Math.floor(hundredths);
  if (hundredths - floor !== 0.5) return quantity.toFixed(2);
  return ((floor % 2 === 0 ? floor : floor + 1) / 100).toFixed(2);
}

/** A friendly number: 1.5 -> "1 1/2", 0.333 -> "1/3", 2.0 -> "2". */
export function nice(quantity: number | null | undefined): string {
  if (quantity === null || quantity === undefined) return '';
  const whole = Math.trunc(quantity);
  const rest = quantity - whole;
  const friendly: [string, number][] = [['1/8', 0.125], ['1/4', 0.25], ['1/3', 1 / 3], ['1/2', 0.5], ['2/3', 2 / 3], ['3/4', 0.75]];
  for (const [text, value] of friendly) {
    if (Math.abs(rest - value) < 0.02) return whole ? `${whole} ${text}` : text;
  }
  if (rest < 0.02) return String(whole);
  if (rest > 0.98) return String(whole + 1);
  return twoPlaces(quantity).replace(/0+$/, '').replace(/\.$/, '');
}

const PLURAL = new Map<string, string>([
  ['clove', 'cloves'], ['can', 'cans'], ['tin', 'tins'], ['jar', 'jars'], ['pinch', 'pinches'], ['dash', 'dashes'],
  ['slice', 'slices'], ['stick', 'sticks'], ['sprig', 'sprigs'], ['bunch', 'bunches'], ['head', 'heads'],
  ['package', 'packages'], ['packet', 'packets'], ['bag', 'bags'], ['box', 'boxes'], ['handful', 'handfuls'],
  ['piece', 'pieces'], ['stalk', 'stalks'], ['leaf', 'leaves'], ['cup', 'cups'],
]);

/** "2 cans", "1 1/2 cups", "500 g", "3" */
export function amount(quantity: number | null | undefined, unitName: string | null | undefined): string {
  if (quantity === null || quantity === undefined) return '';
  const shown = unitName && quantity > 1.02 ? (PLURAL.get(unitName) ?? unitName) : unitName;
  return `${nice(quantity)}${shown ? ' ' + shown : ''}`;
}
