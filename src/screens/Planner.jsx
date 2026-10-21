// One trip (or one-day round), from idea to the record afterwards.
//   /plan           → the Trips tab (Trips.jsx)
//   /plan/:planId   → one trip: Vote · Chat · Who's in · Details · Jobs · Kitty · Rooms & cars
// Anyone can suggest options, vote, chat, say if they're in and add jobs. The admin picks vote winners (or the trip's
// organiser too, if the group allows it) and locks the trip in, which makes it a trip in the app.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, cacheGet, cacheSet, useFeature } from '../lib/store.jsx';
import { Header, Avatar, AvatarStack, Sheet, Loading, Icon, toast } from '../components/ui.jsx';
import {
  tallyPoll, nonVoters, suggestions, fmtRange, countdown, nudgeText, RSVP_LABEL, DEFAULT_BRING, todayISO, money,
} from '../lib/plan.js';
import { notify, shareText, appLink, pushState, enablePush, disablePush, isIOS } from '../lib/push.js';
import { DetailsTab, JobsTab, KittyTab, GroupsTab } from './PlanTabs.jsx';
import { TripSetupCard } from './TripSetup.jsx';
import TripExtras from './TripExtras.jsx';
import { STAGES, STAGE_LABEL, tripStage, canDecide } from '../lib/trips.js';

const PLAN_TABLES = ['plans', 'plan_polls', 'plan_options', 'plan_votes', 'plan_rsvps', 'plan_items', 'plan_costs', 'plan_payments', 'plan_groups', 'plan_group_members', 'plan_transfers', 'plan_comments'];
const STATUS_LABEL = { planning: 'Planning', confirmed: 'Locked in', done: 'Done', cancelled: 'Called off' };

export { useRun, must } from '../lib/run.js';
import { useRun, must } from '../lib/run.js';
import { NotifyCard } from '../components/NotifyCard.jsx';

export { NotifyCard };

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

const TABS = [
  { value: 'vote', label: '🗳️ Vote', feature: 'planner_tasks' },
  { value: 'chat', label: '💬 Chat' },
  { value: 'people', label: '🙋 Who’s in' },
  { value: 'details', label: '📍 Details' },
  { value: 'jobs', label: '📋 Jobs', feature: 'planner_tasks' },
  { value: 'kitty', label: '💰 Kitty', feature: 'planner_costs' },
  { value: 'groups', label: '🛏️ Rooms & cars', feature: 'planner_rooms' },
];

export function PlanDetail() {
  const { planId } = useParams();
  const [params, setParams] = useSearchParams();
  const { status } = useSession();
  const pd = usePlanData(planId);
  const [editing, setEditing] = useState(false);
  // Tabs for switched-off features (Group & invites → Features) aren't shown.
  const on = { planner_tasks: useFeature('planner_tasks'), planner_costs: useFeature('planner_costs'), planner_rooms: useFeature('planner_rooms') };
  const tabs = TABS.filter((t) => !t.feature || on[t.feature]);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : null;
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  if (!pd) return <div className="page"><Header back="Trips" title="Loading…" /><Loading /></div>;
  if (!pd.plan) return <div className="page"><Header back="Trips" title="Not found" /><div className="empty">This trip has been removed.</div></div>;
  const { plan } = pd;
  // Open on the most useful tab: vote while a vote is open, otherwise the details.
  const current = tab || (on.planner_tasks && pd.polls.some((p) => p.status === 'open') ? 'vote' : plan.start_date ? 'details' : 'people');
  const sub = [plan.start_date ? `${fmtRange(plan.start_date, plan.end_date)} · ${countdown(plan.start_date)}` : 'Dates TBC', plan.location_name || 'Location TBC'].join(' · ');

  return (
    <div className="page">
      <Header back="Trips" title={plan.name} sub={sub}
        right={(status.is_admin || (plan.proposed && plan.created_by === status.player_id)) && <button type="button" className="btn ghost sm" style={{ color: '#fff', background: 'transparent', borderColor: 'rgba(255,255,255,.45)' }} onClick={() => setEditing(true)}>Edit</button>}>
        <div className="chips" role="tablist" aria-label="Sections" style={{ margin: '4px -16px 0', padding: '0 16px' }}>
          {tabs.map((t) => (
            <button key={t.value} type="button" role="tab" className="chip" aria-selected={t.value === current} onClick={() => setTab(t.value)}
              style={t.value === current ? { background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy)' } : { background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.35)', color: '#fff' }}>{t.label}</button>
          ))}
        </div>
      </Header>
      <div className="section stack">
        {plan.status === 'cancelled' && <div className="err">{plan.proposed ? 'The admin passed on this one.' : 'This one’s been called off.'}</div>}
        {plan.status !== 'cancelled' && <StageBar pd={pd} />}
        {plan.proposed && plan.status !== 'cancelled' && <ProposalBanner plan={plan} reload={pd.reload} />}
        <LockInCard pd={pd} />
        {on.planner_tasks && <Checklist pd={pd} onGo={setTab} />}
        <TripSetupCard plan={plan} reload={pd.reload} />
        <TripExtras pd={pd} />
        {current === 'vote' && <VoteTab pd={pd} />}
        {current === 'chat' && <ChatTab pd={pd} />}
        {current === 'people' && <PeopleTab pd={pd} />}
        {current === 'details' && <DetailsTab pd={pd} />}
        {current === 'jobs' && <JobsTab pd={pd} />}
        {current === 'kitty' && <KittyTab pd={pd} />}
        {current === 'groups' && <GroupsTab pd={pd} />}
      </div>
      {editing && <PlanSheet plan={plan} onClose={() => setEditing(false)} onSaved={() => pd.reload()} />}
    </div>
  );
}

// ---------------------------------------------------------------- Organiser's checklist (suggestions, never automatic)

function Checklist({ pd, onGo }) {
  const data = useData();
  const { status } = useSession();
  const [open, setOpen] = useState(false);
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

function VoteTab({ pd }) {
  const { status } = useSession();
  const [creating, setCreating] = useState(false);
  const open = pd.polls.filter((p) => p.status === 'open');
  const closed = pd.polls.filter((p) => p.status === 'closed');
  return (
    <>
      {pd.polls.length === 0 && <div className="empty">No votes yet.{status.is_admin ? ' Put one up — dates, place, or anything else.' : ' The admin will put one up.'}</div>}
      {open.map((p) => <PollCard key={p.id} poll={p} pd={pd} />)}
      {status.is_admin && <button type="button" className="btn gold block" onClick={() => setCreating(true)}>+ New vote</button>}
      {closed.length > 0 && <span className="label">Decided</span>}
      {closed.map((p) => <PollCard key={p.id} poll={p} pd={pd} />)}
      <p className="note" style={{ margin: 0 }}>Mark every option ✓ Can, ? Maybe or ✗ Can’t. ✓ = 2 points, ? = 1. Anyone can add an option. {pd.voteDecider === 'admin_or_organiser' ? 'The admin or the trip’s organiser' : 'The admin'} closes the vote and picks the winner.</p>
      {creating && <PollSheet pd={pd} onClose={() => setCreating(false)} />}
    </>
  );
}

function optionTitle(poll, o) {
  if (poll.kind === 'dates' && o.start_date) return fmtRange(o.start_date, o.end_date);
  return o.label;
}

function PollCard({ poll, pd }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [suggesting, setSuggesting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, run] = useRun();
  const options = pd.options.filter((o) => o.poll_id === poll.id);
  const votes = pd.votes.filter((v) => v.poll_id === poll.id);
  const rows = tallyPoll(options, votes);
  const isOpen = poll.status === 'open';
  const people = everyone(data);
  const waiting = nonVoters(options, votes, people.map((p) => p.id));
  const kindLabel = { dates: '📅 Dates', location: '📍 Location', other: '🗳️ Vote' }[poll.kind];
  // A place that's a partner course (with a bookings contact) offers "Ask about a group booking".
  const [partners, setPartners] = useState({});
  const placeNames = poll.kind === 'location' ? options.map((o) => o.label).filter(Boolean).join('|') : '';
  useEffect(() => {
    if (!placeNames) return undefined;
    let live = true;
    supabase.rpc('partner_courses_for', { p_names: placeNames.split('|') })
      .then(({ data: m }) => live && setPartners(Object.fromEntries((m || []).map((x) => [x.name, x.slug]))), () => {});
    return () => { live = false; };
  }, [placeNames]);

  const respond = (o, r) => run(async () => {
    const mine = votes.find((v) => v.option_id === o.id && v.player_id === me);
    if (mine?.response === r) await must(supabase.from('plan_votes').delete().eq('option_id', o.id).eq('player_id', me));
    else await must(supabase.from('plan_votes').upsert({ option_id: o.id, poll_id: poll.id, player_id: me, response: r, updated_at: new Date().toISOString() }));
    pd.reload();
  });

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="small muted" style={{ fontWeight: 700 }}>{kindLabel}{isOpen ? (poll.closes_on ? ` · closes ${countdown(poll.closes_on)}` : ' · open') : ' · closed'}</div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{poll.question}</div>
      </div>
      {rows.length === 0 && <div className="empty">No options yet — suggest one.</div>}
      {rows.map((r) => {
        const o = r.option;
        const winner = poll.winner_option_id === o.id;
        const mine = votes.find((v) => v.option_id === o.id && v.player_id === me)?.response;
        const canRemove = isOpen && (o.created_by === me || status.is_admin);
        return (
          <div key={o.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', background: winner ? 'var(--gold-soft)' : r.leading && isOpen ? '#FBFAF4' : '#fff' }}>
            <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
              <div className="grow">
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {winner && '✅ '}{optionTitle(poll, o)}
                  {!winner && r.leading && isOpen && <span className="small" style={{ marginLeft: 6, color: '#7A5A00', fontWeight: 800 }}>LEADING</span>}
                </div>
                {(o.address || o.cost_pp != null || o.notes) && (
                  <div className="small muted">{[o.address, o.cost_pp != null ? `~$${Number(o.cost_pp)} pp` : null, o.notes].filter(Boolean).join(' · ')}</div>
                )}
                {o.link && <a href={o.link} target="_blank" rel="noreferrer" className="small">Have a look ↗</a>}
                {partners[o.label] && <a href={`#/c/${partners[o.label]}?enquire=1`} className="small" style={{ display: 'block', fontWeight: 700 }}>Partner course · Ask about a group booking →</a>}
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div className="num" style={{ fontSize: 20 }}>{r.score}</div>
                <div className="small muted">✓{r.yes.length} ?{r.maybe.length} ✗{r.no.length}</div>
              </div>
            </div>
            {r.yes.length > 0 && <div className="row small" style={{ gap: 6, marginTop: 4 }}><AvatarStack players={r.yes.map((id) => data.playersById[id]).filter(Boolean)} size={22} /><span className="muted">can</span>{r.no.length > 0 && <span className="muted">· can’t: {r.no.map((id) => playerName(data.playersById[id])).join(', ')}</span>}</div>}
            {isOpen && me && (
              <div style={{ display: 'grid', gridTemplateColumns: canRemove ? '1fr 1fr 1fr auto' : '1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
                {[['yes', '✓ Can', 'var(--navy)'], ['maybe', '? Maybe', '#7A5A00'], ['no', '✗ Can’t', 'var(--under)']].map(([v, label, colour]) => (
                  <button key={v} type="button" className="btn ghost sm" aria-pressed={mine === v} disabled={busy}
                    style={mine === v ? { background: colour, borderColor: colour, color: '#fff' } : {}} onClick={() => respond(o, v)}>{label}</button>
                ))}
                {canRemove && (
                  <button type="button" className="btn ghost sm" aria-label="Remove option" onClick={() => { if (window.confirm('Remove this option and its votes?')) run(async () => { await must(supabase.from('plan_options').delete().eq('id', o.id)); pd.reload(); }); }}>{Icon.x(14)}</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="stack" style={{ padding: '10px 14px', gap: 8 }}>
        {isOpen && waiting.length > 0 && (
          <div className="small"><strong>Still to vote ({waiting.length}):</strong> <span className="muted">{waiting.map((id) => playerName(data.playersById[id])).join(', ')}</span></div>
        )}
        {isOpen && <button type="button" className="btn ghost sm" onClick={() => setSuggesting(true)}>+ Suggest {poll.kind === 'dates' ? 'dates' : poll.kind === 'location' ? 'a place' : 'an option'}</button>}
        {isOpen && waiting.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost sm" onClick={() => shareNudge(nudgeText('votes', { plan: pd.plan, names: waiting.map((id) => playerName(data.playersById[id])), url: appLink(`/plan/${pd.plan.id}?tab=vote`) }))}>💬 Nudge in Messenger</button>
            {status.is_admin && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const r = await notify('nudge_votes', { plan_id: pd.plan.id }); toast(`Reminder sent to ${r.sent || 0} phone${r.sent === 1 ? '' : 's'}`); })}>🔔 Send reminder</button>}
          </div>
        )}
        {isOpen && canDecide({ isAdmin: status.is_admin, me, plan: pd.plan, voteDecider: pd.voteDecider }) && <button type="button" className="btn sm" onClick={() => setClosing(true)}>Close the vote & pick the winner</button>}
        {status.is_admin && (isOpen ? null
          : <button type="button" className="btn ghost sm" onClick={() => run(async () => { await must(supabase.from('plan_polls').update({ status: 'open', winner_option_id: null }).eq('id', poll.id)); pd.reload(); }, 'Vote reopened')}>Reopen this vote</button>)}
      </div>
      {suggesting && <OptionSheet poll={poll} onClose={() => setSuggesting(false)} onSaved={pd.reload} />}
      {closing && <CloseSheet poll={poll} rows={rows} pd={pd} onClose={() => setClosing(false)} />}
    </div>
  );
}

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

function OptionSheet({ poll, onClose, onSaved }) {
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

function PollSheet({ pd, onClose }) {
  const { status } = useSession();
  const [kind, setKind] = useState(pd.polls.some((p) => p.kind === 'dates') ? 'location' : 'dates');
  const [question, setQuestion] = useState(QUESTION[kind]);
  const [closes, setCloses] = useState('');
  const [opts, setOpts] = useState([{}, {}]);
  const [busy, run] = useRun();
  const good = opts.map((o) => cleanOption(kind, o)).filter(Boolean);
  const pick = (k) => { setKind(k); setQuestion(QUESTION[k]); setOpts([{}, {}]); };
  return (
    <Sheet title="New vote" onClose={onClose}>
      <div className="stack">
        <div className="seg light" role="group">
          {[['dates', 'Dates'], ['location', 'Location'], ['other', 'Anything else']].map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => pick(k)}>{l}</button>)}
        </div>
        <label className="field"><span>Question</span><input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Shirt colour?" /></label>
        <label className="field"><span>Closes on (optional — reminder goes out the day before)</span><input className="input" type="date" value={closes} min={todayISO()} onChange={(e) => setCloses(e.target.value)} /></label>
        <span className="label">Options {kind !== 'other' && '(the lads can add more)'}</span>
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
          const r = await notify('poll_open', { poll_id: poll.id });
          pd.reload(); onClose();
          toast(`Vote is up${r.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} notified` : ''}`);
        })}>Put it up</button>
      </div>
    </Sheet>
  );
}

function CloseSheet({ poll, rows, pd, onClose }) {
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

function PeopleTab({ pd }) {
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
          <span className="label">Admin</span>
          {locked ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => { await must(supabase.from('plans').update({ rsvp_locked: false }).eq('id', plan.id)); pd.reload(); }, 'Unlocked — the lads can change their answer')}>🔓 Unlock the list</button>
          ) : (
            <button type="button" className="btn gold" disabled={busy || by('in').length === 0} onClick={() => {
              if (!window.confirm(`Lock in the ${by('in').length} who are in? After this only you can change who’s coming.`)) return;
              run(async () => {
                await must(supabase.from('plans').update({ rsvp_locked: true, status: plan.status === 'planning' ? 'confirmed' : plan.status }).eq('id', plan.id));
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

function ProposalBanner({ plan, reload }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const by = data.playersById[plan.created_by];
  return (
    <div className="card pad stack" style={{ gap: 8, background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>
      <div><strong>💡 An idea from {by ? playerName(by) : 'one of the lads'}.</strong> <span className="small">Vote on when and where, say if you’d be in, and talk it over on Chat — the admin decides whether it goes ahead.</span></div>
      {status.is_admin && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => run(async () => {
            await must(supabase.from('plans').update({ proposed: false }).eq('id', plan.id));
            await feedPost(status.player_id, plan, `🗓️ It’s on: ${plan.name} is being planned (thanks ${by ? playerName(by) : 'mate'}). Say if you’re in.`);
            await notify('plan_new', { plan_id: plan.id });
            reload();
          }, 'Approved — planning’s open')}>✅ Approve — start planning</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { if (window.confirm('Pass on this suggestion?')) run(async () => { await must(supabase.from('plans').update({ status: 'cancelled' }).eq('id', plan.id)); reload(); }, 'Passed'); }}>Pass</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Create / edit a plan (admin, or a suggestion from anyone)

function PlanSheet({ plan, onClose, onSaved }) {
  const { status } = useSession();
  const data = useData();
  const nav = useNavigate();
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
      toast('Suggested — the admin has been told');
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
                <select className="select" {...f('status')}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
            )}
          </>
        )}
        {!plan && !status.is_admin && <label className="field"><span>Pitch it to the lads (optional)</span><textarea className="textarea" rows={3} style={{ padding: 12 }} {...f('brief')} placeholder="Why it’d be great, rough cost, who’s keen…" /></label>}
        <button type="button" className="btn gold block" disabled={busy || !v.name?.trim()} onClick={save}>{plan ? 'Save' : status.is_admin ? 'Start planning' : 'Suggest it'}</button>
        {plan && (
          <button type="button" className="btn ghost block" onClick={() => {
            if (!window.confirm(status.is_admin ? `Delete "${plan.name}" and all its votes, jobs and kitty? This can’t be undone. (To keep it but call it off, set Status to Called off.)` : `Withdraw your suggestion "${plan.name}"?`)) return;
            run(async () => { await must(supabase.from('plans').delete().eq('id', plan.id)); onClose(); nav('/plan'); }, 'Deleted');
          }}>{status.is_admin ? 'Delete this plan' : 'Withdraw my suggestion'}</button>
        )}
      </div>
    </Sheet>
  );
}


// ---------------------------------------------------------------- Where the trip is up to

function StageBar({ pd }) {
  const data = useData();
  const { plan } = pd;
  const trip = plan.trip_id && data.trips.find((t) => t.id === plan.trip_id);
  const stage = tripStage(plan, trip);
  const at = STAGES.indexOf(stage);
  const org = data.playersById[plan.organiser_id || plan.created_by];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div role="list" aria-label="Where this trip is up to" style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 4 }}>
        {STAGES.map((s, i) => (
          <div key={s} role="listitem" aria-current={i === at ? 'step' : undefined} className="small"
            style={{ textAlign: 'center', padding: '6px 2px', borderRadius: 8, fontWeight: i === at ? 800 : 600, fontSize: 12, lineHeight: 1.2,
              background: i === at ? 'var(--navy)' : i < at ? 'var(--gold-soft)' : 'transparent', color: i === at ? '#fff' : i < at ? 'var(--navy)' : 'var(--muted)',
              border: `1px solid ${i <= at ? 'var(--navy)' : 'var(--line)'}` }}>
            {STAGE_LABEL[s].replace(/^\S+\s/, '')}
          </div>
        ))}
      </div>
      {org && <span className="small muted">Organiser: <strong style={{ color: 'var(--ink, inherit)' }}>{playerName(org)}</strong>{plan.budget_pp ? ` · rough budget ${money(plan.budget_pp)} each` : ''}</span>}
    </div>
  );
}

function LockInCard({ pd }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const { plan } = pd;
  if (!status.is_admin || plan.proposed || plan.status !== 'planning') return null;
  const openVotes = pd.polls.filter((p) => p.status === 'open' && p.kind !== 'other').length;
  if (!plan.start_date) {
    return <div className="small muted" style={{ fontWeight: 600 }}>🔒 Once the dates are picked you can lock it in{openVotes ? ' — close the dates vote first' : ' (Edit → dates)'}.</div>;
  }
  return (
    <button type="button" className="card pad row" disabled={busy} style={{ textAlign: 'left', color: 'inherit', width: '100%', borderColor: 'var(--navy)', gap: 12 }}
      onClick={() => {
        if (openVotes && !window.confirm(`${openVotes} vote${openVotes === 1 ? ' is' : 's are'} still open. Lock it in anyway?`)) return;
        run(async () => {
          await must(supabase.from('plans').update({ status: 'confirmed' }).eq('id', plan.id));
          await feedPost(status.player_id, plan, `🔒 ${plan.name} is locked in: ${fmtRange(plan.start_date, plan.end_date)}${plan.location_name ? ` at ${plan.location_name}` : ''}. Say if you’re in.`);
          await notify('trip_locked', { plan_id: plan.id });
          pd.reload();
        }, 'Locked in — it’s a trip in the app now');
      }}>
      <span style={{ fontSize: 26 }}>🔒</span>
      <span className="grow"><strong>Lock it in</strong><div className="small muted">{fmtRange(plan.start_date, plan.end_date)} · {plan.location_name || 'place TBC'} — makes it a trip in the app, ready for rounds.</div></span>
      <span className="btn sm">Lock in</span>
    </button>
  );
}

// ---------------------------------------------------------------- Chat (the back-and-forth on a trip)

function ChatTab({ pd }) {
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
              {(mine || status.is_admin) && (
                <button type="button" className="small" style={{ border: 0, background: 'none', padding: 0, color: 'var(--muted)', marginTop: 2 }}
                  onClick={() => { if (window.confirm('Delete this message?')) run(async () => { await must(supabase.from('plan_comments').delete().eq('id', c.id)); pd.reload(); }); }}>Delete</button>
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
