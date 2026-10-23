// The run-up (ov25, 23 Oct 2026): an Upcoming trip's page between lock-in and the first tee, for everyone.
// Josh: "the lead-up component of the trip — tasks etc., but also the fun stuff like awards, new rules, side
// activities, organising cars…"
//
//   16 days to go · Hunter Valley · Fri 6 – Sun 8 Mar
//   1 Your to-dos       2 Getting there (cars, rooms)   3 Up for a vote      4 What's up for grabs (ov23 / ov24 slots)
//   5 Rules for this trip  6 Side activities (→ kitty)   7 What to bring      8 Form guide
//   9 Tipping (optional)   10 Trip chat
// The thinking is in lib/runup.js; the database side (cars, activities, tipping, claims) is migration 094.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useFeature, useRealtime, useSession, useScores, playerName } from '../lib/store.jsx';
import { Avatar, AvatarStack, Sheet, askConfirm, timeAgo } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { RSVP_LABEL } from '../lib/plan.js';
import { buildHistory } from '../lib/stats.js';
import { useLateJobs } from './LateJobs.jsx';
import { OverviewVotes } from './OverviewVotes.jsx';
import { voteWords } from '../lib/governance.js';
import { RUNUP_SLOTS } from './runupSlots.jsx';
import {
  countdownHeader, runUpSections, myTodos, carsView, joinProblem, roomsView, activityMoney, activityWhen, cleanActivity,
  bringView, bringEmoji, bringAskText, bringAskLink, claimPostText, tippingState, tipResult, tipTally, formGuide, formLine,
  trendWords, mainTrophy, myDayBefore, stageLook,
} from '../lib/runup.js';
import './runup.css';

const RULE_KINDS = ['new_rule', 'change_rule', 'scrap_rule', 'ruling', 'other'];

async function rowsOr(q) {
  try { const { data, error } = await q; return error ? null : data || []; } catch { return null; }
}

/** Everything the run-up needs beyond the plan's own data (pd). null rows = an older database without 094. */
export function useRunUp(pd, tripId) {
  const data = useData();
  const planId = pd?.plan?.id;
  const [st, setSt] = useState({ activities: [], joins: [], people: [], tips: [], tees: [], cases: [], rules: [], ready: false, missing: false });
  const roundIds = useMemo(() => (tripId ? data.rounds.filter((r) => r.trip_id === tripId).map((r) => r.id) : []), [data.rounds, tripId]);
  const key = roundIds.join(',');
  const load = useCallback(async () => {
    if (!planId) return;
    const [activities, people, tips, tees, cases, rules] = await Promise.all([
      rowsOr(supabase.from('trip_activities').select('*').eq('plan_id', planId).order('day', { nullsFirst: false }).order('created_at')),
      rowsOr(supabase.from('trip_runup_people').select('*').eq('plan_id', planId)),
      rowsOr(supabase.from('trip_tips').select('*').eq('plan_id', planId)),
      roundIds.length ? rowsOr(supabase.from('tee_groups').select('round_id,tee_time,player_ids').in('round_id', roundIds)) : [],
      rowsOr(supabase.from('cases').select('id,kind,title,stage,status,closes_at,rule_id,created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(20)),
      rowsOr(supabase.from('rules').select('id,title,status,value,category,sort').in('status', ['active', 'proposed']).order('sort').limit(60)),
    ]);
    const ids = (activities || []).map((a) => a.id);
    const joins = ids.length ? await rowsOr(supabase.from('trip_activity_people').select('*').in('activity_id', ids)) : [];
    setSt({
      activities: activities || [], joins: joins || [], people: people || [], tips: tips || [], tees: tees || [],
      cases: (cases || []).filter((c) => RULE_KINDS.includes(c.kind)), rules: rules || [], ready: true,
      missing: activities == null || people == null || tips == null,
    });
  }, [planId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['trip_activities', 'trip_activity_people', 'trip_runup_people', 'trip_tips', 'tee_groups', 'cases', 'rules'], load);
  return { ...st, reload: load };
}

/** A run-up section: a heading with an icon and a small count, then its body. */
function Part({ id, icon, title, count, children, right }) {
  return (
    <section className="ru-part card" data-testid={`runup-${id}`} aria-label={title}>
      <header className="ru-head">
        <span className="ru-icon" aria-hidden="true">{icon}</span>
        <h3 className="grow">{title}{count ? <span className="ru-count">{count}</span> : null}</h3>
        {right}
      </header>
      <div className="ru-body">{children}</div>
    </section>
  );
}

const firstName = (p) => String(playerName(p) || '').split(' ')[0];

export function RunUp({ pd, trip = null, onOrganise = null, slots = {} }) {
  const data = useData();
  const { status } = useSession();
  const feature = { planner_rooms: useFeature('planner_rooms'), planner_tasks: useFeature('planner_tasks'), stats: useFeature('stats'),
    feed: useFeature('feed'), planner_costs: useFeature('planner_costs'), dinner: useFeature('dinner_awards'), tribunal: useFeature('tribunal') };
  const plan = pd.plan;
  const me = status.player_id;
  const guest = status.role === 'guest';
  const isOrg = !!status.is_admin || (!!me && plan.organiser_id === me);
  const tripId = trip?.id || plan.trip_id || null;
  const ru = useRunUp(pd, tripId);
  const late = useLateJobs();
  const rounds = useMemo(() => (tripId ? data.rounds.filter((r) => r.trip_id === tripId) : []), [data.rounds, tripId]);
  const tipping = tippingState({ plan, rounds, teeGroups: ru.tees });
  const myTip = ru.tips.find((t) => t.player_id === me) || null;
  const mine = ru.people.find((p) => p.player_id === me) || null;
  const cars = carsView({ groups: pd.groups, members: pd.members, people: ru.people, rsvps: pd.rsvps, me });
  const rooms = roomsView({ groups: pd.groups, members: pd.members, me });
  const todos = myTodos({ me, plan, rsvps: pd.rsvps, items: pd.items, transfers: pd.transfers, mine, player: data.playersById[me],
    lateRuleV: late.rule, late: { penalties: late.penalties, adjustments: late.adjustments }, tipping, myTip });
  const sections = runUpSections({ feature: (k) => feature[k] !== false, tippingOff: !!plan.tipping_off, hasRounds: true });
  const S = { ...RUNUP_SLOTS, ...slots };
  const firstTee = useMemo(() => {
    const r = [...rounds].filter((x) => x.play_date).sort((a, b) => a.play_date.localeCompare(b.play_date))[0];
    const mineT = ru.tees.filter((t) => t.round_id === r?.id && (t.player_ids || []).includes(me)).map((t) => t.tee_time).filter(Boolean).sort()[0];
    return mineT || null;
  }, [rounds, ru.tees, me]);
  const dayBefore = myDayBefore({ me, carView: cars, rooms, teeTime: firstTee, items: pd.items, playersById: data.playersById });

  return (
    <div className="runup stack" data-testid="runup">
      <div className="ru-hero">
        <div className="ru-hero-tag">{stageLook('locked').icon} THE RUN-UP</div>
        <div className="ru-hero-line" data-testid="runup-countdown">{countdownHeader(plan)}</div>
        {dayBefore && <div className="ru-hero-sub" data-testid="runup-daybefore">{dayBefore}</div>}
      </div>
      {ru.missing && <div className="small muted">Some of the run-up (cars, side activities, tipping) needs a database update — it’ll appear once that’s done.</div>}

      {sections.includes('todos') && <Todos todos={todos} pd={pd} me={me} mine={mine} onOrganise={onOrganise} reload={ru.reload} guest={guest} />}
      {sections.includes('getting_there') && <GettingThere pd={pd} ru={ru} cars={cars} rooms={rooms} me={me} isOrg={isOrg} guest={guest} onOrganise={onOrganise} />}
      {sections.includes('votes') && (
        <Part id="votes" icon="🗳️" title="Up for a vote">
          <OverviewVotes pd={pd} />
          {S.awardVotes && <S.awardVotes pd={pd} trip={trip} />}
          <CaseVotes cases={ru.cases} reload={ru.reload} guest={guest} />
          {!pd.polls.some((p) => p.status === 'open') && !ru.cases.length && !S.awardVotes && <div className="small muted">Nothing to vote on right now.</div>}
        </Part>
      )}
      {sections.includes('up_for_grabs') && (
        <Part id="grabs" icon="🏆" title="What’s up for grabs">
          {S.compsForTrip ? <S.compsForTrip pd={pd} trip={trip} compact /> : <GrabsStandIn tripId={tripId} rounds={rounds} />}
          {S.awardsForTrip ? <S.awardsForTrip pd={pd} trip={trip} compact /> : (feature.dinner && tripId && (
            <Link to={`/dinner/${tripId}`} className="btn ghost sm" data-testid="runup-awards-link">🍽️ Awards & fines for this trip</Link>
          ))}
        </Part>
      )}
      {sections.includes('rules') && <RulesPart ru={ru} guest={guest} />}
      {sections.includes('activities') && <Activities pd={pd} ru={ru} me={me} isOrg={isOrg} guest={guest} costsOn={feature.planner_costs} />}
      {sections.includes('bring') && <Bring pd={pd} me={me} isOrg={isOrg} guest={guest} feedOn={feature.feed} onOrganise={onOrganise} />}
      {sections.includes('form') && <FormGuide pd={pd} rounds={rounds} />}
      {sections.includes('tipping') && <Tipping pd={pd} ru={ru} tipping={tipping} myTip={myTip} me={me} isOrg={isOrg} guest={guest} tripId={tripId} />}
      {!sections.includes('tipping') && isOrg && <TippingSwitch plan={plan} pd={pd} />}
      {sections.includes('chat') && <ChatBits pd={pd} onOrganise={onOrganise} />}
    </div>
  );
}

// ---------------------------------------------------------------- 1 Your to-dos

function Todos({ todos, pd, me, mine, onOrganise, reload, guest }) {
  const data = useData();
  const [busy, run] = useRun();
  const plan = pd.plan;
  const go = (t) => onOrganise?.(t);
  const reply = (s) => run(async () => { await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status: s })); pd.reload(); }, `You’re ${RSVP_LABEL[s].toLowerCase()}`);
  const handicapOk = () => run(async () => {
    await must(supabase.from('trip_runup_people').upsert({ plan_id: plan.id, player_id: me, handicap_checked_at: new Date().toISOString() }, { onConflict: 'plan_id,player_id' }));
    reload();
  }, 'Handicap checked ✓');
  return (
    <Part id="todos" icon="✅" title="Your to-dos" count={todos.length || null}>
      {!me && <div className="small muted">Sign in to see your to-dos.</div>}
      {me && !todos.length && <div className="small" data-testid="todos-clear">All done — nothing waiting on you. 🎉</div>}
      {todos.map((t) => (
        <div key={t.key} className={'ru-todo' + (t.late ? ' late' : '')} data-testid={`todo-${t.key.replace(/-.*/, '')}`}>
          <span className="ru-todo-icon" aria-hidden="true">{t.icon}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ru-todo-title">{t.title}</div>
            {t.detail && <div className={'small' + (t.late ? ' ru-late' : ' muted')}>{t.detail}</div>}
          </div>
          {t.action === 'rsvp' && !guest && (
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="btn gold sm" disabled={busy} onClick={() => reply('in')}>In</button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => reply('out')}>Out</button>
            </span>
          )}
          {t.action === 'deposit' && <button type="button" className="btn ghost sm" onClick={() => { const el = document.querySelector('[data-testid="next-step"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); else go('kitty'); }}>Pay</button>}
          {t.action === 'job' && <button type="button" className="btn ghost sm" onClick={() => go('jobs')}>Open</button>}
          {t.action === 'handicap' && !guest && (
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="btn gold sm" disabled={busy} data-testid="handicap-ok" onClick={handicapOk}>Looks right</button>
              <Link to={`/player/${me}`} className="btn ghost sm">Fix</Link>
            </span>
          )}
          {t.action === 'tip' && <a href="#runup-tipping" className="btn ghost sm" onClick={(e) => { e.preventDefault(); document.querySelector('[data-testid="runup-tipping"]')?.scrollIntoView({ behavior: 'smooth' }); }}>Pick</a>}
        </div>
      ))}
      {mine?.handicap_checked_at && data.playersById[me]?.handicap != null && <div className="small muted">Handicap {data.playersById[me].handicap} — checked ✓</div>}
    </Part>
  );
}

// ---------------------------------------------------------------- 2 Getting there

function GettingThere({ pd, ru, cars, rooms, me, isOrg, guest, onOrganise }) {
  const data = useData();
  const [busy, run] = useRun();
  const [offer, setOffer] = useState(null);
  const plan = pd.plan;
  const name = (id) => firstName(data.playersById[id]) || 'Someone';
  const afterCar = () => { pd.reload(); ru.reload(); };
  const needLift = (on) => run(async () => {
    await must(supabase.from('trip_runup_people').upsert({ plan_id: plan.id, player_id: me, needs_lift: on }, { onConflict: 'plan_id,player_id' }));
    ru.reload();
  }, on ? 'Asked for a lift' : 'Done');
  const hop = (car, on, who = null) => run(async () => {
    const { error } = await supabase.rpc(on ? 'runup_join_car' : 'runup_leave_car', { p_car: car.id, p_player: who });
    if (error) throw error;
    afterCar();
  }, on ? (who ? `${name(who)}’s in` : `You’re in ${car.name}`) : 'Out of the car');
  const iAmIn = pd.rsvps.some((r) => r.player_id === me && r.status === 'in');
  return (
    <Part id="cars" icon="🚗" title="Getting there" count={cars.cars.length ? `${cars.cars.length} car${cars.cars.length === 1 ? '' : 's'}` : null}>
      {cars.cars.length === 0 && <div className="small muted">No cars yet. Got room? Offer your seats.</div>}
      {cars.cars.map((c) => {
        const problem = joinProblem(c, me, cars);
        const iDriveThis = c.driverId === me;
        return (
          <div key={c.id} className="ru-car" data-testid="runup-car">
            <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <strong>🚙 {c.name}</strong>
                <div className="small muted">{c.driverId ? `${name(c.driverId)} driving` : 'Driver to sort'}{c.pickup ? ` · pick-up ${c.pickup}` : ''}</div>
              </div>
              <span className={'ru-seats' + (c.free ? '' : ' full')} data-testid="car-seats">{c.free ? `${c.free} seat${c.free === 1 ? '' : 's'} free` : 'Full'}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {c.people.map((id) => <span key={id} className="ru-chip"><Avatar player={data.playersById[id]} size={20} />{name(id)}{id === c.driverId ? ' 🧑‍✈️' : ''}</span>)}
              {Array.from({ length: c.free }).map((_, i) => <span key={`s${i}`} className="ru-seat-empty" aria-label="Empty seat" />)}
            </div>
            {!guest && me && (
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {!problem && <button type="button" className="btn gold sm" disabled={busy} data-testid="hop-in" onClick={() => hop(c, true)}>Hop in</button>}
                {c.people.includes(me) && !iDriveThis && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => hop(c, false)}>Hop out</button>}
                {iDriveThis && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setOffer({ car: c })}>Edit my car</button>}
                {(iDriveThis || isOrg) && c.free > 0 && cars.needLift.length > 0 && cars.needLift.map((id) => (
                  <button key={id} type="button" className="btn ghost sm" disabled={busy} onClick={() => hop(c, true, id)}>+ {name(id)}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {cars.needLift.length > 0 && (
        <div className="small" data-testid="need-lift-list"><strong>🙋 Need a lift:</strong> {cars.needLift.map(name).join(', ')}
          {cars.seatsShort > 0 && <span className="ru-late"> · {cars.seatsShort} more seat{cars.seatsShort === 1 ? '' : 's'} needed</span>}</div>
      )}
      {cars.unsorted.length > 0 && cars.cars.length > 0 && <div className="small muted">Not sorted yet: {cars.unsorted.map(name).join(', ')}</div>}
      {!guest && me && iAmIn && !cars.myCar && (
        <div className="row" style={{ gap: 8 }}>
          {cars.iNeedLift
            ? <button type="button" className="btn ghost sm grow" disabled={busy} onClick={() => needLift(false)}>✓ You’ve asked for a lift — cancel</button>
            : <button type="button" className="btn ghost sm grow" disabled={busy} data-testid="need-lift" onClick={() => needLift(true)}>🙋 I need a lift</button>}
          <button type="button" className="btn gold sm grow" disabled={busy} data-testid="offer-seats" onClick={() => setOffer({})}>🚗 I’ve got seats</button>
        </div>
      )}
      {rooms.rooms.length > 0 && (
        <div className="ru-rooms" data-testid="runup-rooms">
          <span className="label">🛏️ Rooms</span>
          {rooms.mine && <div className="small"><strong>You:</strong> {rooms.mine.name}{rooms.mine.with.length ? ` with ${rooms.mine.with.map(name).join(', ')}` : ''}</div>}
          <div className="small muted">{rooms.rooms.map((r) => `${r.name}: ${r.people.map(name).join(', ') || '—'}`).join(' · ')}</div>
        </div>
      )}
      <div className="small muted">Clubs and gear: on the bring list. Fuel or tolls? Add them to the kitty as a normal cost.{onOrganise && <> <button type="button" className="linkish" onClick={() => onOrganise('groups')}>Rooms & cars →</button></>}</div>
      {offer && <OfferSheet plan={plan} car={offer.car} onClose={() => setOffer(null)} onSaved={afterCar} />}
    </Part>
  );
}

function OfferSheet({ plan, car, onClose, onSaved }) {
  const [busy, run] = useRun();
  const [seats, setSeats] = useState(car ? Math.max(0, car.capacity - 1) : 2);
  const [place, setPlace] = useState(car?.pickup || '');
  const [time, setTime] = useState('');
  const save = () => run(async () => {
    const { error } = await supabase.rpc('runup_offer_car', { p_plan: plan.id, p_seats: Number(seats), p_place: place.trim() || null, p_time: time.trim() || null, p_name: null });
    if (error) throw error;
    onSaved(); onClose();
  }, car ? 'Car updated' : 'Seats offered — people can hop in');
  const stop = () => run(async () => {
    if (!(await askConfirm({ title: 'Stop driving?', body: 'Your car goes, and anyone in it is back to needing a lift.', yes: 'Stop driving' }))) return;
    const { error } = await supabase.rpc('runup_leave_car', { p_car: car.id, p_player: null });
    if (error) throw error;
    onSaved(); onClose();
  });
  return (
    <Sheet title={car ? 'Your car' : 'I’ve got seats'} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Spare seats (not counting you)</span>
          <input className="input" type="number" min={0} max={11} value={seats} data-testid="offer-seat-count" onChange={(e) => setSeats(e.target.value)} /></label>
        <label className="field"><span>Pick-up point</span><input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Leichhardt" /></label>
        <label className="field"><span>Pick-up time</span><input className="input" value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 6:30am Fri" /></label>
        <button type="button" className="btn gold block" disabled={busy} data-testid="offer-save" onClick={save}>{car ? 'Save' : 'Offer my seats'}</button>
        {car && <button type="button" className="btn ghost block" disabled={busy} onClick={stop}>Stop driving</button>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- 3 Up for a vote: open rule changes and cases

function CaseVotes({ cases, reload, guest }) {
  const [busy, run] = useRun();
  if (!cases.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="runup-cases">
      {cases.slice(0, 4).map((c) => {
        const w = voteWords(c.kind);
        return (
          <div key={c.id} className="ru-case">
            <Link to={`/tribunal/case/${c.id}`} style={{ fontWeight: 700, color: 'inherit' }}>{c.kind === 'other' ? '⚖️' : '📜'} {c.title}</Link>
            {!guest && ['voting', 'organiser'].includes(c.stage) && (
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {['for', 'against', 'abstain'].map((k) => (
                  <button key={k} type="button" className="btn ghost sm grow" disabled={busy}
                    onClick={() => run(async () => { await must(supabase.rpc('vote_case', { p_case: c.id, p_vote: k, p_comment: null })); reload(); }, 'Vote recorded')}>{w[k]}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- 4 What's up for grabs (until ov23's piece is wired)

function GrabsStandIn({ tripId, rounds }) {
  const data = useData();
  const trophies = (data.trophies || []).filter((t) => t.trip_id === tripId);
  const formats = [...new Set(rounds.map((r) => r.format).filter(Boolean))];
  if (!trophies.length && !formats.length) return <div className="small muted">The trophies and comps show here once the rounds are set up.</div>;
  return (
    <div className="stack" style={{ gap: 4 }} data-testid="runup-grabs-standin">
      {trophies.map((t) => <div key={t.id} className="small">🏆 <strong>{t.name}</strong>{t.description ? <span className="muted"> · {t.description}</span> : null}</div>)}
      {formats.length > 0 && <div className="small muted">Rounds: {formats.map((f) => f[0].toUpperCase() + f.slice(1)).join(', ')}</div>}
      {tripId && <Link to={`/trip-now/${tripId}`} className="small" style={{ fontWeight: 700 }}>Leaderboards and comps →</Link>}
    </div>
  );
}

// ---------------------------------------------------------------- 5 Rules for this trip

function RulesPart({ ru, guest }) {
  const active = ru.rules.filter((r) => r.status === 'active');
  const proposed = ru.rules.filter((r) => r.status === 'proposed');
  const disputed = ru.cases.filter((c) => c.kind !== 'other');
  return (
    <Part id="rules" icon="📜" title="Rules for this trip" count={active.length ? `${active.length} in force` : null}>
      {active.slice(0, 5).map((r) => <Link key={r.id} to={`/rules/${r.id}`} className="ru-rule">{r.title}</Link>)}
      {active.length > 5 && <Link to="/governance/rulebook" className="small" style={{ fontWeight: 700 }}>All {active.length} rules →</Link>}
      {(proposed.length > 0 || disputed.length > 0) && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Proposed or disputed</span>
          {proposed.map((r) => <Link key={r.id} to={`/rules/${r.id}`} className="ru-rule proposed">💡 {r.title}</Link>)}
          {disputed.map((c) => <Link key={c.id} to={`/tribunal/case/${c.id}`} className="ru-rule proposed">⚖️ {c.title}</Link>)}
        </div>
      )}
      {!active.length && !proposed.length && <div className="small muted">No house rules yet — the rules of golf apply.</div>}
      {!guest && <Link to="/governance/rulebook?propose=1" className="btn ghost sm" data-testid="propose-rule">✍️ Propose a change</Link>}
    </Part>
  );
}

// ---------------------------------------------------------------- 6 Side activities

function Activities({ pd, ru, me, isOrg, guest, costsOn }) {
  const data = useData();
  const [busy, run] = useRun();
  const [adding, setAdding] = useState(false);
  const toggle = (a, on) => run(async () => {
    if (on) await must(supabase.from('trip_activity_people').insert({ activity_id: a.id, player_id: me }));
    else await must(supabase.from('trip_activity_people').delete().eq('activity_id', a.id).eq('player_id', me));
    ru.reload(); pd.reload();
  }, on ? (Number(a.cost_pp) > 0 && costsOn ? `You’re in — $${Number(a.cost_pp)} into the kitty` : 'You’re in') : 'You’re out');
  const remove = (a) => run(async () => {
    if (!(await askConfirm({ title: `Remove ${a.title}?`, yes: 'Remove it' }))) return;
    await must(supabase.from('trip_activities').delete().eq('id', a.id));
    ru.reload(); pd.reload();
  });
  return (
    <Part id="activities" icon="🎳" title="Side activities" count={ru.activities.length || null}>
      {!ru.activities.length && <div className="small muted">Go-karts, a brewery, a winery lunch? Anyone can put one up.</div>}
      {ru.activities.map((a) => {
        const m = activityMoney(a, ru.joins, me);
        const iAm = m.ids.includes(me);
        return (
          <div key={a.id} className="ru-act" data-testid="runup-activity">
            <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <strong>{a.title}</strong>
                {activityWhen(a) && <div className="small muted">{activityWhen(a)}</div>}
                <div className="small" data-testid="activity-money">{m.line}</div>
              </div>
              {/* ov28 (walkthrough small fix): in = solid green with a tick; not in = an outline "I'm in" to tap. */}
              {!guest && me && (
                <button type="button" className="btn sm" aria-pressed={iAm} disabled={busy} data-testid="activity-in" onClick={() => toggle(a, !iAm)}
                  style={iAm ? { background: '#1F6B3A', borderColor: '#1F6B3A', color: '#fff', fontWeight: 800 } : { background: '#fff', borderColor: 'var(--navy)', color: 'var(--navy)', fontWeight: 700 }}>
                  {iAm ? '✓ You’re in' : 'I’m in'}
                </button>
              )}
            </div>
            {m.count > 0 && <div className="row" style={{ gap: 6, marginTop: 4 }}><AvatarStack players={m.ids.map((id) => data.playersById[id]).filter(Boolean)} size={22} /></div>}
            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="small">Link ↗</a>}
              {a.created_by && <span className="small muted">from {firstName(data.playersById[a.created_by])}</span>}
              {(isOrg || a.created_by === me) && <button type="button" className="linkish small" onClick={() => remove(a)}>Remove</button>}
            </div>
          </div>
        );
      })}
      {!guest && me && !ru.missing && <button type="button" className="btn ghost sm" data-testid="add-activity" onClick={() => setAdding(true)}>+ Propose an activity</button>}
      {costsOn && <div className="small muted">A cost each goes into the kitty, split between those in.</div>}
      {adding && <ActivitySheet plan={pd.plan} me={me} onClose={() => setAdding(false)} onSaved={() => { ru.reload(); pd.reload(); }} />}
    </Part>
  );
}

function ActivitySheet({ plan, me, onClose, onSaved }) {
  const [v, set] = useState({ title: '', day: '', time: '', place: '', cost_pp: '', link: '' });
  const [busy, run] = useRun();
  const f = (k) => ({ value: v[k], onChange: (e) => set({ ...v, [k]: e.target.value }) });
  const save = () => run(async () => {
    const row = cleanActivity(v);
    if (row.error) throw new Error(row.error);
    const made = await must(supabase.from('trip_activities').insert({ ...row, plan_id: plan.id, created_by: me }).select('id').single());
    // Whoever puts it up is in.
    await supabase.from('trip_activity_people').insert({ activity_id: made.id, player_id: me });
    onSaved(); onClose();
  }, 'Activity up — people can say they’re in');
  return (
    <Sheet title="Propose an activity" onClose={onClose}>
      <div className="stack">
        <label className="field"><span>What</span><input className="input" data-testid="activity-title" {...f('title')} placeholder="e.g. Go-karts" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field"><span>Day</span><input className="input" type="date" min={plan.start_date || undefined} max={plan.end_date || undefined} {...f('day')} /></label>
          <label className="field"><span>Time</span><input className="input" {...f('time')} placeholder="e.g. 4pm" /></label>
        </div>
        <label className="field"><span>Where</span><input className="input" {...f('place')} placeholder="e.g. Hunter Valley Karting" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
          <label className="field"><span>Cost each $</span><input className="input" inputMode="decimal" data-testid="activity-cost" {...f('cost_pp')} /></label>
          <label className="field"><span>Link (optional)</span><input className="input" {...f('link')} /></label>
        </div>
        <span className="small muted">You’re in automatically. A cost each goes into the kitty for everyone who’s in; you’re down as having paid it (you book it).</span>
        <button type="button" className="btn gold block" disabled={busy || !v.title.trim()} data-testid="activity-save" onClick={save}>Put it up</button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- 7 What to bring

export async function claimBring(item, on) {
  const { error } = await supabase.rpc('runup_claim_bring', { p_item: item.id, p_on: on });
  if (error) throw error;
}

function Bring({ pd, me, isOrg, guest, feedOn, onOrganise }) {
  const data = useData();
  const [busy, run] = useRun();
  const [text, setText] = useState('');
  const [tell, setTell] = useState(false);
  const v = bringView(pd.items);
  const add = () => run(async () => {
    const title = text.trim().slice(0, 80);
    if (!title) return;
    await must(supabase.from('plan_items').insert({ plan_id: pd.plan.id, kind: 'bring', title, bring_shared: true, sort: 500 + v.shared.length }));
    setText(''); pd.reload();
  }, 'Added — nobody’s on it yet');
  const claim = (it, on) => run(async () => {
    await claimBring(it, on);
    if (on && tell && feedOn) await supabase.from('posts').insert({ kind: 'user', player_id: me, body: claimPostText(data.playersById[me], it), link: `/plan/${pd.plan.id}?view=overview` });
    pd.reload();
  }, on ? `You’re bringing the ${it.title.toLowerCase()}` : 'Taken off you');
  const ask = () => run(async () => {
    await must(supabase.from('posts').insert({ kind: 'user', player_id: me, body: `📣 ${pd.plan.name}: ${bringAskText(v.open)}`, link: bringAskLink(pd.plan.id) }));
  }, 'Asked the group in the Feed');
  const remove = (it) => run(async () => { await must(supabase.from('plan_items').delete().eq('id', it.id)); pd.reload(); });
  return (
    <Part id="bring" icon="🎒" title="What to bring" count={v.open.length ? `${v.open.length} need someone` : null}>
      {!v.shared.length && <div className="small muted">Speaker, esky, cards, spare balls? Add what the group needs and someone says they’ll bring it.</div>}
      {v.shared.map((it) => {
        const who = it.owner_id ? data.playersById[it.owner_id] : null;
        return (
          <div key={it.id} className="ru-bring" data-testid="bring-item">
            <span aria-hidden="true">{bringEmoji(it.title)}</span>
            <span className="grow" style={{ minWidth: 0 }}><strong>{it.title}</strong>
              <span className={'small' + (who ? '' : ' muted')} data-testid="bring-who"> · {who ? (it.owner_id === me ? 'You' : firstName(who)) : 'Nobody yet'}</span></span>
            {!guest && me && !who && <button type="button" className="btn gold sm" disabled={busy} data-testid="bring-claim" onClick={() => claim(it, true)}>I’ll bring it</button>}
            {!guest && it.owner_id === me && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => claim(it, false)}>Can’t now</button>}
            {isOrg && <button type="button" className="linkish small" aria-label={`Remove ${it.title}`} onClick={() => remove(it)}>✕</button>}
          </div>
        );
      })}
      {!guest && me && (
        <>
          {feedOn && v.open.length > 0 && (
            <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} style={{ width: 20, height: 20 }} />Tell the group when I claim something</label>
          )}
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an idea, e.g. Speaker" data-testid="bring-new" maxLength={80}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button type="button" className="btn ghost sm" disabled={busy || !text.trim()} data-testid="bring-add" onClick={add}>Add</button>
          </div>
          {feedOn && v.open.length > 0 && <button type="button" className="btn ghost sm" disabled={busy} data-testid="bring-ask" onClick={ask}>📣 Ask the group</button>}
        </>
      )}
      {v.personal.length > 0 && <div className="small muted">Plus your own list ({v.personal.length}: {v.personal.slice(0, 3).map((i) => i.title.toLowerCase()).join(', ')}{v.personal.length > 3 ? '…' : ''}){onOrganise && <> — <button type="button" className="linkish" onClick={() => onOrganise('details')}>see it</button></>}</div>}
    </Part>
  );
}

// ---------------------------------------------------------------- 8 Form guide

function FormGuide({ pd, rounds }) {
  const data = useData();
  const ins = useMemo(() => pd.rsvps.filter((r) => r.status === 'in').map((r) => r.player_id), [pd.rsvps]);
  // The last dozen finished rounds any of them played (enough for "last 3" and the trend, without loading everything).
  const recent = useMemo(() => data.rounds.filter((r) => r.status === 'locked' && (data.roundPlayers[r.id] || []).some((rp) => ins.includes(rp.player_id)))
    .sort((a, b) => String(b.play_date || b.created_at).localeCompare(String(a.play_date || a.created_at))).slice(0, 12), [data.rounds, data.roundPlayers, ins]);
  const courseIds = useMemo(() => [...new Set(rounds.map((r) => r.course_id))], [rounds]);
  const atCourses = useMemo(() => data.rounds.filter((r) => r.status === 'locked' && courseIds.includes(r.course_id)).slice(0, 12), [data.rounds, courseIds]);
  const ids = useMemo(() => [...new Set([...recent, ...atCourses].map((r) => r.id))], [recent, atCourses]);
  const scores = useScores(ids);
  const rows = useMemo(() => {
    const ctx = buildHistory({ ...data, rounds: data.rounds.filter((r) => ids.includes(r.id)) }, scores.index);
    return formGuide(ctx, ins, courseIds);
  }, [data, ids, scores.index, ins, courseIds]);
  if (!ins.length) return null;
  return (
    <Part id="form" icon="📈" title="Form guide">
      <div className="ru-form" role="table" aria-label="Form guide">
        <div className="ru-form-row head" role="row"><span role="columnheader">Player</span><span role="columnheader">Last rounds</span><span role="columnheader">Hcp</span><span role="columnheader">Best here</span></div>
        {rows.map((r) => {
          const p = data.playersById[r.id];
          return (
            <div key={r.id} className="ru-form-row" role="row" data-testid="form-row">
              <span role="cell" className="row" style={{ gap: 6, minWidth: 0 }}><Avatar player={p} size={22} /><span className="ellipsis">{firstName(p)}</span></span>
              <span role="cell">{formLine(r.last) || '—'}</span>
              <span role="cell">{trendWords(r.trend) || (p?.handicap ?? '—')}</span>
              <span role="cell" className="ellipsis">{r.best ? `${r.best.points} pts` : '—'}</span>
            </div>
          );
        })}
      </div>
      <div className="small muted">Stableford points, latest first. “Best here”: their best at this trip’s courses.</div>
    </Part>
  );
}

// ---------------------------------------------------------------- 9 Tipping

function Tipping({ pd, ru, tipping, myTip, me, isOrg, guest, tripId }) {
  const data = useData();
  const [busy, run] = useRun();
  const ins = pd.rsvps.filter((r) => r.status === 'in').map((r) => data.playersById[r.player_id]).filter(Boolean);
  const honours = (data.honour_board || []).filter((h) => h.trip_id === tripId);
  const main = mainTrophy(honours);
  const result = tipResult({ tips: ru.tips, winnerIds: main?.player_ids || [], playersById: data.playersById });
  const pick = (id) => run(async () => {
    await must(supabase.from('trip_tips').upsert({ plan_id: pd.plan.id, player_id: me, pick_id: id }, { onConflict: 'plan_id,player_id' }));
    ru.reload();
  }, `Tipped ${firstName(data.playersById[id])}`);
  const tally = tipTally(ru.tips);
  return (
    <Part id="tipping" icon="🔮" title="Tipping" count={ru.tips.length ? `${ru.tips.length} in` : null}
      right={isOrg && <TippingSwitch plan={pd.plan} pd={pd} small />}>
      <div className="small muted">Pick who wins the main trophy. Bragging rights only — no money. {tipping.open ? `Closes ${tipping.closesWords}.` : 'Closed at the first tee.'}</div>
      {result.line && <div className="ru-tip-result" data-testid="tip-result">🏅 {result.line}</div>}
      {tipping.open && !guest && me ? (
        <div className="ru-tip-grid" data-testid="tip-grid">
          {ins.map((p) => (
            <button key={p.id} type="button" className={'ru-tip' + (myTip?.pick_id === p.id ? ' on' : '')} aria-pressed={myTip?.pick_id === p.id} disabled={busy} onClick={() => pick(p.id)}>
              <Avatar player={p} size={28} /><span className="ellipsis">{firstName(p)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="stack" style={{ gap: 4 }} data-testid="tip-locked">
          {myTip && <div className="small"><strong>Your tip:</strong> {firstName(data.playersById[myTip.pick_id])} 🔒</div>}
          {!tipping.open && tally.map((t) => <div key={t.id} className="small">{firstName(data.playersById[t.id])}: {t.n} tip{t.n === 1 ? '' : 's'}</div>)}
        </div>
      )}
      {tipping.open && myTip && <div className="small">Your tip: <strong>{firstName(data.playersById[myTip.pick_id])}</strong> — change it until the first tee.</div>}
    </Part>
  );
}

function TippingSwitch({ plan, pd, small = false }) {
  const [busy, run] = useRun();
  const off = !!plan.tipping_off;
  const flip = () => run(async () => { await must(supabase.from('plans').update({ tipping_off: !off }).eq('id', plan.id)); pd.reload(); }, off ? 'Tipping is on' : 'Tipping is off for this trip');
  return (
    <button type="button" className={small ? 'linkish small' : 'btn ghost sm'} disabled={busy} data-testid="tipping-switch" onClick={flip}>
      {off ? '🔮 Turn tipping on' : 'Turn off'}
    </button>
  );
}

// ---------------------------------------------------------------- 10 Trip chat

function ChatBits({ pd, onOrganise }) {
  const data = useData();
  const latest = [...(pd.comments || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3);
  return (
    <Part id="chat" icon="💬" title="Trip chat" count={pd.comments?.length || null}>
      {!latest.length && <div className="small muted">Nothing yet — say g’day.</div>}
      {latest.map((c) => (
        <div key={c.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Avatar player={data.playersById[c.player_id]} size={24} />
          <div className="grow small" style={{ minWidth: 0 }}><strong>{firstName(data.playersById[c.player_id])}</strong> <span className="muted">{timeAgo(c.created_at)}</span>
            <div className="ru-chat-body">{c.body}</div></div>
        </div>
      ))}
      {onOrganise && <button type="button" className="btn ghost sm" onClick={() => onOrganise('chat')}>Open the chat →</button>}
    </Part>
  );
}

export default RunUp;
