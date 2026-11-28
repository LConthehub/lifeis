import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SubChips, { ROUTINE_CHIPS } from '../components/SubChips';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
import { lastDoneText, todayHere } from '../ago';
import { Checklists, sentNumbers, typed, waitText } from '../components/Routines';
import FirstStep from '../components/FirstStep';
import { RoutineSheet } from '../print/FilledSheets';
import { PrintMenu } from '../print/PrintFrame';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * Routines: the page where they are made and changed. Using them (ticking, going through one) is on the front
 * page and the chore chart. Which steps fall on which day, and how a cycle waits, is worked out on the server.
 */

const DAYS = [[1, 'Mon', 'Monday'], [2, 'Tue', 'Tuesday'], [3, 'Wed', 'Wednesday'], [4, 'Thu', 'Thursday'], [5, 'Fri', 'Friday'], [6, 'Sat', 'Saturday'], [7, 'Sun', 'Sunday']];
const WAITS = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']];
const control = `${inputClass} min-h-[44px]`;

const blankStep = () => ({ id: null, words: '', rule: 'daily', weekdays: [], night: '', every: 2, start: todayHere(), item_id: '', wait_seconds: '', nums: typed({}) });
const blankTime = (name = '') => ({ id: null, name, at: '', steps: [blankStep()] });

/** What a routine becomes in the form. */
function formOf(r, me, startWho = 'me', startKind = 'plain') {
  if (!r) return { name: '', kind: startKind, who: startWho, cycle_length: '', points: '', note: '', times: [blankTime('Morning')] };
  return {
    name: r.name, kind: r.kind ?? 'plain', cycle_length: r.cycle_length ?? '', points: r.points ?? '', note: r.note ?? '',
    who: r.for_pet != null ? `p${r.for_pet}` : r.for_member !== null ? `m${r.for_member}` : r.for_user === me ? 'me' : r.for_user !== null ? `u${r.for_user}` : 'everyone',
    times: r.times.map((t) => ({
      id: t.id, name: t.name, at: t.at ?? '',
      steps: t.steps.map((s) => ({ id: s.id, words: s.words, rule: s.rule, weekdays: s.weekdays, night: s.night ?? '', every: s.every ?? 2, start: s.start ?? todayHere(), item_id: s.item_id ?? '', wait_seconds: s.wait_seconds ?? '', nums: typed(s.nums ?? {}) })),
    })),
  };
}

/** What the form sends. */
function bodyOf(f, me) {
  return {
    name: f.name, kind: f.kind, cycle_length: f.cycle_length === '' ? null : Number(f.cycle_length),
    for_user: f.who === 'me' ? me : f.who.startsWith('u') ? Number(f.who.slice(1)) : null,
    for_member: f.who.startsWith('m') ? Number(f.who.slice(1)) : null,
    for_pet: /^p\d+$/.test(f.who) ? Number(f.who.slice(1)) : null,
    points: f.who.startsWith('m') && f.points !== '' ? Number(f.points) : null, note: f.note.trim() || null,
    times: f.times.map((t) => ({
      id: t.id, name: t.name, at: t.at || null,
      steps: t.steps.map((s) => ({
        id: s.id, words: s.words, rule: s.rule, weekdays: s.rule === 'weekdays' ? s.weekdays : null, night: s.rule === 'cycle' ? Number(s.night) : null,
        every: s.rule === 'every' ? Number(s.every) : null, start: s.rule === 'every' ? s.start || null : null,
        item_id: s.item_id === '' ? null : Number(s.item_id), wait_seconds: s.wait_seconds === '' ? null : Number(s.wait_seconds),
        nums: f.kind === 'workout' ? sentNumbers(s.nums) : null,
      })),
    })),
  };
}

/** The optional numbers of a workout step (sets, reps, a weight, minutes, a distance). Blank ones are not kept: a step with none is a plain checklist step. */
function NumbersEditor({ nums, onChange }) {
  const set = (patch) => onChange({ ...nums, ...patch });
  const small = 'mt-0.5 block min-h-[44px] w-20 max-w-full rounded-xl border border-life-200 bg-card px-3 py-2 text-sm text-gray-800 focus:border-life-500 focus:outline-none focus:ring-2 focus:ring-life-200 dark:border-life-700 dark:bg-life-800 dark:text-life-50';
  const box = (key, label) => (
    <label className="block text-xs text-gray-600 dark:text-life-200">{label}
      <input type="number" inputMode="decimal" min="0" step={key === 'sets' || key === 'reps' ? '1' : 'any'} value={nums[key]} onChange={(e) => set({ [key]: e.target.value })} aria-label={label} className={small} />
    </label>
  );
  const unit = (key, choices, label) => (
    <label className="block text-xs text-gray-600 dark:text-life-200">Unit
      <select value={nums[key]} onChange={(e) => set({ [key]: e.target.value })} aria-label={label} className={small.replace('w-20 ', '')}>
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
  return (
    <div data-step-numbers>
      <p className="text-xs text-gray-500 dark:text-life-300">Numbers, if you want them (leave blank for a plain step)</p>
      <div className="flex flex-wrap items-end gap-2">
        {box('sets', 'Sets')}{box('reps', 'Reps')}{box('weight', 'Weight')}{unit('weight_unit', ['lb', 'kg'], 'Weight unit')}
        {box('minutes', 'Minutes')}{box('distance', 'Distance')}{unit('distance_unit', ['mi', 'km'], 'Distance unit')}
      </div>
    </div>
  );
}

function StepEditor({ step, cycle, items, onChange, onRemove, canRemove, workout }) {
  const set = (patch) => onChange({ ...step, ...patch });
  return (
    <div className="space-y-2 rounded-lg bg-life-50/70 p-2 dark:bg-life-700/60" data-routine-step>
      <input value={step.words} onChange={(e) => set({ words: e.target.value })} placeholder={workout ? 'Goblet squat' : 'Wash your face'} aria-label="Step" className={control} />
      {workout && <NumbersEditor nums={step.nums} onChange={(nums) => set({ nums })} />}
      <div className="flex flex-wrap items-center gap-2">
        <select value={step.rule} onChange={(e) => set({ rule: e.target.value, night: e.target.value === 'cycle' ? (step.night || 1) : '', weekdays: e.target.value === 'weekdays' ? step.weekdays : [] })} aria-label="Days" className={`${control} w-auto`}>
          <option value="daily">Every day</option>
          <option value="weekdays">Some days of the week</option>
          <option value="every">Every few days</option>
          {cycle && <option value="cycle">A night of the cycle</option>}
        </select>
        {step.rule === 'cycle' && (
          <select value={step.night} onChange={(e) => set({ night: Number(e.target.value) })} aria-label="Night of the cycle" className={`${control} w-auto`}>
            {Array.from({ length: Number(cycle) }, (_, i) => <option key={i + 1} value={i + 1}>Night {i + 1} of {cycle}</option>)}
          </select>
        )}
      </div>
      {step.rule === 'every' && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-every>
          <label className="flex items-center gap-2">Every
            <input type="number" inputMode="numeric" min="2" max="30" value={step.every} onChange={(e) => set({ every: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="How many days apart" className={`${control} !w-20`} />
            days</label>
          <label className="flex items-center gap-2">starting
            <input type="date" value={step.start} onChange={(e) => set({ start: e.target.value })} aria-label="Starting day" className={`${control} !w-auto`} />
          </label>
          <span className="w-full text-xs text-gray-500 dark:text-life-300">2 is every other day. A day you miss is just missed; the next one is still on the calendar.</span>
        </div>
      )}
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

export function RoutineForm({ routine, me, people, items, onDone, onGone, startWho, startKind }) {
  const [f, setF] = useState(() => formOf(routine, me, startWho, startKind));
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
  const workout = f.kind === 'workout';
  return (
    <form onSubmit={save} className="space-y-4">
      {workout && <p className="text-sm text-gray-700 dark:text-life-100" data-kind="workout">A workout: its steps can carry numbers, and each shows what you did last time. It starts as yours alone; pick someone else below to share it.</p>}
      <Field label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={workout ? 'Leg day' : 'Skincare'} aria-label="Name of the routine" className={control} /></Field>
      <Field label="Whose is it?">
        <select value={f.who} onChange={(e) => set({ who: e.target.value })} aria-label="Whose is it" className={control}>
          <option value="me">Mine: shows on my front page</option>
          <option value="everyone">Everyone's: shows on every front page</option>
          {people.users.filter((u) => u.id !== me).map((u) => <option key={`u${u.id}`} value={`u${u.id}`}>{u.name}'s: shows on their front page</option>)}
          {people.members.map((m) => <option key={`m${m.id}`} value={`m${m.id}`}>{m.name} (household): shows on the chore chart</option>)}
          {(people.pets ?? []).map((p) => <option key={`p${p.id}`} value={`p${p.id}`}>{p.name} (pet): shows on every front page</option>)}
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
              <StepEditor key={n} step={s} cycle={f.cycle_length} items={items} canRemove={t.steps.length > 1} workout={workout}
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
        {routine && sure && <button type="button" onClick={remove} className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white">Yes, delete it and what was checked off</button>}
        <button type="submit" className={`${buttonClass} ml-auto min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

/** Looking back at a workout: how many of the last 7 days, a month of days, and each numbered step's last few times. Nothing is judged. */
function History({ routine }) {
  const [h, setH] = useState(null);
  useEffect(() => { axios.get(`/api/routines/${routine.id}/history`).then(({ data }) => setH(data)).catch(() => setH(false)); }, [routine.id]);
  if (h === null) return <p className="text-sm text-gray-500 dark:text-life-300">Loading…</p>;
  if (h === false) return <p className="text-sm text-red-600">Couldn't load that</p>;
  return (
    <div className="space-y-4" data-history>
      <p className="text-lg font-semibold text-life-800 dark:text-life-50" data-last7>{h.last7_text}</p>
      <div>
        <p className="mb-1 text-xs text-gray-500 dark:text-life-300">The last 30 days, oldest first. A filled dot is a day something was done.</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="The last 30 days" data-dots>
          {h.days.map((d) => (
            <li key={d.day} data-day={d.day} data-done={d.done ? 'yes' : 'no'} title={`${d.day}: ${d.done ? 'done' : 'nothing'}`}
              className={`h-4 w-4 rounded-full border-2 border-life-500 ${d.done ? 'bg-life-600' : 'bg-transparent'}`}>
              <span className="sr-only">{d.day}: {d.done ? 'done' : 'nothing'}</span>
            </li>
          ))}
        </ul>
      </div>
      {h.steps.length === 0 && <p className="text-sm text-gray-600 dark:text-life-100">No step of this workout carries numbers yet.</p>}
      {h.steps.map((s) => (
        <section key={s.id} data-history-step={s.words}>
          <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">{s.words}</h3>
          {s.entries.length === 0 ? <p className="text-xs text-gray-500 dark:text-life-300">Nothing kept yet.</p> : (
            <ul className="mt-0.5 text-sm text-gray-700 dark:text-life-100">
              {s.entries.map((e) => <li key={e.day}>{e.label}: {e.words}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** The steps of a time that repeat every few days, in words ("Wet food every other day"), or nothing. */
export const everyLine = (t) => t.steps.filter((s) => s.rule === 'every').map((s) => `${s.words} ${s.days}`).join(', ');
export const timeLine = (t) => `${t.name}${t.at_words ? ` at ${t.at_words}` : ''}: ${t.steps.length} ${t.steps.length === 1 ? 'step' : 'steps'}, ${t.last7} of the last 7 days`;

export default function RoutinesPage() {
  const [looking, setLooking] = useState(null);
  const [list, setList] = useState(null);
  const [starters, setStarters] = useState([]);
  const [people, setPeople] = useState({ users: [], members: [], me: 0 });
  const [items, setItems] = useState([]);
  const [tag, setTag] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [startersOpen, setStartersOpen] = useState(null);
  // Today's routine times, for the printed morning and evening sheet.
  const [today, setToday] = useState([]);
  const sel = useSelecting();
  const load = useCallback(() => {
    axios.get('/api/routines', { params: { tag: tag || undefined } }).then(({ data }) => setList(data)).catch(() => setList([]));
    axios.get('/api/routines/starters').then(({ data }) => setStarters(data)).catch(() => {});
    axios.get('/api/routine-day').then(({ data }) => setToday(data)).catch(() => setToday([]));
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
  const offered = starters.filter((s) => !s.have && !s.pet);
  const done = () => { setModal(null); load(); };

  return (
    <div className="space-y-4">
      <SubChips items={ROUTINE_CHIPS} label="Routines and measures" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Routines</h1>
        <button type="button" onClick={() => setModal({ routine: null })} className={`${buttonClass} min-h-[44px]`}>+ New</button>
        <button type="button" onClick={() => setModal({ routine: null, kind: 'workout' })} className={`${quietButtonClass} min-h-[44px]`}>+ New workout</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100">Checklists for parts of the day. They show on the front page, where you check them off or go through one a step at a time. A workout is a routine whose steps can carry numbers.</p>
      <PrintMenu ways={[['routines', 'Print morning and evening']]} onPrint={() => setTimeout(() => window.print(), 60)}>
        <p className="text-sm text-gray-600 dark:text-life-100">One letter page: your morning and evening steps for today, each with a box to check by hand. Empty parts are blank lines to write on.</p>
      </PrintMenu>
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
                <p className="text-xs text-gray-500 dark:text-life-300">{r.kind === 'workout' ? 'Workout · ' : ''}{r.who_kind === 'me' ? 'For you' : r.who_kind === 'everyone' ? 'For everyone' : r.who_kind === 'member' ? `For ${r.who}, on the chore chart` : r.who_kind === 'pet' ? `For ${r.who}, on every front page` : `For ${r.who}`}{r.cycle_length ? ` · ${r.cycle_length}-night cycle` : ''}{r.points ? ` · ${r.points} points a time` : ''}</p>
              </div>
              {r.kind === 'workout' && <button type="button" onClick={() => setLooking(r)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Look back at ${r.name}`}>Look back</button>}
              {r.kind !== 'workout' && <FirstStep kind="routine" id={r.id} onChanged={load} />}
              {r.mine && <button type="button" onClick={() => setModal({ routine: r })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${r.name}`}>Change</button>}
            </div>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700 dark:text-life-100">
              {r.times.map((t) => <li key={t.id}>{timeLine(t)} · <span data-last-done>{lastDoneText(t.last_done, todayHere())}</span>{everyLine(t) && <span data-step-days>{' · '}{everyLine(t)}</span>}</li>)}
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
      <RoutineSheet times={today} />
      {modal && (
        <Modal title={modal.routine ? `Change ${modal.routine.name}` : modal.kind === 'workout' ? 'New workout' : 'New routine'} wide onClose={() => setModal(null)}>
          <RoutineForm routine={modal.routine} me={people.me} people={people} items={items} startKind={modal.kind} onDone={done} onGone={done} />
        </Modal>
      )}
      {looking && (
        <Modal title={`${looking.name}: looking back`} onClose={() => setLooking(null)}>
          <History routine={looking} />
        </Modal>
      )}
    </div>
  );
}

/**
 * A pet's routines, on the pet's page: today's checklists (anyone can tick; each tick says who and when), the routines
 * themselves to change, and ready-made ones to add ("Dog, daily"). Monthly meds are the pet's care, not routines.
 */
export function PetRoutines({ pet }) {
  const [times, setTimes] = useState(null);
  const [mine, setMine] = useState([]);
  const [starters, setStarters] = useState([]);
  const [people, setPeople] = useState({ users: [], members: [], pets: [], me: 0 });
  const [items, setItems] = useState([]);
  const [food, setFood] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    axios.get('/api/routine-day', { params: { pet: pet.id } }).then(({ data }) => setTimes(data)).catch(() => setTimes([]));
    axios.get('/api/routines').then(({ data }) => setMine(data.filter((r) => r.for_pet === pet.id))).catch(() => {});
    axios.get('/api/routines/starters', { params: { pet: pet.id } }).then(({ data }) => setStarters(data)).catch(() => {});
  }, [pet.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get('/api/routines/people').then(({ data }) => setPeople(data)).catch(() => {});
    axios.get('/api/things/items').then(({ data }) => setItems((Array.isArray(data) ? data : []).map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
  }, []);
  if (times === null) return null;
  const offered = starters.filter((s) => s.pet && !s.have && (pet.species === 'dog' || pet.species === 'cat' ? s.pet === pet.species : true));
  const add = async (slug) => {
    setError('');
    try { await axios.post('/api/routines/starters', { slug, for_pet: pet.id, food: food === '' ? null : Number(food) }); load(); } catch (err) { setError(errorMessage(err, "Couldn't add it")); }
  };
  const done = () => { setModal(null); load(); };
  return (
    <>
      <Checklists times={times} setTimes={setTimes} />
      <section className={`${cardClass} space-y-2`} aria-label="Routines" data-pet-routines>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">Routines</h2>
          <button type="button" onClick={() => setModal({ routine: null })} className="min-h-[44px] px-2 text-sm text-life-600 hover:underline dark:text-life-200">+ Make your own</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-life-300">A routine for {pet.name} shows on everyone's front page. Anyone can check off a step, and then everyone sees who did it and when. Monthly meds and flea treatment are in Care above, where Life Is reminds you.</p>
        {mine.length > 0 && (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {mine.map((r) => (
              <li key={r.id} className="py-2" data-routine={r.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-800 dark:text-life-50">{r.name}</span>
                  <button type="button" onClick={() => setModal({ routine: r })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${r.name}`}>Change</button>
                </div>
                <ul className="text-xs text-gray-600 dark:text-life-200">
                  {r.times.map((t) => <li key={t.id}>{timeLine(t)}{t.steps.some((s) => s.item) ? ` · uses ${[...new Set(t.steps.filter((s) => s.item).map((s) => s.item))].join(', ')}` : ''} · <span data-last-done>{lastDoneText(t.last_done, todayHere())}</span>{everyLine(t) && <span data-step-days>{' · '}{everyLine(t)}</span>}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {offered.length > 0 && (
          <div className="border-t border-life-50 pt-2 dark:border-life-700" role="group" aria-label={`Add a routine for ${pet.name}`}>
            <p className="text-sm font-medium text-gray-800 dark:text-life-50">Add a routine for {pet.name}</p>
            <label className="mt-1 block text-xs text-gray-600 dark:text-life-200">The food the feed steps use (so it can be marked running low)
              <select value={food} onChange={(e) => setFood(e.target.value)} aria-label="Food" className={`${control} mt-1`}>
                <option value="">None yet</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <ul className="mt-1 divide-y divide-life-50 dark:divide-life-700">
              {offered.map((s) => (
                <li key={s.slug} className="flex flex-wrap items-center gap-2 py-2" data-starter={s.slug}>
                  <div className="min-w-0 flex-1">
                    <span className="block break-words text-sm text-gray-800 dark:text-life-50">{s.name}</span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">{s.times.map((t) => `${t.name}: ${t.steps.map((x) => x.words.toLowerCase()).join(', ')}`).join(' · ')}</span>
                  </div>
                  <button type="button" onClick={() => add(s.slug)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Add ${s.name} for ${pet.name}`}>Add</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </section>
      {modal && (
        <Modal title={modal.routine ? `Change ${modal.routine.name}` : `New routine for ${pet.name}`} wide onClose={() => setModal(null)}>
          <RoutineForm routine={modal.routine} me={people.me} people={people} items={items} startWho={`p${pet.id}`} onDone={done} onGone={done} />
        </Modal>
      )}
    </>
  );
}
