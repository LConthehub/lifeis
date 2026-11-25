import { describe, expect, it } from 'vitest';
// @ts-expect-error: a page file written in plain JavaScript
import { feedingFrom, fitList, manualParts, shorten, wifiCode, wifiFrom } from '../../frontend/src/print/manualParts.js';

const entry = (section: string, title: string, body: string | null = null, extra = {}) => ({ id: 1, section, title, body, phone: null, place: null, private: false, ...extra });

describe('what the manual printouts are made from', () => {
  it('reads the Wi-Fi network and password, and makes the code a phone reads', () => {
    expect(wifiFrom(entry('house', 'Wi-Fi', 'Network: SampleHome\nPassword: made-up-for-the-demo'))).toEqual({ network: 'SampleHome', password: 'made-up-for-the-demo' });
    expect(wifiFrom(entry('house', 'Wi-Fi', 'Just ask me'))).toBeNull();
    // ; , : " and \ are written with a backslash in front.
    expect(wifiCode({ network: 'Sample;Home', password: 'a:b,c"d\\' })).toBe('WIFI:T:WPA;S:Sample\\;Home;P:a\\:b\\,c\\"d\\\\;;');
    expect(wifiCode({ network: 'Open', password: '' })).toBe('WIFI:T:nopass;S:Open;;');
  });

  it('leaves private entries off the printouts unless asked', () => {
    const manual = {
      sections: [
        { id: 'emergency', entries: [entry('emergency', 'Water shut-off')] },
        { id: 'contacts', entries: [] },
        { id: 'house', entries: [entry('house', 'Wi-Fi', 'Network: n\nPassword: p'), entry('house', 'Alarm', 'Code 4821', { private: true }), entry('house', 'Thermostat')] },
        { id: 'routines', entries: [] },
      ],
      pets: [],
    };
    const quiet = manualParts(manual);
    expect(quiet.quirks.map((e: { title: string }) => e.title)).toEqual(['Thermostat']);
    expect(quiet.wifi).toEqual({ network: 'n', password: 'p' });
    expect(manualParts(manual, { includePrivate: true }).quirks.map((e: { title: string }) => e.title)).toEqual(['Alarm', 'Thermostat']);
  });

  it("finds the pets' feeding steps in their routines", () => {
    const routines = [
      { for_pet: 3, who: 'Biscuit', times: [{ name: 'Morning', at_words: '7:00 AM', steps: [{ words: 'Feed 1 cup', item: 'Dog food' }, { words: 'Walk', item: null }] }] },
      { for_pet: null, who: 'You', times: [{ name: 'Morning', steps: [{ words: 'Feed the cat', item: null }] }] },
    ];
    expect(feedingFrom(routines)).toEqual([{ pet: 'Biscuit', time: 'Morning', at: '7:00 AM', steps: ['Feed 1 cup (Dog food)'] }]);
  });

  it('shortens words and says when a panel left things out', () => {
    expect(shorten('one two three four five', 12)).toBe('one two…');
    expect(shorten('short', 12)).toBe('short');
    const { shown, cut } = fitList(['a', 'b', 'c', 'd', 'e', 'f'], 6, () => 2);
    expect(shown.length).toBeLessThan(6);
    expect(cut).toBe(true);
    expect(fitList(['a'], 6, () => 2)).toEqual({ shown: ['a'], cut: false });
  });
});
