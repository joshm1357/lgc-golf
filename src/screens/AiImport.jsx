// "Bring your history" (/import, wave 3, 21 Oct 2026) — the magic first five minutes of a new group.
// An organiser pastes text (a WhatsApp export, an email, notes, a spreadsheet), uploads a file (.txt .csv .md .docx
// .xlsx, read in the browser) or takes / picks up to 4 photos (an honour board, a trophy plaque, a rules sheet, old
// scorecards — shrunk to 1600px here and never stored). The AI (ai-helper, import mode) proposes players, past trips,
// winners, past handicaps and rules. The confirm screen shows each one with a tick and how it matches the group
// ("Kurt → already a player"); "Add these" writes the ticked ones with the organiser's own sign-in through the paths
// the app already uses: admin_create_player, trips, import_honours, import_handicaps and import_rules (070).
// Safe to run twice: nothing already there is added again. Behind the 'ai_helper' feature; organisers only.
// The matching and row-making are pure functions in lib/aiimport.js (tested).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { Header, toast } from '../components/ui.jsx';
import { must } from '../lib/run.js';
import { readHandicap } from '../lib/history.js';
import { Rate, Remaining } from './AiHelper.jsx';
import {
  MAX_TEXT, MAX_PHOTOS, IMPORT_EXAMPLE, SECTIONS, buildReview, itemLine, picked, handicapRows, startingHandicap, tripRow,
  honourRows, ruleRows, summaryLine, readFileText, fitSize, readImportReply, rematch, itemProblem, findPlayer, findTrip,
} from '../lib/aiimport.js';

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
      <span className="small muted">Paste the group chat or a spreadsheet, or snap the honour board — past trips, winners, handicaps and rules in one go.</span>
    </Link>
  );
}
export function ImportLink({ label = '✨ Import with AI', about }) {
  const on = useFeature('ai_helper');
  const { status } = useSession();
  if (!on || !status?.is_admin) return null;
  return <Link to={about ? `/import?about=${about}` : '/import'} className="btn ghost block" style={{ borderColor: 'var(--navy)', fontWeight: 800 }}>{label}</Link>;
}

export default function AiImport() {
  const { status } = useSession();
  const [params] = useSearchParams();
  const about = params.get('about');
  if (!status?.is_admin) {
    return <div className="page"><Header back title="Bring your history" /><div className="empty">Only an organiser can bring in the group’s history.</div></div>;
  }
  return <ImportFlow about={about} />;
}

function ImportFlow({ about }) {
  const data = useData();
  const trophiesOn = useFeature('trophies');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]); // data URLs, in memory only
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [items, setItems] = useState(null);
  const [extra, setExtra] = useState({ rules: [], handicaps: [] });
  const [done, setDone] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);

  // What's already in the group, for matching (rules and imported handicaps aren't in the shared data).
  const loadExtra = async () => {
    const [{ data: rules }, { data: hc }] = await Promise.all([
      supabase.from('rules').select('id,title,status'),
      supabase.from('handicap_history').select('player_id,new_handicap,created_at').eq('imported', true),
    ]);
    const next = { rules: rules || [], handicaps: (hc || []).map((h) => ({ player_id: h.player_id, date: String(h.created_at).slice(0, 10), handicap: Number(h.new_handicap) })) };
    setExtra(next);
    return next;
  };
  useEffect(() => { loadExtra(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const group = useMemo(() => ({ players: data.players, trips: data.trips, trophies: data.trophies, honour_board: data.honour_board, ...extra }),
    [data.players, data.trips, data.trophies, data.honour_board, extra]);

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
    const { data: d, error } = await supabase.functions.invoke('ai-helper', { body: { mode: 'import', text: text.trim(), images: photos, group_id: currentGroup() || undefined } });
    const r = readImportReply(d, error);
    if (r.remaining) setRemaining(r.remaining);
    setReply(r);
    if (r.kind === 'import') {
      const g = { ...group, ...(await loadExtra()) };
      setItems(buildReview(r.proposal, g));
    }
    setBusy(false);
  };

  const add = async () => {
    setBusy(true);
    const n = { players: 0, trips: 0, winners: 0, handicaps: 0, rules: 0, proposed: 0, skipped: 0 };
    try {
      const p = picked(items);
      // 1. New players (ones already in the group are never made again), starting on their latest handicap.
      const newPlayers = p.players.filter((x) => !x.existingId && !findPlayer(x.data.name, x.data.nickname, data.players));
      const made = [];
      for (const x of newPlayers) {
        const id = await must(supabase.rpc('admin_create_player', { p_name: x.data.name.trim(), p_nickname: x.data.nickname?.trim() || null, p_handicap: startingHandicap(x, p.handicaps), p_avatar_url: null }));
        made.push({ id, name: x.data.name.trim(), nickname: x.data.nickname?.trim() || null });
        n.players++;
      }
      const allPlayers = [...data.players, ...made];
      // 2. Past trips (locked, so none becomes the current trip).
      const newTrips = p.trips.filter((x) => !x.existingId && !findTrip(x.data, data.trips));
      const madeTrips = newTrips.length ? await must(supabase.from('trips').insert(newTrips.map(tripRow)).select('id,name,start_date')) : [];
      n.trips = madeTrips.length;
      const allTrips = [...data.trips, ...madeTrips];
      // 3. Winners onto the honour board (needs the Trophy Room switched on).
      if (p.winners.length && trophiesOn) n.winners = await must(supabase.rpc('import_honours', { p_rows: honourRows(p.winners, allPlayers, allTrips) }));
      // 4. Past handicaps, for players now in the group (including the ones just made).
      const { rows: hcRows, skipped } = handicapRows(p.handicaps, allPlayers);
      n.skipped = skipped;
      if (hcRows.length) n.handicaps = await must(supabase.rpc('import_handicaps', { p_rows: hcRows }));
      // 5. Rules, as normal rules (version 1).
      if (p.rules.length) {
        const r = await must(supabase.rpc('import_rules', { p_rows: ruleRows(p.rules) }));
        n.rules = r?.added || 0;
        n.proposed = r?.proposed || 0;
      }
      await data.reload();
      setDone({ ...n, line: summaryLine(n) });
    } catch (e) {
      const so = summaryLine(n);
      toast(`Stopped part way: ${e?.message || 'something went wrong'}. ${/Nothing new/.test(so) ? '' : `${so}. `}Tap Add these again — nothing gets added twice.`);
      await data.reload();
    }
    setBusy(false);
  };

  const setItem = (id, fn) => setItems((list) => list.map((x) => (x.id === id ? fn(x) : x)));
  const ticked = items ? items.filter((x) => x.ticked) : [];
  const problems = ticked.filter((x) => itemProblem(x));
  const intro = about === 'rules'
    ? 'Snap your rules sheet or paste the rules from the group chat. You’ll tick which ones to add.'
    : 'Paste the group chat, an email or a spreadsheet, upload a file, or snap the honour board, a trophy or the rules sheet. You’ll see everything it finds — and tick what’s right — before anything’s saved.';

  if (done) {
    return (
      <div className="page">
        <Header back title="Bring your history" />
        <div className="section stack" style={{ gap: 10 }}>
          <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }} aria-label="Added">
            <strong style={{ fontSize: 18 }}>✅ {done.line}</strong>
            {done.skipped > 0 && <span className="small muted">{done.skipped} handicap{done.skipped === 1 ? '' : 's'} skipped — no player by that name. Add the player, then add it in History.</span>}
            {done.proposed > 0 && <span className="small muted">Your group votes on new rules, so {done.proposed === 1 ? 'that one is' : 'those are'} up for a vote.</span>}
            <div className="stack" style={{ gap: 6 }}>
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
      <Header back title="Bring your history" sub="Past trips, winners, handicaps and rules" />
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
            <span className="small muted">.txt, .csv, .md, Word and Excel files are read on your phone. Anything else: open it, copy the text and paste it here.</span>
            <button type="button" className="btn gold block" disabled={busy || (text.trim().length < 10 && !photos.length)} onClick={read}>
              {busy ? 'Reading it… (can take a minute)' : 'Read it'}
            </button>
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
                  {list.map((it) => <ItemRow key={it.id} it={it} onTick={(v) => setItem(it.id, (x) => ({ ...x, ticked: v }))}
                    onSave={(d) => setItem(it.id, (x) => rematch({ ...x, data: { ...x.data, ...d } }, group))} />)}
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
};

function ItemRow({ it, onTick, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(it.data);
  const problem = it.ticked ? itemProblem(it) : '';
  const save = () => {
    const d = { ...v };
    if (it.section === 'handicaps') { const h = readHandicap(d.handicap); d.handicap = h == null ? d.handicap : h; }
    if ('year' in d) d.year = Number(d.year) || d.year;
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
          <span className="small" style={{ color: it.already ? 'var(--muted)' : 'var(--navy)', fontWeight: 700 }}>→ {it.match}{it.already ? ' · already there' : ''}</span>
          {it.section === 'rules' && it.data.wording && !editing && <span className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{it.data.wording}</span>}
          {problem && <span className="small err" style={{ margin: 0 }}>{problem}</span>}
        </div>
        <button type="button" className="btn ghost sm" style={{ flex: 'none' }} aria-label={`Edit ${itemLine(it)}`} onClick={() => { setV(it.data); setEditing(!editing); }}>{editing ? 'Close' : 'Edit'}</button>
      </div>
      {editing && (
        <div className="stack" style={{ gap: 6, paddingLeft: 34 }}>
          {FIELDS[it.section].map(([k, label]) => (
            <label key={k} className="field"><span>{label}</span>
              {k === 'wording'
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
