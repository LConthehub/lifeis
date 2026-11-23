import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { ScanSticker } from './Places';
import PlacePicker from '../components/PlacePicker';
import { kindChoices } from '../projectKinds';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
// The headings kinds sit under, in the order shown. Which heading a kind belongs to comes with the kind (its `group`).
const KIND_GROUPS = ['Cooking', 'Crafts', 'Workshop', 'Garage', 'Garden', 'Outdoors', 'Electronics', 'Music', 'Around the house', 'Clothes and linens'];

const OTHER = 'Other';

const TYPES = [['text', 'Text'], ['number', 'A number'], ['choice', 'A choice from a list'], ['yesno', 'Yes or no'], ['date', 'A date'], ['link', 'A link']];
const typeName = (type) => (TYPES.find(([id]) => id === type) || ['', type])[1];
const commaList = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

/** How a field's value reads in a list: "Yes", "45 min", "Flax". */
function shown(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'yesno') return value ? field.name : `not ${field.name.toLowerCase()}`;
  if (field.type === 'number') return `${value}${field.unit ? ` ${field.unit}` : ''}`;
  return String(value);
}

/** The ready-made sets, each with a button to add it. Shown big when there's nothing yet, small after. */
function Starters({ onAdded }) {
  const [starters, setStarters] = useState([]);
  const load = useCallback(() => { axios.get('/api/things/starters').then(({ data }) => setStarters(data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const add = async (slug) => { await axios.post('/api/things/starters', { slug }).catch(() => {}); load(); onAdded(); };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {starters.map((s) => {
        const all = s.kinds.every((k) => k.have);
        return (
          <section key={s.slug} className={cardClass}>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <h3 className="font-semibold text-life-800 dark:text-life-50">{s.name}</h3>
                <p className="text-sm text-gray-600 dark:text-life-200">{s.about}</p>
              </div>
              <button type="button" disabled={all} onClick={() => add(s.slug)} className={quietButtonClass}>{all ? 'Added' : 'Add'}</button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-life-300">{s.kinds.map((k) => `${k.icon} ${k.name}`).join('  ·  ')}</p>
          </section>
        );
      })}
    </div>
  );
}

/** Everything you keep: by kind, found by a word, with where it is and how much is free. */
export default function Things() {
  const [kinds, setKinds] = useState(null);
  const [places, setPlaces] = useState([]);
  const [items, setItems] = useState([]);
  const [group, setGroup] = useState(null);
  const [kind, setKind] = useState(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    axios.get('/api/things/kinds').then(({ data }) => setKinds(data)).catch(() => setKinds([]));
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
    axios.get('/api/things/items', { params: { tag: tag || undefined } }).then(({ data }) => setItems(data)).catch(() => setItems([]));
  }, [tag]);
  useEffect(() => { load(); }, [load]);
  if (!kinds) return null;

  if (kinds.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Things</h1>
        <div className={cardClass}>
          <p className="text-sm text-gray-700 dark:text-life-100">Keep track of anything: fabric, yarn, tools, seeds, board games. First say what kinds of things you keep.
            Start from a ready-made set and change it to suit you, or <Link to="/things/kinds" className="underline">make your own kind</Link> from nothing.</p>
        </div>
        <Starters onAdded={load} />
      </div>
    );
  }

  // Kinds are filed under a few plain headings, worked out here from their names (the database doesn't keep which set a kind came from).
  const groupOf = (k) => k.group ?? OTHER;
  const groupNames = [...KIND_GROUPS, OTHER].filter((g) => kinds.some((k) => groupOf(k) === g));
  const grouped = groupNames.length > 1;
  const chosenGroup = grouped && groupNames.includes(group) ? group : null;
  const inGroup = kinds.filter((k) => chosenGroup === null || groupOf(k) === chosenGroup);
  const chosenKind = kind !== null && inGroup.some((k) => k.id === kind) ? kind : null;
  const pickGroup = (g) => { setGroup(g); setKind(null); };

  const word = q.trim().toLowerCase();
  const matches = (item) => !word || [item.name, item.note, item.place, ...Object.values(item.values)].some((v) => String(v ?? '').toLowerCase().includes(word));
  const shownItems = items.filter((i) => (chosenKind === null || i.kind_id === chosenKind) && inGroup.some((k) => k.id === i.kind_id) && matches(i));
  const low = items.filter((i) => i.low).map((i) => i.name);
  const chip = (on) => `min-h-[44px] rounded-full px-4 py-2 text-sm ${on ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`;
  const kindChips = (list, label, all) => (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {[{ id: null, name: all, items: list.reduce((n, k) => n + k.items, 0) }, ...list].map((k) => (
        <button key={k.id ?? 'all'} type="button" onClick={() => setKind(k.id)} aria-pressed={chosenKind === k.id} className={chip(chosenKind === k.id)}>
          {k.icon ? `${k.icon} ` : ''}{k.name} <span className="opacity-80">{k.items}</span>
        </button>
      ))}
    </div>
  );
  // The cards for the kinds in one list, each under its own heading (one level below the group's, when there is one).
  const cards = (list, Heading) => (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((k) => {
        const here = shownItems.filter((i) => i.kind_id === k.id);
        if (here.length === 0) return null;
        return (
          <section key={k.id} className={cardClass}>
            <Heading className="mb-1 font-semibold text-life-800 dark:text-life-50">{k.icon ? `${k.icon} ` : ''}{k.name}</Heading>
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {here.map((item) => {
                const details = k.fields.map((f) => shown(f, item.values[f.id])).filter(Boolean).slice(0, 4);
                return (
                  <li key={item.id} className="flex items-start">
                    <PickBox sel={sel} id={item.id} name={item.name} />
                    <div className="min-w-0 flex-1">
                    <Link to={`/things/${item.id}`} className="flex w-full items-start gap-2 py-2 text-left">
                      <span className="flex-1">
                        <span className="block text-sm text-gray-800 dark:text-life-50">{item.name}</span>
                        {(details.length > 0 || item.place) && (
                          <span className="block text-xs text-gray-500 dark:text-life-300">{[...details, item.place && `📍 ${item.place}`].filter(Boolean).join(' · ')}</span>
                        )}
                        {item.set_aside > 0 && <span className="block text-xs text-life-600 dark:text-life-200">{item.set_aside} {item.unit || ''} set aside for projects</span>}
                      </span>
                      {item.low && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">low</span>}
                      <span className="text-sm text-gray-500 dark:text-life-300">{item.amount}</span>
                    </Link>
                    <TagChips tags={item.tag_list} className="pb-2" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
  const groupsShown = groupNames.filter((g) => chosenGroup === null || g === chosenGroup)
    .map((g) => ({ name: g, kinds: kinds.filter((k) => groupOf(k) === g && (chosenKind === null || k.id === chosenKind)) }))
    .map((g) => ({ ...g, count: shownItems.filter((i) => g.kinds.some((k) => k.id === i.kind_id)).length }))
    .filter((g) => g.count > 0);
  const groupItems = (g) => items.filter((i) => kinds.some((k) => k.id === i.kind_id && groupOf(k) === g)).length;
  const kindsOfChosen = chosenGroup ? kinds.filter((k) => groupOf(k) === chosenGroup) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Things</h1>
        {items.length > 0 && <Link to="/things/report" className={quietButtonClass}>🏠 Home inventory</Link>}
        <Link to="/things/kinds" className="px-1 py-2 text-sm text-life-600 underline dark:text-life-200">Manage kinds</Link>
        <button type="button" onClick={() => setEditing({ kind_id: chosenKind ?? inGroup[0].id })} className={buttonClass}>+ Add</button>
      </div>
      {low.length > 0 && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Running low: {low.join(', ')}.</p>}
      {grouped ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Part of the house or hobby">
            {/* A heading with nothing in it yet stays out of the row (unless it is the one picked), so a long list of
                interests does not fill the row with zeros. Its kinds are still in the Add form. */}
            {[{ name: 'Everything', id: null, count: items.length },
              ...groupNames.map((g) => ({ name: g, id: g, count: groupItems(g) })).filter((g) => g.count > 0 || g.id === chosenGroup)].map((g) => (
              <button key={g.name} type="button" onClick={() => pickGroup(g.id)} aria-pressed={chosenGroup === g.id} className={chip(chosenGroup === g.id)}>
                {g.name} <span className="opacity-80">{g.count}</span>
              </button>
            ))}
          </div>
          {kindsOfChosen.length > 1 && kindChips(kindsOfChosen, `Kind of thing in ${chosenGroup}`, `All ${chosenGroup}`)}
        </>
      ) : kindChips(kinds, 'Kind of thing', 'Everything')}
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find something" aria-label="Find a thing" className={`${inputClass} max-w-sm`} />}
        <TagFilter value={tag} onChange={setTag} />
        {items.length > 0 && <SelectButton sel={sel} />}
      </div>
      <BulkBar sel={sel} kind="thing" list={shownItems.map((i) => i.id)} noun="things" onDone={load} />
      {shownItems.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>{items.length === 0 && !tag ? 'Nothing here yet. Add the first thing you keep.' : 'Nothing matches.'}</div>
      ) : grouped ? (
        <div className="space-y-6">
          {groupsShown.map((g) => (
            <section key={g.name} aria-labelledby={`group-${g.name.replace(/\W+/g, '-')}`} className="space-y-2">
              <h2 id={`group-${g.name.replace(/\W+/g, '-')}`} className="text-lg font-semibold text-life-800 dark:text-life-50">
                {g.name} <span className="text-sm font-normal text-gray-500 dark:text-life-300">{g.count} {g.count === 1 ? 'thing' : 'things'}</span>
              </h2>
              {cards(g.kinds, 'h3')}
            </section>
          ))}
        </div>
      ) : cards(inGroup, 'h2')}
      {editing && (
        <Modal title={editing.id ? editing.name : 'Add a thing'} onClose={() => setEditing(null)}>
          <ItemForm item={editing} kinds={kinds} places={places} onPlaces={setPlaces} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

/** One input for a field, of the right sort for what the field is. */
function ValueInput({ field, value, onChange }) {
  if (field.type === 'choice') {
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">—</option>
        {field.choices.map((c) => <option key={c} value={c}>{c}</option>)}
        {value && !field.choices.includes(value) && <option value={value}>{value}</option>}
      </select>
    );
  }
  if (field.type === 'yesno') {
    return (
      <select value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'yes')} className={inputClass}>
        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    );
  }
  if (field.type === 'number') return <input type="number" step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
  if (field.type === 'date') return <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
  return <input type={field.type === 'link' ? 'url' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.type === 'link' ? 'https://' : ''} className={inputClass} />;
}

export function ItemForm({ item, kinds, places, onPlaces, onDone }) {
  const [form, setForm] = useState({
    kind_id: item.kind_id, name: item.name || '', quantity: item.quantity ?? '', unit: item.unit || '', place_id: item.place_id ?? '',
    low_at: item.low_at ?? '', note: item.note || '', values: { ...(item.values || {}) },
    activities: (item.activities || []).join(', '), barcode: item.barcode || '',
  });
  const [tags, setTags] = useState(item.tag_list || []);
  const [error, setError] = useState('');
  const kind = kinds.find((k) => k.id === Number(form.kind_id)) || kinds[0];
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of kind.fields) {
      const v = form.values[f.id];
      if (v !== undefined && v !== '' && v !== null) values[f.id] = f.type === 'number' ? Number(v) : v;
    }
    const body = { name: form.name, quantity: form.quantity === '' ? null : Number(form.quantity), unit: form.unit || null,
      place_id: form.place_id === '' ? null : Number(form.place_id), low_at: form.low_at === '' ? null : Number(form.low_at), note: form.note || null, values,
      activities: commaList(form.activities), barcode: form.barcode || null };
    try {
      const { data } = item.id ? await axios.put(`/api/things/items/${item.id}`, body) : await axios.post('/api/things/items', { ...body, kind_id: kind.id });
      await saveTags('thing', data.id, tags);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save"));
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${item.name}? Projects that used it keep its name.`)) return;
    await axios.delete(`/api/things/items/${item.id}`).catch(() => {});
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {!item.id && kinds.length > 1 && (
        <Field label="Kind of thing">
          <select value={form.kind_id} onChange={(e) => setForm({ ...form, kind_id: Number(e.target.value), values: {} })} className={inputClass}>
            {kinds.map((k) => <option key={k.id} value={k.id}>{k.icon ? `${k.icon} ` : ''}{k.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="What *"><input required autoFocus={!item.id} value={form.name} onChange={set('name')} placeholder="e.g. Blue linen" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much (empty: some)"><input type="number" min="0" step="any" value={form.quantity} onChange={set('quantity')} className={inputClass} /></Field>
        <Field label="Unit"><input list="thing-units" value={form.unit} onChange={set('unit')} placeholder={kind.unit || 'yd, m, skein, box…'} className={inputClass} /></Field>
      </div>
      <datalist id="thing-units">{['yd', 'm', 'cm', 'in', 'ft', 'g', 'kg', 'oz', 'lb', 'ml', 'l', 'skein', 'spool', 'packet', 'box', 'piece'].map((u) => <option key={u} value={u} />)}</datalist>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Where it is">
          <PlacePicker value={form.place_id} places={places} onPlaces={onPlaces} onChange={(id) => setForm((f) => ({ ...f, place_id: id }))} />
        </Field>
        <Field label="Running low at"><input type="number" min="0" step="any" value={form.low_at} onChange={set('low_at')} className={inputClass} /></Field>
      </div>
      {kind.fields.length > 0 && (
        <div className="grid grid-cols-2 gap-3 border-t border-life-100 pt-3 dark:border-life-700">
          {kind.fields.map((f) => (
            <Field key={f.id} label={`${f.name}${f.unit ? ` (${f.unit})` : ''}`}>
              <ValueInput field={f} value={form.values[f.id]} onChange={(v) => setForm({ ...form, values: { ...form.values, [f.id]: v } })} />
            </Field>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="What it's for (with commas between)"><input value={form.activities} onChange={set('activities')} placeholder={!item.id && kind.activity ? `${kind.activity}, from its kind` : 'Sewing, Camping'} className={inputClass} /></Field>
        <Field label="Barcode on it or its box"><input inputMode="numeric" value={form.barcode} onChange={set('barcode')} className={inputClass} /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} value={form.note} onChange={set('note')} className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      {item.set_aside > 0 && <p className="text-xs text-life-600 dark:text-life-200">{item.set_aside} {item.unit || ''} is set aside for projects, leaving {item.free} free.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {item.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button>
          : <Link to="/things/kinds" className="text-xs text-life-600 underline dark:text-life-200">Change this kind's fields</Link>}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}

// ==================== KINDS ====================

/** The kinds of things you keep, and the fields each one has. All of it is yours to change. */
export function KindsPage() {
  const [kinds, setKinds] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { axios.get('/api/things/kinds').then(({ data }) => setKinds(data)).catch(() => setKinds([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!kinds) return null;
  const done = (data) => { setKinds(data); setModal(null); setError(''); };
  const removeKind = async (k) => {
    if (!window.confirm(`Remove the kind "${k.name}" and its fields?`)) return;
    try { done((await axios.delete(`/api/things/kinds/${k.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  const removeField = async (f) => {
    if (!window.confirm(`Remove the field "${f.name}"? What was typed into it on every thing goes too.`)) return;
    try { done((await axios.delete(`/api/things/fields/${f.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <div className="space-y-4">
      <Link to="/things" className="inline-block py-2 text-sm text-life-600 underline dark:text-life-200">← Things</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Kinds of things</h1>
        <button type="button" onClick={() => setModal({ kind: {} })} className={buttonClass}>+ New kind</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-200">A kind is whatever you say it is, with the fields you care about. Rename anything, add fields, take them away.</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {kinds.map((k) => (
          <section key={k.id} className={cardClass}>
            <div className="flex items-center gap-2">
              <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{k.icon ? `${k.icon} ` : ''}{k.name}
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-life-300">{k.items} {k.items === 1 ? 'thing' : 'things'}{k.unit ? ` · counted in ${k.unit}` : ''}{k.activity ? ` · for ${k.activity}` : ''}</span></h2>
              <button type="button" onClick={() => setModal({ kind: k })} className="text-xs text-life-600 hover:underline dark:text-life-200">Edit</button>
              {k.items === 0 && <button type="button" onClick={() => removeKind(k)} className="text-xs text-gray-400 hover:text-red-600">Remove</button>}
            </div>
            <ul className="mt-2 divide-y divide-life-50 dark:divide-life-700">
              {k.fields.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <button type="button" onClick={() => setModal({ field: f })} className="flex-1 text-left text-gray-800 hover:underline dark:text-life-50">{f.name}</button>
                  <span className="text-xs text-gray-500 dark:text-life-300">{f.type === 'choice' ? f.choices.join(', ') : typeName(f.type)}{f.unit ? ` (${f.unit})` : ''}</span>
                  <button type="button" onClick={() => removeField(f)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Remove the field ${f.name}`}>✕</button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setModal({ field: { kind_id: k.id } })} className="mt-2 text-sm text-life-600 hover:underline dark:text-life-200">+ Add a field</button>
          </section>
        ))}
      </div>
      <h2 className="pt-2 font-semibold text-life-800 dark:text-life-50">Ready-made sets</h2>
      <Starters onAdded={load} />
      {modal?.kind && <Modal title={modal.kind.id ? modal.kind.name : 'A new kind of thing'} onClose={() => setModal(null)}><KindForm kind={modal.kind} onDone={done} onKinds={setKinds} /></Modal>}
      {modal?.field && <Modal title={modal.field.id ? modal.field.name : 'A new field'} onClose={() => setModal(null)}><FieldForm field={modal.field} onDone={done} /></Modal>}
    </div>
  );
}

function KindForm({ kind, onDone, onKinds }) {
  const [form, setForm] = useState({ name: kind.name || '', icon: kind.icon || '', unit: kind.unit || '', activity: kind.activity || '' });
  const [error, setError] = useState('');
  const [mine, setMine] = useState([]);        // the activities already in use
  const [lacking, setLacking] = useState(0);   // how many of this kind's things don't have the kind's activity yet
  const [applied, setApplied] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const countLacking = useCallback(() => {
    if (!kind.id || !kind.activity) { setLacking(0); return; }
    const want = kind.activity.trim().toLowerCase();
    axios.get('/api/things/items').then(({ data }) => setLacking(data.filter((i) => i.kind_id === kind.id && !(i.activities || []).some((a) => a.toLowerCase() === want)).length)).catch(() => setLacking(0));
  }, [kind.id, kind.activity]);
  useEffect(() => {
    axios.get('/api/things/activities').then(({ data }) => setMine(data.map((a) => a.name))).catch(() => {});
    countLacking();
  }, [countLacking]);
  const addToThings = async () => {
    try {
      const { data } = await axios.post(`/api/things/kinds/${kind.id}/activity`);
      setApplied(`Added ${kind.activity} to ${data.added} ${data.added === 1 ? 'thing' : 'things'}.`);
      setLacking(0);
      setError('');
      onKinds((await axios.get('/api/things/kinds')).data);
    } catch (err) { setError(errorMessage(err, "Couldn't add it")); }
  };
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, icon: form.icon || null, unit: form.unit || null, activity: form.activity.trim() || null };
    try { onDone((kind.id ? await axios.put(`/api/things/kinds/${kind.id}`, body) : await axios.post('/api/things/kinds', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it's called *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Board games" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="A picture (an emoji)"><input value={form.icon} onChange={set('icon')} placeholder="🎲" className={inputClass} /></Field>
        <Field label="Usually counted in"><input value={form.unit} onChange={set('unit')} placeholder="yd, skein, box… or nothing" className={inputClass} /></Field>
      </div>
      <Field label="What its things are usually for"><input list="kind-activities" value={form.activity} onChange={set('activity')} placeholder="Sewing, Woodworking, Home repair… or nothing" className={inputClass} /></Field>
      <datalist id="kind-activities">{kindChoices(mine).map((a) => <option key={a} value={a} />)}</datalist>
      <p className="text-xs text-gray-500 dark:text-life-300">A new thing of this kind starts out for it, so it shows up as gear on a project of that kind.</p>
      {kind.id && kind.activity && lacking > 0 && (
        <button type="button" onClick={addToThings} className={`${quietButtonClass} min-h-[44px]`}>Add this to the {lacking} {lacking === 1 ? 'thing' : 'things'} of this kind that {lacking === 1 ? "doesn't" : "don't"} have it</button>
      )}
      {applied && <p className="text-sm text-life-700 dark:text-life-100" role="status">{applied}</p>}
      {!kind.id && <p className="text-xs text-gray-500 dark:text-life-300">Add its fields after saving.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

function FieldForm({ field, onDone }) {
  const [form, setForm] = useState({ name: field.name || '', type: field.type || 'text', unit: field.unit || '', choices: (field.choices || []).join(', ') });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, type: form.type, unit: form.type === 'number' ? form.unit || null : null, choices: form.type === 'choice' ? commaList(form.choices) : [] };
    try {
      onDone((field.id ? await axios.put(`/api/things/fields/${field.id}`, body) : await axios.post(`/api/things/kinds/${field.kind_id}/fields`, body)).data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it's called *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Color" className={inputClass} /></Field>
      <Field label="What goes in it">
        <select value={form.type} onChange={set('type')} disabled={!!field.id} className={inputClass}>{TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </Field>
      {field.id && <p className="text-xs text-gray-500 dark:text-life-300">What goes in a field can't change once it's made: what's already typed in wouldn't fit.</p>}
      {form.type === 'number' && <Field label="Measured in (optional)"><input value={form.unit} onChange={set('unit')} placeholder="in, cm, gsm, min…" className={inputClass} /></Field>}
      {form.type === 'choice' && <Field label="The choices, with commas between *"><input required value={form.choices} onChange={set('choices')} placeholder="Woven, Knit, Other" className={inputClass} /></Field>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

// ==================== PLACES ====================

/** Where things are: rooms, the shelves in them, the bins on the shelves. */
export function PlacesPage() {
  const [places, setPlaces] = useState(null);
  const [editing, setEditing] = useState(null);
  const [scanning, setScanning] = useState(false);
  const load = useCallback(() => { axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => setPlaces([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!places) return null;
  const depth = (p) => p.path.split(' › ').length - 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Places</h1>
        {places.length > 0 && <button type="button" onClick={() => setScanning(true)} className={quietButtonClass}>📷 Scan a sticker</button>}
        {places.length > 0 && <Link to="/things/places/stickers" className={quietButtonClass}>Print stickers</Link>}
        <Link to="/things/stickers?blank=40" className={quietButtonClass}>Blank stickers for things</Link>
        <Link to="/things/packing" className={quietButtonClass}>📦 Packing</Link>
        <button type="button" onClick={() => setEditing({})} className={buttonClass}>+ New place</button>
      </div>
      {places.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No places yet. Add a room, then the shelves and bins inside it, as far down as helps you find things.</div>
      ) : (
        <section className={cardClass}>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {places.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Link to={`/things/places/${p.id}`} className="flex flex-1 items-center gap-2 py-2 text-left hover:underline" style={{ paddingLeft: `${depth(p) * 1.25}rem` }}>
                  <span className="flex-1 text-sm text-gray-800 dark:text-life-50">{p.name}{p.note && <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{p.note}</span>}</span>
                  <span className="text-xs text-gray-500 dark:text-life-300">{p.items > 0 ? `${p.items} ${p.items === 1 ? 'thing' : 'things'}` : ''}</span>
                </Link>
                <button type="button" onClick={() => setEditing(p)} aria-label={`Change ${p.name}`} className="text-xs text-life-600 hover:underline dark:text-life-200">Change</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && (
        <Modal title={editing.id ? editing.name : 'A new place'} onClose={() => setEditing(null)}>
          <PlaceForm place={editing} places={places} onDone={(data) => { setPlaces(data); setEditing(null); }} />
        </Modal>
      )}
      {scanning && <Modal title="Scan a sticker" onClose={() => setScanning(false)}><ScanSticker /></Modal>}
    </div>
  );
}

function PlaceForm({ place, places, onDone }) {
  const [form, setForm] = useState({ name: place.name || '', parent_id: place.parent_id ?? '', note: place.note || '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  // A place can't go inside itself or anything inside it.
  const allowed = places.filter((p) => !place.id || (p.id !== place.id && !p.path.startsWith(`${place.path} › `)));
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, parent_id: form.parent_id === '' ? null : Number(form.parent_id), note: form.note || null };
    try { onDone((place.id ? await axios.put(`/api/things/places/${place.id}`, body) : await axios.post('/api/things/places', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${place.name}? What's in it stays yours, with no place.`)) return;
    try { onDone((await axios.delete(`/api/things/places/${place.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it's called *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Sewing room, Shelf 2, Bin A" className={inputClass} /></Field>
      <Field label="Inside">
        <select value={form.parent_id} onChange={set('parent_id')} className={inputClass}>
          <option value="">Nothing: it's a room or a place of its own</option>
          {allowed.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
        </select>
      </Field>
      <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="clear lid, top shelf…" className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {place.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
