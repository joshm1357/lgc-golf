// "Import anything from past trips" (22 Oct 2026, Josh: "should allow all"): the pure parts for the new kinds of
// history on the confirm screen (screens/AiImport.jsx) — past rounds and scorecards, past cups, awards and moments,
// stories, and "other". aiimport.js does players, trips, winners, handicaps and rules, and calls in here.
//
// Where each one goes (written with the organiser's own sign-in, migration 081):
//   * rounds → import_rounds: a locked round on a past trip, its players, per-hole strokes when the course's pars
//     are known (one of the group's courses, a copy from the course library, or the card's own pars and stroke
//     index), else the card's Stableford points ("Card pts"). What a round can't hold (gross / net, names not in
//     the group, Ambrose teams) goes with it as a scorecard note.
//   * cups → a history note (sides, matches, final score), and the winning side on the honour board. Never the live
//     Cup's tables: those hold the group's one current Cup.
//   * awards, moments, fines, side comp winners, stories, commentary, other → history notes on the trip (or the
//     group's history when there's no trip).
// Trips: each item goes on an existing trip when its name / year match, on a new past trip from the same import, on
// the trip the organiser started from ("Add history to this trip"), or on a new past trip. The organiser can change
// it. Safe to run twice: the same keys as the database (normKey), so what's already in says "already in".
import { findTrip, honourLabel, resolvePlayer, matchTrophy } from './aiimport.js';
import { winnerNames, localToday } from './history.js';

const low = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** The database's private.norm_key: lower case, one space, trimmed. */
export const normKey = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const yearOfDate = (d) => (d ? Number(String(d).slice(0, 4)) : null);

export const HISTORY_SECTIONS = [
  { key: 'rounds', title: 'Rounds & scorecards', icon: '⛳' },
  { key: 'cups', title: 'Cups', icon: '🏆' },
  { key: 'awards', title: 'Awards & moments', icon: '🎖️' },
  { key: 'stories', title: 'Stories', icon: '📖' },
  { key: 'other', title: 'Other', icon: '🗂️' },
];
export const HISTORY_KEYS = HISTORY_SECTIONS.map((s) => s.key);
export const NEEDS_TRIP = new Set(['rounds', 'cups']); // a round (and a cup) always sits on a trip

export const NOTE_ICON = { story: '📖', commentary: '🎙️', report: '📰', award: '🎖️', fine: '💸', moment: '⭐', side_comp: '🎯', cup: '🏆', scorecard: '📋', other: '🗂️' };
export const KIND_WORDS = { award: 'Award', fine: 'Fine', moment: 'Moment', side_comp: 'Side comp', other: 'Other', story: 'Story', commentary: 'Commentary', report: 'Report' };

// ------------------------------------------------------------------ Courses

const COURSE_FILLER = new Set(['the', 'golf', 'club', 'gc', 'course', 'country', 'cc', 'links', 'resort', 'and', '&']);
/** A course's name for matching: lower case, no punctuation, without "golf / club / course / the …". */
export function courseKey(name) {
  const w = low(name).replace(/[^a-z0-9&\s]/g, ' ').split(/\s+/).filter(Boolean);
  const core = w.filter((x) => !COURSE_FILLER.has(x));
  return (core.length ? core : w).join(' ');
}
/** The group's course for a name on a card: the same name, else the same core ("Kiama GC" = "Kiama Golf Club"),
 *  only when one matches. */
export function findCourse(name, courses = []) {
  const exact = courses.filter((c) => normKey(c.name) === normKey(name));
  if (exact.length) return exact[0];
  const k = courseKey(name);
  const same = k ? courses.filter((c) => courseKey(c.name) === k) : [];
  return same.length === 1 ? same[0] : null;
}
/** The course-library hit for a name ("Kiama" → "Kiama Golf Club"), only when its core name is the same. */
export function libraryPick(name, hits = []) {
  const k = courseKey(name);
  const same = (hits || []).filter((h) => h && h.id && courseKey(h.name) === k && (h.holes == null || Number(h.holes) > 0));
  return same.length >= 1 ? same[0] : null;
}
/** The card's own holes when it printed pars AND a stroke index for 9 or 18 holes, else null. */
export function cardHoles(d) {
  const pars = Array.isArray(d.pars) ? d.pars : null;
  const si = Array.isArray(d.si) ? d.si : null;
  if (!pars || !si || pars.length !== si.length || ![9, 18].includes(pars.length)) return null;
  return pars.map((par, i) => ({ n: i + 1, par: Number(par), si: Number(si[i]) }));
}

// ------------------------------------------------------------------ Trips

/** A name for a new past trip made for an item: the trip it names, else "<course or title> <year>". */
export function newTripName(section, d) {
  if (d.trip) return String(d.trip).trim().slice(0, 60);
  const base = section === 'rounds' ? d.course : section === 'cups' ? d.name : '';
  const y = d.year || yearOfDate(d.date) || '';
  return `${base || 'Past trip'} ${y}`.trim().slice(0, 60);
}

/**
 * Which trip an item goes on, as a choice:
 *   a trip id (one of the group's) · 'p:<item id>' (a past trip proposed in the same import) · 'new' (a new past trip
 *   for this item) · '' (no trip: the group's history in general — not for rounds and cups).
 * ctx = { trips, proposed: [trip items], preset (a trip id the organiser started from) }.
 */
export function chooseTrip(section, d, ctx = {}) {
  const trips = ctx.trips || [];
  const proposed = ctx.proposed || [];
  const year = d.year || yearOfDate(d.date);
  if (d.trip) {
    const hit = findTrip({ name: d.trip, year: year || NaN }, trips) || trips.find((t) => low(t.name) === low(d.trip));
    if (hit) return hit.id;
    const p = proposed.find((x) => low(x.data.name) === low(d.trip) || (x.data.year === year && findTrip({ name: d.trip, year }, [{ name: x.data.name, start_date: `${x.data.year}-01-01` }])));
    if (p) return p.existingId || `p:${p.id}`;
  }
  if (ctx.preset && trips.some((t) => t.id === ctx.preset)) return ctx.preset;
  if (!d.trip && year) {
    const same = trips.filter((t) => yearOfDate(t.start_date) === year);
    if (same.length === 1) return same[0].id;
    const prop = proposed.filter((x) => x.data.year === year);
    if (prop.length === 1 && !same.length) return prop[0].existingId || `p:${prop[0].id}`;
  }
  return d.trip || NEEDS_TRIP.has(section) ? 'new' : '';
}

/** Words for a trip choice: "Kiama 2018", "new past trip Kiama 2018", "the group’s history". */
export function tripWords(it, ctx = {}) {
  const c = it.tripChoice;
  if (!c) return 'the group’s history (no trip)';
  if (c === 'new') return `new past trip ${newTripName(it.section, it.data)}`;
  if (c.startsWith('p:')) {
    const p = (ctx.proposed || []).find((x) => `p:${x.id}` === c);
    return p ? `new past trip ${p.data.name}` : 'a new past trip';
  }
  const t = (ctx.trips || []).find((x) => x.id === c);
  return t ? t.name : 'a trip';
}

// ------------------------------------------------------------------ Keys: what's already in

/** A round's key, the same as import_rounds makes (trip | course | date | name). */
export function roundKey(tripId, course, date, name) {
  return `${tripId}|${normKey(course)}|${date || ''}|${normKey(name)}`.slice(0, 400);
}
/** A note's key, the same as import_history_notes makes (kind | trip | title | year | the body's first 60). */
export function noteKey(kind, tripId, title, year, body) {
  return `${kind}|${tripId || ''}|${normKey(title)}|${year || ''}|${normKey(body).slice(0, 60)}`.slice(0, 400);
}

// ------------------------------------------------------------------ Turning items into rows

const hcpText = (h) => (h < 0 ? `+${-h}` : String(h));
/** The text of a note for each kind (what's saved as its title / body). */
export function noteFor(section, d) {
  if (section === 'awards') {
    const where = [d.hole ? `hole ${d.hole}` : '', d.course || ''].filter(Boolean).join(' at ');
    const body = [d.detail || '', where && !low(d.detail).includes(low(where)) ? where.charAt(0).toUpperCase() + where.slice(1) : ''].filter(Boolean).join(' · ');
    return { kind: d.kind || 'other', title: d.title, body: body || null, people: d.winners || null };
  }
  if (section === 'stories') return { kind: d.kind || 'story', title: d.title, body: d.body, people: null };
  if (section === 'other') return { kind: 'other', title: d.title, body: d.text, people: null };
  if (section === 'cups') return { kind: 'cup', title: d.name, body: cupSummary(d), people: d.winner ? (d.sides.find((s) => s.name === d.winner)?.players || []).join(' & ') || null : null };
  return null;
}

const half = (n) => (n == null ? '' : Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`.replace(/^0½$/, '½'));
/** "Blue 4½ – Gold 3½ (Blue won). Kurt beat Dave 3&2 · Bluey and Sam halved". */
export function cupSummary(d) {
  const [a, b] = d.sides || [];
  if (!a || !b) return '';
  const score = a.points != null && b.points != null ? `${a.name} ${half(a.points)} – ${b.name} ${half(b.points)}` : `${a.name} v ${b.name}`;
  const lines = [`${score}${d.winner ? ` (${d.winner} won)` : ''}.`];
  for (const m of d.matches || []) {
    const A = m.a.join(' & ');
    const B = m.b.join(' & ');
    const res = m.result ? ` ${m.result}` : '';
    lines.push(m.winner === 'a' ? `${A} beat ${B}${res}` : m.winner === 'b' ? `${B} beat ${A}${res}` : m.winner === 'halved' ? `${A} and ${B} halved` : `${A} v ${B}${res}`);
  }
  return lines.join('\n').slice(0, 4000);
}

/** Every name in an item, for matching to players (a cup's sides and matches, an award's winners). */
export function itemNames(section, d) {
  if (section === 'rounds') return d.players.map((p) => p.name);
  if (section === 'cups') return [...new Set([...d.sides.flatMap((s) => s.players), ...(d.matches || []).flatMap((m) => [...m.a, ...m.b])])];
  if (section === 'awards') return winnerNames(d.winners || '');
  return [];
}

/** Ids for names (each a certain match, or the organiser's answer in the players section). */
export function idsFor(names, players, aliases = {}) {
  const ids = [];
  for (const n of names) {
    const p = resolvePlayer(n, players, aliases);
    if (p && !ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}

/**
 * The import_rounds row for a ticked round. `course` = { course_id } (the group's, or a library copy) or
 * { course: { name, holes } } (holes from the card, or null for a totals-only placeholder). `real` = its pars are
 * real, so per-hole strokes are kept. Players not in the group, gross / net, and strokes that can't be kept go in
 * the scorecard note (summary).
 */
export function roundRow(it, tripId, course, real, players, aliases = {}) {
  const d = it.data;
  const lines = [];
  const rows = [];
  for (const p of d.players) {
    const hit = resolvePlayer(p.name, players, aliases);
    const strokesKept = !!(hit && real && p.strokes?.some((s) => s != null));
    const pointsKept = !!(hit && !strokesKept && d.format === 'stableford' && p.points != null);
    if (hit) rows.push({ player_id: hit.id, handicap: p.handicap ?? null, strokes: strokesKept ? p.strokes : null, points: pointsKept ? p.points : null });
    const left = [
      p.gross != null ? `${p.gross} gross` : '', p.net != null ? `${p.net} net` : '',
      p.points != null && !pointsKept && !strokesKept ? `${p.points} pts` : '',
      p.strokes?.some((s) => s != null) && !strokesKept ? `holes ${p.strokes.map((s) => (s == null ? '–' : s)).join(' ')}` : '',
    ].filter(Boolean);
    if (left.length || !hit) lines.push(`${p.name}${p.handicap != null ? ` (${hcpText(p.handicap)})` : ''}${left.length ? `: ${left.join(', ')}` : ''}${hit ? '' : ' — not in the group'}`);
  }
  return {
    trip_id: tripId, ...course, name: d.name || null, play_date: d.date || null, format: d.format || 'stableford',
    players: rows, summary: lines.length ? lines.join('\n').slice(0, 4000) : null,
  };
}

/** The import_history_notes row for a ticked cup, award, story or other. */
export function noteRow(it, tripId, players, aliases = {}) {
  const d = it.data;
  const n = noteFor(it.section, d);
  const names = itemNames(it.section, d);
  const ids = it.section === 'cups' && d.winner ? idsFor(d.sides.find((s) => s.name === d.winner)?.players || [], players, aliases) : idsFor(names, players, aliases);
  return {
    kind: n.kind, title: String(n.title).trim().slice(0, 120), body: n.body ? String(n.body).slice(0, 4000) : null, trip_id: tripId || null,
    year: d.year || yearOfDate(d.date) || null, happened_on: d.date || null, people: n.people ? String(n.people).slice(0, 300) : null,
    player_ids: ids.slice(0, 40),
    data: it.section === 'cups' ? { sides: d.sides, matches: d.matches, winner: d.winner } : it.section === 'awards' ? { hole: d.hole ?? null, course: d.course ?? null } : {},
  };
}

/** The honour board row for a cup's winning side (needs the Trophy Room), or null. */
export function cupHonour(it, trip, players, aliases = {}) {
  const d = it.data;
  if (!d.winner) return null;
  const year = d.year || yearOfDate(trip?.start_date);
  if (!year) return null;
  const side = d.sides.find((s) => s.name === d.winner);
  const names = side?.players?.length ? `${side.name} — ${side.players.join(' & ')}` : d.winner;
  return {
    label: honourLabel({ year, trip: trip?.name || d.trip }, trip?.name || d.trip), trophy: String(it.trophyChoice || d.name).trim().slice(0, 60),
    winners: names.slice(0, 200), player_ids: idsFor(side?.players || [], players, aliases), trip_id: trip?.id || null,
  };
}

// ------------------------------------------------------------------ The confirm screen's items

/** One line for an item. */
export function historyLine(it) {
  const d = it.data;
  const when = d.date || d.year || '';
  if (it.section === 'rounds') {
    const hbh = d.players.some((p) => p.strokes?.some((s) => s != null));
    return [d.course, d.name, when, `${plural(d.players.length, 'player')}${hbh ? ', hole by hole' : ''}`].filter(Boolean).join(' · ');
  }
  if (it.section === 'cups') {
    const [a, b] = d.sides;
    return `${d.name}${d.year ? ` ${d.year}` : ''} — ${a.name}${a.points != null ? ` ${half(a.points)}` : ''} v ${b.name}${b.points != null ? ` ${half(b.points)}` : ''}${d.winner ? ` (${d.winner} won)` : ''}`;
  }
  if (it.section === 'awards') return `${KIND_WORDS[d.kind] || 'Award'}: ${d.title}${d.winners ? ` — ${d.winners}` : ''}${d.hole ? ` (hole ${d.hole})` : ''}${when ? ` · ${when}` : ''}`;
  if (it.section === 'stories') return `${d.title}${when ? ` · ${when}` : ''}`;
  return `${d.title}${when ? ` · ${when}` : ''}`;
}

/** A new item's match words, tick and "already in", from its trip choice and what's in the group.
 *  group = { trips, rounds, courses, notes: [{ import_key }], honour_board, trophiesOn }, ctx as chooseTrip. */
export function historyItem(it, group = {}, ctx = {}) {
  const d = it.data;
  const choice = it.tripChoice;
  const existingTrip = choice && choice !== 'new' && !choice.startsWith('p:') ? choice : null;
  let already = false;
  let detail = '';
  if (it.section === 'rounds') {
    const course = findCourse(d.course, group.courses || []);
    if (existingTrip) {
      const k = roundKey(existingTrip, d.course, d.date, d.name);
      already = (group.rounds || []).some((r) => r.import_key === k
        || (r.trip_id === existingTrip && course && r.course_id === course.id && (r.play_date || '') === (d.date || '') && (!d.name || low(r.name) === low(d.name))));
    }
    const holes = d.players.some((p) => p.strokes?.some((s) => s != null));
    detail = course ? `course: ${course.name}` : cardHoles(d) ? 'new course from the card' : 'course from the library, or totals only';
    if (holes && !course && !cardHoles(d)) detail += ' (hole scores kept as a note if it’s not in the library)';
  } else {
    const n = noteFor(it.section, d);
    if (existingTrip || choice === '') already = (group.notes || []).some((x) => x.import_key === noteKey(n.kind, existingTrip, n.title, d.year || yearOfDate(d.date), n.body));
    if (it.section === 'cups') detail = d.winner && group.trophiesOn ? `${d.winner} goes on the honour board` : 'kept as the trip’s cup story';
  }
  const match = [`→ ${tripWords(it, ctx)}`, detail].filter(Boolean).join(' · ');
  // The tick: off when it's already in; the organiser's own tick kept once they've touched it (unless it was
  // "already in" a moment ago — moved to another trip, it's new again); else on, except a guess.
  const ticked = already ? false : it.touched && !it.already ? it.ticked : !it.guess;
  // A round can't go on a trip that's on now or coming up (import_rounds refuses it): say so before "Add these".
  const t = existingTrip ? (ctx.trips || group.trips || []).find((x) => x.id === existingTrip) : null;
  const today = ctx.today || localToday();
  const current = it.section === 'rounds' && !!t && t.status !== 'locked' && String(t.end_date || t.start_date || today) >= today;
  return { ...it, match, detail, already, ticked, existingTrip, current };
}

/** The new kinds' items for buildReview. `proposed` = the review's trip items (so a round can go on a trip from the
 *  same import). */
export function buildHistoryItems(p, group = {}, proposed = [], preset = null) {
  const ctx = { trips: group.trips || [], proposed, preset };
  const out = [];
  for (const section of HISTORY_KEYS) {
    (p[section] || []).forEach((x, i) => {
      const data = { ...x };
      delete data.guess;
      const it = { id: `${section.slice(0, 2)}${i}`, section, data, guess: !!x.guess };
      it.tripChoice = chooseTrip(section, data, ctx);
      if (section === 'cups') {
        const names = [...new Set([...(group.trophies || []).map((t) => t.name), ...(group.honour_board || []).map((h) => h.trophy_name)])];
        it.trophyChoice = matchTrophy(data.name, names) || '';
      }
      out.push(historyItem(it, group, ctx));
    });
  }
  return out;
}

/** The organiser picked a trip for an item. */
export function chooseItemTrip(it, choice, group, ctx) {
  return historyItem({ ...it, tripChoice: choice, touched: true, ticked: it.ticked }, group, ctx);
}

/** Is an edited new item still good to save? ('' when fine.) */
export function historyProblem(it, nextYear = new Date().getFullYear() + 1) {
  const d = it.data;
  const y = d.year;
  const badYear = y != null && y !== '' && !(Number.isInteger(Number(y)) && Number(y) >= 1950 && Number(y) <= nextYear);
  if (badYear) return 'Year 1950 or later';
  if (NEEDS_TRIP.has(it.section) && !it.tripChoice) return 'Pick a trip';
  if (it.current) return 'That trip is on now or coming up — pick a past one';
  if (it.section === 'rounds') return String(d.course || '').trim().length < 2 ? 'Needs the course' : !d.players?.length ? 'No players' : '';
  if (it.section === 'cups') return String(d.name || '').trim().length < 2 ? 'Needs a name' : '';
  if (it.section === 'stories') return String(d.body || '').trim().length < 2 ? 'Needs the story' : String(d.title || '').trim().length < 2 ? 'Needs a title' : '';
  if (it.section === 'other') return String(d.text || '').trim().length < 2 ? 'Needs the text' : String(d.title || '').trim().length < 2 ? 'Needs a title' : '';
  return String(d.title || '').trim().length < 2 ? 'Needs a title' : '';
}

/** The new trips the ticked items need (choice 'new', or a proposed trip that wasn't ticked itself), one per name. */
export function tripsNeeded(items) {
  const out = [];
  for (const it of items) {
    if (!it.ticked || !HISTORY_KEYS.includes(it.section)) continue;
    if (it.tripChoice === 'new') {
      const name = newTripName(it.section, it.data);
      if (!out.some((t) => low(t.name) === low(name))) out.push({ name, year: it.data.year || yearOfDate(it.data.date) || null, date: it.data.date || null });
    }
  }
  return out;
}

/** "3 rounds, 1 cup, 6 awards & moments and 2 stories" for the done line. */
export function historyCounts(n) {
  return [
    n.rounds ? plural(n.rounds, 'round') : '', n.cups ? plural(n.cups, 'cup') : '',
    n.awards ? `${n.awards} award${n.awards === 1 ? '' : 's'} & moment${n.awards === 1 ? '' : 's'}` : '',
    n.stories ? plural(n.stories, 'story', 'stories') : '', n.other ? `${n.other} other` : '',
  ].filter(Boolean);
}
