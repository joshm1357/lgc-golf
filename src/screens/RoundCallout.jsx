// ov34 — one round call-out, the slim screen (Josh 23 Oct 2026: "plan a round too and ask the guys … not being a cup
// or anything"). Shown by Planner.jsx's PlanDetail for a plan with callout = true. No place votes, organise steps,
// stay, run-up or cups: just the course, when (or the times to tick), spots, who's in / maybe / can't / reserve / not
// answered (headcount.js's rule), the note, when replies close, and the actions. Extras ("➕ Add to this round") only
// show when someone switched them on. Locking it in (103's callout_lock) makes one round in the app, so scoring,
// history and side games work as usual.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Header, Avatar, Sheet, toast, askConfirm } from '../components/ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { gate } from '../lib/savedgate.js';
import { replies, repliesLine } from '../lib/headcount.js';
import {
  lockPreview, promotedBy, spotsWords, extrasOn, cleanExtras, EXTRAS, cleanTime, optionLabel,
} from '../lib/callout.js';
import { calloutView, ReplyButtons, replyRsvp, standingWords, useCallout } from '../components/CalloutCard.jsx';
import { CourseFinder } from '../components/CalloutSheet.jsx';
import { TripWeather } from '../components/Weather.jsx';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import '../components/callout.css';

const KittyTab = lazyScreen(() => import('./PlanTabs.jsx'), 'KittyTab', { inline: true });
const GroupsTab = lazyScreen(() => import('./PlanTabs.jsx'), 'GroupsTab', { inline: true });

const names = (ids, byId) => ids.map((id) => byId[id]).filter(Boolean);

/** Someone's row in a list: avatar, name, and a note on the right. */
function Person({ p, right = null }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Avatar player={p} size={28} />
      <span className="grow" style={{ fontWeight: 600 }}>{playerName(p)}</span>
      {right}
    </div>
  );
}

export default function RoundCallout({ pd }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const cd = useCallout(pd.plan.id); // the plan engine's rows plus who's asked
  const me = status.player_id;
  const isAdmin = !!status.is_admin;
  const [locking, setLocking] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, run] = useRun();
  const on = {
    games: useFeature('games'), dinner_awards: useFeature('dinner_awards'), planner_rooms: useFeature('planner_rooms'), planner_costs: useFeature('planner_costs'),
  };
  const v = useMemo(() => (cd?.plan ? calloutView(cd, { players: data.players, me }) : null), [cd, data.players, me]);
  if (!cd?.plan || !v) return <div className="page"><Header back="Trips" title={pd.plan.name} /><div className="section small muted">Loading…</div></div>;
  const { plan } = cd;
  const byId = data.playersById;
  const manage = isAdmin || (me && (me === plan.created_by || me === plan.organiser_id));
  const by = byId[plan.created_by];
  const asked = v.asked.map((id) => byId[id]).filter(Boolean);
  // The ONE headcount rule (headcount.js), over the people asked.
  const counts = replies({ players: asked, rsvps: cd.rsvps });
  const extras = extrasOn(plan, (f) => on[f] !== false);
  const has = (k) => extras.some((e) => e.key === k);
  const round = plan.round_id ? data.rounds.find((r) => r.id === plan.round_id) : null;
  const trip = plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null;
  const mine = cd.rsvps.find((r) => r.player_id === me)?.status || null;
  const cancelled = plan.status === 'cancelled';

  const pullOut = () => run(async () => {
    const up = promotedBy({ cap: plan.spots, rsvps: cd.rsvps }, me);
    const ok = await askConfirm({ title: 'Can’t make it now?', body: up ? `${playerName(byId[up])} is first on the reserve list and gets your spot.` : 'Your spot opens up for anyone who says they’re in.', yes: 'I can’t make it', tone: 'go' });
    if (!ok) return;
    await replyRsvp(plan, me, 'out');
    await cd.reload();
    toast(up ? `Done — ${playerName(byId[up])} is in from the reserves` : 'Done — your spot is free');
  });
  const callOff = () => run(async () => {
    const ok = await askConfirm({ title: 'Call it off?', body: 'Everyone with a spot gets told. The round goes too, if nobody has scored on it.', yes: 'Call it off' });
    if (!ok) return;
    await must(supabase.rpc('call_off_plan', { p_plan: plan.id, p_off: true }));
    await notify('callout_send', { plan_id: plan.id });
    await cd.reload();
  }, 'Called off');

  return (
    <div className="page">
      <Header back="Trips" title={plan.name} sub={[v.when, v.course].join(' · ')} />
      <div className="section stack" style={{ gap: 12, paddingBottom: 32 }} data-testid="round-callout">
        {/* ---------------- Where it's at */}
        {cancelled ? (
          <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }} data-testid="co-off"><strong>Called off.</strong> <span className="small">Nobody’s playing this one.</span></div>
        ) : v.locked ? (
          <div className="card pad stack" style={{ gap: 8, background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff' }} data-testid="co-locked">
            <span className="label" style={{ color: 'var(--on-navy-muted)' }}>🔒 Locked in</span>
            <strong style={{ fontSize: 20 }}>{v.when} · {v.course}</strong>
            <span className="small" style={{ color: 'var(--on-navy-muted)' }}>{standingWords(v.standing)}{plan.booker_id ? ` · ${playerName(byId[plan.booker_id])} is booking` : ''}</span>
            {plan.round_id && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Link to={`/?r=${plan.round_id}`} className="btn gold sm" data-testid="co-open-round">⛳ Open the round</Link>
                {round && v.standing.status === 'in' && round.status !== 'locked' && <Link to={`/score/${plan.round_id}`} className="btn ghost sm" style={{ color: '#fff', background: 'transparent', borderColor: 'rgba(255,255,255,.5)' }}>Enter scores</Link>}
              </div>
            )}
          </div>
        ) : (
          <div className="card pad stack" style={{ gap: 4 }} data-testid="co-open">
            <span className="label">⛳ Who’s up for a hit?</span>
            <span>{by ? `${playerName(by)} put this out` : 'Put out'}{v.voting ? ' — tick the times you can make.' : ' — say if you can play.'}</span>
            {v.closesLine && <span className="small muted">{v.closesLine}{v.closed && manage ? ' — time to lock it in.' : v.closed ? ` — waiting for ${by ? playerName(by) : 'them'} to lock it in.` : ''}</span>}
          </div>
        )}

        {/* ---------------- Your reply */}
        {!cancelled && !v.past && v.isAsked && (
          <div className="card pad stack" style={{ gap: 10 }} data-testid="co-your-reply">
            <div className="row between"><strong>Your reply</strong><span className={`co-pill${v.standing.status === 'in' ? ' in' : v.standing.status === 'reserve' ? ' reserve' : ''}`} data-testid="co-standing">{v.voting ? `${v.options.filter((o) => v.myVote(o.id)).length} of ${v.options.length} answered` : standingWords(v.standing)}</span></div>
            <ReplyButtons cd={cd} v={v} me={me} />
            {v.locked && mine === 'in' && (
              <button type="button" className="btn ghost block" onClick={pullOut} disabled={busy} data-testid="co-pull-out">I can’t make it now</button>
            )}
            {v.locked && v.standing.status === 'reserve' && <span className="small muted">If someone pulls out, you’re moved up and told straight away.</span>}
          </div>
        )}
        {!v.isAsked && !cancelled && <div className="small muted">This one’s just for the people asked{by ? ` — ask ${playerName(by)} to add you` : ''}.</div>}

        {/* ---------------- Who's playing */}
        <div className="card pad stack" style={{ gap: 10 }} data-testid="co-who-card">
          <div className="row between">
            <strong>Who’s {v.locked ? 'playing' : 'in'}</strong>
            <span className="small muted" data-testid="co-spots">{v.voting ? (plan.spots ? `${plan.spots} spots` : 'No cap') : spotsWords(plan.spots, v.spots.in.length, v.spots.reserve.length)}</span>
          </div>
          {v.voting ? (
            <div className="co-people">
              {v.options.map((o) => {
                const t = v.tally[o.id];
                const prev = lockPreview({ cap: plan.spots, optionId: o.id, votes: cd.votes });
                return (
                  <div key={o.id} className="small" data-testid="co-option-people">
                    <strong>{o.label}</strong>: {t.yes ? names(prev.in, byId).map(playerName).join(', ') : 'nobody yet'}
                    {prev.reserve.length > 0 && <span className="muted"> · reserve: {names(prev.reserve, byId).map(playerName).join(', ')}</span>}
                    {t.maybeIds.length > 0 && <span className="muted"> · maybe: {names(t.maybeIds, byId).map(playerName).join(', ')}</span>}
                  </div>
                );
              })}
              <span className="small muted">{v.noReply.length ? `${v.noReply.length} not answered yet: ${names(v.noReply, byId).map(playerName).join(', ')}` : 'Everyone asked has answered.'}</span>
            </div>
          ) : (
            <div className="co-people" data-testid="co-people">
              {names(v.spots.in, byId).map((p, i) => <Person key={p.id} p={p} right={<span className="co-pill in">{plan.spots ? `Spot ${i + 1}` : 'In'}</span>} />)}
              {names(v.spots.reserve, byId).map((p, i) => <Person key={p.id} p={p} right={<span className="co-pill reserve" data-testid="co-reserve">Reserve #{i + 1}</span>} />)}
              {v.spots.in.length === 0 && <span className="small muted">Nobody in yet.</span>}
              <span className="small muted" data-testid="co-counts">
                {/* headcount.js counts the replies; reserves are split out of "in" here. */}
                {counts.total ? [v.locked ? `${v.spots.in.length} playing` : `${v.spots.in.length} in`, v.spots.reserve.length ? `${v.spots.reserve.length} on reserve` : null,
                  counts.maybe ? `${counts.maybe} maybe` : null, counts.out ? `${counts.out} can’t` : null, counts.noReply ? `${counts.noReply} not replied` : null].filter(Boolean).join(' · ') : repliesLine(counts)}
                {counts.ids.maybe.length > 0 ? ` · maybe: ${names(counts.ids.maybe, byId).map(playerName).join(', ')}` : ''}
                {counts.ids.out.length > 0 ? ` · can’t: ${names(counts.ids.out, byId).map(playerName).join(', ')}` : ''}
              </span>
            </div>
          )}
        </div>

        {/* ---------------- The details */}
        <div className="card pad stack" style={{ gap: 6 }} data-testid="co-details">
          <div className="co-meta small">
            <span>⛳ <strong>{v.course}</strong></span>
            <span>🕐 {v.locked ? v.when : v.voting ? `${v.options.length} times` : v.when}</span>
            <span>👥 {asked.length === data.players.filter((p) => p.approved !== false).length ? 'The whole group' : `${asked.length} asked`}</span>
          </div>
          {plan.brief && <div data-testid="co-note">📝 {plan.brief}</div>}
          {has('after') && <div>🍺 {plan.extras.after}</div>}
          {!v.locked && v.closesLine && <div className="small muted">⏰ {v.closesLine}</div>}
        </div>

        {/* ---------------- Extras, only when switched on */}
        {extras.filter((e) => e.key !== 'after').length > 0 && !cancelled && (
          <div className="card pad stack" style={{ gap: 10 }} data-testid="co-extras-on">
            <strong>➕ Added to this round</strong>
            {has('course_vote') && v.coursePoll && <CourseVote cd={cd} v={v} me={me} />}
            {has('games') && (v.locked && plan.round_id
              ? <Link to={`/games?r=${plan.round_id}`} className="btn ghost sm">🎲 Side games & bets for this round</Link>
              : <span className="small muted">🎲 Side games & bets — set up once it’s locked in.</span>)}
            {has('fines') && (v.locked && plan.trip_id
              ? <Link to={`/dinner/${plan.trip_id}`} className="btn ghost sm">🏷️ Fines & awards</Link>
              : <span className="small muted">🏷️ Fines & awards — once it’s locked in.</span>)}
            {has('cars') && <details className="co-more co-extra"><summary>🚗 Cars & lifts</summary><LazyArea fallback={null} quiet><GroupsTab pd={pd} /></LazyArea></details>}
            {has('kitty') && <details className="co-more co-extra"><summary>💰 Kitty</summary><LazyArea fallback={null} quiet><KittyTab pd={pd} /></LazyArea></details>}
          </div>
        )}

        {v.locked && trip && <TripWeather plan={plan} rounds={round ? [round] : []} coursesById={data.coursesById} />}

        {/* ---------------- The actions */}
        {manage && !cancelled && !v.past && (
          <div className="stack" style={{ gap: 8 }}>
            {!v.locked && (
              <button {...gate('organise')} type="button" className="btn gold block" style={{ minHeight: 56 }} onClick={() => setLocking(true)} data-testid="co-lock">
                🔒 Lock it in{v.best && v.tally[v.best.id]?.yes ? ` — ${v.best.label}` : ''}
              </button>
            )}
            <button {...gate('organise')} type="button" className="btn ghost block" onClick={() => setChanging(true)} data-testid="co-change">Change {v.locked ? 'spots, tee time or extras' : 'details, spots, who’s asked or extras'}</button>
            <button {...gate('organise')} type="button" className="btn ghost block" onClick={callOff} disabled={busy} style={{ color: 'var(--down)' }} data-testid="co-call-off">Call it off</button>
          </div>
        )}
      </div>
      {locking && <LockSheet cd={cd} v={v} onClose={() => setLocking(false)} onDone={(r) => { setLocking(false); if (r?.round_id) toast('Locked in — the round is in the app'); }} />}
      {changing && <ChangeSheet cd={cd} v={v} onClose={() => setChanging(false)} />}
    </div>
  );
}

/** The "vote on the course" extra: ✓ / ? / ✗ per course (the plan's 'location' vote). */
function CourseVote({ cd, v, me }) {
  const [busy, setBusy] = useState(false);
  const votes = cd.votes.filter((x) => x.poll_id === v.coursePoll.id);
  const winner = v.coursePoll.winner_option_id;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="co-course-vote">
      <span className="small"><strong>🗳️ Where should we play?</strong>{v.coursePoll.status === 'closed' ? ' — decided' : ''}</span>
      {v.courseOptions.map((o) => {
        const yes = votes.filter((x) => x.option_id === o.id && x.response === 'yes').length;
        const mineV = votes.find((x) => x.option_id === o.id && x.player_id === me)?.response;
        return (
          <div key={o.id} className={`co-tick${winner === o.id ? ' best' : ''}`}>
            <div><strong>{o.label}</strong><div className="small muted">{yes} keen</div></div>
            {v.coursePoll.status === 'open' && v.isAsked ? (
              <div className="co-reply">
                {[{ r: 'yes', l: '✓', c: 'yes' }, { r: 'maybe', l: '?', c: 'maybe' }, { r: 'no', l: '✗', c: 'no' }].map((b) => (
                  <button key={b.r} type="button" className={b.c} aria-pressed={mineV === b.r} disabled={busy}
                    onClick={async () => { setBusy(true); const { error } = await supabase.from('plan_votes').upsert({ option_id: o.id, poll_id: o.poll_id, player_id: me, response: b.r }, { onConflict: 'option_id,player_id' }); setBusy(false); if (error) toast(error.message); else cd.reload(); }}>{b.l}</button>
                ))}
              </div>
            ) : <span />}
          </div>
        );
      })}
    </div>
  );
}

/** Lock it in: pick the time (the app's suggestion first), the exact tee time, the course if it's TBC, who's booking. */
function LockSheet({ cd, v, onClose, onDone }) {
  const data = useData();
  const { plan } = cd;
  const byId = data.playersById;
  const [optionId, setOptionId] = useState(v.best?.id || v.options[0]?.id || null);
  const opt = v.options.find((o) => o.id === optionId) || null;
  const [tee, setTee] = useState(opt?.tee_time || plan.tee_time || '');
  // The course vote's leader, if there is one and no course yet.
  const courseLead = useMemo(() => {
    if (!v.coursePoll) return null;
    const score = (o) => cd.votes.filter((x) => x.option_id === o.id && x.response === 'yes').length * 100 + cd.votes.filter((x) => x.option_id === o.id && x.response === 'maybe').length;
    return [...v.courseOptions].filter((o) => o.course_id || o.library_course_id).sort((a, b) => score(b) - score(a))[0] || null;
  }, [cd.votes, v.coursePoll, v.courseOptions]);
  const needCourse = !plan.course_id && !plan.library_course_id;
  const [course, setCourse] = useState(() => (courseLead ? (courseLead.course_id ? { kind: 'group', id: courseLead.course_id, name: courseLead.label } : { kind: 'library', id: courseLead.library_course_id, name: courseLead.label }) : null));
  const [finding, setFinding] = useState(false);
  const [booker, setBooker] = useState(plan.created_by || '');
  const [format, setFormat] = useState('stableford');
  const [busy, run] = useRun();
  const preview = lockPreview({ cap: plan.spots, optionId: v.datesPoll ? optionId : null, votes: cd.votes, rsvps: cd.rsvps });
  const teeOk = !tee || cleanTime(tee);
  const go = () => run(async () => {
    const r = await must(supabase.rpc('callout_lock', {
      p_plan: plan.id, p_option: v.datesPoll ? optionId : null, p_tee_time: tee ? cleanTime(tee) : null,
      p_course: needCourse && course?.kind === 'group' ? course.id : null, p_library: needCourse && course?.kind === 'library' ? course.id : null,
      p_booker: booker || null, p_format: format,
    }));
    await notify('callout_send', { plan_id: plan.id });
    await data.reload?.();
    await cd.reload();
    onDone?.(r);
  });
  return (
    <Sheet title="🔒 Lock it in" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }} data-testid="co-lock-sheet">
        {v.datesPoll && (
          <div className="co-step">
            <span className="label">Which time?</span>
            {v.options.map((o) => {
              const t = v.tally[o.id];
              return (
                <label key={o.id} className="co-opt" style={{ cursor: 'pointer' }}>
                  <input type="radio" name="co-opt" checked={optionId === o.id} onChange={() => { setOptionId(o.id); setTee(o.tee_time || ''); }} style={{ width: 20, height: 20 }} />
                  <strong>{o.label}</strong>
                  <span className="small muted" style={{ paddingRight: 8 }}>{t.yes} can{t.maybe ? ` · ${t.maybe} maybe` : ''}{v.best?.id === o.id ? ' · suggested' : ''}</span>
                </label>
              );
            })}
          </div>
        )}
        <label className="field"><span>Tee time{opt?.part && !opt?.tee_time ? ` (it was “${opt.part}”)` : ''}</span>
          <input className="input" type="time" value={tee} onChange={(e) => setTee(e.target.value)} data-testid="co-lock-tee" /></label>
        {!teeOk && <span className="small err">A tee time like 1:20pm.</span>}
        {needCourse && (
          <div className="co-step">
            <span className="label">Course</span>
            <div className="co-chips">
              {data.courses.slice(0, 8).map((c) => <button key={c.id} type="button" className="chip" aria-pressed={course?.kind === 'group' && course.id === c.id} onClick={() => setCourse({ kind: 'group', id: c.id, name: c.name })}>{c.name}</button>)}
              {course?.kind === 'library' && <button type="button" className="chip" aria-pressed="true">{course.name}</button>}
              <button type="button" className="chip" aria-pressed={finding} onClick={() => setFinding(!finding)}>🔎 Another</button>
            </div>
            {finding && <CourseFinder onPick={(c) => { setCourse(c); setFinding(false); }} />}
            {courseLead && <span className="small muted">The course vote says {courseLead.label}.</span>}
          </div>
        )}
        <label className="field"><span>Who’s booking? (they get a job and a reminder)</span>
          <select className="select" value={booker} onChange={(e) => setBooker(e.target.value)} data-testid="co-booker">
            <option value="">Nobody — it’s booked</option>
            {data.players.filter((p) => p.approved !== false).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
          </select>
        </label>
        <div className="seg light" role="group" aria-label="Format">
          <button type="button" aria-pressed={format === 'stableford'} onClick={() => setFormat('stableford')}>Stableford</button>
          <button type="button" aria-pressed={format === 'ambrose'} onClick={() => setFormat('ambrose')}>Ambrose</button>
        </div>
        <div className="card pad stack" style={{ gap: 4, background: 'var(--ground)' }} data-testid="co-lock-preview">
          <span className="small"><strong>In ({preview.in.length}{plan.spots ? ` of ${plan.spots}` : ''}):</strong> {names(preview.in, byId).map(playerName).join(', ') || 'nobody yet'}</span>
          {preview.reserve.length > 0 && <span className="small"><strong>Reserves:</strong> {names(preview.reserve, byId).map((p, i) => `#${i + 1} ${playerName(p)}`).join(', ')}</span>}
          <span className="small muted">In the order they said they could. Everyone gets told where they stand.</span>
        </div>
        <button {...gate('organise')} type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || (v.datesPoll && !optionId) || !teeOk || (needCourse && !course)} onClick={go} data-testid="co-lock-go">
          🔒 Lock it in{opt ? ` — ${optionLabel({ date: opt.start_date, part: opt.part, tee_time: cleanTime(tee) || opt.tee_time })}` : ''}
        </button>
      </div>
    </Sheet>
  );
}

/** Change it: note, when replies close, spots, ask more people, tee time (after lock-in), extras. */
function ChangeSheet({ cd, v, onClose }) {
  const data = useData();
  const { plan } = cd;
  const [note, setNote] = useState(plan.brief || '');
  const [spots, setSpots] = useState(plan.spots == null ? '' : String(plan.spots));
  const [tee, setTee] = useState(plan.tee_time || '');
  const [extras, setExtras] = useState(() => ({ ...(plan.extras || {}) }));
  const [more, setMore] = useState(() => new Set());
  const [busy, run] = useRun();
  const notAsked = plan.invite_all ? [] : data.players.filter((p) => p.approved !== false && !v.asked.includes(p.id));
  const on = { games: useFeature('games'), dinner_awards: useFeature('dinner_awards'), planner_rooms: useFeature('planner_rooms'), planner_costs: useFeature('planner_costs') };
  const save = () => run(async () => {
    const ch = { note, extras: cleanExtras(extras), spots: spots === '' ? null : Math.round(Number(spots)) };
    if (v.locked) ch.tee_time = tee ? cleanTime(tee) : null;
    if (more.size) ch.invite_add = [...more];
    await must(supabase.rpc('callout_update', { p_plan: plan.id, p_changes: ch }));
    await notify('callout_send', { plan_id: plan.id });
    await cd.reload();
    onClose();
  }, 'Saved');
  return (
    <Sheet title="Change it" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }} data-testid="co-change-sheet">
        <label className="field"><span>Spots (blank = no cap)</span><input className="input" inputMode="numeric" value={spots} onChange={(e) => setSpots(e.target.value.replace(/[^0-9]/g, ''))} data-testid="co-change-spots" /></label>
        {v.locked && <span className="small muted" style={{ marginTop: -8 }}>More spots moves the first reserves in straight away (and tells them).</span>}
        {v.locked && <label className="field"><span>Tee time</span><input className="input" type="time" value={tee} onChange={(e) => setTee(e.target.value)} /></label>}
        <label className="field"><span>Note</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
        {notAsked.length > 0 && (
          <details className="co-more">
            <summary>Ask more people</summary>
            <div className="co-who">
              {notAsked.map((p) => (
                <label key={p.id}><input type="checkbox" checked={more.has(p.id)} onChange={() => { const n = new Set(more); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setMore(n); }} />{playerName(p)}</label>
              ))}
            </div>
          </details>
        )}
        <details className="co-more">
          <summary>➕ Add to this round</summary>
          <div className="stack" style={{ gap: 8 }}>
            {EXTRAS.filter((e) => e.key !== 'course_vote' && (!e.feature || on[e.feature])).map((e) => (e.key === 'after' ? (
              <label key={e.key} className="field"><span>{e.icon} {e.label}</span><input className="input" value={extras.after || ''} onChange={(ev) => setExtras({ ...extras, after: ev.target.value })} maxLength={120} /></label>
            ) : (
              <label key={e.key} className="row" style={{ gap: 10, minHeight: 44 }}>
                <input type="checkbox" checked={!!extras[e.key]} onChange={(ev) => setExtras({ ...extras, [e.key]: ev.target.checked })} style={{ width: 22, height: 22 }} />
                <span className="grow"><strong>{e.icon} {e.label}</strong><div className="small muted">{e.help}</div></span>
              </label>
            )))}
            <span className="small muted">A course vote can only be added when you put it out.</span>
          </div>
        </details>
        <button type="button" className="btn gold block" disabled={busy || (spots !== '' && !(Number(spots) >= 2 && Number(spots) <= 72))} onClick={save} data-testid="co-change-save">Save</button>
      </div>
    </Sheet>
  );
}
