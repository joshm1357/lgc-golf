// "Click for everything" (ov22, Josh 23 Oct): the details sheets for a course and a place to stay, opened from a map
// pin or a list row on the planning screens (Build the trip and its area start). The course sheet is the trip
// builder's (moved here from screens/TripBuilder.jsx so the area start uses the same one), now with all the research
// (the "About this course for groups" block plus every other researched field), the library info, the group's own
// history and ratings, social golf times when someone's put them in, and where it is on a map.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { Sheet, Seg } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { currentGroup } from '../lib/group.js';
import * as TB from '../lib/tripbuilder.js';
import { useCourseResearch, AboutForGroups } from './CourseResearch.jsx';
import { extraResearchLines, mapLink, nearestCourses, stayIdeasSummary } from '../lib/placeinfo.js';
import { contactLinks } from '../lib/courseresearch.js';

const BOOKING_COLS = 'course_id,visitor_times,member_times,booking_method,phone,booking_url,email,max_group,max_tee_times,features,notes,source,updated_at';

/** One course's shared booking info (course_booking_info), when the screen hasn't loaded it already. */
function useBooking(id, given) {
  const [row, setRow] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (given !== undefined || !id) return undefined;
    let live = true;
    supabase.from('course_booking_info').select(BOOKING_COLS).eq('course_id', id).maybeSingle()
      .then(({ data }) => { if (live) setRow(data || null); }, () => {});
    return () => { live = false; };
  }, [id, given, n]);
  return [given !== undefined ? given : row, () => setN((x) => x + 1)];
}

/** This group's social golf times for a course (course_social_times), when the screen hasn't loaded them. */
function useSocial(id, given) {
  const [row, setRow] = useState(null);
  useEffect(() => {
    if (given !== undefined || !id) return undefined;
    let live = true;
    supabase.from('course_social_times').select('*').eq('course_id', id).maybeSingle()
      .then(({ data }) => { if (live) setRow(data || null); }, () => {});
    return () => { live = false; };
  }, [id, given]);
  return given !== undefined ? given : row;
}

const SOCIAL_LABELS = { weekdays: 'Weekdays', weekends: 'Weekends', price: 'Price', group_size: 'Group size', notes: 'Notes', contact: 'Contact', how_to_book: 'How to book' };

// ---------------------------------------------------------------- one course: what we know, booking info, look it up
/**
 * course: the library course ({ id, name, area, lat, lng, holes, mine_avg, others_avg, others_n, facts }).
 * booking / research / social: pass them when the screen has them; left out (undefined), the sheet loads its own.
 * toggle: { label, onClick } | null — the screen's "Add to Saturday" / "Put it on the table" button.
 */
export function CourseSheet({ id, course, booking: givenBooking, research: givenResearch, social: givenSocial, history, org, aiOn, drive, toggle = null, onClose, onSaved }) {
  const { status } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [warning, setWarning] = useState('');
  const [busy, run] = useRun();
  const [ratePlan, setRatePlan] = useState(null);
  const [myRating, setMyRating] = useState(null);
  const [booking, reloadBooking] = useBooking(id, givenBooking);
  const loaded = useCourseResearch(givenResearch === undefined ? [id] : []);
  const research = givenResearch === undefined ? loaded[id] : givenResearch;
  const social = useSocial(id, givenSocial);
  const hist = history || { trips: [], text: '', last: null, count: 0 };
  useEffect(() => {
    const tripId = hist.last?.id;
    if (!tripId) return;
    supabase.from('plans').select('id').eq('trip_id', tripId).maybeSingle().then(({ data }) => setRatePlan(data?.id || null), () => {});
  }, [hist.last?.id]);
  if (!course) return null;
  const facts = course.facts || {};
  const lookUp = () => run(async () => {
    const { data, error } = await supabase.functions.invoke('ai-helper', { body: { mode: 'course_lookup', course_id: id, group_id: currentGroup() || undefined } });
    if (error) throw new Error('Couldn’t reach the AI helper — try again');
    if (data?.error) { setWarning(data.error); setDraft(null); return; }
    setDraft({ ...(booking || {}), ...data.draft, source: 'ai' });
    setWarning(data.warning || '');
    setEditing(true);
  });
  const rate = (n) => run(async () => {
    await must(supabase.from('course_ratings').upsert({ plan_id: ratePlan, course_id: id, player_id: status.player_id, rating: n }, { onConflict: 'plan_id,course_id,player_id' }));
    setMyRating(n);
  }, 'Thanks — saved for the group');
  const b = booking || {};
  const extra = extraResearchLines(research);
  const site = contactLinks(research).website;
  const where = mapLink(course);
  const socialRows = social ? Object.entries(SOCIAL_LABELS).filter(([k]) => social[k]).map(([k, label]) => [label, social[k]]) : [];
  const libRows = [
    ['Holes', course.holes ? String(course.holes) : research?.holes ? String(research.holes) : ''],
    ['Par', research?.par ? String(research.par) : course.par ? String(course.par) : ''],
    ['Where', [course.area || [research?.town, research?.state].filter(Boolean).join(' '), research?.region].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);
  return (
    <Sheet title={course.name} onClose={onClose}>
      <div className="stack" data-testid="tb-course">
        <div className="small muted">{[course.area, drive].filter(Boolean).join(' · ')}</div>
        {toggle && <button type="button" className="btn gold block" onClick={toggle.onClick} data-testid="sheet-toggle">{toggle.label}</button>}
        <div className="card pad stack" style={{ gap: 4 }} data-testid="sheet-ours">
          <strong data-testid="tb-course-known">{TB.shortKnown(course, hist)}</strong>
          {hist.text && <span className="small">{hist.text}</span>}
          {(hist.trips || []).slice(1, 4).map((t) => <span key={t.id || t.name} className="small muted">Also: {t.year} {t.name}{t.trophies?.[0] ? ` · ${t.trophies[0]}` : ''}</span>)}
          {course.mine_avg != null && <span className="small">Your group: ★{Number(course.mine_avg).toFixed(1)}</span>}
          {course.others_avg != null && <span className="small muted">Other groups: ★{Number(course.others_avg).toFixed(1)} ({course.others_n} group{Number(course.others_n) === 1 ? '' : 's'})</span>}
          {ratePlan && (
            <div className="row" style={{ gap: 2 }}>
              <span className="small">Rate it:</span>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="btn ghost sm" aria-label={`${n} out of 5`} onClick={() => rate(n)} style={{ minWidth: 40, color: myRating && n <= myRating ? 'var(--gold)' : '#B9C2CC' }}>★</button>)}
            </div>
          )}
        </div>
        {research && <AboutForGroups r={research} />}
        {extra.length > 0 && (
          <div className="card pad stack" style={{ gap: 6 }} data-testid="sheet-more-research">
            <strong>More about it</strong>
            {extra.map((x) => <div key={x.key} className="small" data-testid="sheet-research-line"><span style={{ fontWeight: 700 }}>{x.label}: </span>{x.value}</div>)}
            {site && <a className="small" href={site} target="_blank" rel="noopener noreferrer">Club website ↗</a>}
          </div>
        )}
        <span className="label">How to book</span>
        <div className="card pad stack" style={{ gap: 4 }} data-testid="tb-booking">
          {[['Visitors', b.visitor_times || facts.visitor_times?.value], ['Members only', b.member_times || facts.member_times?.value],
            ['Book by', b.booking_method], ['Phone', b.phone], ['Email', b.email], ['Largest group', b.max_group || facts.max_group?.value], ['Most tee times', b.max_tee_times], ['Notes', b.notes]]
            .filter(([, v]) => v).map(([k, v]) => <div key={k} className="row between small" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ textAlign: 'right' }}>{String(v)}</span></div>)}
          {b.booking_url && <a className="small" href={b.booking_url} target="_blank" rel="noopener noreferrer">Book online ↗</a>}
          {b.features?.length > 0 && <div className="tb-chips">{b.features.map((f) => <span key={f} className="chip" style={{ minHeight: 28 }}>{f}</span>)}</div>}
          {!b.course_id && !facts.visitor_times && <span className="small muted">{research ? 'Nothing added by a group yet — the research is above.' : 'Nothing yet — shared by every group once someone adds it.'}</span>}
        </div>
        {socialRows.length > 0 && (
          <div className="card pad stack" style={{ gap: 4 }} data-testid="sheet-social">
            <strong>Social golf times (from your group)</strong>
            {socialRows.map(([k, v]) => <div key={k} className="row between small" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ textAlign: 'right' }}>{String(v)}</span></div>)}
          </div>
        )}
        {(libRows.length > 0 || where) && (
          <div className="card pad stack" style={{ gap: 4 }} data-testid="sheet-library">
            <strong>The course</strong>
            {libRows.map(([k, v]) => <div key={k} className="row between small" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span></div>)}
            {where && <a className="small" href={where} target="_blank" rel="noopener noreferrer">See it on a map ↗</a>}
          </div>
        )}
        {warning && <div className="small" style={{ fontWeight: 700, color: '#7A5A00' }} data-testid="tb-ai-warning">{warning}</div>}
        {org && !editing && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost grow" onClick={() => { setDraft({ ...b }); setEditing(true); }}>✏️ Add or correct</button>
            {aiOn && <button type="button" className="btn ghost grow" disabled={busy} onClick={lookUp}>✨ Look it up</button>}
          </div>
        )}
        {org && editing && <BookingForm id={id} start={draft || b} onDone={() => { setEditing(false); setWarning(''); reloadBooking(); onSaved?.(); }} />}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- one place to stay
/**
 * stay: { key, name, lat, lng, custom?, on?, sug? }. courses: the courses on the map ({ id, name, lat, lng, on }).
 * ideas: the area's accommodation ideas (plan_stays rows). toggle: { label, onClick } | null.
 */
export function StaySheet({ stay, courses = [], ideas = [], people = 0, stayMax = TB.DEFAULT_STAY_MAX, toggle = null, onCourse, onClose }) {
  if (!stay) return null;
  const near = nearestCourses(stay, courses, 8);
  const within = near.filter((c) => c.min <= stayMax);
  const s = stayIdeasSummary(ideas, people);
  const where = mapLink(stay);
  return (
    <Sheet title={`🏠 ${stay.name}`} onClose={onClose}>
      <div className="stack" data-testid="stay-sheet">
        <div className="small muted">{[stay.custom ? 'Your pin' : 'Town', stay.sug ? '✨ suggested' : '', stay.on ? 'on the table' : ''].filter(Boolean).join(' · ')}</div>
        {toggle && <button type="button" className="btn gold block" onClick={toggle.onClick} data-testid="sheet-toggle">{toggle.label}</button>}
        <div className="card pad stack" style={{ gap: 4 }} data-testid="stay-courses">
          <strong>⛳ Courses nearby</strong>
          <span className="small muted">{within.length} within {stayMax} min (drive times are about).</span>
          {near.map((c) => (
            <div key={c.id} className="row between small" style={{ gap: 8 }}>
              {onCourse ? <button type="button" className="btn ghost sm" style={{ minHeight: 36, padding: '2px 8px' }} onClick={() => onCourse(c.id)}>{c.name}</button> : <span>{c.name}</span>}
              <span className="muted">{c.on ? 'on the table · ' : ''}about {c.min} min</span>
            </div>
          ))}
          {!near.length && <span className="small muted">No courses on the map near here yet.</span>}
        </div>
        <div className="card pad stack" style={{ gap: 4 }} data-testid="stay-ideas">
          <strong>🏡 Places to stay saved</strong>
          {s.count > 0 && <span className="small">{[s.from != null ? `from $${Math.round(s.from)}${s.each != null ? ` (about $${s.each} each)` : ''}` : '', s.sleeps ? `sleeps up to ${s.sleeps}` : ''].filter(Boolean).join(' · ')}</span>}
          {ideas.map((a) => (
            <div key={a.id || a.name} className="stack small" style={{ gap: 2, padding: '4px 0', borderTop: '1px solid var(--line-soft)' }} data-testid="stay-idea">
              <strong>{a.is_list ? '📋 ' : '🏡 '}{a.name}</strong>
              <span className="muted">{[a.sleeps ? `sleeps ${a.sleeps}` : '', a.total_cost != null ? `$${Math.round(a.total_cost)} all up` : '', a.distance_note || '', a.option_id ? 'on the vote' : ''].filter(Boolean).join(' · ') || 'No details yet'}</span>
              {a.link && <a href={a.link} target="_blank" rel="noreferrer noopener">{a.is_list ? 'View places ↗' : 'Have a look ↗'}</a>}
            </div>
          ))}
          {!ideas.length && <span className="small muted">None saved for this area yet — search for places under “Where to stay”.</span>}
        </div>
        {where && <a className="small" href={where} target="_blank" rel="noopener noreferrer">See it on a map ↗</a>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- shared booking info (any group can add or correct)
export function BookingForm({ id, start, onDone }) {
  const [v, setV] = useState({
    visitor_times: start.visitor_times || '', member_times: start.member_times || '', booking_method: start.booking_method || 'phone',
    phone: start.phone || '', booking_url: start.booking_url || '', email: start.email || '', max_group: start.max_group ?? '', max_tee_times: start.max_tee_times ?? '',
    features: start.features || [], notes: start.notes || '', source: start.source === 'ai' ? 'ai' : 'organiser',
  });
  const [busy, run] = useRun();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const saveIt = () => run(async () => {
    const rowv = {
      visitor_times: v.visitor_times.trim() || null, member_times: v.member_times.trim() || null, booking_method: v.booking_method || null,
      phone: v.phone.trim() || null, booking_url: v.booking_url.trim() || null, email: v.email.trim() || null,
      max_group: v.max_group === '' ? null : Number(v.max_group), max_tee_times: v.max_tee_times === '' ? null : Number(v.max_tee_times),
      features: v.features, notes: v.notes.trim() || null, source: v.source,
    };
    if (rowv.booking_url && !/^https:\/\//i.test(rowv.booking_url)) throw new Error('The booking link needs to start with https://');
    const { data: had } = await supabase.from('course_booking_info').select('course_id').eq('course_id', id).maybeSingle();
    if (had) await must(supabase.from('course_booking_info').update(rowv).eq('course_id', id));
    else await must(supabase.from('course_booking_info').insert({ course_id: id, ...rowv }));
    onDone();
  }, 'Saved for every group');
  return (
    <div className="card pad stack" data-testid="tb-booking-form">
      <label className="field"><span>Visitor / social times</span><input className="input" value={v.visitor_times} onChange={set('visitor_times')} placeholder="e.g. Sat 7:00-12:00; Sun 9:00-13:00" aria-label="Visitor times" /></label>
      <label className="field"><span>Members only</span><input className="input" value={v.member_times} onChange={set('member_times')} placeholder="e.g. Sat 6:30-9:00" aria-label="Member times" /></label>
      <Seg light options={TB.BOOKING_METHODS} value={v.booking_method} onChange={(m) => setV({ ...v, booking_method: m })} />
      <label className="field"><span>Phone</span><input className="input" inputMode="tel" value={v.phone} onChange={set('phone')} aria-label="Phone" /></label>
      <label className="field"><span>Online booking link</span><input className="input" value={v.booking_url} onChange={set('booking_url')} placeholder="https://" aria-label="Booking link" /></label>
      <label className="field"><span>Email</span><input className="input" value={v.email} onChange={set('email')} aria-label="Email" /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Largest group</span><input className="input" type="number" min="1" max="400" value={v.max_group} onChange={set('max_group')} aria-label="Largest group" /></label>
        <label className="field grow"><span>Most tee times</span><input className="input" type="number" min="1" max="100" value={v.max_tee_times} onChange={set('max_tee_times')} aria-label="Most tee times" /></label>
      </div>
      <div className="tb-chips">{TB.FEATURES.map((f) => (
        <button key={f} type="button" className="chip" aria-pressed={v.features.includes(f)} onClick={() => setV({ ...v, features: v.features.includes(f) ? v.features.filter((x) => x !== f) : [...v.features, f] })}>{f}</button>
      ))}</div>
      <label className="field"><span>Notes</span><input className="input" value={v.notes} maxLength={300} onChange={set('notes')} placeholder="e.g. Book 6 weeks ahead for groups" aria-label="Notes" /></label>
      <button type="button" className="btn" disabled={busy} onClick={saveIt}>Save (shared with every group)</button>
    </div>
  );
}
