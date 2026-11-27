import { Link, useLocation } from 'react-router-dom';

/**
 * A row of chips at the top of a page that holds more than one part (Routines and Measures, Plans with its
 * Holidays and Trips). Each chip is a link, so every part keeps its own address and the back button works.
 * `items` is [[address, label], ...]; the one whose address is the page now open shows as chosen.
 */
export default function SubChips({ items, label }) {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-wrap gap-1.5 print:hidden" aria-label={label}>
      {items.map(([to, text]) => {
        const on = pathname === to;
        return (
          <Link key={to} to={to} aria-current={on ? 'page' : undefined}
            className={`flex min-h-[44px] items-center rounded-full px-4 py-2 text-sm ${on ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`}>{text}</Link>
        );
      })}
    </nav>
  );
}

export const ROUTINE_CHIPS = [['/routines', 'Routines'], ['/measures', 'Measures']];
export const PLAN_CHIPS = [['/plans', 'All'], ['/plans/holidays', 'Holidays'], ['/plans/trips', 'Trips']];
export const MANUAL_CHIPS = [['/manual', 'Manual'], ['/manual/services', 'Home lab']];
export const THING_CHIPS = [['/things', 'Things'], ['/things/licenses', 'Licenses']];
