import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Budget from '../components/Budget';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, minutesText } from '../components/ui';

const STATUSES = [['idea', 'An idea'], ['planned', 'Planned'], ['active', 'Working on it'], ['paused', 'Paused'], ['done', 'Finished'], ['dropped', 'Dropped']];
const statusName = (status) => (STATUSES.find(([id]) => id === status) || ['', status])[1];
const GROUPS = [['Working on it', ['active', 'paused']], ['Planned', ['planned']], ['Ideas', ['idea']], ['Finished', ['done']], ['Dropped', ['dropped']]];

/** Everything being made or done: what's in hand first, then what's planned, then ideas. */
export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [activities, setActivities] = useState([]);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    axios.get('/api/projects').then(({ data }) => setProjects(data)).catch(() => setProjects([]));
    axios.get('/api/projects/activities').then(({ data }) => setActivities(data)).catch(() => {});
  }, []);
  if (!projects) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Projects</h1>
        <button type="button" onClick={() => setAdding(true)} className={buttonClass}>+ New project</button>
      </div>
      {projects.length === 0 && (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          No projects yet. A project is anything you make or do over more than a day: a dress, a sweater, a bookshelf, the spring planting.
          It lists what it uses from <Link to="/things" className="underline">your things</Link>, tells you what you're short of, and keeps the days you worked on it.
        </div>
      )}
      {GROUPS.map(([title, statuses]) => {
        const here = projects.filter((p) => statuses.includes(p.status));
        if (here.length === 0) return null;
        return (
          <section key={title} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{title}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {here.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className={`${cardClass} block hover:ring-life-300`}>
                  <div className="flex items-start gap-2">
                    <span className="flex-1 font-medium text-life-800 dark:text-life-50">{p.name}</span>
                    {p.status === 'paused' && <span className="rounded bg-gray-100 px-1.5 text-[11px] text-gray-600">paused</span>}
                    {p.short_count > 0 && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">short of {p.short_count}</span>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-life-300">
                    {[p.activity, p.due_on && !['done', 'dropped'].includes(p.status) && `for ${p.due_on}`, p.minutes > 0 && minutesText(p.minutes), p.finished_on && `finished ${p.finished_on}`].filter(Boolean).join(' · ')}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {adding && (
        <Modal title="A new project" onClose={() => setAdding(false)}>
          <ProjectForm project={{}} activities={activities} onDone={(p) => navigate(`/projects/${p.id}`)} />
        </Modal>
      )}
    </div>
  );
}

function ProjectForm({ project, activities, onDone }) {
  const [form, setForm] = useState({ name: project.name || '', activity: project.activity || '', status: project.status || 'idea', due_on: project.due_on || '', notes: project.notes || '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, activity: form.activity || null, status: form.status, due_on: form.due_on || null, notes: form.notes || null };
    try { onDone((project.id ? await axios.put(`/api/projects/${project.id}`, body) : await axios.post('/api/projects', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it is *"><input required autoFocus={!project.id} value={form.name} onChange={set('name')} placeholder="e.g. Linen shirt dress" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What kind of doing"><input list="project-activities" value={form.activity} onChange={set('activity')} placeholder="Sewing, Garden, House…" className={inputClass} /></Field>
        <Field label="Where it's at">
          <select value={form.status} onChange={set('status')} className={inputClass}>{STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </Field>
      </div>
      <datalist id="project-activities">{activities.map((a) => <option key={a} value={a} />)}</datalist>
      <Field label="Wanted by"><input type="date" value={form.due_on} onChange={set('due_on')} className={inputClass} /></Field>
      <Field label="Notes"><textarea rows={4} value={form.notes} onChange={set('notes')} placeholder="Measurements, changes to the pattern, what you'd do differently" className={inputClass} /></Field>
      {form.status === 'done' && project.status !== 'done' && <p className="text-xs text-gray-500 dark:text-life-300">Finishing takes what it hadn't used yet out of your things.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** One project: what it uses and what it's short of, the days it was worked on, and its notes. */
export function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(undefined);
  const [items, setItems] = useState([]);
  const [activities, setActivities] = useState([]);
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const load = useCallback(() => {
    axios.get(`/api/projects/${id}`).then(({ data }) => setProject(data)).catch(() => setProject(null));
    axios.get('/api/things/items').then(({ data }) => setItems(data)).catch(() => {});
    axios.get('/api/projects/activities').then(({ data }) => setActivities(data)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (project === undefined) return null;
  if (project === null) return <p className="text-sm text-gray-600 dark:text-life-200">That project isn't here. <Link to="/projects" className="underline">All projects</Link></p>;

  const open = !['done', 'dropped'].includes(project.status);
  // The things that are for this project's activity, and where each is.
  const doing = project.activity?.trim().toLowerCase();
  const gear = doing ? items.filter((t) => (t.activities || []).some((a) => a.toLowerCase() === doing)) : [];
  const byHand = (names) => (names?.length ? `Finished. Check these by hand, they couldn't be taken out of your things: ${names.join(', ')}.` : '');
  const saved = (data) => { setProject(data); setModal(null); setMessage(byHand(data.check_by_hand)); axios.get('/api/things/items').then(({ data: d }) => setItems(d)).catch(() => {}); };
  const setStatus = async (status) => {
    try {
      saved((await axios.put(`/api/projects/${id}`, { name: project.name, activity: project.activity, status, due_on: project.due_on, notes: project.notes })).data);
    } catch (err) { setMessage(errorMessage(err, "Couldn't save")); }
  };
  const use = async (line) => {
    try {
      const { data } = await axios.post(`/api/projects/lines/${line.id}/use`);
      saved(data);
      if (!data.taken) setMessage(`${line.label} is marked as used, but couldn't be taken out of your things. Change its amount there by hand.`);
    } catch (err) { setMessage(errorMessage(err, "Couldn't save")); }
  };
  const removeLine = async (line) => { saved((await axios.delete(`/api/projects/lines/${line.id}`)).data); };
  const removeSession = async (s) => { await axios.delete(`/api/projects/sessions/${s.id}`).catch(() => {}); load(); };
  const remove = async () => {
    if (!window.confirm(`Remove ${project.name}? What it had set aside is free again.`)) return;
    await axios.delete(`/api/projects/${id}`).catch(() => {});
    navigate('/projects');
  };

  return (
    <div className="space-y-4">
      <div>
        <Link to="/projects" className="text-xs text-life-600 hover:underline dark:text-life-200">← Projects</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-2xl font-semibold text-life-800 dark:text-life-50">{project.name}</h1>
          <select value={project.status} onChange={(e) => setStatus(e.target.value)} aria-label="Where it's at" className={inputClass.replace('w-full', 'w-auto')}>
            {STATUSES.map(([sid, label]) => <option key={sid} value={sid}>{label}</option>)}
          </select>
          <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Edit</button>
        </div>
        <p className="text-sm text-gray-500 dark:text-life-300">
          {[project.activity, project.due_on && `wanted by ${project.due_on}`, project.started_on && `started ${project.started_on}`, project.finished_on && `finished ${project.finished_on}`,
            project.minutes > 0 && `${minutesText(project.minutes)} so far`].filter(Boolean).join(' · ') || statusName(project.status)}
        </p>
      </div>
      {message && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">{message}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <section className={cardClass}>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">What it uses</h2>
            <button type="button" onClick={() => setModal('line')} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add</button>
          </div>
          {project.lines.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-life-200">Nothing yet. Add fabric with an amount to set it aside, or a pattern with no amount just to keep it with the project.</p>
          ) : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {project.lines.map((line) => (
                <li key={line.id} className="flex items-start gap-2 py-2">
                  <span className="flex-1">
                    <span className={`block text-sm ${line.used_on ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-life-50'}`}>{line.amount ? `${line.amount} · ` : ''}{line.item_id ? <Link to={`/things/${line.item_id}`} className="hover:underline">{line.label}</Link> : line.label}</span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">
                      {[line.used_on ? `used ${line.used_on}` : line.have === null ? (line.item_id === null && line.quantity === null ? null : "not one of your things yet") : `you have ${line.have}`,
                        line.place && `📍 ${line.place}`, line.note].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {line.short > 0 && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">short {line.short_text}</span>}
                  {open && !line.used_on && line.quantity !== null && line.item_id !== null && (
                    <button type="button" onClick={() => use(line)} className="text-xs text-life-600 hover:underline dark:text-life-200" title="Take this amount out of your things">Used it</button>
                  )}
                  <button type="button" onClick={() => removeLine(line)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Take ${line.label} off the project`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Budget project={project} onChange={setProject} />

        <section className={cardClass}>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Time on it</h2>
            <button type="button" onClick={() => setModal('session')} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add</button>
          </div>
          {project.sessions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-life-200">No time logged. Add a day you worked on it, and what you watched or listened to while you did.</p>
          ) : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {project.sessions.map((s) => (
                <li key={s.id} className="flex items-start gap-2 py-2">
                  <span className="flex-1">
                    <span className="block text-sm text-gray-800 dark:text-life-50">{s.day}{s.minutes != null ? ` · ${minutesText(s.minutes)}` : ''}</span>
                    {s.note && <span className="block text-xs text-gray-500 dark:text-life-300">{s.note}</span>}
                    {s.media.length > 0 && (
                      <span className="block text-xs text-gray-500 dark:text-life-300">with {s.media.map((m, i) => (
                        <span key={m.id}>{i > 0 && ', '}<Link to={`/media/${m.id}`} className="underline">{m.title}</Link></span>
                      ))}</span>
                    )}
                  </span>
                  <button type="button" onClick={() => removeSession(s)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Remove the time on ${s.day}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {gear.length > 0 && (
        <section className={cardClass} aria-label={`Gear for ${project.activity}`}>
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Your gear for {project.activity}</h2>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {gear.map((t) => (
              <li key={t.id} className="py-1.5 text-sm">
                <Link to={`/things/${t.id}`} className="flex items-baseline gap-2 hover:underline">
                  <span aria-hidden="true">{t.icon}</span>
                  <span className="flex-1 text-gray-800 dark:text-life-50">{t.name}</span>
                  <span className="text-xs text-gray-500 dark:text-life-300">{t.place ? `📍 ${t.place}` : 'no place'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {project.notes && (
        <section className={cardClass}>
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-life-100">{project.notes}</p>
        </section>
      )}
      <p className="text-right"><button type="button" onClick={remove} className="text-xs text-red-600 hover:underline">Remove this project</button></p>

      {modal === 'edit' && <Modal title={project.name} onClose={() => setModal(null)}><ProjectForm project={project} activities={activities} onDone={saved} /></Modal>}
      {modal === 'line' && <Modal title="What it uses" onClose={() => setModal(null)}><LineForm projectId={project.id} items={items} onDone={saved} /></Modal>}
      {modal === 'session' && <Modal title="Time on it" onClose={() => setModal(null)}><SessionForm projectId={project.id} onDone={saved} /></Modal>}
    </div>
  );
}

function LineForm({ projectId, items, onDone }) {
  const [form, setForm] = useState({ item_id: items[0] ? String(items[0].id) : '', label: '', quantity: '', unit: '', note: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const item = items.find((i) => String(i.id) === form.item_id);
  const kinds = [...new Set(items.map((i) => i.kind))];
  const submit = async (e) => {
    e.preventDefault();
    const body = { item_id: item ? item.id : null, label: item ? null : form.label, quantity: form.quantity === '' ? null : Number(form.quantity), unit: form.unit || null, note: form.note || null };
    try { onDone((await axios.post(`/api/projects/${projectId}/lines`, body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Which of your things">
        <select value={form.item_id} onChange={set('item_id')} className={inputClass}>
          {kinds.map((kind) => (
            <optgroup key={kind} label={kind}>
              {items.filter((i) => i.kind === kind).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.free != null ? `${i.free}${i.unit ? ` ${i.unit}` : ''} free` : 'some'})</option>)}
            </optgroup>
          ))}
          <option value="">Something I don't have yet</option>
        </select>
      </Field>
      {!item && <Field label="What it is *"><input required value={form.label} onChange={set('label')} placeholder="e.g. 9 inch zipper" className={inputClass} /></Field>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much it needs"><input type="number" min="0" step="any" value={form.quantity} onChange={set('quantity')} className={inputClass} /></Field>
        <Field label="Unit"><input value={form.unit} onChange={set('unit')} placeholder={item?.unit || ''} className={inputClass} /></Field>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">With an amount, that much is set aside for this project once it's planned. Leave it empty for something only used, not used up: a pattern, a tool.</p>
      <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="for the lining, view B…" className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Add</button></div>
    </form>
  );
}

function SessionForm({ projectId, onDone }) {
  const [form, setForm] = useState({ day: toDateInput(new Date()), hours: '', minutes: '', note: '' });
  const [error, setError] = useState('');
  // What kept the session company, from the collection: found by typing, checked to add.
  const [titles, setTitles] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [find, setFind] = useState('');
  useEffect(() => { axios.get('/api/media').then(({ data }) => setTitles(data)).catch(() => {}); }, []);
  const word = find.trim().toLowerCase();
  const offered = word ? titles.filter((m) => !chosen.includes(m.id) && [m.title, m.creator].some((v) => String(v ?? '').toLowerCase().includes(word))).slice(0, 6) : [];
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const total = form.hours === '' && form.minutes === '' ? null : Math.round(Number(form.hours || 0) * 60 + Number(form.minutes || 0));
    try { onDone((await axios.post(`/api/projects/${projectId}/sessions`, { day: form.day, minutes: total, note: form.note || null, media_ids: chosen })).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day *"><input required type="date" value={form.day} onChange={set('day')} className={inputClass} /></Field>
        <Field label="Hours"><input type="number" min="0" step="any" value={form.hours} onChange={set('hours')} className={inputClass} /></Field>
        <Field label="Minutes"><input type="number" min="0" step="1" value={form.minutes} onChange={set('minutes')} className={inputClass} /></Field>
      </div>
      <Field label="What you did"><input value={form.note} onChange={set('note')} placeholder="Cut out the bodice." className={inputClass} /></Field>
      {titles.length > 0 && (
        <div className="space-y-1">
          <Field label="Watched or listened to meanwhile, from your collection"><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a title" className={inputClass} /></Field>
          {offered.map((m) => (
            <button key={m.id} type="button" onClick={() => { setChosen([...chosen, m.id]); setFind(''); }} className="mr-1 rounded-full bg-white px-3 py-1 text-sm text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700">+ {m.title}{m.year ? ` (${m.year})` : ''}</button>
          ))}
          {chosen.map((id) => {
            const m = titles.find((t) => t.id === id);
            return <button key={id} type="button" onClick={() => setChosen(chosen.filter((c) => c !== id))} className="mr-1 rounded-full bg-life-600 px-3 py-1 text-sm text-white" aria-label={`Take off ${m?.title}`}>{m?.title} ✕</button>;
          })}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Add</button></div>
    </form>
  );
}
