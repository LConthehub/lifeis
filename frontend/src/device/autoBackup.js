/**
 * A backup that makes itself. Once a week, when the app is opened, everything on this phone is locked into one
 * file with a passphrase the person chose once, and the file is put in the phone's Documents, in a folder called
 * Life Is (or, where the phone won't allow that, in the app's own storage). The newest two are kept.
 *
 * The passphrase is remembered in the phone's keystore (kept.js), so nobody types it each week. Life Is sends
 * the file nowhere: it stays on the phone until the person, or the phone's own backup, copies it elsewhere.
 * The pages say so, because a copy that stays on the phone is lost with the phone.
 *
 * One more thing, off until the person turns it on: the newest file is also kept in the one folder of the app's
 * own storage that the phone's own backup is allowed to pick up (android res/xml/carried_backup.xml lets that
 * folder through and nothing else). The phone then carries the locked file to the person's own cloud account,
 * and brings it back to a new phone, where the first screen finds it and asks for the passphrase.
 */
import axios from 'axios';
import { kept } from './kept.js';

const FOLDER = 'Life Is';
const NEWEST = `${FOLDER}/life-is-automatic-backup.lifeis`;
const BEFORE = `${FOLDER}/life-is-automatic-backup-before.lifeis`;
const CARRIED = 'carried/life-is-automatic-backup.lifeis';
// The phone's own backup takes at most 25 MB from an app, and takes nothing at all when there is more.
const CARRIED_MOST = 24 * 1024 * 1024;
const EVERY_DAYS = 7;
const STATE = 'auto_backup';
const PASSPHRASE = 'backup_passphrase';

const base64 = (bytes) => {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
};

/** Whether it is on, when the last one was made, and where it was put ('documents' or 'app'). */
export async function autoBackupState() {
  const s = (await kept.get(STATE)) ?? {};
  return { on: s.on === true, last: s.last ?? null, where: s.where ?? null, problem: s.problem ?? null, carry: s.carry === true, too_large: s.too_large === true };
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Puts the newest file where the phone's own backup looks, or takes it away. Says whether it was too large to go. */
async function carried(bytes) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  if (!bytes || bytes.length > CARRIED_MOST) {
    await Filesystem.deleteFile({ path: CARRIED, directory: Directory.Data }).catch(() => {});
    return Boolean(bytes);
  }
  await Filesystem.writeFile({ path: CARRIED, data: base64(bytes), directory: Directory.Data, recursive: true });
  return false;
}

/**
 * On a phone with no Life Is yet: the backup its own backup brought across, if there is one. Answers a file to
 * hand to "bring a backup back" and the day it was made, or null.
 */
export async function findCarriedBackup() {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const at = await Filesystem.stat({ path: CARRIED, directory: Directory.Data });
    const { data } = await Filesystem.readFile({ path: CARRIED, directory: Directory.Data });
    const bytes = typeof data === 'string' ? fromBase64(data) : new Uint8Array(await data.arrayBuffer());
    return { file: new Blob([bytes]), made: at.mtime ? new Date(at.mtime).toISOString() : null };
  } catch { return null; }
}

/** After a carried backup was brought back with this passphrase: weekly backups carry on as they were. */
export async function carryOnWith(passphrase) {
  await kept.set(PASSPHRASE, passphrase);
  await kept.set(STATE, { on: true, last: new Date().toISOString(), where: null, carry: true });
}

/** Turns the phone's own backup carrying it on or off. Turning it on makes a fresh one to hand over. */
export async function setCarried(on) {
  const s = await autoBackupState();
  if (!s.on) throw new Error('Turn on weekly backups first');
  await kept.set(STATE, { on: true, last: s.last, where: s.where, carry: on });
  if (on) await makeAutoBackup(); else await carried(null);
}

/** The passphrase this phone remembers, for the person to write down. Null when weekly backups are off. */
export const rememberedPassphrase = () => kept.get(PASSPHRASE);

/** Puts the file on the phone: the one before is kept beside it, and the one before that is replaced. */
async function putOnPhone(bytes) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const data = base64(bytes);
  let why;
  for (const [where, directory] of [['documents', Directory.Documents], ['app', Directory.Data]]) {
    try {
      const has = await Filesystem.stat({ path: NEWEST, directory }).then(() => true, () => false);
      if (has) {
        await Filesystem.deleteFile({ path: BEFORE, directory }).catch(() => {});
        await Filesystem.rename({ from: NEWEST, to: BEFORE, directory, toDirectory: directory });
      }
      await Filesystem.writeFile({ path: NEWEST, data, directory, recursive: true });
      return where;
    } catch (problem) { why = problem; }
  }
  throw why;
}

/** Makes one now, with the remembered passphrase, and puts it on the phone. Returns the file's bytes. */
export async function makeAutoBackup() {
  const passphrase = await kept.get(PASSPHRASE);
  if (!passphrase) throw new Error('Weekly backups are off');
  const { data } = await axios.post('/api/device/backup', { passphrase }, { responseType: 'arraybuffer' });
  const bytes = new Uint8Array(data);
  const where = await putOnPhone(bytes);
  const { carry } = await autoBackupState();
  const tooLarge = carry ? await carried(bytes) : false;
  await kept.set(STATE, { on: true, last: new Date().toISOString(), where, carry, too_large: tooLarge });
  return bytes;
}

/** Turns weekly backups on with this passphrase, and makes the first one at once. */
export async function turnOnAutoBackup(passphrase) {
  await kept.set(PASSPHRASE, passphrase);
  try { await makeAutoBackup(); } catch (problem) { await kept.remove(PASSPHRASE); throw problem; }
}

/** Turns them off and forgets the passphrase. The files already made stay where they are. */
export async function turnOffAutoBackup() {
  const s = await autoBackupState();
  await kept.remove(PASSPHRASE);
  await carried(null);
  await kept.set(STATE, { on: false, last: s.last, where: s.where });
}

/** Called when the app opens or comes back to the front: makes one if it is on and a week has gone by. */
export async function autoBackupIfDue(now = new Date()) {
  const s = await autoBackupState();
  if (!s.on) return false;
  if (s.last && now - new Date(s.last) < EVERY_DAYS * 86400000) return false;
  try { await makeAutoBackup(); return true; } catch (problem) {
    await kept.set(STATE, { on: true, last: s.last, where: s.where, carry: s.carry, problem: String(problem?.response?.data?.detail ?? problem?.message ?? problem) });
    return false;
  }
}
