// A trip idea (108, ov39 — Josh 25 Oct 2026): #/idea/<plan id>. COLLECT → SHAPE → DECIDE.
//   * The shared link lands on a QUICK SUMMARY (Josh 19:34): what's set and what's open, the group's answers in one
//     line, the share picture, and one-tap feedback — In / Maybe / Can't (when the weekend is set) or "Help plan — 4
//     quick taps", a comment, a suggestion. "See all the ideas →" opens the lists.
//   * The lists (dates, areas, courses): anyone the idea's shared with adds, 👍 / 👎, sees who added what and a fit line
//     ("suits 9 of 11 · within 3 h"); counts for everyone, names for the organiser. The Caddie's ✨ ideas go in the
//     same lists with one tap. A suggestion outside what the organiser has "Set" goes to the organiser's queue.
//   * The organiser: what's set and what's open to ideas, the queue, paste the chat, ✨ ideas from the comments,
//     📣 Share it, hand over organising, tidy → 🗳️ send to the vote (the v10.6 When? / Where? votes), ✨ pull it
//     together (the planning chat on the strong model), and the leftovers → parked future-trip ideas.
//   * A parked idea (💭 Future trip ideas): whoever suggested its main item has 48 hours to claim it, then anyone can.
// The maths and words are in lib/ideas.js; the database rules in 108.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { useSession, useData, useRealtime, useFeature, playerName } from '../lib/store.jsx';
import { Header, Loading, Sheet, toast, askConfirm } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, shareText, appLink } from '../lib/push.js';
import { usePlanData, ChatTab } from './Planner.jsx';
import { openPlanner } from '../components/Caddie.jsx';
import { drawCard, drawIdeaPreview, sharePicture } from '../lib/shareCard.js';
import { uploadPhoto } from '../lib/images.js';
import { todayISO } from '../lib/plan.js';
import * as TB from '../lib/tripbuilder.js';
import * as I from '../lib/ideas.js';

const nameOf = (data, id) => (id && data.playersById[id] ? playerName(data.playersById[id]) : null);
const first = (s) => String(s || '').split(' ')[0];

function useIdea(planId) {
  const pd = usePlanData(planId);
  const [x, setX] = useState(null);
  const load = useCallback(async () => {
    const [items, wishes, answers, areas, starts, homes] = await Promise.all([
      supabase.from('plan_idea_items').select('*').eq('plan_id', planId).order('created_at'),
      supabase.from('plan_wishes').select('*').eq('plan_id', planId),
      supabase.rpc('idea_wish_answers', { p_plan: planId }),
      supabase.from('stay_areas').select('name,region,state,lat,lng'),
      supabase.from('trip_start_points').select('label,lat,lng,headcount').eq('plan_id', planId),
      supabase.from('player_home_areas').select('label,lat,lng'),
    ]);
    const ids = (items.data || []).map((i) => i.id);
    const rx = ids.length ? await supabase.from('plan_idea_reactions').select('*').in('item_id', ids) : { data: [] };
    setX({
      items: items.data || [], reactions: rx.data || [], wishRows: wishes.data || [],
      answers: Array.isArray(answers.data) ? answers.data : [], stayAreas: areas.data || [],
      base: I.homeBase(starts.data || [], homes.data || []),
    });
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plan_idea_items', 'plan_idea_reactions', 'plan_wishes'], load);
  return { pd, x, reload: () => { load(); pd?.reload?.(); } };
}

export default function TripIdea() {
  const { planId } = useParams();
  const [sp] = useSearchParams();
  const { status } = useSession();
  const data = useData();
  const { pd, x, reload } = useIdea(planId);
  const [view, setView] = useState(sp.get('view') || null);
  if (!pd || !x) return <div className="page"><Header back="Trips" title="Trip idea" /><Loading /></div>;
  const plan = pd.plan;
  if (!plan) return <div className="page"><Header back="Trips" title="Trip idea" /><div className="empty">This idea has been removed.</div></div>;
  const me = status.player_id;
  const organiserId = plan.idea_organiser || plan.organiser_id;
  const isOrg = !status.viewing && (!!status.is_admin || (!!me && organiserId === me));
  const canAdd = plan.status === 'planning' && (!!plan.shared_at || plan.created_by === me || isOrg);
  const fixed = plan.idea_fixed || {};
  const l = I.lists(x.items, x.reactions, me);
  const answers = isOrg && x.wishRows.length >= x.answers.length ? x.wishRows : x.answers;
  const summary = I.summariseWishes(answers, { rsvps: pd.rsvps, fixed });
  const ctx = { plan, pd, x, l, me, isOrg, canAdd, fixed, summary, answers, reload, data, status, organiserId };
  const mode = view || (isOrg ? 'board' : 'summary');
  const parked = plan.idea_pool && plan.status === 'planning';
  return (
    <div className="page">
      <Header back="Trips" title={plan.name} sub={parked ? '💭 A parked trip idea' : `💡 ${nameOf(data, plan.created_by) ? `${first(nameOf(data, plan.created_by))}’s trip idea` : 'Trip idea'}${organiserId && organiserId !== plan.created_by ? ` · organised by ${first(nameOf(data, organiserId))}` : ''}`} />
      <div className="section stack" style={{ gap: 12 }} data-testid="trip-idea" data-view={mode}>
        {parked && <ParkedBanner {...ctx} />}
        {plan.idea_sent_at && (
          <Link to={`/plan/${plan.id}?tab=vote`} className="card pad" style={{ borderColor: 'var(--navy)', borderWidth: 2, textDecoration: 'none', color: 'inherit' }} data-testid="sent-to-vote">
            🗳️ <strong>Sent to the vote</strong> — have your say →
          </Link>
        )}
        <Hero {...ctx} />
        {mode === 'summary' ? (
          <>
            <QuickFeedback {...ctx} />
            <button type="button" className="btn ghost block" onClick={() => setView('board')} data-testid="see-all">See all the ideas ({l.date.length + l.area.length + l.course.length}) →</button>
          </>
        ) : (
          <>
            {isOrg && <OrganiserPanel {...ctx} />}
            {!isOrg && <QuickFeedback {...ctx} compact />}
            <Lists {...ctx} />
            <IdeaCaddie {...ctx} />
            <details className="card pad" open={mode === 'board' && pd.comments.length > 0}>
              <summary style={{ fontWeight: 700, cursor: 'pointer' }}>💬 Comments ({pd.comments.length})</summary>
              <div style={{ marginTop: 8 }}><ChatTab pd={pd} /></div>
            </details>
            {!isOrg && <button type="button" className="btn ghost block" onClick={() => setView('summary')}>← Back to the summary</button>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the top: what's set, what's open, the group so far

function Hero({ plan, fixed, summary, isOrg, me }) {
  const lines = I.defLines(fixed);
  const shape = I.ideaShape(plan);
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)', borderWidth: 2 }} data-testid="idea-hero">
      {plan.card_url && <img src={plan.card_url} alt="" style={{ width: '100%', borderRadius: 10, aspectRatio: '1200 / 630', objectFit: 'cover' }} />}
      {!lines.length && <span>{shape || 'When and where: up to you lot'}</span>}
      {lines.map((d) => (
        <div key={d.key} className="row between" style={{ gap: 8 }} data-testid="def-line">
          <span>{d.label}</span>
          <span className="small" style={{ fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: d.set ? 'var(--navy)' : 'var(--gold-soft)', color: d.set ? '#fff' : '#7A5A00', whiteSpace: 'nowrap' }}>{d.set ? 'Set' : 'Open to ideas'}</span>
        </div>
      ))}
      {plan.brief && <span className="small muted">{plan.brief}</span>}
      <span className="small" style={{ fontWeight: 700 }} data-testid="wish-summary">👥 {summary.line}</span>
      {!plan.shared_at && !plan.idea_pool && <span className="small muted">Not shared yet — {plan.created_by === me || isOrg ? 'tap 📣 Share it when you’re ready.' : 'only whoever proposed it can see it for now.'}</span>}
      {isOrg && summary.wishes.length > 0 && <span className="small muted">Wishes: {summary.wishes.slice(0, 4).map((w) => `“${w}”`).join(' · ')}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- COLLECT: one-tap feedback and the 4 quick taps

function QuickFeedback({ plan, pd, me, canAdd, fixed, reload, compact = false }) {
  const weekendSet = I.isSet(fixed, 'weekend') && fixed.weekend?.start;
  const mine = pd.rsvps.find((r) => r.player_id === me)?.status || null;
  const [busy, run] = useRun();
  const say = (s) => run(async () => {
    await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status: s }, { onConflict: 'plan_id,player_id' }));
    pd.reload();
  }, s === 'in' ? 'You’re in' : s === 'maybe' ? 'Down as a maybe' : 'Noted — maybe next time');
  if (!me) return null;
  if (!canAdd) return <div className="small muted">This idea hasn’t been shared yet.</div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {weekendSet && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="can-you-make-it">
          <strong>Can you make {TB.weekendLabel({ start: fixed.weekend.start, end: fixed.weekend.end })}?</strong>
          <div className="row" style={{ gap: 6 }}>
            {[['in', '✓ In'], ['maybe', '? Maybe'], ['out', '✗ Can’t']].map(([v, t]) => (
              <button key={v} type="button" className={`btn ${mine === v ? 'gold' : 'ghost'} grow`} disabled={busy} onClick={() => say(v)} aria-pressed={mine === v}>{t}</button>
            ))}
          </div>
        </div>
      )}
      <WishTaps plan={plan} me={me} fixed={fixed} reload={reload} compact={compact} />
      <SuggestBox plan={plan} fixed={fixed} reload={reload} />
      {!compact && <QuickComment pd={pd} plan={plan} />}
    </div>
  );
}

function Chips({ options, value, onPick, label }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onPick(value === o.value ? null : o.value)}
          style={{ minHeight: 40, fontWeight: value === o.value ? 800 : 500, background: value === o.value ? 'var(--gold-soft)' : undefined, borderColor: value === o.value ? 'var(--gold)' : undefined }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WishTaps({ plan, me, fixed, reload, compact }) {
  const [w, setW] = useState(null);
  const [open, setOpen] = useState(!compact);
  useEffect(() => {
    supabase.from('plan_wishes').select('*').eq('plan_id', plan.id).eq('player_id', me).maybeSingle()
      .then(({ data }) => setW(data || { cant_dates: [], day_prefs: {} }), () => setW({ cant_dates: [], day_prefs: {} }));
  }, [plan.id, me]);
  const save = async (patch) => {
    const next = { ...w, ...patch };
    setW(next);
    const { error } = await supabase.from('plan_wishes').upsert(I.wishRow(plan.id, me, next), { onConflict: 'plan_id,player_id' });
    if (error) toast('Couldn’t save that — try again'); else reload();
  };
  if (!w) return null;
  const weekendSet = I.isSet(fixed, 'weekend');
  const done = I.tapsDone(w, { weekendFixed: weekendSet, rsvp: weekendSet ? 'x' : null });
  const fridays = I.upcomingFridays(TB.addDays(todayISO(), 7), 16);
  const nights = fixed.nights ?? 2;
  const days = I.tripDayKeys(fixed);
  return (
    <div className="card pad stack" style={{ gap: 10 }} data-testid="wish-taps">
      <button type="button" className="row between" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', minHeight: 40 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>🙋 Help plan {plan.name} — 4 quick taps</strong><span className="small muted">{done}/4 {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          {!weekendSet && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">1. Weekends you CAN’T do</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 6 }} data-testid="cant-calendar">
                {fridays.map((f) => {
                  const on = (w.cant_dates || []).includes(f);
                  const d = TB.dateOf(f);
                  return (
                    <button key={f} type="button" className="chip" aria-pressed={on} onClick={() => save({ cant_dates: I.toggleCant(w.cant_dates || [], f), dates_ok: true })}
                      style={{ minHeight: 44, flexDirection: 'column', textDecoration: on ? 'line-through' : 'none', background: on ? '#FDE7E5' : undefined, borderColor: on ? '#B3261E' : undefined }}
                      aria-label={`Can't do ${I.fridayLabel(f, nights || 2)}`}>
                      <span className="small" style={{ fontWeight: 700 }}>{d.getDate()} {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}</span>
                    </button>
                  );
                })}
              </div>
              <span className="small muted">Fridays shown — tap the weekends you’re out.{(w.cant_dates || []).length ? '' : ' Can do them all? Leave it.'}</span>
            </div>
          )}
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">{weekendSet ? '1' : '2'}. Spend each (all up)</span>
            <Chips label="Spend each" options={I.SPEND} value={w.spend_band} onPick={(v) => save({ spend_band: v })} />
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">{weekendSet ? '2' : '3'}. Getting there</span>
            <Chips label="Getting there" options={I.TRAVEL} value={w.travel} onPick={(v) => save({ travel: v })} />
            {w.travel !== 'fly' && (
              <>
                <span className="small muted">Longest drive you’d do</span>
                <Chips label="Longest drive" options={I.MAX_DRIVE} value={w.max_drive_min} onPick={(v) => save({ max_drive_min: v })} />
              </>
            )}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">{weekendSet ? '3' : '4'}. How much golf</span>
            <Chips label="How much golf" options={I.GOLF} value={w.golf_per_day} onPick={(v) => save({ golf_per_day: v })} />
            <span className="small muted">How you’d like the days (optional)</span>
            {days.map((k) => (
              <div key={k} className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }} data-testid={`day-pref-${k}`}>
                <span className="small" style={{ width: 34, fontWeight: 700 }}>{I.DAY_NAME[k].slice(0, 3)}</span>
                <Chips label={`${I.DAY_NAME[k]} timing`} options={I.DAY_PREF} value={w.day_prefs?.[k] || null}
                  onPick={(v) => { const dp = { ...(w.day_prefs || {}) }; if (v) dp[k] = v; else delete dp[k]; save({ day_prefs: dp }); }} />
              </div>
            ))}
            <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
              <span>Home by (last day)</span>
              <select className="select" value={w.home_by ? String(w.home_by).slice(0, 5) : ''} onChange={(e) => save({ home_by: e.target.value || null })} aria-label="Home by">
                <option value="">Not fussed</option>
                {['12:00', '14:00', '16:00', '18:00', '20:00'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <label className="field"><span>One wish (a course, a place, a must or a please-no)</span>
            <input className="input" defaultValue={w.wish || ''} onBlur={(e) => { if ((e.target.value || '') !== (w.wish || '')) save({ wish: e.target.value }); }} placeholder="e.g. Barnbougle, or no 6am tee times" aria-label="One wish" /></label>
        </>
      )}
    </div>
  );
}

function SuggestBox({ plan, fixed, reload, onAdded }) {
  const [kind, setKind] = useState('area');
  const [text, setText] = useState('');
  const [fri, setFri] = useState('');
  const [busy, run] = useRun();
  const fridays = I.upcomingFridays(TB.addDays(todayISO(), 7), 26);
  const add = () => run(async () => {
    const it = I.newItem(kind, { label: text, start: fri, nights: fixed.nights ?? 2, area: kind === 'course' ? (fixed.area || null) : null });
    if (it.error) throw new Error(it.error);
    const row = await must(supabase.from('plan_idea_items').insert({ plan_id: plan.id, ...it }).select().single());
    setText(''); setFri('');
    reload(); onAdded?.(row);
    toast(row.status === 'queued' ? 'Sent to the organiser to look at (it’s outside what’s set)' : 'Added to the lists');
  });
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="suggest-box">
      <strong>💡 Suggest something</strong>
      <div className="seg light" role="group" aria-label="What kind">
        {[['date', '📅 A weekend'], ['area', '📍 An area'], ['course', '⛳ A course']].map(([v, t]) => <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>{t}</button>)}
      </div>
      {kind === 'date' ? (
        <select className="select" value={fri} onChange={(e) => setFri(e.target.value)} aria-label="Which weekend">
          <option value="">Pick a weekend…</option>
          {fridays.map((f) => <option key={f} value={f}>{I.fridayLabel(f, fixed.nights ?? 2)}</option>)}
        </select>
      ) : (
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'area' ? 'e.g. Port Macquarie' : 'e.g. The Vintage'} aria-label={kind === 'area' ? 'An area' : 'A course'} />
      )}
      {I.outsideDefinition({ kind, label: text, area: kind === 'course' ? fixed.area : null }, fixed) && <span className="small muted">That part’s set — your suggestion goes to the organiser to look at.</span>}
      <button type="button" className="btn gold" disabled={busy || (kind === 'date' ? !fri : text.trim().length < 2)} onClick={add} data-testid="suggest-add">Add it</button>
    </div>
  );
}

function QuickComment({ pd, plan }) {
  const [text, setText] = useState('');
  const [busy, run] = useRun();
  const send = () => run(async () => {
    const c = await must(supabase.from('plan_comments').insert({ plan_id: plan.id, body: text.trim() }).select().single());
    setText(''); pd.reload();
    notify('comment_added', { comment_id: c.id }).catch(() => {});
  }, 'Comment added');
  return (
    <div className="card pad stack" style={{ gap: 6 }}>
      <strong>💬 Say something</strong>
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Keen! But not the 12th…" aria-label="Comment" />
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={send} data-testid="comment-send">Send</button>
      </div>
      {pd.comments.length > 0 && <span className="small muted">{pd.comments.length} comment{pd.comments.length === 1 ? '' : 's'} so far — see them with all the ideas.</span>}
    </div>
  );
}

// ---------------------------------------------------------------- SHAPE: the lists

function Lists(ctx) {
  const { l, canAdd, plan, fixed, reload } = ctx;
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="idea-lists">
      {[['date', '📅 Dates'], ['area', '📍 Areas'], ['course', '⛳ Courses']].map(([k, t]) => (
        <div key={k} className="card pad stack" style={{ gap: 6 }} data-testid={`list-${k}`}>
          <strong>{t} <span className="small muted">({l[k].length})</span></strong>
          {!l[k].length && <span className="small muted">Nothing yet{canAdd ? ' — add one, or ask the Caddie.' : '.'}</span>}
          {l[k].map((it) => <ItemRow key={it.id} it={it} {...ctx} />)}
        </div>
      ))}
      {canAdd && <SuggestBox plan={plan} fixed={fixed} reload={reload} />}
    </div>
  );
}

function ItemRow({ it, me, isOrg, data, x, answers, reload, canAdd }) {
  const [busy, run] = useRun();
  const fit = I.itemFit(it, { wishes: answers, stayAreas: x.stayAreas, base: x.base });
  const cant = isOrg && it.kind === 'date' ? I.whoCant(it, x.wishRows, (id) => nameOf(data, id)) : [];
  const react = (v) => run(async () => {
    const next = I.nextReaction(it.t.mine, v);
    if (!next) await must(supabase.from('plan_idea_reactions').delete().eq('item_id', it.id).eq('player_id', me));
    else await must(supabase.from('plan_idea_reactions').upsert({ item_id: it.id, player_id: me, value: next }, { onConflict: 'item_id,player_id' }));
    reload();
  });
  const remove = () => run(async () => {
    if (!(await askConfirm({ title: `Take “${it.label}” off?`, yes: 'Take it off' }))) return;
    await must(supabase.from('plan_idea_items').delete().eq('id', it.id));
    reload();
  });
  const by = it.by_ai ? '✨ the Caddie' : nameOf(data, it.added_by);
  const fly = it.detail?.fly;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'flex-start', borderTop: '1px solid var(--line-soft)', paddingTop: 6 }} data-testid="idea-item" data-kind={it.kind} data-label={it.label}>
      <div className="grow stack" style={{ gap: 1 }}>
        <span style={{ fontWeight: 700 }}>{it.by_ai && <span title="From the Caddie">✨ </span>}{it.label}{it.kind === 'course' && it.area ? <span className="small muted"> · {it.area}</span> : null}</span>
        {it.note && <span className="small muted">{it.note}</span>}
        {fly && <span className="small muted">✈️ {I.flightLine(fly)}</span>}
        {fit && <span className="small" style={{ color: '#2E6B3F', fontWeight: 600 }} data-testid="fit-line">{fit}</span>}
        {cant.length > 0 && <span className="small" style={{ color: '#B3261E' }} data-testid="who-cant">Can’t: {cant.join(', ')}</span>}
        <span className="small muted">{by ? `from ${by}` : ''}</span>
      </div>
      <div className="row" style={{ gap: 4, flex: 'none' }}>
        <button type="button" className="chip" disabled={busy || !canAdd} aria-pressed={it.t.mine === 1} onClick={() => react(1)} aria-label={`Thumbs up ${it.label}`} style={{ minHeight: 40 }}>👍 {it.t.up || ''}</button>
        <button type="button" className="chip" disabled={busy || !canAdd} aria-pressed={it.t.mine === -1} onClick={() => react(-1)} aria-label={`Thumbs down ${it.label}`} style={{ minHeight: 40 }}>👎 {it.t.down || ''}</button>
        {(isOrg || it.added_by === me) && <button type="button" className="chip" disabled={busy} onClick={remove} aria-label={`Take ${it.label} off`} style={{ minHeight: 40 }}>✕</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the Caddie: quick ideas (the fast model)

async function askIdeas(body) {
  const { data, error } = await supabase.functions.invoke('ai-helper', { body: { mode: 'idea_chat', ...body, group_id: currentGroup() || undefined } });
  if (error) return { error: 'Couldn’t reach the Caddie just now — try again in a minute.' };
  if (data?.error) return { error: String(data.error), code: data.code };
  return data?.idea_chat ? { ok: true, ...data.idea_chat } : { error: 'The Caddie didn’t have an answer — try asking another way.' };
}

export function ideaContext(ctx) {
  return I.caddieContext({ plan: ctx.plan, lists: ctx.l, summary: ctx.summary, base: ctx.x.base });
}

function IdeaCard({ card, ctx, onAdded, canAddIt }) {
  const [busy, run] = useRun();
  const [done, setDone] = useState(false);
  const fly = card.fly && card.travel === 'fly' ? card.fly : null;
  const counts = (ctx.answers || []).length ? I.travelFit({ driveMin: card.drive_min, fly: !!fly }, ctx.answers) : null;
  const sp = !fly && card.cost_each ? I.spendFit(card.cost_each, ctx.answers || []) : null;
  const fit = counts ? I.fitLine({ fit: { fits: Math.min(counts.fits, sp ? sp.fits : counts.fits), of: counts.of }, driveMin: fly ? null : card.drive_min, fly: fly ? { flightMin: fly.flight_min } : null, costEach: fly ? null : card.cost_each }) : card.fit;
  const w = ctx.fixed.weekend?.start ? ctx.fixed.weekend : ctx.l.date[0] ? { start: ctx.l.date[0].start_date, end: ctx.l.date[0].end_date } : null;
  const search = fly ? I.flightSearchLink({ from: fly.from || 'SYD', to: fly.to || card.area, depart: w?.start || null, back: w?.end || null }) : null;
  const add = () => run(async () => {
    const rows = I.itemsFromIdea({ ...card, fit }).map((r) => ({ plan_id: ctx.plan.id, ...r }));
    for (const r of rows) {
      const { error } = await supabase.from('plan_idea_items').insert(r);
      if (error && !/duplicate|unique/i.test(error.message || '')) throw error;
    }
    setDone(true); ctx.reload(); onAdded?.();
  }, 'Added to the lists ✨');
  return (
    <div className="card pad stack" style={{ gap: 4, borderColor: 'var(--gold)' }} data-testid="caddie-card">
      <strong>✨ {card.area}</strong>
      {card.why && <span className="small">{card.why}</span>}
      {fly ? <span className="small muted">✈️ {I.flightLine(fly) || 'Fly'}{search ? <> · <a href={search} target="_blank" rel="noreferrer" data-testid="flight-search">Search flights</a></> : null}</span>
        : card.drive_min ? <span className="small muted">🚗 about {I.dur(card.drive_min)} drive</span> : null}
      {card.courses?.length > 0 && <span className="small muted">⛳ {card.courses.join(', ')}</span>}
      {card.stay && <span className="small muted">🛏️ {card.stay}</span>}
      {card.weekend && <span className="small muted">📅 {I.fridayLabel(card.weekend, ctx.fixed.nights ?? 2)}</span>}
      {fit && <span className="small" style={{ color: '#2E6B3F', fontWeight: 600 }}>{fit}</span>}
      {canAddIt && <button type="button" className="btn sm" disabled={busy || done} onClick={add} data-testid="caddie-add">{done ? '✓ On the lists' : '+ Add to the lists'}</button>}
    </div>
  );
}

function IdeaCaddie(ctx) {
  const aiOn = useFeature('ai_helper');
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!aiOn || !ctx.canAdd) return null;
  const ask = async (q) => {
    setBusy(true);
    const t0 = Date.now();
    const r = await askIdeas({ plan_id: ctx.plan.id, text: q, messages: turns.flatMap((t) => [{ role: 'user', text: t.q }, { role: 'caddie', text: t.message || '' }]).slice(-6), context: ideaContext(ctx) });
    setBusy(false);
    if (r.error) { toast(r.error); return; }
    setTurns([...turns, { q, message: r.message, ideas: r.ideas || [], ms: Date.now() - t0 }]);
    setText('');
  };
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="idea-caddie">
      <strong>✨ The Caddie’s ideas</strong>
      {!turns.length && <span className="small muted">Quick ideas that suit the group’s answers — flying to one place is fine. Tap one to add it to the lists.</span>}
      {turns.map((t, i) => (
        <div key={i} className="stack" style={{ gap: 6 }}>
          <span className="small muted">You: {t.q}</span>
          <span data-testid="caddie-message">{t.message}</span>
          {t.ideas.map((c, j) => <IdeaCard key={j} card={c} ctx={ctx} canAddIt />)}
        </div>
      ))}
      {busy && <span className="small muted">The Caddie’s thinking…</span>}
      {!turns.length ? (
        <button type="button" className="btn gold block" disabled={busy} onClick={() => ask('Give us a few ideas that suit everyone.')} data-testid="caddie-ideas">✨ Give us some ideas</button>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. somewhere warmer? or cheaper?" aria-label="Ask the Caddie" />
          <button type="button" className="btn" disabled={busy || text.trim().length < 3} onClick={() => ask(text.trim())}>Ask</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the organiser

function OrganiserPanel(ctx) {
  const { plan, l } = ctx;
  const [open, setOpen] = useState(null); // 'def' | 'paste' | 'share' | 'hand' | 'tidy'
  const queued = l.queued;
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="organiser-panel">
      <strong>🧭 Organising</strong>
      {queued.length > 0 && <Queue {...ctx} />}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {!plan.idea_pool && <button type="button" className="btn gold sm" onClick={() => setOpen('share')} data-testid="share-it">📣 Share it</button>}
        <button type="button" className="btn ghost sm" onClick={() => setOpen(open === 'def' ? null : 'def')} data-testid="edit-def">📌 What’s set</button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(open === 'paste' ? null : 'paste')} data-testid="paste-chat">📋 Paste the chat</button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(open === 'tidy' ? null : 'tidy')} data-testid="tidy-vote">🗳️ Tidy up → vote</button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(open === 'hand' ? null : 'hand')} data-testid="hand-over">🤝 Hand over organising</button>
        {ctx.status.is_admin && <button type="button" className="btn ghost sm" onClick={() => openPlanner({ planId: plan.id, say: I.pullTogetherText({ plan, lists: l, summary: ctx.summary }) })} data-testid="pull-together">✨ Pull it together</button>}
      </div>
      {open === 'def' && <DefinitionEdit {...ctx} onDone={() => setOpen(null)} />}
      {open === 'paste' && <PasteChat {...ctx} />}
      {open === 'tidy' && <TidyVote {...ctx} />}
      {open === 'hand' && <HandOver {...ctx} onDone={() => setOpen(null)} />}
      {open === 'share' && <ShareIt {...ctx} onClose={() => setOpen(null)} />}
      {plan.idea_sent_at && <Leftovers {...ctx} />}
      {!plan.idea_sent_at && l.declined.length > 0 && <Leftovers {...ctx} />}
    </div>
  );
}

// Josh 19:22 / 19:34: "the definition" — whatever the organiser knows, any mix, each part Set or Open to ideas.
function DefinitionEdit({ plan, fixed, reload, onDone }) {
  const [f, setF] = useState(() => ({
    weekendStart: fixed.weekend?.start || '', when: fixed.when || '', area: fixed.area || '', from: fixed.from || '',
    within_min: fixed.within_min || '', travel: fixed.travel || '', nights: fixed.nights ?? '', golf: fixed.golf || '',
    set: Object.fromEntries((fixed.set || []).map((k) => [k, true])),
  }));
  const [busy, run] = useRun();
  const up = (p) => setF({ ...f, ...p });
  const SetToggle = ({ k }) => (
    <div className="seg light" role="group" aria-label={`${k}: set or open to ideas`} style={{ flex: 'none' }}>
      <button type="button" aria-pressed={!!f.set[k]} onClick={() => up({ set: { ...f.set, [k]: true } })} data-testid={`set-${k}`}>Set</button>
      <button type="button" aria-pressed={!f.set[k]} onClick={() => up({ set: { ...f.set, [k]: false } })}>Open to ideas</button>
    </div>
  );
  const save = () => run(async () => {
    await must(supabase.rpc('idea_set_fixed', { p_plan: plan.id, p_fixed: I.defPayload(f) }));
    reload(); onDone();
  }, 'Saved');
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="def-edit">
      <span className="small muted">Put in whatever you know. “Set”: people say in or out, other suggestions come to you first. “Open to ideas”: suggestions go straight on the lists.</span>
      <div className="row" style={{ gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field grow"><span>The weekend (its first day)</span><input className="input" type="date" value={f.weekendStart} min={todayISO()} onChange={(e) => up({ weekendStart: e.target.value })} aria-label="The weekend" /></label>
        <label className="field grow"><span>…or roughly</span><input className="input" value={f.when} onChange={(e) => up({ when: e.target.value })} placeholder="e.g. the June long weekend" aria-label="Roughly when" /></label>
        <SetToggle k="weekend" />
      </div>
      <div className="row" style={{ gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field grow"><span>Where</span><input className="input" value={f.area} onChange={(e) => up({ area: e.target.value })} placeholder="e.g. Melbourne, or leave blank" aria-label="Where" /></label>
        <SetToggle k="area" />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <label className="field grow"><span>Within</span><select className="select" value={f.within_min} onChange={(e) => up({ within_min: e.target.value ? Number(e.target.value) : '' })} aria-label="Within">
          <option value="">—</option>{[120, 180, 240, 300].map((m) => <option key={m} value={m}>{I.dur(m)}</option>)}</select></label>
        <label className="field grow"><span>of</span><input className="input" value={f.from} onChange={(e) => up({ from: e.target.value })} placeholder="Sydney" aria-label="Of where" /></label>
      </div>
      <div className="row" style={{ gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field grow"><span>How long</span><select className="select" value={f.nights} onChange={(e) => up({ nights: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="How long">
          <option value="">Not sure</option>{I.DAYS.map((d) => <option key={d} value={d - 1}>{I.daysWord(d - 1)}</option>)}</select></label>
        <SetToggle k="nights" />
      </div>
      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chips label="Getting there" options={I.TRAVEL} value={f.travel || null} onPick={(v) => up({ travel: v || '' })} />
        <SetToggle k="travel" />
      </div>
      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chips label="How much golf" options={I.GOLF} value={f.golf || null} onPick={(v) => up({ golf: v || '' })} />
        <SetToggle k="golf" />
      </div>
      <button type="button" className="btn gold" disabled={busy} onClick={save} data-testid="def-save">Save</button>
    </div>
  );
}

function Queue({ l, data, reload }) {
  const [busy, run] = useRun();
  const review = (it, ok) => run(async () => {
    let note = null;
    if (!ok) note = window.prompt?.('A note for them? (optional)', '') ?? null;
    await must(supabase.rpc('idea_review', { p_item: it.id, p_accept: ok, p_note: note }));
    reload();
  }, ok ? 'Added to the lists' : 'Declined');
  return (
    <div className="stack" style={{ gap: 6, background: 'var(--gold-soft)', borderRadius: 10, padding: 10 }} data-testid="queue">
      <strong data-testid="queue-count">{l.queued.length} suggestion{l.queued.length === 1 ? '' : 's'} to look at</strong>
      {l.queued.map((it) => (
        <div key={it.id} className="row between" style={{ gap: 6, alignItems: 'center' }} data-testid="queued-item">
          <span className="small"><strong>{it.label}</strong> · from {nameOf(data, it.added_by) || 'someone'}</span>
          <span className="row" style={{ gap: 4 }}>
            <button type="button" className="btn sm" disabled={busy} onClick={() => review(it, true)} data-testid="queue-accept">✓ Add</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => review(it, false)} data-testid="queue-decline">✗ Decline</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Josh 19:34 (6): "Paste the chat here if it helps" — and (7) "✨ Ideas from the comments". Each suggestion needs the
// organiser's OK (the + Add button). Nothing reads any chat app.
function PasteChat(ctx) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const go = async (source) => {
    const material = source === 'paste' ? text : [
      ...ctx.pd.comments.map((c) => `${first(nameOf(ctx.data, c.player_id)) || 'Someone'}: ${c.body}`),
      ...ctx.l.queued.map((i) => `${first(nameOf(ctx.data, i.added_by)) || 'Someone'} suggested: ${i.label}`),
    ].join('\n');
    setBusy(true);
    const r = await askIdeas({ plan_id: ctx.plan.id, source, material, text: source === 'paste' ? 'What from this chat should go on our lists?' : 'What from the comments should go on our lists?', context: ideaContext(ctx) });
    setBusy(false);
    if (r.error) { toast(r.error); return; }
    setRes(r);
  };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="paste-box">
      <label className="field"><span>Paste the chat here if it helps</span>
        <textarea className="textarea" rows={4} style={{ padding: 10 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Copy a chunk of the WhatsApp or Messenger chat and paste it here" aria-label="Paste the chat" /></label>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm" disabled={busy || text.trim().length < 10} onClick={() => go('paste')} data-testid="paste-go">✨ What should go on the lists?</button>
        <button type="button" className="btn ghost sm" disabled={busy || (!ctx.pd.comments.length && !ctx.l.queued.length)} onClick={() => go('comments')} data-testid="comments-go">✨ Ideas from the comments</button>
      </div>
      {busy && <span className="small muted">The Caddie’s reading…</span>}
      {res && (
        <div className="stack" style={{ gap: 6 }}>
          <span>{res.message}</span>
          {(res.ideas || []).map((c, j) => <IdeaCard key={j} card={c} ctx={ctx} canAddIt />)}
          {!(res.ideas || []).length && <span className="small muted">Nothing new to add.</span>}
        </div>
      )}
    </div>
  );
}

function HandOver({ plan, data, organiserId, reload, onDone }) {
  const [who, setWho] = useState('');
  const [busy, run] = useRun();
  const nav = useNavigate();
  const go = () => run(async () => {
    await must(supabase.rpc('hand_over_idea', { p_plan: plan.id, p_player: who }));
    reload(); onDone();
    nav(`/idea/${plan.id}?view=summary`);
  }, `Handed over to ${first(nameOf(data, who))} — they’ve been told`);
  const people = (data.players || []).filter((p) => p.approved !== false && p.id !== organiserId);
  return (
    <div className="row" style={{ gap: 6, alignItems: 'flex-end' }} data-testid="hand-over-box">
      <label className="field grow"><span>Who organises it from here</span>
        <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who organises it">
          <option value="">Pick someone…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
        </select></label>
      <button type="button" className="btn gold" disabled={busy || !who} onClick={go} data-testid="hand-over-go">Hand over</button>
    </div>
  );
}

// 📣 Share it: (a) a Feed post + buzz in the app, (b) a picture and a link with a proper preview for the group chat.
function ShareIt({ plan, data, status, reload, onClose }) {
  const [busy, run] = useRun();
  const [out, setOut] = useState(null);
  const by = first(nameOf(data, plan.created_by)) || 'Someone';
  useEffect(() => {
    run(async () => {
      const look = status?.look || {};
      const card = I.ideaCard(plan, by);
      const [file, preview] = await Promise.all([drawCard('idea', card, look), drawIdeaPreview(card, look).catch(() => null)]);
      let url = null;
      if (preview) { try { url = await uploadPhoto(preview, 'ideas', {}); } catch { url = null; } }
      const firstTime = !plan.shared_at;
      const token = await must(supabase.rpc('share_idea', { p_plan: plan.id, p_card_url: url && /\/storage\/v1\/object\/public\/photos\//.test(url) ? url : null }));
      if (firstTime) {
        try { await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, link: `/idea/${plan.id}`, body: I.feedLine(plan, by) }); } catch { /* the feed is a nice-to-have */ }
        notify('idea_shared', { plan_id: plan.id }).catch(() => {});
      }
      const link = I.ideaLink({ origin: window.location.origin, base: import.meta.env.BASE_URL, token, appLink: appLink(`/idea/${plan.id}`) });
      setOut({ file, img: URL.createObjectURL(file), link, msg: I.shareMessage(plan, by, link), firstTime });
      reload();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async () => { try { await navigator.clipboard.writeText(out.link); toast('Link copied — paste it in the group chat'); } catch { toast('Couldn’t copy — press and hold the link'); } };
  return (
    <Sheet title="📣 Share it" onClose={onClose}>
      {!out ? <Loading text={busy ? 'Making the picture…' : 'Getting it ready…'} /> : (
        <div className="stack" style={{ gap: 10 }} data-testid="share-out">
          {out.firstTime && <span className="small" style={{ fontWeight: 700 }}>✓ Posted in the app — everyone in the group can add to it now.</span>}
          <img src={out.img} alt="The share picture" style={{ width: '100%', maxWidth: 360, alignSelf: 'center', borderRadius: 12 }} data-testid="share-card" />
          <div className="small" style={{ background: 'var(--ground)', borderRadius: 10, padding: '8px 10px', wordBreak: 'break-word' }} data-testid="share-message">{out.msg}</div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn gold grow" onClick={async () => { const r = await sharePicture(out.file, out.msg); if (r === 'saved') toast('Picture saved — post it with the link'); }} data-testid="share-picture">🖼️ Picture + link</button>
            <button type="button" className="btn grow" onClick={copy} data-testid="share-copy">🔗 Copy link</button>
            <button type="button" className="btn ghost grow" onClick={async () => { const r = await shareText(out.msg, plan.name); if (r === 'copied') toast('Message copied'); }}>📤 Share…</button>
          </div>
          <span className="small muted" data-testid="share-link">{out.link}</span>
        </div>
      )}
    </Sheet>
  );
}

// DECIDE: tick what goes to the vote → the v10.6 When? / Where? votes.
function TidyVote({ plan, x, l, answers, reload, fixed }) {
  const nav = useNavigate();
  const [ticks, setTicks] = useState(() => Object.fromEntries(x.items.filter((i) => i.picked).map((i) => [i.id, true])));
  const [busy, run] = useRun();
  const n = Object.values(ticks).filter(Boolean).length;
  const send = () => run(async () => {
    const picked = Object.keys(ticks).filter((k) => ticks[k]);
    await must(supabase.rpc('idea_tidy', { p_plan: plan.id, p_picked: picked, p_send: true }));
    const items = x.items.map((i) => ({ ...i, picked: !!ticks[i.id] }));
    const fits = Object.fromEntries(items.map((i) => [i.id, I.itemFit(i, { wishes: answers, stayAreas: x.stayAreas, base: x.base })]).filter(([, v]) => v));
    const { data: b } = await supabase.from('trip_builds').select('state').eq('plan_id', plan.id).maybeSingle();
    const st = I.builderFromPicks({ ...TB.newState(plan), ...(b?.state || {}) }, items, { stayAreas: x.stayAreas, fits, fixed });
    await must(supabase.from('trip_builds').upsert({ plan_id: plan.id, state: st }, { onConflict: 'plan_id' }));
    reload();
    nav(`/plan/${plan.id}/build?call=auto`);
  }, 'Sent to the vote');
  const tidy = { ticks, toggle: (id) => setTicks({ ...ticks, [id]: !ticks[id] }) };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="tidy-box">
      <span className="small muted">Tick what goes to the vote. The rest you can park as future trip ideas.</span>
      {[['date', '📅'], ['area', '📍'], ['course', '⛳']].map(([k, e]) => l[k].map((it) => (
        <label key={it.id} className="row" style={{ gap: 8, minHeight: 40, alignItems: 'center' }} data-testid="tidy-item">
          <input type="checkbox" checked={!!ticks[it.id]} onChange={() => tidy.toggle(it.id)} style={{ width: 22, height: 22 }} aria-label={`Send ${it.label} to the vote`} />
          <span>{e} {it.label} <span className="small muted">👍{it.t.up} 👎{it.t.down}</span></span>
        </label>
      )))}
      <button type="button" className="btn gold block" disabled={busy || !n} onClick={send} data-testid="send-to-vote">🗳️ Send to the vote ({n})</button>
    </div>
  );
}

// Josh 19:41: the leftovers → the Caddie proposes 1–3 parked ideas; OK / edit / discard each.
function Leftovers(ctx) {
  const { plan, x, data } = ctx;
  const nav = useNavigate();
  const left = x.items.filter((i) => !i.picked && ['in', 'declined'].includes(i.status) && !i.leftover);
  const [groups, setGroups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, run] = useRun();
  if (!left.length) return null;
  const suggest = async () => {
    setBusy(true);
    const r = await askIdeas({ plan_id: plan.id, source: 'leftovers', leftovers: left.map((i) => ({ id: i.id, kind: i.kind, label: i.label, area: i.area, by: first(nameOf(data, i.added_by)) })), context: ideaContext(ctx) });
    setBusy(false);
    setGroups((r.groups && r.groups.length ? r.groups : I.parkGroups(left)).map((g) => ({ ...g, name: g.name })));
  };
  const park = (g, i) => run(async () => {
    await must(supabase.rpc('idea_park', { p_plan: plan.id, p_name: g.name, p_items: g.items, p_why: g.why || null }));
    setGroups(groups.filter((_, j) => j !== i));
    ctx.reload();
  }, `Parked: ${g.name}`);
  const another = () => run(async () => {
    const id = await must(supabase.rpc('idea_spin_off', { p_plan: plan.id, p_name: null, p_items: null }));
    nav(`/idea/${id}`);
  });
  return (
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }} data-testid="leftovers">
      <strong>💭 {left.length} didn’t go to the vote</strong>
      {!groups ? (
        <button type="button" className="btn sm" disabled={busy} onClick={suggest} data-testid="park-suggest">{busy ? 'The Caddie’s sorting them…' : '✨ Park them as future trip ideas'}</button>
      ) : groups.map((g, i) => (
        <div key={i} className="card pad stack" style={{ gap: 4 }} data-testid="park-group">
          <input className="input" value={g.name} onChange={(e) => setGroups(groups.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} aria-label="Name of the parked idea" />
          <span className="small muted">{g.items.map((id) => x.items.find((it) => it.id === id)?.label).filter(Boolean).join(' · ')}{g.why ? ` — ${g.why}` : ''}</span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn gold sm" onClick={() => park(g, i)} data-testid="park-ok">✓ Park it</button>
            <button type="button" className="btn ghost sm" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>Discard</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={another} data-testid="spin-off">Or start another trip idea now</button>
    </div>
  );
}

function ParkedBanner({ plan, me, data, reload }) {
  const c = I.claimState(plan, me);
  const [busy, run] = useRun();
  const nav = useNavigate();
  const claim = () => run(async () => {
    await must(supabase.rpc('idea_claim', { p_plan: plan.id }));
    reload();
    nav(`/idea/${plan.id}?view=board`);
  }, 'It’s yours — share it when you’re ready');
  const owner = first(nameOf(data, c.owner));
  const until = c.until ? c.until.toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <div className="card pad stack" style={{ gap: 6, borderStyle: 'dashed', borderColor: 'var(--gold)' }} data-testid="parked-banner" data-state={c.state}>
      <strong>💭 Parked for later</strong>
      <span className="small">{c.state === 'mine' ? `It’s yours if you want it (until ${until}).` : c.state === 'theirs' ? `${owner || 'Someone'} gets first go until ${until}. Anyone can still add to it.` : 'Up for grabs — claim it and you organise it.'}</span>
      {c.state !== 'theirs' && <button type="button" className="btn gold" disabled={busy} onClick={claim} data-testid="claim-it">🙋 Claim it</button>}
    </div>
  );
}
