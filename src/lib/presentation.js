// The presentation (ov33). Josh, 23 Oct: "For any of the awards, need a click-through presentation screen. Honourable
// mentions, then 3, 2, 1. Both phone and desktop sized." Pure functions only; the screen is screens/AwardsShow.jsx
// (#/present/awards/<trip>), which ov28 started.
//
// Plain words:
//   - An *item* is one thing to present: a trophy, a round's podium, a side comp, an award, a fine, the fines tally,
//     a cup. presentationItems(trip, data) lists them in a sensible running order; the organiser can untick and
//     drag them (applyOrder keeps their choice).
//   - Each item becomes *steps*: a title card → honourable mentions (if any) → 3rd → 2nd → 1st (podium items), or
//     title → nominations → winner (items with one winner, like "Latest out"). Ties share a place: joint 2nd shows
//     both, and the next place is skipped (1, 2, 2, 4).
//   - The running order: side comps and fines first, then awards, then the rounds and other trophies, then the
//     weekend / social cups, and the main golf trophy last.
//   - No "dinner" anywhere: it's "the presentation" (often lunch after the last round).
import { ordinal } from './awards.js';
import { tally as voteTally, sortAwards } from './dinnerawards.js';
import { termsOf, worthOf, claimWords, rankClaims } from './awardsfines.js';

/** Where each section sits in the default running order (lower first). */
export const SECTION_ORDER = { sides: 10, fines: 20, awards: 30, extras: 35, rounds: 40, trophies: 50, cups: 60, main: 70 };
export const SECTION_LABEL = {
  sides: 'Side comps', fines: 'Fines', awards: 'Awards', extras: 'Extras', rounds: 'The rounds', trophies: 'Trophies',
  cups: 'Cups', main: 'The main trophy',
};
/** How many honourable mentions at most, per item. */
export const MAX_MENTIONS = 4;

const nm = (v) => String(v ?? '').trim();
const and = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`);

/** "1st", "Joint 2nd". */
export function placeLabel(place, joint = false) {
  return `${joint ? 'Joint ' : ''}${ordinal(place)}`;
}

/** The build-up beat before a place is revealed. */
export function beatFor(place, joint = false, single = false) {
  if (single) return 'And the winner is…';
  if (place === 1) return joint ? 'And sharing the win…' : 'And the winner is…';
  if (place === 2) return joint ? 'In second, it’s a tie…' : 'In second place…';
  return joint ? 'Tied for third…' : 'In third place…';
}

/**
 * Podium places from ranked rows ({ id, name, rank, players?, text?, ids? }): the top three places, ties sharing a
 * place. Returns [{ place, joint, label, entrants: [{ id, name, ids, score }] }] best first (1st, then 2nd, …).
 * rank must already be "competition" style (1, 2, 2, 4). `scoreOf(row)` gives the score words.
 */
export function podiumPlaces(rows = [], { scoreOf = (r) => r.text || '', max = 3 } = {}) {
  const by = new Map();
  for (const r of rows || []) {
    if (r == null || r.rank == null || r.rank > max) continue;
    const list = by.get(r.rank) || [];
    list.push({ id: r.id, name: r.name, ids: idsOf(r), score: scoreOf(r) });
    by.set(r.rank, list);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([place, entrants]) => ({ place, joint: entrants.length > 1, label: placeLabel(place, entrants.length > 1), entrants }));
}

function idsOf(r) {
  if (Array.isArray(r.ids) && r.ids.length) return r.ids;
  const ps = (r.players || []).map((p) => p?.id).filter(Boolean);
  return ps.length ? ps : r.id ? [r.id] : [];
}

/**
 * Honourable mentions from ranked rows: 4th and beyond, but only those with a story (a score, a reason, a photo).
 * Returns [{ id, name, ids, story, photo }] (at most `max`).
 */
export function honourableMentions(rows = [], { from = 4, max = MAX_MENTIONS, storyOf = (r) => r.text || r.story || '' } = {}) {
  return (rows || [])
    .filter((r) => r && r.rank != null && r.rank >= from)
    .map((r) => {
      const story = nm(storyOf(r));
      return { id: r.id, name: r.name, ids: idsOf(r), story: story ? `${ordinal(r.rank)} · ${story}` : '', photo: r.photo || null };
    })
    .filter((m) => m.story || m.photo)
    .slice(0, max);
}

/** Competition ranks (1, 2, 2, 4) for rows sorted best first, by `value` (higher better unless lowerBetter). */
export function rankBy(rows = [], value, { lowerBetter = false } = {}) {
  const sorted = [...rows].sort((a, b) => (lowerBetter ? value(a) - value(b) : value(b) - value(a)));
  let rank = 0; let prev;
  return sorted.map((r, i) => {
    const v = value(r);
    if (i === 0 || v !== prev) rank = i + 1;
    prev = v;
    return { ...r, rank };
  });
}

// ------------------------------------------------------------------ items, one kind at a time

/** A trophy from the results (useTripResults → trophies): podium when it has standings, else one winner. */
export function trophyItem(t, { main = false, year = '', nameOf = (id) => id } = {}) {
  if (!t?.winner) return null;
  const base = {
    key: `t-${t.comp.id}`, kind: 'trophy', section: main ? 'main' : t.comp.kind === 'cup' ? 'cups' : 'trophies',
    title: t.name, icon: t.comp.kind === 'cup' ? '⚔️' : '🏆',
    about: main ? `The main trophy${year ? ` · ${year}` : ''}` : aboutComp(t.comp.kind),
    art: { name: t.name, type: t.trophy?.type || null, photo: t.trophy?.photo_url || null },
    handover: t.line || null,
  };
  if (t.comp.kind === 'cup') {
    // The match play Cup: one winning side, with the verdict ("Team Blue win 7–5").
    const verdict = t.st?.verdict?.text || '';
    return { ...base, mode: 'single', mentions: [], winner: { name: t.winner.names, ids: t.winner.ids || [], score: verdict }, worth: verdict };
  }
  const rows = t.st?.rows || [];
  const ranked = rows.length && rows.every((r) => r.rank != null);
  if (ranked && !t.engraved) {
    const places = podiumPlaces(rows.filter(played));
    if (places.length) {
      return { ...base, mode: 'podium', places, mentions: honourableMentions(rows.filter(played)), worth: places[0].entrants[0]?.score || '' };
    }
  }
  if (ranked && t.engraved) {
    // Engraved: the honour board says who won; the standings still give the places behind them.
    const places = podiumPlaces(rows.filter(played));
    if (places.length && places[0].entrants.some((e) => (t.winner.ids || []).some((id) => e.ids.includes(id)))) {
      return { ...base, mode: 'podium', places, mentions: honourableMentions(rows.filter(played)), worth: places[0].entrants[0]?.score || '' };
    }
  }
  return { ...base, mode: 'single', mentions: [], winner: { name: t.winner.names, ids: t.winner.ids || [], score: t.winner.text || '' }, worth: t.winner.text || '' };
}

const played = (r) => r.thru > 0 || r.played > 0 || r.quick || r.value > 0 || r.total > 0 || (r.text && r.text !== '–');

function aboutComp(kind) {
  return {
    individual_points: 'Stableford points over the weekend', individual_net: 'Net score over the weekend', ambrose_teams: 'The Ambrose',
    fourball_pairs: 'Four-ball pairs', day: 'One round', side_comps: 'Most side comps won', games: 'Side games', cup: 'The Cup', manual: 'Awarded by the group',
  }[kind] || '';
}

/** A round's podium (useTripResults → podiums, with rows up to 6th for the mentions). */
export function roundItem(p) {
  const rows = p.rows || p.podium || [];
  const asRows = rows.map((x) => ({ id: x.id, name: x.name, rank: x.place ?? x.rank, ids: (x.players || []).map((pl) => pl?.id).filter(Boolean), text: x.score }));
  const places = podiumPlaces(asRows);
  if (!places.length) return null;
  return {
    key: `r-${p.round.id}`, kind: 'round', section: 'rounds', title: p.round.name, icon: '⛳', about: p.round.play_date ? dayWords(p.round.play_date) : 'The round',
    mode: 'podium', places, mentions: honourableMentions(asRows), worth: places[0].entrants[0]?.score || '',
  };
}

function dayWords(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

const metres = (m) => {
  const v = Number(m);
  if (!Number.isFinite(v)) return '';
  return v < 10 ? `${v.toFixed(2).replace(/0$/, '')} m` : `${Math.round(v)} m`;
};

/**
 * A side comp hole (closest to the pin / longest drive): one winner; the next-best measured shots are the mentions.
 * side: { round, label, winner }; entries: the round's side_entries.
 */
export function sideItem(side, entries = [], { nameOf = (id) => id } = {}) {
  if (!side?.winner) return null;
  const m = /(CTP|LD)\s+(\d+)/.exec(side.label || '');
  const kind = m ? (m[1] === 'CTP' ? 'ctp' : 'ld') : null;
  const hole = m ? Number(m[2]) : null;
  const here = kind ? (entries || []).filter((e) => e.round_id === side.round?.id && e.kind === kind && Number(e.hole) === hole) : [];
  const win = here.find((e) => e.player_id === side.winner && (e.confirmed || e.distance_m != null)) || null;
  const others = here.filter((e) => e.player_id !== side.winner && e.distance_m != null)
    .sort((a, b) => (kind === 'ctp' ? a.distance_m - b.distance_m : b.distance_m - a.distance_m));
  const title = kind === 'ctp' ? `Closest to the pin · ${hole}` : kind === 'ld' ? `Longest drive · ${hole}` : side.label.replace(/^\S+\s+/, '');
  return {
    key: `s-${side.round?.id}-${side.label}`, kind: 'side', section: 'sides', title, icon: kind === 'ctp' ? '🎯' : kind === 'ld' ? '💣' : '⭐',
    about: side.round?.name || '', mode: 'single',
    mentions: others.slice(0, MAX_MENTIONS).map((e, i) => ({ id: e.player_id, name: nameOf(e.player_id), ids: [e.player_id], story: `${ordinal(i + 2)} · ${metres(e.distance_m)}`, photo: e.photo_url || null })),
    winner: { name: nameOf(side.winner), ids: [side.winner], score: win?.distance_m != null ? metres(win.distance_m) : '', photo: win?.photo_url || null },
    worth: win?.distance_m != null ? metres(win.distance_m) : '',
  };
}

/**
 * An award or a fine the group voted on: one winner (the settled winner, else most votes; level on votes is a joint
 * win). The nominations that missed out are the mentions, with their reason, claim or photo.
 */
export function awardItem(award, { nominations = [], votes = [], nameOf = (id) => id, rulesById = {} } = {}) {
  if (!award || award.status !== 'closed') return null;
  const mine = (nominations || []).filter((n) => n.award_id === award.id);
  if (!mine.length) return null;
  const terms = termsOf(award, rulesById);
  const r = voteTally(award, mine, votes);
  let winIds = [];
  if (award.winner_id) winIds = [award.winner_id];
  else if (r.winners.length) winIds = r.winners.map((w) => w.player_id);
  else if (terms.best) {
    const ranked = rankClaims(mine, terms.best).filter((n) => n.rank === 1);
    winIds = ranked.map((n) => n.player_id);
  }
  if (!winIds.length) return null;
  const votesOf = new Map(r.rows.map((x) => [x.player_id, x.votes]));
  const story = (n) => nm(n.reason) || claimWords(n, terms) || (votesOf.get(n.player_id) ? `${votesOf.get(n.player_id)} vote${votesOf.get(n.player_id) === 1 ? '' : 's'}` : '');
  const winNoms = winIds.map((id) => mine.find((n) => n.player_id === id)).filter(Boolean);
  const fine = award.kind === 'fine';
  const worth = worthOf(terms, award);
  const claim = winNoms.length === 1 ? claimWords(winNoms[0], terms) : '';
  const v = votesOf.get(winIds[0]) || 0;
  return {
    key: `a-${award.id}`, kind: fine ? 'fine' : 'award', section: fine ? 'fines' : 'awards', title: award.title, icon: fine ? '🏷' : '🏅',
    about: worth ? `${fine ? 'Fine' : 'Reward'}: ${worth}` : fine ? 'A fine' : 'An award', mode: 'single',
    mentions: mine.filter((n) => !winIds.includes(n.player_id))
      .map((n) => ({ id: n.player_id, name: nameOf(n.player_id), ids: [n.player_id], story: story(n), photo: n.photo_url || null }))
      .filter((m) => m.story || m.photo).slice(0, MAX_MENTIONS),
    winner: {
      name: and(winIds.map(nameOf)), ids: winIds, joint: winIds.length > 1,
      score: [claim, v ? `${v} vote${v === 1 ? '' : 's'}${winIds.length > 1 ? ' each' : ''}` : ''].filter(Boolean).join(' · '),
      story: winNoms.length === 1 ? nm(winNoms[0].reason) : '', photo: winNoms.find((n) => n.photo_url)?.photo_url || null,
    },
    worth: worth ? `${worth}${terms.reward_type === 'strokes' ? ' next round' : ''}` : '',
  };
}

/** The fines tally as a podium: most fines first; 4th and beyond are mentions with what they were fined for. */
export function finesTallyItem(tally = [], { nameOf = (id) => id } = {}) {
  if (!tally?.length) return null;
  const rows = rankBy(tally, (t) => t.count).map((t) => ({
    id: t.player_id, name: nameOf(t.player_id), ids: [t.player_id], rank: t.rank,
    text: `${t.count} fine${t.count === 1 ? '' : 's'}`, story: [...new Set(t.titles)].join(', '),
  }));
  return {
    key: 'fines-tally', kind: 'fines', section: 'fines', title: 'The fines tally', icon: '🏷', about: 'Most fines over the weekend', mode: 'podium',
    places: podiumPlaces(rows), mentions: honourableMentions(rows, { storyOf: (r) => `${r.text} (${r.story})` }), worth: rows[0].text,
  };
}

/** Who tipped right: a list item (no podium). */
export function tipsItem(tipped = []) {
  if (!tipped?.length) return null;
  return {
    key: 'tips', kind: 'tips', section: 'extras', title: 'Who tipped right', icon: '🎯', about: 'Bragging rights only', mode: 'list',
    lines: tipped.map((t) => `${t.title}: ${t.names.length ? t.names.join(', ') : 'nobody'}`),
  };
}

/** The best photos: a photo wall (no podium). */
export function photosItem(photos = []) {
  if (!photos?.length) return null;
  return { key: 'photos', kind: 'photos', section: 'extras', title: 'The best photos', icon: '📸', about: 'Most reactions on the Feed', mode: 'photos', photos: photos.slice(0, 6) };
}

// ------------------------------------------------------------------ EXTENSION POINT: ov32 group cups
/**
 * ⚠️ EXTENSION POINT for ov32 (group cups, migration 101) — not wired to real data yet.
 *
 * When ov32 lands, src/lib/cups.js exposes `cupStandings(cup, data)` with a per-player breakdown that includes
 * "Cap tips 🧢" (points players give each other) and "Vibe points" (posts, photos, videos). Pass each cup and its
 * standings in as `data.cups = [{ cup, standings }]` (screens/AwardsShow.jsx → useCupsForPresentation) and each one
 * becomes a podium item in the "cups" section — after the awards, before the main golf trophy.
 *
 * Expected shapes (adjust here, in one place, if ov32 differs):
 *   cup:       { id, name, about?, photo_url?, kind? ('weekend' | 'social' | …) }
 *   standings: { rows: [{ id, name, players?, value, text?, rank?, breakdown?: [{ label, value }] }] }
 * Rows without a rank are ranked by value (most first). The breakdown becomes the honourable mentions' story
 * ("Cap tips 🧢 12 · Vibe points 8"), and the winner's line.
 */
export function cupStandingsItem({ cup, standings } = {}) {
  const rows0 = standings?.rows || [];
  if (!cup || !rows0.length) return null;
  const rows = (rows0.every((r) => r.rank != null) ? rows0 : rankBy(rows0, (r) => Number(r.value) || 0))
    .filter((r) => (Number(r.value) || 0) !== 0 || r.text);
  if (!rows.length) return null;
  const breakdown = (r) => (typeof r.breakdown === 'string' ? r.breakdown : (r.breakdown || []).filter((b) => b && b.value).map((b) => `${b.label} ${b.value}`).join(' · '));
  const scoreOf = (r) => r.text || `${r.value} pts`;
  const places = podiumPlaces(rows, { scoreOf });
  return {
    key: `cup-${cup.id}`, kind: 'cup', section: 'cups', title: cup.name, icon: '🏆', about: cup.about || 'The weekend cup',
    art: { name: cup.name, type: null, photo: cup.photo_url || null },
    mode: 'podium', places, worth: places[0]?.entrants[0]?.score || '',
    mentions: honourableMentions(rows, { storyOf: (r) => [scoreOf(r), breakdown(r)].filter(Boolean).join(' · ') }),
    breakdowns: Object.fromEntries(rows.map((r) => [r.id, breakdown(r)])),
  };
}

// ------------------------------------------------------------------ the list
/**
 * Everything there is to present for a trip, in the default running order.
 * data: the trip's results (components/TripResults.jsx → useTripResults) plus, optionally:
 *   awards: { awards, nominations, votes } (dinner_awards and friends) · sideEntries · rulesById ·
 *   cups: [{ cup, standings }] — ⚠️ ov32's group cups; see cupStandingsItem (EXTENSION POINT).
 * Returns [{ key, kind, section, title, icon, about, mode: 'podium' | 'single' | 'list' | 'photos', places?, winner?,
 *            mentions?, worth?, handover?, art?, lines?, photos? }].
 */
export function presentationItems(trip, data = {}) {
  if (!trip || !data) return [];
  const nameOf = data.nameOf || ((id) => id);
  const out = [];
  const add = (x) => { if (x) out.push(x); };
  for (const s of data.sides || []) add(sideItem({ round: s.round, label: s.label, winner: s.id || s.winner }, data.sideEntries || [], { nameOf }));
  const aw = data.awards || {};
  for (const a of sortAwards(aw.awards || [])) add(awardItem(a, { nominations: aw.nominations, votes: aw.votes, nameOf, rulesById: data.rulesById || {} }));
  add(finesTallyItem(data.tally || [], { nameOf }));
  add(tipsItem(data.tipped || []));
  add(photosItem(data.photos || []));
  for (const p of data.podiums || []) add(roundItem(p));
  const hero = data.hero || null;
  for (const t of data.trophies || []) add(trophyItem(t, { main: !!hero && t === hero, year: data.year, nameOf }));
  // ⚠️ ov32 group cups (EXTENSION POINT): data.cups = [{ cup, standings }] — see cupStandingsItem.
  for (const c of data.cups || []) add(cupStandingsItem(c));
  return defaultOrder(out);
}

/** Sort items into the default running order: by section, keeping their order within a section. */
export function defaultOrder(items = []) {
  return items.map((x, i) => ({ x, i }))
    .sort((a, b) => (SECTION_ORDER[a.x.section] ?? 50) - (SECTION_ORDER[b.x.section] ?? 50) || a.i - b.i)
    .map(({ x }) => x);
}

/**
 * The organiser's running order over the items. saved: { order: [keys], off: [keys] } (or null).
 * Returns [{ ...item, on }] — saved keys in their saved order; new items (not in `order`) go in after the item that
 * comes before them by default. Keys no longer there are dropped.
 */
export function applyOrder(items = [], saved = null) {
  if (!saved?.order?.length) return items.map((x) => ({ ...x, on: !(saved?.off || []).includes(x.key) }));
  const byKey = new Map(items.map((x) => [x.key, x]));
  const off = new Set(saved.off || []);
  const out = saved.order.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
  const placed = new Set(out.map((x) => x.key));
  items.forEach((x, i) => {
    if (placed.has(x.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex((y) => y.key === items[j].key);
      if (idx >= 0) { at = idx + 1; break; }
    }
    out.splice(at, 0, x);
    placed.add(x.key);
  });
  return out.map((x) => ({ ...x, on: !off.has(x.key) }));
}

/** Move one key up (-1) or down (+1), or to an index: returns the new list of keys. */
export function moveKey(keys = [], key, to) {
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  const dest = Math.max(0, Math.min(keys.length - 1, to));
  const out = keys.filter((k) => k !== key);
  out.splice(dest, 0, key);
  return out;
}

// ------------------------------------------------------------------ steps
/**
 * One item's steps, in order. Each { type: 'title' | 'mentions' | 'place' | 'winner' | 'list' | 'photos', place? }.
 * Podium: title → mentions → 3rd → 2nd → 1st (missing places skipped: a joint 1st has no 2nd).
 * One winner: title → nominations → winner.
 */
export function stepsFor(item) {
  if (!item) return [];
  const steps = [{ type: 'title' }];
  if (item.mode === 'list') return [...steps, { type: 'list' }];
  if (item.mode === 'photos') return [...steps, { type: 'photos' }];
  if (item.mentions?.length) steps.push({ type: 'mentions' });
  if (item.mode === 'podium') {
    for (const p of [...(item.places || [])].sort((a, b) => b.place - a.place)) steps.push({ type: 'place', place: p.place });
  } else {
    steps.push({ type: 'winner' });
  }
  return steps;
}

/** The whole presentation as a flat list of steps: [{ item, index (item's place in the list), step, last }]. */
export function flatSteps(items = []) {
  const out = [];
  items.forEach((item, index) => {
    const steps = stepsFor(item);
    steps.forEach((step, n) => out.push({ item, index, step, last: n === steps.length - 1 }));
  });
  return out;
}

/** Where "Skip to winner" goes from position i: the item's last step. */
export function winnerStep(flat = [], i = 0) {
  const at = flat[i];
  if (!at) return i;
  let j = i;
  while (j + 1 < flat.length && flat[j + 1].index === at.index) j += 1;
  return j;
}

/** The text that goes on the Feed for one item ("🏆 BD Trophy — 1st Mo 40 pts · 2nd Lou 38 pts · 3rd Bo 36 pts"). */
export function shareText(item, tripName = '') {
  if (!item) return '';
  const head = `${item.icon || '🏆'} ${item.title}`;
  let body = '';
  if (item.mode === 'podium') {
    body = (item.places || []).map((p) => `${p.label} ${and(p.entrants.map((e) => e.name))}${p.entrants[0]?.score ? ` ${p.entrants[0].score}` : ''}`).join(' · ');
  } else if (item.mode === 'single' && item.winner) {
    body = `${item.winner.name}${item.winner.score ? ` (${item.winner.score})` : ''}${item.worth && item.worth !== item.winner.score ? ` · ${item.worth}` : ''}`;
  } else if (item.mode === 'list') {
    body = (item.lines || []).join(' · ');
  } else {
    return '';
  }
  const hand = item.handover ? `\n${item.handover}` : '';
  return `${head} — ${body}${hand}${tripName ? `\n🎤 ${tripName} presentation` : ''}`.slice(0, 500);
}

/**
 * The Feed post's id for one item, the same on every phone: so sharing the same item twice (or from two phones)
 * makes one post, never two (the outbox upserts on id and ignores a duplicate). A UUID made from a SHA-1 hash.
 */
export async function postIdFor(tripId, key) {
  const bytes = new TextEncoder().encode(`tgt-present:${tripId}:${key}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5 (name-based, SHA-1)
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

