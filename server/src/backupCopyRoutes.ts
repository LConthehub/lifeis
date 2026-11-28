/**
 * The second backup copy (/api/backup-copy): what it does is core/'s backupCopy.ts. This reads what was sent,
 * lets only the person in charge change it, and is where a copy is carried: to a WebDAV folder over the web, or to
 * a folder on a second drive (BACKUP_COPY_DIR). Nothing else is reached.
 */
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { backupCopy, type CopyTarget, type CopyTools, type Db } from '../../core/src/index.ts';
import { read, Refusal, type Context, type Route } from './http.ts';

const TIMEOUT = 120_000;

/** What a WebDAV server's answer means, in a plain sentence. */
function refused(status: number, doing: string): Error {
  if (status === 401 || status === 403) return new Error(`The folder refused the user name or app password (${status}) when ${doing}.`);
  if (status === 404 || status === 409) return new Error(`The folder wasn't found at that address (${status}) when ${doing}. Make the folder first, then check the address.`);
  if (status === 507) return new Error('The folder is full (507).');
  return new Error(`The folder answered ${status} when ${doing}.`);
}

export function webdavTarget(address: string, username: string, password: string): CopyTarget {
  const headers = { Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` };
  const ask = async (method: string, url: string, init: RequestInit = {}) => {
    try {
      return await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    } catch (problem) {
      throw new Error(`Couldn't reach ${new URL(address).host}: ${(problem as Error).cause instanceof Error ? ((problem as Error).cause as Error).message : (problem as Error).message}`);
    }
  };
  const at = (name: string) => `${address}/${encodeURIComponent(name)}`;
  return {
    async put(name, bytes) {
      const answer = await ask('PUT', at(name), { body: bytes as BodyInit, headers: { 'Content-Type': 'application/octet-stream' } });
      if (answer.status >= 300) throw refused(answer.status, 'sending the copy');
    },
    async list() {
      const answer = await ask('PROPFIND', `${address}/`, { headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>' });
      if (answer.status !== 207) throw refused(answer.status, 'listing the copies');
      const names = [...(await answer.text()).matchAll(/<(?:[a-z0-9]+:)?href>([^<]+)<\/(?:[a-z0-9]+:)?href>/gi)].map((m) => {
        try { return decodeURIComponent(m[1]!.trim().replace(/\/+$/, '').split('/').pop() ?? ''); } catch { return ''; }
      });
      return names.filter(Boolean);
    },
    async remove(name) {
      const answer = await ask('DELETE', at(name));
      if (answer.status >= 300 && answer.status !== 404) throw refused(answer.status, 'removing an older copy');
    },
  };
}

export function folderTarget(dir: string): CopyTarget {
  return {
    async put(name, bytes) {
      try {
        await mkdir(dir, { recursive: true });
        const temp = path.join(dir, `${name}.part`);
        await writeFile(temp, bytes);
        await rename(temp, path.join(dir, name)); // the copy appears whole or not at all
      } catch (problem) { throw new Error(`Couldn't write to the second drive's folder: ${(problem as Error).message}`); }
    },
    async list() { return readdir(dir); },
    async remove(name) { await rm(path.join(dir, path.basename(name)), { force: true }); },
  };
}

/** The ways a copy can be carried, from what this computer was given. `folderDir` is BACKUP_COPY_DIR. */
export function copyTools(sealers: CopyTools['sealers'], folderDir: string | undefined): CopyTools {
  return {
    sealers, folder: Boolean(folderDir),
    target: (place, where) => place === 'folder' ? (folderDir ? folderTarget(folderDir) : null) : webdavTarget(where.address ?? '', where.username ?? '', where.password ?? ''),
  };
}

export function backupCopyRoutes(db: Db, tools: CopyTools | undefined): Route[] {
  const mine = (c: Context) => {
    if (!tools) throw new Refusal(403, "The second backup copy isn't available here.");
    if (!c.user.is_admin) throw new Refusal(403, 'Only the person in charge of this Life Is can change the second backup copy.');
    return backupCopy(db, tools, c.clock);
  };
  return [
    ['GET', /^\/api\/backup-copy$/, async (c) => {
      if (!tools) return { json: { available: false } };
      return { json: { available: true, admin: c.user.is_admin, ...(c.user.is_admin ? await backupCopy(db, tools, c.clock).get() : {}) } };
    }],
    ['PUT', /^\/api\/backup-copy$/, async (c) => ({ json: await mine(c).turnOn({
      place: read.maybeText(c.body, 'place'), address: read.maybeText(c.body, 'address'), username: read.maybeText(c.body, 'username'),
      password: read.maybeText(c.body, 'password'), passphrase: read.maybeText(c.body, 'passphrase') }) })],
    ['POST', /^\/api\/backup-copy\/send$/, async (c) => ({ json: await mine(c).send() })],
    ['DELETE', /^\/api\/backup-copy$/, async (c) => ({ json: await mine(c).turnOff() })],
  ];
}
