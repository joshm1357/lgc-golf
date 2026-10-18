import React, { useEffect, useState } from 'react';
import { startOutbox, outboxCount, onOutboxChange, onOutboxDrop } from './lib/outbox.js';
import { HashRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { SessionProvider, DataProvider, useSession, useData, useFeature } from './lib/store.jsx';
import { TabBar, Toaster, Loading, UpdateBanner, toast } from './components/ui.jsx';
import { lazyScreen, LazyArea } from './lib/lazy.jsx';
import { DrawOverlay } from './components/DrawOverlay.jsx';
// Loaded straight away: the first screens people see and score entry (must work with no signal).
import Join, { InviteJoin } from './screens/Join.jsx';
import { inviteCode } from './lib/invite.js';
import { signInProblemFromUrl } from './lib/auth.js';
import ProfileSetup, { AwaitingApproval } from './screens/ProfileSetup.jsx';
import Leaderboard from './screens/Leaderboard.jsx';
import ScoreEntry from './screens/ScoreEntry.jsx';
import Feed from './screens/Feed.jsx';
import More from './screens/More.jsx';

// Loaded when first opened (the service worker saves them all for offline use in the background).
const Admin = lazyScreen(() => import('./screens/Admin.jsx'));
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

function Gate() {
  const { loading, status } = useSession();
  const loc = useLocation();
  // Coming back from Google with a problem: it's in the address, not an error — say what happened.
  const [problem] = useState(() => signInProblemFromUrl());
  // The public start page and the start-a-group wizard work whether or not you're in a group yet.
  if (loc.pathname === '/start' || loc.pathname.startsWith('/start/')) return <LazyArea resetKey="start" fallback={<Loading />}><Start /></LazyArea>;
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
  const banner = problem && <div className="err" role="alert" style={{ margin: 0, borderRadius: 0 }}>{problem}</div>;
  if (!status?.is_member) return <>{banner}<Join /></>;
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
  // An invite link opened while still picking a name (or waiting for approval) still works.
  if (loc.pathname.startsWith('/join/') && (!status.player_id || !data.playersById[status.player_id])) return <JoinInsideRoute code={loc.pathname.slice(6)} />;
  if (!status.player_id) return <ProfileSetup />;
  const me = data.playersById[status.player_id];
  if (!me) return <ProfileSetup />;
  if (me.approved === false && !status.is_admin) return <AwaitingApproval player={me} />;
  const hideTabs = loc.pathname.startsWith('/score/');
  const offline = data.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return (
    <div className="app">
      {waiting > 0 && !offline && <div className="sync" role="status">📤 {waiting} post{waiting === 1 ? '' : 's'} or entr{waiting === 1 ? 'y' : 'ies'} waiting to send…</div>}
      {offline && <div className="sync" role="status">📵 No signal — showing the copy saved on this phone. Scores you enter are kept and sent when signal comes back.</div>}
      <LazyArea resetKey={loc.pathname} fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Leaderboard />} />
        <Route path="/score/:roundId" element={<ScoreEntry />} />
        <Route path="/feed" element={<FeatureRoute feature="feed" label="The Feed"><Feed /></FeatureRoute>} />
        <Route path="/comps" element={<FeatureRoute feature="side_comps" label="Side comps"><Comps /></FeatureRoute>} />
        <Route path="/map" element={<FeatureRoute feature="location" label="Where’s everyone"><MapScreen /></FeatureRoute>} />
        <Route path="/more" element={<More />} />
        <Route path="/trophies" element={<FeatureRoute feature="trophies" label="The Trophy Room"><Trophies /></FeatureRoute>} />
        <Route path="/tribunal" element={<FeatureRoute feature="tribunal" label="The Handicap Tribunal"><Tribunal /></FeatureRoute>} />
        <Route path="/tribunal/:caseId" element={<FeatureRoute feature="tribunal" label="The Handicap Tribunal"><TribunalCase /></FeatureRoute>} />
        <Route path="/player/:playerId" element={<Profile />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/plan" element={<FeatureRoute feature="planner" label="The Trips planner"><Planner /></FeatureRoute>} />
        <Route path="/plan/:planId" element={<FeatureRoute feature="planner" label="The Trips planner"><PlanDetailRoute /></FeatureRoute>} />
        <Route path="/rules" element={<Rulebook />} />
        <Route path="/courses/:courseId/greens" element={<GreenMapper />} />
        <Route path="/group" element={<Group />} />
        <Route path="/history" element={<History />} />
        <Route path="/round-ready" element={<RoundReady />} />
        <Route path="/join/:code" element={<JoinInsideRoute />} />
        <Route path="*" element={<Leaderboard />} />
      </Routes>
      </LazyArea>
      {!hideTabs && <TabBar />}
      <DrawOverlayIfOn />
      <UpdateBanner />
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
