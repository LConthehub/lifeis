import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
import { waitText } from '../components/Routines';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * Routines: the page where they are made and changed. Using them (ticking, going through one) is on the front
 * page and the chore chart. Which steps fall on which day, and how a cycle waits, is worked out on the server.
 */

const DAYS = [[1, 'Mon', 'Monday'], [2, 'Tue', 'Tuesday'], [3, 'Wed', 'Wednesday'], [4, 'Thu', 'Thursday'], [5, 'Fri', 'Friday'], [6, 'Sat', 'Saturday'], [7, 'Sun', 'Sunday']];
const WAITS = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']];
const control = `${inputClass} min-h-[44px]`;

const blankStep = () => ({ id: null, words: '', rule: 'daily', weekdays: [], night: '', item_id: '', wait_seconds: '' });
const blankTime = (name = '') => ({ id: null, name, at: '', steps: [blankStep()] });

/** What a routine becomes in the form. */
function formOf(r, me) {
  if (!r) return { name: '', who: 'me', cycle_length: '', points: '', note: '', times: [blankTime('Morning')] };
  return {
    name: r.name, cycle_length: r.cycle_length ?? '', points: r.points ?? '', note: r.note ?? '',
    who: r.for_member !== null ? `m${r.for_member}` : r.for_user === me ? 'me' : r.for_user !== null ? `u${r.for_user}` : 'everyone',
    times: r.times.map((t) => ({
      id: t.id, name: t.name, at: t.at ?? '',
      steps: t.steps.map((s) => ({ id: s.id, words: s.words, rule: s.rule, weekdays: s.weekdays, night: s.night ?? '', item_id: s.item_id ?? '', wait_seconds: s.wait_seconds ?? '' })),
    })),
  };
}

/** What the form sends. */
function bodyOf(f, me) {
  return {
    name: f.name, cycle_length: f.cycle_length === '' ? null : Number(f.cycle_length),
    for_user: f.who === 'me' ? me : f.who.startsWith('u') ? Number(f.who.slice(1)) : null,
    for_member: f.who.startsWith('m') ? Number(f.who.slice(1)) : null,
    points: f.who.startsWith('m') && f.points !== '' ? Number(f.points) : null, note: f.note.trim() || null,
    times: f.times.map((t) => ({
      id: t.id, name: t.name, at: t.at || null,
      steps: t.steps.map((s) => ({
        id: s.id, words: s.words, rule: s.rule, weekdays: s.rule === 'weekdays' ? s.weekdays : null, night: s.rule === 'cycle' ? Number(s.night) : null,
        item_id: s.item_id === '' ? null : Number(s.item_id), wait_seconds: s.wait_seconds === '' ? null : Number(s.wait_seconds),
      })),
    })),
  };
}

function StepEditor({ step, cycle, items, onChange, onRemove, canRemove }) {
  const set = (patch) => onChange({ ...step, ...patch });
  return (
    <div className="space-y-2 rounded-lg bg-life-50/70 p-2 dark:bg-life-700/60" data-routine-step>
      <input value={step.words} onChange={(e) => set({ words: e.target.value })} placeholder="Wash your face" aria-label="Step" className={control} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={step.rule} onChange={(e) => set({ rule: e.target.value, night: e.target.value === 'cycle' ? (step.night || 1) : '', weekdays: e.target.value === 'weekdays' ? step.weekdays : [] })} aria-label="Days" className={`${control} w-auto`}>
          <option value="daily">Every day</option>
          <option value="weekdays">Some days of the week</option>
          {cycle && <option value="cycle">A night of the cycle</option>}
        </select>
        {step.rule === 'cycle' && (
          <select value={step.night} onChange={(e) => set({ night: Number(e.target.value) })} aria-label="Night of the cycle" className={`${control} w-auto`}>
            {Array.from({ length: Number(cycle) }, (_, i) => <option key={i + 1} value={i + 1}>Night {i + 1} of {cycle}</option>)}
          </select>
        )}
      </div>
      {step.rule === 'weekdays' && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which days">
          {DAYS.map(([n, short, long]) => {
            const on = step.weekdays.includes(n);
            return (
              <button key={n} type="button" aria-pressed={on} aria-label={long} onClick={() => set({ weekdays: on ? step.weekdays.filter((d) => d !== n) : [...step.weekdays, n].sort() })}
                className={`min-h-[44px] min-w-[44px] rounded-xl px-2 text-sm ${on ? 'bg-life-600 text-white' : 'border border-life-200 text-life-700 dark:border-life-700 dark:text-life-100'}`}>{short}</button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={step.item_id} onChange={(e) => set({ item_id: e.target.value })} aria-label="A thing it uses" className={`${control} min-w-0 flex-1`}>
          <option value="">No thing</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={step.wait_seconds} onChange={(e) => set({ wait_seconds: e.target.value })} aria-label="Wait after this step" className={`${control} w-auto`}>
          <option value="">No wait</option>
          {step.wait_seconds !== '' && !WAITS.some(([s]) => s === Number(step.wait_seconds)) && <option value={step.wait_seconds}>{waitText(Number(step.wait_seconds))}</option>}
          {WAITS.map(([s, label]) => <option key={s} value={s}>Wait {label}</option>)}
        </select>
        {canRemove && <button type="button" onClick={onRemove} className="ml-auto min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Remove step</button>}
      </div>
    </div>
  );
}

function RoutineForm({ routine, me, people, items, onDone, onGone }) {
  const [f, setF] = useState(() => formOf(routine, me));
  const [tags, setTags] = useState(routine?.tag_list ?? []);
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const set = (patch) => setF((before) => ({ ...before, ...patch }));
  const setTime = (i, patch) => set({ times: f.times.map((t, at) => (at === i ? { ...t, ...patch } : t)) });
  const setCycle = (value) => set({
    cycle_length: value,
    times: f.times.map((t) => ({ ...t, steps: t.steps.map((s) => (s.rule !== 'cycle' ? s : !value ? { ...s, rule: 'daily', night: '' } : Number(s.night) > Number(value) ? { ...s, night: '' } : s)) })),
  });
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = bodyOf(f, me);
      const { data } = routine ? await axios.put(`/api/routines/${routine.id}`, body) : await axios.post('/api/routines', body);
      data.tag_list = await saveTags('routine', data.id, tags);
      onDone(data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => {
    try { await axios.delete(`/api/routines/${routine.id}`); onGone(); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  const forMember = f.who.startsWith('m');
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Skincare" aria-label="Name of the routine" className={control} /></Field>
      <Field label="Whose is it?">
        <select value={f.who} onChange={(e) => set({ who: e.target.value })} aria-label="Whose is it" className={control}>
          <option value="me">Mine: shows on my front page</option>
          <option value="everyone">Everyone's: shows on every front page</option>
          {people.users.filter((u) => u.id !== me).map((u) => <option key={`u${u.id}`} value={`u${u.id}`}>{u.name}'s: shows on their front page</option>)}
          {people.members.map((m) => <option key={`m${m.id}`} value={`m${m.id}`}>{m.name} (household): shows on the chore chart</option>)}
        </select>
      </Field>
      {forMember && (
        <Field label="Chore points for each time finished">
          <input type="number" min="0" max="1000" step="1" value={f.points} onChange={(e) => set({ points: e.target.value })} placeholder="None" aria-label="Chore points" className={control} />
        </Field>
      )}
      <Field label="Does it run in a cycle?">
        <select value={f.cycle_length} onChange={(e) => setCycle(e.target.value)} aria-label="Cycle length" className={control}>
          <option value="">No cycle</option>
          {Array.from({ length: 13 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} nights</option>)}
        </select>
        <span className="text-xs text-gray-500 dark:text-life-300">With a cycle, a step can be for one night of it. The cycle moves on only when that time is finished, so days you skip do not use up a night.</span>
      </Field>

      <div className="space-y-3">
        {f.times.map((t, i) => (
          <fieldset key={i} className="space-y-2 rounded-xl border border-life-100 p-3 dark:border-life-700" data-routine-time>
            <legend className="px-1 text-xs font-medium text-gray-600 dark:text-life-200">Time {i + 1}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input value={t.name} onChange={(e) => setTime(i, { name: e.target.value })} placeholder="Morning" aria-label="Name of the time" className={`${control} min-w-0 flex-1`} />
              <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-life-100">at
                <input type="time" value={t.at} onChange={(e) => setTime(i, { at: e.target.value })} aria-label="Clock time (optional)" className={`${control} w-auto`} />
              </label>
              {t.at && <button type="button" onClick={() => setTime(i, { at: '' })} className="min-h-[44px] px-2 text-sm text-life-600 hover:underline dark:text-life-200">No clock time</button>}
            </div>
            <p className="text-xs text-gray-500 dark:text-life-300">With a clock time, Life Is reminds you then, the ways your reminders already go.</p>
            {t.steps.map((s, n) => (
              <StepEditor key={n} step={s} cycle={f.cycle_length} items={items} canRemove={t.steps.length > 1}
                onChange={(next) => setTime(i, { steps: t.steps.map((x, at) => (at === n ? next : x)) })} onRemove={() => setTime(i, { steps: t.steps.filter((_, at) => at !== n) })} />
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setTime(i, { steps: [...t.steps, blankStep()] })} className={`${quietButtonClass} min-h-[44px]`}>+ Add a step</button>
              {f.times.length > 1 && <button type="button" onClick={() => set({ times: f.times.filter((_, at) => at !== i) })} className="ml-auto min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Remove this time</button>}
            </div>
          </fieldset>
        ))}
        {f.times.length < 6 && <button type="button" onClick={() => set({ times: [...f.times, blankTime(f.times.length === 1 ? 'Evening' : '')] })} className={`${quietButtonClass} min-h-[44px]`}>+ Add a time of day</button>}
      </div>

      <Field label="Notes"><textarea value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} aria-label="Notes" className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {routine && !sure && <button type="button" onClick={() => setSure(true)} className="min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Delete this routine</button>}
        {routine && sure && <button type="button" onClick={remove} className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white">Yes, delete it and what was ticked</button>}
        <button type="submit" className={`${buttonClass} ml-auto min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

const timeLine = (t) => `${t.name}${t.at_words ? ` at ${t.at_words}` : ''}: ${t.steps.length} ${t.steps.length === 1 ? 'step' : 'steps'}, ${t.last7} of the last 7 days`;

export default function RoutinesPage() {
  const [list, setList] = useState(null);
  const [starters, setStarters] = useState([]);
  const [people, setPeople] = useState({ users: [], members: [], me: 0 });
  const [items, setItems] = useState([]);
  const [tag, setTag] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [startersOpen, setStartersOpen] = useState(null);
  const sel = useSelecting();
  const load = useCallback(() => {
    axios.get('/api/routines', { params: { tag: tag || undefined } }).then(({ data }) => setList(data)).catch(() => setList([]));
    axios.get('/api/routines/starters').then(({ data }) => setStarters(data)).catch(() => {});
  }, [tag]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get('/api/routines/people').then(({ data }) => setPeople(data)).catch(() => {});
    axios.get('/api/things/items').then(({ data }) => setItems((Array.isArray(data) ? data : []).map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
  }, []);
  if (list === null) return null;
  const addStarter = async (slug) => {
    setError('');
    try { await axios.post('/api/routines/starters', { slug }); load(); } catch (err) { setError(errorMessage(err, "Couldn't add it")); }
  };
  const offered = starters.filter((s) => !s.have);
  const done = () => { setModal(null); load(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Routines</h1>
        <button type="button" onClick={() => setModal({ routine: null })} className={`${buttonClass} min-h-[44px]`}>+ New</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100">Checklists for parts of the day. They show on the front page, where you tick them off or go through one a step at a time.</p>
      <div className="flex flex-wrap items-center gap-2">
        <TagFilter value={tag} onChange={setTag} />
        {(list.length > 0 || tag) && <SelectButton sel={sel} />}
      </div>
      <BulkBar sel={sel} kind="routine" list={list.filter((r) => r.mine).map((r) => r.id)} noun="routines" onDone={load} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {list.length === 0 && tag && <p className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing matches.</p>}
      {list.length === 0 && !tag && <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>No routines yet. Make one, or start from a ready-made one below. Each has times of day, like Morning and Evening, with steps for each.</p>}
      <ul className="space-y-3">
        {list.map((r) => (
          <li key={r.id} className={cardClass} data-routine={r.name}>
            <div className="flex flex-wrap items-center gap-2">
              <PickBox sel={sel} id={r.id} name={r.name} />
              <div className="min-w-0 flex-1">
                <h2 className="break-words font-semibold text-life-800 dark:text-life-50">{r.name}</h2>
                <p className="text-xs text-gray-500 dark:text-life-300">{r.who_kind === 'me' ? 'For you' : r.who_kind === 'everyone' ? 'For everyone' : r.who_kind === 'member' ? `For ${r.who}, on the chore chart` : `For ${r.who}`}{r.cycle_length ? ` · ${r.cycle_length}-night cycle` : ''}{r.points ? ` · ${r.points} points a time` : ''}</p>
              </div>
              {r.mine && <button type="button" onClick={() => setModal({ routine: r })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${r.name}`}>Change</button>}
            </div>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700 dark:text-life-100">
              {r.times.map((t) => <li key={t.id}>{timeLine(t)}</li>)}
            </ul>
            <TagChips tags={r.tag_list} className="mt-1" />
          </li>
        ))}
      </ul>
      {offered.length > 0 && !tag && (
        <details className={cardClass} open={startersOpen ?? list.length === 0} onToggle={(e) => setStartersOpen(e.currentTarget.open)} aria-label="Ready-made routines">
          <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-life-800 dark:text-life-50">Start from a ready-made routine</summary>
          <p className="mb-2 text-xs text-gray-500 dark:text-life-300">Plain steps to copy. Once added, every part is yours to change.</p>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {offered.map((s) => (
              <li key={s.slug} className="flex flex-wrap items-center gap-2 py-2" data-starter={s.slug}>
                <div className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-gray-800 dark:text-life-50">{s.name}</span>
                  <span className="block text-xs text-gray-500 dark:text-life-300">{s.about} {s.times.map((t) => `${t.name} (${t.steps.length})`).join(', ')}</span>
                </div>
                <button type="button" onClick={() => addStarter(s.slug)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Add ${s.name}`}>Add</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {modal && (
        <Modal title={modal.routine ? `Change ${modal.routine.name}` : 'New routine'} wide onClose={() => setModal(null)}>
          <RoutineForm routine={modal.routine} me={people.me} people={people} items={items} onDone={done} onGone={done} />
        </Modal>
      )}
    </div>
  );
}
