import { Fragment } from 'react';
import {
  Archive, Bell, ChefHat, Bird, BookOpen, Cake, CalendarDays, Camera, Car, Cat, Check, CircleHelp, Clapperboard, Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudRain,
  CloudSnow, CloudSun, CloudSunRain, CornerUpRight, Dog, FileText, Film, Fish, Flag, Gamepad2, Hammer, House, Hourglass, Image, Landmark, Link2, ListChecks,
  Lock, Mail, MapPin, Megaphone, MessageCircle, Music, Package, PackageCheck, Paperclip, PawPrint, PenLine, Phone, Pin, Plus, Rabbit, Receipt,
  Refrigerator, Repeat, Search, Settings, ShieldCheck, ShoppingCart, Siren, Smartphone, Sparkles, Sun, Tag, Thermometer, Ticket, Trophy, Truck, Tv,
  TriangleAlert, Utensils, Wrench,
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
  // Where, what is in the photo, and the tools
  place: MapPin, scan: Camera, photo: Image, assistant: MessageCircle, bank: Landmark, car: Car, phone: Smartphone, home: House,
  email: Mail, reminder: Bell, announce: Megaphone, tag: Tag, link: Link2, lock: Lock, data: Archive, search: Search,
  warning: TriangleAlert, unknown: CircleHelp, add: Plus, trophy: Trophy, attachment: Paperclip, flag: Flag, emergency: Siren,
  contacts: Phone, handwritten: PenLine, warranty: ShieldCheck, receipt: Receipt, paper: FileText, cart: ShoppingCart, moved: CornerUpRight,
  packed: PackageCheck, moving: Truck, dog: Dog, cat: Cat, rabbit: Rabbit, bird: Bird, fish: Fish,
  settings: Settings, recipe: ChefHat, weather: CloudSun,
  // Kinds of titles in the collection
  film: Film, show: Tv, music: Music, book: BookOpen, game: Gamepad2, other: Archive,
  // Weather, by what the server sends now (emoji from core/src/weather.ts)
  '☀️': Sun, '🌤': CloudSun, '⛅': CloudSun, '☁️': Cloud, '🌫': CloudFog, '🌦': CloudSunRain, '🌧': CloudRain, '🌨': CloudSnow, '⛈': CloudLightning,
  '🌡': Thermometer, drizzle: CloudDrizzle, hail: CloudHail,
};

/** True when there is an icon for this meaning. */
export const hasIcon = (meaning) => Object.prototype.hasOwnProperty.call(MEANINGS, meaning);

/** An icon when `of` is a meaning we have, otherwise the text as it is (an emoji a person typed, or one the server sent). */
export function Mark({ of, size, className }) {
  return hasIcon(of) ? <Icon of={of} size={size} className={className} /> : <span aria-hidden="true">{of}</span>;
}

/** Parts of a line, with a dot between them; empty parts are left out. Parts may hold icons. */
export function Dots({ parts }) {
  return parts.filter(Boolean).map((p, i) => <Fragment key={i}>{i > 0 && ' · '}{p}</Fragment>);
}

/** `<Icon of="birthday" />`. Size is in pixels (18 matches the text it sits beside); strokeWidth 1.75 matches regular text. */
export default function Icon({ of, size = 18, className = '' }) {
  const Shape = MEANINGS[of];
  if (!Shape) return null;
  return <Shape aria-hidden="true" focusable="false" size={size} strokeWidth={1.75} className={`inline-block shrink-0 align-[-0.15em] ${className}`} />;
}
