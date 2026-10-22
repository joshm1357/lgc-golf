// The side comps library (migration 068): "Add from the list" for organisers, the dots tally (+1 per player) and the
// comps worked out from the scores, inside the Comps screen. All the rules are in lib/sidecomplib.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useScores, playerName } from '../lib/store.jsx';
import { sendOrQueue, outboxPending, onOutboxChange } from '../lib/outbox.js';
import { Avatar, Sheet, toast, timeAgo } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { courseHoles } from '../lib/board.js';
import { gameSubjects } from '../lib/games.js';
import {
  LIB_GROUPS, findPreset, searchLibrary, wonText, holesLabel, defFromPreset, roundsToAdd, defaultHoles,
  tallyStandings, lastDotFor, autoStandings, previousRounds,
} from '../lib/sidecomplib.js';

// ------------------------------------------------------------------ Organiser: add from the list
/** "Add from the list": a picker of ready-made comps. Adding one switches it on for the trip's rounds (default holes). */
export function CompLibrary({ defs, reload, trip }) {
  const data = useData();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [busy, run] = useRun();
  const t = trip || data.currentTrip;
  const rounds = t ? (data.rounds || []).filter((r) => r.trip_id === t.id) : [];
  const live = new Set(defs.filter((d) => d.preset && !d.retired).map((d) => d.preset));
  const list = searchLibrary(q, group);

  const add = (preset) => run(async () => {
    let def = defs.find((d) => d.preset === preset.key && !d.retired);
    if (!def) {
      const put = defs.find((d) => d.preset === preset.key && d.retired);
      if (put) {
        await must(supabase.from('side_comp_defs').update({ retired: false }).eq('id', put.id));
        def = put;
      } else {
        const { data: row, error } = await supabase.from('side_comp_defs').insert(defFromPreset(preset)).select().single();
        if (error) throw error;
        def = row;
      }
    }
    const changes = roundsToAdd(rounds, def.id, preset, data.coursesById);
    for (const c of changes) await must(supabase.from('rounds').update({ own_comps: c.own_comps }).eq('id', c.round.id));
    await reload();
    if (changes.length) await data.reload();
    const where = changes.length ? ` — on ${changes.map((c) => c.round.name).join(', ')}` : '';
    const holes = changes.length && preset.holes !== 'whole' && preset.scoring !== 'auto' ? ` (${holesLabel(preset).toLowerCase()})` : '';
    toast(`${preset.emoji} ${preset.name} added${where}${holes}`);
  });

  return (
    <>
      <button type="button" className="btn gold block" onClick={() => setOpen(true)}>📋 Add from the list</button>
      {open && (
        <Sheet title="Add a side comp" onClose={() => setOpen(false)}>
          <div className="stack" style={{ gap: 10 }}>
            <input className="input" type="search" aria-label="Search side comps" placeholder="Search — sandy, birdies, par 3…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chips" style={{ padding: '0 0 2px' }} role="group" aria-label="Kind of comp">
              {[{ key: 'all', short: 'All' }, ...LIB_GROUPS].map((g) => (
                <button key={g.key} type="button" className="chip" aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>{g.short}</button>
              ))}
            </div>
            {rounds.length > 0
              ? <div className="small muted">Adding one switches it on for {t?.name || 'this trip'}’s rounds, on the usual holes. Change the holes in each round’s settings.</div>
              : <div className="small muted">No rounds yet — added comps can be switched on for a round in its settings.</div>}
            {!list.length && <div className="empty">Nothing matches “{q}”. Try “Make your own” below.</div>}
            {LIB_GROUPS.map((g) => {
              const items = list.filter((p) => p.group === g.key);
              if (!items.length) return null;
              return (
                <div key={g.key} className="stack" style={{ gap: 8 }}>
                  <div><span className="label">{g.label}</span><div className="small muted">{g.blurb}</div></div>
                  {items.map((p) => {
                    const added = live.has(p.key);
                    const sample = rounds[0] ? defaultHoles(p, data.coursesById[rounds[0].course_id]) : [];
                    return (
                      <div key={p.key} className="card pad row" style={{ gap: 10, alignItems: 'flex-start' }} data-preset={p.key}>
                        <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">{p.emoji}</span>
                        <div className="grow stack" style={{ gap: 2 }}>
                          <strong>{p.name}</strong>
                          <span className="small">{p.blurb}</span>
                          <span className="small muted">🏆 {wonText(p)}.</span>
                          <span className="small muted">⛳ {holesLabel(p)}{sample.length ? ` (${sample.join(', ')})` : ''}</span>
                        </div>
                        <button type="button" className={'btn sm' + (added ? ' ghost' : ' gold')} style={{ minWidth: 72, minHeight: 44 }} disabled={busy || added}
                          aria-label={added ? `${p.name} added` : `Add ${p.name}`} onClick={() => add(p)}>{added ? 'Added ✓' : 'Add'}</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Dots: a big +1 per player
export function TallyComp({ round, comp, playerIds }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState([]);
  const [hole, setHole] = useState(null);
  const [busy, setBusy] = useState(false);
  const snake = comp.scoring === 'count_last';
  const load = useCallback(async () => {
    const { data: r, error } = await supabase.from('side_comp_entries').select('*').eq('round_id', round.id).eq('comp_id', comp.id).order('created_at');
    if (!error) setRows(r || []);
  }, [round.id, comp.id]);
  const loadPending = useCallback(() => setPending(outboxPending('side_comp_entries').filter((e) => e.round_id === round.id && e.comp_id === comp.id)), [round.id, comp.id]);
  useEffect(() => { load(); loadPending(); }, [load, loadPending]);
  useEffect(() => onOutboxChange(() => { loadPending(); load(); }), [load, loadPending]);
  useRealtime(['side_comp_entries'], load);

  const entries = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    return [...rows, ...pending.filter((p) => !ids.has(p.id))];
  }, [rows, pending]);
  const ids = [...new Set([...playerIds, ...(playerIds.length ? [] : [me])])].filter(Boolean);
  const names = Object.fromEntries(Object.values(data.playersById || {}).map((p) => [p.id, playerName(p)]));
  const t = tallyStandings(entries, { scoring: comp.scoring, playerIds: ids, names });
  const canLog = round.status !== 'locked' && !status.viewing;
  const penalty = findPreset(comp.preset)?.group === 'penalty';

  const plusOne = async (playerId) => {
    setBusy(true);
    try {
      const res = await sendOrQueue('side_comp_entries', {
        round_id: round.id, comp_id: comp.id, hole: hole ?? null, player_id: playerId, value: 1, note: null, photo_url: null,
        created_by: me, created_at: new Date().toISOString(),
      });
      const who = playerName(data.playersById[playerId]);
      if (!res.sent) toast(`No signal — ${who}’s dot is saved on your phone and sends when signal’s back`);
      else {
        toast(snake ? `${comp.emoji || '🐍'} ${who} holds it now` : `${comp.emoji || ''} +1 ${who}`.trim());
        if (snake && t.holder !== playerId) {
          sendOrQueue('posts', { kind: 'user', player_id: me, round_id: round.id, trip_id: round.trip_id, hole: hole ?? null, body: `${comp.emoji || '🐍'} ${who} now holds ${comp.name.toLowerCase().startsWith('the ') ? comp.name.toLowerCase() : comp.name}` }).catch(() => {});
        }
      }
      loadPending();
      load();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  const minusOne = async (playerId) => {
    const mine = rows.filter((e) => e.created_by === me || status.is_admin);
    const last = lastDotFor(mine, playerId);
    if (!last) { toast('Nothing of yours to take off'); return; }
    const { error } = await supabase.from('side_comp_entries').delete().eq('id', last.id);
    if (error) toast(friendlyError(error)); else { toast('Took one off'); load(); }
  };

  const holder = t.holder ? data.playersById[t.holder] : null;
  const leaders = t.leaders.map((id) => data.playersById[id]).filter(Boolean);
  return (
    <div className="section stack">
      {snake ? (
        holder ? (
          <div className="card pad row" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', gap: 12 }}>
            <Avatar player={holder} size={56} />
            <div className="grow"><div className="label" style={{ color: '#5A4300' }}>Holding {comp.name.toLowerCase().startsWith('the ') ? comp.name.toLowerCase() : comp.name}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{playerName(holder)}</div><div className="small muted">since {timeAgo(t.since)}</div></div>
            <span style={{ fontSize: 40 }} aria-hidden="true">{comp.emoji || '🐍'}</span>
          </div>
        ) : <div className="empty">Nobody holds it yet. First to {comp.preset === 'snake' ? 'three-putt' : 'do it'} takes it.</div>
      ) : leaders.length ? (
        <div className="card pad row" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', gap: 12 }}>
          <Avatar player={leaders[0]} size={56} />
          <div className="grow"><div className="label" style={{ color: '#5A4300' }}>{penalty ? 'Most (for laughs)' : 'Leader'}{leaders.length > 1 ? ` — ${leaders.length} tied` : ''}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{leaders.map(playerName).join(', ')}</div></div>
          <span className="num" style={{ fontSize: 40, lineHeight: 1 }}>{t.rows[0].count}</span>
        </div>
      ) : <div className="empty">No {comp.name.toLowerCase()}s yet. Tap +1 when it happens.</div>}

      {comp.holes.length > 0 && canLog && (
        <div className="chips" style={{ padding: 0 }} role="group" aria-label="Which hole (optional)">
          <button type="button" className="chip" aria-pressed={hole == null} onClick={() => setHole(null)}>Any hole</button>
          {comp.holes.map((n) => <button key={n} type="button" className="chip" aria-pressed={hole === n} onClick={() => setHole(n)}>Hole {n}</button>)}
        </div>
      )}

      <div className="card" data-tally={comp.id}>
        {t.rows.map((r) => {
          const p = data.playersById[r.id];
          const waiting = pending.filter((x) => x.player_id === r.id).length;
          return (
            <div key={r.id} className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-soft)', gap: 10 }} data-player={r.id}>
              <Avatar player={p} size={36} />
              <span className="grow ellipsis"><strong>{playerName(p)}</strong>{snake && t.holder === r.id ? ` ${comp.emoji || '🐍'}` : ''}
                {waiting > 0 && <span className="small muted"> · {waiting} waiting to send</span>}</span>
              <span className="num" style={{ fontSize: 26, minWidth: 28, textAlign: 'right' }} aria-label={`${playerName(p)} has ${r.count}`}>{r.count}</span>
              {canLog && r.count > 0 && <button type="button" className="btn ghost sm" aria-label={`Take one off ${playerName(p)}`} onClick={() => minusOne(r.id)}>−1</button>}
              {canLog && <button type="button" className="btn gold" style={{ minWidth: 64, minHeight: 52, fontSize: 20 }} disabled={busy} aria-label={`+1 ${playerName(p)}`} onClick={() => plusOne(r.id)}>+1</button>}
            </div>
          );
        })}
      </div>
      <p className="note" style={{ margin: 0 }}>{comp.emoji} {findPreset(comp.preset)?.blurb || ''} {wonText(comp)}. Works with no signal — dots send when it’s back.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Worked out from the scores
export function AutoComp({ round, comp }) {
  const data = useData();
  const metric = comp.settings?.metric;
  const tripRounds = useMemo(() => (metric === 'improved' ? (data.rounds || []).filter((r) => r.trip_id === round.trip_id) : [round]), [metric, data.rounds, round]);
  const scores = useScores(tripRounds.map((r) => r.id));
  const ctxFor = (r) => ({ round: r, teams: data.teamsByRound?.[r.id] || [], roundPlayers: data.roundPlayers?.[r.id] || [], playersById: data.playersById });
  const holes = courseHoles(data.coursesById?.[round.course_id]);
  const subjects = gameSubjects(ctxFor(round));
  const prev = metric === 'improved'
    ? previousRounds(round, tripRounds.filter((r) => r.id !== round.id).map((r) => ({ round: r, holes: courseHoles(data.coursesById?.[r.course_id]), subjects: gameSubjects(ctxFor(r)), scores: scores.index[r.id] || {} })))
    : {};
  const res = autoStandings({ metric, basis: comp.settings?.basis, format: round.format, holes, subjects, scores: scores.index[round.id] || {}, locked: round.status === 'locked', prev });
  if (res.skipped) return <div className="section"><div className="empty">{res.skipped}</div></div>;
  if (!res.holes) return <div className="section"><div className="empty">This course has no holes for this comp (e.g. no back 9).</div></div>;
  const leaders = res.leaders.map((id) => data.playersById[id]).filter(Boolean);
  const lead = res.rows.find((r) => r.id === res.leaders[0]);
  return (
    <div className="section stack">
      {leaders.length ? (
        <div className="card pad row" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', gap: 12 }}>
          <Avatar player={leaders[0]} size={56} />
          <div className="grow"><div className="label" style={{ color: '#5A4300' }}>{res.final ? 'Winner' : 'Leader'}{leaders.length > 1 ? ` — ${leaders.length} tied` : ''}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{leaders.map(playerName).join(', ')}</div></div>
          <span className="num" style={{ fontSize: 26, lineHeight: 1, textAlign: 'right' }}>{lead?.display}</span>
        </div>
      ) : <div className="empty">No scores yet — standings appear as scores go in.</div>}
      <div className="card" data-auto={comp.id}>
        {res.rows.map((r) => (
          <div key={r.id} className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', gap: 10 }}>
            <span className="num" style={{ width: 28, fontSize: 16 }}>{r.rankLabel}</span>
            <Avatar player={data.playersById[r.id]} size={32} />
            <span className="grow ellipsis"><strong>{r.name}</strong>{r.value != null && r.thru < res.holes ? <span className="small muted"> · thru {r.thru} of {res.holes}</span> : null}</span>
            <span className="num" style={{ fontSize: 18 }}>{r.display}</span>
          </div>
        ))}
      </div>
      <p className="note" style={{ margin: 0 }}>{wonText(comp)} — live, nothing to enter.{round.format === 'fourball' ? ' In 4BBB each player’s own ball counts.' : ''}</p>
    </div>
  );
}
