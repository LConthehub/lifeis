/**
 * One search across everything a person keeps in Life Is: recipes, the pantry, things and the places they're
 * in, books, films and music, projects, upkeep, plans and the calendar. Each answer says what it is and
 * leads to its own page.
 *
 * Only ever the person's own, plus the upkeep jobs given to them. Every word typed has to be found
 * somewhere in an answer, in any order ("blue linen" finds "Linen, blue").
 */
import type { Db, Value } from './db.ts';
import { servicesSeenBy } from './homeServices.ts';
import { placePaths } from './inventory.ts';
import { Problem } from './problem.ts';
import { idsWithAny, tagsMatching, tagsOnto, type TagKind } from './tags.ts';

export const SEARCH_KINDS = ['tag', 'recipe', 'pantry', 'thing', 'place', 'title', 'list', 'service', 'project', 'job', 'pet', 'license', 'plan', 'event', 'routine'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export type SearchResult = { kind: SearchKind; id: number; icon: string; title: string; detail: string | null; link: string };

const PER_KIND = 8;
const MEDIA_ICONS: Record<string, string> = { film: '🎬', show: '📺', music: '🎵', book: '📚', game: '🎮', other: '🗃' };
/** % and _ mean "anything" to LIKE; typed by a person they mean themselves. */
const like = (word: string) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function search(db: Db, owner: number, query: string, only?: SearchKind | null): Promise<SearchResult[]> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  if (query.length > 100) throw new Problem(400, 'Search for something shorter');
  if (only != null && !SEARCH_KINDS.includes(only)) throw new Problem(400, "That isn't something Life Is can search for");
  const wants = (kind: SearchKind) => !only || only === kind;

  /** A WHERE clause: every word is in at least one of the columns. */
  const every = (columns: string[]): { sql: string; args: Value[] } => ({
    sql: words.map(() => `(${columns.map((c) => `LOWER(COALESCE(${c}, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`).join(' AND '),
    args: words.flatMap((w) => columns.map(() => like(w))),
  });
  /** What carries a tag whose name (with where it sits) holds every word: found along with the tag itself. */
  const named = await tagsMatching(db, owner, words);
  const tagged = async (kind: TagKind, column: string): Promise<string> => {
    const ids = await idsWithAny(db, owner, kind, named.inside);
    return ids.length ? ` OR ${column} IN (${ids.join(',')})` : '';
  };
  const out: SearchResult[] = [];
  const join = (...parts: (string | number | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || null;

  if (wants('tag')) {
    for (const t of named.matches.slice(0, PER_KIND)) out.push({ kind: 'tag', id: t.id, icon: '🏷', title: t.path, detail: 'Tag', link: `/tags/${t.id}` });
  }
  if (wants('recipe')) {
    const w = every(['title', 'description', 'notes']);
    const found = await db.all<{ id: number; title: string }>(
      `SELECT id, title FROM recipes WHERE owner_id = ? AND (${w.sql}${await tagged('recipe', 'id')}) ORDER BY title COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args]);
    const on = await tagsOnto(db, owner, 'recipe', found.map((r) => r.id));
    for (const r of found) {
      out.push({ kind: 'recipe', id: r.id, icon: '🍳', title: r.title, detail: join('Recipe', (on.get(r.id) ?? []).slice(0, 3).map((t) => t.name).join(', ')), link: `/recipes/${r.id}` });
    }
  }
  if (wants('pantry')) {
    const w = every(['i.name', 'p.location']);
    for (const p of await db.all<{ id: number; name: string; location: string | null }>(
      `SELECT p.id, i.name, p.location FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id WHERE p.owner_id = ? AND ${w.sql} ORDER BY i.name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'pantry', id: p.id, icon: '🥫', title: p.name, detail: join('In the pantry', p.location), link: '/pantry' });
    }
  }

  const places = await db.all<{ id: number; parent_id: number | null; name: string; note: string | null }>('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]);
  const paths = placePaths(places);
  const where = (id: number | null) => (id !== null ? (paths.get(id) ?? null) : null);

  if (wants('thing')) {
    const w = every(['i.name', 'i.note', 'i.barcode', 'i.serial', 'i.model', 'i.bought_at', 'k.name', "printf('%03d-%03d', i.asset_no / 1000, i.asset_no % 1000)",
      "(SELECT GROUP_CONCAT(f.name || ' ' || f.value, ' ') FROM item_fields f WHERE f.item_id = i.id)",
      "(SELECT GROUP_CONCAT(v.value, ' ') FROM item_values v WHERE v.item_id = i.id)",
      "(SELECT GROUP_CONCAT(a.activity, ' ') FROM item_activities a WHERE a.item_id = i.id)"]);
    for (const t of await db.all<{ id: number; name: string; kind: string; icon: string | null; place_id: number | null }>(
      `SELECT i.id, i.name, k.name AS kind, k.icon, i.place_id FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? AND i.gone_on IS NULL AND (${w.sql}${await tagged('thing', 'i.id')}) ORDER BY i.name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'thing', id: t.id, icon: t.icon || '📦', title: t.name, detail: join(t.kind, where(t.place_id) && `📍 ${where(t.place_id)}`), link: `/things/${t.id}` });
    }
  }
  if (wants('place')) {
    // A place is found by its whole path, so "bedroom shelf" finds the shelf in the bedroom.
    const found = places.filter((p) => words.every((word) => `${paths.get(p.id) ?? p.name} ${p.note ?? ''}`.toLowerCase().includes(word)))
      .sort((a, b) => (paths.get(a.id) ?? '').localeCompare(paths.get(b.id) ?? '')).slice(0, PER_KIND);
    for (const p of found) out.push({ kind: 'place', id: p.id, icon: '📍', title: p.name, detail: join('Place', paths.get(p.id) !== p.name && paths.get(p.id)), link: `/things/places/${p.id}` });
  }
  if (wants('title')) {
    const w = every(['m.title', 'm.creator', 'm.genres', 'm.note',
      "(SELECT GROUP_CONCAT(c.format || ' ' || COALESCE(c.barcode, '') || ' ' || COALESCE(c.lent_to, ''), ' ') FROM media_copies c WHERE c.media_id = m.id)"]);
    for (const m of await db.all<{ id: number; title: string; type: string; creator: string | null; year: number | null; place_id: number | null; lent_to: string | null; unowned: number; wanted: number; lists: string | null }>(
      `SELECT m.id, m.title, m.type, m.creator, m.year, m.listed_only AS unowned, m.wanted,
              (SELECT GROUP_CONCAT(l.name, ', ') FROM media_list_items i JOIN media_lists l ON l.id = i.list_id WHERE i.media_id = m.id AND l.owner_id = m.owner_id) AS lists,
              (SELECT c.place_id FROM media_copies c WHERE c.media_id = m.id AND c.place_id IS NOT NULL ORDER BY c.id LIMIT 1) AS place_id,
              (SELECT c.lent_to FROM media_copies c WHERE c.media_id = m.id AND c.lent_to IS NOT NULL ORDER BY c.id LIMIT 1) AS lent_to
       FROM media m WHERE m.owner_id = ? AND (${w.sql}${await tagged('title', 'm.id')}) ORDER BY m.title COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'title', id: m.id, icon: MEDIA_ICONS[m.type] ?? '🗃', title: m.title,
        detail: join(m.creator, m.year, m.unowned ? `On a list: ${[m.wanted ? 'Wanted' : '', m.lists ?? ''].filter(Boolean).join(', ') || 'none'}` : m.lent_to ? `with ${m.lent_to}` : where(m.place_id) && `📍 ${where(m.place_id)}`), link: `/media/${m.id}` });
    }
  }
  if (wants('list')) {
    // Lists by name (the person's own, and ones shared with everyone), and the titles on lists others shared. A list nobody shared is never here.
    const names = every(['l.name']);
    for (const l of await db.all<{ id: number; name: string; shared: number; mine: number }>(
      `SELECT l.id, l.name, l.shared, (l.owner_id = ?) AS mine FROM media_lists l WHERE (l.owner_id = ? OR l.shared = 1) AND ${names.sql} ORDER BY l.name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, owner, ...names.args])) {
      out.push({ kind: 'list', id: l.id, icon: '📋', title: l.name, detail: join('List', l.shared && (l.mine ? 'shared' : 'shared with you')), link: `/media/lists/${l.id}` });
    }
    const w = every(['m.title', 'm.creator', 'i.note']);
    // A title on someone else's shared list has a negative id here, so it never matches a list's id.
    for (const e of await db.all<{ id: number; list_id: number; list: string; title: string; type: string; creator: string | null; year: number | null }>(
      `SELECT i.id, l.id AS list_id, l.name AS list, m.title, m.type, m.creator, m.year
       FROM media_list_items i JOIN media_lists l ON l.id = i.list_id JOIN media m ON m.id = i.media_id
       WHERE l.shared = 1 AND l.owner_id != ? AND ${w.sql} ORDER BY m.title COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'list', id: -e.id, icon: MEDIA_ICONS[e.type] ?? '🗃', title: e.title, detail: join(e.creator, e.year, `On the shared list ${e.list}`), link: `/media/lists/${e.list_id}` });
    }
  }
  if (wants('service')) {
    // Home services by name, group and note: only the ones this person may see. A link someone cannot see is never here.
    for (const s of (await servicesSeenBy(db, owner)).filter((r) => words.every((w) => [r.name, r.grp, r.note].some((t) => (t ?? '').toLowerCase().includes(w)))).slice(0, PER_KIND)) {
      out.push({ kind: 'service', id: s.id, icon: '🔗', title: s.name, detail: join('Home services', s.grp), link: '/manual/services' });
    }
  }
  if (wants('project')) {
    const w = every(['name', 'activity', 'notes']);
    for (const p of await db.all<{ id: number; name: string; activity: string | null; status: string }>(
      `SELECT id, name, activity, status FROM projects WHERE owner_id = ? AND (${w.sql}${await tagged('project', 'id')}) ORDER BY updated_at DESC LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'project', id: p.id, icon: '🧵', title: p.name, detail: join('Project', p.activity, p.status), link: `/projects/${p.id}` });
    }
  }
  if (wants('job')) {
    const w = every(['name', 'activity', 'steps', 'note']);
    for (const j of await db.all<{ id: number; name: string; activity: string | null }>(
      `SELECT id, name, activity FROM upkeep_jobs WHERE (owner_id = ? OR assigned_to = ?) AND (${w.sql}${await tagged('job', 'id')}) ORDER BY name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, owner, ...w.args])) {
      out.push({ kind: 'job', id: j.id, icon: '🔧', title: j.name, detail: join('Upkeep', j.activity), link: `/things/upkeep/${j.id}` });
    }
  }
  if (wants('routine')) {
    // The words of a routine's steps and times count too, so "retinoid" finds the routine it is in.
    const w = every(['name', 'note', "(SELECT group_concat(t.name || ' ' || COALESCE((SELECT group_concat(s.words, ' ') FROM routine_steps s WHERE s.time_id = t.id), ''), ' ') FROM routine_times t WHERE t.routine_id = routines.id)"]);
    for (const r of await db.all<{ id: number; name: string; for_member: number | null; for_user: number | null }>(
      `SELECT id, name, for_member, for_user FROM routines WHERE (owner_id = ? OR for_user = ? OR (for_user IS NULL AND for_member IS NULL)) AND (${w.sql}${await tagged('routine', 'id')}) ORDER BY name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, owner, ...w.args])) {
      out.push({ kind: 'routine', id: r.id, icon: '✅', title: r.name, detail: 'Routine', link: '/routines' });
    }
  }
  if (wants('pet')) {
    const w = every(['name', 'species', 'breed', 'microchip', 'vet_name', 'note']);
    for (const p of await db.all<{ id: number; name: string; species: string | null; breed: string | null }>(
      `SELECT id, name, species, breed FROM pets WHERE owner_id = ? AND (${w.sql}${await tagged('pet', 'id')}) ORDER BY name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'pet', id: p.id, icon: '🐾', title: p.name, detail: join('Pet', p.breed ?? p.species), link: `/things/pets/${p.id}` });
    }
  }
  if (wants('license')) {
    // The name, who it is for and who issued it. Never the number, which is not even read here.
    const w = every(['name', 'holder', 'issuer']);
    for (const l of await db.all<{ id: number; name: string; holder: string | null; issuer: string | null }>(
      `SELECT id, name, holder, issuer FROM licenses WHERE owner_id = ? AND ${w.sql} ORDER BY name COLLATE NOCASE LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'license', id: l.id, icon: '🪪', title: l.name, detail: join('License', l.holder, l.issuer), link: '/things/licenses' });
    }
  }
  if (wants('plan')) {
    const w = every(['name', 'note', 'story']);
    for (const p of await db.all<{ id: number; name: string; start_day: string }>(
      `SELECT id, name, start_day FROM plans WHERE owner_id = ? AND (${w.sql}${await tagged('plan', 'id')}) ORDER BY start_day DESC LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'plan', id: p.id, icon: '✨', title: p.name, detail: join('Plan', p.start_day), link: `/plans/${p.id}` });
    }
  }
  if (wants('event')) {
    const w = every(['title', 'note']);
    for (const e of await db.all<{ id: number; title: string; day: string; yearly: number }>(
      `SELECT id, title, day, yearly FROM events WHERE owner_id = ? AND (${w.sql}${await tagged('event', 'id')}) ORDER BY day DESC LIMIT ${PER_KIND}`, [owner, ...w.args])) {
      out.push({ kind: 'event', id: e.id, icon: e.yearly ? '🎂' : '📌', title: e.title, detail: join(e.yearly ? `Every year, ${e.day.slice(5)}` : e.day), link: `/calendar?day=${e.yearly ? e.day.slice(5) : e.day}` });
    }
  }

  // What starts with what was typed comes first, then what has it as a whole word, then the rest.
  const first = words[0]!;
  const rank = (r: SearchResult) => { const t = r.title.toLowerCase(); return t.startsWith(first) ? 0 : new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t) ? 1 : 2; };
  return out.map((r, i) => ({ r, i, n: rank(r) })).sort((a, b) => a.n - b.n || a.i - b.i).map((x) => x.r);
}
