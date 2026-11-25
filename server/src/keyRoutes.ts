/**
 * The addresses for personal keys (/api/keys, for the person signed in) and for the voice shortcuts a key opens
 * (/api/voice, for a key and nothing else). What a voice says and does is core/'s voice.ts; this reads what was
 * sent and passes it on. A key never opens any other address, and a session cookie never opens these.
 */
import { KEY_ACTIONS, voice, type Db, type KeyAction } from '../../core/src/index.ts';
import * as auth from './auth.ts';
import { read, Refusal, type Context, type Reply, type Route } from './http.ts';
import { deleteKey, listKeys, makeKey, MOST_KEYS, REFUSED, turnKey } from './personalKeys.ts';

const ID = '(\\d{1,15})';

export function keyRoutes(db: Db, tools: { clock: auth.Clock; demo: boolean }): Route[] {
  const refuseWait = (wait: number) => { if (wait) throw new Refusal(429, `Too many failed attempts. Try again in ${wait} seconds.`); };
  /** Making a key needs the password again: a key outlives the session that made it. A wrong one is counted like one at sign-in. */
  async function confirmPassword(c: Context, password: string): Promise<void> {
    const counted = auth.countedFor(c.user.username, c.ip);
    refuseWait(await auth.secondsToWait(db, counted, tools.clock));
    const found = await auth.checkLogin(db, c.user.username, password);
    if (!found || found.id !== c.user.id) {
      await auth.countFailure(db, counted, tools.clock);
      throw new Refusal(400, 'That password is wrong');
    }
  }
  const state = async (c: Context) => ({ actions: KEY_ACTIONS, most: MOST_KEYS, keys: await listKeys(db, c.user.id) });
  const notDemo = () => { if (tools.demo) throw new Refusal(403, "Keys can't be made in the demo: everyone shares it"); };
  return [
    ['GET', /^\/api\/keys$/, async (c) => ({ json: await state(c) })],
    ['POST', /^\/api\/keys$/, async (c) => {
      notDemo();
      await confirmPassword(c, read.text(c.body, 'password'));
      const made = await makeKey(db, c.user.id, { name: read.text(c.body, 'name'), can: read.texts(c.body, 'can') }, tools.clock);
      // The only time the key is shown: it is not kept, only a scrambled form of it.
      return { status: 201, json: { key: made.key, made: made.info, ...await state(c) } };
    }],
    ['PUT', new RegExp(`^/api/keys/${ID}$`), async (c) => {
      await turnKey(db, c.user.id, c.id, read.yesNo(c.body, 'on'));
      return { json: await state(c) };
    }],
    ['DELETE', new RegExp(`^/api/keys/${ID}$`), async (c) => {
      await deleteKey(db, c.user.id, c.id);
      return { json: await state(c) };
    }],
  ];
}

const plain = (text: string): Reply => ({ body: Buffer.from(text, 'utf8'), headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export function voiceRoutes(db: Db): Route[] {
  /** Runs `work` only if the key may do `action`. The words that come back are the answer, spoken as they are. */
  const only = (action: KeyAction, work: (c: Context, say: ReturnType<typeof voice>) => Promise<string>) => async (c: Context): Promise<Reply> => {
    if (!c.key) throw new Refusal(401, REFUSED);
    if (!c.key.can.includes(action)) throw new Refusal(403, "That key isn't allowed to do that.");
    return plain(await work(c, voice(db, c.key.owner, c.clock)));
  };
  return [
    ['GET', /^\/api\/voice\/groceries$/, only('groceries_read', (c, say) => say.whatToBuy(c.query.get('store')))],
    ['POST', /^\/api\/voice\/groceries$/, only('groceries_add', (c, say) => say.addGroceries(read.text(c.body, 'text')))],
    ['GET', /^\/api\/voice\/dinner$/, only('meals_read', (_c, say) => say.dinner())],
    ['GET', /^\/api\/voice\/week$/, only('meals_read', (_c, say) => say.week())],
    ['GET', /^\/api\/voice\/today$/, only('today_read', (c, say) => say.today(Boolean(c.key?.can.includes('meals_read'))))],
    ['POST', /^\/api\/voice\/reminders$/, only('reminder_add', (c, say) => say.addReminder(read.text(c.body, 'text'), read.maybeText(c.body, 'when') ?? read.maybeText(c.body, 'time')))],
  ];
}
