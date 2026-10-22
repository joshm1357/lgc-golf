// The run-up to the trip: Organise → step 6 "Comps & on the day" (ov23, Josh 23 Oct: "Ryder Cup format is in the
// trip planning. That and the competitions available should be in later organising, like in the run-up — i.e. what
// cups are up? discussions on rules, handicaps etc."). Four parts, before Teams and the draw:
//   * What's up for grabs — the trip's trophies and comps (tick which are on; the Cup only for groups that use it),
//     with a link to the standings. Before the trip's set up in the app: what the group usually plays for.
//   * Rules for this trip — the Rulebook rules in force, any changes up for a vote or under dispute, "Propose a rule
//     change" (Governance → Rulebook / Tribunal).
//   * Handicaps check — everyone's handicap and its last change, open handicap disputes (the existing dispute flow:
//     tap a handicap), and a "Review handicaps" prompt for organisers before the first round.
// The pure bits are in lib/runup.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import RuleTag, { useActiveRules, useOpenDisputes } from './RuleTag.jsx';
import { upForGrabs, usualComps, handicapRows, ruleDisputes, reviewDue } from '../lib/runup.js';
import { todayISO } from '../lib/plan.js';

function useTripComps(tripId) {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    if (!tripId) { setRows([]); return; }
    const { data, error } = await supabase.from('comps').select('*').eq('trip_id', tripId).order('sort');
    setRows(error ? [] : data || []);
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['comps'], load);
  return [rows, load];
}

function useHandicapHistory() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    supabase.from('handicap_history').select('player_id,old_handicap,new_handicap,reason,created_at').order('created_at', { ascending: false }).limit(400)
      .then(({ data, error }) => { if (live && !error) setRows(data || []); }, () => {});
    return () => { live = false; };
  }, []);
  return rows;
}

function useProposedRules() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    supabase.from('rules').select('id,title,status').eq('status', 'proposed')
      .then(({ data, error }) => { if (live && !error) setRows(data || []); }, () => {});
    return () => { live = false; };
  }, []);
  return rows;
}

export default function RunUp({ pd, trip, isOrg }) {
  const data = useData();
  const { status } = useSession();
  const cupOn = useFeature('cup');
  const trophiesOn = useFeature('trophies');
  const [comps, reloadComps] = useTripComps(trip?.id || null);
  const rules = useActiveRules();
  const proposed = useProposedRules();
  const cases = useOpenDisputes();
  const history = useHandicapHistory();
  const [busy, run] = useRun();
  const plan = pd.plan;

  const grabs = useMemo(() => (trip ? upForGrabs({ comps: comps || [], trophies: data.trophies || [], tripId: trip.id, cupOn }) : []), [trip, comps, data.trophies, cupOn]);
  const usual = useMemo(() => (trip ? [] : usualComps({ trips: data.trips, trophies: data.trophies || [], cupOn })), [trip, data.trips, data.trophies, cupOn]);
  const inIds = pd.rsvps.filter((r) => r.status === 'in').map((r) => r.player_id);
  const hcps = handicapRows({ players: data.players, inIds, history, cases });
  const ruleCases = ruleDisputes(cases);
  const firstRound = trip ? data.rounds.filter((r) => r.trip_id === trip.id).map((r) => r.play_date).filter(Boolean).sort()[0] : null;
  const [reviewed, setReviewed] = useState(null);
  useEffect(() => {
    supabase.from('trip_builds').select('state').eq('plan_id', plan.id).maybeSingle()
      .then(({ data: b }) => setReviewed(b?.state?.hcpReviewed || null), () => {});
  }, [plan.id]);
  const due = reviewDue({ firstRound: firstRound || plan.start_date, today: todayISO(), reviewed });

  const toggleComp = (c) => run(async () => {
    if (c.virtual) { toast('Set it up on the comps page first'); return; }
    await must(supabase.from('comps').update({ retired: !c.retired }).eq('id', c.id));
    await reloadComps();
  });
  const markReviewed = () => run(async () => {
    const { data: b } = await supabase.from('trip_builds').select('state').eq('plan_id', plan.id).maybeSingle();
    const mark = { at: new Date().toISOString(), by: status.player_id };
    await must(supabase.from('trip_builds').upsert({ plan_id: plan.id, state: { ...(b?.state || {}), hcpReviewed: mark } }, { onConflict: 'plan_id' }));
    setReviewed(mark);
  }, 'Handicaps reviewed — noted for the trip');

  return (
    <div className="stack" style={{ gap: 12 }} data-testid="run-up">
      <section className="card pad stack" style={{ gap: 6 }} data-testid="runup-grabs">
        <strong>🏆 What’s up for grabs</strong>
        {trip ? (
          <>
            {comps === null && <span className="small muted">Loading…</span>}
            {comps !== null && !grabs.length && <span className="small muted">No trophies or comps for this trip yet.</span>}
            {grabs.map((c) => (
              <label key={c.id} className="row" style={{ gap: 10, minHeight: 44, alignItems: 'center' }} data-testid="grab">
                <input type="checkbox" checked={!c.retired} disabled={!isOrg || busy || c.virtual} onChange={() => toggleComp(c)} style={{ width: 22, height: 22, flex: 'none' }} aria-label={c.name} />
                <span className="grow"><strong>{c.name}</strong><span className="small muted" style={{ display: 'block' }}>{c.what}</span></span>
              </label>
            ))}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Link to="/comps-board" className="btn ghost sm">📊 The standings</Link>
              {isOrg && <Link to="/comps" className="btn ghost sm">+ Add or change comps</Link>}
            </div>
          </>
        ) : (
          <>
            <span className="small">{usual.length ? <>Usually up for grabs: <strong>{usual.join(', ')}</strong>.</> : 'Nothing from past trips yet.'}</span>
            <span className="small muted">You tick which are on once the trip’s locked in and set up in the app.</span>
            {trophiesOn && <Link to="/trophies" className="small" style={{ fontWeight: 700 }}>The Trophy Room →</Link>}
          </>
        )}
      </section>

      <section className="card pad stack" style={{ gap: 6 }} data-testid="runup-rules">
        <strong>📖 Rules for this trip</strong>
        <span className="small">{rules.length ? `${rules.length} rule${rules.length === 1 ? '' : 's'} in the Rulebook` : 'The Rulebook is empty — the standard rules apply.'}{rules.length ? `: ${rules.slice(0, 4).map((r) => r.title).join(', ')}${rules.length > 4 ? '…' : ''}` : ''}</span>
        {proposed.length > 0 && <span className="small" data-testid="rules-proposed">🗳️ Up for a vote: {proposed.map((r) => r.title).join(', ')}</span>}
        {ruleCases.length > 0 && <span className="small" style={{ color: 'var(--under)', fontWeight: 700 }} data-testid="rules-disputed">⚖️ Under dispute: {ruleCases.map((c) => c.title).join(', ')}</span>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to="/governance/rulebook" className="btn ghost sm">📖 The Rulebook</Link>
          {ruleCases.length > 0 && <Link to="/governance/tribunal" className="btn ghost sm">⚖️ The Tribunal</Link>}
          {status.role !== 'guest' && <Link to="/governance/rulebook?propose=1" className="btn ghost sm" data-testid="propose-rule">✍️ Propose a rule change</Link>}
        </div>
      </section>

      <section className="card pad stack" style={{ gap: 6 }} data-testid="runup-handicaps">
        <strong>⛳ Handicaps check</strong>
        {isOrg && due && (
          <div className="stack" style={{ gap: 6, background: 'var(--gold-soft)', borderRadius: 10, padding: '8px 10px' }} data-testid="review-handicaps">
            <span className="small"><strong>Review handicaps</strong> before the first round{firstRound || plan.start_date ? ` (${firstRound || plan.start_date})` : ''}: check each one’s right, sort any disputes.</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Link to="/group/players" className="btn sm">Review handicaps</Link>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={markReviewed}>✓ Done — they’re right</button>
            </div>
          </div>
        )}
        {reviewed && <span className="small muted">✓ Reviewed {new Date(reviewed.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}{data.playersById[reviewed.by] ? ` by ${playerName(data.playersById[reviewed.by])}` : ''}.</span>}
        <span className="small muted">Tap a handicap to see it or dispute it — disputes go to the Tribunal.</span>
        {hcps.map((h) => (
          <div key={h.id} className="row between small" style={{ gap: 8, minHeight: 36 }} data-testid="hcp-row">
            <span className="grow">{h.name}{h.dispute && <span style={{ color: 'var(--under)', fontWeight: 700 }}> · ⚖️ disputed</span>}
              <span className="muted" style={{ display: 'block' }}>{h.lastChange}</span></span>
            <RuleTag testId="runup-hcp" rule={{ table: 'players', id: h.id, field: 'handicap', label: `${h.name}’s handicap`, value: h.handicap, where: { path: `/plan/${plan.id}?view=organise&step=day` } }}
              explain="Handicaps are set by an organiser. If you think one’s wrong, dispute it: the group decides at the Tribunal.">
              <strong className="num">{h.text}</strong>
            </RuleTag>
          </div>
        ))}
      </section>
    </div>
  );
}
