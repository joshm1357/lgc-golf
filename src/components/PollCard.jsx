// One vote (a planner poll), two views (080, Josh 22 Oct: "the organiser sees the voting like they are a participant;
// there should be different types of pages"):
//   * Organiser view (the admin, or the trip's organiser): the results — per option the tally, the leader, how many
//     are against ("3 don't like it"), who's answered and who hasn't (Nudge), time left, and actions: extend the
//     closing date, close now & pick the winner, add an option, share. Their own ballot is a small "Your vote" part.
//   * Voter view: just the ballot — clear options, big buttons, "Closes Fri", answers saved, then "Thanks — here's
//     how it's looking".
// The words depend on what's voted on: dates ✓ Can / ? Maybe / ✗ Can't; places ⭐ Prefer / 👍 Option / 👎 Don't like;
// extras ⭐ Want it / 👍 Happy either way / 👎 Skip it. Stored the same (yes / maybe / no), scored 2 / 1 / 0.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { Icon, toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, appLink } from '../lib/push.js';
import { tallyPoll, nonVoters, nudgeText, todayISO } from '../lib/plan.js';
import { canDecide } from '../lib/trips.js';
import { answersFor, answerKind } from '../lib/emailvotes.js';
import { sectionResults, organiserView, timeLeft, closesWord } from '../lib/callvote.js';
import { EmailVoteLine } from './VoteEmail.jsx';
import { ShareVoteButton } from './CallVote.jsx';
import { OptionSheet, CloseSheet, optionTitle, everyone, shareNudge } from '../screens/Planner.jsx';

const TONE = { yes: 'var(--navy)', maybe: '#7A5A00', no: 'var(--under)' };

/** A tappable "View places" / "Have a look" link for an option that has one (an Airbnb list, a listing, a course). */
export function OptionLink({ o, kind }) {
  if (!o.link) return null;
  const list = /wishlist|tripboard|trip-board|mywishlist|\/lists?\//i.test(o.link);
  return <a href={o.link} target="_blank" rel="noreferrer noopener" className="small" style={{ fontWeight: 700 }} data-testid="option-link">{list || kind === 'place' ? 'View places ↗' : 'Have a look ↗'}</a>;
}

export function PollCard({ poll, pd, inCard = false, asVoter = false }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [suggesting, setSuggesting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [extend, setExtend] = useState(null);
  const [busy, run] = useRun();
  const options = pd.options.filter((o) => o.poll_id === poll.id);
  const votes = pd.votes.filter((v) => v.poll_id === poll.id);
  const rows = tallyPoll(options, votes);
  const isOpen = poll.status === 'open';
  const people = everyone(data);
  const waiting = nonVoters(options, votes, people.map((p) => p.id));
  const words = answersFor(poll);
  const kind = answerKind(poll);
  const org = organiserView({ isAdmin: status.is_admin && !status.viewing, me, plan: pd.plan, asVoter });
  const results = sectionResults(poll, options, votes, people.map((p) => p.id));
  const kindLabel = { dates: '📅 Dates', location: '📍 Location', other: '🗳️ Vote' }[poll.kind];
  const [partners, setPartners] = useState({});
  const placeNames = poll.kind === 'location' ? options.map((o) => o.label).filter(Boolean).join('|') : '';
  useEffect(() => {
    if (!placeNames) return undefined;
    let live = true;
    supabase.rpc('partner_courses_for', { p_names: placeNames.split('|') })
      .then(({ data: m }) => live && setPartners(Object.fromEntries((m || []).map((x) => [x.name, x.slug]))), () => {});
    return () => { live = false; };
  }, [placeNames]);

  const respond = (o, r) => run(async () => {
    const mine = votes.find((v) => v.option_id === o.id && v.player_id === me);
    if (mine?.response === r) await must(supabase.from('plan_votes').delete().eq('option_id', o.id).eq('player_id', me));
    else await must(supabase.from('plan_votes').upsert({ option_id: o.id, poll_id: poll.id, player_id: me, response: r, updated_at: new Date().toISOString() }));
    pd.reload();
  });
  const decider = canDecide({ isAdmin: status.is_admin, me, plan: pd.plan, voteDecider: pd.voteDecider });
  const closesText = poll.closes_on ? `closes ${closesWord(poll.closes_on, todayISO())}` : 'open';
  const iAnswered = me && options.length > 0 && votes.some((v) => v.player_id === me);
  const iAnsweredAll = me && options.length > 0 && options.every((o) => votes.some((v) => v.option_id === o.id && v.player_id === me));

  // ---------------------------------------------------------------- the ballot (voter rows)
  const ballot = (big = true) => rows.map((r) => {
    const o = r.option;
    const winner = poll.winner_option_id === o.id;
    const mine = votes.find((v) => v.option_id === o.id && v.player_id === me)?.response;
    const canRemove = isOpen && (o.created_by === me || status.is_admin);
    return (
      <div key={o.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', background: winner ? 'var(--gold-soft)' : '#fff' }} data-testid="ballot-option">
        <div style={{ fontWeight: 700, fontSize: 16 }}>{winner && '✅ '}{optionTitle(poll, o)}</div>
        {(o.address || o.cost_pp != null || o.notes) && <div className="small muted">{[o.address, o.cost_pp != null ? `~$${Number(o.cost_pp)} pp` : null, o.notes].filter(Boolean).join(' · ')}</div>}
        <OptionLink o={o} kind={kind} />
        {partners[o.label] && <a href={`#/c/${partners[o.label]}?enquire=1`} className="small" style={{ display: 'block', fontWeight: 700 }}>Partner course · Ask about a group booking →</a>}
        {isOpen && me && (
          <div style={{ display: 'grid', gridTemplateColumns: canRemove && !big ? '1fr 1fr 1fr auto' : '1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
            {['yes', 'maybe', 'no'].map((v) => (
              <button key={v} type="button" className="btn ghost sm" aria-pressed={mine === v} disabled={busy} data-answer={v}
                style={{ minHeight: big ? 48 : 40, fontSize: 14, padding: '6px 4px', ...(mine === v ? { background: TONE[v], borderColor: TONE[v], color: '#fff' } : {}) }} onClick={() => respond(o, v)}>{words[v]}</button>
            ))}
            {canRemove && !big && (
              <button type="button" className="btn ghost sm" aria-label="Remove option" onClick={() => { if (window.confirm('Remove this option and its votes?')) run(async () => { await must(supabase.from('plan_options').delete().eq('id', o.id)); pd.reload(); }); }}>{Icon.x(14)}</button>
            )}
          </div>
        )}
      </div>
    );
  });

  const header = (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
      <div className="small muted" style={{ fontWeight: 700 }}>{kindLabel} · {isOpen ? closesText : 'closed'}{org && isOpen ? ' · results' : ''}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{poll.question}</div>
    </div>
  );

  // ---------------------------------------------------------------- organiser view: the results
  if (org) {
    const name = (id) => playerName(data.playersById[id]);
    return (
      <div className="card" style={{ overflow: 'hidden' }} data-testid="poll-organiser">
        {header}
        {rows.length === 0 && <div className="empty">No options yet — add one.</div>}
        {results.rows.map((r) => {
          const o = r.option;
          const winner = poll.winner_option_id === o.id;
          return (
            <div key={o.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', background: winner ? 'var(--gold-soft)' : r.leading && isOpen ? '#FBFAF4' : '#fff' }} data-testid="result-row">
              <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{winner && '✅ '}{optionTitle(poll, o)}{!winner && r.leading && isOpen && <span className="small" style={{ marginLeft: 6, color: '#7A5A00', fontWeight: 800 }}>LEADING</span>}</div>
                  {(o.cost_pp != null || o.notes) && <div className="small muted">{[o.cost_pp != null ? `~$${Number(o.cost_pp)} pp` : null, o.notes].filter(Boolean).join(' · ')}</div>}
                  <OptionLink o={o} kind={kind} />
                  {r.against && <div className="small" style={{ color: 'var(--under)', fontWeight: 700 }} data-testid="against">⚠️ {r.against}</div>}
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div className="num" style={{ fontSize: 20 }}>{r.score}</div>
                  <div className="small muted">{words.yes.split(' ')[0]}{r.yes} {words.maybe.split(' ')[0]}{r.maybe} {words.no.split(' ')[0]}{r.no}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="stack" style={{ padding: '10px 14px', gap: 8 }}>
          <EmailVoteLine poll={poll} pd={pd} />
          {!inCard && isOpen && (
            <>
              <div className="small"><strong>{timeLeft(poll.closes_on, todayISO())}</strong> · {results.answered.length} of {people.length} answered</div>
              {waiting.length > 0 && <div className="small" data-testid="poll-waiting"><strong>Still to vote ({waiting.length}):</strong> <span className="muted">{waiting.map(name).join(', ')}</span></div>}
              {waiting.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const r = await notify('nudge_votes', { plan_id: pd.plan.id }); toast(`Reminder sent to ${r?.sent || 0} phone${r?.sent === 1 ? '' : 's'}`); })}>🔔 Nudge</button>
                  <button type="button" className="btn ghost sm" onClick={() => shareNudge(nudgeText('votes', { plan: pd.plan, names: waiting.map(name), url: appLink(`/plan/${pd.plan.id}?tab=vote`) }))}>💬 Nudge in the chat</button>
                </div>
              )}
            </>
          )}
          {isOpen && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {!inCard && (extend == null
                ? <button type="button" className="btn ghost sm" onClick={() => setExtend(poll.closes_on || todayISO())}>📅 Extend</button>
                : (
                  <span className="row" style={{ gap: 6 }}>
                    <input className="input" type="date" value={extend} min={todayISO()} onChange={(e) => setExtend(e.target.value)} aria-label="New closing date" style={{ width: 150 }} />
                    <button type="button" className="btn sm" disabled={busy} onClick={() => run(async () => { await must(supabase.from('plan_polls').update({ closes_on: extend }).eq('id', poll.id)); setExtend(null); pd.reload(); }, 'Closing date moved')}>Save</button>
                  </span>
                ))}
              <button type="button" className="btn ghost sm" onClick={() => setSuggesting(true)}>+ Add an option</button>
              {decider && <button type="button" className="btn sm" onClick={() => setClosing(true)} data-testid="close-pick">Close now & pick the winner</button>}
            </div>
          )}
          {!inCard && isOpen && <ShareVoteButton plan={pd.plan} title={poll.question} closes={poll.closes_on} />}
          {isOpen && me && (
            <div className="stack" style={{ gap: 4 }}>
              <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMineOpen(!mineOpen)} data-testid="your-vote">🗳️ Your vote{iAnswered ? ' ✓' : ''} {mineOpen ? '▴' : '▾'}</button>
              {mineOpen && <div className="card" style={{ overflow: 'hidden' }}>{ballot(false)}</div>}
            </div>
          )}
          {status.is_admin && !isOpen && <button type="button" className="btn ghost sm" onClick={() => run(async () => { await must(supabase.from('plan_polls').update({ status: 'open', winner_option_id: null }).eq('id', poll.id)); pd.reload(); }, 'Vote reopened')}>Reopen this vote</button>}
        </div>
        {suggesting && <OptionSheet poll={poll} onClose={() => setSuggesting(false)} onSaved={pd.reload} />}
        {closing && <CloseSheet poll={poll} rows={rows} pd={pd} onClose={() => setClosing(false)} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- voter view: the ballot
  const top = results.rows.filter((r) => r.score > 0).slice(0, 3);
  return (
    <div className="card" style={{ overflow: 'hidden' }} data-testid="poll-voter">
      {header}
      {rows.length === 0 && <div className="empty">No options yet — suggest one.</div>}
      {ballot(true)}
      <div className="stack" style={{ padding: '10px 14px', gap: 8 }}>
        {isOpen && iAnsweredAll && !inCard && (
          <div className="small" data-testid="voter-thanks"><strong>Thanks — here’s how it’s looking:</strong> {top.length ? top.map((r) => `${optionTitle(poll, r.option)} (${r.score})`).join(' · ') : 'no votes yet'}</div>
        )}
        {!isOpen && results.leader && <div className="small muted">Most votes: {optionTitle(poll, results.leader.option)}</div>}
        {isOpen && <button type="button" className="btn ghost sm" onClick={() => setSuggesting(true)}>+ Suggest {poll.kind === 'dates' ? 'dates' : poll.kind === 'location' ? 'a place' : 'an option'}</button>}
        {isOpen && !inCard && waiting.length > 0 && <div className="small muted">{waiting.length} still to vote</div>}
      </div>
      {suggesting && <OptionSheet poll={poll} onClose={() => setSuggesting(false)} onSaved={pd.reload} />}
    </div>
  );
}
