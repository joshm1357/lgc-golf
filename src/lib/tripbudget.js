// The trip plan (a tick-list budget), the deposit, and accommodation search links — pure functions, tested.
//
// Plain words:
//   - The trip plan is a list of lines: accommodation, green fees, trophy, shirts, food, drinks, transport, other.
//     A ticked line counts towards the total. A line is either a total for the group, or "per person".
//   - Food is a basic plan: meals × people × $ per head ("Fri dinner — BBQ at the house, $25").
//     Green fees work the same way: one line per round, $ per person.
//   - Cost per person = total ÷ the people who've confirmed (or ÷ everyone keen, "if everyone keen comes").
//   - Suggested deposit = each person's share of what has to be paid up front (accommodation, plus any line marked
//     "up front", e.g. the trophy and shirts), rounded up to the next $10.
//   - Deposits are payments into the kitty (plan_transfers with no "to"): "I've paid" → the organiser ticks it off.
//     No money moves through the app.

import { parseDate } from './plan.js';

export const BUDGET_KINDS = [
  { kind: 'accommodation', label: 'Accommodation', icon: '🏠', upfront: true, ticked: true },
  { kind: 'green_fees', label: 'Green fees', icon: '⛳', perPerson: true, lines: true, ticked: true },
  { kind: 'trophy', label: 'Trophy / engraving', icon: '🏆', upfront: true, ticked: true },
  { kind: 'shirts', label: 'Shirts / caps', icon: '👕', perPerson: true, upfront: true, ticked: false },
  { kind: 'food', label: 'Food plan', icon: '🍳', perPerson: true, lines: true, ticked: true },
  { kind: 'drinks', label: 'Drinks', icon: '🍺', perPerson: true, ticked: true },
  { kind: 'transport', label: 'Transport / fuel', icon: '🚗', perPerson: true, ticked: true },
  { kind: 'other', label: 'Other', icon: '➕', ticked: false },
];
export const KIND = Object.fromEntries(BUDGET_KINDS.map((k) => [k.kind, k]));

const num = (x) => (x === '' || x == null || !Number.isFinite(Number(x)) ? 0 : Number(x));
const cents = (x) => Math.round(x * 100) / 100;

/** $ per person for a line made of parts (food plan, green fees): the sum of each part's $ per head. */
export function linesPerPerson(lines) {
  return cents((Array.isArray(lines) ? lines : []).reduce((s, l) => s + num(l?.pp), 0));
}

/** How many people the budget is split between: confirmed if any, else everyone keen. */
export function headcount(rsvps) {
  const confirmed = (rsvps || []).filter((r) => r.status === 'in').length;
  const keen = (rsvps || []).filter((r) => r.status === 'in' || r.status === 'maybe').length;
  return confirmed > 0 ? { heads: confirmed, basis: 'confirmed', confirmed, keen } : { heads: keen, basis: 'keen', confirmed, keen };
}

/**
 * One line's total for the group.
 *   accommodation: its amount, else the reserved total (from the Reserve accommodation job)
 *   with parts (food, green fees): $ per head of all parts × heads
 *   per person: amount × heads; otherwise the amount is the group total.
 */
export function lineTotal(item, heads, accomTotal = null) {
  if (item.kind === 'accommodation') return cents(item.amount != null && item.amount !== '' ? num(item.amount) : num(accomTotal));
  if (Array.isArray(item.lines) && item.lines.length) return cents(linesPerPerson(item.lines) * heads);
  return cents(item.per_person ? num(item.amount) * heads : num(item.amount));
}

/**
 * The trip plan's numbers.
 * Returns { lines: [{ item, total, perPerson }], total, heads, basis, perPerson, upfront }
 */
export function budgetSummary(items, { rsvps = [], accomTotal = null } = {}) {
  const { heads, basis, confirmed, keen } = headcount(rsvps);
  const lines = (items || []).map((item) => {
    const total = lineTotal(item, heads, accomTotal);
    return { item, total, perPerson: heads ? cents(total / heads) : 0 };
  });
  const counted = lines.filter((l) => l.item.ticked !== false);
  const total = cents(counted.reduce((s, l) => s + l.total, 0));
  const upfront = cents(counted.filter((l) => l.item.kind === 'accommodation' || l.item.upfront).reduce((s, l) => s + l.total, 0));
  return { lines, total, heads, basis, confirmed, keen, perPerson: heads ? cents(total / heads) : 0, upfront };
}

/** Round up to the next $10 (150 stays 150; 151 → 160). */
export function roundUp10(x) {
  const n = num(x);
  return n <= 0 ? 0 : Math.ceil(Math.round(n * 100) / 1000) * 10;
}

/** The deposit the app suggests: each person's share of the up-front costs, rounded up to $10. */
export function suggestedDeposit(items, opts = {}) {
  const s = budgetSummary(items, opts);
  return s.heads ? roundUp10(s.upfront / s.heads) : 0;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Each day of the trip: [{ date, dow }]. */
export function tripDates(start, end) {
  const a = parseDate(start);
  if (!a) return [];
  const b = parseDate(end) || a;
  const out = [];
  for (let d = new Date(a); d <= b && out.length < 10; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, dow: DOW[d.getDay()] });
  }
  return out;
}

/**
 * A basic food plan to start from: dinner the first night is a BBQ at the house, breakfast at the house each
 * morning after, and the other nights dinner at the club. Every line is editable.
 */
export function defaultMeals(start, end) {
  const days = tripDates(start, end);
  const out = [];
  days.forEach((d, i) => {
    if (i > 0) out.push({ label: `${d.dow} breakfast — at the house`, pp: 10 });
    if (i < days.length - 1) out.push(i === 0 ? { label: `${d.dow} dinner — BBQ at the house`, pp: 25 } : { label: `${d.dow} dinner — at the club`, pp: 50 });
  });
  if (days.length === 1) out.push({ label: `${days[0].dow} lunch — at the club`, pp: 20 });
  return out;
}

/** Green fees to start from: one line per round of the trip (course name if known), $ per person to fill in. */
export function defaultGreenFees(rounds = [], coursesById = {}) {
  return [...rounds]
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')))
    .map((r) => ({ label: `${r.play_date ? `${DOW[parseDate(r.play_date).getDay()]} — ` : ''}${coursesById[r.course_id]?.name || r.name || 'Round'}`, pp: r.green_fee != null ? num(r.green_fee) : null }));
}

/** The starting trip plan: one line per kind, food and green fees pre-filled. */
export function defaultBudget(plan, { rounds = [], coursesById = {} } = {}) {
  return BUDGET_KINDS.map((k, i) => ({
    plan_id: plan.id, kind: k.kind, label: k.label, sort: i,
    amount: null, per_person: !!k.perPerson, upfront: !!k.upfront, ticked: k.ticked,
    lines: k.kind === 'food' ? defaultMeals(plan.start_date, plan.end_date) : k.kind === 'green_fees' ? defaultGreenFees(rounds, coursesById) : [],
  }));
}

/**
 * Who has paid the deposit. Payments into the kitty (to_id null) count; confirmed ones are paid, the rest wait.
 * Everyone keen (in or maybe) is expected to pay.
 * Returns { deposit, people: [{ player_id, rsvp, paid, pending, state }], confirmedPaid, confirmedNotPaid, notConfirmed, pending }
 *   state: 'paid' | 'pending' (says they paid, not ticked off) | 'unpaid'
 */
export function depositStatus({ deposit, rsvps = [], transfers = [] }) {
  const d = num(deposit);
  const keen = rsvps.filter((r) => r.status === 'in' || r.status === 'maybe');
  const people = keen.map((r) => {
    const mine = transfers.filter((t) => t.from_id === r.player_id && !t.to_id);
    const paid = cents(mine.filter((t) => t.confirmed).reduce((s, t) => s + num(t.amount), 0));
    const pending = cents(mine.filter((t) => !t.confirmed).reduce((s, t) => s + num(t.amount), 0));
    const state = paid >= d - 0.5 ? 'paid' : paid + pending >= d - 0.5 ? 'pending' : 'unpaid';
    return { player_id: r.player_id, rsvp: r.status, paid, pending, state };
  });
  return {
    deposit: d, people,
    confirmedPaid: people.filter((p) => p.rsvp === 'in' && p.state === 'paid'),
    confirmedNotPaid: people.filter((p) => p.rsvp === 'in' && p.state !== 'paid'),
    notConfirmed: people.filter((p) => p.rsvp !== 'in'),
    pending: transfers.filter((t) => !t.to_id && !t.confirmed && keen.some((r) => r.player_id === t.from_id)),
  };
}

/**
 * Search links for accommodation, filled in with the town, dates and headcount. Just links: nothing is booked
 * or scraped. A one-day trip searches one night.
 */
export function stayLinks({ town, start, end, people, bedrooms = null, maxPerNight = null }) {
  const where = String(town || '').trim();
  if (!where || !start) return [];
  const d = parseDate(start);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const checkout = end && end > start ? end : `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  const n = Math.max(1, Math.round(num(people)) || 1);
  const beds = bedrooms != null && num(bedrooms) > 0 ? Math.min(30, Math.round(num(bedrooms))) : null;
  const cap = maxPerNight != null && num(maxPerNight) > 0 ? Math.round(num(maxPerNight)) : null;
  const q = encodeURIComponent(where);
  // Real requests (080): the bedrooms the group needs, and a price cap a night when the organiser set a budget.
  const rooms = beds || Math.max(1, Math.ceil(n / 2));
  return [
    { name: 'Booking.com', url: `https://www.booking.com/searchresults.html?ss=${q}&checkin=${start}&checkout=${checkout}&group_adults=${n}&no_rooms=${rooms}&group_children=0${cap ? `&nflt=${encodeURIComponent(`price=AUD-min-${cap}-1`)}` : ''}` },
    { name: 'Airbnb', url: `https://www.airbnb.com.au/s/${q}/homes?checkin=${start}&checkout=${checkout}&adults=${n}${beds ? `&min_bedrooms=${beds}&min_beds=${Math.max(beds, Math.ceil(n / 2))}` : ''}${cap ? `&price_max=${cap}` : ''}` },
    { name: 'Stayz', url: `https://www.stayz.com.au/search?destination=${q}&startDate=${start}&endDate=${checkout}&adults=${n}${beds ? `&minBedrooms=${beds}` : ''}${cap ? `&price=0-${cap}` : ''}` },
  ];
}

/** Bedrooms for a group: two to a room unless the organiser says otherwise. */
export function bedroomsFor(people, perRoom = 2) {
  const n = Math.round(num(people));
  return n > 0 ? Math.ceil(n / Math.max(1, Math.round(num(perRoom)) || 2)) : null;
}

/** What the search links look for, in one line: "Kiama · 13–15 Mar · 12 people · 6+ bedrooms · under $400/night". */
export function staySearchLine({ town, start, end, people, bedrooms = null, maxPerNight = null, fmt = (a, b) => `${a} – ${b}` }) {
  return [String(town || '').trim() || null, start ? fmt(start, end || start) : null, people ? `${people} ${Number(people) === 1 ? 'person' : 'people'}` : null,
    bedrooms ? `${bedrooms}+ bedrooms` : null, maxPerNight ? `under $${maxPerNight}/night` : null].filter(Boolean).join(' · ');
}

/** Save-a-list how-tos (links only — nothing is fetched from these sites). */
export const LIST_HOWTO = {
  Airbnb: ['Tap the ♡ on the places you like and save them to a new wishlist (e.g. “Golf trip — Kiama”)', 'Open Wishlists → your list → Share', 'Copy link, then paste it here'],
  'Booking.com': ['Tap the ♡ on the places you like (they go in “My next trip” or a new list)', 'Open Saved → the list → Share', 'Copy link, then paste it here'],
  Stayz: ['Tap the ♡ to save places to a Trip Board', 'Open the Trip Board → Invite / Share', 'Copy link, then paste it here'],
};

/** Is a pasted link a shared list (wishlist / saved list / trip board) rather than one place? */
export function isListLink(url) {
  return /airbnb\.[a-z.]+\/(wishlists|s\/wishlists)|booking\.com\/(mywishlist|wishlist|lists?)|stayz\.com\.au\/(trip-?boards?|tripboard|trips)/i.test(String(url || ''));
}

/** Clean up a pasted place: name, link, rough total, sleeps, distance note. Null if there's no name. */
export function cleanStay(v) {
  const name = String(v?.name || '').trim().slice(0, 120);
  if (!name) return null;
  const money = (x) => { const n = Number(String(x ?? '').replace(/[^0-9.]/g, '')); return x === '' || x == null || !Number.isFinite(n) || n <= 0 ? null : n; };
  const sleeps = Math.round(Number(String(v?.sleeps ?? '').replace(/[^0-9]/g, '')));
  let link = String(v?.link || '').trim();
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  return {
    name, link: link || null, total_cost: money(v?.total_cost),
    sleeps: Number.isFinite(sleeps) && sleeps > 0 && sleeps < 200 ? sleeps : null,
    distance_note: String(v?.distance_note || '').trim().slice(0, 120) || null,
  };
}
