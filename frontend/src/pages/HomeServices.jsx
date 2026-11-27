import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import SubChips, { MANUAL_CHIPS } from '../components/SubChips';
import { Badge, COLOR_CLASSES, COLOR_WORDS, ICON_WORDS, Open, inGroups } from '../components/ServiceLinks';
import Icon from '../components/Icon';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * Home lab (called home services in the code): links to the programs run at home (a media server, a photos app, the router).
 * The person in charge adds and changes them and picks who sees each. Everyone pins the ones they want to their own Home page.
 * Nothing is fetched from an address, and there is no place to keep a password. Connections can send a connected server
 * here with its name, an icon and its address filled in (`state.add`); the person checks it and saves.
 */
export default function HomeServicesPage() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // a link, or {} for a new one
  const { state } = useLocation();
  const navigate = useNavigate();
  const load = () => axios.get('/api/home-services').then(({ data: d }) => setData(d)).catch(() => setData(false));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!state?.add || !data?.can_change) return;
    setEditing({ ...state.add, fromConnection: true });
    navigate('.', { replace: true, state: null });
  }, [state, data, navigate]);
  if (data === null) return null;
  if (data === false) return <p className="text-sm text-gray-600 dark:text-life-200">Home lab couldn't be opened just now.</p>;

  const pin = async (s) => {
    try { setData((await (s.pinned ? axios.delete(`/api/home-services/${s.id}/pin`) : axios.put(`/api/home-services/${s.id}/pin`))).data); } catch { load(); }
  };

  return (
    <div className="space-y-4">
      <SubChips items={MANUAL_CHIPS} label="House manual and Home lab" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Home lab</h1>
        {data.can_change && <button type="button" onClick={() => setEditing({})} className={`${buttonClass} min-h-[44px]`}>+ Add a link</button>}
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100">
        Links to the programs you run at home. Pin the ones you use to your Home page.
        {data.can_change ? ' You choose who sees each one.' : ' Only the person in charge adds and changes them.'} Life Is only opens a link when you tap it. It does not check on it or keep a password.
      </p>

      {data.services.length === 0 ? (
        <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          {data.can_change ? 'No links yet. Add the first one: a media server, a photos app, the page for your router.' : 'Nothing has been shared with you yet.'}
        </p>
      ) : inGroups(data.services).map((g) => (
        <section key={g.name} className={cardClass} aria-label={g.name || 'Links'}>
          {g.name && <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">{g.name}</h2>}
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {g.services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <Badge icon={s.icon} color={s.color} />
                <div className="min-w-0 flex-1 basis-40">
                  <h3 className="text-sm font-medium text-gray-800 dark:text-life-50">{s.name}</h3>
                  {s.note && <p className="whitespace-pre-line text-xs text-gray-600 dark:text-life-200">{s.note}</p>}
                  {s.sharing && (
                    <p className="text-[11px] text-gray-500 dark:text-life-300">
                      {s.sharing.who === 'everyone' ? 'Everyone sees it' : s.sharing.who === 'me' ? 'Only you see it' : `Chosen people see it (${s.sharing.people.length})`}{s.sharing.guests ? ' · on the guest link' : ''}
                    </p>
                  )}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <Open service={s} />
                  <button type="button" onClick={() => pin(s)} aria-pressed={s.pinned} aria-label={`${s.pinned ? 'Unpin' : 'Pin'} ${s.name} ${s.pinned ? 'from' : 'to'} Home`}
                    className={`${quietButtonClass} min-h-[44px] ${s.pinned ? '!bg-life-100 font-medium dark:!bg-life-700' : ''}`}>{s.pinned ? 'Pinned to Home' : 'Pin to Home'}</button>
                  {data.can_change && <button type="button" onClick={() => setEditing(s)} className="min-h-[44px] px-2 text-sm text-life-600 hover:underline dark:text-life-200">Change</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && (
        <Modal title={editing.id ? editing.name : 'A Home lab link'} onClose={() => setEditing(null)}>
          <ServiceForm service={editing} data={data} onDone={(d) => { setData(d); setEditing(null); }} />
        </Modal>
      )}
    </div>
  );
}

function ServiceForm({ service, data, onDone }) {
  const sharing = service.sharing ?? { who: 'everyone', people: [], guests: false };
  const [form, setForm] = useState({
    name: service.name ?? '', address: service.address ?? '', address_at: service.address_at ?? 'any',
    address2: service.address2 ?? '', address2_at: service.address2_at ?? 'away', icon: service.icon ?? 'link', color: service.color ?? 'brown',
    group: service.group ?? '', order: service.id ? String(service.order) : '', note: service.note ?? '', who: sharing.who, people: sharing.people, guests: sharing.guests,
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const groups = [...new Set([...data.services.map((s) => s.group).filter(Boolean), 'Watch', 'Files', 'House'])];
  const togglePerson = (id) => setForm((f) => ({ ...f, people: f.people.includes(id) ? f.people.filter((p) => p !== id) : [...f.people, id] }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      name: form.name, address: form.address, address_at: form.address_at,
      address2: form.address2.trim() || null, address2_at: form.address2.trim() ? form.address2_at : null, icon: form.icon, color: form.color,
      group: form.group || null, order: form.order === '' ? null : Number(form.order), note: form.note || null, who: form.who, people: form.who === 'chosen' ? form.people : [], guests: form.guests,
    };
    try { onDone((service.id ? await axios.put(`/api/home-services/${service.id}`, body) : await axios.post('/api/home-services', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => { if (window.confirm(`Remove "${service.name}" for everyone?`)) onDone((await axios.delete(`/api/home-services/${service.id}`)).data); };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it is called *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="Jellyfin" className={inputClass} /></Field>
      <Field label="Address *"><input required inputMode="url" autoCapitalize="none" autoCorrect="off" value={form.address} onChange={set('address')} placeholder="http://192.168.1.20:8096" className={inputClass} /></Field>
      {service.fromConnection && <p className="text-xs text-gray-500 dark:text-life-300">Use an address your browser can open. An address like http://jellyfin:8096 works only inside Docker.</p>}
      <Field label="This address works">
        <select value={form.address_at} onChange={set('address_at')} className={`${inputClass} min-h-[44px]`}>
          <option value="any">Anywhere</option><option value="home">Only at home</option><option value="away">Only away from home</option>
        </select>
      </Field>
      <Field label="Another address (optional)"><input inputMode="url" autoCapitalize="none" autoCorrect="off" value={form.address2} onChange={set('address2')} placeholder="https://watch.example.com" className={inputClass} /></Field>
      {form.address2.trim() !== '' && (
        <Field label="The other address works">
          <select value={form.address2_at} onChange={set('address2_at')} className={`${inputClass} min-h-[44px]`}><option value="home">At home</option><option value="away">Away from home</option></select>
        </Field>
      )}
      <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700" role="note">Do not put a password here. Sign in on the page itself. An address with a name and password in it is refused.</p>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-life-200">Icon</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
          {data.icons.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={form.icon === i} aria-label={ICON_WORDS[i] ?? i} title={ICON_WORDS[i] ?? i} onClick={() => setForm({ ...form, icon: i })}
              className={`flex h-11 w-11 items-center justify-center rounded-xl border text-life-700 dark:text-life-100 ${form.icon === i ? 'border-life-600 bg-life-100 ring-2 ring-life-500 dark:bg-life-700' : 'border-life-200 dark:border-life-700'}`}>
              <Icon of={i} size={22} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-life-200">Color</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
          {data.colors.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={COLOR_WORDS[c] ?? c} title={COLOR_WORDS[c] ?? c} onClick={() => setForm({ ...form, color: c })}
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${COLOR_CLASSES[c]} ${form.color === c ? 'ring-2 ring-life-800 ring-offset-2 dark:ring-life-50 dark:ring-offset-life-800' : ''}`}>
              {form.color === c && <Icon of="done" size={20} />}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Group (optional)"><input list="service-groups" value={form.group} onChange={set('group')} placeholder="Watch" className={inputClass} /></Field>
        <Field label="Order (optional)"><input type="number" min="0" max="9999" inputMode="numeric" value={form.order} onChange={set('order')} className={inputClass} /></Field>
      </div>
      <datalist id="service-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <Field label="A note"><textarea rows={2} value={form.note} onChange={set('note')} placeholder="Films and shows for the house." className={inputClass} /></Field>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-life-200">Who sees it</legend>
        {[['everyone', 'Everyone'], ['chosen', 'Chosen people'], ['me', 'Only me']].map(([v, label]) => (
          <label key={v} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 dark:text-life-50">
            <input type="radio" name="who" value={v} checked={form.who === v} onChange={() => setForm({ ...form, who: v })} className="h-5 w-5 accent-life-600" /> {label}
          </label>
        ))}
        {form.who === 'chosen' && (
          data.people.length === 0 ? <p className="text-sm text-gray-600 dark:text-life-200">No one else has an account here yet, so only you see it for now.</p> : (
            <div className="ml-7 space-y-1" role="group" aria-label="Chosen people">
              {data.people.map((p) => (
                <label key={p.id} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 dark:text-life-50">
                  <input type="checkbox" checked={form.people.includes(p.id)} onChange={() => togglePerson(p.id)} className="h-5 w-5 accent-life-600" /> {p.name}
                </label>
              ))}
            </div>
          )
        )}
      </fieldset>
      <label className="flex min-h-[44px] items-start gap-2 text-sm text-gray-700 dark:text-life-100">
        <input type="checkbox" checked={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.checked })} className="mt-0.5 h-5 w-5 accent-life-600" />
        <span>Show to guests on the shared House Manual. Guests see only the address that works away from home. If there is only a home address, they are told it only works at home.</span>
      </label>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center justify-between">
        {service.id ? <button type="button" onClick={remove} className="min-h-[44px] text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}
