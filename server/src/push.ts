/**
 * Browser notifications (Web Push). Life Is signs each message with a key pair of its own, made the first time
 * and kept with its other keys, so the browser maker's push service knows the message comes from the Life Is
 * the browser said yes to. The message itself is locked to that one browser: the push service carries it
 * without being able to read it.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import type { PushSender } from '../../core/src/index.ts';

type Keys = { publicKey: string; privateKey: string };

export function browserPush(keyDir: string, contact = 'mailto:hello@lifeis.living'): { publicKey: string; send: PushSender } {
  const file = path.join(keyDir, 'push-keys.json');
  let keys: Keys;
  if (existsSync(file)) keys = JSON.parse(readFileSync(file, 'utf8')) as Keys;
  else {
    keys = webpush.generateVAPIDKeys();
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  }
  const options = { vapidDetails: { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 12 * 3600 };
  return {
    publicKey: keys.publicKey,
    async send(to, message) {
      try {
        await webpush.sendNotification({ endpoint: to.endpoint, keys: { p256dh: to.p256dh, auth: to.auth } }, JSON.stringify(message), options);
        return 'sent';
      } catch (problem) {
        // 404 and 410: the browser has stopped listening, for good.
        const status = (problem as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return 'gone';
        throw new Error(`the push service said no${status ? ` (${status})` : ''}`);
      }
    },
  };
}
