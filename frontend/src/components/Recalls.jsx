import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import axios from 'axios';
import { quietButtonClass, cardClass, errorMessage } from './ui';

const NHTSA_RECALLS = 'https://www.nhtsa.gov/recalls';
const tall = 'min-h-[44px]';

const dayText = (day) => (day ? new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const whenText = (stamp) => (stamp ? new Date(stamp).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);

/** Said wherever recalls are listed: this goes by make, model and year, so it may not be this very car. */
export function VinNote({ className = '' }) {
  return (
    <p className={`text-xs text-gray-600 dark:text-life-200 ${className}`}>
      This checks by make, model and year, so some recalls listed may not apply to your car. For a certain answer, enter your VIN on{' '}
      <a href={NHTSA_RECALLS} target="_blank" rel="noopener noreferrer" className="underline">NHTSA's own site</a>. Life Is never sends the VIN.
    </p>
  );
}

/** The service in Settings, among the outside ones: what it is, what it's sent, its switch, and checking now. */
export function RecallAlertsService() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { axios.get('/api/recalls').then(({ data }) => setS(data)).catch(() => {}); }, []);
  if (!s) return null;
  const turn = async (on) => {
    setMessage('');
    try { setS((await axios.put('/api/recalls', { on })).data); } catch (err) { setMessage(errorMessage(err, "Couldn't change that")); }
  };
  const check = async () => {
    setBusy(true); setMessage('');
    try {
      const { data } = await axios.post('/api/recalls/check', { force: true });
      setS((was) => ({ ...was, ...data.status }));
      const bits = [`Checked ${data.asked} ${data.asked === 1 ? 'car' : 'cars'}.`, data.not_listed ? `${data.not_listed} with nothing listed by NHTSA.` : '', data.failed ? `${data.failed} couldn't be checked just now.` : ''];
      setMessage(bits.filter(Boolean).join(' '));
    } catch (err) { setMessage(errorMessage(err, "Couldn't check just now")); }
    setBusy(false);
  };
  const open = s.vehicles.reduce((n, v) => n + v.open, 0);
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50"><Icon of="car" /> Recall alerts for your cars</h3>
        <span className={`rounded px-1.5 text-[11px] ${s.on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{s.on ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Looks for safety recalls on the cars you keep, from <a href={s.service.site} target="_blank" rel="noreferrer" className="underline">{s.service.name === 'Recall alerts' ? 'NHTSA' : s.service.name}</a>, the U.S. government's traffic safety agency.
        {' '}<span className="font-medium">What it's sent:</span> {s.service.sends}
      </p>
      {!s.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p> : (
        <div className="mt-2 space-y-2">
          <button type="button" onClick={() => turn(!s.on)} className={`${quietButtonClass} ${tall}`}>{s.on ? 'Turn off' : 'Turn on'}</button>
          {s.on && (
            <div className="space-y-2 text-sm text-gray-800 dark:text-life-50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto">{s.last_check ? <>Last checked {whenText(s.last_check)}</> : 'Not checked yet'}{s.last_check && open > 0 ? ` · ${open} open ${open === 1 ? 'recall' : 'recalls'}` : ''}</span>
                <button type="button" onClick={check} disabled={busy} className={`${quietButtonClass} ${tall} disabled:opacity-50`}>{busy ? 'Checking…' : 'Check now'}</button>
              </div>
              <p>
                {s.vehicles.length === 0 ? 'No car can be checked yet.' : <>It can check {s.vehicles.length} {s.vehicles.length === 1 ? 'car' : 'cars'}: {s.vehicles.map((v, i) => (
                  <span key={v.item_id}>{i > 0 && ', '}<Link to={`/things/${v.item_id}`} className="underline">{v.name}</Link> ({v.year} {v.make} {v.model})</span>
                ))}.</>}
              </p>
              {s.needs_details.length > 0 && (
                <p>
                  These need a make, model and year before they can be checked: {s.needs_details.map((n, i) => (
                    <span key={n.item_id}>{i > 0 && ', '}<Link to={`/things/${n.item_id}`} className="underline">{n.name}</Link> (needs {n.missing.join(', ').toLowerCase()})</span>
                  ))}.
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-life-300">Cars are checked about once a week by themselves. Cars are found by their kind having Make, Model and Year fields, such as the ready-made Vehicles kind.</p>
            </div>
          )}
          {!s.on && s.needs_details.length + s.vehicles.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-life-300">
              {s.vehicles.length} {s.vehicles.length === 1 ? 'car has' : 'cars have'} a make, model and year it could check{s.needs_details.length ? `; ${s.needs_details.length} would need one` : ''}.
            </p>
          )}
          <VinNote />
          {message && <p className="text-sm text-gray-700 dark:text-life-100" role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}

/** One recall, in NHTSA's own words. */
function RecallEntry({ r, onChange, dismissed }) {
  const [busy, setBusy] = useState(false);
  const act = async () => {
    setBusy(true);
    try { await axios.post(`/api/recalls/${r.id}/${dismissed ? 'restore' : 'dismiss'}`); await onChange(); } finally { setBusy(false); }
  };
  return (
    <li className={`rounded-xl p-3 ring-1 ${r.park_it ? 'bg-red-50 ring-red-300 dark:bg-red-950/40 dark:ring-red-800' : r.park_outside ? 'bg-amber-50 ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-800' : 'bg-life-50/60 ring-life-100 dark:bg-life-900/30 dark:ring-life-700'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {r.park_it && <span className="rounded-full bg-red-700 px-2.5 py-0.5 text-xs font-semibold text-white">Do not drive</span>}
        {r.park_outside && <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-semibold text-white">Park outside</span>}
        <h3 className="mr-auto text-sm font-semibold text-gray-900 dark:text-life-50">{r.component || 'Recall'}</h3>
        <span className="text-xs text-gray-600 dark:text-life-200">{[r.reported_on && `Reported ${dayText(r.reported_on)}`, r.campaign].filter(Boolean).join(' · ')}</span>
      </div>
      {r.summary && <p className="mt-2 whitespace-pre-line text-sm text-gray-800 dark:text-life-50">{r.summary}</p>}
      {r.consequence && <p className="mt-2 whitespace-pre-line text-sm text-gray-800 dark:text-life-50"><span className="font-medium">What could happen: </span>{r.consequence}</p>}
      {r.remedy && <p className="mt-2 whitespace-pre-line text-sm text-gray-800 dark:text-life-50"><span className="font-medium">What to do: </span>{r.remedy}</p>}
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={act} disabled={busy} className={`${quietButtonClass} ${tall} disabled:opacity-50`}>{dismissed ? 'Bring it back' : 'Dismiss'}</button>
      </div>
    </li>
  );
}

/**
 * On a car's page: its open recalls, most serious first. With the service off, only a quiet line says it can be
 * turned on; a thing that isn't a car shows nothing at all.
 */
export function ThingRecalls({ itemId }) {
  const [t, setT] = useState(null);
  const [showAside, setShowAside] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (aside = showAside) => {
    try { setT((await axios.get(`/api/recalls/items/${itemId}${aside ? '?dismissed=1' : ''}`)).data); setError(''); } catch (err) { setT(null); setError(errorMessage(err, '')); }
  }, [itemId, showAside]);
  useEffect(() => { load(); }, [load]);
  if (!t || !t.is_vehicle || !t.available) return null;
  if (!t.on) {
    return <p className="text-xs text-gray-500 dark:text-life-300">Recall alerts for this car can be turned on in <Link to="/settings/connections#recalls" className="underline">Settings</Link>.</p>;
  }
  if (!t.vehicle) {
    return (
      <p className="text-xs text-gray-500 dark:text-life-300">
        Recall alerts need this car's make, model and year{t.needs?.length ? ` (it's missing the ${t.needs.join(', ').toLowerCase()})` : ''}. <Link to="/settings/connections#recalls" className="underline">Recall alerts</Link>
      </p>
    );
  }
  const v = t.vehicle;
  const when = whenText(v.checked_at);
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Recalls">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">Recalls for this {v.year} {v.make} {v.model}</h2>
        {when && <span className="text-xs text-gray-500 dark:text-life-300">Checked {when}</span>}
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {v.recalls.length > 0 ? (
        <ul className="space-y-3">{v.recalls.map((r) => <RecallEntry key={r.id} r={r} onChange={() => load()} dismissed={false} />)}</ul>
      ) : (
        <p className="text-sm text-gray-700 dark:text-life-100">
          {v.result === 'not_listed' ? 'NHTSA has nothing under this make, model and year. That can mean no recalls, or that NHTSA spells the make or model differently: check on its own site to be sure.' : v.result === 'failed' ? `The last check didn't work: ${v.message}.` : v.result === 'ok' ? 'No open recalls were found for this make, model and year.' : 'Not checked yet. Press "Check now" in Settings, or wait for the weekly check.'}
        </p>
      )}
      {(t.dismissed_count > 0 || showAside) && (
        <div>
          <button type="button" onClick={() => { const next = !showAside; setShowAside(next); load(next); }} className={`${quietButtonClass} ${tall}`}>
            {showAside ? 'Hide dismissed' : `Show dismissed (${t.dismissed_count})`}
          </button>
          {showAside && t.dismissed.length > 0 && (
            <ul className="mt-3 space-y-3 opacity-80" aria-label="Dismissed recalls">{t.dismissed.map((r) => <RecallEntry key={r.id} r={r} onChange={() => load()} dismissed />)}</ul>
          )}
        </div>
      )}
      <VinNote />
    </section>
  );
}
