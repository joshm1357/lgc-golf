// ov34 — a round call-out as a card with the reply buttons right on it: Home's coming-up area, Trips, and the Feed
// post (link '/plan/<id>?c=1'). Replying is one tap: In / Maybe / Can't for a set time (or once it's locked in), or
// ✓ / ? / ✗ per time when there are options. The full screen is screens/RoundCallout.jsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, useFeature, playerName } from '../lib/store.jsx';
import { AvatarStack, toast } from './ui.jsx';
import { notify } from '../lib/push.js';
import { friendlyError } from '../lib/supabase.js';
import { rsvpSpots, optionTally, suggestOption, myStanding, spotsWords, askedIds, optionLabel, clock, dayLabel, sydneyToday, closesWords } from '../lib/callout.js';
import './callout.css';

export const CALLOUT_TABLES = ['plans', 'plan_rsvps', 'plan_votes', 'plan_options', 'plan_polls', 'plan_invites'];

/** '/plan/<id>?c=1' (the Feed post of a call-out) → the plan id, else null. */
export function calloutFromLink(link) {
  const m = /^\/plan\/([0-9a-f-]{36})\?c=1/.exec(String(link || ''));
  return m ? m[1] : null;
}

/** One call-out with its replies, kept up to date. → { plan, rsvps, polls, options, votes, invites, reload } | null */
export function useCallout(planId) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    if (!planId) return;
    const [pl, rs, po, inv] = await Promise.all([
      supabase.from('plans').select('*').eq('id', planId).maybeSingle(),
      supabase.from('plan_rsvps').select('*').eq('plan_id', planId),
      supabase.from('plan_polls').select('*').eq('plan_id', planId),
      supabase.from('plan_invites').select('*').eq('plan_id', planId),
    ]);
    if (pl.error || !pl.data) { setD((cur) => cur || { plan: null }); return; }
    const pollIds = (po.data || []).map((p) => p.id);
    const [op, vo] = pollIds.length
      ? await Promise.all([supabase.from('plan_options').select('*').in('poll_id', pollIds), supabase.from('plan_votes').select('*').in('poll_id', pollIds)])
      : [{ data: [] }, { data: [] }];
    setD({ plan: pl.data, rsvps: rs.data || [], polls: po.data || [], options: op.data || [], votes: vo.data || [], invites: inv.data || [], reload: load });
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(CALLOUT_TABLES, load);
  return d;
}

/** Everything the screens show, worked out once. cd: { plan, rsvps, polls, options, votes, invites } */
export function calloutView(cd, { players = [], me = null } = {}) {
  const { plan } = cd;
  const datesPoll = cd.polls.find((p) => p.kind === 'dates') || null;
  const coursePoll = cd.polls.find((p) => p.kind === 'location') || null;
  const byStart = (a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')) || String(a.tee_time || a.part || '').localeCompare(String(b.tee_time || b.part || ''));
  const options = datesPoll ? cd.options.filter((o) => o.poll_id === datesPoll.id).sort(byStart) : [];
  const courseOptions = coursePoll ? cd.options.filter((o) => o.poll_id === coursePoll.id) : [];
  const locked = plan.status === 'confirmed' || plan.status === 'done';
  const voting = !!datesPoll && !locked && plan.status === 'planning';
  const asked = askedIds({ plan, players, invites: cd.invites });
  const spots = rsvpSpots({ cap: plan.spots, rsvps: cd.rsvps });
  const tally = optionTally(options, cd.votes);
  const best = voting ? suggestOption(options, cd.votes) : null;
  const replied = new Set(voting ? cd.votes.filter((v) => options.some((o) => o.id === v.option_id)).map((v) => v.player_id) : cd.rsvps.map((r) => r.player_id));
  const noReply = asked.filter((id) => !replied.has(id));
  const winner = datesPoll?.winner_option_id ? options.find((o) => o.id === datesPoll.winner_option_id) : null;
  const when = plan.start_date
    ? [dayLabel(String(plan.start_date).slice(0, 10)), plan.tee_time ? clock(plan.tee_time) : (winner?.part || options[0]?.part || null)].filter(Boolean).join(' · ')
    : options.length ? `${options.length} times to pick from` : 'Time TBC';
  const closed = !!plan.closes_at && new Date(plan.closes_at) <= new Date();
  return {
    datesPoll, coursePoll, options, courseOptions, locked, voting, asked, spots, tally, best, noReply, when, closed,
    isAsked: asked.includes(me), standing: myStanding({ cap: plan.spots, rsvps: cd.rsvps }, me),
    myVote: (optionId) => cd.votes.find((v) => v.option_id === optionId && v.player_id === me)?.response || null,
    course: plan.location_name || 'Course TBC',
    closesLine: plan.closes_at ? `${closed ? 'Replies closed' : 'Replies close'} ${closesWords(plan.closes_at)}` : '',
    past: plan.start_date && String(plan.start_date).slice(0, 10) < sydneyToday(),
  };
}

/** Say In / Maybe / Can't (a set time, or after lock-in). Pokes the notify function so a moved-up reserve hears at once. */
export async function replyRsvp(plan, me, status) {
  const { error } = await supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status }, { onConflict: 'plan_id,player_id' });
  if (error) throw error;
  if (plan.status === 'confirmed') await notify('callout_send', { plan_id: plan.id }).catch(() => null);
}
/** ✓ / ? / ✗ on one time. */
export async function replyVote(option, me, response) {
  const { error } = await supabase.from('plan_votes').upsert({ option_id: option.id, poll_id: option.poll_id, player_id: me, response }, { onConflict: 'option_id,player_id' });
  if (error) throw error;
}

export const RSVP_BUTTONS = [{ v: 'in', label: 'I’m in', cls: 'yes' }, { v: 'maybe', label: 'Maybe', cls: 'maybe' }, { v: 'out', label: 'Can’t', cls: 'no' }];
export const VOTE_BUTTONS = [{ v: 'yes', label: '✓', aria: 'Can', cls: 'yes' }, { v: 'maybe', label: '?', aria: 'Maybe', cls: 'maybe' }, { v: 'no', label: '✗', aria: 'Can’t', cls: 'no' }];

/** "You’re in" / "Reserve #1" / … */
export function standingWords(st) {
  if (st.status === 'in') return 'You’re in';
  if (st.status === 'reserve') return `You’re reserve #${st.place}`;
  if (st.status === 'maybe') return 'You: maybe';
  if (st.status === 'out') return 'You can’t make it';
  return 'You haven’t replied';
}

/** The reply buttons (shared by the card and the screen). */
export function ReplyButtons({ cd, v, me, compact = false, maxOptions = 99 }) {
  const [busy, setBusy] = useState(false);
  const { plan } = cd;
  if (!me || !v.isAsked || plan.status === 'cancelled' || v.past) return null;
  const go = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await cd.reload?.(); } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  if (v.voting) {
    const shown = v.options.slice(0, maxOptions);
    return (
      <div className="stack" style={{ gap: 6 }} data-testid="co-ticks">
        {shown.map((o) => {
          const mine = v.myVote(o.id);
          const t = v.tally[o.id] || { yes: 0, maybe: 0 };
          return (
            <div key={o.id} className={`co-tick${v.best?.id === o.id && t.yes > 0 ? ' best' : ''}`} data-testid="co-tick">
              <div style={{ minWidth: 0 }}>
                <strong>{o.label || optionLabel({ date: o.start_date, part: o.part, tee_time: o.tee_time })}</strong>
                <div className="small muted">{t.yes} can{t.maybe ? ` · ${t.maybe} maybe` : ''}{v.best?.id === o.id && t.yes > 0 ? ' · best so far' : ''}</div>
              </div>
              <div className="co-reply" role="group" aria-label={`Can you make ${o.label}?`}>
                {VOTE_BUTTONS.map((b) => (
                  <button key={b.v} type="button" className={b.cls} aria-pressed={mine === b.v} aria-label={b.aria} disabled={busy}
                    onClick={() => go(() => replyVote(o, me, b.v))}>{b.label}</button>
                ))}
              </div>
            </div>
          );
        })}
        {v.options.length > shown.length && <Link to={`/plan/${plan.id}`} className="small">+ {v.options.length - shown.length} more times — open it</Link>}
      </div>
    );
  }
  const mine = cd.rsvps.find((r) => r.player_id === me)?.status || null;
  if (v.locked && mine === 'in' && !compact) return null; // the screen shows "I can't make it now" instead
  return (
    <div className="co-reply" role="group" aria-label="Can you play?" data-testid="co-rsvp">
      {RSVP_BUTTONS.map((b) => (
        <button key={b.v} type="button" className={b.cls} aria-pressed={mine === b.v} disabled={busy}
          onClick={() => go(() => replyRsvp(plan, me, b.v))}>{b.label}</button>
      ))}
    </div>
  );
}

/** The card. planId, or a ready cd (e.g. the screen's). */
export function CalloutCard({ planId, compact = true }) {
  const data = useData();
  const { status } = useSession();
  const plannerOn = useFeature('planner');
  const cd = useCallout(plannerOn ? planId : null);
  const v = useMemo(() => (cd?.plan ? calloutView(cd, { players: data.players, me: status?.player_id }) : null), [cd, data.players, status?.player_id]);
  if (!cd?.plan || !cd.plan.callout || !v) return null;
  if (!v.isAsked && !status?.is_admin) return null; // a list that isn't me: not mine to see on Home
  const { plan } = cd;
  const by = data.playersById[plan.created_by];
  const ins = v.spots.in.map((id) => data.playersById[id]).filter(Boolean);
  return (
    <div className="card pad stack co-card" style={{ gap: 10 }} data-testid="callout-card">
      <Link to={`/plan/${plan.id}`} className="co-head">
        <span style={{ minWidth: 0 }}>
          <span className="label">⛳ {v.locked ? 'Locked in' : plan.status === 'cancelled' ? 'Called off' : 'Who’s up for a hit?'}</span>
          <strong style={{ display: 'block', fontSize: 18 }} className="ellipsis">{plan.name}</strong>
          <span className="small muted">{[v.when, v.course].join(' · ')}{by ? ` · from ${playerName(by)}` : ''}</span>
        </span>
        <span className={`co-pill${v.standing.status === 'in' ? ' in' : v.standing.status === 'reserve' ? ' reserve' : ''}`} data-testid="co-standing">{standingWords(v.standing)}</span>
      </Link>
      {(v.locked || !v.voting) && (
        <div className="row" style={{ gap: 8 }}>
          <AvatarStack players={ins} />
          <span className="small">{spotsWords(plan.spots, v.spots.in.length, v.spots.reserve.length)}</span>
        </div>
      )}
      <ReplyButtons cd={cd} v={v} me={status?.player_id} compact={compact} maxOptions={compact ? 3 : 99} />
      {!v.isAsked && <span className="small muted">Just for the people asked — you’re an organiser, so you can see it.</span>}
    </div>
  );
}

/** The open call-outs I'm asked to (or put out), soonest first: for Home and Trips. → [plan] */
export function useOpenCallouts() {
  const plannerOn = useFeature('planner');
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!plannerOn) return;
    const { data, error } = await supabase.from('plans').select('id,callout,status,start_date,created_at,invite_all,created_by').eq('callout', true);
    if (error) return; // a database before 103
    const today = sydneyToday();
    setRows((data || []).filter((p) => p.callout && (p.status === 'planning' || p.status === 'confirmed') && (!p.start_date || String(p.start_date).slice(0, 10) >= today))
      .sort((a, b) => String(a.start_date || '9999').localeCompare(String(b.start_date || '9999')) || String(b.created_at).localeCompare(String(a.created_at))));
  }, [plannerOn]);
  useEffect(() => { load(); }, [load]);
  useRealtime(plannerOn ? ['plans'] : [], load);
  return rows;
}

/** Home and Trips: the open call-outs as cards, and the "⛳ Put a round out" button. */
export function CalloutStrip({ onPutOut, button = true }) {
  const plans = useOpenCallouts();
  const plannerOn = useFeature('planner');
  if (!plannerOn) return null;
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="callout-strip">
      {plans.length > 0 && <div className="stage-head"><span className="label">⛳ Rounds going out</span><span className="small muted">{plans.length}</span></div>}
      {plans.map((p) => <CalloutCard key={p.id} planId={p.id} />)}
      {button && onPutOut}
    </div>
  );
}

export default CalloutCard;
