import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { inviteLink } from '../lib/invite.js';
import { shareText } from '../lib/push.js';
import { resultsText, sameTimeNextYear, startOwnLink } from '../lib/quick.js';
import { readHandicap } from '../lib/history.js';
import { toast } from '../components/ui.jsx';
import { SIGN_IN } from '../lib/auth.js';
import { SignInCard } from './Group.jsx';
import SharePicture from '../components/SharePicture.jsx';
import { boardCard } from '../lib/shareCard.js';

// Stage 7b: the quick round inside the app — getting your mates in, joining with just a name, and what happens
// after the last hole (share the results, the winner on the honour board, same time next year, make it official).

const QUICK_KEY = 'lgc-quick';
const quickSaved = () => { try { return JSON.parse(localStorage.getItem(QUICK_KEY) || 'null'); } catch { return null; } };

/** The share-sheet invite and a QR code, for a quick group's guest link. */
function useGuestLink() {
  const { status } = useSession();
  // The link saved when the round started — only if it's for the group this phone is in now.
  const [code, setCode] = useState(() => (quickSaved()?.gid === status?.group_id ? quickSaved()?.invite : null) || null);
  useEffect(() => {
    if (code) return;
    supabase.rpc('group_invite', { p_role: 'guest' }).then(({ data }) => data && setCode(data));
  }, [code]);
  return code ? inviteLink(code) : '';
}

/** Straight after "Start the round": get your mates in, then start scoring. */
export function RoundReady() {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const link = useGuestLink();
  const [qr, setQr] = useState(null);
  const round = data.rounds.find((r) => r.id === quickSaved()?.round) || data.rounds.find((r) => r.status === 'live');
  const course = round ? data.coursesById[round.course_id] : null;
  const slug = (status?.groups || []).find((g) => g.id === status?.group_id)?.slug;
  useEffect(() => {
    if (!link) return undefined;
    let live = true;
    import('qrcode').then((QR) => QR.toDataURL(link, { margin: 1, width: 360 })).then((u) => live && setQr(u)).catch(() => {});
    return () => { live = false; };
  }, [link]);
  const share = async () => {
    const r = await shareText(`⛳ Join my round${course ? ` at ${course.name}` : ''} — live scores on your phone, no app store, just tap:\n${link}\n\nRun a golf group? Start your own: ${startOwnLink(slug)}`);
    if (r === 'copied') toast('Link copied — paste it in the group chat');
    else if (r === 'failed') toast('Couldn’t share from this phone — show them the QR code');
  };
  return (
    <div className="page">
      <header className="hdr"><div className="hdr-title">Get your mates in</div><div className="hdr-sub">{round?.name || 'Your round'}</div></header>
      <div className="section stack" style={{ gap: 12 }}>
        <button type="button" className="btn gold block" style={{ minHeight: 60, fontSize: 19 }} disabled={!link} onClick={share}>📤 Send your mates the link</button>
        <span className="small muted" style={{ textAlign: 'center' }}>They tap it, type their name, and they’re in — no app store, no sign-up.</span>
        {qr && <img src={qr} alt="QR code for your mates to scan" style={{ width: 200, height: 200, alignSelf: 'center', borderRadius: 8 }} />}
        <span className="small muted" style={{ textAlign: 'center' }}>Standing together? They can scan this instead.</span>
        <button type="button" className="btn block" style={{ minHeight: 56 }} disabled={!round} onClick={() => nav(round ? `/score/${round.id}` : '/')}>Start scoring →</button>
        <Link to="/" className="small" style={{ textAlign: 'center' }}>See the leaderboard</Link>
      </div>
    </div>
  );
}

/** Joining a quick round from the link: just a name (and a handicap if you know it). */
export function QuickJoin() {
  const data = useData();
  const { refresh, status } = useSession();
  const [busy, run] = useRun();
  const [name, setName] = useState('');
  const [hcp, setHcp] = useState('');
  const h = hcp.trim() === '' ? 18 : readHandicap(hcp);
  const join = () => run(async () => {
    await must(supabase.rpc('create_my_player', { p_name: name.trim(), p_nickname: null, p_handicap: h, p_avatar_url: null }));
    await data.reload();
    await refresh();
    const live = data.rounds.find((r) => r.status === 'live' && r.format === 'stableford');
    if (live) window.location.hash = `#/score/${live.id}`;
  });
  return (
    <div className="app">
      <header className="hdr"><div className="hdr-title">You’re in</div><div className="hdr-sub">{status?.group_name}</div></header>
      <div className="section stack" style={{ gap: 12 }}>
        <label className="field"><span>Your name</span><input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="What your mates call you" autoFocus /></label>
        <label className="field"><span>Handicap (if you know it)</span><input className="input" inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="18" /></label>
        {hcp.trim() !== '' && h == null && <span className="small err" style={{ margin: 0 }}>A handicap is a number from −10 to 54 (write a plus handicap as +2).</span>}
        <button type="button" className="btn gold block" style={{ minHeight: 60, fontSize: 19 }} disabled={busy || !name.trim() || h == null} onClick={join}>{busy ? 'Joining…' : 'Join the round'}</button>
      </div>
    </div>
  );
}

/** After the last hole of a quick round: share, honour board, same time next year, make it official. */
export function QuickRoundDone({ round, board, course }) {
  const data = useData();
  const { status, user } = useSession();
  const nav = useNavigate();
  const [busy, run] = useRun();
  const rows = board?.rows || [];
  const allDone = rows.length > 0 && rows.every((r) => r.finished);
  const someDone = rows.some((r) => r.finished);
  const today = new Date().toISOString().slice(0, 10);
  const pastDay = round.play_date && round.play_date < today;
  // Everyone done, or (for the organiser) someone's done 18 or the day's over — one mate who never scored can't hold it up.
  const show = round.status === 'locked' || allDone || (status?.is_admin && (someDone || pastDay));
  if (!show) {
    return round.status === 'live' && status?.is_admin ? (
      <div className="section"><Link to="/round-ready" className="small" style={{ fontWeight: 700 }}>📤 Invite more mates</Link></div>
    ) : null;
  }
  const isA = round.format !== 'stableford'; // net to par (Ambrose or stroke play)
  const top = rows[0];
  const slug = (status?.groups || []).find((g) => g.id === status?.group_id)?.slug;
  const engraved = data.honour_board.some((h) => h.trip_id === round.trip_id);
  const label = new Date(`${round.play_date || new Date().toISOString().slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  const share = async () => {
    const r = await shareText(resultsText({ roundName: round.name, courseName: course?.name, rows, format: round.format, groupSlug: slug }));
    if (r === 'copied') toast('Results copied — paste them in the group chat');
    else if (r === 'failed') toast('Couldn’t share from this phone — take a screenshot instead');
  };
  const finish = () => run(async () => {
    if (round.status !== 'locked') await must(supabase.from('rounds').update({ status: 'locked' }).eq('id', round.id));
    if (top && !engraved) {
      const max = Math.max(0, ...data.honour_board.map((x) => x.sort_key));
      const winners = top.players.map((p) => p.name).join(' & ') || top.name;
      await must(supabase.from('honour_board').insert({ trophy_name: course?.name || 'The round', label, winner_names: winners, player_ids: top.players.map((p) => p.id), sort_key: max + 10, trip_id: round.trip_id }));
    }
    await data.reload();
  }, top ? `${top.name} goes on the honour board` : 'Round finished');
  const nextYear = () => {
    const q = new URLSearchParams({ suggest: '1', kind: 'round', name: `${course?.name || 'Our round'} again`, date: sameTimeNextYear(round.play_date || today),
      place: course?.name || '', share: '1' });
    nav(`/plan?${q.toString()}`);
  };
  const official = () => run(async () => {
    await must(supabase.rpc('make_group_official'));
    // The wizard from its sign-in step (if not signed in properly yet), then the group's name and crest.
    try { localStorage.setItem('lgc-start', JSON.stringify({ gid: status.group_id, step: status.signed_in ? 2 : 0, official: true, uid: user?.id || null })); } catch { /* fine */ }
    window.location.hash = '#/start/new';
  });

  return (
    <div className="section">
      <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--gold)' }}>
        <strong style={{ fontSize: 18 }}>🏁 {round.status === 'locked' ? 'Round finished' : 'Everyone’s done'}</strong>
        {top && <span>{top.name} {round.status === 'locked' ? 'won' : 'leads'} — {isA ? `${top.netToPar > 0 ? '+' : ''}${top.netToPar} net` : `${top.points} points`}.</span>}
        <button type="button" className="btn gold block" onClick={share}>📤 Share the results</button>
        <SharePicture kind="leaderboard" data={boardCard(board, { roundName: round.name, courseName: course?.name, playDate: round.play_date, final: round.status === 'locked' })}
          text={`⛳ ${round.name}${course?.name ? ` at ${course.name}` : ''}`} />
        {status?.is_admin && (round.status !== 'locked' || !engraved) && (
          <button type="button" className="btn block" disabled={busy} onClick={finish}>{round.status === 'locked' ? `Put ${top?.name || 'the winner'} on the honour board` : `Finish — ${top?.name || 'the winner'} on the honour board`}</button>
        )}
        <button type="button" className="btn ghost block" onClick={nextYear}>📅 Same time next year?</button>
        {!status?.signed_in && SIGN_IN.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small"><strong>Keep this round on your record</strong> — add a sign-in and it stays with you on any phone.</span>
            <SignInCard />
          </div>
        )}
        {status?.is_admin && status?.quick && round.status === 'locked' && (
          <>
            <button type="button" className="btn ghost block" disabled={busy} onClick={official}>⭐ Make it official — name the group, add a crest</button>
            <span className="small muted">Keeps everyone and today’s round. You become a proper group with your own Rulebook, trophies and trips.</span>
          </>
        )}
      </div>
    </div>
  );
}

