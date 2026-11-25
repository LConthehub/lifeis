// What the house manual's printouts are made from. Plain functions, so a test can check them (core/tests/printParts.test.ts).

const WIFI_NAME = /^\s*(?:network(?: name)?|ssid|wi-?fi(?: name)?|name)\s*[:=]\s*(.+?)\s*$/im;
const WIFI_PASS = /^\s*(?:password|pass(?:word|phrase| ?key)?|key)\s*[:=]\s*(.+?)\s*$/im;
const isWifi = (e) => /wi-?\s?fi/i.test(e.title);

/** The Wi-Fi entry's network and password, read from "Network: x" and "Password: y" lines; null when there is no network line. */
export function wifiFrom(entry) {
  if (!entry) return null;
  const body = entry.body ?? '';
  const network = WIFI_NAME.exec(body)?.[1];
  if (!network) return null;
  const password = WIFI_PASS.exec(body)?.[1] ?? '';
  return { network, password };
}

/** What a phone's camera reads from a Wi-Fi code, to join the network. It is made on this device and goes nowhere. */
export function wifiCode({ network, password }) {
  const esc = (text) => text.replace(/([\\;,:"])/g, '\\$1');
  return password ? `WIFI:T:WPA;S:${esc(network)};P:${esc(password)};;` : `WIFI:T:nopass;S:${esc(network)};;`;
}

/**
 * The manual cut into the parts the printouts are made of. Private entries are left out unless asked for: a printed copy
 * is handed to a sitter or stuck on the fridge, so it is treated like the shared link.
 */
export function manualParts(manual, { includePrivate = false } = {}) {
  const keep = (e) => includePrivate || !e.private;
  const section = (id) => (manual.sections.find((s) => s.id === id)?.entries ?? []).filter(keep);
  const house = section('house');
  const wifiEntry = house.find(isWifi) ?? null;
  return {
    emergencies: section('emergency'),
    contacts: section('contacts'),
    wifiEntry,
    wifi: wifiFrom(wifiEntry),
    quirks: house.filter((e) => e !== wifiEntry),
    daily: section('routines'),
    pets: manual.pets,
  };
}

/** The feeding steps of the pets' routines, for the fridge sheet: [{ pet, time, steps: ["Feed 1 cup (Dog food)"] }]. */
export function feedingFrom(routines) {
  const out = [];
  for (const r of routines ?? []) {
    if (r.for_pet == null) continue;
    for (const t of r.times) {
      const steps = t.steps.filter((s) => /\bfeed|\bfood|\bmeal/i.test(s.words) || s.item).map((s) => `${s.words}${s.item && !s.words.toLowerCase().includes(s.item.toLowerCase()) ? ` (${s.item})` : ''}`);
      if (steps.length) out.push({ pet: r.who, time: t.name, at: t.at_words, steps });
    }
  }
  return out;
}

/** A line or two of words made to fit `max` characters, with an ellipsis when it was cut. */
export function shorten(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** A guess at the lines a text takes, `across` characters to a line. */
export const linesOf = (text, across) => String(text ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / across)), 0);

/**
 * Which of a list fit a panel of `lines` lines, `across` characters wide. `lineCount(item)` says how many lines one takes.
 * Returns { shown, cut }: cut is true when some were left out, and "More in the full manual." should be added.
 */
export function fitList(items, lines, lineCount) {
  const shown = [];
  let used = 0;
  for (let at = 0; at < items.length; at += 1) {
    const need = lineCount(items[at]) + 0.4;
    const last = at === items.length - 1;
    if (used + need + (last ? 0 : 1.4) > lines && !(last && used + need <= lines)) return { shown, cut: true };
    shown.push(items[at]);
    used += need;
  }
  return { shown, cut: false };
}
