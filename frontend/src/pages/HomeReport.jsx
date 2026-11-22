import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { money } from '../components/Records';
import { buttonClass, cardClass, quietButtonClass, errorMessage } from '../components/ui';

const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Dollars as typed ("1,200", "$50.5") to whole cents; null when nothing is typed, NaN when it is not an amount. */
const centsOf = (text) => {
  const t = String(text).replace(/[$,\s]/g, '');
  if (t === '') return null;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Math.round(Number(t) * 100) : Number.NaN;
};

// What printing needs that the screen does not: each room can start a page, a table's headings come round again
// on every page, and a thing's row (with its photo) is never cut in two. Black on white, whatever the screen's colours.
const PRINT_RULES = `
.report-sheet table { border-collapse: collapse; width: 100%; }
.report-sheet th, .report-sheet td { overflow-wrap: anywhere; }
.report-sheet .serial { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media print {
  @page { margin: 0.6in; }
  .report-sheet { color: #000 !important; background: #fff !important; box-shadow: none !important; border-radius: 0 !important; font-size: 10pt; }
  .report-sheet a { color: #000 !important; text-decoration: none !important; }
  .report-sheet thead { display: table-header-group; }
  .report-sheet tr { break-inside: avoid; page-break-inside: avoid; }
  .report-sheet h3 { break-after: avoid; page-break-after: avoid; }
  .report-sheet.one-room-per-page .report-room + .report-room { break-before: page; page-break-before: always; }
}`;

/**
 * The home inventory: everything kept, room by room, with what each thing is, its make and model, serial number,
 * when and where it was bought, what it cost and is worth now, and a photo. What an insurer's claims adjuster asks
 * for after a fire, a flood or a theft. It is made here, on your own Life Is, and goes nowhere unless you send it.
 */
export default function HomeReport() {
  const [report, setReport] = useState(null);
  const [picked, setPicked] = useState(null);          // null: all rooms; else a list of room ids (0 is "no place yet")
  const [minText, setMinText] = useState('');
  const [withUnvalued, setWithUnvalued] = useState(true);
  const [photos, setPhotos] = useState(true);
  const [perPage, setPerPage] = useState(false);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const minCents = centsOf(minText);
  const minBad = Number.isNaN(minCents);
  const query = useMemo(() => {
    const params = {};
    if (picked) params.rooms = picked.join(',');
    if (minCents) params.min_cents = String(minCents);
    if (!withUnvalued) params.unvalued = '0';
    return params;
  }, [picked, minCents, withUnvalued]);

  useEffect(() => {
    if (minBad) return undefined;
    let wanted = true;
    const wait = setTimeout(() => {
      axios.get('/api/things/report', { params: query }).then(({ data }) => { if (wanted) setReport(data); }).catch(() => { if (wanted) setReport((was) => was ?? false); });
    }, report ? 250 : 0);
    return () => { wanted = false; clearTimeout(wait); };
  }, [query, minBad]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    setProblem(''); setSaving(true);
    try {
      const { data, headers } = await axios.get('/api/things/report.csv', { params: query, responseType: 'arraybuffer' });
      const name = /filename="([^"]+)"/.exec(headers['content-disposition'] ?? '')?.[1] ?? `home-inventory-${report.day}.csv`;
      const { handOver } = await import('../device/handOver.js');
      await handOver(new Uint8Array(data), name);
    } catch (err) { setProblem(errorMessage(err, "The spreadsheet couldn't be made just now")); }
    setSaving(false);
  };

  if (report === null) return null;
  if (report === false) return <p className="text-sm text-gray-600 dark:text-life-200">The inventory couldn't be made just now.</p>;
  const choiceName = (id) => report.choices.find((c) => c.id === id)?.name;
  const filtered = picked !== null || Boolean(minCents) || !withUnvalued;
  const toggleRoom = (id) => setPicked((list) => { const has = list.includes(id); return has ? list.filter((x) => x !== id) : [...list, id]; });
  const nothing = report.things === 0;
  const atCost = report.rooms.reduce((n, r) => n + r.at_cost, 0);

  return (
    <div className="space-y-4">
      <style>{PRINT_RULES}</style>
      <div className="space-y-3 print:hidden">
        <Link to="/things" className="text-sm text-life-600 hover:underline dark:text-life-200">← Things</Link>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Home inventory</h1>
        <p className="text-sm text-gray-600 dark:text-life-100">
          What an insurer asks for after a fire, a flood or a theft: what you had, what it was worth, and proof. Keep a printed or saved copy somewhere other than home.
          This report and the spreadsheet are made on your own Life Is and go nowhere unless you send them.
          {report.things > 0 && report.unvalued > 0 && <> {report.unvalued} of your {report.things} things {report.unvalued === 1 ? 'has' : 'have'} no price or value yet; open one and add its records.</>}
        </p>

        {!nothing && (
          <section className={`${cardClass} space-y-2`} aria-label="Readiness">
            <h2 className="font-semibold text-life-800 dark:text-life-50">How ready is it?</h2>
            <p className="text-sm text-gray-800 dark:text-life-50" data-ready>
              Of {plural(report.things, 'thing', 'things')}: {report.valued} {report.valued === 1 ? 'has' : 'have'} a value, {report.with_photo} {report.with_photo === 1 ? 'has' : 'have'} a photo, {report.with_serial} {report.with_serial === 1 ? 'has' : 'have'} a serial number.
            </p>
            {report.neediest
              ? <Link to={`/things/places/${report.neediest.id}/walk`} className={`${buttonClass} inline-flex min-h-11 items-center`}>Walk through {report.neediest.name}: most is missing there</Link>
              : <p className="text-sm text-life-700 dark:text-life-200">Every room has a photo, a value and a serial number for everything in it.</p>}
          </section>
        )}

        {report.warranties.length > 0 && (
          <section className={cardClass} aria-label="Warranties ending soon">
            <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Warranties ending soon</h2>
            <ul className="space-y-0.5 text-sm">
              {report.warranties.map((w) => <li key={w.id}><Link to={`/things/${w.id}`} className="text-gray-800 hover:underline dark:text-life-50">{w.name}</Link> <span className="text-xs text-honey-700">{w.days_left === 0 ? 'today' : `in ${w.days_left} days`}</span></li>)}
            </ul>
          </section>
        )}

        {!nothing && (
          <section className={`${cardClass} space-y-3`} aria-label="What goes in the report">
            <h2 className="font-semibold text-life-800 dark:text-life-50">Choose what goes in it</h2>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Rooms</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-life-50"><input type="radio" name="rooms" checked={picked === null} onChange={() => setPicked(null)} className="h-4 w-4 accent-life-600" /> All rooms</label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-life-50"><input type="radio" name="rooms" checked={picked !== null} onChange={() => setPicked((list) => list ?? report.choices.map((c) => c.id))} className="h-4 w-4 accent-life-600" /> Only the rooms I choose</label>
              {picked !== null && (
                <ul className="grid gap-x-4 sm:grid-cols-2" aria-label="Rooms to include">
                  {report.choices.map((c) => (
                    <li key={c.id}><label className="flex min-h-11 items-center gap-2 pl-6 text-sm text-gray-800 dark:text-life-50">
                      <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggleRoom(c.id)} className="h-4 w-4 accent-life-600" /> {c.name} <span className="text-xs text-gray-500 dark:text-life-300">{c.things}</span>
                    </label></li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <label className="block space-y-1 text-xs font-medium text-gray-600 dark:text-life-200">Only things worth at least (dollars)
                <input inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} placeholder="No minimum" aria-invalid={minBad}
                  className="min-h-11 w-full rounded-lg border border-life-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-life-700 dark:bg-life-800 dark:text-life-50" />
                {minBad && <span className="block text-red-600" role="alert">An amount is a number, like 250 or 79.99</span>}
              </label>
              <div>
                <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-life-50"><input type="checkbox" checked={withUnvalued} onChange={(e) => setWithUnvalued(e.target.checked)} className="h-4 w-4 accent-life-600" /> Include things with no value</label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-life-50"><input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} className="h-4 w-4 accent-life-600" /> With photos (they make it longer)</label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-life-50"><input type="checkbox" checked={perPage} onChange={(e) => setPerPage(e.target.checked)} className="h-4 w-4 accent-life-600" /> One room per page</label>
              </div>
            </div>
            {filtered && <p className="text-xs text-gray-600 dark:text-life-200">Showing {plural(report.shown.things, 'thing', 'things')} of {report.things}{picked ? ` in ${picked.map(choiceName).filter(Boolean).join(', ') || 'no rooms'}` : ''}.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!report.shown.things} onClick={() => window.print()} className={`${buttonClass} min-h-11`}>Print or save as PDF</button>
              <button type="button" disabled={!report.shown.things || saving} onClick={download} className={`${quietButtonClass} min-h-11`}>{saving ? 'Making it…' : 'Download as a spreadsheet (CSV)'}</button>
            </div>
            <p className="text-xs text-gray-500 dark:text-life-300">The spreadsheet has a row for each thing: room, where, what it is, make and model, serial number, when and where bought, cost, worth now and warranty. Photos and papers are not in it.</p>
            {problem && <p className="text-sm text-red-600" role="alert">{problem}</p>}
          </section>
        )}
      </div>

      {/* The sheet itself: black on white whatever the page's colours. */}
      <div className={`report-sheet space-y-5 rounded-xl bg-white p-4 text-black sm:p-6 ${perPage ? 'one-room-per-page' : ''}`} aria-label="The inventory">
        <header>
          <h2 className="text-lg font-bold">Home inventory</h2>
          <p className="text-sm text-gray-700">Made on {dayText(report.day)}</p>
          <p className="mt-1 text-sm" data-totals>
            {report.things} thing{report.things === 1 ? '' : 's'} · worth {money(report.worth_cents)} in all · {report.with_photo} with a photo · {report.with_receipt} with a receipt
          </p>
          <p className="text-sm">Cost {money(report.price_cents)} in all · {report.with_serial} with a serial number</p>
          {report.unvalued > 0 && <p className="text-sm" data-unvalued>{plural(report.unvalued, 'thing has', 'things have')} no value recorded, so the totals leave {report.unvalued === 1 ? 'it' : 'them'} out.</p>}
          {filtered && <p className="text-sm font-medium" data-shown>This report shows {plural(report.shown.things, 'thing', 'things')}, worth {money(report.shown.worth_cents)}.</p>}
        </header>
        {nothing && <p className="text-sm text-gray-600">Nothing is kept yet. Add your things, room by room, and they appear here.</p>}
        {!nothing && report.rooms.length === 0 && <p className="text-sm text-gray-600">Nothing matches those choices.</p>}
        {report.rooms.map((room) => (
          <section key={room.id} className="report-room" aria-label={room.name}>
            <h3 className="border-b-2 border-gray-800 pb-0.5 font-semibold">{room.name}</h3>
            <p className="py-1 text-xs text-gray-800" data-room-totals>
              {plural(room.things, 'thing', 'things')} · cost {money(room.price_cents)} · worth now {money(room.worth_cents)}{room.at_cost > 0 ? ' *' : ''} · {room.with_photo} with a photo · {room.with_serial} with a serial number · {room.with_receipt} with a receipt
            </p>
            <table className="w-full text-left text-xs sm:text-sm">
              <caption className="sr-only">Things in {room.name}</caption>
              <thead><tr className="text-[11px] text-gray-700">
                <th scope="col" className="py-1 font-medium">Thing</th>
                <th scope="col" className="hidden py-1 pr-2 font-medium sm:table-cell print:table-cell">Make, model, serial number</th>
                <th scope="col" className="hidden py-1 pr-2 font-medium sm:table-cell print:table-cell">Bought</th>
                <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell print:table-cell">Cost</th>
                <th scope="col" className="py-1 text-right font-medium">Worth now</th>
              </tr></thead>
              <tbody>
                {room.lines.map((l) => (
                  <tr key={l.id} className="border-t border-gray-300 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="flex gap-2">
                        {photos && l.photo && <Picture src={`/api/things/items/${l.id}/photo`} alt={`Photo of ${l.name}`} className="h-16 w-16 shrink-0 rounded object-cover" />}
                        <div className="min-w-0">
                          <Link to={`/things/${l.id}`} className="font-medium">{l.name}</Link>{l.amount !== 'some' && l.amount !== '1' && <span className="text-gray-700"> × {l.amount}</span>}
                          <div className="text-[11px] text-gray-700">{[l.kind, l.where, l.photo && 'photo', l.receipt && 'receipt'].filter(Boolean).join(' · ')}</div>
                          <div className="text-[11px] text-gray-700 sm:hidden print:hidden">{[l.model, l.serial && <span key="s" className="serial">S/N {l.serial}</span>, l.bought_on, l.bought_at].filter(Boolean).reduce((out, part, i) => (i ? [...out, ' · ', part] : [part]), [])}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-1.5 pr-2 sm:table-cell print:table-cell">{l.model}{l.model && l.serial ? ', ' : ''}{l.serial && <span className="serial">{l.serial}</span>}</td>
                    <td className="hidden py-1.5 pr-2 sm:table-cell print:table-cell">{[l.bought_on, l.bought_at].filter(Boolean).join(' · ')}</td>
                    <td className="hidden whitespace-nowrap py-1.5 text-right sm:table-cell print:table-cell">{l.price_cents != null ? money(l.price_cents) : ''}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">{l.worth_cents ? money(l.worth_cents) : '—'}{l.value_cents === null && l.price_cents !== null && l.price_cents > 0 ? ' *' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {atCost > 0 && (
          <p className="text-xs text-gray-700" data-footnote>* Worth now is the value you gave. Where none was given, the thing is counted at what it cost ({atCost} here).</p>
        )}
      </div>
    </div>
  );
}
