// The awards presentation (ov28, walkthrough I14). Josh: "Not just dinner — often just lunch after the last game and
// head home." So it's the awards, wherever you are: put it on the TV (or pass a phone round) and step through the
// winners one by one — the trophies (handed over), the Cup, each round's podium, side comps, the awards and fines
// the group voted, the fines tally, who tipped right, and the best photos. #/present/awards/<trip>.
// Same results as the trip's results page (components/TripResults.jsx → useTripResults). Arrow keys or tap to move on.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData, useSession } from '../lib/store.jsx';
import { Avatar } from '../components/ui.jsx';
import { GroupCrest } from '../components/Logo.jsx';
import { TrophyArt } from '../components/TrophyArt.jsx';
import { useTripResults } from '../components/TripResults.jsx';
import { tally, resultLine, sortAwards } from '../lib/dinnerawards.js';
import './desk.css';

/** The slides, in order: [{ key, label, title, big, sub, people, art, photos, lines }]. */
export function slidesFor(res, { awards = [], nominations = [], votes = [], playersById = {} } = {}) {
  if (!res) return [];
  const nameOf = res.nameOf;
  const out = [{ key: 'start', label: res.trip.name, title: '🏅 The awards', sub: res.trip.name }];
  for (const t of res.trophies.filter((x) => x.winner)) {
    out.push({ key: `t-${t.comp.id}`, label: t.name, title: t.name, big: t.winner.names, sub: t.line, art: t,
      people: (t.winner.ids || []).map((id) => playersById[id]).filter(Boolean).slice(0, 6) });
  }
  if (res.cup) out.push({ key: 'cup', label: 'The Cup', title: '⚔️ The Cup', big: res.cup.text });
  for (const p of res.podiums) {
    out.push({ key: `r-${p.round.id}`, label: p.round.name, title: `⛳ ${p.round.name}`,
      lines: p.podium.map((x) => `${x.place === 1 ? '🥇' : x.place === 2 ? '🥈' : '🥉'} ${x.name} · ${x.score}`) });
  }
  if (res.sides.length) out.push({ key: 'sides', label: 'Side comps', title: '🎯 Side comps', lines: res.sides.map((s) => `${s.label}: ${s.name}`) });
  for (const a of sortAwards(awards).filter((x) => x.status === 'closed')) {
    const r = tally(a, nominations, votes);
    if (!r.winners.length) continue;
    out.push({ key: `a-${a.id}`, label: a.title, title: `${a.kind === 'fine' ? '🏷 Fine' : '🏅 Award'}: ${a.title}`, big: resultLine(a, r, nameOf),
      people: r.winners.map((w) => playersById[w.player_id]).filter(Boolean) });
  }
  if (res.tally.length) out.push({ key: 'fines', label: 'Fines tally', title: '🏷 The fines tally', lines: res.tally.slice(0, 8).map((t) => `${nameOf(t.player_id)} · ${t.count}`) });
  if (res.tipped.length) out.push({ key: 'tips', label: 'Who tipped right', title: '🎯 Who tipped right', lines: res.tipped.map((t) => `${t.title}: ${t.names.length ? t.names.join(', ') : 'nobody'}`) });
  if (res.photos.length) out.push({ key: 'photos', label: 'Best photos', title: '📸 The best photos', photos: res.photos.slice(0, 6) });
  out.push({ key: 'end', label: 'The end', title: 'That’s a wrap', sub: 'Same time next year?' });
  return out;
}

export default function AwardsShow() {
  const { tripId } = useParams();
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const trip = (tripId && data.trips.find((t) => t.id === tripId)) || data.currentTrip || null;
  const res = useTripResults(trip);
  const slides = useMemo(() => slidesFor(res, { ...(res?.awards || {}), playersById: data.playersById }), [res, data.playersById]);
  const [i, setI] = useState(0);
  const close = () => (window.history.length > 1 ? nav(-1) : nav('/'));
  const go = (d) => setI((x) => Math.max(0, Math.min(slides.length - 1, x + d)));
  useEffect(() => {
    const f = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape' && !document.fullscreenElement) close();
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const look = status?.look || (status && status.legacy !== false ? { crest_url: 'builtin:lgc' } : null);
  const s = slides[Math.min(i, slides.length - 1)];
  const full = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return (
    <div className="present" data-testid="awards-show" role="dialog" aria-label="The awards">
      <div className="present-top">
        <GroupCrest size={56} look={look} name={status?.group_name} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="present-sub">{[status?.group_name, trip?.name].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="present-actions">
          <button type="button" className="present-btn" onClick={full}>⛶ Full screen</button>
          <button type="button" className="present-btn" onClick={close} aria-label="Close">✕</button>
        </div>
      </div>
      {!trip && <div className="present-empty">No trip to present yet.</div>}
      {s && (
        <button type="button" onClick={() => go(1)} data-testid="awards-slide" data-key={s.key}
          style={{ flex: 1, background: 'none', border: 0, color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2vh', textAlign: 'center', cursor: 'pointer', padding: '2vh 0' }}>
          <div className="present-title" data-testid="awards-slide-title">{s.title}</div>
          {s.art && <TrophyArt name={s.art.name} type={s.art.trophy?.type} size={140} />}
          {s.people?.length > 0 && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>{s.people.map((p) => <Avatar key={p.id} player={p} size={72} />)}</div>}
          {s.big && <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'clamp(32px, 6vw, 96px)', color: 'var(--gold)', lineHeight: 1.05 }} data-testid="awards-slide-big">{s.big}</div>}
          {s.sub && <div className="present-sub">{s.sub}</div>}
          {s.lines && <div style={{ display: 'grid', gap: '1vh', fontSize: 'clamp(18px, 3vw, 44px)', fontWeight: 700 }}>{s.lines.map((l) => <div key={l}>{l}</div>)}</div>}
          {s.photos && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: 'min(900px, 100%)' }}>
              {s.photos.map((p) => <img key={p.id} src={p.photo_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 12 }} />)}
            </div>
          )}
        </button>
      )}
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="present-btn" disabled={i === 0} onClick={() => go(-1)} data-testid="awards-back">‹ Back</button>
        <span className="present-sub">{slides.length ? `${Math.min(i, slides.length - 1) + 1} of ${slides.length}` : ''}</span>
        <button type="button" className="present-btn" disabled={i >= slides.length - 1} onClick={() => go(1)} data-testid="awards-next">Next ›</button>
      </div>
    </div>
  );
}
