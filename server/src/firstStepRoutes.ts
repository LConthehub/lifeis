/**
 * The addresses for "Just the first step" (/api/first-step). What it does is core/'s firstStep.ts; the break-down
 * asks the person's assistant (core/'s assistant.ts), and only when they press the button.
 */
import { assistant, firstStep, type AssistantTools, type Db } from '../../core/src/index.ts';
import { queryNumber, read, type Route } from './http.ts';

const ID = '(\\d{1,15})';

export function firstStepRoutes(db: Db, tools?: AssistantTools): Route[] {
  return [
    ['GET', new RegExp(`^/api/first-step/(chore|project|routine)/${ID}$`), async (c) => {
      const [, kind, id] = c.path.match(/^\/api\/first-step\/([a-z]+)\/(\d+)$/)!;
      return { json: await firstStep(db, c.user.id, c.clock).find(kind!, Number(id), queryNumber(c.query, 'after') ?? 0) };
    }],
    ['POST', /^\/api\/first-step\/break-down$/, async (c) => ({
      json: await assistant(db, c.user.id, c.clock, tools).breakDown(read.maybeText(c.body, 'step'), read.maybeText(c.body, 'part')),
    })],
  ];
}
