import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { money, toCents } from '../components/Budget';
import Statement from '../components/Statement';
import { MonthBudget } from './Budgeting';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';

const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`; };
const today = () => { const now = new Date(); return `${thisMonth()}-${pad(now.getDate())}`; };
const step = (month, by) => { const [y, m] = month.split('-').map(Number); const at = new Date(y, m - 1 + by, 1); return `${at.getFullYear()}-${pad(at.getMonth() + 1)}`; };
const monthName = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** How much of a category's month is used: a plain bar, red once it is over. */
function Used({ spent, planned }) {
  const part = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : spent > 0 ? 100 : 0;
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-life-100 dark:bg-life-800" role="img" aria-label={`${part}% of the month's amount used`}>
      <div className={`h-full rounded-full ${spent > planned ? 'bg-red-500' : 'bg-life-500'}`} style={{ width: `${part}%` }} />
    </div>
  );
}

/** Life is spending: the month's plan in each category, what was spent, and what is left. */
export default function Money() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const load = useCallback(() => { axios.get('/api/money', { params: { month, tag: tag || undefined } }).then(({ data: d }) => setData(d)).catch(() => {}); }, [month, tag]);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const sign = data.currency;
  const done = () => { setModal(null); load(); };
  // A statement can span months; the page goes to the latest month it added to, and the others are a step back.
  const broughtIn = (result) => {
    setModal(null);
    const latest = result.months.length ? result.months[result.months.length - 1].month : null;
    if (latest && latest !== month) setMonth(latest); else load();
  };
  const remove = async (entry) => {
    setError('');
    try { await axios.delete(`/api/money/entries/${entry.id}`); load(); } catch (err) { setError(errorMessage(err, "Couldn't remove that")); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold text-life-800 dark:text-life-50">Spending</h1>
        <button type="button" onClick={() => setModal({ statement: true })} className="min-h-[44px] px-2 text-sm text-life-600 hover:underline dark:text-life-200">Import a statement</button>
        <button type="button" onClick={() => setModal({ entry: {} })} className={buttonClass}>+ Spent</button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setMonth(step(month, -1))} className={quietButtonClass} aria-label="The month before">‹</button>
        <p className="font-medium text-life-800 dark:text-life-50" data-month>{monthName(data.month)}</p>
        <button type="button" onClick={() => setMonth(step(month, 1))} className={quietButtonClass} aria-label="The month after">›</button>
      </div>

      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-life-50 px-3 py-3 text-center dark:bg-life-800" data-month-totals>
        <div><dt className="text-xs text-gray-500 dark:text-life-300">Planned</dt><dd className="font-semibold tabular-nums text-gray-800 dark:text-life-50">{money(data.total.planned, sign)}</dd></div>
        <div><dt className="text-xs text-gray-500 dark:text-life-300">Spent</dt><dd className="font-semibold tabular-nums text-gray-800 dark:text-life-50">{money(data.total.spent, sign)}</dd></div>
        <div><dt className="text-xs text-gray-500 dark:text-life-300">{data.total.left < 0 ? 'Over by' : 'Left'}</dt><dd className={`font-semibold tabular-nums ${data.total.left < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{money(Math.abs(data.total.left), sign)}</dd></div>
      </dl>

      <MonthBudget month={month} key={`${month}-${data.entries.length}-${data.total.spent}`} />

      <section className={cardClass}>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Categories</h2>
          <button type="button" onClick={() => setModal({ category: {} })} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add</button>
        </div>
        {data.categories.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">None yet. Add one for each kind of spending you want to keep an eye on (groceries, the house, fun) and give it an amount for the month.</p>}
        <ul className="divide-y divide-life-100 dark:divide-life-800">
          {data.categories.map((c) => (
            <li key={c.id} className="py-2.5" data-category={c.name}>
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                {c.mine
                  ? <button type="button" onClick={() => setModal({ category: c })} className="flex-1 text-left font-medium text-gray-800 hover:underline dark:text-life-50">{c.name}</button>
                  : <span className="flex-1 font-medium text-gray-800 dark:text-life-50">{c.name}</span>}
                <span className="tabular-nums text-gray-600 dark:text-life-100">{money(c.spent, sign)} of {money(c.monthly_cents, sign)}</span>
                <span className={`tabular-nums ${c.left < 0 ? 'font-medium text-red-600' : 'text-gray-500 dark:text-life-300'}`}>{c.left < 0 ? `over by ${money(-c.left, sign)}` : `${money(c.left, sign)} left`}</span>
              </div>
              <Used spent={c.spent} planned={c.monthly_cents} />
              <p className="mt-1 text-xs text-gray-500 dark:text-life-300">
                {!c.mine ? `Shared with you by ${c.owner}` : c.shared_with.length ? `Shared with ${c.shared_with.map((p) => p.name).join(', ')}` : 'Only you see this'}
              </p>
            </li>
          ))}
        </ul>
        {(data.uncategorised > 0 || data.projects.spent > 0) && (
          <p className="mt-2 text-sm text-gray-600 dark:text-life-100">
            {data.uncategorised > 0 && <>In no category: <span className="tabular-nums">{money(data.uncategorised, sign)}</span>. </>}
            {data.projects.spent > 0 && <>Paid on projects: <span className="tabular-nums">{money(data.projects.spent, sign)}</span>.</>}
          </p>
        )}
      </section>

      <section className={cardClass}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">What was spent</h2>
          <TagFilter value={tag} onChange={setTag} />
          {data.entries.some((e) => e.mine) && <SelectButton sel={sel} />}
        </div>
        <BulkBar sel={sel} kind="spending" list={data.entries.filter((e) => e.mine).map((e) => e.id)} noun="entries" onDone={load} />
        {data.entries.length === 0 && data.projects.lines.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">{tag ? 'Nothing with that tag this month.' : 'Nothing written down this month.'}</p>}
        <ul className="divide-y divide-life-100 dark:divide-life-800">
          {data.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-2 py-2 text-sm">
              {e.mine && <PickBox sel={sel} id={e.id} name={e.label} />}
              <span className="w-12 shrink-0 text-xs text-gray-500 dark:text-life-300">{e.day.slice(5).replace('-', '/')}</span>
              <span className="min-w-0 flex-1 text-gray-800 dark:text-life-50">
                {e.mine ? <button type="button" onClick={() => setModal({ entry: e })} aria-label={`Change ${e.label}`} className="min-h-[44px] text-left hover:underline">{e.label}</button> : e.label}
                <span className="text-xs text-gray-500 dark:text-life-300">{e.category ? ` · ${e.category}` : ''}{e.mine ? '' : ` · ${e.by}`}</span>
              </span>
              <span className="tabular-nums text-gray-800 dark:text-life-50">{money(e.cents, sign)}</span>
              {e.mine && <button type="button" aria-label={`Remove ${e.label}`} onClick={() => remove(e)} className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-red-600">✕</button>}
              <TagChips tags={e.tag_list} className="basis-full pb-1 pl-14" />
            </li>
          ))}
          {data.projects.lines.map((l, i) => (
            <li key={`p${i}`} className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
              <span className="w-12 shrink-0 text-xs text-gray-500 dark:text-life-300">{l.day.slice(5).replace('-', '/')}</span>
              <span className="min-w-0 flex-1 text-gray-800 dark:text-life-50">{l.label}<span className="text-xs text-gray-500 dark:text-life-300"> · <Link to={`/projects/${l.project_id}`} className="underline">{l.project}</Link></span></span>
              <span className="tabular-nums text-gray-800 dark:text-life-50">{money(l.cents, sign)}</span>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      </section>
      {modal?.entry && <Modal title={modal.entry.id ? modal.entry.label : 'Something spent'} onClose={() => setModal(null)}><EntryForm entry={modal.entry} categories={data.categories} onDone={done} /></Modal>}
      {modal?.statement && <Modal title="Import a statement" wide onClose={() => { setModal(null); load(); }}><Statement categories={data.categories} currency={sign} onDone={broughtIn} /></Modal>}
      {modal?.category && <Modal title={modal.category.id ? modal.category.name : 'A category'} onClose={() => setModal(null)}><CategoryForm category={modal.category} people={data.people} onDone={done} /></Modal>}
    </div>
  );
}

function EntryForm({ entry = {}, categories, onDone }) {
  const [form, setForm] = useState({ label: entry.label || '', amount: entry.id ? (entry.cents / 100).toFixed(2) : '', category_id: entry.category_id ?? '', day: entry.day || today(), note: entry.note || '' });
  const [tags, setTags] = useState(entry.tag_list || []);
  const [error, setError] = useState('');
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { label: form.label, cents: toCents(form.amount), category_id: form.category_id ? Number(form.category_id) : null, day: form.day, note: form.note };
      if (entry.id) await axios.put(`/api/money/entries/${entry.id}`, body);
      const id = entry.id ?? (await axios.post('/api/money/entries', body)).data.id;
      await saveTags('spending', id, tags);
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What on *"><input required autoFocus value={form.label} onChange={set('label')} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much *"><input required inputMode="decimal" value={form.amount} onChange={set('amount')} className={inputClass} /></Field>
        <Field label="When"><input type="date" value={form.day} onChange={set('day')} className={inputClass} /></Field>
      </div>
      <Field label="Category">
        <select value={form.category_id} onChange={set('category_id')} className={inputClass}>
          <option value="">None (only you see it)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.mine ? (c.shared_with.length ? ' (shared)' : '') : ` (shared by ${c.owner})`}</option>)}
        </select>
      </Field>
      <Field label="Note"><input value={form.note} onChange={set('note')} className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

function CategoryForm({ category, people, onDone }) {
  const [name, setName] = useState(category.name || '');
  const [amount, setAmount] = useState(category.id ? (category.monthly_cents / 100).toFixed(2) : '');
  const [shared, setShared] = useState((category.shared_with || []).map((p) => p.id));
  const [error, setError] = useState('');
  const toggle = (id) => setShared(shared.includes(id) ? shared.filter((x) => x !== id) : [...shared, id]);
  const send = async (request) => { setError(''); try { await request(); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't save that")); } };
  const submit = (e) => {
    e.preventDefault();
    const body = { name, monthly_cents: toCents(amount) ?? 0, shared_with: shared };
    send(() => (category.id ? axios.put(`/api/money/categories/${category.id}`, body) : axios.post('/api/money/categories', body)));
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name *"><input required autoFocus={!category.id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Groceries, House, Fun…" className={inputClass} /></Field>
      <Field label="Amount for each month"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} /></Field>
      {people.length > 0 ? (
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 dark:text-life-100">Who sees it</legend>
          <p className="mb-1 text-xs text-gray-500 dark:text-life-300">Only you, unless you check someone. They see this category and what's spent in it, and can add to it. They can't change its amount or see any other category.</p>
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 py-1 text-sm text-gray-800 dark:text-life-50">
              <input type="checkbox" checked={shared.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}
            </label>
          ))}
        </fieldset>
      ) : <p className="text-xs text-gray-500 dark:text-life-300">Only you see this.</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-between gap-2">
        {category.id ? <button type="button" onClick={() => send(() => axios.delete(`/api/money/categories/${category.id}`))} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
