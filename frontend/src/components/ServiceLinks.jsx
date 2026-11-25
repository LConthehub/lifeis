import Icon, { hasIcon } from './Icon';

/** The icons a link can wear, with the word each is picked by. They are the app's own icon set (Icon.jsx). */
export const ICON_WORDS = {
  link: 'Link', media: 'Media', film: 'Films', show: 'Shows', music: 'Music', book: 'Books', game: 'Games', photo: 'Photos', home: 'Home', email: 'Mail', data: 'Files',
  paper: 'Papers', phone: 'Phone', settings: 'Settings', bank: 'Money', cart: 'Shopping', assistant: 'Assistant', weather: 'Weather', recipe: 'Cooking', thing: 'Things',
  scan: 'Camera', car: 'Car', pet: 'Pets',
};

/** The colors a link can wear, from the app's palette: a plain square behind the icon. Gold gets dark ink so the icon reads. */
export const COLOR_CLASSES = {
  brown: 'bg-life-500 text-white',
  plum: 'bg-plum-500 text-white',
  green: 'bg-avocado-600 text-white',
  rust: 'bg-honey-700 text-white',
  orange: 'bg-coral text-life-900',
  gold: 'bg-honey-400 text-life-900',
};
export const COLOR_WORDS = { brown: 'Brown', plum: 'Plum', green: 'Green', rust: 'Rust', orange: 'Orange', gold: 'Gold' };

export function Badge({ icon, color, size = 'h-11 w-11' }) {
  return (
    <span className={`flex ${size} flex-none items-center justify-center rounded-xl ${COLOR_CLASSES[color] ?? COLOR_CLASSES.brown}`} aria-hidden="true">
      <Icon of={hasIcon(icon) ? icon : 'link'} size={22} />
    </span>
  );
}

const linkClass = 'flex min-h-[44px] items-center justify-center rounded-xl border border-life-200 px-3 py-1.5 text-sm font-medium text-life-700 hover:bg-life-50 dark:border-life-700 dark:text-life-100 dark:hover:bg-life-700';

/**
 * The buttons that open a link. One address: one button. Two: one for at home and one for away. They open in a new tab
 * (in the phone app, the phone's own browser). Nothing is fetched from the address: it is only opened when the button is tapped.
 */
export function Open({ service }) {
  const both = service.address2 ? [[service.address_at, service.address], [service.address2_at, service.address2]] : [[service.address_at, service.address]];
  const word = (at) => (service.address2 ? (at === 'home' ? 'At home' : 'Away') : at === 'home' ? 'Open (works at home)' : at === 'away' ? 'Open (away)' : 'Open');
  return (
    <span className="flex flex-wrap gap-2">
      {both.map(([at, address]) => (
        <a key={address} href={address} target="_blank" rel="noopener noreferrer" aria-label={`${word(at)}: ${service.name}`} className={`${linkClass} ${service.address2 ? 'min-w-[88px]' : ''}`}>{word(at)}</a>
      ))}
    </span>
  );
}

/** Links with a group name are shown under it, in the order the person put them; the ones with no group come first. */
export function inGroups(services) {
  const names = [...new Set(services.map((s) => s.group ?? ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
  return names.map((name) => ({ name, services: services.filter((s) => (s.group ?? '') === name) }));
}
