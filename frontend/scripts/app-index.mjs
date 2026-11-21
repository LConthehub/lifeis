// The app's build names its page device.html; a phone app opens index.html. This gives it that name.
import { renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-device');
renameSync(path.join(out, 'device.html'), path.join(out, 'index.html'));
console.log('The app is in dist-device');
