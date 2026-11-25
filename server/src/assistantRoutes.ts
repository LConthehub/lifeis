/**
 * The addresses for the optional assistant (/api/assistant). What it does is core/'s assistant.ts; this only
 * reads what was sent and passes it on.
 */
import { assistant, type AssistantTools, type Db } from '../../core/src/index.ts';
import { read, type Body, type Context, type Route } from './http.ts';

const sent = (body: Body, name: string) => Object.hasOwn(body, name);

export function assistantRoutes(db: Db, tools?: AssistantTools): Route[] {
  const helper = (c: Context) => assistant(db, c.user.id, c.clock, tools);
  return [
    ['GET', /^\/api\/assistant$/, async (c) => ({ json: await helper(c).status() })],
    ['PUT', /^\/api\/assistant$/, async (c) => ({
      json: await helper(c).save({
        ...(sent(c.body, 'source') ? { source: read.maybeText(c.body, 'source') ?? undefined } : {}),
        ...(sent(c.body, 'enabled') ? { enabled: read.yesNo(c.body, 'enabled') } : {}),
        ...(sent(c.body, 'url') ? { url: read.maybeText(c.body, 'url') } : {}),
        ...(sent(c.body, 'model') ? { model: read.maybeText(c.body, 'model') } : {}),
        ...(sent(c.body, 'cloud_ok') ? { cloud_ok: read.yesNo(c.body, 'cloud_ok') } : {}),
        ...(sent(c.body, 'key') ? { key: read.maybeText(c.body, 'key') } : {}),
        ...(sent(c.body, 'clear_key') ? { clear_key: read.yesNo(c.body, 'clear_key') } : {}),
        ...(sent(c.body, 'areas') ? { areas: read.texts(c.body, 'areas') } : {}),
        ...(sent(c.body, 'show') ? { show: read.maybeText(c.body, 'show') ?? undefined } : {}),
      }),
    })],
    ['POST', /^\/api\/assistant\/models$/, async (c) => ({ json: { models: await helper(c).models() } })],
    ['POST', /^\/api\/assistant\/phone$/, async (c) => ({ json: await helper(c).phoneCheck() })],
    // A photo of a handwritten recipe, copied out by the model. The photo goes to the model and is not kept.
    ['POST', /^\/api\/assistant\/read-recipe$/, async (c) => ({
      json: await helper(c).readRecipePhoto({ type: read.maybeText(c.body, 'type'), base64: read.maybeText(c.body, 'base64') }),
    })],
    ['POST', /^\/api\/assistant\/ask$/, async (c) => ({ json: await helper(c).ask(read.maybeText(c.body, 'question')) })],
  ];
}
