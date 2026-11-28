/**
 * A second backup copy, kept off this computer. For a Life Is someone hosts (never the phone app, which keeps
 * its data on the phone). Off until the person in charge turns it on.
 *
 * They choose a passphrase. Each copy is locked with it before it leaves, by the same locking as the backups
 * the pages already make (backup.ts), so whoever holds the copy can't read it. Life Is keeps the passphrase
 * sealed on this computer (like the other saved secrets) so it can lock each night's copy by itself.
 *
 * The copy goes to a WebDAV folder they name (their own Nextcloud, say: an address, a user name and an app
 * password, the password kept sealed) or to a folder on a second drive of the same computer that the person
 * who runs this computer named in BACKUP_COPY_DIR. The newest three copies are kept there; older ones are
 * removed. A failure never stops Life Is: it is noted here, shown on the card, and said in the person in
 * charge's morning reminder.
 *
 * How a copy is carried (a web request, a file) is handed in (`tools.target`), as it differs by where Life Is runs.
 */
import { makeBackup, PASSPHRASE_MIN } from './backup.ts';
import type { Sealer } from './connections.ts';
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { localDay, stamp, type Clock } from './small.ts';

export const KEEP_COPIES = 3;
/** The name each copy is kept under: the day and time it was made, so the newest sorts last. */
const COPY_NAME = /^life-is-backup-\d{4}-\d{2}-\d{2}-\d{4}\.lifeis$/;

/** A place copies are kept: put one, list the ones there, remove one. Throws an Error with a plain sentence. */
export type CopyTarget = { put(name: string, bytes: Uint8Array): Promise<void>; list(): Promise<string[]>; remove(name: string): Promise<void> };
export type CopyPlace = 'webdav' | 'folder';
export type CopyTools = {
  sealers: { passphrase: Sealer; secret: Sealer };
  /** The place copies go, or null when this computer can't offer it (no BACKUP_COPY_DIR). */
  target(place: CopyPlace, where: { address: string | null; username: string | null; password: string | null }): CopyTarget | null;
  /** Whether a second drive was named (BACKUP_COPY_DIR), so the card offers it. */
  folder: boolean;
};

export type CopyInput = { place: unknown; address?: string | null; username?: string | null; password?: string | null; passphrase?: string | null };
export type CopyState = {
  on: boolean; folder_offered: boolean; place: CopyPlace | null; address: string | null; username: string | null; has_password: boolean;
  last_at: string | null; last_ok: boolean | null; last_note: string | null; keep: number;
  /** Exactly what is sent and to whom, as the card says it. */
  sends: string;
};

type Row = { place: CopyPlace; address: string | null; username: string | null; secret: string | null; passphrase: string; last_at: string | null; last_ok: number | null; last_note: string | null };

const WHAT = 'Everything Life Is holds, as one backup file locked with your passphrase, so only the passphrase opens it. It goes once a night, and when you press Send one now,';
const KEPT = `The newest ${KEEP_COPIES} copies are kept there and older ones are removed.`;
export const COPY_SERVICE = {
  name: 'A second backup copy',
  sends: `${WHAT} to the one place you choose below, and nowhere else. ${KEPT}`,
};

function sendsWords(place: CopyPlace | null, address: string | null): string {
  if (place === 'webdav' && address) return `${WHAT} to the WebDAV folder at ${new URL(address).host}, with the user name and app password you give, and nowhere else. ${KEPT} Whoever runs that folder can see that a file is there, its size and its date, but cannot open it.`;
  if (place === 'folder') return `${WHAT} to a folder on a second drive of the computer Life Is runs on (the one named by whoever set this computer up), and nowhere else. ${KEPT}`;
  return COPY_SERVICE.sends;
}

/** A WebDAV address, checked: https (a plain http address only for this computer itself), no trailing slash. */
function checkedAddress(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new Problem(422, 'Type the address of the WebDAV folder');
  let url: URL;
  try { url = new URL(text.trim()); } catch { throw new Problem(422, "That isn't a web address. It looks like https://cloud.example.com/remote.php/dav/files/you/Backups"); }
  const here = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && here)) throw new Problem(422, 'Use an address that starts with https://, so the password and the copy are not sent in the open');
  if (url.username || url.password) throw new Problem(422, 'Leave the user name and password out of the address; they have their own boxes');
  url.hash = ''; url.search = '';
  return url.toString().replace(/\/+$/, '');
}

const note = (problem: unknown) => String((problem as Error)?.message || 'It did not work').slice(0, 300);
let sending = false;

export function backupCopy(db: Db, tools: CopyTools, clock: Clock = () => new Date()) {
  const row = () => db.get<Row>('SELECT place, address, username, secret, passphrase, last_at, last_ok, last_note FROM backup_copy WHERE id = 1');

  async function get(): Promise<CopyState> {
    const r = await row();
    return {
      on: Boolean(r), folder_offered: tools.folder, place: r?.place ?? null, address: r?.address ?? null, username: r?.username ?? null, has_password: Boolean(r?.secret),
      last_at: r?.last_at ?? null, last_ok: r && r.last_ok !== null ? r.last_ok === 1 : null, last_note: r?.last_note ?? null, keep: KEEP_COPIES,
      sends: sendsWords(r?.place ?? null, r?.address ?? null),
    };
  }

  async function record(ok: boolean, words: string) {
    await db.run('UPDATE backup_copy SET last_at = ?, last_ok = ?, last_note = ? WHERE id = 1', [stamp(clock()), ok ? 1 : 0, words]);
  }

  /** Makes the newest locked copy and sends it, then removes all but the newest three. Never throws: the result is noted. */
  async function send(): Promise<CopyState> {
    const r = await row();
    if (!r) throw new Problem(409, 'Turn the second copy on first');
    if (sending) throw new Problem(409, 'A copy is already being sent. Give it a minute.');
    sending = true;
    try {
      const passphrase = tools.sealers.passphrase.unseal(r.passphrase);
      if (passphrase === null) throw new Error("The passphrase can't be opened on this computer (its key file changed). Turn the copy off and on again, and choose the passphrase again.");
      const password = r.secret ? tools.sealers.secret.unseal(r.secret) : null;
      if (r.place === 'webdav' && r.secret && password === null) throw new Error("The app password can't be opened on this computer (its key file changed). Turn the copy off and on again.");
      const target = tools.target(r.place, { address: r.address, username: r.username, password });
      if (!target) throw new Error('This computer has no second drive named for copies (BACKUP_COPY_DIR is not set).');
      const file = await makeBackup(db, passphrase, clock);
      const iso = clock().toISOString();
      const name = `life-is-backup-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.lifeis`;
      await target.put(name, file);
      let trimmed = '';
      try {
        const old = (await target.list()).filter((n) => COPY_NAME.test(n)).sort().reverse().slice(KEEP_COPIES);
        for (const n of old) await target.remove(n);
      } catch (problem) { trimmed = ` The copy went, but older ones could not be removed: ${note(problem)}`; }
      await record(true, `Sent ${name}.${trimmed}`);
    } catch (problem) {
      await record(false, note(problem));
    } finally {
      sending = false;
    }
    return get();
  }

  return {
    get,
    send,

    /** Turn it on, or change it. Left-blank secrets keep what was saved. Checks nothing outside; "Send one now" is the test. */
    async turnOn(input: CopyInput): Promise<CopyState> {
      if (input.place !== 'webdav' && input.place !== 'folder') throw new Problem(422, 'Choose where the copy goes');
      if (input.place === 'folder' && !tools.folder) throw new Problem(422, 'This computer has no second drive named for copies');
      const before = await row();
      const passphrase = typeof input.passphrase === 'string' && input.passphrase ? input.passphrase : null;
      if (!passphrase && !before) throw new Problem(422, 'Choose a passphrase to lock the copies with');
      if (passphrase && passphrase.length < PASSPHRASE_MIN) throw new Problem(422, `The passphrase needs at least ${PASSPHRASE_MIN} characters`);
      let address: string | null = null, username: string | null = null, secret: string | null = null;
      if (input.place === 'webdav') {
        address = checkedAddress(input.address);
        username = typeof input.username === 'string' ? input.username.trim().slice(0, 200) : '';
        if (!username) throw new Problem(422, 'Type the user name for the folder');
        const typed = typeof input.password === 'string' && input.password ? input.password.slice(0, 500) : null;
        secret = typed ? tools.sealers.secret.seal(typed) : before?.place === 'webdav' ? before.secret : null;
        if (!secret) throw new Problem(422, 'Type the app password for the folder');
      }
      const sealed = passphrase ? tools.sealers.passphrase.seal(passphrase) : before!.passphrase;
      await db.run(`INSERT INTO backup_copy (id, place, address, username, secret, passphrase, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET place = excluded.place, address = excluded.address, username = excluded.username, secret = excluded.secret, passphrase = excluded.passphrase,
          last_at = NULL, last_ok = NULL, last_note = NULL`, [input.place, address, username, secret, sealed, stamp(clock())]);
      return get();
    },

    async turnOff(): Promise<CopyState> {
      await db.run('DELETE FROM backup_copy WHERE id = 1');
      return get();
    },
  };
}

/**
 * The nightly copy: once a day, from 3 in the morning, a locked copy is made and sent if the second copy is on and
 * today's has not been tried. A failure is noted (and tried again tomorrow), never thrown.
 */
export async function copyDue(db: Db, now: Date, tools: CopyTools): Promise<CopyState | null> {
  const r = await db.get<{ last_at: string | null }>('SELECT last_at FROM backup_copy WHERE id = 1');
  if (!r || now.getHours() < 3) return null;
  if (r.last_at && localDay(new Date(r.last_at)) === localDay(now)) return null;
  return backupCopy(db, tools, () => now).send();
}

/** Why the last copy failed, for the morning reminder; null when the second copy is off or the last one went. */
export async function copyProblem(db: Db): Promise<string | null> {
  const r = await db.get<{ last_ok: number | null; last_note: string | null }>('SELECT last_ok, last_note FROM backup_copy WHERE id = 1');
  return r && r.last_ok === 0 ? (r.last_note ?? 'It did not work') : null;
}
