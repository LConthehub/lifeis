/**
 * Moving house, or packing things away: numbered boxes made in one go, each a place like any other, so it
 * has a sticker, is filled by scanning, and is found by search ("which box has the kettle?"). A box says
 * which room it's going to and how far along it is: being packed, packed, moved, unpacked. Unpacking puts
 * everything in it into its new place in one step, and each thing's history remembers the journey.
 */
import { atomic, type Db } from './db.ts';
import { inventory } from './inventory.ts';
import { media } from './media.ts';
import { Problem } from './problem.ts';
import { clean, stamp, type Clock } from './small.ts';

export const BOX_STATES = ['packing', 'packed', 'moved', 'unpacked'] as const;
export type BoxState = (typeof BOX_STATES)[number];
export type Box = {
  id: number; name: string; path: string; state: BoxState;
  /** The room it's going to, in words: "Kitchen". */
  destination: string | null;
  /** What's in it: things and copies from the collection, by name. */
  contents: { kind: 'thing' | 'title'; id: number; name: string }[];
};
export type Packing = { boxes: Box[]; counts: Record<BoxState, number>; things: number };

const MAX_AT_ONCE = 100;

export function packing(db: Db, owner: number, clock: Clock = () => new Date()) {
  const things = inventory(db, owner, clock);

  async function owned(id: number): Promise<{ id: number; box_state: BoxState | null }> {
    const row = await db.get<{ id: number; box_state: BoxState | null }>('SELECT id, box_state FROM places WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, "That place isn't here anymore. It may have been deleted.");
    return row;
  }

  async function list(): Promise<Packing> {
    const rows = await db.all<{ id: number; box_state: BoxState; box_destination: string | null }>(
      'SELECT id, box_state, box_destination FROM places WHERE owner_id = ? AND box_state IS NOT NULL ORDER BY id', [owner]);
    const places = new Map((await things.listPlaces()).map((p) => [p.id, p]));
    const boxes: Box[] = [];
    for (const r of rows) {
      const place = places.get(r.id);
      if (!place) continue;
      const inside = await db.all<{ id: number; name: string }>('SELECT id, name FROM items WHERE owner_id = ? AND place_id = ? AND gone_on IS NULL ORDER BY name COLLATE NOCASE', [owner, r.id]);
      const titles = await db.all<{ id: number; name: string }>(
        'SELECT DISTINCT m.id, m.title AS name FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ? AND c.place_id = ? ORDER BY m.title COLLATE NOCASE', [owner, r.id]);
      boxes.push({ id: r.id, name: place.name, path: place.path, state: r.box_state, destination: r.box_destination,
        contents: [...inside.map((t) => ({ kind: 'thing' as const, ...t })), ...titles.map((t) => ({ kind: 'title' as const, ...t }))] });
    }
    // In the order they were numbered: "Box 2" before "Box 10".
    boxes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const counts = { packing: 0, packed: 0, moved: 0, unpacked: 0 };
    for (const b of boxes) counts[b.state] += 1;
    return { boxes, counts, things: boxes.reduce((n, b) => n + b.contents.length, 0) };
  }

  return {
    list,

    /**
     * Make so many boxes, numbered on from the highest there is, going to a room (in words) and kept, for
     * now, inside a place if one is named (the hallway, the garage).
     */
    async makeBoxes(input: { count: number; destination?: string | null; parent_id?: number | null }): Promise<Packing> {
      if (!(Number.isInteger(input.count) && input.count >= 1 && input.count <= MAX_AT_ONCE)) throw new Problem(400, `Make 1 to ${MAX_AT_ONCE} boxes at a time`);
      if (input.parent_id != null) await owned(input.parent_id);
      const destination = clean(input.destination, 80);
      await atomic(db, async (tx) => {
        const names = await tx.all<{ name: string }>("SELECT name FROM places WHERE owner_id = ? AND name LIKE 'Box %'", [owner]);
        let next = Math.max(0, ...names.map((n) => Number(/^Box (\d+)$/.exec(n.name)?.[1] ?? 0))) + 1;
        for (let i = 0; i < input.count; i += 1, next += 1) {
          await tx.run("INSERT INTO places (owner_id, parent_id, name, note, box_state, box_destination, created_at) VALUES (?, ?, ?, NULL, 'packing', ?, ?)",
            [owner, input.parent_id ?? null, `Box ${next}`, destination, stamp(clock())]);
        }
      });
      return list();
    },

    /** Say how far along a box is, or where it's going. A place that isn't a box becomes one. */
    async setBox(id: number, input: { state?: string | null; destination?: string | null }): Promise<Packing> {
      const row = await owned(id);
      const state = input.state ?? row.box_state ?? 'packing';
      if (!BOX_STATES.includes(state as BoxState)) throw new Problem(400, "A box is being packed, packed, moved or unpacked");
      await db.run('UPDATE places SET box_state = ? WHERE id = ?', [state, id]);
      if (input.destination !== undefined) await db.run('UPDATE places SET box_destination = ? WHERE id = ?', [clean(input.destination, 80), id]);
      return list();
    },

    /** No longer a box: the place and what's in it stay as they are. */
    async notABox(id: number): Promise<Packing> {
      await owned(id);
      await db.run('UPDATE places SET box_state = NULL, box_destination = NULL WHERE id = ?', [id]);
      return list();
    },

    /**
     * Unpack a box: everything in it goes to a place (its new home), each thing's history noting the move,
     * and the box is marked unpacked. Returns how many things moved.
     */
    async unpack(id: number, toPlaceId: number): Promise<Packing & { moved: number }> {
      const row = await owned(id);
      if (row.box_state === null) throw new Problem(400, "That place isn't a box");
      if (toPlaceId === id) throw new Problem(400, 'Unpack it into somewhere else');
      await owned(toPlaceId);
      let moved = 0;
      for (const t of await db.all<{ id: number }>('SELECT id FROM items WHERE owner_id = ? AND place_id = ? AND gone_on IS NULL', [owner, id])) {
        await things.moveItem(t.id, toPlaceId, 'unpacked');
        moved += 1;
      }
      const shelf = media(db, owner, clock);
      for (const c of await db.all<{ id: number }>('SELECT c.id FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ? AND c.place_id = ?', [owner, id])) {
        await shelf.moveCopy(c.id, toPlaceId);
        moved += 1;
      }
      await db.run("UPDATE places SET box_state = 'unpacked' WHERE id = ?", [id]);
      return { ...(await list()), moved };
    },
  };
}
