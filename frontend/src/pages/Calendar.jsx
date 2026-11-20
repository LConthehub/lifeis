import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from '../components/ui';

const ICONS = { plan: '✨', event: '📌', meal: '🍽', session: '🧵', due: '⏳', use_by: '🥫', media: '🎞' };

function startOfWeek(d) {
  const day = new Date(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));    // weeks start on Monday
  return day;
}

/** The week, a day at a time: your own dates, with the meals, projects and everything else alongside. */
export default function Calendar() {
  const [start, setStart] = useState(() => startOfWeek(new Date()));
  const [entries, setEntries] = useState(null);
  const [editing, setEditing] = useState(null);
  const startText = toDateInput(start);
  const load = useCallback(() => {
    axios.get('/api/calendar', { params: { start: startText, days: 7 } }).then(({ data }) => setEntries(data)).catch(() => setEntries([]));
  }, [startText]);
  useEffect(() => { load(); }, [load]);
  const move = (days) => { const d = new Date(start); d.setDate(d.getDate() + days); setStart(d); };
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const today = toDateInput(new Date());
  const edit = async (entry) => {
    const { data } = await axios.get(`/api/calendar/events/${entry.id}`).catch(() => ({ data: null }));
    if (data) setEditing(data);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">
          {start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h1>
        <button type="button" onClick={() => move(-7)} className={quietButtonClass} aria-label="Week before">←</button>
        <button type="button" onClick={() => setStart(startOfWeek(new Date()))} className={quietButtonClass}>This week</button>
        <button type="button" onClick={() => move(7)} className={quietButtonClass} aria-label="Week after">→</button>
        <button type="button" onClick={() => setEditing({ day: today })} className={buttonClass}>+ Add</button>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">Meals, project time, use-by dates and what you watched show here from their own pages. Tap one to go there.</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {days.map((d) => {
          const key = toDateInput(d);
          const here = (entries || []).filter((e) => e.day === key);
          return (
            <section key={key} className={`${cardClass} ${key === today ? 'ring-2 ring-life-400' : ''}`}>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
                <button type="button" onClick={() => setEditing({ day: key })} className="text-sm text-life-600 hover:underline dark:text-life-200" aria-label={`Add to ${key}`}>+ Add</button>
              </div>
              {here.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">Nothing on.</p> : (
                <ul className="space-y-1.5">
                  {here.map((e, i) => {
                    const body = (
                      <>
                        <span aria-hidden="true">{ICONS[e.kind]}</span>
                        <span className="flex-1">
                          <span className="block text-sm text-gray-800 dark:text-life-50">{e.time && <span className="mr-1 font-medium">{e.time}</span>}{e.title}</span>
                          {e.detail && <span className="block text-xs text-gray-500 dark:text-life-300">{e.detail}</span>}
                        </span>
                      </>
                    );
                    return (
                      <li key={`${e.kind}-${e.id ?? e.link}-${i}`}>
                        {e.link
                          ? <Link to={e.link} className="flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-life-50 dark:hover:bg-life-700">{body}</Link>
                          : <button type="button" onClick={() => edit(e)} className="flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-life-50 dark:hover:bg-life-700">{body}</button>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {editing && (
        <Modal title={editing.id ? editing.title : 'Something on the calendar'} onClose={() => setEditing(null)}>
          <EventForm event={editing} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function EventForm({ event, onDone }) {
  const [form, setForm] = useState({ title: event.title || '', day: event.day, end_day: event.end_day || '', time: event.time || '', note: event.note || '', yearly: Boolean(event.yearly) });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { title: form.title, day: form.day, end_day: form.yearly ? null : form.end_day || null, time: form.time || null, note: form.note || null, yearly: form.yearly };
    try {
      if (event.id) await axios.put(`/api/calendar/events/${event.id}`, body); else await axios.post('/api/calendar/events', body);
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => { await axios.delete(`/api/calendar/events/${event.id}`).catch(() => {}); onDone(); };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What *"><input required autoFocus={!event.id} value={form.title} onChange={set('title')} placeholder="e.g. Dentist" className={inputClass} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day *"><input required type="date" value={form.day} onChange={set('day')} className={inputClass} /></Field>
        <Field label="Until (if longer)"><input type="date" min={form.day} value={form.yearly ? '' : form.end_day} disabled={form.yearly} onChange={set('end_day')} className={inputClass} /></Field>
        <Field label="Time (empty: all day)"><input type="time" value={form.time} onChange={set('time')} className={inputClass} /></Field>
      </div>
      <Field label="A note"><input value={form.note} onChange={set('note')} className={inputClass} /></Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800 dark:text-life-50">
        <input type="checkbox" checked={form.yearly} onChange={(e) => setForm({ ...form, yearly: e.target.checked })} className="mt-0.5 accent-life-600" />
        <span>Every year <span className="block text-xs text-gray-500 dark:text-life-300">A birthday or an anniversary. Give the day it first happened, year and all, and the calendar counts the years.</span></span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {event.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
