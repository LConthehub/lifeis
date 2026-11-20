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
 *
 * `kitchen(db, owner)` is one person's kitchen: everything it reads and writes is theirs. It does what
 * backend/kitchen.py does, and gives the same answers. Anything that changes several things changes all of
 * them or none (a transaction).
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import type {
  ExportFile, GroceryItem, Ingredient, Meal, PantryInput, PantryItem, Part, PlanInput, PlannedMeal, Recipe,
  RecipeInput, RecipeLine, RecipeSummary,
} from './kitchenTypes.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, inOrder, localDay, rounded, stamp, type Clock } from './small.ts';
import { cut, folderName, linesAsText, readImport, splitLines, TEXT_LIMIT, toSchemaOrg, type TextLine } from './recipeText.ts';
import * as units from './units.ts';

export const MEALS: readonly string[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const LOCATIONS: readonly string[] = ['fridge', 'freezer', 'pantry', 'spices', 'other'];

const tagList = (tags: string | null) => (tags ?? '').split(',').filter(Boolean);

type RecipeRow = Omit<Recipe, 'tags' | 'ingredients' | 'steps' | 'ingredients_text' | 'steps_text' | 'showing_servings'> & { tags: string | null };
type LineRow = Omit<RecipeLine, 'is_heading' | 'scaled'> & { is_heading: number };
type PantryRow = Omit<PantryItem, 'low' | 'days_left' | 'amount'>;
type GroceryRow = Omit<GroceryItem, 'done' | 'from_plan' | 'amount'> & { done: number; from_plan: number };

export function kitchen(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => localDay(clock());

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

  async function readRecipe(q: Queries, id: number, servings?: number | null): Promise<Recipe> {
    const row = await q.get<RecipeRow>('SELECT * FROM recipes WHERE id = ? AND owner_id = ?', [id, owner]);
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
      ingredients: lines.filter((line) => line.part === 'ingredients'),
      steps: lines.filter((line) => line.part === 'steps'),
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
    return made.lastId;
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
      let sql = 'SELECT id, title, description, servings, prep_minutes, cook_minutes, tags, updated_at FROM recipes WHERE owner_id = ?';
      const args: Value[] = [owner];
      if (find.q) {
        sql += " AND (title LIKE ? OR id IN (SELECT recipe_id FROM recipe_lines WHERE part = 'ingredients' AND text LIKE ?))";
        args.push(`%${find.q.trim()}%`, `%${find.q.trim()}%`);
      }
      if (find.tag) {
        sql += " AND (',' || tags || ',') LIKE ?";
        args.push(`%,${find.tag.trim().toLowerCase()},%`);
      }
      const rows = await db.all<Omit<RecipeSummary, 'tags'> & { tags: string | null }>(sql + ' ORDER BY title COLLATE NOCASE', args);
      return rows.map((row) => ({ ...row, tags: tagList(row.tags) }));
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
        return readRecipe(tx, id);
      });
    },

    async deleteRecipe(id: number): Promise<void> {
      await db.run('DELETE FROM recipes WHERE id = ? AND owner_id = ?', [id, owner]);
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
      const text = clean(body.label, 200);
      if (!text) throw new Problem(400, 'Say what to buy');
      const parsed = units.parseLine(text);
      const quantity = body.quantity ?? parsed.quantity;
      const unit = body.unit ? units.canonical(body.unit) : parsed.unit;
      const name = parsed.name || text;
      return atomic(db, async (tx) => {
        const ingredient = await ingredientId(tx, name);
        await tx.run('INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [owner, ingredient, cut(name, 200), quantity, unit, parsed.note, now()]);
        return groceryRows(tx);
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
