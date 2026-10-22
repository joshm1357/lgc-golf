// Trip jobs and the "Next step" card — pure functions (no database, no React) so they can be tested.
//
// Plain words:
//   - The job formula: when a trip is locked in, the app writes the usual jobs with due dates counted back from the
//     first day of the trip. Some jobs wait for another one ("after: Reserve accommodation") — they show greyed out
//     until that one is done. Running the formula twice adds nothing (each job remembers which formula line made it).
//   - Each job moves To do → Asked / waiting → Done ✓. `done` is kept in step for older app versions.
//   - nextStep(): the single most important next thing on a trip, who it's on, and one button.

import { daysUntil, fmtRange, todayISO, parseDate, money } from './plan.js';
import { closesLabel } from './trips.js';
import { depositStatus } from './tripbudget.js';

export const JOB_STAGES = ['todo', 'asked', 'done'];
export const JOB_STAGE_LABEL = { todo: 'To do', asked: 'Asked / waiting', done: 'Done ✓' };

/**
 * The formula. daysOut = due this many days before the trip starts. after = waits for that job.
 *   auto: the app does most of it (the organiser sets the deposit, the app asks everyone).
 *   dueAfterAsk: due this many days after the deposit was asked for (unknown until then).
 *   onlyIfNoCalls: skipped when the trip builder has already made "Call the course" jobs.
 */
export const FORMULA = [
  { key: 'shortlist_stay', title: 'Shortlist accommodation', daysOut: 56, owner: 'organiser',
    body: 'Find 2–3 places that sleep everyone (the search links are filled in), then put them to the group.' },
  { key: 'reserve_stay', title: 'Reserve accommodation', daysOut: 49, after: 'shortlist_stay', owner: 'organiser',
    body: 'Book the winner and enter the total cost. Then everyone is asked to confirm and pay the deposit.' },
  { key: 'deposit_ask', title: 'Ask everyone to confirm and pay the deposit', daysOut: 48, after: 'reserve_stay', owner: 'organiser', auto: true,
    body: 'Set the deposit on the trip plan and tap “Ask everyone”. The app shows them your payment details.' },
  { key: 'chase_deposits', title: 'Chase deposits', after: 'deposit_ask', dueAfterAsk: 7, owner: 'organiser',
    body: 'Nudge anyone who hasn’t paid, and tick off payments as they land.' },
  { key: 'book_tees', title: 'Book tee times', daysOut: 42, onlyIfNoCalls: true, owner: null,
    body: 'Ring the courses with the numbers and the times you want.' },
  { key: 'pay_balance', title: 'Pay the balance / final numbers', daysOut: 14, after: 'reserve_stay', owner: 'organiser',
    body: 'Final numbers to the accommodation and the courses, and pay what’s left.' },
  { key: 'transport', title: 'Transport / who’s driving', daysOut: 14, owner: null,
    body: 'Work out the drivers and who goes with who (Rooms & cars).' },
  { key: 'teams_draw', title: 'Teams, draw and side comps', daysOut: 1, owner: 'organiser',
    body: 'Set the teams, run the draw and pick the side comps for each round.' },
];
export const FORMULA_BY_KEY = Object.fromEntries(FORMULA.map((f) => [f.key, f]));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** "2027-03-12" plus n days → ISO date. */
export function addDays(date, n) {
  const d = parseDate(date);
  if (!d) return null;
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

const jobsOf = (items) => (items || []).filter((i) => i.kind === 'job');

/** The trip builder's "Call the course" jobs (linked from its tee-time options, or named like one). */
export function callJobs(items, callJobIds = []) {
  const ids = new Set(callJobIds);
  return jobsOf(items).filter((j) => !j.formula_key && (ids.has(j.id) || /(^|\s|📞)call\b|tee[ -]?time/i.test(j.title || '')));
}

/** When a formula job is due: counted back from the start, never before today and never after the start. */
export function dueFor(f, plan, today = todayISO()) {
  if (!plan?.start_date) return null;
  if (f.dueAfterAsk != null) {
    return plan.deposit_asked_at ? addDays(String(plan.deposit_asked_at).slice(0, 10), f.dueAfterAsk) : null;
  }
  const d = addDays(plan.start_date, -f.daysOut);
  if (d < today) return today < plan.start_date ? today : plan.start_date;
  return d;
}

/**
 * The jobs to add for a trip. Pure: returns rows to insert (with ids from `uuid()` so "after" links can point at
 * jobs made in the same go). Nothing if the trip has no dates yet (the accommodation jobs need them).
 *   items: the trip's plan_items; organiserId: who gets the organiser's jobs.
 */
export function buildJobs(plan, items, { today = todayISO(), organiserId = null, uuid = () => crypto.randomUUID(), callJobIds = [] } = {}) {
  if (!plan?.start_date || plan.kind === 'round') return [];
  const have = new Map(jobsOf(items).filter((j) => j.formula_key).map((j) => [j.formula_key, j]));
  const calls = callJobs(items, callJobIds).length > 0;
  const out = [];
  FORMULA.forEach((f, i) => {
    if (have.has(f.key)) return;
    if (f.onlyIfNoCalls && calls) return;
    const after = f.after ? have.get(f.after) : null;
    const row = {
      id: uuid(), plan_id: plan.id, kind: 'job', title: f.title, body: f.body, formula_key: f.key,
      owner_id: f.owner === 'organiser' ? organiserId : null, due: dueFor(f, plan, today),
      after_item: after ? after.id : null, stage: 'todo', done: false, sort: 100 + i,
    };
    have.set(f.key, row);
    out.push(row);
  });
  return out;
}

/** A job's stage, for old rows that only have `done`. */
export function jobStage(j) {
  if (j.stage && JOB_STAGES.includes(j.stage)) return j.done && j.stage !== 'done' ? 'done' : j.stage;
  return j.done ? 'done' : 'todo';
}

/** The job this one is waiting for (not done yet), or null if it's free to start. */
export function blockedBy(job, items) {
  if (!job.after_item) return null;
  const before = (items || []).find((i) => i.id === job.after_item);
  if (!before || jobStage(before) === 'done') return null;
  return before;
}

/** Jobs in the order they should be done: open first, unlocked before locked, then by due date. */
export function sortJobs(items) {
  const rank = (j) => (jobStage(j) === 'done' ? 2 : blockedBy(j, items) ? 1 : 0);
  return [...jobsOf(items)].sort((a, b) => rank(a) - rank(b)
    || String(a.due || '9999').localeCompare(String(b.due || '9999'))
    || (a.sort ?? 0) - (b.sort ?? 0));
}

/** The update for moving a job to a stage (keeps `done` in step for older app versions). */
export function stagePatch(stage) {
  return { stage, done: stage === 'done' };
}

/** People to offer first when allocating: in, then keen (maybe), then everyone else. */
export function allocateOrder(players, rsvps) {
  const rank = (id) => {
    const s = (rsvps || []).find((r) => r.player_id === id)?.status;
    return s === 'in' ? 0 : s === 'maybe' ? 1 : s === 'out' ? 3 : 2;
  };
  return [...players].sort((a, b) => rank(a.id) - rank(b.id));
}

// ---------------------------------------------------------------- Votes, one combined vote at a time

/**
 * Open votes, batched: polls on the same vote card (plan_polls.vote_batch → vote_batches, the trip builder's combined
 * votes, migration 077) count as one vote. `cards` is the vote_batches rows (for their titles); none on older databases.
 * Returns [{ key, label, polls, closes_on, waiting: [player ids who haven't answered everything] }], soonest first.
 */
export function voteBatches(polls, options, votes, playerIds, cards = []) {
  const open = (polls || []).filter((p) => p.status === 'open');
  const by = new Map();
  for (const p of open) {
    const k = p.vote_batch || p.id;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p);
  }
  const out = [...by.entries()].map(([key, ps]) => {
    const ids = new Set(ps.map((p) => p.id));
    const opts = (options || []).filter((o) => ids.has(o.poll_id));
    const optIds = new Set(opts.map((o) => o.id));
    const waiting = opts.length ? playerIds.filter((pid) => {
      const answered = new Set((votes || []).filter((v) => v.player_id === pid && optIds.has(v.option_id)).map((v) => v.option_id));
      return answered.size < optIds.size;
    }) : [];
    const card = ps[0].vote_batch ? (cards || []).find((c) => c.id === ps[0].vote_batch) : null;
    const closes = [card?.closes_on, ...ps.map((p) => p.closes_on)].filter(Boolean).sort()[0] || null;
    const label = card?.title || (ps.length > 1 ? 'The vote' : ps[0].question);
    return { key, label, polls: ps, closes_on: closes, waiting };
  });
  return out.sort((a, b) => String(a.closes_on || '9999').localeCompare(String(b.closes_on || '9999')));
}

// ---------------------------------------------------------------- Where the trip is up to

/**
 * The finer stage for the Next step card:
 *   idea → deciding → locked (no to-do list yet) → booking (jobs under way) → paying (deposits being collected) → on → done.
 * `stage` is tripStage() from trips.js.
 */
export function planPhase({ plan, stage, items = [], rsvps = [], transfers = [] }) {
  if (['idea', 'deciding', 'on', 'done', 'cancelled'].includes(stage)) return stage;
  if (!jobsOf(items).some((j) => j.formula_key)) return 'locked';
  if (plan.deposit_asked_at && Number(plan.deposit_pp) > 0) {
    const d = depositStatus({ deposit: plan.deposit_pp, rsvps, transfers });
    if (d.people.some((p) => p.state !== 'paid')) return 'paying';
  }
  return 'booking';
}

const nameOf = (names, id) => (id && names?.[id]) || 'someone';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one "Next step" for this person on this trip.
 * ctx: { plan, stage, items, polls, options, votes, rsvps, transfers, playerIds, me, isOrganiser, today, names,
 *        builder: { weekends, teeOptions, cards, callJobIds } (from the trip builder's tables when they exist; empty if not) }
 * Returns { key, icon, title, detail, who, label, action } or null.
 *   action: { type: 'tab', tab } | { type: 'allocate', id } | { type: 'job', id } | { type: 'make_jobs' } | { type: 'lock' }
 *         | { type: 'builder' } | { type: 'pay' } | { type: 'deposits' } | { type: 'trip_plan' } | { type: 'go', to }
 */
export function nextStep(ctx) {
  const {
    plan, stage, items = [], polls = [], options = [], votes = [], rsvps = [], transfers = [], playerIds = [],
    me = null, isOrganiser = false, today = todayISO(), names = {}, builder = {},
  } = ctx;
  if (!plan || stage === 'cancelled') return null;
  const phase = planPhase({ plan, stage, items, rsvps, transfers });
  const jobs = sortJobs(items);
  const open = jobs.filter((j) => jobStage(j) !== 'done' && !blockedBy(j, items));
  const myRsvp = rsvps.find((r) => r.player_id === me)?.status;
  const step = (s) => ({ phase, who: null, detail: '', ...s });

  if (phase === 'done') return step({ key: 'done', icon: '🏁', title: 'That’s a wrap', detail: 'Plan the next one while it’s fresh.', label: 'Plan the next trip', action: { type: 'go', to: '/plan' } });
  if (phase === 'on') {
    const draw = jobs.find((j) => j.formula_key === 'teams_draw' && jobStage(j) !== 'done');
    if (draw && isOrganiser) return step({ key: 'on-draw', icon: '🎲', title: 'Teams, draw and side comps', detail: 'Sort them before the first tee time.', who: draw.owner_id, label: 'Open the job', action: { type: 'job', id: draw.id } });
    return step({ key: 'on', icon: '⛳', title: 'It’s on!', detail: 'Scores and the leaderboard are on the home screen.', label: 'Open the leaderboard', action: { type: 'go', to: '/' } });
  }

  // The vote (one combined vote at a time).
  const batch = voteBatches(polls, options, votes, playerIds, builder.cards)[0];
  const voteStep = () => {
    if (!batch) return null;
    const closes = batch.closes_on ? closesLabel(batch.closes_on, today) : 'open';
    const n = batch.waiting.length;
    if (me && batch.waiting.includes(me)) {
      return step({ key: `vote-me:${batch.key}`, icon: '🗳️', title: `Have your say: ${batch.label}`, detail: `Vote ${closes}.`, label: 'Vote now', action: { type: 'tab', tab: 'vote' } });
    }
    return step({ key: `vote:${batch.key}`, icon: '🗳️', title: `${batch.label} vote ${closes}`, detail: n ? `${n} haven’t answered.` : 'Everyone’s had their say.',
      who: null, label: isOrganiser && !n ? 'Pick the winner' : 'See the vote', action: { type: 'tab', tab: 'vote' } });
  };

  if (phase === 'idea') {
    if (isOrganiser) return step({ key: 'idea', icon: '💡', title: 'Approve or pass on this idea', detail: `${nameOf(names, plan.created_by)} suggested it.`, label: 'Decide', action: { type: 'tab', tab: 'people' } });
    const v = voteStep();
    if (v) return v;
    if (!myRsvp) return step({ key: 'keen', icon: '🙋', title: 'Would you be in?', detail: 'Say In, Maybe or Out.', label: 'Answer', action: { type: 'tab', tab: 'people' } });
    return step({ key: 'idea-wait', icon: '💡', title: 'Waiting on the organiser', detail: 'They’ll approve it or pass.', label: 'See who’s keen', action: { type: 'tab', tab: 'people' } });
  }

  if (phase === 'deciding') {
    const v = voteStep();
    if (v) return v;
    if (!isOrganiser && !myRsvp) return step({ key: 'keen', icon: '🙋', title: 'Are you keen?', detail: 'Say In, Maybe or Out so the organiser knows numbers.', label: 'Answer', action: { type: 'tab', tab: 'people' } });
    const calls = callJobs(items, builder.callJobIds).filter((j) => jobStage(j) !== 'done');
    if (!plan.start_date && !(builder.weekends > 0) && !calls.length) {
      return isOrganiser
        ? step({ key: 'weekends', icon: '📅', title: 'Pick 1–3 weekends', detail: 'Courses can’t give you times until you know the dates.', label: 'Build the trip', action: { type: 'builder' } })
        : step({ key: 'weekends-wait', icon: '📅', title: 'The organiser is picking weekends', detail: 'You’ll get a vote soon.', label: 'Chat about it', action: { type: 'tab', tab: 'chat' } });
    }
    const unowned = calls.find((j) => !j.owner_id);
    if (unowned && isOrganiser) return step({ key: `allocate:${unowned.id}`, icon: '📞', title: `Allocate: ${unowned.title}`, detail: unowned.due ? `Due ${fmtRange(unowned.due)}.` : 'Hand it to someone to ring for times.', label: 'Allocate', action: { type: 'allocate', id: unowned.id } });
    const mine = calls.find((j) => j.owner_id === me);
    if (mine) return step({ key: `job:${mine.id}`, icon: '📞', title: mine.title, detail: 'Your job — enter the times they can give you.', who: me, label: 'Open the job', action: { type: 'job', id: mine.id } });
    if (calls.length) {
      const first = calls[0];
      return step({ key: 'calls-wait', icon: '📞', title: `Waiting on ${plural(calls.length, 'call')} for tee times`, detail: `${nameOf(names, first.owner_id)} is on ${first.title.replace(/^📞\s*/, '')}.`, who: first.owner_id, label: 'See jobs', action: { type: 'tab', tab: 'jobs' } });
    }
    if (builder.teeOptions > 0 && isOrganiser) return step({ key: 'configs', icon: '🧩', title: 'Pick a trip or put it to a vote', detail: 'The tee times are in — choose the combination that works.', label: 'See the options', action: { type: 'builder' } });
    if (plan.start_date && isOrganiser) return step({ key: 'lock', icon: '🔒', title: 'Lock it in', detail: `${fmtRange(plan.start_date, plan.end_date)}${plan.location_name ? ` · ${plan.location_name}` : ''}. Then the to-do list is made.`, label: 'Lock it in', action: { type: 'lock' } });
    if (isOrganiser) return step({ key: 'weekends', icon: '📅', title: 'Pick 1–3 weekends', detail: 'Then put them to the group.', label: 'Build the trip', action: { type: 'builder' } });
    return step({ key: 'deciding-wait', icon: '🗳️', title: 'Still being decided', detail: 'The organiser will put up a vote.', label: 'Chat about it', action: { type: 'tab', tab: 'chat' } });
  }

  // Locked in, booking, paying.
  const keen = myRsvp === 'in' || myRsvp === 'maybe';
  const deposit = Number(plan.deposit_pp) || 0;
  const dep = deposit > 0 && plan.deposit_asked_at ? depositStatus({ deposit, rsvps, transfers }) : null;
  const mineDep = dep?.people.find((p) => p.player_id === me);
  if (dep && keen && mineDep && mineDep.state === 'unpaid') {
    return step({ key: 'pay', icon: '💳', title: `Confirm you’re in and pay your ${money(deposit)} deposit`, detail: myRsvp === 'in' ? 'Pay the organiser, then tap “I’ve paid”.' : 'Accommodation is booked — lock in your spot.', who: me, label: 'Confirm and pay', action: { type: 'pay' } });
  }
  if (!isOrganiser) {
    const myJob = open.find((j) => j.owner_id === me);
    if (myJob) return step({ key: `job:${myJob.id}`, icon: '📋', title: `Your job: ${myJob.title}`, detail: myJob.due ? `Due ${fmtRange(myJob.due)}.` : '', who: me, label: 'Open the job', action: { type: 'job', id: myJob.id } });
    const v = voteStep();
    if (v) return v;
    if (mineDep?.state === 'pending') return step({ key: 'pay-wait', icon: '⏳', title: 'Deposit sent', detail: 'Waiting for the organiser to tick it off.', label: 'See the kitty', action: { type: 'tab', tab: 'kitty' } });
    const days = daysUntil(plan.start_date, today);
    return step({ key: 'wait', icon: '🔒', title: days != null && days > 0 ? `${plural(days, 'day')} to go` : 'Locked in', detail: open[0] ? `Next up: ${open[0].title}${open[0].owner_id ? ` (${nameOf(names, open[0].owner_id)})` : ''}.` : 'All sorted.', label: 'See the details', action: { type: 'tab', tab: 'details' } });
  }

  if (phase === 'locked') return step({ key: 'make_jobs', icon: '📋', title: 'Make the to-do list', detail: 'The usual jobs with due dates counted back from the trip — accommodation, deposits, transport, the draw.', label: 'Make it', action: { type: 'make_jobs' } });
  const v = voteStep();
  if (v) return v;
  if (dep && dep.pending.length) return step({ key: 'confirm-deposits', icon: '✅', title: `Tick off ${plural(dep.pending.length, 'deposit')}`, detail: 'They say they’ve paid — check it landed.', label: 'Check deposits', action: { type: 'deposits' } });
  const overdue = open.find((j) => j.due && j.due < today);
  const first = overdue || open[0];
  const toCollect = dep ? dep.people.filter((p) => p.state === 'unpaid').length : 0;
  const jobStep = (j) => {
    if (j.formula_key === 'deposit_ask') return step({ key: 'deposit_ask', icon: '💰', title: 'Set the deposit and ask everyone', detail: 'The trip plan works out a fair deposit from the costs.', label: 'Open the trip plan', action: { type: 'trip_plan' } });
    if (!j.owner_id) return step({ key: `allocate:${j.id}`, icon: '👉', title: `Allocate: ${j.title}`, detail: j.due ? `Due ${fmtRange(j.due)}${j.due < today ? ' — overdue' : ''}.` : 'Hand it to someone.', label: 'Allocate', action: { type: 'allocate', id: j.id } });
    if (j.owner_id === me) {
      if (j.formula_key === 'shortlist_stay' || j.formula_key === 'reserve_stay') {
        return step({ key: `job:${j.id}`, icon: '🏠', title: j.title, detail: j.due ? `Due ${fmtRange(j.due)}${j.due < today ? ' — overdue' : ''}.` : '', who: me, label: j.formula_key === 'shortlist_stay' ? 'Find places' : 'Reserve it', action: { type: 'tab', tab: 'stay' } });
      }
      return step({ key: `job:${j.id}`, icon: '📋', title: j.title, detail: j.due ? `Due ${fmtRange(j.due)}${j.due < today ? ' — overdue' : ''}.` : '', who: me, label: 'Open the job', action: { type: 'job', id: j.id } });
    }
    return step({ key: `wait:${j.id}`, icon: '⏳', title: j.title, detail: `${nameOf(names, j.owner_id)} is on it${jobStage(j) === 'asked' ? ' — asked, waiting to hear back' : ''}.`, who: j.owner_id, label: 'See jobs', action: { type: 'tab', tab: 'jobs' } });
  };
  if (overdue) return jobStep(overdue);
  if (toCollect) return step({ key: 'collect', icon: '💰', title: `${plural(toCollect, 'deposit')} to collect`, detail: `${money(deposit)} each.`, label: 'See who’s paid', action: { type: 'deposits' } });
  if (first) return jobStep(first);
  const days = daysUntil(plan.start_date, today);
  return step({ key: 'sorted', icon: '✅', title: 'All sorted', detail: days != null && days > 0 ? `${plural(days, 'day')} to go.` : 'Enjoy it.', label: 'See the details', action: { type: 'tab', tab: 'details' } });
}
