import React from 'react';
import { Link } from 'react-router-dom';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { Header, Icon, Avatar } from '../components/ui.jsx';
import { NotifyCard } from '../components/NotifyCard.jsx';

export default function More() {
  const { status } = useSession();
  const data = useData();
  const me = data.playersById[status.player_id];
  const pending = status.is_admin ? data.players.filter((p) => p.approved === false).length : 0;
  const items = [
    { to: '/map', icon: Icon.pin, label: 'Where’s everyone', sub: 'Course map with each group’s location' },
    { to: '/rules', icon: Icon.book, label: 'The Rulebook', sub: 'Our rules and bonuses — propose and vote on changes' },
    { to: '/trophies', icon: Icon.trophy, label: 'The Trophy Room', sub: 'BD, Putt Buddies, Noodle Cup and the honour boards' },
    { to: '/tribunal', icon: Icon.gavel, label: 'Handicap Tribunal', sub: 'Lodge a case, vote, see verdicts' },
    { to: '/courses', icon: Icon.map, label: 'Courses', sub: 'Every course and its history' },
    { to: `/player/${status.player_id}`, icon: Icon.user, label: 'My profile', sub: 'Photo, nickname, history' },
    { to: '/group', icon: Icon.user, label: 'Group & invites', sub: status.is_admin ? 'Invite links, QR code, people and roles' : (status.groups?.length > 1 ? 'Switch group, how you’re signed in' : 'Your group and how you’re signed in') },
    // The admin PIN is L.G.C's only; other groups make organisers in Group & invites.
    ...(status.is_admin || status.legacy !== false ? [{ to: '/admin', icon: Icon.cog, label: status.is_admin ? 'Admin' : "I'm the admin", sub: status.is_admin ? (pending ? `${pending} waiting for approval` : 'Trips, courses, players, rounds') : 'Needs the admin PIN' }] : []),
  ];
  return (
    <div className="page">
      <Header logo title="More" sub={me ? `Signed in as ${playerName(me)}` : ''} right={me && <Link to={`/player/${me.id}`} aria-label="My profile"><Avatar player={me} size={40} /></Link>} />
      <div className="section">
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
        <div style={{ marginTop: 12 }}><NotifyCard /></div>
        <a href="?guide" className="btn ghost block" style={{ marginTop: 12 }}>How the app works</a>
        <p className="note">Tip: add this app to your home screen — Share → Add to Home Screen (iPhone) or ⋮ → Add to Home screen (Android).</p>
      </div>
    </div>
  );
}
