import React, { useEffect, useState } from 'react';
import { startOutbox, outboxCount, onOutboxChange, onOutboxDrop } from './lib/outbox.js';
import { HashRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { SessionProvider, DataProvider, useSession, useData } from './lib/store.jsx';
import { TabBar, Toaster, Loading, UpdateBanner, toast } from './components/ui.jsx';
import { lazyScreen, LazyArea } from './lib/lazy.jsx';
import { DrawOverlay } from './components/DrawOverlay.jsx';
// Loaded straight away: the first screens people see and score entry (must work with no signal).
import Join, { InviteJoin } from './screens/Join.jsx';
import { inviteCode } from './lib/invite.js';
import ProfileSetup, { AwaitingApproval } from './screens/ProfileSetup.jsx';
import Leaderboard from './screens/Leaderboard.jsx';
import ScoreEntry from './screens/ScoreEntry.jsx';
import Feed from './screens/Feed.jsx';
import More from './screens/More.jsx';

// Loaded when first opened (the service worker saves them all for offline use in the background).
const Admin = lazyScreen(() => import('./screens/Admin.jsx'));
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

// A fresh plan screen per plan, so nothing carries over when a notification jumps to another one.
function PlanDetailRoute() {
  const { planId } = useParams();
  return <PlanDetail key={planId} />;
}

// An invite link opened by someone already in a group: join that group too (or open it if already in).
function JoinInsideRoute() {
  const { code } = useParams();
  const c = inviteCode(code);
  return (
    <div style={{ minHeight: '70vh', background: 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {c ? <InviteJoin code={c} inside /> : <div>That invite link isn’t right.</div>}
    </div>
  );
}

function Gate() {
  const { loading, status } = useSession();
  if (loading) return <Loading />;
  if (!status?.is_member) return <Join />;
  return (
    <DataProvider>
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
        <Route path="/feed" element={<Feed />} />
        <Route path="/comps" element={<Comps />} />
        <Route path="/map" element={<MapScreen />} />
        <Route path="/more" element={<More />} />
        <Route path="/trophies" element={<Trophies />} />
        <Route path="/tribunal" element={<Tribunal />} />
        <Route path="/tribunal/:caseId" element={<TribunalCase />} />
        <Route path="/player/:playerId" element={<Profile />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/plan" element={<Planner />} />
        <Route path="/plan/:planId" element={<PlanDetailRoute />} />
        <Route path="/rules" element={<Rulebook />} />
        <Route path="/courses/:courseId/greens" element={<GreenMapper />} />
        <Route path="/group" element={<Group />} />
        <Route path="/join/:code" element={<JoinInsideRoute />} />
        <Route path="*" element={<Leaderboard />} />
      </Routes>
      </LazyArea>
      {!hideTabs && <TabBar />}
      <DrawOverlay />
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
