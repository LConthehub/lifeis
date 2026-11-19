/**
 * The keys that open Life Is's records, kept as files apart from the database (in Docker, in their own volume).
 * A copy of the database on its own can't be read without them.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const isCode = (problem: unknown, code: string) => (problem as NodeJS.ErrnoException)?.code === code;

/** A 32-byte secret kept in a file, made the first time. */
export function fileSecret(file: string): Buffer {
  try {
    const key = readFileSync(file);
    if (key.length !== 32) throw new Error(`${file} is not a Life Is key file`);
    return key;
  } catch (problem) {
    if (!isCode(problem, 'ENOENT')) throw problem;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  let key = randomBytes(32);
  try {
    // "wx": never write over a key that appeared in the meantime; that would orphan what it locked.
    writeFileSync(file, key, { flag: 'wx', mode: 0o600 });
  } catch (problem) {
    if (!isCode(problem, 'EEXIST')) throw problem;
    key = readFileSync(file);
    if (key.length !== 32) throw new Error(`${file} is not a Life Is key file`);
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no such permissions; the file is still only in the keys folder.
  }
  return key;
}
