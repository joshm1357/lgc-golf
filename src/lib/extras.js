// Optional extras for a trip (22 Oct, Josh): "in the original setup have the extras that could be included from the
// organiser — that could potentially go to vote as well". Pure functions, tested (extras.test.js).
//
//   * Each extra is 'off' (not on the table), 'in' (the organiser's put it in) or 'vote' (the group gets asked
//     "Would you do these?" — ⭐ Want it · 👍 Happy either way · 👎 Skip it).
//   * Extras that are in, or that win the vote, go into the trip plan budget (078 plan_budget_items) and, where
//     there's something to book, a job ("Book the bus").
import { EXTRA_QUESTION } from './emailvotes.js';

export { EXTRA_QUESTION };
export const EXTRA_STATES = ['off', 'in', 'vote'];
export const MAX_EXTRAS = 16;

/** The usual extras, with a rough cost per person (AUD; null = no set cost). kind = the budget line it feeds. */
export const DEFAULT_EXTRAS = [
  { key: 'trophy', label: 'Trophy & engraving', pp: 15, kind: 'trophy', job: 'Order the trophy and engraving' },
  { key: 'shirts', label: 'Shirts or caps', pp: 45, kind: 'shirts', job: 'Order the shirts or caps' },
  { key: 'dinner', label: 'Group dinner out', pp: 80, kind: 'food', job: 'Book the group dinner' },
  { key: 'chef', label: 'Chef or catering at the house', pp: 70, kind: 'food', job: 'Book the chef or catering' },
  { key: 'bus', label: 'Bus or transfers', pp: 40, kind: 'transport', job: 'Book the bus' },
  { key: 'range', label: 'Range / practice session', pp: 15, kind: 'other', job: null },
  { key: 'wine', label: 'Wine or brewery tour', pp: 60, kind: 'other', job: 'Book the tour' },
  { key: 'fishing', label: 'Fishing or boat trip', pp: 90, kind: 'other', job: 'Book the boat' },
  { key: 'pub', label: 'Casino or pub night', pp: null, kind: 'drinks', job: null },
  { key: 'round', label: 'An extra round', pp: 70, kind: 'green_fees', job: 'Book the extra round' },
  { key: 'spa', label: 'Massage or spa', pp: 100, kind: 'other', job: 'Book the massages' },
  { key: 'ryder', label: 'Ryder Cup format (two teams)', pp: null, kind: 'other', job: null },
];

const money = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n) : null;
};

/** The starting list for a trip: the usual extras, all off. */
export function startExtras() {
  return DEFAULT_EXTRAS.map((e) => ({ ...e, state: 'off' }));
}

/** "Bus or transfers · ~$40 each" */
export function extraLine(e) {
  return `${e.label}${e.pp != null ? ` · ~$${e.pp} each` : ''}`;
}

/** Set one extra's state (off / in / vote). */
export function setExtraState(list, key, state) {
  if (!EXTRA_STATES.includes(state)) return list;
  return (list || []).map((e) => (e.key === key ? { ...e, state } : e));
}
/** Change an extra's rough cost each. */
export function setExtraCost(list, key, pp) {
  return (list || []).map((e) => (e.key === key ? { ...e, pp: money(pp) } : e));
}

/** The organiser's own extra ("Footy tipping comp", $20). Returns the new list, or null if it isn't usable. */
export function addCustomExtra(list, label, pp = null, state = 'vote') {
  const l = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (l.length < 2) return null;
  const cur = list || [];
  if (cur.length >= MAX_EXTRAS) return null;
  if (cur.some((e) => e.label.toLowerCase() === l.toLowerCase())) return null;
  const key = `own-${l.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'extra'}`;
  return [...cur, { key, label: l, pp: money(pp), kind: 'other', job: null, own: true, state: EXTRA_STATES.includes(state) ? state : 'vote' }];
}

export const extrasIn = (list) => (list || []).filter((e) => e.state === 'in');
export const extrasToVote = (list) => (list || []).filter((e) => e.state === 'vote');

/** The ballot section for the extras going to the group, or null when there are none. */
export function extrasSection(list) {
  const v = extrasToVote(list);
  if (!v.length) return null;
  return {
    key: 'extras', kind: 'other', question: EXTRA_QUESTION,
    options: v.map((e) => ({ key: `extra:${e.key}`, label: e.label, notes: e.pp != null ? `~$${e.pp} each` : null })),
  };
}

/** Does an extra win its vote? More want-it / happy than skip-it, and at least one wants it. */
export function extraWins({ yes = 0, maybe = 0, no = 0 } = {}) {
  return yes >= 1 && yes + maybe > no;
}

/**
 * What to add to the trip plan for these extras: budget lines (plan_budget_items) and jobs (plan_items), skipping
 * anything already there (matched by label / title, ignoring case).
 */
export function extrasToPlan(extras, { planId, budget = [], items = [] } = {}) {
  const haveB = new Set((budget || []).map((b) => String(b.label || '').toLowerCase()));
  const haveJ = new Set((items || []).map((i) => String(i.title || '').toLowerCase()));
  const budgetRows = [];
  const jobRows = [];
  (extras || []).forEach((e, i) => {
    if (!haveB.has(e.label.toLowerCase())) {
      budgetRows.push({ plan_id: planId, kind: e.kind || 'other', label: e.label.slice(0, 80), amount: e.pp ?? null, per_person: true, upfront: false, ticked: true, sort: 50 + i });
    }
    if (e.job && !haveJ.has(e.job.toLowerCase())) jobRows.push({ plan_id: planId, kind: 'job', title: e.job, sort: 200 + i });
  });
  return { budgetRows, jobRows };
}

/** Extras from a vote's options (label / notes) back to the extras list entries (by label). */
export function extrasFromOptions(options, list = DEFAULT_EXTRAS) {
  return (options || []).map((o) => {
    const known = (list || []).find((e) => e.label.toLowerCase() === String(o.label || '').toLowerCase());
    if (known) return known;
    const pp = /~\$(\d+)/.exec(String(o.notes || ''));
    return { key: `own-${o.id || o.label}`, label: String(o.label || '').slice(0, 60), pp: pp ? Number(pp[1]) : null, kind: 'other', job: null };
  });
}
