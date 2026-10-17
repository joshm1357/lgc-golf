import React from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { SessionProvider, DataProvider, useSession, useData } from './lib/store.jsx';
import { TabBar, Toaster, Loading } from './components/ui.jsx';
import Join from './screens/Join.jsx';
import ProfileSetup from './screens/ProfileSetup.jsx';
import Leaderboard from './screens/Leaderboard.jsx';
import ScoreEntry from './screens/ScoreEntry.jsx';
import Admin from './screens/Admin.jsx';
import More from './screens/More.jsx';
import Profile from './screens/Profile.jsx';
import Feed from './screens/Feed.jsx';
import Comps from './screens/Comps.jsx';
import MapScreen from './screens/MapScreen.jsx';
import Trophies from './screens/Trophies.jsx';
import Tribunal, { TribunalCase } from './screens/Tribunal.jsx';
import Courses from './screens/Courses.jsx';

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
  if (!data.ready) {
    return data.error ? <div className="empty">Couldn't load: {data.error.message}. Pull down to refresh.</div> : <Loading />;
  }
  if (!status.player_id) return <ProfileSetup />;
  const hideTabs = loc.pathname.startsWith('/score/');
  return (
    <div className="app">
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
        <Route path="*" element={<Leaderboard />} />
      </Routes>
      {!hideTabs && <TabBar />}
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
