/**
 * How long ago a day was, in words: "today", "yesterday", "6 days ago", "3 weeks ago", "2 months ago",
 * "over a year ago". `day` and `today` are 'YYYY-MM-DD'. A day that has not come yet reads "today".
 */
const dayNumber = (day) => { const [y, m, d] = day.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

export function agoText(day, today) {
  const days = dayNumber(today) - dayNumber(day);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 13) return `${days} days ago`;
  if (days < 63) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30.4375)} months ago`;
  return 'over a year ago';
}

/** "Last done 6 days ago", or "Not done yet". */
export const lastDoneText = (day, today) => (day ? `Last done ${agoText(day, today)}` : 'Not done yet');

/** Today as the person's own clock has it, 'YYYY-MM-DD'. */
export function todayHere() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
