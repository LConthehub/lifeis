import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { buttonClass, cardClass } from '../components/ui';
import PrintFrame, { PrintStyleChoice } from '../print/PrintFrame';
import { dayText, dollars, photoAddress } from './Renting';

// Letter paper. A room is never cut in two, and the two visits sit side by side.
const PRINT_RULES = `
@media print {
  @page { size: letter; margin: 0.6in; }
  .rent-sheet { color: #000 !important; background: #fff !important; box-shadow: none !important; border-radius: 0 !important; font-size: 10pt; padding: 0 !important; }
  .rent-room { break-inside: avoid; page-break-inside: avoid; }
  .rent-photo { max-height: 2.4in !important; }
}`;

/**
 * The move-in and move-out record as one printout on letter paper, room by room, with the two visits side by side.
 * It is made on your own Life Is and goes nowhere unless you send it.
 */
export default function RentingPrint() {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get('/api/things/renting').then((r) => setData(r.data)).catch(() => setData({ lease: {}, rooms: [] })); }, []);
  if (!data) return null;
  const { lease, rooms } = data;
  const made = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const facts = [lease.landlord_name && `Landlord: ${lease.landlord_name}`, lease.start_day && `Lease starts ${dayText(lease.start_day)}`, lease.end_day && `Lease ends ${dayText(lease.end_day)}`, lease.deposit_cents != null && `Deposit ${dollars(lease.deposit_cents)}`].filter(Boolean);

  return (
    <div className="space-y-4">
      <style>{PRINT_RULES}</style>
      <div className="space-y-3 print:hidden">
        <Link to="/things/renting" className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">← Renting</Link>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Print the record</h1>
        <section className={`${cardClass} space-y-3`}>
          <p className="text-sm text-gray-600 dark:text-life-100">One printout on letter paper: each room with how it looked at move-in and at move-out, side by side, with your photos and their dates. It is made here and goes nowhere unless you send it.</p>
          <PrintStyleChoice />
          <button type="button" disabled={rooms.length === 0} onClick={() => window.print()} className={`${buttonClass} min-h-[44px]`}>Print or save as PDF</button>
          {rooms.length === 0 && <p className="text-sm text-gray-600 dark:text-life-200" role="status">There are no rooms yet. Add some on the Renting page.</p>}
        </section>
      </div>

      <PrintFrame phrase="Life is in order" title="Move-in and move-out record" className="rent-sheet space-y-4 rounded-xl bg-card p-4 text-black print:bg-white sm:p-6" aria-label="The record">
        <p className="text-sm text-gray-700">{[...facts, `Made on ${made}`].join(' · ')}</p>
        {rooms.map((room) => (
          <section key={room.id} className="rent-room space-y-2" aria-label={room.name}>
            <h3 className="border-b-2 border-gray-800 pb-0.5 font-semibold">{room.name}</h3>
            <div className="grid grid-cols-2 gap-4">
              {[['in', 'Move-in', room.in_note], ['out', 'Move-out', room.out_note]].map(([phase, title, note]) => (
                <div key={phase} className="min-w-0 space-y-2">
                  <h4 className="text-sm font-semibold">{title}</h4>
                  <p className="whitespace-pre-line break-words text-sm">{note || 'No note.'}</p>
                  {room.photos.filter((p) => p.phase === phase).map((p) => (
                    <figure key={p.id} className="space-y-0.5">
                      <Picture src={photoAddress(p.id)} alt={`${room.name} at ${title.toLowerCase()}`} className="rent-photo block max-h-48 w-full rounded object-cover" />
                      <figcaption className="text-xs text-gray-700">Taken {dayText(p.day)}</figcaption>
                    </figure>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </PrintFrame>
    </div>
  );
}
