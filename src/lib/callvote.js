// "Call the vote" (22 Oct, Josh): the organiser sees the full range of what's on the table, ticks what goes on the
// ballot, sets when it closes, and calls it. Then a clear "How it goes out" (app, email, a share link), and an
// organiser's results view of an open vote (tallies, leader, who's answered, Nudge). Pure functions, tested.
import { answerKind } from './emailvotes.js';

export const DEFAULT_CLOSE_DAYS = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The default closing date: `days` days from today (3). */
export function defaultCloses(today, days = DEFAULT_CLOSE_DAYS) {
  const d = parse(today);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** "Fri" within the week, else "Fri 31 Oct". */
export function closesWord(closes, today) {
  const c = parse(closes); const t = parse(today);
  if (!c) return '';
  const days = t ? Math.round((c - t) / 86400000) : 99;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days > 1 && days < 7 ? DOW[c.getDay()] : `${DOW[c.getDay()]} ${c.getDate()} ${MON[c.getMonth()]}`;
}

/** Every option key in the range, ticked (the starting point: everything on the table goes on the ballot). */
export function allTicked(range = []) {
  const out = {};
  for (const s of range) for (const o of s.options || []) out[o.key] = true;
  return out;
}

/**
 * Tick or untick one option. Unticking an area ("area:<name>") also unticks everything that belongs to it (its
 * places to stay, courses and accommodation ideas — options with area: <name>); ticking it back ticks them again.
 */
export function toggleTick(ticks, key, range = []) {
  const on = !ticks[key];
  const next = { ...ticks, [key]: on };
  const m = /^area:(.+)$/.exec(key);
  if (m) for (const s of range) for (const o of s.options || []) if (o.area === m[1]) next[o.key] = on;
  return next;
}

/**
 * The ballot from the range and the ticks: each section keeps only its ticked options; a section with none is left
 * off. A dates section needs 2+ to be worth a vote (one weekend left is just the weekend). → { sections, skipped, count }
 */
export function ballotFrom(range = [], ticks = {}) {
  const sections = [];
  const skipped = [];
  for (const s of range) {
    const options = (s.options || []).filter((o) => ticks[o.key]);
    if (!options.length) { skipped.push(s.question); continue; }
    if (s.kind === 'dates' && options.length < 2) { skipped.push(s.question); continue; }
    sections.push({ ...s, options });
  }
  return { sections, skipped, count: sections.reduce((n, s) => n + s.options.length, 0) };
}

/** Can the vote be called? → '' or what's missing. */
export function callProblem({ sections = [], keen = false, closes = null, today = null } = {}) {
  if (!sections.length && !keen) return 'Tick at least one thing for the ballot.';
  if (closes && today && closes < today) return 'The closing date has passed.';
  return '';
}

/** The rows the database needs: a poll per section, its options. (The screen inserts them in order.) */
export function pollRows(sections, { planId, batchId = null, closes = null }) {
  return sections.map((s) => ({
    // ov23 (092): the detail under an area is optional for voters. Only sent when it's set, so a ballot without any
    // detail still works on a database from before 092.
    poll: { plan_id: planId, kind: s.kind, question: String(s.question).slice(0, 200), closes_on: closes || null, ...(batchId ? { vote_batch: batchId } : {}),
      ...(s.optional ? { optional: true, area: String(s.area || '').slice(0, 80) || null } : {}) },
    options: s.options.map((o) => ({
      label: String(o.label || '').slice(0, 120), notes: o.notes ? String(o.notes).slice(0, 480) : null,
      start_date: o.start_date || null, end_date: o.end_date || null,
    })),
    keys: s.options.map((o) => o.key),
  }));
}

// ------------------------------------------------------------------ how it goes out

/**
 * Who hears about it, from vote_channels() rows: app = a notification, email = an email; none = neither (they only
 * see it if someone shares the link). → { app, email, none, appIds, emailIds, noneIds }
 */
export function reach(rows = []) {
  const appIds = []; const emailIds = []; const noneIds = [];
  for (const r of rows || []) {
    let push = false; let mail = false;
    if (!r.on_app) mail = !!r.has_email;
    else {
      const c = ['app', 'email', 'both'].includes(r.choice) ? r.choice : 'app';
      mail = !!r.has_email && c !== 'app';
      push = c !== 'email' || !r.has_email;
    }
    if (push) appIds.push(r.player_id);
    if (mail) emailIds.push(r.player_id);
    if (!push && !mail) noneIds.push(r.player_id);
  }
  return { app: appIds.length, email: emailIds.length, none: noneIds.length, appIds, emailIds, noneIds };
}

/** The in-app path to the vote. */
export const votePath = (planId) => `/plan/${planId}?tab=vote`;

/**
 * The link to share in the group chat. With the group's join code it goes through the invite first (so someone not
 * in the group yet joins, then lands on the vote); someone already in goes straight to it.
 */
export function voteShareLink({ base, code = null, planId }) {
  if (!UUID.test(String(planId || ''))) return base;
  // The one link scheme (083): #/join/CODE?to=<page>. Old "?vote=<plan>" links still open (voteTarget below).
  const to = encodeURIComponent(votePath(planId));
  return code ? `${base}#/join/${code}?to=${to}` : `${base}#${votePath(planId)}`;
}

/** After joining (or signing in from an invite): where to go — '#/plan/<id>?tab=vote' or null. */
export function voteTarget(search = '') {
  const q = new URLSearchParams(String(search || '').replace(/^.*\?/, ''));
  const id = q.get('vote');
  return id && UUID.test(id) ? `#${votePath(id.toLowerCase())}` : null;
}

/** "🗳️ Where and when for the March trip? Vote by Fri: <link>" */
export function shareMessage({ title, planName, closes = null, today = null, link }) {
  const t = String(title || 'Have your say').replace(/[?.!]+$/, '');
  const by = closes ? ` Vote by ${closesWord(closes, today)}` : ' Have your say';
  return `🗳️ ${t} for ${planName || 'the trip'}?${by}: ${link}`;
}

// ------------------------------------------------------------------ the organiser's view of an open vote

/** "3 don't like it" / "2 would skip it" — when several are against an option (2+). */
export function againstLine(n, kind = 'place') {
  if (!n || n < 2) return '';
  if (kind === 'extra') return `${n} would skip it`;
  if (kind === 'dates') return `${n} can’t make it`;
  return `${n} don’t like it`;
}

/**
 * One section's results for the organiser: per option the tally (score = 2 × yes + maybe), the leader, and how many
 * are against; who's answered and who hasn't (of playerIds). poll: { id, kind, question }.
 * → { kind, rows: [{ option, yes, maybe, no, score, leading, against }], leader, answered, waiting }
 */
export function sectionResults(poll, options = [], votes = [], playerIds = []) {
  const kind = answerKind(poll);
  const mine = options.filter((o) => o.poll_id === poll.id);
  const vs = votes.filter((v) => v.poll_id === poll.id || mine.some((o) => o.id === v.option_id));
  const rows = mine.map((o) => {
    const ov = vs.filter((v) => v.option_id === o.id);
    const yes = ov.filter((v) => v.response === 'yes').length;
    const maybe = ov.filter((v) => v.response === 'maybe').length;
    const no = ov.filter((v) => v.response === 'no').length;
    return { option: o, yes, maybe, no, score: yes * 2 + maybe, against: againstLine(no, kind) };
  });
  const top = Math.max(0, ...rows.map((r) => r.score));
  rows.forEach((r) => { r.leading = top > 0 && r.score === top; });
  rows.sort((a, b) => b.score - a.score || a.no - b.no);
  const answered = playerIds.filter((pid) => vs.some((v) => v.player_id === pid));
  return { kind, rows, leader: rows.find((r) => r.leading) || null, answered, waiting: playerIds.filter((pid) => !answered.includes(pid)) };
}

/** Does this person get the organiser's view of a vote (results first)? The trip's organiser counts too. */
export function organiserView({ isAdmin = false, me = null, plan = null, asVoter = false } = {}) {
  if (asVoter) return false;
  return !!isAdmin || (!!me && !!plan && plan.organiser_id === me);
}

/** Has this person answered every section (and "are you keen?" if asked)? */
export function hasAnsweredAll({ polls = [], votes = [], me, keen = false, rsvps = [] }) {
  if (!me) return false;
  // The detail under an area (ov23) is optional: answering the areas and the weekends counts as answered.
  if (polls.filter((p) => !p.optional).some((p) => !votes.some((v) => v.poll_id === p.id && v.player_id === me))) return false;
  return !keen || rsvps.some((r) => r.player_id === me);
}

/** "Closes in 2 days" / "Closes today" / "Closed". */
export function timeLeft(closes, today) {
  const c = parse(closes); const t = parse(today);
  if (!c || !t) return 'No closing date';
  const n = Math.round((c - t) / 86400000);
  if (n < 0) return 'Past its closing date';
  if (n === 0) return 'Closes today';
  if (n === 1) return 'Closes tomorrow';
  return `Closes in ${n} days`;
}

// ------------------------------------------------------------------ the main questions and the detail (ov23)
// Josh: "the people voting can also just choose to vote area and weekends, or also go into the detail."

/** The area a detail question belongs to: its `area`, else the "Hunter Valley: which courses?" prefix. */
export function pollArea(p) {
  if (!p?.optional) return null;
  if (p.area) return p.area;
  const m = /^(.+?):\s/.exec(String(p.question || ''));
  return m ? m[1] : null;
}

/**
 * A ballot's questions split into the main ones (areas, weekends, extras…) and the optional detail, grouped by area
 * in the order the areas first appear. Works on polls or ballot sections ({ optional, area, question }).
 * → { main: [poll], areas: [{ area, polls: [poll] }] }
 */
export function groupBallot(polls = []) {
  const main = [];
  const areas = [];
  for (const p of polls || []) {
    const a = pollArea(p);
    if (!a) { main.push(p); continue; }
    let g = areas.find((x) => x.area === a);
    if (!g) { g = { area: a, polls: [] }; areas.push(g); }
    g.polls.push(p);
  }
  return { main, areas };
}

/** How many people went into the detail for each area (answered at least one of its optional questions). → { area: n } */
export function detailCounts(polls = [], votes = []) {
  const out = {};
  for (const { area, polls: ps } of groupBallot(polls).areas) {
    const ids = new Set(ps.map((p) => p.id));
    out[area] = new Set((votes || []).filter((v) => ids.has(v.poll_id)).map((v) => v.player_id)).size;
  }
  return out;
}

/** The question without its area prefix, for showing under the area's heading: "which courses?" → "Which courses?". */
export function detailQuestion(p) {
  const a = pollArea(p);
  const q = String(p?.question || '');
  if (!a || !q.startsWith(`${a}:`)) return q;
  const rest = q.slice(a.length + 1).trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
