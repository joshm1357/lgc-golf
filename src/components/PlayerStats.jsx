// Player stats (feature 'stats'): the data hook, the simple SVG charts, and the Stats card on a player's profile.
// All the maths is in src/lib/stats.js; this file only loads and shows it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useFeature, useRealtime } from '../lib/store.jsx';
import { buildHistory, playerStats, signed } from '../lib/stats.js';
import { shortDate } from '../lib/ladder.js';
import { formatName } from '../lib/board.js';
import { Icon } from './ui.jsx';

const PAGE = 1000; // the database hands back at most 1000 rows at a time
const CHUNK = 40; // rounds per request (keeps the address short)

/** Every score for the given rounds, read a page at a time (a few years of trips is well over 1000 rows). */
export function useAllScores(roundIds) {
  const key = [...roundIds].sort().join(',');
  const [state, setState] = useState({ index: {}, loaded: false });
  useEffect(() => {
    let dead = false;
    const ids = key ? key.split(',') : [];
    (async () => {
      const rows = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase.from('scores')
            .select('round_id,subject_id,hole,strokes,picked_up,updated_at')
            .in('round_id', chunk).order('round_id').order('subject_id').order('hole')
            .range(from, from + PAGE - 1);
          if (error || !data) break;
          rows.push(...data);
          if (data.length < PAGE) break;
        }
      }
      if (dead) return;
      const index = {};
      for (const r of rows) ((index[r.round_id] ||= {})[r.subject_id] ||= {})[r.hole] = r;
      setState({ index, loaded: true });
    })().catch(() => !dead && setState((s) => ({ ...s, loaded: true })));
    return () => { dead = true; };
  }, [key]);
  return state;
}

/** The whole group's history, ready for the stats (lib/stats.js buildHistory). */
export function useStatsHistory() {
  const data = useData();
  const { index, loaded } = useAllScores(data.rounds.map((r) => r.id));
  const ctx = useMemo(() => buildHistory(data, index), [data, index]);
  return { ctx, loaded, data };
}

/** The group's season ladder settings (null = the defaults), live. */
export function useSeasonSettings() {
  const [row, setRow] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('season_settings').select('*').limit(1);
    if (!error) setRow(data?.[0] || null);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['season_settings'], load);
  return { row, loaded, reload: load };
}

// ------------------------------------------------------------------ charts (plain SVG)

const GOOD = 'var(--up)';
const BAD = 'var(--down)';

/**
 * Bars up and down from a middle line. values: numbers (+ = good when goodUp); labels under each bar; tops: text
 * over each bar.
 */
export function Bars({ values, labels = [], tops = [], height = 120, goodUp = true, aria, zeroLabel }) {
  if (!values.length) return null;
  const w = 320;
  const pad = { l: 6, r: 6, t: 16, b: 18 };
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const mid = pad.t + (height - pad.t - pad.b) / 2;
  const half = (height - pad.t - pad.b) / 2 - 2;
  const slot = (w - pad.l - pad.r) / values.length;
  const bw = Math.max(4, Math.min(34, slot * 0.66));
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={aria} style={{ display: 'block' }}>
      <line x1={pad.l} x2={w - pad.r} y1={mid} y2={mid} stroke="var(--line)" strokeWidth="1.5" />
      {zeroLabel && <text x={w - pad.r} y={mid - 4} textAnchor="end" fontSize="9" fill="var(--muted)">{zeroLabel}</text>}
      {values.map((v, i) => {
        const x = pad.l + slot * i + (slot - bw) / 2;
        const hgt = Math.max(2, (Math.abs(v) / max) * half);
        const up = v >= 0;
        const good = goodUp ? v > 0 : v < 0;
        const fill = Math.abs(v) < 1e-9 ? 'var(--muted)' : good ? GOOD : BAD;
        const y = up ? mid - hgt : mid;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={hgt} rx="2" fill={fill} opacity="0.85" />
            {tops[i] != null && <text x={x + bw / 2} y={up ? y - 3 : y + hgt + 10} textAnchor="middle" fontSize={slot < 20 ? 8 : 11} fontWeight="700" fill="var(--text)">{tops[i]}</text>}
            {labels[i] != null && <text x={x + bw / 2} y={height - 4} textAnchor="middle" fontSize={slot < 20 ? 8 : 10} fill="var(--muted)">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const MIX = [
  ['eagles', 'Eagles+', 'var(--gold)'],
  ['birdies', 'Birdies', 'var(--up)'],
  ['pars', 'Pars', 'var(--navy)'],
  ['bogeys', 'Bogeys', '#8FA0B5'],
  ['doubles', 'Doubles+', 'var(--down)'],
];

/** How a player's holes went: one bar split eagles / birdies / pars / bogeys / doubles, with the counts. */
export function ScoringMix({ counts }) {
  if (!counts?.holes) return null;
  let x = 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <svg viewBox="0 0 320 18" width="100%" height="18" role="img" aria-label={MIX.map(([k, l]) => `${l} ${counts[k]}`).join(', ')} style={{ display: 'block' }}>
        {MIX.map(([k, , c]) => {
          const wd = (counts[k] / counts.holes) * 320;
          const el = wd > 0 ? <rect key={k} x={x} y="0" width={wd} height="18" fill={c} /> : null;
          x += wd;
          return el;
        })}
      </svg>
      <div className="row small" style={{ flexWrap: 'wrap', gap: '4px 12px' }}>
        {MIX.filter(([k]) => k !== 'eagles' || counts.eagles).map(([k, l, c]) => (
          <span key={k} className="row" style={{ gap: 5 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} /><strong>{counts[k]}</strong> {l.toLowerCase()}</span>
        ))}
      </div>
    </div>
  );
}

const avgToPar = (v) => signed(v, { level: 'par', dp: 1 });

/** Best and worst holes on one course, with an 18-bar chart (strokes vs par, lower is better). */
function CourseHoles({ c }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Bars values={c.holes.map((h) => h.avg)} labels={c.holes.map((h) => h.n)} goodUp={false} height={96}
        aria={`Average strokes over par on each hole at ${c.course.name}`} />
      <div className="small"><strong style={{ color: 'var(--up)' }}>Best:</strong> {c.best.map((h) => `${h.n} (${avgToPar(h.avg)})`).join(' · ') || '–'}</div>
      <div className="small"><strong style={{ color: 'var(--down)' }}>Worst:</strong> {c.worst.map((h) => `${h.n} (${avgToPar(h.avg)})`).join(' · ') || '–'}</div>
    </div>
  );
}

function Tile({ k, v, sub }) {
  return (
    <div className="card" style={{ padding: '10px 6px', textAlign: 'center', minWidth: 0 }}>
      <div className="num" style={{ fontSize: 24, lineHeight: 1.1 }}>{v}</div>
      <div className="small muted">{k}</div>
      {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

/** The Stats card on a player's profile. Hidden when the feature is off. */
export function PlayerStatsCard({ playerId }) {
  const on = useFeature('stats');
  if (!on) return null;
  return <PlayerStatsInner playerId={playerId} />;
}

function PlayerStatsInner({ playerId }) {
  const { ctx, loaded } = useStatsHistory();
  const s = useMemo(() => playerStats(ctx, playerId), [ctx, playerId]);
  const [courseIx, setCourseIx] = useState(0);
  const course = s.courses[Math.min(courseIx, s.courses.length - 1)];
  const nothing = !s.roundsPlayed;
  return (
    <div className="card pad stack" data-testid="player-stats">
      <div className="row between">
        <span className="label">Stats</span>
        <Link to={`/stats?tab=h2h&a=${playerId}`} className="small" style={{ fontWeight: 700, color: 'var(--navy)' }}>Head-to-heads & ladder ›</Link>
      </div>
      {!loaded ? <span className="muted small">Adding up the numbers…</span> : nothing ? (
        <span className="muted small">No rounds yet — stats appear after the first round.</span>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <Tile k="Plays to" v={s.playsTo ?? '–'} sub={s.playedOff != null ? `off ${s.playedOff}` : null} />
            <Tile k="Avg net" v={s.avgNet != null ? signed(s.avgNet, { level: 'E' }) : '–'} sub="to par" />
            <Tile k="Trips won" v={s.tripsWon} sub={s.trophies ? `${s.trophies} troph${s.trophies === 1 ? 'y' : 'ies'}` : null} />
          </div>
          {s.playsTo != null && (
            <div className="small" data-testid="plays-to">
              Plays to <strong>{s.playsTo}</strong> vs handicap <strong>{s.playedOff}</strong>
              {' — '}{Math.abs(s.vsHandicap) < 0.05 ? 'right on it' : `${Math.abs(s.vsHandicap)} shot${Math.abs(s.vsHandicap) === 1 ? '' : 's'} ${s.vsHandicap < 0 ? 'better' : 'worse'} a round`}
              {s.avgPoints != null && <> · averages <strong>{s.avgPoints}</strong> pts</>}.
            </div>
          )}
          {s.best && (
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }} data-testid="best-round">
              <span style={{ color: 'var(--gold)' }}>{Icon.trophy(18)}</span>
              <span className="small"><strong>Best round: {s.best.points} pts</strong>{s.best.format === 'stroke' && s.best.netToPar != null ? ` (net ${signed(s.best.netToPar, { level: 'E', dp: 0 })})` : ''} — {s.best.round.name}{s.best.course ? `, ${s.best.course.name}` : ''} · {shortDate(s.best.date)}</span>
            </div>
          )}
          {s.form.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Form — last {s.form.length}</span>
              <Bars values={s.form.map((f) => f.vsExpected)} tops={s.form.map((f) => f.points)} labels={s.form.map((f) => shortDate(f.date).split(' ').slice(0, 2).join(' '))}
                zeroLabel="36 pts" aria={`Last ${s.form.length} rounds: ${s.form.map((f) => `${f.points} points`).join(', ')}`} />
            </div>
          )}
          {s.counts.holes > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="label">Every hole ({s.counts.holes})</span>
              <ScoringMix counts={s.counts} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }} data-testid="par-types">
                {[3, 4, 5].map((p) => <Tile key={p} k={`Par ${p}s`} v={s.parTypes[p].n ? avgToPar(s.parTypes[p].avg) : '–'} sub={s.parTypes[p].n ? `${s.parTypes[p].n} played` : null} />)}
              </div>
            </div>
          )}
          {course && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="label">Best and worst holes</span>
              {s.courses.length > 1 && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {s.courses.map((c, i) => <button key={c.course.id} type="button" className="chip" aria-pressed={c === course} onClick={() => setCourseIx(i)}>{c.course.name}</button>)}
                </div>
              )}
              <div className="small muted">{course.course.name} · {course.rounds} round{course.rounds === 1 ? '' : 's'} · average strokes over par</div>
              <CourseHoles c={course} />
            </div>
          )}
          {s.team.played > 0 && (
            <div className="small" data-testid="team-results">
              <strong>Team rounds</strong> (Ambrose, 4BBB): {s.team.played} played · {s.team.wins} won{s.team.avgFinish != null ? ` · average finish ${s.team.avgFinish}` : ''}
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            From {s.individualRounds} finished Stableford / stroke round{s.individualRounds === 1 ? '' : 's'}. “Plays to”: 36 points is playing to your handicap. A pick-up counts as a net double bogey; {formatName('ambrose')} counts for team results only.
          </p>
        </>
      )}
    </div>
  );
}

/** A link to the Stats screen, for the Trophy Room (hidden when the feature is off). */
export function StatsLink({ style }) {
  if (!useFeature('stats')) return null;
  return <Link to="/stats" className="small" style={{ color: '#EBD496', fontWeight: 700, ...style }}>📈 Season ladder, records & head-to-heads ›</Link>;
}
