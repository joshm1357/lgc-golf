// The trip plan (Josh, 22 Oct): one "Next step" card at the top of a trip, jobs you can Allocate, the job formula,
// the accommodation shortlist vote, the trip plan (a tick-list budget) and the deposit ("Confirm and pay").
// The thinking is in lib/tripjobs.js and lib/tripbudget.js. No money moves through the app and nothing is booked by it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName, useFeature, useRealtime } from '../lib/store.jsx';
import { Avatar, Sheet, Icon, toast } from '../components/ui.jsx';
import { fmtRange, money, todayISO, tallyPoll } from '../lib/plan.js';
import { notify, shareText } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import {
  nextStep, buildJobs, jobStage, blockedBy, sortJobs, stagePatch, allocateOrder, addDays, JOB_STAGE_LABEL, FORMULA_BY_KEY,
} from '../lib/tripjobs.js';
import {
  budgetSummary, suggestedDeposit, defaultBudget, depositStatus, stayLinks, cleanStay, KIND, linesPerPerson,
} from '../lib/tripbudget.js';
import { tripStage } from '../lib/trips.js';
import StaySearch from '../components/StaySearch.jsx';
import { tripHeadcount } from '../lib/weekends.js';
import { coursesDone as builderCoursesDone } from '../lib/tripsteps.js';
import { CallVoteSheet } from '../components/CallVote.jsx';
import { useLateJobs, LateBadge, WaiveButton } from '../components/LateJobs.jsx';
import { lateJobs } from '../lib/latejobs.js';

const RSVP_WORD = { in: 'In', maybe: 'Keen', out: 'Out' };

// ---------------------------------------------------------------- Data

/** Rows the planner doesn't load: the shortlist, the trip plan, and the trip builder's bits (077) if they're there. */
async function rowsOr(q) {
  try { const { data, error } = await q; return error ? [] : data || []; } catch { return []; }
}
function stateNames(state) {
  const list = state?.stayAreas || state?.stay_areas || state?.areas || [];
  return (Array.isArray(list) ? list : []).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
}
function countWeekends(state) {
  if (!state || typeof state !== 'object') return 0;
  for (const [k, v] of Object.entries(state)) if (/weekend|dates/i.test(k) && Array.isArray(v)) return v.length;
  return 0;
}

export function useTripExtras(pd) {
  const planId = pd?.plan?.id;
  const [ex, setEx] = useState({ stays: [], budget: [], builder: { weekends: 0, teeOptions: 0, cards: [], callJobIds: [], areas: [] } });
  const load = useCallback(async () => {
    if (!planId) return;
    const [stays, budget, builds, tees, cards] = await Promise.all([
      rowsOr(supabase.from('plan_stays').select('*').eq('plan_id', planId).order('created_at')),
      rowsOr(supabase.from('plan_budget_items').select('*').eq('plan_id', planId).order('sort').order('created_at')),
      rowsOr(supabase.from('trip_builds').select('state').eq('plan_id', planId)),
      rowsOr(supabase.from('trip_tee_options').select('*').eq('plan_id', planId)),
      rowsOr(supabase.from('vote_batches').select('id,title,closes_on').eq('plan_id', planId)),
    ]);
    const state = builds[0]?.state || null;
    setEx({
      stays, budget,
      builder: {
        weekends: countWeekends(state), areas: stateNames(state), cards,
        weekendList: Array.isArray(state?.weekends) ? state.weekends : [],
        // ov23: where the builder is up to (area chosen? primary and backup weekends set?) and how many are coming.
        started: !!state, region: state?.region || null, weekendsSettled: !!state?.weekendsSettled,
        state, coursesDone: builderCoursesDone(state), // the shared step lines and "done" (lib/tripsteps.js)
        headcount: Number(state?.headcount) > 0 ? Number(state.headcount) : null, headcountBy: state?.headcountBy || null, nights: state?.nights ?? null,
        // The chosen area with places to stay picked but no accommodation idea or list yet (080; ov23: after the area's chosen).
        noStayList: Object.entries(state?.areaStays || {}).filter(([area, pins]) => (pins || []).length && state.region === area
          && !stays.some((x) => x.area === area || (!x.area && state.region === area))).map(([area]) => area),
        teeOptions: tees.filter((t) => (t.times || []).length || (t.ranges || []).length).length,
        callJobIds: [...new Set([...tees.map((t) => t.job_id), ...Object.values(state?.callJobs || {})].filter(Boolean))],
      },
    });
  }, [planId]);
  // The planner reloads on any change to its tables; reload alongside it.
  useEffect(() => { load(); }, [load, pd]);
  useRealtime(['plan_stays', 'plan_budget_items'], load);
  return { ...ex, reload: load };
}

const reserveJob = (pd) => pd.items.find((i) => i.kind === 'job' && i.formula_key === 'reserve_stay');
const accomTotal = (pd, ex) => {
  const r = reserveJob(pd);
  if (r?.amount != null) return Number(r.amount);
  const chosen = ex.stays.find((s) => s.chosen);
  return chosen?.total_cost != null ? Number(chosen.total_cost) : null;
};

/** Make the usual jobs for a locked-in trip (organisers; running it twice adds nothing). Returns how many were added. */
export async function makeTripJobs(pd, status) {
  if (!status?.is_admin || !pd?.plan?.start_date) return 0;
  const { data: items } = await supabase.from('plan_items').select('*').eq('plan_id', pd.plan.id);
  const tees = await rowsOr(supabase.from('trip_tee_options').select('job_id').eq('plan_id', pd.plan.id));
  const rows = buildJobs(pd.plan, items || pd.items, {
    organiserId: pd.plan.organiser_id || status.player_id, callJobIds: tees.map((t) => t.job_id).filter(Boolean),
  });
  if (!rows.length) return 0;
  const { error } = await supabase.from('plan_items').insert(rows);
  if (error && error.code !== '23505') throw error;
  return rows.length;
}

// ---------------------------------------------------------------- The Next step card

/** The Next step (lib/tripjobs.js nextStep) for whoever's signed in. ex: useTripExtras(pd). */
export function useNextStep(pd, stage, ex) {
  const data = useData();
  const { status } = useSession();
  const tasksOn = useFeature('planner_tasks');
  const costsOn = useFeature('planner_costs');
  const late = useLateJobs();
  const plan = pd.plan;
  const names = useMemo(() => Object.fromEntries(data.players.map((p) => [p.id, playerName(p)])), [data.players]);
  return useMemo(() => nextStep({
    plan: costsOn ? plan : { ...plan, deposit_pp: null, deposit_asked_at: null }, stage,
    items: tasksOn ? pd.items : [], polls: tasksOn ? pd.polls : [], options: pd.options, votes: pd.votes, rsvps: pd.rsvps,
    transfers: pd.transfers, playerIds: data.players.filter((p) => p.approved !== false).map((p) => p.id),
    me: status.player_id, isOrganiser: !!status.is_admin, names, builder: ex.builder,
    late: tasksOn ? late : null,
  }), [plan, stage, pd, data.players, status, names, ex.builder, tasksOn, costsOn, late]);
}

/**
 * What a Next step's button does: { act(action), busy, sheets, setSheet }. Render `sheets` once.
 * onTab(tab) opens a part of Organise; actions it doesn't know go to onOther(action).
 */
export function useStepActions(pd, ex, { onTab, onOther } = {}) {
  const { status } = useSession();
  const nav = useNavigate();
  const [sheet, setSheet] = useState(null);
  const [busy, run] = useRun();
  const late = useLateJobs();
  const plan = pd.plan;
  const job = (id) => pd.items.find((i) => i.id === id);
  const act = (a) => {
    if (!a) return;
    if (a.type === 'tab') { if (a.tab === 'stay') setSheet({ kind: 'stay' }); else onTab?.(a.tab); return; }
    if (a.type === 'allocate') { setSheet({ kind: 'allocate', job: job(a.id) }); return; }
    if (a.type === 'job') { setSheet({ kind: 'job', job: job(a.id) }); return; }
    if (a.type === 'pay') { setSheet({ kind: 'pay' }); return; }
    if (a.type === 'deposits') { setSheet({ kind: 'deposits' }); return; }
    if (a.type === 'trip_plan') { setSheet({ kind: 'budget' }); return; }
    if (a.type === 'builder' || a.type === 'plan_builder') { nav(`/plan/${plan.id}/build`); return; }
    if (a.type === 'lock') {
      const openVotes = pd.polls.filter((p) => p.status === 'open').length;
      if (openVotes && !window.confirm(`${openVotes} vote${openVotes === 1 ? ' is' : 's are'} still open. Lock it in anyway?`)) return;
      run(async () => {
        // Same as the Lock it in card: lock, tell the feed and everyone, then make the to-do list.
        await must(supabase.from('plans').update({ status: 'confirmed' }).eq('id', plan.id));
        await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, body: `🔒 ${plan.name} is locked in: ${fmtRange(plan.start_date, plan.end_date)}${plan.location_name ? ` at ${plan.location_name}` : ''}. Say if you’re in.`, link: `/plan/${plan.id}` });
        await notify('trip_locked', { plan_id: plan.id });
        await makeTripJobs({ ...pd, plan: { ...plan, status: 'confirmed' } }, status).catch(() => 0);
        pd.reload();
      }, 'Locked in — the to-do list is ready');
      return;
    }
    if (a.type === 'go') { nav(a.to); return; }
    if (a.type === 'make_jobs') {
      run(async () => { const n = await makeTripJobs(pd, status); pd.reload(); return n; })
        .then((n) => n != null && toast(n ? `Added ${n} jobs with due dates` : 'The jobs are already there'));
      return;
    }
    onOther?.(a);
  };
  const sheets = <TripSheets sheet={sheet} setSheet={setSheet} pd={pd} ex={ex} onTab={onTab} late={late} />;
  return { act, busy, sheets, setSheet };
}

/** The Next step card (Overview, for players: their own next thing — a deposit to pay, a job). hideVotes: skip
 *  vote steps (the votes are on the page already). */
export function NextStepCard({ pd, stage, onTab, hideVotes = false }) {
  const data = useData();
  const { status } = useSession();
  const ex = useTripExtras(pd);
  const step = useNextStep(pd, stage, ex);
  const { act, busy, sheets } = useStepActions(pd, ex, { onTab });
  if (!step) return null;
  if (hideVotes && /^vote/.test(step.key)) return null;
  const who = step.who ? data.playersById[step.who] : null;
  return (
    <div className="section" style={{ paddingBottom: 0 }}>
      <div className="card" data-testid="next-step" style={{ borderColor: 'var(--navy)', borderWidth: 2, overflow: 'hidden' }}>
        <div className="small" style={{ padding: '6px 14px', background: 'var(--navy)', color: '#fff', fontWeight: 800, letterSpacing: '.04em' }}>NEXT STEP</div>
        <div className="row" style={{ padding: '12px 14px', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">{step.icon}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.25 }}>{step.title}</div>
            {step.detail && <div className={step.late ? 'small' : 'small muted'} data-testid={step.late ? 'next-step-late' : undefined} style={{ marginTop: 2, ...(step.late ? { color: 'var(--under)', fontWeight: 700 } : {}) }}>{step.detail}</div>}
            {who && <div className="row small" style={{ gap: 6, marginTop: 6 }}><Avatar player={who} size={22} /><span>On {who.id === status.player_id ? 'you' : playerName(who)}</span></div>}
          </div>
        </div>
        <div style={{ padding: '0 14px 12px' }}>
          <button type="button" className="btn gold block" disabled={busy} onClick={() => act(step.action)}>{step.label}</button>
        </div>
      </div>
      {sheets}
    </div>
  );
}

// ---------------------------------------------------------------- Organise: where to stay, the trip plan, deposits

export function TripPlanCards({ pd, only = null }) {
  const data = useData();
  const { status } = useSession();
  const tasksOn = useFeature('planner_tasks');
  const costsOn = useFeature('planner_costs');
  const ex = useTripExtras(pd);
  const [sheet, setSheet] = useState(null);
  const plan = pd.plan;
  const stage = tripStage(plan, plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null);
  if (plan.kind !== 'trip' || ['done', 'cancelled', 'idea'].includes(stage)) return null;
  const chosen = ex.stays.find((s) => s.chosen);
  const sum = budgetSummary(ex.budget, { rsvps: pd.rsvps, accomTotal: accomTotal(pd, ex) });
  const dep = Number(plan.deposit_pp) > 0 && plan.deposit_asked_at ? depositStatus({ deposit: plan.deposit_pp, rsvps: pd.rsvps, transfers: pd.transfers }) : null;
  const rows = [
    tasksOn && { k: 'stay', icon: '🏠', title: 'Where to stay', sub: chosen ? `${chosen.name}${chosen.total_cost != null ? ` · ${money(chosen.total_cost)}` : ''}` : ex.stays.length ? `${ex.stays.length} on the shortlist` : plan.start_date ? 'Find 2–3 places, then the group votes' : 'Once the dates are known' },
    costsOn && { k: 'budget', icon: '🧾', title: 'Trip plan', sub: ex.budget.length ? `${money(sum.total)} · ${money(sum.perPerson)} each${sum.basis === 'keen' ? ' if everyone keen comes' : ''}` : status.is_admin ? 'Costs, food plan and the deposit' : 'Not started yet' },
    costsOn && dep && { k: 'deposits', icon: '💳', title: `Deposits · ${money(plan.deposit_pp)} each`, sub: `${dep.people.filter((p) => p.state === 'paid').length} of ${dep.people.length} paid` },
  ].filter(Boolean).filter((r) => !only || only.includes(r.k));
  if (!rows.length) return null;
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <button key={r.k} type="button" className="row" onClick={() => setSheet({ kind: r.k === 'deposits' && !status.is_admin ? 'pay' : r.k })}
          style={{ width: '100%', padding: '12px 14px', border: 0, borderTop: i ? '1px solid var(--line-soft)' : 0, background: '#fff', textAlign: 'left', color: 'inherit', gap: 12, minHeight: 56 }}>
          <span style={{ fontSize: 22 }} aria-hidden="true">{r.icon}</span>
          <span className="grow" style={{ minWidth: 0 }}><strong>{r.title}</strong><div className="small muted">{r.sub}</div></span>
          <span className="muted" aria-hidden="true">›</span>
        </button>
      ))}
      <TripSheets sheet={sheet} setSheet={setSheet} pd={pd} ex={ex} />
    </div>
  );
}

function TripSheets({ sheet, setSheet, pd, ex, onTab, late }) {
  if (!sheet) return null;
  const close = () => setSheet(null);
  const open = (s) => setSheet(s);
  if (sheet.kind === 'allocate' && sheet.job) return <AllocateSheet pd={pd} job={sheet.job} onClose={close} />;
  if (sheet.kind === 'job' && sheet.job) return <JobSheet pd={pd} job={sheet.job} onClose={close} open={open} late={late} />;
  if (sheet.kind === 'stay') return <StaySheet pd={pd} ex={ex} onClose={close} onTab={onTab} />;
  if (sheet.kind === 'budget') return <BudgetSheet pd={pd} ex={ex} onClose={close} />;
  if (sheet.kind === 'pay') return <PaySheet pd={pd} onClose={close} />;
  if (sheet.kind === 'deposits') return <DepositsSheet pd={pd} onClose={close} />;
  return null;
}

// ---------------------------------------------------------------- Jobs

const canAllocate = (j, me, isAdmin) => isAdmin || (me && (j.owner_id === me || (!j.owner_id && j.created_by === me)));
const canWork = (j, me, isAdmin) => isAdmin || (me && (j.owner_id === me || j.created_by === me));
const STAGE_STYLE = {
  todo: { background: '#fff', color: 'var(--navy)', borderColor: '#B9C2CC' },
  asked: { background: 'var(--gold-soft)', color: '#7A5A00', borderColor: 'var(--gold)' },
  done: { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' },
};

/** Who's doing it: pick a person (in and keen first). They get a notification. */
function AllocateSheet({ pd, job, onClose }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const people = allocateOrder(data.players.filter((p) => p.approved !== false), pd.rsvps);
  const give = (p) => run(async () => {
    const rows = await must(supabase.from('plan_items').update({ owner_id: p ? p.id : null }).eq('id', job.id).select());
    if (!rows?.length) throw new Error('Couldn’t change that job — only the organiser or whoever has it can.');
    let told = '';
    if (p && p.id !== status.player_id) {
      const r = await notify('job_assigned', { item_id: job.id });
      told = r?.sent ? ' — they’ve been told' : '';
    }
    pd.reload(); onClose();
    return p ? `${p.id === status.player_id ? 'It’s yours' : `Over to ${playerName(p)}`}${told}` : 'Nobody on it now';
  }).then((m) => m && toast(m));
  return (
    <Sheet title={`Allocate: ${job.title}`} onClose={onClose}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small muted">Pick who’s doing it. People who are in come first.</span>
        {people.map((p) => {
          const rs = pd.rsvps.find((r) => r.player_id === p.id)?.status;
          const cur = job.owner_id === p.id;
          return (
            <button key={p.id} type="button" className="row" disabled={busy || cur} onClick={() => give(p)}
              style={{ width: '100%', minHeight: 52, padding: '6px 10px', border: `1px solid ${cur ? 'var(--navy)' : 'var(--line-soft)'}`, borderRadius: 10, background: cur ? 'var(--gold-soft)' : '#fff', textAlign: 'left', color: 'inherit', gap: 10 }}>
              <Avatar player={p} size={32} />
              <span className="grow"><strong>{playerName(p)}</strong>{p.id === status.player_id && <span className="small muted"> (you)</span>}</span>
              <span className="small muted">{cur ? 'Has it' : RSVP_WORD[rs] || ''}</span>
            </button>
          );
        })}
        {job.owner_id && <button type="button" className="btn ghost block" disabled={busy} onClick={() => give(null)}>Nobody for now</button>}
      </div>
    </Sheet>
  );
}

/** One job: what to do, To do → Asked / waiting → Done ✓, a note (confirmation number, cost), hand it on. */
function JobSheet({ pd, job, onClose, open, late }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [note, setNote] = useState(job.note || '');
  const [amount, setAmount] = useState(job.amount ?? '');
  const [busy, run] = useRun();
  const st = jobStage(job);
  const before = blockedBy(job, pd.items);
  const mayWork = canWork(job, me, status.is_admin);
  const owner = data.playersById[job.owner_id];
  const isReserve = job.formula_key === 'reserve_stay';
  const save = (stage) => run(async () => {
    const amt = amount === '' || amount == null ? null : Number(String(amount).replace(/[^0-9.]/g, ''));
    if (isReserve && stage === 'done' && !(amt > 0)) throw new Error('Enter the total cost first — it sets the deposit.');
    const patch = { note: note.trim() || null, amount: Number.isFinite(amt) ? amt : null, ...(stage ? stagePatch(stage) : {}) };
    await must(supabase.from('plan_items').update(patch).eq('id', job.id));
    pd.reload(); onClose();
    return stage === 'done' ? (isReserve ? 'Reserved ✓ — set the deposit on the trip plan' : 'Done ✓') : 'Saved';
  }).then((m) => m && toast(m));
  return (
    <Sheet title={job.title} onClose={onClose}>
      <div className="stack">
        {before && <div className="card pad small" style={{ background: '#F4F6F8' }}>🔒 Waits for <strong>{before.title}</strong> to be done first.</div>}
        {job.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{job.body}</div>}
        {job.link && <a className="small" href={job.link} target="_blank" rel="noreferrer">Open the link ↗</a>}
        <div className="row small" style={{ gap: 8 }}>
          {owner ? <><Avatar player={owner} size={24} /><span>{owner.id === me ? 'You' : playerName(owner)}</span></> : <span className="muted">Nobody on it yet</span>}
          {job.due && <span className="muted">· due {fmtRange(job.due)}</span>}
        </div>
        <LateBadge job={job} late={late} />
        <WaiveButton job={job} late={late} onDone={onClose} />
        {(job.formula_key === 'shortlist_stay' || isReserve) && <button type="button" className="btn ghost" onClick={() => open({ kind: 'stay' })}>🏠 Where to stay — search links and the shortlist</button>}
        {job.formula_key === 'deposit_ask' && <button type="button" className="btn ghost" onClick={() => open({ kind: 'budget' })}>🧾 Open the trip plan and set the deposit</button>}
        {job.formula_key === 'chase_deposits' && <button type="button" className="btn ghost" onClick={() => open({ kind: 'deposits' })}>💳 See who’s paid</button>}
        {mayWork && (
          <>
            <span className="label">Where it’s up to</span>
            <div className="seg light" role="group" aria-label="Where it’s up to">
              {['todo', 'asked', 'done'].map((s) => (
                <button key={s} type="button" aria-pressed={st === s} disabled={busy || (!!before && s !== 'todo')} onClick={() => save(s)}>{JOB_STAGE_LABEL[s]}</button>
              ))}
            </div>
            {isReserve && <label className="field"><span>Total cost of the accommodation $</span><input className="input" inputMode="decimal" value={amount ?? ''} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2400" /></label>}
            {!isReserve && <label className="field"><span>Cost $ (optional)</span><input className="input" inputMode="decimal" value={amount ?? ''} onChange={(e) => setAmount(e.target.value)} /></label>}
            <label className="field"><span>Note (confirmation number, who you spoke to…)</span><textarea className="textarea" rows={2} style={{ padding: 12 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <button type="button" className="btn gold block" disabled={busy} onClick={() => save(null)}>Save</button>
          </>
        )}
        {!mayWork && job.note && <div className="small"><strong>Note:</strong> {job.note}</div>}
        {canAllocate(job, me, status.is_admin) && <button type="button" className="btn ghost block" onClick={() => open({ kind: 'allocate', job })}>👉 {job.owner_id ? 'Hand it on' : 'Allocate'}</button>}
      </div>
    </Sheet>
  );
}

/** The Jobs tab: every job with its stage, who's on it, locks, and an Allocate button. */
export function TripJobsTab({ pd, AddSheet }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, run] = useRun();
  const ex = useTripExtras(pd);
  const lateData = useLateJobs();
  const today = todayISO();
  const jobs = sortJobs(pd.items);
  const lateList = lateJobs(jobs, lateData.rule, { today, penalties: lateData.penalties, adjustments: lateData.adjustments }).filter((x) => !x.info.waived);
  const shown = jobs.filter((j) => (filter === 'mine' ? j.owner_id === me : filter === 'todo' ? jobStage(j) !== 'done' : true));
  const done = jobs.filter((j) => jobStage(j) === 'done').length;
  const unowned = jobs.filter((j) => !j.owner_id && jobStage(j) !== 'done').length;
  const hasFormula = jobs.some((j) => j.formula_key);
  return (
    <>
      <div className="row between">
        <span><strong>{done} of {jobs.length}</strong> <span className="small muted">done{unowned ? ` · ${unowned} with nobody on it` : ''}</span></span>
        <div className="seg light" role="group" style={{ width: 'auto' }}>
          {[['all', 'All'], ['todo', 'Open'], ['mine', 'Mine']].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      {jobs.length > 0 && <div className="vote-bar"><span className="g" style={{ width: `${(done / jobs.length) * 100}%`, background: 'var(--navy)' }} /></div>}
      {status.is_admin && lateList.length > 0 && (
        <div className="card pad small" data-testid="late-summary" style={{ background: '#FDF1EF', borderColor: 'var(--under)' }}>
          <strong>⚠️ {lateList.length} late job{lateList.length === 1 ? '' : 's'}</strong>
          <span className="muted"> — {lateData.rule.strokes} penalty stroke{lateData.rule.strokes === 1 ? '' : 's'} each in the next round unless they’re done first. Tap one to waive it.</span>
          <div style={{ marginTop: 4 }}>{lateList.map(({ job, info }) => `${job.title} (${playerName(data.playersById[job.owner_id])}, ${info.daysLate} days)`).join(' · ')}</div>
        </div>
      )}
      {status.is_admin && !hasFormula && pd.plan.kind === 'trip' && pd.plan.start_date && (
        <button type="button" className="card pad row" disabled={busy} style={{ width: '100%', textAlign: 'left', color: 'inherit', gap: 10, borderColor: 'var(--gold)' }}
          onClick={() => run(async () => { const n = await makeTripJobs(pd, status); pd.reload(); return n ? `Added ${n} jobs` : 'Already there'; }).then((m) => m && toast(m))}>
          <span style={{ fontSize: 22 }}>📋</span>
          <span className="grow"><strong>Add the usual jobs</strong><div className="small muted">Accommodation, deposits, transport, the draw — due dates counted back from the trip.</div></span>
        </button>
      )}
      {shown.length === 0 && <div className="empty">{filter === 'mine' ? 'No jobs with your name on them. Lucky.' : 'No jobs yet.'}</div>}
      {shown.length > 0 && (
        <div className="card">
          {shown.map((j) => {
            const owner = data.playersById[j.owner_id];
            const st = jobStage(j);
            const lock = blockedBy(j, pd.items);
            const late = st !== 'done' && !lock && j.due && j.due < today;
            return (
              <div key={j.id} data-testid="job-row" className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', gap: 10, alignItems: 'flex-start', opacity: lock ? 0.55 : 1 }}>
                <span className="chip" style={{ minHeight: 28, padding: '0 8px', fontSize: 12, marginTop: 2, ...STAGE_STYLE[st] }}>{lock ? '🔒' : st === 'done' ? '✓' : st === 'asked' ? '⏳' : '○'}</span>
                <button type="button" className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0, color: 'inherit', minWidth: 0 }} onClick={() => setSheet({ kind: 'job', job: j })}>
                  <div style={{ fontWeight: 700, textDecoration: st === 'done' ? 'line-through' : 'none', color: st === 'done' ? 'var(--muted)' : 'inherit' }}>{j.title}</div>
                  <div className="small" style={{ color: late ? 'var(--under)' : 'var(--muted)', fontWeight: late ? 700 : 400 }}>
                    {lock ? `after: ${lock.title}` : [owner ? playerName(owner) : 'Nobody yet', st === 'asked' ? 'asked, waiting' : null, j.due ? `due ${fmtRange(j.due)}${late ? ' — overdue' : ''}` : null].filter(Boolean).join(' · ')}
                  </div>
                  {j.note && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>📝 {j.note}</div>}
                  <LateBadge job={j} late={lateData} compact />
                </button>
                {canAllocate(j, me, status.is_admin) && st !== 'done' ? (
                  <button type="button" className="btn ghost sm" onClick={() => setSheet({ kind: 'allocate', job: j })}>{owner ? <Avatar player={owner} size={22} /> : null}{owner ? '' : 'Allocate'}</button>
                ) : !owner && st !== 'done' && me ? (
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => {
                    const rows = await must(supabase.from('plan_items').update({ owner_id: me }).eq('id', j.id).is('owner_id', null).select());
                    if (!rows?.length) throw new Error('Someone beat you to it — refresh.');
                    pd.reload();
                  }, 'It’s yours')}>I’ll do it</button>
                ) : owner ? <Avatar player={owner} size={30} /> : null}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="btn ghost block" onClick={() => setAdding(true)}>+ Add a job</button>
      {adding && AddSheet && <AddSheet plan={pd.plan} kind="job" item={null} onClose={() => setAdding(false)} onSaved={pd.reload} />}
      <TripSheets sheet={sheet} setSheet={setSheet} pd={pd} ex={ex} late={lateData} />
    </>
  );
}

// ---------------------------------------------------------------- Where to stay: search links, the shortlist, the vote

function StaySheet({ pd, ex, onClose, onTab }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const plan = pd.plan;
  const [v, setV] = useState({});
  const [busy, run] = useRun();
  // ov23: the trip's real head count — the number set (organiser / plan chat), else who's in, else the group.
  const keen = tripHeadcount({ set: ex.builder.headcount, setBy: ex.builder.headcountBy, rsvps: pd.rsvps, players: data.players }).people;
  const towns = ex.builder.areas.length ? ex.builder.areas : [plan.location_name].filter(Boolean);
  const shortlistJob = pd.items.find((i) => i.formula_key === 'shortlist_stay');
  const mayRun = status.is_admin || (me && (plan.organiser_id === me || shortlistJob?.owner_id === me));
  const poll = [...pd.polls].reverse().find((p) => p.purpose === 'stay');
  const rows = poll ? tallyPoll(pd.options.filter((o) => o.poll_id === poll.id), pd.votes.filter((x) => x.poll_id === poll.id)) : [];
  const winnerOpt = poll?.winner_option_id;
  const winner = winnerOpt ? ex.stays.find((s) => s.option_id === winnerOpt) : null;
  const chosen = ex.stays.find((s) => s.chosen);
  const fresh = ex.stays.filter((s) => !s.option_id);
  const add = () => run(async () => {
    const row = cleanStay(v);
    if (!row) throw new Error('Give it a name');
    await must(supabase.from('plan_stays').insert({ plan_id: plan.id, ...row }));
    setV({}); await ex.reload();
  }, 'Added to the shortlist');
  const [calling, setCalling] = useState(false);
  // Call the vote (080): the shortlist with tick boxes; only the ticked places go on (put_stays_to_vote's p_only).
  const stayRange = [{ key: 'accom', kind: 'other', question: 'Where should we stay?', options: fresh.map((s) => ({
    key: `accom:${s.id}`, stayId: s.id, label: s.name,
    notes: [s.area, s.is_list ? 'a shared list' : null, s.total_cost != null ? `${money(s.total_cost)} total` : null, s.sleeps ? `sleeps ${s.sleeps}` : null].filter(Boolean).join(' · ') || null,
  })) }];
  const callStays = async (ballot, { closes: c }) => {
    const ids = (ballot.sections[0]?.options || []).map((o) => o.stayId);
    const r = await must(supabase.rpc('put_stays_to_vote', { p_plan: plan.id, p_closes_on: c || null, p_only: ids }));
    // Joined the trip builder's combined vote (or added to one already out): no second notification.
    if (r && !r.joined) await notify('poll_open', { poll_id: r.poll_id });
    pd.reload(); await ex.reload();
    return r;
  };
  const putToVote = () => setCalling(true);
  const goWith = (s) => run(async () => {
    await must(supabase.from('plan_stays').update({ chosen: false }).eq('plan_id', plan.id).neq('id', s.id));
    await must(supabase.from('plan_stays').update({ chosen: true }).eq('id', s.id));
    const rj = reserveJob(pd);
    if (rj) {
      await must(supabase.from('plan_items').update({
        link: s.link, amount: s.total_cost, body: `Book ${s.name}${s.sleeps ? ` (sleeps ${s.sleeps})` : ''} for ${fmtRange(plan.start_date, plan.end_date)} and enter the total cost.`,
      }).eq('id', rj.id));
    }
    if (shortlistJob && jobStage(shortlistJob) !== 'done') await must(supabase.from('plan_items').update(stagePatch('done')).eq('id', shortlistJob.id));
    pd.reload(); await ex.reload();
  }, `Going with ${s.name} — now reserve it`);
  return (
    <Sheet title="Where to stay" onClose={onClose}>
      <div className="stack">
        {chosen && <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>✅ <strong>{chosen.name}</strong>{chosen.total_cost != null ? ` · ${money(chosen.total_cost)}` : ''}{chosen.link && <> · <a href={chosen.link} target="_blank" rel="noreferrer">Have a look ↗</a></>}</div>}
        {towns.length > 0 && (
          <StaySearch places={towns.slice(0, 3)} weekends={plan.start_date ? [{ start: plan.start_date, end: plan.end_date }] : ex.builder.weekendList || []} people={keen}
            maxPerNight={null} busy={busy} onSave={(mayRun || me) ? (row) => run(async () => { await must(supabase.from('plan_stays').insert({ plan_id: plan.id, ...row })); await ex.reload(); }, row.is_list ? 'List added — it goes on the vote with a View places link' : 'Added to the shortlist') : null} />
        )}

        <span className="label">The shortlist</span>
        {ex.stays.length === 0 && <div className="small muted">Nothing yet. Paste in 2–3 places, or a shared list.</div>}
        {ex.stays.map((s) => (
          <div key={s.id} className="card pad stack" style={{ gap: 4, borderColor: s.chosen ? 'var(--gold)' : undefined }}>
            <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <strong className="grow">{s.name}</strong>
              {(status.is_admin || s.created_by === me) && !s.option_id && <button type="button" className="btn ghost sm" aria-label={`Remove ${s.name}`} onClick={() => run(async () => { await must(supabase.from('plan_stays').delete().eq('id', s.id)); await ex.reload(); })}>{Icon.x(14)}</button>}
            </div>
            <div className="small muted">{[s.total_cost != null ? `${money(s.total_cost)} total${keen ? ` (~${money(Math.round(s.total_cost / keen))} each)` : ''}` : null, s.sleeps ? `sleeps ${s.sleeps}` : null, s.distance_note].filter(Boolean).join(' · ')}</div>
            {s.link && <a className="small" href={s.link} target="_blank" rel="noreferrer">Have a look ↗</a>}
            {status.is_admin && !s.chosen && (!poll || poll.status === 'closed') && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => goWith(s)}>Go with this one</button>}
          </div>
        ))}

        {(mayRun || me) && (
          <div className="card pad stack" style={{ gap: 8 }}>
            <strong>+ Add a place</strong>
            <label className="field"><span>Name</span><input className="input" value={v.name || ''} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Beach house, Culburra" /></label>
            <label className="field"><span>Link</span><input className="input" type="url" value={v.link || ''} onChange={(e) => setV({ ...v, link: e.target.value })} placeholder="Paste the Airbnb / Stayz link" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>Rough total $</span><input className="input" inputMode="decimal" value={v.total_cost || ''} onChange={(e) => setV({ ...v, total_cost: e.target.value })} /></label>
              <label className="field"><span>Sleeps</span><input className="input" inputMode="numeric" value={v.sleeps || ''} onChange={(e) => setV({ ...v, sleeps: e.target.value })} /></label>
            </div>
            <label className="field"><span>How far (optional)</span><input className="input" value={v.distance_note || ''} onChange={(e) => setV({ ...v, distance_note: e.target.value })} placeholder="e.g. 10 min to the course" /></label>
            <button type="button" className="btn block" disabled={busy || !String(v.name || '').trim()} onClick={add}>Add to the shortlist</button>
          </div>
        )}

        {poll && poll.status === 'open' && (
          <div className="card pad stack" style={{ gap: 6 }}>
            <strong>🗳️ The group is voting</strong>
            {rows.map((r) => <div key={r.option.id} className="row between small"><span>{r.option.label}</span><span>✓{r.yes.length} ?{r.maybe.length} ✗{r.no.length}</span></div>)}
            {onTab && <button type="button" className="btn ghost sm" onClick={() => { onClose(); onTab('vote'); }}>Go to the vote</button>}
          </div>
        )}
        {winner && !winner.chosen && status.is_admin && <button type="button" className="btn gold block" disabled={busy} onClick={() => goWith(winner)}>Winner: {winner.name} — go with it</button>}
        {mayRun && fresh.length > 0 && (!poll || poll.status === 'open') && ex.stays.length >= 2 && (
          <div className="stack" style={{ gap: 8 }}>
            <button type="button" className="btn gold block" disabled={busy} onClick={putToVote} data-testid="stays-call-vote">{poll ? `🗳️ Add to the vote (${fresh.length})` : '🗳️ Call the vote'}</button>
          </div>
        )}
        {mayRun && ex.stays.length === 1 && !poll && <span className="small muted">Add one more place to put it to a vote.</span>}
      </div>
      {calling && <CallVoteSheet plan={plan} title="Where should we stay?" range={stayRange} keenOption={false} doCall={callStays} onClose={() => setCalling(false)} />}
    </Sheet>
  );
}

// ---------------------------------------------------------------- The trip plan (tick-list budget) and the deposit

function LinesEditor({ lines, onChange, disabled, what }) {
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 76px 36px', gap: 6 }}>
          <input className="input" aria-label={`${what} ${i + 1}`} value={l.label || ''} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} />
          <input className="input" aria-label={`$ per head for ${l.label || what}`} inputMode="decimal" value={l.pp ?? ''} disabled={disabled} placeholder="$ pp"
            onChange={(e) => set(i, { pp: e.target.value === '' ? null : Number(String(e.target.value).replace(/[^0-9.]/g, '')) })} />
          {!disabled && <button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => onChange(lines.filter((_, j) => j !== i))}>{Icon.x(14)}</button>}
        </div>
      ))}
      {!disabled && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...lines, { label: '', pp: null }])}>+ Add {what}</button>}
    </div>
  );
}

function BudgetLine({ item, line, heads, isAdmin, onSave }) {
  const [v, setV] = useState(item);
  useEffect(() => { setV(item); }, [item]);
  const k = KIND[item.kind] || {};
  const save = (patch) => { const next = { ...v, ...patch }; setV(next); onSave(item.id, patch); };
  const hasLines = item.kind === 'food' || item.kind === 'green_fees';
  return (
    <div className="stack" style={{ gap: 6, padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
      <div className="row" style={{ gap: 10 }}>
        <input type="checkbox" aria-label={`Include ${item.label}`} checked={v.ticked !== false} disabled={!isAdmin} onChange={(e) => save({ ticked: e.target.checked })} style={{ width: 24, height: 24, flex: 'none' }} />
        <span className="grow" style={{ fontWeight: 700, opacity: v.ticked === false ? 0.5 : 1 }}>{k.icon} {item.label}</span>
        <span className="num" style={{ whiteSpace: 'nowrap', opacity: v.ticked === false ? 0.5 : 1 }}>{money(line.total)}</span>
      </div>
      {v.ticked !== false && hasLines && (
        <>
          <LinesEditor lines={v.lines || []} disabled={!isAdmin} what={item.kind === 'food' ? 'a meal' : 'a round'} onChange={(lines) => save({ lines })} />
          <span className="small muted">{money(linesPerPerson(v.lines))} a head × {heads} people</span>
        </>
      )}
      {v.ticked !== false && !hasLines && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ width: 120 }} inputMode="decimal" aria-label={`${item.label} $`} disabled={!isAdmin}
            placeholder={item.kind === 'accommodation' ? (line.total ? String(line.total) : 'from Reserve') : '$'}
            value={v.amount ?? ''} onChange={(e) => setV({ ...v, amount: e.target.value })}
            onBlur={() => isAdmin && save({ amount: v.amount === '' || v.amount == null ? null : Number(String(v.amount).replace(/[^0-9.]/g, '')) || 0 })} />
          {item.kind !== 'accommodation' && (
            <div className="seg light" role="group" style={{ width: 'auto' }}>
              <button type="button" aria-pressed={!v.per_person} disabled={!isAdmin} onClick={() => save({ per_person: false })}>Total</button>
              <button type="button" aria-pressed={!!v.per_person} disabled={!isAdmin} onClick={() => save({ per_person: true })}>Each</button>
            </div>
          )}
          {item.kind !== 'accommodation' && isAdmin && (
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!v.upfront} onChange={(e) => save({ upfront: e.target.checked })} style={{ width: 20, height: 20 }} />Up front</label>
          )}
        </div>
      )}
    </div>
  );
}

function BudgetSheet({ pd, ex, onClose }) {
  const data = useData();
  const { status } = useSession();
  const plan = pd.plan;
  const [busy, run] = useRun();
  const accom = accomTotal(pd, ex);
  const sum = budgetSummary(ex.budget, { rsvps: pd.rsvps, accomTotal: accom });
  const suggested = suggestedDeposit(ex.budget, { rsvps: pd.rsvps, accomTotal: accom });
  const [deposit, setDeposit] = useState(plan.deposit_pp ?? '');
  const [payTo, setPayTo] = useState(plan.kitty_note || data.playersById[status.player_id]?.pay_details || '');
  const reserved = jobStage(reserveJob(pd) || {}) === 'done';
  const start = () => run(async () => {
    const rounds = plan.trip_id ? data.rounds.filter((r) => r.trip_id === plan.trip_id) : [];
    await must(supabase.from('plan_budget_items').insert(defaultBudget(plan, { rounds, coursesById: data.coursesById })));
    await ex.reload();
  }, 'Trip plan started — change anything that’s wrong');
  const saveLine = (id, patch) => run(async () => { await must(supabase.from('plan_budget_items').update(patch).eq('id', id)); await ex.reload(); });
  const ask = () => run(async () => {
    const amt = Number(String(deposit || suggested).replace(/[^0-9.]/g, ''));
    if (!(amt > 0)) throw new Error('Set a deposit first');
    if (!payTo.trim()) throw new Error('Add how to pay you (PayID or BSB / account) — only the group sees it');
    const now = new Date().toISOString();
    await must(supabase.from('plans').update({ deposit_pp: amt, deposit_asked_at: plan.deposit_asked_at || now, kitty_note: payTo.trim() }).eq('id', plan.id));
    const askJob = pd.items.find((i) => i.formula_key === 'deposit_ask');
    if (askJob && jobStage(askJob) !== 'done') await must(supabase.from('plan_items').update(stagePatch('done')).eq('id', askJob.id));
    const chase = pd.items.find((i) => i.formula_key === 'chase_deposits');
    if (chase && !chase.due) await must(supabase.from('plan_items').update({ due: addDays(todayISO(), FORMULA_BY_KEY.chase_deposits.dueAfterAsk) }).eq('id', chase.id));
    const r = plan.deposit_asked_at ? { sent: 0 } : await notify('deposit_ask', { plan_id: plan.id });
    pd.reload(); onClose();
    return `Everyone keen has been asked to confirm and pay ${money(amt)}${r?.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} told` : ''}`;
  }).then((m) => m && toast(m));
  return (
    <Sheet title="Trip plan" onClose={onClose}>
      <div className="stack">
        {ex.budget.length === 0 ? (
          status.is_admin
            ? <><div className="small muted">Accommodation, green fees, trophy, shirts, a basic food plan, drinks and transport — tick what’s in and the app works out the cost per person and a fair deposit.</div>
              <button type="button" className="btn gold block" disabled={busy} onClick={start}>Start the trip plan</button></>
            : <div className="empty">The organiser hasn’t started the trip plan yet.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'center' }}>
              <div className="card pad"><div className="num" style={{ fontSize: 22 }}>{money(sum.total)}</div><div className="small muted">Total</div></div>
              <div className="card pad" data-testid="per-person"><div className="num" style={{ fontSize: 22 }}>{money(sum.perPerson)}</div><div className="small muted">Each · ÷ {sum.heads} {sum.basis === 'keen' ? 'if everyone keen comes' : 'confirmed'}</div></div>
            </div>
            <div>
              {sum.lines.map((l) => <BudgetLine key={l.item.id} item={l.item} line={l} heads={sum.heads} isAdmin={status.is_admin} onSave={saveLine} />)}
            </div>
            {status.is_admin && (
              <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }}>
                <strong>💳 The deposit</strong>
                <span className="small muted">Suggested: <strong data-testid="suggested-deposit">{money(suggested)}</strong> each — the accommodation share{sum.upfront > (accom || 0) ? ' plus the up-front bits' : ''}, rounded up to $10.</span>
                <label className="field"><span>Deposit per person $</span><input className="input" inputMode="decimal" value={deposit === '' || deposit == null ? '' : deposit} placeholder={String(suggested || '')} onChange={(e) => setDeposit(e.target.value)} /></label>
                <label className="field"><span>How to pay you (only the group sees this)</span><input className="input" value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="e.g. PayID 04xx xxx xxx — Josh" /></label>
                {!reserved && !plan.deposit_asked_at && <span className="small" style={{ color: '#7A5A00', fontWeight: 700 }}>Tip: reserve the accommodation first, so the deposit is for something real.</span>}
                <button type="button" className="btn gold block" disabled={busy} onClick={ask}>{plan.deposit_asked_at ? 'Update the deposit' : 'Ask everyone to confirm and pay'}</button>
                <span className="small muted">No money goes through the app. They pay you, tap “I’ve paid”, and you tick it off.</span>
              </div>
            )}
            {!status.is_admin && Number(plan.deposit_pp) > 0 && <div className="card pad">Deposit: <strong>{money(plan.deposit_pp)}</strong> each</div>}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** A player: confirm you're in and pay the deposit (payment details shown only to the group). */
function PaySheet({ pd, onClose }) {
  const { status } = useSession();
  const me = status.player_id;
  const plan = pd.plan;
  const [busy, run] = useRun();
  const deposit = Number(plan.deposit_pp) || 0;
  const mine = pd.rsvps.find((r) => r.player_id === me);
  const dep = depositStatus({ deposit, rsvps: mine ? [mine] : [], transfers: pd.transfers });
  const st = dep.people[0]?.state || 'unpaid';
  const confirm = () => run(async () => {
    await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status: 'in', note: mine?.note || null, updated_at: new Date().toISOString() }));
    pd.reload();
  }, 'You’re in 🍻');
  const paid = () => run(async () => {
    if (mine?.status !== 'in') await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status: 'in', note: mine?.note || null, updated_at: new Date().toISOString() }));
    const owe = Math.max(0, deposit - (dep.people[0]?.paid || 0) - (dep.people[0]?.pending || 0)) || deposit;
    await must(supabase.from('plan_transfers').insert({ plan_id: plan.id, from_id: me, to_id: null, amount: owe, note: 'Deposit' }));
    pd.reload(); onClose();
  }, 'Thanks — the organiser will tick it off');
  return (
    <Sheet title="Confirm and pay" onClose={onClose}>
      <div className="stack">
        <div style={{ fontSize: 20, fontWeight: 800 }}>{plan.name}</div>
        <div className="small muted">{fmtRange(plan.start_date, plan.end_date)}{plan.location_name ? ` · ${plan.location_name}` : ''}</div>
        <div className="card pad stack" style={{ gap: 6 }}>
          <div className="row between"><span>1. You’re in</span>{mine?.status === 'in' ? <strong>✓ In</strong> : <button type="button" className="btn sm" disabled={busy || plan.rsvp_locked} onClick={confirm}>I’m in</button>}</div>
          <div className="row between"><span>2. Pay the deposit</span><strong>{money(deposit)}</strong></div>
          {plan.kitty_note
            ? <button type="button" className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => shareText(plan.kitty_note).then((r) => r === 'copied' && toast('Copied'))}>📋 {plan.kitty_note}</button>
            : <span className="small muted">The organiser hasn’t added payment details yet.</span>}
        </div>
        {st === 'paid' && <div className="card pad" style={{ background: 'var(--gold-soft)' }}>✅ Paid and ticked off. You’re locked in.</div>}
        {st === 'pending' && <div className="card pad">⏳ You said you’ve paid — waiting for the organiser to tick it off.</div>}
        {st === 'unpaid' && <button type="button" className="btn gold block" disabled={busy || !deposit} onClick={paid}>I’ve paid {money(deposit)}</button>}
        <span className="small muted">No money goes through the app — pay the organiser directly.</span>
      </div>
    </Sheet>
  );
}

/** The organiser: who's confirmed and paid, tick payments off, nudge the rest. */
function DepositsSheet({ pd, onClose }) {
  const data = useData();
  const { status } = useSession();
  const plan = pd.plan;
  const [busy, run] = useRun();
  const d = depositStatus({ deposit: plan.deposit_pp, rsvps: pd.rsvps, transfers: pd.transfers });
  const name = (id) => playerName(data.playersById[id]);
  const section = (title, list, colour) => (
    <div className="card">
      <div className="small" style={{ padding: '8px 14px', fontWeight: 800, color: colour, borderBottom: '1px solid var(--line-soft)' }}>{title} · {list.length}</div>
      {list.map((p) => {
        const waiting = pd.transfers.filter((t) => t.from_id === p.player_id && !t.to_id && !t.confirmed);
        return (
          <div key={p.player_id} className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-soft)', gap: 10 }}>
            <Avatar player={data.playersById[p.player_id]} size={28} />
            <span className="grow"><strong>{name(p.player_id)}</strong><div className="small muted">{p.state === 'paid' ? `paid ${money(p.paid)}` : p.state === 'pending' ? `says paid ${money(p.pending)}` : 'not paid'}</div></span>
            {status.is_admin && p.state === 'unpaid' && (
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => {
                const owe = Math.max(0, Number(plan.deposit_pp) - p.paid - p.pending);
                await must(supabase.from('plan_transfers').insert({ plan_id: plan.id, from_id: p.player_id, to_id: null, amount: owe, confirmed: true, note: 'Deposit' }));
                pd.reload();
              }, 'Marked paid ✓')}>Mark paid</button>
            )}
            {status.is_admin && waiting.map((t) => (
              <button key={t.id} type="button" className="btn gold sm" disabled={busy} onClick={() => run(async () => { await must(supabase.from('plan_transfers').update({ confirmed: true }).eq('id', t.id)); pd.reload(); }, 'Ticked off ✓')}>✓ Got {money(t.amount)}</button>
            ))}
          </div>
        );
      })}
      {list.length === 0 && <div className="small muted" style={{ padding: '8px 14px' }}>Nobody.</div>}
    </div>
  );
  const unpaid = d.people.filter((p) => p.state === 'unpaid');
  const nudge = () => run(async () => {
    const r = await notify('nudge_deposit', { plan_id: plan.id });
    if (r?.sent) return `Reminder sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}`;
    const text = `💳 ${plan.name}: deposit is ${money(plan.deposit_pp)}. Still need it from ${unpaid.map((p) => name(p.player_id)).join(', ')}.${plan.kitty_note ? ` Pay to: ${plan.kitty_note}` : ''} Then tap “I’ve paid” in the app.`;
    const s = await shareText(text);
    return s === 'copied' ? 'Copied — paste it into Messenger' : null;
  }).then((m) => m && toast(m));
  return (
    <Sheet title={`Deposits · ${money(plan.deposit_pp)} each`} onClose={onClose}>
      <div className="stack">
        {section('Confirmed and paid', d.confirmedPaid, 'var(--navy)')}
        {section('Confirmed, not paid yet', d.confirmedNotPaid, '#7A5A00')}
        {section('Not confirmed yet', d.notConfirmed, 'var(--under)')}
        {status.is_admin && unpaid.length > 0 && <button type="button" className="btn ghost block" disabled={busy} onClick={nudge}>🔔 Nudge the {unpaid.length} who haven’t paid</button>}
        <span className="small muted">Payments land in the kitty — they show on the Kitty tab too.</span>
      </div>
    </Sheet>
  );
}
