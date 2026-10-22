// The organiser's panels on a laptop (Stage 11c, full desktop; folded into Trips → Organise on 22 Oct): a panel for
// each part of organising a trip. These pure functions work out what each panel says and its obvious next step, plus
// the table helpers (sort, filter), the costs CSV and where the old /desk addresses go now. Tested in desk.test.js;
// the panels are screens/OrganisePanels.jsx.
import { tallyPoll, nonVoters, kitty, countdown, fmtRange, todayISO, money } from './plan.js';
import { sortTrips, tripStage, canDecide } from './trips.js';

/** Which trip the desk opens on: the one on now (or next locked in), else the soonest being decided, else the latest. */
export function pickDeskPlan(plans = [], trips = [], today = todayISO()) {
  const s = sortTrips(plans.filter((p) => p.status !== 'cancelled'), trips, today);
  return s.now?.plan || s.ideas[0]?.plan || s.later[0]?.plan || s.past[0]?.plan || null;
}

/** The big line at the top: stage, dates and the countdown ("in 6 weeks", "on now", "done"). */
export function deskHeader(plan, trip, today = todayISO()) {
  const stage = tripStage(plan, trip, today);
  const when = plan.start_date ? fmtRange(plan.start_date, plan.end_date) : 'Dates to decide';
  let count = '';
  if (stage === 'on') count = 'On now';
  else if (stage === 'done') count = 'Done';
  else if (plan.start_date) count = countdown(plan.start_date, today);
  return { stage, when, count, where: plan.location_name || 'Place to decide' };
}

const act = (label, opts = {}) => ({ label, ...opts });

/**
 * What every panel says. pd: the plan's data (usePlanData); ctx: { playerIds, me, isAdmin, today, nameOf }.
 * Each panel: { ...facts, next: { label, tab?, kind? } | null } — next is the one obvious thing to do.
 */
export function deskPanels(pd, { playerIds = [], me = null, isAdmin = false, today = todayISO() } = {}) {
  const { plan } = pd;
  const rsvps = pd.rsvps || [];
  // Who's in
  const by = (s) => rsvps.filter((r) => r.status === s).map((r) => r.player_id);
  const replied = new Set(rsvps.map((r) => r.player_id));
  const noReply = playerIds.filter((id) => !replied.has(id));
  const inIds = by('in');
  const people = {
    in: inIds, maybe: by('maybe'), out: by('out'), noReply, locked: !!plan.rsvp_locked,
    next: noReply.length && !plan.rsvp_locked ? act(`Nudge ${noReply.length} who haven’t said`, { kind: 'nudge-rsvp' })
      : isAdmin && !plan.rsvp_locked && inIds.length ? act('Lock in who’s coming', { kind: 'lock' }) : null,
  };
  // Votes
  const open = (pd.polls || []).filter((p) => p.status === 'open').map((poll) => {
    const options = (pd.options || []).filter((o) => o.poll_id === poll.id);
    const votes = (pd.votes || []).filter((v) => v.poll_id === poll.id);
    const rows = tallyPoll(options, votes);
    return { poll, rows, leading: rows.find((r) => r.leading) || null, waiting: nonVoters(options, votes, playerIds) };
  });
  const decider = canDecide({ isAdmin, me, plan, voteDecider: pd.voteDecider || 'admin' });
  const votes = {
    open, decided: (pd.polls || []).filter((p) => p.status === 'closed').length, canDecide: decider,
    next: open.length && decider && open[0].rows.length ? act('Close the vote & pick the winner', { kind: 'close-vote' })
      : open.length && open[0].waiting.length ? act(`Nudge ${open[0].waiting.length} to vote`, { kind: 'nudge-votes' })
        : !open.length && isAdmin && (!plan.start_date || !plan.location_name) ? act('Put up a vote', { tab: 'vote' }) : null,
  };
  // Jobs
  const jobs = (pd.items || []).filter((i) => i.kind === 'job');
  const openJobs = jobs.filter((j) => !j.done);
  const unowned = openJobs.filter((j) => !j.owner_id);
  const jobsPanel = {
    open: openJobs, done: jobs.length - openJobs.length, unowned,
    next: unowned.length ? act(`Give ${unowned.length} job${unowned.length === 1 ? '' : 's'} an owner`, { tab: 'jobs' }) : act('Add a job', { kind: 'add-job' }),
  };
  // Costs
  const k = kitty(pd.costs || [], pd.payments || [], inIds, pd.transfers || []);
  const owing = k.people.filter((p) => p.balance > 0.5);
  const costs = {
    count: (pd.costs || []).length, total: k.total, toCollect: k.toCollect, settle: k.settle, owing, kittyHeld: k.kitty, people: k.people,
    next: !(pd.costs || []).length ? act('Add the first cost', { kind: 'add-cost' })
      : owing.length ? act(`Chase ${owing.length} who owe${owing.length === 1 ? 's' : ''}`, { kind: 'nudge-kitty' }) : act('Add a cost', { kind: 'add-cost' }),
  };
  // Rooms & cars
  const rooms = {};
  for (const kind of ['room', 'car']) {
    const groups = (pd.groups || []).filter((g) => g.kind === kind);
    const ids = new Set(groups.map((g) => g.id));
    const placed = new Set((pd.members || []).filter((m) => ids.has(m.group_id)).map((m) => m.player_id));
    rooms[kind] = {
      count: groups.length, spaces: groups.reduce((s, g) => s + (Number(g.capacity) || 0), 0),
      placed: placed.size, unplaced: inIds.filter((id) => !placed.has(id)),
    };
  }
  const roomWord = plan.kind === 'round' ? 'car' : 'room';
  rooms.next = !rooms[roomWord].count ? act(`Add the ${roomWord}s`, { tab: 'groups' })
    : rooms[roomWord].unplaced.length ? act(`Place ${rooms[roomWord].unplaced.length} more`, { tab: 'groups' }) : null;
  return { people, votes, jobs: jobsPanel, costs, rooms, today };
}

// ------------------------------------------------------------------ Tables

const blank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Sort rows by a key (or a function), numbers as numbers, blanks always last. dir: 'asc' | 'desc'. */
export function sortRows(rows, key, dir = 'asc') {
  const get = typeof key === 'function' ? key : (r) => r[key];
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].map((r, i) => ({ r, i, v: get(r) })).sort((a, b) => {
    if (blank(a.v) && blank(b.v)) return a.i - b.i;
    if (blank(a.v)) return 1;
    if (blank(b.v)) return -1;
    const na = Number(a.v);
    const nb = Number(b.v);
    const c = typeof a.v === 'number' || (!Number.isNaN(na) && !Number.isNaN(nb) && String(a.v).trim() !== '' && String(b.v).trim() !== '')
      ? na - nb : String(a.v).localeCompare(String(b.v), 'en', { sensitivity: 'base' });
    return c * sign || a.i - b.i;
  }).map((x) => x.r);
}

/** Click a heading: same column flips the direction, a new one starts ascending. */
export function nextSort(cur, key) {
  return cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

/** Keep rows where every word typed appears in one of the fields (any case). */
export function filterRows(rows, query, fields) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = fields.map((f) => (typeof f === 'function' ? f(r) : r[f])).filter((x) => x != null).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ------------------------------------------------------------------ CSV

/** One CSV cell: quoted when it has a comma, quote or new line; formulas made safe for spreadsheets. */
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

const two = (x) => (Math.round(Number(x || 0) * 100) / 100).toFixed(2);

/**
 * The trip's costs as a spreadsheet: one line per cost, then everyone's balance and who pays whom.
 * nameOf(id) → a name ('kitty' → 'The kitty').
 */
export function costsCsv({ plan, costs = [], payments = [], transfers = [], inIds = [], nameOf = (id) => id }) {
  const k = kitty(costs, payments, inIds, transfers);
  const who = (id) => (id === 'kitty' ? 'The kitty' : nameOf(id));
  const groupOf = (c) => (c.split_between && c.split_between.length ? c.split_between : inIds);
  const rows = [[`${plan?.name || 'Trip'} — costs`], ['What', 'Amount', 'Per head or total', 'Paid by', 'Split between', 'People', 'Each', 'Total', 'Note']];
  for (const c of costs) {
    const n = groupOf(c).length || 1;
    const total = c.per_head ? Number(c.amount) * n : Number(c.amount);
    rows.push([c.title, two(c.amount), c.per_head ? 'Per head' : 'Total', c.paid_by ? who(c.paid_by) : 'The kitty / not paid yet',
      c.split_between && c.split_between.length ? c.split_between.map(who).join('; ') : 'Everyone in', n,
      two(c.per_head ? c.amount : total / n), two(total), c.note || '']);
  }
  rows.push([], ['Total', two(k.total)], [], ['Person', 'Share', 'Paid for the group', 'Paid in', 'Balance (+ owes, − is owed)']);
  for (const p of k.people) rows.push([who(p.player_id), two(p.share), two(p.fronted), two(p.paid + p.sent - p.received), two(p.balance)]);
  if (k.settle.length) {
    rows.push([], ['Who pays whom'], ['From', 'To', 'Amount']);
    for (const s of k.settle) rows.push([who(s.from), who(s.to), two(s.amount)]);
  }
  return toCsv(rows);
}

/** A safe file name from a trip name: "Hunter Weekend 2026" → "hunter-weekend-2026-costs.csv". */
export function csvName(name, what = 'costs') {
  const slug = String(name || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
  return `${slug}-${what}.csv`;
}

// ------------------------------------------------------------------ Where the desk tools live now (22 Oct)
// Josh: "Why is there still a Trip desk if there is Trips?" The Trip desk folded into the places things belong:
// the trip panels are the laptop layout of Trips → a trip → Organise; the players table is in Group & invites; the
// scorecard paste is on Courses; paper cards, Present and Print are on each round. Old /desk links still work.

export const TOOL = {
  organise: (planId) => `/plan/${planId}?view=organise`,
  players: '/group/players',
  coursePaste: '/courses/paste',
  cards: '/cards',
  card: (roundId) => `/round/${roundId}/cards`,
  present: (roundId) => (roundId ? `/round/${roundId}/present` : '/present'),
  print: (roundId) => `/round/${roundId}/print`,
};

/**
 * An old /desk… address → its new home. Returns null for /desk itself (and anything not recognised): that one
 * opens the Organise view of the trip that matters now (pickDeskPlan), or Trips if there isn't one.
 */
export function deskForward(pathname = '') {
  const seg = String(pathname).split(/[?#]/)[0].split('/').filter(Boolean);
  if (seg[0] !== 'desk') return null;
  const [, what, id] = seg;
  if (what === 'trip' && id) return TOOL.organise(id);
  if (what === 'players') return TOOL.players;
  if (what === 'courses') return TOOL.coursePaste;
  if (what === 'cards') return TOOL.cards;
  if (what === 'card' && id) return TOOL.card(id);
  if (what === 'present') return TOOL.present(id);
  if (what === 'print' && id) return TOOL.print(id);
  return null;
}

/** Where a tool's back bar goes (screens/DeskNav.jsx), from its address. */
export function toolHome(pathname = '') {
  if (pathname.startsWith('/group/')) return { to: '/group', label: 'Players & group' };
  if (pathname.startsWith('/courses/')) return { to: '/courses', label: 'Courses' };
  const m = pathname.match(/^\/round\/([^/]+)\//);
  if (m) return { to: `/?r=${m[1]}`, label: 'Leaderboard' };
  return { to: '/', label: 'Leaderboard' };
}

export { money };
