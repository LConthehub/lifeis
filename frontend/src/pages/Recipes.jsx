import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { inApp } from '../where';
import Picture from '../components/Picture';
import RecipeFile from '../components/RecipeFile';
import { shrink } from '../components/shrink';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, minutesText, toDateInput } from '../components/ui';

/** Where a recipe's picture is asked for; the version makes a changed picture show at once instead of the one remembered. */
const photoAddress = (r) => `/api/kitchen/recipes/${r.id}/photo?v=${encodeURIComponent(r.photo_added_at || '')}`;

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
        <button type="button" onClick={() => setModal('import')} className={quietButtonClass}>Import one</button>
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
              <Link to={`/recipes/${r.id}`} className={`${cardClass} flex h-full gap-3 hover:ring-life-300`}>
                {r.has_photo && (
                  <Picture src={photoAddress(r)} alt={r.title} loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-lg bg-life-50 object-cover dark:bg-life-700" />
                )}
                <span className="block min-w-0 flex-1">
                  <span className="block font-medium text-life-800 dark:text-life-50">{r.title}</span>
                  <span className="block text-xs text-gray-500 dark:text-life-200">
                    {[r.servings && `serves ${r.servings}`, (r.prep_minutes || r.cook_minutes) && minutesText((r.prep_minutes || 0) + (r.cook_minutes || 0))].filter(Boolean).join(' · ')}
                  </span>
                  {r.description && <span className="mt-1 block line-clamp-2 text-sm text-gray-600 dark:text-life-100">{r.description}</span>}
                  {r.tags.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{r.tags.map((t) => <span key={t} className="rounded-full bg-life-50 px-2 py-0.5 text-[11px] text-life-700 dark:bg-life-700 dark:text-life-100">{t}</span>)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!inApp() && (
        <p className="text-xs text-gray-500 dark:text-life-300">
          <a href="/api/kitchen/recipes-export.zip" className="underline">Download all recipes</a> as Nextcloud Cookbook folders. Unzip into the Recipes folder in your Nextcloud.
        </p>
      )}
      {modal === 'new' && (
        <Modal title="New recipe" onClose={() => setModal(null)} wide>
          <RecipeForm onSaved={(r) => navigate(`/recipes/${r.id}`)} />
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title="Import a recipe" onClose={() => setModal(null)} wide>
          <BringIn onDraft={(draft) => setModal({ draft })} onDone={(made) => (made.length === 1 ? navigate(`/recipes/${made[0].id}`) : (setModal(null), load()))} />
        </Modal>
      )}
      {modal?.draft && (
        <Modal title="Look it over, then save" onClose={() => setModal(null)} wide>
          <p className="mb-3 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">This is what was read. Nothing is saved until you press Save, so fix anything that came out wrong.</p>
          <RecipeForm draft={modal.draft} onSaved={(r) => navigate(`/recipes/${r.id}`)} />
        </Modal>
      )}
    </div>
  );
}

const WAYS = [['web', 'From a website'], ['photo', 'From a photo or a book'], ['text', 'Paste the text'], ['file', 'Many, from another app']];

/** A recipe from somewhere else: a web page, a photo of a page or a card, or text pasted in. */
function BringIn({ onDraft, onDone }) {
  const [way, setWay] = useState('web');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the recipe is">
        {WAYS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setWay(key)} aria-pressed={way === key}
            className={`rounded-full px-3 py-1 text-sm ${way === key ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`}>{label}</button>
        ))}
      </div>
      {way === 'web' && <FromWeb onDraft={onDraft} />}
      {way === 'photo' && <FromPhoto onDraft={onDraft} />}
      {way === 'text' && <ImportForm onDone={onDone} />}
      {way === 'file' && <RecipeFile onDone={() => onDone([])} />}
    </div>
  );
}

function FromWeb({ onDraft }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [about, setAbout] = useState(null);
  useEffect(() => { axios.get('/api/kitchen/recipes/from-web').then(({ data }) => setAbout(data)).catch(() => {}); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onDraft((await axios.post('/api/kitchen/recipes/from-web', { url })).data); } catch (err) { setError(errorMessage(err, "Couldn't read that page")); }
    setBusy(false);
  };
  if (about && !about.available) return <p className="text-sm text-gray-600 dark:text-life-100">This copy of Life Is isn't set up to reach outside, so it can't fetch a page. Copy the recipe's text from the page and use "Paste the text".</p>;
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="The recipe's web address"><input required type="url" inputMode="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputClass} /></Field>
      {about && <p className="text-xs text-gray-500 dark:text-life-300"><span className="font-medium">What this does:</span> {about.service.sends}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Reading the page…' : 'Read it'}</button></div>
    </form>
  );
}

function FromPhoto({ onDraft }) {
  const [text, setText] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  // Handwriting: a model you chose in Settings can copy it out. Offered only when one is turned on at an address.
  const [helper, setHelper] = useState(null);
  useEffect(() => { axios.get('/api/assistant').then(({ data }) => setHelper(data)).catch(() => {}); }, []);
  const canWrite = helper?.enabled && helper.source === 'address';
  const handwritten = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length === 0) return;
    setError('');
    try {
      const { photoForModel } = await import('../components/readPhoto');
      let page = 0;
      for (const file of files) {
        page += 1;
        setProgress(`The model is reading${files.length > 1 ? ` page ${page} of ${files.length}` : ''}… this can take a minute.`);
        const { data } = await axios.post('/api/assistant/read-recipe', await photoForModel(file));
        setText((before) => [before, data.text].filter((part) => part && part.trim()).join('\n\n'));
      }
    } catch (err) {
      // No answer from Life Is at all means the photo never left: it couldn't be opened here.
      setError(err?.response ? errorMessage(err, "The model couldn't read that photo.") : "That file couldn't be opened as a photo. Try a JPEG or PNG.");
    }
    setProgress(null);
  };
  const picked = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length === 0) return;
    setError(''); setProgress('Getting ready…');
    try {
      const { readPhotos } = await import('../components/readPhoto');
      const read = await readPhotos(files, setProgress);
      if (!read.trim()) setError("No words could be read from that. A sharper photo, straight on and in good light, reads best.");
      setText((before) => [before, read].filter((part) => part && part.trim()).join('\n\n'));
    } catch (problem) {
      console.error(problem);
      setError("The photo couldn't be read on this device.");
    }
    setProgress(null);
  };
  const next = async () => {
    setError('');
    try { onDraft((await axios.post('/api/kitchen/recipes/read', { text })).data); } catch (err) { setError(errorMessage(err, "Couldn't make a recipe of that")); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        Take a photo of a recipe card or a page in a book, or choose one you have. The words are read off it <span className="font-medium">here on this device</span>:
        the photo is not sent anywhere and is not kept. Printed pages read well this way; handwriting needs the button below.
      </p>
      <label className={`${quietButtonClass} inline-block cursor-pointer`}>
        {text ? 'Add another page' : 'Choose or take a photo'}
        <input type="file" accept="image/*" multiple onChange={picked} disabled={progress !== null} className="sr-only" aria-label="Choose or take a photo of a recipe" />
      </label>
      {canWrite ? (
        <div className="space-y-1 rounded-lg bg-life-50 p-3 dark:bg-life-700">
          <label className={`${quietButtonClass} inline-block cursor-pointer`}>
            ✍️ It's handwritten
            <input type="file" accept="image/*" multiple onChange={handwritten} disabled={progress !== null} className="sr-only" aria-label="Choose or take a photo of a handwritten recipe" />
          </label>
          <p className="text-xs text-gray-600 dark:text-life-200">
            Handwriting is read by the AI model you chose in Settings{helper.model ? ` (${helper.model})` : ''}.
            {helper.local ? ' It is on your own computer or network, so the photo doesn\'t leave home.' : ' It is a cloud AI: the photo is sent to it, and nothing else is.'}
            {' '}It copies out what is written; check it against the card before saving.
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-life-300">
          For handwriting, turn on the assistant in <Link to="/settings#assistant" className="underline">Settings</Link> with a model that can look at pictures. Then a handwritten card can be read too.
        </p>
      )}
      {progress !== null && <p className="text-sm text-life-700 dark:text-life-200" role="status">{progress}</p>}
      {text !== null && (
        <>
          <Field label="What was read (fix anything obvious: the name first, then the ingredients, then the method)">
            <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className={`${inputClass} font-mono text-xs`} />
          </Field>
          <div className="flex justify-end"><button type="button" onClick={next} disabled={!text.trim()} className={buttonClass}>Make it a recipe</button></div>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
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
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Import it</button></div>
    </form>
  );
}

/** A recipe being changed (`recipe`), a new one, or a new one started from what was read somewhere (`draft`). */
export function RecipeForm({ recipe, draft, onSaved }) {
  const from = recipe ?? draft;
  const [form, setForm] = useState({
    title: from?.title || '', description: from?.description || '', servings: from?.servings ?? '',
    prep_minutes: from?.prep_minutes ?? '', cook_minutes: from?.cook_minutes ?? '', source_url: from?.source_url || '',
    ingredients_text: from?.ingredients_text || '', steps_text: from?.steps_text || '', notes: from?.notes || '',
    tags: (from?.tags || []).join(', '),
  });
  // What it's cooked in: each row is one of your things, or a name typed in.
  const [equipment, setEquipment] = useState(() => (recipe?.equipment || []).map((e) => ({ item_id: e.item_id ?? '', label: e.item_id ? '' : e.label, quantity: e.quantity, note: e.note || '' })));
  const [things, setThings] = useState([]);
  useEffect(() => { axios.get('/api/things/items').then(({ data }) => setThings(data)).catch(() => {}); }, []);
  const setRow = (i, change) => setEquipment(equipment.map((row, n) => (n === i ? { ...row, ...change } : row)));
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const num = (v) => (v === '' ? null : Number(v));
  const submit = async (e) => {
    e.preventDefault();
    // What was read is kept alongside, as it was, so a correction can always be checked against it.
    const body = { ...form, ...(draft?.original_text ? { original_text: draft.original_text } : {}), servings: num(form.servings), prep_minutes: num(form.prep_minutes), cook_minutes: num(form.cook_minutes),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      equipment: equipment.filter((row) => row.item_id !== '' || row.label.trim()).map((row) => ({
        item_id: row.item_id === '' ? null : Number(row.item_id), label: row.item_id === '' ? row.label : null,
        quantity: row.quantity === '' ? null : Number(row.quantity), note: row.note || null })) };
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
      <div className="space-y-2">
        <span className="block text-xs font-medium text-gray-600 dark:text-life-200">What it's cooked in: pans, dishes and tools, from your things or just by name</span>
        {equipment.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input type="number" min="1" step="1" value={row.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} aria-label="How many" className={`${inputClass} !w-16`} />
            <select value={row.item_id} onChange={(e) => setRow(i, { item_id: e.target.value })} aria-label="Which of your things" className={`${inputClass} !w-auto flex-1`}>
              <option value="">Something not in my things…</option>
              {[...new Set(things.map((t) => t.kind))].map((kind) => (
                <optgroup key={kind} label={kind}>{things.filter((t) => t.kind === kind).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
              ))}
            </select>
            {row.item_id === '' && <input value={row.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="e.g. 8x8 baking dish" aria-label="What it is" className={`${inputClass} !w-auto flex-1`} />}
            <input value={row.note} onChange={(e) => setRow(i, { note: e.target.value })} placeholder="note" aria-label="A note" className={`${inputClass} !w-28`} />
            <button type="button" onClick={() => setEquipment(equipment.filter((_, n) => n !== i))} className="text-xs text-gray-400 hover:text-red-600" aria-label="Take this off">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setEquipment([...equipment, { item_id: things[0] ? String(things[0].id) : '', label: '', quantity: 1, note: '' }])} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add a pan, dish or tool</button>
      </div>
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
  const [pictureError, setPictureError] = useState('');
  const picker = useRef(null);
  const load = useCallback(() => {
    axios.get(`/api/kitchen/recipes/${id}`, { params: { servings: servings ? Number(servings) : undefined } })
      .then(({ data }) => setR(data)).catch(() => setMissing(true));
  }, [id, servings]);
  useEffect(() => { load(); }, [load]);
  if (missing) return <p className="text-sm text-gray-500">That recipe isn't here. <Link to="/recipes" className="underline">All recipes</Link></p>;
  if (!r) return null;
  const remove = async () => {
    if (!window.confirm(`Delete "${r.title}"? It can't be brought back.`)) return;
    await axios.delete(`/api/kitchen/recipes/${r.id}`).catch(() => {});
    navigate('/recipes');
  };
  const picture = async (file) => {
    if (!file) return;
    setPictureError('');
    try { await axios.put(`/api/kitchen/recipes/${r.id}/photo`, { data: await shrink(file) }); load(); } catch (err) {
      setPictureError(err?.response ? errorMessage(err, "The picture couldn't be kept") : "That file couldn't be opened as a picture. Try a JPEG or PNG.");
    }
  };
  const removePicture = async () => {
    setPictureError('');
    try { await axios.delete(`/api/kitchen/recipes/${r.id}/photo`); load(); } catch (err) { setPictureError(errorMessage(err, "The picture couldn't be removed")); }
  };
  let stepNumber = 0;
  return (
    <article className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <Link to="/recipes" className="text-xs text-life-600 hover:underline dark:text-life-200">← Recipes</Link>
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{r.title}</h1>
          <p className="text-sm text-gray-500 dark:text-life-200">
            {[r.prep_minutes != null && `prep ${minutesText(r.prep_minutes)}`, r.cook_minutes != null && `cook ${minutesText(r.cook_minutes)}`, r.source_url].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" onClick={() => setModal('plan')} className={buttonClass}>Add to the week</button>
        <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Edit</button>
      </div>
      {r.description && <p className="whitespace-pre-wrap text-gray-700 dark:text-life-100">{r.description}</p>}
      <div className="space-y-2" data-section="picture">
        {r.has_photo && <Picture src={photoAddress(r)} alt={r.title} loading="lazy" decoding="async" className="max-h-72 w-full rounded-xl bg-life-50 object-contain dark:bg-life-700 sm:max-w-md" />}
        <input ref={picker} type="file" accept="image/*" className="hidden" aria-label="Choose or take a picture of the recipe" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; picture(file); }} />
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" onClick={() => picker.current?.click()} className={r.has_photo ? `${quietButtonClass} min-h-[44px]` : 'min-h-[44px] rounded-lg px-1 text-life-600 hover:underline dark:text-life-200'}>
            {r.has_photo ? 'Change the picture' : 'Add a picture'}
          </button>
          {r.has_photo && <button type="button" onClick={removePicture} className="min-h-[44px] rounded-lg px-3 text-gray-600 hover:underline dark:text-life-200">Remove</button>}
        </div>
        {pictureError && <p className="text-sm text-red-600">{pictureError}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_3fr]">
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
          {r.equipment?.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Cooked in</h2>
              <ul className="space-y-1 text-sm">
                {r.equipment.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-gray-800 dark:text-life-50">{e.quantity !== 1 ? `${e.quantity} × ` : ''}{e.label}</span>
                    {e.note && <span className="text-xs text-gray-500 dark:text-life-300">{e.note}</span>}
                    {e.place && <span className="text-xs text-gray-500 dark:text-life-300">📍 {e.place}</span>}
                    {e.have === null ? <span className="rounded bg-gray-100 px-1.5 text-[11px] text-gray-600">not in your things</span>
                      : e.have < e.quantity && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">you have {e.have}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
