/**
 * What the kitchen takes in and gives back. The names are the ones the pages already use (ingredients_text,
 * prep_minutes), so a page can't tell whether the answer came from the server or from the app itself.
 */

import type { TagRef } from './tags.ts';

export type Part = 'ingredients' | 'steps';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Ingredient = { id: number; name: string; aisle: string | null };

/** A recipe as it's typed in or brought in. */
export type RecipeInput = {
  title: string;
  description?: string | null;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  source_url?: string | null;
  /** One ingredient a line; "# For the sauce" starts a section. */
  ingredients_text?: string | null;
  /** One step a paragraph. */
  steps_text?: string | null;
  notes?: string | null;
  tags?: string[];
  /** What was pasted or imported, kept as it was. */
  original_text?: string | null;
  /** What it's cooked in. Left out when changing a recipe: what it had stays. */
  equipment?: EquipmentInput[];
};

/** A pan, dish or tool a recipe needs. */
export type EquipmentInput = {
  /** One of the things you keep. Left out: something named by `label` that isn't catalogued. */
  item_id?: number | null;
  label?: string | null;
  /** How many are needed at once. Left out: one. */
  quantity?: number | null;
  note?: string | null;
};

export type RecipeEquipment = {
  id: number;
  item_id: number | null;
  /** The thing's name, kept even if the thing is later removed. */
  label: string;
  quantity: number;
  note: string | null;
  /** How many of it you have, or null when it isn't one of your things. Owning it with no count is one. */
  have: number | null;
  /** Where it's kept, when it's one of your things with a place. */
  place: string | null;
};

/** For one meal of one day: something the planned recipes need more of than you have. */
export type EquipmentShortage = {
  day: string;
  meal: Meal;
  item_id: number | null;
  label: string;
  /** How many the recipes planned for that meal need at once. */
  need: number;
  have: number | null;
  short: number;
  /** The recipes that need it. */
  recipes: string[];
};

export type RecipeLine = {
  id: number;
  recipe_id: number;
  part: Part;
  is_heading: boolean;
  /** The line, exactly as written. */
  text: string;
  quantity: number | null;
  unit: string | null;
  ingredient_id: number | null;
  sort_order: number;
  /** The ingredient's name, for an ingredient line that was understood. */
  ingredient: string | null;
  /** The amount for the servings asked for, when that isn't the recipe's own. The line itself never changes. */
  scaled: string | null;
};

export type RecipeSummary = {
  id: number;
  title: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  /** The names of its tags. */
  tags: string[];
  /** Its tags in full: where each sits. */
  tag_list: TagRef[];
  updated_at: string;
  /** Whether it has a picture (asked for at /api/kitchen/recipes/:id/photo). */
  has_photo: boolean;
  /** When the picture was added: a page uses it to ask for the new picture after a change. */
  photo_added_at: string | null;
};

export type Recipe =Omit<RecipeSummary, 'tags' | 'tag_list'> & {
  owner_id: number;
  source_url: string | null;
  original_text: string | null;
  notes: string | null;
  tags: string[];
  tag_list: TagRef[];
  created_at: string;
  ingredients: RecipeLine[];
  steps: RecipeLine[];
  equipment: RecipeEquipment[];
  ingredients_text: string;
  steps_text: string;
  showing_servings: number | null;
};

export type PantryInput = {
  name: string;
  /** Left out: "I have some". */
  quantity?: number | null;
  unit?: string | null;
  location?: string | null;
  /** A day, as 2046-03-05. */
  expires_on?: string | null;
  low_at?: number | null;
};

export type PantryItem = {
  id: number;
  owner_id: number;
  ingredient_id: number;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  expires_on: string | null;
  low_at: number | null;
  updated_at: string;
  name: string;
  aisle: string | null;
  low: boolean;
  days_left: number | null;
  /** "500 g", or "some" when no amount is known. */
  amount: string;
};

export type PlanInput = {
  /** A day, as 2046-03-05. */
  day: string;
  meal?: string;
  recipe_id?: number | null;
  /** A meal without a recipe ("leftovers", "out"). */
  title?: string | null;
  servings?: number | null;
};

export type PlannedMeal = {
  id: number;
  owner_id: number;
  day: string;
  meal: Meal;
  recipe_id: number | null;
  title: string | null;
  servings: number | null;
  cooked_on: string | null;
  created_at: string;
  recipe_title: string | null;
  recipe_servings: number | null;
};

export type GroceryItem = {
  id: number;
  owner_id: number;
  ingredient_id: number | null;
  label: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  from_plan: boolean;
  done: boolean;
  created_at: string;
  aisle: string | null;
  amount: string;
};

/** One file of an export: where it goes in the folder, and what's in it. */
export type ExportFile = { path: string; text: string };
