// Automatic awards and fines (migration 100, feature 'dinner_awards'): "Claim Latest out?" on a night-time Feed photo,
// the morning's proposed winner (confirm, pick another claim, "No winner", dispute — the whole thing or one person's
// points), the runs on the awards screen, the results page lines and points, the "when it runs / points" settings in
// the propose sheet, and the "from the scores" proposal when a round is finished. The sums are in lib/autoawards.js;
// the database (100) does them again and decides.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useFeature, useScores, playerName } from '../lib/store.jsx';
import { Header, Sheet, Avatar, toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { courseHoles } from '../lib/board.js';
import { gameSubjects } from '../lib/games.js';
import { LIBRARY, findPreset, autoStandings } from '../lib/sidecomplib.js';
import { tripAwardList } from '../lib/awardsfines.js';
import {
  RUNS, POINT_MODES, autoTerms, runsWords, clock, clockAt, checkPoints, pointsWords, claimableFor, RUN_STATUS, runLabel,
  resultLines, pointsTally, signedPoints,
} from '../lib/autoawards.js';

const rowsOr = async (q) => { const { data, error } = await q; return error ? [] : data || []; };

/**
 * A trip's automatic awards, live: items (the trip's awards with their automatic terms), runs (award_runs), points
 * (cup_points), the windows' claims (nominations on the nights' copies) and the copies themselves.
 */
export function useAutoAwards(tripId) {
  const on = useFeature('dinner_awards');
  const [d, setD] = useState({ items: [], runs: [], points: [], noms: [], copies: [], awards: [], ready: false });
  const load = useCallback(async () => {
    if (!on || !tripId) { setD({ items: [], runs: [], points: [], noms: [], copies: [], awards: [], ready: true }); return; }
    const [rules, awards, runs, points] = await Promise.all([
      rowsOr(supabase.from('rules').select('*').not('award_kind', 'is', null)),
      rowsOr(supabase.from('dinner_awards').select('*').eq('trip_id', tripId)),
      rowsOr(supabase.from('award_runs').select('*').eq('trip_id', tripId).order('window_date')),
      rowsOr(supabase.from('cup_points').select('*').eq('trip_id', tripId)),
    ]);
    const copies = awards.filter((a) => a.parent_id);
    const noms = copies.length ? await rowsOr(supabase.from('dinner_award_nominations').select('*').in('award_id', copies.map((a) => a.id))) : [];
    const { list } = tripAwardList({ rules, awards: awards.filter((a) => !a.parent_id), tripId });
    const items = list.map((x) => ({ ...x, terms: autoTerms(x.award || { title: x.title, kind: x.kind }, x.rule) }));
    setD({ items, runs, points, noms, copies, awards, ready: true });
  }, [on, tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['award_runs', 'cup_points', 'dinner_awards', 'dinner_award_nominations'], load);
  return { ...d, on, reload: load };
}

// ------------------------------------------------------------------ claiming from a Feed post
/** For the Feed: the current trip's automatic awards, once for every post (not one load per post). */
export function useFeedClaims() {
  const data = useData();
  const trip = data.currentTrip || null;
  const aa = useAutoAwards(trip?.id || null);
  return { trip, aa };
}

/**
 * Under a Feed post: "🌙 Claim Latest out?" — one tap claims it for whoever posted it (you, or the mate in the photo
 * when you posted it — tap "Someone else"). Only during a claim window on the trip, before the morning's proposal.
 */
export function ClaimChips({ post, claims }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const [other, setOther] = useState(null);
  const trip = claims?.trip;
  const aa = claims?.aa;
  const list = useMemo(() => (aa?.ready && trip ? claimableFor(post, aa.items, aa.runs, trip) : []), [aa, trip, post]);
  const can = !status.viewing && status.role !== 'guest' && !!status.player_id;
  if (!can || !list.length || post.kind !== 'user') return null;
  const who = post.player_id || status.player_id;
  const claim = (c, pid) => run(async () => {
    const args = { p_post: post.id, ...(c.item.award ? { p_award: c.item.award.id } : { p_rule: c.item.rule.id }), ...(pid ? { p_player: pid } : {}) };
    const r = await must(supabase.rpc('award_claim_post', args));
    const name = playerName(data.playersById[r.player]) || 'them';
    toast(r.status === 'kept' ? `${name} already has a later claim (${clockAt(r.at)}) — kept` : `Claimed ${c.item.title} for ${name} — ${clockAt(r.at)}`);
    aa.reload();
  });
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="claim-chips">
      {list.map((c) => (
        <span key={c.item.key} className="row" style={{ gap: 4 }}>
          <button type="button" className="react" disabled={busy} onClick={() => claim(c, who)} data-testid="claim-award"
            style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', fontWeight: 800 }}>
            {c.item.terms.runs === 'night' ? '🌙' : '☀️'} Claim {c.item.title}{who !== status.player_id ? ` for ${playerName(data.playersById[who])}` : ''}?
          </button>
          <button type="button" className="react" disabled={busy} onClick={() => setOther(c)} aria-label={`Claim ${c.item.title} for someone else`} data-testid="claim-other">👤 Someone else</button>
        </span>
      ))}
      {other && (
        <Sheet title={`Claim ${other.item.title} for…`} onClose={() => setOther(null)}>
          <div className="stack" data-testid="claim-sheet">
            <span className="small muted">The time is when the post went up ({clockAt(post.server_at || post.created_at)}). The photo is the proof.</span>
            {data.players.filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b))).map((p) => (
              <button key={p.id} type="button" className="btn ghost block" style={{ justifyContent: 'flex-start', gap: 10 }} disabled={busy}
                onClick={async () => { await claim(other, p.id); setOther(null); }} data-testid="claim-for">
                <Avatar player={p} size={28} /> {playerName(p)}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ a run: the proposal and what people can do
/** The run's id from a proposal post's link ("/award-run/<id>"), or null. */
export const runIdFromLink = (link) => (typeof link === 'string' && link.startsWith('/award-run/') ? link.slice(11) : null);

function useRun1(runId) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    if (!runId) return;
    const { data: run } = await supabase.from('award_runs').select('*').eq('id', runId).maybeSingle();
    if (!run) { setD({ missing: true }); return; }
    const [src, points, rule] = await Promise.all([
      supabase.from('dinner_awards').select('*').eq('id', run.source_id).maybeSingle().then((x) => x.data),
      rowsOr(supabase.from('cup_points').select('*').eq('source_id', run.id)),
      run.rule_id ? supabase.from('rules').select('*').eq('id', run.rule_id).maybeSingle().then((x) => x.data) : Promise.resolve(null),
    ]);
    setD({ run, src, points, rule });
  }, [runId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['award_runs', 'cup_points'], load);
  return [d, load];
}

/**
 * The proposed (or decided) winner of one night / day / round: the ranked claims with their points, and
 * Confirm / pick another / No winner (organisers), Dispute (anyone but guests), and a dispute on one person's points.
 */
export function AwardRunCard({ runId, compact = false }) {
  const data = useData();
  const { status } = useSession();
  const [d, reload] = useRun1(runId);
  const [busy, run] = useRun();
  const [picking, setPicking] = useState(false);
  if (!d || d.missing || !d.run) return null;
  const r = d.run;
  const terms = autoTerms(d.src || {}, d.rule);
  const title = d.src?.title || 'Award';
  const roundName = (data.rounds || []).find((x) => x.id === r.round_id)?.name || 'the round';
  const nameOf = (id) => playerName(data.playersById[id]) || 'Someone';
  const member = !status.viewing && status.role !== 'guest' && !!status.player_id;
  const org = member && status.is_admin;
  const lines = Array.isArray(r.results) ? r.results : [];
  const lineOf = (pid) => d.points.find((p) => p.player_id === pid);
  const open = ['proposed', 'overturned'].includes(r.status);
  const act = (fn, ok) => run(async () => { await fn(); await reload(); }, ok);
  const confirm = (pick) => act(() => must(supabase.rpc('award_run_confirm', { p_run: r.id, ...(pick || {}) })), 'Confirmed — it’s on the Feed');
  const noWinner = () => window.confirm(`No winner for ${title}?`) && act(() => must(supabase.rpc('award_run_no_winner', { p_run: r.id })), 'No winner — nothing lands');
  const dispute = () => {
    const why = window.prompt(`Dispute ${title}: ${nameOf(r.player_id)}? Say why (optional) — the Tribunal decides.`, '');
    if (why === null) return;
    act(() => must(supabase.rpc('award_run_dispute', { p_run: r.id, p_reason: why || null })), 'Disputed — it’s with the Tribunal');
  };
  const disputeLine = (cp) => {
    const why = window.prompt(`Dispute ${nameOf(cp.player_id)}’s ${signedPoints(cp.points)}? Say why (optional).`, '');
    if (why === null) return;
    act(() => must(supabase.rpc('cup_points_dispute', { p_line: cp.id, p_reason: why || null })), 'Disputed — that line waits for the Tribunal');
  };
  return (
    <div className="card pad stack" style={{ gap: 8, background: r.status === 'confirmed' ? 'var(--gold-soft)' : undefined }} data-testid="award-run" data-status={r.status}>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <strong style={{ flex: '1 1 160px' }}>{r.kind === 'night' ? '🌙 ' : r.kind === 'day' ? '☀️ ' : '📊 '}{runLabel(r, title, roundName)}</strong>
        <span className="small" style={{ fontWeight: 800, whiteSpace: 'nowrap' }} data-testid="run-status">{RUN_STATUS[r.status] || r.status}</span>
      </div>
      {r.status === 'open' && <span className="small muted">Claims open {clockAt(r.opens_at)}–{clockAt(r.closes_at)} — post a photo and tap “Claim”. Proposed {clockAt(r.propose_at)}.</span>}
      {lines.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {lines.slice(0, compact ? 4 : 20).map((l, i) => {
            const cp = lineOf(l.player_id);
            const won = r.player_id === l.player_id && r.status !== 'no_winner';
            return (
              <div key={l.nomination_id || l.player_id || i} className="row between small" style={{ gap: 8, padding: '3px 0', borderTop: i ? '1px solid var(--line-soft)' : 0 }} data-testid="run-line">
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="muted">#{l.rank} </span><strong>{nameOf(l.player_id)}</strong>{won ? ' 🏆' : ''}
                  {l.display ? <span> · {l.display}</span> : null}{l.photo ? ' 📷' : ''}
                </span>
                {cp && <span style={{ fontWeight: 800, textDecoration: cp.waived_at ? 'line-through' : 'none' }} data-testid="run-points">{signedPoints(cp.points)}{!cp.confirmed_at && !cp.waived_at ? ' ⏳' : ''}</span>}
                {cp && member && !cp.confirmed_at && !cp.waived_at && !cp.case_id && (
                  <button type="button" className="btn ghost sm" style={{ minHeight: 28, padding: '0 8px' }} disabled={busy} onClick={() => disputeLine(cp)} data-testid="dispute-line" aria-label={`Dispute ${nameOf(l.player_id)}'s points`}>⚖️</button>
                )}
                {cp?.case_id && !cp.confirmed_at && !cp.waived_at && <Link to={`/tribunal/case/${cp.case_id}`} className="small">case</Link>}
                {org && picking && open && !won && (
                  <button type="button" className="btn gold sm" disabled={busy} onClick={() => confirm(l.nomination_id ? { p_nomination: l.nomination_id } : { p_player: l.player_id })} data-testid="pick-claim">Pick</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {r.worth && <span className="small">Worth: <strong>{r.worth}</strong>{r.reward_type === 'strokes' ? (r.adjust_state === 'applied' ? ' — on the next round’s card' : r.status === 'confirmed' ? ' — goes on their next round' : ' next round') : ''}</span>}
      {r.status === 'proposed' && <span className="small muted">Confirms itself at {clockAt(r.confirm_by)} unless someone disputes it.</span>}
      {r.status === 'disputed' && r.case_id && <Link to={`/tribunal/case/${r.case_id}`} className="small" style={{ fontWeight: 700 }}>⚖️ See the case →</Link>}
      {r.status === 'confirmed' && r.decided_how && <span className="small muted">Confirmed {r.decided_how === 'auto' ? 'at the deadline (nobody disputed it)' : r.decided_how === 'tribunal' ? 'after the Tribunal threw the dispute out' : 'by the organiser'}.</span>}
      {(open || (r.status === 'proposed' && member)) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {org && open && <button type="button" className="btn gold sm" disabled={busy || (r.status === 'overturned' && !picking)} onClick={() => (r.status === 'overturned' ? setPicking(true) : confirm())} data-testid="run-confirm">✅ Confirm {nameOf(r.player_id)}</button>}
          {org && open && lines.length > 1 && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setPicking((x) => !x)} data-testid="run-pick">{picking ? 'Cancel' : 'Pick another'}</button>}
          {org && open && <button type="button" className="btn ghost sm" disabled={busy} onClick={noWinner} data-testid="run-no-winner">No winner</button>}
          {member && r.status === 'proposed' && <button type="button" className="btn ghost sm" disabled={busy} onClick={dispute} data-testid="run-dispute">⚖️ Dispute</button>}
        </div>
      )}
    </div>
  );
}

/** /award-run/:runId — one run on its own (the proposal post's "Open"). */
export function AwardRunPage() {
  const { runId } = useParams();
  return (
    <div className="page">
      <Header back title="Awards and fines" />
      <div className="section stack"><AwardRunCard runId={runId} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ on the awards screen
/** "Each night" awards on a trip: how each runs, and every night's run (newest first). */
export function AutoAwardRuns({ trip }) {
  const aa = useAutoAwards(trip?.id);
  const auto = aa.items.filter((x) => x.terms.runs !== 'trip');
  if (!aa.on || !aa.ready || !auto.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="auto-award-runs">
      {auto.map((x) => {
        const runs = aa.runs.filter((r) => x.award && r.source_id === x.award.id).slice().reverse();
        return (
          <div key={x.key} className="card pad stack" style={{ gap: 6 }}>
            <div className="row between" style={{ gap: 8 }}>
              <strong>{x.kind === 'fine' ? '🏷' : '🏅'} {x.title}</strong>
              {x.worth && <span className="small" style={{ fontWeight: 800 }}>{x.worth}</span>}
            </div>
            <span className="small muted">{runsWords(x.terms)}{x.terms.points ? ` · ${pointsWords(x.terms.points, x.kind, x.terms.best, x.terms.number_unit)}` : ''}</span>
            {x.terms.runs !== 'round' && runs.length === 0 && <span className="small muted">Nothing claimed yet. Post a photo in the Feed between {clock(x.terms.window_from)} and {clock(x.terms.window_to)} and tap “Claim”.</span>}
            {runs.map((r) => <AwardRunCard key={r.id} runId={r.id} compact />)}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ the results page
/**
 * For the results page (ov28's TripResults) and the presentation: the automatic awards decided on the trip and the
 * points they put towards each cup. lines: resultLines(); tally: pointsTally() — both from lib/autoawards.js.
 */
export function useAutoAwardResults(trip) {
  const data = useData();
  const aa = useAutoAwards(trip?.id);
  return useMemo(() => {
    const titles = Object.fromEntries(aa.awards.map((a) => [a.id, a.title]));
    const kinds = Object.fromEntries(aa.awards.map((a) => [a.id, a.kind]));
    const roundNames = Object.fromEntries((data.rounds || []).map((r) => [r.id, r.name]));
    return { lines: resultLines(aa.runs, { titles, kinds, roundNames }), tally: pointsTally(aa.points), points: aa.points, ready: aa.ready && aa.on };
  }, [aa, data.rounds]);
}

export function AutoAwardResults({ trip }) {
  const data = useData();
  const res = useAutoAwardResults(trip);
  if (!res.ready || (!res.lines.length && !res.tally.length)) return null;
  const nameOf = (id) => playerName(data.playersById[id]) || 'Someone';
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="auto-award-results">
      <strong>🌙 Nightly awards and fines</strong>
      {res.lines.map((l) => (
        <div key={l.id} className="row between small" style={{ gap: 8 }} data-testid="auto-result-line">
          <span className="grow" style={{ minWidth: 0 }}>{l.kind === 'fine' ? '🏷' : '🏅'} {l.title}: <strong>{nameOf(l.player_id)}</strong></span>
          {l.worth && <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{l.worth}</span>}
        </div>
      ))}
      {res.tally.length > 0 && (
        <div className="small" data-testid="auto-points">
          <span className="label">Points from awards and fines</span>
          <div>{res.tally.map((t) => `${nameOf(t.player_id)} ${signedPoints(t.points)}`).join(' · ')}</div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ settings in the propose sheet
/** The automatic settings' starting values for a proposal (from an idea or nothing). */
export const AUTO_START = { runs: '', window_from: '', window_to: '', propose_time: '', from_scores: '', points_mode: 'none', points: {} };

/**
 * The columns the automatic settings add to a proposed rule (only those set): runs, window_from / window_to,
 * propose_time, from_scores, points. v: the sheet's state (AUTO_START keys + proof / best / award_kind / number_unit).
 */
export function autoRow(v) {
  const fromScores = v.from_scores || null;
  const pts = pointsOf(v);
  const out = {
    runs: fromScores ? null : v.runs || null,
    window_from: v.window_from || null, window_to: v.window_to || null, propose_time: v.propose_time || null,
    from_scores: fromScores, points: pts,
  };
  // Only what's set (a database before 100 doesn't have these columns; the defaults are the database's).
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x != null));
}
function pointsOf(v) {
  const p = v.points || {};
  if (v.points_mode === 'winner') return { mode: 'winner', points: Number(p.points) || 0 };
  if (v.points_mode === 'placings') return { mode: 'placings', places: String(p.places || '3,2,1').split(/[,\-\s/]+/).filter(Boolean).map(Number) };
  if (v.points_mode === 'per_unit') {
    const time = v.best === 'latest' || v.best === 'earliest';
    const out = { mode: 'per_unit', per: Number(p.per) || 1, size: Number(p.size) || 1, from: time ? p.from || '00:00' : Number(p.from) || 0, round: p.round || 'whole' };
    if (p.to !== '' && p.to != null) out.to = time ? p.to : Number(p.to);
    if (p.max !== '' && p.max != null) out.max = Number(p.max);
    return out;
  }
  return null;
}
/** '' or the reason the automatic settings can't be saved. */
export function autoProblem(v) {
  return checkPoints(pointsOf(v), v.best || null, v.from_scores || null);
}

/** "When it runs" and "Points towards a cup", inside the propose sheet. */
export function AutoSettings({ v, set }) {
  const t = autoTerms({ ...v, ...autoRow(v), points: null });
  const time = v.best === 'latest' || v.best === 'earliest';
  const p = v.points || {};
  const setP = (patch) => set({ points: { ...p, ...patch } });
  const autos = LIBRARY.filter((x) => x.scoring === 'auto');
  const pts = pointsOf(v);
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="auto-settings">
      <label className="field"><span>Worked out from the scores (optional)</span>
        <select className="select" value={v.from_scores || ''} onChange={(e) => set({ from_scores: e.target.value })} data-testid="from-scores">
          <option value="">No — people claim it</option>
          {autos.map((x) => <option key={x.key} value={x.key}>{x.emoji} {x.name}</option>)}
        </select>
      </label>
      {!v.from_scores && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">When it runs</span>
          <div className="chips">
            {RUNS.map((r) => (
              <button key={r.key} type="button" className="chip" aria-pressed={t.runs === r.key} onClick={() => set({ runs: r.key })} data-testid={`runs-${r.key}`}>{r.label}</button>
            ))}
          </div>
          {(t.runs === 'night' || t.runs === 'day') && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: 1, minWidth: 90 }}><span>Claims from</span><input className="input" type="time" value={v.window_from || t.window_from} onChange={(e) => set({ window_from: e.target.value })} /></label>
              <label className="field" style={{ flex: 1, minWidth: 90 }}><span>to</span><input className="input" type="time" value={v.window_to || t.window_to} onChange={(e) => set({ window_to: e.target.value })} /></label>
              <label className="field" style={{ flex: 1, minWidth: 90 }}><span>Proposed at</span><input className="input" type="time" value={v.propose_time || t.propose_time} onChange={(e) => set({ propose_time: e.target.value })} /></label>
            </div>
          )}
          {(t.runs === 'night' || t.runs === 'day') && <span className="small muted">A photo posted in the window gets a one-tap “Claim”. The best claim is proposed in the morning (or an hour before the first tee) — an organiser confirms, or it confirms itself at the first tee unless someone disputes it.</span>}
        </div>
      )}
      {v.from_scores && <span className="small muted">Proposed when the round’s finished ({findPreset(v.from_scores)?.blurb || ''}) — then confirmed or disputed the same way.</span>}
      <label className="field"><span>Points towards a cup</span>
        <select className="select" value={v.points_mode || 'none'} onChange={(e) => set({ points_mode: e.target.value })} data-testid="points-mode">
          {POINT_MODES.filter((m) => m.key !== 'per_unit' || (!v.from_scores && v.best)).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      {v.points_mode === 'winner' && <label className="field"><span>Points</span><input className="input" inputMode="decimal" value={p.points ?? ''} onChange={(e) => setP({ points: e.target.value.replace(/[^\d.]/g, '') })} data-testid="points-winner" /></label>}
      {v.points_mode === 'placings' && <label className="field"><span>Points for 1st, 2nd, 3rd…</span><input className="input" value={p.places ?? '3,2,1'} onChange={(e) => setP({ places: e.target.value })} placeholder="3,2,1" /></label>}
      {v.points_mode === 'per_unit' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 80 }}><span>Points</span><input className="input" inputMode="decimal" value={p.per ?? '1'} onChange={(e) => setP({ per: e.target.value })} /></label>
          <label className="field" style={{ flex: 1, minWidth: 80 }}><span>{time ? 'Per hours' : `Per ${v.number_unit || 'unit'}s`}</span><input className="input" inputMode="decimal" value={p.size ?? '1'} onChange={(e) => setP({ size: e.target.value })} /></label>
          <label className="field" style={{ flex: 1, minWidth: 90 }}><span>{time ? (v.best === 'latest' ? 'After' : 'Before') : (v.best === 'highest' ? 'Over' : 'Under')}</span>
            <input className="input" type={time ? 'time' : 'text'} inputMode={time ? undefined : 'decimal'} value={p.from ?? (time ? '00:00' : '')} onChange={(e) => setP({ from: e.target.value })} data-testid="points-from" /></label>
          <label className="field" style={{ flex: 1, minWidth: 90 }}><span>{time ? 'Nothing past' : 'Up to'}</span>
            <input className="input" type={time ? 'time' : 'text'} value={p.to ?? ''} onChange={(e) => setP({ to: e.target.value })} data-testid="points-to" /></label>
          <label className="field" style={{ flex: 1, minWidth: 80 }}><span>At most</span><input className="input" inputMode="decimal" value={p.max ?? ''} onChange={(e) => setP({ max: e.target.value })} /></label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={p.round === 'part'} onChange={(e) => setP({ round: e.target.checked ? 'part' : 'whole' })} /> <span className="small">Part {time ? 'hours' : 'units'} count</span></label>
        </div>
      )}
      {pts && !autoProblem(v) && <span className="small" data-testid="points-words">➕ {pointsWords(pts, v.award_kind, v.best, v.number_unit)}{v.award_kind === 'fine' ? ' (taken off)' : ''}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ from the scores: proposed when a round is finished
/**
 * Headless: when a round on the trip is finished and an award is "from the scores", any member's app works out the
 * standings (lib/sidecomplib.js — all the scoring maths stays there) and hands them to the server, which proposes
 * once per award per round (a second call does nothing).
 */
export function FromScoresProposer({ trip }) {
  const data = useData();
  const { status } = useSession();
  const aa = useAutoAwards(trip?.id);
  const member = !status.viewing && status.role !== 'guest' && !!status.player_id;
  const todo = useMemo(() => {
    if (!member || !aa.ready || !trip) return [];
    const auto = aa.items.filter((x) => x.terms.runs === 'round' && x.award);
    const rounds = (data.rounds || []).filter((r) => r.trip_id === trip.id && r.status === 'locked' && r.format !== 'ambrose');
    const out = [];
    for (const x of auto) for (const r of rounds) if (!aa.runs.some((run) => run.source_id === x.award.id && run.round_id === r.id)) out.push({ x, r });
    return out.slice(0, 4);
  }, [member, aa, trip, data.rounds]);
  const ids = useMemo(() => [...new Set(todo.map((t) => t.r.id))], [todo]);
  const scores = useScores(ids);
  const key = todo.map((t) => `${t.x.award.id}:${t.r.id}`).join(',');
  useEffect(() => {
    if (!todo.length || !scores?.index) return;
    let live = true;
    (async () => {
      for (const { x, r } of todo) {
        if (!live) return;
        if (!scores.index[r.id]) continue;
        const preset = findPreset(x.terms.from_scores);
        if (!preset) continue;
        const ctx = { round: r, teams: data.teamsByRound?.[r.id] || [], roundPlayers: data.roundPlayers?.[r.id] || [], playersById: data.playersById };
        const res = autoStandings({ metric: preset.settings.metric, basis: preset.settings.basis, format: r.format, holes: courseHoles(data.coursesById?.[r.course_id]),
          subjects: gameSubjects(ctx), scores: scores.index[r.id] || {}, locked: true });
        const rows = (res.rows || []).filter((s) => s.value != null && data.playersById[s.id]).map((s) => ({ player_id: s.id, value: s.value, display: s.display, rank: s.rank }));
        await supabase.rpc('award_propose_from_scores', { p_round: r.id, p_award: x.award.id, p_results: rows });
      }
      if (live) aa.reload();
    })();
    return () => { live = false; };
  }, [key, scores?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
