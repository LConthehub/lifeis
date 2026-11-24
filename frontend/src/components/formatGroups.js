/**
 * The groups a collection's formats fall into, for the second row of chips under Books, Films, Shows and Music.
 * Formats are free words ("Blu-ray", "4K UHD", "paperback", "Kindle"), so each is put in a group by what it says.
 * The books follow the old eBooks and Audiobooks views: audio is an audiobook or a book on CD, tape or cassette;
 * an eBook is on Kindle, Kobo, epub and the like; everything else a book is on is print.
 *
 * This file imports nothing, so core/tests/formatGroups.test.ts can load it alone.
 */

const AUDIO = /audio|audible|\b(cd|cds|mp3|tape|tapes|cassette|cassettes|vinyl|record|records|lp|playaway)\b/i;
const EBOOK = /e-?book|kindle|kobo|epub|nook/i;
const FOUR_K = /\b4k\b|\buhd\b|ultra.?hd/i;
const BLURAY = /blu.?ray|\bbd\b/i;
const DVD = /\bdvds?\b/i;
const DIGITAL = /digital|stream|download|\bfiles?\b|mkv|mp4|avi|mp3|flac|itunes|vudu|movies anywhere|ultraviolet|plex|jellyfin|emby|kodi|prime|netflix|apple tv|disney|hulu|\bhd\b|bandcamp|spotify/i;
const VINYL = /vinyl|\blps?\b|\brecords?\b|\b(7|10|12)\s?("|in\b|inch)|\b45\b|\b33\b|\b78\b/i;
const CD = /\bcds?\b|compact disc/i;
const CASSETTE = /cassette|\btapes?\b/i;

/** The groups for each kind, in the order the chips show. Every kind also has "other", for what fits none. */
export const FORMAT_GROUPS = {
  book: [['print', 'Print'], ['ebook', 'eBooks'], ['audio', 'Audiobooks']],
  film: [['dvd', 'DVD'], ['bluray', 'Blu-ray'], ['4k', '4K'], ['digital', 'Digital']],
  show: [['dvd', 'DVD'], ['bluray', 'Blu-ray'], ['4k', '4K'], ['digital', 'Digital']],
  music: [['vinyl', 'Vinyl'], ['cd', 'CD'], ['cassette', 'Cassette'], ['digital', 'Digital']],
};

/** Which group one format word is in, for a kind of title: 'print', 'dvd', 'vinyl' and so on, or 'other'. */
export function formatGroup(type, format) {
  const f = String(format ?? '').trim();
  if (!f) return 'other';
  if (type === 'book') return AUDIO.test(f) ? 'audio' : EBOOK.test(f) ? 'ebook' : 'print';
  if (type === 'film' || type === 'show') return FOUR_K.test(f) ? '4k' : BLURAY.test(f) ? 'bluray' : DVD.test(f) ? 'dvd' : DIGITAL.test(f) ? 'digital' : 'other';
  if (type === 'music') return VINYL.test(f) ? 'vinyl' : CD.test(f) ? 'cd' : CASSETTE.test(f) ? 'cassette' : DIGITAL.test(f) ? 'digital' : 'other';
  return 'other';
}

/**
 * Whether a title has a copy in the group. "Other" holds the formats that fit no named group. A book with no copy
 * yet (one you only want) is with the print books, as it was on the old Books tab.
 */
export function inFormatGroup(title, group) {
  if (!group) return true;
  const formats = title.formats ?? [];
  if (title.type === 'book' && group === 'print' && formats.length === 0) return true;
  return formats.some((f) => formatGroup(title.type, f) === group);
}

/**
 * The chips for the titles of one kind: [{ id, label, count }] for "All" and each group the person owns something
 * in, with "Other" last. Empty when there would be only "All", so no second row shows. `chosen` is kept in the row
 * even with nothing in it, so a link to an empty group still shows its chip.
 */
export function formatChips(titles, type, chosen = '') {
  const own = titles.filter((m) => m.type === type);
  const groups = [...(FORMAT_GROUPS[type] ?? []), ['other', 'Other']];
  const chips = groups
    .map(([id, label]) => ({ id, label, count: own.filter((m) => inFormatGroup(m, id)).length }))
    .filter((c) => c.count > 0 || c.id === chosen);
  return chips.length > 0 && (chips.length > 1 || chips[0].id === chosen) ? [{ id: '', label: 'All', count: own.length }, ...chips] : [];
}

/** The name of a group, for a kind: "eBooks", "Blu-ray", "Other". */
export function formatGroupName(type, group) {
  return [...(FORMAT_GROUPS[type] ?? []), ['other', 'Other']].find(([id]) => id === group)?.[1] ?? '';
}
