// Late organising jobs (migration 085): the data the screens need, the "⚠️ 6 days late" badge, the organiser's
// one-tap waiver, and the penalty lines on a scorecard. The thinking is in lib/latejobs.js; the server decides.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useFeature, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { useRun } from '../lib/run.js';
import RuleTag from './RuleTag.jsx';
import { lateRule, lateInfo, lateMessage, penaltyRef, lateRuleRefs } from '../lib/latejobs.js';

async function rowsOr(q) {
  try { const { data, error } = await q; return error ? [] : data || []; } catch { return []; }
}

/**
 * The late job rule, waivers and penalties for this group → { rule, penalties, adjustments, reload } (rule null
 * until loaded, on an older database, or with the planner's jobs switched off).
 */
export function useLateJobs() {
  const tasksOn = useFeature('planner_tasks');
  const data = useData();
  const [st, setSt] = useState({ rule: null, penalties: [], adjustments: [] });
  const load = useCallback(async () => {
    if (!tasksOn) { setSt({ rule: null, penalties: [], adjustments: [] }); return; }
    const [rules, penalties, adjustments] = await Promise.all([
      rowsOr(supabase.from('rules').select('id,title,status,system_key,late_strokes,late_days,value').eq('system_key', 'late_job')),
      rowsOr(supabase.from('job_penalties').select('item_id,waived_at,waived_by,notified_at')),
      rowsOr(supabase.from('score_adjustments').select('id,round_id,player_id,strokes,label,kind,item_id,rule_id,waived_at,waived_by').eq('kind', 'late_job')),
    ]);
    const roundName = Object.fromEntries((data?.rounds || []).map((r) => [r.id, r.name]));
    setSt({ rule: lateRule(rules), penalties, adjustments: adjustments.map((a) => ({ ...a, roundName: roundName[a.round_id] })) });
  }, [tasksOn, data?.rounds]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['rules', 'job_penalties', 'score_adjustments', 'plan_items'], load);
  return useMemo(() => ({ ...st, reload: load }), [st, load]);
}

/** "⚠️ 6 days late — 2 penalty strokes if it's not done before the next round" under a job. */
export function LateBadge({ job, late, compact = false }) {
  const info = late?.rule ? lateInfo(job, late.rule, { penalties: late.penalties, adjustments: late.adjustments }) : null;
  if (!info) return null;
  const words = lateMessage(info);
  return (
    <div className="small" data-testid="late-badge" style={{ color: info.waived ? 'var(--muted)' : 'var(--under)', fontWeight: 700, lineHeight: 1.35 }}>
      {compact ? words.replace(/ if it’s not done before the next round$/, '') : words}
    </div>
  );
}

/** The organiser's one tap: waive this job's penalty (before or after it's been added). Recorded on the server. */
export function WaiveButton({ job, late, onDone }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const info = late?.rule ? lateInfo(job, late.rule, { penalties: late.penalties, adjustments: late.adjustments }) : null;
  if (!status?.is_admin || !info || info.waived) return null;
  return (
    <button type="button" className="btn ghost block" data-testid="waive-penalty" disabled={busy}
      onClick={() => run(async () => {
        const { error } = await supabase.rpc('waive_late_penalty', { p_item: job.id });
        if (error) throw error;
        await late.reload?.();
        onDone?.();
      }, info.applied ? 'Penalty waived — it’s off the scorecard' : 'Penalty waived')}>
      🙅 Waive the penalty{info.applied ? ' (take it off the scorecard)' : ''}
    </button>
  );
}

/** Penalty strokes for one round, live → score_adjustments rows ([] on an older database). */
export function useRoundAdjustments(roundIds) {
  const ids = (Array.isArray(roundIds) ? roundIds : [roundIds]).filter(Boolean);
  const key = ids.join(',');
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!ids.length) { setRows([]); return; }
    // 093: strokes won or copped from an award or fine sit in award_strokes — added the same way.
    const [adj, award] = await Promise.all([
      rowsOr(supabase.from('score_adjustments').select('*').in('round_id', ids)),
      rowsOr(supabase.from('award_strokes').select('*').in('round_id', ids)),
    ]);
    setRows([...adj, ...award.map((a) => ({ ...a, kind: 'award' }))]);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['score_adjustments', 'award_strokes'], load);
  return rows;
}

/** The penalty lines on a scorecard: "Late job: Book the bus (+2)", tap to see the rule or dispute it. */
export function PenaltyLines({ lines = [], round, names }) {
  const points = round && ['stableford', 'fourball'].includes(round.format); // a stroke costs a point there
  const data = useData();
  if (!lines.length) return null;
  return (
    <div className="card pad small stack" data-testid="penalty-lines" style={{ gap: 4, background: '#FDF1EF', borderColor: 'var(--under)' }}>
      {lines.map((l) => (
        <div key={l.id} className="row between" style={{ gap: 8, textDecoration: l.waived ? 'line-through' : 'none', opacity: l.waived ? 0.6 : 1 }}>
          <span>
            {l.kind === 'award' ? <span data-testid="award-stroke-line">{l.strokes < 0 ? '🏆 ' : '🏷 '}{l.label}</span> : (
              <RuleTag testId="penalty-line" rule={penaltyRef(l, round)}
                explain="A trip job given to this player was more than the set number of days overdue when the round started, so the Rulebook’s “Late organising job” rule added penalty strokes. An organiser can waive it.">
                {l.label}
              </RuleTag>
            )}
            {names && l.player_id && <span className="muted"> · {playerName(data.playersById[l.player_id])}</span>}
          </span>
          <strong style={{ whiteSpace: 'nowrap' }}>{l.waived ? 'waived' : points ? `${l.strokes > 0 ? '−' : '+'}${Math.abs(l.strokes)} pts` : `${l.strokes < 0 ? '−' : '+'}${Math.abs(l.strokes)}`}</strong>
        </div>
      ))}
    </div>
  );
}

/** The late job rule's two numbers on its Rulebook page, each tappable to see or dispute. */
export function LateRuleNumbers({ rule }) {
  const lr = lateRule([rule]);
  const refs = lateRuleRefs(lr);
  if (!refs) return null;
  return (
    <div className="row small" data-testid="late-rule-numbers" style={{ gap: 14, flexWrap: 'wrap' }}>
      <span>Penalty: <strong><RuleTag testId="late-strokes-tag" rule={refs.strokes} explain="Penalty strokes added to a late job's owner in the next round. 0 = listed, but nothing happens.">{lr.strokes} stroke{lr.strokes === 1 ? '' : 's'}</RuleTag></strong></span>
      <span>Late after: <strong><RuleTag testId="late-days-tag" rule={refs.days} explain="How many days past its due date a job can be before it counts as late.">{lr.days} day{lr.days === 1 ? '' : 's'} overdue</RuleTag></strong></span>
    </div>
  );
}
