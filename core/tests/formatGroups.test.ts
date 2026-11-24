import { describe, expect, it } from 'vitest';
// @ts-ignore: a plain .js file with no type declarations
import { formatChips, formatGroup, formatGroupName, inFormatGroup } from '../../frontend/src/components/formatGroups.js';

// The groups behind the second row of chips in the Collection (Print, eBooks, DVD, Vinyl...). Formats are free
// words, so each is sorted by what it says; the books follow the old eBooks and Audiobooks tabs.
const title = (type: string, ...formats: string[]) => ({ type, formats });

describe('formatGroup', () => {
  it('sorts books into print, eBooks and audiobooks', () => {
    for (const f of ['Paperback', 'Hardcover', 'Mass market', 'Comic']) expect(formatGroup('book', f), f).toBe('print');
    for (const f of ['eBook', 'E-book', 'Kindle', 'Kobo', 'epub', 'Nook']) expect(formatGroup('book', f), f).toBe('ebook');
    for (const f of ['Audiobook', 'Audible', 'Book on CD', 'Book on tape', 'Cassette', 'MP3', 'Playaway']) expect(formatGroup('book', f), f).toBe('audio');
  });
  it('sorts films and shows by disc, with 4K ahead of Blu-ray', () => {
    for (const type of ['film', 'show']) {
      expect(formatGroup(type, 'DVD')).toBe('dvd');
      expect(formatGroup(type, 'Blu-ray')).toBe('bluray');
      expect(formatGroup(type, 'Bluray')).toBe('bluray');
      expect(formatGroup(type, '4K UHD Blu-ray')).toBe('4k');
      expect(formatGroup(type, '4K')).toBe('4k');
      expect(formatGroup(type, 'Digital HD')).toBe('digital');
      expect(formatGroup(type, 'Jellyfin')).toBe('digital');
      expect(formatGroup(type, 'Emby')).toBe('digital');
      for (const f of ['VHS', 'LaserDisc', 'Betamax', '']) expect(formatGroup(type, f), f).toBe('other');
    }
  });
  it('sorts music by vinyl, CD, cassette and digital', () => {
    for (const f of ['Vinyl', 'LP', '12" single', '45', 'Record']) expect(formatGroup('music', f), f).toBe('vinyl');
    for (const f of ['CD', 'Compact disc', 'CD single']) expect(formatGroup('music', f), f).toBe('cd');
    for (const f of ['Cassette', 'Tape']) expect(formatGroup('music', f), f).toBe('cassette');
    for (const f of ['Digital', 'MP3', 'FLAC', 'Jellyfin']) expect(formatGroup('music', f), f).toBe('digital');
    for (const f of ['8-track', 'MiniDisc']) expect(formatGroup('music', f), f).toBe('other');
  });
  it('puts games, other things and empty words in other', () => {
    expect(formatGroup('game', 'Switch')).toBe('other');
    expect(formatGroup('book', '')).toBe('other');
    expect(formatGroup('music', null)).toBe('other');
  });
});

describe('inFormatGroup', () => {
  it('holds a title under every group one of its copies is in', () => {
    const both = title('book', 'Hardcover', 'Audiobook');
    expect(inFormatGroup(both, 'print')).toBe(true);
    expect(inFormatGroup(both, 'audio')).toBe(true);
    expect(inFormatGroup(both, 'ebook')).toBe(false);
    expect(inFormatGroup(both, '')).toBe(true);
  });
  it('keeps a wanted book with no copy yet among the print books, and a film with none out of every group', () => {
    expect(inFormatGroup(title('book'), 'print')).toBe(true);
    expect(inFormatGroup(title('book'), 'ebook')).toBe(false);
    expect(inFormatGroup(title('film'), 'dvd')).toBe(false);
    expect(inFormatGroup(title('film'), 'other')).toBe(false);
  });
});

describe('formatChips', () => {
  const films = [title('film', 'DVD'), title('film', 'DVD', 'Blu-ray'), title('film', 'VHS'), title('show', 'DVD'), title('book', 'Kindle')];
  it('shows All and only the groups something is in, with Other last and a count on each', () => {
    expect(formatChips(films, 'film').map((c: any) => `${c.label} ${c.count}`)).toEqual(['All 3', 'DVD 2', 'Blu-ray 1', 'Other 1']);
  });
  it('counts only that kind', () => {
    expect(formatChips(films, 'show').length).toBe(0);
  });
  it('leaves the row out when it would be only All', () => {
    expect(formatChips([title('book', 'Paperback'), title('book', 'Hardcover')], 'book')).toEqual([]);
    expect(formatChips([], 'music')).toEqual([]);
    expect(formatChips([title('music', '8-track')], 'music')).toEqual([]);
  });
  it('keeps a chosen group in the row even when it is empty, so a link to it still shows its chip', () => {
    const chips = formatChips([title('book', 'Paperback')], 'book', 'audio');
    expect(chips.map((c: any) => `${c.label} ${c.count}`)).toEqual(['All 1', 'Print 1', 'Audiobooks 0']);
    expect(formatChips([], 'book', 'ebook').map((c: any) => c.label)).toEqual(['All', 'eBooks']);
  });
  it('names the groups', () => {
    expect(formatGroupName('film', 'bluray')).toBe('Blu-ray');
    expect(formatGroupName('book', 'ebook')).toBe('eBooks');
    expect(formatGroupName('music', 'other')).toBe('Other');
  });
});
