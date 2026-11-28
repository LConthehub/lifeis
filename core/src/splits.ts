/**
 * Splitting a bill or a purchase between people, and keeping score of who owes whom.
 *
 * Life Is only keeps score. It never moves money, never shows a way to pay, and gives no advice. Paying happens
 * outside; a person taps Settled on what they were paid or paid, and the line leaves the balance.
 *
 * A split has a total, a day, one person who paid it, and a share for each person in it. A person is someone who
 * signs in to this Life Is, or a typed name. A typed name is only a label: that person has no access and sees nothing.
 * Shares start equal. A person can be given an amount or a percent instead, and anyone can be left out (left out of the
 * list). Shares always add up to the whole, to the cent. Leftover cents go one each to the first people in the list.
 *
 * Whoever is in a split sees it, and whoever made it. Only the person who made it can change or remove it. Everyone
 * else can mark their own part settled, and the one who paid can mark what they were paid.
 *
 * "Who owes whom" is worked out over the lines not yet settled, and boiled down to the fewest payments between people
 * (groups of people whose balances cancel are settled inside the group). Money is whole cents.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { shown } from './displayName.ts';
import { fmt } from './goalFigures.ts';
import { Problem } from './problem.ts';
import { clean, dayOrNull, labelKey, stamp, todayOf, type Clock } from './small.ts';

export type Mode = 'equal' | 'amount' | 'percent';
export type SplitPersonInput = {
  /** Someone who signs in to this Life Is. */
  user_id?: number | null;
  /** Or a typed name. */
  name?: string | null;
  mode?: Mode | null;
  /** For mode 'amount': whole cents. */
  cents?: number | null;
  /** For mode 'percent': 0 to 100, up to two decimals. */
  percent?: number | null;
  /** Whether this one paid the whole thing. Exactly one person did. */
  paid?: boolean;
};
export type SplitInput = {
  what?: string | null; total_cents?: number | null; day?: string | null; note?: string | null;
  entry_id?: number | null; job_id?: number | null; people?: SplitPersonInput[];
};
export type ShareView = {
  id: number; who: string; user_id: number | null; you: boolean; typed: boolean; cents: number; paid: boolean;
  settled_on: string | null;
  /** What this line is: the person owes the one who paid (a line to settle), or paid it. */
  owes: boolean;
  can_settle: boolean;
};
export type SplitView = {
  id: number; what: string; total_cents: number; day: string; note: string | null; entry_id: number | null; job_id: number | null;
  by: string; mine: boolean; paid_by: string; shares: ShareView[];
  /** Whether any line is still to settle. */
  open: boolean; owed_cents: number;
};
export type Payment = { from: string; to: string; cents: number; from_you: boolean; to_you: boolean };
export type Settled = { id: number; what: string; from: string; to: string; cents: number; settled_on: string; split_id: number };
export type SplitsPage = {
  currency: string; people: { id: number; name: string }[]; me: { id: number; name: string };
  splits: SplitView[]; payments: Payment[]; you_owe: number; you_are_owed: number; history: Settled[];
};
export type Preview = { shares: { who: string; cents: number }[]; total_cents: number; words: string };

const MOST = 100_000_000_00;
const MOST_PEOPLE = 30;
const HISTORY = 20;
const LEFTOVER_WORDS = 'Leftover cents go one each to the first people on the list.';

/**
 * Shares out a total. Amounts and percents are taken first; whatever is left is shared equally between those on
 * "equal". Returns each person's cents (in the order given) and the positions that took a leftover cent.
 */
export function shareOut(total: number, people: { mode: Mode; cents?: number | null; percent?: number | null }[], sign = '$'): { cents: number[]; extra: number[] } {
  if (!Number.isInteger(total) || total <= 0) throw new Problem(422, 'Say how much the whole thing was, more than nothing');
  if (people.length < 2) throw new Problem(422, 'A split needs at least two people');
  const cents: number[] = people.map(() => 0);
  let taken = 0;
  let percentSum = 0;
  let percents = 0;
  const equal: number[] = [];
  people.forEach((p, at) => {
    if (p.mode === 'amount') {
      const c = p.cents;
      if (c === null || c === undefined || !Number.isInteger(c) || c < 0 || c > MOST) throw new Problem(422, 'An amount should be money, not below zero');
      cents[at] = c; taken += c;
    } else if (p.mode === 'percent') {
      const pct = p.percent;
      if (pct === null || pct === undefined || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new Problem(422, 'A percent should be from 0 to 100');
      const bp = Math.round(pct * 100);
      cents[at] = Math.floor((total * bp) / 10000); taken += cents[at]!; percentSum += bp; percents += 1;
    } else equal.push(at);
  });
  const rest = total - taken;
  const extra: number[] = [];
  if (equal.length > 0) {
    if (rest < 0) throw new Problem(422, `The amounts come to more than the whole, ${fmt(sign, total)}`);
    const base = Math.floor(rest / equal.length);
    const more = rest % equal.length;
    equal.forEach((at, n) => { cents[at] = base + (n < more ? 1 : 0); if (n < more) extra.push(at); });
  } else if (rest !== 0) {
    // Percents that come to exactly 100 can leave a few cents from rounding down: they go one each to the first of them.
    const onlyPercents = percents === people.length && percentSum === 10000;
    if (!(onlyPercents && rest > 0 && rest < percents)) {
      throw new Problem(422, `The shares come to ${fmt(sign, taken)}, and the whole is ${fmt(sign, total)}. ${rest > 0 ? `${fmt(sign, rest)} is not given to anyone yet.` : `They are ${fmt(sign, -rest)} too much.`}`);
    }
    let left = rest;
    people.forEach((_p, at) => { if (left > 0) { cents[at] = cents[at]! + 1; extra.push(at); left -= 1; } });
  }
  return { cents, extra };
}

/** The fewest payments that settle these balances (positive: is owed, negative: owes). Groups that cancel are settled inside the group. */
export function fewestPayments(balances: Map<string, number>): { from: string; to: string; cents: number }[] {
  const people = [...balances.entries()].filter(([, v]) => v !== 0);
  const paying = (group: [string, number][]) => {
    const debtors = group.filter(([, v]) => v < 0).map(([k, v]) => [k, -v] as [string, number]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const creditors = group.filter(([, v]) => v > 0).map(([k, v]) => [k, v] as [string, number]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const out: { from: string; to: string; cents: number }[] = [];
    let d = 0;
    let c = 0;
    while (d < debtors.length && c < creditors.length) {
      const pay = Math.min(debtors[d]![1], creditors[c]![1]);
      out.push({ from: debtors[d]![0], to: creditors[c]![0], cents: pay });
      debtors[d]![1] -= pay; creditors[c]![1] -= pay;
      if (debtors[d]![1] === 0) d += 1;
      if (creditors[c]![1] === 0) c += 1;
    }
    return out;
  };
  // With few people, find the most groups whose balances cancel exactly: each group of k people needs only k - 1 payments.
  if (people.length > 14) return paying(people);
  const m = people.length;
  const sum = new Array<number>(1 << m).fill(0);
  for (let mask = 1; mask < 1 << m; mask++) {
    const low = Math.log2(mask & -mask);
    sum[mask] = sum[mask & (mask - 1)]! + people[low]![1];
  }
  const best = new Array<number>(1 << m).fill(0);
  const last = new Array<number>(1 << m).fill(-1);
  for (let mask = 1; mask < 1 << m; mask++) {
    let top = -1;
    let at = -1;
    for (let i = 0; i < m; i++) {
      if (!(mask & (1 << i))) continue;
      const before = best[mask ^ (1 << i)]!;
      if (before > top) { top = before; at = i; }
    }
    best[mask] = top + (sum[mask] === 0 ? 1 : 0);
    last[mask] = at;
  }
  const order: number[] = [];
  for (let mask = (1 << m) - 1; mask > 0; mask ^= 1 << last[mask]!) order.unshift(last[mask]!);
  const out: { from: string; to: string; cents: number }[] = [];
  let group: [string, number][] = [];
  let running = 0;
  for (const i of order) {
    group.push(people[i]!);
    running += people[i]![1];
    if (running === 0) { out.push(...paying(group)); group = []; }
  }
  return out;
}

export function splits(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const sign = async (q: Queries = db) => (await q.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'shopping_currency'", [viewer]))?.value ?? '$';

  type Party = { user_id: number | null; name: string; mode: Mode; cents: number | null; percent: number | null; paid: boolean };
  async function parties(q: Queries, input: SplitPersonInput[] | undefined): Promise<Party[]> {
    const list = input ?? [];
    if (list.length < 2) throw new Problem(422, 'A split needs at least two people');
    if (list.length > MOST_PEOPLE) throw new Problem(422, `A split can have ${MOST_PEOPLE} people at most`);
    const seen = new Set<string>();
    const out: Party[] = [];
    for (const p of list) {
      const typed = clean(p.name, 60);
      const uid = p.user_id ?? null;
      if ((uid === null) === (typed === null)) throw new Problem(422, 'Each person is someone who signs in, or a typed name');
      let name = typed ?? '';
      if (uid !== null) {
        const found = await q.get<{ n: string }>(`SELECT ${shown('u')} AS n FROM users u WHERE u.id = ?`, [uid]);
        if (!found) throw new Problem(400, "That person isn't in this Life Is");
        name = found.n;
      }
      const key = uid !== null ? `u${uid}` : `n${labelKey(name)}`;
      if (seen.has(key)) throw new Problem(422, `${name} is in the split twice`);
      seen.add(key);
      const mode: Mode = p.mode === 'amount' || p.mode === 'percent' ? p.mode : 'equal';
      out.push({ user_id: uid, name, mode, cents: p.cents ?? null, percent: p.percent ?? null, paid: p.paid === true });
    }
    if (out.filter((p) => p.paid).length !== 1) throw new Problem(422, 'Say who paid: exactly one person');
    return out;
  }

  async function checked(q: Queries, input: SplitInput) {
    const what = clean(input.what, 200);
    if (!what) throw new Problem(400, 'Say what it was for');
    const total = input.total_cents ?? null;
    if (total === null || !Number.isInteger(total) || total <= 0 || total > MOST) throw new Problem(422, 'The total should be an amount of money, more than nothing');
    const day = input.day ? dayOrNull(input.day) : today();
    if (!day) throw new Problem(422, "That isn't a day I can read");
    const who = await parties(q, input.people);
    const { cents } = shareOut(total, who, await sign(q));
    return { what, total, day, note: clean(input.note, 1000), who, cents };
  }

  /** The split a person can see, or a refusal that says nothing about whether it exists. */
  async function seenSplit(q: Queries, id: number): Promise<{ id: number; creator_id: number }> {
    const row = await q.get<{ id: number; creator_id: number }>(
      'SELECT s.id, s.creator_id FROM splits s WHERE s.id = ? AND (s.creator_id = ? OR EXISTS (SELECT 1 FROM split_shares x WHERE x.split_id = s.id AND x.user_id = ?))', [id, viewer, viewer]);
    if (!row) throw new Problem(404, "That split isn't here anymore. It may have been deleted.");
    return row;
  }

  async function links(q: Queries, input: SplitInput) {
    let entry: number | null = null;
    let job: number | null = null;
    if (input.entry_id != null) {
      if (!(await q.get('SELECT id FROM money_entries WHERE id = ? AND owner_id = ?', [input.entry_id, viewer]))) throw new Problem(404, "That purchase isn't one of yours");
      entry = input.entry_id;
    }
    if (input.job_id != null) {
      if (!(await q.get('SELECT id FROM upkeep_jobs WHERE id = ? AND kind = \'bill\' AND (owner_id = ? OR assigned_to = ?)', [input.job_id, viewer, viewer]))) throw new Problem(404, "That bill isn't here");
      job = input.job_id;
    }
    return { entry, job };
  }

  async function putShares(q: Queries, id: number, c: Awaited<ReturnType<typeof checked>>, keep: Map<string, { cents: number; settled_on: string }>) {
    for (const [at, p] of c.who.entries()) {
      const key = p.user_id !== null ? `u${p.user_id}` : `n${labelKey(p.name)}`;
      const was = keep.get(key);
      const settled = !p.paid && was && was.cents === c.cents[at] ? was.settled_on : null;
      await q.run('INSERT INTO split_shares (split_id, user_id, name, cents, paid, settled_on, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, p.user_id, p.user_id === null ? p.name : null, c.cents[at]!, p.paid ? 1 : 0, settled, at]);
    }
  }

  return {
    /** The other people who sign in to this Life Is, to put in a split. */
    async people(): Promise<{ id: number; name: string }[]> {
      return db.all<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM users u WHERE u.id != ? ORDER BY u.username`, [viewer]);
    },

    /** What a purchase in Spending or a bill in Upkeep starts a split with, so nothing is typed twice. */
    async start(from: { entry_id?: number | null; job_id?: number | null }): Promise<{ what: string; total_cents: number | null; day: string; entry_id: number | null; job_id: number | null }> {
      if (from.entry_id != null) {
        const e = await db.get<{ label: string; cents: number; day: string }>('SELECT label, cents, day FROM money_entries WHERE id = ? AND owner_id = ?', [from.entry_id, viewer]);
        if (!e) throw new Problem(404, "That purchase isn't one of yours");
        return { what: e.label, total_cents: e.cents > 0 ? e.cents : null, day: e.day, entry_id: from.entry_id, job_id: null };
      }
      if (from.job_id != null) {
        const j = await db.get<{ name: string; amount_cents: number | null; first_due: string | null }>(
          "SELECT name, amount_cents, first_due FROM upkeep_jobs WHERE id = ? AND kind = 'bill' AND (owner_id = ? OR assigned_to = ?)", [from.job_id, viewer, viewer]);
        if (!j) throw new Problem(404, "That bill isn't here");
        return { what: j.name, total_cents: j.amount_cents && j.amount_cents > 0 ? j.amount_cents : null, day: today(), entry_id: null, job_id: from.job_id };
      }
      return { what: '', total_cents: null, day: today(), entry_id: null, job_id: null };
    },

    /** What each person would get, before anything is kept. */
    async preview(input: SplitInput): Promise<Preview> {
      const who = await parties(db, input.people);
      const money = await sign();
      const { cents, extra } = shareOut(input.total_cents ?? 0, who, money);
      const words = extra.length > 0
        ? `${LEFTOVER_WORDS} ${extra.length === 1 ? 'One cent' : `${extra.length} cents`} went to ${extra.map((i) => who[i]!.name).join(', ')}.`
        : 'The shares add up to the whole.';
      return { shares: who.map((p, i) => ({ who: p.name, cents: cents[i]! })), total_cents: input.total_cents ?? 0, words };
    },

    async create(input: SplitInput): Promise<{ id: number }> {
      return atomic(db, async (tx) => {
        const c = await checked(tx, input);
        const l = await links(tx, input);
        const made = await tx.run('INSERT INTO splits (creator_id, what, total_cents, day, note, entry_id, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [viewer, c.what, c.total, c.day, c.note, l.entry, l.job, stamp(clock())]);
        await putShares(tx, made.lastId, c, new Map());
        return { id: made.lastId };
      });
    },

    /** Change a split: only by the person who made it. Lines already settled stay settled when that person's share did not change. */
    async update(id: number, input: SplitInput): Promise<void> {
      await atomic(db, async (tx) => {
        const row = await seenSplit(tx, id);
        if (row.creator_id !== viewer) throw new Problem(403, 'Only the person who made this split can change it');
        const c = await checked(tx, input);
        const old = await tx.all<{ user_id: number | null; name: string | null; cents: number; settled_on: string | null }>('SELECT user_id, name, cents, settled_on FROM split_shares WHERE split_id = ?', [id]);
        const keep = new Map<string, { cents: number; settled_on: string }>();
        for (const o of old) if (o.settled_on) keep.set(o.user_id !== null ? `u${o.user_id}` : `n${labelKey(o.name ?? '')}`, { cents: o.cents, settled_on: o.settled_on });
        await tx.run('UPDATE splits SET what = ?, total_cents = ?, day = ?, note = ? WHERE id = ?', [c.what, c.total, c.day, c.note, id]);
        await tx.run('DELETE FROM split_shares WHERE split_id = ?', [id]);
        await putShares(tx, id, c, keep);
      });
    },

    async remove(id: number): Promise<void> {
      const row = await seenSplit(db, id);
      if (row.creator_id !== viewer) throw new Problem(403, 'Only the person who made this split can remove it');
      await db.run('DELETE FROM splits WHERE id = ?', [id]);
    },

    /**
     * Mark a line paid back (or take that back). The person who owes it, the one who paid, and the one who made the split can.
     * No money moves.
     */
    async settle(shareId: number, settled: boolean): Promise<void> {
      const share = await db.get<{ id: number; split_id: number; user_id: number | null; paid: number; creator_id: number; payer: number | null }>(
        `SELECT x.id, x.split_id, x.user_id, x.paid, s.creator_id, (SELECT p.user_id FROM split_shares p WHERE p.split_id = s.id AND p.paid = 1) AS payer
         FROM split_shares x JOIN splits s ON s.id = x.split_id WHERE x.id = ?`, [shareId]);
      if (!share) throw new Problem(404, "That line isn't here anymore.");
      await seenSplit(db, share.split_id);
      if (share.paid === 1) throw new Problem(400, 'The one who paid has nothing to settle');
      if (share.creator_id !== viewer && share.user_id !== viewer && share.payer !== viewer) throw new Problem(403, 'You can mark your own part, or what you were paid');
      await db.run('UPDATE split_shares SET settled_on = ? WHERE id = ?', [settled ? today() : null, shareId]);
    },

    /** Everything this person is in, who owes whom boiled down, and the short history of what was settled. */
    async list(): Promise<SplitsPage> {
      const money = await sign();
      const me = (await db.get<{ id: number; name: string }>(`SELECT u.id, ${shown('u')} AS name FROM users u WHERE u.id = ?`, [viewer])) ?? { id: viewer, name: '' };
      const rows = await db.all<{ id: number; what: string; total_cents: number; day: string; note: string | null; entry_id: number | null; job_id: number | null; creator_id: number; by: string }>(
        `SELECT s.id, s.what, s.total_cents, s.day, s.note, s.entry_id, s.job_id, s.creator_id, ${shown('c')} AS by FROM splits s JOIN users c ON c.id = s.creator_id
         WHERE s.creator_id = ? OR EXISTS (SELECT 1 FROM split_shares x WHERE x.split_id = s.id AND x.user_id = ?) ORDER BY s.day DESC, s.id DESC`, [viewer, viewer]);
      const shareRows = await db.all<{ id: number; split_id: number; user_id: number | null; name: string | null; uname: string | null; cents: number; paid: number; settled_on: string | null }>(
        `SELECT x.id, x.split_id, x.user_id, x.name, ${shown('u')} AS uname, x.cents, x.paid, x.settled_on FROM split_shares x LEFT JOIN users u ON u.id = x.user_id
         WHERE x.split_id IN (SELECT s.id FROM splits s WHERE s.creator_id = ? OR EXISTS (SELECT 1 FROM split_shares y WHERE y.split_id = s.id AND y.user_id = ?)) ORDER BY x.split_id, x.sort_order, x.id`, [viewer, viewer]);
      const labels = new Map<string, string>();
      const balance = new Map<string, number>();
      const history: Settled[] = [];
      const key = (s: { user_id: number | null; name: string | null }) => (s.user_id !== null ? `u${s.user_id}` : `n${labelKey(s.name ?? '')}`);
      const view: SplitView[] = rows.map((r) => {
        const mine = shareRows.filter((x) => x.split_id === r.id);
        const payer = mine.find((x) => x.paid === 1)!;
        const payerName = payer.uname ?? payer.name ?? '';
        let owed = 0;
        const shares: ShareView[] = mine.map((x) => {
          const who = x.uname ?? x.name ?? '';
          labels.set(key(x), who);
          const owes = x.paid === 0 && x.cents > 0;
          if (owes && x.settled_on === null) {
            owed += x.cents;
            balance.set(key(x), (balance.get(key(x)) ?? 0) - x.cents);
            balance.set(key(payer), (balance.get(key(payer)) ?? 0) + x.cents);
          }
          if (owes && x.settled_on !== null) history.push({ id: x.id, what: r.what, from: who, to: payerName, cents: x.cents, settled_on: x.settled_on, split_id: r.id });
          return {
            id: x.id, who, user_id: x.user_id, you: x.user_id === viewer, typed: x.user_id === null, cents: x.cents, paid: x.paid === 1, settled_on: x.settled_on, owes,
            can_settle: owes && (r.creator_id === viewer || x.user_id === viewer || payer.user_id === viewer),
          };
        });
        return { id: r.id, what: r.what, total_cents: r.total_cents, day: r.day, note: r.note, entry_id: r.entry_id, job_id: r.job_id, by: r.by, mine: r.creator_id === viewer, paid_by: payerName, shares, open: owed > 0, owed_cents: owed };
      });
      const you = `u${viewer}`;
      const payments: Payment[] = fewestPayments(balance).map((p) => ({ from: labels.get(p.from) ?? '', to: labels.get(p.to) ?? '', cents: p.cents, from_you: p.from === you, to_you: p.to === you }));
      history.sort((a, b) => (a.settled_on < b.settled_on ? 1 : a.settled_on > b.settled_on ? -1 : b.id - a.id));
      const net = balance.get(you) ?? 0;
      return {
        currency: money, people: await this.people(), me, splits: view, payments,
        you_owe: net < 0 ? -net : 0, you_are_owed: net > 0 ? net : 0, history: history.slice(0, HISTORY),
      };
    },
  };
}
export type SplitTools = ReturnType<typeof splits>;
