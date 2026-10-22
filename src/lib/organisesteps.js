// Organise as one clear path (Josh, 22 Oct: "It's not clear where to start"). Pure functions, no React, so they can
// be tested.
//
// Plain words: a trip is organised in six steps, in the order the organiser actually works:
//   1 Plan          where and when (Build the trip, or set them by hand)
//   2 Vote          put it to the group, then pick the winner
//   3 Book          call the courses for tee times, find and pick the accommodation
//   4 Lock in       lock it in, who's in, the deposits
//   5 Jobs & money  the to-do list, the kitty, rooms and cars
//   6 On the day    rounds, teams, the draw and side comps
// The step that's open ("current") is the one the Next step (nextStep() in tripjobs.js) belongs to, so there's only
// ever one big button and it's the same advice as before. Each step also says, from the trip's own data, whether
// it's done, and a one-line summary ("✓ Hunter Valley · Fri 13 – Sun 15 Mar").

import { fmtRange, money } from './plan.js';
import { callJobs, jobStage } from './tripjobs.js';
import { depositStatus } from './tripbudget.js';

export const ORGANISE_STEPS = [
  { key: 'plan', n: 1, title: 'Plan', blurb: 'Where and when' },
  { key: 'vote', n: 2, title: 'Vote', blurb: 'Put it to the group' },
  { key: 'book', n: 3, title: 'Book', blurb: 'Tee times and accommodation' },
  { key: 'lockin', n: 4, title: 'Lock in', blurb: 'Who’s in and deposits' },
  { key: 'money', n: 5, title: 'Jobs & money', blurb: 'Jobs, kitty, rooms and cars' },
  { key: 'day', n: 6, title: 'On the day', blurb: 'Teams, draw and comps' },
];
export const STEP_KEYS = ORGANISE_STEPS.map((s) => s.key);

/** The old ?tab= addresses (notifications and shared links use them) → the step they now live under. */
export const TAB_STEP = { vote: 'vote', people: 'lockin', jobs: 'money', kitty: 'money', groups: 'money' };
/** Tabs that live in the "More" section rather than a step. */
export const MORE_TABS = ['chat', 'details'];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const jobsOf = (items) => (items || []).filter((i) => i.kind === 'job');
const BOOK_JOBS = ['shortlist_stay', 'reserve_stay', 'book_tees'];
const LOCK_JOBS = ['deposit_ask', 'chase_deposits'];

/** Which step a job belongs to. */
export function stepOfJob(job, items, callJobIds = []) {
  if (!job) return 'money';
  if (BOOK_JOBS.includes(job.formula_key)) return 'book';
  if (LOCK_JOBS.includes(job.formula_key)) return 'lockin';
  if (job.formula_key === 'teams_draw') return 'day';
  if (callJobs(items, callJobIds).some((j) => j.id === job.id)) return 'book';
  return 'money';
}

/** Which step a nextStep() result belongs to. ctx: { items, polls, builder }. */
export function stepOfNext(next, { items = [], polls = [], builder = {} } = {}) {
  if (!next) return null;
  const [kind, id] = String(next.key).split(/:(.*)/s);
  if (['idea', 'weekends', 'weekends-wait', 'stay-list'].includes(kind)) return 'plan';
  if (['configs', 'deciding-wait'].includes(kind)) return 'vote';
  if (kind === 'vote' || kind === 'vote-me') {
    // A vote on where to stay is part of booking; anything else is the Vote step.
    const ps = polls.filter((p) => p.id === id || p.vote_batch === id);
    return ps.length && ps.every((p) => p.purpose === 'stay') ? 'book' : 'vote';
  }
  if (['calls-mine', 'calls-wait'].includes(kind)) return 'book';
  if (['allocate', 'job', 'wait'].includes(kind)) return stepOfJob(items.find((j) => j.id === id), items, builder.callJobIds);
  if (['lock', 'make_jobs', 'deposit_ask', 'confirm-deposits', 'collect', 'pay', 'pay-wait', 'keen'].includes(kind)) return 'lockin';
  if (['sorted', 'on', 'on-draw', 'done'].includes(kind)) return 'day';
  return null;
}

/**
 * Every step with whether it's done and a one-line summary, and which one is current.
 * ctx: { plan, stage, items, polls, options, votes, rsvps, transfers, costs, builder, stays, next,
 *        costsOn = true, roundsSetUp = 0 }
 * → { steps: [{ key, n, title, blurb, done, started, state: 'done'|'current'|'todo'|'later', summary }], current }
 */
export function organiseSteps(ctx) {
  const {
    plan, stage, items = [], polls = [], rsvps = [], transfers = [], costs = [], builder = {}, stays = [], next = null,
    costsOn = true, roundsSetUp = 0,
  } = ctx;
  if (!plan) return { steps: [], current: null };
  const confirmed = ['locked', 'on', 'done'].includes(stage);
  const round = plan.kind === 'round';
  const jobs = jobsOf(items);
  const calls = callJobs(items, builder.callJobIds);
  const openCalls = calls.filter((j) => jobStage(j) !== 'done');
  const groupPolls = polls.filter((p) => p.purpose !== 'stay');
  const openVotes = groupPolls.filter((p) => p.status === 'open');
  const decided = groupPolls.filter((p) => p.status === 'closed');
  const chosen = stays.find((s) => s.chosen);
  const reserve = jobs.find((j) => j.formula_key === 'reserve_stay');
  const ins = rsvps.filter((r) => r.status === 'in').length;
  const deposit = Number(plan.deposit_pp) || 0;
  const dep = costsOn && deposit > 0 && plan.deposit_asked_at ? depositStatus({ deposit, rsvps, transfers }) : null;
  const askJob = jobs.find((j) => j.formula_key === 'deposit_ask');
  const formulaMade = jobs.some((j) => j.formula_key);
  const openJobs = jobs.filter((j) => jobStage(j) !== 'done');
  const moneyJobs = jobs.filter((j) => stepOfJob(j, items, builder.callJobIds) === 'money');
  const dates = plan.start_date ? fmtRange(plan.start_date, plan.end_date) : null;
  const areas = builder.areas || [];
  const kittyTotal = costs.reduce((s, c) => s + (Number(c.amount) || 0) * (c.per_head ? Math.max(1, ins) : 1), 0);

  const done = {
    plan: confirmed || groupPolls.length > 0 || !!plan.start_date || (builder.weekends || 0) > 0,
    vote: confirmed || (openVotes.length === 0 && !!plan.start_date && (!!plan.location_name || decided.length > 0)),
    book: openCalls.length === 0 && (round || !!chosen || (reserve && jobStage(reserve) === 'done')),
    lockin: confirmed && (round || !costsOn || (formulaMade && (dep ? dep.people.every((p) => p.state === 'paid') : !askJob || jobStage(askJob) === 'done'))),
    money: confirmed && formulaMade && moneyJobs.every((j) => jobStage(j) === 'done'),
    day: stage === 'done',
  };
  if (round) done.money = confirmed && openJobs.filter((j) => j.formula_key !== 'teams_draw').length === 0;

  const summary = {
    plan: [plan.location_name || (areas.length ? `${plural(areas.length, 'area')}: ${areas.join(', ')}` : null),
      dates || (builder.weekends ? plural(builder.weekends, 'weekend') + ' to choose from' : null)].filter(Boolean).join(' · ') || 'Where and when — nothing yet',
    vote: openVotes.length
      ? `${plural(openVotes.length, 'vote')} open`
      : [plan.location_name, dates].filter(Boolean).join(' · ') || (decided.length ? `${plural(decided.length, 'vote')} decided` : 'No vote yet'),
    book: [round ? null : chosen ? `🏠 ${chosen.name}` : stays.length ? `${plural(stays.length, 'place')} on the shortlist` : 'Accommodation not picked',
      calls.length ? `📞 ${calls.length - openCalls.length} of ${plural(calls.length, 'call')} done` : null].filter(Boolean).join(' · '),
    lockin: [confirmed ? '🔒 Locked in' : 'Not locked in yet', `${ins} in`,
      dep ? `deposits ${dep.people.filter((p) => p.state === 'paid').length} of ${dep.people.length} paid` : null].filter(Boolean).join(' · '),
    money: [jobs.length ? `${jobs.length - openJobs.length} of ${plural(jobs.length, 'job')} done` : 'No jobs yet',
      costs.length ? `${money(kittyTotal)} in the kitty` : null].filter(Boolean).join(' · '),
    day: stage === 'done' ? 'That’s a wrap' : stage === 'on' ? 'It’s on!' : roundsSetUp ? `${plural(roundsSetUp, 'round')} set up` : 'Rounds not set up yet',
  };

  // Something has happened on the step already (a greyed later step shows its summary instead of what it's for).
  const started = {
    plan: true, vote: polls.length > 0, book: calls.length > 0 || stays.length > 0, lockin: confirmed || !!dep,
    money: jobs.length > 0 || costs.length > 0, day: roundsSetUp > 0 || stage === 'on',
  };

  // The current step: where the Next step points. If there's no Next step, the first step that isn't done.
  let current = stepOfNext(next, { items, polls, builder });
  if (stage === 'on') current = 'day';
  if (!current) current = STEP_KEYS.find((k) => !done[k]) || null;
  if (stage === 'done') current = null;
  const at = current ? STEP_KEYS.indexOf(current) : STEP_KEYS.length;
  const steps = ORGANISE_STEPS.map((s, i) => ({
    ...s,
    done: !!done[s.key],
    started: !!started[s.key] || !!done[s.key],
    state: s.key === current ? 'current' : done[s.key] ? 'done' : i < at ? 'todo' : 'later',
    summary: summary[s.key],
  }));
  return { steps, current };
}

/**
 * The one big button on the current step, for an organiser: the Next step's own button, worded for this screen.
 * → { title, detail, label, action } or null. Actions are NextStepCard's, plus:
 *   { type: 'pick_winner', pollIds } (open the winner sheet), { type: 'plan_builder' } (the trip builder),
 *   { type: 'edit' } (dates and place by hand).
 */
export function primaryFor(next, { current, polls = [], builderOn = true, builderStarted = false } = {}) {
  if (!next || !current) return null;
  const base = { title: next.title, detail: next.detail, label: next.label, action: next.action, icon: next.icon, who: next.who };
  const [kind, id] = String(next.key).split(/:(.*)/s);
  if (kind === 'idea') return { ...base, label: null, action: null }; // Approve / Pass are on the idea card itself
  if (kind === 'weekends') {
    return builderOn
      ? { ...base, title: builderStarted ? 'Carry on planning where and when' : 'Start by planning where and when', label: builderStarted ? 'Carry on: plan where and when' : 'Start: plan where and when', action: { type: 'plan_builder' } }
      : { ...base, title: 'Set the dates and place', label: 'Set the dates and place', action: { type: 'edit' } };
  }
  if (kind === 'stay-list' || kind === 'configs' || kind === 'calls-mine') return { ...base, action: builderOn ? { type: 'plan_builder' } : base.action };
  if (kind === 'vote' && current === 'vote') {
    const open = polls.filter((p) => (p.id === id || p.vote_batch === id) && p.status === 'open').map((p) => p.id);
    return { ...base, label: 'Pick the winner', action: { type: 'pick_winner', pollIds: open } };
  }
  if (kind === 'allocate' && current === 'book') return { ...base, label: 'Allocate the calls' };
  return base;
}
