import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { useRun, must } from '../lib/run.js';
import { defaultComps, sourceFrom, rememberSource, rememberedSource } from '../lib/quick.js';
import { readHandicap } from '../lib/history.js';
import { parTotal } from '../lib/scoring.js';
import { paintLook, DEFAULT_LOOK } from '../lib/theme.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { Toaster, toast } from '../components/ui.jsx';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';

// Stage 7b: the public course page (#/c/<course>) — works without signing in — and the quick round.
// Scan or tap → "Start a round with your mates" → your name, the format, the side comps → playing in under 2 minutes.

const CourseMap = lazyScreen(() => import('../components/CourseMap.jsx'), 'default', { inline: true });
const QUICK_KEY = 'lgc-quick'; // the round this phone just started: { gid, round, invite }

async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }
}

export default function CoursePage() {
  const { slug } = useParams();
  const loc = useLocation();
  const { status } = useSession() || {};
  // Where they came from (a club's code, another group's card) — remembered for the group they start.
  useEffect(() => { rememberSource(sourceFrom(loc.search)); }, [loc.search]);
  useEffect(() => { if (!status?.is_member) paintLook(DEFAULT_LOOK, 'The Golf Trip'); }, [status?.is_member]);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)' }}>
      {slug ? <Course slug={slug} /> : <FindACourse />}
      <Toaster />
    </div>
  );
}

function Top({ title, sub }) {
  return (
    <div style={{ background: 'var(--navy)', color: '#fff', padding: '22px 16px 18px' }}>
      <div className="row" style={{ gap: 12 }}>
        <GolfTripCrest size={52} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
          {sub && <div style={{ color: 'var(--on-navy-muted)' }}>{sub}</div>}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- No course in the link: find one

function FindACourse() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        await ensureSignedIn();
        let { data, error } = await supabase.rpc('find_courses', { p_query: q, p_lat: null, p_lng: null, p_limit: 20 });
        if (error && /PGRST202|Could not find the function/i.test(`${error.code} ${error.message}`)) ({ data, error } = await supabase.rpc('search_courses', { p_query: q, p_lat: null, p_lng: null, p_limit: 20 }));
        if (error) throw error;
        setErr('');
        setRows(data || []);
      } catch (e) { setErr(friendlyError(e)); setRows([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <Top title="Play a round" sub="Pick your course — live scores for your group, no app store." />
      <div className="stack" style={{ maxWidth: 520, margin: '0 auto', padding: 16, gap: 10 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by course or town" aria-label="Search courses" autoFocus />
        {err && <div className="err" style={{ margin: 0 }}>{err}</div>}
        {rows?.map((r) => (
          <a key={r.id} href={`#/c/${r.slug}`} className="card pad stack" style={{ gap: 2, textDecoration: 'none', color: 'inherit' }}>
            <strong>{r.name}</strong>
            <span className="small muted">{[r.area, `${r.holes} holes`, r.partner ? 'Partner course' : null].filter(Boolean).join(' · ')}</span>
          </a>
        ))}
        {rows && !rows.length && !err && <span className="small muted">No courses by that name yet. Groups add them as they play — or <a href="#/start">start a group</a> and add yours.</span>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- The course and "Start a round"

function Course({ slug }) {
  const [course, setCourse] = useState(undefined);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    supabase.rpc('course_page', { p_slug: slug }).then(({ data, error }) => setCourse(error ? null : data || null));
  }, [slug]);
  if (course === undefined) return <><Top title="…" /><div className="muted" style={{ padding: 16 }}>Loading the course…</div></>;
  if (!course) {
    return (
      <>
        <Top title="Course not found" />
        <div className="stack" style={{ padding: 16 }}>
          <span>That course isn’t in the library (or the link is wrong).</span>
          <a href="#/c" className="btn block">Find your course</a>
        </div>
      </>
    );
  }
  const greens = course.holes.filter((h) => h.green);
  return (
    <>
      <Top title={course.name} sub={[course.area, `${course.holes.length} holes · par ${parTotal(course.holes)}`].filter(Boolean).join(' · ')} />
      <div className="stack" style={{ maxWidth: 520, margin: '0 auto', padding: 16, gap: 12 }}>
        {!starting ? (
          <>
            <button type="button" className="btn gold block" style={{ minHeight: 64, fontSize: 20 }} onClick={() => setStarting(true)}>⛳ Start a round with your mates</button>
            <span className="small muted" style={{ textAlign: 'center' }}>Live scores and a leaderboard on everyone’s phone. No app store, no sign-up — your mates just tap a link.</span>
            {greens.length > 0 && (
              <LazyArea fallback={null} quiet>
                <CourseMap className="map" markers={greens.map((h) => ({ id: `g${h.n}`, lat: h.green.lat, lng: h.green.lng, popup: `Hole ${h.n} · par ${h.par}` }))} osm={course.holes.some((h) => h.osm)} animate={false} />
              </LazyArea>
            )}
            {course.club && <PartnerCard club={course.club} />}
            <Scorecard holes={course.holes} />
            {course.verified && <span className="small muted">✓ Hole data checked by the club.</span>}
            {course.osm && <span className="small muted">Some greens © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors.</span>}
            <a href="#/start" className="small" style={{ fontWeight: 700, textAlign: 'center' }}>Run a golf group? Start your own →</a>
            {!course.club && <a href="#/club" className="small muted" style={{ textAlign: 'center' }}>Work at this club? Claim this page</a>}
          </>
        ) : <QuickStart course={course} onCancel={() => setStarting(false)} />}
      </div>
    </>
  );
}

/** A partner course: the club's logo, offers for groups and who to ask about a group booking. Clearly labelled. */
function PartnerCard({ club }) {
  return (
    <div className="card pad stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 10 }}>
        {club.logo_url && <img src={club.logo_url} alt={`${club.name} logo`} width={48} height={48} style={{ borderRadius: 8, objectFit: 'contain', background: '#fff', flex: 'none' }} />}
        <span><strong>{club.name}</strong><div className="small muted">Partner course</div></span>
      </div>
      {club.offers && <span className="small">🎁 {club.offers}</span>}
      {club.booking_note && <span className="small">{club.booking_note}</span>}
      {(club.booking_email || club.booking_phone) && (
        <span className="small">Group bookings: {club.booking_email && <a href={`mailto:${club.booking_email}`}>{club.booking_email}</a>}{club.booking_email && club.booking_phone ? ' · ' : ''}{club.booking_phone && <a href={`tel:${club.booking_phone.replace(/\s/g, '')}`}>{club.booking_phone}</a>}</span>
      )}
    </div>
  );
}

function Scorecard({ holes }) {
  return (
    <div className="card pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(9, minmax(0, 1fr))', gap: 4, textAlign: 'center' }}>
      {holes.map((h) => (
        <div key={h.n} className="small" style={{ background: 'var(--ground, #F4F5F7)', borderRadius: 6, padding: '4px 0' }}>
          <div className="muted" style={{ fontSize: 11 }}>{h.n}</div><strong>{h.par}</strong>
        </div>
      ))}
    </div>
  );
}

function QuickStart({ course, onCancel }) {
  const { refresh } = useSession() || {};
  const loc = useLocation();
  const [busy, run] = useRun();
  const comps = useMemo(() => defaultComps(course.holes), [course.holes]);
  const [name, setName] = useState('');
  const [hcp, setHcp] = useState('');
  const [format, setFormat] = useState('stableford');
  const [ctp, setCtp] = useState(comps.ctp);
  const [ld, setLd] = useState(comps.ld);
  const h = hcp.trim() === '' ? 18 : readHandicap(hcp);
  const ok = name.trim().length >= 1 && h != null;
  const toggle = (list, set, n) => set(list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));
  const start = () => run(async () => {
    await ensureSignedIn();
    const r = await must(supabase.rpc('start_quick_round', {
      p_slug: course.slug, p_my_name: name.trim(), p_handicap: h, p_format: format, p_ctp: ctp, p_ld: ld,
      p_source: sourceFrom(loc.search) || rememberedSource() || {},
    }));
    try { localStorage.setItem(QUICK_KEY, JSON.stringify({ gid: r.group_id, round: r.round_id, invite: r.invite })); } catch { /* fine */ }
    setCurrentGroup(r.group_id);
    await refresh?.();
    window.location.hash = '#/round-ready';
  });
  return (
    <>
      <div className="card pad stack" style={{ gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8 }}>
          <label className="field"><span>Your name</span><input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="e.g. Josh" autoFocus /></label>
          <label className="field"><span>Handicap</span><input className="input" inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="18" /></label>
        </div>
        {hcp.trim() !== '' && h == null && <span className="small err" style={{ margin: 0 }}>A handicap is a number from −10 to 54 (write a plus handicap as +2).</span>}
        <span className="small muted" style={{ marginTop: -4 }}>No handicap? Leave it at 18 — you can change it later.</span>
        <div className="seg light" role="group" aria-label="Format">
          {[['stableford', 'Stableford'], ['ambrose', 'Ambrose']].map(([k, l]) => <button key={k} type="button" aria-pressed={format === k} onClick={() => setFormat(k)}>{l}</button>)}
          <button type="button" disabled title="Coming soon" style={{ opacity: 0.45 }}>Stroke play (soon)</button>
        </div>
        {format === 'ambrose' && <span className="small muted">Ambrose: once your mates are in, put them in teams from Admin (or use the draw).</span>}
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">🎯 Closest to the pin</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {course.holes.filter((x) => Number(x.par) === 3).map((x) => <button key={x.n} type="button" className="chip" aria-pressed={ctp.includes(x.n)} onClick={() => toggle(ctp, setCtp, x.n)}>Hole {x.n}</button>)}
          </div>
          <span className="label">💣 Longest drive</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {course.holes.filter((x) => Number(x.par) >= 5).map((x) => <button key={x.n} type="button" className="chip" aria-pressed={ld.includes(x.n)} onClick={() => toggle(ld, setLd, x.n)}>Hole {x.n}</button>)}
          </div>
        </div>
      </div>
      <button type="button" className="btn gold block" style={{ minHeight: 60, fontSize: 19 }} disabled={busy || !ok} onClick={start}>{busy ? 'Setting up…' : 'Start the round'}</button>
      <button type="button" className="btn ghost block" disabled={busy} onClick={onCancel}>Back</button>
    </>
  );
}
