// /v/<token> — where a vote email's buttons land (079). No sign-in: the link is the person's own, for that one vote.
// Tapping an answer in the email opens this page with that answer ready; one tap on "Save" records it (so email
// scanners that open every link can't vote for anyone). Then every question of the email can be answered here too.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { ANSWERS, RSVP_ANSWERS, parseVoteLink, recordedLine, answersFor, safeLink, linkWord } from '../lib/emailvotes.js';

// Josh can switch this on to record the tapped answer as soon as the page opens (truly one tap). Off by default:
// some work email systems open every link in an email to check it, which would record every answer in turn.
const RECORD_ON_OPEN = false;

async function call(body) {
  try {
    const { data, error } = await supabase.functions.invoke('vote-link', { body });
    if (error) {
      let msg = null;
      try { msg = await error.context?.json?.(); } catch { /* not JSON */ }
      return msg || { ok: false, error: 'Couldn’t reach the vote — check your signal and try again.' };
    }
    return data || { ok: false, error: 'Something went wrong — try again.' };
  } catch {
    return { ok: false, error: 'Couldn’t reach the vote — check your signal and try again.' };
  }
}

const TONE = { yes: 'var(--navy)', maybe: '#7A5A00', no: 'var(--under)', in: 'var(--navy)', out: 'var(--under)' };
const optionLabel = (view, o) => view?.polls?.flatMap((p) => p.options).find((x) => x.id === o)?.label || '';

export default function VoteLink() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const link = parseVoteLink(token, params.toString());
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [stopped, setStopped] = useState(false);

  const send = useCallback(async (extra) => {
    setBusy(true);
    const r = await call({ t: link.t, ...extra });
    setBusy(false);
    // A refused answer keeps the vote on screen, with the reason; a closed vote shows the closed card.
    setView((v) => (r.ok ? { ...r, lastError: null } : { ...v, closed: !!(r.closed || v?.closed), lastError: r.error }));
    if (r.ok && r.recorded) setDone(r.recorded);
    if (r.ok && r.stopped) setStopped(true);
    return r;
  }, [link.t]);

  useEffect(() => {
    (async () => {
      const first = await call({ t: link.t });
      setView(first);
      if (RECORD_ON_OPEN && first.ok && !first.closed && (link.o || link.rsvp)) send(link.o ? { o: link.o, r: link.r } : { rsvp: link.rsvp });
    })();
  }, [link.t]); // eslint-disable-line react-hooks/exhaustive-deps

  const app = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const openApp = view?.plan ? `${app}#/plan/${view.plan.id}?tab=vote` : app;
  const pending = !done && !view?.closed && view?.ok && (link.o || link.rsvp);
  const pendingPoll = link.o ? (view?.polls || []).find((p) => (p.options || []).some((o) => o.id === link.o)) : null;
  const pendingAnswers = pendingPoll ? answersFor(pendingPoll) : ANSWERS;
  const pendingWords = link.o ? `${pendingAnswers[link.r] || pendingAnswers.yes} for ${optionLabel(view, link.o)}` : RSVP_ANSWERS[link.rsvp];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F6F4EE)' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '18px 16px' }}>
        <div className="hdr-title" style={{ fontSize: 20 }}>{view?.plan?.name || 'Trip vote'}</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)' }}>The Golf Trip · your answers</div>
      </div>
      <div className="section stack" style={{ gap: 12, maxWidth: 560, margin: '0 auto' }}>
        {!view && <div className="card pad">Loading your vote…</div>}
        {view && !view.ok && !view.closed && (
          <div className="card pad stack" style={{ gap: 8 }} data-testid="vote-link-error">
            <strong>{view.error || 'That link didn’t work.'}</strong>
            <a className="btn ghost" href={openApp}>Open The Golf Trip</a>
          </div>
        )}
        {link.stop && view?.ok !== undefined && (
          <div className="card pad stack" style={{ gap: 8 }}>
            {stopped ? <strong data-testid="stopped">Done — no more vote emails. You can turn them back on in the app’s Notifications.</strong> : (
              <>
                <strong>Stop vote emails?</strong>
                <div className="small muted">You’ll still see votes in the app.</div>
                <button type="button" className="btn gold block" disabled={busy} onClick={() => send({ stop: true })}>Stop vote emails</button>
              </>
            )}
          </div>
        )}
        {!link.stop && view?.closed && (
          <div className="card pad stack" style={{ gap: 8 }} data-testid="vote-closed">
            <strong style={{ fontSize: 18 }}>This vote has closed</strong>
            <div className="small muted">Thanks{view.name && view.name !== 'there' ? `, ${view.name}` : ''} — see how it went in the app.</div>
            <a className="btn ghost" href={openApp}>Open the trip</a>
          </div>
        )}
        {!link.stop && pending && (
          <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--gold)', borderWidth: 2 }} data-testid="vote-confirm">
            <div className="small muted">Hi {view.name} — save this answer?</div>
            <button type="button" className="btn gold block" style={{ minHeight: 56, fontSize: 18 }} disabled={busy}
              onClick={() => send(link.o ? { o: link.o, r: link.r || 'yes' } : { rsvp: link.rsvp })}>Save: {pendingWords}</button>
          </div>
        )}
        {view?.ok && view.lastError && !view.closed && <div className="card pad small" role="alert" style={{ color: 'var(--under)', fontWeight: 700 }}>{view.lastError}</div>}
        {!link.stop && done && (
          <div className="card pad" role="status" style={{ borderColor: 'var(--navy)' }} data-testid="vote-thanks">
            <div style={{ fontWeight: 800, fontSize: 18 }}>{recordedLine(view.name, done, (view.polls || []).find((p) => p.id === done.poll))}</div>
            <div className="small muted">Change it any time — tap another answer below, or <a href={openApp}>open the vote in the app</a>.</div>
          </div>
        )}
        {!link.stop && view?.ok && !view.closed && (view.polls || []).map((p) => (
          <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)', fontWeight: 800, fontSize: 17 }}>{p.question}{!p.open && <span className="small muted"> · closed</span>}</div>
            {p.options.map((o) => (
              <div key={o.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ fontWeight: 700 }}>{o.label}</div>
                {safeLink(o.link) && <a href={safeLink(o.link)} target="_blank" rel="noreferrer noopener" className="small" style={{ fontWeight: 700 }} data-testid="option-link">{linkWord(p)}</a>}
                {p.open && (
                  <div style={{ display: 'grid', gridTemplateColumns: p.choice === 'single' ? '1fr' : '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
                    {(p.choice === 'single' ? ['yes'] : ['yes', 'maybe', 'no']).map((r) => {
                      const on = p.mine?.[o.id] === r;
                      return (
                        <button key={r} type="button" className="btn ghost sm" aria-pressed={on} disabled={busy} style={{ minHeight: 44, ...(on ? { background: TONE[r], borderColor: TONE[r], color: '#fff' } : {}) }}
                          onClick={() => send({ o: o.id, r })}>{p.choice === 'single' ? (on ? '✓ Picked' : 'Pick this') : answersFor(p)[r]}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {!link.stop && view?.ok && !view.closed && view.rsvp?.asked && (
          <div className="card pad stack" style={{ gap: 8 }}>
            <strong>Are you keen for {view.plan?.name}?</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {['in', 'maybe', 'out'].map((s) => {
                const on = view.rsvp.mine === s;
                return <button key={s} type="button" className="btn ghost sm" aria-pressed={on} disabled={busy} style={{ minHeight: 44, ...(on ? { background: TONE[s] || '#7A5A00', borderColor: TONE[s] || '#7A5A00', color: '#fff' } : {}) }} onClick={() => send({ rsvp: s })}>{RSVP_ANSWERS[s]}</button>;
              })}
            </div>
          </div>
        )}
        {view?.ok && !link.stop && <a className="small muted" href={openApp} style={{ textAlign: 'center' }}>Open the vote in the app</a>}
      </div>
    </div>
  );
}
