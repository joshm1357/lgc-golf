// "Bring your history" (/import, wave 3, 21 Oct 2026) — the magic first five minutes of a new group.
// An organiser pastes text (a WhatsApp export, an email, notes, a spreadsheet), uploads a file (.txt .csv .md .docx
// .xlsx, read in the browser) or takes / picks up to 4 photos (an honour board, a trophy plaque, a rules sheet, old
// scorecards — shrunk to 1600px here and never stored). The AI (ai-helper, import mode) proposes players, past trips,
// winners, past handicaps and rules. The confirm screen shows each one with a tick and how it matches the group
// ("Kurt → already a player"); "Add these" writes the ticked ones with the organiser's own sign-in through the paths
// the app already uses: admin_create_player, trips, import_honours, import_handicaps and import_rules (070).
// Safe to run twice: nothing already there is added again. Behind the 'ai_helper' feature; organisers only.
// The matching and row-making are pure functions in lib/aiimport.js (tested).
// 22 Oct ("import anything", Josh: "should allow all"): also past rounds and scorecards, cups, awards and moments,
// stories and anything else, each on a trip the organiser can change (lib/historyimport.js), written through
// import_rounds and import_history_notes (081). Up to 12 photos. /import?trip=<id> ("Add history to this trip" on a
// past trip's Overview) puts everything on that trip unless it names another. Organisers only: a player can't send
// history in for approval yet (Josh's call).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { Header, toast } from '../components/ui.jsx';
import { must } from '../lib/run.js';
import { readHandicap } from '../lib/history.js';
import { Rate, Remaining } from './AiHelper.jsx';
import { withRetry } from '../lib/aihelper.js';
import {
  MAX_TEXT, MAX_PHOTOS, IMPORT_EXAMPLE, SECTIONS, buildReview, itemLine, picked, handicapRows, startingHandicap, tripRow,
  honourRows, ruleRows, summaryLine, readFileText, fitSize, readImportReply, rematch, itemProblem, findTrip,
  choosePlayer, chooseNickname, chooseTrophy, playerAliases,
} from '../lib/aiimport.js';
import {
  HISTORY_KEYS, NEEDS_TRIP, chooseItemTrip, newTripName, tripWords, findCourse, libraryPick, cardHoles, roundRow, noteRow, cupHonour,
} from '../lib/historyimport.js';
import { isYearOnly } from '../lib/trips.js';
import Thinking from '../components/Thinking.jsx';

/** A photo, shrunk in the browser to 1600px on its longest side, as a JPEG data URL (kept in memory only). */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, 0, 0, width, height);
    return c.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Small ways in, for other screens. All hidden when the AI helper is off, and for players. */
export function ImportCard() {
  const on = useFeature('ai_helper');
  const { status } = useSession();
  if (!on || !status?.is_admin) return null;
  return (
    <Link to="/import" className="card pad stack" style={{ gap: 4, color: 'inherit', textDecoration: 'none', borderColor: 'var(--gold)' }} aria-label="Bring your history">
      <strong>✨ Bring your history</strong>
      <span className="small muted">Paste the group chat or a spreadsheet, or snap the honour board and old scorecards — past trips, rounds, cups, winners, stories, handicaps and rules in one go.</span>
    </Link>
  );
}
export function ImportLink({ label = '✨ Import with the Caddie', about, trip }) {
  const on = useFeature('ai_helper');
  const { status } = useSession();
  if (!on || !status?.is_admin) return null;
  const to = trip ? `/import?trip=${trip}` : about ? `/import?about=${about}` : '/import';
  return <Link to={to} className="btn ghost block" style={{ borderColor: 'var(--navy)', fontWeight: 800 }}>{label}</Link>;
}

export default function AiImport() {
  const { status } = useSession();
  const [params] = useSearchParams();
  const about = params.get('about');
  const trip = params.get('trip');
  if (!status?.is_admin) {
    return <div className="page"><Header back title="Bring your history" /><div className="empty">Only an organiser can bring in the group’s history.</div></div>;
  }
  return <ImportFlow about={about} tripId={trip} />;
}

function ImportFlow({ about, tripId }) {
  const data = useData();
  const trophiesOn = useFeature('trophies');
  // "Add history to this trip": a trip of this group's, or none.
  const preset = tripId && data.trips.some((t) => t.id === tripId) ? tripId : null;
  const presetTrip = preset ? data.trips.find((t) => t.id === preset) : null;
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]); // data URLs, in memory only
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [items, setItems] = useState(null);
  const [extra, setExtra] = useState({ rules: [], handicaps: [], notes: [] });
  const [done, setDone] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);

  // What's already in the group, for matching (rules and imported handicaps aren't in the shared data).
  const loadExtra = async () => {
    const [{ data: rules }, { data: hc }, { data: notes }] = await Promise.all([
      supabase.from('rules').select('id,title,status'),
      supabase.from('handicap_history').select('player_id,new_handicap,created_at').eq('imported', true),
      supabase.from('history_notes').select('import_key'), // none yet on a database without 081: nothing's "already in"
    ]);
    const next = { rules: rules || [], handicaps: (hc || []).map((h) => ({ player_id: h.player_id, date: String(h.created_at).slice(0, 10), handicap: Number(h.new_handicap) })), notes: notes || [] };
    setExtra(next);
    return next;
  };
  useEffect(() => { loadExtra(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const group = useMemo(() => ({
    players: data.players, trips: data.trips, trophies: data.trophies, honour_board: data.honour_board, courses: data.courses, rounds: data.rounds,
    trophiesOn, ...extra,
  }), [data.players, data.trips, data.trophies, data.honour_board, data.courses, data.rounds, trophiesOn, extra]);
  // For the trip pickers: the group's trips (newest first) and the past trips proposed in this import.
  const tripCtx = useMemo(() => ({
    trips: [...data.trips].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))),
    proposed: (items || []).filter((x) => x.section === 'trips'), preset,
  }), [data.trips, items, preset]);

  const addFile = async (file) => {
    if (!file) return;
    const r = await readFileText(file);
    if (r.error) { setNote(r.error); return; }
    setText((t) => (t.trim() ? `${t.trim()}\n\n${r.text}` : r.text).slice(0, MAX_TEXT));
    setNote(r.cut ? 'That file was long — only the first part fits. Paste the rest in another go.' : `Read ${file.name}.`);
  };
  const addPhotos = async (files) => {
    const list = [...(files || [])].slice(0, MAX_PHOTOS - photos.length);
    if (files?.length > list.length) setNote(`Up to ${MAX_PHOTOS} photos at a time.`);
    try {
      const shrunk = await Promise.all(list.map(shrinkPhoto));
      setPhotos((p) => [...p, ...shrunk].slice(0, MAX_PHOTOS));
    } catch {
      setNote('Couldn’t open that photo — try another one.');
    }
  };

  const read = async () => {
    setBusy(true);
    setNote('');
    // Busy / odd reply / too slow: one more go by itself before showing the error (a failed go doesn't use up a question).
    const body = {
      mode: 'import', text: text.trim(), images: photos, group_id: currentGroup() || undefined,
      ...(presetTrip ? { trip: { name: presetTrip.name, year: presetTrip.start_date ? Number(String(presetTrip.start_date).slice(0, 4)) : null } } : {}),
    };
    const r = await withRetry(async () => {
      const { data: d, error } = await supabase.functions.invoke('ai-helper', { body });
      return readImportReply(d, error);
    }, body);
    if (r.remaining) setRemaining(r.remaining);
    setReply(r);
    if (r.kind === 'import') {
      const g = { ...group, ...(await loadExtra()) };
      setItems(buildReview(r.proposal, g, preset));
    }
    setBusy(false);
  };

  const add = async () => {
    setBusy(true);
    const n = { players: 0, nicknames: 0, trips: 0, winners: 0, handicaps: 0, rules: 0, proposed: 0, skipped: 0, rounds: 0, cups: 0, awards: 0, stories: 0, other: 0, already: 0, notInGroup: 0 };
    try {
      const p = picked(items);
      // 1. New players (the organiser said "someone new", or nobody matched), starting on their latest handicap.
      //    Never made twice: a second "Add these" finds the one made the first time by its exact name.
      const newPlayers = p.players.filter((x) => !x.existingId && !data.players.some((q) => q.name.trim().toLowerCase() === x.data.name.trim().toLowerCase()));
      const made = [];
      for (const x of newPlayers) {
        const id = await must(supabase.rpc('admin_create_player', { p_name: x.data.name.trim(), p_nickname: x.data.nickname?.trim() || null, p_handicap: startingHandicap(x, p.handicaps), p_avatar_url: null }));
        made.push({ itemId: x.id, id, name: x.data.name.trim(), nickname: x.data.nickname?.trim() || null });
        n.players++;
      }
      // Nicknames for players already in the group (the same organiser path as editing a player).
      for (const x of p.players.filter((y) => y.existingId && y.canAddNick && y.addNick)) {
        await must(supabase.from('players').update({ nickname: x.nickToAdd }).eq('id', x.existingId));
        n.nicknames++;
      }
      const allPlayers = [...data.players, ...made];
      // Names → the player the organiser picked (so "Josh Moran"'s handicaps go to Joshua Moran).
      const aliases = playerAliases(items, made);
      // 2. Past trips (locked, so none becomes the current trip).
      const newTrips = p.trips.filter((x) => !x.existingId && !findTrip(x.data, data.trips));
      const madeTrips = newTrips.length ? await must(supabase.from('trips').insert(newTrips.map(tripRow)).select('id,name,start_date')) : [];
      n.trips = madeTrips.length;
      const allTrips = [...data.trips, ...madeTrips];
      // 3. Winners onto the honour board (needs the Trophy Room switched on).
      if (p.winners.length && trophiesOn) n.winners = await must(supabase.rpc('import_honours', { p_rows: honourRows(p.winners, allPlayers, allTrips, aliases) }));
      // 4. Past handicaps, for players now in the group (including the ones just made).
      const { rows: hcRows, skipped } = handicapRows(p.handicaps, allPlayers, aliases);
      n.skipped = skipped;
      if (hcRows.length) n.handicaps = await must(supabase.rpc('import_handicaps', { p_rows: hcRows }));
      // 5. Rules, as normal rules (version 1).
      if (p.rules.length) {
        const r = await must(supabase.rpc('import_rules', { p_rows: ruleRows(p.rules) }));
        n.rules = r?.added || 0;
        n.proposed = r?.proposed || 0;
      }
      // 6. Rounds, cups, awards and moments, stories, other — each on its trip.
      const h = await addHistory(p, { allPlayers, allTrips, aliases, madeTrips });
      for (const k of ['rounds', 'cups', 'awards', 'stories', 'other', 'already', 'notInGroup']) n[k] += h[k] || 0;
      n.trips += h.trips || 0;
      n.winners += h.cupWinners || 0;
      await data.reload();
      setDone({ ...n, line: summaryLine(n) });
    } catch (e) {
      const so = summaryLine(n);
      toast(`Stopped part way: ${e?.message || 'something went wrong'}. ${/Nothing new/.test(so) ? '' : `${so}. `}Tap Add these again — nothing gets added twice.`);
      await data.reload();
    }
    setBusy(false);
  };

  // The new kinds: trips made as needed, then rounds (import_rounds), cups (a note + the honour board), awards,
  // stories and other (import_history_notes). Returns the counts. Safe to run twice (the database's keys).
  const addHistory = async (p, { allPlayers, allTrips, aliases, madeTrips }) => {
    const out = { rounds: 0, cups: 0, awards: 0, stories: 0, other: 0, already: 0, notInGroup: 0 };
    const hist = HISTORY_KEYS.flatMap((k) => p[k]);
    if (!hist.length) return out;
    const trips = [...allTrips];
    const lowName = (x) => String(x || '').trim().toLowerCase();
    // A past trip by name (made once, even when several items need it).
    const tripNamed = async (name, year, date) => {
      const hit = trips.find((t) => lowName(t.name) === lowName(name)) || (year ? findTrip({ name, year }, trips) : null);
      if (hit) return hit.id;
      const row = year ? tripRow({ data: { name, year, start_date: date || null, end_date: date || null } }) : { name: String(name).trim().slice(0, 60), start_date: null, end_date: null, status: 'locked' };
      const made = await must(supabase.from('trips').insert(row).select('id,name,start_date').single());
      trips.push(made);
      out.trips = (out.trips || 0) + 1;
      return made.id;
    };
    const tripFor = async (it) => {
      const c = it.tripChoice;
      if (!c) return null;
      if (c.startsWith('p:')) {
        const prop = items.find((x) => `p:${x.id}` === c);
        const made = prop && (madeTrips.find((t) => lowName(t.name) === lowName(prop.data.name)) || prop.existingId && { id: prop.existingId });
        if (made) return made.id;
        return prop ? tripNamed(prop.data.name, prop.data.year, prop.data.start_date) : null;
      }
      if (c === 'new') return tripNamed(newTripName(it.section, it.data), it.data.year || (it.data.date ? Number(it.data.date.slice(0, 4)) : null), it.data.date);
      return c;
    };
    // Rounds: the course from the group, else the course library, else the card's own pars (or totals only).
    if (p.rounds.length) {
      const courses = [...data.courses];
      const rows = [];
      for (const it of p.rounds) {
        const tid = await tripFor(it);
        let course = findCourse(it.data.course, courses);
        if (!course) {
          try {
            const args = { p_query: it.data.course, p_lat: null, p_lng: null, p_limit: 5 };
            let r = await supabase.rpc('find_courses', args);
            if (r.error) r = await supabase.rpc('search_courses', args);
            const pick = libraryPick(it.data.course, r.data || []);
            if (pick) {
              const id = await must(supabase.rpc('copy_library_course', { p_id: pick.id }));
              course = { id, name: pick.name };
              courses.push(course);
            }
          } catch { /* no library match: the card's pars, or totals only */ }
        }
        const holes = cardHoles(it.data);
        const payload = course ? { course_id: course.id } : { course: { name: it.data.course, holes } };
        rows.push(roundRow(it, tid, payload, !!(course || holes), allPlayers, aliases));
      }
      const r = await must(supabase.rpc('import_rounds', { p_rows: rows }));
      out.rounds = r?.added || 0;
      out.already += r?.already || 0;
      out.notInGroup += r?.players_skipped || 0;
    }
    // Cups, awards and moments, stories, other: notes on their trips (one call each, so each can be counted).
    const honours = [];
    for (const key of ['cups', 'awards', 'stories', 'other']) {
      if (!p[key].length) continue;
      const rows = [];
      for (const it of p[key]) {
        const tid = await tripFor(it);
        rows.push(noteRow(it, tid, allPlayers, aliases));
        if (key === 'cups' && trophiesOn) {
          const hr = cupHonour(it, trips.find((t) => t.id === tid), allPlayers, aliases);
          if (hr) honours.push(hr);
        }
      }
      const r = await must(supabase.rpc('import_history_notes', { p_rows: rows }));
      out[key] = r?.added || 0;
      out.already += r?.already || 0;
    }
    if (honours.length) out.cupWinners = await must(supabase.rpc('import_honours', { p_rows: honours }));
    return out;
  };

  const setItem = (id, fn) => setItems((list) => list.map((x) => (x.id === id ? fn(x) : x)));
  const ticked = items ? items.filter((x) => x.ticked) : [];
  const problems = ticked.filter((x) => itemProblem(x));
  const intro = about === 'rules'
    ? 'Snap your rules sheet or paste the rules from the group chat. You’ll tick which ones to add.'
    : presetTrip
      ? `Snap the scorecards, results sheet or the honour board, or paste the chat or a write-up from ${presetTrip.name}. It all goes on this trip unless it says otherwise — and you tick what’s right before anything’s saved.`
      : 'Paste the group chat, an email or a spreadsheet, upload a file, or snap old scorecards, results sheets, the honour board or the rules. Rounds, cups, winners, awards, stories — you’ll see everything it finds, and tick what’s right, before anything’s saved.';

  if (done) {
    return (
      <div className="page">
        <Header back title="Bring your history" />
        <div className="section stack" style={{ gap: 10 }}>
          <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }} aria-label="Added">
            <strong style={{ fontSize: 18 }}>✅ {done.line}</strong>
            {done.skipped > 0 && <span className="small muted">{done.skipped} handicap{done.skipped === 1 ? '' : 's'} skipped — no player by that name. Add the player, then add it in History.</span>}
            {done.proposed > 0 && <span className="small muted">Your group votes on new rules, so {done.proposed === 1 ? 'that one is' : 'those are'} up for a vote.</span>}
            {done.already > 0 && <span className="small muted">{done.already} {done.already === 1 ? 'was' : 'were'} already in — nothing added twice.</span>}
            {done.notInGroup > 0 && <span className="small muted">{done.notInGroup} score{done.notInGroup === 1 ? '' : 's'} kept as notes on the round — {done.notInGroup === 1 ? 'that name isn’t' : 'those names aren’t'} a player in the group.</span>}
            <div className="stack" style={{ gap: 6 }}>
              {presetTrip && <Link to={`/trip/${presetTrip.id}`} className="btn ghost block">🧳 {presetTrip.name}</Link>}
              {trophiesOn && <Link to="/trophies" className="btn ghost block">🏆 The Trophy Room</Link>}
              <Link to="/history" className="btn ghost block">📈 History</Link>
              <Link to="/rules" className="btn ghost block">📜 The Rulebook</Link>
            </div>
            <button type="button" className="btn block" onClick={() => { setDone(null); setItems(null); setReply(null); setText(''); setPhotos([]); }}>Bring in more</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Header back title="Bring your history" sub={presetTrip ? `Adding to ${presetTrip.name}` : 'Trips, rounds, cups, winners, stories and rules'} />
      <div className="section stack" style={{ gap: 10 }}>
        {!items && (
          <div className="card pad stack" style={{ gap: 10 }}>
            <span className="small muted">{intro}</span>
            <textarea className="textarea" rows={7} style={{ padding: 12 }} value={text} maxLength={MAX_TEXT} aria-label="Paste your history"
              placeholder={IMPORT_EXAMPLE} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost grow" disabled={busy} onClick={() => fileRef.current?.click()}>📄 Upload a file</button>
              <button type="button" className="btn ghost grow" disabled={busy || photos.length >= MAX_PHOTOS} onClick={() => photoRef.current?.click()}>📷 Photos</button>
            </div>
            <input ref={fileRef} type="file" hidden accept=".txt,.csv,.tsv,.md,.docx,.xlsx,text/plain,text/csv" aria-label="Upload a file"
              onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={photoRef} type="file" hidden accept="image/*" multiple aria-label="Add photos"
              onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            {photos.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label="Photos to read">
                {photos.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={src} alt={`Photo ${i + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                    <button type="button" className="btn ghost sm" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -8, right: -8, minHeight: 28, minWidth: 28, padding: 0, borderRadius: 14 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {note && <span className="small muted" role="status">{note}</span>}
            <span className="small muted">Up to {MAX_PHOTOS} photos (scorecards, results sheets, honour boards). .txt, .csv, .md, Word and Excel files are read on your phone. Anything else: open it, copy the text and paste it here.</span>
            <button type="button" className="btn gold block" disabled={busy || (text.trim().length < 10 && !photos.length)} onClick={read}>
              {busy ? 'Reading it…' : 'Read it'}
            </button>
            {busy && <Thinking steps={['Reading what you sent', 'Finding names, scores and winners', 'Matching trips and courses', 'Putting it together for you to check']} />}
            {reply?.kind === 'error' && <div className="small err" style={{ margin: 0 }} role="alert">{reply.text}</div>}
            {reply?.kind === 'message' && <div className="card pad small" style={{ background: 'var(--ground)' }}>💬 {reply.text}</div>}
            <Remaining r={remaining} />
            <span className="small muted">Photos and text go to the AI company to be read, and aren’t kept.</span>
          </div>
        )}

        {items && (
          <>
            {reply?.proposal?.unsure?.length > 0 && (
              <div className="card pad stack" style={{ gap: 4, background: 'var(--gold-soft)', borderColor: 'var(--gold)' }} aria-label="Not sure about">
                <strong className="small">🤔 Not sure about</strong>
                {reply.proposal.unsure.map((u, i) => <span key={i} className="small">• {u}</span>)}
              </div>
            )}
            {!items.length && <div className="empty">Nothing from the group’s history in that. Try a different paste or a clearer photo.</div>}
            {SECTIONS.map((s) => {
              const list = items.filter((x) => x.section === s.key);
              if (!list.length) return null;
              const on = list.filter((x) => x.ticked).length;
              return (
                <section key={s.key} className="card pad stack" style={{ gap: 6 }} aria-label={s.title}>
                  <div className="row between"><strong>{s.icon} {s.title}</strong><span className="small muted">{on} of {list.length} ticked</span></div>
                  {s.key === 'winners' && !trophiesOn && <span className="small err" style={{ margin: 0 }}>The Trophy Room is switched off, so winners won’t be added. Switch it on in More → Group &amp; invites → Features.</span>}
                  {list.map((it) => <ItemRow key={it.id} it={it} players={data.players} tripCtx={tripCtx}
                    onTrip={(c) => setItem(it.id, (x) => chooseItemTrip(x, c, group, tripCtx))}
                    // A matched player's tick is "add the nickname".
                    onTick={(v) => setItem(it.id, (x) => (x.section === 'players' && x.canAddNick ? chooseNickname(x, v, data.players) : { ...x, ticked: v }))}
                    onSave={(d) => setItem(it.id, (x) => rematch({ ...x, data: { ...x.data, ...d } }, group, tripCtx))}
                    onChoosePlayer={(c) => setItem(it.id, (x) => choosePlayer(x, c, data.players))}
                    onChooseTrophy={(t) => setItem(it.id, (x) => chooseTrophy(x, t, data.honour_board))} />)}
                </section>
              );
            })}
            {reply?.proposal?.dropped > 0 && <span className="small muted">{reply.proposal.dropped} thing{reply.proposal.dropped === 1 ? '' : 's'} it found didn’t look right (or there were too many) and {reply.proposal.dropped === 1 ? 'was' : 'were'} left out.</span>}
            {problems.length > 0 && <span className="small err" style={{ margin: 0 }}>Fix or untick: {problems.map((x) => itemLine(x)).slice(0, 3).join('; ')}</span>}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn gold grow" disabled={busy || !ticked.length || problems.length > 0} onClick={add}>{busy ? 'Adding…' : `Add these (${ticked.length})`}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => { setItems(null); setReply(null); }}>Start again</button>
            </div>
            <Rate key={reply?.logId} logId={reply?.logId} />
          </>
        )}
      </div>
    </div>
  );
}

const FIELDS = {
  players: [['name', 'Name'], ['nickname', 'Nickname']],
  trips: [['name', 'Trip'], ['year', 'Year']],
  winners: [['trophy', 'Trophy'], ['year', 'Year'], ['winners', 'Winner(s)'], ['score', 'Score']],
  handicaps: [['player', 'Player'], ['date', 'Date (YYYY-MM-DD)'], ['handicap', 'Handicap']],
  rules: [['title', 'Rule'], ['value', 'Worth / amount'], ['wording', 'Wording']],
  rounds: [['course', 'Course'], ['name', 'Round (e.g. Day 2)'], ['date', 'Date (YYYY-MM-DD)'], ['year', 'Year']],
  cups: [['name', 'Cup'], ['year', 'Year']],
  awards: [['title', 'What'], ['winners', 'Who'], ['year', 'Year'], ['detail', 'Details']],
  stories: [['title', 'Title'], ['year', 'Year'], ['body', 'Story']],
  other: [['title', 'Title'], ['year', 'Year'], ['text', 'Text']],
};
const LONG = new Set(['wording', 'body', 'text', 'detail']);

/** Which trip a round, cup, award or story goes on (the group's trips, the new ones from this import, a new one). */
function TripPick({ it, ctx, onTrip }) {
  const c = it.tripChoice || '';
  const label = (t) => (isYearOnly(t) ? `${t.name}` : `${t.name}${t.start_date && !String(t.name).includes(String(t.start_date).slice(0, 4)) ? ` (${String(t.start_date).slice(0, 4)})` : ''}`);
  return (
    <select className="input" style={{ minHeight: 40, padding: '4px 8px', width: 'auto', maxWidth: '100%' }} aria-label={`Trip for ${itemLine(it)}`}
      value={c} onChange={(e) => onTrip(e.target.value)}>
      {ctx.trips.map((t) => <option key={t.id} value={t.id}>🧳 {label(t)}</option>)}
      {ctx.proposed.filter((x) => !x.existingId).map((x) => <option key={x.id} value={`p:${x.id}`}>🆕 {x.data.name}</option>)}
      <option value="new">🆕 New past trip: {newTripName(it.section, it.data)}</option>
      {!NEEDS_TRIP.has(it.section) && <option value="">No trip — the group’s history</option>}
    </select>
  );
}

function ItemRow({ it, players = [], tripCtx, onTrip, onTick, onSave, onChoosePlayer, onChooseTrophy }) {
  const isHistory = HISTORY_KEYS.includes(it.section);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(it.data);
  const problem = it.ticked ? itemProblem(it) : '';
  const save = () => {
    const d = { ...v };
    if (it.section === 'handicaps') { const h = readHandicap(d.handicap); d.handicap = h == null ? d.handicap : h; }
    if ('year' in d) d.year = d.year === '' || d.year == null ? null : Number(d.year) || d.year;
    if (it.section === 'rounds' && d.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) d.date = null;
    onSave(d);
    setEditing(false);
  };
  return (
    <div className="stack" style={{ gap: 4, padding: '6px 0', borderTop: '1px solid var(--line-soft, #E3E7EC)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={it.ticked} onChange={(e) => onTick(e.target.checked)} aria-label={`Add ${itemLine(it)}`}
          style={{ width: 24, height: 24, flex: 'none', marginTop: 2 }} />
        <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ lineHeight: 1.35, overflowWrap: 'anywhere' }}>{itemLine(it)}</span>
          {it.guess && <span className="small" style={{ fontWeight: 700, color: 'var(--gold-dark, #8a6a00)' }}>⚠️ a guess — check it before ticking</span>}
          {it.ask && (
            <label className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="small" style={{ fontWeight: 700 }}>{it.ask}</span>
              <select className="input" style={{ minHeight: 40, padding: '4px 8px', width: 'auto', maxWidth: '100%' }} aria-label={`Who is ${it.data.name}?`}
                value={it.choice || 'new'} onChange={(e) => onChoosePlayer(e.target.value)}>
                {players.filter((p) => p.id === it.candidateId).map((p) => <option key={p.id} value={p.id}>Yes — {p.name}</option>)}
                <option value="new">No — someone new</option>
                {players.filter((p) => p.id !== it.candidateId).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {it.section === 'winners' && it.trophyOptions?.length > 0 && (
            <select className="input" style={{ minHeight: 40, padding: '4px 8px', width: 'auto', maxWidth: '100%' }} aria-label={`Trophy for ${itemLine(it)}`}
              value={it.trophyChoice || ''} onChange={(e) => onChooseTrophy(e.target.value)}>
              {it.trophyOptions.map((t) => <option key={t} value={t}>🏆 {t}</option>)}
              <option value="">New trophy: {it.data.trophy}</option>
            </select>
          )}
          {isHistory && <TripPick it={it} ctx={tripCtx} onTrip={onTrip} />}
          <span className="small" style={{ color: it.already ? 'var(--muted)' : 'var(--navy)', fontWeight: 700 }}>{isHistory ? [it.already ? 'already in' : '', it.detail].filter(Boolean).join(' · ') : `→ ${it.match}`}{!isHistory && it.already ? ' · already there' : ''}</span>
          {isHistory && (it.section === 'stories' || it.section === 'other') && !editing && <span className="small muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'hidden' }}>{it.data.body || it.data.text}</span>}
          {it.section === 'rounds' && !editing && <span className="small muted">{it.data.players.map((p) => `${p.name} ${p.points != null ? `${p.points} pts` : p.gross != null ? p.gross : p.strokes ? p.strokes.reduce((a, b) => a + (b || 0), 0) : ''}`.trim()).join(' · ')}</span>}
          {it.section === 'rules' && it.data.wording && !editing && <span className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{it.data.wording}</span>}
          {problem && <span className="small err" style={{ margin: 0 }}>{problem}</span>}
        </div>
        <button type="button" className="btn ghost sm" style={{ flex: 'none' }} aria-label={`Edit ${itemLine(it)}`} onClick={() => { setV(it.data); setEditing(!editing); }}>{editing ? 'Close' : 'Edit'}</button>
      </div>
      {editing && (
        <div className="stack" style={{ gap: 6, paddingLeft: 34 }}>
          {FIELDS[it.section].map(([k, label]) => (
            <label key={k} className="field"><span>{label}</span>
              {LONG.has(k)
                ? <textarea className="textarea" rows={3} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
                : <input className="input" value={v[k] ?? ''} inputMode={k === 'year' || k === 'handicap' ? 'decimal' : undefined} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
            </label>
          ))}
          <button type="button" className="btn sm" onClick={save}>Done</button>
        </div>
      )}
    </div>
  );
}
