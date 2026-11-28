/**
 * A photo library of your own (Immich), so a plan can show photos without Life Is keeping copies of them.
 * An outside service, and so off until a person connects it.
 *
 * What is kept here is the library's address and its key, locked. A plan that links a photo keeps only which
 * photo it is. The picture is asked for from the library each time it's shown, and passed straight on; it is
 * never stored. Life Is only ever reads from the library: it looks for photos taken on a plan's days, and
 * fetches the ones shown. Nothing there is changed.
 *
 * The key needs two permissions and no more: asset.read (to find photos by day) and asset.view (to show one).
 *
 * `fetcher` asks a web address for its answer and `sealer` locks the key; both are handed in because they
 * differ by where Life Is runs.
 */
import { serverUrl, type Answer, type Fetcher, type Sealer } from './connections.ts';
import type { Db } from './db.ts';
import { pictureType } from './plans.ts';
import { unlessPaused } from './paused.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, type Clock } from './small.ts';

export const PHOTO_SERVICE = {
  name: 'Immich',
  site: 'https://immich.app',
  sends: 'Life Is talks only to the Immich address you give, with the key you give (stored locked). It asks which photos were taken on a plan\'s days, and fetches the ones a plan shows. ' +
    'Photos stay in Immich: a plan keeps only which photo it is. Nothing in Immich is changed.',
  needs: 'Make an API key in Immich (Account settings, API keys) with just two permissions: asset.read and asset.view.',
};

export type LibraryPhoto = { id: string; name: string; /** When it was taken, where it was taken: 2046-03-05T14:30. */ taken: string };
export type PhotoLibrary = { available: boolean; connected: boolean; url: string | null };

const SETTING = 'photo_library';
const ASSET_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_PICTURE = 20_000_000;

export function photoLibrary(db: Db, owner: number, _clock: Clock = () => new Date(), reachable?: { fetcher: Fetcher; sealer: Sealer }) {
  // Switched off in Settings, it keeps its setup and asks nothing of the library.
  const tools = reachable && { ...reachable, fetcher: unlessPaused(db, owner, 'photos', reachable.fetcher) };
  const need = () => {
    if (!tools) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    return tools;
  };

  async function kept(): Promise<{ url: string; key: string } | null> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    try {
      const saved = row?.value ? JSON.parse(row.value) as { url?: unknown; key?: unknown } : null;
      return saved && typeof saved.url === 'string' && typeof saved.key === 'string' ? { url: saved.url, key: saved.key } : null;
    } catch {
      return null;
    }
  }
  async function library(): Promise<{ url: string; key: string }> {
    const saved = await kept();
    if (!saved) throw new Problem(400, 'No photo library is connected. Connect Immich in Settings, under "Connections".');
    const key = need().sealer.unseal(saved.key);
    if (key === null) throw new Problem(400, "The photo library's key can't be opened any more. Enter it again in Settings.");
    return { url: saved.url, key };
  }

  async function ask(url: string, key: string, send?: { method: 'POST'; body: string }): Promise<Answer> {
    let answer: Answer;
    try {
      answer = await need().fetcher(url, { 'x-api-key': key, Accept: send ? 'application/json' : '*/*', ...(send ? { 'Content-Type': 'application/json' } : {}) }, send);
    } catch {
      throw new Problem(400, "Couldn't reach Immich at that address. If it's on the same computer as Life Is, and Life Is runs in Docker, use http://host.docker.internal and its port instead of localhost.");
    }
    if (answer.status === 401) throw new Problem(400, "Immich didn't accept that key");
    if (answer.status === 403) throw new Problem(400, 'That key isn\'t allowed to do this. It needs the permissions asset.read and asset.view.');
    if (answer.status === 404) throw new Problem(404, "Immich doesn't have that any more");
    if (answer.status !== 200) throw new Problem(400, "Immich couldn't answer just now. Try again in a moment.");
    return answer;
  }

  /** Photos taken from the start of one day to the end of another, oldest first. Pictures only, no videos. */
  async function search(url: string, key: string, start: string, end: string, limit: number): Promise<LibraryPhoto[]> {
    // Asked a day wide on each side, then kept by the day where each photo was taken: the library files by
    // universal time, and a photo taken late in the evening may sit under the next day there.
    const body = JSON.stringify({ type: 'IMAGE', takenAfter: `${addDays(start, -1)}T00:00:00.000Z`, takenBefore: `${addDays(end, 2)}T00:00:00.000Z`, size: 1000 });
    let data: { assets?: { items?: unknown } };
    try {
      data = await (await ask(`${url}/api/search/metadata`, key, { method: 'POST', body })).json() as typeof data;
    } catch (problem) {
      if (problem instanceof Problem) throw problem;
      throw new Problem(400, 'That address answered, but not like Immich does');
    }
    const items = data?.assets?.items;
    if (!Array.isArray(items)) throw new Problem(400, 'That address answered, but not like Immich does');
    return items.flatMap((item: Record<string, unknown>): LibraryPhoto[] => {
      const taken = typeof item.localDateTime === 'string' ? item.localDateTime : typeof item.fileCreatedAt === 'string' ? item.fileCreatedAt : '';
      if (typeof item.id !== 'string' || !ASSET_ID.test(item.id) || item.type !== 'IMAGE' || taken.slice(0, 10) < start || taken.slice(0, 10) > end) return [];
      return [{ id: item.id, name: clean(typeof item.originalFileName === 'string' ? item.originalFileName : '', 200) ?? 'photo', taken: taken.slice(0, 16) }];
    }).sort((a, b) => (a.taken < b.taken ? -1 : a.taken > b.taken ? 1 : 0)).slice(0, limit);
  }

  const status = async (): Promise<PhotoLibrary> => {
    const saved = await kept();
    return { available: Boolean(tools), connected: Boolean(tools) && saved !== null, url: saved?.url ?? null };
  };

  return {
    status,

    /** Connect a library. It is only saved once the address and key have been shown to work. */
    async connect(input: { url: string; key: string }): Promise<PhotoLibrary> {
      const { sealer } = need();
      const url = serverUrl(input.url).replace(/\/api$/, '');
      const key = input.key.trim();
      if (!key) throw new Problem(400, "Give the library's API key");
      await search(url, key, '2000-01-01', '2000-01-01', 1); // the same question a plan asks, so the key's permissions are tried too
      await db.run(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, SETTING, JSON.stringify({ url, key: sealer.seal(key) })]);
      return status();
    },

    /** Forget the library and its key. Photos already linked to plans stay linked, and show again if it's reconnected. */
    async disconnect(): Promise<PhotoLibrary> {
      await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
      return status();
    },

    /** The photos taken on these days, for choosing which to link. */
    async taken(start: string, end: string): Promise<LibraryPhoto[]> {
      if (dayNumber(end) < dayNumber(start) || dayNumber(end) - dayNumber(start) > 62) throw new Problem(400, 'Up to 62 days at a time');
      const { url, key } = await library();
      return search(url, key, start, end, 300);
    },

    /** One photo's picture, small (for choosing) or larger (for showing). Fetched now, kept nowhere. */
    async picture(assetId: string, size: 'thumbnail' | 'preview'): Promise<{ type: string; bytes: Uint8Array }> {
      if (!ASSET_ID.test(assetId)) throw new Problem(400, "That isn't a photo from the library");
      const { url, key } = await library();
      const answer = await ask(`${url}/api/assets/${assetId}/thumbnail?size=${size}`, key);
      const bytes = await answer.bytes();
      // Only ever passed on as the kind of picture its own bytes say it is.
      const type = pictureType(bytes);
      if (!type || bytes.length > MAX_PICTURE) throw new Problem(400, "Immich's answer wasn't a picture");
      return { type, bytes };
    },
  };
}

export type Photos = ReturnType<typeof photoLibrary>;
