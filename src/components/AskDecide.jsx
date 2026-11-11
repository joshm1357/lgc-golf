// ov43 — "Anyone keen for a round?" after the asking: the live leader and who can make what (everyone sees it after
// they reply), the organiser's card (Choose, or Put 2–3 to a vote), the course check (visitor times, daylight, booking
// link — unknown visitor times guessed and marked unconfirmed), then after lock-in: the booking job with "Full → next
// best", "It's booked", "Was that easy?" and "Go again in 2 weeks?". Sums in lib/ask.js; database in migration 111.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { Sheet, toast } from './ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { gate } from '../lib/savedgate.js';
import {
  askCells, rankCells, decideReady, voteChoices, nextBest, cellSpots, cellWords, leaderLine, teeFor, groupSize, teeTimes,
  courseCheck, whereSummary, prefill, answerSlots, funnel, funnelReading, againAsk, WHERE_WISHES, ASK_PARTS,
} from '../lib/ask.js';
import { courseWindows } from '../lib/daytiming.js';
import { clock, dayLabel, dowOf, sydneyToday, cleanTime } from '../lib/callout.js';
import { openCallout } from '../lib/calloutopen.js';
import { CourseFinder } from './CalloutSheet.jsx';
import './callout.css';

const names = (ids, byId) => ids.map((id) => byId[id]).filter(Boolean).map(playerName).join(', ');
const windowWords = (c) => (c.part ? `${clock(c.from)}–${clock(c.to)}` : clock(c.from));

/** Answers, probably (usual weeks), events for one ask. */
export function useAsk(plan) {
  const [d, setD] = useState({ answers: [], probably: [], events: [] });
  const id = plan?.id;
  const load = async () => {
    if (!id || !plan.ask) return;
    const [a, p, e] = await Promise.all([
      supabase.from('callout_answers').select('*').eq('plan_id', id),
      supabase.rpc('callout_probably', { p_plan: id }),
      supabase.from('callout_events').select('plan_id,player_id,kind,at').eq('plan_id', id),
    ]);
    setD({ answers: a.data || [], probably: p.data || [], events: e.data || [] });
  };
  useEffect(() => { load(); }, [id, plan?.status, plan?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(['callout_answers', 'callout_events'], load);
  return { ...d, reload: load };
}

/** The live board: the leader and the best few windows. */
export function AskBoard({ plan, asked = [], ad, manage, onChoose, onVote }) {
  const data = useData();
  const byId = data.playersById;
  const today = sydneyToday();
  const cells = useMemo(() => askCells(plan.ask, today), [JSON.stringify(plan.ask), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const probably = useMemo(() => ad.probably.map((p) => ({ player_id: p.player_id, slots: answerSlots(cells, prefill(cells, { pattern: p.pattern }).picks) })), [ad.probably, cells]);
  const ranked = useMemo(() => rankCells(cells, ad.answers, { probably, full: plan.ask_full || [] }), [cells, ad.answers, probably, plan.ask_full]);
  const top = ranked[0];
  const ready = decideReady(ranked, { spots: plan.spots, closesAt: plan.closes_at });
  const shown = ranked.filter((r) => r.can.length || r.probably.length).slice(0, 5);
  const answered = new Set(ad.answers.map((a) => a.player_id));
  const cant = ad.answers.filter((a) => a.cant).map((a) => a.player_id);
  const noReply = asked.filter((id) => !answered.has(id));
  const where = whereSummary(ad.answers);
  return (
    <div className="card pad stack" style={{ gap: 10 }} data-testid="ask-board">
      <div className="row between"><strong>Who can make what</strong><span className="small muted">{groupSize(plan.spots)} make{groupSize(plan.spots) === 1 ? 's' : ''} a group</span></div>
      <div className={`ask-leader${ready.ready ? ' ready' : ''}`} data-testid="ask-leader">
        <span className="label">{ready.why === 'full' ? '✅ That’s a group' : ready.why === 'closed' ? '⏰ Replies closed' : 'Leading'}</span>
        <strong>{leaderLine(top)}</strong>
      </div>
      {shown.map((r, i) => {
        const sp = cellSpots(r, plan.spots);
        return (
          <div key={r.cell.key} className="ask-slot" data-testid="ask-slot">
            <div className="grow" style={{ minWidth: 0 }}>
              <strong>{cellWords(r.cell)}</strong> <span className="small muted">{windowWords(r.cell)} · {r.can.length} can</span>
              <div className="small">{names(sp.in, byId) || '—'}{sp.reserve.length ? <span className="muted"> · reserve: {names(sp.reserve, byId)}</span> : null}</div>
              {r.probably.length > 0 && <div className="small muted">+ probably (usual week, unconfirmed): {names(r.probably, byId)}</div>}
              {r.notes.length > 0 && <div className="small muted">📝 {r.notes.map((n) => `${playerName(byId[n.player_id])}: ${n.note}`).join(' · ')}</div>}
            </div>
            {manage && r.can.length > 0 && <button {...gate('organise')} type="button" className={`btn ${i === 0 ? 'gold' : 'ghost'} sm`} onClick={() => onChoose(r)} data-testid="ask-choose">Choose</button>}
          </div>
        );
      })}
      {!shown.length && <span className="small muted">Nobody’s answered yet.</span>}
      {manage && voteChoices(ranked).length >= 2 && (
        <button {...gate('organise')} type="button" className="btn ghost block" onClick={() => onVote(voteChoices(ranked))} data-testid="ask-vote">🗳️ Put 2–3 to a vote</button>
      )}
      <span className="small muted" data-testid="ask-noreply">
        {noReply.length ? `Not answered: ${names(noReply, byId)}` : 'Everyone asked has answered.'}{cant.length ? ` · Can’t this round: ${names(cant, byId)}` : ''}
      </span>
      {(where.courses.length > 0 || Object.keys(where.wishes).length > 0) && (
        <span className="small muted">📍 Asked for: {[...where.courses.map((c) => `${c.name} (${c.n})`), ...Object.entries(where.wishes).map(([kk, n]) => `${WHERE_WISHES.find((w) => w.key === kk)?.label.toLowerCase()} (${n})`)].join(' · ')}</span>
      )}
      {manage && <GuestContacts plan={plan} />}
      {manage && top && top.can.length > 0 && <CourseChecks plan={plan} r={top} answers={ad.answers} />}
      {manage && <FunnelLine events={ad.events} asked={asked.length} />}
    </div>
  );
}

/** The app's check per course for the leading window: visitor times, daylight, booking link. */
function CourseChecks({ plan, r, answers }) {
  const data = useData();
  const list = useMemo(() => {
    const out = [];
    const add = (libId, name) => { if (libId && !out.some((x) => x.libId === libId)) out.push({ libId, name }); };
    if (plan.course_id) add(data.coursesById[plan.course_id]?.library_id, plan.location_name);
    if (plan.library_course_id) add(plan.library_course_id, plan.location_name);
    for (const c of whereSummary(answers).courses) add(c.kind === 'library' ? c.id : data.coursesById[c.id]?.library_id, c.name);
    if (!out.length) for (const c of data.courses.filter((x) => x.library_id).slice(0, 3)) add(c.library_id, c.name);
    return out.slice(0, 4);
  }, [plan, answers, data.courses, data.coursesById]);
  const [info, setInfo] = useState({});
  useEffect(() => {
    const ids = list.map((x) => x.libId);
    if (!ids.length) return;
    Promise.all([
      supabase.from('course_booking_info').select('course_id,visitor_times,booking_url,phone').in('course_id', ids),
      supabase.from('course_research').select('library_id,details,booking_url,phone').in('library_id', ids),
    ]).then(([b, rs]) => {
      const m = {};
      for (const id of ids) m[id] = { booking: (b.data || []).find((x) => x.course_id === id) || null, research: (rs.data || []).find((x) => x.library_id === id) || null };
      setInfo(m);
    }, () => {});
  }, [list.map((x) => x.libId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  const nine = r.nine.length > 0 && r.nine.length === r.can.length;
  return (
    <details className="co-more" data-testid="ask-course-check" open>
      <summary>🔎 The courses for {cellWords(r.cell)}</summary>
      <div className="stack" style={{ gap: 6 }}>
        {list.map((c) => {
          const i = info[c.libId] || {};
          const w = courseWindows(dowOf(r.cell.date), { booking: i.booking, research: i.research });
          const link = i.booking?.booking_url || i.research?.booking_url || (i.booking?.phone || i.research?.phone ? `tel:${i.booking?.phone || i.research?.phone}` : null);
          const chk = courseCheck({ cell: r.cell, windows: w, booking: link, nine });
          return (
            <div key={c.libId} className="small" data-testid="ask-course-row">
              <strong>{c.name}</strong>: <span className={chk.visitors === 'no' ? 'err' : ''}>{chk.words}</span>
              {link && <> · <a href={link} target="_blank" rel="noreferrer">{link.startsWith('tel:') ? 'call' : 'book'} ↗</a></>}
            </div>
          );
        })}
        <span className="small muted">Unconfirmed = a guess from what’s usual for clubs that day.</span>
      </div>
    </details>
  );
}

/** People who answered from the link (no sign-in): how to reach them (whoever runs it, and the booker). */
export function GuestContacts({ plan }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { supabase.rpc('ask_contacts', { p_plan: plan.id }).then(({ data }) => setRows(data || []), () => {}); }, [plan.id, plan.status]);
  if (!rows.length) return null;
  return (
    <details className="co-more" data-testid="ask-contacts">
      <summary>📇 Answered from the link ({rows.length})</summary>
      <div className="stack" style={{ gap: 4 }}>
        {rows.map((r) => (
          <span key={r.player_id} className="small">
            <strong>{r.name}</strong>{r.signed_in ? ' · signed in' : ''}
            {r.email && <> · <a href={`mailto:${r.email}`}>{r.email}</a></>}
            {r.phone && <> · <a href={`tel:${r.phone.replace(/\s+/g, '')}`}>{r.phone}</a></>}
          </span>
        ))}
      </div>
    </details>
  );
}

/** The test plan's funnel, on the organiser's view. */
function FunnelLine({ events, asked }) {
  const f = funnel(events, { asked });
  if (!f.steps[0].n) return null;
  return (
    <span className="small muted" data-testid="ask-funnel">
      📊 {f.steps.map((s) => `${s.step} ${s.n}`).join(' → ')}{f.hoursToLock != null ? ` · ${f.hoursToLock.toFixed(1)} h to lock` : ''} · {funnelReading(f)}
    </span>
  );
}

/** Choose a window and lock it in (migration 111's callout_ask_choose → 103's callout_lock). */
export function ChooseSheet({ plan, r, onClose, onDone }) {
  const data = useData();
  const { status } = useSession();
  const byId = data.playersById;
  const [tee, setTee] = useState(r.cell.from);
  const needCourse = !plan.course_id && !plan.library_course_id;
  const [course, setCourse] = useState(null);
  const [finding, setFinding] = useState(false);
  const [booker, setBooker] = useState(status.player_id || '');
  const [format, setFormat] = useState('stableford');
  const [busy, run] = useRun();
  const t = cleanTime(tee);
  const teeOk = !!t && t >= r.cell.from && t <= r.cell.to;
  const sp = cellSpots(r, plan.spots);
  const go = () => run(async () => {
    const res = await must(supabase.rpc('callout_ask_choose', {
      p_plan: plan.id, p_date: r.cell.date, p_from: r.cell.from, p_to: r.cell.to, p_part: r.cell.part, p_tee_time: teeFor(r.cell, tee),
      p_course: needCourse && course?.kind === 'group' ? course.id : null, p_library: needCourse && course?.kind === 'library' ? course.id : null,
      p_booker: booker || null, p_format: format,
    }));
    await notify('callout_send', { plan_id: plan.id });
    await data.reload?.();
    onDone?.(res);
  });
  return (
    <Sheet title={`🔒 ${cellWords(r.cell)}`} onClose={onClose}>
      <div className="stack" style={{ gap: 12 }} data-testid="ask-choose-sheet">
        <label className="field"><span>Tee time ({windowWords(r.cell)})</span>
          <input className="input" type="time" value={tee} min={r.cell.from} max={r.cell.to} onChange={(e) => setTee(e.target.value)} data-testid="ask-choose-tee" /></label>
        {!teeOk && <span className="small err">Pick a time from {clock(r.cell.from)} to {clock(r.cell.to)}.</span>}
        {needCourse && (
          <div className="co-step">
            <span className="label">Course</span>
            <div className="co-chips">
              {data.courses.slice(0, 8).map((c) => <button key={c.id} type="button" className="chip" aria-pressed={course?.kind === 'group' && course.id === c.id} onClick={() => setCourse({ kind: 'group', id: c.id, name: c.name })}>{c.name}</button>)}
              {course?.kind === 'library' && <button type="button" className="chip" aria-pressed="true">{course.name}</button>}
              <button type="button" className="chip" aria-pressed={finding} onClick={() => setFinding(!finding)}>🔎 Another</button>
            </div>
            {finding && <CourseFinder onPick={(c) => { setCourse(c); setFinding(false); }} />}
          </div>
        )}
        <label className="field"><span>Who’s booking? (anyone can take it)</span>
          <select className="select" value={booker} onChange={(e) => setBooker(e.target.value)} data-testid="ask-booker">
            <option value="">Nobody — it’s booked</option>
            {data.players.filter((p) => p.approved !== false).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
          </select>
        </label>
        <div className="seg light" role="group" aria-label="Format">
          <button type="button" aria-pressed={format === 'stableford'} onClick={() => setFormat('stableford')}>Stableford</button>
          <button type="button" aria-pressed={format === 'ambrose'} onClick={() => setFormat('ambrose')}>Ambrose</button>
        </div>
        <div className="card pad stack" style={{ gap: 4, background: 'var(--ground)' }} data-testid="ask-choose-preview">
          <span className="small"><strong>In ({sp.in.length}{plan.spots ? ` of ${plan.spots}` : ''}):</strong> {names(sp.in, byId) || 'nobody yet'}</span>
          {sp.reserve.length > 0 && <span className="small"><strong>Reserves:</strong> {sp.reserve.map((id, i) => `#${i + 1} ${playerName(byId[id])}`).join(', ')}</span>}
          <span className="small muted">Everyone who ticked it, in the order they answered. {teeTimes(sp.in.length)} tee time{teeTimes(sp.in.length) === 1 ? '' : 's'} to book.</span>
        </div>
        <button {...gate('organise')} type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || !teeOk || (needCourse && !course)} onClick={go} data-testid="ask-choose-go">
          🔒 Lock it in — {dayLabel(r.cell.date)} {clock(teeFor(r.cell, tee))}
        </button>
      </div>
    </Sheet>
  );
}

/** Put 2–3 to a vote (103's vote from here on, pre-ticked). */
export function VoteSheet({ plan, choices, onClose, onDone }) {
  const [on, setOn] = useState(() => new Set(choices.map((r) => r.cell.key)));
  const [busy, run] = useRun();
  const picked = choices.filter((r) => on.has(r.cell.key));
  const go = () => run(async () => {
    await must(supabase.rpc('callout_ask_vote', { p_plan: plan.id, p_cells: picked.map((r) => ({ date: r.cell.date, from: r.cell.from, to: r.cell.to, part: r.cell.part })) }));
    await notify('callout_send', { plan_id: plan.id });
    onDone?.();
  }, 'Vote sent');
  return (
    <Sheet title="🗳️ Put it to a vote" onClose={onClose}>
      <div className="stack" style={{ gap: 10 }} data-testid="ask-vote-sheet">
        {choices.map((r) => (
          <label key={r.cell.key} className="co-opt" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={on.has(r.cell.key)} onChange={() => { const n = new Set(on); if (n.has(r.cell.key)) n.delete(r.cell.key); else n.add(r.cell.key); setOn(n); }} style={{ width: 20, height: 20 }} />
            <strong>{cellWords(r.cell)}</strong><span className="small muted" style={{ paddingRight: 8 }}>{r.can.length} can</span>
          </label>
        ))}
        <span className="small muted">Everyone who said they can is already ticked. Replies close in 24 hours.</span>
        <button type="button" className="btn gold block" disabled={busy || picked.length < 2} onClick={go} data-testid="ask-vote-go">Send the vote ({picked.length})</button>
      </div>
    </Sheet>
  );
}

/** After lock-in: the booking job, Full → next best, It's booked. */
export function BookingCard({ plan, ad, manage, inCount }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const byId = data.playersById;
  const canAct = manage || (me && me === plan.booker_id);
  const [busy, run] = useRun();
  const [info, setInfo] = useState(null);
  const libId = plan.library_course_id || data.coursesById[plan.course_id]?.library_id || null;
  useEffect(() => {
    if (!libId) return;
    Promise.all([
      supabase.from('course_booking_info').select('booking_url,phone').eq('course_id', libId).maybeSingle(),
      supabase.from('course_research').select('booking_url,phone').eq('library_id', libId).maybeSingle(),
    ]).then(([b, rs]) => setInfo({ url: b.data?.booking_url || rs.data?.booking_url || null, phone: b.data?.phone || rs.data?.phone || null }), () => {});
  }, [libId]);
  const today = sydneyToday();
  const cells = useMemo(() => askCells(plan.ask, today), [JSON.stringify(plan.ask), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = plan.ask?.chosen;
  const chosenKey = chosen ? `${chosen.date}|${chosen.part || `@${chosen.from}`}` : null;
  const next = useMemo(() => nextBest(rankCells(cells, ad.answers, { full: [...(plan.ask_full || []), chosenKey].filter(Boolean) })), [cells, ad.answers, plan.ask_full, chosenKey]);
  const full = () => run(async () => {
    if (!next) { toast('No other time works for enough people — call it off or ask again'); return; }
    await must(supabase.rpc('callout_move', { p_plan: plan.id, p_date: next.cell.date, p_from: next.cell.from, p_to: next.cell.to, p_part: next.cell.part }));
    await notify('callout_send', { plan_id: plan.id });
    await data.reload?.();
  }, 'Moved — everyone’s been told');
  const booked = () => run(async () => {
    await must(supabase.rpc('callout_booked', { p_plan: plan.id }));
    await notify('callout_send', { plan_id: plan.id });
    await data.reload?.();
  }, 'Booked — the players have been told');
  const n = Math.max(inCount, 1);
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="ask-booking">
      <div className="row between"><strong>📞 Booking</strong>{plan.booked_at ? <span className="co-pill in">Booked ✓</span> : <span className="co-pill reserve">To book</span>}</div>
      <span className="small">{plan.location_name || 'Course TBC'} · {dayLabel(String(plan.start_date).slice(0, 10))} {clock(plan.tee_time)} · {teeTimes(n)} tee time{teeTimes(n) === 1 ? '' : 's'} for {n}{plan.booker_id ? ` · ${playerName(byId[plan.booker_id])} is booking` : ' · anyone can take it'}</span>
      {(info?.url || info?.phone) && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {info.url && <a className="btn ghost sm" href={info.url} target="_blank" rel="noreferrer" data-testid="ask-book-link">Book online ↗</a>}
          {info.phone && <a className="btn ghost sm" href={`tel:${info.phone}`}>Call {info.phone}</a>}
        </div>
      )}
      {!plan.booked_at && canAct && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold grow" disabled={busy} onClick={booked} data-testid="ask-booked">✅ It’s booked</button>
          <button type="button" className="btn ghost grow" disabled={busy} onClick={full} data-testid="ask-full">Full → {next ? cellWords(next.cell) : 'no other time'}</button>
        </div>
      )}
      {!plan.booked_at && !canAct && !plan.booker_id && me && (
        <button type="button" className="btn ghost block" disabled={busy} onClick={() => run(async () => { await must(supabase.rpc('callout_take_booking', { p_plan: plan.id })); await data.reload?.(); }, 'It’s yours to book')}>I’ll book it</button>
      )}
      {canAct && <GuestContacts plan={plan} />}
      {next && !plan.booked_at && canAct && <span className="small muted">“Full” moves it to {cellWords(next.cell)} ({next.can.length} can) and tells everyone where they stand.</span>}
    </div>
  );
}

/** "Was that easy to organise?" 👍 / 👎 and a line — once, after lock-in. Goes to Caddie. */
export function EasyAsk({ plan, ad }) {
  const { status } = useSession();
  const [note, setNote] = useState('');
  const [pick, setPick] = useState(null);
  const [busy, run] = useRun();
  const done = ad.events.some((e) => e.player_id === status.player_id && (e.kind === 'easy_yes' || e.kind === 'easy_no'));
  if (done) return null;
  const send = (easy) => run(async () => { await must(supabase.rpc('callout_easy', { p_plan: plan.id, p_easy: easy, p_note: note.trim() || null })); await ad.reload(); }, 'Thanks — that helps');
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="ask-easy">
      <strong>Was that easy to organise?</strong>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn ghost grow" aria-pressed={pick === true} onClick={() => setPick(true)} data-testid="ask-easy-yes">👍</button>
        <button type="button" className="btn ghost grow" aria-pressed={pick === false} onClick={() => setPick(false)} data-testid="ask-easy-no">👎</button>
      </div>
      {pick !== null && (
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={pick ? 'What worked? (optional)' : 'What got in the way? (optional)'} />
          <button type="button" className="btn gold" disabled={busy} onClick={() => send(pick)} data-testid="ask-easy-send">Send</button>
        </div>
      )}
    </div>
  );
}

/** "Go again in 2 weeks?" — the same ask, one tap (opens the sheet filled in). */
export function GoAgain({ plan, invites = [] }) {
  const useFeat = useFeature('planner');
  if (useFeat === false) return null;
  return (
    <button type="button" className="btn gold block" style={{ minHeight: 56 }} data-testid="ask-again"
      onClick={() => openCallout({ ask: againAsk(plan.ask), spots: plan.spots, invite: plan.invite_all ? null : invites.map((i) => i.player_id),
        course: plan.course_id ? { kind: 'group', id: plan.course_id, name: plan.location_name } : null, again: true })}>
      ⛳ Go again in 2 weeks?
    </button>
  );
}

export const askPartLabel = (p) => ASK_PARTS[p]?.label || '';
