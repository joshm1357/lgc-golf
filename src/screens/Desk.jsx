// Stage 11c — the full desktop. Everything under #/desk:
//   /desk                 the Trip desk for the trip that matters now (the organiser's home on a laptop)
//   /desk/trip/:planId    the Trip desk for one trip
//   /desk/players         players & handicaps: a table to sort, filter, edit, and paste into
//   /desk/courses         paste a course scorecard
//   /desk/cards           paper cards: pick a round;  /desk/card/:roundId  type the cards in
//   /desk/present/:id     the leaderboard on a big screen ("Present")
//   /desk/print/:id       results and scorecards to print
// It works at any width (one column on a phone), but it's linked from the laptop sidebar only, so phones are unchanged.
// The working-out lives in lib/desk.js, lib/papercard.js and lib/paste.js.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { Avatar, AvatarStack, Loading, toast } from '../components/ui.jsx';
import { usePlanData, everyone, feedPost, shareNudge, useRun, must } from './Planner.jsx';
import { nudgeText, fmtRange, money, suggestions } from '../lib/plan.js';
import { STAGE_LABEL } from '../lib/trips.js';
import { notify, appLink } from '../lib/push.js';
import { pickDeskPlan, deskHeader, deskPanels, sortRows, nextSort, filterRows, costsCsv, csvName } from '../lib/desk.js';
import { setupSteps } from '../lib/setupguide.js';
import { formatName } from '../lib/board.js';
import { groupWhen } from '../lib/teegroups.js';
import { PlayersTable, CoursePaste } from './DeskTables.jsx';
import { PaperCard, CardPicker, PrintRound } from './PaperCard.jsx';
import { Present } from './Present.jsx';
import { DeskNav, download } from './DeskNav.jsx';
import './desk.css';

export default function DeskArea() {
  return (
    <Routes>
      <Route index element={<DeskHome />} />
      <Route path="trip/:planId" element={<TripDeskRoute />} />
      <Route path="players" element={<PlayersTable />} />
      <Route path="courses" element={<CoursePaste />} />
      <Route path="cards" element={<CardPicker />} />
      <Route path="card/:roundId" element={<PaperCard />} />
      <Route path="present" element={<Present />} />
      <Route path="present/:roundId" element={<Present />} />
      <Route path="print/:roundId" element={<PrintRound />} />
      <Route path="*" element={<DeskHome />} />
    </Routes>
  );
}

/** Plans for the trip switcher and for picking the one to open on. */
function usePlans() {
  const [plans, setPlans] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('plans').select('*').order('created_at', { ascending: false });
    setPlans(error ? [] : data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plans'], load);
  return plans;
}

function DeskHome() {
  const planner = useFeature('planner');
  const data = useData();
  const plans = usePlans();
  if (!planner) {
    return (
      <div className="page desk-page">
        <DeskNav />
        <div className="desk-head"><div className="hdr-title">Trip desk</div></div>
        <div className="section"><div className="empty">The Trips planner is switched off for this group, so there’s no Trip desk. Players, courses and paper cards are in the tabs above.</div></div>
      </div>
    );
  }
  if (!plans) return <div className="page desk-page"><DeskNav /><Loading /></div>;
  const plan = pickDeskPlan(plans, data.trips);
  if (!plan) {
    return (
      <div className="page desk-page">
        <DeskNav />
        <div className="desk-head"><div className="hdr-title">Trip desk</div><div className="hdr-sub">One screen for organising a trip.</div></div>
        <div className="section"><div className="empty">No trips yet. <Link to="/plan">Start one in Trips →</Link></div></div>
      </div>
    );
  }
  return <TripDesk key={plan.id} planId={plan.id} plans={plans} />;
}

function TripDeskRoute() {
  const { planId } = useParams();
  const plans = usePlans();
  return <TripDesk key={planId} planId={planId} plans={plans || []} />;
}

// ------------------------------------------------------------------ The Trip desk

function TripDesk({ planId, plans }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const pd = usePlanData(planId);
  const on = {
    tasks: useFeature('planner_tasks'), costs: useFeature('planner_costs'), rooms: useFeature('planner_rooms'),
    tribunal: useFeature('tribunal'), tee: useFeature('tee_groups'), replay: useFeature('replay'), cup: useFeature('cup'), side_comps: useFeature('side_comps'),
  };
  const people = everyone(data);
  const playerIds = people.map((p) => p.id);
  const panels = useMemo(() => (pd?.plan ? deskPanels(pd, { playerIds, me: status.player_id, isAdmin: !!status.is_admin }) : null),
    [pd, playerIds.join(','), status.player_id, status.is_admin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pd) return <div className="page desk-page"><DeskNav /><Loading /></div>;
  if (!pd.plan) return <div className="page desk-page"><DeskNav /><div className="empty">This trip has been removed. <Link to="/desk">Back to the Trip desk</Link></div></div>;
  const { plan } = pd;
  const trip = plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null;
  const head = deskHeader(plan, trip);
  const goTab = (tab) => nav(`/plan/${plan.id}?tab=${tab}`);
  const choices = (plans || []).filter((p) => p.status !== 'cancelled');
  return (
    <div className="page desk-page" data-testid="trip-desk">
      <DeskNav />
      <div className="desk-head">
        <div className="desk-head-main">
          <span className="desk-stage">{STAGE_LABEL[head.stage] || head.stage}</span>
          <h1 className="hdr-title desk-title">{plan.name}</h1>
          <div className="hdr-sub">{head.when} · {head.where}</div>
        </div>
        {head.count && <div className="desk-count" data-testid="desk-countdown">{head.count}</div>}
        <div className="desk-head-side no-print">
          {choices.length > 1 && (
            <select className="select desk-switch" aria-label="Switch trip" value={plan.id} onChange={(e) => nav(`/desk/trip/${e.target.value}`)}>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.start_date ? ` · ${fmtRange(p.start_date, p.end_date)}` : ''}</option>)}
            </select>
          )}
          <Link to={`/plan/${plan.id}`} className="btn ghost sm desk-ghost">Phone view</Link>
        </div>
      </div>
      <div className="desk-grid">
        <PeoplePanel pd={pd} p={panels.people} people={people} />
        {on.tasks && <VotesPanel pd={pd} p={panels.votes} goTab={goTab} />}
        {on.costs && <CostsPanel pd={pd} p={panels.costs} />}
        {on.tasks && <JobsPanel pd={pd} p={panels.jobs} goTab={goTab} />}
        {on.rooms && <RoomsPanel pd={pd} p={panels.rooms} goTab={goTab} />}
        <ChecklistPanel pd={pd} trip={trip} on={on} goTab={goTab} />
        <RoundsPanel plan={plan} trip={trip} on={on} />
        {on.tribunal && <TribunalPanel />}
      </div>
    </div>
  );
}

function Panel({ id, title, count, children, next, wide }) {
  return (
    <section className={'desk-panel' + (wide ? ' wide' : '')} data-testid={`panel-${id}`} aria-labelledby={`dp-${id}`}>
      <div className="desk-panel-hdr">
        <h2 id={`dp-${id}`}>{title}</h2>
        {count != null && <span className="desk-panel-count">{count}</span>}
      </div>
      <div className="desk-panel-body">{children}</div>
      {next && <div className="desk-panel-next">{next}</div>}
    </section>
  );
}

const names = (data, ids) => ids.map((id) => playerName(data.playersById[id])).join(', ');

function PeoplePanel({ pd, p }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const { plan } = pd;
  const lock = () => {
    if (!window.confirm(`Lock in the ${p.in.length} who are in? After this only you can change who’s coming.`)) return;
    run(async () => {
      await must(supabase.from('plans').update({ rsvp_locked: true, status: plan.status === 'planning' ? 'confirmed' : plan.status }).eq('id', plan.id));
      await feedPost(status.player_id, plan, `🔒 ${plan.name}: the list is locked — ${p.in.length} in: ${names(data, p.in)}.`);
      await notify('rsvp_locked', { plan_id: plan.id });
      pd.reload();
    }, 'Locked in — everyone’s been told');
  };
  const nudge = () => shareNudge(nudgeText('rsvp', { plan, names: p.noReply.map((id) => playerName(data.playersById[id])), url: appLink(`/plan/${plan.id}?tab=people`) }));
  return (
    <Panel id="people" title="🙋 Who’s in" count={`${p.in.length} in`}
      next={p.next && <button type="button" className="btn sm gold" disabled={busy} onClick={p.next.kind === 'lock' ? lock : nudge}>{p.next.label}</button>}>
      <div className="desk-stats">
        <Stat label="In" value={p.in.length} />
        <Stat label="Maybe" value={p.maybe.length} />
        <Stat label="Out" value={p.out.length} />
        <Stat label="No reply" value={p.noReply.length} warn={p.noReply.length > 0} />
      </div>
      {p.in.length > 0 && <div className="row" style={{ gap: 8, marginTop: 8 }}><AvatarStack players={p.in.map((id) => data.playersById[id]).filter(Boolean)} size={26} /><span className="small muted ellipsis">{names(data, p.in)}</span></div>}
      {p.noReply.length > 0 && <div className="small" style={{ marginTop: 6 }}><strong>Haven’t said:</strong> <span className="muted">{names(data, p.noReply)}</span></div>}
      {p.locked && <div className="small" style={{ marginTop: 6, fontWeight: 700 }}>🔒 The list is locked.</div>}
    </Panel>
  );
}

function Stat({ label, value, warn }) {
  return <div className={'desk-stat' + (warn ? ' warn' : '')}><span className="num">{value}</span><span className="small muted">{label}</span></div>;
}

function optionTitle(poll, o) {
  return poll.kind === 'dates' && o.start_date ? fmtRange(o.start_date, o.end_date) : o.label;
}

function VotesPanel({ pd, p, goTab }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const [pick, setPick] = useState({});
  const close = (v) => {
    const choice = pick[v.poll.id] || v.leading?.option.id || v.rows[0]?.option.id;
    const o = v.rows.find((r) => r.option.id === choice)?.option;
    if (!o) return;
    run(async () => {
      // One step on the server: closes the vote, records the winner and sets the trip's dates or place.
      await must(supabase.rpc('decide_poll', { p_poll: v.poll.id, p_option: o.id, p_apply: v.poll.kind !== 'other' }));
      await feedPost(status.player_id, pd.plan, `✅ ${pd.plan.name} — ${v.poll.question} ${optionTitle(v.poll, o)}.`);
      await notify('poll_decided', { poll_id: v.poll.id });
      pd.reload();
    }, 'Decided — everyone’s been told');
  };
  return (
    <Panel id="votes" title="🗳️ Votes" count={p.open.length ? `${p.open.length} open` : `${p.decided} decided`}
      next={!p.open.length && p.next ? <button type="button" className="btn sm gold" onClick={() => goTab('vote')}>{p.next.label}</button>
        : p.next?.kind === 'nudge-votes' ? <button type="button" className="btn sm ghost" onClick={() => shareNudge(nudgeText('votes', { plan: pd.plan, names: p.open[0].waiting.map((id) => playerName(data.playersById[id])), url: appLink(`/plan/${pd.plan.id}?tab=vote`) }))}>{p.next.label}</button> : null}>
      {!p.open.length && <div className="small muted">No votes open.</div>}
      {p.open.map((v) => (
        <div key={v.poll.id} className="desk-vote" data-testid="desk-vote">
          <div style={{ fontWeight: 800 }}>{v.poll.question}</div>
          <table className="desk-table compact">
            <tbody>
              {v.rows.slice(0, 4).map((r) => (
                <tr key={r.option.id}>
                  <td>{r.leading ? '★ ' : ''}{optionTitle(v.poll, r.option)}</td>
                  <td className="num-cell">{r.score} pts</td>
                  <td className="small muted num-cell">✓{r.yes.length} ?{r.maybe.length} ✗{r.no.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.waiting.length > 0 && <div className="small muted">Still to vote: {names(data, v.waiting)}</div>}
          {p.canDecide && v.rows.length > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <select className="select grow" aria-label={`Winner for ${v.poll.question}`} value={pick[v.poll.id] || v.leading?.option.id || v.rows[0].option.id} onChange={(e) => setPick({ ...pick, [v.poll.id]: e.target.value })}>
                {v.rows.map((r) => <option key={r.option.id} value={r.option.id}>{optionTitle(v.poll, r.option)} · {r.score} pts</option>)}
              </select>
              <button type="button" className="btn sm gold" disabled={busy} onClick={() => close(v)}>Close & pick</button>
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

function JobsPanel({ pd, p, goTab }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const [title, setTitle] = useState('');
  const input = useRef(null);
  const add = () => {
    const t = title.trim();
    if (!t) return;
    run(async () => { await must(supabase.from('plan_items').insert({ plan_id: pd.plan.id, kind: 'job', title: t })); setTitle(''); pd.reload(); }, 'Job added');
  };
  return (
    <Panel id="jobs" title="📋 Jobs" count={`${p.open.length} to do`}
      next={p.next.tab ? <button type="button" className="btn sm ghost" onClick={() => goTab('jobs')}>{p.next.label}</button> : null}>
      {p.open.length === 0 && <div className="small muted">Nothing to do. {p.done ? `${p.done} done ✓` : ''}</div>}
      <ul className="desk-list">
        {p.open.slice(0, 8).map((j) => (
          <li key={j.id}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={false} disabled={busy} aria-label={`Done: ${j.title}`}
                onChange={() => run(async () => { await must(supabase.from('plan_items').update({ done: true }).eq('id', j.id)); pd.reload(); }, 'Nice work ✓')} />
              <span className="grow">{j.title}</span>
              <span className="small muted">{j.owner_id ? playerName(data.playersById[j.owner_id]) : 'no owner'}</span>
            </label>
          </li>
        ))}
      </ul>
      {p.open.length > 8 && <div className="small muted">and {p.open.length - 8} more</div>}
      {(status.is_admin || status.player_id) && (
        <form className="row" style={{ gap: 8, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input ref={input} className="input grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a job…" aria-label="New job" />
          <button className="btn sm" disabled={busy || !title.trim()}>Add</button>
        </form>
      )}
    </Panel>
  );
}

function CostsPanel({ pd, p }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [busy, run] = useRun();
  const [sort, setSort] = useState({ key: 'created_at', dir: 'asc' });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // { id, field, value }
  const [fresh, setFresh] = useState({ title: '', amount: '' });
  const newRef = useRef(null);
  const inIds = pd.rsvps.filter((r) => r.status === 'in').map((r) => r.player_id);
  const who = (id) => (id === 'kitty' ? 'the kitty' : playerName(data.playersById[id]));
  // "n" on the desk: start a new cost.
  useEffect(() => {
    const f = () => newRef.current?.focus();
    window.addEventListener('tgt:new', f);
    return () => window.removeEventListener('tgt:new', f);
  }, []);
  const rows = pd.costs.map((c) => {
    const n = (c.split_between && c.split_between.length ? c.split_between.length : inIds.length) || 1;
    const total = c.per_head ? Number(c.amount) * n : Number(c.amount);
    return { ...c, total, each: c.per_head ? Number(c.amount) : total / n, payer: c.paid_by ? who(c.paid_by) : 'Kitty / not paid', split: c.split_between?.length ? `${n} chosen` : `Everyone in (${n})` };
  });
  const shown = sortRows(filterRows(rows, q, ['title', 'payer', 'note']), sort.key, sort.dir);
  const canEdit = (c) => status.is_admin || (c.paid_by && c.paid_by === me);
  const save = (c, patch) => run(async () => { await must(supabase.from('plan_costs').update(patch).eq('id', c.id)); pd.reload(); }, 'Saved');
  const commit = () => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    const c = pd.costs.find((x) => x.id === e.id);
    if (!c) return;
    if (e.field === 'amount') {
      const amount = Number(String(e.value).replace(/[^0-9.]/g, ''));
      if (!(amount > 0)) { toast('An amount is a number more than 0'); return; }
      if (amount !== Number(c.amount)) save(c, { amount });
    } else if (e.field === 'title') {
      const t = String(e.value).trim();
      if (t && t !== c.title) save(c, { title: t });
    }
  };
  const add = () => {
    const amount = Number(String(fresh.amount).replace(/[^0-9.]/g, ''));
    if (!fresh.title.trim() || !(amount > 0)) { toast('Type what it’s for and an amount'); return; }
    run(async () => {
      await must(supabase.from('plan_costs').insert({ plan_id: pd.plan.id, title: fresh.title.trim(), amount, per_head: false, paid_by: status.is_admin ? null : me, split_between: null }));
      setFresh({ title: '', amount: '' });
      pd.reload();
      newRef.current?.focus();
    }, 'Cost added');
  };
  const head = (key, label, cls) => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-btn" onClick={() => setSort(nextSort(sort, key))}>{label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );
  const cell = (c, field, text) => {
    if (editing?.id === c.id && editing.field === field) {
      return <input className="input cell-input" autoFocus value={editing.value} aria-label={`Edit ${field}`}
        onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />;
    }
    return canEdit(c)
      ? <button type="button" className="cell-btn" title="Click to edit" onClick={() => setEditing({ id: c.id, field, value: field === 'amount' ? String(Number(c.amount)) : c.title })}>{text}</button>
      : text;
  };
  return (
    <Panel id="costs" title="💰 Costs" count={money(p.total)} wide
      next={<>
        {p.next.kind === 'nudge-kitty' && <button type="button" className="btn sm ghost" onClick={() => shareNudge(nudgeText('kitty', { plan: pd.plan, names: p.owing.map((x) => who(x.player_id)), url: appLink(`/plan/${pd.plan.id}?tab=kitty`) }))}>{p.next.label}</button>}
        <button type="button" className="btn sm ghost" disabled={!pd.costs.length} onClick={() => download(csvName(pd.plan.name), costsCsv({ plan: pd.plan, costs: pd.costs, payments: pd.payments, transfers: pd.transfers, inIds, nameOf: who }))}>⬇ Export CSV</button>
        <Link to={`/plan/${pd.plan.id}?tab=kitty`} className="btn sm ghost">Split & payments →</Link>
      </>}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input className="input grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter costs" aria-label="Filter costs" data-search />
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>To settle: <strong>{money(p.toCollect)}</strong></span>
      </div>
      <div className="desk-scroll">
        <table className="desk-table" data-testid="costs-table">
          <thead><tr>{head('title', 'What')}{head('total', 'Total', 'num-cell')}{head('split', 'Split')}{head('payer', 'Paid by')}{head('each', 'Each', 'num-cell')}</tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} data-testid="cost-row">
                <td>{cell(c, 'title', c.title)}{c.note ? <div className="small muted">{c.note}</div> : null}</td>
                <td className="num-cell">{cell(c, 'amount', c.per_head ? `${money(c.amount)} pp` : money(c.amount))}</td>
                <td className="small">{c.split}</td>
                <td className="small">{status.is_admin
                  ? <select className="select cell-select" aria-label={`Who paid ${c.title}`} value={c.paid_by || ''} onChange={(e) => save(c, { paid_by: e.target.value || null })}>
                      <option value="">Kitty / not paid</option>
                      {everyone(data).map((pl) => <option key={pl.id} value={pl.id}>{playerName(pl)}</option>)}
                    </select>
                  : c.payer}</td>
                <td className="num-cell">{money(Math.round(c.each * 100) / 100)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={5} className="small muted">{q ? 'No costs match.' : 'No costs yet.'}</td></tr>}
          </tbody>
          <tfoot>
            <tr className="add-row">
              <td><input ref={newRef} className="input cell-input" value={fresh.title} onChange={(e) => setFresh({ ...fresh, title: e.target.value })} placeholder="New cost — what for" aria-label="New cost: what for"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /></td>
              <td><input className="input cell-input num-input" inputMode="decimal" value={fresh.amount} onChange={(e) => setFresh({ ...fresh, amount: e.target.value })} placeholder="$" aria-label="New cost: amount"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /></td>
              <td className="small muted">Everyone in</td>
              <td className="small muted">{status.is_admin ? 'Kitty' : 'You'}</td>
              <td><button type="button" className="btn sm" disabled={busy} onClick={add}>Add</button></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {p.settle.length > 0 && (
        <div className="desk-owes" data-testid="who-owes">
          <span className="label">Who pays whom</span>
          {p.settle.map((s, i) => <div key={i} className="small"><strong>{who(s.from)}</strong> → {who(s.to)} <strong>{money(s.amount)}</strong></div>)}
        </div>
      )}
    </Panel>
  );
}

function RoomsPanel({ pd, p, goTab }) {
  const data = useData();
  const kinds = pd.plan.kind === 'round' ? ['car'] : ['room', 'car'];
  return (
    <Panel id="rooms" title="🛏️ Rooms & cars" next={p.next && <button type="button" className="btn sm ghost" onClick={() => goTab('groups')}>{p.next.label}</button>}>
      {kinds.map((k) => {
        const x = p[k];
        const w = k === 'room' ? ['room', 'rooms', 'beds'] : ['car', 'cars', 'seats'];
        return (
          <div key={k} className="small" style={{ marginBottom: 6 }}>
            <strong>{x.count} {x.count === 1 ? w[0] : w[1]}</strong> · {x.spaces} {w[2]} · {x.placed} placed
            {x.unplaced.length > 0 && <div className="muted">Not placed: {names(data, x.unplaced)}</div>}
          </div>
        );
      })}
    </Panel>
  );
}

function ChecklistPanel({ pd, trip, on, goTab }) {
  const data = useData();
  const { status } = useSession();
  const steps = trip ? setupSteps(data, { cup: on.cup, side_comps: on.side_comps }, trip) : [];
  const ideas = status.is_admin ? suggestions(pd.plan, { ...pd, playerIds: everyone(data).map((p) => p.id) }).slice(0, 4) : [];
  const done = steps.filter((s) => s.done).length;
  return (
    <Panel id="checklist" title="📝 Organiser checklist" count={trip ? `${done} of ${steps.length}` : null}
      next={trip && steps.some((s) => !s.done && !s.optional) ? <Link to="/setup" className="btn sm gold">Set up the trip →</Link> : null}>
      {trip ? (
        <ul className="desk-list">
          {steps.map((s) => (
            <li key={s.key} className={s.done ? 'done' : ''}>
              <span className="tick" aria-hidden="true">{s.done ? '✓' : '○'}</span>
              <span className="grow"><strong>{s.title}</strong>{s.optional ? <span className="small muted"> · optional</span> : null}<div className="small muted">{s.summary}</div></span>
            </li>
          ))}
        </ul>
      ) : <div className="small muted">Rounds, courses and players get set up once the trip is locked in.</div>}
      {ideas.length > 0 && (
        <>
          <span className="label" style={{ display: 'block', marginTop: 10 }}>Worth doing</span>
          <ul className="desk-list">
            {ideas.map((s) => (
              <li key={s.key}>
                <span className="grow">{s.title} <span className="small" style={{ color: s.when === 'Overdue' ? 'var(--under)' : 'var(--muted)', fontWeight: 700 }}>· {s.when}</span></span>
                <button type="button" className="btn ghost sm" onClick={() => goTab(s.tab)}>Go</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function RoundsPanel({ plan, trip, on }) {
  const data = useData();
  const rounds = trip ? data.rounds.filter((r) => r.trip_id === trip.id) : [];
  const ids = rounds.map((r) => r.id);
  const [tee, setTee] = useState({});
  const load = useCallback(async () => {
    if (!on.tee || !ids.length) { setTee({}); return; }
    const { data: rows, error } = await supabase.from('tee_groups').select('*').in('round_id', ids);
    if (error) return;
    const by = {};
    for (const r of rows || []) (by[r.round_id] ||= []).push(r);
    for (const k of Object.keys(by)) by[k].sort((a, b) => a.group_no - b.group_no);
    setTee(by);
  }, [ids.join(','), on.tee]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['tee_groups'], load);
  return (
    <Panel id="rounds" title="⛳ Rounds & tee times" count={rounds.length ? `${rounds.length}` : null} wide
      next={trip ? <Link to="/setup" className="btn sm ghost">Add or change rounds →</Link> : null}>
      {!trip && <div className="small muted">{plan.status === 'confirmed' ? 'This trip isn’t set up in the app yet.' : 'Rounds come once the trip is locked in.'}</div>}
      {trip && !rounds.length && <div className="small muted">No rounds yet.</div>}
      {rounds.map((r) => {
        const course = data.coursesById[r.course_id];
        const groups = tee[r.id] || [];
        return (
          <div key={r.id} className="desk-round" data-testid="desk-round">
            <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{r.name}</strong>
                <div className="small muted">{[r.play_date && fmtRange(r.play_date), course?.name, formatName(r.format), r.status === 'live' ? '🔴 live' : r.status === 'locked' ? 'final' : 'not started'].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Link className="btn sm" to={`/desk/card/${r.id}`}>Paper cards</Link>
                <Link className="btn sm ghost" to={`/desk/present/${r.id}`}>Present</Link>
                <Link className="btn sm ghost" to={`/desk/print/${r.id}`}>Print</Link>
                {on.replay && r.status === 'locked' && <Link className="btn sm ghost" to={`/replay/${r.id}`}>Replay</Link>}
              </div>
            </div>
            {groups.length > 0 && (
              <div className="desk-tee">
                {groups.map((g) => <div key={g.id} className="small"><strong>{groupWhen(g)}</strong> {g.player_ids.map((id) => playerName(data.playersById[id])).join(', ')}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function TribunalPanel() {
  const data = useData();
  const [cases, setCases] = useState(null);
  const load = useCallback(async () => {
    const { data: rows, error } = await supabase.from('tribunal_cases').select('*').eq('status', 'open').order('created_at', { ascending: false });
    setCases(error ? [] : rows || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['tribunal_cases'], load);
  return (
    <Panel id="tribunal" title="⚖️ Tribunal" count={cases ? `${cases.length} open` : null}
      next={<Link to="/tribunal" className="btn sm ghost">Open the Tribunal →</Link>}>
      {!cases && <div className="small muted">Loading…</div>}
      {cases && !cases.length && <div className="small muted">No open cases.</div>}
      <ul className="desk-list">
        {(cases || []).map((c) => {
          const p = data.playersById[c.accused_id];
          return (
            <li key={c.id}>
              <Avatar player={p} size={26} />
              <span className="grow"><Link to={`/tribunal/${c.id}`}><strong>{playerName(p)}</strong></Link> <span className="small muted">· {Number(c.proposed_change) > 0 ? '+' : ''}{Number(c.proposed_change)} proposed</span>
                <div className="small muted ellipsis">{c.case_text}</div></span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

