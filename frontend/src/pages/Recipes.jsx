import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, minutesText, toDateInput } from '../components/ui';

/** The recipe box: search, tags, add, paste in, export. */
export default function Recipes() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [modal, setModal] = useState(null);
  const navigate = useNavigate();
  const load = useCallback(() => {
    axios.get('/api/kitchen/recipes', { params: { q: q || undefined, tag: tag || undefined } }).then(({ data }) => setRows(data)).catch(() => setRows([]));
  }, [q, tag]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const tags = [...new Set((rows || []).flatMap((r) => r.tags))].sort();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Recipes</h1>
        <button type="button" onClick={() => setModal('import')} className={quietButtonClass}>Paste one in</button>
        <button type="button" onClick={() => setModal('new')} className={buttonClass}>+ New recipe</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe or an ingredient" aria-label="Search recipes" className={`${inputClass} max-w-sm`} />
        {(tags.length > 0 || tag) && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" className={`${inputClass} !w-auto`}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      {rows && rows.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          {q || tag ? 'Nothing matches.' : 'No recipes yet. Add one, or paste one in from anywhere: it’s kept exactly as written.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(rows || []).map((r) => (
            <li key={r.id}>
              <Link to={`/recipes/${r.id}`} className={`${cardClass} block h-full hover:ring-life-300`}>
                <span className="block font-medium text-life-800 dark:text-life-50">{r.title}</span>
                <span className="block text-xs text-gray-500 dark:text-life-200">
                  {[r.servings && `serves ${r.servings}`, (r.prep_minutes || r.cook_minutes) && minutesText((r.prep_minutes || 0) + (r.cook_minutes || 0))].filter(Boolean).join(' · ')}
                </span>
                {r.description && <span className="mt-1 block line-clamp-2 text-sm text-gray-600 dark:text-life-100">{r.description}</span>}
                {r.tags.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{r.tags.map((t) => <span key={t} className="rounded-full bg-life-50 px-2 py-0.5 text-[11px] text-life-700 dark:bg-life-700 dark:text-life-100">{t}</span>)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-500 dark:text-life-300">
        <a href="/api/kitchen/recipes-export.zip" className="underline">Download all recipes</a> as Nextcloud Cookbook folders. Unzip into the Recipes folder in your Nextcloud.
      </p>
      {modal === 'new' && (
        <Modal title="New recipe" onClose={() => setModal(null)} wide>
          <RecipeForm onSaved={(r) => navigate(`/recipes/${r.id}`)} />
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title="Paste a recipe in" onClose={() => setModal(null)} wide>
          <ImportForm onDone={(made) => (made.length === 1 ? navigate(`/recipes/${made[0].id}`) : (setModal(null), load()))} />
        </Modal>
      )}
    </div>
  );
}

function ImportForm({ onDone }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post('/api/kitchen/recipes/import', { text });
      onDone(data.recipes);
    } catch (err) {
      setError(errorMessage(err, "Couldn't read that"));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        Paste a recipe from anywhere: the name on the first line, then the ingredients and the method. Headings like "Ingredients"
        and "Method" help. Or paste recipe JSON from the Nextcloud Cookbook app or a recipe website. Nothing is shortened or rewritten,
        and what you paste is kept alongside.
      </p>
      <textarea required rows={14} value={text} onChange={(e) => setText(e.target.value)} className={`${inputClass} font-mono text-xs`} aria-label="Recipe text" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Bring it in</button></div>
    </form>
  );
}

export function RecipeForm({ recipe, onSaved }) {
  const [form, setForm] = useState({
    title: recipe?.title || '', description: recipe?.description || '', servings: recipe?.servings ?? '',
    prep_minutes: recipe?.prep_minutes ?? '', cook_minutes: recipe?.cook_minutes ?? '', source_url: recipe?.source_url || '',
    ingredients_text: recipe?.ingredients_text || '', steps_text: recipe?.steps_text || '', notes: recipe?.notes || '',
    tags: (recipe?.tags || []).join(', '),
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const num = (v) => (v === '' ? null : Number(v));
  const submit = async (e) => {
    e.preventDefault();
    const body = { ...form, servings: num(form.servings), prep_minutes: num(form.prep_minutes), cook_minutes: num(form.cook_minutes),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      const { data } = recipe ? await axios.put(`/api/kitchen/recipes/${recipe.id}`, body) : await axios.post('/api/kitchen/recipes', body);
      onSaved(data);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save"));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name *"><input required autoFocus={!recipe} value={form.title} onChange={set('title')} className={inputClass} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Serves"><input type="number" min="0.5" step="0.5" value={form.servings} onChange={set('servings')} className={inputClass} /></Field>
        <Field label="Prep (min)"><input type="number" min="0" value={form.prep_minutes} onChange={set('prep_minutes')} className={inputClass} /></Field>
        <Field label="Cook (min)"><input type="number" min="0" value={form.cook_minutes} onChange={set('cook_minutes')} className={inputClass} /></Field>
      </div>
      <Field label="About it"><textarea rows={2} value={form.description} onChange={set('description')} className={inputClass} /></Field>
      <Field label="Ingredients: one a line. A line starting with # is a section, like # For the sauce">
        <textarea rows={10} value={form.ingredients_text} onChange={set('ingredients_text')} placeholder={'# For the sauce\n2 tbsp olive oil\n1 onion, finely chopped'} className={`${inputClass} font-mono text-xs`} />
      </Field>
      <Field label="Method: one step a paragraph (a blank line between steps). # starts a section">
        <textarea rows={12} value={form.steps_text} onChange={set('steps_text')} className={`${inputClass} text-sm`} />
      </Field>
      <Field label="Notes"><textarea rows={3} value={form.notes} onChange={set('notes')} className={inputClass} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tags, with commas"><input value={form.tags} onChange={set('tags')} placeholder="dinner, freezes well" className={inputClass} /></Field>
        <Field label="Where it's from"><input value={form.source_url} onChange={set('source_url')} placeholder="A link, a book, Grandma" className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** One recipe, exactly as written, with a servings scaler and "add to the week". */
export function RecipePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [servings, setServings] = useState('');
  const [modal, setModal] = useState(null);
  const [missing, setMissing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const load = useCallback(() => {
    axios.get(`/api/kitchen/recipes/${id}`, { params: { servings: servings ? Number(servings) : undefined } })
      .then(({ data }) => setR(data)).catch(() => setMissing(true));
  }, [id, servings]);
  useEffect(() => { load(); }, [load]);
  if (missing) return <p className="text-sm text-gray-500">That recipe isn't here. <Link to="/" className="underline">All recipes</Link></p>;
  if (!r) return null;
  const remove = async () => {
    if (!window.confirm(`Delete "${r.title}"? It can't be brought back.`)) return;
    await axios.delete(`/api/kitchen/recipes/${r.id}`).catch(() => {});
    navigate('/');
  };
  let stepNumber = 0;
  return (
    <article className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <Link to="/" className="text-xs text-life-600 hover:underline dark:text-life-200">← Recipes</Link>
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{r.title}</h1>
          <p className="text-sm text-gray-500 dark:text-life-200">
            {[r.prep_minutes != null && `prep ${minutesText(r.prep_minutes)}`, r.cook_minutes != null && `cook ${minutesText(r.cook_minutes)}`, r.source_url].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" onClick={() => setModal('plan')} className={buttonClass}>Add to the week</button>
        <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Edit</button>
      </div>
      {r.description && <p className="whitespace-pre-wrap text-gray-700 dark:text-life-100">{r.description}</p>}
      <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
        <section className={cardClass}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-life-800 dark:text-life-50">Ingredients</h2>
            {r.servings && (
              <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-life-200">Serves
                <input type="number" min="0.5" step="0.5" value={servings === '' ? r.servings : servings} onChange={(e) => setServings(e.target.value)} className={`${inputClass} !w-16 !py-1`} />
                {servings !== '' && Number(servings) !== r.servings && <button type="button" onClick={() => setServings('')} className="underline">reset</button>}
              </label>
            )}
          </div>
          <ul className="space-y-1 text-sm">
            {r.ingredients.map((l) => (l.is_heading
              ? <li key={l.id} className="pt-2 text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{l.text}</li>
              : <li key={l.id} className="text-gray-800 dark:text-life-50">{l.text}{l.scaled && <span className="ml-2 rounded bg-honey-100 px-1.5 text-xs text-honey-700">{l.scaled}</span>}</li>))}
          </ul>
          {servings !== '' && Number(servings) !== r.servings && <p className="mt-2 text-xs text-gray-500 dark:text-life-300">The highlighted amounts are for {servings}. The lines stay as written.</p>}
        </section>
        <section className={cardClass}>
          <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Method</h2>
          <ol className="space-y-3">
            {r.steps.map((s) => (s.is_heading
              ? <li key={s.id} className="pt-1 text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{s.text}</li>
              : (
                <li key={s.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-life-100 text-xs font-semibold text-life-700 dark:bg-life-700 dark:text-life-100">{++stepNumber}</span>
                  <span className="whitespace-pre-wrap text-gray-800 dark:text-life-50">{s.text}</span>
                </li>
              )))}
          </ol>
        </section>
      </div>
      {r.notes && <section className={cardClass}><h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Notes</h2><p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-life-100">{r.notes}</p></section>}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-life-300">
        {r.original_text && <button type="button" onClick={() => setShowOriginal(!showOriginal)} className="underline">{showOriginal ? 'Hide' : 'Show'} the original as it came in</button>}
        <button type="button" onClick={remove} className="ml-auto text-red-600 hover:underline">Delete recipe</button>
      </div>
      {showOriginal && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-life-50 p-3 text-xs text-gray-700 dark:bg-life-800 dark:text-life-100">{r.original_text}</pre>}
      {modal === 'edit' && (
        <Modal title={`Edit ${r.title}`} onClose={() => setModal(null)} wide>
          <RecipeForm recipe={r} onSaved={() => { setModal(null); load(); }} />
        </Modal>
      )}
      {modal === 'plan' && (
        <Modal title={`Add ${r.title} to the week`} onClose={() => setModal(null)}>
          <AddToWeek recipe={r} servings={servings === '' ? r.servings : Number(servings)} onDone={() => navigate('/week')} />
        </Modal>
      )}
    </article>
  );
}

function AddToWeek({ recipe, servings, onDone }) {
  const [form, setForm] = useState({ day: toDateInput(new Date()), meal: 'dinner', servings: servings || '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/kitchen/plan', { ...form, recipe_id: recipe.id, servings: form.servings === '' ? null : Number(form.servings) });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't add it"));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day"><input type="date" required value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} className={inputClass} /></Field>
        <Field label="Meal">
          <select value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} className={inputClass}>
            {['breakfast', 'lunch', 'dinner', 'snack'].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Servings"><input type="number" min="0.5" step="0.5" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Add</button></div>
    </form>
  );
}
