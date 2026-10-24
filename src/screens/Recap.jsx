// 📺 The Weekend Recap (ov37, migration 107) — /recap/:tripId. A short two-voice commentary of the trip (Rex Fairway
// on play-by-play, Bev Divot on colour — our own characters), read out on the phone, shared to the group chat.
//
//   * Organisers: "✍️ Write the recap" (the ai-helper's trip_recap mode writes it from the facts below — the AI if
//     it's on and under its limit, else the house script from the facts), "Write it again" (e.g. after more cards come
//     in) and "📣 Post it in the Feed" (publish_trip_recap: one Feed post, "▶️ have a listen").
//   * Everyone: the script as a two-voice transcript, ▶️ Play it (the phone's own voices, two of them, the line lit up
//     as it's read; Pause / Stop; tap a line to start there), 📤 Share to the group chat, what the commentators had to
//     go on (folded away), and the missing-cards nudge ("6 cards missing from Saturday — add yours and you're in").
// The facts and the reader are in lib/recap.js; the words (voices, checks, the house script) in
// supabase/functions/_shared/recap.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { useData, useRealtime, useScores, useSession, playerName } from '../lib/store.jsx';
import { useTripResults } from '../components/TripResults.jsx';
import { Header, Loading, toast } from '../components/ui.jsx';
import { appLink, shareText } from '../lib/push.js';
import {
  VOICES, buildRecapFacts, factLines, missingCards, missingNudge, recapOutOfDate, scriptText, createDuoReader, canSpeak, recordedAudio,
} from '../lib/recap.js';

const rowsOr = async (q) => { try { const { data, error } = await q; return error ? [] : data || []; } catch { return []; } };
const VOICE_COLOUR = { A: 'var(--gold)', B: 'var(--up)' };
const ON_NAVY = { background: 'transparent', color: '#fff', borderColor: 'var(--on-navy-muted)' };

/** The trip's posts, Tribunal cases and its saved recap (each one empty on an older database). */
function useRecapRows(tripId) {
  const [d, setD] = useState({ posts: [], tribunal: [], cases: [], casePosts: [], recap: null, ready: false });
  const load = useCallback(async () => {
    if (!tripId) return;
    const [posts, tribunal, cases, recaps] = await Promise.all([
      rowsOr(supabase.from('posts').select('id,body,player_id,round_id,created_at,kind').eq('trip_id', tripId).not('body', 'is', null).order('created_at').limit(300)),
      rowsOr(supabase.from('tribunal_cases').select('*').order('created_at', { ascending: false }).limit(50)),
      rowsOr(supabase.from('cases').select('*').order('created_at', { ascending: false }).limit(50)),
      rowsOr(supabase.from('trip_recaps').select('*').eq('trip_id', tripId)),
    ]);
    const casePosts = cases.length ? await rowsOr(supabase.from('case_posts').select('case_id,kind,player_id,body,created_at').in('case_id', cases.map((c) => c.id)).order('created_at')) : [];
    setD({ posts, tribunal, cases, casePosts, recap: recaps[0] || null, ready: true });
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['trip_recaps'], load);
  return [d, load];
}

export default function Recap() {
  const { tripId } = useParams();
  const data = useData();
  const { status } = useSession();
  const trip = data.trips.find((t) => t.id === tripId) || null;
  const res = useTripResults(trip);
  const rounds = useMemo(() => data.rounds.filter((r) => r.trip_id === tripId)
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || ''))), [data.rounds, tripId]);
  const scores = useScores(rounds.map((r) => r.id));
  const [rows, reload] = useRecapRows(tripId);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const organiser = !!status?.is_admin && !status?.viewing && status?.role !== 'guest';

  const ctx = { roundPlayers: data.roundPlayers, teamsByRound: data.teamsByRound, playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results, nameOf: playerName };
  const facts = useMemo(() => (trip ? buildRecapFacts({
    trip, res, rounds, playersById: data.playersById, roundPlayers: data.roundPlayers, teamsByRound: data.teamsByRound, coursesById: data.coursesById,
    scoresIdx: scores.index, quickResults: data.quick_results, posts: rows.posts, tribunal: rows.tribunal, cases: rows.cases, casePosts: rows.casePosts,
    honourBoard: data.honour_board, nameOfId: (id) => playerName(data.playersById[id]),
  }) : null), [trip, res, rounds, data, scores.index, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = useMemo(() => missingCards(rounds, ctx), [rounds, scores.index, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const nudge = missingNudge(missing);
  const recap = rows.recap;

  if (!trip) return <div className="page"><Header back title="📺 The Weekend Recap" /><Loading /></div>;
  const write = async () => {
    setBusy('write');
    setNote('');
    try {
      const { data: d, error } = await supabase.functions.invoke('ai-helper', { body: { mode: 'trip_recap', trip_id: trip.id, facts, group_id: currentGroup() || undefined } });
      if (error) throw error;
      if (d?.error) toast(String(d.error));
      else {
        if (d?.note) setNote(String(d.note));
        toast(recap ? 'Fresh recap written' : 'The recap is written — have a listen');
        await reload();
      }
    } catch (e) { toast(/fetch|network/i.test(String(e?.message)) ? 'No signal — try again in a moment.' : 'Couldn’t reach the commentators — try again in a minute.'); }
    setBusy('');
  };
  const publish = async () => {
    setBusy('publish');
    const { error } = await supabase.rpc('publish_trip_recap', { p_trip: trip.id });
    setBusy('');
    if (error) { toast(friendlyError(error)); return; }
    toast('Posted in the Feed — 📺 The Weekend Recap is out');
    reload();
  };
  const share = async () => {
    const r = await shareText(scriptText(recap, appLink(`/recap/${trip.id}`)), recap.title);
    if (r === 'copied') toast('Copied — paste it in the group chat');
    else if (r === 'failed') toast('Couldn’t share from this phone');
  };
  const stale = recapOutOfDate(recap, facts);
  const unposted = recap && (!recap.published_at || (recap.updated_at && recap.published_at && recap.updated_at > recap.published_at && recap.version > 1));

  return (
    <div className="page" data-testid="recap-page">
      <Header back title="📺 The Weekend Recap" sub={trip.name} />
      <div className="section stack" style={{ gap: 12 }}>
        {recap ? (
          <Player recap={recap} onShare={share} />
        ) : (
          <div className="card pad stack" style={{ gap: 8, background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff', textAlign: 'center' }} data-testid="recap-empty">
            <span style={{ fontSize: 40 }} aria-hidden="true">📺</span>
            <strong style={{ fontSize: 20 }}>{VOICES.A.name} &amp; {VOICES.B.name}</strong>
            <span style={{ color: 'var(--on-navy-muted)' }}>
              {organiser ? 'Your commentary team is warmed up. They’ll call the whole weekend in about a minute — winners, bomb drives, three-putts, the Tribunal and the history.'
                : 'The organiser hasn’t written this trip’s recap yet. Get your card in so you’re in it.'}
            </span>
          </div>
        )}

        {organiser && (
          <div className="stack" style={{ gap: 8 }} data-testid="recap-organiser">
            {stale && <div className="note" data-testid="recap-stale">{facts.cards - recap.cards} new card{facts.cards - recap.cards === 1 ? '' : 's'} since this was written — write it again to put them in.</div>}
            {note && <div className="note small" data-testid="recap-note">{note}</div>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={recap ? 'btn ghost sm' : 'btn gold block'} disabled={!!busy || !facts} onClick={write} data-testid="recap-write">
                {busy === 'write' ? 'The commentators are warming up…' : recap ? '✍️ Write it again' : '✍️ Write the recap'}
              </button>
              {recap && unposted && (
                <button type="button" className="btn gold sm" disabled={!!busy} onClick={publish} data-testid="recap-publish">
                  {busy === 'publish' ? 'Posting…' : recap.published_at ? '📣 Update the Feed post' : '📣 Post it in the Feed'}
                </button>
              )}
              {recap?.published_at && !unposted && <span className="small muted" style={{ alignSelf: 'center' }} data-testid="recap-posted">✓ In the Feed</span>}
            </div>
            {recap && !note && <span className="small muted">{recap.written_by === 'ai' ? 'Written by the Caddie from the facts below.' : 'Written from the facts below (the house script — no AI).'}</span>}
          </div>
        )}
        {!organiser && stale && <div className="note small">More cards have come in since this was written — the organiser can update it.</div>}

        {nudge && (
          <div className="card pad stack" style={{ gap: 8, borderLeft: '6px solid var(--gold)' }} data-testid="recap-missing">
            <strong>🃏 {nudge.text}</strong>
            <span className="small muted">{missing.filter((m) => m.of > m.have).map((m) => `${m.name}: ${m.have} of ${m.of} in`).join(' · ')}</span>
            <AddCard round={nudge.round} organiser={organiser} />
          </div>
        )}

        {(recap?.facts || facts) && (
          <details className="card pad" data-testid="recap-facts">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>What the commentators had to go on</summary>
            <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {factLines(recap?.facts || facts).map((l, i) => <li key={i}>{l.text}</li>)}
            </ul>
          </details>
        )}
        <Link to={`/trip-now/${trip.id}`} className="small" style={{ fontWeight: 700 }}>← The results</Link>
      </div>
    </div>
  );
}

/** Add a missing card: the score screen while the round's open; once it's finished, the organiser's paper cards. */
function AddCard({ round, organiser }) {
  if (!round) return null;
  if (round.status !== 'locked') return <Link to={`/score/${round.id}`} className="btn gold sm" style={{ alignSelf: 'flex-start' }} data-testid="recap-add-card">Add your card</Link>;
  if (organiser) return <Link to={`/round/${round.id}/cards`} className="btn gold sm" style={{ alignSelf: 'flex-start' }} data-testid="recap-add-card">Add the missing cards</Link>;
  return <span className="small" data-testid="recap-add-card">Round’s finished — send your card to the organiser and they’ll pop it in.</span>;
}

/** The script, read out in two voices. */
function Player({ recap, onShare }) {
  const lines = recap.lines || [];
  const reader = useMemo(() => {
    const w = typeof window !== 'undefined' ? window : {};
    return createDuoReader(w.speechSynthesis || null, w.SpeechSynthesisUtterance || null);
  }, []);
  const [at, setAt] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  useEffect(() => () => reader.stop(), [reader]);
  useEffect(() => { reader.stop(); setAt(-1); setPaused(false); }, [recap.id, recap.version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Extension point: a real recorded voice (lib/recap.js recordedAudio) — null until a text-to-speech service is added.
  const recorded = recordedAudio(recap); // eslint-disable-line no-unused-vars
  const play = (from = 0) => {
    if (!canSpeak() || !reader.ok) { setNoVoice(true); return; }
    setPaused(false);
    reader.play(lines, { from, onLine: (i) => setAt(i), onDone: () => { setAt(-1); setPaused(false); } });
  };
  const pause = () => { reader.stop(); setPaused(true); };
  const stop = () => { reader.stop(); setAt(-1); setPaused(false); };
  const playing = at >= 0 && !paused;
  const v = reader.ok ? reader.voices() : null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="card pad stack" style={{ gap: 8, background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff', textAlign: 'center' }} data-testid="recap-hero">
        <span className="label" style={{ color: 'var(--on-navy-muted)' }}>📺 The Weekend Recap</span>
        <strong style={{ fontSize: 22, lineHeight: 1.2 }} data-testid="recap-title">{recap.title}</strong>
        <span className="small" style={{ color: 'var(--on-navy-muted)' }}>with {VOICES.A.name} ({VOICES.A.role.toLowerCase()}) and {VOICES.B.name} ({VOICES.B.role.toLowerCase()})</span>
        <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {!playing && <button type="button" className="btn gold" onClick={() => play(paused && at >= 0 ? at : 0)} data-testid="recap-play">{paused && at >= 0 ? '▶️ Keep going' : '▶️ Play it'}</button>}
          {playing && <button type="button" className="btn gold" onClick={pause} data-testid="recap-pause">⏸ Pause</button>}
          {at >= 0 && <button type="button" className="btn ghost" style={ON_NAVY} onClick={stop} data-testid="recap-stop">⏹ Stop</button>}
          <button type="button" className="btn ghost" style={ON_NAVY} onClick={onShare} data-testid="recap-share">📤 Share to the group chat</button>
        </div>
        {noVoice && <span className="small" style={{ color: 'var(--on-navy-muted)' }} data-testid="recap-novoice">Your phone can’t read this out — here’s the script.</span>}
        {!noVoice && v?.A && <span className="small" style={{ color: 'var(--on-navy-muted)' }}>Voices: {VOICES.A.short} — {v.A.name}{v.distinct ? ` · ${VOICES.B.short} — ${v.B.name}` : ` (${VOICES.B.short} in a higher voice)`}</span>}
      </div>
      <ol className="card pad stack" style={{ gap: 6, listStyle: 'none', margin: 0 }} data-testid="recap-transcript">
        {lines.map((l, i) => (
          <li key={i} data-testid="recap-line" aria-current={at === i ? 'true' : undefined}
            style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 8, padding: '6px 8px', borderRadius: 8, background: at === i ? 'var(--gold-soft)' : 'transparent', transition: 'background .2s' }}>
            <button type="button" onClick={() => play(i)} aria-label={`Play from ${VOICES[l.who].short}’s line`}
              style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 15, color: l.who === 'A' ? 'var(--navy)' : 'var(--up)', borderLeft: `4px solid ${VOICE_COLOUR[l.who]}`, paddingLeft: 6, alignSelf: 'start' }}>
              {VOICES[l.who].short}
            </button>
            <span style={{ fontWeight: at === i ? 700 : 400, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
