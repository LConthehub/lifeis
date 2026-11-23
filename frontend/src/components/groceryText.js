/**
 * The grocery list as plain text, to send in a message or paste into a note.
 *
 * One pure function, so the page and its tests share the very same words. It reads only what the list page
 * already has (each line's label, amount, aisle, usual size and usual store) and writes nothing but those:
 * no prices, no coupons, no store account, nothing about the household.
 */

/** What a line is called when nothing says where it is bought. */
export const ANY_STORE = 'Any store';

/** One line of text from whatever was typed: no line breaks, no stray spaces, no control characters. */
const tidy = (s) => {
  let out = '';
  for (const ch of String(s ?? '')) {
    const code = ch.codePointAt(0);
    out += code < 32 || code === 127 || code === 8232 || code === 8233 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
};

const things = (n) => `${n} thing${n === 1 ? '' : 's'}`;

/** The store a line is usually bought at, or "Any store". */
export const storeOf = (line) => tidy(line?.likely_store) || ANY_STORE;

/**
 * Whether "just this store" means anything: a store is set and something on the list is bought there.
 * `lines` is the shopping list's per-line facts, `items` the grocery lines.
 */
export function canNarrowToStore(items, lines, store) {
  const here = tidy(store).toLowerCase();
  if (!here) return false;
  return items.some((g) => !g.done && storeOf(lines.find((l) => l.id === g.id)).toLowerCase() === here);
}

/**
 * @param {object} given
 * @param {Array} given.items grocery lines: { id, label, amount, done, aisle }
 * @param {Array} given.lines per-line facts: { id, likely_store, usual_size }
 * @param {string|null} [given.store] the store the person is at
 * @param {'aisle'|'store'|'none'} [given.group] how the lines are grouped
 * @param {boolean} [given.justHere] only what is bought at `store`, and what can be got anywhere
 * @param {boolean} [given.includeBought] also list what is already in the buggy
 * @param {boolean} [given.boxes] "[ ] " rather than "- " in front of each line
 */
export function groceryText({ items, lines = [], store = null, group = 'aisle', justHere = false, includeBought = false, boxes = false }) {
  const here = tidy(store).toLowerCase();
  const factsOf = (g) => lines.find((l) => l.id === g.id);
  const narrow = justHere && here !== '';
  const wanted = (g) => !narrow || [here, ANY_STORE.toLowerCase()].includes(storeOf(factsOf(g)).toLowerCase());
  const todo = items.filter((g) => !g.done && wanted(g));
  const bought = includeBought ? items.filter((g) => g.done && wanted(g)) : [];

  // "2 lb chicken thighs"; with no amount, the usual size in brackets: "coffee (30 oz)".
  const say = (g, mark) => {
    const name = tidy(g.label);
    const amount = tidy(g.amount);
    const size = tidy(factsOf(g)?.usual_size);
    return `${mark} ${amount ? `${amount} ${name}` : size ? `${name} (${size})` : name}`;
  };
  const mark = (done) => (boxes ? (done ? '[x]' : '[ ]') : '-');

  const named = narrow ? `Groceries for ${tidy(store)}` : 'Groceries';
  const count = todo.length === 0 ? 'nothing to get' : things(todo.length);
  const head = `${named} (${count}${bought.length ? `, ${bought.length} in the buggy` : ''})`;
  if (todo.length === 0 && bought.length === 0) return head;

  const headingOf = (g) => (group === 'store' ? storeOf(factsOf(g)) : tidy(g.aisle) || 'Everything else');
  const blocks = [];
  if (group === 'none') {
    if (todo.length) blocks.push(todo.map((g) => say(g, mark(false))).join('\n'));
  } else {
    // Aisles keep the order the list has them. Stores: where you are first, "Any store" last, the rest A to Z.
    const names = [...new Set(todo.map(headingOf))];
    if (group === 'store') {
      names.sort((a, b) => (b.toLowerCase() === here) - (a.toLowerCase() === here) || (a === ANY_STORE) - (b === ANY_STORE) || a.localeCompare(b));
    }
    for (const name of names) blocks.push([name, ...todo.filter((g) => headingOf(g) === name).map((g) => say(g, mark(false)))].join('\n'));
  }
  if (bought.length) blocks.push(['In the buggy', ...bought.map((g) => say(g, mark(true)))].join('\n'));
  return [head, ...blocks].join('\n\n');
}
