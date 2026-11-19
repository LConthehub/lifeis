"""Writes units.golden.json: what backend/units.py answers for a list of lines, names and numbers.
The TypeScript core is checked against it, so the two read amounts the same way. Run it again whenever
backend/units.py or the lists below change:   python core/tests/golden.py"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "backend"))
import units  # noqa: E402

LINES = [
    "1 1/2 cups flour, sifted", "½ tsp salt", "1½ tbsp butter", "2-3 cloves garlic", "1 (28 oz) can crushed tomatoes",
    "200 g dark chocolate", "3 eggs", "2 fl oz cream", "Salt to taste", "2 tomatoes", "1 large onion",
    "2 tbsp olive oil", "1 onion, finely chopped", "1 lb ground beef", "12 lasagne sheets", "2 cups ricotta",
    "1 1/2 cups grated mozzarella", "500 ml stock", "2 lb chicken thighs", "2,5 kg potatoes", "1.25 l milk",
    "1 to 2 tbsp honey", "2 – 3 sprigs thyme", "1/0 cup nothing", "3/4 cup of sugar", "1 c. milk", "2 T soy sauce",
    "1 t vanilla", "2 Tbsp. butter, melted, plus more for the pan", "1 pkg (8 oz) cream cheese, softened",
    "Fresh basil for garnish", "Pepper, to taste", "1 pinch salt optional", "Oil as needed", "4 slices bread",
    "1 can (14 oz) coconut milk", "2 cans chickpeas, drained", "  3   large   eggs  ", "", "a handful of spinach",
    "1 handful of spinach", "2 OZ Parmesan", "1 ⅓ cups water", "⅞ cup cream", "10 g. yeast", "1 stick butter",
    "1 Constructor salt", "2 gal water", "3 leaves sage", "1 bunch cilantro (coriander), chopped", "0 g nothing",
    "1 1/2", "5", "1 heaping tbsp cocoa", "2 fluid ounces gin", "1 lime, juice of", "100g flour", "2x eggs",
]
NAMES = ["Tomatoes", "tomato", "Berries", "glass", "Hummus", "Potatoes", "Ground Beef", "olive oil", "Crème fraîche",
         "eggs", "bus", "", "  ", "Chickpeas (canned)", "peas", "Basil", "asparagus", "Lentils", "pies", "toes", "S"]
NUMBERS = [1.5, 1 / 3, 2.0, 0.25, 2.999, 1.37, 0, 0.125, 0.375, 0.625, 0.875, 3.625, 2 / 3, 0.75, 10, 0.01, 0.99,
           1.019, 1.02, 4.409, 453.592, 0.1, 0.005, 2.005, 12.5, 0.7]
UNITS = [None, "", "g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "fl oz", "pint", "quart", "gallon",
         "clove", "cloves", "can", "Cups", "tbsp.", "widget", "leaf"]

out = {
    "lines": [[line, units.parse_line(line)] for line in LINES],
    "names": [[name, units.name_key(name)] for name in NAMES],
    "nice": [[n, units.nice(n)] for n in NUMBERS],
    "amounts": [[n, u, units.amount(n, u)] for n in (0.5, 1, 1.5, 2, 3.625) for u in UNITS],
    "units": [[u, units.canonical(u), units.kind_of(u)] for u in UNITS],
    "convert": [[a, b, units.convert(2.5, a, b)] for a in UNITS for b in UNITS],
}
with open(os.path.join(HERE, "units.golden.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("wrote units.golden.json")

# ---------- recipes' words: recipeText.golden.json ----------
try:
    import kitchen
    from fastapi import HTTPException
except ImportError as missing:
    sys.exit(f"units.golden.json is written, but not recipeText.golden.json: {missing} (pip install fastapi)")

INGREDIENT_TEXTS = [
    "# For the sauce\n2 tbsp olive oil\n1 onion, finely chopped\n2-3 cloves garlic\n\n# To build\n12 lasagne sheets",
    "For the dough:\n2 cups flour\n1 tsp salt\nFilling:\n1 lb apples\r\nCinnamon to taste\n  \n## Glaze ##\n1 cup: sugar",
    "2 cups:\nSalt:\n" + "A very long line that ends in a colon and so is not a heading because it is far too long:", "", "\n\n",
    "  3 eggs  \n\t1 cup milk\t",
]
STEP_TEXTS = [
    "Warm the oil.\n\nAdd the garlic.\n\n# Layering\nSpread a thin layer.\n\nBake at 190°C.",
    "Mix.\nCut in the butter.\nBake.", "One paragraph only.", "# Broth\n\nBlanch the bones.\n\n\n\nServe.  \n",
    "First line\nsecond line of the same step\n\nNext step", "  indented step\n\n# Only a heading", "#\nStep under an empty heading", "",
    "Step one\r\n\r\nStep two\r\n",
]
PASTED = [
    "Grandma's Biscuits\nMakes 12\n\nIngredients:\n2 cups flour\n1 tbsp baking powder\n\nDirections:\nMix.\nCut in the butter until it looks like coarse crumbs.\n\nNotes:\nCold butter is everything.",
    "Rice\n1 cup rice\n2 cups water\nRinse the rice.\n\nSimmer 18 minutes.",
    "Toast\n\nIngredients\n2 slices bread\nButter\n\nMethod\nToast it.\nButter it.",
    "\n\n# Pancakes\nServes: 4, takes 20 minutes\nA family favourite.\n\n## Ingredients\n1 cup flour\n1 egg\n\n## Instructions\nWhisk.\n\nFry.\n\nTips\nRest the batter.",
    "Just a title", "", "   \n  ", "Soup\nYield 6\nServings 8\nSTEPS:\nBoil.\nINGREDIENT:\nWater",
    "Tea\r\n1 tsp tea\r\n250 ml water\r\nSteep 3 minutes.",
]
SCHEMA = [
    {"@context": "https://schema.org", "@type": "Recipe", "name": "Pho", "recipeYield": "4 servings", "prepTime": "PT30M",
     "cookTime": "PT3H", "recipeIngredient": ["2 lb beef bones", "1 onion, charred"], "keywords": "soup, weekend",
     "recipeInstructions": [{"@type": "HowToSection", "name": "Broth", "itemListElement": [{"@type": "HowToStep", "text": "Blanch the bones."}]},
                            {"@type": "HowToStep", "text": "Serve with herbs."}]},
    {"@graph": [{"@type": "WebSite", "name": "A site"}, {"@type": ["Recipe", "NewsArticle"], "name": "Graph cake", "recipeYield": ["8", "8 slices"],
                 "recipeInstructions": "Bake it.", "description": {"text": "Moist."}, "url": "https://example.com/cake",
                 "keywords": ["cake", " ", 3, "easy"], "prepTime": "P1DT2H", "cookTime": "PT90S", "recipeIngredient": [" 2 eggs ", "", 3]}]},
    [{"@type": "Thing", "name": "Not it"}, {"@type": "Recipe", "name": "Second one", "recipeYield": 2.5, "cookTime": "soon",
                                              "recipeInstructions": ["Stir.", {"name": "Named step"}, {"@type": "HowToSection", "itemListElement": []}]}],
    {"@type": "Recipe", "name": "Bare", "recipeYield": 0}, {"@type": "Thing"}, [], "a string", {"name": "No type, but named"},
]
DURATIONS = ["PT1H30M", "PT30M", "P1D", "PT0M", "PT", "P", "", None, "30 minutes", " PT2H ", "PT1H30M15S", "PT45S", 90]


def answer(read, given):
    try:
        return read(given)
    except HTTPException as problem:
        return {"problem": problem.detail}


out = {
    "ingredients": [[t, kitchen._split_lines(t, "ingredients")] for t in INGREDIENT_TEXTS],
    "steps": [[t, kitchen._split_lines(t, "steps")] for t in STEP_TEXTS],
    "pasted": [[t, answer(kitchen.read_pasted, t)] for t in PASTED],
    "schema": [[d, answer(kitchen.read_schema_org, d)] for d in SCHEMA],
    "minutes": [[d, kitchen._minutes(d)] for d in DURATIONS],
}
with open(os.path.join(HERE, "recipeText.golden.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("wrote recipeText.golden.json")
