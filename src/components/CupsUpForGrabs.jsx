// "What's up for grabs" — the group's cups for this trip (ov32, migration 101). In the run-up (compact, via
// runupSlots.jsx → CompsOnTheDay) and on Organise step 6 (CompsOnTheDay, full). Josh: "When you set up a cup you select
// what it is for in general, i.e. in the group. Then you choose which one is up for grabs that trip and set specifics,
// i.e. what round etc. The selection of the cups up for grabs should be in the run-up. Or create another, and it goes
// into a cup that can be allocated to the weekend."
//   * Organisers: tick which of the group's cups are on (none is on by default), set the specifics (which rounds count,
//     what counts and how many points), "+ New cup" (saved to the library and put on this trip), and "Do you have a
//     cup for this?" (a photo and who has it now — or "Not yet": a reminder and "Get one: coming soon").
//   * Players: the cups that are on, read-only, with one plain line on how to win.
// Maths and defaults: lib/cups.js. Test ids are cups-*.
import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { uploadPhoto } from '../lib/images.js';
import { cleanSettings, trophyTypeFor, fittingRounds, dayOf } from '../lib/comps.js';
import {
  PURPOSES, PURPOSE, GOLF_FORMATS, GOLF_FORMAT, SOURCES, LATER_SOURCES, CAP_TIP_NAMES, defaultCounts, cleanCounts, compForCup,
  cupsForTrip, howToWin, trophyReminder, kindForCup,
} from '../lib/cups.js';
import { useTripComps } from './CompsChip.jsx';
import { useCups, useCapTipName, CupPhoto } from './CupStandings.jsx';
import ComingSoon from './ComingSoon.jsx';
import { Sheet } from './ui.jsx';

const FORMAT_WORD = { stableford: 'Stableford', stroke: 'Stroke', ambrose: 'Ambrose', fourball: '4BBB' };
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

/** Put a library cup up for grabs on a trip: its comp (unticked before → ticked again) and a trophy for the hand-over. */
async function turnOn(cup, trip, allComps) {
  const old = (allComps || []).find((c) => c.trip_id === trip.id && c.cup_id === cup.id);
  if (old) { await must(supabase.from('comps').update({ retired: false }).eq('id', old.id)); return old.id; }
  const sort = Math.max(0, ...(allComps || []).filter((c) => c.trip_id === trip.id).map((c) => Number(c.sort) || 0)) + 1;
  const id = uuid();
  const row = compForCup(cup, trip, { sort });
  await must(supabase.from('comps').insert({ id, ...row, settings: cleanSettings(row.kind, row.settings) }));
  // A trophy row, so the Trophy Room, the honour board and the hand-over work as for any comp (and older app versions).
  const trophyId = uuid();
  const { error } = await supabase.from('trophies').insert({ id: trophyId, trip_id: trip.id, name: cup.name, type: trophyTypeFor(row.kind) });
  if (!error) await supabase.from('comps').update({ trophy_id: trophyId }).eq('id', id);
  return id;
}

export default function CupsUpForGrabs({ trip, isOrg }) {
  const [cups, reloadCups] = useCups();
  const [, reloadComps, allComps] = useTripComps(trip?.id);
  const cupOn = useFeature('cup');
  const [busy, run] = useRun();
  const [making, setMaking] = useState(false);
  const [editing, setEditing] = useState(null); // { cup, comp }
  const list = useMemo(() => (trip ? cupsForTrip({ cups, comps: allComps, tripId: trip.id }) : []), [cups, allComps, trip]);
  // The Cup (match play) stays Kurt's group's: hidden where the Cup feature is off.
  const shown = list.filter((x) => (cupOn || x.cup.format !== 'match_play') && (isOrg || x.on));
  if (!trip) return null;
  const toggle = (x) => run(async () => {
    if (x.on) await must(supabase.from('comps').update({ retired: true }).eq('id', x.comp.id));
    else await turnOn(x.cup, trip, allComps);
    await reloadComps();
  }, x.on ? `${x.cup.name} is off for this trip` : `${x.cup.name} is up for grabs`);
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="cups-grabs">
      {!shown.length && <span className="small muted">{isOrg ? 'No group cups yet. Make one for this weekend:' : 'No group cups on for this trip yet.'}</span>}
      {shown.map((x) => (
        <div key={x.cup.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }} data-testid="cups-row">
          <label className="row" style={{ gap: 10, minHeight: 44, alignItems: 'center' }}>
            {isOrg && <input type="checkbox" checked={x.on} disabled={busy} onChange={() => toggle(x)} style={{ width: 22, height: 22, flex: 'none' }} aria-label={x.cup.name} data-testid="cups-tick" />}
            <span className="grow" style={{ minWidth: 0 }}>
              <strong>{PURPOSE[x.cup.purpose]?.emoji} {x.cup.name}</strong>
              <span className="small muted" style={{ display: 'block' }}>
                {x.cup.purpose === 'golf' ? GOLF_FORMAT[x.cup.format]?.name || 'Golf' : PURPOSE[x.cup.purpose]?.name}{x.on ? ' · on this trip' : ''}
              </span>
            </span>
            {isOrg && x.on && <button type="button" className="btn ghost sm" onClick={(e) => { e.preventDefault(); setEditing(x); }} data-testid="cups-specifics">Specifics</button>}
          </label>
          {x.on && <span className="small" data-testid="cups-how">{howToWin(x.comp, x.cup)}</span>}
          {x.on && <TrophyBits cup={x.cup} isOrg={isOrg} onSaved={reloadCups} />}
        </div>
      ))}
      {isOrg && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMaking(true)} data-testid="cups-new">+ New cup</button>}
      {making && <NewCupSheet trip={trip} cupOn={cupOn} onClose={() => setMaking(false)} onSaved={async () => { await Promise.all([reloadCups(), reloadComps()]); }} allComps={allComps} />}
      {editing && <SpecificsSheet trip={trip} cup={editing.cup} comp={editing.comp} onClose={() => setEditing(null)} onSaved={reloadComps} />}
    </div>
  );
}

// ------------------------------------------------------------------ "Do you have a cup for this?"

function TrophyBits({ cup, isOrg, onSaved }) {
  const [asking, setAsking] = useState(false);
  const reminder = trophyReminder(cup);
  if (cup.has_trophy === true) {
    return (
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <CupPhoto comp={{ cup_id: cup.id }} cups={[cup]} size={44} />
        {isOrg && <button type="button" className="btn ghost sm" onClick={() => setAsking(true)} data-testid="cups-trophy-edit">{cup.trophy_photo_url || cup.held_by ? 'Change photo / who has it' : '📷 Add a photo / who has it'}</button>}
        {asking && <TrophySheet cup={cup} onClose={() => setAsking(false)} onSaved={onSaved} />}
      </div>
    );
  }
  if (reminder) {
    return (
      <div className="stack" style={{ gap: 4, background: 'var(--gold-soft)', borderRadius: 10, padding: '6px 10px' }} data-testid="cups-reminder">
        <span className="small"><strong>{reminder}</strong></span>
        <ComingSoon feature="trophy_shop" label={cup.name} />
        {isOrg && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAsking(true)}>We’ve got one now</button>}
        {asking && <TrophySheet cup={cup} onClose={() => setAsking(false)} onSaved={onSaved} />}
      </div>
    );
  }
  if (!isOrg) return null;
  return <TrophyAsk cup={cup} onSaved={onSaved} />;
}

/** The question, asked when a cup is picked without a real trophy recorded. */
function TrophyAsk({ cup, onSaved }) {
  const [busy, run] = useRun();
  const [yes, setYes] = useState(false);
  const notYet = () => run(async () => { await must(supabase.from('cups').update({ has_trophy: false }).eq('id', cup.id)); await onSaved?.(); });
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-testid="cups-trophy-ask">
      <span className="small">Do you have a cup for this?</span>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setYes(true)} data-testid="cups-trophy-yes">Yes</button>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={notYet} data-testid="cups-trophy-notyet">Not yet</button>
      {yes && <TrophySheet cup={cup} onClose={() => setYes(false)} onSaved={onSaved} />}
    </div>
  );
}

/** "Yes": an optional photo of the real cup and who has it now. */
function TrophySheet({ cup, onClose, onSaved }) {
  const data = useData();
  const [file, setFile] = useState(null);
  const [held, setHeld] = useState(cup.held_by || '');
  const [busy, run] = useRun();
  const people = (data.players || []).filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const save = () => run(async () => {
    const url = file ? await uploadPhoto(file, 'cups') : cup.trophy_photo_url || null;
    await must(supabase.from('cups').update({ has_trophy: true, trophy_photo_url: url, held_by: held || null }).eq('id', cup.id));
    await onSaved?.();
    onClose();
  }, 'Saved — it shows in the Trophy Room and on the results');
  return (
    <Sheet title={`The real ${cup.name}`} onClose={onClose}>
      <div className="stack" data-testid="cups-trophy-sheet">
        <label className="field"><span>A photo of it (optional)</span><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        <label className="field"><span>Who has it now? (optional)</span>
          <select className="select" value={held} onChange={(e) => setHeld(e.target.value)} data-testid="cups-held-by">
            <option value="">Not sure</option>
            {people.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
          </select>
        </label>
        <button type="button" className="btn gold block" disabled={busy} onClick={save} data-testid="cups-trophy-save">Save</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ a new cup

function NewCupSheet({ trip, cupOn, allComps, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('social');
  const [format, setFormat] = useState('stableford');
  const [description, setDescription] = useState('');
  const [trophy, setTrophy] = useState(null); // true | false | null
  const [busy, run] = useRun();
  const formats = GOLF_FORMATS.filter((f) => cupOn || !f.needsCup);
  const save = () => run(async () => {
    if (name.trim().length < 2) throw new Error('Give it a name');
    const cup = {
      id: uuid(), name: name.trim().slice(0, 60), purpose, format: purpose === 'golf' ? format : null,
      description: description.trim() || null, counts: defaultCounts(purpose), has_trophy: trophy,
    };
    await must(supabase.from('cups').insert(cup));
    if (trip) await turnOn(cup, trip, allComps);
    await onSaved?.();
    onClose();
  }, `${name.trim()} saved to the group’s cups${trip ? ' and put up for grabs' : ''}`);
  return (
    <Sheet title="A new cup" onClose={onClose}>
      <div className="stack" data-testid="cups-new-sheet">
        <label className="field"><span>Name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Weekend Cup" data-testid="cups-new-name" /></label>
        <span className="label">What it’s for</span>
        {PURPOSES.map((p) => (
          <button key={p.key} type="button" className="card pad row" aria-pressed={purpose === p.key} onClick={() => setPurpose(p.key)} data-testid={`cups-purpose-${p.key}`}
            style={{ gap: 10, textAlign: 'left', color: 'inherit', borderColor: purpose === p.key ? 'var(--navy)' : undefined, borderWidth: purpose === p.key ? 2 : 1 }}>
            <span aria-hidden="true" style={{ fontSize: 22 }}>{p.emoji}</span>
            <span className="grow"><strong>{p.name}</strong><span className="small muted" style={{ display: 'block' }}>{p.blurb}</span></span>
          </button>
        ))}
        {purpose === 'golf' && (
          <label className="field"><span>Decided by</span>
            <select className="select" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="cups-new-format">
              {formats.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>A line about it (optional)</span><input className="input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Best all-rounder of the weekend" /></label>
        <span className="label">Do you have a cup for this?</span>
        <div className="seg light" role="group" aria-label="Do you have a cup for this?">
          <button type="button" aria-pressed={trophy === true} onClick={() => setTrophy(true)} data-testid="cups-new-trophy-yes">Yes</button>
          <button type="button" aria-pressed={trophy === false} onClick={() => setTrophy(false)} data-testid="cups-new-trophy-notyet">Not yet</button>
        </div>
        {trophy === true && <span className="small muted">Once it’s saved, add a photo of it and who has it now (next to the cup).</span>}
        {trophy === false && <span className="small muted">We’ll remind you in the run-up to sort one before the presentation.</span>}
        <button type="button" className="btn gold block" disabled={busy || name.trim().length < 2} onClick={save} data-testid="cups-new-save">Save{trip ? ' and put it up for grabs' : ''}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ the specifics for this trip

function SpecificsSheet({ trip, cup, comp, onClose, onSaved }) {
  const data = useData();
  const [nameKey, setNameKey] = useCapTipName();
  const { status } = useSession();
  const tripRounds = useMemo(() => (data.rounds || []).filter((r) => r.trip_id === trip.id).sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || ''))), [data.rounds, trip.id]);
  const social = comp.kind === 'manual' && ['social', 'combined'].includes(comp.settings?.cup);
  const eclectic = comp.settings?.cup === 'eclectic';
  const [roundIds, setRoundIds] = useState(() => (eclectic ? comp.settings?.rounds || [] : comp.round_ids || []));
  const [net, setNet] = useState(comp.settings?.net !== false);
  const [counts, setCounts] = useState(() => {
    const base = defaultCounts(comp.settings?.cup || cup.purpose);
    const have = comp.settings?.counts || {};
    return Object.fromEntries(SOURCES.map((s) => [s.key, { ...base[s.key], ...(have[s.key] || {}), on: !!(have[s.key]?.on ?? base[s.key]?.on) }]));
  });
  const [busy, run] = useRun();
  const kind = kindForCup(cup);
  const roundChoices = eclectic ? tripRounds.filter((r) => r.format !== 'ambrose') : social ? tripRounds : fittingRounds(kind, tripRounds);
  const setSrc = (k, patch) => setCounts((c) => ({ ...c, [k]: { ...c[k], ...patch } }));
  const save = () => run(async () => {
    let patch;
    if (social) patch = { settings: cleanSettings('manual', { ...comp.settings, counts: cleanCounts(counts) }) };
    else if (eclectic) patch = { settings: cleanSettings('manual', { ...comp.settings, rounds: roundIds, net }) };
    else patch = { round_ids: roundIds };
    await must(supabase.from('comps').update(patch).eq('id', comp.id));
    await onSaved?.();
    onClose();
  }, 'Saved');
  const chip = (r, on, flip) => (
    <button key={r.id} type="button" className="chip" aria-pressed={on} onClick={flip} data-testid="cups-round">
      {dayOf(r)} · {FORMAT_WORD[r.format] || r.format}
    </button>
  );
  const numField = (k, f, label) => (
    <label key={f} className="row small" style={{ gap: 6 }}>
      <span className="grow">{label}</span>
      <input className="input" style={{ width: 64, minHeight: 36 }} inputMode="decimal" value={counts[k]?.[f] ?? ''} aria-label={`${SOURCES.find((s) => s.key === k)?.name}: ${label}`}
        onChange={(e) => setSrc(k, { [f]: e.target.value.replace(/[^\d.-]/g, '').slice(0, 5) })} data-testid={`cups-${k}-${f}`} />
    </label>
  );
  const LABELS = {
    per_win: 'Points per win', per_right: 'Points per tip right', per_stroke: 'Points per breach (minus)', ctp: 'Closest to the pin', ld: 'Longest drive',
    own: 'Your own comps', dot: 'Each dot (greenie…)', penalty_dot: 'Each penalty dot (three-putt, snake…)', allowance: 'How many each player can give',
    per: 'Points each', max_same: 'Most to the same person', post: 'A post', photo: 'A photo', video: 'A video', daily_cap: 'Most a day, each',
  };
  return (
    <Sheet title={`${cup.name}: this trip`} onClose={onClose}>
      <div className="stack" data-testid="cups-specifics-sheet">
        <span className="small muted">{howToWin({ ...comp, settings: social ? { ...comp.settings, counts } : comp.settings }, cup)}</span>
        {!social && kind === 'cup' && <span className="small">Set the sides and matches on the Cup screen.</span>}
        {!social && kind !== 'cup' && (
          <>
            <span className="label">Which rounds count</span>
            {!roundChoices.length && <span className="small muted">No {eclectic ? 'stroke or Stableford' : GOLF_FORMAT[cup.format]?.name || ''} round on this trip yet. Set a round’s format on the round first.</span>}
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {roundChoices.map((r) => chip(r, roundIds.includes(r.id), () => setRoundIds(roundIds.includes(r.id) ? roundIds.filter((x) => x !== r.id) : [...roundIds, r.id])))}
            </div>
            <span className="small muted">{roundIds.length ? '' : 'None picked = every round that fits.'} A round’s format is set on the round.</span>
            {eclectic && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={net} onChange={(e) => setNet(e.target.checked)} /> <span>Net (after handicap shots)</span></label>}
          </>
        )}
        {social && (
          <>
            <span className="label">What counts towards this cup</span>
            {SOURCES.map((s) => (
              <div key={s.key} className="card pad stack" style={{ gap: 4 }} data-testid={`cups-src-${s.key}`}>
                <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!counts[s.key]?.on} onChange={(e) => setSrc(s.key, { on: e.target.checked })} style={{ width: 20, height: 20 }} data-testid={`cups-src-${s.key}-on`} />
                  <span className="grow"><strong>{s.emoji} {s.key === 'kudos' ? CAP_TIP_NAMES[nameKey]?.name || s.name : s.name}</strong><span className="small muted" style={{ display: 'block' }}>{s.blurb}</span></span>
                </label>
                {counts[s.key]?.on && (
                  <div className="stack" style={{ gap: 4, paddingLeft: 28 }}>
                    {s.key === 'placings' && (
                      <>
                        <label className="row small" style={{ gap: 6 }}><span className="grow">Points for 1st, 2nd, 3rd…</span>
                          <input className="input" style={{ width: 110, minHeight: 36 }} value={Array.isArray(counts.placings.scale) ? counts.placings.scale.join('/') : counts.placings.scale}
                            onChange={(e) => setSrc('placings', { scale: e.target.value.replace(/[^\d./ ,-]/g, '').slice(0, 40) })} data-testid="cups-placings-scale" /></label>
                        <span className="small muted">Rounds (none picked = all of them):</span>
                        <div className="chips" style={{ flexWrap: 'wrap' }}>
                          {tripRounds.map((r) => chip(r, (counts.placings.rounds || []).includes(r.id), () => setSrc('placings', { rounds: (counts.placings.rounds || []).includes(r.id) ? counts.placings.rounds.filter((x) => x !== r.id) : [...(counts.placings.rounds || []), r.id] })))}
                        </div>
                      </>
                    )}
                    {Object.keys(s.fields).filter((f) => !['scale', 'guests'].includes(f)).map((f) => numField(s.key, f, LABELS[f] || f))}
                    {s.key === 'kudos' && (
                      <>
                        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={!!counts.kudos.guests} onChange={(e) => setSrc('kudos', { guests: e.target.checked })} /> <span>Guests can give and get them</span></label>
                        <span className="small muted">What the group calls them:</span>
                        <div className="chips" style={{ flexWrap: 'wrap' }}>
                          {Object.values(CAP_TIP_NAMES).map((n) => (
                            <button key={n.key} type="button" className="chip" aria-pressed={nameKey === n.key} data-testid={`cups-name-${n.key}`}
                              onClick={() => run(async () => { await must(supabase.rpc('set_cap_tip_name', { p_group: status.group_id, p_value: n.key })); setNameKey(n.key); })}>
                              {n.name} {n.emoji}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <span className="small muted">Later: {LATER_SOURCES.map((s) => s.name.toLowerCase()).join(' · ')}.</span>
          </>
        )}
        <button type="button" className="btn gold block" disabled={busy} onClick={save} data-testid="cups-specifics-save">Save</button>
      </div>
    </Sheet>
  );
}
