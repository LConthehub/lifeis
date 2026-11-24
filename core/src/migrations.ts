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

export const MIGRATIONS: Migration[] = [
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
  {
    number: 15,
    name: 'shops, and the sizes things come in',
    statements: [
      // The shops a person uses, to choose from. Prices and coupons keep the shop's name as it was.
      `CREATE TABLE stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX idx_stores_name ON stores(owner_id, name COLLATE NOCASE)`,
      // Shops already named on a price become the start of the list.
      `INSERT OR IGNORE INTO stores (owner_id, name, created_at)
       SELECT owner_id, TRIM(store), MIN(created_at) FROM prices WHERE store IS NOT NULL AND TRIM(store) != '' GROUP BY owner_id, TRIM(store) COLLATE NOCASE`,
      // The size on a product's packet ("30 oz"), learned with its barcode.
      `ALTER TABLE ingredient_barcodes ADD COLUMN size_quantity REAL`,
      `ALTER TABLE ingredient_barcodes ADD COLUMN size_unit TEXT`,
    ],
  },
  {
    number: 16,
    name: 'where each thing is usually bought, and in what size',
    statements: [
      // A person's habits for an ingredient: the shop they get it at, and the size they get ("30 oz").
      `ALTER TABLE ingredients ADD COLUMN usual_store TEXT`,
      `ALTER TABLE ingredients ADD COLUMN usual_size_quantity REAL`,
      `ALTER TABLE ingredients ADD COLUMN usual_size_unit TEXT`,
    ],
  },
  {
    number: 17,
    name: 'a link the calendar on your phone can follow',
    statements: [
      // One link each: the random part of its address, and which kinds of thing it carries (a JSON list).
      `CREATE TABLE calendar_feeds (
        owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        kinds TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      )`,
    ],
  },
  {
    number: 18,
    name: 'other calendars, followed by their link',
    statements: [
      // A calendar somewhere else. Its link is the key to it, so it is kept locked. `show` is how much of it
      // Life Is keeps: 'busy' (the times only) or 'titles'. `zone` is the time zone its times are shown in.
      `CREATE TABLE followed_calendars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        show TEXT NOT NULL DEFAULT 'busy' CHECK(show IN ('busy', 'titles')),
        zone TEXT NOT NULL DEFAULT 'UTC',
        fetched_at TEXT,
        problem TEXT,
        created_at TEXT NOT NULL
      )`,
      // What was last read from it, replaced whole each time. A 'busy' calendar's rows never have a title.
      `CREATE TABLE followed_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendar_id INTEGER NOT NULL REFERENCES followed_calendars(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        end_day TEXT,
        time TEXT,
        end_time TEXT,
        title TEXT
      )`,
      `CREATE INDEX idx_followed_events ON followed_events(calendar_id, day)`,
    ],
  },
  {
    // What a project is planned to cost and what it did cost, line by line. Money is whole cents.
    number: 19,
    name: 'what a project costs',
    statements: [
      `CREATE TABLE project_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        planned_cents INTEGER CHECK(planned_cents IS NULL OR planned_cents >= 0),
        actual_cents INTEGER CHECK(actual_cents IS NULL OR actual_cents >= 0),
        paid_on TEXT,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_project_costs ON project_costs(project_id, sort_order)`,
    ],
  },
  {
    // Life is spending: an amount for each category each month, what was spent, and who a category is
    // shared with. Nobody but its owner sees a category unless it is shared with them by name.
    number: 20,
    name: 'spending: categories, what was spent, who sees it',
    statements: [
      `CREATE TABLE money_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        monthly_cents INTEGER NOT NULL DEFAULT 0 CHECK(monthly_cents >= 0),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_money_categories ON money_categories(owner_id, sort_order)`,
      `CREATE TABLE money_shares (
        category_id INTEGER NOT NULL REFERENCES money_categories(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (category_id, user_id)
      )`,
      `CREATE TABLE money_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES money_categories(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        cents INTEGER NOT NULL CHECK(cents >= 0),
        day TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_money_entries ON money_entries(category_id, day)`,
      `CREATE INDEX idx_money_entries_owner ON money_entries(owner_id, day)`,
    ],
  },
  {
    // A whole home inventoried: each thing can carry a Life Is sticker, the barcode printed on its box, and a
    // photo; it can belong to activities (Sewing, Camping); and it keeps a history of where it has been and
    // what it was used for. A book or film's copy keeps the same history.
    number: 21,
    name: 'stickers, barcodes, photos, activities and a history for each thing',
    statements: [
      `ALTER TABLE items ADD COLUMN code TEXT`,
      `CREATE UNIQUE INDEX idx_items_code ON items(code) WHERE code IS NOT NULL`,
      `ALTER TABLE items ADD COLUMN barcode TEXT`,
      `CREATE INDEX idx_items_barcode ON items(owner_id, barcode)`,
      `CREATE TABLE item_photos (
        item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        bytes BLOB NOT NULL
      )`,
      `CREATE TABLE item_activities (
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        activity TEXT NOT NULL,
        key TEXT NOT NULL,
        PRIMARY KEY (item_id, key)
      )`,
      // Where a place is written as it was then ("Leo's room › Shelf"), so the history still reads right after a
      // place is renamed or removed. The same for a project's name.
      `CREATE TABLE item_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        copy_id INTEGER REFERENCES media_copies(id) ON DELETE CASCADE,
        what TEXT NOT NULL CHECK(what IN ('added', 'moved', 'used')),
        from_place TEXT,
        to_place TEXT,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        project TEXT,
        activity TEXT,
        day TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        CHECK ((item_id IS NULL) != (copy_id IS NULL))
      )`,
      `CREATE INDEX idx_item_history_item ON item_history(item_id, id)`,
      `CREATE INDEX idx_item_history_copy ON item_history(copy_id, id)`,
    ],
  },
  {
    // Upkeep: jobs that come round again (the furnace filter every three months, the oil every 5,000 miles),
    // with the tools they need and the supplies they use up, the thing they're for, who usually does them, and
    // each time they were done. A reading (an odometer, an hour meter) is kept on the thing it's read from, so
    // every job for that thing knows it.
    number: 22,
    name: 'upkeep: jobs that come round again, their tools and supplies, and each time they were done',
    statements: [
      `CREATE TABLE upkeep_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        activity TEXT,
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        every_n INTEGER CHECK(every_n IS NULL OR every_n > 0),
        every_unit TEXT CHECK(every_unit IS NULL OR every_unit IN ('day', 'week', 'month', 'year')),
        every_reading REAL CHECK(every_reading IS NULL OR every_reading > 0),
        reading_unit TEXT,
        first_due TEXT,
        assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
        steps TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_upkeep_jobs_owner ON upkeep_jobs(owner_id)`,
      `CREATE INDEX idx_upkeep_jobs_assigned ON upkeep_jobs(assigned_to)`,
      `CREATE TABLE upkeep_tools (
        job_id INTEGER NOT NULL REFERENCES upkeep_jobs(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (job_id, item_id)
      )`,
      `CREATE TABLE upkeep_supplies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES upkeep_jobs(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        quantity REAL CHECK(quantity IS NULL OR quantity > 0),
        unit TEXT,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_upkeep_supplies ON upkeep_supplies(job_id, sort_order)`,
      `CREATE TABLE upkeep_done (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES upkeep_jobs(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reading REAL,
        minutes INTEGER CHECK(minutes IS NULL OR minutes >= 0),
        cost_cents INTEGER CHECK(cost_cents IS NULL OR cost_cents >= 0),
        money_entry_id INTEGER REFERENCES money_entries(id) ON DELETE SET NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_upkeep_done ON upkeep_done(job_id, day)`,
      // An odometer or hour meter read on a day: on the thing it's read from, or on a job that's for no thing.
      `CREATE TABLE readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES upkeep_jobs(id) ON DELETE CASCADE,
        value REAL NOT NULL,
        day TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_readings_item ON readings(item_id, day)`,
      `CREATE INDEX idx_readings_job ON readings(job_id, day)`,
      // A tool's history can say which upkeep job it was used for.
      `ALTER TABLE item_history ADD COLUMN job_id INTEGER REFERENCES upkeep_jobs(id) ON DELETE SET NULL`,
      `ALTER TABLE item_history ADD COLUMN job TEXT`,
    ],
  },
  {
    // Browsers that asked to be sent reminders: where to send each (the browser maker's push address) and the
    // keys that lock the message so only that browser can read it.
    number: 23,
    name: 'browsers that get reminders',
    statements: [
      `CREATE TABLE push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id)`,
    ],
  },
  {
    // Home records: what a thing cost and where it came from, the numbers that identify it, how long its
    // warranty runs and what it's worth now; and its papers (a receipt, the manual), kept here as files.
    number: 24,
    name: 'home records: what things cost, their serial numbers, warranties and papers',
    statements: [
      `ALTER TABLE items ADD COLUMN bought_on TEXT`,
      `ALTER TABLE items ADD COLUMN bought_at TEXT`,
      `ALTER TABLE items ADD COLUMN price_cents INTEGER CHECK(price_cents IS NULL OR price_cents >= 0)`,
      `ALTER TABLE items ADD COLUMN value_cents INTEGER CHECK(value_cents IS NULL OR value_cents >= 0)`,
      `ALTER TABLE items ADD COLUMN serial TEXT`,
      `ALTER TABLE items ADD COLUMN model TEXT`,
      `ALTER TABLE items ADD COLUMN warranty_until TEXT`,
      `CREATE TABLE item_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('receipt', 'manual', 'warranty', 'other')),
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_item_documents ON item_documents(item_id)`,
    ],
  },
  {
    // Upkeep grows to the rest of what comes round in a household: bills and renewals, which stay on their
    // date and have an amount, and chores, which carry points for whoever does them.
    number: 25,
    name: 'bills, renewals and chores, beside upkeep jobs',
    statements: [
      `ALTER TABLE upkeep_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'job' CHECK(kind IN ('job', 'bill', 'renewal', 'chore'))`,
      `ALTER TABLE upkeep_jobs ADD COLUMN amount_cents INTEGER CHECK(amount_cents IS NULL OR amount_cents >= 0)`,
      `ALTER TABLE upkeep_jobs ADD COLUMN points INTEGER CHECK(points IS NULL OR points >= 0)`,
      `ALTER TABLE upkeep_jobs ADD COLUMN autopay INTEGER NOT NULL DEFAULT 0 CHECK(autopay IN (0, 1))`,
      `ALTER TABLE upkeep_done ADD COLUMN points INTEGER`,
    ],
  },
  {
    // Pets: who they are and who looks after them (the vet, the microchip), a photo, how their weight goes,
    // and their care, which is upkeep that belongs to a pet.
    number: 26,
    name: 'pets, and the care that belongs to each',
    statements: [
      `CREATE TABLE pets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        species TEXT,
        breed TEXT,
        born_on TEXT,
        microchip TEXT,
        vet_name TEXT,
        vet_phone TEXT,
        food TEXT,
        note TEXT,
        photo_type TEXT,
        photo BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_pets_owner ON pets(owner_id)`,
      `CREATE TABLE pet_weights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        value REAL NOT NULL CHECK(value > 0),
        unit TEXT NOT NULL
      )`,
      `CREATE INDEX idx_pet_weights ON pet_weights(pet_id, day)`,
      `ALTER TABLE upkeep_jobs ADD COLUMN pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE`,
    ],
  },
  {
    // The house manual: what someone else needs to know to look after the home, and a link to share it by
    // that needs no sign-in and stops working on a chosen day.
    number: 27,
    name: 'the house manual, and a link to share it by',
    statements: [
      `CREATE TABLE manual_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        section TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        phone TEXT,
        place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
        private INTEGER NOT NULL DEFAULT 0 CHECK(private IN (0, 1)),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_manual_entries ON manual_entries(owner_id, sort_order)`,
      `CREATE TABLE manual_shares (
        owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_on TEXT,
        pets INTEGER NOT NULL DEFAULT 1 CHECK(pets IN (0, 1)),
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    // Moving and packing: a place can be a box, which says how far along it is and which room it's going to.
    number: 28,
    name: 'boxes, for moving and packing',
    statements: [
      `ALTER TABLE places ADD COLUMN box_state TEXT CHECK(box_state IS NULL OR box_state IN ('packing', 'packed', 'moved', 'unpacked'))`,
      `ALTER TABLE places ADD COLUMN box_destination TEXT`,
    ],
  },
  {
    // People in the household who have no sign-in of their own (children, mostly): they can be given chores
    // and collect the points for doing them.
    number: 29,
    name: 'people in the household without a sign-in, for chores',
    statements: [
      `CREATE TABLE household_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_household_members ON household_members(owner_id)`,
      `ALTER TABLE upkeep_jobs ADD COLUMN assigned_member INTEGER REFERENCES household_members(id) ON DELETE SET NULL`,
      // Their name is kept beside who they were, so a week's points still read right after someone is removed.
      `ALTER TABLE upkeep_done ADD COLUMN done_member INTEGER REFERENCES household_members(id) ON DELETE SET NULL`,
      `ALTER TABLE upkeep_done ADD COLUMN done_name TEXT`,
    ],
  },
  {
    // Cataloguing books kept elsewhere: a link on a copy that opens it where it lives (Kindle, Apple Books, a
    // server of your own), and book servers to bring a library in from (Audiobookshelf, Calibre-Web, Kavita,
    // or any OPDS catalogue). How each signs in differs, so the sign-in is stored locked, as one piece.
    number: 30,
    name: 'a link on each copy, and book servers to bring a library in from',
    statements: [
      `ALTER TABLE media_copies ADD COLUMN link TEXT`,
      `CREATE TABLE library_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT,
        every_hours INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        last_ok INTEGER,
        last_message TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_library_sources ON library_sources(owner_id)`,
      `ALTER TABLE media_copies ADD COLUMN library_source_id INTEGER REFERENCES library_sources(id) ON DELETE SET NULL`,
      `CREATE INDEX idx_media_copies_library ON media_copies(library_source_id, source_id)`,
    ],
  },
  {
    // American spellings for the ready-made kinds: Colour, Fibre, Colourway, Colour name and Colour code lose
    // the u (and the i), and Aluminium becomes Aluminum. Only fields named exactly that are renamed, and not
    // where the same kind already has a field with the new name. The choice is renamed as a whole entry in the
    // list of choices, and in what was chosen, so a word that merely contains it is left alone.
    number: 31,
    name: 'American spellings for the ready-made kinds',
    statements: [
      `UPDATE item_values SET value = 'Aluminum'
        WHERE value = 'Aluminium' AND field_id IN (SELECT id FROM kind_fields WHERE type = 'choice')`,
      `UPDATE kind_fields SET choices = REPLACE(choices, '"Aluminium"', '"Aluminum"')
        WHERE type = 'choice' AND choices LIKE '%"Aluminium"%'
          AND NOT (choices LIKE '%"Aluminum"%')`,
      ...[['Colour', 'Color'], ['Fibre', 'Fiber'], ['Colourway', 'Colorway'], ['Colour name', 'Color name'], ['Colour code', 'Color code']].map(
        ([from, to]) => `UPDATE kind_fields SET name = '${to}'
          WHERE name = '${from}'
            AND NOT EXISTS (SELECT 1 FROM kind_fields other WHERE other.kind_id = kind_fields.kind_id AND other.name = '${to}')`,
      ),
    ],
  },
  {
    // Recall alerts for cars: the recalls NHTSA lists for a car's make, model and year, each kept once per car
    // (so one the person has dismissed stays dismissed), and what the last check of each car found.
    number: 32,
    name: 'Recall alerts for cars',
    statements: [
      `CREATE TABLE vehicle_recalls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        campaign TEXT NOT NULL,
        component TEXT,
        summary TEXT,
        consequence TEXT,
        remedy TEXT,
        park_it INTEGER NOT NULL DEFAULT 0,
        park_outside INTEGER NOT NULL DEFAULT 0,
        over_the_air INTEGER NOT NULL DEFAULT 0,
        reported_on TEXT,
        looked_up TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        dismissed_at TEXT,
        UNIQUE (owner_id, item_id, campaign)
      )`,
      `CREATE INDEX idx_vehicle_recalls_item ON vehicle_recalls(item_id)`,
      `CREATE TABLE recall_checks (
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        looked_up TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        result TEXT NOT NULL CHECK(result IN ('ok', 'not_listed', 'failed')),
        message TEXT,
        PRIMARY KEY (owner_id, item_id)
      )`,
    ],
  },
  {
    // Three small things. A copy of a book or album can say how many discs or tapes it is. A kind of thing
    // can name the activity its things are for ("Car & mechanics"), so new things of that kind show up as gear
    // for projects of that kind without being tagged one by one. And licenses and permits get a place of their
    // own: whose it is, its number, who gave it, and when it runs out. A license can be tied to the renewal
    // in upkeep that reminds you of it; if that renewal is removed, the license stays.
    number: 33,
    name: 'how many discs a copy is, the activity a kind is for, and licenses',
    statements: [
      `ALTER TABLE media_copies ADD COLUMN pieces INTEGER`,
      `ALTER TABLE kinds ADD COLUMN activity TEXT`,
      `CREATE TABLE licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT,
        holder TEXT,
        number TEXT,
        issuer TEXT,
        issued_on TEXT,
        expires_on TEXT,
        note TEXT,
        job_id INTEGER REFERENCES upkeep_jobs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_licenses_owner ON licenses(owner_id, expires_on)`,
    ],
  },
  {
    // A second step at sign-in. Two-step sign-in with an authenticator app: the app's secret is kept locked
    // (never in the clear), with the last 30-second step accepted so a code works once. Recovery codes are kept
    // only as hashes. Passkeys keep each one's public key, never anything that could sign. A challenge is a
    // short-lived, single-use random value (a sign-in waiting for its code, or a passkey waiting for the device).
    number: 34,
    name: 'two-step sign-in, recovery codes and passkeys',
    statements: [
      `CREATE TABLE user_security (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        totp_secret TEXT,
        totp_last_step INTEGER NOT NULL DEFAULT 0,
        webauthn_handle TEXT,
        notice TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id)`,
      `CREATE TABLE passkeys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        backed_up INTEGER NOT NULL DEFAULT 0,
        multi_device INTEGER NOT NULL DEFAULT 0,
        rp_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        flagged_at TEXT
      )`,
      `CREATE INDEX idx_passkeys_user ON passkeys(user_id)`,
      `CREATE TABLE auth_challenges (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        data TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    ],
  },
  {
    // A recipe can keep one picture, the way a thing keeps a photo: its type, its bytes, and when it was added.
    number: 35,
    name: 'a picture for a recipe',
    statements: [
      `CREATE TABLE recipe_photos (
        recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        added_at TEXT NOT NULL
      )`,
    ],
  },
  {
    // What a copy of a film, record or book cost and what it is worth now, typed by the person (never looked up), in cents.
    number: 36,
    name: 'what a copy cost and is worth',
    statements: [
      `ALTER TABLE media_copies ADD COLUMN cost_cents INTEGER`,
      `ALTER TABLE media_copies ADD COLUMN bought_on TEXT`,
      `ALTER TABLE media_copies ADD COLUMN value_cents INTEGER`,
      `ALTER TABLE media_copies ADD COLUMN valued_on TEXT`,
    ],
  },
  {
    // A bed size: "Cot" becomes "Crib", the American word, on the list of sizes and in what was chosen.
    // Only choice fields are changed, and a list that already has "Crib" is left as it is.
    number: 37,
    name: 'Crib, not cot, for bed sizes',
    statements: [
      `UPDATE item_values SET value = 'Crib'
        WHERE value = 'Cot' AND field_id IN (SELECT id FROM kind_fields WHERE type = 'choice')`,
      `UPDATE kind_fields SET choices = REPLACE(choices, '"Cot"', '"Crib"')
        WHERE type = 'choice' AND choices LIKE '%"Cot"%'
          AND NOT (choices LIKE '%"Crib"%')`,
    ],
  },
  {
    // "Knitting & crochet" becomes "Yarn crafts" (it takes in macrame too). Kinds, things, projects and upkeep
    // that said the old name say the new one, so old things still show as gear on yarn projects. A thing that
    // already had both keeps one. The history is left as it was written.
    number: 38,
    name: 'Yarn crafts, not Knitting & crochet',
    statements: [
      `UPDATE kinds SET activity = 'Yarn crafts' WHERE activity = 'Knitting & crochet' COLLATE NOCASE`,
      `UPDATE OR IGNORE item_activities SET activity = 'Yarn crafts', key = 'yarn crafts' WHERE key = 'knitting & crochet'`,
      `DELETE FROM item_activities WHERE key = 'knitting & crochet'`,
      `UPDATE projects SET activity = 'Yarn crafts' WHERE activity = 'Knitting & crochet' COLLATE NOCASE`,
      `UPDATE upkeep_jobs SET activity = 'Yarn crafts' WHERE activity = 'Knitting & crochet' COLLATE NOCASE`,
    ],
  },
  {
    // Tags: one list for the household, nesting like Kitchen > Appliances, put on things, recipes, projects, plans,
    // spending, titles, pets, upkeep jobs and calendar dates. A link names the kind of thing and its id; there is no
    // foreign key to the thing (the kinds live in many tables), so the code takes a thing's links away when it is
    // removed and every read joins the thing, so a stray link never shows. Recipe tags were a comma list of words:
    // each distinct word becomes one top-level tag for its owner, linked to the recipes that had it. The old
    // recipes.tags column is left where it is and no longer read.
    number: 39,
    name: 'tags',
    statements: [
      `CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        parent_id INTEGER REFERENCES tags(id),
        created_at TEXT NOT NULL
      )`,
      // NULL parents are never equal in a unique index, so top-level tags are keyed under 0.
      `CREATE UNIQUE INDEX idx_tags_key ON tags(owner_id, COALESCE(parent_id, 0), key)`,
      `CREATE INDEX idx_tags_parent ON tags(parent_id)`,
      `CREATE TABLE tag_links (
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        PRIMARY KEY (tag_id, kind, target_id)
      )`,
      `CREATE INDEX idx_tag_links_target ON tag_links(kind, target_id)`,
      `INSERT INTO tags (owner_id, name, key, parent_id, created_at)
        WITH RECURSIVE split(owner_id, word, rest) AS (
          SELECT owner_id, '', tags || ',' FROM recipes WHERE tags IS NOT NULL AND tags <> ''
          UNION ALL
          SELECT owner_id, TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1)), SUBSTR(rest, INSTR(rest, ',') + 1) FROM split WHERE rest <> ''
        )
        SELECT owner_id, SUBSTR(MIN(word), 1, 40), LOWER(SUBSTR(MIN(word), 1, 40)), NULL, strftime('%Y-%m-%dT%H:%M:%S', 'now') || '+00:00'
        FROM split WHERE word <> '' GROUP BY owner_id, LOWER(SUBSTR(word, 1, 40))`,
      `INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id)
        WITH RECURSIVE split(recipe_id, owner_id, word, rest) AS (
          SELECT id, owner_id, '', tags || ',' FROM recipes WHERE tags IS NOT NULL AND tags <> ''
          UNION ALL
          SELECT recipe_id, owner_id, TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1)), SUBSTR(rest, INSTR(rest, ',') + 1) FROM split WHERE rest <> ''
        )
        SELECT t.id, 'recipe', s.recipe_id FROM split s
        JOIN tags t ON t.owner_id = s.owner_id AND t.parent_id IS NULL AND t.key = LOWER(SUBSTR(s.word, 1, 40))
        WHERE s.word <> ''`,
    ],
  },
  {
    // Life is budgeted: what comes in (with how often), savings goals, and the money put toward each. Bills are not
    // here: they stay upkeep jobs of kind 'bill'. Each row is its owner's alone.
    number: 40,
    name: 'budget: income, savings goals and what was put toward them',
    statements: [
      `CREATE TABLE money_income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cents INTEGER NOT NULL CHECK(cents >= 0),
        every TEXT NOT NULL CHECK(every IN ('weekly', 'biweekly', 'twice_monthly', 'monthly', 'yearly', 'once')),
        start_day TEXT,
        end_day TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_money_income ON money_income(owner_id)`,
      `CREATE TABLE money_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_cents INTEGER NOT NULL CHECK(target_cents > 0),
        by_day TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_money_goals ON money_goals(owner_id)`,
      `CREATE TABLE money_goal_saved (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL REFERENCES money_goals(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        cents INTEGER NOT NULL CHECK(cents <> 0),
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_money_goal_saved ON money_goal_saved(goal_id, day)`,
    ],
  },
  {
    // Reading bank accounts through SimpleFIN, read-only. One connection per person, with its access address kept
    // sealed (never readable by a page). The accounts it lists are kept so the person can choose which to bring
    // in, and into which category. An entry brought in remembers its SimpleFIN account and transaction, so the
    // same transaction is never brought in twice.
    number: 41,
    name: 'reading bank accounts through SimpleFIN',
    statements: [
      `CREATE TABLE simplefin_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        access TEXT NOT NULL,
        host TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        last_read_at TEXT
      )`,
      `CREATE TABLE simplefin_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id INTEGER NOT NULL REFERENCES simplefin_connections(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        org TEXT,
        currency TEXT,
        balance_cents INTEGER,
        chosen INTEGER NOT NULL DEFAULT 0 CHECK(chosen IN (0, 1)),
        category_id INTEGER REFERENCES money_categories(id) ON DELETE SET NULL,
        UNIQUE(connection_id, account_id)
      )`,
      `ALTER TABLE money_entries ADD COLUMN bank_account TEXT`,
      `ALTER TABLE money_entries ADD COLUMN bank_txn TEXT`,
      `CREATE UNIQUE INDEX idx_money_entries_bank ON money_entries(owner_id, bank_account, bank_txn)`,
    ],
  },
  {
    // Prep reminders: steps worked out from when a meal is eaten ("thaw the chicken the night before"). A step
    // belongs to a recipe (so it applies every time the recipe is planned) or to one planned meal (a one-off).
    // A meal may have its own time to eat. prep_sent remembers which reminders went, so each goes once.
    number: 42,
    name: 'prep reminders on recipes and planned meals',
    statements: [
      `ALTER TABLE meal_plan ADD COLUMN eat_time TEXT`,
      `CREATE TABLE prep_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
        meal_plan_id INTEGER REFERENCES meal_plan(id) ON DELETE CASCADE,
        words TEXT NOT NULL,
        rule TEXT NOT NULL CHECK(rule IN ('night_before', 'morning_of', 'hours_before')),
        at_time TEXT,
        hours INTEGER CHECK(hours IS NULL OR (hours >= 1 AND hours <= 72)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        CHECK((recipe_id IS NULL) <> (meal_plan_id IS NULL))
      )`,
      `CREATE INDEX idx_prep_steps_recipe ON prep_steps(recipe_id)`,
      `CREATE INDEX idx_prep_steps_meal ON prep_steps(meal_plan_id)`,
      `CREATE TABLE prep_sent (
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, key)
      )`,
    ],
  },
  {
    // Routines: checklists for parts of the day ("Morning"), each with times and steps. A routine belongs to one
    // person with a sign-in (for_user), to a household member without one (for_member), or to everyone (neither).
    // Steps can be every day, on chosen weekdays, or on one night of a cycle that only moves on when that time
    // was finished. routine_ticks and routine_finished remember each day; routine_sent, reminders already sent.
    number: 43,
    name: 'routines: times of day with steps, ticked each day',
    statements: [
      `CREATE TABLE routines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        for_user INTEGER REFERENCES users(id) ON DELETE CASCADE,
        for_member INTEGER REFERENCES household_members(id) ON DELETE CASCADE,
        cycle_length INTEGER CHECK(cycle_length IS NULL OR (cycle_length >= 2 AND cycle_length <= 14)),
        points INTEGER CHECK(points IS NULL OR points >= 0),
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(for_user IS NULL OR for_member IS NULL)
      )`,
      `CREATE INDEX idx_routines_owner ON routines(owner_id)`,
      `CREATE TABLE routine_times (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        at_time TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_routine_times ON routine_times(routine_id)`,
      `CREATE TABLE routine_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time_id INTEGER NOT NULL REFERENCES routine_times(id) ON DELETE CASCADE,
        words TEXT NOT NULL,
        rule TEXT NOT NULL DEFAULT 'daily' CHECK(rule IN ('daily', 'weekdays', 'cycle')),
        weekdays TEXT,
        night INTEGER CHECK(night IS NULL OR (night >= 1 AND night <= 14)),
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        wait_seconds INTEGER CHECK(wait_seconds IS NULL OR (wait_seconds >= 1 AND wait_seconds <= 3600)),
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_routine_steps_time ON routine_steps(time_id)`,
      `CREATE INDEX idx_routine_steps_item ON routine_steps(item_id)`,
      `CREATE TABLE routine_ticks (
        step_id INTEGER NOT NULL REFERENCES routine_steps(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        by_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (step_id, day)
      )`,
      `CREATE TABLE routine_finished (
        time_id INTEGER NOT NULL REFERENCES routine_times(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        night INTEGER,
        points INTEGER,
        by_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (time_id, day)
      )`,
      `CREATE TABLE routine_sent (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      )`,
    ],
  },
  {
    // Budget with projects and grocery trips. A paid project cost is also a spending entry (project_id, project_cost_id),
    // so the budget reads one place; paid costs already there get their entry here, once. A savings goal can be for a
    // project (money_goals.project_id), and paying a cost can draw from it (money_goal_saved.cost_id). A grocery line can
    // be moved to another store (grocery.store). A trip is one visit to a store, with the receipt total; the entries
    // it made carry trip_id, and a bank charge that matches it is not counted again. No REFERENCES on the added
    // columns: what they point at is cleaned up in code.
    number: 44,
    name: 'budget with projects and grocery trips',
    statements: [
      `ALTER TABLE money_entries ADD COLUMN project_id INTEGER`,
      `ALTER TABLE money_entries ADD COLUMN project_cost_id INTEGER`,
      `ALTER TABLE money_entries ADD COLUMN trip_id INTEGER`,
      `CREATE UNIQUE INDEX idx_money_entries_cost ON money_entries(project_cost_id) WHERE project_cost_id IS NOT NULL`,
      `INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at, project_id, project_cost_id)
        SELECT p.owner_id, NULL, k.label, k.actual_cents, k.paid_on, NULL, strftime('%Y-%m-%dT%H:%M:%S', 'now') || '+00:00', p.id, k.id
        FROM project_costs k JOIN projects p ON p.id = k.project_id WHERE k.paid_on IS NOT NULL AND k.actual_cents IS NOT NULL`,
      `ALTER TABLE money_goals ADD COLUMN project_id INTEGER`,
      `ALTER TABLE money_goal_saved ADD COLUMN cost_id INTEGER`,
      `ALTER TABLE grocery ADD COLUMN store TEXT`,
      `CREATE TABLE shopping_trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        store TEXT NOT NULL,
        day TEXT NOT NULL,
        estimate_cents INTEGER CHECK(estimate_cents IS NULL OR estimate_cents >= 0),
        total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
        matched INTEGER NOT NULL DEFAULT 0 CHECK(matched IN (0, 1)),
        bank_account TEXT,
        bank_txn TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_shopping_trips ON shopping_trips(owner_id, day)`,
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
