// Tee groups (migration 056, feature 'tee_groups'): the organiser makes fair groups of four for a round, swaps
// anyone by tapping two names, and saves them with tee times; players see "Your group: 8:16 with Al, Bo and Cy" on
// the leaderboard. All the maths is in lib/teegroups.js.
//  - TeeGroupsCard: one round's tee groups, for Admin → Rounds (one line in RoundCard).
//  - TeeGroupsForTrip: every round of a trip, for the guided setup (one line).
//  - TeeGroupsBoard: "Your group" and the list of groups, near the top of the leaderboard.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useFeature, playerName } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { Seg, toast } from '../components/ui.jsx';
import { shareText } from '../lib/push.js';
import {
  roundTeeInputs, pastPartners, makeTeeGroups, buildBlocks, scoringContext, scoreGroups, explain, swapPlayers, rowsToSave,
  teeTimes, timeSettings, groupWhen, myGroupLine, shareTeeText, showTime, pairKey,
} from '../lib/teegroups.js';

/** Saved tee groups for these rounds, live: { [round_id]: rows sorted by group_no }. */
export function useTeeRows(roundIds) {
  const ids = (roundIds || []).filter(Boolean);
  const key = ids.join(',');
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!ids.length) { setRows([]); return; }
    try {
      const { data, error } = await supabase.from('tee_groups').select('*').in('round_id', ids);
      if (!error && data) setRows(data);
    } catch { /* keep what we have */ }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['tee_groups'], load);
  const byRound = useMemo(() => {
    const out = {};
    for (const r of rows) (out[r.round_id] ||= []).push(r);
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.group_no - b.group_no);
    return out;
  }, [rows]);
  return [byRound, load];
}

// The organiser's "keep together" / "keep apart" pairs live on this phone only (a feud stays private).
const rulesKey = (tripId) => `tgt-tee-rules-${tripId || 'x'}`;
function readRules(tripId) {
  try {
    const v = JSON.parse(localStorage.getItem(rulesKey(tripId)) || 'null');
    return { together: Array.isArray(v?.together) ? v.together : [], apart: Array.isArray(v?.apart) ? v.apart : [] };
  } catch { return { together: [], apart: [] }; }
}
function writeRules(tripId, rules) {
  try { localStorage.setItem(rulesKey(tripId), JSON.stringify(rules)); } catch { /* fine: just not remembered */ }
}

function useNames() {
  const data = useData();
  return useCallback((id) => playerName(data.playersById[id]), [data.playersById]);
}

// ------------------------------------------------------------------ Organiser: one round
export function TeeGroupsCard({ round, startOpen = false }) {
  const on = useFeature('tee_groups');
  if (!on || !round) return null;
  return <TeeGroupsCardInner round={round} startOpen={startOpen} />;
}

function TeeGroupsCardInner({ round, startOpen }) {
  const data = useData();
  // Every round of the trip: earlier rounds' groups are the partners to avoid.
  const tripRoundIds = useMemo(() => data.rounds.filter((r) => r.trip_id === round.trip_id).map((r) => r.id), [data.rounds, round.trip_id]);
  const [byRound, reload] = useTeeRows(tripRoundIds);
  const rows = byRound[round.id] || [];
  return (
    <details className="card pad" style={{ background: '#fff' }} open={startOpen || undefined} data-testid="tee-card">
      <summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>
        ⛳ Tee groups <span className="small muted" style={{ fontWeight: 400 }}>{rows.length ? `· ${rows.length} saved${rows[0].tee_time ? `, first off ${showTime(rows[0].tee_time)}` : ''}` : '· not made yet'}</span>
      </summary>
      <TeeGroupsEditor round={round} byRound={byRound} reload={reload} />
    </details>
  );
}

function TeeGroupsEditor({ round, byRound, reload }) {
  const data = useData();
  const cupOn = useFeature('cup');
  const nameOf = useNames();
  const [busy, run] = useRun();
  const saved = byRound[round.id] || [];
  const [matches, setMatches] = useState([]);
  useEffect(() => {
    if (!cupOn) { setMatches([]); return; }
    supabase.from('cup_matches').select('*').eq('round_id', round.id).then(({ data: m }) => setMatches(m || []), () => setMatches([]));
  }, [cupOn, round.id]);
  const [oneMatch, setOneMatch] = useState(false);
  const [rules, setRules] = useState(() => readRules(round.trip_id));
  const [times, setTimes] = useState(null);
  const t = times || timeSettings(saved);
  const [draft, setDraft] = useState(null); // { groups, seed }
  const [picked, setPicked] = useState(null);

  const inputs = useMemo(() => roundTeeInputs({
    round, roundPlayers: data.roundPlayers[round.id] || [], teams: data.teamsByRound[round.id] || [], matches, playersById: data.playersById,
  }), [round, data.roundPlayers, data.teamsByRound, data.playersById, matches]);
  const history = useMemo(() => pastPartners({ round, rounds: data.rounds, teeRowsByRound: byRound, teamsByRound: data.teamsByRound }), [round, data.rounds, byRound, data.teamsByRound]);
  const opts = { ...inputs, oneMatchPerGroup: oneMatch, together: rules.together, apart: rules.apart, history };
  // What the score is measured against: who must stay together, earlier partners, keep-aparts.
  const scoring = useMemo(() => {
    const { blocks, notes } = buildBlocks({ playerIds: inputs.players.map((p) => p.id), units: inputs.units, matches: inputs.matches, together: rules.together, oneMatchPerGroup: oneMatch });
    return { ctx: scoringContext({ players: inputs.players, blocks, history, apart: rules.apart }), notes };
  }, [inputs, rules, oneMatch, history]);

  const generate = (seed) => {
    const res = makeTeeGroups({ ...opts, seed });
    setDraft({ groups: res.groups, seed });
    setPicked(null);
  };
  const tap = (id) => {
    if (!picked || picked === id) { setPicked(picked === id ? null : id); return; }
    const sameGroup = draft.groups.some((g) => g.includes(picked) && g.includes(id));
    if (sameGroup) { setPicked(id); return; }
    setDraft({ ...draft, groups: swapPlayers(draft.groups, picked, id) });
    toast(`Swapped ${nameOf(picked)} and ${nameOf(id)}`);
    setPicked(null);
  };
  const save = () => run(async () => {
    const rows = rowsToSave(round.id, draft.groups, t);
    await must(supabase.from('tee_groups').upsert(rows, { onConflict: 'round_id,group_no' }));
    await must(supabase.from('tee_groups').delete().eq('round_id', round.id).gt('group_no', rows.length));
    await reload();
    setDraft(null);
    setTimes(null);
  }, 'Tee groups saved — the lads see theirs on the leaderboard');
  const share = async () => {
    const res = await shareText(shareTeeText({ round, rows: saved, nameOf, courseName: data.coursesById[round.course_id]?.name }), `${round.name} — tee groups`);
    if (res === 'copied') toast('Copied — paste it in the group chat');
    else if (res === 'failed') toast('Couldn’t share from this phone');
  };

  if (inputs.players.length < 2) {
    return <div className="small muted" style={{ marginTop: 8 }}>Add who’s playing first ({round.format === 'ambrose' ? 'the teams' : round.format === 'fourball' ? 'the pairs' : 'the players'}), then make the tee groups here.</div>;
  }

  const score = draft ? scoreGroups(draft.groups, scoring.ctx) : null;
  const words = score ? explain(score, nameOf, { notes: scoring.notes, hasApart: rules.apart.length > 0, groups: draft.groups }) : [];
  const previewTimes = draft ? teeTimes(draft.groups.length, t) : [];

  return (
    <div className="stack" style={{ marginTop: 10, gap: 10 }}>
      {!draft && saved.length > 0 && (
        <>
          <SavedList rows={saved} nameOf={nameOf} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" onClick={share}>Share the list</button>
            <button type="button" className="btn ghost sm" onClick={() => { setDraft({ groups: saved.map((r) => r.player_ids), seed: 1 }); setTimes(timeSettings(saved)); }}>Swap players</button>
            <button type="button" className="btn ghost sm" onClick={() => generate(1)}>Make new groups</button>
          </div>
        </>
      )}
      {!draft && !saved.length && (
        <>
          <span className="small muted">{inputs.players.length} playing. Makes groups of four (threes when the numbers need it), with new partners each day and handicaps mixed{inputs.units.length ? `; ${round.format === 'fourball' ? 'pairs' : 'teams'} stay together` : ''}{inputs.matches.length ? '; Cup matches stay together' : ''}.</span>
          <button type="button" className="btn gold" onClick={() => generate(1)}>Make tee groups</button>
        </>
      )}
      {inputs.matches.length > 0 && (
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={oneMatch} onChange={(e) => { setOneMatch(e.target.checked); if (draft) setDraft(null); }} />
          <span>One Cup match a group (instead of two singles together)</span>
        </label>
      )}
      <KeepRules players={inputs.players.map((p) => p.id)} rules={rules} nameOf={nameOf} onChange={(next) => {
        setRules(next);
        writeRules(round.trip_id, next);
        if (draft) setDraft({ groups: makeTeeGroups({ ...opts, together: next.together, apart: next.apart, seed: draft.seed }).groups, seed: draft.seed });
      }} />
      {draft && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <Seg light value={t.mode} onChange={(mode) => setTimes({ ...t, mode })} options={[{ value: 'times', label: 'Tee times' }, { value: 'shotgun', label: 'Shotgun start' }]} />
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow"><span>{t.mode === 'shotgun' ? 'Everyone tees off at' : 'First group off'}</span>
                <input className="input" type="time" value={t.first || ''} onChange={(e) => setTimes({ ...t, first: e.target.value })} aria-label="First tee time" />
              </label>
              {t.mode === 'times' && (
                <label className="field" style={{ width: 110 }}><span>Minutes apart</span>
                  <input className="input" inputMode="numeric" value={String(t.gap)} onChange={(e) => setTimes({ ...t, gap: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) })} aria-label="Minutes apart" />
                </label>
              )}
            </div>
          </div>
          <div className="card pad small" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', lineHeight: 1.5 }} data-testid="tee-explain">
            {words.map((w, i) => <span key={i}>{i ? ' · ' : ''}{w.ok ? '✓' : '⚠️'} {w.text}</span>)}
          </div>
          <span className="small muted">Tap two players in different groups to swap them.</span>
          {draft.groups.map((g, i) => (
            <div key={i} className="card pad stack" style={{ gap: 6, background: 'var(--ground)' }} data-testid="tee-draft-group">
              <div className="row between">
                <strong>{groupWhen({ group_no: i + 1, ...previewTimes[i] })}</strong>
                <span className="small muted">avg hcp {Math.round(score.averages[i] * 10) / 10}</span>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {g.map((id) => (
                  <button key={id} type="button" className="chip" aria-pressed={picked === id} onClick={() => tap(id)}>
                    {nameOf(id)} <span style={{ opacity: 0.7, fontWeight: 400 }}>{fmtHcp(scoring.ctx.hcp[id])}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn gold" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save tee groups'}</button>
            <button type="button" className="btn ghost sm" onClick={() => generate(draft.seed + 1)}>🔀 Shuffle again</button>
            <button type="button" className="btn ghost sm" onClick={() => { setDraft(null); setTimes(null); setPicked(null); }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

const fmtHcp = (h) => (h == null ? '' : h < 0 ? `+${-h}` : String(h));

function SavedList({ rows, nameOf }) {
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="tee-saved">
      {rows.map((r) => (
        <div key={r.group_no} className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <strong style={{ minWidth: 64 }}>{groupWhen(r)}</strong>
          <span className="small grow">{r.player_ids.map(nameOf).join(', ')}</span>
        </div>
      ))}
    </div>
  );
}

function KeepRules({ players, rules, nameOf, onChange }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const sorted = [...players].sort((x, y) => nameOf(x).localeCompare(nameOf(y)));
  const add = (kind) => {
    if (!a || !b || a === b) return;
    const k = pairKey(a, b);
    const strip = (list) => list.filter(([x, y]) => pairKey(x, y) !== k);
    onChange({ together: strip(rules.together), apart: strip(rules.apart), [kind]: [...strip(rules[kind]), [a, b]] });
    setA(''); setB('');
  };
  const remove = (kind, i) => onChange({ ...rules, [kind]: rules[kind].filter((_, j) => j !== i) });
  const inRound = new Set(players);
  const count = rules.together.length + rules.apart.length;
  return (
    <details>
      <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>Keep together / keep apart{count ? ` (${count})` : ''}</summary>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        <span className="small muted">E.g. two in the same car, or two who shouldn’t share a cart. Kept on this phone only — nobody else sees them.</span>
        {rules.together.map(([x, y], i) => inRound.has(x) && inRound.has(y) && (
          <div key={`t${i}`} className="row small" style={{ gap: 8 }}><span className="grow">🤝 {nameOf(x)} & {nameOf(y)} together</span><button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => remove('together', i)}>✕</button></div>
        ))}
        {rules.apart.map(([x, y], i) => inRound.has(x) && inRound.has(y) && (
          <div key={`a${i}`} className="row small" style={{ gap: 8 }}><span className="grow">↔️ {nameOf(x)} & {nameOf(y)} apart</span><button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => remove('apart', i)}>✕</button></div>
        ))}
        <div className="row" style={{ gap: 6 }}>
          <select className="select grow" value={a} onChange={(e) => setA(e.target.value)} aria-label="First player"><option value="">Player…</option>{sorted.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</select>
          <select className="select grow" value={b} onChange={(e) => setB(e.target.value)} aria-label="Second player"><option value="">Player…</option>{sorted.filter((id) => id !== a).map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</select>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn ghost sm grow" disabled={!a || !b} onClick={() => add('together')}>Keep together</button>
          <button type="button" className="btn ghost sm grow" disabled={!a || !b} onClick={() => add('apart')}>Keep apart</button>
        </div>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ Guided setup: every round of the trip
export function TeeGroupsForTrip({ trip }) {
  const data = useData();
  const on = useFeature('tee_groups');
  if (!on || !trip) return null;
  const rounds = data.rounds.filter((r) => r.trip_id === trip.id && r.status !== 'locked');
  if (!rounds.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">Tee groups</span>
      {rounds.map((r) => (
        <div key={r.id} className="stack" style={{ gap: 4 }}>
          <span className="small"><strong>{r.name}</strong></span>
          <TeeGroupsCard round={r} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Leaderboard: your group, and all of them
export function TeeGroupsBoard({ round }) {
  const on = useFeature('tee_groups');
  if (!on || !round || round.status === 'locked') return null;
  return <TeeGroupsBoardInner round={round} />;
}

function TeeGroupsBoardInner({ round }) {
  const data = useData();
  const { status } = useSession();
  const nameOf = useNames();
  const [byRound] = useTeeRows([round.id]);
  const rows = byRound[round.id] || [];
  if (!rows.length) return null;
  const mine = status?.player_id ? myGroupLine(rows, status.player_id, nameOf) : null;
  const share = async () => {
    const res = await shareText(shareTeeText({ round, rows, nameOf, courseName: data.coursesById[round.course_id]?.name }), `${round.name} — tee groups`);
    if (res === 'copied') toast('Copied — paste it in the group chat');
    else if (res === 'failed') toast('Couldn’t share from this phone');
  };
  return (
    <div className="section stack" style={{ gap: 8 }}>
      {mine && (
        <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }} data-testid="tee-mine">
          <strong>Your group:</strong> {mine}
        </div>
      )}
      <details className="card pad">
        <summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 28 }}>⛳ All tee groups ({rows.length})</summary>
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          <SavedList rows={rows} nameOf={nameOf} />
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={share}>Share the list</button>
        </div>
      </details>
    </div>
  );
}
