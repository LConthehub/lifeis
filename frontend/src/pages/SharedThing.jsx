import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { Serial, money } from '../components/Records';
import { cardClass } from '../components/ui';
import { goneText } from './Things';

const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A gun or ammunition someone else keeps and chose to share with this person: to look at, never to change. */
export default function SharedThing() {
  const { id } = useParams();
  const [t, setT] = useState(undefined);
  useEffect(() => { axios.get(`/api/things/shared/${id}`).then(({ data }) => setT(data)).catch(() => setT(null)); }, [id]);
  if (t === undefined) return null;
  if (t === null) return <Navigate to="/things" replace />;
  const r = t.records;
  const rows = [
    ...t.fields.map((f) => [f.name, f.value]), ['Model', r.model], ['Serial number', r.serial ? <Serial key="s" value={r.serial} /> : ''],
    ['Bought', [r.bought_on && dayText(r.bought_on), r.bought_at && `from ${r.bought_at}`].filter(Boolean).join(' ')], ['Paid', r.price_cents != null ? money(r.price_cents) : ''],
    ['Kept in', t.place],
  ].filter(([, v]) => v);
  return (
    <div className="space-y-4">
      <Link to="/things" className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">← Things</Link>
      <section className={`${cardClass} space-y-3`}>
        {t.photo && <Picture src={`/api/things/shared/${t.id}/photo`} alt={t.name} className="max-h-80 w-full rounded-xl object-contain" />}
        <div>
          <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">{t.name}</h1>
          <p className="text-xs text-gray-500 dark:text-life-300">{[t.icon && `${t.icon} ${t.kind}`, t.amount !== 'some' && t.amount].filter(Boolean).join(' · ') || t.kind}</p>
        </div>
        <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-700 dark:bg-life-700 dark:text-life-50" data-shared-note>{t.owner} shared this with you. You can look at it, but not change it.</p>
        {t.gone && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700" data-gone>No longer have it: {goneText(t.gone)}</p>}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents"><dt className="text-xs text-gray-500 dark:text-life-300">{label}</dt><dd className="break-words text-gray-800 dark:text-life-50">{value}</dd></div>
          ))}
        </dl>
        {t.note && <p className="whitespace-pre-line text-sm text-gray-700 dark:text-life-100">{t.note}</p>}
      </section>
    </div>
  );
}
