// A finished trip's results (ov28, walkthrough W1, I9, I14, I15, I16). Pure functions, no React: the results page at
// the top of a finished trip (components/TripResults.jsx), the awards presentation (screens/AwardsShow.jsx) and the
// Trophy Room's hand-over all read from here.
//
// Josh's review: "This is the moment people screenshot for the group chat. It's also what brings them back for the
// next trip." So: winner and trophy, a podium per round, side comps, the team / Cup verdict from the real match
// results, fines tally, who tipped right, best photos, trophies handed over ("Mo wins the BD Trophy 2026, takes it from
// Bo"), and only then "Plan the next trip".
import { tripSpan } from './activetrip.js';
import { honourOrder } from './history.js';
import { scoreText } from './awards.js';

const day = (s) => (s ? String(s).slice(0, 10) : null);

/**
 * Is a trip over? Its last day is before today, or every one of its rounds is locked (finished) and the last day is
 * today. A trip with no rounds and no dates is never "finished".
 */
export function tripFinished(trip, rounds = [], today) {
  if (!trip) return false;
  const mine = (rounds || []).filter((r) => r.trip_id === trip.id);
  const { end } = tripSpan(trip, rounds);
  if (end && end < today) return true;
  return mine.length > 0 && mine.every((r) => r.status === 'locked') && (!end || end <= today);
}

/** The year a trip is engraved with: its last day's year (else this year). */
export function tripYear(trip, rounds = [], today = '') {
  const { end, start } = tripSpan(trip, rounds);
  return String(end || start || today || '').slice(0, 4) || String(new Date().getFullYear());
}

/** A round's podium: the top three places (ties share a place), each { place, name, players, score, ids }. */
export function roundPodium(board, { max = 3 } = {}) {
  if (!board?.rows?.length) return [];
  const played = board.rows.filter((r) => r.thru > 0 || r.quick);
  return played.filter((r) => r.rank <= max).map((r) => ({
    place: r.rank, label: r.rankLabel, id: r.id, name: r.name, players: r.players || [], score: scoreText(board.format, r),
  }));
}

/**
 * Who's held a trophy before this trip: the newest honour board line for it from any other trip (or from history).
 * Returns { names, ids } or null.
 */
export function previousHolder({ trophyName, tripId, honourBoard = [] } = {}) {
  const name = String(trophyName || '').toLowerCase();
  const list = honourOrder((honourBoard || []).filter((h) => String(h.trophy_name || '').toLowerCase() === name && h.trip_id !== tripId));
  const h = list[0];
  return h ? { names: h.winner_names, ids: h.player_ids || [] } : null;
}

/** Is this trophy already engraved for this trip? Returns the honour board row or null. */
export function engraved({ trophyName, tripId, honourBoard = [] } = {}) {
  const name = String(trophyName || '').toLowerCase();
  return (honourBoard || []).find((h) => h.trip_id === tripId && String(h.trophy_name || '').toLowerCase() === name) || null;
}

/**
 * The hand-over line: "Mo wins the BD Trophy 2026, takes it from Bo", "Mo keeps the BD Trophy 2026",
 * "Mo wins the BD Trophy 2026" (first time). winner: names ("Mo" or "Mo & Lou"); winnerIds to spot "keeps".
 */
export function handoverLine({ trophyName, year, winner, winnerIds = [], previous = null } = {}) {
  if (!winner) return null;
  const t = `${trophyName}${year ? ` ${year}` : ''}`;
  const plural = /&| and /.test(winner);
  if (!previous) return `${winner} ${plural ? 'win' : 'wins'} the ${t}`;
  const same = previous.ids?.length && winnerIds.length && previous.ids.length === winnerIds.length && previous.ids.every((x) => winnerIds.includes(x));
  if (same || previous.names === winner) return `${winner} ${plural ? 'keep' : 'keeps'} the ${t}`;
  return `${winner} ${plural ? 'win' : 'wins'} the ${t}, ${plural ? 'take' : 'takes'} it from ${previous.names}`;
}

/** The winner(s) of a comp's standings: everyone ranked 1st. Returns { names, ids, text } or null (nobody yet). */
export function compWinner(st) {
  const rows = st?.rows || [];
  if (!rows.length) return null;
  const top = rows.filter((r) => r.rank === rows[0].rank);
  const played = top.filter((r) => r.played > 0 || r.thru > 0 || r.value > 0 || r.total > 0 || r.text);
  if (!played.length) return null;
  const ids = played.flatMap((r) => ((r.players || []).length ? r.players.map((p) => p?.id).filter(Boolean) : [r.id]));
  return { names: played.map((r) => r.name).join(' & '), ids, text: played[0].text || '' };
}

/**
 * Fines so far / the fines tally: [{ player_id, count, titles }], most first. awards: the trip's dinner_awards rows
 * (kind 'fine' counts); nominations: their dinner_award_nominations.
 */
export function finesTally({ awards = [], nominations = [] } = {}) {
  const fines = new Map((awards || []).filter((a) => a.kind === 'fine').map((a) => [a.id, a]));
  const by = new Map();
  for (const n of nominations || []) {
    const a = fines.get(n.award_id);
    if (!a) continue;
    const row = by.get(n.player_id) || { player_id: n.player_id, count: 0, titles: [] };
    row.count += 1;
    row.titles.push(a.title);
    by.set(n.player_id, row);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.titles.join().localeCompare(b.titles.join()));
}

/** "Fines so far: Mo 3 · Bo 2 · Al 1" (top `max`), or null when nobody's been fined. */
export function finesLine(tally = [], nameOf = (id) => id, max = 4) {
  if (!tally.length) return null;
  const shown = tally.slice(0, max).map((t) => `${nameOf(t.player_id)} ${t.count}`).join(' · ');
  return `${shown}${tally.length > max ? ` · +${tally.length - max} more` : ''}`;
}

/**
 * Who tipped right. tips: [{ player_id, pick }] where pick is what they tipped (a player id, a side id, a team id…);
 * right: the winning pick(s). Returns { right: [player ids], count, of }.
 */
export function tippedRight(tips = [], right = []) {
  const win = new Set((Array.isArray(right) ? right : [right]).filter(Boolean));
  const ok = (tips || []).filter((t) => win.has(t.pick ?? t.pick_id));
  return { right: ok.map((t) => t.player_id), count: ok.length, of: (tips || []).length };
}

/** "7 tipped Red, 4 tipped Blue" from tips and the options [{ value, label }] (most first; nobody → null). */
export function tipCounts(tips = [], options = []) {
  const n = new Map();
  for (const t of tips || []) n.set(t.pick, (n.get(t.pick) || 0) + 1);
  const parts = (options || []).map((o) => ({ ...o, n: n.get(o.value) || 0 })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n);
  return parts.length ? parts.map((o) => `${o.n} tipped ${o.label}`).join(', ') : null;
}

/** The best photos: most reactions, then newest. posts: [{ id, photo_url, created_at }]; reactions: [{ post_id }]. */
export function bestPhotos(posts = [], reactions = [], max = 6) {
  const count = new Map();
  for (const r of reactions || []) count.set(r.post_id, (count.get(r.post_id) || 0) + 1);
  return (posts || []).filter((p) => p.photo_url)
    .map((p) => ({ ...p, likes: count.get(p.id) || 0 }))
    .sort((a, b) => b.likes - a.likes || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, max);
}

/** The results as text for the group chat. lines: ['🏆 Mo wins the BD Trophy 2026, takes it from Bo', …]. */
export function resultsText(tripName, lines = []) {
  return [`🏁 ${tripName} — the results`, '', ...lines.filter(Boolean)].join('\n');
}

// ------------------------------------------------------------------ I16: months later
/**
 * "This time last year": a trip that was on within `window` days of today, a year ago. Returns { trip, ago: 1 } or
 * null. (Two or more years back counts too, for the biggest anniversary first: the newest.)
 */
export function thisTimeLastYear({ trips = [], rounds = [], today, window = 10 } = {}) {
  if (!today) return null;
  const t0 = Date.parse(`${today}T00:00:00Z`);
  let best = null;
  for (const trip of trips || []) {
    if (!trip || trip.status === 'cancelled') continue;
    const { start, end } = tripSpan(trip, rounds);
    if (!start) continue;
    for (let years = 1; years <= 5; years++) {
      const shift = (d) => {
        const [y, m, dd] = d.split('-').map(Number);
        return Date.UTC(y + years, m - 1, dd);
      };
      const s = shift(start);
      const e = shift(end || start);
      if (t0 >= s - window * 86400000 && t0 <= e + window * 86400000) {
        if (!best || years < best.ago || (years === best.ago && start > best.start)) best = { trip, ago: years, start };
      }
    }
  }
  return best ? { trip: best.trip, ago: best.ago } : null;
}

/**
 * The nudge to suggest the next trip: the last trip finished six months ago (or more) and nothing's coming up.
 * Returns { trip, months } or null.
 */
export function nextTripNudge({ trips = [], rounds = [], today, months = 6 } = {}) {
  if (!today) return null;
  const live = (trips || []).filter((t) => t && t.status !== 'cancelled');
  const spans = live.map((t) => ({ t, ...tripSpan(t, rounds) }));
  if (spans.some((x) => !x.start ? x.t.status === 'active' && !x.end : x.end >= today)) return null; // something on or coming
  const last = spans.filter((x) => x.end && x.end < today).sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!last) return null;
  const gone = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.end}T00:00:00Z`)) / (86400000 * 30.44));
  return gone >= months ? { trip: last.t, months: gone } : null;
}

export { day as isoDay };
