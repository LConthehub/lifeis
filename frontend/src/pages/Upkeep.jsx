import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, minutesText } from '../components/ui';

const UNITS = [['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']];
export const KINDS = { job: ['Jobs', '🔧', 'Done'], bill: ['Bills', '💵', 'Paid'], renewal: ['Renewals', '📄', 'Renewed'], chore: ['Chores', '🧹', 'Done'] };
const KIND_ONE = { job: 'A job around the home', bill: 'A bill', renewal: 'A renewal (insurance, registration, a passport)', chore: 'A chore' };
const doneWord = (job) => KINDS[job.kind][2];
/** What all the bills and renewals come to in a month, each spread over its own round. */
const monthly = (jobs) => jobs.filter((j) => (j.kind === 'bill' || j.kind === 'renewal') && j.amount_cents && j.every)
  .reduce((n, j) => n + j.amount_cents / (j.every.n * { day: 1 / 30.44, week: 7 / 30.44, month: 1, year: 12 }[j.every.unit]), 0);
const number = (n) => Number(n).toLocaleString();
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const money = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

/** How often, in words: "every 3 months, or every 5,000 miles". */
export function scheduleText(job) {
  const parts = [];
  if (job.every) parts.push(`every ${job.every.n === 1 ? '' : `${job.every.n} `}${UNITS.find(([u]) => u === job.every.unit)[job.every.n === 1 ? 0 : 1]}`);
  if (job.every_reading) parts.push(`every ${number(job.every_reading)}${job.reading_unit ? ` ${job.reading_unit}` : ''}`);
  return parts.length ? parts.join(', or ') + (parts.length > 1 ? ', whichever comes first' : '') : 'when it needs it';
}

/** When it's due, in words, and how to colour it. */
export function dueText(job) {
  const d = job.due;
  const unit = job.reading_unit ? ` ${job.reading_unit}` : '';
  const byDays = d.days_left === null ? null
    : d.days_left < 0 ? `late by ${-d.days_left} day${d.days_left === -1 ? '' : 's'}`
      : d.days_left === 0 ? 'due today' : d.days_left === 1 ? 'due tomorrow' : d.days_left <= 30 ? `due in ${d.days_left} days` : `due ${dayText(d.next_day)}`;
  const byReading = d.reading_left === null ? null
    : d.reading_left < 0 ? `${number(-d.reading_left)}${unit} past` : d.reading_left === 0 ? 'due now' : `in ${number(d.reading_left)}${unit}`;
  // Whichever is more pressing comes first: the one with less of its gap left.
  const span = job.every ? job.every.n * { day: 1, week: 7, month: 30, year: 365 }[job.every.unit] : 1;
  const readingFirst = d.reading_left !== null && (d.days_left === null || d.reading_left / (job.every_reading || 1) < d.days_left / span);
  const text = (readingFirst ? [byReading, byDays] : [byDays, byReading]).filter(Boolean).join(' · ') || (d.state === 'unscheduled' ? 'no schedule' : 'no reading yet');
  return { text, tone: { overdue: 'bg-red-100 text-red-700', due: 'bg-honey-100 text-honey-700', soon: 'bg-honey-100 text-honey-700', later: 'bg-life-50 text-life-700', unscheduled: 'bg-gray-100 text-gray-600' }[d.state] };
}

export function DueBadge({ job }) {
  const { text, tone } = dueText(job);
  return <span className={`max-w-[9.5rem] shrink rounded px-1.5 py-0.5 text-right text-[11px] leading-tight ${tone}`} data-state={job.due.state}>{text}</span>;
}

/** The form of a name used to tell whether two are the same: case and spacing don't count. */
const nameKey = (name) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** What a job in a ready-made set says about when it is first due. */
const firstText = (job) => (job.first_due ? `first due ${dayText(job.first_due)}` : job.kind === 'renewal' ? 'the date is yours to set' : 'due as soon as you add it');

/** The ready-made sets: pick one, see its jobs, uncheck any, add. A job already kept (by name) is not added twice. */
function ReadySets({ sets, jobs, onAdded }) {
  const [open, setOpen] = useState('');            // the slug of the set being looked at
  const [picked, setPicked] = useState({});        // slug -> the names left checked
  const [said, setSaid] = useState({});            // slug -> what happened when it was added
  const [busy, setBusy] = useState(false);
  const have = new Set(jobs.map((j) => nameKey(j.name)));
  const checked = (set) => picked[set.slug] ?? set.jobs.map((j) => j.name);
  const toggle = (set, name) => { const now = checked(set); setPicked({ ...picked, [set.slug]: now.includes(name) ? now.filter((n) => n !== name) : [...now, name] }); };
  const add = async (set) => {
    setBusy(true);
    try {
      const { data } = await axios.post('/api/things/upkeep/sets', { slug: set.slug, only: checked(set) });
      const s = (n) => (n === 1 ? '' : 's');
      setSaid({ ...said, [set.slug]: data.added === 0 ? `Nothing new was added: ${data.already} job${s(data.already)} already there.` : `Added ${data.added} job${s(data.added)}.${data.already ? ` ${data.already} ${data.already === 1 ? 'was' : 'were'} already there.` : ''}` });
      onAdded();
    } catch (err) { setSaid({ ...said, [set.slug]: errorMessage(err, "Couldn't add them") }); }
    setBusy(false);
  };
  return (
    <ul className="space-y-2">
      {sets.map((set) => {
        const here = open === set.slug;
        const mine = checked(set);
        const kept = set.jobs.filter((j) => have.has(nameKey(j.name))).length;
        return (
          <li key={set.slug} className="rounded-lg border border-life-100 dark:border-life-700" data-set={set.slug}>
            <button type="button" onClick={() => setOpen(here ? '' : set.slug)} aria-expanded={here} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-life-800 dark:text-life-50">{set.name}</span>
                <span className="block text-xs text-gray-500 dark:text-life-300">{set.about}</span>
              </span>
              <span className="shrink-0 text-xs text-gray-500 dark:text-life-300">{set.jobs.length} jobs{kept > 0 ? ` · ${kept} yours` : ''}</span>
              <span aria-hidden="true" className="shrink-0 text-life-600">{here ? '▾' : '▸'}</span>
            </button>
            {here && (
              <div className="space-y-2 border-t border-life-50 px-3 py-2 dark:border-life-700">
                <ul className="divide-y divide-life-50 dark:divide-life-700" aria-label={`Jobs in ${set.name}`}>
                  {set.jobs.map((j) => (
                    <li key={j.name}>
                      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-2">
                        <input type="checkbox" checked={mine.includes(j.name)} onChange={() => toggle(set, j.name)} className="mt-0.5 h-5 w-5 shrink-0 accent-life-600" />
                        <span className="min-w-0 flex-1 break-words">
                          <span className="block text-sm text-gray-800 dark:text-life-50"><span aria-hidden="true">{j.kind !== 'job' ? `${KINDS[j.kind][1]} ` : ''}</span>{j.name}{have.has(nameKey(j.name)) && <span className="ml-1 text-xs text-life-600 dark:text-life-200">(you have this)</span>}</span>
                          <span className="block text-xs text-gray-500 dark:text-life-300">{scheduleText({ every: j.every_n ? { n: j.every_n, unit: j.every_unit } : null, every_reading: j.every_reading, reading_unit: j.reading_unit })} · {firstText(j)}</span>
                          {j.note && <span className="block text-xs text-gray-500 dark:text-life-300">{j.note}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => add(set)} disabled={busy || mine.length === 0} className={`${buttonClass} min-h-[44px]`}>Add these {mine.length} job{mine.length === 1 ? '' : 's'}</button>
                  <button type="button" onClick={() => setPicked({ ...picked, [set.slug]: mine.length === set.jobs.length ? [] : set.jobs.map((j) => j.name) })} className={`${quietButtonClass} min-h-[44px]`}>{mine.length === set.jobs.length ? 'Uncheck all' : 'Check all'}</button>
                </div>
                {said[set.slug] && <p className="text-sm text-life-700 dark:text-life-100" role="status">{said[set.slug]}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const GROUPS = [['Late or due', ['overdue', 'due']], ['Coming up', ['soon']], ['Later', ['later']], ['When it needs it', ['unscheduled']]];

/** Every upkeep job, the most pressing first, with the common ones to start from when there are none. */
export default function UpkeepPage() {
  const [jobs, setJobs] = useState(null);
  const [starters, setStarters] = useState([]);
  const [sets, setSets] = useState([]);
  const [setsOpen, setSetsOpen] = useState(null);  // null until the person opens or closes the sets: then open when there are no jobs yet
  const [modal, setModal] = useState(null);       // { job: {} } to make one, { done: job } to mark one done
  const [kind, setKind] = useState('');           // '' for everything, or one kind
  const [scores, setScores] = useState(null);
  const [members, setMembers] = useState([]);
  const navigate = useNavigate();
  const load = useCallback(() => {
    axios.get('/api/things/upkeep').then(({ data }) => setJobs(data)).catch(() => setJobs([]));
    axios.get('/api/things/upkeep/scores').then(({ data }) => setScores(data)).catch(() => {});
    axios.get('/api/things/upkeep/members').then(({ data }) => setMembers(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); axios.get('/api/things/upkeep/starters').then(({ data }) => setStarters(data)).catch(() => {}); axios.get('/api/things/upkeep/sets').then(({ data }) => setSets(data)).catch(() => {}); }, [load]);
  if (!jobs) return null;
  const have = new Set(jobs.map((j) => j.name.toLowerCase()));
  const addStarter = async (s) => { const { data } = await axios.post('/api/things/upkeep', s); if (s.kind === 'bill' || s.kind === 'renewal') navigate(`/things/upkeep/${data.id}?edit=1`); else load(); };
  const shown = jobs.filter((j) => !kind || j.kind === kind);
  const offered = starters.filter((s) => !have.has(s.name.toLowerCase()) && (!kind || (s.kind ?? 'job') === kind));
  const perMonth = monthly(jobs);
  const chip = (active) => `rounded-full px-3 py-1 text-sm ${active ? 'bg-life-600 text-white' : 'bg-white text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Upkeep</h1>
        <button type="button" onClick={() => setModal({ job: { kind: kind || 'job' } })} className={buttonClass}>+ New</button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to show">
        <button type="button" onClick={() => setKind('')} aria-pressed={!kind} className={chip(!kind)}>Everything <span className="opacity-70">{jobs.length || ''}</span></button>
        {Object.entries(KINDS).map(([k, [label, icon]]) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={chip(kind === k)}>{icon} {label} <span className="opacity-70">{jobs.filter((j) => j.kind === k).length || ''}</span></button>
        ))}
      </div>
      {(!kind || kind === 'bill' || kind === 'renewal') && perMonth > 0 && (
        <p className="text-sm text-gray-700 dark:text-life-100" data-monthly>Your bills and renewals come to about <span className="font-semibold">{money(Math.round(perMonth))}</span> a month.</p>
      )}
      {scores && (kind === 'chore' || (!kind && scores.people.length > 0)) && (
        <section className={cardClass} aria-label="Chores this week">
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Chores this week</h2>
          {scores.people.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">Nobody has done one yet this week.</p>}
          <ul className="space-y-1">
            {scores.people.map((p, i) => (
              <li key={p.name} className="flex items-baseline gap-2 text-sm">
                <span className="flex-1 text-gray-800 dark:text-life-50">{i === 0 && p.this_week > (scores.people[1]?.this_week ?? 0) ? '🏆 ' : ''}{p.name} <span className="text-xs text-gray-500 dark:text-life-300">{p.done} done{p.last_week ? ` · ${p.last_week} points last week` : ''}</span></span>
                <span className="font-semibold text-life-700 dark:text-life-100">{p.this_week} point{p.this_week === 1 ? '' : 's'}{scores.point_cents ? <span className="font-normal text-gray-600 dark:text-life-200"> · {money(p.this_week * scores.point_cents)}</span> : null}</span>
              </li>
            ))}
          </ul>
          {kind === 'chore' && <Family members={members} setMembers={setMembers} pointCents={scores.point_cents} onPoints={setScores} />}
        </section>
      )}
      {jobs.length === 0 && (
        <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          Everything that comes round again: jobs like the furnace filter and the oil, bills and renewals like the rent and the car registration, and chores.
          Say how often and what each needs. Life Is tells you when each is due, and keeps every time it was done.
        </p>
      )}
      {GROUPS.map(([title, states]) => {
        const here = shown.filter((j) => states.includes(j.due.state));
        if (!here.length) return null;
        return (
          <section key={title} className={cardClass} aria-label={title}>
            <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">{title}</h2>
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {here.map((j) => (
                <li key={j.id} className="flex items-center gap-2 py-2">
                  <Link to={`/things/upkeep/${j.id}`} className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-800 hover:underline dark:text-life-50"><span aria-hidden="true">{j.kind !== 'job' ? `${KINDS[j.kind][1]} ` : ''}</span>{j.name}</span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">
                      {[j.amount_cents != null && money(j.amount_cents), j.autopay && 'pays itself', j.points != null && `${j.points} point${j.points === 1 ? '' : 's'}`, j.item?.name, j.activity, (j.member ?? j.assigned_to) && `${(j.member ?? j.assigned_to).name} does it`, !j.mine && `${j.owner}'s`].filter(Boolean).join(' · ') || scheduleText(j)}
                    </span>
                  </Link>
                  <DueBadge job={j} />
                  <button type="button" onClick={() => setModal({ done: j })} aria-label={`${j.name} ${doneWord(j).toLowerCase()}`} className="shrink-0 rounded-full border border-life-200 px-2.5 py-1 text-xs text-life-700 hover:bg-life-50 dark:border-life-700 dark:text-life-100">✓ {doneWord(j)}</button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {sets.length > 0 && !kind && (
        <details className={cardClass} role="region" aria-label="Ready-made sets" open={setsOpen ?? jobs.length === 0} onToggle={(e) => setSetsOpen(e.currentTarget.open)}>
          <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-life-800 dark:text-life-50">Add a ready-made set</summary>
          <p className="mb-2 text-xs text-gray-500 dark:text-life-300">Each set is a group of jobs and renewals for an American household. Look inside, uncheck what you don't need, then add it. You can change or remove each one afterward. Dates that vary by state or plan are left for you to set.</p>
          <ReadySets sets={sets} jobs={jobs} onAdded={load} />
        </details>
      )}
      {offered.length > 0 && (
        <details className={cardClass} role="region" aria-label="Common jobs" open={shown.length === 0 || Boolean(kind)} key={`${kind}-${shown.length === 0}`}>
          <summary className="cursor-pointer font-semibold text-life-800 dark:text-life-50">Common ones to start from <span className="text-sm font-normal text-gray-500 dark:text-life-300">{offered.length}</span></summary>
          <p className="mb-2 mt-1 text-xs text-gray-500 dark:text-life-300">Add one, then say when it's due and what it needs or costs.</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {offered.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 text-gray-800 dark:text-life-50"><span aria-hidden="true">{KINDS[s.kind ?? 'job'][1]} </span>{s.name} <span className="text-xs text-gray-500 dark:text-life-300">{scheduleText({ every: s.every_n ? { n: s.every_n, unit: s.every_unit } : null, every_reading: s.every_reading, reading_unit: s.reading_unit })}</span></span>
                <button type="button" onClick={() => addStarter(s)} className="text-xs text-life-600 hover:underline dark:text-life-200">Add</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {modal?.job && <Modal title="Something that comes round again" wide onClose={() => setModal(null)}><JobForm job={modal.job} onDone={(j) => navigate(`/things/upkeep/${j.id}`)} /></Modal>}
      {modal?.done && <Modal title={`${modal.done.name}: ${doneWord(modal.done).toLowerCase()}`} onClose={() => setModal(null)}><DoneForm job={modal.done} onDone={() => { setModal(null); load(); }} /></Modal>}
    </div>
  );
}

/** One job: what it needs and where those things are, its steps, and each time it was done. */
export function JobPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [job, setJob] = useState(undefined);
  const [modal, setModal] = useState(() => (new URLSearchParams(window.location.search).get('edit') ? 'edit' : null));       // 'edit', 'done' or 'reading'
  const [said, setSaid] = useState('');
  const load = useCallback(() => { axios.get(`/api/things/upkeep/${id}`).then(({ data }) => setJob(data)).catch(() => setJob(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (job === undefined) return null;
  if (job === null) return <Navigate to="/things/upkeep" replace />;
  const remove = async () => {
    if (!window.confirm(`Remove "${job.name}" and every time it was done?`)) return;
    await axios.delete(`/api/things/upkeep/${id}`);
    navigate('/things/upkeep');
  };
  const undo = async (d) => { if (window.confirm(`Take back ${dayText(d.day)}?`)) setJob((await axios.delete(`/api/things/upkeep/done/${d.id}`)).data); };
  const steps = (job.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      <Link to="/things/upkeep" className="text-sm text-life-600 hover:underline dark:text-life-200">← Upkeep</Link>
      <section className={`${cardClass} space-y-2`}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="mr-auto min-w-0">
            <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">{job.name}</h1>
            <p className="text-sm text-gray-600 dark:text-life-100">
              {job.item && <>For <Link to={`/things/${job.item.id}`} className="underline">{job.item.name}</Link> · </>}
              {scheduleText(job)}{job.amount_cents != null && <> · {money(job.amount_cents)} each time</>}{job.autopay && ' · pays itself'}{job.points != null && <> · {job.points} point{job.points === 1 ? '' : 's'}</>}
            </p>
            <p className="text-xs text-gray-500 dark:text-life-300">
              {[job.activity, job.assigned_to ? `${job.assigned_to.name} usually does it` : null, !job.mine && `${job.owner}'s job`,
                job.last_done && `last done ${dayText(job.last_done.day)}${job.last_done.reading !== null ? ` at ${number(job.last_done.reading)}${job.reading_unit ? ` ${job.reading_unit}` : ''}` : ''}`,
                job.due.latest_reading !== null && `now ${number(job.due.latest_reading)}${job.reading_unit ? ` ${job.reading_unit}` : ''}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <DueBadge job={job} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setModal('done')} className={buttonClass}>✓ {doneWord(job)}</button>
          {job.every_reading && <button type="button" onClick={() => setModal('reading')} className={quietButtonClass}>Note the {job.reading_unit || 'reading'}</button>}
          {job.mine && <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Change</button>}
        </div>
        {said && <p className="text-sm text-life-700 dark:text-life-100" role="status">{said}</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cardClass} aria-label="What it needs">
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">What it needs</h2>
          {job.tools.length === 0 && job.supplies.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing listed. {job.mine && <button type="button" onClick={() => setModal('edit')} className="underline">Add tools and supplies</button>}</p> : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {job.tools.map((t) => (
                <li key={`t${t.id}`} className="py-1.5 text-sm">
                  <Link to={`/things/${t.id}`} className="flex items-baseline gap-2 hover:underline">
                    <span aria-hidden="true">🔧</span><span className="flex-1 text-gray-800 dark:text-life-50">{t.name}</span>
                    <span className="text-xs text-gray-500 dark:text-life-300">{t.place ? `📍 ${t.place}` : 'no place'}</span>
                  </Link>
                </li>
              ))}
              {job.supplies.map((s) => (
                <li key={`s${s.id}`} className="py-1.5 text-sm">
                  <Link to={`/things/${s.item_id}`} className="flex items-baseline gap-2 hover:underline">
                    <span aria-hidden="true">📦</span>
                    <span className="flex-1 text-gray-800 dark:text-life-50">{s.name} <span className="text-xs text-gray-500 dark:text-life-300">uses {s.amount}</span></span>
                    <span className={`text-xs ${s.low ? 'text-honey-700' : 'text-gray-500 dark:text-life-300'}`}>have {s.have}{s.low ? ', low' : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {steps.length > 0 && (
          <section className={cardClass} aria-label="Steps">
            <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Steps</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-800 dark:text-life-50">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </section>
        )}
      </div>
      {job.note && <p className={`${cardClass} whitespace-pre-line text-sm text-gray-700 dark:text-life-100`}>{job.note}</p>}

      <section className={cardClass} aria-label="Each time it was done">
        <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Each time it was done</h2>
        {job.done.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Not yet.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {job.done.map((d) => (
              <li key={d.id} className="flex items-baseline gap-2 py-1.5 text-sm">
                <span className="w-28 shrink-0 text-gray-800 dark:text-life-50">{dayText(d.day)}</span>
                <span className="min-w-0 flex-1 text-xs text-gray-600 dark:text-life-200">
                  {[d.by, d.points != null && `${d.points} point${d.points === 1 ? '' : 's'}`, d.reading !== null && `${number(d.reading)}${job.reading_unit ? ` ${job.reading_unit}` : ''}`, d.minutes !== null && minutesText(d.minutes), d.cost_cents !== null && money(d.cost_cents), d.note].filter(Boolean).join(' · ')}
                </span>
                <button type="button" onClick={() => undo(d)} aria-label={`Take back ${d.day}`} className="text-xs text-gray-400 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {job.mine && <p className="text-right"><button type="button" onClick={remove} className="text-xs text-red-600 hover:underline">Remove this</button></p>}

      {modal === 'edit' && <Modal title={job.name} wide onClose={() => setModal(null)}><JobForm job={job} onDone={(j) => { setModal(null); setJob({ ...job, ...j }); load(); }} /></Modal>}
      {modal === 'done' && (
        <Modal title={`${job.name}: ${doneWord(job).toLowerCase()}`} onClose={() => setModal(null)}>
          <DoneForm job={job} onDone={(r) => {
            setModal(null);
            setJob({ ...r.job, done: r.done });
            setSaid([r.to_buy.length && `Added to the shopping list: ${r.to_buy.join(', ')}.`, r.check_by_hand.length && `Change how much is left of ${r.check_by_hand.join(', ')} by hand: it's kept in another measure.`].filter(Boolean).join(' '));
          }} />
        </Modal>
      )}
      {modal === 'reading' && <Modal title={`The ${job.reading_unit || 'reading'} now`} onClose={() => setModal(null)}><ReadingForm job={job} onDone={(j) => { setModal(null); setJob({ ...job, ...j }); }} /></Modal>}
    </div>
  );
}

/** A job: its name and what it's for, how often, who does it, and what it needs. */
function JobForm({ job, onDone }) {
  const making = !job.id;
  const [things, setThings] = useState([]);
  const [people, setPeople] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({
    kind: job.kind || 'job', amount: job.amount_cents != null ? (job.amount_cents / 100).toFixed(2) : '', points: job.points ?? '', autopay: Boolean(job.autopay),
    first_due: job.first_due || '',
    name: job.name || '', activity: job.activity || '', item_id: job.item?.id ?? '',
    every_n: job.every?.n ?? '', every_unit: job.every?.unit ?? 'month', by_time: job.id ? Boolean(job.every) : true,
    every_reading: job.every_reading ?? '', reading_unit: job.reading_unit || '', by_reading: Boolean(job.every_reading),
    assigned_to: job.member ? `m:${job.member.id}` : (job.assigned_to?.id ?? ''), steps: job.steps || '', note: job.note || '',
    tools: (job.tools || []).map((t) => t.id), supplies: (job.supplies || []).map((s) => ({ item_id: s.item_id, quantity: s.quantity ?? '', unit: s.unit || '' })),
    last_day: '', last_reading: '',
  });
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get('/api/things/items').then(({ data }) => setThings(data)).catch(() => {});
    axios.get('/api/things/upkeep/people').then(({ data }) => setPeople(data)).catch(() => {});
    axios.get('/api/things/upkeep/members').then(({ data }) => setMembers(data)).catch(() => {});
  }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const named = (id) => things.find((t) => t.id === Number(id));

  const submit = async (e) => {
    e.preventDefault();
    const dated = form.kind === 'bill' || form.kind === 'renewal';
    const body = {
      kind: form.kind, amount_cents: dated && form.amount.trim() !== '' ? Math.round(Number(form.amount.replace(/[^0-9.]/g, '')) * 100) : null,
      points: form.kind === 'chore' && form.points !== '' ? Number(form.points) : null, autopay: dated && form.autopay,
      ...(dated ? { first_due: form.first_due || null } : {}),
      name: form.name, activity: form.activity || null, item_id: form.item_id === '' ? null : Number(form.item_id),
      every_n: form.by_time && form.every_n !== '' ? Number(form.every_n) : null, every_unit: form.by_time && form.every_n !== '' ? form.every_unit : null,
      every_reading: form.by_reading && form.every_reading !== '' ? Number(form.every_reading) : null, reading_unit: form.by_reading ? form.reading_unit || null : null,
      assigned_to: form.assigned_to === '' || String(form.assigned_to).startsWith('m:') ? null : Number(form.assigned_to),
      assigned_member: String(form.assigned_to).startsWith('m:') ? Number(String(form.assigned_to).slice(2)) : null, steps: form.steps || null, note: form.note || null,
      tools: form.tools, supplies: form.supplies.map((s) => ({ item_id: s.item_id, quantity: s.quantity === '' ? null : Number(s.quantity), unit: s.unit || null })),
      ...(making && !dated && form.last_day ? { last_done: { day: form.last_day, reading: form.last_reading === '' ? null : Number(form.last_reading) } } : {}),
    };
    try { onDone((job.id ? await axios.put(`/api/things/upkeep/${job.id}`, body) : await axios.post('/api/things/upkeep', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };

  const dated = form.kind === 'bill' || form.kind === 'renewal';
  const example = { job: 'Change the furnace filter', bill: 'Electricity', renewal: 'Car registration', chore: 'Take out the trash' }[form.kind];
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What it is">
          <select value={form.kind} onChange={set('kind')} className={inputClass}>{Object.entries(KIND_ONE).map(([k, label]) => <option key={k} value={k}>{KINDS[k][1]} {label}</option>)}</select>
        </Field>
        <Field label="Its name *"><input required autoFocus={making} value={form.name} onChange={set('name')} placeholder={example} className={inputClass} /></Field>
        {dated && <Field label={form.kind === 'bill' ? 'Next due on' : 'Runs out on'}><input type="date" value={form.first_due} onChange={set('first_due')} className={inputClass} /></Field>}
        {dated && <Field label="What it costs each time"><input inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="0.00" className={inputClass} /></Field>}
        {form.kind === 'chore' && <Field label="Points for doing it"><input type="number" min="0" max="1000" step="1" value={form.points} onChange={set('points')} placeholder="2" className={inputClass} /></Field>}
        <Field label="Part of (an activity)"><input value={form.activity} onChange={set('activity')} placeholder="Home maintenance, Car, Garden" className={inputClass} /></Field>
        <Field label="It's for">
          <select value={form.item_id} onChange={set('item_id')} className={inputClass}>
            <option value="">Nothing in particular</option>
            {things.map((t) => <option key={t.id} value={t.id}>{t.name}{t.place ? ` (${t.place})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Usually done by">
          <select value={form.assigned_to} onChange={set('assigned_to')} className={inputClass}>
            <option value="">Anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {members.map((p) => <option key={`m${p.id}`} value={`m:${p.id}`}>{p.name}</option>)}
          </select>
        </Field>
      </div>

      <fieldset className="space-y-2 rounded-lg bg-life-50 p-3 dark:bg-life-700">
        <legend className="sr-only">How often</legend>
        <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
          <input type="checkbox" checked={form.by_time} onChange={(e) => setForm({ ...form, by_time: e.target.checked })} className="accent-life-600" /> Every
          <input type="number" min="1" step="1" value={form.every_n} onChange={set('every_n')} disabled={!form.by_time} aria-label="How many" className={`${inputClass} !w-20`} />
          <select value={form.every_unit} onChange={set('every_unit')} disabled={!form.by_time} aria-label="Days, weeks, months or years" className={`${inputClass} !w-28`}>
            {UNITS.map(([u, many]) => <option key={u} value={u}>{many}</option>)}
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
          <input type="checkbox" checked={form.by_reading} onChange={(e) => setForm({ ...form, by_reading: e.target.checked })} className="accent-life-600" /> {form.by_time ? 'or every' : 'Every'}
          <input type="number" min="0" step="any" value={form.every_reading} onChange={set('every_reading')} disabled={!form.by_reading} aria-label="How far between" className={`${inputClass} !w-28`} />
          <input value={form.reading_unit} onChange={set('reading_unit')} disabled={!form.by_reading} list="reading-units" aria-label="Measured in" placeholder="miles" className={`${inputClass} !w-28`} />
          <datalist id="reading-units">{['miles', 'km', 'hours', 'cycles'].map((u) => <option key={u} value={u} />)}</datalist>
        </label>
        {form.by_time && form.by_reading && <p className="text-xs text-gray-500 dark:text-life-300">Whichever comes first.</p>}
        {dated && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            <input type="checkbox" checked={form.autopay} onChange={(e) => setForm({ ...form, autopay: e.target.checked })} className="accent-life-600" /> It pays itself (a reminder that money is about to leave)
          </label>
        )}
        {making && !dated && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            Last done
            <input type="date" value={form.last_day} onChange={set('last_day')} aria-label="Last done" className={`${inputClass} !w-40`} />
            {form.by_reading && <input type="number" min="0" step="any" value={form.last_reading} onChange={set('last_reading')} aria-label="The reading then" placeholder={`at (${form.reading_unit || 'reading'})`} className={`${inputClass} !w-32`} />}
            <span className="text-xs text-gray-500 dark:text-life-300">Left empty: it's due now.</span>
          </div>
        )}
      </fieldset>

      {!dated && (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-gray-600 dark:text-life-200">Tools it needs</span>
          <div className="flex flex-wrap gap-1.5">
            {form.tools.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-life-50 px-2.5 py-0.5 text-sm text-life-700 dark:bg-life-700 dark:text-life-100">
                {named(id)?.name ?? '…'}
                <button type="button" onClick={() => setForm({ ...form, tools: form.tools.filter((t) => t !== id) })} aria-label={`Take ${named(id)?.name ?? 'it'} off`} className="text-gray-400 hover:text-red-600">✕</button>
              </span>
            ))}
          </div>
          <select value="" onChange={(e) => e.target.value && setForm({ ...form, tools: [...form.tools, Number(e.target.value)] })} aria-label="Add a tool" className={inputClass}>
            <option value="">+ Add a tool</option>
            {things.filter((t) => !form.tools.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-gray-600 dark:text-life-200">Supplies it uses up</span>
          {form.supplies.map((s, i) => (
            <div key={`${s.item_id}-${i}`} className="flex items-center gap-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-life-50">{named(s.item_id)?.name ?? '…'}</span>
              <input type="number" min="0" step="any" value={s.quantity} aria-label="How much" placeholder="how much"
                onChange={(e) => setForm({ ...form, supplies: form.supplies.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} className={`${inputClass} !w-20`} />
              <input value={s.unit} aria-label="Unit" placeholder={named(s.item_id)?.unit || 'unit'}
                onChange={(e) => setForm({ ...form, supplies: form.supplies.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} className={`${inputClass} !w-16`} />
              <button type="button" onClick={() => setForm({ ...form, supplies: form.supplies.filter((_, j) => j !== i) })} aria-label="Take it off" className="text-gray-400 hover:text-red-600">✕</button>
            </div>
          ))}
          <select value="" onChange={(e) => e.target.value && setForm({ ...form, supplies: [...form.supplies, { item_id: Number(e.target.value), quantity: 1, unit: '' }] })} aria-label="Add a supply" className={inputClass}>
            <option value="">+ Add a supply</option>
            {things.filter((t) => !form.supplies.some((s) => s.item_id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.amount})</option>)}
          </select>
        </div>
      </div>
      )}
      {!dated && <Field label="Steps, one on each line"><textarea rows={3} value={form.steps} onChange={set('steps')} className={inputClass} /></Field>}
      <Field label="Notes"><textarea rows={2} value={form.note} onChange={set('note')} placeholder={dated ? 'account number, who to call, where to pay' : 'filter size, part numbers, who to call'} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** The job done: when, the reading then, how long it took, what it cost, and whether that goes into spending. */
function DoneForm({ job, onDone }) {
  const dated = job.kind === 'bill' || job.kind === 'renewal';
  const [form, setForm] = useState({ day: toDateInput(new Date()), reading: '', minutes: '', cost: dated && job.amount_cents != null ? (job.amount_cents / 100).toFixed(2) : '', spend: dated, category_id: '', note: '' });
  const [categories, setCategories] = useState([]);
  const [members, setMembers] = useState([]);
  const [who, setWho] = useState(job.member ? String(job.member.id) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    axios.get('/api/money').then(({ data }) => setCategories(data.categories || [])).catch(() => {});
    if (job.kind === 'chore' && job.mine) axios.get('/api/things/upkeep/members').then(({ data }) => setMembers(data)).catch(() => {});
  }, [job.kind, job.mine]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    const cents = form.cost.trim() === '' ? null : Math.round(Number(form.cost.replace(/[^0-9.]/g, '')) * 100);
    try {
      onDone((await axios.post(`/api/things/upkeep/${job.id}/done`, {
        day: form.day, reading: form.reading === '' ? null : Number(form.reading), minutes: form.minutes === '' ? null : Number(form.minutes),
        cost_cents: cents, note: form.note || null, by_member: who === '' ? null : Number(who), spend: form.spend && cents ? { category_id: form.category_id === '' ? null : Number(form.category_id) } : null,
      })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't keep that")); setBusy(false); }
  };
  const gather = [...job.tools.map((t) => `${t.name}${t.place ? ` (${t.place})` : ''}`), ...job.supplies.map((s) => `${s.amount} ${s.name}`)];
  return (
    <form onSubmit={submit} className="space-y-3">
      {members.length > 0 && (
        <Field label="Who did it">
          <select value={who} onChange={(e) => setWho(e.target.value)} className={inputClass}>
            <option value="">Me</option>
            {members.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {gather.length > 0 && <p className="text-xs text-gray-600 dark:text-life-200">Each tool notes it was used for this; supplies come out of what you have. {gather.join(' · ')}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="When"><input type="date" required value={form.day} onChange={set('day')} className={inputClass} /></Field>
        {dated ? null : job.every_reading
          ? <Field label={`${job.reading_unit ? job.reading_unit[0].toUpperCase() + job.reading_unit.slice(1) : 'Reading'} then`}><input type="number" min="0" step="any" value={form.reading} onChange={set('reading')} placeholder={job.due.latest_reading !== null ? `last ${number(job.due.latest_reading)}` : ''} className={inputClass} /></Field>
          : <Field label="Minutes it took"><input type="number" min="0" step="1" value={form.minutes} onChange={set('minutes')} className={inputClass} /></Field>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={dated ? 'How much' : 'What it cost'}><input inputMode="decimal" value={form.cost} onChange={set('cost')} placeholder="0.00" className={inputClass} /></Field>
        {!dated && job.every_reading && <Field label="Minutes it took"><input type="number" min="0" step="1" value={form.minutes} onChange={set('minutes')} className={inputClass} /></Field>}
      </div>
      {form.cost.trim() !== '' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.checked })} className="accent-life-600" /> Put it in this month's spending</label>
          {form.spend && (
            <select value={form.category_id} onChange={set('category_id')} aria-label="Spending category" className={`${inputClass} !w-auto`}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      )}
      <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="what was found, the part used" className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Keeping it…' : doneWord(job)}</button></div>
    </form>
  );
}

/** A reading taken without doing the job: the car's miles today. */
function ReadingForm({ job, onDone }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onDone((await axios.post(`/api/things/upkeep/${job.id}/reading`, { value: Number(value) })).data); } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={`${job.reading_unit || 'Reading'} today${job.item ? `, on ${job.item.name}` : ''}`}>
        <input type="number" required min="0" step="any" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={job.due.latest_reading !== null ? `last ${number(job.due.latest_reading)}` : ''} className={inputClass} />
      </Field>
      {job.item && <p className="text-xs text-gray-500 dark:text-life-300">Every job for {job.item.name} goes by this reading.</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Keep it</button></div>
    </form>
  );
}

/** Who does chores without a sign-in of their own (children, mostly), and what a point is worth. */
function Family({ members, setMembers, pointCents, onPoints }) {
  const [name, setName] = useState('');
  const [worth, setWorth] = useState(pointCents ? (pointCents / 100).toFixed(2) : '');
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setError('');
    try { setMembers((await axios.post('/api/things/upkeep/members', { name })).data); setName(''); } catch (err) { setError(errorMessage(err, "Couldn't add them")); }
  };
  const remove = async (m) => {
    if (!window.confirm(`Take ${m.name} out of the household? What they did stays in each chore's history.`)) return;
    setMembers((await axios.delete(`/api/things/upkeep/members/${m.id}`)).data);
  };
  const saveWorth = async () => {
    const cents = worth.trim() === '' ? null : Math.round(Number(worth.replace(/[^0-9.]/g, '')) * 100);
    if (cents !== null && Number.isNaN(cents)) { setError('What a point is worth is a number, like 0.50'); return; }
    setError('');
    try { onPoints((await axios.put('/api/things/upkeep/points', { cents })).data); } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  return (
    <div className="mt-3 space-y-2 border-t border-life-50 pt-3 dark:border-life-700" data-family>
      <h3 className="text-xs font-medium text-gray-600 dark:text-life-200">Who does chores, without a sign-in of their own</h3>
      {members.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="In the household">
          {members.map((m) => (
            <li key={m.id} className="inline-flex items-center gap-1 rounded-full bg-life-50 px-2.5 py-0.5 text-sm text-life-700 dark:bg-life-700 dark:text-life-100">
              {m.name}<button type="button" onClick={() => remove(m)} aria-label={`Take ${m.name} out`} className="text-gray-400 hover:text-red-600">✕</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Their name" placeholder="A child's name" className={`${inputClass} !w-44`} />
        <button type="submit" disabled={!name.trim()} className={quietButtonClass}>Add</button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
        <label className="flex items-center gap-2">A point is worth
          <input inputMode="decimal" value={worth} onChange={(e) => setWorth(e.target.value)} onBlur={saveWorth} aria-label="What a point is worth" placeholder="0.00" className={`${inputClass} !w-24`} />
        </label>
        <span className="text-xs text-gray-500 dark:text-life-300">Left empty: points only.</span>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
