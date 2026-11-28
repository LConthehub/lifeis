/**
 * A backup that makes itself. Once a week, when the app is opened, everything on this phone is locked into one
 * file with a passphrase the person chose once, and the file is put in the phone's Documents, in a folder called
 * Life Is (or, where the phone won't allow that, in the app's own storage). The newest two are kept.
 *
 * The passphrase is remembered in the phone's keystore (kept.js), so nobody types it each week. Life Is sends
 * the file nowhere: it stays on the phone until the person, or the phone's own backup, copies it elsewhere.
 * The pages say so, because a copy that stays on the phone is lost with the phone.
 */
import axios from 'axios';
import { kept } from './kept.js';

const FOLDER = 'Life Is';
const NEWEST = `${FOLDER}/life-is-automatic-backup.lifeis`;
const BEFORE = `${FOLDER}/life-is-automatic-backup-before.lifeis`;
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
  return { on: s.on === true, last: s.last ?? null, where: s.where ?? null, problem: s.problem ?? null };
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
  await kept.set(STATE, { on: true, last: new Date().toISOString(), where });
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
  await kept.set(STATE, { on: false, last: s.last, where: s.where });
}

/** Called when the app opens or comes back to the front: makes one if it is on and a week has gone by. */
export async function autoBackupIfDue(now = new Date()) {
  const s = await autoBackupState();
  if (!s.on) return false;
  if (s.last && now - new Date(s.last) < EVERY_DAYS * 86400000) return false;
  try { await makeAutoBackup(); return true; } catch (problem) {
    await kept.set(STATE, { on: true, last: s.last, where: s.where, problem: String(problem?.response?.data?.detail ?? problem?.message ?? problem) });
    return false;
  }
}
