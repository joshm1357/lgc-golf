import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SIGN_IN, linkProvider, linkEmail } from '../lib/auth.js';
import { useRun, must } from '../lib/run.js';
import { uploadPhoto } from '../lib/images.js';
import { parTotal } from '../lib/scoring.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { Toaster, toast, Sheet } from '../components/ui.jsx';

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
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)' }}>
      {me === undefined ? <><Top title="Clubs" /><div className="muted" style={{ padding: 16 }}>Loading…</div></>
        : claimsPage && me?.platform_admin ? <Claims />
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
          <span className="small">• Coming next: a QR kit for carts, par 3s and the counter, and a clubhouse TV leaderboard.</span>
        </div>
        {me?.platform_admin && <a href="#/club/claims" className="btn ghost block">Josh: claims to approve →</a>}
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
        <div className="card pad small muted">Coming next: your QR kit (carts, par 3 signs, counter card, clubhouse TV) and counts of groups playing your course. You’ll never see players’ names, scores or whereabouts.</div>
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
