import { useEffect, useRef, useState } from 'react';
import { inputClass, quietButtonClass } from './ui';

const cameraTrouble = (problem) => {
  const name = problem?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return "The camera wasn't allowed. Allow it for this site in your browser's settings, or type the number below.";
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Type the number below.';
  if (name === 'NotReadableError') return 'The camera is in use by something else. Close that, or type the number below.';
  return "The camera couldn't be started. Type the number below.";
};

/**
 * Reads a barcode (or a QR code) with the camera. The picture is read here, in the browser, and goes nowhere:
 * only the number that was read is handed on. Typing the number works too, which is also how a handheld
 * scanner plugged into the computer sends it.
 */
export default function Scanner({ onCode, label = 'Point the camera at the barcode' }) {
  const video = useRef(null);
  const handed = useRef(false);
  const [state, setState] = useState('starting');   // starting, looking, or a sentence saying what went wrong
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let controls = null;
    let gone = false;
    const give = (code) => {
      if (handed.current || !code) return;
      handed.current = true;
      controls?.stop();
      onCode(code);
    };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState(window.isSecureContext ? 'This browser has no camera to offer. Type the number below.' : 'The camera only works when Life Is is opened over https (or on this computer itself). Type the number below.');
        return;
      }
      try {
        // The reader is only fetched when a scan is started, so the rest of Life Is doesn't carry it.
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (gone) return;
        const started = await new BrowserMultiFormatReader().decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          video.current, (result) => { if (result) give(result.getText().trim()); });
        if (gone) started.stop(); else { controls = started; setState('looking'); }
      } catch (problem) {
        if (!gone) setState(cameraTrouble(problem));
      }
    })();
    return () => { gone = true; controls?.stop(); };
  }, [onCode]);

  const submit = (e) => {
    e.preventDefault();
    const code = typed.trim();
    if (code && !handed.current) { handed.current = true; onCode(code); }
  };
  const working = state === 'starting' || state === 'looking';
  return (
    <div className="space-y-3">
      {working ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} muted playsInline className="aspect-video w-full object-cover" aria-label="What the camera sees" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-coral/80" />
          <p className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-1.5 text-center text-xs text-white">{state === 'starting' ? 'Starting the camera…' : label}</p>
        </div>
      ) : <p role="alert" className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">{state}</p>}
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="flex-1 text-xs text-gray-600 dark:text-life-200">Or type the number under the bars
          <input inputMode="numeric" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <button type="submit" className={quietButtonClass}>Find</button>
      </form>
      <p className="text-[11px] text-gray-400 dark:text-life-400">The picture is read on this device and never sent anywhere.</p>
    </div>
  );
}
