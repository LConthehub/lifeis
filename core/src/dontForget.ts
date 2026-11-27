/**
 * "Don't forget": at most three quiet things on the front page for one person.
 *
 * Nothing about the things themselves is kept here. Each line is read from where it lives (the pantry, projects,
 * bills and chores) and links back there. All that is saved is what the person pushed away: "Later" hides a line
 * for a week, "Not now" hides it until the thing changes (or 30 days). The card never counts what is late and
 * says nothing when nothing qualifies.
 */
import type { Db } from './db.ts';
import { kitchen } from './kitchen.ts';
import { Problem } from './problem.ts';
import { addDays, dayNumber, todayOf, type Clock } from './small.ts';
import { upkeep, type EveryUnit } from './upkeep.ts';

export const MOST_LINES = 3;
const LATER_DAYS = 7;
const NOT_NOW_DAYS = 30;
const GAP_DAYS: Record<EveryUnit, number> = { day: 1, week: 7, month: 30, year: 365 };

export type Line = {
  /** pantry-12, project-3, job-5, bill-8: what the person's Later and Not now are kept against. */
  key: string;
  text: string;
  /** The page the line opens. */
  to: string;
  /** A chore or job can be done right from the line; its id, else null. */
  job_id: number | null;
};

type Candidate = Line & { score: number; sig: string; on: string[] };

/** The Home cards that already say a line, so the card does not say it twice. */
const pantryCards = ['pantry'];
const dueCards = ['days', 'upkeep'];

/** "12 days", "3 weeks", "4 months". */
export function span(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

export function dontForget(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);

  async function candidates(): Promise<Candidate[]> {
    const day = today();
    const now = dayNumber(day);
    const found: Candidate[] = [];

    // Food near or past its use-by date.
    for (const item of await kitchen(db, owner, clock).listPantry().then((p) => p.items)) {
      if (item.days_left === null || item.days_left > 2) continue;
      const left = item.days_left;
      const when = left < 0 ? 'past its use-by date' : left === 0 ? 'use by today' : left === 1 ? 'use by tomorrow' : `use within ${left} days`;
      found.push({ key: `pantry-${item.id}`, text: `${item.name}: ${when}`, to: '/pantry', job_id: null, score: left, sig: item.expires_on ?? '', on: pantryCards });
    }

    // A project of theirs left alone for two weeks or more.
    const projects = await db.all<{ id: number; name: string; updated_at: string; last_session: string | null }>(
      `SELECT p.id, p.name, p.updated_at, (SELECT MAX(s.day) FROM project_sessions s WHERE s.project_id = p.id) AS last_session
       FROM projects p WHERE p.owner_id = ? AND p.status IN ('active', 'planned')`, [owner]);
    for (const project of projects) {
      const touched = [project.updated_at.slice(0, 10), project.last_session ?? ''].sort().pop()!;
      const idle = now - dayNumber(touched);
      if (idle < 14) continue;
      found.push({ key: `project-${project.id}`, text: `${project.name}: untouched for ${span(idle)}`, to: `/projects/${project.id}`, job_id: null, score: 6, sig: touched, on: [] });
    }

    for (const job of await upkeep(db, owner, clock).list()) {
      // A bill or renewal that is due soon or late (one that pays itself is left out).
      if ((job.kind === 'bill' || job.kind === 'renewal') && !job.autopay && job.due.days_left !== null && job.due.days_left <= 7 && !job.due.needs_date) {
        const left = job.due.days_left;
        const when = left < 0 ? `due ${span(-left)} ago` : left === 0 ? 'due today' : left === 1 ? 'due tomorrow' : `due in ${left} days`;
        found.push({ key: `bill-${job.id}`, text: `${job.name}: ${when}`, to: `/things/upkeep/${job.id}`, job_id: null, score: left + 0.5, sig: `${job.last_done?.day ?? ''}|${job.due.next_day ?? ''}`, on: left <= 2 ? dueCards : ['upkeep'] });
        continue;
      }
      // It's been a while: a chore or job of theirs, long past how often it is usually done.
      if ((job.kind === 'chore' || job.kind === 'job') && job.every && job.last_done && !job.pet && !job.member && (!job.assigned_to || job.assigned_to.id === owner)) {
        const gap = job.every.n * GAP_DAYS[job.every.unit];
        const since = now - dayNumber(job.last_done.day);
        if (since < Math.max(gap * 2, gap + 5)) continue;
        found.push({ key: `job-${job.id}`, text: `${job.name}: it's been a while (${span(since)})`, to: `/things/upkeep/${job.id}`, job_id: job.id, score: 4, sig: job.last_done.day, on: dueCards });
      }
    }
    return found.sort((a, b) => a.score - b.score || (a.text < b.text ? -1 : 1));
  }

  async function pushedAway(): Promise<Map<string, { until: string; sig: string | null }>> {
    const rows = await db.all<{ key: string; until: string; sig: string | null }>('SELECT key, until, sig FROM dont_forget_hidden WHERE user_id = ?', [owner]);
    return new Map(rows.map((r) => [r.key, r]));
  }

  return {
    /**
     * Up to three lines, the most pressing first; none when nothing qualifies. `shown` is the Home cards on screen:
     * what one of them already lists (food going off, a bill or chore due in the next three days) is left out.
     */
    async lines(shown: string[] = []): Promise<Line[]> {
      const day = today();
      const away = await pushedAway();
      return (await candidates())
        .filter((c) => {
          const hidden = away.get(c.key);
          return !(hidden && hidden.until > day && (hidden.sig === null || hidden.sig === c.sig)) && !c.on.some((card) => shown.includes(card));
        })
        .slice(0, MOST_LINES)
        .map(({ score: _score, sig: _sig, on: _on, ...line }) => line);
    },

    /** Later: out of sight for a week. Not now: out of sight until the thing changes, or 30 days. */
    async push(key: string, action: string, shown: string[] = []): Promise<Line[]> {
      if (action !== 'later' && action !== 'notnow') throw new Problem(400, 'Choose Later or Not now');
      const found = (await candidates()).find((c) => c.key === key);
      if (!found) throw new Problem(404, "That reminder isn't here anymore. It may have been deleted.");
      await db.run(
        `INSERT INTO dont_forget_hidden (user_id, key, until, sig) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET until = excluded.until, sig = excluded.sig`,
        [owner, key, addDays(today(), action === 'later' ? LATER_DAYS : NOT_NOW_DAYS), action === 'later' ? null : found.sig]);
      // Old rows are cleared as they lapse, so the table stays small.
      await db.run('DELETE FROM dont_forget_hidden WHERE user_id = ? AND until <= ?', [owner, today()]);
      return this.lines(shown);
    },
  };
}

export type DontForget = ReturnType<typeof dontForget>;
