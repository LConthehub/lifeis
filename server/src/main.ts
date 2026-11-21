/**
 * Starts Life Is:  node src/main.ts
 *
 *   DATA_DIR               where the database is kept                         (./data)
 *   KEY_DIR                where the key that opens it is kept, apart from it  (DATA_DIR/keys)
 *   STATIC_DIR             the built pages to serve; left out, only /api is answered
 *   PORT, HOST             where to listen                                    (8008, every address)
 *   SESSION_IDLE_MINUTES   sign out after this long unused                    (15)
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { createApp } from './app.ts';
import { patientFetcher, syncDue, webFetcher } from './connectionRoutes.ts';
import { followedDue } from '../../core/src/index.ts';
import { openDatabase } from './database.ts';
import { realPostbox } from './postbox.ts';
import { vault } from './vault.ts';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const keyDir = process.env.KEY_DIR || path.join(dataDir, 'keys');
const port = Number(process.env.PORT || 8008);
const idle = Number(process.env.SESSION_IDLE_MINUTES || 15);

const database = await openDatabase(dataDir, keyDir);
const reach = { fetcher: webFetcher, sealer: vault(keyDir, 'media_source') };
const calendars = { fetcher: webFetcher, sealer: vault(keyDir, 'calendar_source') };
const server = createServer(createApp({
  db: database.db,
  reach,
  photos: { fetcher: webFetcher, sealer: vault(keyDir, 'photo_library') },
  calendars,
  assistant: { fetcher: patientFetcher, sealer: vault(keyDir, 'assistant') },
  mail: { postbox: realPostbox, sealer: vault(keyDir, 'mail_account') },
  staticDir: process.env.STATIC_DIR || undefined,
  idleMinutes: Number.isInteger(idle) && idle >= 0 ? idle : 15,
}));
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Life Is is running on port ${port}`));

// Media servers that sync by themselves are looked at every five minutes, one sync at a time.
let syncing = false;
const timer = setInterval(async () => {
  if (syncing) return;
  syncing = true;
  try {
    await syncDue(database.db, () => new Date(), reach);
    // Other calendars a person follows are read again once an hour.
    await followedDue(database.db, () => new Date(), calendars);
  } catch (problem) {
    console.error(problem);
  } finally {
    syncing = false;
  }
}, 5 * 60_000);
timer.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
