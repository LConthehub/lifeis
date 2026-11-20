/**
 * Projects: a dress, a jumper, a bookshelf, the spring planting. Anything made or done over more than a day.
 *
 * A project has the same shape whatever it is:
 * - a list of what it uses, drawn from the things you keep (inventory.ts). A line with an amount ("3 yd of the
 *   blue linen") sets that much aside, so another project can't count on the same cloth. A line without an
 *   amount only refers to the thing (the pattern, the tool). A line can also name something you don't have yet.
 * - what it is short of: what a line needs, less what's free for it.
 * - sessions: the days it was worked on, for how long, and what was watched or listened to meanwhile (media.ts).
 *
 * Amounts are set aside while a project is planned, active or paused. Using a line, or finishing the project,
 * takes its amount out of what you keep, the way cooking a meal takes from the pantry.
 *
 * `projects(db, owner)` is one person's projects: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { placePaths, setAsideByItem } from './inventory.ts';
import { Problem } from './problem.ts';
import { clean, dayNumber, dayOrNull, rounded, stamp, todayOf, type Clock } from './small.ts';
import * as units from './units.ts';

export const STATUSES = ['idea', 'planned', 'active', 'paused', 'done', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];

export type ProjectInput = { name: string; activity?: string | null; status?: string | null; notes?: string | null; due_on?: string | null };
export type LineInput = {
  /** One of the things you keep. Left out: something you don't have yet, named by `label`. */
  item_id?: number | null;
  label?: string | null;
  /** Left out: the thing is only referred to, and nothing is set aside. */
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
};
export type SessionInput = {
  day: string;
  minutes?: number | null;
  note?: string | null;
  /** Titles from the collection that kept the session company: watched, or listened to, while working. */
  media_ids?: number[];
};

export type Line = {
  id: number;
  project_id: number;
  item_id: number | null;
  /** The thing's name, kept even if the thing is later removed. */
  label: string;
  quantity: number | null;
  unit: string | null;
  /** "3 yd", or "" for a line with no amount. */
  amount: string;
  used_on: string | null;
  note: string | null;
  sort_order: number;
  /** What you have of it now ("5 yd", "some"), or null when it isn't one of your things. */
  have: string | null;
  place: string | null;
  /**
   * How much more is needed than is free for this line, in the line's unit. 0 when there's enough; null when
   * it can't be worked out (no amount known, or units that don't compare) or the line is already used.
   */
  short: number | null;
  /** "1 yd", or "" when nothing is short or it can't be worked out. */
  short_text: string;
};
export type Session = {
  id: number;
  project_id: number;
  day: string;
  minutes: number | null;
  note: string | null;
  created_at: string;
  /** What was watched or listened to while working. */
  media: { id: number; title: string; type: string }[];
};
export type ProjectSummary = {
  id: number;
  name: string;
  activity: string | null;
  status: Status;
  notes: string | null;
  due_on: string | null;
  started_on: string | null;
  finished_on: string | null;
  created_at: string;
  updated_at: string;
  /** All the time logged, in minutes. */
  minutes: number;
  sessions_count: number;
  /** How many of its lines are short of something. */
  short_count: number;
};
export type Project = ProjectSummary & { lines: Line[]; sessions: Session[] };

type ProjectRow = Omit<ProjectSummary, 'minutes' | 'sessions_count' | 'short_count'>;
type LineRow = Omit<Line, 'amount' | 'have' | 'place' | 'short' | 'short_text'> & {
  item_quantity: number | null; item_unit: string | null; item_place: number | null; item_there: number | null;
};

const PROJECT_COLUMNS = 'id, name, activity, status, notes, due_on, started_on, finished_on, created_at, updated_at';

export function projects(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);

  async function projectRow(q: Queries, id: number): Promise<ProjectRow> {
    const row = await q.get<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, 'Project not found');
    return row;
  }

  /** A project's lines, each with what you have of it and what it's short of. */
  async function linesOf(q: Queries, project: ProjectRow): Promise<Line[]> {
    const rows = await q.all<LineRow>(
      `SELECT l.id, l.project_id, l.item_id, l.label, l.quantity, l.unit, l.used_on, l.note, l.sort_order,
              i.quantity AS item_quantity, i.unit AS item_unit, i.place_id AS item_place, i.id AS item_there
       FROM project_items l LEFT JOIN items i ON i.id = l.item_id WHERE l.project_id = ? ORDER BY l.sort_order, l.id`, [project.id]);
    const paths = placePaths(await q.all('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]));
    const open = project.status !== 'done' && project.status !== 'dropped';
    const lines: Line[] = [];
    for (const { item_quantity, item_unit, item_place, item_there, ...row } of rows) {
      let short: number | null = null;
      if (open && row.used_on === null && row.quantity !== null) {
        if (item_there === null) {
          short = row.quantity; // not one of your things: all of it is still to get
        } else if (item_quantity !== null) {
          const need = units.convert(row.quantity, row.unit, item_unit);
          if (need !== null) {
            const others = (await setAsideByItem(q, owner, row.id)).get(item_there) ?? 0;
            const missing = need - Math.max(0, item_quantity - others);
            short = missing > 1e-9 ? rounded(units.convert(missing, item_unit, row.unit) ?? missing, 3) : 0;
          }
        }
      }
      lines.push({
        ...row,
        amount: units.amount(row.quantity, row.unit),
        have: item_there === null ? null : item_quantity !== null ? units.amount(item_quantity, item_unit) : 'some',
        place: item_place !== null ? (paths.get(item_place) ?? null) : null,
        short,
        short_text: short ? units.amount(short, row.unit) : '',
      });
    }
    return lines;
  }

  async function sessionsOf(q: Queries, projectId: number): Promise<Session[]> {
    const rows = await q.all<Omit<Session, 'media'>>(
      'SELECT id, project_id, day, minutes, note, created_at FROM project_sessions WHERE project_id = ? ORDER BY day DESC, id DESC', [projectId]);
    const kept = await q.all<{ session_id: number; id: number; title: string; type: string }>(
      `SELECT l.session_id, m.id, m.title, m.type FROM media_log l JOIN media m ON m.id = l.media_id JOIN project_sessions s ON s.id = l.session_id
       WHERE s.project_id = ? ORDER BY l.id`, [projectId]);
    return rows.map((row) => ({ ...row, media: kept.filter((k) => k.session_id === row.id).map(({ id, title, type }) => ({ id, title, type })) }));
  }

  async function project(q: Queries, id: number): Promise<Project> {
    const row = await projectRow(q, id);
    const lines = await linesOf(q, row);
    const sessions = await sessionsOf(q, id);
    return {
      ...row, lines, sessions,
      minutes: sessions.reduce((sum, s) => sum + (s.minutes ?? 0), 0),
      sessions_count: sessions.length,
      short_count: lines.filter((line) => line.short).length,
    };
  }

  function checkedProject(input: ProjectInput) {
    const name = clean(input.name, 200);
    if (!name) throw new Problem(400, 'Give the project a name');
    const status = (input.status ?? 'idea') as Status;
    if (!STATUSES.includes(status)) throw new Problem(400, 'A project is an idea, planned, active, paused, done or dropped');
    return { name, activity: clean(input.activity, 60), status, notes: clean(input.notes, 20_000), due: dayOrNull(input.due_on) };
  }

  /** The activity as the person first spelled it, so "sewing" and "Sewing" stay one activity. */
  async function activityAs(q: Queries, activity: string | null, self = 0): Promise<string | null> {
    if (!activity) return null;
    const known = await q.get<{ activity: string }>(
      'SELECT activity FROM projects WHERE owner_id = ? AND id != ? AND activity = ? COLLATE NOCASE ORDER BY id LIMIT 1', [owner, self, activity]);
    return known?.activity ?? activity;
  }

  /** A line's own columns, checked. */
  async function checkedLine(q: Queries, input: LineInput, before?: { item_id: number | null; label: string }) {
    if (input.quantity != null && !(input.quantity > 0 && input.quantity < 1e9)) throw new Problem(400, 'The amount is more than 0');
    const itemId = before ? before.item_id : (input.item_id ?? null);
    let label = before?.label ?? clean(input.label, 200);
    let unit = units.canonical(clean(input.unit, 20));
    if (itemId !== null) {
      const item = await q.get<{ name: string; unit: string | null }>('SELECT name, unit FROM items WHERE id = ? AND owner_id = ?', [itemId, owner]);
      if (!item && !before) throw new Problem(404, "That isn't one of your things");
      if (item) {
        label = item.name;
        unit ??= item.unit;
      }
    }
    if (!label) throw new Problem(400, 'Choose one of your things, or say what it is');
    const quantity = input.quantity ?? null;
    return { itemId, label, quantity, unit: quantity !== null ? unit : null, note: clean(input.note, 1000) };
  }

  async function lineRow(q: Queries, id: number) {
    const row = await q.get<{ id: number; project_id: number; item_id: number | null; label: string; quantity: number | null; unit: string | null; used_on: string | null }>(
      `SELECT l.id, l.project_id, l.item_id, l.label, l.quantity, l.unit, l.used_on FROM project_items l JOIN projects p ON p.id = l.project_id
       WHERE l.id = ? AND p.owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }

  /**
   * Mark a line as used, and take its amount out of what you keep. Says whether the amount could be taken
   * (it can't when the thing has no amount known, or the units don't compare).
   */
  async function useLineIn(q: Queries, line: { id: number; item_id: number | null; quantity: number | null; unit: string | null }): Promise<boolean> {
    await q.run('UPDATE project_items SET used_on = ? WHERE id = ?', [today(), line.id]);
    if (line.item_id === null || line.quantity === null) return true; // nothing of yours to take
    const item = await q.get<{ quantity: number | null; unit: string | null }>('SELECT quantity, unit FROM items WHERE id = ?', [line.item_id]);
    if (!item) return true; // the thing is gone: there is nothing left to take from
    const same = item.quantity === null ? null : units.convert(line.quantity, line.unit, item.unit);
    if (same === null) return false;
    await q.run('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?', [Math.max(0, rounded(item.quantity! - same, 4)), now(), line.item_id]);
    return true;
  }

  /** Everything not yet used is used, and the project is done. Gives the names of what couldn't be taken away. */
  async function finishIn(q: Queries, id: number): Promise<string[]> {
    const byHand = new Set<string>();
    for (const line of await q.all<{ id: number; item_id: number | null; label: string; quantity: number | null; unit: string | null }>(
      'SELECT id, item_id, label, quantity, unit FROM project_items WHERE project_id = ? AND used_on IS NULL', [id])) {
      if (!(await useLineIn(q, line))) byHand.add(line.label);
    }
    await q.run("UPDATE projects SET status = 'done', finished_on = ?, updated_at = ? WHERE id = ?", [today(), now(), id]);
    return [...byHand].sort();
  }

  return {
    /** The person's projects, the ones being worked on first. */
    async listProjects(find: { status?: string | null; activity?: string | null } = {}): Promise<ProjectSummary[]> {
      let sql = `SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner_id = ?`;
      const args: Value[] = [owner];
      if (find.status) {
        sql += ' AND status = ?';
        args.push(find.status);
      }
      if (find.activity) {
        sql += ' AND activity = ? COLLATE NOCASE';
        args.push(find.activity.trim());
      }
      sql += ` ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'planned' THEN 2 WHEN 'idea' THEN 3 WHEN 'done' THEN 4 ELSE 5 END,
               COALESCE(due_on, '9999'), name COLLATE NOCASE`;
      const out: ProjectSummary[] = [];
      for (const row of await db.all<ProjectRow>(sql, args)) {
        const { lines: _lines, sessions: _sessions, ...summary } = await project(db, row.id);
        out.push(summary);
      }
      return out;
    },

    /** The activities the person has used ("Sewing", "Garden"), to offer when starting a new project. */
    async listActivities(): Promise<string[]> {
      return (await db.all<{ activity: string }>(
        'SELECT activity FROM projects WHERE owner_id = ? AND activity IS NOT NULL GROUP BY activity COLLATE NOCASE ORDER BY activity COLLATE NOCASE', [owner]))
        .map((row) => row.activity);
    },

    getProject: (id: number) => project(db, id),

    async createProject(input: ProjectInput): Promise<Project> {
      const p = checkedProject(input);
      return atomic(db, async (tx) => {
        const made = await tx.run(
          'INSERT INTO projects (owner_id, name, activity, status, notes, due_on, started_on, finished_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [owner, p.name, await activityAs(tx, p.activity), p.status, p.notes, p.due, p.status === 'active' ? today() : null, p.status === 'done' ? today() : null, now(), now()]);
        return project(tx, made.lastId);
      });
    },

    /**
     * Change a project. Making it active notes the day it started. Making it done finishes it: what it hadn't
     * used yet is taken out of what you keep, and `check_by_hand` names anything that couldn't be.
     */
    async updateProject(id: number, input: ProjectInput): Promise<Project & { check_by_hand: string[] }> {
      const p = checkedProject(input);
      return atomic(db, async (tx) => {
        const before = await projectRow(tx, id);
        const started = before.started_on ?? (p.status === 'active' ? today() : null);
        await tx.run('UPDATE projects SET name = ?, activity = ?, status = ?, notes = ?, due_on = ?, started_on = ?, finished_on = ?, updated_at = ? WHERE id = ?',
          [p.name, await activityAs(tx, p.activity, id), p.status, p.notes, p.due, started, p.status === 'done' ? (before.finished_on ?? today()) : null, now(), id]);
        const byHand = p.status === 'done' && before.status !== 'done' ? await finishIn(tx, id) : [];
        return { ...(await project(tx, id)), check_by_hand: byHand };
      });
    },

    /** Remove a project. What it had set aside is free again; what it had already used stays used. */
    async deleteProject(id: number): Promise<void> {
      await db.run('DELETE FROM projects WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    // ---------- what it uses ----------

    async addLine(projectId: number, input: LineInput): Promise<Project> {
      return atomic(db, async (tx) => {
        await projectRow(tx, projectId);
        const line = await checkedLine(tx, input);
        const next = (await tx.get<{ n: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM project_items WHERE project_id = ?', [projectId]))!.n;
        await tx.run('INSERT INTO project_items (project_id, item_id, label, quantity, unit, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [projectId, line.itemId, line.label, line.quantity, line.unit, line.note, next]);
        return project(tx, projectId);
      });
    },

    /** Change a line's amount or note. A line that has been used can't change: the cloth is already cut. */
    async updateLine(id: number, input: Pick<LineInput, 'quantity' | 'unit' | 'note'>): Promise<Project> {
      return atomic(db, async (tx) => {
        const before = await lineRow(tx, id);
        if (before.used_on) throw new Problem(409, "That's already been used");
        const line = await checkedLine(tx, input, before);
        await tx.run('UPDATE project_items SET label = ?, quantity = ?, unit = ?, note = ? WHERE id = ?', [line.label, line.quantity, line.unit, line.note, id]);
        return project(tx, before.project_id);
      });
    },

    /** Take a line off a project. If it had been used, what it used is not put back. */
    async removeLine(id: number): Promise<Project> {
      return atomic(db, async (tx) => {
        const before = await lineRow(tx, id);
        await tx.run('DELETE FROM project_items WHERE id = ?', [id]);
        return project(tx, before.project_id);
      });
    },

    /** The line's amount has been used (the cloth is cut): it comes out of what you keep. */
    async useLine(id: number): Promise<Project & { taken: boolean }> {
      return atomic(db, async (tx) => {
        const line = await lineRow(tx, id);
        if (line.used_on) throw new Problem(409, "That's already been used");
        const taken = await useLineIn(tx, line);
        return { ...(await project(tx, line.project_id)), taken };
      });
    },

    // ---------- when it was worked on ----------

    async addSession(projectId: number, input: SessionInput): Promise<Project> {
      dayNumber(input.day);
      if (input.minutes != null && !(Number.isInteger(input.minutes) && input.minutes >= 0 && input.minutes <= 1440)) {
        throw new Problem(400, 'Time is in minutes, up to a whole day');
      }
      return atomic(db, async (tx) => {
        await projectRow(tx, projectId);
        const made = await tx.run('INSERT INTO project_sessions (project_id, day, minutes, note, created_at) VALUES (?, ?, ?, ?, ?)',
          [projectId, input.day, input.minutes ?? null, clean(input.note, 1000), now()]);
        for (const mediaId of new Set(input.media_ids ?? [])) {
          if (!(await tx.get('SELECT id FROM media WHERE id = ? AND owner_id = ?', [mediaId, owner]))) throw new Problem(404, "That isn't in your collection");
          await tx.run('INSERT INTO media_log (media_id, day, session_id, created_at) VALUES (?, ?, ?, ?)', [mediaId, input.day, made.lastId, now()]);
        }
        return project(tx, projectId);
      });
    },

    async deleteSession(id: number): Promise<void> {
      await db.run('DELETE FROM project_sessions WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)', [id, owner]);
    },

    /** Every session between two days, with its project's name: what the calendar shows. */
    async sessionsBetween(start: string, end: string): Promise<(Omit<Session, 'media'> & { project: string; activity: string | null })[]> {
      dayNumber(start);
      dayNumber(end);
      return db.all(
        `SELECT s.id, s.project_id, s.day, s.minutes, s.note, s.created_at, p.name AS project, p.activity
         FROM project_sessions s JOIN projects p ON p.id = s.project_id WHERE p.owner_id = ? AND s.day >= ? AND s.day <= ? ORDER BY s.day, s.id`,
        [owner, start, end]);
    },
  };
}

export type Projects = ReturnType<typeof projects>;
