/**
 * The kitchen: recipes, the week's meals, the pantry and the grocery list, all linked by one list of ingredients.
 *
 * How the pieces connect:
 * - "Flour" in a recipe, in the pantry and on the grocery list is one ingredient.
 * - The grocery list from the week's meals is what the recipes need, scaled to the servings you plan, minus
 *   what the pantry already has. Amounts in units of the same kind are added and taken away (grams and pounds,
 *   cups and spoons); amounts that can't be compared are listed in full, marked so.
 * - Ticking something off with "put away" adds it to the pantry. Marking a meal as cooked takes what it used
 *   out of the pantry.
 * - A recipe knows what it's cooked in: pans and dishes from the things you keep (inventory.ts). The week can
 *   then say when one meal needs more of something than you own.
 *
 * `kitchen(db, owner)` is one person's kitchen: everything it reads and writes is theirs. It does what
 * backend/kitchen.py does, and gives the same answers. Anything that changes several things changes all of
 * them or none (a transaction).
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { MAX_THING_PHOTO, placePaths } from './inventory.ts';
import type {
  EquipmentInput, EquipmentShortage, ExportFile, GroceryItem, Ingredient, Meal, PantryInput, PantryItem, Part, PlanInput, PlannedMeal, Recipe,
  RecipeEquipment, RecipeInput, RecipeLine, RecipeSummary,
} from './kitchenTypes.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, inOrder, labelKey, pictureType, rounded, stamp, todayOf, type Clock } from './small.ts';
import { cut, folderName, linesAsText, readImport, splitLines, TEXT_LIMIT, toSchemaOrg, type TextLine } from './recipeText.ts';
import { MAX_PASTED_GROCERIES, readGroceryList, readRecipeFile, recipeKey, type RecipeFile, type Unread } from './recipeFiles.ts';
import { barcodeKey } from './media.ts';
import { sizeOf } from './shopping.ts';
import * as units from './units.ts';

export const MEALS: readonly string[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const LOCATIONS: readonly string[] = ['fridge', 'freezer', 'pantry', 'spices', 'other'];

/** A meal as copied from one week to another: where it goes, and what it is. Never "cooked". */
type MealCopy = { day: string; meal: Meal; recipe_id: number | null; title: string | null; servings: number | null };
/** A week's meals kept under a name, by weekday (0 is the first day of the week). The recipe is kept by id and by title, so a deleted one can be named. */
type TemplateMeal = { weekday: number; meal: Meal; recipe_id: number | null; recipe_title: string | null; title: string | null; servings: number | null };
type StoredTemplate = { id: number; name: string; meals: TemplateMeal[] };
export type WeekTemplate = { id: number; name: string; meals: (TemplateMeal & { missing: boolean })[]; /** Titles of recipes that are gone. */ missing: string[] };
export type CopyResult = { added: number; /** Meals that were already there, the same, so not added twice. */ already: number; /** Days that got meals and already had something. */ days_with_meals: number; missing: string[] };
export type UseItUp = {
  /** What is within the window (or past), soonest first. */
  soon: { name: string; days_left: number }[];
  suggestions: { recipe_id: number; title: string; servings: number | null; uses: string[]; have_others: number; other_total: number }[];
};
export type PantryScan = { barcode: string; ingredient: { id: number; name: string; product: string | null; size: string } | null; in_pantry: PantryItem | null };
const WEEK_TEMPLATES = 'week_templates';
const MAX_TEMPLATES = 50;

const tagList = (tags: string | null) => (tags ?? '').split(',').filter(Boolean);

type RecipeRow = Omit<Recipe, 'tags' | 'ingredients' | 'steps' | 'equipment' | 'ingredients_text' | 'steps_text' | 'showing_servings' | 'has_photo'> & { tags: string | null; photo_added_at: string | null };
type LineRow = Omit<RecipeLine, 'is_heading' | 'scaled'> & { is_heading: number };
type PantryRow = Omit<PantryItem, 'low' | 'days_left' | 'amount'>;
type GroceryRow = Omit<GroceryItem, 'done' | 'from_plan' | 'amount'> & { done: number; from_plan: number };

export function kitchen(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);

  // ==================== INGREDIENTS ====================

  /** The ingredient with this name (made the first time it's seen), or null for an empty name. */
  async function ingredientId(q: Queries, name: string): Promise<number | null> {
    const key = units.nameKey(name);
    if (!key) return null;
    const found = await q.get<{ id: number }>('SELECT id FROM ingredients WHERE owner_id = ? AND key = ?', [owner, key]);
    if (found) return found.id;
    return (await q.run('INSERT INTO ingredients (owner_id, name, key) VALUES (?, ?, ?)', [owner, cut(name.trim(), 120), key])).lastId;
  }

  // ==================== RECIPES ====================

  async function saveLines(q: Queries, recipeId: number, ingredients: TextLine[], steps: TextLine[]) {
    await q.run('DELETE FROM recipe_lines WHERE recipe_id = ?', [recipeId]);
    const parts: [Part, TextLine[]][] = [['ingredients', ingredients], ['steps', steps]];
    for (const [part, rows] of parts) {
      for (const [i, row] of rows.entries()) {
        let quantity: number | null = null;
        let unit: string | null = null;
        let ingredient: number | null = null;
        if (part === 'ingredients' && !row.is_heading) {
          const parsed = units.parseLine(row.text);
          quantity = parsed.quantity;
          unit = parsed.unit;
          ingredient = await ingredientId(q, parsed.name);
        }
        await q.run(
          'INSERT INTO recipe_lines (recipe_id, part, is_heading, text, quantity, unit, ingredient_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [recipeId, part, row.is_heading ? 1 : 0, cut(row.text, 5000), quantity, unit, ingredient, i],
        );
      }
    }
  }

  /**
   * What a recipe is cooked in. A piece of equipment is one of the person's things, or only a name. Unlike an
   * ingredient it isn't used up, and it doesn't grow with the servings: a doubled stew may still fit one pot.
   */
  async function saveEquipment(q: Queries, recipeId: number, list: EquipmentInput[]) {
    if (list.length > 40) throw new Problem(400, 'A recipe can list up to 40 pieces of equipment');
    await q.run('DELETE FROM recipe_equipment WHERE recipe_id = ?', [recipeId]);
    for (const [i, one] of list.entries()) {
      const quantity = one.quantity ?? 1;
      if (!(quantity > 0 && quantity <= 1000)) throw new Problem(400, 'How many is a number above 0');
      let label = clean(one.label, 200);
      if (one.item_id != null) {
        const item = await q.get<{ name: string }>('SELECT name FROM items WHERE id = ? AND owner_id = ?', [one.item_id, owner]);
        if (!item) throw new Problem(404, "That isn't one of your things");
        label = item.name;
      }
      if (!label) throw new Problem(400, 'Choose one of your things, or say what it is');
      await q.run('INSERT INTO recipe_equipment (recipe_id, item_id, label, quantity, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [recipeId, one.item_id ?? null, label, quantity, clean(one.note, 500), i]);
    }
  }

  async function equipmentOf(q: Queries, recipeId: number): Promise<RecipeEquipment[]> {
    const rows = await q.all<{ id: number; item_id: number | null; label: string; quantity: number; note: string | null;
      item_name: string | null; item_quantity: number | null; item_place: number | null; item_there: number | null }>(
      `SELECT e.id, e.item_id, e.label, e.quantity, e.note, i.name AS item_name, i.quantity AS item_quantity, i.place_id AS item_place, i.id AS item_there
       FROM recipe_equipment e LEFT JOIN items i ON i.id = e.item_id AND i.owner_id = ? WHERE e.recipe_id = ? ORDER BY e.sort_order, e.id`, [owner, recipeId]);
    const paths = rows.some((r) => r.item_place !== null) ? placePaths(await q.all('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner])) : new Map<number, string>();
    return rows.map((r) => ({
      id: r.id, item_id: r.item_there, label: r.item_name ?? r.label, quantity: r.quantity, note: r.note,
      have: r.item_there === null ? null : (r.item_quantity ?? 1),
      place: r.item_place !== null ? (paths.get(r.item_place) ?? null) : null,
    }));
  }

  async function readRecipe(q: Queries, id: number, servings?: number | null): Promise<Recipe> {
    const row = await q.get<RecipeRow>('SELECT r.*, (SELECT p.added_at FROM recipe_photos p WHERE p.recipe_id = r.id) AS photo_added_at FROM recipes r WHERE r.id = ? AND r.owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Recipe not found');
    const rows = await q.all<LineRow>(
      `SELECT l.*, i.name AS ingredient FROM recipe_lines l LEFT JOIN ingredients i ON i.id = l.ingredient_id
       WHERE l.recipe_id = ? ORDER BY l.part, l.sort_order`, [id]);
    const factor = servings && row.servings ? servings / row.servings : 1;
    const lines: RecipeLine[] = rows.map((line) => ({
      ...line,
      is_heading: Boolean(line.is_heading),
      // Scaling shows a new amount next to the line; the line itself never changes.
      scaled: factor !== 1 && line.quantity !== null ? units.amount(line.quantity * factor, line.unit) : null,
    }));
    return {
      ...row,
      has_photo: row.photo_added_at !== null,
      ingredients: lines.filter((line) => line.part === 'ingredients'),
      steps: lines.filter((line) => line.part === 'steps'),
      equipment: await equipmentOf(q, id),
      ingredients_text: linesAsText(lines, 'ingredients'),
      steps_text: linesAsText(lines, 'steps'),
      showing_servings: servings || row.servings,
      tags: tagList(row.tags),
    };
  }

  /** The recipe's own columns, checked, in the order the SQL below names them. */
  function recipeValues(body: RecipeInput): (string | number | null)[] {
    const title = clean(body.title, 200);
    if (!title) throw new Problem(400, 'Give the recipe a name');
    if (body.servings != null && !(body.servings > 0 && body.servings <= 1000)) throw new Problem(400, 'Servings is a number above 0');
    for (const time of [body.prep_minutes, body.cook_minutes]) {
      if (time != null && !(time >= 0 && time <= 100_000)) throw new Problem(400, 'Times are in minutes');
    }
    for (const text of [body.ingredients_text, body.steps_text, body.original_text, body.notes]) {
      if (text && text.length > TEXT_LIMIT) throw new Problem(400, 'That recipe is too long');
    }
    const tags = new Set((body.tags ?? []).filter((t) => t.trim()).map((t) => cut(t.trim().toLowerCase(), 40)));
    return [
      title, clean(body.description, 5000), body.servings ?? null, body.prep_minutes ?? null, body.cook_minutes ?? null,
      clean(body.source_url, 1000), body.original_text || null, body.notes?.trim() || null,
      cut([...tags].sort().join(','), 500) || null,
    ];
  }

  async function createIn(q: Queries, body: RecipeInput): Promise<number> {
    const made = await q.run(
      `INSERT INTO recipes (title, description, servings, prep_minutes, cook_minutes, source_url, original_text, notes, tags,
       owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...recipeValues(body), owner, now(), now()]);
    await saveLines(q, made.lastId, splitLines(body.ingredients_text, 'ingredients'), splitLines(body.steps_text, 'steps'));
    await saveEquipment(q, made.lastId, body.equipment ?? []);
    return made.lastId;
  }

  /** A picture Life Is can keep: a real JPEG, PNG or WebP (by its bytes, not its name), no larger than a thing's photo. */
  const picturable = (bytes: Uint8Array) => bytes.length <= MAX_THING_PHOTO && pictureType(bytes) !== null;

  async function keepPhoto(q: Queries, recipeId: number, bytes: Uint8Array) {
    await q.run(
      'INSERT INTO recipe_photos (recipe_id, type, bytes, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(recipe_id) DO UPDATE SET type = excluded.type, bytes = excluded.bytes, added_at = excluded.added_at',
      [recipeId, pictureType(bytes)!, bytes, now()]);
  }

  // ==================== PANTRY ====================

  async function pantryRows(q: Queries): Promise<PantryItem[]> {
    const day = dayNumber(today());
    const rows = await q.all<PantryRow>(
      `SELECT p.*, i.name, i.aisle FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id
       WHERE p.owner_id = ? ORDER BY i.name COLLATE NOCASE`, [owner]);
    return rows.map((row) => ({
      ...row,
      low: row.low_at !== null && row.quantity !== null && row.quantity <= row.low_at,
      days_left: row.expires_on ? dayNumber(row.expires_on) - day : null,
      amount: row.quantity !== null ? units.amount(row.quantity, row.unit) : 'some',
    }));
  }

  /** Put something away: add it to what's there, in the pantry's own unit when the two compare. */
  async function addToPantry(q: Queries, ingredient: number, quantity: number | null, unitName: string | null) {
    const row = await q.get<PantryRow>('SELECT * FROM pantry WHERE owner_id = ? AND ingredient_id = ?', [owner, ingredient]);
    const unit = units.canonical(unitName);
    if (!row) {
      await q.run('INSERT INTO pantry (owner_id, ingredient_id, quantity, unit, updated_at) VALUES (?, ?, ?, ?, ?)',
        [owner, ingredient, quantity, unit, now()]);
      return;
    }
    let next: [number | null, string | null];
    if (quantity === null) {
      next = [row.quantity, row.unit]; // bought "some": what's known stays
    } else if (row.quantity === null) {
      next = [quantity, unit]; // had "some", now at least this much
    } else {
      const same = units.convert(quantity, unit, row.unit);
      next = same !== null ? [row.quantity + same, row.unit] : [quantity, unit];
    }
    await q.run('UPDATE pantry SET quantity = ?, unit = ?, updated_at = ? WHERE id = ?', [...next, now(), row.id]);
  }

  /** Use something up. Says whether the pantry knew enough to take it away (an amount in a comparable unit). */
  async function takeFromPantry(q: Queries, ingredient: number, quantity: number | null, unit: string | null): Promise<boolean> {
    const row = await q.get<PantryRow>('SELECT * FROM pantry WHERE owner_id = ? AND ingredient_id = ?', [owner, ingredient]);
    if (!row || quantity === null || row.quantity === null) return false;
    const same = units.convert(quantity, unit, row.unit);
    if (same === null) return false;
    await q.run('UPDATE pantry SET quantity = ?, updated_at = ? WHERE id = ?',
      [Math.max(0, rounded(row.quantity - same, 4)), now(), row.id]);
    return true;
  }

  // ==================== THE WEEK'S MEALS ====================

  function planRows(q: Queries, start: string, end: string): Promise<PlannedMeal[]> {
    return q.all<PlannedMeal>(
      `SELECT m.*, r.title AS recipe_title, r.servings AS recipe_servings FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
       WHERE m.owner_id = ? AND m.day >= ? AND m.day <= ?
       ORDER BY m.day, CASE m.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, m.id`,
      [owner, start, end]);
  }

  const factorOf = (meal: { servings: number | null; recipe_servings: number | null }) =>
    meal.servings && meal.recipe_servings ? meal.servings / meal.recipe_servings : 1;

  /** What a recipe uses, for the servings planned: each understood ingredient line. */
  async function neededLines(q: Queries, recipeId: number, factor: number) {
    const rows = await q.all<{ ingredient_id: number; quantity: number | null; unit: string | null }>(
      `SELECT ingredient_id, quantity, unit FROM recipe_lines WHERE recipe_id = ? AND part = 'ingredients'
       AND is_heading = 0 AND ingredient_id IS NOT NULL`, [recipeId]);
    return rows.map((line) => ({ ...line, quantity: line.quantity !== null ? line.quantity * factor : null }));
  }

  // ==================== THE GROCERY LIST ====================

  /**
   * What the meals planned between start and end need, minus the pantry.
   *
   * For each ingredient the amounts are added up by kind (weight, volume, a unit of its own, or a count). The
   * pantry's amount is taken off where its unit compares. Gives the lines to buy, and the ingredients the
   * pantry has "some" of (no amount), which are left off the list but named, so you can check the cupboard.
   */
  async function shoppingNeeds(q: Queries, start: string, end: string) {
    type Slot = { ingredient: number; kind: string; base: number; unit: string | null; some: boolean };
    const need = new Map<string, Slot>();
    for (const meal of await planRows(q, start, end)) {
      if (!meal.recipe_id || meal.cooked_on) continue;
      for (const line of await neededLines(q, meal.recipe_id, factorOf(meal))) {
        const kind = units.kindOf(line.unit);
        const key = `${line.ingredient_id}|${kind}`;
        let slot = need.get(key);
        if (!slot) {
          slot = { ingredient: line.ingredient_id, kind, base: 0, unit: units.canonical(line.unit), some: false };
          need.set(key, slot);
        }
        if (line.quantity === null) slot.some = true;
        else slot.base += units.toBase(line.quantity, line.unit);
      }
    }
    type Buy = { ingredient_id: number; label: string; aisle: string | null; quantity: number | null; unit: string | null; note: string | null };
    const buy: Buy[] = [];
    const check = new Set<string>();
    for (const slot of need.values()) {
      const ingredient = (await q.get<{ name: string; aisle: string | null }>('SELECT name, aisle FROM ingredients WHERE id = ?', [slot.ingredient]))!;
      const have = await q.get<{ quantity: number | null; unit: string | null }>(
        'SELECT quantity, unit FROM pantry WHERE owner_id = ? AND ingredient_id = ?', [owner, slot.ingredient]);
      let base = slot.base;
      let note: string | null = null;
      if (have) {
        if (have.quantity === null) {
          // "I have some": not bought, but named, so the cupboard gets a look.
          check.add(ingredient.name);
          continue;
        }
        if (slot.base === 0 && have.quantity > 0) continue; // only "salt to taste" needed, and there's salt
        if (units.kindOf(have.unit) === slot.kind) {
          base -= units.toBase(have.quantity, have.unit);
          if (base <= 1e-9 && !(slot.base === 0 && have.quantity === 0)) continue;
        } else if (have.quantity > 0) {
          note = `you have ${units.nice(have.quantity)}${have.unit ? ' ' + have.unit : ''}, in other units`;
        }
      }
      const quantity = slot.base > 0 ? rounded(units.fromBase(base, slot.unit), 3) : null;
      buy.push({ ingredient_id: slot.ingredient, label: ingredient.name, aisle: ingredient.aisle, quantity,
        unit: quantity !== null ? slot.unit : null, note });
    }
    buy.sort((a, b) => inOrder((a.aisle || '~').toLowerCase(), (b.aisle || '~').toLowerCase()) || inOrder(a.label.toLowerCase(), b.label.toLowerCase()));
    return { buy, check: [...check].sort((a, b) => inOrder(a.toLowerCase(), b.toLowerCase())) };
  }

  async function groceryRows(q: Queries): Promise<GroceryItem[]> {
    const rows = await q.all<GroceryRow>(
      `SELECT g.*, i.aisle FROM grocery g LEFT JOIN ingredients i ON i.id = g.ingredient_id
       WHERE g.owner_id = ? ORDER BY g.done, COALESCE(i.aisle, '~') COLLATE NOCASE, g.label COLLATE NOCASE`, [owner]);
    return rows.map((row) => ({ ...row, done: Boolean(row.done), from_plan: Boolean(row.from_plan), amount: units.amount(row.quantity, row.unit) }));
  }

  /** One typed grocery line, read: "2 lb chicken thighs" is an amount, a unit and a name, as in a recipe. */
  function groceryLine(body: { label: string; quantity?: number | null; unit?: string | null }) {
    const text = clean(body.label, 200);
    if (!text) throw new Problem(400, 'Say what to buy');
    const parsed = units.parseLine(text);
    return {
      parsed, name: parsed.name || text,
      quantity: body.quantity ?? parsed.quantity,
      unit: body.unit ? units.canonical(body.unit) : parsed.unit,
    };
  }

  /** Put one read line on the list: the one place a grocery line is made. */
  async function putOnList(q: Queries, line: ReturnType<typeof groceryLine>, ingredient: number | null) {
    await q.run('INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [owner, ingredient, cut(line.name, 200), line.quantity, line.unit, line.parsed.note, now()]);
  }

  /** The things on the list not yet bought, by the ingredient's name, as the list tells "already there". */
  async function openOnList(q: Queries): Promise<Set<string>> {
    const rows = await q.all<{ key: string }>(
      'SELECT i.key FROM grocery g JOIN ingredients i ON i.id = g.ingredient_id WHERE g.owner_id = ? AND g.done = 0', [owner]);
    return new Set(rows.map((row) => row.key));
  }

  /** Recipes already kept, by name and first ingredient (recipeFiles.ts says why those two). */
  async function keptRecipeKeys(q: Queries): Promise<Set<string>> {
    const rows = await q.all<{ title: string; first: string | null }>(
      `SELECT r.title, (SELECT l.text FROM recipe_lines l WHERE l.recipe_id = r.id AND l.part = 'ingredients' AND l.is_heading = 0
        ORDER BY l.sort_order LIMIT 1) AS first FROM recipes r WHERE r.owner_id = ?`, [owner]);
    return new Set(rows.map((row) => recipeKey(row.title, row.first)));
  }

  /** Each recipe read from a file that Life Is can keep, and each that it can't, with why. */
  function recipesFromFile(file: RecipeFile) {
    const read = readRecipeFile(file);
    const failed: Unread[] = [...read.failed];
    const recipes: { name: string; input: RecipeInput; key: string; photo: Uint8Array | null; pictured: boolean }[] = [];
    for (const one of read.recipes) {
      try {
        recipeValues(one.input); // the checks saving makes, so a recipe that would be refused is named now
        recipes.push({ ...one, key: recipeKey(one.input.title, one.input.ingredients_text) });
      } catch (problem) {
        failed.push({ name: one.name, why: problem instanceof Problem ? problem.message : "It couldn't be read" });
      }
    }
    return { recipes, failed };
  }

  // ---------- week copies and templates ----------

  const mealKey = (m: { day: string; meal: string; recipe_id: number | null; title: string | null }) =>
    `${m.day}|${m.meal}|${m.recipe_id ?? `t:${(m.title ?? '').trim().toLowerCase()}`}`;

  /** Add meals beside what's there. A meal already there the same (day, meal, recipe or title) isn't added twice. */
  async function putMeals(tx: Queries, items: MealCopy[], missing: string[]): Promise<CopyResult> {
    if (items.length === 0) return { added: 0, already: 0, days_with_meals: 0, missing };
    const days = [...new Set(items.map((i) => i.day))].sort();
    const there = await planRows(tx, days[0]!, days[days.length - 1]!);
    const keys = new Set(there.map(mealKey));
    const busy = new Set(there.map((m) => m.day).filter((d) => days.includes(d)));
    let added = 0;
    let already = 0;
    for (const item of items) {
      if (keys.has(mealKey(item))) { already += 1; continue; }
      await tx.run('INSERT INTO meal_plan (owner_id, day, meal, recipe_id, title, servings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [owner, item.day, item.meal, item.recipe_id, item.recipe_id === null ? clean(item.title, 200) : null, item.servings, now()]);
      keys.add(mealKey(item));
      added += 1;
    }
    return { added, already, days_with_meals: busy.size, missing };
  }

  async function readTemplates(q: Queries): Promise<StoredTemplate[]> {
    const row = await q.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, WEEK_TEMPLATES]);
    try {
      const list = JSON.parse(row?.value ?? '[]') as unknown;
      return Array.isArray(list) ? list.filter((t): t is StoredTemplate => Boolean(t) && typeof t.id === 'number' && typeof t.name === 'string' && Array.isArray(t.meals)) : [];
    } catch {
      return [];
    }
  }

  async function writeTemplates(q: Queries, list: StoredTemplate[]) {
    if (list.length === 0) await q.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, WEEK_TEMPLATES]);
    else {
      await q.run('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
        [owner, WEEK_TEMPLATES, JSON.stringify(list)]);
    }
  }

  /** A template, with each recipe in it checked to still be there. */
  async function describeTemplate(q: Queries, t: StoredTemplate): Promise<WeekTemplate> {
    const ids = [...new Set(t.meals.map((m) => m.recipe_id).filter((id): id is number => id !== null))];
    const alive = new Set<number>();
    for (const id of ids) if (await q.get('SELECT id FROM recipes WHERE id = ? AND owner_id = ?', [id, owner])) alive.add(id);
    const meals = t.meals.map((m) => ({ ...m, missing: m.recipe_id !== null && !alive.has(m.recipe_id) }));
    return { id: t.id, name: t.name, meals, missing: [...new Set(meals.filter((m) => m.missing).map((m) => m.recipe_title ?? 'a recipe'))] };
  }

  async function templatesIn(q: Queries): Promise<WeekTemplate[]> {
    const out: WeekTemplate[] = [];
    for (const t of await readTemplates(q)) out.push(await describeTemplate(q, t));
    return out.sort((a, b) => inOrder(a.name.toLowerCase(), b.name.toLowerCase()));
  }

  function planWindow(start: string, days: number): [string, string] {
    if (!(Number.isInteger(days) && days >= 1 && days <= 62)) throw new Problem(400, '1 to 62 days');
    return [start, addDays(start, days - 1)];
  }

  return {
    // ---------- ingredients ----------

    listIngredients(): Promise<Ingredient[]> {
      return db.all<Ingredient>('SELECT id, name, aisle FROM ingredients WHERE owner_id = ? ORDER BY name COLLATE NOCASE', [owner]);
    },

    /** Rename an ingredient, or say which aisle it's in (the grocery list is sorted by aisle). */
    updateIngredient(id: number, body: { name?: string | null; aisle?: string | null }): Promise<Ingredient> {
      return atomic(db, async (tx) => {
        const row = await tx.get<Ingredient>('SELECT id, name, aisle FROM ingredients WHERE id = ? AND owner_id = ?', [id, owner]);
        if (!row) throw new Problem(404, 'Not found');
        const name = clean(body.name, 120) || row.name;
        const key = units.nameKey(name);
        if (await tx.get('SELECT id FROM ingredients WHERE owner_id = ? AND key = ? AND id != ?', [owner, key, id])) {
          throw new Problem(409, 'You already have an ingredient by that name');
        }
        const aisle = body.aisle != null ? clean(body.aisle, 60) : row.aisle;
        await tx.run('UPDATE ingredients SET name = ?, key = ?, aisle = ? WHERE id = ?', [name, key, aisle, id]);
        return { id, name, aisle };
      });
    },

    // ---------- recipes ----------

    async listRecipes(find: { q?: string | null; tag?: string | null } = {}): Promise<RecipeSummary[]> {
      let sql = 'SELECT id, title, description, servings, prep_minutes, cook_minutes, tags, updated_at, (SELECT p.added_at FROM recipe_photos p WHERE p.recipe_id = recipes.id) AS photo_added_at FROM recipes WHERE owner_id = ?';
      const args: Value[] = [owner];
      if (find.q) {
        sql += " AND (title LIKE ? OR id IN (SELECT recipe_id FROM recipe_lines WHERE part = 'ingredients' AND text LIKE ?))";
        args.push(`%${find.q.trim()}%`, `%${find.q.trim()}%`);
      }
      if (find.tag) {
        sql += " AND (',' || tags || ',') LIKE ?";
        args.push(`%,${find.tag.trim().toLowerCase()},%`);
      }
      const rows = await db.all<Omit<RecipeSummary, 'tags' | 'has_photo'> & { tags: string | null }>(sql + ' ORDER BY title COLLATE NOCASE', args);
      return rows.map((row) => ({ ...row, tags: tagList(row.tags), has_photo: row.photo_added_at !== null }));
    },

    /** A recipe, with amounts for other servings shown beside the lines when asked. */
    async getRecipe(id: number, servings?: number | null): Promise<Recipe> {
      if (servings != null && !(servings > 0 && servings <= 1000)) throw new Problem(400, 'Servings is a number above 0');
      return readRecipe(db, id, servings);
    },

    createRecipe(body: RecipeInput): Promise<Recipe> {
      return atomic(db, async (tx) => readRecipe(tx, await createIn(tx, body)));
    },

    updateRecipe(id: number, body: RecipeInput): Promise<Recipe> {
      return atomic(db, async (tx) => {
        const before = await readRecipe(tx, id);
        const values = recipeValues(body);
        if (values[6] === null) values[6] = before.original_text; // editing never throws away the original
        await tx.run(
          `UPDATE recipes SET title = ?, description = ?, servings = ?, prep_minutes = ?, cook_minutes = ?, source_url = ?,
           original_text = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?`, [...values, now(), id]);
        await saveLines(tx, id, splitLines(body.ingredients_text, 'ingredients'), splitLines(body.steps_text, 'steps'));
        if (body.equipment !== undefined) await saveEquipment(tx, id, body.equipment);
        return readRecipe(tx, id);
      });
    },

    async deleteRecipe(id: number): Promise<void> {
      await db.run('DELETE FROM recipes WHERE id = ? AND owner_id = ?', [id, owner]); // its picture goes with it
    },

    /** Keep a picture of the recipe (JPEG, PNG or WebP), in place of any before. */
    async setPhoto(id: number, bytes: Uint8Array): Promise<Recipe> {
      if (!picturable(bytes)) throw new Problem(400, bytes.length > MAX_THING_PHOTO ? 'That picture is too large to keep' : "That isn't a picture Life Is can keep (JPEG, PNG or WebP)");
      return atomic(db, async (tx) => {
        await readRecipe(tx, id); // 404 unless it is yours
        await keepPhoto(tx, id, bytes);
        return readRecipe(tx, id);
      });
    },

    /** The recipe's picture, or null when it has none. */
    async photo(id: number): Promise<{ type: string; bytes: Uint8Array } | null> {
      const row = await db.get<{ type: string; bytes: Uint8Array }>(
        'SELECT p.type, p.bytes FROM recipe_photos p JOIN recipes r ON r.id = p.recipe_id WHERE p.recipe_id = ? AND r.owner_id = ?', [id, owner]);
      if (!row && !(await db.get('SELECT 1 AS there FROM recipes WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Recipe not found');
      return row ?? null;
    },

    async removePhoto(id: number): Promise<Recipe> {
      return atomic(db, async (tx) => {
        await readRecipe(tx, id);
        await tx.run('DELETE FROM recipe_photos WHERE recipe_id = ?', [id]);
        return readRecipe(tx, id);
      });
    },

    /** Pasted text, or schema.org recipe JSON (one recipe or a list). Each is saved with its original beside it. */
    async importRecipes(text: string): Promise<{ imported: number; recipes: Recipe[] }> {
      const found = readImport(text);
      return atomic(db, async (tx) => {
        const recipes: Recipe[] = [];
        for (const recipe of found) recipes.push(await readRecipe(tx, await createIn(tx, recipe)));
        return { imported: recipes.length, recipes };
      });
    },

    /**
     * What a file from another app holds, and nothing kept: how many recipes, the first few by name, how many
     * are in Life Is already (the same name and first ingredient), and any that couldn't be read.
     */
    async lookOverRecipeFile(file: RecipeFile): Promise<{ found: number; first: string[]; already: number; fresh: number; pictures: number; failed: Unread[] }> {
      const { recipes, failed } = recipesFromFile(file);
      const kept = await keptRecipeKeys(db);
      let already = 0;
      let pictures = 0; // pictures that will be kept: only a new recipe is given one
      for (const one of recipes) {
        if (kept.has(one.key)) already += 1;
        else { kept.add(one.key); if (one.pictured) pictures += 1; } // the same recipe twice in one file is one new recipe
      }
      return { found: recipes.length + failed.length, first: recipes.slice(0, 8).map((one) => one.name), already, fresh: recipes.length - already, pictures, failed };
    },

    /** Keep the new recipes of a file from another app, all in one change. Bringing the same file in again adds nothing. */
    async bringInRecipeFile(file: RecipeFile): Promise<{ found: number; added: number; already: number; pictures: number; failed: Unread[] }> {
      const { recipes, failed } = recipesFromFile(file);
      return atomic(db, async (tx) => {
        const kept = await keptRecipeKeys(tx);
        let added = 0;
        let already = 0;
        let pictures = 0;
        for (const one of recipes) {
          if (kept.has(one.key)) { already += 1; continue; } // a recipe already here is left as it is, with no picture added
          const id = await createIn(tx, one.input);
          // A picture that can't be kept (not a real picture, or too large) leaves the recipe without one; the recipe still comes in.
          if (one.photo && picturable(one.photo)) { await keepPhoto(tx, id, one.photo); pictures += 1; }
          kept.add(one.key);
          added += 1;
        }
        return { found: recipes.length + failed.length, added, already, pictures, failed };
      });
    },

    /**
     * Every recipe as a Nextcloud Cookbook folder (recipe.json in a folder named after it). Put them in the
     * Recipes folder in your Nextcloud and the Cookbook app shows them. The place Life Is runs turns these
     * into a zip or writes them to a folder.
     */
    async exportRecipes(): Promise<ExportFile[]> {
      const files: ExportFile[] = [];
      const used = new Set<string>();
      for (const { id } of await db.all<{ id: number }>('SELECT id FROM recipes WHERE owner_id = ? ORDER BY id', [owner])) {
        const recipe = await readRecipe(db, id);
        const name = folderName(recipe.title, used);
        files.push({ path: `Recipes/${name}/recipe.json`, text: JSON.stringify(toSchemaOrg(recipe), null, 2) });
        if (recipe.original_text) files.push({ path: `Recipes/${name}/original.txt`, text: recipe.original_text });
      }
      return files;
    },

    // ---------- pantry ----------

    async listPantry(): Promise<{ items: PantryItem[]; low: string[]; expiring: string[] }> {
      const items = await pantryRows(db);
      return {
        items,
        low: items.filter((item) => item.low).map((item) => item.name),
        expiring: items.filter((item) => item.days_left !== null && item.days_left <= 3).map((item) => item.name),
      };
    },

    /** Set what you have of an ingredient (adding it to the pantry if it's new). */
    async savePantry(body: PantryInput): Promise<PantryItem> {
      if (body.quantity != null && !(body.quantity >= 0 && body.quantity < 1e7)) throw new Problem(400, 'The amount is 0 or more');
      if (body.location != null && !LOCATIONS.includes(body.location)) throw new Problem(400, 'Unknown place');
      if (body.expires_on) dayNumber(body.expires_on);
      return atomic(db, async (tx) => {
        const ingredient = await ingredientId(tx, body.name);
        if (!ingredient) throw new Problem(400, 'Say what it is');
        await tx.run(
          `INSERT INTO pantry (owner_id, ingredient_id, quantity, unit, location, expires_on, low_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity, unit = excluded.unit, location = excluded.location,
             expires_on = excluded.expires_on, low_at = excluded.low_at, updated_at = excluded.updated_at`,
          [owner, ingredient, body.quantity ?? null, units.canonical(body.unit), body.location ?? null, body.expires_on || null,
            body.low_at ?? null, now()]);
        return (await pantryRows(tx)).find((item) => item.ingredient_id === ingredient)!;
      });
    },

    /**
     * Recipes for what is about to run out: the pantry items whose use-by day is within `days` (or has passed),
     * and the recipes that use them, most first, then the ones whose other ingredients the pantry already has.
     * Ingredients are matched the way the grocery list does: by the ingredient a recipe line was read as.
     */
    async useItUp(days = 5, limit = 12): Promise<UseItUp> {
      if (!(Number.isInteger(days) && days >= 0 && days <= 60)) throw new Problem(400, '0 to 60 days');
      const pantry = await pantryRows(db);
      const soonItems = pantry.filter((p) => p.days_left !== null && p.days_left <= days && p.quantity !== 0).sort((a, b) => a.days_left! - b.days_left! || inOrder(a.name.toLowerCase(), b.name.toLowerCase()));
      const soon = new Map(soonItems.map((p) => [p.ingredient_id, p]));
      const have = new Set(pantry.filter((p) => p.quantity !== 0).map((p) => p.ingredient_id));
      if (soon.size === 0) return { soon: [], suggestions: [] };
      const lines = await db.all<{ recipe_id: number; ingredient_id: number; title: string; servings: number | null }>(
        `SELECT DISTINCT l.recipe_id, l.ingredient_id, r.title, r.servings FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id
         WHERE r.owner_id = ? AND l.part = 'ingredients' AND l.is_heading = 0 AND l.ingredient_id IS NOT NULL`, [owner]);
      const byRecipe = new Map<number, { title: string; servings: number | null; ids: Set<number> }>();
      for (const line of lines) {
        const one = byRecipe.get(line.recipe_id) ?? { title: line.title, servings: line.servings, ids: new Set<number>() };
        one.ids.add(line.ingredient_id);
        byRecipe.set(line.recipe_id, one);
      }
      const suggestions = [...byRecipe.entries()].flatMap(([recipe_id, r]) => {
        const uses = [...r.ids].filter((id) => soon.has(id)).map((id) => soon.get(id)!).sort((a, b) => a.days_left! - b.days_left!);
        if (uses.length === 0) return [];
        const others = [...r.ids].filter((id) => !soon.has(id));
        return [{ recipe_id, title: r.title, servings: r.servings, uses: uses.map((p) => p.name), have_others: others.filter((id) => have.has(id)).length, other_total: others.length }];
      }).sort((a, b) => b.uses.length - a.uses.length || b.have_others - a.have_others || a.other_total - b.other_total || inOrder(a.title.toLowerCase(), b.title.toLowerCase()));
      return { soon: soonItems.map((p) => ({ name: p.name, days_left: p.days_left! })), suggestions: suggestions.slice(0, limit) };
    },

    /** What a scanned barcode is, as the grocery list knows it, and whether that is in the pantry. Asks nobody outside. */
    async scanForPantry(code: string): Promise<PantryScan> {
      const barcode = barcodeKey(code);
      if (!/^[0-9A-Z]{4,40}$/.test(barcode)) throw new Problem(400, "That isn't a barcode");
      const found = await db.get<{ id: number; name: string; product: string | null; size_quantity: number | null; size_unit: string | null; usual_quantity: number | null; usual_unit: string | null }>(
        `SELECT i.id, i.name, b.label AS product, b.size_quantity, b.size_unit, i.usual_size_quantity AS usual_quantity, i.usual_size_unit AS usual_unit
         FROM ingredient_barcodes b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.owner_id = ? AND b.barcode = ?`, [owner, barcode]);
      if (!found) return { barcode, ingredient: null, in_pantry: null };
      const size = found.size_quantity !== null ? units.amount(found.size_quantity, found.size_unit) : units.amount(found.usual_quantity, found.usual_unit);
      return {
        barcode, ingredient: { id: found.id, name: found.name, product: found.product, size },
        in_pantry: (await pantryRows(db)).find((p) => p.ingredient_id === found.id) ?? null,
      };
    },

    /**
     * Put what was scanned in the pantry: more of it when it's there. A barcode not seen before needs the
     * ingredient it is (one of yours by `ingredient_id`, or a `name`), and is remembered from then on. The amount
     * left out is the usual size of that product; null is "some".
     */
    async addScanned(body: { code: string; quantity?: number | null; unit?: string | null; ingredient_id?: number | null; name?: string | null; product?: string | null; size?: string | null }):
      Promise<{ item: PantryItem; learned: boolean }> {
      const barcode = barcodeKey(body.code);
      if (!/^[0-9A-Z]{4,40}$/.test(barcode)) throw new Problem(400, "That isn't a barcode");
      if (body.quantity != null && !(body.quantity > 0 && body.quantity < 1e7)) throw new Problem(400, 'The amount is more than 0');
      const packet = sizeOf(body.size);
      return atomic(db, async (tx) => {
        const known = await tx.get<{ ingredient_id: number; size_quantity: number | null; size_unit: string | null; usual_quantity: number | null; usual_unit: string | null }>(
          `SELECT b.ingredient_id, b.size_quantity, b.size_unit, i.usual_size_quantity AS usual_quantity, i.usual_size_unit AS usual_unit
           FROM ingredient_barcodes b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.owner_id = ? AND b.barcode = ?`, [owner, barcode]);
        let ingredient = known?.ingredient_id ?? null;
        if (ingredient === null) {
          if (body.ingredient_id != null) {
            if (!(await tx.get('SELECT id FROM ingredients WHERE id = ? AND owner_id = ?', [body.ingredient_id, owner]))) throw new Problem(404, "That isn't one of your ingredients");
            ingredient = body.ingredient_id;
          } else {
            ingredient = await ingredientId(tx, body.name ?? '');
          }
          if (ingredient === null) throw new Problem(400, 'Say what it is');
          await tx.run(
            'INSERT INTO ingredient_barcodes (owner_id, barcode, ingredient_id, label, size_quantity, size_unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [owner, barcode, ingredient, clean(body.product, 200), packet?.quantity ?? null, packet?.unit ?? null, now()]);
        }
        // The amount: what was said; else the size of this product; else the usual size; else "some".
        const usual = known?.size_quantity != null ? { quantity: known.size_quantity, unit: known.size_unit }
          : known?.usual_quantity != null ? { quantity: known.usual_quantity, unit: known.usual_unit } : packet;
        const quantity = body.quantity !== undefined ? body.quantity : (usual?.quantity ?? null);
        const unit = body.quantity != null ? (body.unit ?? null) : body.quantity === null ? null : (usual?.unit ?? null);
        await addToPantry(tx, ingredient, quantity, unit);
        return { item: (await pantryRows(tx)).find((p) => p.ingredient_id === ingredient)!, learned: !known };
      });
    },

    async deletePantry(id: number): Promise<void> {
      await db.run('DELETE FROM pantry WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    // ---------- the week's meals ----------

    async listPlan(start: string, days = 7): Promise<PlannedMeal[]> {
      return planRows(db, ...planWindow(start, days));
    },

    async addPlan(body: PlanInput): Promise<PlannedMeal> {
      const meal = body.meal ?? 'dinner';
      if (!MEALS.includes(meal)) throw new Problem(400, 'Breakfast, lunch, dinner or a snack');
      if (body.servings != null && !(body.servings > 0 && body.servings <= 1000)) throw new Problem(400, 'Servings is a number above 0');
      dayNumber(body.day);
      return atomic(db, async (tx) => {
        if (body.recipe_id != null) await readRecipe(tx, body.recipe_id);
        else if (!clean(body.title)) throw new Problem(400, 'Choose a recipe, or say what the meal is');
        const made = await tx.run(
          'INSERT INTO meal_plan (owner_id, day, meal, recipe_id, title, servings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [owner, body.day, meal as Meal, body.recipe_id ?? null, clean(body.title, 200), body.servings ?? null, now()]);
        return (await planRows(tx, body.day, body.day)).find((row) => row.id === made.lastId)!;
      });
    },

    /**
     * For each meal planned between the days given, what its recipes need more of than you have. Everything
     * cooked for one meal is assumed to need its pans and dishes at the same time, so their numbers add up;
     * breakfast and dinner on the same day can share a pan. A meal already cooked isn't counted.
     */
    async equipmentCheck(start: string, days = 7): Promise<EquipmentShortage[]> {
      const [from, to] = planWindow(start, days);
      const rows = await db.all<{ day: string; meal: Meal; title: string; item_id: number | null; label: string; quantity: number;
        item_name: string | null; item_quantity: number | null; item_there: number | null }>(
        `SELECT m.day, m.meal, r.title, e.item_id, e.label, e.quantity, i.name AS item_name, i.quantity AS item_quantity, i.id AS item_there
         FROM meal_plan m JOIN recipes r ON r.id = m.recipe_id JOIN recipe_equipment e ON e.recipe_id = r.id
         LEFT JOIN items i ON i.id = e.item_id AND i.owner_id = m.owner_id
         WHERE m.owner_id = ? AND m.day >= ? AND m.day <= ? AND m.cooked_on IS NULL ORDER BY m.day, m.id, e.sort_order`, [owner, from, to]);
      const needs = new Map<string, EquipmentShortage>();
      for (const row of rows) {
        const label = row.item_name ?? row.label;
        const key = `${row.day}|${row.meal}|${row.item_there !== null ? `#${row.item_there}` : labelKey(label)}`;
        let need = needs.get(key);
        if (!need) {
          need = { day: row.day, meal: row.meal, item_id: row.item_there, label, need: 0, have: row.item_there === null ? null : (row.item_quantity ?? 1), short: 0, recipes: [] };
          needs.set(key, need);
        }
        need.need += row.quantity;
        if (!need.recipes.includes(row.title)) need.recipes.push(row.title);
      }
      const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'];
      return [...needs.values()]
        .map((need) => ({ ...need, need: rounded(need.need, 3), short: rounded(Math.max(0, need.need - (need.have ?? 0)), 3) }))
        .filter((need) => need.short > 0)
        .sort((a, b) => inOrder(a.day, b.day) || mealOrder.indexOf(a.meal) - mealOrder.indexOf(b.meal) || inOrder(a.label.toLowerCase(), b.label.toLowerCase()));
    },

    /**
     * Copy the meals of the week starting `from` onto the week starting `to`, each onto the same day of the week.
     * Meals already on those days stay; copies are added beside them. A copy is never "cooked", and keeps its servings.
     */
    async copyWeek(from: string, to: string, days = 7): Promise<CopyResult> {
      const [first, last] = planWindow(from, days);
      const offset = dayNumber(to) - dayNumber(from);
      if (offset === 0) throw new Problem(400, 'Choose a different week to copy to');
      return atomic(db, async (tx) => {
        const items: MealCopy[] = (await planRows(tx, first, last))
          .filter((m) => m.recipe_id !== null || m.title)
          .map((m) => ({ day: addDays(m.day, offset), meal: m.meal, recipe_id: m.recipe_id, title: m.title, servings: m.servings }));
        return putMeals(tx, items, []);
      });
    },

    // ---------- week templates (kept with the person's settings, no table) ----------

    listTemplates(): Promise<WeekTemplate[]> {
      return templatesIn(db);
    },

    /** Keep the week starting `start` as a template under a name. */
    async saveTemplate(start: string, name: string): Promise<WeekTemplate[]> {
      const tidy = clean(name, 60);
      if (!tidy) throw new Problem(400, 'Give the template a name');
      const [first, last] = planWindow(start, 7);
      return atomic(db, async (tx) => {
        const list = await readTemplates(tx);
        if (list.some((t) => t.name.toLowerCase() === tidy.toLowerCase())) throw new Problem(409, 'You already have a template by that name');
        if (list.length >= MAX_TEMPLATES) throw new Problem(400, `You can keep up to ${MAX_TEMPLATES} templates`);
        const meals: TemplateMeal[] = (await planRows(tx, first, last)).filter((m) => m.recipe_id !== null || m.title).map((m) => ({
          weekday: dayNumber(m.day) - dayNumber(first), meal: m.meal, recipe_id: m.recipe_id,
          recipe_title: m.recipe_id !== null ? m.recipe_title : null, title: m.recipe_id === null ? m.title : null, servings: m.servings,
        }));
        if (meals.length === 0) throw new Problem(400, 'That week has nothing planned, so there is nothing to keep');
        await writeTemplates(tx, [...list, { id: Math.max(0, ...list.map((t) => t.id)) + 1, name: tidy, meals }]);
        return templatesIn(tx);
      });
    },

    async renameTemplate(id: number, name: string): Promise<WeekTemplate[]> {
      const tidy = clean(name, 60);
      if (!tidy) throw new Problem(400, 'Give the template a name');
      return atomic(db, async (tx) => {
        const list = await readTemplates(tx);
        const one = list.find((t) => t.id === id);
        if (!one) throw new Problem(404, 'Not found');
        if (list.some((t) => t.id !== id && t.name.toLowerCase() === tidy.toLowerCase())) throw new Problem(409, 'You already have a template by that name');
        one.name = tidy;
        await writeTemplates(tx, list);
        return templatesIn(tx);
      });
    },

    async deleteTemplate(id: number): Promise<WeekTemplate[]> {
      return atomic(db, async (tx) => {
        await writeTemplates(tx, (await readTemplates(tx)).filter((t) => t.id !== id));
        return templatesIn(tx);
      });
    },

    /** Put a template on the week starting `start`. A recipe that has been deleted is named and left out; the rest still goes on. */
    async useTemplate(id: number, start: string): Promise<CopyResult> {
      dayNumber(start);
      return atomic(db, async (tx) => {
        const one = (await readTemplates(tx)).find((t) => t.id === id);
        if (!one) throw new Problem(404, 'Not found');
        const described = await describeTemplate(tx, one);
        const items: MealCopy[] = described.meals.filter((m) => !m.missing).map((m) => ({
          day: addDays(start, m.weekday), meal: m.meal, recipe_id: m.recipe_id, title: m.title, servings: m.servings,
        }));
        return putMeals(tx, items, described.missing);
      });
    },

    async deletePlan(id: number): Promise<void> {
      await db.run('DELETE FROM meal_plan WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    /**
     * The meal was made: what it used comes out of the pantry. Says what couldn't be taken away (no amount
     * known, or units that don't compare), so the pantry can be fixed by hand.
     */
    cooked(id: number): Promise<{ cooked: true; check_by_hand: string[] }> {
      return atomic(db, async (tx) => {
        const meal = await tx.get<PlannedMeal>(
          `SELECT m.*, r.title AS recipe_title, r.servings AS recipe_servings FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
           WHERE m.id = ? AND m.owner_id = ?`, [id, owner]);
        if (!meal) throw new Problem(404, 'Not found');
        if (meal.cooked_on) throw new Problem(409, 'That meal is already marked as cooked');
        const unchanged = new Set<string>();
        if (meal.recipe_id) {
          for (const line of await neededLines(tx, meal.recipe_id, factorOf(meal))) {
            const inPantry = await tx.get('SELECT 1 AS there FROM pantry WHERE owner_id = ? AND ingredient_id = ?', [owner, line.ingredient_id]);
            if (inPantry && !(await takeFromPantry(tx, line.ingredient_id, line.quantity, line.unit))) {
              unchanged.add((await tx.get<{ name: string }>('SELECT name FROM ingredients WHERE id = ?', [line.ingredient_id]))!.name);
            }
          }
        }
        await tx.run('UPDATE meal_plan SET cooked_on = ? WHERE id = ?', [today(), id]);
        return { cooked: true as const, check_by_hand: [...unchanged].sort() };
      });
    },

    // ---------- the grocery list ----------

    listGrocery(): Promise<GroceryItem[]> {
      return groceryRows(db);
    },

    /** Something to buy, typed in. "2 lb chicken thighs" is read like a recipe line. */
    async addGrocery(body: { label: string; quantity?: number | null; unit?: string | null }): Promise<GroceryItem[]> {
      const line = groceryLine(body);
      return atomic(db, async (tx) => {
        await putOnList(tx, line, await ingredientId(tx, line.name));
        return groceryRows(tx);
      });
    },

    /**
     * A list pasted in (from Notes, a message, an email), read and checked against the list, and nothing
     * added. Each line says what it would become and whether it's already on the list (or earlier in the paste).
     */
    async lookOverGroceries(pasted: string): Promise<{ lines: { text: string; label: string; amount: string | null; note: string | null; already: boolean }[] }> {
      const seen = await openOnList(db);
      const lines = readGroceryList(pasted).map((text) => {
        const line = groceryLine({ label: text });
        const key = units.nameKey(line.name);
        const already = key !== '' && seen.has(key);
        if (key) seen.add(key);
        return { text, label: cut(line.name, 200), amount: line.quantity !== null ? units.amount(line.quantity, line.unit) : null, note: line.parsed.note, already };
      });
      return { lines };
    },

    /** Put each line on the list as if typed, skipping what's on it already. All of them, or none. */
    async addGroceries(texts: string[]): Promise<{ items: GroceryItem[]; added: number; already: number }> {
      if (texts.length > MAX_PASTED_GROCERIES) throw new Problem(400, `That's more than ${MAX_PASTED_GROCERIES} things. Add it in two parts.`);
      const lines = texts.filter((text) => text.trim()).map((text) => groceryLine({ label: text }));
      return atomic(db, async (tx) => {
        const onList = await openOnList(tx);
        let added = 0;
        let already = 0;
        for (const line of lines) {
          const ingredient = await ingredientId(tx, line.name);
          const key = units.nameKey(line.name);
          if (key && onList.has(key)) { already += 1; continue; }
          await putOnList(tx, line, ingredient);
          if (key) onList.add(key);
          added += 1;
        }
        return { items: await groceryRows(tx), added, already };
      });
    },

    /**
     * Fill the list from the week's meals, minus the pantry. Items added by hand stay; earlier items from the
     * plan that aren't ticked off are replaced, so running it again after changing the week gives the right list.
     */
    async groceryFromPlan(start: string, days = 7): Promise<{ items: GroceryItem[]; added: number; check: string[] }> {
      const [from, to] = planWindow(start, days);
      return atomic(db, async (tx) => {
        const needs = await shoppingNeeds(tx, from, to);
        await tx.run('DELETE FROM grocery WHERE owner_id = ? AND from_plan = 1 AND done = 0', [owner]);
        for (const b of needs.buy) {
          await tx.run(
            'INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, from_plan, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
            [owner, b.ingredient_id, b.label, b.quantity, b.unit, b.note, now()]);
        }
        return { items: await groceryRows(tx), added: needs.buy.length, check: needs.check };
      });
    },

    /** Tick something off (or untick it). Ticked off with "put away", it goes into the pantry. */
    tickGrocery(id: number, body: { done: boolean; put_away?: boolean }): Promise<GroceryItem[]> {
      return atomic(db, async (tx) => {
        const item = await tx.get<GroceryRow>('SELECT g.*, NULL AS aisle FROM grocery g WHERE id = ? AND owner_id = ?', [id, owner]);
        if (!item) throw new Problem(404, 'Not found');
        if (body.done && !item.done && (body.put_away ?? true) && item.ingredient_id) {
          await addToPantry(tx, item.ingredient_id, item.quantity, item.unit);
        }
        await tx.run('UPDATE grocery SET done = ? WHERE id = ?', [body.done ? 1 : 0, id]);
        return groceryRows(tx);
      });
    },

    async clearDone(): Promise<GroceryItem[]> {
      await db.run('DELETE FROM grocery WHERE owner_id = ? AND done = 1', [owner]);
      return groceryRows(db);
    },

    async deleteGrocery(id: number): Promise<void> {
      await db.run('DELETE FROM grocery WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    /** Add everything running low in the pantry that isn't on the list already. */
    groceryFromLow(): Promise<{ items: GroceryItem[]; added: number }> {
      return atomic(db, async (tx) => {
        const onList = new Set((await tx.all<{ ingredient_id: number | null }>(
          'SELECT ingredient_id FROM grocery WHERE owner_id = ? AND done = 0', [owner])).map((row) => row.ingredient_id));
        let added = 0;
        for (const item of await pantryRows(tx)) {
          if (item.low && !onList.has(item.ingredient_id)) {
            await tx.run('INSERT INTO grocery (owner_id, ingredient_id, label, created_at) VALUES (?, ?, ?, ?)',
              [owner, item.ingredient_id, item.name, now()]);
            added += 1;
          }
        }
        return { items: await groceryRows(tx), added };
      });
    },
  };
}

export type Kitchen = ReturnType<typeof kitchen>;
export type { Clock };
