import React from 'react';
import { Link } from 'react-router-dom';
import { useData, useSession, playerName, useFeature } from '../lib/store.jsx';
import { Header, Icon, Avatar } from '../components/ui.jsx';
import { notifyItem } from '../components/NotifyPrompt.jsx';
import { SIGN_IN } from '../lib/auth.js';
import { SaveSpotBanner } from '../components/SaveSpot.jsx';
import { NEW_GROUPS } from '../lib/beta.js';
import { BetaCard, InstallCard } from '../components/Feedback.jsx';
import { usePlatformAdmin, wishesItem } from '../components/WishesLink.jsx';

export default function More() {
  const { status } = useSession();
  const data = useData();
  const me = data.playersById[status.player_id];
  const pending = status.is_admin ? data.players.filter((p) => p.approved === false).length : 0;
  const on = { location: useFeature('location'), rule_voting: useFeature('rule_voting'), trophies: useFeature('trophies'), tribunal: useFeature('tribunal'), notifications: useFeature('notifications'), committees: useFeature('committees'), }; // the AI helper's way in is the Caddie button now (components/Caddie.jsx)
  const manyGroups = (status.groups?.length || 0) > 1;
  const platformAdmin = usePlatformAdmin();
  const items = [
    // The way back to Your groups (switch group, start one, join another). Builds without sign-in only show it
    // to someone in more than one group, so L.G.C's live app looks the same as before.
    (SIGN_IN.length > 0 || manyGroups) && { to: '/groups', icon: Icon.user, label: 'Your groups', sub: manyGroups ? (NEW_GROUPS ? 'Switch group, start a new one or join another' : 'Switch group or join another') : (NEW_GROUPS ? 'Start a new group or join another' : 'Join another group') },
    on.location && { to: '/map', icon: Icon.pin, label: 'Where’s everyone', sub: 'Course map with each group’s location' },
    // ov19: one entry for the Rulebook, the Tribunal and Committees (tabs inside).
    { to: '/governance/rulebook', icon: Icon.gavel, label: '⚖️ Group rules', sub: [on.rule_voting ? 'Rules (and votes on them)' : 'Our rules', on.tribunal && 'the Tribunal', on.committees && 'committees and elections'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') },
    // ov15: comps, the Cup and games live inside the trip now (This trip → What we're playing for).
    on.trophies && { to: '/trophies', icon: Icon.trophy, label: 'The Trophy Room', sub: status.legacy ? 'BD, Putt Buddies, Noodle Cup and the honour boards' : 'Trophies and the honour boards' },
    useFeature('stats') && { to: '/stats', icon: Icon.board, label: 'Stats & season ladder', sub: 'Order of merit, records and head-to-heads' },
    { to: '/courses', icon: Icon.map, label: 'Courses', sub: 'Every course and its history' },
    on.notifications && !status.viewing && notifyItem(),
    { to: `/player/${status.player_id}`, icon: Icon.user, label: 'My profile & settings', sub: 'Photo, nickname, sign-in, how you get votes, your own link' },
    { to: '/group', icon: Icon.user, label: 'Players & group', sub: status.is_admin ? 'Players and handicaps, invite links, roles and settings' : 'Everyone’s handicap, and your group' },
    status.is_admin && !status.viewing && { to: '/setup', icon: Icon.cog, label: 'Set up your trip', sub: 'Trip, courses, rounds, players, side comps — step by step' },
    status.is_admin && !status.viewing && { to: '/history', icon: Icon.book, label: '📜 History and import', sub: on.ai_helper ? 'Past winners, handicaps and trips — or ✨ import with the Caddie' : 'Past winners, handicaps and trips' },
    platformAdmin && !status.viewing && wishesItem(Icon.feed),
    // No admin PIN any more (083): organisers are made in Group & invites, so only they see Admin.
    ...(status.is_admin ? [{ to: '/admin', icon: Icon.cog, label: 'Organiser tools', sub: pending ? `${pending} waiting for approval` : 'Trips, courses, players, rounds' }] : []),
  ].filter(Boolean);
  return (
    <div className="page">
      <Header logo title="More" sub={me ? `Signed in as ${playerName(me)}` : ''} right={me && <Link to={`/player/${me.id}`} aria-label="My profile"><Avatar player={me} size={40} /></Link>} />
      <SaveSpotBanner />
      <div className="section">
        <div style={{ marginBottom: 12 }}><BetaCard /></div>
        <div className="card">
          {items.map((it) => (
            <Link key={it.to} to={it.to} className="row" style={{ padding: '14px', borderBottom: '1px solid var(--line-soft)', textDecoration: 'none', color: 'inherit' }}>
              <span style={{ color: 'var(--navy)' }}>{it.icon()}</span>
              <span className="grow">
                <div style={{ fontWeight: 700, fontSize: 16 }}>{it.label}</div>
                <div className="small muted">{it.sub}</div>
              </span>
              <span className="muted">{Icon.next()}</span>
            </Link>
          ))}
        </div>
        <InstallCard />
        {status?.legacy && <a href="?guide" className="btn ghost block" style={{ marginTop: 12 }}>How the app works</a>}
        <p className="note">Tip: add this app to your home screen — Share → Add to Home Screen (iPhone) or ⋮ → Add to Home screen (Android).</p>
      </div>
    </div>
  );
}
