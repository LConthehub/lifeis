"""Tests for the kitchen: recipes kept word for word, reading amounts, the pantry, the week's meals and the
grocery list that subtracts the pantry. Run with:  docker compose -f docker-compose.dev.yml run --rm tests"""
import io
import json
import os
import sys
import tempfile
import uuid
import zipfile
from datetime import date, timedelta

import pytest

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="lifeis-test-"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import units  # noqa: E402

PASSWORD = "correct-horse-battery"
MONDAY = date(2046, 3, 5)


@pytest.fixture(scope="module")
def admin():
    c = TestClient(main.app, client=("127.0.0.1", 50000))       # on this computer: the first account can be made
    if c.post("/api/auth/setup", json={"username": "owner", "password": PASSWORD}).status_code != 201:
        assert c.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}).status_code == 200
    return c


@pytest.fixture
def api(admin):
    name = "k-" + uuid.uuid4().hex[:8]
    assert admin.post("/api/users", json={"username": name, "password": PASSWORD}).status_code == 201
    c = TestClient(main.app)
    assert c.post("/api/auth/login", json={"username": name, "password": PASSWORD}).status_code == 200
    return c


def ok(r, code=200):
    assert r.status_code == code, r.text
    return r.json()


LASAGNE_INGREDIENTS = """# For the sauce
2 tbsp olive oil
1 onion, finely chopped
2-3 cloves garlic
1 lb ground beef
1 (28 oz) can crushed tomatoes
Salt to taste

# To build
12 lasagne sheets
2 cups ricotta
1 1/2 cups grated mozzarella"""

LASAGNE_STEPS = """Warm the oil over medium heat. Add the onion and cook it slowly, 10 minutes, until soft and sweet, not brown: this is where the flavour comes from, so don't rush it.

Add the garlic for one minute, then the beef. Break it up and brown it well.

# Layering
Spread a thin layer of sauce, then sheets, ricotta, sauce. Repeat three times; finish with sauce and mozzarella.

Bake at 190°C (375°F) for 45 minutes, covered for the first 25. Rest it 15 minutes before cutting, or it falls apart."""


def lasagne(api, servings=6):
    return ok(api.post("/api/kitchen/recipes", json={"title": "Lasagne", "servings": servings, "ingredients_text": LASAGNE_INGREDIENTS,
                                                    "steps_text": LASAGNE_STEPS, "tags": ["Dinner", "freezes well"]}), 201)


# ---------- reading amounts ----------

@pytest.mark.parametrize("line,quantity,unit,name,note", [
    ("1 1/2 cups flour, sifted", 1.5, "cup", "flour", "sifted"),
    ("½ tsp salt", 0.5, "tsp", "salt", None),
    ("1½ tbsp butter", 1.5, "tbsp", "butter", None),
    ("2-3 cloves garlic", 3, "clove", "garlic", None),
    ("1 (28 oz) can crushed tomatoes", 1, "can", "crushed tomatoes", None),
    ("200 g dark chocolate", 200, "g", "dark chocolate", None),
    ("3 eggs", 3, None, "eggs", None),
    ("2 fl oz cream", 2, "fl oz", "cream", None),
    ("Salt to taste", None, None, "Salt", "to taste"),
    ("2 tomatoes", 2, None, "tomatoes", None),
    ("1 large onion", 1, None, "large onion", None),
])
def test_reading_an_ingredient_line(line, quantity, unit, name, note):
    p = units.parse_line(line)
    assert (p["quantity"], p["unit"], p["name"], p["note"]) == (pytest.approx(quantity) if quantity else None, unit, name, note)


def test_units_convert_only_within_their_kind():
    assert units.convert(1, "lb", "g") == pytest.approx(453.592)
    assert units.convert(3, "tsp", "tbsp") == pytest.approx(1, rel=1e-3)
    assert units.convert(1, "cup", "g") is None                   # volume and weight never mix
    assert units.convert(2, "clove", "clove") == 2 and units.convert(2, "clove", "can") is None
    assert units.name_key("Tomatoes") == units.name_key("tomato") and units.name_key("Berries") == "berry"
    assert units.name_key("glass") == "glass" and units.name_key("Hummus") == "hummus"
    assert [units.nice(x) for x in (1.5, 1 / 3, 2.0, 0.25, 2.999, 1.37)] == ["1 1/2", "1/3", "2", "1/4", "3", "1.37"]


# ---------- recipes word for word ----------

def test_a_recipe_is_kept_exactly_as_written(api):
    r = lasagne(api)
    # Every line and every step, word for word, with the section headings where they were.
    assert r["ingredients_text"] == LASAGNE_INGREDIENTS.replace("\n\n", "\n")
    assert r["steps_text"] == LASAGNE_STEPS.replace("# Layering\n", "# Layering\n\n")
    assert [s["text"] for s in r["steps"] if s["is_heading"]] == ["Layering"]
    assert len([s for s in r["steps"] if not s["is_heading"]]) == 4
    assert "this is where the flavour comes from, so don't rush it." in r["steps"][0]["text"]
    assert r["tags"] == ["dinner", "freezes well"]
    beef = next(l for l in r["ingredients"] if "beef" in l["text"])
    assert beef["ingredient"] == "ground beef" and beef["quantity"] == 1 and beef["unit"] == "lb"

    # Scaling shows new amounts beside the lines, and never touches the lines.
    big = ok(api.get(f"/api/kitchen/recipes/{r['id']}", params={"servings": 9}))
    beef = next(l for l in big["ingredients"] if "beef" in l["text"])
    assert beef["text"] == "1 lb ground beef" and beef["scaled"] == "1 1/2 lb"
    assert big["steps_text"] == r["steps_text"] and next(l for l in big["ingredients"] if l["text"] == "Salt to taste")["scaled"] is None

    # Editing keeps the original pasted text.
    pasted = ok(api.post("/api/kitchen/recipes/import", json={"text": "Toast\n\nIngredients\n2 slices bread\nButter\n\nMethod\nToast it.\nButter it."}), 201)["recipes"][0]
    edited = ok(api.put(f"/api/kitchen/recipes/{pasted['id']}", json={"title": "Better toast", "ingredients_text": "2 slices bread", "steps_text": "Toast it well."}))
    assert edited["title"] == "Better toast" and edited["original_text"].startswith("Toast\n\nIngredients")

    found = ok(api.get("/api/kitchen/recipes", params={"q": "ricotta"}))
    assert [x["title"] for x in found] == ["Lasagne"]
    assert [x["title"] for x in ok(api.get("/api/kitchen/recipes", params={"tag": "freezes well"}))] == ["Lasagne"]
    assert api.post("/api/kitchen/recipes", json={"title": " "}).status_code == 400
    assert api.post("/api/kitchen/recipes", json={"title": "x", "servings": 0}).status_code == 400


def test_pasted_text_is_split_without_being_rewritten(api):
    text = "Grandma's Biscuits\nMakes 12\n\nIngredients:\n2 cups flour\n1 tbsp baking powder\n\nDirections:\nMix.\nCut in the butter until it looks like coarse crumbs.\n\nNotes:\nCold butter is everything."
    r = ok(api.post("/api/kitchen/recipes/import", json={"text": text}), 201)["recipes"][0]
    assert r["title"] == "Grandma's Biscuits" and r["servings"] == 12 and r["description"] == "Makes 12"
    assert r["ingredients_text"] == "2 cups flour\n1 tbsp baking powder"
    assert [s["text"] for s in r["steps"]] == ["Mix.", "Cut in the butter until it looks like coarse crumbs."]
    assert r["notes"] == "Cold butter is everything." and r["original_text"] == text

    # No headings: amounts first, then steps.
    r = ok(api.post("/api/kitchen/recipes/import", json={"text": "Rice\n1 cup rice\n2 cups water\nRinse the rice.\n\nSimmer 18 minutes."}), 201)["recipes"][0]
    assert r["ingredients_text"] == "1 cup rice\n2 cups water" and [s["text"] for s in r["steps"]] == ["Rinse the rice.", "Simmer 18 minutes."]


def test_schema_org_json_comes_in_and_goes_out_as_nextcloud_cookbook_folders(api):
    data = {"@context": "https://schema.org", "@type": "Recipe", "name": "Pho", "recipeYield": "4 servings", "prepTime": "PT30M",
            "cookTime": "PT3H", "recipeIngredient": ["2 lb beef bones", "1 onion, charred"], "keywords": "soup, weekend",
            "recipeInstructions": [{"@type": "HowToSection", "name": "Broth", "itemListElement": [{"@type": "HowToStep", "text": "Blanch the bones."}]},
                                   {"@type": "HowToStep", "text": "Serve with herbs."}]}
    r = ok(api.post("/api/kitchen/recipes/import", json={"text": json.dumps(data)}), 201)["recipes"][0]
    assert (r["title"], r["servings"], r["prep_minutes"], r["cook_minutes"]) == ("Pho", 4, 30, 180)
    assert r["steps_text"] == "# Broth\n\nBlanch the bones.\n\nServe with herbs." and r["tags"] == ["soup", "weekend"]
    assert json.loads(r["original_text"])["name"] == "Pho"
    lasagne(api)
    z = zipfile.ZipFile(io.BytesIO(api.get("/api/kitchen/recipes-export.zip").content))
    names = sorted(z.namelist())
    assert "Recipes/Pho/recipe.json" in names and "Recipes/Lasagne/recipe.json" in names and "Recipes/Pho/original.txt" in names
    out = json.loads(z.read("Recipes/Pho/recipe.json"))
    assert out["@type"] == "Recipe" and out["recipeYield"] == 4 and out["cookTime"] == "PT3H0M"
    # A section runs to the next heading, so the step after it is part of it on the way out.
    assert out["recipeInstructions"] == [{"@type": "HowToSection", "name": "Broth", "itemListElement": [
        {"@type": "HowToStep", "text": "Blanch the bones."}, {"@type": "HowToStep", "text": "Serve with herbs."}]}]
    lz = json.loads(z.read("Recipes/Lasagne/recipe.json"))
    assert lz["recipeIngredient"][0] == "# For the sauce" and "1 lb ground beef" in lz["recipeIngredient"]
    assert api.post("/api/kitchen/recipes/import", json={"text": "{not json"}).status_code == 400
    assert api.post("/api/kitchen/recipes/import", json={"text": '{"@type": "Thing"}'}).status_code == 400


# ---------- pantry, plan and groceries together ----------

def test_the_grocery_list_is_what_the_week_needs_minus_the_pantry(api):
    r = lasagne(api, servings=6)
    soup = ok(api.post("/api/kitchen/recipes", json={"title": "Soup", "servings": 2, "ingredients_text": "1 onion\n500 ml stock\n1 tsp salt"}), 201)
    ok(api.post("/api/kitchen/plan", json={"day": MONDAY.isoformat(), "recipe_id": r["id"], "servings": 12}), 201)     # doubled
    ok(api.post("/api/kitchen/plan", json={"day": (MONDAY + timedelta(days=2)).isoformat(), "recipe_id": soup["id"]}), 201)
    ok(api.post("/api/kitchen/plan", json={"day": (MONDAY + timedelta(days=3)).isoformat(), "title": "Leftovers"}), 201)
    ok(api.post("/api/kitchen/plan", json={"day": (MONDAY + timedelta(days=9)).isoformat(), "recipe_id": soup["id"]}), 201)   # next week: not counted

    ok(api.put("/api/kitchen/pantry", json={"name": "ground beef", "quantity": 500, "unit": "g", "location": "freezer"}))
    ok(api.put("/api/kitchen/pantry", json={"name": "Onions", "quantity": 1}))            # one onion; the week needs three
    ok(api.put("/api/kitchen/pantry", json={"name": "olive oil"}))                        # "some": not bought, but named
    ok(api.put("/api/kitchen/pantry", json={"name": "salt", "quantity": 1, "unit": "kg"}))
    ok(api.put("/api/kitchen/pantry", json={"name": "ricotta", "quantity": 1, "unit": "lb"}))   # weight; the recipe says cups
    ok(api.post("/api/kitchen/grocery", json={"label": "2 lb chicken thighs"}), 201)      # typed in by hand: stays

    out = ok(api.post("/api/kitchen/grocery/from-plan", json={"start": MONDAY.isoformat()}))
    items = {i["label"]: i for i in out["items"]}
    assert out["check"] == ["olive oil"] and "olive oil" not in items
    assert items["ground beef"]["unit"] == "lb" and items["ground beef"]["quantity"] == pytest.approx(2 - 500 / 453.592, abs=0.01)
    assert items["onion"]["quantity"] == 2                                               # 2 for the lasagne, 1 for soup, 1 in the pantry
    assert items["ricotta"]["quantity"] == 4 and "other units" in items["ricotta"]["note"]
    assert "salt" not in items                                                           # "to taste" and 1 tsp: a kilo covers it
    assert items["garlic"]["quantity"] == 6 and items["garlic"]["unit"] == "clove"
    assert items["chicken thighs"]["from_plan"] is False and items["chicken thighs"]["amount"] == "2 lb"
    assert items["stock"]["quantity"] == 500 and items["stock"]["unit"] == "ml"

    # Running it again after changing the week replaces the plan's items and leaves the hand-typed one.
    soup_day = next(m for m in ok(api.get("/api/kitchen/plan", params={"start": MONDAY.isoformat()})) if m["recipe_id"] == soup["id"])
    assert api.delete(f"/api/kitchen/plan/{soup_day['id']}").status_code == 204
    items = {i["label"]: i for i in ok(api.post("/api/kitchen/grocery/from-plan", json={"start": MONDAY.isoformat()}))["items"]}
    assert "stock" not in items and items["onion"]["quantity"] == 1 and "chicken thighs" in items

    # Ticking off with "put away" fills the pantry; cooking takes it out again.
    beef_item = items["ground beef"]
    ok(api.post(f"/api/kitchen/grocery/{beef_item['id']}/tick", json={"done": True}))
    beef = next(p for p in ok(api.get("/api/kitchen/pantry"))["items"] if p["name"] == "ground beef")
    assert beef["unit"] == "g" and beef["quantity"] == pytest.approx(2 * 453.592, abs=0.5)
    lasagne_day = next(m for m in ok(api.get("/api/kitchen/plan", params={"start": MONDAY.isoformat()})) if m["recipe_id"] == r["id"])
    done = ok(api.post(f"/api/kitchen/plan/{lasagne_day['id']}/cooked"))
    assert "ricotta" in done["check_by_hand"]                                            # cups can't come out of pounds
    beef = next(p for p in ok(api.get("/api/kitchen/pantry"))["items"] if p["name"] == "ground beef")
    assert beef["quantity"] == pytest.approx(0, abs=0.5)
    assert api.post(f"/api/kitchen/plan/{lasagne_day['id']}/cooked").status_code == 409
    # A cooked meal isn't shopped for again.
    assert "ground beef" not in {i["label"] for i in ok(api.post("/api/kitchen/grocery/from-plan", json={"start": MONDAY.isoformat()}))["items"] if not i["done"]}

    left = ok(api.post("/api/kitchen/grocery/clear-done"))
    assert all(not i["done"] for i in left)


def test_low_pantry_items_go_on_the_list_once(api):
    ok(api.put("/api/kitchen/pantry", json={"name": "coffee", "quantity": 1, "unit": "bag", "low_at": 1}))
    ok(api.put("/api/kitchen/pantry", json={"name": "rice", "quantity": 5, "unit": "lb", "low_at": 1,
                                            "expires_on": (date.today() + timedelta(days=2)).isoformat()}))
    pantry = ok(api.get("/api/kitchen/pantry"))
    assert pantry["low"] == ["coffee"] and pantry["expiring"] == ["rice"]
    assert ok(api.post("/api/kitchen/grocery/from-pantry-low"))["added"] == 1
    assert ok(api.post("/api/kitchen/grocery/from-pantry-low"))["added"] == 0
    assert api.put("/api/kitchen/pantry", json={"name": "x", "location": "garage"}).status_code == 400


def test_each_person_has_their_own_kitchen(admin, api):
    r = lasagne(api)
    other_name = "k-" + uuid.uuid4().hex[:8]
    ok(admin.post("/api/users", json={"username": other_name, "password": PASSWORD}), 201)
    other = TestClient(main.app)
    ok(other.post("/api/auth/login", json={"username": other_name, "password": PASSWORD}))
    assert other.get(f"/api/kitchen/recipes/{r['id']}").status_code == 404
    assert ok(other.get("/api/kitchen/recipes")) == []
    assert other.post("/api/kitchen/plan", json={"day": MONDAY.isoformat(), "recipe_id": r["id"]}).status_code == 404
    assert TestClient(main.app).get("/api/kitchen/recipes").status_code == 401
    assert api.post("/api/users", json={"username": "nope-" + uuid.uuid4().hex[:4], "password": PASSWORD}).status_code == 403


def test_the_database_is_encrypted_on_disk():
    with open(main.DB_PATH, "rb") as f:
        assert f.read(16) != b"SQLite format 3\x00"


def test_the_first_account_can_only_be_made_on_this_computer():
    import migrations
    c = TestClient(main.app)
    # Through a reverse proxy (Caddy adds X-Forwarded-For), setup is refused, whether or not an account exists yet.
    r = c.post("/api/auth/setup", json={"username": "stranger", "password": PASSWORD}, headers={"X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 403 and "localhost" in r.json()["detail"]
    assert c.get("/api/auth/status", headers={"X-Forwarded-For": "203.0.113.9"}).json()["local"] is False
