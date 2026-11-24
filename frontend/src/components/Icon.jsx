import {
  Archive, BookOpen, Cake, CalendarDays, Check, Clapperboard, Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudRain,
  CloudSnow, CloudSun, CloudSunRain, Film, Gamepad2, Hammer, Hourglass, ListChecks, Music, Package, PawPrint, Pin, Receipt,
  Refrigerator, Repeat, Sparkles, Sun, Thermometer, Ticket, Tv, Utensils, Wrench,
} from 'lucide-react';

/**
 * Small single-color icons from Lucide (ISC license, drawn by people), in place of emoji.
 * Each meaning Life Is uses maps to one Lucide icon by name; nothing here is drawn by us.
 * The icon takes the text color around it and is hidden from screen readers: the words next to it say what it is.
 * Emoji that people type in their own titles and notes are not touched; this is only for ones the pages choose.
 */
const MEANINGS = {
  // What a day on the calendar can hold
  event: Pin, outside: CalendarDays, date: CalendarDays, meal: Utensils, session: Hammer, due: Hourglass, upkeep: Wrench,
  use_by: Refrigerator, media: Clapperboard, plan: Sparkles,
  // Other meanings the pages share
  birthday: Cake, bill: Receipt, renewal: Repeat, chore: Wrench, project: Hammer, thing: Package, pet: PawPrint,
  title: Clapperboard, routine: ListChecks, coupon: Ticket, done: Check,
  // Kinds of titles in the collection
  film: Film, show: Tv, music: Music, book: BookOpen, game: Gamepad2, other: Archive,
  // Weather, by what the server sends now (emoji from core/src/weather.ts)
  '☀️': Sun, '🌤': CloudSun, '⛅': CloudSun, '☁️': Cloud, '🌫': CloudFog, '🌦': CloudSunRain, '🌧': CloudRain, '🌨': CloudSnow, '⛈': CloudLightning,
  '🌡': Thermometer, drizzle: CloudDrizzle, hail: CloudHail,
};

/** True when there is an icon for this meaning. */
export const hasIcon = (meaning) => Object.prototype.hasOwnProperty.call(MEANINGS, meaning);

/** `<Icon of="birthday" />`. Size is in pixels (18 matches the text it sits beside); strokeWidth 1.75 matches regular text. */
export default function Icon({ of, size = 18, className = '' }) {
  const Shape = MEANINGS[of];
  if (!Shape) return null;
  return <Shape aria-hidden="true" focusable="false" size={size} strokeWidth={1.75} className={`inline-block shrink-0 align-[-0.15em] ${className}`} />;
}
