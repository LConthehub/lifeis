import { useEffect, useState } from 'react';
import axios from 'axios';
import Modal, { buttonClass, quietButtonClass, errorMessage } from './ui';
import { StartDialog } from './Start';

const GROUPS = [['home', 'Around the home'], ['doing', 'Things you make and do']];

/** What Life Is looks after, as tick boxes. Saving shows the sections that fit and adds ready-made kinds of things. */
export function LifeAreasPicker({ onSaved, onSkip, saveLabel = 'Save' }) {
  const [profile, setProfile] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    axios.get('/api/life').then(({ data }) => { setProfile(data); setChosen(data.areas || []); }).catch(() => {});
  }, []);
  const toggle = (key) => setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const save = async (areas) => {
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await axios.put('/api/life', { areas });
      setMessage({ ok: data.added.length ? `Added to your kinds of things: ${data.added.join(', ')}.` : 'Saved.' });
      onSaved?.(data);
    } catch (err) {
      setMessage({ error: errorMessage(err, "Couldn't save") });
    } finally {
      setSaving(false);
    }
  };
  if (!profile) return null;
  return (
    <div className="space-y-3">
      {GROUPS.map(([group, title]) => (
        <fieldset key={group} className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{title}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {profile.options.filter((o) => o.group === group).map((o) => (
              <label key={o.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${chosen.includes(o.key) ? 'border-life-300 bg-life-50 dark:border-life-500 dark:bg-life-700' : 'border-gray-200 dark:border-life-700'}`}>
                <input type="checkbox" checked={chosen.includes(o.key)} onChange={() => toggle(o.key)} className="mt-0.5 accent-life-600" />
                <span>
                  <span className="block font-medium text-gray-800 dark:text-life-50">{o.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-life-300">{o.about}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-gray-500 dark:text-life-300">
        Life Is shows the parts that fit. Each thing you make and do adds ready-made kinds of things to start from, which you can rename, change or remove.
        Unchecking something later only hides it: nothing you've saved is deleted.
      </p>
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-life-50 text-life-800 dark:bg-life-700 dark:text-life-50' : 'bg-red-50 text-red-700'}`}>{message.ok || message.error}</p>}
      <div className="flex justify-end gap-2">
        {onSkip && <button type="button" disabled={saving} onClick={() => save([]).then(onSkip)} className={quietButtonClass}>Skip, show me everything</button>}
        <button type="button" disabled={saving} onClick={() => save(chosen)} className={buttonClass}>{saving ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
  );
}

/**
 * Asked once, after the first sign-in, until the person answers or skips. A household that is just beginning gets
 * the short guided start (Start.jsx); anyone else gets the long checklist, as before. Closing the guided start
 * part way is remembered, so it is not shown again on its own: the front page offers to finish it.
 */
export function LifeFirstRun({ open, onDone }) {
  const [mode, setMode] = useState(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!open) { setMode(null); return; }
    axios.get('/api/start').then(({ data }) => setMode(data.first_run)).catch(() => setMode('checklist'));
  }, [open]);
  if (!open || closed || !mode || mode === 'quiet') return null;
  if (mode === 'guide') return <StartDialog onDone={(data) => onDone(data)} onClose={() => { setClosed(true); onDone(); }} />;
  return (
    <Modal title="What does life need looking after?" onClose={onDone}>
      <p className="mb-3 text-sm text-gray-600 dark:text-life-100">Check everything that applies. Life Is sets itself up to match, and you can change it any time in Settings.</p>
      <LifeAreasPicker saveLabel="Set up Life Is" onSaved={(data) => setTimeout(() => onDone(data), data.added.length ? 1400 : 300)} onSkip={() => onDone()} />
    </Modal>
  );
}
