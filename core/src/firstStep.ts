/**
 * "Just the first step": one small step of a chore, a project or a routine, shown alone.
 *
 * Nothing new is kept here. The step is read from where it lives:
 *  - a chore with steps written down: its steps, one on each line (a chore keeps no check for each line, so the page
 *    says how many it has been through on this device and passes that in as `after`); a chore with none: the chore itself
 *  - a project: its next line not yet marked used
 *  - a routine: its next step not yet checked today
 * Checking one off is done with the same calls as everywhere else (the page makes them), so this only reads.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { projects } from './projects.ts';
import { routines } from './routines.ts';
import type { Clock } from './small.ts';
import { upkeep } from './upkeep.ts';

export const FIRST_STEP_KINDS = ['chore', 'project', 'routine'] as const;
export type FirstStepKind = (typeof FIRST_STEP_KINDS)[number];

/** How the page checks the step off. */
export type FirstStepDone =
  /** The whole chore is done (POST /api/things/upkeep/:id/done). */
  | { how: 'chore'; id: number }
  /** A step of a chore: nothing to save; the page counts it on this device. `last` is true when it is the final one. */
  | { how: 'chore-line'; id: number; last: boolean }
  /** A line of a project is used (POST /api/projects/lines/:id/use). */
  | { how: 'line'; id: number }
  /** A routine step is checked (PUT /api/routine-day/steps/:id). */
  | { how: 'routine'; id: number };

export type FirstStep = {
  kind: FirstStepKind;
  id: number;
  /** The chore, project or routine the step is part of. */
  name: string;
  /** The step in a few plain words, or null when nothing is left to do. */
  step: string | null;
  /** A line under the step, when there is more to say. */
  more: string | null;
  /** "Step 2 of 5", or null when it is the only one. */
  place: string | null;
  done: FirstStepDone | null;
};

/** The lines of a chore's steps: trimmed, with blank lines gone. */
export const stepLines = (steps: string | null | undefined): string[] => (steps ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

/**
 * The step to show for a chore's written steps, after `after` of them have been gone through. With no steps the chore
 * itself is the step. Past the last one, null.
 */
export function pickChoreStep(name: string, steps: string | null | undefined, after = 0): { words: string; index: number; of: number } | null {
  const lines = stepLines(steps);
  if (lines.length === 0) return after > 0 ? null : { words: name, index: 0, of: 1 };
  const index = Math.max(0, Math.floor(after));
  return index >= lines.length ? null : { words: lines[index]!, index, of: lines.length };
}

/** The first of a project's lines not yet used, with its words, or null when all are. */
export function pickProjectLine<T extends { used_on: string | null; label: string; amount: string; note: string | null }>(lines: T[]): { line: T; words: string } | null {
  const line = lines.find((l) => !l.used_on);
  if (!line) return null;
  return { line, words: line.amount ? `${line.label}: ${line.amount}` : line.label };
}

/** The first of a routine's steps not yet checked, going through its times in order, or null when all are. */
export function pickRoutineStep<T extends { steps: { ticked: boolean }[] }>(times: T[]): { time: T; step: T['steps'][number]; index: number } | null {
  for (const time of times) {
    const index = time.steps.findIndex((s) => !s.ticked);
    if (index >= 0) return { time, step: time.steps[index]!, index };
  }
  return null;
}

export function firstStep(db: Db, owner: number, clock: Clock = () => new Date()) {
  return {
    /** The one small step for a chore, a project or a routine. `after` is how many of a chore's written steps were already gone through. */
    async find(kind: string, id: number, after = 0): Promise<FirstStep> {
      if (kind === 'chore') {
        const job = await upkeep(db, owner, clock).get(id);
        const pick = pickChoreStep(job.name, job.steps, after);
        if (!pick) return { kind, id, name: job.name, step: null, more: null, place: null, done: null };
        const written = stepLines(job.steps).length > 0;
        return {
          kind, id, name: job.name, step: pick.words, more: null,
          place: pick.of > 1 ? `Step ${pick.index + 1} of ${pick.of}` : null,
          done: written ? { how: 'chore-line', id, last: pick.index === pick.of - 1 } : { how: 'chore', id },
        };
      }
      if (kind === 'project') {
        const project = await projects(db, owner, clock).getProject(id);
        const pick = pickProjectLine(project.lines);
        if (!pick) return { kind, id, name: project.name, step: null, more: null, place: null, done: null };
        const left = project.lines.filter((l) => !l.used_on).length;
        return {
          kind, id, name: project.name, step: pick.words, more: pick.line.note || null,
          place: project.lines.length > 1 ? `${left} left of ${project.lines.length}` : null,
          done: { how: 'line', id: pick.line.id },
        };
      }
      if (kind === 'routine') {
        const mine = routines(db, owner, clock);
        const routine = await mine.get(id);
        const times = [];
        for (const t of routine.times) times.push(await mine.time(t.id));
        const pick = pickRoutineStep(times);
        if (!pick) return { kind, id, name: routine.name, step: null, more: null, place: null, done: null };
        const total = times.reduce((n, t) => n + t.steps.length, 0);
        const left = times.reduce((n, t) => n + t.steps.filter((s) => !s.ticked).length, 0);
        return {
          kind, id, name: routine.name, step: pick.step.words, more: routine.times.length > 1 ? pick.time.name : null,
          place: total > 1 ? `${left} left of ${total} today` : null,
          done: { how: 'routine', id: pick.step.id },
        };
      }
      throw new Problem(400, 'A first step is for a chore, a project or a routine');
    },
  };
}
