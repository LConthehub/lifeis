/**
 * Plans, and the memories they become.
 *
 * A plan is something with a name and its days: a holiday, a party, an afternoon's sewing. It can be made
 * ahead, or written down afterwards. What belongs to it is drawn from everywhere else and only pointed at,
 * never copied: recipes from the kitchen, things you keep (with how many are needed, so it can say what
 * you're short of), titles from the collection, a project, and a checklist of its own.
 *
 * Once its days have come, a plan also shows what happened on them, gathered from the calendar (what was
 * cooked, worked on, watched), and keeps your own words about how it went and your photos. Nothing is
 * thrown away when it's over: past plans are there to look back on, and to start next year's from.
 *
 * A photo is either kept here (one picked from a phone or computer) or only linked (one that lives in a
 * photo library such as Immich, which is asked for it each time it's shown; see photos.ts).
 */
import { calendar, type Entry } from './calendar.ts';
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { inventory } from './inventory.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, stamp, todayOf, type Clock } from './small.ts';

export const PLAN_ITEM_KINDS = ['task', 'recipe', 'thing', 'media', 'project'] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

export type PlanInput = {
  name: string;
  /** The day, or the first of several, as 2046-03-05. */
  start_day: string;
  end_day?: string | null;
  /** What it's for, written ahead. */
  note?: string | null;
  /** How it went, written afterwards. */
  story?: string | null;
};
export type PlanItemInput = {
  kind: string;
  /** Which recipe, thing, title or project. Not for a task. */
  ref_id?: number | null;
  /** A task's words. For the rest, left out: the name of what it points at is used. */
  label?: string | null;
  /** How many of a thing are needed. */
  quantity?: number | null;
  note?: string | null;
  done?: boolean;
};
export type PlanItem = {
  id: number; kind: PlanItemKind; ref_id: number | null; label: string; quantity: number | null; note: string | null; done: boolean;
  /** The page of what it points at; null for a task, or when that has since been removed. */
  link: string | null;
  /** For a thing: what you're short of, in words, or null when there's enough. */
  short: string | null;
  /** For a thing: where it's kept. For a title: the formats you have it on. */
  detail: string | null;
};
export type PlanPhoto = { id: number; source: 'kept' | 'immich'; caption: string | null };
export type PlanWhen = 'ahead' | 'now' | 'past';
export type PlanSummary = {
  id: number; name: string; start_day: string; end_day: string; when: PlanWhen; note: string | null;
  items: number; tasks_left: number; photos: number; cover_photo: number | null;
};
export type Plan = PlanSummary & { story: string | null; items_list: PlanItem[]; photos_list: PlanPhoto[]; /** What the calendar holds for its days, once they've come. */ happened: Entry[] };

const MAX_DAYS = 62;
const MAX_PHOTOS = 80;
export const MAX_PHOTO_BYTES = 3_000_000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type PlanRow = { id: number; name: string; start_day: string; end_day: string; note: string | null; story: string | null };
type ItemRow = { id: number; plan_id: number; kind: PlanItemKind; ref_id: number | null; label: string; quantity: number | null; note: string | null; done: number };

/** What kind of picture these bytes are, going by how they begin; null when they aren't one Life Is keeps. */
export function pictureType(bytes: Uint8Array): string | null {
  const starts = (...head: number[]) => head.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export function plans(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const when = (row: { start_day: string; end_day: string }): PlanWhen => {
    const today = todayOf(clock);
    return row.end_day < today ? 'past' : row.start_day > today ? 'ahead' : 'now';
  };

  function checked(input: PlanInput): Value[] {
    const name = clean(input.name, 200);
    if (!name) throw new Problem(400, 'Give it a name');
    dayNumber(input.start_day);
    const end = dayOrNull(input.end_day) ?? input.start_day;
    if (dayNumber(end) < dayNumber(input.start_day)) throw new Problem(400, "It can't end before it starts");
    if (dayNumber(end) - dayNumber(input.start_day) >= MAX_DAYS) throw new Problem(400, `A plan runs for ${MAX_DAYS} days at most`);
    return [name, input.start_day, end, clean(input.note, 5000), clean(input.story, 20_000)];
  }

  async function row(q: Queries, id: number): Promise<PlanRow> {
    const found = await q.get<PlanRow>('SELECT id, name, start_day, end_day, note, story FROM plans WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }

  /** The name of what an item points at, checking it is the person's own. */
  async function pointedAt(q: Queries, kind: PlanItemKind, ref: number): Promise<string> {
    const table = { recipe: ['recipes', 'title'], thing: ['items', 'name'], media: ['media', 'title'], project: ['projects', 'name'] }[kind as Exclude<PlanItemKind, 'task'>];
    const found = await q.get<{ label: string }>(`SELECT ${table[1]} AS label FROM ${table[0]} WHERE id = ? AND owner_id = ?`, [ref, owner]);
    if (!found) throw new Problem(404, "That isn't there to add");
    return found.label;
  }

  async function itemValues(q: Queries, input: PlanItemInput): Promise<{ kind: PlanItemKind; ref: number | null; label: string; quantity: number | null; note: string | null }> {
    if (!PLAN_ITEM_KINDS.includes(input.kind as PlanItemKind)) throw new Problem(400, "That isn't something a plan holds");
    const kind = input.kind as PlanItemKind;
    const quantity = input.quantity ?? null;
    if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) throw new Problem(400, 'How many is a number above nothing');
    if (kind === 'task') {
      const label = clean(input.label, 300);
      if (!label) throw new Problem(400, 'Say what needs doing');
      return { kind, ref: null, label, quantity: null, note: clean(input.note, 1000) };
    }
    if (input.ref_id == null) throw new Problem(400, 'Choose what to add');
    return { kind, ref: input.ref_id, label: await pointedAt(q, kind, input.ref_id), quantity: kind === 'thing' ? quantity : null, note: clean(input.note, 1000) };
  }

  /** A plan's items as they stand now: names refreshed from what they point at, and what's short said. */
  async function itemsOf(q: Queries, planId: number): Promise<PlanItem[]> {
    const rows = await q.all<ItemRow>('SELECT id, plan_id, kind, ref_id, label, quantity, note, done FROM plan_items WHERE plan_id = ? ORDER BY sort_order, id', [planId]);
    const names = async (table: string, column: string) =>
      new Map((await q.all<{ id: number; label: string }>(`SELECT id, ${column} AS label FROM ${table} WHERE owner_id = ?`, [owner])).map((r) => [r.id, r.label]));
    const has = (kind: PlanItemKind) => rows.some((r) => r.kind === kind);
    const recipes = has('recipe') ? await names('recipes', 'title') : new Map<number, string>();
    const projectNames = has('project') ? await names('projects', 'name') : new Map<number, string>();
    const things = has('thing') ? new Map((await inventory(db, owner, clock).listItems()).map((item) => [item.id, item])) : new Map();
    const titles = has('media') ? new Map((await q.all<{ id: number; title: string; formats: string | null }>(
      `SELECT m.id, m.title, (SELECT GROUP_CONCAT(DISTINCT c.format) FROM media_copies c WHERE c.media_id = m.id) AS formats FROM media m WHERE m.owner_id = ?`, [owner])).map((r) => [r.id, r])) : new Map();

    return rows.map((r): PlanItem => {
      const base = { id: r.id, kind: r.kind, ref_id: r.ref_id, quantity: r.quantity, note: r.note, done: r.done === 1, short: null as string | null, detail: null as string | null };
      if (r.kind === 'task' || r.ref_id === null) return { ...base, label: r.label, link: null };
      if (r.kind === 'recipe') return { ...base, label: recipes.get(r.ref_id) ?? r.label, link: recipes.has(r.ref_id) ? `/recipes/${r.ref_id}` : null };
      if (r.kind === 'project') return { ...base, label: projectNames.get(r.ref_id) ?? r.label, link: projectNames.has(r.ref_id) ? `/projects/${r.ref_id}` : null };
      if (r.kind === 'media') {
        const title = titles.get(r.ref_id);
        return { ...base, label: title?.title ?? r.label, link: title ? `/media/${r.ref_id}` : null, detail: title?.formats?.split(',').join(', ') ?? null };
      }
      const thing = things.get(r.ref_id);
      if (!thing) return { ...base, label: r.label, link: null, short: "it's no longer among your things" };
      const need = r.quantity ?? 1;
      const short = thing.quantity !== null && thing.quantity < need ? `needs ${need}${thing.unit ? ` ${thing.unit}` : ''}, and you have ${thing.amount}` : null;
      return { ...base, label: thing.name, link: '/things', short, detail: thing.place };
    });
  }

  const photosOf = (q: Queries, planId: number) =>
    q.all<{ id: number; source: 'kept' | 'immich'; caption: string | null }>('SELECT id, source, caption FROM plan_photos WHERE plan_id = ? ORDER BY sort_order, id', [planId]);

  async function summaries(where: string, args: Value[]): Promise<PlanSummary[]> {
    const rows = await db.all<PlanRow & { items: number; tasks_left: number; photos: number; cover_photo: number | null }>(
      `SELECT p.id, p.name, p.start_day, p.end_day, p.note, p.story,
         (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id) AS items,
         (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id AND i.kind = 'task' AND i.done = 0) AS tasks_left,
         (SELECT COUNT(*) FROM plan_photos f WHERE f.plan_id = p.id) AS photos,
         (SELECT f.id FROM plan_photos f WHERE f.plan_id = p.id ORDER BY f.sort_order, f.id LIMIT 1) AS cover_photo
       FROM plans p WHERE p.owner_id = ? ${where} ORDER BY p.start_day DESC, p.id DESC`, [owner, ...args]);
    return rows.map(({ story: _story, ...r }) => ({ ...r, when: when(r) }));
  }

  async function whole(id: number): Promise<Plan> {
    const found = await row(db, id);
    const [summary] = await summaries('AND p.id = ?', [id]);
    const today = todayOf(clock);
    // What happened is only what has happened: the plan's days up to today, and never the plan itself.
    const lastSeen = found.end_day < today ? found.end_day : today;
    const happened = found.start_day <= today
      ? (await calendar(db, owner, clock).between(found.start_day, dayNumber(lastSeen) - dayNumber(found.start_day) + 1)).filter((e) => ['meal', 'session', 'media'].includes(e.kind))
      : [];
    return { ...summary!, story: found.story, items_list: await itemsOf(db, id), photos_list: await photosOf(db, id), happened };
  }

  const planOfItem = async (q: Queries, itemId: number): Promise<number> => {
    const found = await q.get<{ plan_id: number }>('SELECT i.plan_id FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE i.id = ? AND p.owner_id = ?', [itemId, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found.plan_id;
  };
  const planOfPhoto = async (q: Queries, photoId: number): Promise<number> => {
    const found = await q.get<{ plan_id: number }>('SELECT f.plan_id FROM plan_photos f JOIN plans p ON p.id = f.plan_id WHERE f.id = ? AND p.owner_id = ?', [photoId, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found.plan_id;
  };
  async function roomForPhoto(q: Queries, planId: number): Promise<number> {
    await row(q, planId);
    const count = (await q.get<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(sort_order) AS last FROM plan_photos WHERE plan_id = ?', [planId]))!;
    if (count.n >= MAX_PHOTOS) throw new Problem(400, `A plan holds ${MAX_PHOTOS} photos at most`);
    return (count.last ?? 0) + 1;
  }

  return {
    /** Every plan, newest first: those ahead and under way, and the ones to look back on. */
    list: () => summaries('', []),
    get: whole,

    async create(input: PlanInput): Promise<Plan> {
      const made = await db.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, story, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, ...checked(input), now(), now()]);
      return whole(made.lastId);
    },

    async update(id: number, input: PlanInput): Promise<Plan> {
      const values = checked(input);
      await row(db, id);
      await db.run('UPDATE plans SET name = ?, start_day = ?, end_day = ?, note = ?, story = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [...values, now(), id, owner]);
      return whole(id);
    },

    /** Remove a plan, with its checklist and photos. What it pointed at is untouched. */
    async remove(id: number): Promise<void> {
      await db.run('DELETE FROM plans WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    /**
     * Start a new plan from an old one: the same things, on new days. The checklist starts unticked; the
     * story and the photos stay with the old one, where they happened.
     */
    copy(id: number, input: { name?: string | null; start_day: string }): Promise<Plan> {
      return atomic(db, async (tx) => {
        const old = await row(tx, id);
        const length = dayNumber(old.end_day) - dayNumber(old.start_day);
        const values = checked({ name: clean(input.name, 200) ?? old.name, start_day: input.start_day, end_day: addDays(input.start_day, length), note: old.note });
        const made = await tx.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, story, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [owner, ...values, now(), now()]);
        await tx.run(
          `INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order)
           SELECT ?, kind, ref_id, label, quantity, note, 0, sort_order FROM plan_items WHERE plan_id = ? ORDER BY sort_order, id`, [made.lastId, id]);
        return made.lastId;
      }).then(whole);
    },

    // ---------- what belongs to it ----------

    addItem(planId: number, input: PlanItemInput): Promise<Plan> {
      return atomic(db, async (tx) => {
        await row(tx, planId);
        const v = await itemValues(tx, input);
        if (v.ref !== null && await tx.get('SELECT id FROM plan_items WHERE plan_id = ? AND kind = ? AND ref_id = ?', [planId, v.kind, v.ref])) throw new Problem(409, "That's already part of it");
        const last = (await tx.get<{ last: number | null }>('SELECT MAX(sort_order) AS last FROM plan_items WHERE plan_id = ?', [planId]))!.last ?? 0;
        await tx.run('INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
          [planId, v.kind, v.ref, v.label, v.quantity, v.note, last + 1]);
      }).then(() => whole(planId));
    },

    /** Tick it, reword a task, or change how many are needed or the note. What it points at stays. */
    async updateItem(itemId: number, input: { label?: string | null; quantity?: number | null; note?: string | null; done?: boolean }): Promise<Plan> {
      const planId = await planOfItem(db, itemId);
      const old = (await db.get<ItemRow>('SELECT id, plan_id, kind, ref_id, label, quantity, note, done FROM plan_items WHERE id = ?', [itemId]))!;
      const label = old.kind === 'task' && input.label !== undefined ? clean(input.label, 300) : old.label;
      if (!label) throw new Problem(400, 'Say what needs doing');
      const quantity = input.quantity === undefined ? old.quantity : input.quantity;
      if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) throw new Problem(400, 'How many is a number above nothing');
      await db.run('UPDATE plan_items SET label = ?, quantity = ?, note = ?, done = ? WHERE id = ?',
        [label, old.kind === 'thing' ? quantity : null, input.note === undefined ? old.note : clean(input.note, 1000), (input.done ?? old.done === 1) ? 1 : 0, itemId]);
      return whole(planId);
    },

    async removeItem(itemId: number): Promise<Plan> {
      const planId = await planOfItem(db, itemId);
      await db.run('DELETE FROM plan_items WHERE id = ?', [itemId]);
      return whole(planId);
    },

    // ---------- photos ----------

    /** Keep a photo with the plan: one picked from a phone or computer. */
    async keepPhoto(planId: number, bytes: Uint8Array, caption?: string | null): Promise<Plan> {
      const type = pictureType(bytes);
      if (!type || !PHOTO_TYPES.includes(type)) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_PHOTO_BYTES) throw new Problem(400, 'That photo is too large to keep');
      const order = await roomForPhoto(db, planId);
      await db.run('INSERT INTO plan_photos (plan_id, source, type, bytes, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [planId, 'kept', type, bytes, clean(caption, 300), order, now()]);
      return whole(planId);
    },

    /** Link a photo that lives in a photo library. Only which one is kept; the picture stays there. */
    async linkPhoto(planId: number, source: 'immich', assetId: string, caption?: string | null): Promise<Plan> {
      if (!/^[0-9a-fA-F-]{8,64}$/.test(assetId)) throw new Problem(400, "That isn't a photo from the library");
      const order = await roomForPhoto(db, planId);
      if (await db.get('SELECT id FROM plan_photos WHERE plan_id = ? AND source = ? AND asset_id = ?', [planId, source, assetId])) return whole(planId);
      await db.run('INSERT INTO plan_photos (plan_id, source, asset_id, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [planId, source, assetId, clean(caption, 300), order, now()]);
      return whole(planId);
    },

    /** A photo, for showing: its bytes when it's kept here, or which library photo it is when it's linked. */
    async photo(photoId: number): Promise<{ source: 'kept'; type: string; bytes: Uint8Array } | { source: 'immich'; asset_id: string }> {
      await planOfPhoto(db, photoId);
      const found = (await db.get<{ source: 'kept' | 'immich'; type: string | null; bytes: Uint8Array | null; asset_id: string | null }>(
        'SELECT source, type, bytes, asset_id FROM plan_photos WHERE id = ?', [photoId]))!;
      return found.source === 'kept' ? { source: 'kept', type: found.type!, bytes: found.bytes! } : { source: 'immich', asset_id: found.asset_id! };
    },

    async captionPhoto(photoId: number, caption: string | null): Promise<Plan> {
      const planId = await planOfPhoto(db, photoId);
      await db.run('UPDATE plan_photos SET caption = ? WHERE id = ?', [clean(caption, 300), photoId]);
      return whole(planId);
    },

    /** Take a photo off the plan. A kept one is deleted; a linked one stays in its library. */
    async removePhoto(photoId: number): Promise<Plan> {
      const planId = await planOfPhoto(db, photoId);
      await db.run('DELETE FROM plan_photos WHERE id = ?', [photoId]);
      return whole(planId);
    },
  };
}

export type Plans = ReturnType<typeof plans>;
