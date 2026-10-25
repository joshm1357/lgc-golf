// One trip (or one-day round), from idea to the record afterwards.
//   /plan           → the Trips tab (Trips.jsx)
//   /plan/:planId   → one trip: Overview (at a glance, open votes) | Organise (six steps + More — OrganiseSteps.jsx)
// Anyone can suggest options, vote, chat, say if they're in and add jobs. The admin picks vote winners (or the trip's
// organiser too, if the group allows it) and locks the trip in, which makes it a trip in the app.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, cacheGet, cacheSet, useFeature } from '../lib/store.jsx';
import { Header, Avatar, AvatarStack, Sheet, Loading, Icon, toast, askConfirm } from '../components/ui.jsx';
import {
  tallyPoll, nonVoters, suggestions, fmtRange, countdown, nudgeText, RSVP_LABEL, DEFAULT_BRING, todayISO, money,
} from '../lib/plan.js';
import { notify, shareText, appLink, pushState, enablePush, disablePush, isIOS } from '../lib/push.js';
import TripExtras from './TripExtras.jsx';
import { TripFinderCard } from '../components/TripFinderCard.jsx';
import { TripBuilderCard } from '../components/TripBuilderCard.jsx';
import { VoteBatches } from '../components/VoteBatchCard.jsx';
import { TripOverview } from './TripOverview.jsx';
import { NextStepCard, makeTripJobs, lockInTrip, redateTripJobs } from './TripPlan.jsx';
import { openPlanningPolls, lockInWords, closePlanningVotes, closedAtLockIn } from '../lib/lockin.js';
import { OrganiseView } from './OrganiseSteps.jsx';
import { OverviewVotes } from '../components/OverviewVotes.jsx';
import { defaultView } from '../lib/tripsummary.js';
import { tripStage, planIsEmpty, canCallOff } from '../lib/trips.js';
import { RunUp } from '../components/RunUp.jsx';
import { showRunUp } from '../lib/runup.js';

const PLAN_TABLES = ['plans', 'plan_polls', 'plan_options', 'plan_votes', 'plan_rsvps', 'plan_items', 'plan_costs', 'plan_payments', 'plan_groups', 'plan_group_members', 'plan_transfers', 'plan_comments'];
const STATUS_LABEL = { planning: 'Planning', confirmed: 'Locked in', done: 'Done', cancelled: 'Called off' };

export { useRun, must } from '../lib/run.js';
import { useRun, must } from '../lib/run.js';
import { NotifyCard } from '../components/NotifyCard.jsx';
import { PollCard, DecidedLine } from '../components/PollCard.jsx';
import { HowItGoesOut } from '../components/CallVote.jsx';
import { defaultCloses } from '../lib/callvote.js';
import { useDesktop } from '../components/Sidebar.jsx';
import { gate } from '../lib/savedgate.js';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
// ov34: a round call-out (plans.callout) gets its own slim screen — no place votes, organise steps, run-up or kitty.
const RoundCallout = lazyScreen(() => import('./RoundCallout.jsx'));

export { NotifyCard };

// ---------------------------------------------------------------- Call it off / bring it back / delete (ov21)
// A live trip ("March") was hard-deleted with one tap on a browser "OK" box. Now "Call it off" keeps everything and
// can be undone; real deletion is only for an empty plan, and the organiser types the trip's name first.
const missingFn = (e) => /PGRST202|42883|function|schema cache/i.test(`${e?.code} ${e?.message}`);

/** Call a trip off (off = true) or bring it back. 091's call_off_plan records who; an older database: the admin's
 *  plain update. */
export async function callOffPlan(plan, off, isAdmin) {
  const { error } = await supabase.rpc('call_off_plan', { p_plan: plan.id, p_off: off });
  if (!error) return;
  if (!missingFn(error) || !isAdmin) throw error;
  const back = plan.trip_id ? 'confirmed' : 'planning';
  await must(supabase.from('plans').update({ status: off ? 'cancelled' : back }).eq('id', plan.id));
}

/** Delete an EMPTY plan (091's delete_empty_plan checks it's empty; an older database: a plain delete). */
export async function deleteEmptyPlan(plan) {
  const { error } = await supabase.rpc('delete_empty_plan', { p_plan: plan.id });
  if (!error) return;
  if (!missingFn(error)) throw error;
  await must(supabase.from('plans').delete().eq('id', plan.id));
}

/** "Called off by Josh · Bring it back" — on a called-off trip. */
export function CalledOffBanner({ plan, reload }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const by = data.playersById[plan.cancelled_by];
  const can = canCallOff({ isAdmin: !!status.is_admin, me: status.player_id, plan });
  const when = plan.cancelled_at ? new Date(plan.cancelled_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null;
  return (
    <div className="card pad stack" data-testid="called-off-banner" style={{ gap: 8, background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>
      <div>
        <strong>{plan.proposed ? 'This idea was passed on' : 'Called off'}{by ? ` by ${playerName(by)}` : ''}</strong>
        {when && <span className="small muted"> · {when}</span>}
        <div className="small">Everything’s kept — the votes, who was in, the jobs and the kitty.{can ? '' : ' An organiser can bring it back.'}</div>
      </div>
      {can && (
        <button type="button" className="btn gold" data-testid="bring-it-back" disabled={busy}
          onClick={() => run(async () => { await callOffPlan(plan, false, !!status.is_admin); reload?.(); }, 'It’s back on')}>
          ↩︎ Bring it back
        </button>
      )}
    </div>
  );
}

export function feedPost(me, plan, body) {
  return supabase.from('posts').insert({ kind: 'user', player_id: me, body, link: `/plan/${plan.id}` });
}

export function everyone(data) {
  return data.players.filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b)));
}

/** Share sheet → Messenger, or copy. */
export async function shareNudge(text) {
  const r = await shareText(text);
  if (r === 'copied') toast('Copied — paste it into Messenger');
  else if (r === 'failed') toast('Couldn’t share from this phone');
}

// ---------------------------------------------------------------- One plan

export function usePlanData(planId) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    const by = (t) => supabase.from(t).select('*').eq('plan_id', planId);
    let res;
    try {
      res = await Promise.all([
        supabase.from('plans').select('*').eq('id', planId).maybeSingle(),
        by('plan_polls').order('created_at'), by('plan_rsvps'), by('plan_items').order('sort').order('created_at'),
        by('plan_costs').order('created_at'), by('plan_payments'), by('plan_groups').order('sort').order('created_at'),
        by('plan_transfers').order('created_at'), by('plan_comments').order('created_at'),
      ]);
    } catch {
      res = [{ error: true }];
    }
    const [plan, polls, rsvps, items, costs, payments, groups, transfers, comments] = res;
    if (plan.error) {
      // No signal: show the copy saved on this phone last time.
      const c = cacheGet(`plan-${planId}`);
      if (c) setD((cur) => cur || { ...c, reload: load, offline: true });
      return;
    }
    const pollIds = (polls.data || []).map((p) => p.id);
    const groupIds = (groups.data || []).map((g) => g.id);
    const [options, votes, members, group] = await Promise.all([
      pollIds.length ? supabase.from('plan_options').select('*').in('poll_id', pollIds).order('start_date', { nullsFirst: false }).order('created_at') : { data: [] },
      pollIds.length ? supabase.from('plan_votes').select('*').in('poll_id', pollIds) : { data: [] },
      groupIds.length ? supabase.from('plan_group_members').select('*').in('group_id', groupIds) : { data: [] },
      plan.data ? supabase.from('groups').select('vote_decider').eq('id', plan.data.group_id).maybeSingle() : { data: null },
    ]);
    const next = {
      plan: plan.data, polls: polls.data || [], rsvps: rsvps.data || [], items: items.data || [], costs: costs.data || [],
      payments: payments.data || [], groups: groups.data || [], options: options.data || [], votes: votes.data || [], members: members.data || [],
      transfers: transfers.data || [], comments: comments?.data || [],
      // Older databases (before 025) have no vote_decider: the admin decides.
      voteDecider: group?.data?.vote_decider || 'admin',
    };
    cacheSet(`plan-${planId}`, next);
    setD({ ...next, reload: load });
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(PLAN_TABLES, load);
  return d;
}

export function PlanDetail() {
  const { planId } = useParams();
  const [params, setParams] = useSearchParams();
  const { status } = useSession();
  const pd = usePlanData(planId);
  const data = useData();
  const [editing, setEditing] = useState(false);
  const wide = useDesktop();
  // Old addresses (notifications, shared links) say ?tab=vote / people / jobs / kitty / groups / chat / details.
  const tab = params.get('tab');
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', 'organise'); n.set('tab', t); n.delete('step'); return n; }, { replace: true });
  // Overview (the trip at a glance and its open votes — everyone) or Organise (the steps). Josh, 21–22 Oct.
  const setView = (v, t = null) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', v); n.delete('step'); if (t) n.set('tab', t); else n.delete('tab'); return n; }, { replace: true });

  if (!pd) return <div className="page"><Header back="Trips" title="Loading…" /><Loading /></div>;
  if (!pd.plan) return <div className="page"><Header back="Trips" title="Not found" /><div className="empty">This trip has been removed.</div></div>;
  const { plan } = pd;
  // ov34: a call-out opens its own screen (?full=1 still shows the trip planner, for anything the extras don't cover).
  if (plan.callout && params.get('full') !== '1') return <LazyArea resetKey={plan.id} fallback={<Loading />}><RoundCallout pd={pd} /></LazyArea>;
  const trip = plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null;
  const stage = tripStage(plan, trip);
  const isAdmin = !!status.is_admin;
  // A player's vote link (?tab=vote) lands on the Overview, where the votes are; organisers get Organise → Vote.
  const fromTab = tab ? (tab === 'vote' && !isAdmin ? 'overview' : 'organise') : null;
  const asked = params.get('view');
  // ov27 (R2): a guest has no Organise view — always the overview.
  const guest = status.role === 'guest';
  const view = guest && stage !== 'cancelled' ? 'overview' : stage === 'cancelled' ? 'organise'
    : asked === 'organise' || asked === 'overview' ? asked : fromTab || defaultView(stage, isAdmin);
  const sub = [plan.start_date ? `${fmtRange(plan.start_date, plan.end_date)} · ${countdown(plan.start_date)}` : 'Dates TBC', plan.location_name || 'Location TBC'].join(' · ');
  // Laptop + one of the trip's organisers: the slim status column down the right (was the Trip desk, 22 Oct).
  const organiser = isAdmin || (!!status.player_id && plan.organiser_id === status.player_id);
  const desk = wide && view === 'organise' && plan.status !== 'cancelled' && organiser;

  return (
    <div className={'page' + (desk ? ' org-desk-page' : '')}>
      <Header back="Trips" title={plan.name} sub={sub}
        right={(isAdmin || (plan.proposed && plan.created_by === status.player_id)) && <button type="button" className="btn ghost sm" style={{ color: '#fff', background: 'transparent', borderColor: 'rgba(255,255,255,.45)' }} onClick={() => setEditing(true)}>Edit</button>}>
        {plan.status !== 'cancelled' && !guest && (
          <div className="chips" role="tablist" aria-label="View" style={{ margin: '4px -16px 0', padding: '0 16px' }}>
            {[{ value: 'overview', label: '⛳ Overview' }, { value: 'organise', label: '🧰 Plan the trip' }].map((v) => (
              <button key={v.value} type="button" role="tab" className="chip" aria-selected={v.value === view} onClick={() => setView(v.value)}
                style={v.value === view ? { background: '#fff', borderColor: '#fff', color: 'var(--navy)', fontWeight: 800 } : { background: 'transparent', borderColor: 'rgba(255,255,255,.35)', color: '#fff' }}>{v.label}</button>
            ))}
          </div>
        )}
      </Header>
      {view === 'overview' ? (
        <>
          {/* A player's own next thing (a deposit, a job). Organisers get theirs on Organise; votes are below. */}
          {/* ov27 (R1): on a locked-in trip the run-up's own "Your to-dos" carry this, under Your weekend. */}
          {!isAdmin && !showRunUp(stage) && <NextStepCard pd={pd} stage={stage} onTab={setTab} hideVotes />}
          <div className="section">
            {plan.proposed && !isAdmin && <div style={{ marginBottom: 12 }}><ProposalBanner plan={plan} reload={pd.reload} /></div>}
            <TripOverview trip={trip} plan={plan} rsvps={pd.rsvps} items={pd.items} stage={stage} onOrganise={(t) => setView('organise', t)}
              votes={showRunUp(stage) ? null : <OverviewVotes pd={pd} />}
              runUp={showRunUp(stage) ? <RunUp pd={pd} trip={trip} onOrganise={(t) => setView('organise', t)} /> : null} />
            {/* ov23: the same for organisers and players — "how it's coming together", never "Build the trip" here. */}
            {plan.status === 'planning' && <div style={{ marginTop: 14 }}><TripBuilderCard pd={pd} viewer /></div>}
            {/* After the trip: rate the course and the dinner awards belong with the summary. */}
            {stage === 'done' && <div className="stack" style={{ marginTop: 14 }}><TripFinderCard pd={pd} /><TripExtras pd={pd} viewer /></div>}
          </div>
        </>
      ) : (
        <OrganiseView pd={pd} stage={stage} trip={trip} wide={wide} desk={desk} onEdit={() => setEditing(true)} />
      )}
      {editing && <PlanSheet plan={plan} pd={pd} onClose={() => setEditing(false)} onSaved={() => pd.reload()} />}
    </div>
  );
}

// ---------------------------------------------------------------- Organiser's checklist (suggestions, never automatic)

export function Checklist({ pd, onGo, open: startOpen = false }) {
  const data = useData();
  const { status } = useSession();
  const [open, setOpen] = useState(startOpen);
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem(`lgc-hide-${pd.plan.id}`) || '[]'); } catch { return []; } });
  const [busy, run] = useRun();
  const list = useMemo(() => suggestions(pd.plan, { ...pd, playerIds: everyone(data).map((p) => p.id) }), [pd, data]);
  if (!status.is_admin || pd.plan.proposed || pd.plan.status === 'done' || pd.plan.status === 'cancelled') return null;
  const shown = list.filter((s) => !hidden.includes(s.key));
  if (!shown.length) return null;
  const hide = (k) => {
    const next = [...hidden, k];
    setHidden(next);
    try { localStorage.setItem(`lgc-hide-${pd.plan.id}`, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const act = (s) => run(async () => {
    if (s.action?.type === 'job') {
      await must(supabase.from('plan_items').insert({ plan_id: pd.plan.id, kind: 'job', title: s.action.title }));
      return 'Added to jobs — give it an owner';
    }
    if (s.action?.type === 'bring') {
      await must(supabase.from('plan_items').insert(DEFAULT_BRING.map((t, i) => ({ plan_id: pd.plan.id, kind: 'bring', title: t, sort: i }))));
      return 'Added the usual list';
    }
    onGo(s.tab);
    return null;
  }).then((msg) => msg && toast(msg));
  const overdue = shown.filter((s) => s.when === 'Overdue').length;
  const items = open ? shown : [];
  return (
    <div className="card" style={{ borderColor: 'var(--gold)', overflow: 'hidden' }}>
      <button type="button" className="row between" onClick={() => setOpen(!open)} style={{ width: '100%', padding: '12px 14px', background: 'var(--gold-soft)', border: 0, textAlign: 'left' }}>
        <span><strong>📝 Organiser’s checklist</strong><div className="small muted">Suggestions — nothing happens until you tap</div></span>
        <span className="small" style={{ fontWeight: 700, whiteSpace: 'nowrap', color: overdue ? 'var(--under)' : 'var(--navy)' }}>{overdue ? `${overdue} overdue` : `${shown.length} to sort`} {open ? '▴' : '▾'}</span>
      </button>
      {items.map((s) => (
        <div key={s.key} style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
          <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>{s.title} <span className="small" style={{ fontWeight: 700, color: s.when === 'Overdue' ? 'var(--under)' : 'var(--muted)' }}>· {s.when}</span></div>
              <div className="small muted">{s.why}</div>
            </div>
            <button type="button" className="btn ghost sm" aria-label="Hide this suggestion" onClick={() => hide(s.key)}>{Icon.x(14)}</button>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => act(s)}>
            {s.action?.type === 'job' ? '+ Add as a job' : s.action?.type === 'bring' ? '+ Add the usual list' : 'Go →'}
          </button>
        </div>
      ))}

    </div>
  );
}

// ---------------------------------------------------------------- Vote

// The Vote step on Organise: the votes (organiser results), Call a vote, and the decided ones.
// showCall=false: the screen already has its own Call a vote button (Organise step 1 while planning), so one per screen.
export function VoteTab({ pd, showCall = true }) {
  const { status } = useSession();
  const [creating, setCreating] = useState(false);
  const open = pd.polls.filter((p) => p.status === 'open' && !p.vote_batch); // combined cards (077) show in VoteBatches
  // V1: votes closed when the trip was locked in show as one line ("Decided: Fri 22 – Mon 25 Jan, Nowra").
  const atLockIn = pd.polls.filter((p) => !p.vote_batch && closedAtLockIn(p, pd.plan));
  const closed = pd.polls.filter((p) => p.status === 'closed' && !p.vote_batch && !atLockIn.includes(p));
  return (
    <>
      {pd.polls.length === 0 && <div className="empty">No votes yet.{status.is_admin ? ' Put one up — dates, place, or anything else.' : ' An organiser will put one up.'}</div>}
      <VoteBatches pd={pd} />
      {open.map((p) => <PollCard key={p.id} poll={p} pd={pd} />)}
      {status.is_admin && showCall && <button {...gate('call_vote')} type="button" className="btn ghost block" onClick={() => setCreating(true)} data-testid="call-a-vote">🗳️ Call a vote</button>}
      {(closed.length > 0 || atLockIn.length > 0) && <span className="label">Decided</span>}
      {atLockIn.length > 0 && <DecidedLine plan={pd.plan} titles={atLockIn.map((p) => p.question)} />}
      {closed.map((p) => <PollCard key={p.id} poll={p} pd={pd} />)}
      <p className="note" style={{ margin: 0 }}>Dates: ✓ Yes · ? Maybe · ✗ No. Places: ⭐ Keen · 👍 Happy with it · 👎 Not keen. The first is 2 points, the middle 1. Anyone can add an option. {pd.voteDecider === 'admin_or_organiser' ? 'A group organiser or the trip’s organiser' : 'An organiser'} closes the vote and picks the winner.</p>
      {creating && <PollSheet pd={pd} onClose={() => setCreating(false)} />}
    </>
  );
}

export function optionTitle(poll, o) {
  if (poll.kind === 'dates' && o.start_date) return fmtRange(o.start_date, o.end_date);
  return o.label;
}

// One vote: organiser and voter views (080) — components/PollCard.jsx.
export { PollCard };

function OptionFields({ kind, v, set }) {
  return (
    <>
      {kind === 'dates' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field"><span>From</span><input className="input" type="date" value={v.start_date || ''} onChange={(e) => set({ ...v, start_date: e.target.value, end_date: v.end_date && v.end_date >= e.target.value ? v.end_date : e.target.value })} /></label>
          <label className="field"><span>To</span><input className="input" type="date" value={v.end_date || ''} min={v.start_date || undefined} onChange={(e) => set({ ...v, end_date: e.target.value })} /></label>
        </div>
      ) : (
        <label className="field"><span>{kind === 'location' ? 'Place' : 'Option'}</span><input className="input" value={v.label || ''} onChange={(e) => set({ ...v, label: e.target.value })} placeholder={kind === 'location' ? 'e.g. Port Stephens' : ''} /></label>
      )}
      {kind === 'location' && (
        <>
          <label className="field"><span>Courses / address (optional)</span><input className="input" value={v.address || ''} onChange={(e) => set({ ...v, address: e.target.value })} placeholder="e.g. Horizons + Newcastle GC" /></label>
          <label className="field"><span>Rough cost per head $ (optional)</span><input className="input" inputMode="decimal" value={v.cost_pp ?? ''} onChange={(e) => set({ ...v, cost_pp: e.target.value })} /></label>
        </>
      )}
      <label className="field"><span>{kind === 'dates' ? 'Note (optional)' : 'Link (optional)'}</span>
        {kind === 'dates'
          ? <input className="input" value={v.notes || ''} onChange={(e) => set({ ...v, notes: e.target.value })} placeholder="e.g. long weekend" />
          : <input className="input" type="url" value={v.link || ''} onChange={(e) => set({ ...v, link: e.target.value })} placeholder="Airbnb / course website" />}
      </label>
    </>
  );
}

function cleanOption(kind, v) {
  const row = {
    label: kind === 'dates' ? (v.start_date ? fmtRange(v.start_date, v.end_date) : '') : (v.label || '').trim(),
    start_date: kind === 'dates' ? v.start_date || null : null,
    end_date: kind === 'dates' ? v.end_date || v.start_date || null : null,
    address: v.address?.trim() || null,
    link: v.link?.trim() || null,
    cost_pp: v.cost_pp === '' || v.cost_pp == null ? null : Number(String(v.cost_pp).replace(/[^0-9.]/g, '')) || null,
    notes: v.notes?.trim() || null,
  };
  return row.label ? row : null;
}

export function OptionSheet({ poll, onClose, onSaved }) {
  const [v, set] = useState({});
  const [busy, run] = useRun();
  return (
    <Sheet title={poll.question} onClose={onClose}>
      <div className="stack">
        <OptionFields kind={poll.kind} v={v} set={set} />
        <button type="button" className="btn gold block" disabled={busy || !cleanOption(poll.kind, v)} onClick={() => run(async () => {
          await must(supabase.from('plan_options').insert({ poll_id: poll.id, ...cleanOption(poll.kind, v) }));
          onSaved(); onClose();
        }, 'Added')}>Add it</button>
      </div>
    </Sheet>
  );
}

const QUESTION = { dates: 'Which weekend works?', location: 'Where should we go?', other: '' };

export function PollSheet({ pd, onClose }) {
  const { status } = useSession();
  const [kind, setKind] = useState(pd.polls.some((p) => p.kind === 'dates') ? 'location' : 'dates');
  const [question, setQuestion] = useState(QUESTION[kind]);
  const [closes, setCloses] = useState(() => defaultCloses(todayISO()));
  const [opts, setOpts] = useState([{}, {}]);
  const [busy, run] = useRun();
  const [called, setCalled] = useState(null);
  const good = opts.map((o) => cleanOption(kind, o)).filter(Boolean);
  const pick = (k) => { setKind(k); setQuestion(QUESTION[k]); setOpts([{}, {}]); };
  if (called) {
    return (
      <Sheet title="The vote’s out" onClose={onClose}>
        <div className="stack"><HowItGoesOut plan={pd.plan} title={called.question} closes={called.closes_on} /><button type="button" className="btn ghost block" onClick={onClose}>Done</button></div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Call a vote" onClose={onClose}>
      <div className="stack">
        <div className="seg light" role="group">
          {[['dates', 'Dates'], ['location', 'Location'], ['other', 'Anything else']].map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => pick(k)}>{l}</button>)}
        </div>
        <label className="field"><span>Question</span><input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Shirt colour?" /></label>
        <label className="field"><span>Closes (a reminder goes out the day before)</span><input className="input" type="date" value={closes} min={todayISO()} onChange={(e) => setCloses(e.target.value)} /></label>
        <span className="label">What goes on the ballot {kind !== 'other' && '(the lads can add more)'}</span>
        {opts.map((o, i) => (
          <div key={i} className="card pad stack" style={{ gap: 8 }}>
            <OptionFields kind={kind} v={o} set={(nv) => setOpts(opts.map((x, j) => (j === i ? nv : x)))} />
          </div>
        ))}
        <button type="button" className="btn ghost sm" onClick={() => setOpts([...opts, {}])}>+ Another option</button>
        <button type="button" className="btn gold block" disabled={busy || !question.trim()} onClick={() => run(async () => {
          const poll = await must(supabase.from('plan_polls').insert({ plan_id: pd.plan.id, kind, question: question.trim(), closes_on: closes || null }).select().single());
          if (good.length) await must(supabase.from('plan_options').insert(good.map((g) => ({ ...g, poll_id: poll.id }))));
          await feedPost(status.player_id, pd.plan, `🗳️ New vote for ${pd.plan.name}: ${poll.question} — have your say.`);
          notify('poll_open', { poll_id: poll.id }).catch(() => {});
          pd.reload();
          setCalled(poll);
        })}>🗳️ Call the vote</button>
      </div>
    </Sheet>
  );
}

export function CloseSheet({ poll, rows, pd, onClose }) {
  const { status } = useSession();
  const [pick, setPick] = useState(rows[0]?.option.id || null);
  const [apply, setApply] = useState(poll.kind !== 'other');
  const [busy, run] = useRun();
  return (
    <Sheet title="Close the vote" onClose={onClose}>
      <div className="stack">
        <span className="small muted">Pick the winner — it doesn’t have to be the top score.</span>
        {rows.map((r) => (
          <button key={r.option.id} type="button" className="chip" style={{ textAlign: 'left', whiteSpace: 'normal', minHeight: 48 }} aria-pressed={pick === r.option.id} onClick={() => setPick(r.option.id)}>
            {optionTitle(poll, r.option)} · {r.score} pts (✓{r.yes.length} ?{r.maybe.length} ✗{r.no.length})
          </button>
        ))}
        {poll.kind !== 'other' && (
          <label className="row" style={{ gap: 8, fontWeight: 600 }}>
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span>Set the {poll.kind === 'dates' ? 'trip dates' : 'place'} to the winner</span>
          </label>
        )}
        <button type="button" className="btn gold block" disabled={busy || !pick} onClick={() => run(async () => {
          const o = rows.find((r) => r.option.id === pick).option;
          // One step on the server: closes the vote, records the winner and (if ticked) sets the trip's dates or place.
          const { error } = await supabase.rpc('decide_poll', { p_poll: poll.id, p_option: pick, p_apply: apply && poll.kind !== 'other' });
          if (error && /decide_poll|PGRST202|function/i.test(`${error.code} ${error.message}`) && status.is_admin) {
            // A database from before Stage 1b: the admin closes it the old way.
            await must(supabase.from('plan_polls').update({ status: 'closed', winner_option_id: pick }).eq('id', poll.id));
            if (apply && poll.kind === 'dates' && o.start_date) await must(supabase.from('plans').update({ start_date: o.start_date, end_date: o.end_date || o.start_date }).eq('id', pd.plan.id));
            if (apply && poll.kind === 'location') await must(supabase.from('plans').update({ location_name: o.label, address: o.address || pd.plan.address, link: o.link || pd.plan.link }).eq('id', pd.plan.id));
          } else if (error) throw error;
          await feedPost(status.player_id, pd.plan, `✅ ${pd.plan.name} — ${poll.question} ${optionTitle(poll, o)}.`);
          await notify('poll_decided', { poll_id: poll.id });
          pd.reload(); onClose();
        }, 'Decided — everyone’s been told')}>Pick this winner</button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Who's in

export function PeopleTab({ pd }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const { plan } = pd;
  const [busy, run] = useRun();
  const [editFor, setEditFor] = useState(null);
  const mine = pd.rsvps.find((r) => r.player_id === me);
  const [note, setNote] = useState(mine?.note || '');
  useEffect(() => { setNote(mine?.note || ''); }, [mine?.note]);
  const people = everyone(data);
  const by = (s) => pd.rsvps.filter((r) => r.status === s);
  const replied = new Set(pd.rsvps.map((r) => r.player_id));
  const noReply = people.filter((p) => !replied.has(p.id));
  const locked = plan.rsvp_locked;

  const setMine = (s) => run(async () => {
    await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status: s, note: note.trim() || null, updated_at: new Date().toISOString() }));
    pd.reload();
  }, s === 'in' ? 'You’re in 🍻' : 'Saved');

  const group = (label, list, colour) => list.length > 0 && (
    <div className="card">
      <div className="small" style={{ padding: '8px 14px', fontWeight: 800, color: colour, borderBottom: '1px solid var(--line-soft)' }}>{label} · {list.length}</div>
      {list.map(({ p, r }) => (
        <button key={p.id} type="button" className="row" disabled={!status.is_admin} onClick={() => setEditFor(p)}
          style={{ width: '100%', padding: '8px 14px', border: 0, borderBottom: '1px solid var(--line-soft)', background: '#fff', textAlign: 'left', color: 'inherit' }}>
          <Avatar player={p} size={32} />
          <span className="grow"><strong>{playerName(p)}</strong>{r?.note && <div className="small muted">“{r.note}”</div>}</span>
          {status.is_admin && <span className="small muted">change</span>}
        </button>
      ))}
    </div>
  );
  const withP = (rs) => rs.map((r) => ({ r, p: data.playersById[r.player_id] })).filter((x) => x.p);

  return (
    <>
      {locked
        ? <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}><strong>🔒 The list is locked.</strong> <span className="small">{by('in').length} confirmed. Need to change? Talk to the admin.</span></div>
        : plan.rsvp_deadline && <div className="small"><strong>Reply by {fmtRange(plan.rsvp_deadline)}</strong> <span className="muted">({countdown(plan.rsvp_deadline)})</span></div>}
      {me && (
        <div className="card pad stack" style={{ gap: 8 }}>
          <strong>Are you in?</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[['in', '👍 In', 'var(--navy)'], ['maybe', '🤔 Maybe', '#7A5A00'], ['out', '👎 Out', 'var(--under)']].map(([s, label, colour]) => (
              <button key={s} type="button" className="btn ghost" aria-pressed={mine?.status === s} disabled={busy || (locked && !status.is_admin)}
                style={{ minHeight: 54, padding: '0 6px', whiteSpace: 'nowrap', ...(mine?.status === s ? { background: colour, borderColor: colour, color: '#fff' } : {}) }} onClick={() => setMine(s)}>{label}</button>
            ))}
          </div>
          {!(locked && !status.is_admin) && (
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. Sat–Sun only" />
              {mine && note !== (mine.note || '') && <button type="button" className="btn sm" onClick={() => setMine(mine.status)}>Save</button>}
            </div>
          )}
        </div>
      )}
      {group('IN', withP(by('in')), 'var(--navy)')}
      {group('MAYBE', withP(by('maybe')), '#7A5A00')}
      {group('OUT', withP(by('out')), 'var(--under)')}
      {group('NO REPLY YET', noReply.map((p) => ({ p, r: null })), 'var(--muted)')}
      {!locked && noReply.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn ghost sm" onClick={() => shareNudge(nudgeText('rsvp', { plan, names: noReply.map(playerName), url: appLink(`/plan/${plan.id}?tab=people`) }))}>💬 Nudge in Messenger</button>
          {status.is_admin && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const r = await notify('nudge_rsvp', { plan_id: plan.id }); toast(`Reminder sent to ${r.sent || 0} phone${r.sent === 1 ? '' : 's'}`); })}>🔔 Send reminder</button>}
        </div>
      )}
      {status.is_admin && (
        <div className="card pad stack" style={{ gap: 8 }}>
          <span className="label">Organiser</span>
          {locked ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => { await must(supabase.from('plans').update({ rsvp_locked: false }).eq('id', plan.id)); pd.reload(); }, 'Unlocked — the lads can change their answer')}>🔓 Unlock the list</button>
          ) : (
            <button type="button" className="btn ghost" disabled={busy || by('in').length === 0} onClick={() => {
              if (!window.confirm(`Lock in the ${by('in').length} who are in? After this only you can change who’s coming.`)) return;
              run(async () => {
                await must(supabase.from('plans').update({ rsvp_locked: true, status: plan.status === 'planning' ? 'confirmed' : plan.status }).eq('id', plan.id));
                // V1: locking the list locks the trip in, so its votes on where and when close too.
                if (plan.status === 'planning') await closePlanningVotes(supabase, pd.polls);
                await feedPost(me, plan, `🔒 ${plan.name}: the list is locked — ${by('in').length} in: ${withP(by('in')).map(({ p }) => playerName(p)).join(', ')}.`);
                await notify('rsvp_locked', { plan_id: plan.id });
                pd.reload();
              }, 'Locked in — everyone’s been told');
            }}>🔒 Lock in who’s coming ({by('in').length})</button>
          )}
          <span className="small muted">Tap anyone above to set their answer for them (e.g. if they told you in the chat).</span>
        </div>
      )}
      {editFor && (
        <Sheet title={playerName(editFor)} onClose={() => setEditFor(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {['in', 'maybe', 'out'].map((s) => (
              <button key={s} type="button" className="btn ghost" style={{ minHeight: 54 }} disabled={busy} onClick={() => run(async () => {
                await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: editFor.id, status: s, updated_at: new Date().toISOString() }));
                pd.reload(); setEditFor(null);
              }, 'Updated')}>{RSVP_LABEL[s]}</button>
            ))}
          </div>
          {pd.rsvps.some((r) => r.player_id === editFor.id) && (
            <button type="button" className="btn ghost block" style={{ marginTop: 10 }} onClick={() => run(async () => {
              await must(supabase.from('plan_rsvps').delete().eq('plan_id', plan.id).eq('player_id', editFor.id)); pd.reload(); setEditFor(null);
            }, 'Cleared')}>Clear their answer</button>
          )}
        </Sheet>
      )}
    </>
  );
}

export function ProposalBanner({ plan, reload }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const by = data.playersById[plan.created_by];
  return (
    <div className="card pad stack" style={{ gap: 8, background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>
      <div><strong>💡 An idea from {by ? playerName(by) : 'one of the lads'}.</strong> <span className="small">Vote on when and where, say if you’d be in, and talk it over on Chat — an organiser decides whether it goes ahead.</span></div>
      {status.is_admin && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => run(async () => {
            await must(supabase.from('plans').update({ proposed: false }).eq('id', plan.id));
            await feedPost(status.player_id, plan, `🗓️ It’s on: ${plan.name} is being planned (thanks ${by ? playerName(by) : 'mate'}). Say if you’re in.`);
            await notify('plan_new', { plan_id: plan.id });
            reload();
          }, 'Approved — planning’s open')}>✅ Approve — start planning</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => {
            if (!(await askConfirm({ title: 'Pass on this idea?', body: 'It moves to “Called off” on Trips with its votes and replies kept. You can bring it back.', yes: 'Pass on it' }))) return;
            run(async () => { await callOffPlan(plan, true, true); reload(); }, 'Passed');
          }}>Pass</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Create / edit a plan (admin, or a suggestion from anyone)

/** The bottom of Edit (ov21): "Call it off" (keeps everything, undoable) and — only for an empty plan — Delete,
 *  after typing the trip's name. No browser "OK" boxes. */
function EndPlan({ plan, pd, onClose }) {
  const { status } = useSession();
  const data = useData();
  const nav = useNavigate();
  const [busy, run] = useRun();
  const isAdmin = !!status.is_admin;
  const can = canCallOff({ isAdmin, me: status.player_id, plan });
  const empty = planIsEmpty(pd, data.rounds);
  const mine = !isAdmin && plan.proposed && plan.created_by === status.player_id;
  if (!can && !(empty && mine)) return null;
  const callOff = async () => {
    const yes = await askConfirm({
      title: mine ? 'Withdraw your idea?' : `Call off ${plan.name}?`,
      body: 'Everything’s kept — the votes, who was in, the jobs and the kitty. It moves to “Called off” on Trips, and an organiser can bring it back.',
      yes: mine ? 'Withdraw it' : 'Call it off',
    });
    if (!yes) return;
    run(async () => { await callOffPlan(plan, true, isAdmin); onClose(); pd?.reload?.(); }, mine ? 'Withdrawn' : 'Called off — tap Bring it back to undo');
  };
  const del = async () => {
    const yes = await askConfirm({
      title: `Delete ${plan.name}?`,
      body: 'Nobody has replied, voted or added anything yet, so it can go for good. This can’t be undone.',
      yes: 'Delete for good', typeName: plan.name,
    });
    if (!yes) return;
    run(async () => { await deleteEmptyPlan(plan); onClose(); nav('/plan'); }, 'Deleted');
  };
  return (
    <div className="stack" style={{ gap: 8, marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
      {can && plan.status !== 'cancelled' && (
        <button type="button" className="btn ghost block" data-testid="call-it-off" disabled={busy} onClick={callOff}>
          {mine ? 'Withdraw my idea' : '✋ Call it off'}
        </button>
      )}
      {empty && (isAdmin || mine) && (
        <button type="button" className="btn ghost block" data-testid="delete-plan" disabled={busy} onClick={del} style={{ color: 'var(--under)' }}>
          Delete for good
        </button>
      )}
      {!empty && isAdmin && <span className="small muted" data-testid="no-delete-note">It has replies, votes or jobs on it, so it can’t be deleted — call it off instead (that keeps everything).</span>}
    </div>
  );
}

function PlanSheet({ plan, pd, onClose, onSaved }) {
  const { status } = useSession();
  const data = useData();
  const [v, set] = useState(() => plan || { kind: 'trip', name: '', status: 'planning' });
  const [busy, run] = useRun();
  const f = (k) => ({ value: v[k] ?? '', onChange: (e) => set({ ...v, [k]: e.target.value }) });
  const save = () => run(async () => {
    const row = {
      kind: v.kind, name: v.name.trim(), status: status.is_admin ? v.status || 'planning' : 'planning',
      start_date: v.start_date || null, end_date: v.kind === 'round' ? v.start_date || null : v.end_date || v.start_date || null,
      location_name: v.location_name?.trim() || null, address: v.address?.trim() || null, link: v.link?.trim() || null,
      brief: v.brief?.trim() || null, rsvp_deadline: v.rsvp_deadline || null, kitty_note: v.kitty_note?.trim() || null,
      ...(plan && status.is_admin && 'organiser_id' in plan ? { organiser_id: v.organiser_id || null } : {}),
    };
    if (plan) {
      await must(supabase.from('plans').update(row).eq('id', plan.id));
      // O7: the usual jobs move with the dates (the database does it too from 095).
      if (pd && row.start_date && plan.start_date && row.start_date !== String(plan.start_date).slice(0, 10)) await redateTripJobs({ ...plan, ...row }, pd.items, plan.start_date).catch(() => 0);
      onSaved?.(plan); onClose();
      return;
    }
    if (!status.is_admin) {
      // A suggestion: the lads can say if they'd be in; the admin approves or passes.
      const created = await must(supabase.from('plans').insert({ ...row, status: 'planning', proposed: true }).select().single());
      await must(supabase.from('plan_rsvps').upsert({ plan_id: created.id, player_id: status.player_id, status: 'in' }));
      await feedPost(status.player_id, created, `💡 New idea: ${created.name}${created.start_date ? ` (${fmtRange(created.start_date, created.end_date)})` : ''}${created.location_name ? ` at ${created.location_name}` : ''}. Open it and say if you’d be in.`);
      await notify('plan_proposed', { plan_id: created.id });
      onClose(); onSaved?.(created);
      toast('Suggested — the organisers have been told');
      return;
    }
    const created = await must(supabase.from('plans').insert(row).select().single());
    await feedPost(status.player_id, created, `🗓️ ${created.name} is being planned — open it to say if you’re in.`);
    const r = await notify('plan_new', { plan_id: created.id });
    onClose(); onSaved?.(created);
    toast(`Started${r.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} notified` : ''}`);
  });
  return (
    <Sheet title={plan ? 'Edit' : status.is_admin ? 'Plan something' : 'Suggest something'} onClose={onClose}>
      <div className="stack">
        <div className="seg light" role="group">
          <button type="button" aria-pressed={v.kind === 'trip'} onClick={() => set({ ...v, kind: 'trip' })}>🧳 Trip (away)</button>
          <button type="button" aria-pressed={v.kind === 'round'} onClick={() => set({ ...v, kind: 'round' })}>⛳ One-day round</button>
        </div>
        <label className="field"><span>Name</span><input className="input" {...f('name')} placeholder={v.kind === 'trip' ? 'e.g. Autumn trip 2027' : 'e.g. Xmas Ambrose'} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: v.kind === 'trip' ? '1fr 1fr' : '1fr', gap: 8 }}>
          <label className="field"><span>{v.kind === 'trip' ? 'From' : 'Date'} (blank = vote on it)</span><input className="input" type="date" {...f('start_date')} /></label>
          {v.kind === 'trip' && <label className="field"><span>To</span><input className="input" type="date" {...f('end_date')} min={v.start_date || undefined} /></label>}
        </div>
        <label className="field"><span>{v.kind === 'trip' ? 'Where (blank = vote on it)' : 'Course (blank = vote on it)'}</span><input className="input" {...f('location_name')} /></label>
        {plan && (
          <>
            <label className="field"><span>Address (for Maps)</span><input className="input" {...f('address')} /></label>
            <label className="field"><span>Link (accommodation, course…)</span><input className="input" type="url" {...f('link')} /></label>
            <label className="field"><span>The details — accommodation, check-in, meeting point, anything</span><textarea className="textarea" rows={5} style={{ padding: 12 }} {...f('brief')} /></label>
            <label className="field"><span>Reply by (reminder goes out the day before)</span><input className="input" type="date" {...f('rsvp_deadline')} /></label>
            <label className="field"><span>How to pay the kitty (shown on the Kitty tab)</span><input className="input" {...f('kitty_note')} placeholder="e.g. PayID 04xx xxx xxx — Josh" /></label>
            {status.is_admin && (
              <label className="field"><span>Organiser (can pick vote winners if the group allows it)</span>
                <select className="select" value={v.organiser_id || ''} onChange={(e) => set({ ...v, organiser_id: e.target.value || null })}>
                  <option value="">Nobody</option>
                  {everyone(data).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
                </select>
              </label>
            )}
            {status.is_admin && (
              <label className="field"><span>Status</span>
                <select className="select" {...f('status')}>{Object.entries(STATUS_LABEL).filter(([k]) => k !== 'cancelled' || plan.status === 'cancelled').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
            )}
          </>
        )}
        {!plan && !status.is_admin && <label className="field"><span>Pitch it to the lads (optional)</span><textarea className="textarea" rows={3} style={{ padding: 12 }} {...f('brief')} placeholder="Why it’d be great, rough cost, who’s keen…" /></label>}
        <button type="button" className="btn gold block" disabled={busy || !v.name?.trim()} onClick={save}>{plan ? 'Save' : status.is_admin ? 'Start planning' : 'Suggest it'}</button>
        {plan && <EndPlan plan={plan} pd={pd} onClose={onClose} />}
      </div>
    </Sheet>
  );
}


// ---------------------------------------------------------------- Lock it in

// "Lock it in now" on the Lock in step, for when the Next step is still on something else.
export function LockInCard({ pd }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const { plan } = pd;
  if (!status.is_admin || plan.proposed || plan.status !== 'planning') return null;
  const openVotes = openPlanningPolls(pd.polls).length;
  if (!plan.start_date) {
    return <div className="small muted" style={{ fontWeight: 600 }}>🔒 Once the dates are picked you can lock it in{openVotes ? ' — close the dates vote first' : ' (Edit → dates)'}.</div>;
  }
  return (
    <button type="button" className="card pad row" disabled={busy} style={{ textAlign: 'left', color: 'inherit', width: '100%', borderColor: 'var(--navy)', gap: 12 }} data-testid="lock-in-card"
      onClick={async () => {
        // V1: one box; the open votes on where and when close when it's locked in.
        if (!(await askConfirm(lockInWords(plan, pd.polls)))) return;
        run(async () => {
          await lockInTrip(pd, status);
          pd.reload();
        }, 'Locked in — the votes are closed and the jobs are ready');
      }}>
      <span style={{ fontSize: 26 }}>🔒</span>
      <span className="grow"><strong>Lock it in</strong><div className="small muted">{fmtRange(plan.start_date, plan.end_date)} · {plan.location_name || 'place TBC'} — makes it a trip in the app, ready for rounds.</div></span>
      <span className="btn ghost sm">Lock in now</span>
    </button>
  );
}

// ---------------------------------------------------------------- Chat (the back-and-forth on a trip)

export function ChatTab({ pd }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [text, setText] = useState('');
  const [busy, run] = useRun();
  const send = () => run(async () => {
    const body = text.trim();
    if (!body) return;
    const c = await must(supabase.from('plan_comments').insert({ plan_id: pd.plan.id, body }).select().single());
    setText('');
    pd.reload();
    notify('comment_added', { comment_id: c.id }).catch(() => {});
  });
  const when = (iso) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="stack">
      {pd.comments.length === 0 && <div className="empty">No chat yet. Got a thought on the dates, the place or the budget? Kick it off.</div>}
      {pd.comments.map((c) => {
        const p = data.playersById[c.player_id];
        const mine = c.player_id === me;
        return (
          <div key={c.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <Avatar player={p} size={32} />
            <div className="grow card" style={{ padding: '8px 12px', background: mine ? 'var(--gold-soft)' : '#fff' }}>
              <div className="row between" style={{ gap: 8 }}>
                <strong className="small">{p ? playerName(p) : 'Someone'}</strong>
                <span className="small muted">{when(c.created_at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</div>
              {c.day_date && <Link to={`/plan/${pd.plan.id}/days`} className="small" style={{ color: 'var(--navy)' }} data-testid="chat-day-tag">📅 On {new Date(`${String(c.day_date).slice(0, 10)}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} · day plan</Link>}
              {(mine || status.is_admin) && (
                <button type="button" className="small" style={{ border: 0, background: 'none', padding: 0, color: 'var(--muted)', marginTop: 2 }}
                  onClick={async () => { if (await askConfirm({ title: 'Delete this message?', yes: 'Delete it' })) run(async () => { await must(supabase.from('plan_comments').delete().eq('id', c.id)); pd.reload(); }); }}>Delete</button>
              )}
            </div>
          </div>
        );
      })}
      {me && (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="textarea" rows={2} maxLength={2000} style={{ padding: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something about this trip…" aria-label="Message" />
          <button type="button" className="btn gold" disabled={busy || !text.trim()} onClick={send}>Send</button>
        </div>
      )}
      <span className="small muted">Goes to everyone who’s in or maybe, the organiser, and anyone already in the chat.</span>
    </div>
  );
}
