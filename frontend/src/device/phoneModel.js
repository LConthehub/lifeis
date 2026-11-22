/**
 * The phone's own built-in AI, for the assistant: Apple Intelligence on an iPhone or iPad, Gemini Nano on
 * Android phones that have it. The model is part of the phone, so a question and what it is given never leave
 * the device.
 *
 * Not every phone has one (older iPhones, most Android phones today). `check` says so in words, and the
 * assistant then offers only a model at an address.
 *
 * Written against @capgo/capacitor-llm, which wraps both. Not yet run on a real phone: the pretend phone on a
 * computer has neither model.
 */
import { Capacitor } from '@capacitor/core';

const NAMES = { ios: 'Apple Intelligence', android: 'Gemini Nano' };
const ANSWER_WITHIN = 120_000;

/** The phone's model, or null where there can't be one (a browser). */
export function phoneModel() {
  const platform = Capacitor.getPlatform();
  const name = NAMES[platform];
  if (!name) return null;
  let plugin = null;
  let loaded = null;
  const llm = async () => {
    plugin ??= (await import('@capgo/capacitor-llm')).CapgoLLM;
    return plugin;
  };
  // The model is chosen once per opening of the app; a failure is tried again next time.
  const load = () => {
    loaded ??= llm().then((p) => p.setModel({ path: name, temperature: 0.2 }).then(() => p)).catch((problem) => { loaded = null; throw problem; });
    return loaded;
  };

  return {
    name,
    async check() {
      try {
        const p = await load();
        const { readiness } = await p.getReadiness();
        if (['ready', 'available'].includes(readiness)) return { ready: true };
        if (readiness === 'downloading') return { ready: false, why: `${name} is still downloading onto this ${platform === 'ios' ? 'device' : 'phone'}. Try again later.` };
        return { ready: false, why: `${name} isn't ready on this device (${readiness}).` };
      } catch {
        return {
          ready: false,
          why: platform === 'ios'
            ? 'Apple Intelligence needs iOS 26 or later on an iPhone 15 Pro or newer, or an iPad with an M-series chip, with Apple Intelligence turned on in Settings.'
            : "This phone doesn't have Gemini Nano. Google offers it on recent Pixel phones and some other recent Android phones.",
        };
      }
    },
    async answer(system, prompt) {
      const p = await load();
      const { id } = await p.createChat();
      let text = '';
      const listeners = [];
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No answer in time')), ANSWER_WITHIN);
          const done = (fn) => (value) => { clearTimeout(timer); fn(value); };
          Promise.all([
            p.addListener('textFromAi', (e) => { if (e.chatId === id) text += e.text; }),
            p.addListener('aiFinished', (e) => { if (e.chatId === id) done(resolve)(text); }),
            p.addListener('generationError', (e) => { if (!e.chatId || e.chatId === id) done(reject)(new Error(e.error)); }),
          ]).then((added) => {
            listeners.push(...added);
            // The plugin's chat has no separate place for instructions, so they go first in the one message.
            return p.sendMessage({ chatId: id, message: `${system}\n\n${prompt}` });
          }).catch(done(reject));
        });
      } finally {
        await Promise.all(listeners.map((l) => l.remove().catch(() => {})));
      }
    },
  };
}
