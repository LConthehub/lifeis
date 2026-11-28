/**
 * What the other people who sign in to this Life Is can see of one person's things. Only reads; nothing here changes
 * anything. The privacy check-up page puts this beside what the app already says about guests, the screen, reminders
 * and outside connections.
 */
import type { Db } from './db.ts';

export type SeenByOthers = {
  /** How many other people sign in here. */
  others: number;
  /** The person's lists that everyone who signs in here can see and add to. */
  shared_lists: string[];
  /** Spending categories shared with named people, and with how many each. */
  shared_categories: { name: string; people: number }[];
  /** Kept-private things (guns and ammunition) the person has shared, and how many of them. */
  shared_private_things: number;
  /** Trips left shared: other people see the name and days. */
  shared_trips: string[];
  /** Trips marked private: other people do not see them. */
  private_trips: number;
};

export async function seenByOthers(db: Db, owner: number): Promise<SeenByOthers> {
  const names = async (sql: string) => (await db.all<{ name: string }>(sql, [owner])).map((r) => r.name);
  return {
    others: (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE id <> ?', [owner]))!.n,
    shared_lists: await names('SELECT name FROM media_lists WHERE owner_id = ? AND shared = 1 ORDER BY sort_order, id'),
    shared_categories: await db.all<{ name: string; people: number }>(
      `SELECT c.name AS name, COUNT(s.user_id) AS people FROM money_categories c JOIN money_shares s ON s.category_id = c.id
       WHERE c.owner_id = ? GROUP BY c.id ORDER BY c.sort_order, c.id`, [owner]),
    shared_private_things: (await db.get<{ n: number }>('SELECT COUNT(DISTINCT s.item_id) AS n FROM item_shares s JOIN items i ON i.id = s.item_id WHERE i.owner_id = ?', [owner]))!.n,
    shared_trips: await names('SELECT name FROM outdoor_trips WHERE owner_id = ? AND private = 0 ORDER BY id'),
    private_trips: (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outdoor_trips WHERE owner_id = ? AND private = 1', [owner]))!.n,
  };
}
