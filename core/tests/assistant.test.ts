/** The assistant: a model you choose, given only the parts of Life Is you tick, and never another person's. */
import { beforeEach, expect, it } from 'vitest';
import { assistant, isLocal, FACTS_LIMIT } from '../src/assistant.ts';
import type { Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const sealer: Sealer = { seal: (s) => `sealed:${s}`, unseal: (s) => (s.startsWith('sealed:') ? s.slice(7) : null) };
type Asked = { url: string; headers: Record<string, string>; body: Record<string, unknown> | null };
let asked: Asked[];
let reply: unknown;
const fetcher: Fetcher = async (url, headers, send) => {
  asked.push({ url, headers, body: send ? JSON.parse(send.body) as Record<string, unknown> : null });
  const text = JSON.stringify(url.endsWith('/models') ? { data: [{ id: 'llama3.2' }, { id: 'qwen3' }] } : reply);
  return { status: 200, type: 'application/json', json: async () => JSON.parse(text), bytes: async () => new TextEncoder().encode(text) };
};
const helper = (who: number) => assistant(db, who, clock, { fetcher, sealer });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
  asked = [];
  reply = { choices: [{ message: { content: '<think>pantry has eggs</think>You could make an omelette.' } }] };
});

it('knows a model on this computer or your own network from one out on the internet', () => {
  for (const near of ['http://localhost:11434/v1', 'http://host.docker.internal:1234/v1', 'http://192.168.1.20:1234', 'http://10.0.0.5', 'http://172.20.1.1', 'http://100.101.1.2', 'http://studio.local:1234', 'http://box.tail1234.ts.net', 'http://[::1]:8080'])
    expect([near, isLocal(near)]).toEqual([near, true]);
  for (const far of ['https://api.openai.com/v1', 'https://api.anthropic.com/v1', 'http://8.8.8.8', 'http://172.32.0.1', 'not an address'])
    expect([far, isLocal(far)]).toEqual([far, false]);
});

it('is off until turned on, starts with the kitchen only, and refuses a cloud AI without the tick', async () => {
  const me = helper(ana);
  expect(await me.status()).toMatchObject({ available: true, enabled: false, local: true, cloud_ok: false, areas: ['kitchen'], key_saved: false });
  await expect(me.ask('What can I cook?')).rejects.toMatchObject({ status: 409 });
  await expect(me.save({ url: 'https://api.example-ai.com/v1' })).rejects.toThrow(/leaves this computer/);
  const cloud = await me.save({ enabled: true, url: 'https://api.example-ai.com/v1/', cloud_ok: true, key: 'sk-secret', model: 'big-model', areas: ['kitchen', 'spending', 'nonsense'] });
  expect(cloud).toMatchObject({ enabled: true, url: 'https://api.example-ai.com/v1', local: false, cloud_ok: true, key_saved: true, areas: ['kitchen', 'spending'] });
  // The key is kept locked, and goes only to the model's server.
  expect((await db.get<{ value: string }>("SELECT value FROM user_settings WHERE key = 'assistant'"))!.value).toContain('sealed:sk-secret');
  expect(await me.models()).toEqual(['llama3.2', 'qwen3']);
  expect(asked[0]).toMatchObject({ url: 'https://api.example-ai.com/v1/models', headers: { Authorization: 'Bearer sk-secret' } });
  expect((await me.save({ clear_key: true })).key_saved).toBe(false);
  expect(assistant(db, ana, clock).status()).resolves.toMatchObject({ available: false });
});

it('keeps where the Ask box shows: Home at first, then every page or nowhere, and nothing else', async () => {
  const me = helper(ana);
  expect((await me.status()).show).toBe('home');
  expect((await me.save({ show: 'everywhere' })).show).toBe('everywhere');
  expect((await me.save({ areas: ['kitchen'] })).show).toBe('everywhere');
  expect((await me.save({ show: 'nowhere' })).show).toBe('nowhere');
  await expect(me.save({ show: 'sometimes' })).rejects.toMatchObject({ status: 400 });
  expect((await me.status()).show).toBe('nowhere');
});

it('answers from the ticked parts only, says what it sent, and leaves out its thinking', async () => {
  const cook = kitchen(db, ana, clock);
  await cook.createRecipe({ title: 'Omelette', ingredients_text: '3 eggs\n1 tbsp butter', steps_text: 'Whisk and fry.', tags: ['quick'] });
  const groceries = await money(db, ana, clock).addCategory({ name: 'Groceries', monthly_cents: 40000 });
  await money(db, ana, clock).addEntry({ label: 'Market', cents: 2500, category_id: groceries.id });
  await db.run("INSERT INTO events (owner_id, title, day, note, created_at, updated_at) VALUES (?, 'Dentist', '2046-03-07', 'private note', 'now', 'now')", [ana]);
  const me = helper(ana);
  await me.save({ enabled: true, url: 'http://localhost:11434/v1', model: 'llama3.2', areas: ['kitchen'] });

  const got = await me.ask('  What can I make?  ');
  expect(got.answer).toBe('You could make an omelette.');
  expect(got.given).toMatchObject({ today: '2046-03-05', recipes: [{ title: 'Omelette', ingredients: ['3 eggs', '1 tbsp butter'] }] });
  expect(Object.keys(got.given)).not.toContain('spending_this_month');
  const sent = asked.at(-1)!;
  expect(sent.url).toBe('http://localhost:11434/v1/chat/completions');
  expect(sent.headers.Authorization).toBeUndefined();
  expect(sent.body).toMatchObject({ model: 'llama3.2', temperature: 0.2 });
  const said = JSON.stringify(sent.body);
  expect(said).toContain('What can I make?');
  expect(said).not.toMatch(/Market|Dentist|Groceries/);

  await me.save({ areas: ['spending', 'calendar'] });
  const wider = JSON.stringify((await me.ask('How much is left?')).given);
  expect(wider).toMatch(/Groceries/);
  expect(wider).toMatch(/Dentist/);
  expect(wider).not.toMatch(/private note|Omelette/);

  await me.save({ areas: [] });
  await expect(me.ask('Anything?')).rejects.toMatchObject({ status: 409 });
  await expect(me.ask('   ')).rejects.toMatchObject({ status: 400 });
  reply = { nothing: 'here' };
  await me.save({ areas: ['kitchen'] });
  await expect(me.ask('Hello?')).rejects.toThrow(/isn't an answer/);
});

it("never gives the model someone else's private category, and keeps other calendars to 'busy'", async () => {
  const theirs = money(db, ben, clock);
  const gift = await theirs.addCategory({ name: "Ana's present", monthly_cents: 20000 });
  await theirs.addEntry({ label: 'Necklace', cents: 15000, category_id: gift.id });
  const shared = await theirs.addCategory({ name: 'House', monthly_cents: 50000, shared_with: [ana] });
  await theirs.addEntry({ label: 'Paint', cents: 4000, category_id: shared.id });
  const calendar = (await db.run("INSERT INTO followed_calendars (owner_id, name, url, show, zone, created_at) VALUES (?, 'Work', 'sealed', 'titles', 'UTC', 'now')", [ana])).lastId;
  await db.run("INSERT INTO followed_events (calendar_id, day, time, end_time, title) VALUES (?, '2046-03-06', '09:00', '17:00', 'Client: Mr Smith')", [calendar]);
  const me = helper(ana);
  await me.save({ enabled: true, areas: ['spending', 'calendar'] });
  const given = JSON.stringify((await me.ask('What is on?')).given);
  expect(given).toMatch(/House/);
  expect(given).toMatch(/Paint/);
  expect(given).not.toMatch(/present|Necklace/);
  expect(given).not.toMatch(/Smith|Client|Work/);
  expect(given).toContain('"what":"busy"');
});

it('shortens the longest lists to fit a small model, and says it did', async () => {
  const cook = kitchen(db, ana, clock);
  for (let n = 0; n < 400; n += 1) await cook.createRecipe({ title: `Recipe number ${n} with a fairly long name`, ingredients_text: '2 cups flour\n1 cup sugar\n3 eggs\n1 cup milk', steps_text: 'Mix.', tags: [] });
  const me = helper(ana);
  await me.save({ enabled: true });
  const given = (await me.ask('Which recipes?')).given;
  expect(JSON.stringify(given).length).toBeLessThanOrEqual(FACTS_LIMIT);
  expect((given.recipes as unknown[]).length).toBeGreaterThan(10);
  expect(given.note).toMatch(/shortened/);
});

it("uses the phone's own model when chosen: no address, no tick, nothing fetched, and less to read", async () => {
  let ready = true;
  const prompts: string[] = [];
  const phone = {
    name: 'Apple Intelligence',
    check: async () => (ready ? { ready: true } : { ready: false, why: 'Apple Intelligence is still downloading.' }),
    answer: async (system: string, prompt: string) => { prompts.push(system + prompt); return 'You have eggs.'; },
  };
  const cook = kitchen(db, ana, clock);
  for (let n = 0; n < 120; n += 1) await cook.createRecipe({ title: `Recipe ${n} with a long name`, ingredients_text: '2 cups flour\n3 eggs\n1 cup milk', steps_text: 'Mix.', tags: [] });
  // On a server there is no phone model to choose.
  await expect(helper(ana).save({ source: 'phone' })).rejects.toMatchObject({ status: 400 });
  const me = assistant(db, ana, clock, { phone });
  expect(await me.status()).toMatchObject({ available: true, source: 'address', phone: { name: 'Apple Intelligence' } });
  // A cloud address saved earlier doesn't matter once the phone's own model is chosen.
  const chosen = await me.save({ source: 'phone', enabled: true, url: 'https://far-away.example/v1' });
  expect(chosen).toMatchObject({ source: 'phone', local: true, cloud_ok: false });
  expect(await me.phoneCheck()).toEqual({ name: 'Apple Intelligence', ready: true });
  const got = await me.ask('What can I make?');
  expect(got.answer).toBe('You have eggs.');
  expect(asked).toHaveLength(0); // nothing went to any address
  expect(JSON.stringify(got.given).length).toBeLessThanOrEqual(6000);
  expect(prompts[0]).toContain('What can I make?');
  // Not ready yet: said in words, and nothing is asked of it.
  ready = false;
  await expect(me.ask('Again?')).rejects.toThrow(/still downloading/);
  expect(prompts).toHaveLength(1);
  // A key can't be kept where there's no way to lock it.
  await expect(me.save({ source: 'address', url: 'http://localhost:11434/v1', key: 'sk-1' })).rejects.toThrow(/can't be kept safely/);
  // The same records on a server, where there's no phone: it falls back to an address.
  expect((await helper(ana).status()).source).toBe('address');
});

it('copies a handwritten recipe out of a photo: the photo alone goes to the model, and only when allowed', async () => {
  const me = helper(ana);
  const photo = { type: 'image/jpeg', base64: '/9j/4AAQSkZJRg==' };
  await expect(me.readRecipePhoto(photo)).rejects.toThrow('Turn the assistant on');
  await me.save({ enabled: true, url: 'http://host.docker.internal:1234/v1', model: 'a-model-that-sees' });
  await kitchen(db, ana).createRecipe({ title: 'Secret family stew', ingredients_text: '1 secret' });
  reply = { choices: [{ message: { content: "```\nNana's biscuits\n2 cups flour\n1 [?] butter\nCut the butter in.\n```" } }] };
  expect(await me.readRecipePhoto(photo)).toEqual({ text: "Nana's biscuits\n2 cups flour\n1 [?] butter\nCut the butter in." });
  const sent = asked.at(-1)!;
  expect(sent.url).toBe('http://host.docker.internal:1234/v1/chat/completions');
  const content = (sent.body!.messages as { content: { type: string; text?: string; image_url?: { url: string } }[] }[])[0]!.content;
  expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } });
  expect(content[0]!.text).toMatch(/Copy out exactly what is written/);
  // None of the household's records go with the photo.
  expect(JSON.stringify(sent.body)).not.toContain('Secret family stew');

  // Not a recipe, not a photo, a cloud model that wasn't allowed, or the phone's own model: each is said plainly.
  reply = { choices: [{ message: { content: 'NOTHING' } }] };
  await expect(me.readRecipePhoto(photo)).rejects.toThrow("couldn't read a recipe");
  await expect(me.readRecipePhoto({ type: 'application/pdf', base64: 'AAAA' })).rejects.toThrow('Choose a photo');
  await expect(me.readRecipePhoto({ type: 'image/png', base64: 'not base64!' })).rejects.toThrow('Choose a photo');
  await db.run("UPDATE user_settings SET value = json_set(value, '$.url', 'https://api.example.com/v1') WHERE user_id = ? AND key = 'assistant'", [ana]);
  await expect(me.readRecipePhoto(photo)).rejects.toThrow("a cloud AI hasn't been allowed");
});
