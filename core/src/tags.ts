/**
 * Tags: one list for the household, put on things, recipes, projects, plans, spending, titles, pets, upkeep
 * jobs and calendar dates. A tag can sit inside another ("Kitchen > Appliances"), and asking for a tag asks
 * for the tags inside it too.
 *
 * A link names the kind of thing and its id. The kinds live in many tables, so there is no foreign key to the
 * thing: the code takes a thing's links away when the thing is removed (`unlink`), and every read joins the
 * thing, so a link that was left behind never shows.
 *
 * `tags(db, owner)` is one household's tags: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { Problem } from './problem.ts';
import { clean, labelKey, stamp, todayOf, type Clock } from './small.ts';

export const TAG_KINDS = ['thing', 'recipe', 'project', 'plan', 'spending', 'title', 'pet', 'job', 'event'] as const;
export type TagKind = (typeof TAG_KINDS)[number];
/** A tag as shown on a row: its name, and where it sits ("Kitchen > Appliances"). */
export type TagRef = { id: number; name: string; path: string };
/** A tag in the tree. `own` counts what carries it; `total` counts what carries it or a tag inside it. */
export type TagNode = TagRef & { parent_id: number | null; depth: number; own: number; total: number };
export type Tagged = { kind: TagKind; id: number; icon: string; title: string; detail: string | null; link: string };
export type TagPage = { tag: TagRef & { parent_id: number | null }; trail: TagRef[]; inside: TagNode[]; groups: { kind: TagKind; label: string; items: Tagged[] }[]; total: number;
  /** What the spending with this tag (or one inside it) came to: this month, this year, and all of it. */
  spending: { currency: string; count: number; month: number; year: number; all: number } };

export const MAX_TAG_NAME = 60;
const MAX_TARGETS = 500;

type TagRow = { id: number; name: string; key: string; parent_id: number | null };

/**
 * How each kind is read: `rows` gives the things that are this person's (and nothing else), as id, title,
 * detail and extra. A link joins it, which is what keeps a link to something removed from showing.
 */
const KINDS: Record<TagKind, { label: string; icon: string; rows: string; args: (owner: number) => Value[]; link: (r: Base) => string }> = {
  thing: {
    label: 'Things', icon: '📦', args: (o) => [o],
    rows: 'SELECT i.id, i.name AS title, k.name AS detail, COALESCE(k.icon, \'📦\') AS extra FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ?',
    link: (r) => `/things/${r.id}`,
  },
  recipe: { label: 'Recipes', icon: '🍳', args: (o) => [o], rows: 'SELECT id, title, NULL AS detail, NULL AS extra FROM recipes WHERE owner_id = ?', link: (r) => `/recipes/${r.id}` },
  project: { label: 'Projects', icon: '🧵', args: (o) => [o], rows: 'SELECT id, name AS title, status AS detail, NULL AS extra FROM projects WHERE owner_id = ?', link: (r) => `/projects/${r.id}` },
  plan: { label: 'Plans', icon: '✨', args: (o) => [o], rows: 'SELECT id, name AS title, start_day AS detail, NULL AS extra FROM plans WHERE owner_id = ?', link: (r) => `/plans/${r.id}` },
  spending: {
    label: 'Spending', icon: '💵', args: (o) => [o],
    rows: "SELECT id, label AS title, printf('%.2f', cents / 100.0) || ' on ' || day AS detail, day AS extra FROM money_entries WHERE owner_id = ?",
    link: (r) => `/money?month=${String(r.extra).slice(0, 7)}`,
  },
  title: { label: 'Collection', icon: '🎬', args: (o) => [o], rows: 'SELECT id, title, creator AS detail, type AS extra FROM media WHERE owner_id = ?', link: (r) => `/media/${r.id}` },
  pet: { label: 'Pets', icon: '🐾', args: (o) => [o], rows: 'SELECT id, name AS title, species AS detail, NULL AS extra FROM pets WHERE owner_id = ?', link: (r) => `/things/pets/${r.id}` },
  job: {
    label: 'Upkeep', icon: '🔧', args: (o) => [o, o],
    rows: 'SELECT id, name AS title, activity AS detail, NULL AS extra FROM upkeep_jobs WHERE (owner_id = ? OR assigned_to = ?)', link: (r) => `/things/upkeep/${r.id}`,
  },
  event: {
    label: 'Calendar dates', icon: '📌', args: (o) => [o],
    rows: "SELECT id, title, CASE WHEN yearly = 1 THEN 'Every year, ' || SUBSTR(day, 6) ELSE day END AS detail, CASE WHEN yearly = 1 THEN SUBSTR(day, 6) ELSE day END AS extra FROM events WHERE owner_id = ?",
    link: (r) => `/calendar?day=${r.extra}`,
  },
};
type Base = { id: number; title: string; detail: string | null; extra: string | null };

export const isTagKind = (kind: string): kind is TagKind => (TAG_KINDS as readonly string[]).includes(kind);

// ---------- reading, usable inside a transaction ----------

async function allTags(q: Queries, owner: number): Promise<Map<number, TagRow>> {
  const rows = await q.all<TagRow>('SELECT id, name, key, parent_id FROM tags WHERE owner_id = ? ORDER BY id', [owner]);
  return new Map(rows.map((r) => [r.id, r]));
}

function pathOf(all: Map<number, TagRow>, id: number): string {
  const names: string[] = [];
  for (let at: TagRow | undefined = all.get(id), guard = 0; at && guard < 50; at = at.parent_id === null ? undefined : all.get(at.parent_id), guard += 1) names.unshift(at.name);
  return names.join(' > ');
}

/** A tag and every tag inside it, as ids. */
function withinOf(all: Map<number, TagRow>, id: number): Set<number> {
  const inside = new Set<number>([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of all.values()) {
      if (t.parent_id !== null && inside.has(t.parent_id) && !inside.has(t.id)) { inside.add(t.id); grew = true; }
    }
  }
  return inside;
}

/** The ids of what carries this tag or one inside it, of one kind, among this person's things. Nothing stray. */
export async function idsWithTag(q: Queries, owner: number, kind: TagKind, tagId: number): Promise<Set<number>> {
  const all = await allTags(q, owner);
  if (!all.has(tagId)) throw new Problem(404, 'Not found');
  const inside = [...withinOf(all, tagId)];
  const k = KINDS[kind];
  const rows = await q.all<{ id: number }>(
    `SELECT DISTINCT b.id FROM tag_links l JOIN (${k.rows}) b ON b.id = l.target_id WHERE l.kind = ? AND l.tag_id IN (${inside.map(() => '?').join(',')})`,
    [...k.args(owner), kind, ...inside]);
  return new Set(rows.map((r) => r.id));
}

/** The tags on each of some things of one kind: id -> tags, by path. Things with none are left out. */
export async function tagsOnto(q: Queries, owner: number, kind: TagKind, ids: number[]): Promise<Map<number, TagRef[]>> {
  const out = new Map<number, TagRef[]>();
  if (ids.length === 0) return out;
  const all = await allTags(q, owner);
  for (let from = 0; from < ids.length; from += 400) {
    const part = ids.slice(from, from + 400);
    for (const l of await q.all<{ target_id: number; tag_id: number }>(
      `SELECT l.target_id, l.tag_id FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE t.owner_id = ? AND l.kind = ? AND l.target_id IN (${part.map(() => '?').join(',')})`,
      [owner, kind, ...part])) {
      const tag = all.get(l.tag_id);
      if (!tag) continue;
      const list = out.get(l.target_id) ?? [];
      list.push({ id: tag.id, name: tag.name, path: pathOf(all, tag.id) });
      out.set(l.target_id, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  return out;
}

/** Gives each row a `tag_list`. */
export async function attachTags<T extends { id: number }>(q: Queries, owner: number, kind: TagKind, rows: T[]): Promise<(T & { tag_list: TagRef[] })[]> {
  const on = await tagsOnto(q, owner, kind, rows.map((r) => r.id));
  return rows.map((r) => Object.assign(r, { tag_list: on.get(r.id) ?? [] }));
}

/** Keeps the rows that carry the tag (or one inside it). Without a tag, all of them. */
export async function onlyTagged<T extends { id: number }>(q: Queries, owner: number, kind: TagKind, rows: T[], tag: number | null | undefined): Promise<T[]> {
  if (tag == null) return rows;
  const have = await idsWithTag(q, owner, kind, tag);
  return rows.filter((r) => have.has(r.id));
}

/** Inclusive first and last day of a month ("2046-03") or a year ("2046"). */
export const span = (period: string): [string, string] => (period.length === 4 ? [`${period}-01-01`, `${period}-12-31`] : [`${period}-01`, `${period}-31`]);
/** One tag's spending, in whole cents, counting what is tagged with it or with a tag inside it. */
export type TagSpend = TagRef & { parent_id: number | null; depth: number; cents: number; count: number };

/**
 * What each tag's spending came to between two days (both included). A tag counts what carries it and what
 * carries a tag inside it, each entry once even when it has several tags inside one. Only this person's own
 * spending entries: tags are theirs alone. Tags with nothing in the period are left out.
 */
export async function spendingByTag(q: Queries, owner: number, from: string, to: string): Promise<TagSpend[]> {
  const all = await allTags(q, owner);
  const links = await q.all<{ tag_id: number; id: number; cents: number }>(
    `SELECT l.tag_id, e.id, e.cents FROM tag_links l JOIN money_entries e ON e.id = l.target_id
     WHERE l.kind = 'spending' AND e.owner_id = ? AND e.day BETWEEN ? AND ?`, [owner, from, to]);
  const entries = new Map<number, Map<number, number>>();
  for (const l of links) {
    if (!all.has(l.tag_id)) continue;
    // The tag, and every tag above it: the entry counts toward each, once.
    for (let at: TagRow | undefined = all.get(l.tag_id), guard = 0; at && guard < 50; at = at.parent_id === null ? undefined : all.get(at.parent_id), guard += 1) {
      const here = entries.get(at.id) ?? new Map<number, number>();
      here.set(l.id, l.cents);
      entries.set(at.id, here);
    }
  }
  const out: TagSpend[] = [];
  for (const [id, here] of entries) {
    const path = pathOf(all, id);
    out.push({ id, name: all.get(id)!.name, path, parent_id: all.get(id)!.parent_id, depth: path.split(' > ').length - 1, cents: [...here.values()].reduce((n, c) => n + c, 0), count: here.size });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
}

/** A thing was removed: its links go too. */
export async function unlink(q: Queries, kind: TagKind, id: number): Promise<void> {
  await q.run('DELETE FROM tag_links WHERE kind = ? AND target_id = ?', [kind, id]);
}

/**
 * Sets the tags of one thing from words: each found by name (the first tag with that name, the top-level one
 * before one inside another), or made at the top. Used where a thing arrives with its tags as words (a
 * recipe file, an import).
 */
export async function setByNames(q: Queries, owner: number, kind: TagKind, id: number, names: string[], at: string): Promise<void> {
  const all = await allTags(q, owner);
  const wanted = new Set<number>();
  for (const raw of names) {
    const name = clean(raw, MAX_TAG_NAME);
    if (!name) continue;
    const key = labelKey(name);
    const same = [...all.values()].filter((t) => t.key === key).sort((a, b) => (a.parent_id === null ? 0 : 1) - (b.parent_id === null ? 0 : 1) || a.id - b.id);
    if (same[0]) { wanted.add(same[0].id); continue; }
    const made = await q.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)', [owner, name, key, at]);
    all.set(made.lastId, { id: made.lastId, name, key, parent_id: null });
    wanted.add(made.lastId);
  }
  await q.run('DELETE FROM tag_links WHERE kind = ? AND target_id = ? AND tag_id IN (SELECT id FROM tags WHERE owner_id = ?)', [kind, id, owner]);
  for (const tagId of wanted) await q.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) VALUES (?, ?, ?)', [tagId, kind, id]);
}

/** The tag ids whose full path holds every one of the words, with everything inside them. For search. */
export async function tagsMatching(q: Queries, owner: number, words: string[]): Promise<{ matches: TagRef[]; inside: number[] }> {
  const all = await allTags(q, owner);
  const matches: TagRef[] = [];
  const inside = new Set<number>();
  for (const t of all.values()) {
    const path = pathOf(all, t.id);
    if (words.every((w) => path.toLowerCase().includes(w))) {
      matches.push({ id: t.id, name: t.name, path });
      for (const id of withinOf(all, t.id)) inside.add(id);
    }
  }
  return { matches, inside: [...inside] };
}

/** Ids of one kind carrying any of these tags, among this person's things. */
export async function idsWithAny(q: Queries, owner: number, kind: TagKind, tagIds: number[]): Promise<number[]> {
  if (tagIds.length === 0) return [];
  const k = KINDS[kind];
  const rows = await q.all<{ id: number }>(
    `SELECT DISTINCT b.id FROM tag_links l JOIN (${k.rows}) b ON b.id = l.target_id WHERE l.kind = ? AND l.tag_id IN (${tagIds.map(() => '?').join(',')})`, [...k.args(owner), kind, ...tagIds]);
  return rows.map((r) => r.id);
}

/** Every live link of this person's tags: which tag, which kind, which thing, and how to show it. */
export async function liveLinks(q: Queries, owner: number, kinds: readonly TagKind[] = TAG_KINDS): Promise<{ tag_id: number; kind: TagKind; base: Base }[]> {
  const out: { tag_id: number; kind: TagKind; base: Base }[] = [];
  for (const kind of kinds) {
    const k = KINDS[kind];
    for (const r of await q.all<Base & { tag_id: number }>(
      `SELECT l.tag_id, b.* FROM tag_links l JOIN tags t ON t.id = l.tag_id JOIN (${k.rows}) b ON b.id = l.target_id WHERE t.owner_id = ? AND l.kind = ?`, [...k.args(owner), owner, kind])) {
      const { tag_id, ...base } = r;
      out.push({ tag_id, kind, base });
    }
  }
  return out;
}

/** For the export: every tag with its path, and what carries it (a tag nothing carries has no kind or name). */
export async function exportRows(q: Queries, owner: number): Promise<string[][]> {
  const all = await allTags(q, owner);
  const links = await liveLinks(q, owner);
  const rows: string[][] = [];
  for (const t of all.values()) {
    const mine = links.filter((l) => l.tag_id === t.id);
    if (mine.length === 0) rows.push([pathOf(all, t.id), '', '']);
    for (const l of mine) rows.push([pathOf(all, t.id), KINDS[l.kind].label, l.base.title]);
  }
  return rows.sort((a, b) => a[0]!.localeCompare(b[0]!, undefined, { sensitivity: 'base' }) || a[1]!.localeCompare(b[1]!) || a[2]!.localeCompare(b[2]!, undefined, { sensitivity: 'base' }));
}

/**
 * Finds or makes the tag at the end of a path ("Kitchen > Appliances"), making each step that is missing. Used
 * where tags arrive as text (an export being brought back in).
 */
export async function ensurePath(q: Queries, owner: number, text: string, at: string): Promise<number | null> {
  let parent: number | null = null;
  for (const part of text.split('>')) {
    const name = clean(part, MAX_TAG_NAME);
    if (!name) continue;
    const key = labelKey(name);
    const found: { id: number } | undefined = await q.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND COALESCE(parent_id, 0) = ? AND key = ?', [owner, parent ?? 0, key]);
    parent = found ? found.id : (await q.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, ?, ?)', [owner, name, key, parent, at])).lastId;
  }
  return parent;
}

/** Sets the tags of one thing from paths. */
export async function setByPaths(q: Queries, owner: number, kind: TagKind, id: number, paths: string[], at: string): Promise<void> {
  await q.run('DELETE FROM tag_links WHERE kind = ? AND target_id = ? AND tag_id IN (SELECT id FROM tags WHERE owner_id = ?)', [kind, id, owner]);
  for (const p of paths) {
    const tag = await ensurePath(q, owner, p, at);
    if (tag !== null) await q.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) VALUES (?, ?, ?)', [tag, kind, id]);
  }
}

// ---------- the household's tags ----------

export function tags(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  function named(text: string | null | undefined): { name: string; key: string } {
    const name = clean(text, MAX_TAG_NAME);
    if (!name) throw new Problem(400, 'Give the tag a name');
    if (name.includes('>')) throw new Problem(400, 'A tag name cannot have > in it. To put one tag inside another, move it.');
    return { name, key: labelKey(name) };
  }
  async function mine(q: Queries, id: number): Promise<TagRow> {
    const found = await q.get<TagRow>('SELECT id, name, key, parent_id FROM tags WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }
  async function sibling(q: Queries, parent: number | null, key: string, except?: number): Promise<TagRow | undefined> {
    return q.get<TagRow>(
      'SELECT id, name, key, parent_id FROM tags WHERE owner_id = ? AND COALESCE(parent_id, 0) = ? AND key = ? AND id != ?', [owner, parent ?? 0, key, except ?? 0]);
  }
  const refOf = (all: Map<number, TagRow>, id: number): TagRef => ({ id, name: all.get(id)!.name, path: pathOf(all, id) });

  /** Moves everything `from` carries onto `into`, moves what is inside `from` under `into`, and removes `from`. */
  async function mergeInto(q: Queries, from: number, into: number): Promise<void> {
    const all = await allTags(q, owner);
    let target = into;
    if (withinOf(all, from).has(into)) {
      // Merging into a tag inside itself: that tag steps up to where `from` is, then takes its place.
      const f = all.get(from)!;
      const clash = await sibling(q, f.parent_id, all.get(into)!.key, into);
      if (clash) throw new Problem(409, 'Merge those two first: both already have a tag with that name in the same place');
      await q.run('UPDATE tags SET parent_id = ? WHERE id = ?', [f.parent_id, into]);
      target = into;
    }
    await q.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) SELECT ?, kind, target_id FROM tag_links WHERE tag_id = ?', [target, from]);
    await q.run('DELETE FROM tag_links WHERE tag_id = ?', [from]);
    for (const child of await q.all<TagRow>('SELECT id, name, key, parent_id FROM tags WHERE parent_id = ? ORDER BY id', [from])) {
      const clash = await sibling(q, target, child.key);
      if (clash) await mergeInto(q, child.id, clash.id);
      else await q.run('UPDATE tags SET parent_id = ? WHERE id = ?', [target, child.id]);
    }
    await q.run('DELETE FROM tags WHERE id = ?', [from]);
  }

  const live = (q: Queries, kinds?: readonly TagKind[]) => liveLinks(q, owner, kinds);

  /** Targets that are this person's, checked before anything is tagged. */
  async function checkTargets(q: Queries, kind: TagKind, ids: number[]): Promise<number[]> {
    if (!isTagKind(kind)) throw new Problem(400, "Tags can't go on that");
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    if (unique.length > MAX_TARGETS) throw new Problem(400, `Tag ${MAX_TARGETS} at most at once`);
    const k = KINDS[kind];
    const have = new Set((await q.all<{ id: number }>(`SELECT id FROM (${k.rows}) WHERE id IN (${unique.map(() => '?').join(',')})`, [...k.args(owner), ...unique])).map((r) => r.id));
    if (unique.some((id) => !have.has(id))) throw new Problem(404, 'Not found');
    return unique;
  }
  async function checkTags(q: Queries, ids: number[]): Promise<number[]> {
    const unique = [...new Set(ids)];
    for (const id of unique) await mine(q, id);
    return unique;
  }

  return {
    /** Every tag, in tree order (each tag, then what is inside it), with how many things carry it. */
    async list(): Promise<TagNode[]> {
      const all = await allTags(db, owner);
      const links = await live(db);
      const kids = new Map<number | null, TagRow[]>();
      for (const t of all.values()) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
      const out: TagNode[] = [];
      const walk = (parent: number | null, depth: number) => {
        for (const t of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id)) {
          const inside = withinOf(all, t.id);
          const own = new Set(links.filter((l) => l.tag_id === t.id).map((l) => `${l.kind}:${l.base.id}`));
          const total = new Set(links.filter((l) => inside.has(l.tag_id)).map((l) => `${l.kind}:${l.base.id}`));
          out.push({ id: t.id, name: t.name, path: pathOf(all, t.id), parent_id: t.parent_id, depth, own: own.size, total: total.size });
          walk(t.id, depth + 1);
        }
      };
      walk(null, 0);
      return out;
    },

    /** One tag: where it sits, what is inside it, and everything with it (or with a tag inside it), by kind. */
    async page(id: number): Promise<TagPage> {
      const all = await allTags(db, owner);
      const t = all.get(id);
      if (!t) throw new Problem(404, 'Not found');
      const inside = withinOf(all, id);
      const links = (await live(db)).filter((l) => inside.has(l.tag_id));
      const trail: TagRef[] = [];
      for (let at: TagRow | undefined = t.parent_id === null ? undefined : all.get(t.parent_id), guard = 0; at && guard < 50; at = at.parent_id === null ? undefined : all.get(at.parent_id), guard += 1) trail.unshift(refOf(all, at.id));
      const groups = TAG_KINDS.map((kind) => {
        const seen = new Set<number>();
        const items: Tagged[] = [];
        for (const l of links.filter((x) => x.kind === kind)) {
          if (seen.has(l.base.id)) continue;
          seen.add(l.base.id);
          items.push({ kind, id: l.base.id, icon: kind === 'thing' ? (l.base.extra ?? KINDS.thing.icon) : KINDS[kind].icon, title: l.base.title, detail: l.base.detail, link: KINDS[kind].link(l.base) });
        }
        items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
        return { kind, label: KINDS[kind].label, items };
      }).filter((g) => g.items.length > 0);
      const nodes = (await this.list()).filter((n) => inside.has(n.id) && n.id !== id);
      const today = todayOf(clock);
      const spent = async (from: string, to: string) => (await spendingByTag(db, owner, from, to)).find((x) => x.id === id) ?? { cents: 0, count: 0 };
      const [m1, m2] = span(today.slice(0, 7));
      const [y1, y2] = span(today.slice(0, 4));
      const [month, year, every] = [await spent(m1, m2), await spent(y1, y2), await spent('0000-01-01', '9999-12-31')];
      return {
        tag: { id, name: t.name, path: pathOf(all, id), parent_id: t.parent_id }, trail, inside: nodes, groups, total: groups.reduce((n, g) => n + g.items.length, 0),
        spending: { currency: (await db.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'shopping_currency'", [owner]))?.value ?? '$', count: every.count, month: month.cents, year: year.cents, all: every.cents },
      };
    },

    /**
     * Makes a tag, under another when `parent` is given. Typing "Kitchen > Appliances" makes both (or finds
     * Kitchen, which is already there). A name that is already there in the same place gives that tag back.
     */
    async create(text: string, parent?: number | null): Promise<TagRef> {
      const parts = text.split('>').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) throw new Problem(400, 'Give the tag a name');
      return atomic(db, async (tx) => {
        let at: number | null = parent ?? null;
        if (at !== null) await mine(tx, at);
        for (const part of parts) {
          const { name, key } = named(part);
          const found = await sibling(tx, at, key);
          if (found) { at = found.id; continue; }
          at = (await tx.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, ?, ?)', [owner, name, key, at, now()])).lastId;
        }
        return refOf(await allTags(tx, owner), at!);
      });
    },

    async rename(id: number, text: string): Promise<TagRef> {
      const { name, key } = named(text);
      return atomic(db, async (tx) => {
        const t = await mine(tx, id);
        if (await sibling(tx, t.parent_id, key, id)) throw new Problem(409, 'There is already a tag with that name in the same place. Merge them instead.');
        await tx.run('UPDATE tags SET name = ?, key = ? WHERE id = ?', [name, key, id]);
        return refOf(await allTags(tx, owner), id);
      });
    },

    /** Puts a tag inside another, or at the top (`parent` null). Never inside itself or what is inside it. */
    async move(id: number, parent: number | null): Promise<TagRef> {
      return atomic(db, async (tx) => {
        const t = await mine(tx, id);
        const all = await allTags(tx, owner);
        if (parent !== null) {
          await mine(tx, parent);
          if (withinOf(all, id).has(parent)) throw new Problem(400, "A tag can't go inside itself or inside a tag that is inside it");
        }
        if (await sibling(tx, parent, t.key, id)) throw new Problem(409, 'There is already a tag with that name there. Merge them instead.');
        await tx.run('UPDATE tags SET parent_id = ? WHERE id = ?', [parent, id]);
        return refOf(await allTags(tx, owner), id);
      });
    },

    /** Everything `from` carries goes onto `into` (nothing twice); what is inside `from` goes inside `into`; `from` is removed. */
    async merge(from: number, into: number): Promise<TagRef> {
      if (from === into) throw new Problem(400, 'Pick two different tags');
      return atomic(db, async (tx) => {
        await mine(tx, from);
        await mine(tx, into);
        await mergeInto(tx, from, into);
        return refOf(await allTags(tx, owner), into);
      });
    },

    /** Removes a tag from everything. What was inside it moves up to where it was (joining a tag of the same name there). */
    async remove(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        const t = await mine(tx, id);
        await tx.run('DELETE FROM tag_links WHERE tag_id = ?', [id]);
        for (const child of await tx.all<TagRow>('SELECT id, name, key, parent_id FROM tags WHERE parent_id = ? ORDER BY id', [id])) {
          const clash = await sibling(tx, t.parent_id, child.key, id);
          if (clash) await mergeInto(tx, child.id, clash.id);
          else await tx.run('UPDATE tags SET parent_id = ? WHERE id = ?', [t.parent_id, child.id]);
        }
        await tx.run('DELETE FROM tags WHERE id = ?', [id]);
      });
    },

    /** The tags on one thing, in full. */
    async of(kind: TagKind, id: number): Promise<TagRef[]> {
      if (!isTagKind(kind)) throw new Problem(400, "Tags can't go on that");
      await checkTargets(db, kind, [id]);
      return (await tagsOnto(db, owner, kind, [id])).get(id) ?? [];
    },

    /** Replaces the tags on one thing with exactly these. */
    async set(kind: TagKind, id: number, tagIds: number[]): Promise<TagRef[]> {
      return atomic(db, async (tx) => {
        await checkTargets(tx, kind, [id]);
        const wanted = await checkTags(tx, tagIds);
        await tx.run('DELETE FROM tag_links WHERE kind = ? AND target_id = ? AND tag_id IN (SELECT id FROM tags WHERE owner_id = ?)', [kind, id, owner]);
        for (const t of wanted) await tx.run('INSERT INTO tag_links (tag_id, kind, target_id) VALUES (?, ?, ?)', [t, kind, id]);
        return (await tagsOnto(tx, owner, kind, [id])).get(id) ?? [];
      });
    },

    /** Adds some tags to, and takes some off, many things of one kind at once. */
    async change(kind: TagKind, ids: number[], add: number[], remove: number[]): Promise<{ changed: number }> {
      return atomic(db, async (tx) => {
        const targets = await checkTargets(tx, kind, ids);
        const adding = await checkTags(tx, add);
        const removing = await checkTags(tx, remove);
        for (const id of targets) {
          for (const t of adding) await tx.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) VALUES (?, ?, ?)', [t, kind, id]);
          for (const t of removing) await tx.run('DELETE FROM tag_links WHERE tag_id = ? AND kind = ? AND target_id = ?', [t, kind, id]);
        }
        return { changed: targets.length };
      });
    },
  };
}

export type Tags = ReturnType<typeof tags>;
