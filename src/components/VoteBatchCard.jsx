import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, playerName } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, appLink, shareText } from '../lib/push.js';
import { todayISO } from '../lib/plan.js';
import { batchNonVoters } from '../lib/tripbuilder.js';
import { organiserView, hasAnsweredAll, sectionResults, timeLeft, closesWord, groupBallot, detailCounts, detailQuestion, detailVerdict, votersOf, lastDayNudge, ballotHeader } from '../lib/callvote.js';
import { PollCard, DecidedLine } from './PollCard.jsx';
import { closedAtLockIn } from '../lib/lockin.js';
import { replies, repliesLine } from '../lib/headcount.js';
import { useOptionKeys, detailsFor, OptionDetailsSheet } from './OptionDetails.jsx';
import { ShareVoteButton } from './CallVote.jsx';

// Combined vote cards (077): several polls on a trip shown as ONE card with a section each ("Where and when?":
// area · weekend · are you keen?). One notification, one closing date, reminders only to people who haven't answered
// every section. The polls are ordinary planner polls (vote_batch set), so older app versions still show them one by one.
//
// Two views (080): organisers get the results (tallies, leader, who's answered, Nudge, Extend, Share / How it goes
// out; Close now & pick the winner and Add an option per section) with their own ballot as a small "Your vote";
// players get just the ballot, then "Thanks — here's how it's looking". Organisers can flip with "See it as a voter".

/** The trip's vote cards, loaded on their own (an older database without 077: nothing shown). */
export function useVoteBatches(planId) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('vote_batches').select('*').eq('plan_id', planId).order('created_at');
    if (!error) setRows(data || []);
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['vote_batches'], load);
  return [rows, load];
}

export function VoteBatches({ pd, voterOnly = false, openOnly = false }) {
  const [batches] = useVoteBatches(pd.plan.id);
  const shown = batches.filter((b) => pd.polls.some((p) => p.vote_batch === b.id && (!openOnly || p.status === 'open')));
  if (!shown.length) return null;
  return <>{shown.map((b) => <VoteBatchCard key={b.id} batch={b} pd={pd} voterOnly={voterOnly} />)}</>;
}

// V3 (walkthrough): "Are you in?" comes first, with the same Yes / Maybe / No as every other question.
const KEEN = [['in', '✓ Yes', 'var(--navy)'], ['maybe', '? Maybe', '#7A5A00'], ['out', '✗ No', 'var(--under)']];

// voterOnly: the ballot only, even for organisers (the Overview; the results are on Organise → Vote).
export function VoteBatchCard({ batch, pd, voterOnly = false }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [busy, run] = useRun();
  const [asVoter, setAsVoter] = useState(false);
  const [extend, setExtend] = useState(null);
  const all = pd.polls.filter((p) => p.vote_batch === batch.id);
  // ov23: the main questions (areas, weekends, how long…) and the optional detail under each area.
  const { main: polls, areas: detailAreas } = groupBallot(all);
  const counts = detailCounts(all, pd.votes);
  const [openArea, setOpenArea] = useState({});
  const st = useOptionKeys(pd.plan.id); // the builder's state: option details, and the ballot's header line (V3)
  const [showing, setShowing] = useState(null); // { option, detail }
  const details = (o) => { const d = detailsFor(o, st); return d ? () => setShowing({ option: o, detail: d }) : null; };
  const open = all.some((p) => p.status === 'open');
  const people = data.players.filter((p) => p.approved !== false).map((p) => p.id);
  const waiting = open ? batchNonVoters({ polls: polls.filter((p) => p.status === 'open'), votes: pd.votes, rsvps: pd.rsvps, keen: batch.keen, playerIds: people }) : [];
  const mine = pd.rsvps.find((r) => r.player_id === me)?.status;
  const keen = (s) => run(async () => {
    await must(supabase.from('plan_rsvps').upsert({ plan_id: pd.plan.id, player_id: me, status: s, updated_at: new Date().toISOString() }));
    pd.reload();
  });
  const sections = polls.length + (batch.keen ? 1 : 0);
  const canRun = !voterOnly && organiserView({ isAdmin: status.is_admin && !status.viewing, me, plan: pd.plan });
  const org = canRun && !asVoter;
  const doneAll = hasAnsweredAll({ polls: polls.filter((p) => p.status === 'open'), votes: pd.votes, me, keen: batch.keen, rsvps: pd.rsvps });
  const name = (id) => playerName(data.playersById[id]);
  const answeredCount = polls.filter((p) => pd.votes.some((v) => v.poll_id === p.id && v.player_id === me)).length + (batch.keen && mine ? 1 : 0);
  // V3: "South Coast NSW · about $450 each · 2 hr drive · 9 in so far" (saved with the vote when it was called).
  const header = ballotHeader({ areas: st?.voteHeader?.[batch.id]?.areas || [], ins: replies({ players: data.players, rsvps: pd.rsvps }).in });
  // I3: the last day of the vote — who it's waiting on, and a cheeky message for the group chat.
  const nudge = open ? lastDayNudge({ closes: batch.closes_on, today: todayISO(), waiting: waiting.map(name), planName: pd.plan.name, title: batch.title, link: appLink(`/plan/${pd.plan.id}?tab=vote`) }) : null;
  const voters = votersOf(polls, pd.votes);
  const keenFirst = batch.keen ? 1 : 0;
  const looking = polls.map((p) => {
    const r = sectionResults(p, pd.options, pd.votes, people);
    return r.leader ? `${p.question.replace(/\?$/, '')}: ${r.leader.option.label}` : null;
  }).filter(Boolean);
  const moveClose = () => run(async () => {
    await must(supabase.from('vote_batches').update({ closes_on: extend }).eq('id', batch.id));
    for (const p of all.filter((x) => x.status === 'open')) await must(supabase.from('plan_polls').update({ closes_on: extend }).eq('id', p.id));
    setExtend(null);
    pd.reload();
  }, 'Closing date moved');
  if (!open && all.length && all.every((p) => closedAtLockIn(p, pd.plan))) return <DecidedLine plan={pd.plan} titles={[batch.title]} />;
  const keenCard = batch.keen && (
    <div className="card pad stack" data-testid="vote-batch-keen" style={{ gap: 8 }}>
      <div className="small muted" style={{ fontWeight: 800 }}>1 of {sections}</div>
      <strong style={{ fontSize: 18 }}>Are you in?</strong>
      {me && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {KEEN.map(([v, label, colour]) => (
            <button key={v} type="button" className="btn ghost sm" aria-pressed={mine === v} disabled={busy || (pd.plan.rsvp_locked && !status.is_admin)}
              style={{ minHeight: 48, ...(mine === v ? { background: colour, borderColor: colour, color: '#fff' } : {}) }} onClick={() => keen(v)}>{label}</button>
          ))}
        </div>
      )}
      <span className="small muted" data-testid="keen-count">{repliesLine(replies({ players: data.players, rsvps: pd.rsvps }))}</span>
    </div>
  );
  return (
    <div className="card" data-testid="vote-batch" data-view={org ? 'organiser' : 'voter'} style={{ overflow: org ? 'hidden' : 'visible', borderColor: 'var(--navy)', borderWidth: 2 }}>
      <div style={{ padding: '12px 14px', background: 'var(--navy)', color: '#fff' }}>
        <div className="small" style={{ fontWeight: 700, opacity: 0.85 }}>🗳️ {sections} quick question{sections === 1 ? '' : 's'}{open ? (batch.closes_on ? ` · closes ${closesWord(batch.closes_on, todayISO())}` : ' · open') : ' · closed'}</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{batch.title}</div>
        {open && <div className="small" style={{ fontWeight: 700, opacity: 0.9 }} data-testid="ballot-header">{header}</div>}
        {canRun && (
          <button type="button" className="btn ghost sm" style={{ marginTop: 6, color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent' }} onClick={() => setAsVoter(!asVoter)} data-testid="see-as-voter">
            {asVoter ? '📊 Back to the results' : '👀 See it as a voter'}
          </button>
        )}
      </div>
      {org && open && (
        <div className="stack" style={{ padding: '10px 14px', gap: 8, background: 'var(--ground)' }} data-testid="batch-dashboard">
          <div className="small"><strong>{timeLeft(batch.closes_on, todayISO())}</strong> · {people.length - waiting.length} of {people.length} answered everything</div>
          {waiting.length > 0 && <div className="small" data-testid="vote-batch-waiting"><strong>Still to answer ({waiting.length}):</strong> <span className="muted">{waiting.map(name).join(', ')}</span></div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {waiting.length > 0 && (
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => {
                const r = await notify('nudge_votes', { plan_id: pd.plan.id });
                toast(`Reminder sent to ${r?.sent || 0} phone${r?.sent === 1 ? '' : 's'}`);
              })}>🔔 Nudge</button>
            )}
            {extend == null
              ? <button type="button" className="btn ghost sm" onClick={() => setExtend(batch.closes_on || todayISO())}>📅 Extend</button>
              : (
                <span className="row" style={{ gap: 6 }}>
                  <input className="input" type="date" value={extend} min={todayISO()} onChange={(e) => setExtend(e.target.value)} aria-label="New closing date" style={{ width: 150 }} />
                  <button type="button" className="btn sm" disabled={busy} onClick={moveClose}>Save</button>
                </span>
              )}
          </div>
          <ShareVoteButton plan={pd.plan} title={batch.title} closes={batch.closes_on} />
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAsVoter(true)} data-testid="your-vote">🗳️ Your vote{doneAll ? ' ✓' : ''}</button>
        </div>
      )}
      {!org && open && me && (
        <div className="small" data-testid="voter-progress" style={{ position: 'sticky', top: 0, zIndex: 5, padding: '8px 14px', background: 'var(--navy)', color: '#fff', fontWeight: 700 }}>
          {answeredCount} of {sections} answered · saved as you go{batch.closes_on ? ` · closes ${closesWord(batch.closes_on, todayISO())}` : ''}
        </div>
      )}
      {!org && open && doneAll && (
        <div className="small" style={{ padding: '10px 14px', background: 'var(--gold-soft)' }} data-testid="voter-thanks">
          <strong>Thanks — here’s how it’s looking:</strong> {looking.length ? looking.join(' · ') : 'no votes yet'}. You can change your answers until it closes.
        </div>
      )}
      {nudge && (
        <div className="row" style={{ padding: '8px 14px', gap: 8, background: 'var(--gold-soft)', flexWrap: 'wrap', alignItems: 'center' }} data-testid="last-day-nudge">
          <span className="small grow" style={{ fontWeight: 700 }}>⏰ Last day · {nudge.line}</span>
          <button type="button" className="btn ghost sm" onClick={async () => {
            const r = await shareText(nudge.message, pd.plan.name);
            if (r === 'copied') toast('Copied — paste it in the group chat');
          }} data-testid="nudge-chat">💬 Nudge them in the group chat</button>
        </div>
      )}
      <div className="stack" style={{ padding: 10, gap: 10 }}>
        {keenCard}
        {polls.map((p, i) => (
          <div key={p.id} data-testid="vote-batch-section">
            <div className="small muted" style={{ fontWeight: 800, margin: '0 4px 4px' }}>{i + 1 + keenFirst} of {sections}</div>
            <PollCard poll={p} pd={pd} inCard asVoter={!org} details={details} />
          </div>
        ))}
        {detailAreas.length > 0 && (
          <div className="stack" style={{ gap: 8 }} data-testid="vote-detail">
            <div className="small muted" style={{ fontWeight: 800, margin: '4px 4px 0' }}>
              {org ? 'The detail (optional for voters)' : 'Want a say on the courses and places? Optional — the questions above are enough.'}
            </div>
            {detailAreas.map(({ area, polls: ps }) => {
              const isOpen = org || !!openArea[area];
              return (
                <div key={area} className="card" style={{ overflow: 'hidden' }} data-testid="vote-detail-area" data-area={area}>
                  <button type="button" className="row between" onClick={() => setOpenArea({ ...openArea, [area]: !openArea[area] })} aria-expanded={isOpen}
                    style={{ width: '100%', padding: '10px 14px', background: 'var(--ground)', border: 0, textAlign: 'left', color: 'inherit', font: 'inherit', minHeight: 48 }}>
                    <span><strong>📍 If it’s {area}</strong>
                      <span className="small muted" style={{ display: 'block' }} data-testid="detail-count">{org ? detailVerdict(counts[area] || 0, voters).line : ps.map((p) => detailQuestion(p).replace(/\?$/, '')).join(' · ')}</span></span>
                    {!org && <span className="small" style={{ fontWeight: 700 }}>{isOpen ? 'Hide ▴' : 'Go into the detail →'}</span>}
                  </button>
                  {isOpen && (
                    <div className="stack" style={{ padding: 8, gap: 8 }}>
                      {ps.map((p) => <div key={p.id} data-testid="vote-detail-section"><PollCard poll={p} pd={pd} inCard asVoter={!org} details={details} title={detailQuestion(p)} /></div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {showing && <OptionDetailsSheet option={showing.option} detail={showing.detail} st={st} onClose={() => setShowing(null)} />}
      </div>
    </div>
  );
}
