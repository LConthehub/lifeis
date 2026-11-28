import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { buttonClass, cardClass } from '../components/ui';
import PrintFrame, { PrintStyleChoice } from '../print/PrintFrame';
import { LOCK_RULE, dayText, momentText } from './IncidentLog';

/**
 * The whole incident log as one record on letter paper, oldest first, each entry with when it was written and each thing
 * added to it with when that was written. It is made here on this person's own Life Is and goes nowhere unless they send it.
 */
const PRINT_RULES = `
@media print {
  @page { size: letter; margin: 0.6in; }
  .log-sheet { color: #000 !important; background: #fff !important; box-shadow: none !important; border-radius: 0 !important; font-size: 10.5pt; padding: 0 !important; }
  .log-entry { break-inside: avoid-page; page-break-inside: avoid; }
  .log-entry h3 { break-after: avoid; page-break-after: avoid; }
}`;

export default function IncidentPrintPage() {
  const [list, setList] = useState(null);
  useEffect(() => { axios.get('/api/incidents').then(({ data }) => setList(data)).catch(() => setList([])); }, []);
  if (list === null) return null;
  const none = list.length === 0;
  return (
    <div className="space-y-4">
      <style>{PRINT_RULES}</style>
      <div className="space-y-3 print:hidden">
        <Link to="/incident-log" className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">← Incident log</Link>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Print or save the whole log</h1>
        <p className="text-sm text-gray-600 dark:text-life-100">The whole log as one record on letter paper, the oldest entry first. Each entry shows when it was written, and each addition shows when it was added. It is made here on your own Life Is and goes nowhere unless you send it.</p>
        <section className={`${cardClass} space-y-3`}>
          <PrintStyleChoice />
          <button type="button" disabled={none} onClick={() => window.print()} className={`${buttonClass} min-h-[44px]`}>Print or save as PDF</button>
        </section>
      </div>
      <PrintFrame phrase="Life is in order" title="Incident log" className="log-sheet space-y-4 rounded-xl bg-card p-4 text-black print:bg-white sm:p-6" aria-label="The incident log">
        <header className="space-y-1">
          <p className="text-sm text-gray-700">Kept privately in Life Is. {list.length === 1 ? '1 entry' : `${list.length} entries`}. Made on {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
          <p className="text-xs text-gray-700">{LOCK_RULE}</p>
        </header>
        {none && <p className="text-sm text-gray-600">No entries yet.</p>}
        {list.map((x, n) => (
          <section key={x.id} className="log-entry space-y-1.5 border-t-2 border-gray-800 pt-2" data-print-entry>
            <h3 className="font-semibold">{n + 1}. {dayText(x.happened_on)}{x.happened_time ? `, ${x.happened_time}` : ''}</h3>
            <p className="text-xs text-gray-700">Written {momentText(x.written_at)}</p>
            <p className="whitespace-pre-wrap break-words text-sm"><span className="font-semibold">What happened: </span>{x.what}</p>
            {x.who && <p className="whitespace-pre-wrap break-words text-sm"><span className="font-semibold">Who was there: </span>{x.who}</p>}
            {x.kept && <p className="whitespace-pre-wrap break-words text-sm"><span className="font-semibold">What was kept: </span>{x.kept}</p>}
            {x.additions.map((a) => (
              <p key={a.id} className="whitespace-pre-wrap break-words border-l-2 border-gray-500 pl-3 text-sm"><span className="font-semibold">Added {momentText(a.written_at)}: </span>{a.words}</p>
            ))}
          </section>
        ))}
      </PrintFrame>
    </div>
  );
}
