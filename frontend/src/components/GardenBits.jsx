import { useState } from 'react';
import axios from 'axios';
import { fromDateInput, errorMessage } from './ui';

/** "Thu, Mar 7". */
export const dayWords = (day) => fromDateInput(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** What a plant's watering says in words: when it is next due, or that it is late, or why it isn't needed. */
export function waterWords(water) {
  if (!water) return 'Not watered by hand';
  if (water.due) return water.days_late > 0 ? `Water now: ${water.days_late} ${water.days_late === 1 ? 'day' : 'days'} late` : 'Water today';
  return `Next watering ${dayWords(water.due_on)}`;
}

/**
 * One plant with its watering: one tap marks it done. When the plant is a child's chore the tap goes to them and
 * earns the points; "Someone else" is for when a grown-up did it. Rain that counted is said right under it.
 */
export function WaterRow({ plant, onWatered, children }) {
  const [by, setBy] = useState(plant.member ? String(plant.member.id) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const water = plant.water;
  const done = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await axios.post(`/api/garden/plants/${plant.id}/water`, by ? { by_member: Number(by) } : {});
      onWatered?.(data);
    } catch (err) { setError(errorMessage(err, "Couldn't mark that as done")); }
    setBusy(false);
  };
  return (
    <li className="flex flex-wrap items-center gap-2" data-plant={plant.name}>
      <div className="min-w-0 flex-1">
        {children}
        <span className="block text-xs text-gray-600 dark:text-life-200">{plant.place ? `${plant.place} · ` : ''}{waterWords(water)}</span>
        {water?.rain && <span className="block text-xs text-life-700 dark:text-life-200" data-rain>{water.skipped_for_rain ? `Not needed yet. ${water.rain.says}` : water.rain.says}</span>}
        {error && <span className="block text-xs text-red-600">{error}</span>}
      </div>
      {plant.member && (
        <select value={by} onChange={(e) => setBy(e.target.value)} aria-label={`Who watered ${plant.name}`} className="min-h-[44px] rounded-xl border border-life-200 bg-card px-2 text-sm dark:border-life-700 dark:bg-life-800">
          <option value={plant.member.id}>{plant.member.name}{plant.points ? ` (${plant.points} points)` : ''}</option>
          <option value="">Someone else</option>
        </select>
      )}
      {water && <button type="button" disabled={busy} onClick={done} aria-label={`Done: water ${plant.name}`} className="min-h-[44px] min-w-[64px] rounded-full bg-gradient-to-br from-life-500 to-life-700 px-4 text-sm font-semibold text-white shadow-md hover:from-life-600 hover:to-life-800 disabled:opacity-50">Done</button>}
    </li>
  );
}
