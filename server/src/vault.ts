/**
 * Saved keys, locked.
 *
 * Life Is has to keep a few secrets it must be able to read back, such as the key to your media server. They
 * are stored in the database encrypted (AES-256-GCM) with a key that lives in its own file, outside the
 * database (settings.key, beside database.key). So a copy of the database alone does not give them away.
 *
 * What this does not do: protect against someone who has the whole computer, key file included. That is what
 * disk encryption is for.
 *
 * If the key file is lost, or the database is moved to another computer without it, the locked values can't
 * be opened. They then count as "not saved": the person pastes the key in again.
 *
 * The form is the one the Python server used (backend/vault.py): "sealed:v1:" then nonce + ciphertext + tag.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Sealer } from '../../core/src/index.ts';
import { fileSecret } from './keys.ts';

const PREFIX = 'sealed:v1:';

/** A sealer for one purpose. The purpose is bound in, so a value locked for one can't be opened as another. */
export function vault(keyDir: string, purpose: string): Sealer {
  const key = () => fileSecret(path.join(keyDir, 'settings.key'));
  return {
    seal(plain) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(), nonce);
      cipher.setAAD(Buffer.from(purpose, 'utf8'));
      const sealed = Buffer.concat([nonce, cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return PREFIX + sealed.toString('base64url');
    },
    unseal(stored) {
      if (!stored.startsWith(PREFIX)) return null;
      try {
        const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
        if (raw.length < 12 + 16) return null;
        const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
        decipher.setAAD(Buffer.from(purpose, 'utf8'));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
      } catch {
        return null; // locked with a key this computer doesn't have
      }
    },
  };
}
