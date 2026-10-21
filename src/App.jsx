import React, { useEffect, useState } from 'react';
import { startOutbox, outboxCount, onOutboxChange, onOutboxDrop } from './lib/outbox.js';
import { HashRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { SessionProvider, DataProvider, useSession, useData, useFeature } from './lib/store.jsx';
import { TabBar, Toaster, Loading, UpdateBanner, toast } from './components/ui.jsx';
import { lazyScreen, LazyArea } from './lib/lazy.jsx';
import { DrawOverlay } from './components/DrawOverlay.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { FeedbackHost } from './components/Feedback.jsx';
import { WhatsNew } from './components/WhatsNew.jsx';
import { ViewingBar, StopViewing } from './components/Viewing.jsx';
import { AwardWatcher } from './components/Awards.jsx';
import { Shortcuts } from './components/Shortcuts.jsx';
import { NEW_GROUPS } from './lib/beta.js';
import { supabase } from './lib/supabase.js';
import { sourceFrom, countScan } from './lib/quick.js';
// Loaded straight away: the first screens people see and score entry (must work with no signal).
import Join, { InviteJoin } from './screens/Join.jsx';
import { inviteCode } from './lib/invite.js';
import { signInProblemFromUrl, SIGN_IN } from './lib/auth.js';
import { frontDoor, isFreshSignIn, clearFreshSignIn, takeReturn, choosesItsOwnWay } from './lib/home.js';
import YourGroups, { YourGroupsInside } from './screens/YourGroups.jsx';
import PersonalLink from './screens/PersonalLink.jsx';
import { personalCode } from './lib/personal.js';
import ProfileSetup, { AwaitingApproval } from './screens/ProfileSetup.jsx';
import Leaderboard from './screens/Leaderboard.jsx';
import ScoreEntry from './screens/ScoreEntry.jsx';
import Feed from './screens/Feed.jsx';
import More from './screens/More.jsx';

// Loaded when first opened (the service worker saves them all for offline use in the background).
const Admin = lazyScreen(() => import('./screens/Admin.jsx'));
const SetupGuide = lazyScreen(() => import('./screens/SetupGuide.jsx'));
const Privacy = lazyScreen(() => import('./screens/Legal.jsx'), 'Privacy');
const Terms = lazyScreen(() => import('./screens/Legal.jsx'), 'Terms');
const Profile = lazyScreen(() => import('./screens/Profile.jsx'));
const Comps = lazyScreen(() => import('./screens/Comps.jsx'));
const MapScreen = lazyScreen(() => import('./screens/MapScreen.jsx'));
const Trophies = lazyScreen(() => import('./screens/Trophies.jsx'));
const Tribunal = lazyScreen(() => import('./screens/Tribunal.jsx'));
const TribunalCase = lazyScreen(() => import('./screens/Tribunal.jsx'), 'TribunalCase');
const Courses = lazyScreen(() => import('./screens/Courses.jsx'));
const Planner = lazyScreen(() => import('./screens/Trips.jsx'));
const PlanDetail = lazyScreen(() => import('./screens/Planner.jsx'), 'PlanDetail');
const Rulebook = lazyScreen(() => import('./screens/Rulebook.jsx'));
const GreenMapper = lazyScreen(() => import('./screens/GreenMapper.jsx'));
const Group = lazyScreen(() => import('./screens/Group.jsx'));
const History = lazyScreen(() => import('./screens/History.jsx'));
const Start = lazyScreen(() => import('./screens/Start.jsx'));
const CoursePage = lazyScreen(() => import('./screens/CoursePage.jsx'));
const Club = lazyScreen(() => import('./screens/Club.jsx'));
const TvBoard = lazyScreen(() => import('./screens/TvBoard.jsx'));
const RoundReady = lazyScreen(() => import('./screens/QuickRound.jsx'), 'RoundReady');
const Cup = lazyScreen(() => import('./screens/Cup.jsx'));
const CupMatch = lazyScreen(() => import('./screens/Cup.jsx'), 'CupMatch');
const InJokes = lazyScreen(() => import('./screens/InJokes.jsx'));
const Wishes = lazyScreen(() => import('./screens/Wishes.jsx'));
const Games = lazyScreen(() => import('./screens/Games.jsx'));
const Replay = lazyScreen(() => import('./screens/Replay.jsx'));
const CourseGuide = lazyScreen(() => import('./screens/CourseGuide.jsx'));
const Ask = lazyScreen(() => import('./screens/AiHelper.jsx'));
const Desk = lazyScreen(() => import('./screens/Desk.jsx')); // Stage 11c: the full desktop (Trip desk, tables, paper cards)

// A fresh plan screen per plan, so nothing carries over when a notification jumps to another one.
function PlanDetailRoute() {
  const { planId } = useParams();
  return <PlanDetail key={planId} />;
}

// An invite link opened by someone already in a group: join that group too (or open it if already in).
function JoinInsideRoute({ code: given }) {
  const { code } = useParams();
  const c = inviteCode(given || code);
  return (
    <div style={{ minHeight: '70vh', background: 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {c ? <InviteJoin code={c} inside /> : <div>That invite link isn’t right.</div>}
    </div>
  );
}

// Screens of a switched-off feature (opened from an old post, a bookmark or a notification) say so instead of half-working.
function FeatureRoute({ feature, label, children }) {
  return useFeature(feature) ? children : (
    <div className="page"><div className="empty" style={{ marginTop: 40 }}>{label} is switched off for this group.<div className="small muted" style={{ marginTop: 6 }}>An organiser can switch it on in More → Group & invites → Features.</div></div></div>
  );
}
function DrawOverlayIfOn() {
  return useFeature('draw') ? <DrawOverlay /> : null;
}

// Starting a group is off on live until Stage 2 (friends' beta): say so, instead of a wizard the database would refuse.
// Josh (a platform admin) can still start one; the database decides who that is.
function StartOrClosed() {
  const loc = useLocation();
  const [open, setOpen] = useState(NEW_GROUPS ? true : null);
  useEffect(() => {
    if (NEW_GROUPS) return;
    supabase.rpc('new_groups_open').then(({ data }) => setOpen(data === true), () => setOpen(false));
  }, []);
  // Closed: the wizard (which counts a stay card's scan) doesn't open, so count it here, once a visit.
  useEffect(() => {
    if (open !== false) return;
    const src = sourceFrom(loc.search);
    if (!src?.ref || !src.placement) return;
    const key = `lgc-scan-${src.ref}-${src.placement}-start`;
    let counted = false;
    try { counted = !!sessionStorage.getItem(key); sessionStorage.setItem(key, '1'); } catch { /* fine */ }
    if (!counted) countScan(supabase, { ref: src.ref, placement: src.placement, slug: null }).catch(() => {});
  }, [open, loc.search]);
  if (open === null) return <Loading />;
  if (open) return <LazyArea resetKey="start" fallback={<Loading />}><Start /></LazyArea>;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <div className="hdr-title">The Golf Trip is invite-only for now</div>
      <div style={{ maxWidth: 360, color: 'var(--on-navy-muted)' }}>We’re testing it with our first groups. Got an invite link from your organiser? Open it to join your group.</div>
      <a href="#/" className="btn gold" style={{ minWidth: 200 }}>Back</a>
    </div>
  );
}

function Gate() {
  const { loading, status } = useSession();
  const loc = useLocation();
  // Coming back from Google with a problem: it's in the address, not an error — say what happened.
  const [problem] = useState(() => signInProblemFromUrl());
  // Back from Google: go to the page they left from (an invite, the wizard), kept on the phone (lib/auth.js back()).
  useEffect(() => {
    if (loading) return;
    const to = takeReturn();
    if (to && !inviteCode(window.location.hash) && /^#?\/?$/.test(window.location.hash)) window.location.hash = to;
  }, [loading]);
  // An invite, the start-a-group wizard or a course's quick round: they've chosen where to go, so don't send them
  // to Your groups afterwards.
  useEffect(() => { if (choosesItsOwnWay(loc.pathname)) clearFreshSignIn(); }, [loc.pathname]);
  // The public start page and the start-a-group wizard work whether or not you're in a group yet.
  if (loc.pathname === '/start' || loc.pathname.startsWith('/start/')) return <StartOrClosed />;
  // Privacy and terms (drafts): anyone can read them.
  if (loc.pathname === '/privacy') return <LazyArea resetKey="privacy" fallback={<Loading />}><Privacy /></LazyArea>;
  if (loc.pathname === '/terms') return <LazyArea resetKey="terms" fallback={<Loading />}><Terms /></LazyArea>;
  // The clubhouse TV: read-only, no sign-in.
  if (loc.pathname.startsWith('/tv/')) return <LazyArea resetKey="tv" fallback={<Loading />}><Routes><Route path="/tv/:slug" element={<TvBoard />} /></Routes></LazyArea>;
  // Club partners (claiming a course, the club's own page; Josh's claim approvals).
  if (loc.pathname === '/club' || loc.pathname.startsWith('/club/')) return <LazyArea resetKey="club" fallback={<Loading />}><Club /></LazyArea>;
  // The public course page (and the quick round from it): no sign-in needed to look.
  if (loc.pathname === '/c' || loc.pathname.startsWith('/c/')) {
    return (
      <LazyArea resetKey="course" fallback={<Loading />}>
        <Routes><Route path="/c/:slug" element={<CoursePage />} /><Route path="*" element={<CoursePage />} /></Routes>
      </LazyArea>
    );
  }
  if (loading) return <Loading />;
  // A personal link ("Hi Mike, this link is just for you"): works whether or not this phone is in a group yet.
  if (loc.pathname.startsWith('/me/')) return <><ViewingBar /><PersonalLink code={personalCode(loc.pathname)} /></>;
  const banner = problem && <div className="err" role="alert" style={{ margin: 0, borderRadius: 0 }}>{problem}</div>;
  // The front door: sign in first (when it's switched on in this build), then Your groups, then into a group.
  // With sign-in off (the live L.G.C build), this is exactly the old rule: not in a group → the PIN screen.
  const door = frontDoor({ signInOn: SIGN_IN.length > 0, status, fresh: isFreshSignIn(), hasInvite: !!inviteCode(window.location.hash) });
  if (door === 'join' || door === 'home') return <>{banner}<Join /></>;
  if (door === 'your-groups') return <>{banner}<YourGroups /></>;
  return (
    <DataProvider>
      {banner}
      <Inside />
    </DataProvider>
  );
}

function Inside() {
  const { status } = useSession();
  const data = useData();
  const loc = useLocation();
  // New screens open at the top, so a tap can't land on a button further down the next page.
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  // In a group now: a fresh sign-in has done its job (next time, straight back into this group).
  useEffect(() => { clearFreshSignIn(); }, []);
  const [waiting, setWaiting] = useState(outboxCount());
  useEffect(() => {
    startOutbox();
    const a = onOutboxChange(setWaiting);
    const b = onOutboxDrop((msg) => toast(msg));
    return () => { a(); b(); };
  }, []);
  if (!data.ready) {
    return data.error ? <div className="empty">Couldn't load: {data.error.message}. Pull down to refresh.</div> : <Loading />;
  }
  // Viewing as a player who isn't in the group's list any more: stop viewing (Viewing.jsx).
  if (status.viewing && !data.playersById[status.player_id]) return <StopViewing />;
  // An invite link opened while still picking a name (or waiting for approval) still works.
  if (loc.pathname.startsWith('/join/') && (!status.player_id || !data.playersById[status.player_id])) return <><ViewingBar /><JoinInsideRoute code={loc.pathname.slice(6)} /></>;
  if (!status.player_id) return <><ViewingBar /><ProfileSetup /></>;
  const me = data.playersById[status.player_id];
  if (!me) return <><ViewingBar /><ProfileSetup /></>;
  if (me.approved === false && !status.is_admin) return <><ViewingBar /><AwaitingApproval player={me} /></>;
  const hideTabs = loc.pathname.startsWith('/score/');
  const offline = data.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return (
    <div className="app with-side">
      <Sidebar />
      <ViewingBar />
      <AwardWatcher />
      {waiting > 0 && !offline && <div className="sync" role="status">📤 {waiting} post{waiting === 1 ? '' : 's'} or entr{waiting === 1 ? 'y' : 'ies'} waiting to send…</div>}
      {offline && <div className="sync" role="status">📵 No signal — showing the copy saved on this phone.{status.viewing ? '' : ' Scores you enter are kept and sent when signal comes back.'}</div>}
      <LazyArea resetKey={loc.pathname} fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Leaderboard />} />
        <Route path="/score/:roundId" element={<ScoreEntry />} />
        <Route path="/feed" element={<FeatureRoute feature="feed" label="The Feed"><Feed /></FeatureRoute>} />
        <Route path="/comps" element={<FeatureRoute feature="side_comps" label="Side comps"><Comps /></FeatureRoute>} />
        <Route path="/map" element={<FeatureRoute feature="location" label="Where’s everyone"><MapScreen /></FeatureRoute>} />
        <Route path="/more" element={<More />} />
        <Route path="/ask" element={<FeatureRoute feature="ai_helper" label="The AI helper"><Ask /></FeatureRoute>} />
        <Route path="/cup" element={<FeatureRoute feature="cup" label="The Cup"><Cup /></FeatureRoute>} />
        <Route path="/cup/:matchId" element={<FeatureRoute feature="cup" label="The Cup"><CupMatch /></FeatureRoute>} />
        <Route path="/games" element={<FeatureRoute feature="games" label="Games and side bets"><Games /></FeatureRoute>} />
        <Route path="/replay/:roundId" element={<FeatureRoute feature="replay" label="Round replay"><Replay /></FeatureRoute>} />
        <Route path="/trophies" element={<FeatureRoute feature="trophies" label="The Trophy Room"><Trophies /></FeatureRoute>} />
        <Route path="/tribunal" element={<FeatureRoute feature="tribunal" label="The Handicap Tribunal"><Tribunal /></FeatureRoute>} />
        <Route path="/tribunal/:caseId" element={<FeatureRoute feature="tribunal" label="The Handicap Tribunal"><TribunalCase /></FeatureRoute>} />
        <Route path="/in-jokes" element={<FeatureRoute feature="in_jokes" label="In-jokes"><InJokes /></FeatureRoute>} />
        <Route path="/player/:playerId" element={<Profile />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/setup" element={<SetupGuide />} />
        <Route path="/plan" element={<FeatureRoute feature="planner" label="The Trips planner"><Planner /></FeatureRoute>} />
        <Route path="/plan/:planId" element={<FeatureRoute feature="planner" label="The Trips planner"><PlanDetailRoute /></FeatureRoute>} />
        <Route path="/rules" element={<Rulebook />} />
        <Route path="/courses/:courseId/greens" element={<GreenMapper />} />
        <Route path="/guide/:courseId/:hole?" element={<FeatureRoute feature="gps" label="The course guide"><CourseGuide /></FeatureRoute>} />
        <Route path="/group" element={<Group />} />
        <Route path="/groups" element={<YourGroupsInside />} />
        <Route path="/history" element={<History />} />
        <Route path="/round-ready" element={<RoundReady />} />
        <Route path="/wishes" element={<Wishes />} />
        <Route path="/join/:code" element={<JoinInsideRoute />} />
        <Route path="/desk/*" element={<Desk />} />
        <Route path="*" element={<Leaderboard />} />
      </Routes>
      </LazyArea>
      {!hideTabs && <TabBar />}
      <DrawOverlayIfOn />
      <UpdateBanner />
      <FeedbackHost />
      <WhatsNew />
      <Shortcuts />
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </HashRouter>
  );
}
