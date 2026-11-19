"""
The database's shape, version by version.

Each migration runs once, in order, inside a transaction, and the database remembers the last one it ran
(PRAGMA user_version). A shipped migration is never edited: a change is always a new one at the end.
Before an upgrade of a database that has something in it, a copy is saved next to it.
"""

import logging
import os

import dbfile as sqlite3

log = logging.getLogger("lifeis.migrations")


def _m1_foundation(conn):
    """Logins, sessions, settings and the login throttle."""
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_seen_at TEXT,
            method TEXT,
            ip TEXT,
            user_agent TEXT,
            device_hash TEXT
        )
    """)
    conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("""
        CREATE TABLE user_settings (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY (user_id, key)
        )
    """)
    conn.execute("""
        CREATE TABLE login_throttle (
            key TEXT PRIMARY KEY,
            failures INTEGER NOT NULL,
            locked_until REAL NOT NULL DEFAULT 0,
            updated_at REAL NOT NULL
        )
    """)


def _m2_kitchen(conn):
    """The kitchen: ingredients shared by recipes, the pantry and the grocery list; recipes kept word for word;
    the week's meals; and the grocery list."""
    conn.execute("""
        CREATE TABLE ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            key TEXT NOT NULL,
            aisle TEXT,
            UNIQUE (owner_id, key)
        )
    """)
    conn.execute("""
        CREATE TABLE recipes (
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
        )
    """)
    conn.execute("CREATE INDEX idx_recipes_owner ON recipes(owner_id, title)")
    conn.execute("""
        CREATE TABLE recipe_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            part TEXT NOT NULL CHECK(part IN ('ingredients', 'steps')),
            is_heading INTEGER NOT NULL DEFAULT 0,
            text TEXT NOT NULL,
            quantity REAL,
            unit TEXT,
            ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
            sort_order INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX idx_recipe_lines ON recipe_lines(recipe_id, part, sort_order)")
    conn.execute("""
        CREATE TABLE pantry (
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
        )
    """)
    conn.execute("""
        CREATE TABLE meal_plan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day TEXT NOT NULL,
            meal TEXT NOT NULL DEFAULT 'dinner' CHECK(meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
            recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
            title TEXT,
            servings REAL CHECK(servings IS NULL OR servings > 0),
            cooked_on TEXT,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX idx_meal_plan ON meal_plan(owner_id, day)")
    conn.execute("""
        CREATE TABLE grocery (
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
        )
    """)
    conn.execute("CREATE INDEX idx_grocery_owner ON grocery(owner_id, done)")


MIGRATIONS = [
    (1, "logins, sessions and settings", _m1_foundation),
    (2, "the kitchen", _m2_kitchen),
]
LATEST = MIGRATIONS[-1][0]


def current_version(conn) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def _has_data(conn) -> bool:
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    return "users" in tables and bool(conn.execute("SELECT 1 FROM users LIMIT 1").fetchone())


def _save_copy(conn, db_path: str, target: int) -> str:
    copy_path = os.path.join(os.path.dirname(db_path), f"lifeis.before-v{target}.db")
    if os.path.exists(copy_path):
        os.replace(copy_path, copy_path + ".old")
    dest = sqlite3.connect(copy_path)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    return copy_path


def run(db_path: str) -> int:
    """Bring the database at db_path up to date. Returns the version it ends at."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    sqlite3.encrypt_folder(os.path.dirname(db_path))
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    try:
        version = current_version(conn)
        if version > LATEST:
            raise RuntimeError(f"This database is version {version}, but this copy of Life Is only knows up to {LATEST}. "
                               "Update Life Is, or restore the copy made before the upgrade.")
        pending = [m for m in MIGRATIONS if m[0] > version]
        if not pending:
            return version
        if _has_data(conn):
            log.warning("Upgrading the database from v%s to v%s. A copy was saved at %s", version, LATEST,
                        _save_copy(conn, db_path, LATEST))
        conn.execute("PRAGMA foreign_keys = ON")
        for number, name, migrate in pending:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if current_version(conn) >= number:
                    conn.execute("ROLLBACK")
                    continue
                migrate(conn)
                conn.execute(f"PRAGMA user_version = {number}")
                conn.execute("COMMIT")
                log.info("Database migration %s applied: %s", number, name)
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return current_version(conn)
    finally:
        conn.close()
