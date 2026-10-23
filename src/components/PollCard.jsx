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
import { Icon, toast, askConfirm } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, appLink, shareText } from '../lib/push.js';
import { tallyPoll, nonVoters, nudgeText, todayISO } from '../lib/plan.js';
import { canDecide } from '../lib/trips.js';
import { answersFor, answerKind } from '../lib/emailvotes.js';
import { sectionResults, organiserView, timeLeft, closesWord, lastDayNudge } from '../lib/callvote.js';
import { EmailVoteLine } from './VoteEmail.jsx';
import { ShareVoteButton } from './CallVote.jsx';
import { DetailsButton } from './OptionDetails.jsx';
import { addExtrasToPlan } from './ExtrasPanel.jsx';
import { extraWins, extrasFromOptions } from '../lib/extras.js';
import { closedAtLockIn, decidedLine } from '../lib/lockin.js';
import { OptionSheet, CloseSheet, optionTitle, everyone, shareNudge } from '../screens/Planner.jsx';
import './planux.css';
import { gate } from '../lib/savedgate.js';

const TONE = { yes: 'var(--navy)', maybe: '#7A5A00', no: 'var(--under)' };

/** A tappable "View places" / "Have a look" link for an option that has one (an Airbnb list, a listing, a course). */
export function OptionLink({ o, kind }) {
  if (!o.link) return null;
  const list = /wishlist|tripboard|trip-board|mywishlist|\/lists?\//i.test(o.link);
  return <a href={o.link} target="_blank" rel="noreferrer noopener" className="small" style={{ fontWeight: 700 }} data-testid="option-link">{list || kind === 'place' ? 'View places ↗' : 'Have a look ↗'}</a>;
}

/** I3: on a vote's last day, "Waiting on Lou, Mo and Pete" and a one-tap cheeky message for the group chat. */
export function LastDayNudge({ poll, pd, names }) {
  const n = lastDayNudge({ closes: poll.closes_on, today: todayISO(), waiting: names, planName: pd.plan.name, title: poll.question, link: appLink(`/plan/${pd.plan.id}?tab=vote`) });
  if (!n) return null;
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="last-day-nudge">
      <span className="small grow" style={{ fontWeight: 700 }}>⏰ Last day · {n.line}</span>
      <button type="button" className="btn ghost sm" onClick={async () => { const r = await shareText(n.message, pd.plan.name); if (r === 'copied') toast('Copied — paste it in the group chat'); }} data-testid="nudge-chat">💬 Nudge them in the group chat</button>
    </div>
  );
}

/** V1: a vote closed when the trip was locked in — one line, "Decided: Fri 22 – Mon 25 Jan, Nowra". */
export function DecidedLine({ plan, titles = [] }) {
  return (
    <div className="card pad row" style={{ gap: 10, alignItems: 'center', background: 'var(--ground)' }} data-testid="decided-line">
      <span aria-hidden="true" style={{ fontSize: 20 }}>✅</span>
      <span className="grow" style={{ minWidth: 0 }}><strong>{decidedLine(plan)}</strong>
        {titles.length > 0 && <span className="small muted" style={{ display: 'block' }}>{titles.join(' · ')} — closed when the trip was locked in</span>}</span>
    </div>
  );
}

// details (ov23): (option) → a function that opens its details sheet, or null. Adds "ⓘ Details" to the option.
export function PollCard({ poll, pd, inCard = false, asVoter = false, details = null, title = null }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [suggesting, setSuggesting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [extend, setExtend] = useState(null);
  const [expanded, setExpanded] = useState(!inCard);
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
  if (closedAtLockIn(poll, pd.plan) && !inCard) return <DecidedLine plan={pd.plan} titles={[title || poll.question]} />;

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
      <div key={o.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', background: winner ? 'var(--gold-soft)' : '#fff' }} data-testid="ballot-option" title={o.notes || undefined}>
        <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{winner && '✅ '}{optionTitle(poll, o)}</div>
          {details?.(o) && <DetailsButton onClick={details(o)} label={o.label} />}
        </div>
        {(o.address || o.cost_pp != null || o.notes) && <div className="small muted" data-testid="option-summary-line">{[o.address, o.cost_pp != null ? `~$${Number(o.cost_pp)} pp` : null, o.notes].filter(Boolean).join(' · ')}</div>}
        <OptionLink o={o} kind={kind} />
        {partners[o.label] && <a href={`#/c/${partners[o.label]}?enquire=1`} className="small" style={{ display: 'block', fontWeight: 700 }}>Partner course · Ask about a group booking →</a>}
        {isOpen && me && (
          <div style={{ display: 'grid', gridTemplateColumns: canRemove && !big ? '1fr 1fr 1fr auto' : '1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
            {['yes', 'maybe', 'no'].map((v) => (
              <button key={v} type="button" className="btn ghost sm" aria-pressed={mine === v} disabled={busy} data-answer={v}
                style={{ minHeight: big ? 48 : 40, fontSize: 14, padding: '6px 4px', ...(mine === v ? { background: TONE[v], borderColor: TONE[v], color: '#fff' } : {}) }} onClick={() => respond(o, v)}>{words[v]}</button>
            ))}
            {canRemove && !big && (
              <button type="button" className="btn ghost sm" aria-label="Remove option" onClick={async () => { if (await askConfirm({ title: 'Remove this option and its votes?', yes: 'Remove it' })) run(async () => { await must(supabase.from('plan_options').delete().eq('id', o.id)); pd.reload(); }); }}>{Icon.x(14)}</button>
            )}
          </div>
        )}
      </div>
    );
  });

  const header = (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
      <div className="small muted" style={{ fontWeight: 700 }}>{kindLabel} · {isOpen ? closesText : 'closed'}{org && isOpen ? ' · results' : ''}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{title || poll.question}</div>
    </div>
  );

  // ---------------------------------------------------------------- organiser view: the results
  if (org) {
    const name = (id) => playerName(data.playersById[id]);
    if (inCard && !expanded) {
      const lead = results.leader;
      return (
        <button type="button" className="card" onClick={() => setExpanded(true)} data-testid="poll-organiser" data-collapsed="true"
          style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
          <div className="row between" style={{ gap: 8 }}>
            <strong>{title || poll.question}</strong><span className="small muted">▾</span>
          </div>
          <div className="small">{lead ? <>Leading: <strong>{optionTitle(poll, lead.option)}</strong> ({lead.score})</> : 'No votes yet'} · {options.length} option{options.length === 1 ? '' : 's'} · {results.answered.length} answered</div>
          {results.rows.filter((r) => r.against).slice(0, 2).map((r) => <div key={r.option.id} className="small" style={{ color: 'var(--under)', fontWeight: 700 }} data-testid="against">⚠️ {optionTitle(poll, r.option)}: {r.against}</div>)}
        </button>
      );
    }
    return (
      <div className="card" style={{ overflow: 'hidden' }} data-testid="poll-organiser">
        {inCard ? <button type="button" onClick={() => setExpanded(false)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit' }}>{header}</button> : header}
        {rows.length === 0 && <div className="empty">No options yet — add one.</div>}
        {rows.length > 0 && (
          <div className="res-table" data-testid="results-table">
            <table>
              <thead><tr><th>Option</th><th>Total</th>{people.map((p) => <th key={p.id} title={playerName(p)}>{playerName(p).slice(0, 6)}</th>)}</tr></thead>
              <tbody>
                {results.rows.map((r) => (
                  <tr key={r.option.id} className={r.leading && isOpen ? 'lead' : ''}>
                    <td><strong>{poll.winner_option_id === r.option.id ? '✅ ' : ''}{optionTitle(poll, r.option)}</strong>{r.against && <span style={{ color: 'var(--under)', fontWeight: 700 }}> · {r.against}</span>} <OptionLink o={r.option} kind={kind} /></td>
                    <td><strong>{r.score}</strong></td>
                    {people.map((p) => {
                      const v = votes.find((x) => x.option_id === r.option.id && x.player_id === p.id)?.response;
                      return <td key={p.id} title={v ? words[v] : 'No answer'}>{v ? words[v].split(' ')[0] : '·'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="res-rows">
        {results.rows.map((r) => {
          const o = r.option;
          const winner = poll.winner_option_id === o.id;
          return (
            <div key={o.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', background: winner ? 'var(--gold-soft)' : r.leading && isOpen ? '#FBFAF4' : '#fff' }} data-testid="result-row">
              <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div className="grow">
                  <div style={{ fontWeight: 700 }} title={o.notes || undefined}>{winner && '✅ '}{optionTitle(poll, o)}{!winner && r.leading && isOpen && <span className="small" style={{ marginLeft: 6, color: '#7A5A00', fontWeight: 800 }}>LEADING</span>}
                    {details?.(o) && <span style={{ marginLeft: 6 }}><DetailsButton onClick={details(o)} label={o.label} /></span>}</div>
                  {(o.cost_pp != null || o.notes) && <div className="small muted" data-testid="option-summary-line">{[o.cost_pp != null ? `~$${Number(o.cost_pp)} pp` : null, o.notes].filter(Boolean).join(' · ')}</div>}
                  <OptionLink o={o} kind={kind} />
                  {partners[o.label] && <a href={`#/c/${partners[o.label]}?enquire=1`} className="small" style={{ display: 'block', fontWeight: 700 }}>Partner course · Ask about a group booking →</a>}
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
        </div>
        <div className="stack" style={{ padding: '10px 14px', gap: 8 }}>
          {!inCard && <EmailVoteLine poll={poll} pd={pd} />}
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
              {decider && <button {...gate('call_vote')} type="button" className="btn sm" onClick={() => setClosing(true)} data-testid="close-pick">Close now & pick the winner</button>}
            </div>
          )}
          {kind === 'extra' && decider && results.rows.some((r) => extraWins(r)) && (
            <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="extras-winners"
              onClick={() => run(async () => {
                const won = results.rows.filter((r) => extraWins(r)).map((r) => r.option);
                const r = await addExtrasToPlan(pd.plan, extrasFromOptions(won));
                return r.budgetRows.length || r.jobRows.length ? `Added ${won.length} to the trip plan` : 'Already in the trip plan';
              }).then((m) => m && toast(m))}>+ Add the winners to the trip plan ({results.rows.filter((r) => extraWins(r)).map((r) => r.option.label).join(', ')})</button>
          )}
          {!inCard && isOpen && <ShareVoteButton plan={pd.plan} title={poll.question} closes={poll.closes_on} />}
          {isOpen && me && !inCard && (
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
        {isOpen && !inCard && <LastDayNudge poll={poll} pd={pd} names={waiting.map((id) => playerName(data.playersById[id]))} />}
      </div>
      {suggesting && <OptionSheet poll={poll} onClose={() => setSuggesting(false)} onSaved={pd.reload} />}
    </div>
  );
}
