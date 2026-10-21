import React from 'react';
import { Link } from 'react-router-dom';
import { useData, useSession, playerName, useFeature } from '../lib/store.jsx';
import { Header, Icon, Avatar } from '../components/ui.jsx';
import { NotifyCard } from '../components/NotifyCard.jsx';
import { SIGN_IN } from '../lib/auth.js';
import { NEW_GROUPS } from '../lib/beta.js';
import { BetaCard, InstallCard } from '../components/Feedback.jsx';
import { usePlatformAdmin, wishesItem } from '../components/WishesLink.jsx';

export default function More() {
  const { status } = useSession();
  const data = useData();
  const me = data.playersById[status.player_id];
  const pending = status.is_admin ? data.players.filter((p) => p.approved === false).length : 0;
  const on = { location: useFeature('location'), rule_voting: useFeature('rule_voting'), trophies: useFeature('trophies'), tribunal: useFeature('tribunal'), notifications: useFeature('notifications'), games: useFeature('games'), ai_helper: useFeature('ai_helper') };
  const manyGroups = (status.groups?.length || 0) > 1;
  const platformAdmin = usePlatformAdmin();
  const items = [
    // The way back to Your groups (switch group, start one, join another). Builds without sign-in only show it
    // to someone in more than one group, so L.G.C's live app looks the same as before.
    (SIGN_IN.length > 0 || manyGroups) && { to: '/groups', icon: Icon.user, label: 'Your groups', sub: manyGroups ? (NEW_GROUPS ? 'Switch group, start a new one or join another' : 'Switch group or join another') : (NEW_GROUPS ? 'Start a new group or join another' : 'Join another group') },
    on.location && { to: '/map', icon: Icon.pin, label: 'Where’s everyone', sub: 'Course map with each group’s location' },
    { to: '/rules', icon: Icon.book, label: 'The Rulebook', sub: on.rule_voting ? 'Our rules and bonuses — propose and vote on changes' : 'Our rules and bonuses' },
    on.trophies && { to: '/trophies', icon: Icon.trophy, label: 'The Trophy Room', sub: status.legacy ? 'BD, Putt Buddies, Noodle Cup and the honour boards' : 'Trophies and the honour boards' },
    on.games && { to: '/games', icon: Icon.flag, label: 'Games & side bets', sub: 'Skins, Nassau, pots — and who pays who' },
    on.tribunal && { to: '/tribunal', icon: Icon.gavel, label: 'Handicap Tribunal', sub: 'Lodge a case, vote, see verdicts' },
    useFeature('in_jokes') && { to: '/in-jokes', icon: Icon.hot, label: 'In-jokes', sub: 'Nicknames and running jokes — roast the golf, keep it friendly' },
    on.ai_helper && { to: '/ask', icon: Icon.feed, label: '✨ Ask the AI helper', sub: 'What’s on, who’s leading, who’s won the most — in plain words' },
    { to: '/courses', icon: Icon.map, label: 'Courses', sub: 'Every course and its history' },
    { to: `/player/${status.player_id}`, icon: Icon.user, label: 'My profile', sub: 'Photo, nickname, history' },
    { to: '/group', icon: Icon.user, label: 'Group & invites', sub: status.is_admin ? 'Invite links, QR code, people and roles' : (status.groups?.length > 1 ? 'Switch group, how you’re signed in' : 'Your group and how you’re signed in') },
    // The admin PIN is L.G.C's only; other groups make organisers in Group & invites.
    status.is_admin && !status.viewing && { to: '/setup', icon: Icon.cog, label: 'Set up your trip', sub: 'Trip, courses, rounds, players, side comps — step by step' },
    platformAdmin && !status.viewing && wishesItem(Icon.feed),
    ...(status.is_admin || status.legacy !== false ? [{ to: '/admin', icon: Icon.cog, label: status.is_admin ? 'Admin' : "I'm the admin", sub: status.is_admin ? (pending ? `${pending} waiting for approval` : 'Trips, courses, players, rounds') : 'Needs the admin PIN' }] : []),
  ].filter(Boolean);
  return (
    <div className="page">
      <Header logo title="More" sub={me ? `Signed in as ${playerName(me)}` : ''} right={me && <Link to={`/player/${me.id}`} aria-label="My profile"><Avatar player={me} size={40} /></Link>} />
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
        {on.notifications && <div style={{ marginTop: 12 }}><NotifyCard /></div>}
        {status?.legacy && <a href="?guide" className="btn ghost block" style={{ marginTop: 12 }}>How the app works</a>}
        <p className="note">Tip: add this app to your home screen — Share → Add to Home Screen (iPhone) or ⋮ → Add to Home screen (Android).</p>
      </div>
    </div>
  );
}
