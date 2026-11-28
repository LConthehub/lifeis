import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cardClass } from './ui';
import { ForgetSheet } from '../print/FilledSheets';
import { PrintMenu } from '../print/PrintFrame';

const small = 'inline-flex min-h-[44px] items-center text-sm text-life-600 underline disabled:opacity-50 dark:text-life-200';

/**
 * A few quiet things not to forget, for the signed-in person. Shows nothing at all when there is nothing to say.
 * Done on a chore or job records it; on anything else it just puts the line away until it changes.
 * `cards` is the Home cards on screen: what they already list is left out here.
 */
export default function DontForget({ cards = [] }) {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const shown = `?cards=${cards.join(',')}`;
  useEffect(() => { axios.get(`/api/home/dont-forget${shown}`).then(({ data }) => setLines(data)).catch(() => setLines([])); }, [shown]);

  const put = async (line, action) => {
    setBusy(true);
    try {
      if (action === 'done' && line.job_id !== null) {
        await axios.post(`/api/things/upkeep/${line.job_id}/done`, {});
        const { data } = await axios.get(`/api/home/dont-forget${shown}`);
        setLines(data);
      } else {
        const { data } = await axios.post(`/api/home/dont-forget/${line.key}${shown}`, { action: action === 'done' ? 'notnow' : action });
        setLines(data);
      }
    } catch { /* the line stays; try again */ } finally { setBusy(false); }
  };

  if (lines.length === 0) return null;
  return (
    <section className={cardClass} data-card="dont-forget">
      <h2 className="font-semibold text-life-800 dark:text-life-50">Don't forget</h2>
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line.key} data-line={line.key}>
            <Link to={line.to} className="flex min-h-[44px] items-center text-sm text-life-800 hover:underline dark:text-life-50">{line.text}</Link>
            <div className="-mt-2 flex flex-wrap gap-x-4">
              <button type="button" disabled={busy} onClick={() => put(line, 'done')} className={small}>Done</button>
              <button type="button" disabled={busy} onClick={() => put(line, 'later')} className={small}>Later</button>
              <button type="button" disabled={busy} onClick={() => put(line, 'notnow')} className={small}>Not now</button>
            </div>
          </li>
        ))}
      </ul>
      <PrintMenu ways={[['forget', "Print today's Don't forget"]]} onPrint={() => setTimeout(() => window.print(), 60)}>
        <p className="text-sm text-gray-600 dark:text-life-100">One letter page with these lines, a box beside each, and blank lines to write more.</p>
      </PrintMenu>
      <ForgetSheet lines={lines} />
    </section>
  );
}
