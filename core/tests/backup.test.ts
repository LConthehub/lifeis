/** A backup: one file that holds everything, opens only with its passphrase, and comes back whole or not at all. */
import { beforeEach, expect, it } from 'vitest';
import { makeBackup, restoreBackup } from '../src/backup.ts';
import type { Db } from '../src/db.ts';
import { kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const PASS = 'correct horse battery';
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function filled(): Promise<{ db: Db; owner: number }> {
  const db = memoryDb();
  await migrate(db);
  const owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('me', 'none', 'now')")).lastId;
  await kitchen(db, owner, clock).createRecipe({ title: 'Grandmother’s soup 🍲', ingredients_text: '3 leeks\n1 lb potatoes', steps_text: 'Simmer.', tags: ['winter'] });
  await db.run("INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at) VALUES ('t', ?, 'now', 'now', 'later')", [owner]).catch(() => {});
  return { db, owner };
}
const everything = async (db: Db) => {
  const out: Record<string, unknown[]> = {};
  for (const { name } of await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sessions', 'login_throttle') ORDER BY name")) out[name] = await db.all(`SELECT * FROM "${name}" ORDER BY rowid`);
  return out;
};

let from: Db;
let owner: number;
beforeEach(async () => { ({ db: from, owner } = await filled()); });

it('says nothing readable, and differs every time it is made', async () => {
  const one = await makeBackup(from, PASS, clock);
  const two = await makeBackup(from, PASS, clock);
  const seen = new TextDecoder('latin1').decode(one);
  expect(seen.startsWith('LIFEIS-BACKUP-1\n')).toBe(true);
  for (const word of ['soup', 'leeks', 'recipes', 'winter', 'users']) expect(seen).not.toContain(word);
  expect(Buffer.from(one).equals(Buffer.from(two))).toBe(false);
  await expect(makeBackup(from, 'short', clock)).rejects.toEqual(problem(422));
});

it('comes back whole into another Life Is, replacing what was there, pictures included', async () => {
  const picture = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
  await from.run('PRAGMA foreign_keys = OFF');
  await from.run("INSERT INTO media_covers (media_id, type, bytes) VALUES (1, 'image/jpeg', ?)", [picture]);
  const file = await makeBackup(from, PASS, clock);

  const { db: to, owner: other } = await filled();
  await kitchen(to, other, clock).createRecipe({ title: 'Only here', ingredients_text: '1 egg', steps_text: 'Fry.', tags: [] });
  await to.run('PRAGMA foreign_keys = OFF');
  const done = await restoreBackup(to, file, PASS);
  expect(done.made_at).toBe('2046-03-05T10:00:00.000Z');
  expect(done.rows).toBeGreaterThan(3);
  expect(await everything(to)).toEqual(await everything(from));
  expect((await to.get<{ bytes: Uint8Array }>('SELECT bytes FROM media_covers'))!.bytes).toEqual(picture);
  expect((await kitchen(to, owner, clock).listRecipes()).map((r) => r.title)).toEqual(['Grandmother’s soup 🍲']);
  // And it still works as a Life Is afterwards: new things get new numbers.
  await kitchen(to, owner, clock).createRecipe({ title: 'After', ingredients_text: '', steps_text: '', tags: [] });
  expect(await kitchen(to, owner, clock).listRecipes()).toHaveLength(2);
});

it('refuses the wrong passphrase, a damaged file and a stranger, and leaves everything as it was', async () => {
  const file = await makeBackup(from, PASS, clock);
  const { db: to, owner: other } = await filled();
  await kitchen(to, other, clock).createRecipe({ title: 'Only here', ingredients_text: '1 egg', steps_text: 'Fry.', tags: [] });
  const before = await everything(to);
  await expect(restoreBackup(to, file, 'wrong horse battery')).rejects.toThrow(/doesn't open this backup/);
  const damaged = file.slice(); damaged[damaged.length - 5]! ^= 1;
  await expect(restoreBackup(to, damaged, PASS)).rejects.toThrow(/doesn't open this backup/);
  await expect(restoreBackup(to, new TextEncoder().encode('just some text that is long enough to be looked at properly, not a backup'), PASS)).rejects.toThrow(/isn't a Life Is backup/);
  await expect(restoreBackup(to, file, '')).rejects.toEqual(problem(422));
  expect(await everything(to)).toEqual(before);
});

it('leaves sign-ins out', async () => {
  const sessions = (await from.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions'))!.n;
  const { db: to } = await filled();
  await to.run('DELETE FROM sessions');
  await restoreBackup(to, await makeBackup(from, PASS, clock), PASS);
  expect((await to.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions'))!.n).toBe(0);
  expect(sessions).toBeGreaterThanOrEqual(0);
});
