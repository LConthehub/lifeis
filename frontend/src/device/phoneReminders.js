/**
 * The morning reminders, made on the phone itself. Whenever the app opens or comes back to the front, this
 * morning's digest (if its time hasn't come) and the next seven mornings' are worked out from what Life Is holds
 * and handed to the phone to show at the person's time, so a week without opening the app is not a week without
 * reminders. Each opening replaces them with fresh ones. Nothing is sent anywhere: the phone shows them by itself.
 *
 * Works the same whether Life Is lives on the phone or on the person's own server: the digest is asked for
 * the way every page asks for things.
 */
import axios from 'axios';
import { LocalNotifications } from '@capacitor/local-notifications';

// The mornings that are ever waiting: this one and the next seven. Each new schedule replaces them.
const DAYS_AHEAD = 7;
const TODAY = 1001;
const MORNING_IDS = Array.from({ length: DAYS_AHEAD + 1 }, (_, ahead) => ({ id: TODAY + ahead }));

const lineText = (l) => `${l.title}${l.detail ? `: ${l.detail}` : ''}`;

export async function scheduleReminders() {
  const { data } = await axios.get('/api/reminders');
  await LocalNotifications.cancel({ notifications: [...MORNING_IDS, ...PREP_IDS, ...ROUTINE_IDS] }).catch(() => {});
  if (!data.settings.phone) return;
  let allowed = (await LocalNotifications.checkPermissions()).display;
  if (allowed !== 'granted') allowed = (await LocalNotifications.requestPermissions()).display;
  if (allowed !== 'granted') return;

  const [hour, minute] = data.settings.time.split(':').map(Number);
  const now = new Date();
  const waiting = [];
  for (const [ahead, { id }] of MORNING_IDS.entries()) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, hour, minute);
    if (at <= now) continue;
    const { data: digest } = await axios.get('/api/reminders/digest', { params: ahead ? { ahead } : {} });
    if (!digest.lines.length) continue;
    const shown = digest.lines.slice(0, 5).map(lineText);
    if (digest.lines.length > 5) shown.push(`…and ${digest.lines.length - 5} more`);
    waiting.push({
      id, title: `Life Is: ${digest.title}`, body: shown.join('\n'), largeBody: shown.join('\n'),
      schedule: { at, allowWhileIdle: true }, extra: { url: digest.lines.length === 1 ? digest.lines[0].link : '/' },
    });
  }
  if (waiting.length) await LocalNotifications.schedule({ notifications: waiting });
  await schedulePrep();
  await scheduleRoutines();
}

// Prep steps ("Thaw the chicken") are kept apart from the morning ones: each waits for its own time. A run of
// ids is set aside for them, and every schedule replaces what was waiting, so a meal that moved or went off the
// week takes its reminders with it. A step whose time has gone is never shown late (the server leaves it out).
const PREP_FIRST = 2000;
const PREP_MOST = 60;
const PREP_IDS = Array.from({ length: PREP_MOST }, (_, i) => ({ id: PREP_FIRST + i }));

async function schedulePrep() {
  const { data: coming } = await axios.get('/api/prep/coming', { params: { days: 8 } });
  const now = new Date();
  const waiting = [];
  for (const step of coming) {
    const [y, m, d] = step.due_day.split('-').map(Number);
    const [hour, minute] = step.due_time.split(':').map(Number);
    const at = new Date(y, m - 1, d, hour, minute);
    if (at <= now || waiting.length >= PREP_MOST) continue;
    waiting.push({
      id: PREP_FIRST + waiting.length, title: `Life Is: ${step.words}`, body: `For ${step.what} at ${step.eat_time}`,
      schedule: { at, allowWhileIdle: true }, extra: { url: '/week' },
    });
  }
  if (waiting.length) await LocalNotifications.schedule({ notifications: waiting });
}

// A time of a routine that has a clock time ("Evening, 9 pm") is kept apart the same way: its own run of ids, replaced
// on every schedule, and one that is already finished (or whose time has gone) is left out by the server or here.
const ROUTINE_FIRST = 2100;
const ROUTINE_MOST = 60;
const ROUTINE_IDS = Array.from({ length: ROUTINE_MOST }, (_, i) => ({ id: ROUTINE_FIRST + i }));

async function scheduleRoutines() {
  const { data: coming } = await axios.get('/api/routines/coming', { params: { days: 8 } });
  const now = new Date();
  const waiting = [];
  for (const one of coming) {
    const [y, m, d] = one.day.split('-').map(Number);
    const [hour, minute] = one.at.split(':').map(Number);
    const at = new Date(y, m - 1, d, hour, minute);
    if (at <= now || waiting.length >= ROUTINE_MOST) continue;
    waiting.push({
      id: ROUTINE_FIRST + waiting.length, title: `Life Is: ${one.title}`, body: `${one.steps} ${one.steps === 1 ? 'step' : 'steps'} to do`,
      schedule: { at, allowWhileIdle: true }, extra: { url: '/' },
    });
  }
  if (waiting.length) await LocalNotifications.schedule({ notifications: waiting });
}

/** A tapped reminder opens the page it's about. */
export function followReminderTaps(go) {
  LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => go(notification.extra?.url || '/'));
}

// A cooking timer on a phone that keeps everything on the phone: its end is handed to the phone to show, so it goes
// off even when the app is closed. A run of ids is set aside for them; the same id replaces the old one.
export async function scheduleTimerNotice(id, label, at, recipeId) {
  let allowed = (await LocalNotifications.checkPermissions()).display;
  if (allowed !== 'granted') allowed = (await LocalNotifications.requestPermissions()).display;
  if (allowed !== 'granted') return;
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
  await LocalNotifications.schedule({ notifications: [{
    id, title: `Timer done: ${label}`, body: 'Your cooking timer has ended.',
    schedule: { at, allowWhileIdle: true }, extra: { url: recipeId ? `/recipes/${recipeId}` : '/recipes' },
  }] });
}

export async function cancelTimerNotice(id) {
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
}
