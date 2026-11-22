/**
 * The morning reminders, made on the phone itself. Whenever the app opens or comes back to the front, this
 * morning's digest (if its time hasn't come) and tomorrow's are worked out from what Life Is holds and handed
 * to the phone to show at the person's time. Nothing is sent anywhere: the phone shows them by itself.
 *
 * Works the same whether Life Is lives on the phone or on the person's own server: the digest is asked for
 * the way every page asks for things.
 */
import axios from 'axios';
import { LocalNotifications } from '@capacitor/local-notifications';

// The two that are ever waiting: this morning's and tomorrow's. Each new schedule replaces them.
const TODAY = 1001;
const TOMORROW = 1002;

const lineText = (l) => `${l.title}${l.detail ? ` — ${l.detail}` : ''}`;

export async function scheduleReminders() {
  const { data } = await axios.get('/api/reminders');
  await LocalNotifications.cancel({ notifications: [{ id: TODAY }, { id: TOMORROW }] }).catch(() => {});
  if (!data.settings.phone) return;
  let allowed = (await LocalNotifications.checkPermissions()).display;
  if (allowed !== 'granted') allowed = (await LocalNotifications.requestPermissions()).display;
  if (allowed !== 'granted') return;

  const [hour, minute] = data.settings.time.split(':').map(Number);
  const now = new Date();
  const waiting = [];
  for (const [id, ahead] of [[TODAY, 0], [TOMORROW, 1]]) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, hour, minute);
    if (at <= now) continue;
    const { data: digest } = await axios.get('/api/reminders/digest', { params: ahead ? { ahead: 1 } : {} });
    if (!digest.lines.length) continue;
    const shown = digest.lines.slice(0, 5).map(lineText);
    if (digest.lines.length > 5) shown.push(`…and ${digest.lines.length - 5} more`);
    waiting.push({
      id, title: `Life Is: ${digest.title}`, body: shown.join('\n'), largeBody: shown.join('\n'),
      schedule: { at, allowWhileIdle: true }, extra: { url: digest.lines.length === 1 ? digest.lines[0].link : '/' },
    });
  }
  if (waiting.length) await LocalNotifications.schedule({ notifications: waiting });
}

/** A tapped reminder opens the page it's about. */
export function followReminderTaps(go) {
  LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => go(notification.extra?.url || '/'));
}
