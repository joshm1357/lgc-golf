// A trip's Organise view as one clear path (ov14, 22 Oct — Josh: "The organiser screen is a bit messy … It's not clear
// where to start"). Six steps in the order the organiser works — Plan → Vote → Book → Lock in → Jobs & money → On the
// day — with the current one open and ONE big button (the Next step, lib/tripjobs.js), finished ones folded to a
// line ("✓ Hunter Valley · Fri 13 – Sun 15 Mar"), later ones greyed but still openable. Everything else is under its
// step or in "More". On a laptop: the steps across the top, the open step in the middle, a slim status column on the
// right (who's in, open votes). The step logic is in lib/organisesteps.js.
//
// Addresses: ?step=vote opens a step; the old ?tab=… still work (vote → Vote, people → Lock in, jobs / kitty / groups
// → Jobs & money on that part, chat / details → More).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Avatar } from '../components/ui.jsx';
import { tallyPoll, money } from '../lib/plan.js';
import { callJobs, jobStage } from '../lib/tripjobs.js';
import { organiseSteps, primaryFor, STEP_KEYS, TAB_STEP, MORE_TABS } from '../lib/organisesteps.js';
import { stepKey } from '../lib/tripsteps.js';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import { useTripExtras, useNextStep, useStepActions, TripPlanCards, TripJobsTab } from './TripPlan.jsx';
import { DetailsTab, KittyTab, GroupsTab, ItemSheet } from './PlanTabs.jsx';
import { TripSetupCard } from './TripSetup.jsx';
import TripExtras, { RepeatInfo } from './TripExtras.jsx';
import { TripBuilderCard } from '../components/TripBuilderCard.jsx';
import { TripFinderCard } from '../components/TripFinderCard.jsx';
import { AwardsRunUp } from '../components/AwardsFines.jsx'; // ov24
import CompsOnTheDay from '../components/CompsOnTheDay.jsx'; // ov23
import { VoteTab, PeopleTab, ChatTab, PollSheet, CloseSheet, ProposalBanner, LockInCard, Checklist, CalledOffBanner } from './Planner.jsx';
import './organise.css';

// Laptop-only parts (what was the Trip desk), loaded only on a laptop so phones download nothing new.
const OrganiseSide = lazyScreen(() => import('./OrganisePanels.jsx'), 'OrganiseSide', { inline: true });
const CostsPanel = lazyScreen(() => import('./OrganisePanels.jsx'), 'CostsPanel', { inline: true });
const DayPanels = lazyScreen(() => import('./OrganisePanels.jsx'), 'DayPanels', { inline: true });
const MoreTribunal = lazyScreen(() => import('./OrganisePanels.jsx'), 'MoreTribunal', { inline: true });

const MONEY_TABS = [
  { value: 'jobs', label: '📋 Jobs', feature: 'planner_tasks' },
  { value: 'kitty', label: '💰 Kitty', feature: 'planner_costs' },
  { value: 'groups', label: '🛏️ Rooms & cars', feature: 'planner_rooms' },
];

export function OrganiseView({ pd, stage, trip, wide, desk, onEdit }) {
  const data = useData();
  const { status } = useSession();
  const [params, setParams] = useSearchParams();
  const on = {
    planner_tasks: useFeature('planner_tasks'), planner_costs: useFeature('planner_costs'), planner_rooms: useFeature('planner_rooms'),
    trip_finder: useFeature('trip_finder'),
  };
  const isOrg = !!status.is_admin;
  const { plan } = pd;
  const ex = useTripExtras(pd);
  const next = useNextStep(pd, stage, ex);
  const [polling, setPolling] = useState(false);
  const [closing, setClosing] = useState(null); // { poll, rows }
  const [newCostAt, setNewCostAt] = useState(0); // "n" on a laptop: when it was pressed

  const tab = params.get('tab');
  const setQuery = useCallback((patch) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set('view', 'organise');
    for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); }
    return n;
  }, { replace: true }), [setParams]);
  const openStep = (k) => setQuery({ step: k, tab: null });
  const openTab = (t) => setQuery({ tab: t, step: null });

  const pickWinner = (pollIds) => {
    const poll = pd.polls.find((p) => (pollIds || []).includes(p.id)) || pd.polls.find((p) => p.status === 'open' && p.purpose !== 'stay');
    if (!poll) { openStep('area'); return; }
    const rows = tallyPoll(pd.options.filter((o) => o.poll_id === poll.id), pd.votes.filter((v) => v.poll_id === poll.id));
    setClosing({ poll, rows });
  };
  const { act, busy, sheets } = useStepActions(pd, ex, {
    onTab: (t) => openTab(t),
    onOther: (a) => {
      if (a.type === 'pick_winner') pickWinner(a.pollIds);
      else if (a.type === 'edit') onEdit();
      else if (a.type === 'call_vote') setPolling(true);
    },
  });

  // "n" on a laptop: a new cost (Jobs & money → Kitty, where the costs table is).
  const latest = useRef(null);
  latest.current = { tab, costs: on.planner_costs, desk };
  useEffect(() => {
    const f = () => {
      const l = latest.current;
      if (!l.costs || !l.desk) return;
      if (l.tab !== 'kitty') openTab('kitty');
      setNewCostAt(Date.now());
    };
    window.addEventListener('tgt:new', f);
    return () => window.removeEventListener('tgt:new', f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const roundsSetUp = trip ? data.rounds.filter((r) => r.trip_id === trip.id).length : 0;
  const { steps, current } = useMemo(() => organiseSteps({
    plan, stage, items: on.planner_tasks ? pd.items : [], polls: pd.polls, options: pd.options, votes: pd.votes, rsvps: pd.rsvps,
    transfers: pd.transfers, costs: pd.costs, builder: ex.builder, stays: ex.stays, next: isOrg ? next : null,
    costsOn: on.planner_costs, roundsSetUp,
  }), [plan, stage, pd, ex.builder, ex.stays, next, isOrg, on.planner_tasks, on.planner_costs, roundsSetUp]);

  if (plan.status === 'cancelled') {
    return (
      <div className="section stack">
        <CalledOffBanner plan={plan} reload={pd.reload} />
        <More pd={pd} tab={MORE_TABS.includes(tab) ? tab : 'chat'} onTab={openTab} isOrg={isOrg} desk={desk} trip={trip} />
      </div>
    );
  }

  const asked = params.get('step');
  const moneyTab = ['jobs', 'kitty', 'groups'].includes(tab) ? tab : null;
  const askedKey = stepKey(asked); // old ?step=plan / ?step=vote links open Areas & weekends
  const open = STEP_KEYS.includes(askedKey) ? askedKey : (tab && TAB_STEP[tab]) || current || (stage === 'done' ? 'day' : 'area');
  const moreTab = MORE_TABS.includes(tab) || tab === 'checklist' || tab === 'tribunal' ? tab : null;
  const primary = isOrg ? primaryFor(next, { current, polls: pd.polls, builderOn: on.trip_finder, builderStarted: !!(ex.builder.weekends || ex.builder.areas?.length) }) : null;
  const doPrimary = () => act(primary.action);

  const body = (k) => (
    <StepBody k={k} pd={pd} ex={ex} stage={stage} trip={trip} isOrg={isOrg} on={on} desk={desk} wide={wide}
      moneyTab={moneyTab} onMoneyTab={openTab} onPoll={() => setPolling(true)} onEdit={onEdit} newCostAt={newCostAt} act={act} />
  );
  const bigButton = primary?.label ? (
    <div className="org-primary" data-testid="next-step">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 26, lineHeight: 1 }} aria-hidden="true">{primary.icon}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small org-next-label">NEXT STEP</div>
          <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.25 }}>{primary.title}</div>
          {primary.detail && <div className={primary.late ? 'small' : 'small muted'} data-testid={primary.late ? 'next-step-late' : undefined} style={{ marginTop: 2, ...(primary.late ? { color: 'var(--under)', fontWeight: 700 } : {}) }}>{primary.detail}</div>}
          {primary.who && data.playersById[primary.who] && (
            <div className="row small" style={{ gap: 6, marginTop: 6 }}><Avatar player={data.playersById[primary.who]} size={22} /><span>On {primary.who === status.player_id ? 'you' : playerName(data.playersById[primary.who])}</span></div>
          )}
        </div>
      </div>
      <button type="button" className="btn gold block" style={{ marginTop: 10 }} disabled={busy} onClick={doPrimary} data-testid="primary">{primary.label}</button>
    </div>
  ) : null;
  const curStep = steps.find((s) => s.key === current);
  const org = data.playersById[plan.organiser_id || plan.created_by];
  const organiserName = org ? playerName(org) : null;

  // Laptop: the steps as a strip across the top (above the status column too).
  const strip = (
    <ol className="org-strip" aria-label="Organising steps">
      {steps.map((s) => (
        <li key={s.key} className={`org-chip ${s.state}${s.key === open ? ' open' : ''}`} aria-current={s.key === current ? 'step' : undefined}>
          <button type="button" onClick={() => openStep(s.key)} aria-label={`Step ${s.n}: ${s.title}${s.done ? ' (done)' : ''}`}>
            <span className="org-chip-text">
              <span className="org-chip-top"><span className="org-n sm" aria-hidden="true">{s.done ? '✓' : s.n}</span><strong>{s.title}</strong></span>
              <span className="small">{s.state === 'later' && !s.started ? s.blurb : s.summary}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
  const main = (
    <div className="section stack org-main-col" data-testid="organise-steps">
      {organiserName && <span className="small muted" data-testid="organiser-line">Organiser: <strong style={{ color: 'var(--text)' }}>{organiserName}</strong>{plan.budget_pp ? ` · rough budget ${money(plan.budget_pp)} each` : ''}</span>}
      {/* The open step isn't the current one: the Next step still shows, slim, above it — the one big button. */}
      {open !== current && bigButton && (
        <div className="org-upnext">
          <div className="small muted" style={{ fontWeight: 700 }}>You’re looking at step {steps.find((s) => s.key === open)?.n}. The trip is up to step {curStep?.n}: {curStep?.title}.</div>
          {bigButton}
        </div>
      )}
      {/* The steps, stacked (a phone shows them all; a laptop only the open one, the strip does the rest). */}
      <div className="org-steps">
        {steps.map((s) => {
          const isOpen = s.key === open;
          return (
            <section key={s.key} className={`org-step ${s.state}${isOpen ? ' open' : ''}`} data-testid={`step-${s.key}`} data-state={s.state} aria-current={s.key === current ? 'step' : undefined}>
              <button type="button" className="org-step-hdr" aria-expanded={isOpen} onClick={() => (isOpen ? null : openStep(s.key))}>
                <span className="org-n" aria-hidden="true">{s.done ? '✓' : s.n}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="org-step-title">{s.title}{s.state === 'current' && <span className="org-now">Now</span>}</span>
                  <span className="small org-step-sum">{s.done ? `✓ ${s.summary}` : s.state === 'later' && !s.started ? s.blurb : s.summary}</span>
                </span>
                {!isOpen && <span aria-hidden="true" className="muted">▾</span>}
              </button>
              {isOpen && (
                <div className="org-step-body stack">
                  {s.key === current && bigButton}
                  {body(s.key)}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <More pd={pd} tab={moreTab} onTab={openTab} isOrg={isOrg} desk={desk} trip={trip} />
    </div>
  );

  return (
    <>
      <div className="section org-strip-wrap">{strip}</div>
      {desk ? (
        <div className="org-desk">
          <div className="org-main">{main}</div>
          <LazyArea fallback={null} quiet><OrganiseSide pd={pd} onStep={(k, t) => (t ? openTab(t) : openStep(k))} /></LazyArea>
        </div>
      ) : main}
      {sheets}
      {polling && <PollSheet pd={pd} onClose={() => setPolling(false)} />}
      {closing && <CloseSheet poll={closing.poll} rows={closing.rows} pd={pd} onClose={() => setClosing(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- What's inside each step

function StepBody({ k, pd, ex, stage, trip, isOrg, on, desk, wide, moneyTab, onMoneyTab, onPoll, onEdit, newCostAt, act }) {
  const { plan } = pd;
  // ov23: one step for where and when — the areas, the weekends, how long, AND the vote (no separate Vote step).
  if (k === 'area') {
    return (
      <>
        {plan.proposed && <ProposalBanner plan={plan} reload={pd.reload} />}
        {/* Organisers get "Build the trip" as the step's big button; players see how it's coming together. */}
        {!isOrg && <TripBuilderCard pd={pd} />}
        {isOrg && plan.status === 'planning' && on.trip_finder && (
          <Link to={`/plan/${plan.id}/build`} className="small" data-testid="tb-link" style={{ fontWeight: 700 }}>🗺️ Open the trip builder →</Link>
        )}
        <TripFinderCard pd={pd} />
        {isOrg && plan.status === 'planning' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost sm" onClick={onEdit}>✏️ Set dates and place by hand</button>
            {on.planner_tasks && <button type="button" className="btn ghost sm" onClick={onPoll}>🗳️ Call a vote yourself</button>}
          </div>
        )}
        {!isOrg && <div className="small muted">The organiser works out where and when — you’ll get a vote.</div>}
        {on.planner_tasks && <VoteTab pd={pd} />}
      </>
    );
  }
  // Courses & stays: each day's course options (the trip builder) and where to stay (the shortlist, its vote).
  if (k === 'courses') {
    return (
      <>
        {isOrg && plan.status === 'planning' && on.trip_finder && ex.builder.started && (
          <Link to={`/plan/${plan.id}/build`} className="small" data-testid="courses-link" style={{ fontWeight: 700 }}>⛳ Course options each day, in the trip builder →</Link>
        )}
        {plan.kind !== 'round' && <TripPlanCards pd={pd} only={['stay']} />}
        {plan.kind === 'round' && <div className="small muted">A one-day round: no places to stay to sort.</div>}
      </>
    );
  }
  if (k === 'book') return <BookStep pd={pd} ex={ex} isOrg={isOrg} act={act} on={on} />;
  if (k === 'lockin') {
    return (
      <>
        {/* ov23: pick the best combination from the tee times first (the trip builder), then lock it in. */}
        {isOrg && plan.status === 'planning' && on.trip_finder && ex.builder.started && (
          <Link to={`/plan/${plan.id}/build`} className="small" data-testid="pick-link" style={{ fontWeight: 700 }}>🧩 Pick the trip from the tee times (best per day) →</Link>
        )}
        {isOrg && plan.status === 'planning' && !plan.proposed && <LockInCard pd={pd} />}
        {plan.repeat_shape && stage !== 'done' && <RepeatInfo pd={pd} />}
        <TripPlanCards pd={pd} only={['budget', 'deposits']} />
        <PeopleTab pd={pd} />
      </>
    );
  }
  if (k === 'money') {
    const tabs = MONEY_TABS.filter((t) => on[t.feature]);
    const cur = tabs.some((t) => t.value === moneyTab) ? moneyTab : tabs[0]?.value;
    if (!cur) return <div className="small muted">Jobs, the kitty and rooms are switched off for this group.</div>;
    return (
      <>
        <div className="chips" role="tablist" aria-label="Jobs and money">
          {tabs.map((t) => <button key={t.value} type="button" role="tab" className="chip" aria-selected={t.value === cur} onClick={() => onMoneyTab(t.value)}>{t.label}</button>)}
        </div>
        {cur === 'jobs' && <TripJobsTab pd={pd} AddSheet={ItemSheet} />}
        {cur === 'kitty' && desk && <LazyArea fallback={null} quiet><CostsPanel pd={pd} focusAt={newCostAt} owes={false} /></LazyArea>}
        {cur === 'kitty' && <KittyTab pd={pd} table={desk} />}
        {cur === 'groups' && <GroupsTab pd={pd} />}
      </>
    );
  }
  // Comps & on the day (ov23): the run-up — what's up for grabs, the rules, the handicaps — then teams and the draw.
  return (
    <>
      <CompsOnTheDay pd={pd} trip={trip} isOrg={isOrg} />
      <span className="label" style={{ marginTop: 4 }} data-testid="teams-draw">👥 Teams and the draw</span>
      <TripSetupCard plan={plan} reload={pd.reload} />
      {wide && isOrg && <LazyArea fallback={null} quiet><DayPanels pd={pd} trip={trip} goTab={onMoneyTab} /></LazyArea>}
      {!wide && isOrg && trip && <Link to="/setup" className="btn ghost block">⛳ Teams, draw and side comps →</Link>}
      {!trip && <div className="small muted">Rounds, teams and the draw get set up once the trip is locked in.</div>}
      {stage !== 'done' && <AwardsRunUp trip={trip} />}
      {stage === 'done' && <TripExtras pd={pd} />}
    </>
  );
}

/** Call the courses: the calls for tee times (where to stay is step 2, Courses & stays). */
function BookStep({ pd, ex, isOrg, act, on }) {
  const data = useData();
  const calls = callJobs(pd.items, ex.builder.callJobIds);
  const round = pd.plan.kind === 'round';
  return (
    <>
      {calls.length > 0 && (
        <div className="card" data-testid="book-calls">
          <div className="small" style={{ padding: '8px 14px', fontWeight: 800, borderBottom: '1px solid var(--line-soft)' }}>📞 Calls to the courses for tee times</div>
          {calls.map((j) => {
            const owner = data.playersById[j.owner_id];
            const st = jobStage(j);
            return (
              <button key={j.id} type="button" className="row" onClick={() => act({ type: j.owner_id || !isOrg ? 'job' : 'allocate', id: j.id })}
                style={{ width: '100%', minHeight: 52, padding: '8px 14px', border: 0, borderBottom: '1px solid var(--line-soft)', background: '#fff', textAlign: 'left', color: 'inherit', gap: 10 }}>
                <span aria-hidden="true">{st === 'done' ? '✓' : st === 'asked' ? '⏳' : '○'}</span>
                <span className="grow" style={{ minWidth: 0, textDecoration: st === 'done' ? 'line-through' : 'none' }}>{j.title.replace(/^📞\s*/, '')}
                  <div className="small muted">{owner ? playerName(owner) : 'Nobody on it yet'}</div></span>
                {owner && <Avatar player={owner} size={26} />}
              </button>
            );
          })}
          {on.trip_finder && <Link to={`/plan/${pd.plan.id}/build`} className="small" style={{ display: 'block', padding: '8px 14px', fontWeight: 700 }}>The tee times so far, in the trip builder →</Link>}
        </div>
      )}
      {round && !calls.length && <div className="small muted">A one-day round: nothing to book here unless you’re calling the course.</div>}
      {!round && !calls.length && <div className="small muted">Once the area and the primary and backup weekends are picked, the courses get called for tee times.</div>}
    </>
  );
}

// ---------------------------------------------------------------- More: everything that isn't a step

const MORE = [
  { value: 'chat', label: '💬 Chat' },
  { value: 'details', label: '📍 Details' },
  { value: 'checklist', label: '📝 Checklist', org: true },
  { value: 'tribunal', label: '⚖️ Tribunal', desk: true },
];

function More({ pd, tab, onTab, isOrg, desk, trip }) {
  const list = MORE.filter((m) => (!m.org || isOrg) && (!m.desk || desk));
  return (
    <section className="org-more" data-testid="organise-more" aria-label="More">
      <span className="label">More</span>
      <div className="chips" role="tablist" aria-label="More">
        {list.map((m) => <button key={m.value} type="button" role="tab" className="chip" aria-selected={m.value === tab} onClick={() => onTab(m.value)}>{m.label}</button>)}
      </div>
      {tab === 'chat' && <div style={{ marginTop: 10 }}><ChatTab pd={pd} /></div>}
      {tab === 'details' && <div className="stack" style={{ marginTop: 10 }}><DetailsTab pd={pd} /><TripExtras pd={pd} viewer noRepeat /></div>}
      {tab === 'checklist' && isOrg && <div style={{ marginTop: 10 }}><Checklist pd={pd} onGo={onTab} open /></div>}
      {tab === 'tribunal' && desk && <div style={{ marginTop: 10 }}><LazyArea fallback={null} quiet><MoreTribunal /></LazyArea></div>}
    </section>
  );
}
