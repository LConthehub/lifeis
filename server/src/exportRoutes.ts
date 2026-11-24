/**
 * Taking everything out in open files, and bringing it back (/api/export). What it does is core/'s exportAll.ts;
 * this reads what was sent and passes it on. Nothing here needs a Node module, so the phone app answers the
 * same addresses itself, with the same file.
 *
 * The page opens the zip it is given (in the browser, or on the phone), and sends what is in it in small
 * pieces: the spreadsheets first, to look at and to bring in, then the pictures and papers a few at a time.
 * That keeps every request under the size the server reads at once. Nothing is sent anywhere else.
 */
import { bringInDownload, bringInPictures, exportEverything, lookAtDownload, MAX_SENT_BYTES, reminders, type PictureIn } from '../../core/src/index.ts';
import { notUnderstood, read, Refusal, type Body, type Route } from './http.ts';
import type { Db } from '../../core/src/index.ts';

const MAX_FILES = 200;

/** The spreadsheets and text the page found in the zip: { "recipes.csv": "…" }. */
function filesFrom(body: Body): Record<string, string> {
  const given = read.record(body, 'files');
  const files: Record<string, string> = {};
  let size = 0;
  for (const [name, text] of Object.entries(given)) {
    if (typeof text !== 'string') throw notUnderstood('files');
    size += text.length;
    files[name.slice(0, 300)] = text;
  }
  if (Object.keys(files).length === 0) throw new Refusal(422, 'Choose the zip file you downloaded');
  if (Object.keys(files).length > MAX_FILES || size > 8 * 1024 * 1024) throw new Refusal(413, "That's too much to bring in at once");
  return files;
}

function bytesFrom(data: unknown): Uint8Array {
  if (typeof data !== 'string') throw notUnderstood('pictures');
  try { return Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { throw notUnderstood('pictures'); }
}

export function exportRoutes(db: Db): Route[] {
  return [
    // One zip of everything the person keeps. Made in memory; refused in words when the pictures are too many.
    ['GET', /^\/api\/export\/everything\.zip$/, async (c) => {
      const made = await exportEverything(db, c.user.id, c.clock);
      return { body: made.bytes, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${made.filename}"`, 'Cache-Control': 'private, no-store' } };
    }],
    // What a download holds, kind by kind, and how much of it is new. Nothing is kept.
    ['POST', /^\/api\/export\/look$/, async (c) => ({ json: { ...(await lookAtDownload(db, c.user.id, filesFrom(c.body), c.clock)), max_sent: MAX_SENT_BYTES } })],
    // Brings the chosen kinds in, each in its own transaction.
    ['POST', /^\/api\/export\/bring-in$/, async (c) => ({ json: await bringInDownload(db, c.user.id, filesFrom(c.body), read.texts(c.body, 'kinds'), c.clock) })],
    // The pictures and papers that belong to what was brought in, a few at a time.
    ['POST', /^\/api\/export\/pictures$/, async (c) => {
      const pictures: PictureIn[] = read.records(c.body, 'pictures').slice(0, 40).map((one) => ({
        as: read.text(one, 'as') as PictureIn['as'], id: read.maybeWhole(one, 'id') ?? 0, kind: read.maybeText(one, 'kind') ?? undefined, name: read.maybeText(one, 'name') ?? undefined, spot: read.maybeText(one, 'spot') ?? undefined, bytes: bytesFrom(one.data),
      }));
      return { json: await bringInPictures(db, c.user.id, pictures, c.clock) };
    }],
    // The day of the person's last copy (an encrypted backup or a download), and noting one was just made. Kept in user_settings.
    ['GET', /^\/api\/your-data\/copy$/, async (c) => ({ json: await reminders(db, c.user.id, c.clock).copyState() })],
    ['POST', /^\/api\/your-data\/copied$/, async (c) => ({ json: await reminders(db, c.user.id, c.clock).copyMade() })],
  ];
}
