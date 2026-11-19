"""
The kitchen: recipes, the week's meals, the pantry and the grocery list, all linked by one list of ingredients.

The promise about recipes: they are kept exactly as you wrote them. Every ingredient line and every step is
stored word for word, with section headings ("For the sauce") where you put them, and the original text of an
imported recipe is kept beside it. Nothing here shortens, summarises or rewrites a recipe. Reading an
ingredient line ("1 1/2 cups flour, sifted") only works out the amount and the ingredient, so the pantry and
the grocery list know it's flour; the words stay yours.

How the pieces connect:
- "Flour" in a recipe, in the pantry and on the grocery list is one ingredient.
- The grocery list from the week's meals is what the recipes need, scaled to the servings you plan, minus
  what the pantry already has. Amounts in units of the same kind are added and taken away (grams and pounds,
  cups and spoons); amounts that can't be compared are listed in full, marked so.
- Ticking something off with "put away" adds it to the pantry. Marking a meal as cooked takes what it used
  out of the pantry.

Recipes can be brought in by pasting text, or as schema.org recipe JSON (what the Nextcloud Cookbook app and
most recipe sites use), and are given back the same way: a zip of Nextcloud Cookbook folders.
"""

import io
import json
import re
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Callable, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

import units

router = APIRouter(prefix="/api/kitchen")
_get_db: Optional[Callable] = None

MEALS = ("breakfast", "lunch", "dinner", "snack")
LOCATIONS = ("fridge", "freezer", "pantry", "spices", "other")
TEXT_LIMIT = 200_000            # a recipe's text: long enough for anything real
MAX_LINES = 500


def setup(get_db: Callable):
    global _get_db
    _get_db = get_db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(text: Optional[str], limit: int = 2000) -> Optional[str]:
    return (text or "").strip()[:limit] or None


def _owner(request: Request) -> int:
    return request.state.user["id"]


class _Db:
    """`with _Db() as db:` opens a connection and always closes it."""

    def __enter__(self):
        self.db = _get_db()
        return self.db

    def __exit__(self, *exc):
        self.db.close()


# ==================== INGREDIENTS ====================

def ingredient_id(db, owner: int, name: str) -> Optional[int]:
    """The ingredient with this name (made the first time it's seen), or None for an empty name."""
    key = units.name_key(name)
    if not key:
        return None
    r = db.execute("SELECT id FROM ingredients WHERE owner_id = ? AND key = ?", (owner, key)).fetchone()
    if r:
        return r["id"]
    return db.execute("INSERT INTO ingredients (owner_id, name, key) VALUES (?, ?, ?)",
                      (owner, name.strip()[:120], key)).lastrowid


@router.get("/ingredients")
def list_ingredients(request: Request):
    with _Db() as db:
        return [dict(r) for r in db.execute("SELECT id, name, aisle FROM ingredients WHERE owner_id = ? ORDER BY name COLLATE NOCASE",
                                            (_owner(request),))]


class IngredientIn(BaseModel):
    name: Optional[str] = None
    aisle: Optional[str] = None


@router.put("/ingredients/{iid}")
def update_ingredient(iid: int, body: IngredientIn, request: Request):
    """Rename an ingredient, or say which aisle it's in (the grocery list is sorted by aisle)."""
    owner = _owner(request)
    with _Db() as db:
        r = db.execute("SELECT * FROM ingredients WHERE id = ? AND owner_id = ?", (iid, owner)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Not found")
        name = _clean(body.name, 120) or r["name"]
        key = units.name_key(name)
        other = db.execute("SELECT id FROM ingredients WHERE owner_id = ? AND key = ? AND id != ?", (owner, key, iid)).fetchone()
        if other:
            raise HTTPException(status_code=409, detail="You already have an ingredient by that name")
        db.execute("UPDATE ingredients SET name = ?, key = ?, aisle = ? WHERE id = ?",
                   (name, key, _clean(body.aisle, 60) if body.aisle is not None else r["aisle"], iid))
        db.commit()
        return dict(db.execute("SELECT id, name, aisle FROM ingredients WHERE id = ?", (iid,)).fetchone())


# ==================== RECIPES ====================

def _split_lines(text: Optional[str], part: str) -> List[dict]:
    """One line per ingredient, or one paragraph per step. A line starting with "#" (or ending in ":" on its own,
    for ingredients) is a section heading. Text is kept exactly, apart from the "#" and blank lines."""
    if not text:
        return []
    if part == "steps":
        chunks = [c.strip("\n") for c in re.split(r"\n\s*\n", text.replace("\r\n", "\n"))]
        # A pasted list with one step per line and no blank lines between: each line is a step.
        if len(chunks) == 1 and "\n" in chunks[0]:
            chunks = chunks[0].split("\n")
    else:
        chunks = text.replace("\r\n", "\n").split("\n")
    if part == "steps":
        # A heading written straight above its first step ("# Layering" then the step on the next line).
        split = []
        for c in chunks:
            first, _, rest = c.strip("\n").partition("\n")
            if first.strip().startswith("#") and rest.strip():
                split += [first, rest]
            else:
                split.append(c)
        chunks = split
    out = []
    for c in chunks:
        if not c.strip():
            continue
        stripped = c.strip()
        if stripped.startswith("#"):
            out.append({"text": stripped.lstrip("#").strip(), "is_heading": True})
        elif part == "ingredients" and stripped.endswith(":") and len(stripped) < 60 and not units.parse_line(stripped)["quantity"]:
            out.append({"text": stripped[:-1].strip(), "is_heading": True})
        else:
            out.append({"text": c.strip() if part == "ingredients" else c.rstrip(), "is_heading": False})
    return out[:MAX_LINES]


def _save_lines(db, owner: int, recipe_id: int, ingredients: List[dict], steps: List[dict]):
    db.execute("DELETE FROM recipe_lines WHERE recipe_id = ?", (recipe_id,))
    for part, rows in (("ingredients", ingredients), ("steps", steps)):
        for i, row in enumerate(rows):
            quantity = unit = iid = None
            if part == "ingredients" and not row["is_heading"]:
                parsed = units.parse_line(row["text"])
                quantity, unit = parsed["quantity"], parsed["unit"]
                iid = ingredient_id(db, owner, parsed["name"])
            db.execute("INSERT INTO recipe_lines (recipe_id, part, is_heading, text, quantity, unit, ingredient_id, sort_order) "
                       "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                       (recipe_id, part, int(row["is_heading"]), row["text"][:5000], quantity, unit, iid, i))


def lines_as_text(lines: List[dict], part: str) -> str:
    """The editable text of a recipe's ingredients or steps, exactly as stored."""
    out = [("# " + l["text"]) if l["is_heading"] else l["text"] for l in lines if l["part"] == part]
    return ("\n" if part == "ingredients" else "\n\n").join(out)


def _recipe(db, owner: int, rid: int, servings: Optional[float] = None) -> dict:
    r = db.execute("SELECT * FROM recipes WHERE id = ? AND owner_id = ?", (rid, owner)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    d = dict(r)
    lines = [dict(l) for l in db.execute("""
        SELECT l.*, i.name AS ingredient FROM recipe_lines l LEFT JOIN ingredients i ON i.id = l.ingredient_id
        WHERE l.recipe_id = ? ORDER BY l.part, l.sort_order
    """, (rid,))]
    factor = (servings / d["servings"]) if servings and d["servings"] else 1
    for l in lines:
        l["is_heading"] = bool(l["is_heading"])
        # Scaling shows a new amount next to the line; the line itself never changes.
        l["scaled"] = units.amount(l["quantity"] * factor, l["unit"]) if factor != 1 and l["quantity"] is not None else None
    d["ingredients"] = [l for l in lines if l["part"] == "ingredients"]
    d["steps"] = [l for l in lines if l["part"] == "steps"]
    d["ingredients_text"] = lines_as_text(lines, "ingredients")
    d["steps_text"] = lines_as_text(lines, "steps")
    d["showing_servings"] = servings or d["servings"]
    d["tags"] = [t for t in (d["tags"] or "").split(",") if t]
    return d


class RecipeIn(BaseModel):
    title: str
    description: Optional[str] = None
    servings: Optional[float] = None
    prep_minutes: Optional[int] = None
    cook_minutes: Optional[int] = None
    source_url: Optional[str] = None
    ingredients_text: Optional[str] = None     # one ingredient a line; "# For the sauce" starts a section
    steps_text: Optional[str] = None           # one step a paragraph
    notes: Optional[str] = None
    tags: List[str] = []
    original_text: Optional[str] = None        # what was pasted or imported, kept as it was


def _values(body: RecipeIn) -> tuple:
    title = _clean(body.title, 200)
    if not title:
        raise HTTPException(status_code=400, detail="Give the recipe a name")
    if body.servings is not None and not 0 < body.servings <= 1000:
        raise HTTPException(status_code=400, detail="Servings is a number above 0")
    for v in (body.prep_minutes, body.cook_minutes):
        if v is not None and not 0 <= v <= 100_000:
            raise HTTPException(status_code=400, detail="Times are in minutes")
    for text in (body.ingredients_text, body.steps_text, body.original_text, body.notes):
        if text and len(text) > TEXT_LIMIT:
            raise HTTPException(status_code=400, detail="That recipe is too long")
    tags = ",".join(sorted({t.strip().lower()[:40] for t in body.tags if t.strip()}))[:500] or None
    return (title, _clean(body.description, 5000), body.servings, body.prep_minutes, body.cook_minutes, _clean(body.source_url, 1000),
            body.original_text or None, body.notes.strip() if body.notes and body.notes.strip() else None, tags)


@router.get("/recipes")
def list_recipes(request: Request, q: Optional[str] = Query(None, max_length=100), tag: Optional[str] = Query(None, max_length=40)):
    owner = _owner(request)
    with _Db() as db:
        sql = "SELECT id, title, description, servings, prep_minutes, cook_minutes, tags, updated_at FROM recipes WHERE owner_id = ?"
        args: list = [owner]
        if q:
            sql += (" AND (title LIKE ? OR id IN (SELECT recipe_id FROM recipe_lines WHERE part = 'ingredients' AND text LIKE ?))")
            args += [f"%{q.strip()}%", f"%{q.strip()}%"]
        if tag:
            sql += " AND (',' || tags || ',') LIKE ?"
            args.append(f"%,{tag.strip().lower()},%")
        rows = [dict(r) for r in db.execute(sql + " ORDER BY title COLLATE NOCASE", args)]
        for r in rows:
            r["tags"] = [t for t in (r["tags"] or "").split(",") if t]
        return rows


@router.get("/recipes/{rid}")
def get_recipe(rid: int, request: Request, servings: Optional[float] = Query(None, gt=0, le=1000)):
    with _Db() as db:
        return _recipe(db, _owner(request), rid, servings)


@router.post("/recipes", status_code=201)
def create_recipe(body: RecipeIn, request: Request):
    owner = _owner(request)
    with _Db() as db:
        cur = db.execute("INSERT INTO recipes (title, description, servings, prep_minutes, cook_minutes, source_url, original_text, notes, tags, "
                         "owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (*_values(body), owner, _now(), _now()))
        _save_lines(db, owner, cur.lastrowid, _split_lines(body.ingredients_text, "ingredients"), _split_lines(body.steps_text, "steps"))
        db.commit()
        return _recipe(db, owner, cur.lastrowid)


@router.put("/recipes/{rid}")
def update_recipe(rid: int, body: RecipeIn, request: Request):
    owner = _owner(request)
    with _Db() as db:
        before = _recipe(db, owner, rid)
        values = list(_values(body))
        if values[6] is None:
            values[6] = before["original_text"]        # editing never throws away the original
        db.execute("UPDATE recipes SET title = ?, description = ?, servings = ?, prep_minutes = ?, cook_minutes = ?, source_url = ?, "
                   "original_text = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?", (*values, _now(), rid))
        _save_lines(db, owner, rid, _split_lines(body.ingredients_text, "ingredients"), _split_lines(body.steps_text, "steps"))
        db.commit()
        return _recipe(db, owner, rid)


@router.delete("/recipes/{rid}", status_code=204)
def delete_recipe(rid: int, request: Request):
    with _Db() as db:
        db.execute("DELETE FROM recipes WHERE id = ? AND owner_id = ?", (rid, _owner(request)))
        db.commit()


# ---------- bringing recipes in ----------

INGREDIENT_HEADS = re.compile(r"^\s*#*\s*(ingredients?)\s*:?\s*$", re.I)
STEP_HEADS = re.compile(r"^\s*#*\s*(instructions?|directions?|method|steps?|preparation)\s*:?\s*$", re.I)
NOTE_HEADS = re.compile(r"^\s*#*\s*(notes?|tips?)\s*:?\s*$", re.I)


def read_pasted(text: str) -> dict:
    """A recipe from pasted text. The first line is the name; "Ingredients" and "Method" (or "Instructions",
    "Directions", "Steps") headings split the rest. Without headings, lines that start with an amount are
    ingredients and everything after the first line that doesn't is a step. Nothing is rewritten."""
    lines = text.replace("\r\n", "\n").split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        raise HTTPException(status_code=400, detail="There's nothing to read")
    title = lines.pop(0).strip().lstrip("#").strip()[:200]
    sections = {"intro": [], "ingredients": [], "steps": [], "notes": []}
    current = None
    for line in lines:
        if INGREDIENT_HEADS.match(line):
            current = "ingredients"
        elif STEP_HEADS.match(line):
            current = "steps"
        elif NOTE_HEADS.match(line):
            current = "notes"
        else:
            sections[current or "intro"].append(line)
    if current is None:
        # No headings: amounts first, then steps.
        body = sections["intro"]
        sections["intro"] = []
        i = 0
        while i < len(body) and (not body[i].strip() or units.parse_line(body[i])["quantity"] is not None):
            i += 1
        sections["ingredients"], sections["steps"] = body[:i], body[i:]
    servings = None
    for line in sections["intro"]:
        m = re.search(r"(?:serves|servings?|makes|yield)\s*:?\s*(\d+)", line, re.I)
        if m:
            servings = float(m.group(1))
            break
    return {"title": title or "Untitled recipe", "description": "\n".join(sections["intro"]).strip() or None, "servings": servings,
            "ingredients_text": "\n".join(sections["ingredients"]).strip(), "steps_text": "\n".join(sections["steps"]).strip(),
            "notes": "\n".join(sections["notes"]).strip() or None, "original_text": text}


def _minutes(iso: Optional[str]) -> Optional[int]:
    """ISO 8601 durations as recipe sites write them: PT1H30M -> 90."""
    if not iso or not isinstance(iso, str):
        return None
    m = re.match(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$", iso.strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi = (int(x) if x else 0 for x in m.groups())
    return d * 1440 + h * 60 + mi


def _text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("text") or value.get("name") or ""
    return ""


def read_schema_org(data: dict) -> dict:
    """A recipe from schema.org Recipe JSON: what the Nextcloud Cookbook app stores and most recipe sites publish."""
    if isinstance(data, list):
        data = next((d for d in data if isinstance(d, dict) and "Recipe" in str(d.get("@type"))), data[0] if data else {})
    if isinstance(data, dict) and "@graph" in data:
        data = next((d for d in data["@graph"] if "Recipe" in str(d.get("@type"))), {})
    if not isinstance(data, dict) or not data.get("name"):
        raise HTTPException(status_code=400, detail="That doesn't look like a recipe")
    steps = []
    instructions = data.get("recipeInstructions") or []
    if isinstance(instructions, str):
        instructions = [instructions]
    for item in instructions:
        if isinstance(item, dict) and "HowToSection" in str(item.get("@type")):
            steps.append("# " + (item.get("name") or "").strip())
            steps += [_text(s).strip() for s in item.get("itemListElement") or []]
        else:
            steps.append(_text(item).strip())
    servings = data.get("recipeYield")
    if isinstance(servings, list):
        servings = servings[0] if servings else None
    m = re.search(r"\d+(?:\.\d+)?", str(servings or ""))
    keywords = data.get("keywords") or []
    if isinstance(keywords, str):
        keywords = keywords.split(",")
    return {"title": str(data["name"])[:200], "description": _text(data.get("description")) or None,
            "servings": float(m.group()) if m and float(m.group()) > 0 else None,
            "prep_minutes": _minutes(data.get("prepTime")), "cook_minutes": _minutes(data.get("cookTime")),
            "source_url": data.get("url") if isinstance(data.get("url"), str) else None,
            "ingredients_text": "\n".join(str(i).strip() for i in data.get("recipeIngredient") or [] if str(i).strip()),
            "steps_text": "\n\n".join(s for s in steps if s and s != "#"),
            "tags": [k.strip() for k in keywords if isinstance(k, str) and k.strip()][:20],
            "original_text": json.dumps(data, ensure_ascii=False, indent=2)}


class PasteIn(BaseModel):
    text: str


@router.post("/recipes/import", status_code=201)
def import_recipes(body: PasteIn, request: Request):
    """Pasted text, or schema.org recipe JSON (one recipe or a list). Each is saved with its original beside it."""
    if len(body.text) > TEXT_LIMIT * 10:
        raise HTTPException(status_code=400, detail="That's too much to bring in at once")
    stripped = body.text.strip()
    found = []
    if stripped.startswith(("{", "[")):
        try:
            data = json.loads(stripped)
        except ValueError:
            raise HTTPException(status_code=400, detail="That looks like JSON, but it couldn't be read")
        items = data if isinstance(data, list) and data and all(isinstance(d, dict) and d.get("name") for d in data) else [data]
        found = [read_schema_org(d) for d in items]
    else:
        found = [read_pasted(body.text)]
    owner = _owner(request)
    made = []
    for r in found:
        made.append(create_recipe(RecipeIn(**r), request)["id"])
    with _Db() as db:
        return {"imported": len(made), "recipes": [_recipe(db, owner, i) for i in made]}


def to_schema_org(r: dict) -> dict:
    """A recipe as schema.org Recipe JSON, the way the Nextcloud Cookbook app keeps it (recipe.json)."""
    def duration(m):
        return f"PT{m // 60}H{m % 60}M" if m else ""
    instructions, section = [], None
    for s in r["steps"]:
        if s["is_heading"]:
            section = {"@type": "HowToSection", "name": s["text"], "itemListElement": []}
            instructions.append(section)
        elif section is not None:
            section["itemListElement"].append({"@type": "HowToStep", "text": s["text"]})
        else:
            instructions.append({"@type": "HowToStep", "text": s["text"]})
    return {
        "@context": "https://schema.org", "@type": "Recipe", "name": r["title"], "description": r["description"] or "",
        "recipeYield": int(r["servings"]) if r["servings"] and float(r["servings"]).is_integer() else (r["servings"] or ""),
        "prepTime": duration(r["prep_minutes"]), "cookTime": duration(r["cook_minutes"]), "url": r["source_url"] or "",
        # Section headings among the ingredients are kept as lines of their own, written as they were.
        "recipeIngredient": [("# " + l["text"]) if l["is_heading"] else l["text"] for l in r["ingredients"]],
        "recipeInstructions": instructions, "keywords": ",".join(r["tags"]),
        "dateCreated": r["created_at"], "dateModified": r["updated_at"],
    }


@router.get("/recipes-export.zip")
def export_recipes(request: Request):
    """Every recipe as a Nextcloud Cookbook folder (recipe.json in a folder named after it), in one zip. Unzip
    it into the Recipes folder in your Nextcloud and the Cookbook app shows them."""
    owner = _owner(request)
    buf = io.BytesIO()
    with _Db() as db, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        used = set()
        for row in db.execute("SELECT id FROM recipes WHERE owner_id = ? ORDER BY id", (owner,)).fetchall():
            r = _recipe(db, owner, row["id"])
            folder = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", r["title"]).strip(" .")[:100] or "Recipe"
            name, n = folder, 2
            while name.lower() in used:
                name, n = f"{folder} ({n})", n + 1
            used.add(name.lower())
            z.writestr(f"Recipes/{name}/recipe.json", json.dumps(to_schema_org(r), ensure_ascii=False, indent=2))
            if r["original_text"]:
                z.writestr(f"Recipes/{name}/original.txt", r["original_text"])
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="lifeis-recipes.zip"'})


# ==================== PANTRY ====================

class PantryIn(BaseModel):
    name: str
    quantity: Optional[float] = None          # empty: "I have some"
    unit: Optional[str] = None
    location: Optional[str] = None
    expires_on: Optional[date] = None
    low_at: Optional[float] = None


def _pantry_rows(db, owner: int) -> List[dict]:
    today = date.today()
    out = []
    for r in db.execute("""
        SELECT p.*, i.name, i.aisle FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id
        WHERE p.owner_id = ? ORDER BY i.name COLLATE NOCASE
    """, (owner,)):
        d = dict(r)
        d["low"] = d["low_at"] is not None and d["quantity"] is not None and d["quantity"] <= d["low_at"]
        d["days_left"] = (date.fromisoformat(d["expires_on"]) - today).days if d["expires_on"] else None
        d["amount"] = units.amount(d["quantity"], d["unit"]) if d["quantity"] is not None else "some"
        out.append(d)
    return out


@router.get("/pantry")
def list_pantry(request: Request):
    with _Db() as db:
        rows = _pantry_rows(db, _owner(request))
    return {"items": rows, "low": [r["name"] for r in rows if r["low"]],
            "expiring": [r["name"] for r in rows if r["days_left"] is not None and r["days_left"] <= 3]}


def _check_pantry(body: PantryIn):
    if body.quantity is not None and not 0 <= body.quantity < 1e7:
        raise HTTPException(status_code=400, detail="The amount is 0 or more")
    if body.location is not None and body.location not in LOCATIONS:
        raise HTTPException(status_code=400, detail="Unknown place")


@router.put("/pantry")
def save_pantry(body: PantryIn, request: Request):
    """Set what you have of an ingredient (adding it to the pantry if it's new)."""
    _check_pantry(body)
    owner = _owner(request)
    with _Db() as db:
        iid = ingredient_id(db, owner, body.name)
        if not iid:
            raise HTTPException(status_code=400, detail="Say what it is")
        db.execute("""
            INSERT INTO pantry (owner_id, ingredient_id, quantity, unit, location, expires_on, low_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity, unit = excluded.unit, location = excluded.location,
                expires_on = excluded.expires_on, low_at = excluded.low_at, updated_at = excluded.updated_at
        """, (owner, iid, body.quantity, units.canonical(body.unit), body.location, body.expires_on.isoformat() if body.expires_on else None,
              body.low_at, _now()))
        db.commit()
        return next(r for r in _pantry_rows(db, owner) if r["ingredient_id"] == iid)


@router.delete("/pantry/{pid}", status_code=204)
def delete_pantry(pid: int, request: Request):
    with _Db() as db:
        db.execute("DELETE FROM pantry WHERE id = ? AND owner_id = ?", (pid, _owner(request)))
        db.commit()


def add_to_pantry(db, owner: int, iid: int, quantity: Optional[float], unit: Optional[str]):
    """Put something away: add it to what's there, in the pantry's own unit when the two compare."""
    row = db.execute("SELECT * FROM pantry WHERE owner_id = ? AND ingredient_id = ?", (owner, iid)).fetchone()
    unit = units.canonical(unit)
    if not row:
        db.execute("INSERT INTO pantry (owner_id, ingredient_id, quantity, unit, updated_at) VALUES (?, ?, ?, ?, ?)",
                   (owner, iid, quantity, unit, _now()))
        return
    if quantity is None:
        new_quantity, new_unit = row["quantity"], row["unit"]          # bought "some": what's known stays
    elif row["quantity"] is None:
        new_quantity, new_unit = quantity, unit                        # had "some", now at least this much
    else:
        same = units.convert(quantity, unit, row["unit"])
        new_quantity, new_unit = (row["quantity"] + same, row["unit"]) if same is not None else (quantity, unit)
    db.execute("UPDATE pantry SET quantity = ?, unit = ?, updated_at = ? WHERE id = ?", (new_quantity, new_unit, _now(), row["id"]))


def take_from_pantry(db, owner: int, iid: int, quantity: Optional[float], unit: Optional[str]) -> bool:
    """Use something up. Returns whether the pantry knew enough to take it away (an amount in a comparable unit)."""
    row = db.execute("SELECT * FROM pantry WHERE owner_id = ? AND ingredient_id = ?", (owner, iid)).fetchone()
    if not row or quantity is None or row["quantity"] is None:
        return False
    same = units.convert(quantity, unit, row["unit"])
    if same is None:
        return False
    db.execute("UPDATE pantry SET quantity = ?, updated_at = ? WHERE id = ?", (max(0.0, round(row["quantity"] - same, 4)), _now(), row["id"]))
    return True


# ==================== THE WEEK'S MEALS ====================

class PlanIn(BaseModel):
    day: date
    meal: str = "dinner"
    recipe_id: Optional[int] = None
    title: Optional[str] = None           # a meal without a recipe ("leftovers", "out")
    servings: Optional[float] = None


def _plan_rows(db, owner: int, start: str, end: str) -> List[dict]:
    return [dict(r) for r in db.execute("""
        SELECT m.*, r.title AS recipe_title, r.servings AS recipe_servings FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
        WHERE m.owner_id = ? AND m.day >= ? AND m.day <= ?
        ORDER BY m.day, CASE m.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, m.id
    """, (owner, start, end))]


@router.get("/plan")
def list_plan(request: Request, start: date = Query(...), days: int = Query(7, ge=1, le=62)):
    with _Db() as db:
        return _plan_rows(db, _owner(request), start.isoformat(), (start + timedelta(days=days - 1)).isoformat())


@router.post("/plan", status_code=201)
def add_plan(body: PlanIn, request: Request):
    if body.meal not in MEALS:
        raise HTTPException(status_code=400, detail="Breakfast, lunch, dinner or a snack")
    if body.servings is not None and not 0 < body.servings <= 1000:
        raise HTTPException(status_code=400, detail="Servings is a number above 0")
    owner = _owner(request)
    with _Db() as db:
        if body.recipe_id is not None:
            _recipe(db, owner, body.recipe_id)
        elif not _clean(body.title):
            raise HTTPException(status_code=400, detail="Choose a recipe, or say what the meal is")
        cur = db.execute("INSERT INTO meal_plan (owner_id, day, meal, recipe_id, title, servings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (owner, body.day.isoformat(), body.meal, body.recipe_id, _clean(body.title, 200), body.servings, _now()))
        db.commit()
        return next(r for r in _plan_rows(db, owner, body.day.isoformat(), body.day.isoformat()) if r["id"] == cur.lastrowid)


@router.delete("/plan/{pid}", status_code=204)
def delete_plan(pid: int, request: Request):
    with _Db() as db:
        db.execute("DELETE FROM meal_plan WHERE id = ? AND owner_id = ?", (pid, _owner(request)))
        db.commit()


def _needed_lines(db, recipe_id: int, factor: float):
    for l in db.execute("SELECT ingredient_id, quantity, unit FROM recipe_lines WHERE recipe_id = ? AND part = 'ingredients' "
                        "AND is_heading = 0 AND ingredient_id IS NOT NULL", (recipe_id,)):
        yield l["ingredient_id"], (l["quantity"] * factor if l["quantity"] is not None else None), l["unit"]


def _factor(meal: dict) -> float:
    return (meal["servings"] / meal["recipe_servings"]) if meal["servings"] and meal["recipe_servings"] else 1.0


@router.post("/plan/{pid}/cooked")
def cooked(pid: int, request: Request):
    """The meal was made: what it used comes out of the pantry. Says what couldn't be taken away (no amount
    known, or units that don't compare), so the pantry can be fixed by hand."""
    owner = _owner(request)
    with _Db() as db:
        meal = db.execute("SELECT m.*, r.servings AS recipe_servings FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id "
                          "WHERE m.id = ? AND m.owner_id = ?", (pid, owner)).fetchone()
        if not meal:
            raise HTTPException(status_code=404, detail="Not found")
        if meal["cooked_on"]:
            raise HTTPException(status_code=409, detail="That meal is already marked as cooked")
        meal = dict(meal)
        unchanged = []
        if meal["recipe_id"]:
            for iid, quantity, unit in _needed_lines(db, meal["recipe_id"], _factor(meal)):
                in_pantry = db.execute("SELECT 1 FROM pantry WHERE owner_id = ? AND ingredient_id = ?", (owner, iid)).fetchone()
                if in_pantry and not take_from_pantry(db, owner, iid, quantity, unit):
                    unchanged.append(db.execute("SELECT name FROM ingredients WHERE id = ?", (iid,)).fetchone()["name"])
        db.execute("UPDATE meal_plan SET cooked_on = ? WHERE id = ?", (date.today().isoformat(), pid))
        db.commit()
        return {"cooked": True, "check_by_hand": sorted(set(unchanged))}


# ==================== THE GROCERY LIST ====================

def shopping_needs(db, owner: int, start: str, end: str) -> dict:
    """What the meals planned between start and end need, minus the pantry.

    For each ingredient the amounts are added up by kind (weight, volume, a unit of its own, or a count). The
    pantry's amount is taken off where its unit compares. Returns the lines to buy, and the ingredients the
    pantry has "some" of (no amount), which are left off the list but named, so you can check the cupboard.
    """
    need = {}       # (ingredient_id, kind) -> {"base": amount in the kind's base unit, "unit": the first unit seen, "some": bool}
    for meal in _plan_rows(db, owner, start, end):
        if not meal["recipe_id"] or meal["cooked_on"]:
            continue
        for iid, quantity, unit in _needed_lines(db, meal["recipe_id"], _factor(meal)):
            key = (iid, units.kind_of(unit))
            slot = need.setdefault(key, {"base": 0.0, "unit": units.canonical(unit), "some": False})
            if quantity is None:
                slot["some"] = True
            else:
                slot["base"] += units.to_base(quantity, unit)
    buy, check = [], []
    for (iid, kind), slot in need.items():
        ing = db.execute("SELECT name, aisle FROM ingredients WHERE id = ?", (iid,)).fetchone()
        have = db.execute("SELECT quantity, unit FROM pantry WHERE owner_id = ? AND ingredient_id = ?", (owner, iid)).fetchone()
        base, note = slot["base"], None
        if have is not None:
            if have["quantity"] is None:
                # "I have some": not bought, but named, so the cupboard gets a look.
                check.append(ing["name"])
                continue
            if slot["base"] == 0 and have["quantity"] > 0:
                continue                      # only "salt to taste" needed, and there's salt
            if units.kind_of(have["unit"]) == kind:
                base -= units.to_base(have["quantity"], have["unit"])
                if base <= 1e-9 and not (slot["base"] == 0 and have["quantity"] == 0):
                    continue
            elif have["quantity"] > 0:
                note = f"you have {units.nice(have['quantity'])}{' ' + have['unit'] if have['unit'] else ''}, in other units"
        quantity = round(units.from_base(base, slot["unit"]), 3) if slot["base"] > 0 else None
        buy.append({"ingredient_id": iid, "label": ing["name"], "aisle": ing["aisle"], "quantity": quantity,
                    "unit": slot["unit"] if quantity is not None else None, "note": note})
    buy.sort(key=lambda b: ((b["aisle"] or "~").lower(), b["label"].lower()))
    return {"buy": buy, "check": sorted(set(check), key=str.lower)}


def _grocery_rows(db, owner: int) -> List[dict]:
    rows = []
    for r in db.execute("""
        SELECT g.*, i.aisle FROM grocery g LEFT JOIN ingredients i ON i.id = g.ingredient_id
        WHERE g.owner_id = ? ORDER BY g.done, COALESCE(i.aisle, '~') COLLATE NOCASE, g.label COLLATE NOCASE
    """, (owner,)):
        d = dict(r)
        d["done"], d["from_plan"] = bool(d["done"]), bool(d["from_plan"])
        d["amount"] = units.amount(d["quantity"], d["unit"])
        rows.append(d)
    return rows


@router.get("/grocery")
def list_grocery(request: Request):
    with _Db() as db:
        return _grocery_rows(db, _owner(request))


class GroceryIn(BaseModel):
    label: str
    quantity: Optional[float] = None
    unit: Optional[str] = None


@router.post("/grocery", status_code=201)
def add_grocery(body: GroceryIn, request: Request):
    """Something to buy, typed in. "2 lb chicken thighs" is read like a recipe line."""
    owner = _owner(request)
    text = _clean(body.label, 200)
    if not text:
        raise HTTPException(status_code=400, detail="Say what to buy")
    parsed = units.parse_line(text)
    quantity = body.quantity if body.quantity is not None else parsed["quantity"]
    unit = units.canonical(body.unit) if body.unit else parsed["unit"]
    name = parsed["name"] or text
    with _Db() as db:
        iid = ingredient_id(db, owner, name)
        db.execute("INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   (owner, iid, name[:200], quantity, unit, parsed["note"], _now()))
        db.commit()
        return _grocery_rows(db, owner)


class FromPlanIn(BaseModel):
    start: date
    days: int = 7


@router.post("/grocery/from-plan")
def grocery_from_plan(body: FromPlanIn, request: Request):
    """Fill the list from the week's meals, minus the pantry. Items added by hand stay; earlier items from the plan
    that aren't ticked off are replaced, so running it again after changing the week gives the right list."""
    if not 1 <= body.days <= 62:
        raise HTTPException(status_code=400, detail="1 to 62 days")
    owner = _owner(request)
    with _Db() as db:
        needs = shopping_needs(db, owner, body.start.isoformat(), (body.start + timedelta(days=body.days - 1)).isoformat())
        db.execute("DELETE FROM grocery WHERE owner_id = ? AND from_plan = 1 AND done = 0", (owner,))
        for b in needs["buy"]:
            db.execute("INSERT INTO grocery (owner_id, ingredient_id, label, quantity, unit, note, from_plan, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                       (owner, b["ingredient_id"], b["label"], b["quantity"], b["unit"], b["note"], _now()))
        db.commit()
        return {"items": _grocery_rows(db, owner), "added": len(needs["buy"]), "check": needs["check"]}


class TickIn(BaseModel):
    done: bool
    put_away: bool = True        # ticked off: add it to the pantry


@router.post("/grocery/{gid}/tick")
def tick_grocery(gid: int, body: TickIn, request: Request):
    owner = _owner(request)
    with _Db() as db:
        g = db.execute("SELECT * FROM grocery WHERE id = ? AND owner_id = ?", (gid, owner)).fetchone()
        if not g:
            raise HTTPException(status_code=404, detail="Not found")
        if body.done and not g["done"] and body.put_away and g["ingredient_id"]:
            add_to_pantry(db, owner, g["ingredient_id"], g["quantity"], g["unit"])
        db.execute("UPDATE grocery SET done = ? WHERE id = ?", (int(body.done), gid))
        db.commit()
        return _grocery_rows(db, owner)


@router.post("/grocery/clear-done")
def clear_done(request: Request):
    owner = _owner(request)
    with _Db() as db:
        db.execute("DELETE FROM grocery WHERE owner_id = ? AND done = 1", (owner,))
        db.commit()
        return _grocery_rows(db, owner)


@router.delete("/grocery/{gid}", status_code=204)
def delete_grocery(gid: int, request: Request):
    with _Db() as db:
        db.execute("DELETE FROM grocery WHERE id = ? AND owner_id = ?", (gid, _owner(request)))
        db.commit()


@router.post("/grocery/from-pantry-low")
def grocery_from_low(request: Request):
    """Add everything running low in the pantry that isn't on the list already."""
    owner = _owner(request)
    with _Db() as db:
        on_list = {r["ingredient_id"] for r in db.execute("SELECT ingredient_id FROM grocery WHERE owner_id = ? AND done = 0", (owner,))}
        added = 0
        for p in _pantry_rows(db, owner):
            if p["low"] and p["ingredient_id"] not in on_list:
                db.execute("INSERT INTO grocery (owner_id, ingredient_id, label, created_at) VALUES (?, ?, ?, ?)",
                           (owner, p["ingredient_id"], p["name"], _now()))
                added += 1
        db.commit()
        return {"items": _grocery_rows(db, owner), "added": added}
