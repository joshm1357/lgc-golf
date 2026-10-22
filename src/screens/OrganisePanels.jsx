// Trips → a trip → Organise, on a laptop (1024 px and up), for the trip's organisers: what was the Trip desk
// (Stage 11c). Since the Organise tidy-up (ov14, 22 Oct) the panels sit where they belong instead of all down the right:
//   OrganiseSide    the slim right-hand column: the trip at a glance and trip switcher, who's in, open votes (status only)
//   CostsPanel      the costs table (sort, filter, edit in place, CSV, who pays whom) — Jobs & money → Kitty
//   RoundsPanel     rounds & tee times with paper cards, Present and Print — the On the day step
//   ChecklistPanel  the set-up checklist and "worth doing" — the On the day step
//   TribunalPanel   open Tribunal cases — Organise → More
// The working-out lives in lib/desk.js. Old /desk addresses forward from screens/Desk.jsx.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { Avatar, AvatarStack, toast } from '../components/ui.jsx';
import { everyone, shareNudge, useRun, must } from './Planner.jsx';
import { nudgeText, fmtRange, money, suggestions } from '../lib/plan.js';
import { STAGE_LABEL } from '../lib/trips.js';
import { appLink } from '../lib/push.js';
import { deskHeader, deskPanels, sortRows, nextSort, filterRows, costsCsv, csvName, TOOL } from '../lib/desk.js';
import { setupSteps } from '../lib/setupguide.js';
import { formatName } from '../lib/board.js';
import { groupWhen } from '../lib/teegroups.js';
import { download } from './DeskNav.jsx';
import { useLateJobs } from '../components/LateJobs.jsx';
import { lateJobs } from '../lib/latejobs.js';
import './desk.css';

/** Plans for the trip switcher. */
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

/** The feature switches the panels follow. */
export function usePanelFeatures() {
  return {
    tasks: useFeature('planner_tasks'), costs: useFeature('planner_costs'), rooms: useFeature('planner_rooms'),
    tribunal: useFeature('tribunal'), tee: useFeature('tee_groups'), replay: useFeature('replay'), cup: useFeature('cup'), side_comps: useFeature('side_comps'),
  };
}

/**
 * The slim right-hand column of Organise on a laptop (ov14, 22 Oct): status only — the trip at a glance (with the trip
 * switcher), who's in, and the open votes. No buttons to compete with the step's one big button; tapping a vote opens
 * its step. pd: the plan's data; onStep(key) opens a step.
 */
export function OrganiseSide({ pd, onStep }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const plans = usePlans();
  const people = everyone(data);
  const playerIds = people.map((p) => p.id);
  const panels = useMemo(() => deskPanels(pd, { playerIds, me: status.player_id, isAdmin: !!status.is_admin }),
    [pd, playerIds.join(','), status.player_id, status.is_admin]); // eslint-disable-line react-hooks/exhaustive-deps
  const { plan } = pd;
  const trip = plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null;
  const head = deskHeader(plan, trip);
  const choices = (plans || []).filter((p) => p.status !== 'cancelled');
  return (
    <aside className="org-side" aria-label="The trip at a glance" data-testid="organise-panels">
      <div className="org-glance">
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="desk-stage">{STAGE_LABEL[head.stage] || head.stage}</span>
          <div className="small muted" style={{ marginTop: 4 }}>{head.when} · {head.where}</div>
        </div>
        {head.count && <div className="desk-count" data-testid="desk-countdown">{head.count}</div>}
        {choices.length > 1 && (
          <select className="select desk-switch" aria-label="Switch trip" value={plan.id} onChange={(e) => nav(TOOL.organise(e.target.value))}>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.start_date ? ` · ${fmtRange(p.start_date, p.end_date)}` : ''}</option>)}
          </select>
        )}
      </div>
      <PeoplePanel p={panels.people} />
      <VotesPanel p={panels.votes} onStep={onStep} />
      <LatePanel pd={pd} onStep={onStep} />
    </aside>
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

function PeoplePanel({ p }) {
  const data = useData();
  return (
    <Panel id="people" title="🙋 Who’s in" count={`${p.in.length} in`}>
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

/** Late jobs at a glance (085): how many, whose. Tap to open Jobs & money → Jobs (the badges and Waive are there). */
function LatePanel({ pd, onStep }) {
  const data = useData();
  const late = useLateJobs();
  const list = late.rule ? lateJobs(pd.items.filter((i) => i.kind === 'job'), late.rule, { penalties: late.penalties, adjustments: late.adjustments }).filter((x) => !x.info.waived) : [];
  if (!list.length) return null;
  return (
    <Panel id="late" title="⚠️ Late jobs" count={String(list.length)}>
      <button type="button" className="org-vote-btn small" onClick={() => onStep?.('money', 'jobs')}>
        {list.map(({ job, info }) => `${job.title} (${playerName(data.playersById[job.owner_id])}, ${info.daysLate} days)`).join(' · ')}
      </button>
    </Panel>
  );
}

/** Open votes at a glance: the leader and who's still to vote. Tap one to open its step. */
function VotesPanel({ p, onStep }) {
  const data = useData();
  return (
    <Panel id="votes" title="🗳️ Open votes" count={p.open.length ? `${p.open.length} open` : `${p.decided} decided`}>
      {!p.open.length && <div className="small muted">No votes open.</div>}
      {p.open.map((v) => (
        <button key={v.poll.id} type="button" className="desk-vote org-vote-btn" data-testid="desk-vote" onClick={() => onStep?.(v.poll.purpose === 'stay' ? 'courses' : 'area')}>
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
        </button>
      ))}
    </Panel>
  );
}

/**
 * The costs table (Kitty tab, laptop, organisers): sort, filter, edit in place, add with the keyboard, CSV, who pays
 * whom. focusAt: when "n" was pressed (the new-cost box takes the cursor if that was just now).
 */
export function CostsPanel({ pd, focusAt = 0, owes = true }) {
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
  const p = useMemo(() => deskPanels(pd, { playerIds: everyone(data).map((x) => x.id), me, isAdmin: !!status.is_admin }).costs, [pd, data, me, status.is_admin]);
  // "n" on Organise: start a new cost.
  useEffect(() => {
    if (focusAt && Date.now() - focusAt < 2000) newRef.current?.focus();
  }, [focusAt]);
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
    <Panel id="costs" title="💰 Costs table" count={money(p.total)} wide
      next={<>
        {p.next.kind === 'nudge-kitty' && <button type="button" className="btn sm ghost" onClick={() => shareNudge(nudgeText('kitty', { plan: pd.plan, names: p.owing.map((x) => who(x.player_id)), url: appLink(`/plan/${pd.plan.id}?tab=kitty`) }))}>{p.next.label}</button>}
        <button type="button" className="btn sm ghost" disabled={!pd.costs.length} onClick={() => download(csvName(pd.plan.name), costsCsv({ plan: pd.plan, costs: pd.costs, payments: pd.payments, transfers: pd.transfers, inIds, nameOf: who }))}>⬇ Export CSV</button>
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
      {owes && p.settle.length > 0 && (
        <div className="desk-owes" data-testid="who-owes">
          <span className="label">Who pays whom</span>
          {p.settle.map((s, i) => <div key={i} className="small"><strong>{who(s.from)}</strong> → {who(s.to)} <strong>{money(s.amount)}</strong></div>)}
        </div>
      )}
    </Panel>
  );
}

export function ChecklistPanel({ pd, trip, on, goTab, ideasToo = true }) {
  const data = useData();
  const { status } = useSession();
  const steps = trip ? setupSteps(data, { cup: on.cup, side_comps: on.side_comps }, trip) : [];
  const ideas = status.is_admin && ideasToo ? suggestions(pd.plan, { ...pd, playerIds: everyone(data).map((p) => p.id) }).slice(0, 4) : [];
  const done = steps.filter((s) => s.done).length;
  return (
    <Panel id="checklist" title="📝 Organiser checklist" count={trip ? `${done} of ${steps.length}` : null}
      next={trip && steps.some((s) => !s.done && !s.optional) ? <Link to="/setup" className="btn sm ghost">Set up the trip →</Link> : null}>
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

export function RoundsPanel({ plan, trip, on }) {
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
                <Link className="btn sm" to={TOOL.card(r.id)}>Paper cards</Link>
                <Link className="btn sm ghost" to={TOOL.present(r.id)}>Present</Link>
                <Link className="btn sm ghost" to={TOOL.print(r.id)}>Print</Link>
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

export function TribunalPanel() {
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

/** The On the day step on a laptop: rounds & tee times (paper cards, Present, Print) and the set-up checklist. */
export function DayPanels({ pd, trip, goTab }) {
  const on = usePanelFeatures();
  return (
    <div className="stack" style={{ gap: 12 }}>
      <RoundsPanel plan={pd.plan} trip={trip} on={on} />
      <ChecklistPanel pd={pd} trip={trip} on={on} goTab={goTab} ideasToo={false} />
    </div>
  );
}

/** Organise → More → Tribunal (laptop, organisers), when the Tribunal is switched on. */
export function MoreTribunal() {
  const on = useFeature('tribunal');
  return on ? <TribunalPanel /> : <div className="small muted">The Tribunal is switched off for this group.</div>;
}
