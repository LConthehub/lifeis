/**
 * The database's shape, version by version.
 *
 * Each migration runs once, in order, inside a transaction, and the database remembers the last one it ran
 * (PRAGMA user_version). A shipped migration is never edited: a change is always a new one at the end.
 *
 * Migrations 1 and 2 are word for word the tables backend/migrations.py made. From 3 on, the database is this
 * program's alone: the Python one refuses a database newer than it knows.
 */
import { atomic, type Db } from './db.ts';

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
  {
    number: 3,
    name: 'things you keep, and the projects that use them',
    statements: [
      // A kind of thing ("Fabric", "Seeds"), made by the person, with the fields they chose for it.
      `CREATE TABLE kinds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        icon TEXT,
        unit TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (owner_id, key)
      )`,
      `CREATE TABLE kind_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind_id INTEGER NOT NULL REFERENCES kinds(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text', 'number', 'choice', 'yesno', 'date', 'link')),
        unit TEXT,
        choices TEXT,
        sort_order INTEGER NOT NULL,
        UNIQUE (kind_id, key)
      )`,
      // Where things are: a room, a shelf in it, a bin on the shelf.
      `CREATE TABLE places (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_places_owner ON places(owner_id, parent_id)`,
      `CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind_id INTEGER NOT NULL REFERENCES kinds(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
        unit TEXT,
        place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
        low_at REAL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_items_owner ON items(owner_id, kind_id)`,
      `CREATE TABLE item_values (
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        field_id INTEGER NOT NULL REFERENCES kind_fields(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        PRIMARY KEY (item_id, field_id)
      )`,
      // Something being made or done, from an idea to finished.
      `CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        activity TEXT,
        status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea', 'planned', 'active', 'paused', 'done', 'dropped')),
        notes TEXT,
        due_on TEXT,
        started_on TEXT,
        finished_on TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_projects_owner ON projects(owner_id, status)`,
      // What a project uses. With an amount, that much is set aside for it; without, it's only referred to
      // (a pattern, a tool). The label keeps the thing's name if the thing itself is later removed.
      `CREATE TABLE project_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        quantity REAL CHECK(quantity IS NULL OR quantity > 0),
        unit TEXT,
        used_on TEXT,
        note TEXT,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_project_items ON project_items(project_id, sort_order)`,
      `CREATE INDEX idx_project_items_item ON project_items(item_id)`,
      // Time spent on a project: a day, and how long. The calendar will show these.
      `CREATE TABLE project_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        minutes INTEGER CHECK(minutes IS NULL OR minutes >= 0),
        note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_project_sessions ON project_sessions(project_id, day)`,
    ],
  },
  {
    number: 4,
    name: 'the calendar',
    statements: [
      // Something on a day (or over several), with a time if it has one. Meals, project sessions and the rest
      // are shown on the calendar from where they already live; only what is typed in here is kept here.
      `CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        day TEXT NOT NULL,
        end_day TEXT,
        time TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_events_owner ON events(owner_id, day)`,
    ],
  },
  {
    number: 5,
    name: 'films, shows, music, books and games',
    statements: [
      // A title: the film, the album, the book. What you own of it is its copies.
      `CREATE TABLE media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('film', 'show', 'music', 'book', 'game', 'other')),
        title TEXT NOT NULL,
        creator TEXT,
        year INTEGER,
        summary TEXT,
        genres TEXT,
        minutes INTEGER,
        cover TEXT,
        wanted INTEGER NOT NULL DEFAULT 0 CHECK(wanted IN (0, 1)),
        ids TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_media_owner ON media(owner_id, type, title)`,
      // One copy: the VHS on the shelf, the Blu-ray in the bin, the file on the media server. `source` and
      // `source_id` say which media server a copy was brought in from, so it can be kept in step.
      `CREATE TABLE media_copies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
        barcode TEXT,
        lent_to TEXT,
        lent_on TEXT,
        note TEXT,
        source TEXT,
        source_id TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_media_copies ON media_copies(media_id)`,
      `CREATE INDEX idx_media_copies_source ON media_copies(source, source_id)`,
      // A day it was watched, read, listened to or played, and the project session it kept company, if any.
      `CREATE TABLE media_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        note TEXT,
        session_id INTEGER REFERENCES project_sessions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_media_log ON media_log(media_id, day)`,
      `CREATE INDEX idx_media_log_session ON media_log(session_id)`,
    ],
  },
  {
    number: 6,
    name: 'media servers, and covers kept here',
    statements: [
      // A Jellyfin or Emby server to bring the library in from. The key is stored locked (see the server's vault).
      `CREATE TABLE media_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('jellyfin', 'emby')),
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT,
        every_hours INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        last_ok INTEGER,
        last_message TEXT,
        created_at TEXT NOT NULL
      )`,
      // Which server a copy came from. When the server is removed, its copies stay as ordinary copies.
      `ALTER TABLE media_copies ADD COLUMN connection_id INTEGER REFERENCES media_sources(id) ON DELETE SET NULL`,
      `CREATE INDEX idx_media_copies_connection ON media_copies(connection_id, source_id)`,
      // A title's cover, kept here so the pages never fetch a picture from anywhere else.
      `CREATE TABLE media_covers (
        media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        bytes BLOB NOT NULL
      )`,
    ],
  },
  {
    number: 7,
    name: 'what a recipe is cooked in',
    statements: [
      // The pans, dishes and tools a recipe needs, and how many. Each is one of the person's things, or just a
      // name for something they haven't catalogued. The label keeps the name if the thing is later removed.
      `CREATE TABLE recipe_equipment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
        note TEXT,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_recipe_equipment ON recipe_equipment(recipe_id, sort_order)`,
    ],
  },
  {
    number: 8,
    name: 'dates that come round every year',
    statements: [
      // A birthday or an anniversary: kept once, on its first day, and shown on that day every year after.
      `ALTER TABLE events ADD COLUMN yearly INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    number: 9,
    name: 'email accounts',
    statements: [
      // Only the account is kept: where its servers are, and its password, locked (see mail.ts). No message is.
      `CREATE TABLE mail_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        name TEXT,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        local INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_mail_accounts ON mail_accounts(owner_id)`,
    ],
  },
  {
    number: 10,
    name: 'a code for each place, for its sticker',
    statements: [
      // What a place's printed sticker carries. Random, so one sticker says nothing about another; given the
      // first time stickers are asked for.
      `ALTER TABLE places ADD COLUMN code TEXT`,
      `CREATE UNIQUE INDEX idx_places_code ON places(code) WHERE code IS NOT NULL`,
    ],
  },
  {
    number: 11,
    name: 'plans, and the memories they become',
    statements: [
      `CREATE TABLE plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_day TEXT NOT NULL,
        end_day TEXT NOT NULL,
        note TEXT,
        story TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_plans_owner ON plans(owner_id, start_day)`,
      // What belongs to a plan. A task is its own words; the rest point at a recipe, a thing, a title or a
      // project by id (ref_id), and keep its name (label) in case it's later removed.
      `CREATE TABLE plan_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('task', 'recipe', 'thing', 'media', 'project')),
        ref_id INTEGER,
        label TEXT NOT NULL,
        quantity REAL CHECK(quantity IS NULL OR quantity > 0),
        note TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_plan_items ON plan_items(plan_id, sort_order)`,
      // A photo kept here (its bytes), or one only linked from a photo library (which one: asset_id).
      `CREATE TABLE plan_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('kept', 'immich')),
        asset_id TEXT,
        type TEXT,
        bytes BLOB,
        caption TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_plan_photos ON plan_photos(plan_id, sort_order)`,
    ],
  },
  {
    number: 12,
    name: "a plan's food on the week's meals",
    statements: [
      // A recipe on a plan may also be a meal on the week (meal_plan), so the grocery list and the pans it
      // needs follow. This is which meal. Removing the meal from the week only forgets the link.
      `ALTER TABLE plan_items ADD COLUMN meal_plan_id INTEGER REFERENCES meal_plan(id) ON DELETE SET NULL`,
    ],
  },
  {
    number: 13,
    name: 'what things cost, and coupons',
    statements: [
      // A price paid for a line of the grocery list, in whole cents. While the line is on the list the price
      // is tied to it (grocery_id); once the list is cleared it stays as that ingredient's history. A price
      // marked assumed is last time's standing in, and is never treated as history.
      `CREATE TABLE prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
        grocery_id INTEGER REFERENCES grocery(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        cents INTEGER NOT NULL CHECK(cents >= 0),
        quantity REAL,
        unit TEXT,
        store TEXT,
        day TEXT NOT NULL,
        assumed INTEGER NOT NULL DEFAULT 0 CHECK(assumed IN (0, 1)),
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_prices_owner ON prices(owner_id, ingredient_id, day)`,
      `CREATE INDEX idx_prices_grocery ON prices(grocery_id)`,
      // Money or a percentage off: for one ingredient, or (ingredient_id empty) for the whole shop.
      `CREATE TABLE coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
        cents_off INTEGER CHECK(cents_off IS NULL OR cents_off > 0),
        percent_off REAL CHECK(percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
        store TEXT,
        code TEXT,
        expires_on TEXT,
        used_on TEXT,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_coupons_owner ON coupons(owner_id, used_on)`,
    ],
  },
  {
    number: 14,
    name: 'barcodes for groceries',
    statements: [
      // Which ingredient a product's barcode is: taught once, by scanning it and saying what it is. Several
      // products (brands, sizes) can be the same ingredient. The label is the product's own name, if known.
      `CREATE TABLE ingredient_barcodes (
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        barcode TEXT NOT NULL,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        label TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, barcode)
      )`,
      // The product a price was paid for, when it was scanned.
      `ALTER TABLE prices ADD COLUMN barcode TEXT`,
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
