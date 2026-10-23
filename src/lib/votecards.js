// Two votes, either order (ov35, Josh 23 Oct): "the dates should be reasonably independent of location … They are two
// separate." The trip builder's start vote is now two cards — 📅 When? (the weekends, and How long? when it's asked)
// and 📍 Where? (the areas, and optionally their courses and places to stay). Call either first, or both at once;
// each closes on its own and says plainly where it's up to: not called yet / out now / closed.
// Trips that already had the old combined vote (state.votes.v1) keep working the old way.
// Pure functions only — the screen is components/WhenWhere.jsx.
import { weekendLabel } from './tripbuilder.js';
import { lengthLabel } from './weekends.js';
import { votersOf } from './callvote.js';

export const PARTS = ['when', 'where'];
export const PART_LOOK = {
  when: { icon: '📅', title: 'When?', batch: 'When are we going?', what: 'the weekend' },
  where: { icon: '📍', title: 'Where?', batch: 'Where are we going?', what: 'where we go' },
};
export const BOTH_TITLE = 'When and where?';

const WHEN_KEY = /^(weekend|nights):/;

/** A ballot section (lib/tripbuilder.js startRange) belongs to When? (the weekends, How long?) or Where? (the rest). */
export function sectionPart(s = {}) {
  if (s.key === 'weekend' || s.key === 'length' || s.kind === 'dates') return 'when';
  if ((s.options || []).length && s.options.every((o) => WHEN_KEY.test(o.key || ''))) return 'when';
  return 'where';
}

/** The ballot split in two. → { when: [sections], where: [sections] } */
export function splitRange(range = []) {
  const out = { when: [], where: [] };
  for (const s of range || []) out[sectionPart(s)].push(s);
  return out;
}

/** A saved vote (plan_polls row) belongs to When? or Where?, from its kind or its options' keys. */
export function pollPart(poll = {}, options = [], optionKeys = {}) {
  if (poll.kind === 'dates') return 'when';
  if (/^how long\??$/i.test(String(poll.question || '').trim())) return 'when';
  const keys = (options || []).filter((o) => o.poll_id === poll.id).map((o) => optionKeys[o.id]).filter(Boolean);
  return keys.length && keys.every((k) => WHEN_KEY.test(k)) ? 'when' : 'where';
}

/** Is this trip on the old combined vote (one "Where and when?" card)? Then it keeps the old screen. */
export function isCombined(st = {}) {
  return !!st?.votes?.v1 && !st.votes.when && !st.votes.where;
}

/** The polls on a card: the card's batch, this part only. */
export function cardPolls(part, { st = {}, polls = [], options = [] } = {}) {
  const batch = st?.votes?.[part];
  if (!batch) return [];
  return (polls || []).filter((p) => p.vote_batch === batch && pollPart(p, options, st.optionKeys || {}) === part);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);

/** "closes today" / "closes tomorrow" / "closes Thu" / "closes Thu 12 Nov" / "closed Tue". */
export function closesWords(closes, today) {
  if (!closes) return 'no closing date';
  const d = dateOf(closes);
  const n = today ? daysBetween(today, closes) : 99;
  const day = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  if (n < 0) return `closing date was ${day}`;
  if (n === 0) return 'closes tonight';
  if (n === 1) return 'closes tomorrow';
  if (n < 7) return `closes ${DOW[d.getDay()]}`;
  return `closes ${day}`;
}

/** ✓ counts on a vote's options, best first: [{ id, label, yes }]. */
export function yesCounts(poll, options = [], votes = []) {
  return (options || []).filter((o) => o.poll_id === poll?.id)
    .map((o) => ({ id: o.id, label: o.label, yes: (votes || []).filter((v) => v.option_id === o.id && v.response === 'yes').length }))
    .sort((a, b) => b.yes - a.yes);
}

/** The vote that decides the card: the weekends (When?) or the areas (Where?) — else the first one. */
export function mainPoll(part, cardP = [], options = [], optionKeys = {}) {
  const want = part === 'when' ? /^weekend:/ : /^area:/;
  return cardP.find((p) => options.some((o) => o.poll_id === p.id && want.test(optionKeys[o.id] || ''))) || cardP[0] || null;
}

/**
 * Where the card's up to, in plain words.
 *   none     — "Not called yet"
 *   out      — "Out now — 4 of 9 voted, closes Thu"
 *   closed   — "Closed — Hunter Valley won 5–2" (or "Closed — Hunter Valley" with no ✓ votes)
 *   decided  — "Decided — Fri 12 – Sun 14 Mar (no vote)"
 * decided: what's settled for this part (a label) or null. of: how many could vote (the group's players).
 * → { state, line, closes, voted, of }
 */
export function cardStatus(part, { st = {}, polls = [], options = [], votes = [], of = 0, today = null, decided = null } = {}) {
  const cardP = cardPolls(part, { st, polls, options });
  if (!cardP.length) {
    return decided ? { state: 'decided', line: `Decided — ${decided} (no vote)`, voted: 0, of } : { state: 'none', line: 'Not called yet', voted: 0, of };
  }
  const voted = votersOf(cardP, votes);
  const open = cardP.filter((p) => p.status === 'open');
  const closes = open.map((p) => p.closes_on).filter(Boolean).sort()[0] || null;
  if (open.length) {
    const who = of ? `${voted} of ${of} voted` : `${voted} voted`;
    return { state: 'out', line: `Out now — ${who}, ${closesWords(closes, today)}`, closes, voted, of };
  }
  const main = mainPoll(part, cardP, options, st.optionKeys || {});
  const counts = main ? yesCounts(main, options, votes) : [];
  const win = main?.winner_option_id ? counts.find((c) => c.id === main.winner_option_id) : null;
  const label = decided || win?.label || null;
  const runner = win ? counts.filter((c) => c.id !== win.id)[0] : null;
  const score = win && win.yes > 0 ? ` won ${win.yes}–${runner?.yes || 0}` : '';
  return { state: 'closed', line: label ? `Closed — ${label}${score}` : 'Closed', voted, of };
}

/** The gold button's words: say it closes the vote (and posts) when it does. */
export function closeButton(part, label, { open = false } = {}) {
  if (!label) return null;
  return open ? `Close the vote and go with ${label}` : `Go with ${label}`;
}

/** The weekends after the When? vote: the chosen one first (default: most votes), the next best as the fallback. */
export function settleWhen(st = {}, ranked = [], { start = null, nights = null, resize = (w) => w } = {}) {
  const pool = st.weekendPool?.length ? st.weekendPool : (st.weekends || []);
  const n = nights ?? st.nights ?? 2;
  const list = ranked.length ? ranked : pool;
  const first = start ? list.find((w) => (w.from || w.start) === start) : list[0];
  if (!first) return null;
  const rest = list.filter((w) => w !== first);
  const strip = ({ points: _p, ...w }) => w;
  const weekends = [first, ...rest.slice(0, 1)].map(strip).map((w) => resize(w, n));
  return { weekends, weekendPool: pool, weekendsSettled: true, nights: n };
}

/** The option keys a closed When? / Where? vote should be marked as won by. */
export function winnerKeys(part, { weekendKey = null, nights = null, area = null } = {}) {
  return part === 'when' ? [weekendKey ? `weekend:${weekendKey}` : null, nights != null ? `nights:${nights}` : null].filter(Boolean)
    : [area ? `area:${area}` : null].filter(Boolean);
}

/**
 * The Feed post for one card's result (once per vote).
 *   When:  "📅 March trip — the weekend's decided: Fri 12 – Sun 14 Mar (2 nights). 5 votes to 2. Still to decide: where."
 *   Where: "📍 March trip — we're going to Hunter Valley. 6 votes to 3. Next: ringing the courses for tee times."
 * otherDone: the other card's decided too.
 */
export function partResultPost({ planName, part, label, nights = null, votes = null, otherDone = false }) {
  const score = votes && votes[0] > 0 ? ` ${votes[0]} ${votes[0] === 1 ? 'vote' : 'votes'} to ${votes[1] || 0}.` : '';
  const next = otherDone ? ' Next: ringing the courses for tee times.' : part === 'when' ? ' Still to decide: where.' : ' Still to decide: when.';
  if (part === 'when') return `📅 ${planName} — the weekend’s decided: ${label}${nights != null ? ` (${lengthLabel(nights)})` : ''}.${score}${next}`;
  return `📍 ${planName} — we’re going to ${label}.${score}${next}`;
}

/** The weekend as its short label for a button ("Fri 12 – Sun 14 Mar"). */
export const whenLabel = (w) => (w ? weekendLabel({ start: w.start, end: w.end }) : null);

/** What the Call buttons offer: either card, or both at once when both have something to vote on. */
export function callChoices(st = {}, range = []) {
  const split = splitRange(range);
  const can = {
    when: !st.votes?.when && !st.weekendsSettled && split.when.length > 0,
    where: !st.votes?.where && split.where.length > 0 && !(st.region && !split.where.some((s) => s.key !== 'area')),
  };
  return { ...can, both: can.when && can.where, split };
}
