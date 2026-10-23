// First open on Home (F1, Josh 23 Oct 2026 — walkthrough review option A). Separate first screens:
//   - OrganiserStart: the organiser of a new group gets a three-step start —
//       1 Invite your mates: a ready-made group-chat message with the invite link, then a live list of who's joined (I1)
//       2 Suggest the next trip
//       3 Turn on notifications
//     Each step ticks itself off; "Hide this" puts it away.
//   - Welcome: a new player or guest gets one card — the group's name, the faces already in, and the next trip (or
//     "Nothing planned yet").
// The rules are in lib/firstopen.js. Shown on Trips (the Home screen when no trip is on).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { AvatarStack, toast } from './ui.jsx';
import { useRun } from '../lib/run.js';
import { inviteLink } from '../lib/invite.js';
import { shareText, myPushState, enablePush } from '../lib/push.js';
import { fmtRange } from '../lib/plan.js';
import {
  starterSteps, showStarter, starterState, setStarterState, inviteMessage, joinedWords, showWelcome, welcomeHidden, hideWelcome,
  nextTripWords,
} from '../lib/firstopen.js';
import { gate } from '../lib/savedgate.js';

const first = (p) => String(playerName(p) || '').split(' ')[0];

/** The group's members (who has picked a name), refreshed every 20 seconds while the start is showing (I1). */
function useMembers(groupId, live) {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    if (!groupId) return;
    try {
      const { data, error } = await supabase.from('group_members').select('user_id,player_id,role,created_at').eq('group_id', groupId).order('created_at');
      if (!error) setRows(data || []);
    } catch { /* no signal: keep what we had */ }
  }, [groupId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [live, load]);
  return rows;
}

/**
 * The first-open card for Home, if one is due. plans: the group's plans (Trips has them); next: the next trip's plan
 * (or null); onSuggest: open "Suggest a trip"; hasCard(bool): tells Trips the start is showing (it hides its own
 * "Plan a trip" card and notifications card so there aren't two ways to do the same thing).
 */
export function FirstOpen({ plans = [], next = null, onSuggest = null, onShowing = null }) {
  const { status, user } = useSession();
  const data = useData();
  const gid = status?.group_id;
  const isOrganiser = !!status?.is_admin;
  const quick = !!status?.quick;
  const [st, setSt] = useState(() => (gid ? starterState(gid) : {}));
  const [push, setPush] = useState(null);
  const [welcomeAway, setWelcomeAway] = useState(() => (gid ? welcomeHidden(gid) : true));
  useEffect(() => { myPushState().then(setPush, () => setPush('unsupported')); }, []);
  const realPlans = plans.filter((p) => !p.tripOnly);
  const maybeStarter = isOrganiser && !quick && !st.hidden;
  const members = useMembers(gid, maybeStarter);
  const me = user?.id;
  const others = (members || []).filter((m) => m.player_id && m.user_id !== me);
  const joinedPlayers = others.map((m) => data.playersById[m.player_id]).filter(Boolean);
  const steps = starterSteps({ joined: others.length, invited: !!st.invited, plans: realPlans.length, pushOn: push === 'on' });
  const starter = members != null && showStarter({ isOrganiser: isOrganiser && !quick, joined: others.length, plans: realPlans.length, hidden: !!st.hidden, steps });
  const mine = (members || []).find((m) => m.user_id === me);
  const welcome = !starter && members != null && !quick && showWelcome({ isOrganiser, joinedAt: mine?.created_at || null, hidden: welcomeAway });
  // 'checking' while an organiser's members load, so Home doesn't flash its other ways to start a trip first.
  const checking = maybeStarter && members == null;
  // 'starter-suggest': the start is showing and its step 2 (suggest the next trip) is still to do — Home hides its own
  // "Plan a trip" ways meanwhile, so there's one way to start a trip, not five.
  const suggestOpen = starter && !steps.find((s) => s.key === 'suggest')?.done;
  const showing = suggestOpen ? 'starter-suggest' : starter ? 'starter' : welcome ? 'welcome' : checking ? 'checking' : null;
  useEffect(() => { onShowing?.(showing); }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (starter) return <OrganiserStart steps={steps} joined={joinedPlayers} gid={gid} push={push} setPush={setPush} onSuggest={onSuggest} onState={setSt} />;
  if (welcome) {
    const faces = (members || []).filter((m) => m.player_id).map((m) => data.playersById[m.player_id]).filter(Boolean);
    return <Welcome faces={faces.length ? faces : data.players} next={next} guest={status?.role === 'guest'} onClose={() => { hideWelcome(gid); setWelcomeAway(true); }} />;
  }
  return null;
}

function OrganiserStart({ steps, joined, gid, push, setPush, onSuggest, onState }) {
  const { status } = useSession();
  const data = useData();
  const nav = useNavigate();
  const [busy, run] = useRun();
  const [code, setCode] = useState(null);
  useEffect(() => {
    supabase.rpc('group_invite', { p_role: 'player' }).then(({ data: c }) => c && setCode(c), () => {});
  }, []);
  const link = code ? inviteLink(code) : '';
  const me = data.playersById[status?.player_id];
  const invite = () => run(async () => {
    if (!link) throw new Error('The invite link isn’t ready yet — try again in a moment.');
    const r = await shareText(inviteMessage({ groupName: status?.group_name || 'our group', link, from: first(me) }));
    if (r === 'failed') throw new Error('Couldn’t share from this phone — copy the link from Players & group instead.');
    if (r === 'cancelled') return;
    if (r === 'copied') toast('Copied — paste it into your group chat');
    onState(setStarterState(gid, { invited: true }));
  });
  const turnOn = () => run(async () => {
    if (push === 'off') { await enablePush(); setPush(await myPushState().catch(() => push)); return 'Notifications on'; }
    nav('/notifications');
    return null;
  }).then((m) => m && toast(m));
  const names = joined.map(first);
  return (
    <div className="card pad stack fo-card" style={{ gap: 4 }} data-testid="organiser-start">
      <div className="row between" style={{ gap: 8 }}>
        <strong style={{ fontSize: 18 }}>Get {status?.group_name || 'your group'} going</strong>
        <button type="button" className="linkish small" data-testid="starter-hide" onClick={() => onState(setStarterState(gid, { hidden: true }))}>Hide this</button>
      </div>
      <div className="small muted">Three things, about two minutes.</div>
      {steps.map((s, i) => (
        <div key={s.key} className={'fo-step' + (s.done ? ' done' : '')} data-testid={`fo-step-${s.key}`} data-done={s.done ? '1' : '0'}>
          <span className="fo-num" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
          <div className="grow stack" style={{ gap: 6, minWidth: 0 }}>
            <span className="fo-title">{s.title}</span>
            {s.key === 'invite' && (
              <>
                <span className="small muted">A ready-made message with your group’s link — paste it in the group chat. Mates tap it, sign in and pick their name.</span>
                <button type="button" className="btn gold sm" disabled={busy || !link} data-testid="starter-invite" style={{ alignSelf: 'flex-start' }} onClick={invite}>💬 Send the invite to the group chat</button>
                <div className="row" style={{ gap: 8 }} data-testid="starter-joined" aria-live="polite">
                  {joined.length > 0 && <AvatarStack players={joined} size={24} />}
                  <span className="small">{joinedWords(names)}</span>
                </div>
              </>
            )}
            {s.key === 'suggest' && !s.done && (
              <>
                <span className="small muted">Put a weekend and a place or two up for a vote — everyone says if they’re in.</span>
                <button {...gate('propose_trip')} type="button" className="btn ghost sm" data-testid="starter-suggest" style={{ alignSelf: 'flex-start' }} onClick={onSuggest}>💡 Suggest the next trip</button>
              </>
            )}
            {s.key === 'notify' && !s.done && push !== 'unsupported' && (
              <>
                <span className="small muted">So you hear when mates join, vote and pay.</span>
                <button type="button" className="btn ghost sm" disabled={busy} data-testid="starter-notify" style={{ alignSelf: 'flex-start' }} onClick={turnOn}>🔔 Turn on notifications</button>
              </>
            )}
          </div>
        </div>
      ))}
      <Link to="/group" className="small" style={{ fontWeight: 700, marginTop: 4 }}>Players & group →</Link>
    </div>
  );
}

function Welcome({ faces, next, guest, onClose }) {
  const { status } = useSession();
  const words = useMemo(() => nextTripWords(next, (a, b) => fmtRange(a, b)), [next]);
  return (
    <div className="card pad stack fo-card" style={{ gap: 8 }} data-testid="welcome-card">
      <strong style={{ fontSize: 20 }}>Welcome to {status?.group_name || 'the group'} 👋</strong>
      {guest && <div className="small">You’re here as a guest — play, score and join the chat. Votes on the group’s trips and rules are for its players.</div>}
      {faces.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <AvatarStack players={faces} size={28} />
          <span className="small">{faces.length} {faces.length === 1 ? 'person' : 'people'} in so far</span>
        </div>
      )}
      <div style={{ fontWeight: 700 }} data-testid="welcome-next">{words}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {next && !next.tripOnly && <Link to={`/plan/${next.id}`} className="btn gold sm" onClick={onClose}>Have a look</Link>}
        <button type="button" className="btn ghost sm" data-testid="welcome-close" onClick={onClose}>Thanks, got it</button>
      </div>
    </div>
  );
}

export default FirstOpen;
