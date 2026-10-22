// "Call the vote" (080, Josh 22 Oct): the full range of what's on the table, each with a tick box (ticked = on the
// ballot), when it closes (3 days unless changed), "Are you keen?", then [Call the vote]. Afterwards "How it goes
// out": app notifications, emails, and a share link for the group chat (through the group's invite, so someone not in
// the group yet joins and lands on the vote). The maths is in lib/callvote.js.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSession, useData } from '../lib/store.jsx';
import { Sheet, toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, shareText } from '../lib/push.js';
import { todayISO } from '../lib/plan.js';
import { answersFor } from '../lib/emailvotes.js';
import { allTicked, toggleTick, ballotFrom, callProblem, defaultCloses, closesWord, pollRows, reach, voteShareLink, shareMessage } from '../lib/callvote.js';
import { joinCodeNow, loadJoinCode } from '../lib/joincode.js';
import './planux.css';

const appBase = () => `${window.location.origin}${import.meta.env.BASE_URL}`;

/** The group's join code (any member, 083), for share links that let someone with no session join first. */
export function useJoinCode(on = true) {
  const { status } = useSession();
  const [code, setCode] = useState(() => joinCodeNow());
  useEffect(() => {
    if (!on || code) return undefined;
    let live = true;
    loadJoinCode(supabase, { role: status?.role, group: status?.group_id }).then((c) => { if (live && c) setCode(c); });
    return () => { live = false; };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return code;
}

let channels = null;
function useReach(on = true) {
  const [r, setR] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    if (!channels || Date.now() - channels.at > 60000) channels = { at: Date.now(), p: supabase.rpc('vote_channels').then(({ data, error }) => (error ? [] : data || []), () => []) };
    channels.p.then((rows) => live && setR(reach(rows)));
    return () => { live = false; };
  }, [on]);
  return r;
}

/** The share link and message for a vote, with [Copy link] [Share…]. */
export function SharePanel({ plan, title, closes }) {
  const { status } = useSession();
  const code = useJoinCode(!status.viewing);
  const link = voteShareLink({ base: appBase(), code, planId: plan.id });
  const msg = shareMessage({ title, planName: plan.name, closes, today: todayISO(), link });
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied — paste it in the group chat'); } catch { toast('Couldn’t copy — press and hold the link'); }
  };
  const share = async () => {
    const r = await shareText(msg, plan.name);
    if (r === 'copied') toast('Message copied — paste it in the group chat');
  };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="share-vote">
      <div className="small" style={{ background: 'var(--ground)', borderRadius: 10, padding: '8px 10px', wordBreak: 'break-word' }} data-testid="share-message">{msg}</div>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn grow" onClick={copy} data-testid="copy-link">🔗 Copy link</button>
        <button type="button" className="btn gold grow" onClick={share}>📤 Share…</button>
      </div>
      <span className="small muted">WhatsApp, Messenger or a text. {code ? 'Anyone not in the group yet joins first, then lands on the vote.' : 'It opens the vote in the app.'}</span>
    </div>
  );
}

/** "How it goes out": ✓ app notification to N, ✓ email to M, and the share link. */
export function HowItGoesOut({ plan, title, closes }) {
  const { status } = useSession();
  const data = useData();
  const r = useReach(!!status.is_admin);
  const names = (ids) => ids.map((id) => data.playersById[id]?.nickname || data.playersById[id]?.name).filter(Boolean).join(', ');
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="how-it-goes-out">
      <strong>📣 How it goes out</strong>
      {r ? (
        <div className="stack small" style={{ gap: 4 }}>
          <div data-testid="reach-app">✓ App notification to <strong>{r.app}</strong> {r.app === 1 ? 'person' : 'people'}</div>
          <div data-testid="reach-email">✓ Email to <strong>{r.email}</strong> {r.email === 1 ? 'person' : 'people'}{r.email ? ' — one-tap answers, no app needed' : ''}</div>
          {r.none > 0 && <div className="muted">Not reached: {names(r.noneIds)} — send them the link.</div>}
        </div>
      ) : <span className="small muted">Working out who gets it…</span>}
      <SharePanel plan={plan} title={title} closes={closes} />
    </div>
  );
}

/** "Share this vote" on an open vote card, for organisers. */
export function ShareVoteButton({ plan, title, closes }) {
  const [open, setOpen] = useState(false);
  return open ? <HowItGoesOut plan={plan} title={title} closes={closes} />
    : <button type="button" className="btn ghost sm" onClick={() => setOpen(true)} data-testid="share-this-vote">📤 Share this vote</button>;
}

/**
 * One combined vote card (077 vote_batches): a poll per section, options, one notification, a feed post.
 * Accommodation ideas (options with stayId) go on through put_stays_to_vote so the shortlist stays linked.
 * → { batch, keys: { option_id: key } }
 */
export async function callBatch({ plan, me, title, sections, keen, closes }) {
  const b = await must(supabase.from('vote_batches').insert({ plan_id: plan.id, title, keen, closes_on: closes }).select().single());
  const keys = {};
  let first = null;
  const plain = sections.filter((s) => !s.options.some((o) => o.stayId));
  const stays = sections.filter((s) => s.options.some((o) => o.stayId));
  for (const row of pollRows(plain, { planId: plan.id, batchId: b.id, closes })) {
    const p = await must(supabase.from('plan_polls').insert(row.poll).select().single());
    first ||= p;
    if (row.options.length) {
      const made = await must(supabase.from('plan_options').insert(row.options.map((o) => ({ ...o, poll_id: p.id }))).select('id'));
      made.forEach((m, i) => { keys[m.id] = row.keys[i]; });
    }
  }
  for (const s of stays) {
    const r = await must(supabase.rpc('put_stays_to_vote', { p_plan: plan.id, p_closes_on: closes, p_only: s.options.map((o) => o.stayId) }));
    if (!first && r?.poll_id) first = { id: r.poll_id };
  }
  if (first) notify('poll_open', { poll_id: first.id }).catch(() => {});
  try { await supabase.from('posts').insert({ kind: 'user', player_id: me, body: `🗳️ ${title} — ${plan.name}. Have your say.`, link: `/plan/${plan.id}?tab=vote` }); } catch { /* the feed is a nice-to-have */ }
  return { batch: b, keys };
}

/**
 * The sheet. range: sections [{ key, kind, question, options: [{ key, label, notes, … }] }].
 * doCall(ballot, { closes, keen }) → optional; by default a combined vote card (callBatch). onCalled(result) after.
 */
export function CallVoteSheet({ plan, title, range, keenDefault = true, keenOption = true, onClose, onCalled, doCall = null, intro = null }) {
  const { status } = useSession();
  const [ticks, setTicks] = useState(() => allTicked(range));
  const [closes, setCloses] = useState(() => defaultCloses(todayISO()));
  const [keen, setKeen] = useState(keenDefault);
  const [called, setCalled] = useState(null);
  const [busy, run] = useRun();
  const ballot = useMemo(() => ballotFrom(range, ticks), [range, ticks]);
  const problem = callProblem({ sections: ballot.sections, keen: keenOption && keen, closes, today: todayISO() });
  const call = () => run(async () => {
    const result = doCall ? await doCall(ballot, { closes, keen: keenOption && keen }) : await callBatch({ plan, me: status.player_id, title, sections: ballot.sections, keen: keenOption && keen, closes });
    await onCalled?.(result, ballot);
    setCalled({ closes });
  }, 'The vote’s called');
  return (
    <Sheet title={called ? 'The vote’s out' : 'Call the vote'} onClose={onClose} wide={!called}>
      {called ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="small" style={{ fontWeight: 700 }}>🗳️ “{title}” — closes {closesWord(called.closes, todayISO())}.</div>
          <HowItGoesOut plan={plan} title={title} closes={called.closes} />
          <button type="button" className="btn ghost block" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="cv-grid">
        <div className="stack" style={{ gap: 10 }} data-testid="call-vote">
          {intro}
          <span className="label">What goes on the ballot</span>
          <span className="small muted">Everything on the table is ticked. Untick anything you don’t want the group to vote on.</span>
          {range.map((s) => (
            <div key={s.key} className="card pad stack" style={{ gap: 4 }} data-testid="ballot-section">
              <strong>{s.question}</strong>
              {s.options.map((o) => (
                <label key={o.key} className="row" style={{ gap: 10, minHeight: 44, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!ticks[o.key]} onChange={() => setTicks(toggleTick(ticks, o.key, range))} style={{ width: 22, height: 22, flex: 'none' }} aria-label={`${s.question}: ${o.label}`} />
                  <span className="grow"><span style={{ fontWeight: 600 }}>{o.label}</span>{o.suggested && <span className="small muted"> ✨</span>}
                    {o.notes && <span className="small muted" style={{ display: 'block' }}>{o.notes}</span>}</span>
                </label>
              ))}
            </div>
          ))}
          {ballot.skipped.length > 0 && <span className="small muted">Left off: {ballot.skipped.join(', ')}{ballot.skipped.some((q) => /weekend/i.test(q)) ? ' (one weekend isn’t a vote)' : ''}.</span>}
          {keenOption && (
            <label className="row" style={{ gap: 10, minHeight: 44 }}>
              <input type="checkbox" checked={keen} onChange={(e) => setKeen(e.target.checked)} style={{ width: 22, height: 22 }} />
              <span>Ask “Are you keen?” (In / Maybe / Out) too</span>
            </label>
          )}
          <label className="field"><span>Closes</span><input className="input" type="date" value={closes || ''} min={todayISO()} onChange={(e) => setCloses(e.target.value)} aria-label="Closes" /></label>
          {problem && <span className="small err" style={{ margin: 0 }}>{problem}</span>}
          <button type="button" className="btn gold block" disabled={busy || !!problem} onClick={call} data-testid="call-the-vote">🗳️ Call the vote{ballot.count ? ` (${ballot.count} option${ballot.count === 1 ? '' : 's'})` : ''}</button>
        </div>
        <aside className="cv-preview" data-testid="ballot-preview">
          <span className="label">What the group sees</span>
          <div className="card" style={{ overflow: 'hidden', borderColor: 'var(--navy)', borderWidth: 2, marginTop: 6 }}>
            <div style={{ padding: '10px 14px', background: 'var(--navy)', color: '#fff' }}>
              <div className="small" style={{ opacity: 0.85, fontWeight: 700 }}>🗳️ {ballot.sections.length + (keenOption && keen ? 1 : 0)} quick questions · closes {closesWord(closes, todayISO())}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
            </div>
            <div className="stack" style={{ padding: 10, gap: 8 }}>
              {ballot.sections.map((s) => {
                const words = answersFor({ kind: s.kind, question: s.question, purpose: s.options.some((o) => o.stayId) ? 'stay' : null });
                return (
                  <div key={s.key} className="card pad stack" style={{ gap: 4 }}>
                    <strong>{s.question}</strong>
                    {s.options.map((o) => (
                      <div key={o.key} className="row between small" style={{ gap: 6 }}>
                        <span style={{ fontWeight: 600 }}>{o.label}</span>
                        <span className="muted" style={{ whiteSpace: 'nowrap' }}>{words.yes.split(' ')[0]} {words.maybe.split(' ')[0]} {words.no.split(' ')[0]}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {keenOption && keen && <div className="card pad"><strong>Are you keen?</strong> <span className="small muted">✓ In · ? Maybe · ✗ Out</span></div>}
              {!ballot.sections.length && !(keenOption && keen) && <span className="small muted">Nothing ticked yet.</span>}
            </div>
          </div>
        </aside>
        </div>
      )}
    </Sheet>
  );
}

