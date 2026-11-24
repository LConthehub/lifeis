import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Icon from './Icon';
import { buttonClass, quietButtonClass, cardClass, errorMessage, fromDateInput, inputClass, toDateInput } from './ui';

const API = '/api/plans/holidays';
const when = (card) => (card.days_until === null ? '' : card.days_until === 0 ? 'today' : card.days_until === 1 ? 'tomorrow' : `in ${card.days_until} days`);

/**
 * Front page: each holiday with something to say. Six weeks ahead (or the lead time the person chose) it says
 * to start planning and then what is next, until take-down; then it asks for notes for next year, and goes quiet.
 */
export default function HolidayCard({ cards, onChange }) {
  return (
    <section className={cardClass} aria-label="Holidays">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Holidays</h2>
        <Link to="/plans/holidays" className="text-xs text-life-600 hover:underline dark:text-life-200">All holidays →</Link>
      </div>
      {cards.length === 0
        ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing to do for a holiday right now.</p>
        : <ul className="space-y-3">{cards.map((c) => <Row key={c.holiday_id} card={c} onChange={onChange} />)}</ul>}
    </section>
  );
}

function Row({ card, onChange }) {
  const navigate = useNavigate();
  const [notes, setNotes] = useState('');
  const [day, setDay] = useState(toDateInput(new Date()));
  const [error, setError] = useState('');
  const run = async (work) => { setError(''); try { await work(); onChange?.(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); } };
  const heading = (
    <span className="flex items-baseline gap-2">
      <span className="self-start"><Icon of="holiday" /></span>
      <span className="flex-1 font-medium text-gray-800 dark:text-life-50">{card.name}{card.year ? ` ${card.year}` : ''}</span>
      <span className="text-xs text-gray-500 dark:text-life-300">{when(card)}{card.day && card.days_until !== 0 ? ` · ${fromDateInput(card.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</span>
    </span>
  );
  return (
    <li className="space-y-1 text-sm" data-holiday-card={card.stage}>
      <Link to={card.link} className="block hover:underline">{heading}</Link>
      {card.stage === 'planning' && <p className="pl-6 text-gray-700 dark:text-life-100">Next: {card.next}</p>}
      {card.stage === 'take_down' && <p className="pl-6 text-gray-700 dark:text-life-100">{card.next}</p>}
      {card.stage === 'start' && (
        <div className="pl-6">
          <button type="button" onClick={() => run(async () => { const { data } = await axios.post(`${API}/${card.holiday_id}/years`, {}); navigate(`/plans/holidays/${card.holiday_id}/${data.plan_id}`); })} className={`${quietButtonClass} min-h-[44px]`}>Start this year's from last year's</button>
        </div>
      )}
      {card.stage === 'notes' && (
        <form className="space-y-2 pl-6" onSubmit={(e) => { e.preventDefault(); run(() => axios.post(`${API}/years/${card.plan_id}/finish`, { notes: notes || null })); }}>
          <label className="block text-xs font-medium text-gray-600 dark:text-life-200">What should next year remember?
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <button type="submit" className={`${buttonClass} min-h-[44px]`}>{notes.trim() ? 'Save, and finish this year' : 'Nothing to add: finish this year'}</button>
        </form>
      )}
      {card.stage === 'next_date' && (
        <form className="flex flex-wrap items-end gap-2 pl-6" onSubmit={(e) => { e.preventDefault(); run(async () => { const { data } = await axios.post(`${API}/${card.holiday_id}/years`, { day }); navigate(`/plans/holidays/${card.holiday_id}/${data.plan_id}`); }); }}>
          <label className="text-xs font-medium text-gray-600 dark:text-life-200">{card.next}
            <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={`${inputClass} mt-1 min-h-[44px]`} />
          </label>
          <button type="submit" className={`${buttonClass} min-h-[44px]`}>Start it</button>
        </form>
      )}
      {error && <p className="pl-6 text-red-600">{error}</p>}
    </li>
  );
}
