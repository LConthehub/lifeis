/**
 * Timers in the cooking view. Only the reading of a step's words lives here: "simmer 12 minutes" is 12, "25 to 30
 * min" is 30 (the longer), "1 1/2 hours" is 90. A step that names no time gives null. The timers themselves run on
 * the server (server/src/cookTimers.ts), and nothing is saved in the database.
 */

/** The longest a timer may run: a day. */
export const MOST_TIMER_MINUTES = 1440;

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90,
};
const WORD = Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|');
const NUMBER = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?\s?[½¼¾]?|[½¼¾]|${WORD})`;
const UNIT = String.raw`(hours?|hrs?|minutes?|mins?)`;
const AMOUNT = new RegExp(String.raw`(?<![\w/.])(${NUMBER})(?:\s*(?:-|–|to|or)\s*(${NUMBER}))?\s*-?\s*${UNIT}(?![a-z])`, 'i');
const MORE = new RegExp(String.raw`^\s*(?:,|and)?\s*(${NUMBER})\s*-?\s*(minutes?|mins?)(?![a-z])`, 'i');

function valueOf(token: string): number {
  const t = token.trim().toLowerCase();
  if (t in WORDS) return WORDS[t]!;
  const glyph: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
  let total = 0;
  let rest = t;
  const g = /([½¼¾])$/.exec(rest);
  if (g) { total += glyph[g[1]!]!; rest = rest.slice(0, -1).trim(); }
  if (!rest) return total;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(rest);
  if (mixed) return total + Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(rest);
  if (fraction) return total + Number(fraction[1]) / Number(fraction[2]);
  return total + Number(rest);
}

/**
 * The minutes a step says to wait, or null when it names no time (or one that makes no sense, like 0 or more than
 * a day). The first time named is the one used; a range gives its longer end; "1 hour 15 minutes" is added up.
 */
export function minutesInStep(text: string): number | null {
  const words = String(text ?? '');
  const half = /\bhalf an hour\b/i.exec(words);
  const found = AMOUNT.exec(words);
  let minutes: number | null = null;
  if (found && (!half || found.index < half.index)) {
    const per = /^h/i.test(found[3]!) ? 60 : 1;
    const longer = Math.max(valueOf(found[1]!), found[2] ? valueOf(found[2]) : 0);
    minutes = longer * per;
    if (per === 60) {
      const more = MORE.exec(words.slice(found.index + found[0].length));
      if (more) minutes += valueOf(more[1]!);
    }
  } else if (half) minutes = 30;
  else {
    const one = /\b(?:an|one) hour\b/i.test(words) ? 60 : /\ba minute\b/i.test(words) ? 1 : null;
    minutes = one;
  }
  if (minutes === null || !Number.isFinite(minutes)) return null;
  const whole = Math.round(minutes);
  return whole >= 1 && whole <= MOST_TIMER_MINUTES ? whole : null;
}

/** A short name for a step on a timer: its first few words, "Simmer the sauce until it". */
export function timerName(step: string): string {
  const one = String(step ?? '').replace(/\s+/g, ' ').trim().replace(/[.!:;,\s]+$/, '');
  if (!one) return 'Timer';
  if (one.length <= 40) return one;
  const cut = one.slice(0, 40);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20))}...`;
}
