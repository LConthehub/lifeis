/**
 * The name Life Is shows for a person: the one they chose, or their sign-in name when they have not chosen one.
 *
 * It is kept with the person's other settings (user_settings), so there is nothing to migrate. The sign-in
 * name (users.username) never changes here, and is still what signs in, finds an account and goes in addresses.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';

export const NAME_SETTING = 'display_name';
export const MAX_NAME = 40;

/**
 * SQL for the name to show for the person in a `users` row, whatever alias the query gave that table. Put it
 * in a SELECT where a bare `u.username` would be shown to people.
 */
export const shown = (alias = 'u'): string =>
  `COALESCE(NULLIF(TRIM((SELECT s.value FROM user_settings s WHERE s.user_id = ${alias}.id AND s.key = '${NAME_SETTING}')), ''), ${alias}.username)`;

/** What the person typed, made ready to keep: trimmed and at most 40 characters. Empty means none. */
export function readName(given: unknown): string {
  if (given === undefined || given === null) return '';
  if (typeof given !== 'string') throw new Problem(400, 'A name is words');
  const said = given.trim().replace(/\s+/g, ' ');
  if ([...said].length > MAX_NAME) throw new Problem(400, `Keep the name to ${MAX_NAME} letters or fewer`);
  return said;
}

export function displayName(db: Db, owner: number) {
  async function get(): Promise<{ display_name: string; name: string }> {
    const person = await db.get<{ username: string; chosen: string | null }>(
      `SELECT u.username, (SELECT s.value FROM user_settings s WHERE s.user_id = u.id AND s.key = '${NAME_SETTING}') AS chosen FROM users u WHERE u.id = ?`, [owner]);
    if (!person) throw new Problem(404, 'Not found');
    const chosen = (person.chosen ?? '').trim();
    return { display_name: chosen, name: chosen || person.username };
  }
  return {
    get,
    /** Keep a new name. Empty goes back to the sign-in name. */
    async set(given: unknown): Promise<{ display_name: string; name: string }> {
      const name = readName(given);
      if (name) {
        await db.run(
          `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, NAME_SETTING, name]);
      } else {
        await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, NAME_SETTING]);
      }
      return get();
    },
  };
}
