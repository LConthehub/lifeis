import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cardClass } from './ui';

const small = 'min-h-[44px] rounded-xl border border-life-200 px-3 text-sm text-life-700 hover:bg-life-50 disabled:opacity-50 dark:border-life-700 dark:text-life-100 dark:hover:bg-life-800';

/**
 * A few quiet things not to forget, for the signed-in person. Shows nothing at all when there is nothing to say.
 * Done on a chore or job records it; on anything else it just puts the line away until it changes.
 */
export default function DontForget() {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get('/api/home/dont-forget').then(({ data }) => setLines(data)).catch(() => setLines([])); }, []);

  const put = async (line, action) => {
    setBusy(true);
    try {
      if (action === 'done' && line.job_id !== null) {
        await axios.post(`/api/things/upkeep/${line.job_id}/done`, {});
        const { data } = await axios.get('/api/home/dont-forget');
        setLines(data);
      } else {
        const { data } = await axios.post(`/api/home/dont-forget/${line.key}`, { action: action === 'done' ? 'notnow' : action });
        setLines(data);
      }
    } catch { /* the line stays; try again */ } finally { setBusy(false); }
  };

  if (lines.length === 0) return null;
  return (
    <section className={cardClass} data-card="dont-forget">
      <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Don't forget</h2>
      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={line.key} data-line={line.key}>
            <Link to={line.to} className="block min-h-[44px] py-2 text-sm text-life-800 hover:underline dark:text-life-50">{line.text}</Link>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => put(line, 'done')} className={small}>Done</button>
              <button type="button" disabled={busy} onClick={() => put(line, 'later')} className={small}>Later</button>
              <button type="button" disabled={busy} onClick={() => put(line, 'notnow')} className={small}>Not now</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
