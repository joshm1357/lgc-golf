// The presentation (ov28 started it, ov33 made it a click-through show). #/present/awards/<trip>
// Josh: "For any of the awards, need a click-through presentation screen. Honourable mentions, then 3, 2, 1. Both
// phone and desktop sized." It's "the presentation" — often lunch after the last round, so never "dinner".
//
//   - First the running order: every trophy, round, side comp, award, fine and cup there is to present, ticked, in a
//     sensible order (side comps and fines → awards → the rounds and other trophies → cups → the main trophy last).
//     Untick, drag or ↑↓ to change it; it's kept on this phone or laptop for this trip.
//   - Then each item: a title card → honourable mentions → 3rd → 2nd → 1st (each with a short build-up beat), or
//     title → nominations → winner for one-winner awards. 1st shows the photo, what they won and the hand-over line.
//   - Tap (left third = back), space, arrow keys or the buttons move on; "Skip to winner"; a progress bar and
//     "Next: Longest drive"; full screen on a laptop. Reduced motion: no animation, reveals still work.
//   - After each item, one tap shares it to the Feed (the outbox's sendOrQueue, with an id made from the trip and
//     the item, so it's only ever one post per item — from any phone).
//   - ?only=<item key> presents one item on its own (e.g. from an award's card).
// The list and the steps: lib/presentation.js (presentationItems — the extension point for ov32's cups).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { supabase } from '../lib/supabase.js';
import { sendOrQueue } from '../lib/outbox.js';
import { Avatar, toast } from '../components/ui.jsx';
import { GroupCrest } from '../components/Logo.jsx';
import { TrophyArt } from '../components/TrophyArt.jsx';
import { useTripResults } from '../components/TripResults.jsx';
import {
  presentationItems, applyOrder, moveKey, flatSteps, winnerStep, beatFor, shareText, postIdFor, SECTION_LABEL,
} from '../lib/presentation.js';
import './desk.css';
import './presentation.css';

const ORDER_KEY = (tripId) => `tgt-present-order:${tripId}`;
const SHARED_KEY = (tripId) => `tgt-present-shared:${tripId}`;
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };

/**
 * ⚠️ ov32 EXTENSION POINT: the group cups to present, as [{ cup, standings }].
 * When ov32 lands: load the trip's cups (src/lib/cups.js) and return
 *   cups.map((cup) => ({ cup, standings: cupStandings(cup, data) }))
 * presentationItems turns each into a podium (with "Cap tips 🧢" and "Vibe points" in the mentions).
 */
function useCupsForPresentation(/* trip */) {
  return [];
}

function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const f = () => setR(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  return r;
}

/** A fresh show for each trip and each ?only= (moving between them never carries over the place you were up to). */
export default function AwardsShow() {
  const { tripId } = useParams();
  const [params] = useSearchParams();
  return <Presentation key={`${tripId || ''}|${params.get('only') || ''}`} />;
}

function Presentation() {
  const { tripId } = useParams();
  const [params] = useSearchParams();
  const only = params.get('only');
  const data = useData();
  const { status } = useSession();
  const feedOn = useFeature('feed');
  const nav = useNavigate();
  const trip = (tripId && data.trips.find((t) => t.id === tripId)) || data.currentTrip || null;
  const res = useTripResults(trip);
  const cups = useCupsForPresentation(trip);
  const rulesById = useMemo(() => Object.fromEntries((data.rules || []).map((r) => [r.id, r])), [data.rules]);
  const items = useMemo(() => (res ? presentationItems(trip, { ...res, rulesById, cups }) : []), [res, trip, rulesById, cups]);
  const [saved, setSaved] = useState(() => (trip ? readJSON(ORDER_KEY(trip.id), null) : null));
  useEffect(() => { if (trip) setSaved(readJSON(ORDER_KEY(trip.id), null)); }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordered = useMemo(() => applyOrder(items, saved), [items, saved]);
  const chosen = useMemo(() => (only ? ordered.filter((x) => x.key === only) : ordered.filter((x) => x.on)), [ordered, only]);
  const [showing, setShowing] = useState(!!only);
  const close = () => (window.history.length > 1 ? nav(-1) : nav('/'));
  const look = status?.look || (status && status.legacy !== false ? { crest_url: 'builtin:lgc' } : null);

  const save = (next) => { setSaved(next); if (trip) writeJSON(ORDER_KEY(trip.id), next); };

  return (
    <div className="present pz" data-testid="awards-show" role="dialog" aria-label="The presentation">
      {!trip && <div className="present-empty">No trip to present yet.</div>}
      {trip && !showing && (
        <RunningOrder trip={trip} look={look} status={status} items={ordered} save={save} close={close}
          start={() => setShowing(true)} reset={() => save(null)} />
      )}
      {trip && showing && (
        <Show trip={trip} items={chosen} look={look} status={status} playersById={data.playersById} feedOn={feedOn}
          close={only ? close : () => setShowing(false)} closeLabel={only ? 'Close' : 'Running order'} onExit={close} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the running order
function RunningOrder({ trip, look, status, items, save, close, start, reset }) {
  const [drag, setDrag] = useState(null);
  const keys = items.map((x) => x.key);
  const off = items.filter((x) => !x.on).map((x) => x.key);
  const put = (order, offKeys = off) => save({ order, off: offKeys });
  const on = items.filter((x) => x.on).length;
  return (
    <div className="pz-setup" data-testid="pz-setup">
      <div className="present-top">
        <GroupCrest size={48} look={look} name={status?.group_name} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="present-title">🎤 The presentation</div>
          <div className="present-sub">{trip.name} · the running order</div>
        </div>
        <div className="present-actions">
          <button type="button" className="present-btn" onClick={close} aria-label="Close">✕</button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="present-empty">Nothing to present yet — winners show up here once the rounds are in and the awards are decided.</div>
      ) : (
        <>
          <p className="pz-help">Untick anything you’ll skip. Drag, or use ↑ ↓, to change the order. The main trophy goes last.</p>
          <ol className="pz-order">
            {items.map((x, i) => (
              <li key={x.key} data-testid="pz-item" data-key={x.key} className={`pz-row${x.on ? '' : ' off'}${drag === x.key ? ' dragging' : ''}`}
                draggable onDragStart={(e) => { setDrag(x.key); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (drag && drag !== x.key) put(moveKey(keys, drag, i)); setDrag(null); }}
                onDragEnd={() => setDrag(null)}>
                <span className="pz-grip" aria-hidden="true">⋮⋮</span>
                <label className="pz-pick">
                  <input type="checkbox" checked={x.on} onChange={() => put(keys, x.on ? [...off, x.key] : off.filter((k) => k !== x.key))} />
                  <span className="pz-row-text">
                    <strong>{x.icon} {x.title}</strong>
                    <span className="pz-row-sub">{SECTION_LABEL[x.section]}{x.mode === 'podium' ? ' · 3, 2, 1' : x.mode === 'single' ? ' · one winner' : ''}</span>
                  </span>
                </label>
                <span className="pz-move">
                  <button type="button" className="present-btn" disabled={i === 0} aria-label={`Move ${x.title} up`} onClick={() => put(moveKey(keys, x.key, i - 1))}>↑</button>
                  <button type="button" className="present-btn" disabled={i === items.length - 1} aria-label={`Move ${x.title} down`} onClick={() => put(moveKey(keys, x.key, i + 1))}>↓</button>
                </span>
              </li>
            ))}
          </ol>
          <div className="pz-setup-foot">
            <button type="button" className="present-btn" onClick={reset} data-testid="pz-reset">Back to the usual order</button>
            <button type="button" className="pz-go" disabled={!on} onClick={start} data-testid="present-start">▶ Start ({on})</button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the show
function Show({ trip, items, look, status, playersById, feedOn, close, closeLabel, onExit }) {
  const reduced = useReducedMotion();
  const flat = useMemo(() => flatSteps(items), [items]);
  const total = flat.length;
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(true);
  const [shared, setShared] = useState(() => new Set(readJSON(SHARED_KEY(trip.id), [])));
  const [sharing, setSharing] = useState(false);
  const at = pos < total ? flat[pos] : null; // null = the end card
  const needsBeat = !!at && (at.step.type === 'place' || at.step.type === 'winner');
  const jump = useRef(false); // "Skip to winner" and going back show the result straight away

  // The build-up beat: the words first, then the name. Reduced motion: straight away.
  useEffect(() => {
    if (!needsBeat) { jump.current = false; setRevealed(true); return undefined; }
    if (reduced || jump.current) { jump.current = false; setRevealed(true); return undefined; }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 1100);
    return () => clearTimeout(t);
  }, [pos, needsBeat, reduced]);

  // Already shared from another phone? Look for the posts with these items' ids.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const ids = await Promise.all(items.map((x) => postIdFor(trip.id, x.key)));
        if (!ids.length) return;
        const { data } = await supabase.from('posts').select('id').in('id', ids);
        const have = new Set((data || []).map((r) => r.id));
        if (!live || !have.size) return;
        setShared((s) => new Set([...s, ...items.filter((_, i) => have.has(ids[i])).map((x) => x.key)]));
      } catch { /* offline: the phone's own memory will do */ }
    })();
    return () => { live = false; };
  }, [items, trip.id]);

  const forward = useCallback(() => {
    if (needsBeat && !revealed) { setRevealed(true); return; }
    setPos((p) => Math.min(total, p + 1));
  }, [needsBeat, revealed, total]);
  const back = useCallback(() => { jump.current = true; setPos((p) => Math.max(0, p - 1)); }, []);
  const skip = useCallback(() => {
    if (!at) return;
    if (at.last) { setRevealed(true); return; }
    jump.current = true;
    setPos((p) => winnerStep(flat, p));
  }, [flat, at]);
  const full = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => {
    const f = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); forward(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'w' || e.key === 'W') skip();
      else if ((e.key === 'f' || e.key === 'F') && canFull) full();
      else if (e.key === 'Escape' && !document.fullscreenElement) close();
      else return;
      document.activeElement?.blur?.();
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const tapStage = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) back(); else forward();
  };

  const item = at?.item || null;
  const nextItem = at ? items[at.index + 1] : null;
  const canShare = feedOn && status?.player_id && !status?.viewing && status?.role !== 'guest';
  const share = async (it) => {
    if (sharing || shared.has(it.key)) return;
    const body = shareText(it, trip.name);
    if (!body) return;
    setSharing(true);
    try {
      const id = await postIdFor(trip.id, it.key);
      const r = await sendOrQueue('posts', { id, kind: 'user', player_id: status.player_id, trip_id: trip.id, body });
      const next = new Set([...shared, it.key]);
      setShared(next);
      writeJSON(SHARED_KEY(trip.id), [...next]);
      toast(r.sent ? 'On the Feed' : 'Saved — it’ll go on the Feed when there’s signal');
    } catch (e) { toast(e?.message || 'Couldn’t share that'); }
    setSharing(false);
  };

  const progress = total ? Math.min(1, pos / total) : 1;
  return (
    <>
      <div className="present-top pz-top">
        <GroupCrest size={40} look={look} name={status?.group_name} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="pz-now ellipsis">{item ? `${item.icon} ${item.title}` : trip.name}</div>
          <div className="present-sub ellipsis" data-testid="pz-next">{nextItem ? `Next: ${nextItem.title}` : item ? 'Last one' : 'That’s everything'}</div>
        </div>
        <div className="present-actions">
          {at && !(at.last && revealed) && (
            <button type="button" className="present-btn pz-skipbtn" onClick={skip} data-testid="pz-skip">⏭ <span>Skip to winner</span></button>
          )}
          {canFull && <button type="button" className="present-btn pz-desk" onClick={full} data-testid="pz-full">⛶ Full screen</button>}
          <button type="button" className="present-btn" onClick={close} data-testid="pz-close" aria-label={closeLabel}>{closeLabel === 'Close' ? '✕' : '☰'}</button>
        </div>
      </div>
      <div className="pz-progress" data-testid="pz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={pos}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      <div className={`pz-stage${reduced ? ' still' : ''}`} onClick={tapStage} data-testid="pz-stage" data-key={item?.key || 'end'}
        data-step={at ? `${at.step.type}${at.step.place || ''}` : 'end'} data-revealed={revealed ? '1' : '0'} aria-live="polite">
        {item ? <Step key={pos} at={at} revealed={revealed} playersById={playersById} /> : (
          <div className="pz-card pz-in">
            <div className="pz-icon">🏁</div>
            <div className="pz-title" data-testid="pz-title">That’s a wrap</div>
            <div className="pz-about">Same time next year?</div>
          </div>
        )}
        {at?.last && revealed && canShare && ['podium', 'single', 'list'].includes(item.mode) && (
          <button type="button" className="pz-share" onClick={(e) => { e.stopPropagation(); share(item); }} disabled={sharing || shared.has(item.key)} data-testid="pz-share">
            {shared.has(item.key) ? '✓ On the Feed' : '📣 Share to the Feed'}
          </button>
        )}
      </div>

      <div className="pz-foot">
        <button type="button" className="pz-nav" disabled={pos === 0} onClick={back} data-testid="pz-back" aria-label="Back">‹ <span>Back</span></button>
        <span className="present-sub pz-count">{Math.min(pos + 1, total)} of {total}</span>
        {pos < total
          ? <button type="button" className="pz-nav fwd" onClick={forward} data-testid="pz-forward" aria-label="Next">{needsBeat && !revealed ? 'Reveal' : 'Next'} ›</button>
          : <button type="button" className="pz-nav fwd" onClick={onExit} data-testid="pz-done">Done</button>}
      </div>
    </>
  );
}

function People({ ids = [], playersById, size }) {
  const ps = ids.map((id) => playersById?.[id]).filter(Boolean).slice(0, 6);
  if (!ps.length) return null;
  return <div className="pz-people">{ps.map((p) => <Avatar key={p.id} player={p} size={size} />)}</div>;
}

function Step({ at, revealed, playersById }) {
  const { item, step } = at;
  if (step.type === 'title') {
    return (
      <div className="pz-card pz-in pz-titlecard">
        {item.art?.photo ? <img className="pz-trophy-photo" src={item.art.photo} alt="" />
          : item.art ? <div className="pz-art"><TrophyArt name={item.art.name} type={item.art.type} size={160} /></div>
            : <div className="pz-icon">{item.icon}</div>}
        <div>
          <div className="pz-title" data-testid="pz-title">{item.title}</div>
          {item.about && <div className="pz-about">{item.about}</div>}
        </div>
      </div>
    );
  }
  if (step.type === 'mentions') {
    return (
      <div className="pz-card pz-in" data-testid="pz-mentions">
        <div className="pz-kicker">{item.mode === 'podium' ? 'Honourable mentions' : 'Also nominated'}</div>
        <div className="pz-mentions">
          {item.mentions.map((m) => (
            <div key={m.id} className="pz-mention">
              {m.photo ? <img className="pz-mention-photo" src={m.photo} alt="" /> : <People ids={m.ids} playersById={playersById} size={56} />}
              <div className="pz-mention-text">
                <strong>{m.name}</strong>
                {m.story && <span>{m.story}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (step.type === 'list') {
    return (
      <div className="pz-card pz-in">
        <div className="pz-kicker">{item.title}</div>
        <div className="pz-lines">{item.lines.map((l) => <div key={l}>{l}</div>)}</div>
      </div>
    );
  }
  if (step.type === 'photos') {
    return (
      <div className="pz-card pz-in">
        <div className="pz-photos">{item.photos.map((p) => <img key={p.id} src={p.photo_url} alt="" />)}</div>
      </div>
    );
  }
  // A place on the podium, or the one winner.
  const single = step.type === 'winner';
  const place = single ? null : item.places.find((p) => p.place === step.place);
  const first = single || step.place === 1;
  const joint = single ? !!item.winner?.joint : place.joint;
  const entrants = single ? [{ name: item.winner.name, ids: item.winner.ids, score: item.winner.score }] : place.entrants;
  const ids = entrants.flatMap((e) => e.ids);
  const photo = single ? item.winner.photo : null;
  const medal = single ? '🏆' : step.place === 1 ? '🥇' : step.place === 2 ? '🥈' : '🥉';
  return (
    <div className={`pz-card pz-reveal-card${first ? ' first' : ''}`}>
      <div className="pz-beat" data-testid="pz-beat">{beatFor(single ? 1 : step.place, joint, single && !joint)}</div>
      {revealed && (
        <div className="pz-reveal" data-testid="pz-reveal">
          <div className="pz-place">{medal} {single ? (joint ? 'Joint winners' : 'The winner') : place.label}</div>
          <div className="pz-who">
            {photo ? <img className="pz-photo" src={photo} alt="" /> : null}
            <People ids={ids} playersById={playersById} size={first ? 132 : 104} />
          </div>
          <div className="pz-name" data-testid="pz-name">{entrants.map((e) => e.name).join(' & ')}</div>
          {entrants[0]?.score && <div className="pz-score">{entrants[0].score}</div>}
          {single && item.winner.story && <div className="pz-about">“{item.winner.story}”</div>}
          {first && item.worth && item.worth !== entrants[0]?.score && <div className="pz-worth">{item.worth}</div>}
          {first && item.handover && <div className="pz-handover" data-testid="pz-handover">{item.handover}</div>}
        </div>
      )}
    </div>
  );
}
