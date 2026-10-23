// Ambrose minimum drives (migration 099): "Whose drive?" on the score entry, the live tracker
// ("Drives: Al 3/6 · Bo 5/6 · Cy 2/6"), the warnings ("Cy needs 4 more in 3 holes: +2 strokes coming"), the
// "needs one" hint on the tee, and a gentle reminder when a hole was saved without a drive. The maths is in
// lib/drives.js; the server adds the strokes when the round is locked.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, playerName } from '../lib/store.jsx';
import { courseHoles } from '../lib/board.js';
import RuleTag, { roundRef } from './RuleTag.jsx';
import { DRIVES_KEY, drivesRule, minDrivesFor, drivePenaltyFor, driveStatus, projectedDrivePenalties, drivesRoundLine, signed } from '../lib/drives.js';

let cache = { at: 0, rows: null };

/** The group's drives rule → drivesRule(...) result, or null (no rule yet / older database). */
export function useDrivesRule() {
  const [rows, setRows] = useState(cache.rows || []);
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('rules').select('*').eq('system_key', DRIVES_KEY);
      if (error) return;
      cache = { at: Date.now(), rows: data || [] };
      setRows(cache.rows);
    } catch { /* offline: keep the last copy */ }
  }, []);
  useEffect(() => { if (!cache.rows || Date.now() - cache.at > 30000) load(); }, [load]);
  useRealtime(['rules'], load);
  return drivesRule(rows);
}

/** For a team in a round → { need, per, players: [{ id, name }], ref (what to tap to see / dispute N) }. */
export function teamDrives({ dr, round, team, holes }) {
  const players = (team?.players || []).filter(Boolean).map((p) => ({ id: p.id, name: playerName(p) }));
  const need = minDrivesFor({ dr, round, teamSize: players.length, holes: holes.length });
  const per = drivePenaltyFor({ dr, round });
  const field = { 2: 'drives_2', 3: 'drives_3' }[players.length] || 'drives_4';
  const ref = round?.min_drives != null || !dr?.rule
    ? { ...roundRef(round, 'min_drives', `Minimum ${need} drives each`, []), ...(dr?.rule?.id && dr.on ? { rule_id: dr.rule.id } : {}) }
    : { table: 'rules', id: dr.rule.id, field, label: `${need} drives each`, value: dr.rule[field], rule_id: dr.rule.id, where: { path: `/rules/${dr.rule.id}` } };
  return { need, per, players, ref };
}

const EXPLAIN = (need, per) => `In Ambrose, each player’s drive must be used at least ${need} times in the round. ${per ? `Each drive short costs the team ${per} stroke${per === 1 ? '' : 's'}, added when the round is locked.` : 'No penalty is set for this round.'} Tap whose drive it was on each hole.`;

/**
 * "Whose drive?" for one hole of a team's card.
 *   round, team (subject: { id, players }), holes, hole (the one being entered), scores (the team's, by hole),
 *   pick (whose drive is picked now: id / null), onPick(id | '') — '' clears it.
 */
export default function AmbroseDrives({ round, team, holes, hole, scores = {}, pick, onPick }) {
  const dr = useDrivesRule();
  if (round?.format !== 'ambrose' || !team) return null;
  const { need, per, players, ref } = teamDrives({ dr, round, team, holes });
  if (!need) return null;
  const st = driveStatus({ players, holes, scores, need, per, current: { n: hole.n, pick: pick ?? null } });
  const skipped = holes.filter((h) => h.n !== hole.n && scores[h.n] && !scores[h.n].tee_shot_player).map((h) => h.n);
  const hint = !pick && st.needsOne.length ? st.needsOne.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean) : [];
  const bad = st.warnings.length > 0;
  return (
    <div className="section" data-testid="ambrose-drives">
      <div className="card pad stack" style={{ gap: 8, borderColor: bad ? 'var(--down)' : 'var(--line)' }}>
        <div className="row between">
          <span className="label">Whose drive?</span>
          <span className="small muted"><RuleTag testId="min-drives" rule={ref} explain={EXPLAIN(need, per)}>min {need} each{per ? ` · ${signed(per)} a drive short` : ''}</RuleTag></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, players.length)}, minmax(0, 1fr))`, gap: 8 }}>
          {st.rows.map((r) => {
            const done = r.used >= need;
            const on = pick === r.id;
            return (
              <button key={r.id} type="button" className="chip" aria-pressed={on} data-testid="drive-pick" onClick={() => onPick(on ? '' : r.id)}
                style={{ minHeight: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '6px 4px' }}>
                <span className="ellipsis" style={{ maxWidth: '100%' }}>{r.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: on ? '#fff' : done ? 'var(--up)' : 'var(--down)' }}>{r.used}/{need}{done ? ' ✓' : ''}</span>
              </button>
            );
          })}
        </div>
        {hint.length > 0 && <span className="small" data-testid="drive-hint" style={{ fontWeight: 700 }}>🏌️ {hint.join(' or ')} need{hint.length === 1 ? 's' : ''} one — use {hint.length === 1 ? 'their' : 'one of theirs'} off this tee if you can.</span>}
        {bad
          ? st.warnings.map((w) => <span key={w} className="err" data-testid="drive-warning" style={{ fontSize: 13 }}>⚠️ {w}</span>)
          : <span className="small muted" data-testid="drive-tracker">{st.rows.every((r) => r.used >= need) ? 'Drive rule done ✓' : st.line}</span>}
        {!pick && <span className="small muted" data-testid="drive-nudge">Tap whose drive you used — it keeps the count right.</span>}
        {skipped.length > 0 && <span className="small muted" data-testid="drive-skipped">No drive picked on hole{skipped.length > 1 ? 's' : ''} {skipped.join(', ')} — tap the hole to add it.</span>}
      </div>
    </div>
  );
}

/** The round's rules line for Ambrose: "🏌️ Minimum drives: 6 each in a three, 4 each in a four — +2 strokes for each drive short". */
export function DrivesRoundRule({ round }) {
  const data = useData();
  const dr = useDrivesRule();
  if (round?.format !== 'ambrose' || round.status === 'locked') return null;
  const sizes = (data.teamsByRound?.[round.id] || []).map((t) => (t.players || []).filter(Boolean).length);
  const holes = courseHoles(data.coursesById?.[round.course_id]).length || 18;
  const line = drivesRoundLine({ dr, round, teamSizes: sizes, holes });
  if (!line) return null;
  const ref = round.min_drives != null || round.drive_penalty != null || !dr?.rule
    ? { ...roundRef(round, round.drive_penalty != null ? 'drive_penalty' : 'min_drives', line, []), ...(dr?.rule?.id && dr.on ? { rule_id: dr.rule.id } : {}) }
    : { table: 'rules', id: dr.rule.id, field: 'breach_strokes', label: line, value: dr.strokes, rule_id: dr.rule.id, where: { path: `/rules/${dr.rule.id}` } };
  return (
    <div className="section"><div className="card pad small" data-testid="drives-round-rule" style={{ lineHeight: 1.45 }}>
      🏌️ <RuleTag testId="drives-rule-tag" rule={ref} explain={EXPLAIN(minDrivesFor({ dr, round, teamSize: sizes[0] || 3, holes }), drivePenaltyFor({ dr, round }))}>{line}</RuleTag>
      <span className="muted"> · tap whose drive on each hole.</span>
    </div></div>
  );
}

/** Drive penalties still to come on a live Ambrose round, as projected adjustment rows for the board ([] otherwise). */
export function useProjectedDrives(round, scoresIndex) {
  const data = useData();
  const dr = useDrivesRule();
  const live = round?.format === 'ambrose' && round?.status === 'live';
  return useMemo(() => {
    if (!live) return [];
    const holes = courseHoles(data.coursesById?.[round.course_id]);
    const teams = data.teamsByRound?.[round.id] || [];
    return projectedDrivePenalties({ round, teams, holes, scoresIdx: scoresIndex?.[round.id] || {}, dr, nameOf: playerName });
  }, [live, round, data, dr, scoresIndex]);
}

/** The tracker on a team's card (leaderboard): "Drives: Al 3/6 · Bo 5/6 · Cy 2/6", with any warning. */
export function DriveTracker({ round, team, holes, scores = {} }) {
  const dr = useDrivesRule();
  if (round?.format !== 'ambrose' || !team) return null;
  const { need, per, players } = teamDrives({ dr, round, team, holes });
  if (!need) return null;
  const st = driveStatus({ players, holes, scores, need, per });
  if (!st.tracked) return null;
  return (
    <div className="card pad small stack" data-testid="team-drive-tracker" style={{ gap: 4, borderColor: st.warnings.length ? 'var(--down)' : 'var(--line)' }}>
      <span><strong>{st.line}</strong></span>
      {st.warnings.map((w) => <span key={w} className="err">⚠️ {w}</span>)}
    </div>
  );
}
