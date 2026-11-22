/**
 * An optional assistant: questions about your own household, answered by an AI model you choose.
 *
 * Answers come from one of two places, chosen by the person:
 *   - the phone's own built-in AI (Apple Intelligence on an iPhone or iPad, Gemini Nano on Android), in the app.
 *     The model is part of the phone, so nothing leaves the device. It is small, so it is given less.
 *   - a model at an address, the way Sworkr's assistant works: one you run yourself (Ollama, LM Studio,
 *     llama.cpp's server: all speak the same OpenAI-style language). Addresses on this computer or your own
 *     network are allowed as they are. Anything else (a cloud AI) needs an explicit "yes, my information leaves
 *     this computer" tick, and that is off by default.
 *
 * What the model is given is chosen by you, part by part (the kitchen, your things, projects, spending, the
 * calendar), and you can see exactly what was sent with every answer. Never: mail, passwords, notes on the
 * calendar, or anything someone else hasn't shared with you. Times from a calendar you follow go as "busy" and
 * nothing more, whatever that calendar shows elsewhere.
 *
 * The assistant answers; it never changes anything in Life Is.
 */
import type { Db } from './db.ts';
import type { Fetcher, Sealer } from './connections.ts';
import { placePaths } from './inventory.ts';
import { money } from './money.ts';
import { Problem } from './problem.ts';
import { projects } from './projects.ts';
import { addDays, clean, todayOf, type Clock } from './small.ts';

export const ASSISTANT_SERVICE = {
  name: 'An AI assistant',
  sends: 'Only when you ask a question: your question, and what Life Is holds in the parts you check below, go to the model at the address you give. ' +
    'Nothing is sent at any other time, and the assistant can\'t change anything in Life Is. With a model on your own computer or network, nothing leaves home.',
};
/** LM Studio on the computer running Docker, as Sworkr starts with. Ollama is the same address with port 11434. */
export const DEFAULT_URL = 'http://host.docker.internal:1234/v1';
export const AREAS = ['kitchen', 'things', 'projects', 'spending', 'calendar'] as const;
export type Area = (typeof AREAS)[number];
/** Small models take in only so much. Past this, the longest lists are shortened, and the model is told. */
export const FACTS_LIMIT = 24_000;
/** A phone's built-in model takes in far less (Apple's on-device model reads about 4,000 tokens in all). */
export const PHONE_FACTS_LIMIT = 6_000;

/**
 * The phone's own built-in model, handed in by the app. Never present on a server or in a browser.
 * `check` says whether it can answer now; `answer` gives its reply to one prompt.
 */
export type PhoneModel = {
  name: string;
  check(): Promise<{ ready: boolean; why?: string }>;
  answer(system: string, prompt: string): Promise<string>;
};
export type AssistantTools = { fetcher?: Fetcher; sealer?: Sealer; phone?: PhoneModel };
export type Source = 'address' | 'phone';

const SETTING = 'assistant';
const SYSTEM = 'You help someone with their own household. Answer ONLY from the JSON facts you are given about their home: ' +
  'recipes, pantry, groceries, the things they own and where they are, projects, spending and calendar. If the facts don\'t hold the answer, ' +
  'say so plainly instead of guessing. Be brief and concrete. You can\'t change anything in their records; if they ask you to, ' +
  'say what they could do in Life Is instead. Money is in the currency the facts give.';

export type AssistantStatus = {
  available: boolean;
  enabled: boolean;
  /** Where answers come from: the phone's built-in AI, or a model at an address. */
  source: Source;
  /** The phone's built-in AI, when this is the app on a phone that may have one. */
  phone: { name: string } | null;
  url: string;
  model: string;
  /** Whether a cloud AI (an address that isn't this computer or your own network) has been allowed. */
  cloud_ok: boolean;
  key_saved: boolean;
  /** Whether nothing leaves home: the phone's own model, or an address on this computer or your own network. */
  local: boolean;
  areas: Area[];
  service: typeof ASSISTANT_SERVICE;
};
export type AssistantInput = { source?: string; enabled?: boolean; url?: string | null; model?: string | null; cloud_ok?: boolean; key?: string | null; clear_key?: boolean; areas?: string[] };
type Kept = { source: Source; enabled: boolean; url: string; model: string; cloud_ok: boolean; key: string | null; areas: Area[] };

/** This computer, your own network, or your Tailscale network. */
export function isLocal(address: string): boolean {
  let host: string;
  try { host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (['localhost', 'host.docker.internal'].includes(host) || /\.(local|lan|home\.arpa|ts\.net|localhost|internal)$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

/**
 * What a model is told when it is handed a photo of a recipe. It copies; it doesn't cook. Life Is keeps a
 * recipe as it was written, so the model is asked for the words on the page and nothing of its own.
 */
const COPY_OUT = 'You are shown a photo of a recipe, handwritten or printed. Copy out exactly what is written, in the same words, ' +
  'the same amounts and the same order. Do not correct, reword, translate, shorten or add anything, and do not comment. ' +
  'Put the title on the first line. Then the ingredients, one to a line. Then the steps, one to a line. ' +
  'Where a word cannot be read, write [?] in its place. If the photo is not a recipe, or nothing can be read, answer with exactly: NOTHING';
/** A photo no larger than this is sent as it is; the page shrinks photos well below it. */
const MAX_PICTURE_BYTES = 4_000_000;

/** Thinking some models write out before their answer (<think>…</think>) is left out of what is shown. */
const answerOnly = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export function assistant(db: Db, owner: number, clock: Clock = () => new Date(), tools?: AssistantTools) {
  async function kept(): Promise<Kept> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    let saved: Partial<Kept> = {};
    try { saved = row?.value ? JSON.parse(row.value) as Partial<Kept> : {}; } catch { /* start again */ }
    return {
      // The phone's model only where there is one: a backup brought to a server falls back to an address.
      source: saved.source === 'phone' && tools?.phone ? 'phone' : 'address',
      enabled: saved.enabled === true, url: typeof saved.url === 'string' ? saved.url : DEFAULT_URL, model: typeof saved.model === 'string' ? saved.model : '',
      cloud_ok: saved.cloud_ok === true, key: typeof saved.key === 'string' ? saved.key : null,
      areas: Array.isArray(saved.areas) ? saved.areas.filter((a): a is Area => (AREAS as readonly string[]).includes(a)) : ['kitchen'],
    };
  }
  const keep = (k: Kept) => db.run(
    'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value', [owner, SETTING, JSON.stringify(k)]);
  const shown = (k: Kept): AssistantStatus => ({
    available: Boolean(tools?.fetcher || tools?.phone), enabled: k.enabled, source: k.source, phone: tools?.phone ? { name: tools.phone.name } : null,
    url: k.url, model: k.model, cloud_ok: k.cloud_ok, key_saved: k.key !== null, local: k.source === 'phone' || isLocal(k.url), areas: k.areas, service: ASSISTANT_SERVICE,
  });
  const need = () => {
    if (!tools?.fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    return tools.fetcher;
  };
  const sealer = () => {
    if (!tools?.sealer) throw new Problem(400, "A key can't be kept safely here yet. Use a model that needs no key, such as one on your own network.");
    return tools.sealer;
  };
  async function call(k: Kept, path: string, send?: string) {
    const key = k.key ? sealer().unseal(k.key) : null;
    const headers: Record<string, string> = { Accept: 'application/json', ...(send ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) };
    let answer;
    try {
      answer = await need()(k.url + path, headers, send ? { method: 'POST', body: send } : undefined);
    } catch {
      throw new Problem(400, `Couldn't reach ${k.url}. Is the model running? If it's on the computer that runs Life Is in Docker, use host.docker.internal instead of localhost.`);
    }
    if (answer.status === 401 || answer.status === 403) throw new Problem(400, "The model's server didn't accept the key");
    if (answer.status >= 400) throw new Problem(400, `The model's server answered with an error (${answer.status})`);
    try { return await answer.json() as Record<string, unknown>; } catch { throw new Problem(400, "The model's server sent something that isn't an answer"); }
  }

  /** What the model is given: the ticked parts of Life Is, as plain facts. */
  async function facts(areas: Area[], limit = FACTS_LIMIT): Promise<Record<string, unknown>> {
    const today = todayOf(clock);
    const out: Record<string, unknown> = { today };
    if (areas.includes('kitchen')) {
      const recipes = await db.all<{ id: number; title: string; tags: string | null }>('SELECT id, title, tags FROM recipes WHERE owner_id = ? ORDER BY title', [owner]);
      const lines = await db.all<{ recipe_id: number; text: string }>(
        "SELECT l.recipe_id, l.text FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id WHERE r.owner_id = ? AND l.part = 'ingredients' AND l.is_heading = 0 ORDER BY l.recipe_id, l.sort_order", [owner]);
      out.recipes = recipes.map((r) => ({
        title: r.title, ...(r.tags ? { tags: r.tags } : {}), ingredients: lines.filter((l) => l.recipe_id === r.id).map((l) => l.text).slice(0, 40),
      }));
      out.pantry = (await db.all<{ name: string; quantity: number | null; unit: string | null; expires_on: string | null }>(
        'SELECT i.name, p.quantity, p.unit, p.expires_on FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id WHERE p.owner_id = ? ORDER BY i.name', [owner]))
        .map((p) => ({ name: p.name, ...(p.quantity !== null ? { amount: [p.quantity, p.unit].filter((x) => x !== null).join(' ') } : {}), ...(p.expires_on ? { use_by: p.expires_on } : {}) }));
      out.grocery_list = (await db.all<{ label: string; quantity: number | null; unit: string | null }>(
        'SELECT label, quantity, unit FROM grocery WHERE owner_id = ? AND done = 0 ORDER BY id', [owner])).map((g) => [g.quantity, g.unit, g.label].filter((x) => x !== null).join(' '));
      out.meals_this_week = await db.all(
        `SELECT m.day, m.meal, COALESCE(r.title, m.title) AS what FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
         WHERE m.owner_id = ? AND m.day BETWEEN ? AND ? ORDER BY m.day, m.meal`, [owner, today, addDays(today, 7)]);
    }
    if (areas.includes('things')) {
      const places = placePaths(await db.all('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]));
      out.things = (await db.all<{ name: string; kind: string; quantity: number | null; unit: string | null; place_id: number | null }>(
        'SELECT i.name, k.name AS kind, i.quantity, i.unit, i.place_id FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? ORDER BY k.name, i.name', [owner]))
        .map((t) => ({ name: t.name, kind: t.kind, ...(t.quantity !== null ? { amount: [t.quantity, t.unit].filter((x) => x !== null).join(' ') } : {}), ...(t.place_id !== null && places.has(t.place_id) ? { where: places.get(t.place_id) } : {}) }));
    }
    if (areas.includes('projects')) {
      const making = projects(db, owner, clock);
      const open = (await making.listProjects()).filter((p) => !['done', 'dropped'].includes(p.status)).slice(0, 30);
      out.projects = await Promise.all(open.map(async (p) => {
        const whole = await making.getProject(p.id);
        return {
          name: p.name, status: p.status, ...(p.activity ? { activity: p.activity } : {}), ...(p.due_on ? { wanted_by: p.due_on } : {}),
          uses: whole.lines.map((l) => ({ what: l.label, ...(l.amount ? { amount: l.amount } : {}), ...(l.short ? { short_by: l.short_text } : {}), ...(l.used_on ? { used: true } : {}) })),
          ...(whole.costs.length ? { budget: { planned_cents: whole.budget.planned, spent_cents: whole.budget.spent, left_cents: whole.budget.left } } : {}),
        };
      }));
    }
    if (areas.includes('spending')) {
      const month = await money(db, owner, clock).month();
      out.spending_this_month = {
        month: month.month, currency: month.currency, amounts_are: 'cents',
        categories: month.categories.map((c) => ({ name: c.name, planned: c.monthly_cents, spent: c.spent, left: c.left })),
        in_no_category: month.uncategorised, paid_on_projects: month.projects.spent, total: month.total,
        spent_on: month.entries.map((e) => ({ day: e.day, what: e.label, cents: e.cents, ...(e.category ? { category: e.category } : {}) })),
      };
    }
    if (areas.includes('calendar')) {
      const until = addDays(today, 30);
      out.calendar_next_30_days = await db.all('SELECT day, end_day, time, title FROM events WHERE owner_id = ? AND day BETWEEN ? AND ? ORDER BY day, time', [owner, today, until]);
      // Other calendars: when, and nothing about what.
      out.busy_times = (await db.all<{ day: string; time: string | null; end_time: string | null }>(
        `SELECT e.day, e.time, e.end_time FROM followed_events e JOIN followed_calendars f ON f.id = e.calendar_id
         WHERE f.owner_id = ? AND e.day BETWEEN ? AND ? ORDER BY e.day, e.time`, [owner, today, until])).map((b) => ({ ...b, what: 'busy' }));
    }
    // Small models take in only so much: the longest lists are shortened until it fits, and the model is told.
    const lists = ['recipes', 'things', 'spent_on', 'calendar_next_30_days', 'pantry'];
    for (let size = JSON.stringify(out).length, rounds = 0; size > limit && rounds < 60; size = JSON.stringify(out).length, rounds += 1) {
      const holders = lists.map((name) => [name, name === 'spent_on' ? (out.spending_this_month as { spent_on?: unknown[] } | undefined)?.spent_on : out[name]] as const)
        .filter((h): h is readonly [string, unknown[]] => Array.isArray(h[1]) && h[1].length > 1)
        .sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length);
      const longest = holders[0];
      if (!longest) break;
      longest[1].length = Math.ceil(longest[1].length / 2);
      out.note = 'Some lists were shortened to fit; say so if the answer might be in what was left out.';
    }
    return out;
  }

  return {
    async status(): Promise<AssistantStatus> { return shown(await kept()); },

    async save(input: AssistantInput): Promise<AssistantStatus> {
      const before = await kept();
      const source: Source = input.source === undefined ? before.source : input.source === 'phone' ? 'phone' : 'address';
      if (source === 'phone' && !tools?.phone) throw new Problem(400, "This device has no built-in AI that Life Is can use");
      const url = input.url === undefined || input.url === null ? before.url : input.url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Problem(400, 'The address starts with http:// or https://');
      const cloudOk = input.cloud_ok ?? before.cloud_ok;
      // The address only matters when answers come from it; choosing the phone's own model never needs the tick.
      if (source === 'address' && !isLocal(url) && !cloudOk) {
        throw new Problem(400, "That address isn't on this computer or your own network. Check the box to allow a cloud AI, knowing what you ask about leaves this computer.");
      }
      const typedKey = clean(input.key, 500);
      const next: Kept = {
        source, enabled: input.enabled ?? before.enabled, url, model: input.model === undefined || input.model === null ? before.model : input.model.trim().slice(0, 120), cloud_ok: cloudOk,
        key: input.clear_key ? null : typedKey ? sealer().seal(typedKey) : before.key,
        areas: input.areas === undefined ? before.areas : [...new Set(input.areas)].filter((a): a is Area => (AREAS as readonly string[]).includes(a)),
      };
      await keep(next);
      return shown(next);
    },

    /** Reaches the model's server and lists the models it has. */
    async models(): Promise<string[]> {
      const got = await call(await kept(), '/models');
      return (Array.isArray(got.data) ? got.data : []).map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : null)).filter((id): id is string => typeof id === 'string');
    },

    facts: async (): Promise<Record<string, unknown>> => { const k = await kept(); return facts(k.areas, k.source === 'phone' ? PHONE_FACTS_LIMIT : FACTS_LIMIT); },

    /** Whether the phone's built-in AI can answer right now, and if not, why not, in words. */
    async phoneCheck(): Promise<{ ready: boolean; why?: string; name: string }> {
      if (!tools?.phone) throw new Problem(400, 'This device has no built-in AI that Life Is can use');
      try {
        return { name: tools.phone.name, ...(await tools.phone.check()) };
      } catch {
        return { name: tools.phone.name, ready: false, why: `${tools.phone.name} isn't available on this device.` };
      }
    },

    /**
     * The words on a photo of a recipe, copied out by the model at the address you gave: for handwriting, which
     * the reader built into Life Is can't make out. The photo goes to that model and nowhere else, only when
     * asked, and none of your records go with it. The model must be one that can look at pictures.
     */
    async readRecipePhoto(picture: { type?: string | null; base64?: string | null }): Promise<{ text: string }> {
      const type = picture.type ?? '';
      const data = (picture.base64 ?? '').replace(/\s+/g, '');
      if (!/^image\/(jpeg|png|webp)$/.test(type) || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new Problem(400, 'Choose a photo (JPEG or PNG)');
      if (data.length * 0.75 > MAX_PICTURE_BYTES) throw new Problem(400, 'That photo is too large to send. Take it again a little further back.');
      const k = await kept();
      if (!k.enabled) throw new Problem(409, 'Turn the assistant on in Settings, under "Outside services"');
      if (k.source === 'phone') throw new Problem(409, "The phone's built-in AI can't look at photos. Choose a model at an address in Settings to read handwriting.");
      if (!isLocal(k.url) && !k.cloud_ok) throw new Problem(409, "The assistant's address isn't on this computer or your network, and a cloud AI hasn't been allowed");
      const got = await call(k, '/chat/completions', JSON.stringify({
        ...(k.model ? { model: k.model } : {}), temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: COPY_OUT }, { type: 'image_url', image_url: { url: `data:${type};base64,${data}` } }] }],
      }));
      const said = (got.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
      if (typeof said !== 'string') throw new Problem(400, "The model's server sent something that isn't an answer. Is it a model that can look at pictures?");
      // Some models wrap what they copy in a code fence; the words inside are what was asked for.
      const text = answerOnly(said).replace(/^```[a-z]*\s*|\s*```$/g, '').trim();
      if (!text || /^NOTHING\.?$/i.test(text)) throw new Problem(400, "The model couldn't read a recipe in that photo. A sharper photo, straight on and in good light, reads best.");
      return { text: text.slice(0, 20_000) };
    },

    /** An answer to a question about the household, and exactly what the model was given to answer it. */
    async ask(given: string | null | undefined): Promise<{ answer: string; given: Record<string, unknown> }> {
      const question = clean(given, 1000);
      if (!question) throw new Problem(400, 'Ask a question');
      const k = await kept();
      if (!k.enabled) throw new Problem(409, 'Turn the assistant on in Settings, under "Outside services"');
      if (k.source === 'address' && !isLocal(k.url) && !k.cloud_ok) throw new Problem(409, "The assistant's address isn't on this computer or your network, and a cloud AI hasn't been allowed");
      if (k.areas.length === 0) throw new Problem(409, 'The assistant has been given nothing to look at. Check what it may see in Settings.');
      const prompt = (data: Record<string, unknown>) => `Facts:\n${JSON.stringify(data)}\n\nQuestion: ${question}`;
      if (k.source === 'phone') {
        const phone = tools!.phone!;
        const state = await phone.check().catch(() => ({ ready: false, why: undefined }));
        if (!state.ready) throw new Problem(409, state.why ?? `${phone.name} isn't ready on this device.`);
        const data = await facts(k.areas, PHONE_FACTS_LIMIT);
        let text: string;
        try { text = await phone.answer(SYSTEM, prompt(data)); } catch { throw new Problem(400, `${phone.name} couldn't answer that. Try a shorter question, or check fewer things for it to look at.`); }
        return { answer: answerOnly(text) || '(The model gave no answer.)', given: data };
      }
      const data = await facts(k.areas);
      const got = await call(k, '/chat/completions', JSON.stringify({
        ...(k.model ? { model: k.model } : {}), temperature: 0.2,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt(data) }],
      }));
      const text = (got.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Problem(400, "The model's server sent something that isn't an answer");
      return { answer: answerOnly(text) || '(The model gave no answer.)', given: data };
    },
  };
}
