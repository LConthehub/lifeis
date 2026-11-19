/**
 * The database's shape, version by version.
 *
 * Each migration runs once, in order, inside a transaction, and the database remembers the last one it ran
 * (PRAGMA user_version). A shipped migration is never edited: a change is always a new one at the end.
 *
 * Migrations 1 and 2 are word for word the tables backend/migrations.py makes, so a database made by either
 * opens in the other.
 */
import { atomic, type Db } from './db';

type Migration = { number: number; name: string; statements: string[] };

const MIGRATIONS: Migration[] = [
  {
    number: 1,
    name: 'logins, sessions and settings',
    statements: [
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT,
        method TEXT,
        ip TEXT,
        user_agent TEXT,
        device_hash TEXT
      )`,
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`,
      `CREATE TABLE user_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )`,
      `CREATE TABLE login_throttle (
        key TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        locked_until REAL NOT NULL DEFAULT 0,
        updated_at REAL NOT NULL
      )`,
    ],
  },
  {
    number: 2,
    name: 'the kitchen',
    statements: [
      `CREATE TABLE ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        aisle TEXT,
        UNIQUE (owner_id, key)
      )`,
      `CREATE TABLE recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        servings REAL CHECK(servings IS NULL OR servings > 0),
        prep_minutes INTEGER,
        cook_minutes INTEGER,
        source_url TEXT,
        original_text TEXT,
        notes TEXT,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_recipes_owner ON recipes(owner_id, title)`,
      `CREATE TABLE recipe_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        part TEXT NOT NULL CHECK(part IN ('ingredients', 'steps')),
        is_heading INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        quantity REAL,
        unit TEXT,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_recipe_lines ON recipe_lines(recipe_id, part, sort_order)`,
      `CREATE TABLE pantry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
        unit TEXT,
        location TEXT,
        expires_on TEXT,
        low_at REAL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, ingredient_id)
      )`,
      `CREATE TABLE meal_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        meal TEXT NOT NULL DEFAULT 'dinner' CHECK(meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        title TEXT,
        servings REAL CHECK(servings IS NULL OR servings > 0),
        cooked_on TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_meal_plan ON meal_plan(owner_id, day)`,
      `CREATE TABLE grocery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        quantity REAL,
        unit TEXT,
        note TEXT,
        from_plan INTEGER NOT NULL DEFAULT 0 CHECK(from_plan IN (0, 1)),
        done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_grocery_owner ON grocery(owner_id, done)`,
    ],
  },
];

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.number;

export async function currentVersion(db: Db): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Brings the database up to date and returns the version it ends at.
 *
 * `beforeUpgrade` is called before an existing database is changed, so the place Life Is runs can save a
 * copy first (the server copies the file; the app does it its own way).
 */
export async function migrate(db: Db, beforeUpgrade?: (from: number, to: number) => Promise<void>): Promise<number> {
  const version = await currentVersion(db);
  if (version > LATEST) {
    throw new Error(`This database is version ${version}, but this copy of Life Is only knows up to ${LATEST}. ` +
      'Update Life Is, or restore the copy made before the upgrade.');
  }
  const pending = MIGRATIONS.filter((m) => m.number > version);
  if (pending.length === 0) return version;
  if (version > 0 && beforeUpgrade) await beforeUpgrade(version, LATEST);
  for (const migration of pending) {
    await atomic(db, async (tx) => {
      for (const statement of migration.statements) await tx.run(statement);
      await tx.run(`PRAGMA user_version = ${migration.number}`);
    });
  }
  return currentVersion(db);
}
