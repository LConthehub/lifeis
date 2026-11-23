/**
 * The addresses for tags (/api/tags). What they do is core/'s tags.ts; this only reads what was sent and
 * passes it on. The phone app answers the same addresses on the device, through everydayRoutes.
 */
import { isTagKind, tags, TAG_KINDS, type Db, type TagKind } from '../../core/src/index.ts';
import { notUnderstood, read, Refusal, type Body, type Context, type Route } from './http.ts';

const ID = '([0-9]{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);
const KIND = `(?:${TAG_KINDS.join('|')})`;

export function tagRoutes(db: Db): Route[] {
  const mine = (c: Context) => tags(db, c.user.id, c.clock);
  const kindOf = (c: Context): TagKind => {
    const kind = c.path.split('/')[4] ?? '';
    if (!isTagKind(kind)) throw new Refusal(404, 'Not found');
    return kind;
  };
  return [
    ['GET', at('tags'), async (c) => ({ json: await mine(c).list() })],
    ['POST', at('tags'), async (c) => ({ status: 201, json: await mine(c).create(read.text(c.body, 'name'), read.maybeWhole(c.body, 'parent_id')) })],
    // Tick many things (of one kind) and add some tags to them, or take some off.
    ['POST', at('tags/bulk'), async (c) => {
      const kind = read.text(c.body, 'kind');
      if (!isTagKind(kind)) throw notUnderstood('kind');
      return { json: await mine(c).change(kind, read.wholes(c.body, 'ids'), read.wholes(c.body, 'add'), read.wholes(c.body, 'remove')) };
    }],
    // The tags on one thing, and setting them.
    ['GET', new RegExp(`^/api/tags/on/${KIND}/${ID}$`), async (c) => ({ json: await mine(c).of(kindOf(c), c.id) })],
    ['PUT', new RegExp(`^/api/tags/on/${KIND}/${ID}$`), async (c) => ({ json: await mine(c).set(kindOf(c), c.id, read.wholes(c.body, 'tag_ids')) })],
    ['GET', at('tags/:id'), async (c) => ({ json: await mine(c).page(c.id) })],
    ['PUT', at('tags/:id'), async (c) => {
      let made = null;
      if (sent(c.body, 'name')) made = await mine(c).rename(c.id, read.text(c.body, 'name'));
      if (sent(c.body, 'parent_id')) made = await mine(c).move(c.id, read.maybeWhole(c.body, 'parent_id'));
      return { json: made ?? (await mine(c).page(c.id)).tag };
    }],
    ['POST', at('tags/:id/merge'), async (c) => {
      const into = read.maybeWhole(c.body, 'into');
      if (into === null) throw notUnderstood('into');
      return { json: await mine(c).merge(c.id, into) };
    }],
    ['DELETE', at('tags/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
  ];
}
