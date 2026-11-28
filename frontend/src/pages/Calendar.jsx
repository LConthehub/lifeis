import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from '../components/ui';


function startOfWeek(d) {
  const day = new Date(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));    // weeks start on Monday
  return day;
}

/** The week, a day at a time: your own dates, with the meals, projects and everything else alongside. */
export default function Calendar() {
  // Opened at a day (/calendar?day=2046-03-05, or 03-05 for a date that comes every year): its week shows.
  const [start, setStart] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get('day') ?? '';
    const now = new Date();
    let at = now;
    if (/^\d{4}-\d{2}-\d{2}$/.test(asked)) at = new Date(`${asked}T12:00:00`);
    else if (/^\d{2}-\d{2}$/.test(asked)) {
      at = new Date(`${now.getFullYear()}-${asked}T12:00:00`);
      if (at < new Date(now.getFullYear(), now.getMonth(), now.getDate())) at = new Date(`${now.getFullYear() + 1}-${asked}T12:00:00`);
    }
    return startOfWeek(Number.isNaN(at.getTime()) ? now : at);
  });
  const [entries, setEntries] = useState(null);
  const [editing, setEditing] = useState(null);
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const startText = toDateInput(start);
  const load = useCallback(() => {
    axios.get('/api/calendar', { params: { start: startText, days: 7, tag: tag || undefined } }).then(({ data }) => setEntries(data)).catch(() => setEntries([]));
  }, [startText, tag]);
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
      <div className="flex flex-wrap items-center gap-2">
        <TagFilter value={tag} onChange={setTag} />
        <SelectButton sel={sel} />
      </div>
      <BulkBar sel={sel} kind="event" list={[...new Set((entries || []).filter((e) => e.kind === 'event' && e.id !== null).map((e) => e.id))]} noun="dates" onDone={load} />
      {tag && <p className="text-sm text-gray-600 dark:text-life-200">Showing only the dates with this tag.</p>}
      <p className="text-xs text-gray-500 dark:text-life-300">Meals, project time, use-by dates and what you watched show here from their own pages. Tap one to go there. <Link to="/settings#calendar-link" className="text-life-600 hover:underline dark:text-life-200">See this on your phone's calendar</Link></p>
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
              {here.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">Nothing planned.</p> : (
                <ul className="space-y-1.5">
                  {here.map((e, i) => {
                    const body = (
                      <>
                        <Icon of={e.kind} />
                        <span className="flex-1">
                          <span className="block text-sm text-gray-800 dark:text-life-50">{e.time && <span className="mr-1 font-medium">{e.time}</span>}{e.title}</span>
                          {e.detail && <span className="block text-xs text-gray-500 dark:text-life-300">{e.detail}</span>}
                        </span>
                      </>
                    );
                    return (
                      <li key={`${e.kind}-${e.id ?? e.link}-${i}`} className="flex flex-wrap items-start">
                        {e.kind === 'event' && e.id !== null && <PickBox sel={sel} id={e.id} name={e.title} />}
                        <div className="min-w-0 flex-1">
                        {e.link
                          ? <Link to={e.link} className="flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-life-50 dark:hover:bg-life-700">{body}</Link>
                          : e.kind === 'outside' ? <span className="flex items-start gap-2 px-1 py-0.5">{body}</span>
                          : <button type="button" onClick={() => edit(e)} className="flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-life-50 dark:hover:bg-life-700">{body}</button>}
                        <TagChips tags={e.tag_list} className="pl-7" />
                        </div>
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
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: event.title || '', day: event.day, end_day: event.end_day || '', time: event.time || '', note: event.note || '', yearly: Boolean(event.yearly), travel: event.travel_minutes ? String(event.travel_minutes) : '' });
  const [tags, setTags] = useState(event.tag_list || []);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { title: form.title, day: form.day, end_day: form.yearly ? null : form.end_day || null, time: form.time || null, note: form.note || null, yearly: form.yearly, travel_minutes: form.time && form.travel ? Number(form.travel) : null };
    try {
      const { data } = event.id ? await axios.put(`/api/calendar/events/${event.id}`, body) : await axios.post('/api/calendar/events', body);
      await saveTags('event', data.id, tags);
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => { await axios.delete(`/api/calendar/events/${event.id}`).catch(() => {}); onDone(); };
  // A birthday, anniversary or other yearly date becomes a holiday with one tap: its own plan each year, started from last year's.
  const makeHoliday = async () => {
    try { const { data } = await axios.post('/api/plans/holidays/from-event', { event_id: event.id }); navigate(`/plans/${data.years[0].plan_id}`); } catch (err) { setError(errorMessage(err, "Couldn't make that a holiday")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What *"><input required autoFocus={!event.id} value={form.title} onChange={set('title')} placeholder="e.g. Dentist" className={inputClass} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day *"><input required type="date" value={form.day} onChange={set('day')} className={inputClass} /></Field>
        <Field label="Until (if longer)"><input type="date" min={form.day} value={form.yearly ? '' : form.end_day} disabled={form.yearly} onChange={set('end_day')} className={inputClass} /></Field>
        <Field label="Time (empty: all day)"><input type="time" value={form.time} onChange={set('time')} className={inputClass} /></Field>
      </div>
      <Field label="Minutes to get there (only with a time)">
        <input type="number" inputMode="numeric" min="1" max="720" step="1" value={form.travel} disabled={!form.time} onChange={set('travel')} aria-label="Minutes to get there" placeholder="e.g. 25" className={inputClass} />
        <span className="mt-1 block text-xs text-gray-500 dark:text-life-300">You type it. Nothing is looked up. The morning reminder then says when to leave.</span>
      </Field>
      <Field label="A note"><input value={form.note} onChange={set('note')} className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800 dark:text-life-50">
        <input type="checkbox" checked={form.yearly} onChange={(e) => setForm({ ...form, yearly: e.target.checked })} className="mt-0.5 accent-life-600" />
        <span>Every year <span className="block text-xs text-gray-500 dark:text-life-300">A birthday or an anniversary. Give the day it first happened, year and all, and the calendar counts the years.</span></span>
      </label>
      {event.id && event.yearly && (
        <button type="button" onClick={makeHoliday} className="min-h-[44px] w-full rounded-xl border border-life-200 px-3 text-sm text-life-700 hover:bg-life-50 dark:border-life-700 dark:text-life-100 dark:hover:bg-life-800">
          <Icon of="holiday" /> Make it a holiday: its own gifts, menu, guests, decor and notes each year
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {event.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
