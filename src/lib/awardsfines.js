// Awards and fines (migration 093, feature 'dinner_awards') — pure functions only.
//
// Plain words:
//   - Anyone (not guests) proposes an award or a fine. It's a Rulebook rule (category 'fines', award_kind award|fine)
//     decided the group's usual way. It can be for every trip or just one.
//   - Each one is worth something (strokes, points, money, a drink, a title, bragging rights or words) and says what
//     proof a claim needs (none, a photo, a time, a number, or a photo with a time or a number). "best" means the best
//     claim wins on its own value (latest / earliest time, highest / lowest number) — the app ranks the claims and the
//     vote confirms.
//   - People give an opinion on a fine's size: Too much / About right / Too little.
//   - Any feed post can be fined: "🏷 Fine / award" → which one → who → a note. The post gets a chip.
//   - The standard "Leftover kitty" rule says what happens to money left in the kitty (words only).
// The database (093) writes the same words (private.award_value, private.leftover_value) — unit tests check examples.

export const REWARD_TYPES = [
  { key: 'strokes', label: 'Strokes', icon: '⛳', amount: true },
  { key: 'points', label: 'Points', icon: '➕', amount: true },
  { key: 'money', label: 'Money ($)', icon: '💵', amount: true },
  { key: 'drink', label: 'A drink / round', icon: '🍺' },
  { key: 'title', label: 'A trophy or title', icon: '🏆' },
  { key: 'bragging', label: 'Bragging rights', icon: '😎' },
  { key: 'other', label: 'Something else', icon: '✍️' },
];
export const PROOFS = [
  { key: 'none', label: 'Nothing — just nominate' },
  { key: 'photo', label: 'A photo' },
  { key: 'time', label: 'A time' },
  { key: 'number', label: 'A number' },
  { key: 'photo_time', label: 'A photo and a time' },
  { key: 'photo_number', label: 'A photo and a number' },
];
export const BESTS = {
  time: [{ key: 'latest', label: 'Latest wins' }, { key: 'earliest', label: 'Earliest wins' }],
  number: [{ key: 'highest', label: 'Biggest wins' }, { key: 'lowest', label: 'Smallest wins' }],
};
export const OPINIONS = [
  { key: 'too_much', label: 'Too much' },
  { key: 'about_right', label: 'About right' },
  { key: 'too_little', label: 'Too little' },
];
export const LEFTOVER = [
  { key: 'bar', label: 'On the bar the last night' },
  { key: 'split', label: 'Split back to everyone' },
  { key: 'rollover', label: 'Rolls over to the next trip' },
  { key: 'winner', label: 'Goes to the trophy winner' },
  { key: 'other', label: 'Something else' },
];
export const LEFTOVER_KEY = 'leftover_kitty';

/** Ideas to get people started (one tap fills the form). */
export const IDEAS = [
  { title: 'Latest out', award_kind: 'award', reward_type: 'strokes', reward_amount: -1, proof: 'photo_time', best: 'latest' },
  { title: 'Longest putt holed', award_kind: 'award', reward_type: 'bragging', proof: 'number', number_unit: 'm', best: 'highest' },
  { title: 'Most balls lost', award_kind: 'award', reward_type: 'title', reward_note: 'Wears the hat at dinner', proof: 'number', number_unit: 'balls', best: 'highest' },
  { title: 'Wrong-ball fine', award_kind: 'fine', reward_type: 'money', reward_amount: 5, proof: 'none' },
  { title: 'Air shot', award_kind: 'fine', reward_type: 'drink', reward_note: 'Buys the first round', proof: 'none' },
  { title: 'Late to the tee', award_kind: 'fine', reward_type: 'strokes', reward_amount: 1, proof: 'time' },
];

const trimScale = (n) => {
  const v = Math.abs(Number(n) || 0);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
};
const note = (s) => String(s || '').trim();

/** What it's worth, in words — the same as the database's private.award_value. "" when nothing. */
export function rewardWords(type, amount, n) {
  const a = Number(amount) || 0;
  const tail = note(n) ? ` · ${note(n)}` : '';
  let out = '';
  if (type === 'strokes') out = `${a < 0 ? '−' : '+'}${trimScale(a)} stroke${Math.abs(a) === 1 ? '' : 's'}${tail}`;
  else if (type === 'points') out = `${a < 0 ? '−' : '+'}${trimScale(a)} point${Math.abs(a) === 1 ? '' : 's'}${tail}`;
  else if (type === 'money') out = `$${trimScale(a)}${tail}`;
  else if (type === 'drink') out = note(n) || 'Buys a round';
  else if (type === 'title') out = note(n) || 'The title';
  else if (type === 'bragging') out = 'Bragging rights';
  else if (type === 'other') out = note(n);
  return out.slice(0, 120);
}

/** The leftover kitty rule's words — the same as private.leftover_value. */
export function leftoverWords(choice, n) {
  if (choice === 'other') return (note(n) || 'Something else').slice(0, 80);
  return (LEFTOVER.find((l) => l.key === (choice || 'bar')) || LEFTOVER[0]).label;
}

/** What a claim needs. */
export function proofNeeds(proof) {
  const p = proof || 'none';
  return { photo: p.startsWith('photo'), time: p === 'time' || p === 'photo_time', number: p === 'number' || p === 'photo_number' };
}

/** "📷 Photo + ⏱ time" for a card; '' for none. */
export function proofLabel(proof, unit) {
  const n = proofNeeds(proof);
  const parts = [n.photo && '📷 photo', n.time && '⏱ time', n.number && `🔢 ${note(unit) || 'number'}`].filter(Boolean);
  return parts.length ? `Needs ${parts.join(' + ')}` : '';
}

/** "Latest wins" etc. */
export function bestLabel(best) {
  return [...BESTS.time, ...BESTS.number].find((b) => b.key === best)?.label || '';
}

/** Check a proposal before saving. '' = fine, else a short reason (the database checks the same). */
export function checkProposal(v = {}) {
  const t = note(v.title);
  if (t.length < 2) return v.award_kind === 'fine' ? 'Name the fine first' : 'Name the award first';
  if (t.length > 60) return 'Keep the name under 60 characters';
  const a = Number(v.reward_amount);
  if (v.reward_type === 'strokes' && (!Number.isInteger(a) || a === 0 || a < -10 || a > 10)) return 'Strokes: a whole number from 1 to 10';
  if (v.reward_type === 'points' && (!a || a < -50 || a > 50)) return 'Points: a number from 1 to 50';
  if (v.reward_type === 'money' && (!(a > 0) || a > 1000 || Math.round(a * 100) !== a * 100)) return 'Money: dollars and cents, up to $1000';
  if (v.reward_type === 'other' && note(v.reward_note).length < 2) return 'Say what it’s worth';
  if (note(v.reward_note).length > 80) return 'Keep it under 80 characters';
  return '';
}

/**
 * Strokes are typed as a positive number; an award takes them off, a fine adds them. The stored amount is the change
 * to the player's score (award −1, fine +2).
 */
export function signedAmount(kind, type, amount) {
  const a = Math.abs(Number(amount) || 0);
  if (type === 'strokes' || type === 'points') return kind === 'fine' ? (type === 'strokes' ? a : -a) : (type === 'strokes' ? -a : a);
  return type === 'money' ? a : null;
}

/** An award's terms: its Rulebook rule's when it came from one, else its own (as private.award_terms). */
export function termsOf(award, rulesById = {}) {
  const r = award?.rule_id ? rulesById[award.rule_id] : null;
  const s = r || award || {};
  return {
    kind: award?.kind || r?.award_kind || 'award', title: award?.title || r?.title || '',
    reward_type: s.reward_type || null, reward_amount: s.reward_amount ?? null, reward_note: s.reward_note || null,
    proof: s.proof || 'none', best: s.best || null, number_unit: s.number_unit || null, rule_id: r?.id || null,
  };
}
const ruleTerms = (r) => ({
  kind: r.award_kind, title: r.title, reward_type: r.reward_type, reward_amount: r.reward_amount, reward_note: r.reward_note,
  proof: r.proof || 'none', best: r.best || null, number_unit: r.number_unit || null, rule_id: r.id,
});

/** The worth line for an award: its reward words, or a fine's old "penalty" words. */
export function worthOf(terms, award) {
  return rewardWords(terms?.reward_type, terms?.reward_amount, terms?.reward_note) || (award?.kind === 'fine' ? note(award?.penalty) : '');
}

/**
 * Which awards and fines are on a trip.
 *   rules: the group's rules; awards: dinner_awards rows (any trip); tripId.
 * Returns { list: [{ key, title, kind, terms, worth, rule, award }] — in force for this trip (Rulebook ones for every
 *           trip or this one, plus the trip's own), awards first; proposed: rules waiting for a decision that would be
 *           on this trip }.
 */
export function tripAwardList({ rules = [], awards = [], tripId = null } = {}) {
  const forTrip = (r) => !r.for_trip || r.for_trip === tripId;
  const mine = (awards || []).filter((a) => a.trip_id === tripId);
  const byRule = new Map(mine.filter((a) => a.rule_id).map((a) => [a.rule_id, a]));
  const list = [];
  for (const r of rules || []) {
    if (!r.award_kind || r.status !== 'active' || !forTrip(r)) continue;
    const terms = ruleTerms(r);
    const award = byRule.get(r.id) || null;
    list.push({ key: `r:${r.id}`, title: r.title, kind: r.award_kind, terms, worth: worthOf(terms, award), rule: r, award });
  }
  for (const a of mine) {
    if (a.rule_id && list.some((x) => x.rule?.id === a.rule_id)) continue;
    const terms = termsOf(a, {});
    list.push({ key: `a:${a.id}`, title: a.title, kind: a.kind, terms, worth: worthOf(terms, a), rule: null, award: a });
  }
  list.sort((x, y) => (x.kind === y.kind ? String(x.title).localeCompare(String(y.title)) : x.kind === 'award' ? -1 : 1));
  const proposed = (rules || []).filter((r) => r.award_kind && r.status === 'proposed' && forTrip(r));
  return { list, proposed };
}

/** The chip on a feed post: "🏷 Fined: Wrong ball ($5)" · "🏅 Up for: Latest out (−1 stroke)". */
export function chipText({ kind, title, worth }) {
  const w = note(worth);
  return `${kind === 'fine' ? '🏷 Fined' : '🏅 Up for'}: ${title}${w ? ` (${w})` : ''}`;
}

/** "2:47am" in Sydney. */
export function timeWords(iso) {
  if (!iso) return '';
  const s = new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' });
  return s.replace(/\s+/g, '').replace(/\./g, '').toLowerCase();
}

/** A claim's proof in words: "2:47am", "15 m". */
export function claimWords(nom, terms = {}) {
  const parts = [];
  if (nom?.claim_at) parts.push(timeWords(nom.claim_at));
  if (nom?.claim_number != null) parts.push(`${trimScale(nom.claim_number)}${terms.number_unit ? ` ${terms.number_unit}` : ''}`);
  return parts.join(', ');
}

/**
 * Rank the claims on an award decided by its value. Returns the nominations best first (ties share a rank), with
 * { rank }; claims without the value go last. [] when the award isn't decided on value.
 */
export function rankClaims(nominations = [], best) {
  if (!best) return [];
  const field = best === 'latest' || best === 'earliest' ? 'claim_at' : 'claim_number';
  const val = (n) => (field === 'claim_at' ? (n.claim_at ? Date.parse(n.claim_at) : null) : n.claim_number == null ? null : Number(n.claim_number));
  const desc = best === 'latest' || best === 'highest';
  const sorted = [...nominations].sort((a, b) => {
    const x = val(a); const y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return desc ? y - x : x - y;
  });
  let rank = 0; let prev;
  return sorted.map((n, i) => {
    const v = val(n);
    if (v == null) return { ...n, rank: null };
    if (i === 0 || v !== prev) rank = i + 1;
    prev = v;
    return { ...n, rank };
  });
}

/** The result post, as the database writes it: "🏆 Latest out — Hamish, 2:47am 📷 · −1 stroke next round". */
export function resultText({ kind, title, name, nom, terms, penalty }) {
  const worth = rewardWords(terms?.reward_type, terms?.reward_amount, terms?.reward_note) || (kind === 'fine' ? note(penalty) : '');
  const claim = claimWords(nom, terms);
  const photo = nom?.photo_url || nom?.post_id ? ' 📷' : '';
  const strokes = terms?.reward_type === 'strokes';
  return `${kind === 'fine' ? '🍺' : '🏆'} ${title} — ${name || 'Someone'}${claim ? `, ${claim}` : ''}${photo}${worth ? ` · ${worth}${strokes ? ' next round' : ''}` : ''}`;
}

/**
 * Opinions on a fine's size → { too_much, about_right, too_little, total, lean, line }.
 * lean: the most common opinion when it's clearly ahead (else null). line: "3 say too much · 1 about right".
 */
export function tallyOpinions(rows = []) {
  const t = { too_much: 0, about_right: 0, too_little: 0 };
  for (const r of rows || []) if (t[r.opinion] != null) t[r.opinion] += 1;
  const total = t.too_much + t.about_right + t.too_little;
  const sorted = Object.entries(t).sort((a, b) => b[1] - a[1]);
  const lean = total && sorted[0][1] > sorted[1][1] ? sorted[0][0] : null;
  const words = { too_much: 'too much', about_right: 'about right', too_little: 'too little' };
  const line = total ? sorted.filter(([, n]) => n).map(([k, n], i) => `${n} ${i === 0 ? (n === 1 ? 'says' : 'say') + ' ' : ''}${words[k]}`).join(' · ') : 'No opinions yet';
  return { ...t, total, lean, line };
}

/**
 * The leftover kitty line for the settle-up: { text, share } — "Leftover $85 → on the bar the last night (group
 * rule)"; with "split", each person's share. null when there's nothing left (or no rule).
 */
export function leftoverLine(pot, rule, people = 0, money = (n) => `$${Math.round(n)}`) {
  const p = Math.round((Number(pot) || 0) * 100) / 100;
  if (!rule || p < 0.5) return null;
  const words = leftoverWords(rule.leftover, rule.leftover_note);
  const share = rule.leftover === 'split' && people > 0 ? Math.floor((p / people) * 100) / 100 : null;
  const lower = words.charAt(0).toLowerCase() + words.slice(1);
  return { text: `Leftover ${money(p)} → ${lower} (group rule)`, share, words };
}
