// The Stats screen (feature 'stats'): the season ladder (order of merit across trips), the group's records and a
// head-to-head between any two players. The maths is in src/lib/stats.js and src/lib/ladder.js.
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession, playerName } from '../lib/store.jsx';
import { currentGroup } from '../lib/group.js';
import { headToHead, records, seasonResults, seasonTrophies, historyDates, tripWinners, signed } from '../lib/stats.js';
import {
  ladderSettings, seasonRange, seasonYears, seasonLadder, parsePoints, pointsText, fmtPts, shortDate,
} from '../lib/ladder.js';
import { formatName } from '../lib/board.js';
import { Header, Seg, Avatar, Sheet, Loading, toast, Icon } from '../components/ui.jsx';
import { useStatsHistory, useSeasonSettings, Bars } from '../components/PlayerStats.jsx';

export default function Stats() {
  const [params, setParams] = useSearchParams();
  const tab = ['ladder', 'records', 'h2h'].includes(params.get('tab')) ? params.get('tab') : 'ladder';
  const { status } = useSession();
  const hist = useStatsHistory();
  const setTab = (t) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };
  return (
    <div className="page">
      <Header back title="Stats" sub={status?.look?.short_name || status?.group_name} />
      <div className="section stack">
        <Seg light value={tab} onChange={setTab} options={[{ value: 'ladder', label: 'Ladder' }, { value: 'records', label: 'Records' }, { value: 'h2h', label: 'Head-to-head' }]} />
        {!hist.loaded ? <Loading text="Adding up the numbers…" /> : (
          <>
            {tab === 'ladder' && <Ladder hist={hist} />}
            {tab === 'records' && <Records hist={hist} />}
            {tab === 'h2h' && <HeadToHead hist={hist} params={params} setParams={setParams} />}
          </>
        )}
      </div>
    </div>
  );
}

const nameOf = (data, id) => playerName(data.playersById[id]);

function PlayerCell({ data, id, sub }) {
  const p = data.playersById[id];
  return (
    <Link to={`/player/${id}`} className="row grow" style={{ gap: 8, minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
      <Avatar player={p} size={30} />
      <span className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 700 }}>{playerName(p)}</div>
        {sub && <div className="small muted ellipsis">{sub}</div>}
      </span>
    </Link>
  );
}

// ------------------------------------------------------------------ the season ladder

function Ladder({ hist }) {
  const { ctx, data } = hist;
  const { status } = useSession();
  const settings = useSeasonSettings();
  const s = ladderSettings(settings.row);
  const [year, setYear] = useState(null); // null = the group's own season (its range, or this year)
  const [editing, setEditing] = useState(false);
  const range = seasonRange(settings.row, year);
  const years = seasonYears(historyDates(ctx));
  const ladder = useMemo(() => seasonLadder({
    results: seasonResults(ctx), trophies: seasonTrophies(ctx), range, points: s.points, bonus: s.trophy_bonus,
    names: Object.fromEntries(Object.values(data.playersById).map((p) => [p.id, playerName(p)])),
  }), [ctx, range.start, range.end, s.points.join(','), s.trophy_bonus]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = ladder.rows.filter((r) => data.playersById[r.id]);
  const canEdit = status.is_admin && !status.viewing;
  const title = s.name || 'Season ladder';
  return (
    <>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="num" style={{ fontSize: 26, lineHeight: 1 }}>{title}</div>
          <div className="small muted" data-testid="season-label">{range.label} · {ladder.rounds} round{ladder.rounds === 1 ? '' : 's'}</div>
        </div>
        {canEdit && <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>{Icon.cog(16)}<span>Settings</span></button>}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Season">
        {s.mode === 'range' && <button type="button" className="chip" aria-pressed={year == null} onClick={() => setYear(null)}>This season</button>}
        {years.map((y) => (
          <button key={y} type="button" className="chip" aria-pressed={s.mode === 'range' ? year === y : (year ?? new Date().getFullYear()) === y} onClick={() => setYear(s.mode !== 'range' && y === new Date().getFullYear() ? null : y)}>{y}</button>
        ))}
      </div>
      {!rows.length ? (
        <div className="card pad muted" data-testid="ladder-empty">No finished Stableford or stroke rounds in {range.label} yet. The ladder fills in as rounds finish.</div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }} data-testid="ladder">
          {rows.map((r, i) => (
            <div key={r.id} className={'lb-row' + (i === 0 ? ' lead' : '')} style={{ gridTemplateColumns: '34px minmax(0,1fr) 56px' }} data-testid="ladder-row">
              <span className="lb-rank">{r.rankLabel}</span>
              <PlayerCell data={data} id={r.id} sub={[
                `${r.rounds} round${r.rounds === 1 ? '' : 's'}`,
                r.wins ? `${r.wins} win${r.wins === 1 ? '' : 's'}` : null,
                r.bonusPoints ? `+${fmtPts(r.bonusPoints)} trophy` : null,
              ].filter(Boolean).join(' · ')} />
              <span className="lb-main" style={{ textAlign: 'right' }}>{fmtPts(r.total)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="note" style={{ margin: 0 }}>
        Points for each finished Stableford or stroke round: {pointsText(s.points)} for 1st, 2nd, 3rd…; players tied on a place
        share the points. {s.trophy_bonus ? `Each trophy won adds ${s.trophy_bonus}.` : ''} {formatName('ambrose')} and 4BBB are team
        rounds, so they aren’t in the ladder. {s.mode === 'range' ? `This season runs ${range.custom ? range.label : `${shortDate(s.start_date)} – ${shortDate(s.end_date)}`}.` : 'A season is a calendar year.'}
      </p>
      {editing && <LadderSettings row={settings.row} onClose={() => setEditing(false)} onSaved={() => { settings.reload(); setYear(null); }} />}
    </>
  );
}

function LadderSettings({ row, onClose, onSaved }) {
  const s = ladderSettings(row);
  const [name, setName] = useState(s.name || '');
  const [mode, setMode] = useState(s.mode);
  const [start, setStart] = useState(s.start_date || `${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(s.end_date || `${new Date().getFullYear()}-12-31`);
  const [pts, setPts] = useState(pointsText(s.points));
  const [bonus, setBonus] = useState(String(s.trophy_bonus));
  const [busy, setBusy] = useState(false);
  const parsed = parsePoints(pts);
  const bonusN = Number(bonus);
  const okBonus = Number.isInteger(bonusN) && bonusN >= 0 && bonusN <= 100;
  const okRange = mode === 'year' || (start && end && end >= start);
  const okName = !name.trim() || (name.trim().length >= 2 && name.trim().length <= 40);
  const save = async () => {
    setBusy(true);
    const body = {
      group_id: currentGroup() || undefined, name: name.trim() || null, mode,
      start_date: mode === 'range' ? start : null, end_date: mode === 'range' ? end : null,
      points: parsed, trophy_bonus: bonusN,
    };
    const { error } = await supabase.from('season_settings').upsert(body, { onConflict: 'group_id' });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast('Ladder settings saved');
    onSaved();
    onClose();
  };
  return (
    <Sheet title="Season ladder settings" onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Name (optional)</span><input className="input" value={name} maxLength={40} placeholder="Season ladder" onChange={(e) => setName(e.target.value)} /></label>
        <Seg light value={mode} onChange={setMode} options={[{ value: 'year', label: 'Calendar year' }, { value: 'range', label: 'Own dates' }]} />
        {mode === 'range' && (
          <div className="row" style={{ gap: 8 }}>
            <label className="field grow"><span>Starts</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="field grow"><span>Ends</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
        )}
        <label className="field"><span>Points for 1st, 2nd, 3rd…</span><input className="input" inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value)} aria-invalid={!parsed} /></label>
        {!parsed && <span className="small" style={{ color: 'var(--down)' }}>Whole numbers 0–100, split by dashes, e.g. 10-8-6-5-4-3-2-1</span>}
        <label className="field"><span>Bonus for each trophy won</span><input className="input" type="number" min="0" max="100" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value)} /></label>
        {!okRange && <span className="small" style={{ color: 'var(--down)' }}>The end date has to be after the start.</span>}
        <button type="button" className="btn block" disabled={busy || !parsed || !okBonus || !okRange || !okName} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <span className="small muted">Everyone in the group sees the same ladder. Changing the points re-works the whole season.</span>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ records

function Records({ hist }) {
  const { ctx, data } = hist;
  const rec = useMemo(() => records(ctx, { winners: tripWinners(ctx) }), [ctx]);
  const empty = !rec.bestRounds.length && !rec.mostBirdies.length && !rec.mostTripWins.length;
  if (empty) return <div className="card pad muted">No records yet — they appear once rounds are finished.</div>;
  // Equal values share a place (T1), like the leaderboard.
  const place = (items, value, i) => {
    const v = value(items[i]);
    const first = items.findIndex((y) => value(y) === v);
    return (items.filter((y) => value(y) === v).length > 1 ? 'T' : '') + (first + 1);
  };
  const List = ({ title, testid, items, render, value }) => (items.length ? (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">{title}</span>
      <div className="card" style={{ overflow: 'hidden' }} data-testid={testid}>
        {items.map((x, i) => (
          <div key={i} className={'lb-row' + (i === 0 ? ' lead' : '')} style={{ gridTemplateColumns: '26px minmax(0,1fr) auto' }}>
            <span className="lb-rank">{place(items, value, i)}</span>
            {render(x)}
          </div>
        ))}
      </div>
    </div>
  ) : null);
  return (
    <>
      <List title="Best rounds" testid="rec-best" items={rec.bestRounds} value={(x) => x.score} render={(x) => (
        <>
          <PlayerCell data={data} id={x.playerId} sub={`${shortDate(x.date)} · ${x.round.name}${x.course ? ` · ${x.course.name}` : ''}`} />
          <span className="lb-main" style={{ fontSize: 20 }}>{x.points}<span className="small"> pts</span></span>
        </>
      )} />
      <List title="Most birdies" testid="rec-birdies" items={rec.mostBirdies} value={(x) => x.total} render={(x) => (
        <>
          <PlayerCell data={data} id={x.playerId} sub={`${x.holes} holes${x.eagles ? ` · ${x.eagles} eagle${x.eagles === 1 ? '' : 's'} or better` : ''}`} />
          <span className="lb-main" style={{ fontSize: 20 }}>{x.total}</span>
        </>
      )} />
      <List title="Most trip wins" testid="rec-trips" items={rec.mostTripWins} value={(x) => x.wins} render={(x) => (
        <>
          <PlayerCell data={data} id={x.playerId} />
          <span className="lb-main" style={{ fontSize: 20 }}>{x.wins}</span>
        </>
      )} />
      <p className="note" style={{ margin: 0 }}>Best rounds are ranked against handicap (Stableford points, or points worked out from a stroke play card). Birdies are gross, from every hole players scored themselves. A trip is won on its Stableford trophy — the engraved winner if there is one.</p>
    </>
  );
}

// ------------------------------------------------------------------ head-to-head

function HeadToHead({ hist, params, setParams }) {
  const { ctx, data } = hist;
  const { status } = useSession();
  const players = data.players.filter((p) => p.approved !== false).sort((x, y) => playerName(x).localeCompare(playerName(y)));
  const a = data.playersById[params.get('a')] ? params.get('a') : status.player_id;
  const firstOther = players.find((p) => p.id !== a)?.id || '';
  const b = data.playersById[params.get('b')] && params.get('b') !== a ? params.get('b') : firstOther;
  const pick = (k, v) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };
  const h = useMemo(() => headToHead(ctx, a, b), [ctx, a, b]);
  const an = nameOf(data, a);
  const bn = nameOf(data, b);
  const Select = ({ k, value, label }) => (
    <label className="field grow" style={{ minWidth: 0 }}>
      <span>{label}</span>
      <select className="select" aria-label={label} value={value} onChange={(e) => pick(k, e.target.value)}>
        {players.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
      </select>
    </label>
  );
  const verdict = h.a === h.b ? 'All square' : `${h.a > h.b ? an : bn} leads`;
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <Select k="a" value={a} label="Player" />
        <span className="muted" style={{ paddingTop: 22, fontWeight: 700 }}>v</span>
        <Select k="b" value={b} label="Against" />
      </div>
      {a === b || !b ? <div className="card pad muted">Pick two different players.</div> : (
        <>
          <div className="card pad stack" style={{ alignItems: 'center', gap: 4 }} data-testid="h2h-summary">
            <div className="row" style={{ gap: 14, justifyContent: 'center' }}>
              <Avatar player={data.playersById[a]} size={44} />
              <span className="num" style={{ fontSize: 40, lineHeight: 1 }} data-testid="h2h-score">{h.a} – {h.b}</span>
              <Avatar player={data.playersById[b]} size={44} />
            </div>
            <div style={{ fontWeight: 700 }}>{h.rounds.length ? verdict : 'No rounds together yet'}</div>
            <div className="small muted" style={{ textAlign: 'center' }}>
              {h.rounds.length ? `${h.rounds.length} round${h.rounds.length === 1 ? '' : 's'} both finished${h.halves ? ` · ${h.halves} halved` : ''}` : 'Head-to-heads count Stableford and stroke rounds you both finished.'}
              {h.avgMargin ? ` · ${h.avgMargin > 0 ? an : bn} by ${Math.abs(h.avgMargin)} a round on average` : ''}
            </div>
          </div>
          {h.rounds.length > 1 && (
            <Bars values={h.rounds.map((x) => x.margin)} tops={h.rounds.map((x) => (x.margin > 0 ? `+${x.margin}` : x.margin))}
              labels={h.rounds.map((x) => shortDate(x.date).split(' ').slice(1).join(' '))}
              zeroLabel={`up = ${an}`} aria={`Margins round by round, ${an} positive`} />
          )}
          {h.rounds.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }} data-testid="h2h-rounds">
              {[...h.rounds].reverse().map((x) => (
                <div key={x.round.id} className="lb-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 700 }}>{x.round.name}</div>
                    <div className="small muted">{formatName(x.format)} · {shortDate(x.date)} · {x.format === 'stroke' && x.unit === 'shots' ? `net ${signed(x.a.netToPar, { level: 'E', dp: 0 })} v ${signed(x.b.netToPar, { level: 'E', dp: 0 })}` : `${x.a.points} v ${x.b.points} pts`}</div>
                  </span>
                  <span className="small" style={{ fontWeight: 700, textAlign: 'right', color: x.winner === 'half' ? 'var(--muted)' : x.winner === 'a' ? 'var(--up)' : 'var(--down)' }}>
                    {x.winner === 'half' ? 'Halved' : `${x.winner === 'a' ? an : bn} by ${Math.abs(x.margin)}${x.unit === 'pts' ? (Math.abs(x.margin) === 1 ? ' pt' : ' pts') : ''}`}
                  </span>
                </div>
              ))}
            </div>
          )}
          {(h.team.rounds.length > 0 || h.partners > 0) && (
            <div className="card pad small stack" style={{ gap: 4 }} data-testid="h2h-team">
              {h.team.rounds.length > 0 && <div><strong>Team rounds on opposite sides</strong> (Ambrose, 4BBB): {an} {h.team.a} – {h.team.b} {bn}{h.team.halves ? ` · ${h.team.halves} level` : ''}</div>}
              {h.partners > 0 && <div><strong>As partners:</strong> {h.partners} round{h.partners === 1 ? '' : 's'}, {h.partnerWins} won</div>}
            </div>
          )}
          <p className="note" style={{ margin: 0 }}>Stableford: more points wins; stroke play: lower net wins. Margins are net points or shots.</p>
        </>
      )}
    </>
  );
}
