import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cardClass } from './ui';
import { WaterRow, dayWords } from './GardenBits';

const DOING = { sow: 'Sow', plant: 'Plant', prune: 'Prune', feed: 'Feed' };

/**
 * The garden on the front page: what to do this week (sow, plant, prune, feed), what needs water (one tap, and a
 * line saying so when rain already did it), and frost or heat coming. Shown only when gardening is checked in
 * "What Life Is looks after".
 */
export default function GardenCard() {
  const [card, setCard] = useState(null);
  const load = useCallback(() => { axios.get('/api/garden/card').then(({ data }) => setCard(data)).catch(() => setCard(false)); }, []);
  useEffect(() => { load(); }, [load]);
  if (!card) return null;
  const nothing = card.week.length === 0 && card.water.due.length === 0 && card.water.skipped.length === 0 && card.warnings.length === 0;
  return (
    <section className={cardClass} aria-label="Garden" data-card="garden">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Garden</h2>
        <Link to="/garden" className="text-xs text-life-600 hover:underline dark:text-life-200">Open →</Link>
      </div>
      <div className="space-y-3 text-sm">
        {card.warnings.length > 0 && (
          <ul className="space-y-1" aria-label="Weather warnings">
            {card.warnings.map((w) => <li key={`${w.kind}-${w.day}`} className="rounded-lg bg-honey-100 px-3 py-1.5 text-honey-700">{w.says}</li>)}
          </ul>
        )}
        {card.water.due.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">Needs water</h3>
            <ul className="mt-1 space-y-2">
              {card.water.due.map((p) => (
                <WaterRow key={p.id} plant={p} onWatered={load}><Link to={`/garden/${p.id}`} className="font-medium text-gray-800 hover:underline dark:text-life-50">{p.name}</Link></WaterRow>
              ))}
            </ul>
          </div>
        )}
        {card.water.skipped.length > 0 && (
          <div data-section="rain">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">Rain did it</h3>
            <ul className="mt-1 space-y-1">
              {card.water.skipped.map((p) => (
                <li key={p.id} className="text-gray-800 dark:text-life-50">{p.name}<span className="block text-xs text-gray-600 dark:text-life-200">{p.water.rain.says}. Next watering {dayWords(p.water.due_on)}.</span></li>
              ))}
            </ul>
          </div>
        )}
        {card.week.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">This week</h3>
            <ul className="mt-1 space-y-1">
              {card.week.map((t) => (
                <li key={`${t.do}-${t.what}-${t.plant_id ?? 'seed'}`}>
                  <Link to={t.link ?? '/garden'} className="flex min-h-[44px] items-center gap-2 hover:underline sm:min-h-0">
                    <span className="w-14 flex-none text-xs font-medium uppercase text-life-600 dark:text-life-300">{DOING[t.do]}</span>
                    <span className="min-w-0 flex-1 text-gray-800 dark:text-life-50">{t.what}{t.seed ? ' (seed packet)' : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!card.frost.last_spring && !card.frost.first_fall && (
          <p className="text-gray-600 dark:text-life-200">Add your frost dates to see what to sow and plant each week. <Link to="/garden" className="underline">Set them</Link></p>
        )}
        {nothing && (card.frost.last_spring || card.frost.first_fall) && <p className="text-gray-500 dark:text-life-300">Nothing to do in the garden this week.</p>}
      </div>
    </section>
  );
}
