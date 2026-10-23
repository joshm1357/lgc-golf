// Penalties for breaking a rule (migration 099): the "⚖️ Penalty" button and sheet on score entry, the organiser's
// "waiting to confirm" list, and the one-tap waiver on a rule penalty line. Organisers apply a penalty straight away;
// players propose one and an organiser confirms; guests can't. Every write goes through the server's functions
// (apply_rule_penalty / decide_rule_penalty / waive_rule_penalty). The thinking is in lib/drives.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { useRun } from '../lib/run.js';
import { Sheet } from './ui.jsx';
import { Link } from 'react-router-dom';
import RuleTag from './RuleTag.jsx';
import { penaltyPower, ruleStrokes, penaltyArgs, breachLabel, DRIVES_KEY, drivesRule, drivesTable, drivesRoundLine, signed } from '../lib/drives.js';
import { gate } from '../lib/savedgate.js';

/** organiser → 'apply', player → 'propose', guest / viewing / no profile → null. */
export function usePenaltyPower() {
  const { status } = useSession();
  if (!status?.player_id || status?.viewing) return null;
  return penaltyPower(status.role || (status.is_admin ? 'organiser' : 'player'));
}

/** The group's rules in force that a penalty can be given under (not the automatic ones). */
function usePenaltyRules(open) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!open) return;
    supabase.from('rules').select('*').eq('status', 'active').then(({ data: r, error }) => {
      if (error) { setRows([]); return; }
      setRows((r || []).filter((x) => x.system_key !== 'late_job' && x.system_key !== 'leftover_kitty' && !x.award_kind)
        .sort((a, b) => (Number(b.breach_strokes > 0) - Number(a.breach_strokes > 0)) || String(a.title).localeCompare(String(b.title))));
    }, () => setRows([]));
  }, [open]);
  return rows;
}

/** Everyone playing this round: [{ id, name, team }] (Ambrose and 4BBB by team). */
function useRoundPlayers(round) {
  const data = useData();
  return useMemo(() => {
    if (!round) return [];
    const teams = data.teamsByRound?.[round.id] || [];
    if (['ambrose', 'fourball'].includes(round.format) && teams.length) {
      return teams.flatMap((t) => (t.players || []).filter(Boolean).map((p) => ({ id: p.id, name: playerName(p), team: t.name })));
    }
    return (data.roundPlayers?.[round.id] || []).map((rp) => ({ id: rp.player_id, name: playerName(data.playersById?.[rp.player_id]), team: null }));
  }, [round, data]);
}

/** "⚖️ Penalty" on score entry → the sheet. Nothing for guests or before the round has started. */
export function PenaltyButton({ round, hole, who = '' }) {
  const power = usePenaltyPower();
  const [open, setOpen] = useState(false);
  if (!power || !round || !['live', 'locked'].includes(round.status)) return null;
  return (
    <>
      <button {...gate('penalty')} type="button" className="btn ghost sm" data-testid="penalty-button" onClick={() => setOpen(true)}>⚖️ Penalty</button>
      {open && <PenaltySheet round={round} hole={hole} who={who} power={power} onClose={() => setOpen(false)} />}
    </>
  );
}

export function PenaltySheet({ round, hole, who = '', power, onClose }) {
  const rules = usePenaltyRules(true);
  const players = useRoundPlayers(round);
  const [ruleId, setRuleId] = useState('');
  const [player, setPlayer] = useState(who);
  const [strokes, setStrokes] = useState('');
  const [holeN, setHoleN] = useState(hole?.n ? String(hole.n) : '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useRun();
  const rule = (rules || []).find((r) => r.id === ruleId) || null;
  const team = round?.format === 'ambrose';
  const pick = (id) => {
    setRuleId(id);
    const r = (rules || []).find((x) => x.id === id);
    setStrokes(ruleStrokes(r) != null ? String(ruleStrokes(r)) : '');
  };
  const send = () => {
    const args = penaltyArgs({ round, player, rule, strokes, hole: holeN, note });
    if (args.error) { setErr(args.error); return; }
    setErr('');
    run(async () => {
      const { data, error } = await supabase.rpc('apply_rule_penalty', args);
      if (error) throw error;
      onClose();
      return data;
    }, power === 'apply' ? 'Penalty added to the card' : 'Sent to the organisers to confirm');
  };
  return (
    <Sheet title="Penalty for breaking a rule" onClose={onClose}>
      <div className="stack" data-testid="penalty-sheet" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>
          {power === 'apply' ? 'You’re an organiser, so it goes straight on the card.' : 'An organiser confirms it before it goes on the card.'}
          {team ? ' In Ambrose it counts on the team’s score.' : ' It counts on that player’s score.'} Anyone can dispute it.
        </p>
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">Which rule?</span>
          <select className="select" data-testid="penalty-rule" value={ruleId} onChange={(e) => pick(e.target.value)}>
            <option value="">{rules == null ? 'Loading…' : 'Pick a rule'}</option>
            {(rules || []).map((r) => <option key={r.id} value={r.id}>{r.title}{ruleStrokes(r) ? ` (+${ruleStrokes(r)})` : ''}</option>)}
          </select>
        </label>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Who?</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {players.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={player === p.id} data-testid="penalty-who" onClick={() => setPlayer(player === p.id ? '' : p.id)}>
                {p.name}{p.team ? <span className="muted"> · {p.team}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <label className="stack grow" style={{ gap: 4 }}>
            <span className="label">Strokes</span>
            <input className="input" inputMode="numeric" data-testid="penalty-strokes" value={strokes} onChange={(e) => setStrokes(e.target.value)} placeholder={rule ? 'How many?' : '—'} />
          </label>
          <label className="stack grow" style={{ gap: 4 }}>
            <span className="label">Hole (optional)</span>
            <input className="input" inputMode="numeric" data-testid="penalty-hole" value={holeN} onChange={(e) => setHoleN(e.target.value)} />
          </label>
        </div>
        {rule && ruleStrokes(rule) == null && <span className="small muted">This rule has no set penalty — say how many strokes.</span>}
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">What happened? (optional)</span>
          <input className="input" maxLength={200} data-testid="penalty-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {rule && player && /^\d+$/.test(strokes.trim()) && (
          <span className="small" data-testid="penalty-preview"><strong>{breachLabel(rule.title, /^\d+$/.test(holeN.trim()) ? Number(holeN) : null, Number(strokes))}</strong> · {players.find((p) => p.id === player)?.name}</span>
        )}
        {err && <span className="err" data-testid="penalty-error">{err}</span>}
        <button type="button" className="btn gold block" disabled={busy} data-testid="penalty-send" onClick={send}>
          {busy ? 'Sending…' : power === 'apply' ? 'Add the penalty' : 'Send to the organisers'}
        </button>
      </div>
    </Sheet>
  );
}

/** Players' proposed penalties waiting on this round → [{ ...row }]. */
export function usePenaltyProposals(roundId) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!roundId) { setRows([]); return; }
    try {
      const { data, error } = await supabase.from('penalty_proposals').select('*').eq('round_id', roundId).eq('status', 'open');
      setRows(error ? [] : data || []);
    } catch { setRows([]); }
  }, [roundId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['penalty_proposals'], load);
  return [rows, load];
}

/** On score entry and the board: the organiser confirms or declines; whoever proposed it sees it waiting. */
export function PendingPenalties({ round }) {
  const data = useData();
  const { status } = useSession();
  const power = usePenaltyPower();
  const [rows, reload] = usePenaltyProposals(round?.id);
  const [busy, run] = useRun();
  const mine = power === 'apply' ? rows : rows.filter((r) => r.proposed_by === status?.player_id);
  if (!power || !mine.length) return null;
  const decide = (id, ok) => run(async () => {
    const { error } = await supabase.rpc('decide_rule_penalty', { p_proposal: id, p_confirm: ok });
    if (error) throw error;
    await reload();
  }, ok ? 'Penalty confirmed — it’s on the card' : 'Penalty declined');
  return (
    <div className="section"><div className="card pad small stack" data-testid="pending-penalties" style={{ gap: 8, borderColor: 'var(--gold)' }}>
      <strong>⚖️ {power === 'apply' ? 'Penalties to confirm' : 'Your penalties waiting on an organiser'}</strong>
      {mine.map((p) => (
        <div key={p.id} className="stack" style={{ gap: 6 }} data-testid="pending-penalty">
          <span>{p.label} · <strong>{playerName(data.playersById?.[p.player_id])}</strong>
            {p.note ? <span className="muted"> — “{p.note}”</span> : null}
            {power === 'apply' && p.proposed_by ? <span className="muted"> (from {playerName(data.playersById?.[p.proposed_by])})</span> : null}
          </span>
          {power === 'apply' && (
            <div className="row" style={{ gap: 8 }}>
              <button {...gate('penalty')} type="button" className="btn sm gold" disabled={busy} data-testid="penalty-confirm" onClick={() => decide(p.id, true)}>Confirm</button>
              <button {...gate('penalty')} type="button" className="btn sm ghost" disabled={busy} data-testid="penalty-decline" onClick={() => decide(p.id, false)}>Decline</button>
            </div>
          )}
        </div>
      ))}
    </div></div>
  );
}

/**
 * On a rule's page: the drives rule's numbers (each tappable to see or dispute) with the defaults table, or any other
 * rule's penalty ("Penalty for breaking it: +2 strokes").
 */
export function RuleBreachNumbers({ rule }) {
  if (!rule) return null;
  const tag = (field, label, value, explain, children, testId) => (
    rule.status === 'active'
      ? <RuleTag testId={testId} rule={{ table: 'rules', id: rule.id, field, label, value, rule_id: rule.id }} explain={explain}>{children}</RuleTag>
      : children
  );
  if (rule.system_key === DRIVES_KEY) {
    const dr = drivesRule([rule]);
    return (
      <div className="stack small" style={{ gap: 6 }} data-testid="drive-rule-numbers">
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span>Three: <strong>{tag('drives_3', 'Drives each in a team of three', dr.n3, 'Drives each player needs in a team of three over 18 holes.', `${dr.n3} each`, 'drives-3-tag')}</strong></span>
          <span>Four: <strong>{tag('drives_4', 'Drives each in a team of four', dr.n4, 'Drives each player needs in a team of four over 18 holes.', `${dr.n4} each`, 'drives-4-tag')}</strong></span>
          <span>Pair: <strong>{tag('drives_2', 'Drives each in a pair', dr.n2, 'Drives each player needs in a pair over 18 holes.', `${dr.n2} each`, 'drives-2-tag')}</strong></span>
          <span>Penalty: <strong>{tag('breach_strokes', 'Strokes per drive short', dr.strokes, 'Strokes added to the team for each drive a player is short.', `${signed(dr.strokes)} a drive short`, 'drives-strokes-tag')}</strong></span>
        </div>
        <DrivesTable dr={dr} />
      </div>
    );
  }
  if (!(rule.breach_strokes > 0)) return null;
  return (
    <div className="small" data-testid="breach-strokes">
      ⚖️ Penalty for breaking it: <strong>{tag('breach_strokes', `${rule.title}: penalty`, rule.breach_strokes, 'Strokes added to the score of whoever breaks this rule (the team’s, in Ambrose). An organiser applies it, or confirms a player’s.', `+${rule.breach_strokes} stroke${rule.breach_strokes === 1 ? '' : 's'}`, 'breach-strokes-tag')}</strong>
    </div>
  );
}

/** For "Rules for this trip": the drives rule and its penalty, and any rule's penalty for breaking it. */
export function TripPenaltyRules({ rules: given }) {
  const loaded = usePenaltyRules(!given); // loads the rules itself when not handed them
  const rules = given || loaded || [];
  const dr = drivesRule(rules || []);
  const drives = dr?.on ? drivesRoundLine({ dr, round: null, teamSizes: [3, 4] }) : '';
  const others = (rules || []).filter((r) => r.status === 'active' && !r.system_key && r.breach_strokes > 0);
  if (!drives && !others.length) return null;
  return (
    <div className="stack small" style={{ gap: 4 }} data-testid="trip-penalty-rules">
      {drives && <Link to={`/rules/${dr.rule.id}`} style={{ color: 'inherit' }}>🏌️ <strong>Ambrose</strong> — {drives}</Link>}
      {others.length > 0 && <span>⚖️ <strong>Penalties:</strong> {others.map((r) => `${r.title} +${r.breach_strokes}`).join(' · ')}</span>}
    </div>
  );
}

/** "Drives each: Pair 6 (3 on 9 holes) · Three 6 (3) · Four 4 (2) · Five 3 (1)". */
export function DrivesTable({ dr }) {
  const rows = drivesTable(dr);
  return (
    <table className="sc" data-testid="drives-table" style={{ maxWidth: 360 }}>
      <thead><tr><th>Team</th><th>18 holes</th><th>9 holes</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.size}><td>{r.label}</td><td>{r.n18} each</td><td>{r.n9} each</td></tr>)}</tbody>
    </table>
  );
}

/** The organiser's one tap on a rule penalty line: waive it (stays on the card, struck out; recorded on the server). */
export function WaiveRulePenalty({ line, onDone }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const organiser = !status?.viewing && (status?.role === 'organiser' || (!status?.role && status?.is_admin));
  if (!organiser || !line || line.kind !== 'rule_breach' || line.waived || line.projected) return null;
  return (
    <button {...gate('penalty')} type="button" className="btn ghost sm" data-testid="waive-rule-penalty" disabled={busy} style={{ minHeight: 32, padding: '2px 10px' }}
      onClick={(e) => { e.stopPropagation(); run(async () => {
        const { error } = await supabase.rpc('waive_rule_penalty', { p_adjustment: line.id });
        if (error) throw error;
        onDone?.();
      }, 'Penalty waived — it’s off the score'); }}>
      Waive
    </button>
  );
}
