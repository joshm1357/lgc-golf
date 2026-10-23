// Comps (migration 067): the picker ("What are you playing for?" cards) and the editor for one comp — name, the
// rounds that count, a trophy, and the settings for its kind (Cup sides and sessions, teams fixed or new each
// round…). Used by the guided setup and the Comps screen (CompsBoard.jsx). The rules are in lib/comps.js.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { formatName } from '../lib/board.js';
import { pts, toWin } from '../lib/cup.js';
import {
  COMP_TYPES, COMP_TYPE, fittingRounds, noRoundHint, defaultName, dayOf, cleanSettings, trophyTypeFor,
} from '../lib/comps.js';

const COLOURS = ['#1F4B9E', '#B3261E', '#1F6B3A', '#C9A227', '#5B2A86', '#E06A1B', '#111827', '#0E7490'];
const DEFAULT_SIDES = [{ name: 'Team Blue', colour: '#1F4B9E', sort: 1 }, { name: 'Team Red', colour: '#B3261E', sort: 2 }];
const FAMILIES = [...new Set(COMP_TYPES.map((t) => t.family))];
const byDate = (a, b) => String(a.play_date || a.created_at || '').localeCompare(String(b.play_date || b.created_at || ''));

/** The comp cards: pick a kind. */
export function CompCards({ onPick }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {FAMILIES.map((fam) => (
        <div key={fam} className="stack" style={{ gap: 6 }}>
          <span className="label">{fam}</span>
          {COMP_TYPES.filter((t) => t.family === fam && t.kind !== 'individual_net').map((t) => (
            <button key={t.kind} type="button" className="card pad row" onClick={() => onPick(t.kind)}
              style={{ gap: 12, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ fontSize: 26, lineHeight: 1 }}>{t.emoji}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <strong>{t.kind === 'individual_points' ? 'Over the weekend' : t.name}</strong>
                <div className="small">{t.kind === 'individual_points' ? 'Each player’s score added up over the rounds you pick — Stableford points or net strokes.' : t.description}</div>
                <div className="small muted">{t.example}</div>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Add or change one comp. comp: an existing comp (or a trophy's stand-in, comp.virtual), or null for a new one.
 * comps: the trip's comps (for the order). onStep: the guided setup's step opener (for "make Friday Ambrose first").
 */
export default function CompEditor({ trip, comp = null, comps = [], onDone, onStep }) {
  const data = useData();
  const { status } = useSession();
  const trophiesOn = useFeature('trophies');
  const [busy, run] = useRun();
  const editing = comp && !comp.virtual;
  const [kind, setKind] = useState(comp?.kind || null);
  const [name, setName] = useState(comp?.name || '');
  const tripRounds = useMemo(() => data.rounds.filter((r) => r.trip_id === trip.id).sort(byDate), [data.rounds, trip.id]);
  const t = COMP_TYPE[kind];
  const options = kind ? (t.formats ? fittingRounds(kind, tripRounds) : t.noRounds ? [] : tripRounds) : [];
  const [picked, setPicked] = useState(() => (comp?.round_ids?.length ? comp.round_ids : null)); // null = all that fit
  const chosen = picked ? options.filter((r) => picked.includes(r.id)) : t?.oneRound ? options.slice(0, 1) : options;
  const trophy = comp?.trophy_id ? data.trophies.find((x) => x.id === comp.trophy_id) : null;
  const [hasTrophy, setHasTrophy] = useState(!!comp?.trophy_id);
  const [trophyName, setTrophyName] = useState(trophy?.name || '');
  const [mode, setMode] = useState(comp?.settings?.teams || comp?.settings?.pairs || 'each_round');
  // The Cup
  const [sides, setSides] = useState(DEFAULT_SIDES);
  const [haveSides, setHaveSides] = useState([]);
  const [sessions, setSessions] = useState(comp?.settings?.sessions || {});
  const [total, setTotal] = useState(comp?.settings?.points != null ? String(comp.settings.points) : trip.cup_points != null ? String(Number(trip.cup_points)) : '');
  useEffect(() => {
    if (kind !== 'cup') return;
    supabase.from('cup_sides').select('*').order('sort').then(({ data: rows }) => {
      const list = (rows || []).filter((s) => !s.comp_id || s.comp_id === comp?.id);
      setHaveSides(list);
      if (list.length) setSides(DEFAULT_SIDES.map((d) => { const s = list.find((x) => x.sort === d.sort); return s ? { ...d, name: s.name, colour: s.colour } : d; }));
    }, () => {});
  }, [kind, comp?.id]);

  const pick = (k) => {
    setKind(k);
    setPicked(null);
    if (!name || name === defaultName(kind, trip)) setName(defaultName(k, trip));
    if (!comp?.trophy_id) setHasTrophy(k === 'individual_points' || k === 'manual');
  };
  if (!kind) {
    return (
      <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--navy)' }}>
        <strong>Trophies &amp; cups</strong>
        <CompCards onPick={pick} />
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onDone}>Cancel</button>
      </div>
    );
  }

  const toggle = (id) => {
    const cur = chosen.map((r) => r.id);
    if (t.oneRound) { setPicked([id]); return; }
    setPicked(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const hint = noRoundHint(kind, tripRounds);
  const session = (rid) => ({ format: 'ambrose', points: 2, ...(sessions[rid] || {}) });
  const setSession = (rid, patch) => setSessions({ ...sessions, [rid]: { ...session(rid), ...patch } });
  const suggested = chosen.reduce((s, r) => s + (Number(session(r.id).points) || 0) * (Number(session(r.id).matches) || 0), 0);

  const settingsNow = () => {
    const s = { ...(comp?.settings?.note ? { note: comp.settings.note } : {}) };
    if (kind === 'ambrose_teams') s.teams = mode;
    if (kind === 'fourball_pairs') s.pairs = mode;
    if (kind === 'side_comps') s.most_wins = true;
    if (kind === 'cup') {
      if (total.trim()) s.points = Number(total.replace(',', '.'));
      s.sessions = Object.fromEntries(chosen.map((r) => [r.id, session(r.id)]));
    }
    return cleanSettings(kind, s);
  };
  // Every fitting round picked: save "all of them" (new rounds of that format count too). The Cup lists its days.
  const roundIdsNow = () => {
    if (t.noRounds) return [];
    const ids = chosen.map((r) => r.id);
    if (kind !== 'cup' && !t.oneRound && ids.length === options.length && options.length > 0) return [];
    return ids;
  };
  const ok = name.trim().length >= 2 && (t.noRounds || chosen.length > 0) && (!hasTrophy || (trophyName || name).trim().length >= 2)
    && (kind !== 'cup' || sides.every((s) => s.name.trim()));

  const save = () => run(async () => {
    const row = { name: name.trim(), kind, round_ids: roundIdsNow(), settings: settingsNow() };
    let id = editing ? comp.id : null;
    if (editing) await must(supabase.from('comps').update(row).eq('id', id));
    else {
      const sort = Math.max(0, ...comps.filter((c) => !c.virtual).map((c) => c.sort || 0)) + 1;
      const made = await must(supabase.from('comps').insert({ ...row, trip_id: trip.id, sort, trophy_id: comp?.virtual ? comp.trophy_id : null, created_by: status.player_id || null }).select().single());
      id = made.id;
    }
    // The trophy: a trophies row, so the Trophy Room, the honour board and older app versions keep working.
    if (hasTrophy && !comp?.trophy_id) {
      const tr = await must(supabase.from('trophies').insert({ trip_id: trip.id, name: (trophyName || name).trim(), type: trophyTypeFor(kind) }).select().single());
      await must(supabase.from('comps').update({ trophy_id: tr.id }).eq('id', id));
    } else if (!hasTrophy && comp?.trophy_id && editing) {
      await must(supabase.from('trophies').delete().eq('id', comp.trophy_id));
    }
    // The Cup: its two sides (the comp switched the Cup on), and the whole Cup's points on the trip for older apps.
    if (kind === 'cup') {
      for (const [i, d] of DEFAULT_SIDES.entries()) {
        const s = sides[i];
        const have = haveSides.find((x) => x.sort === d.sort);
        if (have) await must(supabase.from('cup_sides').update({ name: s.name.trim(), colour: s.colour, comp_id: id }).eq('id', have.id));
        else await must(supabase.from('cup_sides').insert({ name: s.name.trim(), colour: s.colour, sort: d.sort, comp_id: id }));
      }
      if (row.settings.points) await must(supabase.from('trips').update({ cup_points: row.settings.points }).eq('id', trip.id));
    }
    await data.reload();
    onDone?.();
  }, editing ? 'Saved' : 'Added');

  const individual = kind === 'individual_points' || kind === 'individual_net';
  return (
    <div className="card pad stack" style={{ gap: 12, borderColor: 'var(--navy)' }}>
      <div className="row" style={{ gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 26 }}>{t.emoji}</span>
        <span className="grow"><strong>{individual ? 'Over the weekend' : t.name}</strong><div className="small muted">{t.description}</div></span>
        {!editing && <button type="button" className="btn ghost sm" onClick={() => setKind(null)}>Change type</button>}
      </div>

      {individual && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Count</span>
          <div className="seg" role="group" aria-label="Count">
            <button type="button" aria-pressed={kind === 'individual_points'} onClick={() => pick('individual_points')}>Stableford points</button>
            <button type="button" aria-pressed={kind === 'individual_net'} onClick={() => pick('individual_net')}>Net strokes</button>
          </div>
        </div>
      )}

      <label className="field"><span>Name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. The BD Trophy" /></label>

      {!t.noRounds && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{t.oneRound ? 'Which round' : kind === 'cup' ? 'Days (sessions) that count' : 'Rounds that count'}</span>
          {options.length ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Rounds that count">
              {options.map((r) => (
                <button key={r.id} type="button" className="chip" aria-pressed={chosen.some((x) => x.id === r.id)} onClick={() => toggle(r.id)}>
                  {dayOf(r)} · {formatName(r.format)}
                </button>
              ))}
            </div>
          ) : (
            <div className="small" style={{ fontWeight: 700 }}>
              {hint || 'No rounds yet'}.{' '}
              {onStep && <button type="button" className="btn ghost sm" onClick={() => onStep('rounds')}>Go to rounds</button>}
            </div>
          )}
          {options.length > 0 && kind !== 'cup' && !t.oneRound && chosen.length === options.length && (
            <span className="small muted">All of them — {t.formats ? `new ${t.formats.map(formatName).join('/')} rounds` : 'new rounds'} on this trip count too.</span>
          )}
          {options.length > 0 && t.formats && options.length < tripRounds.length && (
            <span className="small muted">Only {t.formats.map(formatName).join(' or ')} rounds can count.</span>
          )}
        </div>
      )}

      {(kind === 'ambrose_teams' || kind === 'fourball_pairs') && chosen.length > 1 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{kind === 'ambrose_teams' ? 'Teams' : 'Pairs'}</span>
          <div className="seg" role="group" aria-label={kind === 'ambrose_teams' ? 'Teams' : 'Pairs'}>
            <button type="button" aria-pressed={mode === 'each_round'} onClick={() => setMode('each_round')}>New each round</button>
            <button type="button" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')}>Same all trip</button>
          </div>
          <span className="small muted">{mode === 'fixed' ? 'The same teams add up their scores over the rounds.' : 'Each player carries their team’s score, added up over the rounds.'}</span>
        </div>
      )}

      {kind === 'cup' && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">The two sides</span>
          {sides.map((s, i) => (
            <div key={i} className="stack" style={{ gap: 6 }}>
              <input className="input" value={s.name} maxLength={30} aria-label={`Side ${i + 1} name`}
                onChange={(e) => setSides(sides.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ borderLeft: `6px solid ${s.colour}` }} />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {COLOURS.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={s.colour === c}
                    onClick={() => setSides(sides.map((x, j) => (j === i ? { ...x, colour: c } : x)))}
                    style={{ width: 30, height: 30, borderRadius: 999, background: c, border: s.colour === c ? '3px solid var(--gold)' : '1px solid #fff' }} />
                ))}
              </div>
            </div>
          ))}
          {chosen.length > 0 && <span className="label">Each session</span>}
          {chosen.map((r) => {
            const ses = session(r.id);
            return (
              <div key={r.id} className="card pad stack" style={{ gap: 6, background: 'var(--ground)' }}>
                <strong className="small">{r.name}</strong>
                <div className="row" style={{ gap: 6 }}>
                  {[['ambrose', 'Ambrose pairs'], ['singles', 'Singles']].map(([f, label]) => (
                    <button key={f} type="button" className="chip" aria-pressed={ses.format === f} onClick={() => setSession(r.id, { format: f, points: f === 'ambrose' ? 2 : 1 })}>{label}</button>
                  ))}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <label className="field grow"><span>Matches</span><input className="input" inputMode="numeric" aria-label={`${dayOf(r)} matches`} value={ses.matches ?? ''} placeholder="e.g. 4"
                    onChange={(e) => setSession(r.id, { matches: e.target.value === '' ? undefined : Number(e.target.value.replace(/[^0-9]/g, '')) || undefined })} /></label>
                  <label className="field grow"><span>Points a match</span><input className="input" inputMode="decimal" aria-label={`${dayOf(r)} points a match`} value={ses.points ?? ''}
                    onChange={(e) => setSession(r.id, { points: e.target.value === '' ? undefined : Number(e.target.value.replace(',', '.')) })} /></label>
                </div>
              </div>
            );
          })}
          <label className="field"><span>Points in the whole Cup</span>
            <input className="input" inputMode="decimal" value={total} placeholder={suggested ? String(suggested) : 'e.g. 28'} onChange={(e) => setTotal(e.target.value)} />
          </label>
          {suggested > 0 && !total && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTotal(String(suggested))}>Use {pts(suggested)} (the matches add up to that)</button>}
          {Number(total) > 0 && <span className="small muted">{pts(toWin(Number(total)))} to win.</span>}
          <span className="small muted">Who’s on which side and the matches themselves are set in the Cup (its jobs take you there). The team links put people straight on a side.</span>
        </div>
      )}

      {trophiesOn && (
        <div className="stack" style={{ gap: 6 }}>
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={hasTrophy} disabled={comp?.virtual} onChange={(e) => setHasTrophy(e.target.checked)} style={{ width: 24, height: 24 }} />
            <span><strong>Has a trophy</strong><div className="small muted">It goes in the Trophy Room, and the winner goes on the honour board.</div></span>
          </label>
          {hasTrophy && !comp?.trophy_id && (
            <label className="field"><span>Trophy name</span><input className="input" value={trophyName} maxLength={60} placeholder={name || 'e.g. The BD'} onChange={(e) => setTrophyName(e.target.value)} /></label>
          )}
          {hasTrophy && trophy && <span className="small muted">Trophy: {trophy.name}</span>}
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn gold" disabled={busy || !ok} onClick={save}>{editing ? 'Save' : 'Add it'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
