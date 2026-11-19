"""
Amounts in recipes: reading "1 1/2 cups flour, sifted", and converting between units of the same kind.

Reading a line never changes it. The line is always kept exactly as written; this only works out the number,
the unit and the ingredient's name from it, so the pantry and the grocery list can be linked to it. When the
reading is wrong, the words are still right.

Units of weight (g, kg, oz, lb) convert to each other, and so do units of volume (ml, l, tsp, tbsp, cup, fl oz,
pint, quart, gallon). Weight and volume never convert to each other: a cup of flour and a cup of honey weigh
different amounts. Anything else (a clove, a can, a pinch) only adds up with the same word.
"""

import re
from typing import Optional

# alias -> (canonical name, kind, how many of the kind's base unit: grams or millilitres)
_TABLE = {
    "g": ("g", "mass", 1), "gram": ("g", "mass", 1), "grams": ("g", "mass", 1), "gr": ("g", "mass", 1),
    "kg": ("kg", "mass", 1000), "kilogram": ("kg", "mass", 1000), "kilograms": ("kg", "mass", 1000), "kgs": ("kg", "mass", 1000),
    "oz": ("oz", "mass", 28.3495), "ounce": ("oz", "mass", 28.3495), "ounces": ("oz", "mass", 28.3495),
    "lb": ("lb", "mass", 453.592), "lbs": ("lb", "mass", 453.592), "pound": ("lb", "mass", 453.592), "pounds": ("lb", "mass", 453.592),
    "ml": ("ml", "volume", 1), "milliliter": ("ml", "volume", 1), "milliliters": ("ml", "volume", 1),
    "millilitre": ("ml", "volume", 1), "millilitres": ("ml", "volume", 1),
    "l": ("l", "volume", 1000), "liter": ("l", "volume", 1000), "liters": ("l", "volume", 1000),
    "litre": ("l", "volume", 1000), "litres": ("l", "volume", 1000),
    "tsp": ("tsp", "volume", 4.92892), "teaspoon": ("tsp", "volume", 4.92892), "teaspoons": ("tsp", "volume", 4.92892), "t": ("tsp", "volume", 4.92892),
    "tbsp": ("tbsp", "volume", 14.7868), "tablespoon": ("tbsp", "volume", 14.7868), "tablespoons": ("tbsp", "volume", 14.7868),
    "tbs": ("tbsp", "volume", 14.7868), "tbl": ("tbsp", "volume", 14.7868),
    "cup": ("cup", "volume", 236.588), "cups": ("cup", "volume", 236.588), "c": ("cup", "volume", 236.588),
    "fl oz": ("fl oz", "volume", 29.5735), "floz": ("fl oz", "volume", 29.5735), "fluid ounce": ("fl oz", "volume", 29.5735),
    "fluid ounces": ("fl oz", "volume", 29.5735),
    "pint": ("pint", "volume", 473.176), "pints": ("pint", "volume", 473.176), "pt": ("pint", "volume", 473.176),
    "quart": ("quart", "volume", 946.353), "quarts": ("quart", "volume", 946.353), "qt": ("quart", "volume", 946.353),
    "gallon": ("gallon", "volume", 3785.41), "gallons": ("gallon", "volume", 3785.41), "gal": ("gallon", "volume", 3785.41),
}
# Words that are units of their own: they only add up with the same word.
_OWN = {
    "clove": "clove", "cloves": "clove", "can": "can", "cans": "can", "tin": "tin", "tins": "tin", "jar": "jar", "jars": "jar",
    "pinch": "pinch", "pinches": "pinch", "dash": "dash", "dashes": "dash", "slice": "slice", "slices": "slice",
    "stick": "stick", "sticks": "stick", "sprig": "sprig", "sprigs": "sprig", "bunch": "bunch", "bunches": "bunch",
    "head": "head", "heads": "head", "package": "package", "packages": "package", "pkg": "package", "packet": "packet",
    "packets": "packet", "bag": "bag", "bags": "bag", "box": "box", "boxes": "box", "handful": "handful", "handfuls": "handful",
    "piece": "piece", "pieces": "piece", "stalk": "stalk", "stalks": "stalk", "leaf": "leaf", "leaves": "leaf",
}
_FRACTIONS = {"½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
              "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}

_NUMBER = r"(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+(?:[.,]\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])"
_AMOUNT = re.compile(rf"^\s*(?P<a>{_NUMBER})(?:\s*(?:-|–|to)\s*(?P<b>{_NUMBER}))?\s*")


def _number(text: str) -> float:
    text = text.strip().replace(",", ".")
    total = 0.0
    for part in text.split():
        if "/" in part:
            top, bottom = part.split("/")
            total += int(top) / int(bottom)
        else:
            frac = next((v for k, v in _FRACTIONS.items() if part.endswith(k)), None)
            if frac is not None:
                head = part[:-1]
                total += (float(head) if head else 0) + frac
            else:
                total += float(part)
    return total


def unit_info(unit: Optional[str]):
    """(canonical, kind, factor) for a unit, or None for no unit. A unit of its own is its own kind."""
    if not unit:
        return None
    u = unit.strip().lower().rstrip(".")
    if u in _TABLE:
        return _TABLE[u]
    own = _OWN.get(u, u)
    return (own, f"own:{own}", 1)


def canonical(unit: Optional[str]) -> Optional[str]:
    info = unit_info(unit)
    return info[0] if info else None


def kind_of(unit: Optional[str]) -> str:
    info = unit_info(unit)
    return info[1] if info else "count"


def convert(quantity: float, from_unit: Optional[str], to_unit: Optional[str]) -> Optional[float]:
    """The same amount in another unit, or None when the two can't be compared."""
    a, b = unit_info(from_unit), unit_info(to_unit)
    if a is None and b is None:
        return quantity
    if a is None or b is None or a[1] != b[1]:
        return None
    return quantity * a[2] / b[2]


def to_base(quantity: float, unit: Optional[str]) -> float:
    info = unit_info(unit)
    return quantity * info[2] if info else quantity


def from_base(quantity: float, unit: Optional[str]) -> float:
    info = unit_info(unit)
    return quantity / info[2] if info else quantity


def name_key(name: str) -> str:
    """The form of an ingredient's name used to match it everywhere: "Tomatoes" and "tomato" are the same thing."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower()).split()
    if not words:
        return ""
    last = words[-1]
    if len(last) > 4 and last.endswith("ies"):
        last = last[:-3] + "y"
    elif len(last) > 4 and last.endswith("oes"):
        last = last[:-2]
    elif len(last) > 3 and last.endswith("s") and not last.endswith(("ss", "us", "is")):
        last = last[:-1]
    return " ".join(words[:-1] + [last])


def parse_line(line: str) -> dict:
    """{"quantity", "unit", "name", "note"} read from an ingredient line. Anything not understood is left out:
    "Salt to taste" has no quantity and the name "Salt"."""
    rest = line.strip()
    quantity = None
    m = _AMOUNT.match(rest)
    if m:
        try:
            # A range ("2-3 cloves") shops for the larger amount.
            quantity = max(_number(m.group("a")), _number(m.group("b"))) if m.group("b") else _number(m.group("a"))
            rest = rest[m.end():]
        except (ValueError, ZeroDivisionError):
            quantity = None
    unit = None
    if quantity is not None:
        # A size in brackets after the number ("1 (14 oz) can tomatoes") belongs to the note.
        size = re.match(r"^\(([^)]*)\)\s*", rest)
        bracket = size.group(1) if size else None
        if size:
            rest = rest[size.end():]
        lowered = rest.lower()
        for candidate in sorted(list(_TABLE) + list(_OWN), key=len, reverse=True):
            if re.match(rf"^{re.escape(candidate)}\.?(?=\s|$|,)", lowered):
                unit = canonical(candidate)
                rest = rest[len(candidate):].lstrip(". ")
                break
        if bracket:
            rest = f"{rest} ({bracket})"
    rest = re.sub(r"^of\s+", "", rest.strip(), flags=re.I)
    name, _, note = rest.partition(",")
    name = re.sub(r"\s*\([^)]*\)\s*", " ", name).strip()
    for tail in (" to taste", " as needed", " for serving", " for garnish", " optional"):
        if name.lower().endswith(tail):
            note = (tail.strip() + (", " + note if note else "")).strip()
            name = name[: -len(tail)].strip()
    return {"quantity": quantity, "unit": unit, "name": name, "note": note.strip() or None}


def nice(quantity: Optional[float]) -> str:
    """A friendly number: 1.5 -> "1 1/2", 0.333 -> "1/3", 2.0 -> "2"."""
    if quantity is None:
        return ""
    whole = int(quantity)
    rest = quantity - whole
    for text, value in (("1/8", 0.125), ("1/4", 0.25), ("1/3", 1 / 3), ("1/2", 0.5), ("2/3", 2 / 3), ("3/4", 0.75)):
        if abs(rest - value) < 0.02:
            return f"{whole} {text}" if whole else text
    if rest < 0.02:
        return str(whole)
    if rest > 0.98:
        return str(whole + 1)
    return f"{quantity:.2f}".rstrip("0").rstrip(".")


_PLURAL = {"clove": "cloves", "can": "cans", "tin": "tins", "jar": "jars", "pinch": "pinches", "dash": "dashes", "slice": "slices",
           "stick": "sticks", "sprig": "sprigs", "bunch": "bunches", "head": "heads", "package": "packages", "packet": "packets",
           "bag": "bags", "box": "boxes", "handful": "handfuls", "piece": "pieces", "stalk": "stalks", "leaf": "leaves", "cup": "cups"}


def amount(quantity: Optional[float], unit: Optional[str]) -> str:
    """ "2 cans", "1 1/2 cups", "500 g", "3" """
    if quantity is None:
        return ""
    if unit and quantity > 1.02:
        unit = _PLURAL.get(unit, unit)
    return f"{nice(quantity)}{' ' + unit if unit else ''}"
