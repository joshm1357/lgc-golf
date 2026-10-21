import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SIGN_IN, linkProvider, linkEmail } from '../lib/auth.js';
import { useRun, must } from '../lib/run.js';
import { uploadPhoto } from '../lib/images.js';
import { parTotal } from '../lib/scoring.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { Toaster, toast, Sheet } from '../components/ui.jsx';
import { QrCard } from '../components/QrCard.jsx';
import JoshPage from './Josh.jsx';

// Stage 8b: club partners. A club claims its course's page (Josh approves each claim by hand), then keeps its hole
// data, logo, group-booking contact and offers up to date. A club never sees players' names, scores or locations.
// Route #/club (works whether or not you're in a group). Josh's approval screen is #/club/claims.

async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }
}

function Top({ title, sub }) {
  return (
    <div style={{ background: 'var(--navy)', color: '#fff', padding: '22px 16px 18px' }}>
      <div className="row" style={{ gap: 12 }}>
        <GolfTripCrest size={48} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
          {sub && <div style={{ color: 'var(--on-navy-muted)' }}>{sub}</div>}
        </span>
      </div>
    </div>
  );
}

export default function Club() {
  const [me, setMe] = useState(undefined);
  const load = useCallback(async () => {
    try {
      await ensureSignedIn();
      const { data, error } = await supabase.rpc('my_club');
      if (error) throw error;
      setMe(data || null);
    } catch (e) { toast(e.message); setMe(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const claimsPage = typeof window !== 'undefined' && window.location.hash.startsWith('#/club/claims');
  const kitPage = typeof window !== 'undefined' && window.location.hash.startsWith('#/club/kit');
  const joshPage = typeof window !== 'undefined' && window.location.hash.startsWith('#/club/josh');
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)' }}>
      {me === undefined ? <><Top title="Clubs" /><div className="muted" style={{ padding: 16 }}>Loading…</div></>
        : claimsPage && me?.platform_admin ? <Claims />
        : joshPage && me?.platform_admin ? <JoshPage Top={Top} />
        : kitPage && me?.club ? <Kit club={me.club} />
        : me?.club ? <ClubHome club={me.club} reload={load} admin={me.platform_admin} />
        : <ClaimStart me={me} reload={load} />}
      <Toaster />
    </div>
  );
}

// ---------------------------------------------------------------- Not a club yet: sign in, then claim

function ClaimStart({ me, reload }) {
  const [course, setCourse] = useState(null);
  return (
    <>
      <Top title="Is this your course?" sub="Free for golf clubs: your course page, verified hole data and group bookings." />
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto', padding: 16, gap: 12 }}>
        <div className="card pad stack" style={{ gap: 6 }}>
          <strong>What a club gets</strong>
          <span className="small">• Your course page shows your logo, hole data you’ve checked, a group-booking contact and any offers for visiting groups.</span>
          <span className="small">• Counts of how many groups play your course through the app — never anyone’s names, scores or whereabouts.</span>
          <span className="small">• A QR kit for carts, par 3s and the counter, and a clubhouse TV leaderboard that shows only groups who say yes.</span>
        </div>
        {me?.platform_admin && <a href="#/club/claims" className="btn ghost block">Josh: claims to approve →</a>}
        {me?.platform_admin && <a href="#/club/josh" className="btn ghost block">Josh: numbers, app problems and stay cards →</a>}
        {!me?.signed_in ? <SignInFirst /> : (
          <>
            {(me?.claims || []).length > 0 && (
              <div className="card pad stack" style={{ gap: 4 }}>
                <strong>Your requests</strong>
                {me.claims.map((k) => <span key={k.id} className="small">{k.course} — {k.status === 'pending' ? 'waiting for Josh' : k.status === 'approved' ? 'approved' : 'not approved'}</span>)}
              </div>
            )}
            {course ? <ClaimForm course={course} onDone={() => { setCourse(null); reload(); }} onCancel={() => setCourse(null)} /> : <PickCourse onPick={setCourse} />}
          </>
        )}
      </div>
    </>
  );
}

function SignInFirst() {
  const [busy, run] = useRun();
  const [email, setEmail] = useState('');
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }}>
      <strong>First, sign in</strong>
      <span className="small">A club account needs a proper sign-in, so it stays yours on any device.</span>
      {SIGN_IN.length === 0 && <span className="small muted">Signing in with Google or email isn’t switched on yet — check back soon.</span>}
      {SIGN_IN.includes('google') && <button type="button" className="btn block" disabled={busy} onClick={() => run(() => linkProvider('google', '#/club'))}>Sign in with Google</button>}
      {SIGN_IN.includes('email') && (
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); run(() => linkEmail(email, '#/club'), 'Check your email to confirm'); }}>
          <input className="input grow" style={{ minWidth: 0 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Club email" />
          <button className="btn" disabled={busy || !email.includes('@')}>Email me</button>
        </form>
      )}
    </div>
  );
}

function PickCourse({ onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('find_courses', { p_query: q, p_lat: null, p_lng: null, p_limit: 20 });
      setRows(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <strong>Find your course</strong>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Course or town" aria-label="Search courses" />
      {rows?.map((r) => (
        <button key={r.id} type="button" className="card pad row between" style={{ gap: 8, textAlign: 'left', font: 'inherit', color: 'inherit' }} disabled={r.partner} onClick={() => onPick(r)}>
          <span style={{ minWidth: 0 }}><strong>{r.name}</strong><div className="small muted">{r.area || ''}</div></span>
          <span className="small" style={{ flex: 'none', fontWeight: 700 }}>{r.partner ? 'Already claimed' : 'This is us →'}</span>
        </button>
      ))}
      {rows && !rows.length && <span className="small muted">Not listed yet? Email Josh and we’ll add it.</span>}
      {rows?.some((r) => r.osm) && <span className="small muted">Some course details © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors.</span>}
    </div>
  );
}

function ClaimForm({ course, onDone, onCancel }) {
  const [busy, run] = useRun();
  const [f, setF] = useState({ club: course.name, name: '', email: '', phone: '', role: '', note: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.club.trim().length >= 2 && f.name.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const send = () => run(async () => {
    await must(supabase.rpc('request_club_claim', { p_course_id: course.id, p_club_name: f.club.trim(), p_contact_name: f.name.trim(), p_contact_email: f.email.trim(),
      p_contact_phone: f.phone.trim() || null, p_position: f.role.trim() || null, p_note: f.note.trim() || null }));
    onDone();
  }, 'Sent — Josh checks each one by hand and will be in touch');
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <strong>Claim {course.name}</strong>
      <span className="small muted">Josh checks every claim by hand — usually by calling the club — before it’s switched on.</span>
      <label className="field"><span>Club name</span><input className="input" value={f.club} maxLength={80} onChange={set('club')} /></label>
      <label className="field"><span>Your name</span><input className="input" value={f.name} maxLength={80} onChange={set('name')} /></label>
      <label className="field"><span>Your role at the club</span><input className="input" value={f.role} maxLength={80} onChange={set('role')} placeholder="e.g. General manager" /></label>
      <label className="field"><span>Club email</span><input className="input" type="email" value={f.email} maxLength={120} onChange={set('email')} placeholder="e.g. gm@yourclub.com.au" /></label>
      <label className="field"><span>Club phone</span><input className="input" inputMode="tel" value={f.phone} maxLength={30} onChange={set('phone')} /></label>
      <label className="field"><span>Anything else (optional)</span><textarea className="input" rows={3} value={f.note} maxLength={600} onChange={set('note')} style={{ fontFamily: 'inherit' }} /></label>
      <button type="button" className="btn gold block" disabled={busy || !ok} onClick={send}>Send the claim</button>
      <button type="button" className="btn ghost block" disabled={busy} onClick={onCancel}>Back</button>
    </div>
  );
}

// ---------------------------------------------------------------- A club: its page details and its courses

function ClubHome({ club, reload, admin }) {
  const [busy, run] = useRun();
  const [f, setF] = useState({ name: club.name, logo_url: club.logo_url || null, email: club.booking_email || '', phone: club.booking_phone || '', note: club.booking_note || '', offers: club.offers || '' });
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickLogo = (file) => file && run(async () => {
    const url = await uploadPhoto(file, `clubs/${club.id}`, { maxDim: 512, png: true, strict: true, rawFolder: true });
    setF((x) => ({ ...x, logo_url: url }));
  }, 'Logo ready — save to use it');
  const save = () => run(async () => {
    await must(supabase.rpc('club_update_profile', { p_name: f.name.trim(), p_logo_url: f.logo_url, p_booking_email: f.email.trim() || null,
      p_booking_phone: f.phone.trim() || null, p_booking_note: f.note.trim() || null, p_offers: f.offers.trim() || null }));
    await reload();
  }, 'Saved — your course page shows it now');
  return (
    <>
      <Top title={club.name} sub="Partner club" />
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto', padding: 16, gap: 12 }}>
        {admin && <a href="#/club/claims" className="btn ghost block">Josh: claims to approve →</a>}
        {admin && <a href="#/club/josh" className="btn ghost block">Josh: numbers, app problems and stay cards →</a>}
        <div className="card pad stack" style={{ gap: 8 }}>
          <strong>Your course page</strong>
          <div className="row" style={{ gap: 10 }}>
            {f.logo_url ? <img src={f.logo_url} alt="Club logo" width={56} height={56} style={{ borderRadius: 8, objectFit: 'contain', background: '#fff' }} /> : <GolfTripCrest size={56} />}
            <label className="btn ghost sm" style={{ cursor: 'pointer' }}>Upload logo<input type="file" accept="image/*" hidden onChange={(e) => pickLogo(e.target.files?.[0])} /></label>
          </div>
          <label className="field"><span>Club name</span><input className="input" value={f.name} maxLength={80} onChange={set('name')} /></label>
          <label className="field"><span>Group bookings email</span><input className="input" type="email" value={f.email} maxLength={120} onChange={set('email')} /></label>
          <label className="field"><span>Group bookings phone</span><input className="input" inputMode="tel" value={f.phone} maxLength={30} onChange={set('phone')} /></label>
          <label className="field"><span>About group bookings</span><textarea className="input" rows={2} value={f.note} maxLength={400} onChange={set('note')} placeholder="e.g. Groups of 8+ welcome midweek" style={{ fontFamily: 'inherit' }} /></label>
          <label className="field"><span>Offers for visiting groups</span><textarea className="input" rows={2} value={f.offers} maxLength={600} onChange={set('offers')} placeholder="e.g. Stay and play from $99 a person" style={{ fontFamily: 'inherit' }} /></label>
          <button type="button" className="btn gold block" disabled={busy || f.name.trim().length < 2} onClick={save}>Save</button>
        </div>
        <div className="card pad stack" style={{ gap: 8 }}>
          <strong>Your course{club.courses.length === 1 ? '' : 's'}</strong>
          {club.courses.map((c) => (
            <div key={c.id} className="row between" style={{ gap: 8 }}>
              <span style={{ minWidth: 0 }}><strong>{c.name}</strong><div className="small muted">{c.verified ? '✓ Hole data checked by you' : 'Hole data not checked yet'}</div></span>
              <span className="row" style={{ gap: 6, flex: 'none' }}>
                <a className="btn ghost sm" href={`#/c/${c.slug}`}>View</a>
                <button type="button" className="btn sm" onClick={() => setEditing(c)}>Hole data</button>
              </span>
            </div>
          ))}
        </div>
        <Counts />
        <Enquiries />
        <a href="#/club/kit" className="btn block">🖨️ Your QR kit (carts, par 3 signs, counter card, TV)</a>
      </div>
      {editing && <HoleData course={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

const nums = (s) => String(s).trim().split(/[\s,]+/).filter(Boolean).map(Number);

function HoleData({ course, onClose, onSaved }) {
  const [busy, run] = useRun();
  const [holes, setHoles] = useState(null);
  const [pars, setPars] = useState('');
  const [sis, setSis] = useState('');
  useEffect(() => {
    supabase.rpc('course_page', { p_slug: course.slug }).then(({ data }) => {
      const h = data?.holes || [];
      setHoles(h);
      setPars(h.map((x) => x.par).join(' '));
      setSis(h.map((x) => x.si).join(' '));
    });
  }, [course.slug]);
  const p = nums(pars), s = nums(sis);
  const problems = [];
  if (p.length !== 18) problems.push(`Pars: ${p.length} of 18`);
  if (p.some((x) => ![3, 4, 5, 6].includes(x))) problems.push('Pars are 3, 4, 5 or 6');
  if (s.length !== 18 || new Set(s).size !== 18 || s.some((x) => x < 1 || x > 18)) problems.push('Stroke index uses each of 1–18 once');
  const save = () => run(async () => {
    const next = p.map((par, i) => ({ ...(holes?.[i] || {}), n: i + 1, par, si: s[i] }));
    await must(supabase.rpc('club_update_course', { p_course_id: course.id, p_holes: next }));
    onSaved();
  }, 'Saved — new groups get your checked hole data');
  return (
    <Sheet title={`${course.name}: hole data`} onClose={onClose}>
      <div className="stack">
        {!holes ? <span className="muted">Loading…</span> : (
          <>
            <span className="small muted">From your scorecard. Groups that already copied the course keep their own copy; new groups get yours. Par total: {parTotal(p.map((par, i) => ({ n: i + 1, par })))}.</span>
            <label className="field"><span>Pars, holes 1–18</span><textarea className="input" inputMode="numeric" rows={2} value={pars} onChange={(e) => setPars(e.target.value)} /></label>
            <label className="field"><span>Stroke index, holes 1–18</span><textarea className="input" inputMode="numeric" rows={2} value={sis} onChange={(e) => setSis(e.target.value)} /></label>
            {problems.map((x) => <div key={x} className="err" style={{ margin: 0 }}>{x}</div>)}
            <button type="button" className="btn gold block" disabled={busy || problems.length > 0} onClick={save}>Save checked hole data</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Josh: approve claims by hand

function Claims() {
  const [rows, setRows] = useState(null);
  const [busy, run] = useRun();
  const load = useCallback(() => supabase.rpc('admin_club_claims').then(({ data }) => setRows(data || [])), []);
  useEffect(() => { load(); }, [load]);
  const decide = (k, approve) => {
    if (!window.confirm(approve ? `Approve ${k.club_name} (${k.contact_name}, ${k.contact_email}) for ${k.course}? Only after you've checked with the club.` : `Turn down this claim for ${k.course}?`)) return;
    run(async () => { await must(supabase.rpc('decide_club_claim', { p_claim: k.id, p_approve: approve })); await load(); }, approve ? 'Approved — the club can sign in and edit its page' : 'Turned down');
  };
  const unclaim = (k) => {
    if (!window.confirm(`Unclaim ${k.course}? ${k.club_name} keeps its account but loses the course page, and the hole data goes back to unchecked.`)) return;
    run(async () => { await must(supabase.rpc('admin_unclaim', { p_claim: k.id })); await load(); }, 'Unclaimed');
  };
  return (
    <>
      <Top title="Club claims" sub="Check each one with the club before approving" />
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto', padding: 16, gap: 10 }}>
        <a href="#/club" className="small">← Back</a>
        {rows == null && <span className="muted">Loading…</span>}
        {rows && !rows.length && <span className="muted">No claims yet.</span>}
        {rows?.map((k) => (
          <div key={k.id} className="card pad stack" style={{ gap: 4, opacity: k.status === 'pending' ? 1 : 0.6 }}>
            <strong>{k.course}{k.area ? ` · ${k.area}` : ''}</strong>
            <span className="small">{k.club_name} — {k.contact_name}{k.role_at_club ? `, ${k.role_at_club}` : ''}</span>
            <span className="small">{k.contact_email}{k.contact_phone ? ` · ${k.contact_phone}` : ''} · signed in as {k.signed_in_as || '?'}</span>
            {k.note && <span className="small muted">“{k.note}”</span>}
            <span className="small muted">{new Date(k.created_at).toLocaleDateString('en-AU')} · {k.status}{k.claimed && k.status === 'pending' ? ' · course already claimed' : ''}</span>
            {k.status === 'approved' && k.claimed_by_this && (
              <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => unclaim(k)}>Unclaim this course</button>
            )}
            {k.status === 'pending' && (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn sm" disabled={busy || k.claimed} onClick={() => decide(k, true)}>Approve</button>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => decide(k, false)}>Turn down</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Counts (never names)

const PLACES = { cart: 'Cart stickers', par3: 'Par 3 signs', counter: 'Counter card', tv: 'Clubhouse TV', stay: 'Stay cards', card: 'Results cards', invite: 'Invites' };

/** Stage 10: group booking enquiries people sent to this club (they chose to send their contact details). */
function Enquiries() {
  const [rows, setRows] = useState(null);
  useEffect(() => { supabase.rpc('club_enquiries', { p_days: 90 }).then(({ data }) => setRows(data || []), () => setRows([])); }, []);
  const d = (x) => (x ? new Date(`${x}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '');
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <strong>Group booking enquiries <span className="small muted">(last 90 days)</span></strong>
      {rows == null && <span className="small muted">Loading…</span>}
      {rows && !rows.length && <span className="small muted">None yet. Groups see “Ask about a group booking” on your course page once you’ve added a bookings email or phone.</span>}
      {rows?.map((e) => (
        <div key={e.id} className="stack" style={{ gap: 2, borderTop: '1px solid var(--line-soft, #E3E6EA)', paddingTop: 6 }}>
          <span><strong>{e.contact_name}</strong>{e.group_size ? ` · ${e.group_size} golfers` : ''}{e.rounds ? ` · ${e.rounds} round${e.rounds === 1 ? '' : 's'}` : ''}{e.start_date ? ` · ${d(e.start_date)}${e.end_date && e.end_date !== e.start_date ? `–${d(e.end_date)}` : ''}` : ''}</span>
          <span className="small">{e.contact_email && <a href={`mailto:${e.contact_email}`}>{e.contact_email}</a>}{e.contact_email && e.contact_phone ? ' · ' : ''}{e.contact_phone && <a href={`tel:${e.contact_phone.replace(/\s/g, '')}`}>{e.contact_phone}</a>}</span>
          {e.note && <span className="small muted">“{e.note}”</span>}
          <span className="small muted">{new Date(e.created_at).toLocaleDateString('en-AU')}{e.course ? ` · ${e.course}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Counts() {
  const [days, setDays] = useState(90);
  const [s, setS] = useState(null);
  useEffect(() => { supabase.rpc('club_stats', { p_days: days }).then(({ data }) => setS(data || null)); }, [days]);
  const scans = s?.scans || {};
  const total = Object.values(scans).reduce((a, n) => a + Number(n), 0);
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="row between"><strong>How groups find you</strong>
        <select className="select" style={{ width: 'auto', minHeight: 36 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>A year</option>
        </select>
      </div>
      {!s ? <span className="small muted">Loading…</span> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {[['Scans', total], ['Rounds started', s.rounds_started], ['Groups started', s.groups_created], ['Came back', s.groups_came_back], ['Trips planned', s.trips_planned], ['Became a group', s.made_official]].map(([k, v]) => (
              <div key={k} className="card" style={{ padding: '8px 6px', textAlign: 'center' }}><div className="num" style={{ fontSize: 24 }}>{v === -1 ? '<5' : v ?? 0}</div><div className="small muted">{k}</div></div>
            ))}
          </div>
          {total > 0 && <span className="small muted">Scans by where the code is: {Object.entries(scans).map(([k, n]) => `${PLACES[k] || k} ${n}`).join(' · ')}</span>}
          <span className="small muted">Counts only — you never see players’ names, scores or whereabouts. Fewer than 5 groups or rounds shows as “&lt;5”. Rounds are the ones played on your course.</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- The QR kit (print, or save as PDF)

function Kit({ club }) {
  const [pages, setPages] = useState([]);
  const [tvKey, setTvKey] = useState(null);
  const [busy, run] = useRun();
  useEffect(() => { supabase.rpc('my_club_tv_key').then(({ data }) => setTvKey(data || null)); }, []);
  const newKey = () => {
    if (!window.confirm('Get a new TV key? The TV will need the new link — the old one stops working.')) return;
    run(async () => setTvKey(await must(supabase.rpc('new_club_tv_key'))), 'New TV key — open the new link on the TV');
  };
  useEffect(() => {
    Promise.all(club.courses.map((c) => supabase.rpc('course_page', { p_slug: c.slug }).then(({ data }) => data))).then((r) => setPages(r.filter(Boolean)));
  }, [club.courses]);
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const link = (slug, p, h) => `${base}#/c/${slug}?ref=${club.ref}&p=${p}${h ? `&h=${h}` : ''}`;
  return (
    <>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } .kit-sheet { break-after: page; } }`}</style>
      <div className="no-print"><Top title="Your QR kit" sub={club.name} /></div>
      <div className="stack" style={{ maxWidth: 760, margin: '0 auto', padding: 16, gap: 14 }}>
        <div className="no-print stack" style={{ gap: 8 }}>
          <a href="#/club" className="small">← Back</a>
          <div className="card pad small" style={{ borderColor: 'var(--gold)' }}>
            <strong>Draft — please don’t print yet.</strong> These codes point at the test address. The real kit comes once The Golf Trip moves to its own web address, and Josh sends it to you.
          </div>
          <button type="button" className="btn block" onClick={() => window.print()}>🖨️ Print or save as PDF</button>
        </div>
        {pages.map((c) => (
          <React.Fragment key={c.slug}>
            {!(c.holes || []).length && <div className="no-print card pad small err" style={{ margin: 0 }}>{c.name} has no hole data yet — add it (Club screen → Hole data) before putting codes out, or golfers can’t start a round.</div>}
            <div className="kit-sheet stack" style={{ gap: 12 }}>
              <strong className="no-print">{c.name}: cart sticker and counter card</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <QrCard link={link(c.slug, 'cart')} title="Live scores for your group" line="Scan, 30 seconds, no app store." />
                <QrCard link={link(c.slug, 'counter')} title="Bringing a group?" line="Live leaderboard, side comps and trophies — free. Scan to start." />
              </div>
            </div>
            <div className="kit-sheet stack" style={{ gap: 12 }}>
              <strong className="no-print">Par 3 signs</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {(c.holes || []).filter((h) => Number(h.par) === 3).map((h) => (
                  <QrCard key={h.n} small link={link(c.slug, 'par3', h.n)} title={`Hole ${h.n}`} line="Closest to the pin today? Log it here." />
                ))}
              </div>
            </div>
            <div className="no-print stack" style={{ gap: 12 }}>
              <strong>Clubhouse TV (for staff — not printed)</strong>
              {tvKey && <QrCard link={`${base}#/tv/${c.slug}?k=${tvKey}&ref=${club.ref}`} title="On the clubhouse TV" line={`Open this on the TV’s browser: ${base}#/tv/${c.slug}?k=${tvKey}`} />}
              <span className="small muted">Keep this link to the club — it has your club’s key in it, so don’t pin it up. Groups only show up if they tick “Show on the clubhouse TV”. If the link gets out, get a new key: the old link stops working.</span>
              <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={newKey}>🔑 New TV key</button>
            </div>
          </React.Fragment>
        ))}
      </div>
    </>
  );
}
