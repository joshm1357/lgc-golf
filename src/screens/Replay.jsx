// Round replay (Stage 12, v1): a finished round played back as a short animated story, phone portrait.
// Plays itself. Tap right = next, tap left = back, hold = pause. Sound (the phone reading the lines) is off until
// you turn it on. All the working-out is in lib/replay.js and lib/replay-lines.js; this file only shows it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData, useSession, useFeature, cacheGet } from '../lib/store.jsx';
import { supabase } from '../lib/supabase.js';
import { Avatar, AvatarStack, Loading, toast } from '../components/ui.jsx';
import { shareText, appLink } from '../lib/push.js';
import { currentGroup } from '../lib/group.js';
import { buildReplay, buildTimeline, holeWord, gapWords } from '../lib/replay.js';
import { STYLES, captionsFor, popFor, topMoment, hashSeed, savedStyle, saveStyle, ordinal } from '../lib/replay-lines.js';
import { jokesFromLines } from '../lib/injokes.js';
import './replay.css';

const ROW_H = 56; // one leaderboard row (50px) + gap
const MAX_ROWS = 8;

/** Everything the replay needs that isn't already loaded. Each read is allowed to fail (older database, feature
 * off, no signal): the replay just leaves that part out. */
function useReplayExtras(roundId, jokesOn) {
  const [extras, setExtras] = useState(null);
  useEffect(() => {
    let live = true;
    const safe = async (q) => {
      try { const { data, error } = await q; return error ? null : data || []; } catch { return null; }
    };
    setExtras(null);
    (async () => {
      const [scores, sideEntries, posts, ownDefs, ownEntries, jokes] = await Promise.all([
        safe(supabase.from('scores').select('*').eq('round_id', roundId)),
        safe(supabase.from('side_entries').select('*').eq('round_id', roundId)),
        safe(supabase.from('posts').select('*').eq('round_id', roundId)),
        safe(supabase.from('side_comp_defs').select('*')),
        safe(supabase.from('side_comp_entries').select('*').eq('round_id', roundId)),
        // A few running jokes for the captions (072: never the whole list).
        jokesOn ? safe(supabase.rpc('in_joke_lines', { p_n: 5 })) : Promise.resolve([]),
      ]);
      if (!live) return;
      setExtras({
        scores: scores ?? cacheGet(`scores-${roundId}`) ?? [],
        sideEntries: sideEntries || [], posts: posts || [], ownDefs: ownDefs || [], ownEntries: ownEntries || [], jokes: jokesFromLines(jokes),
      });
    })();
    return () => { live = false; };
  }, [roundId, jokesOn]);
  return extras;
}

export default function Replay() {
  const { roundId } = useParams();
  const [params] = useSearchParams();
  const fast = params.get('fast') === '1';
  const data = useData();
  const { status } = useSession();
  const jokesOn = useFeature('in_jokes');
  const extras = useReplayExtras(roundId, jokesOn);
  const round = data.rounds?.find((r) => r.id === roundId) || null;
  const course = round ? data.coursesById[round.course_id] : null;
  const groupId = status?.group_id || currentGroup();
  const [style, setStyle] = useState(() => savedStyle(groupId));

  const replay = useMemo(() => {
    if (!round || !extras || !course) return null;
    return buildReplay({
      round, course, teams: data.teamsByRound[round.id] || [], roundPlayers: data.roundPlayers[round.id] || [],
      playersById: data.playersById, scores: extras.scores, quickResults: data.quick_results || [],
      sideEntries: extras.sideEntries, ownDefs: extras.ownDefs, ownEntries: extras.ownEntries, posts: extras.posts,
    });
  }, [round, course, extras, data]);
  const steps = useMemo(() => (replay ? buildTimeline(replay, { fast }) : []), [replay, fast]);
  const captions = useMemo(
    () => (replay ? captionsFor(replay, steps, { style, seed: hashSeed(round?.id || ''), jokes: extras?.jokes || [], roundName: round?.name, courseName: course?.name }) : []),
    [replay, steps, style, extras, round, course],
  );

  if (!data.ready || (round && !extras)) return <div className="rp"><Loading text="Setting up the replay…" /></div>;
  if (!round || !course) {
    return (
      <div className="rp"><div className="rp-center" style={{ padding: 24 }}>
        <div className="rp-title" style={{ fontSize: 32 }}>Can’t find that round</div>
        <Link to="/" className="btn gold">Back to the leaderboard</Link>
      </div></div>
    );
  }
  return (
    <Player
      key={`${round.id}-${fast ? 'fast' : 'normal'}`}
      round={round} course={course} replay={replay} steps={steps} captions={captions}
      style={style} setStyle={(s) => { setStyle(s); saveStyle(groupId, s); }}
    />
  );
}

function Player({ round, course, replay, steps, captions, style, setStyle }) {
  const nav = useNavigate();
  const [idx, setIdx] = useState(0);
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false); // the pause button
  const [muted, setMuted] = useState(true);
  const paused = held || stopped;
  const step = steps[idx] || { scene: 'end', ms: null };
  const last = steps.length - 1;
  const go = (d) => setIdx((i) => Math.max(0, Math.min(last, i + d)));

  // The clock: each step waits its time, then moves on. Pausing keeps the time left.
  const remaining = useRef(null);
  const forIdx = useRef(-1);
  useEffect(() => {
    if (forIdx.current !== idx) { forIdx.current = idx; remaining.current = step.ms; }
    if (step.ms == null || paused) return undefined;
    const started = performance.now();
    const t = setTimeout(() => setIdx((i) => Math.min(last, i + 1)), Math.max(0, remaining.current));
    return () => { clearTimeout(t); remaining.current -= performance.now() - started; };
  }, [idx, paused, step.ms, last]);

  // Sound: the phone reads each line out (off until switched on).
  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) return undefined;
    synth.cancel();
    if (muted || !captions[idx]) return undefined;
    try {
      const u = new SpeechSynthesisUtterance(captions[idx]);
      const voices = synth.getVoices();
      u.voice = voices.find((v) => /en-AU/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
      u.rate = style === 'larrikins' ? 1.08 : 0.98;
      synth.speak(u);
    } catch { /* no voice on this phone: fine */ }
    return () => synth.cancel();
  }, [idx, muted, captions, style]);

  // Hold anywhere to pause; a quick tap on the left third goes back, anywhere else goes forward.
  const press = useRef(null);
  const down = (e) => {
    if (e.button != null && e.button !== 0) return;
    const x = e.clientX;
    const w = e.currentTarget.getBoundingClientRect();
    press.current = { x: x - w.left, w: w.width, hold: false, t: setTimeout(() => { if (press.current) { press.current.hold = true; setHeld(true); } }, 220) };
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.t);
    if (p.hold) { setHeld(false); return; }
    if (step.scene === 'end') return;
    go(p.x < p.w / 3 ? -1 : 1);
  };
  const cancel = () => {
    const p = press.current;
    press.current = null;
    if (p) { clearTimeout(p.t); if (p.hold) setHeld(false); }
  };
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') { e.preventDefault(); setStopped((s) => !s); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    const r = await shareText(`🎬 ${round.name}${course?.name ? ` at ${course.name}` : ''} — watch the replay: ${appLink(`/replay/${round.id}`)}`);
    if (r === 'copied') toast('Link copied — paste it in the group chat');
    else if (r === 'failed') toast('Couldn’t share from this phone');
  };
  const nextStyle = STYLES[(STYLES.findIndex((s) => s.key === style) + 1) % STYLES.length];
  const stop = (e) => e.stopPropagation();

  // Which leaderboard frame the race shows (the finish card sits over the board as it stood with 3 to play).
  const frameIdx = step.scene === 'race' ? step.frame : step.scene === 'finish' ? replay?.finish?.frameIndex : null;

  return (
    <div className="rp" data-scene={step.scene} data-step={idx} data-paused={paused ? '1' : '0'}>
      <div className="rp-inner">
        <div className="rp-progress" aria-hidden="true">
          {steps.filter((s) => s.ms != null).map((s, i) => (
            <span key={i} className={'rp-seg' + (i < idx ? ' done' : i === idx ? ' now' : '')} style={{ flexGrow: Math.max(1, Math.round(s.ms / 500)) }}>
              <i key={i === idx ? `n${idx}` : 'x'} style={i === idx ? { animationDuration: `${s.ms}ms`, animationPlayState: paused ? 'paused' : 'running' } : undefined} />
            </span>
          ))}
        </div>
        <div className="rp-top" onPointerDown={stop} onPointerUp={stop}>
          <button type="button" className="rp-btn" aria-label="Close the replay" onClick={() => nav(`/?r=${round.id}`)}>✕</button>
          <span className="grow">Replay</span>
          <button type="button" className="rp-btn" aria-label={`Commentary: ${STYLES.find((s) => s.key === style)?.name}. Tap for ${nextStyle.name}`} onClick={() => setStyle(nextStyle.key)}>
            🎙️ {STYLES.find((s) => s.key === style)?.name}
          </button>
          <button type="button" className="rp-btn" aria-label={muted ? 'Sound off — tap to turn on' : 'Sound on — tap to turn off'} aria-pressed={!muted} onClick={() => setMuted((m) => !m)}>
            {muted ? '🔇' : '🔊'}
          </button>
          {step.ms != null && (
            <button type="button" className="rp-btn" aria-label={stopped ? 'Play' : 'Pause'} onClick={() => setStopped((s) => !s)}>{stopped ? '▶' : '❚❚'}</button>
          )}
        </div>

        <div className="rp-stage" onPointerDown={down} onPointerUp={up} onPointerLeave={cancel} onPointerCancel={cancel} onContextMenu={(e) => e.preventDefault()}>
          {paused && step.ms != null && <div className="rp-paused" role="status">PAUSED</div>}
          {!replay || replay.empty ? (
            <div className="rp-center">
              <div className="rp-title" style={{ fontSize: 34 }}>Nothing to replay yet</div>
              <div className="rp-sub">Once scores are in, the replay builds itself.</div>
            </div>
          ) : step.scene === 'welcome' ? (
            <Welcome round={round} course={course} replay={replay} />
          ) : step.scene === 'field' ? (
            <Field replay={replay} />
          ) : frameIdx != null ? (
            <>
              <Race replay={replay} frameIdx={frameIdx} stepKey={idx} quietPop={step.scene === 'finish'} />
              {step.scene === 'finish' && <Finish replay={replay} />}
            </>
          ) : step.scene === 'winner' ? (
            <Winner replay={replay} />
          ) : step.scene === 'awards' ? (
            <Awards replay={replay} />
          ) : null}
          {step.scene === 'end' && (
            <End replay={replay} round={round} style={style} setStyle={setStyle} onAgain={() => { setStopped(false); setIdx(0); }} onShare={share} stop={stop} />
          )}
        </div>

        <div className="rp-caption" aria-live="polite">{captions[idx] ? <span key={`${idx}-${style}`}>{captions[idx]}</span> : null}</div>
      </div>
    </div>
  );
}

function niceDate(iso) {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

function Welcome({ round, course, replay }) {
  return (
    <div className="rp-center rp-welcome">
      <div className="rp-flag" aria-hidden="true">⛳</div>
      <div className="rp-kicker rp-in">The replay</div>
      <div className="rp-title rp-in" style={{ animationDelay: '.1s' }}>{round.name}</div>
      <div className="rp-sub rp-in" style={{ animationDelay: '.2s' }}>{course?.name}</div>
      <div className="rp-sub rp-in" style={{ animationDelay: '.3s' }}>{niceDate(round.play_date)}</div>
      <span className="rp-chip rp-in" style={{ animationDelay: '.4s' }}>{replay.formatLabel}</span>
    </div>
  );
}

function Field({ replay }) {
  const n = replay.subjects.length;
  const size = n > 12 ? 44 : n > 6 ? 56 : 72;
  return (
    <div className="rp-center" style={{ justifyContent: 'flex-start', paddingTop: 12 }}>
      <div className="rp-kicker">{replay.teams ? 'The teams' : 'The field'}</div>
      <div className="rp-field">
        {replay.subjects.map((s, i) => (
          <div key={s.id} className="rp-face" style={{ animationDelay: `${Math.min(i, 16) * 0.12}s` }}>
            {s.players.length > 1 ? <AvatarStack players={s.players} size={Math.round(size * 0.75)} /> : <Avatar player={s.players[0]} size={size} />}
            <span className="n">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Race({ replay, frameIdx, stepKey, quietPop }) {
  const f = replay.frames[frameIdx];
  const shown = Math.min(MAX_ROWS, f.rows.length);
  const top = topMoment(f);
  const pop = quietPop ? null : popFor(f);
  const post = top?.kind === 'post' ? top : null;
  const lead = f.rows[0];
  return (
    <>
      <div className="rp-hole">
        <span className="h">{f.label}</span>
        <span className="p">
          {f.par ? `Par ${f.par}` : ''}
          {lead?.thru > 0 && f.gap != null && <div>{f.leader ? `${lead.name} by ${gapWords(replay.format, f.gap)}` : 'Tied at the top'}</div>}
        </span>
      </div>
      <div className="rp-board" style={{ height: shown * ROW_H + (f.rows.length > shown ? 22 : 0) }}>
        {f.rows.map((r, pos) => {
          const mv = f.moves[r.id] || 0;
          const cls = 'rp-row' + (pos === 0 && f.leader === r.id ? ' lead' : '') + (top?.subjectId === r.id ? ' hot' : '') + (pos >= shown ? ' off' : '');
          return (
            <div key={r.id} className={cls} style={{ transform: `translateY(${Math.min(pos, shown) * ROW_H}px)` }} data-name={r.name}>
              <span className="pos">{r.thru ? r.rankLabel : '–'}</span>
              {r.players.length > 1 ? <AvatarStack players={r.players} size={30} /> : <Avatar player={r.players[0]} size={36} />}
              <span className="nm">{r.name}</span>
              <span className="rp-sc">{r.display}</span>
              <span className={'mv' + (mv > 0 ? ' up' : mv < 0 ? ' down' : '')}>{mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : ''}</span>
            </div>
          );
        })}
        {f.rows.length > shown && <div className="rp-more" style={{ top: shown * ROW_H }}>+ {f.rows.length - shown} more</div>}
      </div>
      {post && (
        <div className="rp-post" key={`p${stepKey}`}>
          {post.photo && <img src={post.photo} alt="" />}
          <span className="small">💬 <strong>{post.name}</strong>{post.text ? `: ${post.text}` : ''}</span>
        </div>
      )}
      {pop && <div key={`w${stepKey}`} className={'rp-word' + (pop.kind === 'lead_change' || pop.kind === 'tied_lead' ? ' lead' : pop.kind === 'blowup' ? ' ouch' : '')}>{pop.word}</div>}
    </>
  );
}

function Finish({ replay }) {
  const f = replay.finish;
  return (
    <div className="rp-finish">
      <div className="rp-kicker">{f.left} to play</div>
      <div className="rp-gap">{f.gap === 0 ? 'All square' : `${f.gapText} in it`}</div>
      <div className="rp-sub">{f.gap === 0 ? `${f.leader} and ${f.second}, level.` : `${f.leader} leads ${f.second}.`}</div>
      {f.chances.length > 0 && (
        <div className="stack" style={{ gap: 12, marginTop: 6 }}>
          <div className="rp-kicker" style={{ color: 'var(--rp-muted)' }}>Chance of winning, then</div>
          {f.chances.map((c) => (
            <div key={c.id} className="rp-chance">
              {c.players.length > 1 ? <AvatarStack players={c.players} size={26} /> : <Avatar player={c.players[0]} size={30} />}
              <strong className="ellipsis">{c.name}</strong>
              <strong>{c.winPct}%</strong>
              <span className="rp-bar"><i style={{ width: `${Math.max(2, c.winPct)}%` }} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CONFETTI_COLOURS = ['#D9A521', '#FFFFFF', '#4CC38A', '#5AA9E6', '#FF7A6E', '#F4D35E'];
function Confetti() {
  // Fixed positions (no randomness on each render), spread across the screen.
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100, delay: ((i * 53) % 30) / 10, dur: 2.6 + ((i * 17) % 20) / 10, dx: ((i * 29) % 80) - 40,
    colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length], round: i % 3 === 0,
  })), []);
  return (
    <div className="rp-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, background: b.colour, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, borderRadius: b.round ? '50%' : 2, '--dx': `${b.dx}px` }} />
      ))}
    </div>
  );
}

function Winner({ replay }) {
  const w = replay.winner;
  const big = w.players.length > 2 ? 64 : w.players.length === 2 ? 84 : 112;
  return (
    <>
      <Confetti />
      <div className="rp-center rp-winner" style={{ position: 'relative', zIndex: 2 }}>
        <div className="rp-trophy" aria-hidden="true">🏆</div>
        <div className="faces">{w.players.map((p) => <Avatar key={p.id} player={p} size={big} />)}</div>
        <div className="rp-kicker rp-in" style={{ animationDelay: '.4s' }}>{w.tiedWith.length ? 'Winner (tied)' : 'Winner'}</div>
        <div className="rp-title rp-in" style={{ animationDelay: '.5s' }} data-testid="replay-winner">{w.name}</div>
        <div className="rp-sub rp-in" style={{ animationDelay: '.6s', fontSize: 20, color: '#fff', fontWeight: 700 }}>
          {replay.unit === 'points' ? `${w.score} points` : `${w.display} net`}
          {w.tiedWith.length ? ` · level with ${w.tiedWith.join(', ')}` : w.by && !w.by.startsWith('0 ') ? ` · by ${w.by}` : ''}
        </div>
      </div>
    </>
  );
}

function Awards({ replay }) {
  const a = replay.awards;
  const list = [
    a.climber && { ic: '🚀', k: 'Biggest climber', who: a.climber, d: `${ordinal(a.climber.from)} after 3 → ${ordinal(a.climber.to)} at the end` },
    a.worst && { ic: '💥', k: 'Worst hole', who: a.worst, d: `A ${a.worst.strokes} on the ${ordinal(a.worst.hole)} (par ${a.worst.par}) — ${holeWord(a.worst.strokes, a.worst.par)}` },
    a.best && { ic: '⭐', k: 'Best hole', who: a.best, d: `A ${a.best.strokes} on the ${ordinal(a.best.hole)} (par ${a.best.par}) — ${holeWord(a.best.strokes, a.best.par)}` },
  ].filter(Boolean);
  return (
    <div className="rp-center">
      <div className="rp-kicker">The awards</div>
      <div className="rp-awards">
        {list.map((x, i) => (
          <div key={x.k} className="rp-award" style={{ animationDelay: `${0.25 + i * 0.5}s` }}>
            <span className="ic" aria-hidden="true">{x.ic}</span>
            <span style={{ minWidth: 0 }}>
              <div className="k">{x.k}</div>
              <div className="t ellipsis">{x.who.name}</div>
              <div className="d">{x.d}</div>
            </span>
            {x.who.players?.length > 1 ? <AvatarStack players={x.who.players} size={30} /> : <Avatar player={x.who.players?.[0]} size={40} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function End({ replay, round, style, setStyle, onAgain, onShare, stop }) {
  return (
    <div className="rp-center" onPointerDown={stop} onPointerUp={stop}>
      <div className="rp-kicker">That’s the replay</div>
      {replay?.winner && <div className="rp-title" style={{ fontSize: 36 }}>{replay.winner.name} {replay.winner.tiedWith.length ? (replay.teams ? 'tie it' : 'ties it') : (replay.teams ? 'win it' : 'wins it')}</div>}
      <div className="rp-actions">
        <button type="button" className="btn gold" onClick={onAgain}>↺ Watch again</button>
        <button type="button" className="btn ghost-dark" onClick={onShare}>📤 Share the replay</button>
        <Link to={`/?r=${round.id}`} className="ghost-dark" style={{ minHeight: 52 }}>Back to the leaderboard</Link>
      </div>
      <div style={{ width: '100%', maxWidth: 340, marginTop: 8 }}>
        <div className="rp-sub" style={{ fontSize: 13, marginBottom: 6 }}>Commentary</div>
        <div className="rp-style" role="group" aria-label="Commentary style">
          {STYLES.map((s) => <button key={s.key} type="button" aria-pressed={s.key === style} onClick={() => setStyle(s.key)}>{s.name}</button>)}
        </div>
      </div>
    </div>
  );
}
