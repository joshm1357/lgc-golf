// Comps — what you're playing for (migration 067). The Comps screen (/comps-board: every comp of the trip, its
// standings and its to-do list), the guided setup's "What are you playing for?" step, the round card's "This round
// counts for…" line, and the standings view the Trophy Room reuses. All the maths is in lib/comps.js; the picker and
// editor are in CompPicker.jsx. (/comps is the side comps screen — a different thing.)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useScores, useSession, useRealtime, useFeature, playerName } from '../lib/store.jsx';
import { useRoundGames } from '../components/GamesChip.jsx';
import { useTripComps, useCompData } from '../components/CompsChip.jsx';
import { Header, AvatarStack, Loading } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import {
  COMP_TYPE, compStandings, compNeeds, needsSummary, actionPath, actionLabel, compRounds, roundComps, dayOf,
} from '../lib/comps.js';
import { pts } from '../lib/cup.js';
import CompEditor from './CompPicker.jsx';
import { RulesLink } from '../components/RulesLinks.jsx';
import RuleTag from '../components/RuleTag.jsx';
import { isDisputable } from '../lib/disputes.js';
import { pickActiveTrip } from '../lib/activetrip.js';
import YourRound from '../components/YourRound.jsx';
import { isCupComp } from '../lib/cups.js';
import { CupStandingsView } from '../components/CupStandings.jsx'; // ov32: a group cup's points, with the breakdown

// useCompData moved to components/CompsChip.jsx (ov15) so This trip can use it without loading this screen.
export { useCompData };

// ------------------------------------------------------------------ pieces

/** A comp's standings, the same look as the leaderboard. room: inside the Trophy Room. */
export function CompStandingsView({ comp, st, data, limit = 0, admin = false }) {
  const [all, setAll] = useState(false);
  if (comp.kind === 'cup') return <CupView st={st} />;
  if (st.cupKind && st.cupKind !== 'eclectic') return <CupStandingsView comp={comp} st={st} data={data} limit={limit} admin={admin} />;
  if (!st.rows.length) return <div className="card pad small muted">{st.empty || 'Nothing yet.'}</div>;
  const rows = limit && !all ? st.rows.slice(0, limit) : st.rows;
  const cols = st.rows.some((r) => r.byRound) && st.rounds.length > 1 ? st.rounds : [];
  const grid = `30px minmax(0,1fr) ${cols.map(() => '34px').join(' ')} 64px`;
  const showRound = (r, rd) => {
    const v = r.byRound?.[rd.id];
    if (v == null) return '–';
    return comp.kind === 'individual_net' || comp.kind === 'ambrose_teams' ? (v === 0 ? 'E' : v > 0 ? `+${v}` : `−${Math.abs(v)}`) : v;
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        {cols.length > 0 && (
          <div className="lb-row" style={{ gridTemplateColumns: grid, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
            <span>#</span><span>{COMP_TYPE[comp.kind]?.who === 'teams' && st.rows[0]?.players?.length > 1 ? 'Team' : 'Player'}</span>
            {cols.map((r) => <span key={r.id} style={{ textAlign: 'center' }} title={r.name}>{dayOf(r).slice(0, 3)}</span>)}
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>
        )}
        {rows.map((r, i) => {
          const inner = (
            <>
              <span className="lb-rank" style={{ fontSize: 18 }}>{r.rankLabel || i + 1}</span>
              <span className="row" style={{ gap: 8, minWidth: 0 }}>
                {r.players?.length ? <AvatarStack players={r.players} size={24} /> : null}
                <span className="lb-name ellipsis" style={{ fontSize: 15 }}>{r.name}</span>
              </span>
              {cols.map((rd) => <span key={rd.id} style={{ textAlign: 'center', fontWeight: 600, fontSize: 14 }}>{showRound(r, rd)}</span>)}
              <span className="lb-main" style={{ fontSize: 18 }}>{r.text}</span>
            </>
          );
          const style = { gridTemplateColumns: grid, color: 'inherit', textDecoration: 'none' };
          const cls = 'lb-row' + (i === 0 && r.value !== 0 ? ' lead' : '');
          return r.players?.length === 1 && data?.playersById?.[r.players[0]?.id]
            ? <Link key={r.id} to={`/player/${r.players[0].id}`} className={cls} style={style}>{inner}</Link>
            : <div key={r.id} className={cls} style={style}>{inner}</div>;
        })}
      </div>
      {limit > 0 && st.rows.length > limit && (
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${st.rows.length}`}</button>
      )}
      {comp.kind === 'side_comps' && st.results?.length > 0 && (
        <div className="small muted">{st.results.map((x) => `${x.label}: ${x.winner ? playerName(data?.playersById?.[x.winner]) : 'open'}`).join(' · ')}</div>
      )}
      {comp.kind === 'games' && <Link to="/games" className="small" style={{ fontWeight: 700 }}>Who pays who →</Link>}
    </div>
  );
}

function CupView({ st }) {
  if (!st.sides?.length || st.sides.length < 2) return <div className="card pad small muted">{st.empty || 'The two sides aren’t set up yet.'}</div>;
  const [A, B] = st.sides;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Link to="/cup" className="card pad" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, textAlign: 'center', textDecoration: 'none', color: 'inherit' }}>
        <div><div style={{ fontWeight: 800, color: A.colour }}>{A.name}</div><div style={{ fontSize: 34, fontWeight: 800, color: A.colour }}>{pts(st.won.a)}</div></div>
        <div className="small muted">{st.toWin ? <>{pts(st.toWin)}<br />to win</> : 'v'}</div>
        <div><div style={{ fontWeight: 800, color: B.colour }}>{B.name}</div><div style={{ fontSize: 34, fontWeight: 800, color: B.colour }}>{pts(st.won.b)}</div></div>
      </Link>
      {st.perRound.filter((p) => p.matches).map((p) => (
        <div key={p.round.id} className="small muted">{p.round.name}: {pts(p.won.a)} – {pts(p.won.b)} · {p.matches} match{p.matches === 1 ? '' : 'es'}</div>
      ))}
    </div>
  );
}

/** A comp's to-do list. onAction(action) can handle a button itself (return true); otherwise it's a link. */
export function CompTodo({ items, onAction, hideDone = false }) {
  const nav = useNavigate();
  const list = hideDone ? items.filter((i) => !i.done) : items;
  if (!list.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {list.map((i) => {
        const to = actionPath(i.action);
        return (
          <div key={i.key} className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, flex: 'none', borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800,
              background: i.done ? 'var(--gold)' : 'transparent', border: i.done ? 0 : '2px solid var(--line, #C9D0D8)' }}>{i.done ? '✓' : ''}</span>
            <span className={'grow small' + (i.done ? ' muted' : '')} style={{ fontWeight: i.done ? 400 : 700 }}>{i.text}</span>
            {!i.done && to && (
              <button type="button" className="btn ghost sm" style={{ flex: 'none' }} onClick={() => { if (!(onAction && onAction(i.action))) nav(to); }}>{actionLabel(i.action)}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function roundDays(comp, rounds) {
  const t = COMP_TYPE[comp.kind];
  if (t?.noRounds) return 'no rounds — you pick the winner';
  const rs = compRounds(comp, rounds);
  if (!rs.length) return 'No rounds yet';
  const days = rs.map(dayOf).join(', ');
  return comp.round_ids?.length ? days : `${days}${t?.formats ? ` (all ${t.formats.map((f) => ({ stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'stroke play', fourball: '4BBB' }[f])).join('/')} rounds)` : ''}`;
}

/** One comp: name, what it is, who leads, the standings and (organisers) the to-do list. */
export function CompCard({ comp, data, admin, open: startOpen = false, onEdit, onRemove, onAction }) {
  const [open, setOpen] = useState(startOpen);
  const st = useMemo(() => compStandings(comp, data), [comp, data]);
  const needs = useMemo(() => compNeeds(comp, data), [comp, data]);
  const sum = needsSummary(needs);
  const t = COMP_TYPE[comp.kind];
  return (
    <div className="card" id={`comp-${comp.id}`} style={{ overflow: 'hidden', borderColor: open ? 'var(--navy)' : undefined }}>
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ width: '100%', padding: 14, background: 'none', border: 0, gap: 12, textAlign: 'left', color: 'inherit', font: 'inherit' }}>
        <span aria-hidden="true" style={{ fontSize: 26 }}>{comp.trophy_id ? '🏆' : t?.emoji}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong>{comp.name}</strong>
          <div className="small muted ellipsis">{isCupComp(comp) ? (comp.settings.cup === 'eclectic' ? 'Group cup · eclectic' : 'Group cup · points') : `${t?.name} · ${roundDays(comp, data.rounds)}`}</div>
          {st.leaderText && <div className="small" style={{ fontWeight: 700, marginTop: 2 }}>{st.leaderText}</div>}
        </span>
        <span className="small" style={{ flex: 'none', fontWeight: 700, color: sum.todo && admin ? 'var(--navy)' : 'var(--muted)' }}>{admin && sum.text ? sum.text : open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="stack" style={{ padding: '0 14px 14px', gap: 10 }}>
          <CompStandingsView comp={comp} st={st} data={data} limit={8} admin={admin} />
          {st.note && <div className="small muted"><RuleTag testId="comp-rules" rule={isDisputable({ table: 'comps', id: comp.id, field: 'settings' })
            ? { table: 'comps', id: comp.id, field: 'settings', label: `${comp.name}: how it’s decided`, value: comp.settings || {}, where: { comp_id: comp.id, trip_id: comp.trip_id, path: `/comps-board?c=${comp.id}` } }
            : { table: 'standard', field: 'rule', key: `comp.${comp.kind}`, label: `${comp.name}: how it’s decided`, value: st.note, where: { path: '/comps-board' } }}
            explain={st.note}>{st.note}</RuleTag></div>}
          <div><RulesLink value={`comp:${comp.id}`} /></div>
          {admin && needs.length > 0 && (
            <>
              <span className="label">To do</span>
              <CompTodo items={needs} onAction={onAction} />
            </>
          )}
          {admin && (
            <div className="row" style={{ gap: 8 }}>
              {onEdit && <button type="button" className="btn ghost sm" onClick={() => onEdit(comp)}>Change</button>}
              {onRemove && <button type="button" className="btn ghost sm" onClick={() => onRemove(comp)}>Remove</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Retire a comp (nothing is deleted), and its trophy if the organiser says so (past winners stay on the honour board). */
export function useRemoveComp(reload) {
  const data = useData();
  const [busy, run] = useRun();
  const remove = (comp) => {
    const msg = comp.trophy_id
      ? `Remove ${comp.name}? Its trophy leaves this trip’s Trophy Room too. Past winners stay on the honour board.`
      : `Remove ${comp.name}? Scores, teams and matches stay — it just stops being something you play for.`;
    if (!window.confirm(msg)) return;
    run(async () => {
      if (!comp.virtual) await must(supabase.from('comps').update({ retired: true }).eq('id', comp.id));
      if (comp.trophy_id) await must(supabase.from('trophies').delete().eq('id', comp.trophy_id));
      await Promise.all([reload(), data.reload()]);
    }, 'Removed');
  };
  return [busy, remove];
}

// ------------------------------------------------------------------ the Comps screen

export default function CompsBoard() {
  const data = useData();
  const { status } = useSession();
  const [params] = useSearchParams();
  const asked = params.get('c');
  // A trip's comps (ov15: comps are part of the trip): ?trip=<id>, else the trip on now / next, else the current one.
  const askedTrip = params.get('trip');
  const trip = (askedTrip && data.trips?.find((t) => t.id === askedTrip))
    || (data.ready ? pickActiveTrip({ trips: data.trips, rounds: data.rounds })?.trip : null) || data.currentTrip;
  const [list, reload] = useTripComps(trip?.id);
  const cd = useCompData(trip?.id);
  const admin = !!status?.is_admin && !status?.viewing;
  const [editing, setEditing] = useState(null); // a comp, or 'new'
  const [, remove] = useRemoveComp(reload);
  const trophiesOn = useFeature('trophies');
  useEffect(() => {
    if (!asked) return undefined;
    const t = setTimeout(() => document.getElementById(`comp-${asked}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
    return () => clearTimeout(t);
  }, [asked]);
  if (!data.ready) return <Loading />;
  return (
    <div className="page">
      <Header back title="What we’re playing for" sub={trip ? trip.name : 'No trip yet'} />
      <div className="section stack" style={{ gap: 10, paddingBottom: 24 }}>
        {!trip && <div className="empty">No trip yet.{admin ? <> <Link to="/setup">Set up your trip</Link>.</> : ''}</div>}
        {/* ov28 (C1): your team, partner, opponents and tee time for the round that's on or next (nothing if none). */}
        {trip && <YourRound trip={trip} />}
        {trip && !list.length && (
          <div className="empty">
            Nothing to play for yet — just the round leaderboards.
            {admin && <div className="small" style={{ marginTop: 6 }}>Add a trophy over the weekend, Ambrose teams, a Cup, side comps…</div>}
          </div>
        )}
        {list.map((c) => (
          <CompCard key={c.id} comp={c} data={cd} admin={admin} open={asked ? asked === c.id : list.length === 1}
            onEdit={(x) => setEditing(x)} onRemove={remove} />
        ))}
        {admin && trip && (editing
          ? <CompEditor key={editing === 'new' ? 'new' : editing.id} trip={trip} comp={editing === 'new' ? null : editing} comps={list}
              onDone={() => { setEditing(null); reload(); }} />
          : <button type="button" className="btn gold block" onClick={() => setEditing('new')}>+ Add something to play for</button>)}
        {trophiesOn && <Link to="/trophies" className="small" style={{ fontWeight: 700 }}>The Trophy Room and honour boards →</Link>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the guided setup's step

/** "What are you playing for?" — the trip's comps with their to-do lists, and the picker. */
export function CompsStep({ trip, onStep }) {
  const [list, reload] = useTripComps(trip?.id);
  const cd = useCompData(trip?.id, { scores: false, entries: false });
  const [editing, setEditing] = useState(null);
  const [, remove] = useRemoveComp(reload);
  if (!trip) return <div className="small muted">Make the trip first (step 1).</div>;
  // Inside the guide, a few to-dos are its own steps.
  const onAction = (a) => {
    if (!onStep) return false;
    if (a.kind === 'add_round' || a.kind === 'round_format') { onStep('rounds'); return true; }
    if (a.kind === 'side_holes') { onStep('extras'); return true; }
    return false;
  };
  return (
    <>
      <span className="small muted">The trophies, teams and cups you’re playing for this trip. Each one shows what it still needs before its rounds.</span>
      {list.map((c) => (
        <div key={c.id} className="card pad stack" style={{ gap: 8, background: 'var(--ground)' }}>
          <div className="row" style={{ gap: 10 }}>
            <span aria-hidden="true" style={{ fontSize: 22 }}>{c.trophy_id ? '🏆' : COMP_TYPE[c.kind]?.emoji}</span>
            <span className="grow" style={{ minWidth: 0 }}><strong>{c.name}</strong><div className="small muted ellipsis">{COMP_TYPE[c.kind]?.name} · {roundDays(c, cd.rounds)}</div></span>
          </div>
          <CompTodo items={compNeeds(c, cd)} onAction={onAction} />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(c)}>Change</button>
            <button type="button" className="btn ghost sm" onClick={() => remove(c)}>Remove</button>
          </div>
        </div>
      ))}
      {editing
        ? <CompEditor key={editing === 'new' ? 'new' : editing.id} trip={trip} comp={editing === 'new' ? null : editing} comps={list} onStep={onStep}
            onDone={() => { setEditing(null); reload(); }} />
        : <button type="button" className="btn gold" onClick={() => setEditing('new')}>{list.length ? '+ Add another' : '+ Pick what you’re playing for'}</button>}
      {list.length > 0 && <Link to="/comps-board" className="small" style={{ fontWeight: 700 }}>See the standings →</Link>}
    </>
  );
}

// ------------------------------------------------------------------ the round card (Admin and the guided setup)

/** "This round counts for: BD Trophy, 6th Ryder Cup" and what those comps still need for this round. */
export function RoundCompsCard({ round }) {
  const [list] = useTripComps(round?.trip_id);
  const cd = useCompData(round?.trip_id, { scores: false, entries: false });
  if (!round) return null;
  const mine = roundComps(round, list, cd.rounds);
  if (!mine.length) return null;
  const items = mine.flatMap((c) => compNeeds(c, cd)
    .filter((i) => !i.done && (i.action?.roundId === round.id || (c.kind === 'cup' && !i.action?.roundId)))
    .map((i) => ({ ...i, key: `${c.id}-${i.key}`, text: c.kind === 'cup' ? i.text.replace(/^Cup: /, `${c.name}: `) : `${c.name} — ${i.text.replace(/^[A-Z][a-z]+day: /, '')}` })));
  return (
    <div className="card pad stack" style={{ gap: 6, background: '#fff' }}>
      <div className="small"><strong>This round counts for:</strong> {mine.map((c) => c.name).join(', ')}</div>
      {items.length ? <CompTodo items={items} /> : <div className="small muted">✓ Everything they need is set.</div>}
    </div>
  );
}

/** Admin: /admin?round=<id> scrolls to that round's card (from a to-do button). */
export function useScrollToRound(ready = true) {
  const [params] = useSearchParams();
  const id = params.get('round');
  useEffect(() => {
    if (!id || !ready) return undefined;
    const t = setTimeout(() => document.getElementById(`round-${id}`)?.scrollIntoView({ block: 'start' }), 350);
    return () => clearTimeout(t);
  }, [id, ready]);
}
