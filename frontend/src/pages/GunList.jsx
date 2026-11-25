import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { money } from '../components/Records';
import { goneText } from './Things';
import { csvText } from './CollectionPrint';
import { buttonClass, cardClass, quietButtonClass, errorMessage } from '../components/ui';

const control = 'min-h-[44px]';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Black on white for the page, a gun's block never cut in two, serial numbers in a plain monospace face.
const PRINT_RULES = `
.gun-sheet .serial { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.gun-sheet dd, .gun-sheet dt { overflow-wrap: anywhere; }
@media print {
  @page { margin: 0.6in; }
  .gun-sheet { color: #000 !important; background: #fff !important; box-shadow: none !important; border-radius: 0 !important; font-size: 10pt; padding: 0 !important; }
  .gun-sheet article { break-inside: avoid; page-break-inside: avoid; }
  .gun-sheet h3 { break-after: avoid; page-break-after: avoid; }
}`;

const FIELDS = (g, serials) => [
  ['Type', g.type], ['Maker', g.maker], ['Model', g.model], ['Caliber or gauge', g.caliber], serials && ['Serial number', g.serial, true],
  ['Bought', [g.bought_on && dayText(g.bought_on), g.bought_at && `from ${g.bought_at}`].filter(Boolean).join(' ')], ['Paid', g.price_cents != null ? money(g.price_cents) : ''],
  ['Kept in', g.place], ['Receipt', g.receipt ? 'Kept in Life Is' : ''], ['Asset number', g.asset_no], ['Notes', g.note],
].filter((row) => row && row[1]);

/**
 * The person's own guns as a plain list with serial numbers and photos: for an insurer or a police report. It shows only
 * guns kept by this person, the ones they no longer have last. It is made here, on your own Life Is, and goes nowhere unless you send it.
 */
export default function GunList() {
  const [guns, setGuns] = useState(null);
  const [serials, setSerials] = useState(true);
  const [photos, setPhotos] = useState(true);
  const [gone, setGone] = useState(true);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { axios.get('/api/things/guns').then(({ data }) => setGuns(data)).catch(() => setGuns(false)); }, []);
  if (guns === null) return null;
  if (guns === false) return <p className="text-sm text-gray-600 dark:text-life-200">The list couldn't be made just now.</p>;

  const here = guns.filter((g) => !g.gone);
  const away = gone ? guns.filter((g) => g.gone) : [];
  const none = here.length + away.length === 0;

  const save = async () => {
    setProblem(''); setSaving(true);
    try {
      const rows = [['Name', 'Type', 'Maker', 'Model', 'Caliber or gauge', ...(serials ? ['Serial number'] : []), 'Bought on', 'Bought from', 'Paid', 'Kept in', 'Asset number', 'Notes', 'No longer have it']];
      for (const g of [...here, ...away]) {
        rows.push([g.name, g.type ?? '', g.maker ?? '', g.model ?? '', g.caliber ?? '', ...(serials ? [g.serial ?? ''] : []), g.bought_on ?? '', g.bought_at ?? '',
          g.price_cents != null ? (g.price_cents / 100).toFixed(2) : '', g.place ?? '', g.asset_no, g.note ?? '', g.gone ? goneText(g.gone) : '']);
      }
      const { handOver } = await import('../device/handOver.js');
      await handOver(new TextEncoder().encode(csvText(rows)), `guns-${today()}.csv`);
    } catch (err) { setProblem(errorMessage(err, "The spreadsheet couldn't be made just now")); }
    setSaving(false);
  };

  const block = (g) => (
    <article key={g.id} className="flex gap-3 border-t border-gray-300 py-3" data-gun>
      {photos && g.photo && <Picture src={`/api/things/items/${g.id}/photo`} alt={`Photo of ${g.name}`} className="h-24 w-24 shrink-0 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{g.name}</h3>
        {g.gone && <p className="text-sm font-medium" data-gone>No longer have it: {goneText(g.gone)}</p>}
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
          {FIELDS(g, serials).map(([label, value, mono]) => (
            <div key={label} className="contents"><dt className="text-xs font-medium text-gray-700">{label}</dt><dd className={mono ? 'serial' : ''}>{value}</dd></div>
          ))}
        </dl>
      </div>
    </article>
  );

  return (
    <div className="space-y-4">
      <style>{PRINT_RULES}</style>
      <div className="space-y-3 print:hidden">
        <Link to="/things" className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">← Things</Link>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">List of guns</h1>
        <p className="text-sm text-gray-600 dark:text-life-100">
          Your own guns with their serial numbers and photos, for an insurer or a police report. Guns other people shared with you are not on it.
          The list is made here on your own Life Is and goes nowhere unless you send it. It is not part of the home inventory.
        </p>
        <section className={`${cardClass} space-y-1`} aria-label="What goes in the list">
          <h2 className="font-semibold text-life-800 dark:text-life-50">Choose what goes in it</h2>
          {[[serials, setSerials, 'Serial numbers'], [photos, setPhotos, 'Photos'], [gone, setGone, 'Guns you no longer have (sold, given away or stolen)']].map(([on, set, label]) => (
            <label key={label} className={`flex ${control} items-center gap-2 text-sm text-gray-800 dark:text-life-50`}>
              <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-5 w-5 flex-none accent-life-600" /> {label}
            </label>
          ))}
          <p className="text-xs text-gray-600 dark:text-life-200" role="status">{none ? 'No guns are kept yet.' : `${plural(here.length, 'gun', 'guns')} here${away.length ? `, ${away.length} no longer yours` : ''}.`}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={none} onClick={() => window.print()} className={`${buttonClass} ${control}`}>Print or save as PDF</button>
            <button type="button" disabled={none || saving} onClick={save} className={`${quietButtonClass} ${control}`}>{saving ? 'Making it…' : 'Save as spreadsheet'}</button>
          </div>
          {problem && <p className="text-sm text-red-600" role="alert">{problem}</p>}
        </section>
      </div>

      <div className="gun-sheet space-y-3 rounded-xl bg-card p-4 text-black print:bg-white sm:p-6" aria-label="The list">
        <header>
          <h2 className="text-lg font-bold">List of guns</h2>
          <p className="text-sm text-gray-700">Made on {dayText(today())}</p>
          <p className="text-sm" data-totals>{plural(here.length, 'gun', 'guns')}{away.length ? ` here · ${away.length} no longer owned` : ''}</p>
        </header>
        {none && <p className="text-sm text-gray-600">No guns are kept yet. Add the Hunting and shooting set under Things, then add each gun.</p>}
        {here.map(block)}
        {away.length > 0 && <h2 className="border-b-2 border-gray-800 pt-2 font-semibold">No longer owned</h2>}
        {away.map(block)}
      </div>
    </div>
  );
}
