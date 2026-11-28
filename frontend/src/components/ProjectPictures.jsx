import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Picture from './Picture';
import { shrink } from './shrink';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, errorMessage, toDateInput } from './ui';

export const pictureAddress = (picture) => `/api/projects/pictures/${picture.id ?? picture}`;
const KINDS = [['idea', 'Idea', 'What you are aiming for'], ['mine', 'Mine', 'Your own work']];
const kindName = (kind) => (kind === 'mine' ? 'Mine' : 'Idea');
const touch = 'min-h-[44px]';

/** Idea or Mine: two buttons, one checked. */
function KindChoice({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Idea or mine" className="grid grid-cols-2 gap-2">
      {KINDS.map(([id, name, says]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
          className={`${touch} rounded-xl border px-3 py-2 text-left text-sm ${value === id ? 'border-life-500 bg-life-50 text-life-800 ring-2 ring-life-200 dark:bg-life-700 dark:text-life-50' : 'border-life-200 text-life-700 dark:border-life-700 dark:text-life-100'}`}>
          <span className="block font-medium">{name}</span>
          <span className="block text-xs text-gray-500 dark:text-life-300">{says}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A project's pictures: one row that scrolls sideways inside itself. Ideas are what the person is aiming for;
 * Mine is their own work. A tap shows one big. Pictures are kept here (made smaller) or linked from Immich.
 */
export default function ProjectPictures({ project, onChanged }) {
  const [modal, setModal] = useState(null);
  const [library, setLibrary] = useState(null);
  useEffect(() => { axios.get('/api/photos').then(({ data }) => setLibrary(data)).catch(() => {}); }, []);
  const pictures = project.pictures || [];
  const changed = (data) => { setModal(null); onChanged(data); };
  return (
    <section aria-label="Pictures" className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-life-800 dark:text-life-50">Pictures</h2>
        <button type="button" onClick={() => setModal({ add: true })} className={`${touch} px-1 text-sm text-life-600 hover:underline dark:text-life-200`}>+ Add a picture</button>
      </div>
      {pictures.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-life-400">
          None yet. Add ideas of what you are aiming for, and pictures of your own work. A picture from this device is made smaller and kept here.
          {library?.available && !library.connected && <> If your photos are in Immich, <Link to="/settings" className="underline">connect it in Settings</Link> and link them instead.</>}
        </p>
      ) : (
        <ul data-testid="picture-row" className="flex w-full gap-2 overflow-x-auto pb-2">
          {pictures.map((p) => (
            <li key={p.id} className="flex-none">
              <button type="button" onClick={() => setModal({ picture: p })} aria-label={`${kindName(p.kind)}: ${p.caption || 'no caption'}`}
                className="relative block h-28 w-28 overflow-hidden rounded-lg ring-1 ring-life-100 hover:ring-life-400 dark:ring-life-700">
                <Picture src={pictureAddress(p)} alt="" loading="lazy" className="h-full w-full object-cover" />
                <span className={`absolute left-1 top-1 rounded px-1.5 text-[11px] font-medium ${p.kind === 'mine' ? 'bg-life-700 text-white' : 'bg-white/90 text-life-800'}`}>{kindName(p.kind)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {modal?.add && <Modal title="Add a picture" onClose={() => setModal(null)}><AddPicture project={project} library={library} onDone={changed} onLibrary={() => setModal({ library: true })} /></Modal>}
      {modal?.library && <Modal title="Photos from Immich" wide onClose={() => setModal(null)}><LibraryPicker project={project} onDone={changed} /></Modal>}
      {modal?.picture && <Modal title={`${kindName(modal.picture.kind)} picture`} wide onClose={() => setModal(null)}><PictureView picture={modal.picture} onDone={changed} /></Modal>}
    </section>
  );
}

function AddPicture({ project, library, onDone, onLibrary }) {
  const camera = useRef(null);
  const files = useRef(null);
  const [kind, setKind] = useState('idea');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const room = 80 - (project.pictures || []).length;
  const add = async (e) => {
    const picked = [...e.target.files].slice(0, room);
    e.target.value = '';
    setError('');
    let latest = null;
    for (const [n, file] of picked.entries()) {
      setBusy(`Adding ${n + 1} of ${picked.length}…`);
      try { latest = (await axios.post(`/api/projects/${project.id}/pictures`, { data: await shrink(file), kind, caption: caption.trim() || null })).data; } catch (err) { setError(errorMessage(err, `${file.name} couldn't be added`)); }
    }
    setBusy('');
    if (latest) onDone(latest);
  };
  return (
    <div className="space-y-3">
      <Field label="What is it?"><KindChoice value={kind} onChange={setKind} /></Field>
      <Field label="A caption (you can leave it out)"><input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <input ref={camera} type="file" accept="image/*" capture="environment" onChange={add} className="hidden" aria-label="Take a photo" />
      <input ref={files} type="file" accept="image/*" multiple onChange={add} className="hidden" aria-label="Choose pictures from your files" />
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={Boolean(busy) || room < 1} onClick={() => camera.current.click()} className={`${buttonClass} ${touch}`}>{busy || 'Take a photo'}</button>
        <button type="button" disabled={Boolean(busy) || room < 1} onClick={() => files.current.click()} className={`${quietButtonClass} ${touch}`}>Choose from your files</button>
        {library?.connected && <button type="button" disabled={Boolean(busy) || room < 1} onClick={onLibrary} className={`${quietButtonClass} ${touch} sm:col-span-2`}>From Immich</button>}
      </div>
      {room < 1 && <p className="text-sm text-gray-600 dark:text-life-100">A project holds 80 pictures at most.</p>}
    </div>
  );
}

/** One picture big, with its caption. Change the caption, switch Idea or Mine, or take it off. */
function PictureView({ picture, onDone }) {
  const [caption, setCaption] = useState(picture.caption || '');
  const [kind, setKind] = useState(picture.kind);
  const [error, setError] = useState('');
  const save = async () => {
    try { onDone((await axios.put(`/api/projects/pictures/${picture.id}`, { caption: caption.trim() || null, kind })).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => {
    try { onDone((await axios.delete(`/api/projects/pictures/${picture.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <div className="space-y-3">
      <Picture src={pictureAddress(picture)} alt={picture.caption || ''} className="max-h-[60vh] w-full rounded-lg object-contain" />
      {picture.caption && <p data-testid="picture-caption" className="text-sm text-gray-700 dark:text-life-100">{picture.caption}</p>}
      <Field label="Caption"><input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} className={inputClass} /></Field>
      <Field label="What is it?"><KindChoice value={kind} onChange={setKind} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={remove} className={`${touch} text-sm text-red-600 hover:underline`}>{picture.source === 'kept' ? 'Delete this picture' : 'Take it off (it stays in your library)'}</button>
        <button type="button" onClick={save} className={`${buttonClass} ${touch}`}>Save</button>
      </div>
    </div>
  );
}

/** Photos in the person's library taken between two days. Check the ones to link; they stay in Immich. */
function LibraryPicker({ project, onDone }) {
  const [end, setEnd] = useState(toDateInput(new Date()));
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return toDateInput(d); });
  const [photos, setPhotos] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [kind, setKind] = useState('idea');
  const [error, setError] = useState('');
  const look = async () => {
    setError(''); setPhotos(null); setChosen([]);
    try { setPhotos((await axios.get(`/api/projects/${project.id}/library`, { params: { start, end } })).data); } catch (err) { setPhotos([]); setError(errorMessage(err, "Your library couldn't be read")); }
  };
  const link = async () => {
    try { onDone((await axios.post(`/api/projects/${project.id}/pictures/linked`, { ids: chosen, kind })).data); } catch (err) { setError(errorMessage(err, "Couldn't link them")); }
  };
  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">Pick the days the photos were taken (up to 62 days). They stay in Immich; the project only remembers which they are.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} /></Field>
        <Field label="To"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} /></Field>
      </div>
      <button type="button" onClick={look} className={`${quietButtonClass} ${touch}`}>Look in Immich</button>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {photos && photos.length === 0 && !error && <p className="text-sm text-gray-600 dark:text-life-100">Your library has no photos taken on those days.</p>}
      {photos && photos.length > 0 && (
        <>
          <ul className="grid max-h-[45vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
            {photos.map((p) => (
              <li key={p.id}>
                <label className={`relative block cursor-pointer overflow-hidden rounded-lg ring-2 ${chosen.includes(p.id) ? 'ring-life-500' : 'ring-transparent'} ${p.linked ? 'opacity-50' : ''}`}>
                  <Picture src={`/api/photos/thumb?id=${p.id}`} alt={`${p.name}, taken ${p.taken.replace('T', ' at ')}`} loading="lazy" className="aspect-square w-full object-cover" />
                  <input type="checkbox" disabled={p.linked} checked={p.linked || chosen.includes(p.id)} onChange={() => toggle(p.id)} className="absolute left-1.5 top-1.5 h-4 w-4 accent-life-600" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1 text-center text-[10px] text-white">{p.linked ? 'already here' : p.taken.slice(0, 10)}</span>
                </label>
              </li>
            ))}
          </ul>
          <Field label="What are these?"><KindChoice value={kind} onChange={setKind} /></Field>
          <div className="flex justify-end"><button type="button" disabled={chosen.length === 0} onClick={link} className={`${buttonClass} ${touch}`}>Link {chosen.length || ''}</button></div>
        </>
      )}
    </div>
  );
}
