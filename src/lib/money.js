// One money line per person (M1, Josh 23 Oct 2026 — the walkthrough review, option A).
//
//   "Your share $535 · paid $200 · still to pay $335 to Josh (PayID …)  [I've paid]"
//   After "I've paid": "waiting for Josh to confirm" — no Pay button.
//   Organiser: who has and hasn't paid, with one Remind button; the full table sits behind "Details".
//   One word for where the money goes: "pay Josh" (the trip's organiser collects it), never "the kitty".
//
// Pure functions (no database, no React), tested in money.test.js. The screens: components/MoneyLine.jsx (the line,
// used on the trip page, the Kitty tab and the results page's Settle up) and screens/PlanTabs.jsx (Details).
// The maths underneath is lib/plan.js kitty() — unchanged; this file only turns it into one line per person.
import { kitty, money } from './plan.js';
import { replies } from './headcount.js';

const cents = (x) => Math.round(Number(x || 0) * 100) / 100;
const firstName = (p) => String(p?.nickname || p?.name || '').trim().split(/\s+/)[0] || '';
const nameList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Who's in for a trip: the player ids who said In — by the ONE headcount rule (lib/headcount.js). */
export function peopleIn(rsvps = []) {
  return replies({ rsvps }).ids.in.filter((id) => !String(id).startsWith('reply:'));
}

/** Who collects the money paid in (what used to be "the kitty"): the trip's organiser. → { id, name } */
export function collectorOf(plan, playersById = {}) {
  const id = plan?.organiser_id || plan?.created_by || null;
  const name = firstName(playersById[id]);
  return { id, name: name || 'the organiser' };
}

/** "Josh" for the kitty, a first name for a person. */
export function payeeName(id, collector, playersById = {}) {
  if (!id || id === 'kitty') return collector.name;
  return firstName(playersById[id]) || 'them';
}

/**
 * One person's money for a trip.
 *   costs / payments / transfers / rsvps: the plan's rows; plan: deposit_pp, organiser_id, kitty_note.
 * → null when there's nothing to say (not in, no costs, no deposit), else
 *   { state, share, paid, waiting, toPay, owed, deposit, payees: [{ id, name, amount, details, waiting }], collector }
 *   state: 'owe' (still to pay) | 'waiting' (said they paid, not confirmed yet) | 'square' | 'owed' (owed money back)
 *   paid: money counted towards their share (confirmed); waiting: "I've paid" not ticked off yet.
 */
export function myMoney({ costs = [], payments = [], transfers = [], rsvps = [], plan = null, me = null, playersById = {} } = {}) {
  if (!me || !plan) return null;
  const inIds = peopleIn(rsvps);
  const k = kitty(costs, payments, inIds, transfers);
  const collector = collectorOf(plan, playersById);
  const mine = k.people.find((p) => p.player_id === me) || null;
  // Keen counts for the deposit: a "maybe" pays it to take their seat (and paying says they're in).
  const iAmIn = inIds.includes(me) || (rsvps || []).some((r) => r.player_id === me && r.status === 'maybe');
  const pending = (transfers || []).filter((t) => !t.confirmed && t.from_id === me);
  // Money waiting for a tick, by who it went to — paid in ("the kitty") and paid to the collector are the same person.
  const same = (a, b) => a === b || ((a === 'kitty' || a === collector.id) && (b === 'kitty' || b === collector.id));
  const waitingTo = (to) => cents(pending.filter((t) => same(t.to_id || 'kitty', to)).reduce((s, t) => s + Number(t.amount), 0));
  const waiting = cents(pending.reduce((s, t) => s + Number(t.amount), 0));
  // Paying the organiser direct or "into the kitty" is the same person: their kitty note (PayID) either way.
  const details = (id) => (!id || id === 'kitty' || id === collector.id
    ? plan.kitty_note || playersById[collector.id]?.pay_details || null : playersById[id]?.pay_details || null);
  const deposit = Number(plan.deposit_pp) > 0 ? Number(plan.deposit_pp) : 0;

  // No costs yet: the deposit is what's asked (paid to the organiser, like any money paid in).
  if (!(mine && mine.share > 0)) {
    // v10 merge fix: the collector holds the deposits, their own included — nothing for them to pay.
    if (!deposit || !iAmIn || me === collector.id) {
      if (mine && mine.balance < -0.5) return { state: 'owed', share: 0, paid: 0, waiting, toPay: 0, owed: cents(-mine.balance), deposit, payees: [], collector };
      return null;
    }
    const paidIn = cents((transfers || []).filter((t) => t.confirmed && t.from_id === me && !t.to_id).reduce((s, t) => s + Number(t.amount), 0)
      + (payments || []).filter((p) => p.player_id === me).reduce((s, p) => s + Number(p.paid || 0), 0));
    const left = cents(Math.max(0, deposit - paidIn));
    const wait = waitingTo('kitty');
    const toPay = cents(Math.max(0, left - wait));
    const state = toPay > 0.5 ? 'owe' : wait > 0.5 && left > 0.5 ? 'waiting' : 'square';
    return {
      state, share: deposit, paid: cents(Math.min(paidIn, deposit)), waiting: wait, toPay, owed: 0, deposit, depositOnly: true, collector,
      payees: left > 0.5 ? [{ id: 'kitty', name: collector.name, amount: left, toPay, waiting: wait, details: details('kitty') }] : [],
    };
  }

  const balance = mine.balance;
  if (balance < -0.5) {
    // The organiser who collects already holds what's been paid in: that part isn't owed to them any more.
    const owed = cents(-balance - (me === collector.id ? Math.max(0, k.kitty) : 0));
    if (owed <= 0.5) return { state: 'square', share: mine.share, paid: mine.share, waiting: 0, toPay: 0, owed: 0, deposit, payees: [], collector };
    return { state: 'owed', share: mine.share, paid: mine.share, waiting, toPay: 0, owed, deposit, payees: [], collector };
  }
  const payees = k.settle.filter((s) => s.from === me).map((s) => {
    const wait = waitingTo(s.to);
    return { id: s.to, name: payeeName(s.to, collector, playersById), amount: s.amount, toPay: cents(Math.max(0, s.amount - wait)), waiting: wait, details: details(s.to) };
  });
  const owing = cents(Math.max(0, balance));
  const toPay = cents(Math.max(0, owing - waiting));
  const state = owing <= 0.5 ? 'square' : toPay > 0.5 ? 'owe' : 'waiting';
  return { state, share: mine.share, paid: cents(Math.max(0, mine.share - owing)), waiting: cents(Math.min(waiting, owing)), toPay, owed: 0, deposit, payees, collector };
}

/**
 * The words for one person's line.
 *   'owe'     → "Your share $535 · paid $200 · still to pay $335 to Josh"
 *   'waiting' → "Your share $535 · paid $200 · $335 waiting for Josh to confirm"
 *   'square'  → "Your share $535 · all paid ✓"
 *   'owed'    → "You're owed $1,701 — the others pay you back"
 * (A deposit with no costs yet says "Deposit" instead of "Your share".)
 */
export function moneyWords(m) {
  if (!m) return '';
  const what = m.depositOnly ? 'Deposit' : 'Your share';
  if (m.state === 'owed') return `You’re owed ${money(m.owed)} — the others pay you back`;
  if (m.state === 'square') return `${what} ${money(m.share)} · all paid ✓`;
  const to = nameList([...new Set(m.payees.filter((p) => (m.state === 'owe' ? p.toPay > 0.5 : p.waiting > 0.5)).map((p) => p.name))]) || m.collector.name;
  const paid = m.paid > 0.5 ? ` · paid ${money(m.paid)}` : '';
  if (m.state === 'waiting') return `${what} ${money(m.share)}${paid} · ${money(m.waiting)} waiting for ${to} to confirm`;
  const wait = m.waiting > 0.5 ? ` · ${money(m.waiting)} waiting for a tick` : '';
  return `${what} ${money(m.share)}${paid}${wait} · still to pay ${money(m.toPay)} to ${to}`;
}

/** "You owe $535" / "You're owed $80" / "All square ✓" — the old big label, in the right grammar. */
export function youLabel(balance) {
  const b = Number(balance) || 0;
  if (b > 0.5) return `You owe ${money(b)}`;
  if (b < -0.5) return `You’re owed ${money(-b)}`;
  return 'All square ✓';
}

/** "Gus owes $335" / "Al is owed $80" / "Mo is square ✓" — anyone else's label. */
export function theyLabel(name, balance) {
  const b = Number(balance) || 0;
  if (b > 0.5) return `${name} owes ${money(b)}`;
  if (b < -0.5) return `${name} is owed ${money(-b)}`;
  return `${name} is square ✓`;
}

/**
 * The organiser's short list: everyone who's in and still has money to pay, most first, and the payments waiting for
 * a tick. → { owing: [{ id, name, toPay, waiting }], total, waitingCount }
 */
export function whoOwes({ costs = [], payments = [], transfers = [], rsvps = [], plan = null, playersById = {} } = {}) {
  const ids = peopleIn(rsvps);
  const others = [...new Set([...ids, ...kitty(costs, payments, ids, transfers).people.map((p) => p.player_id)])];
  const owing = others.map((id) => {
    const m = myMoney({ costs, payments, transfers, rsvps, plan, me: id, playersById });
    return m && (m.state === 'owe' || m.state === 'waiting') ? { id, name: firstName(playersById[id]) || 'Someone', toPay: m.toPay, waiting: m.waiting, state: m.state } : null;
  }).filter(Boolean).sort((a, b) => b.toPay - a.toPay || a.name.localeCompare(b.name));
  return {
    owing,
    total: cents(owing.reduce((s, o) => s + o.toPay, 0)),
    waitingCount: (transfers || []).filter((t) => !t.confirmed).length,
  };
}

/**
 * I7: "Seats confirmed: 6 of 10 (paid)" — the deposit is the seat. Only when the trip asks for a deposit.
 * → null or { paid: [ids], of, line }
 */
export function seatsLine({ plan = null, rsvps = [], transfers = [], payments = [] } = {}) {
  const deposit = Number(plan?.deposit_pp) || 0;
  if (!deposit) return null;
  const ids = peopleIn(rsvps);
  if (!ids.length) return null;
  const paidBy = (id) => (transfers || []).filter((t) => t.confirmed && t.from_id === id && !t.to_id).reduce((s, t) => s + Number(t.amount), 0)
    + (payments || []).filter((p) => p.player_id === id).reduce((s, p) => s + Number(p.paid || 0), 0);
  const paid = ids.filter((id) => paidBy(id) >= deposit - 0.5);
  return { paid, of: ids.length, line: `Seats confirmed: ${paid.length} of ${ids.length} (paid)` };
}

/** The Remind message for the group chat: "Hunter Valley: still to pay Josh — Gus $335, Lou $535. PayID …" */
export function remindText({ plan, owing = [], collector, url = '' }) {
  const list = owing.filter((o) => o.toPay > 0.5).map((o) => `${o.name} ${money(o.toPay)}`).join(', ');
  return [`💰 ${plan?.name || 'The trip'}: still to pay ${collector?.name || 'the organiser'} — ${list}.`, plan?.kitty_note || null, url || null].filter(Boolean).join(' ');
}
