// Late organising jobs (migration 085) — pure functions, no database or screen code.
//
// Plain words:
//   - Every group has a standard Rulebook rule, "Late organising job" (rules.system_key = 'late_job'): if you're given
//     a trip job and it's more than N days overdue, you cop X penalty strokes in the next round. It starts at X = 0
//     (listed, does nothing) and N = 5.
//   - A job is late when X > 0 and it has an owner, isn't done, and is more than N days past its due date (and an
//     organiser hasn't waived it). The server decides this for real (private.late_jobs) and adds the strokes when the
//     next round starts; these functions only show it.

import { todayISO } from './plan.js';

export const LATE_KEY = 'late_job';
export const LATE_DEFAULTS = { strokes: 0, days: 5 };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The group's late job rule from its rules → { rule, strokes, days, on } (on = in force with X > 0), or null. */
export function lateRule(rules = []) {
  const rule = (rules || []).find((r) => r?.system_key === LATE_KEY);
  if (!rule) return null;
  const strokes = Number.isFinite(Number(rule.late_strokes)) && rule.late_strokes != null ? Number(rule.late_strokes) : LATE_DEFAULTS.strokes;
  const days = Number.isFinite(Number(rule.late_days)) && rule.late_days != null ? Number(rule.late_days) : LATE_DEFAULTS.days;
  return { rule, strokes, days, on: rule.status === 'active' && strokes > 0 };
}

/** Whole days from one ISO date to another (b − a). */
export function daysBetween(a, b) {
  const pa = String(a || '').slice(0, 10).split('-').map(Number);
  const pb = String(b || '').slice(0, 10).split('-').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

const isDone = (j) => j.done || j.stage === 'done';

/**
 * Is this job late? → null, or { daysLate, strokes, days, waived, applied }.
 *   rule: lateRule(...) result. penalties: job_penalties rows (waivers). adjustments: score_adjustments rows (applied).
 * A waived or already-applied job still comes back (so the screen can say so), with waived / applied set.
 */
export function lateInfo(job, rule, { today = todayISO(), penalties = [], adjustments = [] } = {}) {
  if (!job || job.kind !== 'job' || !rule?.on || !job.owner_id || !job.due || isDone(job)) return null;
  const daysLate = daysBetween(job.due, today);
  if (daysLate == null || daysLate <= rule.days) return null;
  const p = (penalties || []).find((x) => x.item_id === job.id);
  const a = (adjustments || []).find((x) => x.item_id === job.id && (x.kind || LATE_KEY) === LATE_KEY);
  return { daysLate, strokes: rule.strokes, days: rule.days, waived: !!(p?.waived_at || a?.waived_at), applied: a || null };
}

/** The words: "⚠️ 6 days late — 2 penalty strokes if it's not done before the next round". */
export function lateMessage(info) {
  if (!info) return '';
  const late = `⚠️ ${plural(info.daysLate, 'day')} late`;
  if (info.waived) return `${late} — penalty waived`;
  if (info.applied) return `${late} — ${plural(info.applied.strokes ?? info.strokes, 'penalty stroke')} added to ${info.applied.roundName || 'the round'}`;
  return `${late} — ${plural(info.strokes, 'penalty stroke')} if it’s not done before the next round`;
}

/** The label the server writes on the scorecard: "Late job: Book the bus (+2)". */
export function lateLabel(title, strokes) {
  return `Late job: ${String(title || '').slice(0, 140)} (+${strokes})`;
}

/** The late jobs on a trip for the organiser's view, most days late first. */
export function lateJobs(items = [], rule, opts = {}) {
  return (items || []).map((j) => ({ job: j, info: lateInfo(j, rule, opts) })).filter((x) => x.info)
    .sort((a, b) => b.info.daysLate - a.info.daysLate);
}

/** The rule's two numbers as RuleTag references (so either can be disputed). */
export function lateRuleRefs(rule) {
  if (!rule?.rule?.id) return null;
  const id = rule.rule.id;
  return {
    strokes: { table: 'rules', id, field: 'late_strokes', label: `${plural(rule.strokes, 'penalty stroke')} for a late job`, value: rule.strokes, rule_id: id, where: { path: `/rules/${id}` } },
    days: { table: 'rules', id, field: 'late_days', label: `Late after ${plural(rule.days, 'day')} overdue`, value: rule.days, rule_id: id, where: { path: `/rules/${id}` } },
  };
}

/** A penalty line on a scorecard as a RuleTag reference (dispute this one penalty). */
export function penaltyRef(line, round) {
  if (!line?.id) return null;
  return {
    table: 'score_adjustments', id: line.id, field: 'strokes', label: line.label, value: line.strokes,
    where: round ? { round_id: round.id, ...(round.trip_id ? { trip_id: round.trip_id } : {}), path: `/?r=${round.id}` } : undefined,
  };
}

/** The organiser's form → the rules row update (whole numbers, X 0–10, N 0–60), or { error }. */
export function lateRulePatch(strokesText, daysText) {
  const x = Number(String(strokesText ?? '').trim());
  const n = Number(String(daysText ?? '').trim());
  if (!Number.isInteger(x) || x < 0 || x > 10) return { error: 'Penalty strokes: a whole number from 0 to 10' };
  if (!Number.isInteger(n) || n < 0 || n > 60) return { error: 'Days late: a whole number from 0 to 60' };
  return { late_strokes: x, late_days: n };
}

/** The rule's wording with the numbers in (same as the server's private.late_job_detail). */
export function lateDetail(strokes, days) {
  return `If you’re given a trip job and it’s more than ${plural(days, 'day')} overdue, you cop ${plural(strokes, 'penalty stroke')} in the next round. Finish it before that round starts and it’s off. An organiser can waive it.${strokes === 0 ? ' (At 0 strokes it’s listed but nothing happens.)' : ''}`;
}
