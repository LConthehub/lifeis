import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { money } from '../components/Records';
import { buttonClass, cardClass } from '../components/ui';

const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * The home inventory: everything kept, room by room, with what each is worth, its serial number, and whether
 * there's a photo and a receipt to show for it. Made to be printed, or saved as a PDF, for an insurer.
 */
export default function HomeReport() {
  const [report, setReport] = useState(null);
  const [photos, setPhotos] = useState(true);
  useEffect(() => { axios.get('/api/things/report').then(({ data }) => setReport(data)).catch(() => setReport(false)); }, []);
  if (report === null) return null;
  if (report === false) return <p className="text-sm text-gray-600 dark:text-life-200">The inventory couldn't be made just now.</p>;
  const unvalued = report.things - report.valued;

  return (
    <div className="space-y-4">
      <div className="space-y-3 print:hidden">
        <Link to="/things" className="text-sm text-life-600 hover:underline dark:text-life-200">← Things</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Home inventory</h1>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100"><input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} className="accent-life-600" /> With photos</label>
          <button type="button" disabled={!report.things} onClick={() => window.print()} className={buttonClass}>Print or save as PDF</button>
        </div>
        <p className="text-sm text-gray-600 dark:text-life-100">
          What an insurer asks for after a fire, a flood or a theft: what you had, what it was worth, and proof. Keep a printed or saved copy somewhere other than home.
          {report.things > 0 && unvalued > 0 && <> {unvalued} of your {report.things} things {unvalued === 1 ? 'has' : 'have'} no price or value yet; open one and add its records.</>}
        </p>
        {report.warranties.length > 0 && (
          <section className={cardClass} aria-label="Warranties ending soon">
            <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Warranties ending soon</h2>
            <ul className="space-y-0.5 text-sm">
              {report.warranties.map((w) => <li key={w.id}><Link to={`/things/${w.id}`} className="text-gray-800 hover:underline dark:text-life-50">{w.name}</Link> <span className="text-xs text-honey-700">{w.days_left === 0 ? 'today' : `in ${w.days_left} days`}</span></li>)}
            </ul>
          </section>
        )}
      </div>

      {/* The sheet itself: black on white whatever the page's colours. */}
      <div className="report-sheet space-y-5 rounded-xl bg-white p-4 text-black sm:p-6" aria-label="The inventory">
        <header>
          <h2 className="text-lg font-bold">Home inventory</h2>
          <p className="text-sm text-gray-700">As of {dayText(report.day)}</p>
          <p className="mt-1 text-sm" data-totals>
            {report.things} thing{report.things === 1 ? '' : 's'} · worth {money(report.worth_cents)} in all · {report.with_photo} with a photo · {report.with_receipt} with a receipt
          </p>
        </header>
        {report.things === 0 && <p className="text-sm text-gray-600">Nothing is kept yet. Add your things, room by room, and they appear here.</p>}
        {report.rooms.map((room) => (
          <section key={room.name} className="break-inside-avoid-page">
            <h3 className="flex items-baseline gap-2 border-b-2 border-gray-800 pb-0.5 font-semibold"><span className="flex-1">{room.name}</span><span className="text-sm">{money(room.worth_cents)}</span></h3>
            <table className="w-full text-left text-xs sm:text-sm">
              <thead><tr className="text-[11px] text-gray-600"><th className="py-1 font-medium">Thing</th><th className="hidden py-1 font-medium sm:table-cell print:table-cell">Model, serial</th><th className="hidden py-1 font-medium sm:table-cell print:table-cell">Bought</th><th className="py-1 text-right font-medium">Worth</th></tr></thead>
              <tbody>
                {room.lines.map((l) => (
                  <tr key={l.id} className="break-inside-avoid border-t border-gray-200 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="flex gap-2">
                        {photos && l.photo && <Picture src={`/api/things/items/${l.id}/photo`} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />}
                        <div>
                          <Link to={`/things/${l.id}`} className="font-medium print:no-underline">{l.name}</Link>{l.amount !== 'some' && l.amount !== '1' && <span className="text-gray-600"> × {l.amount}</span>}
                          <div className="text-[11px] text-gray-600">{[l.kind, l.place && l.place !== room.name && l.place.slice(room.name.length + 3), l.photo && 'photo', l.receipt && 'receipt'].filter(Boolean).join(' · ')}</div>
                          <div className="text-[11px] text-gray-600 sm:hidden print:hidden">{[l.model, l.serial && `S/N ${l.serial}`].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-1.5 pr-2 sm:table-cell print:table-cell">{[l.model, l.serial && `S/N ${l.serial}`].filter(Boolean).join(' · ')}</td>
                    <td className="hidden py-1.5 pr-2 sm:table-cell print:table-cell">{[l.bought_on, l.bought_at, l.price_cents != null && l.value_cents != null && `paid ${money(l.price_cents)}`].filter(Boolean).join(' · ')}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">{l.worth_cents ? money(l.worth_cents) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
