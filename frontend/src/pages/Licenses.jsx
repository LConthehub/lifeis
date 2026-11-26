import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import SubChips, { THING_CHIPS } from '../components/SubChips';
import CopyButton from '../components/Copy';
import Modal, { Field, inputClass as baseInput, buttonClass as baseButton, quietButtonClass as baseQuiet, cardClass, errorMessage } from '../components/ui';

// Every control is at least 44px tall, so a thumb finds it.
const inputClass = `${baseInput} min-h-[44px]`;
const buttonClass = `${baseButton} min-h-[44px]`;
const quietButtonClass = `${baseQuiet} min-h-[44px]`;

const LEAD_UNITS = [['day', 'days'], ['week', 'weeks'], ['month', 'months']];
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How far off, in plain words: "3 months", "12 days", "2 years". */
function spanText(days) {
  if (days < 60) return plural(days, 'day');
  const months = Math.round(days / 30.44);
  return months < 24 ? plural(months, 'month') : plural(Math.round(days / 365.25), 'year');
}

/** When it runs out, in words, and whether to warn. */
export function runsOut(license) {
  const left = license.days_left;
  if (left === null) return { text: 'no expiry day', warn: false, late: false };
  if (left < 0) return { text: `ran out ${spanText(-left)} ago`, warn: true, late: true };
  if (left === 0) return { text: 'runs out today', warn: true, late: false };
  if (left === 1) return { text: 'runs out tomorrow', warn: true, late: false };
  return { text: `runs out in ${spanText(left)}`, warn: license.state === 'soon', late: false };
}

/** The name with whose it is, for a sentence: "Dana's driver's license". */
const ownedName = (l) => (l.holder ? `${l.holder}'s ${/[A-Z]/.test(l.name.slice(1)) ? l.name : l.name.charAt(0).toLowerCase() + l.name.slice(1)}` : l.name);

/** The licenses and permits a household keeps: whose, what number, who issued it, when it runs out, and the reminder to renew. */
export default function LicensesPage() {
  const [licenses, setLicenses] = useState(null);
  const [ready, setReady] = useState(null);
  const [names, setNames] = useState({ members: [], pets: [] });
  const [modal, setModal] = useState(null); // { license?, start? } to add or change, { remove: license }
  const load = useCallback(() => {
    axios.get('/api/things/licenses').then(({ data }) => setLicenses(data)).catch(() => setLicenses([]));
  }, []);
  useEffect(() => {
    load();
    axios.get('/api/things/licenses/ready').then(({ data }) => setReady(data)).catch(() => setReady({ categories: [], starters: [], soon_days: 60, leads: {} }));
    Promise.all([axios.get('/api/things/upkeep/members').catch(() => ({ data: [] })), axios.get('/api/things/pets').catch(() => ({ data: [] }))])
      .then(([m, p]) => setNames({ members: m.data.map((x) => x.name), pets: p.data.map((x) => x.name) }));
  }, [load]);
  if (!licenses || !ready) return null;

  const attention = licenses.filter((l) => l.state === 'expired' || l.state === 'soon')
    .sort((a, b) => a.days_left - b.days_left);
  const groups = [];
  for (const l of licenses) {
    const who = l.holder ?? '';
    let g = groups.find((x) => x.who === who);
    if (!g) { g = { who, items: [] }; groups.push(g); }
    g.items.push(l);
  }
  groups.sort((a, b) => (a.who === '' ? 1 : b.who === '' ? -1 : a.who.localeCompare(b.who)));
  const done = () => { setModal(null); load(); };

  return (
    <div className="space-y-4">
      <SubChips items={THING_CHIPS} label="Things and licenses" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Licenses</h1>
        <button type="button" onClick={() => setModal({ start: true })} className={buttonClass}>+ Add a license</button>
      </div>

      {attention.length > 0 && (
        <section role="status" aria-label="Licenses running out" className={`rounded-2xl p-4 text-sm ring-1 ${attention.some((l) => l.state === 'expired') ? 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-900' : 'bg-honey-100 text-honey-700 ring-honey-100'}`}>
          <h2 className="font-semibold">{attention.length === 1 ? 'One license needs attention' : `${attention.length} licenses need attention`}</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {attention.map((l) => <li key={l.id}>{ownedName(l)} {runsOut(l).text}</li>)}
          </ul>
        </section>
      )}

      {licenses.length === 0 ? (
        <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          Driver&apos;s licenses, passports, fishing and professional licenses, pet tags, parking permits: who each belongs to, its number, who issued it and when it runs out.
          Life Is can remind you in time to renew.
        </p>
      ) : groups.map((g) => (
        <section key={g.who || 'household'} aria-label={g.who || 'Household'} className="space-y-2">
          <h2 className="text-sm font-semibold text-life-700 dark:text-life-100">{g.who || 'Household'}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.items.map((l) => <li key={l.id}><LicenseCard license={l} onChange={() => setModal({ license: l })} onRemind={() => setModal({ license: l, remind: true })} onRemove={() => setModal({ remove: l })} /></li>)}
          </ul>
        </section>
      ))}

      {modal?.remove && <RemoveForm license={modal.remove} onClose={() => setModal(null)} onDone={done} />}
      {(modal?.license || modal?.start) && (
        <Modal title={modal.license ? ownedName(modal.license) : 'A license'} onClose={() => setModal(null)}>
          <LicenseForm license={modal.license} remindFirst={Boolean(modal.remind)} ready={ready} names={names} onDone={done} />
        </Modal>
      )}
    </div>
  );
}

function LicenseCard({ license: l, onChange, onRemind, onRemove }) {
  const [number, setNumber] = useState(null); // null: hidden
  const [error, setError] = useState('');
  const out = runsOut(l);
  // A number is not left on the screen: it hides itself again after a minute.
  useEffect(() => {
    if (number === null) return undefined;
    const timer = setTimeout(() => setNumber(null), 60_000);
    return () => clearTimeout(timer);
  }, [number]);
  const show = async () => {
    setError('');
    try { setNumber((await axios.get(`/api/things/licenses/${l.id}`)).data.number ?? ''); } catch (err) { setError(errorMessage(err, "Couldn't open that")); }
  };
  const r = l.reminder;
  return (
    <article className={`${cardClass} space-y-2`} aria-label={ownedName(l)} data-state={l.state}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="mr-auto font-semibold text-life-800 dark:text-life-50">{l.name}</h3>
        {l.category && <span className="rounded bg-life-50 px-1.5 py-0.5 text-[11px] text-life-700 dark:bg-life-700 dark:text-life-100">{l.category}</span>}
      </div>
      <p className={`text-sm ${out.late ? 'font-medium text-red-700 dark:text-red-300' : out.warn ? 'font-medium text-honey-700' : 'text-gray-700 dark:text-life-100'}`} data-runs-out>
        {out.text[0].toUpperCase() + out.text.slice(1)}{l.expires_on ? <span className="font-normal text-gray-500 dark:text-life-300"> · {dayText(l.expires_on)}</span> : null}
      </p>
      {(l.issuer || l.issued_on) && (
        <p className="text-xs text-gray-500 dark:text-life-300">{[l.issuer, l.issued_on && `issued ${dayText(l.issued_on)}`].filter(Boolean).join(' · ')}</p>
      )}
      {l.note && <p className="whitespace-pre-line text-sm text-gray-700 dark:text-life-100">{l.note}</p>}

      {l.has_number && (
        <div className="flex flex-wrap items-center gap-2">
          {number === null ? (
            <button type="button" onClick={show} aria-label={`Show the number for ${ownedName(l)}`} className={quietButtonClass}>Show number</button>
          ) : (
            <>
              <code className="min-w-0 break-all rounded bg-life-50 px-2 py-1.5 font-mono text-sm text-gray-800 dark:bg-life-900 dark:text-life-50" data-license-number>{number}</code>
              <CopyButton text={number} what={`the number for ${ownedName(l)}`} />
              <button type="button" onClick={() => setNumber(null)} aria-label={`Hide the number for ${ownedName(l)}`} className={quietButtonClass}>Hide</button>
            </>
          )}
        </div>
      )}

      {r ? (
        <p className="text-sm text-gray-700 dark:text-life-100">
          <Link to={`/things/upkeep/${r.job_id}`} className="underline">Reminder set</Link>
          {r.due_on ? `: due ${dayText(r.due_on)}` : ''}
          {r.term_years ? `, then every ${plural(r.term_years, 'year')}` : ', once'}
        </p>
      ) : l.expires_on ? null : <p className="text-xs text-gray-500 dark:text-life-300">Add the day it runs out to be reminded to renew.</p>}
      {r?.renewed && (
        <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700" role="note">Renewed? Update the new expiry day.{' '}
          <button type="button" onClick={onChange} className="min-h-[44px] underline">Change it</button></p>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!r && l.expires_on && <button type="button" onClick={onRemind} aria-label={`Remind me to renew ${ownedName(l)}`} className={quietButtonClass}>Remind me to renew</button>}
        <button type="button" onClick={onChange} aria-label={`Change ${ownedName(l)}`} className={quietButtonClass}>Change</button>
        <button type="button" onClick={onRemove} aria-label={`Remove ${ownedName(l)}`} className={`${quietButtonClass} !text-red-700`}>Remove</button>
      </div>
    </article>
  );
}

/** Taking one away: with its reminder in Upkeep or without it. */
function RemoveForm({ license: l, onClose, onDone }) {
  const [error, setError] = useState('');
  const go = async (withReminder) => {
    try { await axios.delete(`/api/things/licenses/${l.id}${withReminder ? '?reminder=1' : ''}`); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't remove that")); }
  };
  return (
    <Modal title={`Remove ${ownedName(l)}?`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-life-100">
          {l.reminder ? 'It has a reminder to renew in Upkeep. Take that away too, or leave it there?' : 'This takes it out of Life Is for good.'}
        </p>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={quietButtonClass}>Keep it</button>
          {l.reminder
            ? (<>
              <button type="button" onClick={() => go(false)} className={quietButtonClass}>Remove it, keep the reminder</button>
              <button type="button" onClick={() => go(true)} className={buttonClass}>Remove both</button>
            </>)
            : <button type="button" onClick={() => go(false)} className={buttonClass}>Remove it</button>}
        </div>
      </div>
    </Modal>
  );
}

/** The years between two days when they are whole years apart (issued 2042-04-04, runs out 2046-04-04: 4), else empty. */
function wholeYears(from, to) {
  if (!from || !to || from.slice(5) !== to.slice(5)) return '';
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return years >= 1 && years <= 100 ? String(years) : '';
}

function LicenseForm({ license, remindFirst, ready, names, onDone }) {
  const editing = Boolean(license);
  const [form, setForm] = useState({ name: license?.name ?? '', holder: license?.holder ?? '', category: license?.category ?? '', number: '', issuer: license?.issuer ?? '',
    issued_on: license?.issued_on ?? '', expires_on: license?.expires_on ?? '', note: license?.note ?? '' });
  const [term, setTerm] = useState(license?.reminder?.term_years ? String(license.reminder.term_years) : wholeYears(license?.issued_on, license?.expires_on));
  const [remind, setRemind] = useState(Boolean(remindFirst));
  const [lead, setLead] = useState(ready.leads[license?.category ?? '']?.n ? { n: ready.leads[license.category].n, unit: ready.leads[license.category].unit } : { n: 30, unit: 'day' });
  const [leadTouched, setLeadTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The number is not in the list: it is asked for only to change it.
  const [loaded, setLoaded] = useState(!editing || !license.has_number);
  useEffect(() => {
    if (!editing || !license.has_number) return;
    axios.get(`/api/things/licenses/${license.id}`).then(({ data }) => { setForm((f) => ({ ...f, number: data.number ?? '' })); setLoaded(true); }).catch(() => setLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setCategory = (e) => {
    const category = e.target.value;
    setForm({ ...form, category });
    // The usual lead for a kind of license, until the person picks their own.
    if (!leadTouched) { const usual = ready.leads[category]; setLead(usual ? { n: usual.n, unit: usual.unit } : { n: 30, unit: 'day' }); }
  };
  const pick = (s) => {
    setForm({ ...form, name: s.name, category: s.category, issuer: s.issuer ?? '', note: form.note || (s.note ?? '') });
    setTerm(s.term_years ? String(s.term_years) : '');
    if (!leadTouched) { const usual = ready.leads[s.category]; setLead(usual ? { n: usual.n, unit: usual.unit } : { n: 30, unit: 'day' }); }
  };
  const why = ready.leads[form.category]?.why;
  const hasReminder = Boolean(license?.reminder);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' && k !== 'name' ? null : v]));
    try {
      const saved = editing ? (await axios.put(`/api/things/licenses/${license.id}`, body)).data : (await axios.post('/api/things/licenses', body)).data;
      if (remind && !hasReminder) {
        await axios.post(`/api/things/licenses/${saved.id}/reminder`, { lead_n: Number(lead.n), lead_unit: lead.unit, term_years: term ? Number(term) : null });
      }
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save")); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!editing && (
        <div role="group" aria-label="Ready-made licenses" className="space-y-1">
          <p className="text-xs font-medium text-gray-600 dark:text-life-200">Start from a common one</p>
          <div className="flex flex-wrap gap-1.5">
            {ready.starters.map((s) => (
              <button key={s.name} type="button" onClick={() => pick(s)} className="min-h-[44px] rounded-full bg-life-50 px-3 py-1 text-xs text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-100">{s.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What it is *"><input required autoFocus={!editing} value={form.name} onChange={set('name')} placeholder="Driver's license, passport…" className={inputClass} /></Field>
        <Field label="Whose it is">
          <input list="license-holders" value={form.holder} onChange={set('holder')} placeholder="Leave empty for the household" className={inputClass} />
          <datalist id="license-holders">
            {names.members.map((n) => <option key={`m-${n}`} value={n} />)}
            {names.pets.map((n) => <option key={`p-${n}`} value={n} />)}
          </datalist>
        </Field>
        <Field label="Kind">
          <select value={form.category} onChange={setCategory} className={inputClass}>
            <option value="">No kind</option>
            {ready.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Number">
          <input value={form.number} onChange={set('number')} disabled={!loaded} autoComplete="off" spellCheck={false} className={inputClass} />
        </Field>
        <Field label="Issued by"><input value={form.issuer} onChange={set('issuer')} placeholder="The state DMV, a county…" className={inputClass} /></Field>
        <Field label="Term in years"><input type="number" min="1" max="100" step="1" value={term} onChange={(e) => setTerm(e.target.value)} disabled={hasReminder} className={inputClass} /></Field>
        <Field label="Issued on"><input type="date" value={form.issued_on} onChange={set('issued_on')} className={inputClass} /></Field>
        <Field label="Runs out on"><input type="date" value={form.expires_on} onChange={set('expires_on')} className={inputClass} /></Field>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">The term is how many years a renewed one lasts, so the reminder comes round again. Leave it empty for a one-time reminder.</p>
      <Field label="Notes"><textarea rows={2} value={form.note} onChange={set('note')} placeholder="Where the card is kept, what renewing needs" className={inputClass} /></Field>

      {hasReminder ? (
        <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-900 dark:text-life-100">
          Its reminder to renew is set, and its due day follows this expiry day: change the day here and the reminder moves with it.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg bg-life-50 p-3 dark:bg-life-900">
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 dark:text-life-50">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} disabled={!form.expires_on} className="h-5 w-5" />
            Remind me to renew
          </label>
          {!form.expires_on && <p className="text-xs text-gray-500 dark:text-life-300">Add the day it runs out first.</p>}
          {remind && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
                Start
                <input type="number" min="0" max="1000" step="1" value={lead.n} onChange={(e) => { setLeadTouched(true); setLead({ ...lead, n: e.target.value }); }} aria-label="How long before it runs out" className={`${inputClass} !w-24`} />
                <select value={lead.unit} onChange={(e) => { setLeadTouched(true); setLead({ ...lead, unit: e.target.value }); }} aria-label="Days, weeks or months" className={`${inputClass} !w-28`}>
                  {LEAD_UNITS.map(([u, many]) => <option key={u} value={u}>{many}</option>)}
                </select>
                before it runs out
              </div>
              {why && <p className="text-xs text-gray-600 dark:text-life-200" data-why>{why}</p>}
              <p className="text-xs text-gray-500 dark:text-life-300">It is a renewal in Upkeep, so it shows in your morning reminder and the calendar. It moves if you change the expiry day.</p>
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={busy} className={buttonClass}>Save</button></div>
    </form>
  );
}
