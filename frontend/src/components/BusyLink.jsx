import { useEffect, useState } from 'react';
import axios from 'axios';
import CopyButton from './Copy';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { serverOrigin } from '../where';

const touch = 'min-h-[44px]';

/** Words for a day like 2046-03-12: "Mar 12, 2046". */
function dayWords(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A link to give someone who is planning around the household. The page behind it shows blocks of busy and
 * free time for the next four weeks, and nothing else. Off until the person makes one; it ends on a day they
 * choose, and can be ended at any time.
 */
export default function BusyLink() {
  const [link, setLink] = useState(null);
  const [days, setDays] = useState('14');
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/api/busy/link').then(({ data }) => setLink(data)).catch(() => {}); }, []);
  if (!link) return null;
  const ask = async (send, failed) => {
    setError('');
    try { setLink((await send()).data); } catch (err) { setError(errorMessage(err, failed)); }
  };
  const address = link.on ? `${serverOrigin()}/b/${link.token}` : '';
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Busy times sharing">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">A link to your busy times</h2>
        <span className={`rounded px-1.5 text-[11px] ${link.on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{link.on ? 'On' : 'Off'}</span>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100">
        For someone planning around you. The page shows blocks of busy and free time for the next four weeks, taken from your calendar. It never shows titles, names, places, notes or what kind of thing it is, and it does not say one busy block from another. They need no sign-in and can't change anything.
      </p>
      {link.on ? (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">This link works until {dayWords(link.expires_on)}. Turn it off sooner any time.</p>
          <input readOnly value={address} aria-label="The busy times link" onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-xs`} />
          <div className="flex flex-wrap gap-2">
            <CopyButton text={address} what="the busy times link" label="Copy the link" />
            <a href={address} target="_blank" rel="noreferrer" className={`${quietButtonClass} ${touch} inline-flex items-center`}>See what they'll see</a>
            <button type="button" onClick={() => ask(() => axios.delete('/api/busy/link'), "Couldn't turn it off")} className={`${quietButtonClass} ${touch}`}>Turn it off</button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2 text-sm text-gray-700 dark:text-life-100">
          <Field label="It works for">
            <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="How long the link works" className={`${inputClass} ${touch} !w-auto`}>
              <option value="1">a day</option><option value="3">3 days</option><option value="7">a week</option><option value="14">2 weeks</option><option value="30">a month</option><option value="90">3 months</option>
            </select>
          </Field>
          <button type="button" onClick={() => ask(() => axios.put('/api/busy/link', { days: Number(days) }), "Couldn't make the link")} className={`${buttonClass} ${touch}`}>Make the link</button>
        </div>
      )}
      <label className={`flex ${touch} items-center gap-2 text-sm text-gray-700 dark:text-life-100`}>
        <input type="checkbox" checked={link.credit} onChange={(e) => ask(() => axios.put('/api/busy/credit', { on: e.target.checked }), "Couldn't save that")} className="accent-life-600" /> Show 'Made with Life Is' on the shared page
      </label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </section>
  );
}
