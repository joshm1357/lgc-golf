// Fines and dinner awards (migration 064, feature 'dinner_awards') — pure functions only.
//
// Plain words:
//   - Each trip has awards ("Hack of the day") and fines ("Late to the tee — buys the first round"). Fines are words
//     only: no money moves in the app.
//   - Anyone in the group adds one and nominates people (with a reason, and a photo or feed post as evidence).
//   - The organiser opens the voting (nominations close), then closes it. One vote per person per award; you can
//     change it until it closes. Most votes wins; level on votes is a tie, shown as a tie.
//   - Roast the golf and the mates — never race, religion, sexuality, disability or tragedy. The database has the
//     same checks (064, private.dinner_award_blocked), so an old app can't get around them.

import { isBlocked, normalise } from './injokes.js';

export const STATUS_LABEL = { nominating: 'Nominations open', voting: 'Voting open', closed: 'Decided' };
export const KIND_LABEL = { award: '🏅 Award', fine: '🍺 Fine' };

export const TITLE_MAX = 60;
export const PENALTY_MAX = 80;
export const REASON_MAX = 140;

/** Ideas to get the night going (one tap to add). */
export const AWARD_IDEAS = ['Hack of the day', 'Best excuse', 'Shot of the trip', 'Worst shirt', 'Biggest sook', 'Most balls lost', 'Ball in the water of the trip'];
export const FINE_IDEAS = [
  { title: 'Late to the tee', penalty: 'buys the first round' },
  { title: 'Air shot', penalty: 'wears the hat at dinner' },
  { title: 'Phone out at dinner', penalty: 'shouts the next round' },
  { title: 'Missed a tap-in', penalty: 'carries the esky tomorrow' },
  { title: 'Didn’t pass the ladies’ tee', penalty: 'sings at dinner' },
];

// Tragedy is off limits too (on top of the in-jokes block list: race, religion, sexuality, disability, abuse).
// Whole words / phrases after normalising. The database (064) has the same list; a unit test checks they match.
export const TRAGEDY_BLOCKED = [
  'cancer', 'tumour', 'tumor', 'chemo', 'suicide', 'suicidal', 'overdose', 'overdosed', 'miscarriage', 'stillborn',
  'holocaust', 'terrorist', 'terrorists', 'rape', 'raped', 'rapist', 'paedo', 'pedo', 'paedophile', 'pedophile',
  'dead mum', 'dead dad', 'dead wife', 'dead kid',
];

/** Is it off limits? */
export function awardBlocked(text) {
  if (isBlocked(text)) return true;
  const padded = ` ${normalise(text)} `;
  return TRAGEDY_BLOCKED.some((w) => padded.includes(` ${w} `));
}

const FRIENDLY = 'Keep it friendly — roast the golf and the mates, never who someone is or anything tragic';

/** Check an award or fine before saving. '' = fine, else a short reason. */
export function checkAward({ title, kind = 'award', penalty = '' } = {}) {
  const t = String(title || '').trim();
  if (t.length < 2) return kind === 'fine' ? 'Name the fine first' : 'Name the award first';
  if (t.length > TITLE_MAX) return `Keep the name under ${TITLE_MAX} characters`;
  const p = String(penalty || '').trim();
  if (kind === 'fine' && p && p.length < 2) return 'Say what the fine is';
  if (p.length > PENALTY_MAX) return `Keep the fine under ${PENALTY_MAX} characters`;
  if (awardBlocked(t) || awardBlocked(p)) return FRIENDLY;
  return '';
}

/** Check a nomination's reason (optional). */
export function checkReason(reason) {
  const r = String(reason || '').trim();
  if (r.length > REASON_MAX) return `Keep it under ${REASON_MAX} characters`;
  if (r && awardBlocked(r)) return FRIENDLY;
  return '';
}

/** Who can do what, given an award's status. */
export const canNominate = (award, isOrganiser = false) => !!award && (award.status === 'nominating' || (isOrganiser && award.status === 'voting'));
export const canVote = (award) => award?.status === 'voting';

/** What the organiser's button does next. */
export function nextStep(award) {
  if (award?.status === 'nominating') return { status: 'voting', label: 'Open the voting' };
  if (award?.status === 'voting') return { status: 'closed', label: 'Close the voting' };
  return { status: 'voting', label: 'Reopen the voting' };
}

/** My vote on an award (the nomination id), or null. */
export function myVote(votes = [], awardId, me) {
  return votes.find((v) => v.award_id === awardId && v.voter_id === me)?.nomination_id || null;
}

/**
 * Count the votes on one award.
 * Returns { rows: [{ nomination, player_id, votes }] most votes first (then nominated first), total,
 *           winners: rows on the top count (empty if no votes), tie: more than one winner }.
 * Votes for a nomination that isn't on this award are ignored; one vote per voter (the latest wins if a list
 * somehow has two).
 */
export function tally(award, nominations = [], votes = []) {
  const noms = nominations.filter((n) => n.award_id === award?.id)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const ids = new Set(noms.map((n) => n.id));
  const byVoter = new Map();
  for (const v of votes) {
    if (v.award_id !== award?.id || !ids.has(v.nomination_id)) continue;
    const had = byVoter.get(v.voter_id);
    if (!had || String(v.updated_at || v.created_at || '') >= String(had.updated_at || had.created_at || '')) byVoter.set(v.voter_id, v);
  }
  const count = new Map();
  for (const v of byVoter.values()) count.set(v.nomination_id, (count.get(v.nomination_id) || 0) + 1);
  const rows = noms.map((n, i) => ({ nomination: n, player_id: n.player_id, votes: count.get(n.id) || 0, order: i }))
    .sort((a, b) => b.votes - a.votes || a.order - b.order)
    .map(({ order, ...r }) => r);
  const top = rows[0]?.votes || 0;
  const winners = top > 0 ? rows.filter((r) => r.votes === top) : [];
  return { rows, total: byVoter.size, winners, tie: winners.length > 1 };
}

const and = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * One line for an award's result.
 *   "Tom (4 votes)" · "Tie — Tom & Dick (2 votes each)" · "No votes yet"
 * A fine adds what the winner has to do: "Tom (3 votes) — fine: buys the first round".
 */
export function resultLine(award, result, nameOf = (id) => id) {
  if (!result?.winners?.length) return result?.rows?.length ? 'No votes yet' : 'No nominations';
  const names = result.winners.map((w) => nameOf(w.player_id));
  const n = result.winners[0].votes;
  const who = result.tie ? `Tie — ${and(names)} (${plural(n, 'vote')} each)` : `${names[0]} (${plural(n, 'vote')})`;
  return award?.kind === 'fine' && award.penalty ? `${who} — fine: ${award.penalty}` : who;
}

/** Awards in the order to show: voting open first, then nominations open, then decided; awards before fines. */
export function sortAwards(awards = []) {
  const rank = { voting: 0, nominating: 1, closed: 2 };
  return [...awards].sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)
    || (a.kind === b.kind ? 0 : a.kind === 'award' ? -1 : 1)
    || (a.sort || 0) - (b.sort || 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/** The feed post when the organiser closes the voting on one award. */
export function closedPost(award, result, nameOf) {
  const icon = award?.kind === 'fine' ? '🍺' : '🏅';
  return `${icon} ${award.kind === 'fine' ? 'Fine' : 'Dinner award'} — ${award.title}: ${resultLine(award, result, nameOf)}`;
}

/**
 * The share card for the night: every decided award and fine, winner(s) and votes.
 * { title, sub, rows: [{ label, name, line }] } — at most 7 rows.
 */
export function resultsCard({ tripName = '', awards = [], nominations = [], votes = [], nameOf = (id) => id } = {}) {
  const rows = sortAwards(awards).filter((a) => a.status === 'closed').map((a) => {
    const r = tally(a, nominations, votes);
    const names = r.winners.map((w) => nameOf(w.player_id));
    return {
      label: `${a.kind === 'fine' ? 'FINE' : 'AWARD'} · ${String(a.title).toUpperCase()}`.slice(0, 44),
      name: names.length ? (r.tie ? `Tie: ${and(names)}` : names[0]).slice(0, 34) : '—',
      line: names.length ? `${plural(r.winners[0].votes, 'vote')}${a.kind === 'fine' && a.penalty ? ` · ${a.penalty}` : ''}`.slice(0, 50) : 'no votes',
    };
  });
  return { title: tripName || 'Dinner awards', sub: rows.length ? `${rows.length} decided` : 'Nothing decided yet', rows: rows.slice(0, 7) };
}
