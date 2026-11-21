/**
 * Hands a file the app has made (a backup) to the person, to keep where they choose.
 *
 * On a phone it goes to the phone's own "share" sheet, which offers whatever the person has: Files, Google
 * Drive, iCloud Drive, a message to themselves. Life Is itself never talks to any of those. In a browser,
 * where the app is only tried out, it is an ordinary download.
 */
import { Capacitor } from '@capacitor/core';

export async function handOver(bytes, name) {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    let text = '';
    for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    const { uri } = await Filesystem.writeFile({ path: name, data: btoa(text), directory: Directory.Cache });
    try { await Share.share({ title: name, files: [uri] }); } finally { await Filesystem.deleteFile({ path: name, directory: Directory.Cache }).catch(() => {}); }
    return;
  }
  const address = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = Object.assign(document.createElement('a'), { href: address, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(address), 10000);
}
