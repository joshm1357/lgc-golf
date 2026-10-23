// Awards and fines (migration 093, feature 'dinner_awards'): the run-up list ("Awards & fines for this trip" /
// "What's up for grabs"), proposing one, opinions on a fine's size, fining a feed post (and the chip it leaves), and
// the leftover kitty line. The words and sums are in lib/awardsfines.js; the database checks everything again.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Sheet, PhotoButtons, Avatar } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { uploadPhoto } from '../lib/images.js';
import { notify } from '../lib/push.js';
import RuleTag from './RuleTag.jsx';
import { AutoSettings, AUTO_START, autoRow, autoProblem } from './AutoAwards.jsx';
import { useTripComps } from './CompsChip.jsx';
import { tripCupComps } from '../lib/cups.js'; // ov32: "Counts towards: [cup]"
import {
  REWARD_TYPES, PROOFS, BESTS, OPINIONS, IDEAS, LEFTOVER_KEY, rewardWords, proofNeeds, proofLabel, bestLabel, checkProposal,
  signedAmount, tripAwardList, chipText, claimWords, tallyOpinions, leftoverLine, leftoverWords, termsOf, worthOf,
} from '../lib/awardsfines.js';
import { gate } from '../lib/savedgate.js';

const KIND_ICON = { award: '🏅', fine: '🏷' };

/** The group's award / fine rules (and the leftover kitty rule) and a trip's awards, live. */
export function useAwardsData(tripId) {
  const on = useFeature('dinner_awards');
  const [d, setD] = useState({ rules: [], awards: [], leftover: null, ready: false });
  const load = useCallback(async () => {
    const [r, a] = await Promise.all([
      supabase.from('rules').select('*').or(`award_kind.not.is.null,system_key.eq.${LEFTOVER_KEY}`),
      on && tripId ? supabase.from('dinner_awards').select('*').eq('trip_id', tripId) : Promise.resolve({ data: [] }),
    ]);
    // An older database (no award_kind yet): nothing to show.
    const rules = r.error ? [] : r.data || [];
    setD({ rules: rules.filter((x) => x.award_kind), awards: a.error ? [] : a.data || [], leftover: rules.find((x) => x.system_key === LEFTOVER_KEY && x.status === 'active') || null, ready: true });
  }, [on, tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['rules', 'dinner_awards'], load);
  return { ...d, reload: load, on };
}

// ------------------------------------------------------------------ the run-up list
/**
 * "Awards & fines for this trip": what's on (worth and proof), what's waiting for a decision, and "Propose one".
 * Mounted in the run-up Organise step and on the trip Overview before the trip (title "What's up for grabs").
 */
export function AwardsRunUp({ trip, title = '🏷 Fines & awards for this trip', overview = false }) {
  const { status } = useSession();
  const ad = useAwardsData(trip?.id);
  const [proposing, setProposing] = useState(null);
  const { list, proposed } = useMemo(() => tripAwardList({ rules: ad.rules, awards: ad.awards, tripId: trip?.id || null }), [ad.rules, ad.awards, trip?.id]);
  if (!ad.on || !ad.ready) return null;
  const canPropose = !status.viewing && status.role !== 'guest' && !!status.player_id;
  if (overview && !list.length && !proposed.length) {
    return canPropose ? (
      <div className="card pad stack" style={{ gap: 6 }} data-testid="awards-runup">
        <strong>{title}</strong>
        <span className="small muted">No awards or fines yet. Got one in mind — latest out, wrong ball, air shot?</span>
        <button {...gate('propose_award')} type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setProposing({})} data-testid="propose-award">+ Propose one</button>
        {proposing && <ProposeSheet trip={trip} start={proposing} onClose={() => setProposing(null)} onSaved={ad.reload} />}
      </div>
    ) : null;
  }
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="awards-runup">
      <div className="row between" style={{ gap: 8 }}>
        <strong>{title}</strong>
        {trip && <Link to={`/dinner/${trip.id}`} className="small" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Fines &amp; awards →</Link>}
      </div>
      {list.length === 0 && <span className="small muted">Nothing on yet — propose the first.</span>}
      {list.map((x) => <AwardLine key={x.key} item={x} />)}
      {proposed.length > 0 && (
        <div className="stack" style={{ gap: 6 }} data-testid="awards-waiting">
          <span className="label">Waiting for a decision ({proposed.length})</span>
          {proposed.map((r) => (
            <Link key={r.id} to={`/rules/${r.id}`} className="row between" style={{ gap: 8, color: 'inherit', textDecoration: 'none', padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span className="grow" style={{ minWidth: 0 }}>{KIND_ICON[r.award_kind]} <strong>{r.title}</strong>{r.value ? <span className="muted"> · {r.value}</span> : null}</span>
              <span className="small" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{status.is_admin ? 'Decide →' : 'Have your say →'}</span>
            </Link>
          ))}
        </div>
      )}
      {ad.leftover && !overview && (
        <div className="small" data-testid="runup-leftover">💰 Leftover kitty: <strong><RuleTag rule={{ table: 'rules', id: ad.leftover.id, field: 'value', label: 'Leftover kitty', value: ad.leftover.value, rule_id: ad.leftover.id }}
          explain="What happens to money left in the kitty at the end of the trip. Words only — no money moves in the app.">{leftoverWords(ad.leftover.leftover, ad.leftover.leftover_note)}</RuleTag></strong></div>
      )}
      {canPropose && <button {...gate('propose_award')} type="button" className="btn gold sm" style={{ alignSelf: 'flex-start' }} onClick={() => setProposing({})} data-testid="propose-award">+ Propose one</button>}
      {!overview && <span className="small muted">A week out, everyone’s asked “Any awards or fines to add?” — and the organiser hears what’s waiting.</span>}
      {proposing && <ProposeSheet trip={trip} start={proposing} onClose={() => setProposing(null)} onSaved={ad.reload} />}
    </div>
  );
}

function AwardLine({ item }) {
  const t = item.terms;
  const proof = proofLabel(t.proof, t.number_unit);
  const best = bestLabel(t.best);
  const inner = (
    <>
      <span className="grow" style={{ minWidth: 0 }}>
        <span>{KIND_ICON[item.kind]} <strong>{item.title}</strong></span>
        {(proof || best) && <span className="small muted" style={{ display: 'block' }}>{[proof, best].filter(Boolean).join(' · ')}</span>}
      </span>
      {item.worth && <span className="small" style={{ padding: '2px 10px', borderRadius: 999, background: 'var(--gold-soft)', border: '1px solid var(--gold)', fontWeight: 800, whiteSpace: 'nowrap' }}>{item.worth}</span>}
    </>
  );
  const style = { gap: 8, padding: '6px 0', borderTop: '1px solid var(--line-soft)', color: 'inherit', textDecoration: 'none', alignItems: 'flex-start' };
  return item.rule
    ? <Link to={`/rules/${item.rule.id}`} className="row between" style={style} data-testid="award-line">{inner}</Link>
    : <div className="row between" style={style} data-testid="award-line">{inner}</div>;
}

// ------------------------------------------------------------------ proposing
/** Propose an award or a fine: it's a Rulebook rule, decided the group's usual way. */
export function ProposeSheet({ trip, start = {}, onClose, onSaved }) {
  const { status } = useSession();
  const votingOn = useFeature('rule_voting');
  const [v, setV] = useState(() => ({ award_kind: 'award', title: '', detail: '', reward_type: 'strokes', amount: '1', reward_note: '', proof: 'none', best: '', number_unit: '', thisTrip: false, ...AUTO_START, ...start }));
  const [busy, run] = useRun();
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));
  const type = REWARD_TYPES.find((t) => t.key === v.reward_type);
  const amount = type?.amount ? signedAmount(v.award_kind, v.reward_type, v.amount) : null;
  const needs = proofNeeds(v.proof);
  const bests = needs.time ? BESTS.time : needs.number ? BESTS.number : [];
  const row = {
    title: v.title.trim(), award_kind: v.award_kind, reward_type: v.reward_type, reward_amount: amount,
    reward_note: v.reward_note.trim() || null, proof: v.proof, best: bests.some((b) => b.key === v.best) ? v.best : null,
    number_unit: needs.number ? v.number_unit.trim() || null : null,
    // 100: when it runs (each night / day), from the scores, points towards a cup.
    ...autoRow({ ...v, best: bests.some((b) => b.key === v.best) ? v.best : '' }),
  };
  const err = v.title.trim() ? checkProposal(row) || autoProblem({ ...v, best: row.best }) : '';
  const blockedVote = !status.is_admin && !votingOn;
  // ov32: the cups up for grabs this trip; an award or fine can count towards one (rules.comp_id, 100), worth points.
  const [tripCompsList] = useTripComps(trip?.id || null);
  const cupList = trip ? tripCupComps(tripCompsList, trip.id) : [];
  const cupPart = v.comp_id && cupList.some((c) => c.id === v.comp_id)
    ? { comp_id: v.comp_id, ...(row.points ? {} : { points: { mode: 'winner', points: Number(v.cup_points) > 0 ? Number(v.cup_points) : 1 } }) }
    : {};
  const save = () => run(async () => {
    const created = await must(supabase.from('rules').insert({
      ...row, ...cupPart, detail: v.detail.trim() || null, category: 'fines', applies_to: ['trip'], status: 'proposed',
      proposed_by: status.player_id, for_trip: v.thisTrip && trip?.id ? trip.id : null,
    }).select().single());
    await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, link: `/rules/${created.id}`, trip_id: trip?.id || null, body: `📜 Up for a decision: ${created.award_kind === 'fine' ? 'fine' : 'award'} “${created.title}”${created.value ? ` (${created.value})` : ''}` });
    await notify('rule_proposed', { rule_id: created.id });
    onSaved?.();
    onClose();
  }, 'Proposed — it goes to the group’s usual decision');
  return (
    <Sheet title={v.award_kind === 'fine' ? 'Propose a fine' : 'Propose an award'} onClose={onClose}>
      <div className="stack" data-testid="propose-sheet">
        <div className="seg light" role="group" aria-label="Award or fine">
          <button type="button" aria-pressed={v.award_kind === 'award'} onClick={() => set({ award_kind: 'award' })}>🏅 Award</button>
          <button type="button" aria-pressed={v.award_kind === 'fine'} onClick={() => set({ award_kind: 'fine' })}>🏷 Fine</button>
        </div>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {IDEAS.filter((i) => i.award_kind === v.award_kind).map((i) => (
            <button key={i.title} type="button" className="chip" onClick={() => set({ ...i, amount: i.reward_amount != null ? String(Math.abs(i.reward_amount)) : v.amount, reward_note: i.reward_note || '', number_unit: i.number_unit || '', best: i.best || '' })}>{i.title}</button>
          ))}
        </div>
        <label className="field"><span>Name</span><input className="input" value={v.title} maxLength={70} onChange={(e) => set({ title: e.target.value })} placeholder={v.award_kind === 'fine' ? 'e.g. Wrong-ball fine' : 'e.g. Latest out'} data-testid="award-title" /></label>
        <label className="field"><span>What it’s for (optional)</span><input className="input" value={v.detail} maxLength={300} onChange={(e) => set({ detail: e.target.value })} placeholder={v.award_kind === 'fine' ? 'e.g. Played someone else’s ball' : 'e.g. Last one standing at the bar'} /></label>
        <label className="field"><span>{v.award_kind === 'fine' ? 'The penalty' : 'The reward'}</span>
          <select className="select" value={v.reward_type} onChange={(e) => set({ reward_type: e.target.value })} data-testid="reward-type">
            {REWARD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
          </select>
        </label>
        {type?.amount && (
          <label className="field"><span>{v.reward_type === 'money' ? 'How much ($)' : v.reward_type === 'strokes' ? (v.award_kind === 'fine' ? 'Strokes added in the next round' : 'Strokes off in the next round') : (v.award_kind === 'fine' ? 'Points off' : 'Points added')}</span>
            <input className="input" inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '').slice(0, 7) })} data-testid="reward-amount" /></label>
        )}
        {['drink', 'title', 'other', 'money'].includes(v.reward_type) && (
          <label className="field"><span>{v.reward_type === 'other' ? 'What happens' : 'In words (optional)'}</span>
            <input className="input" value={v.reward_note} maxLength={80} onChange={(e) => set({ reward_note: e.target.value })} placeholder={v.reward_type === 'drink' ? 'Buys the first round' : v.reward_type === 'title' ? 'Wears the green jacket at dinner' : v.reward_type === 'money' ? 'into the kitty' : 'Sings at dinner'} /></label>
        )}
        <label className="field"><span>Proof a claim needs</span>
          <select className="select" value={v.proof} onChange={(e) => set({ proof: e.target.value })} data-testid="proof">
            {PROOFS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {needs.number && <label className="field"><span>The number is in… (optional)</span><input className="input" value={v.number_unit} maxLength={12} onChange={(e) => set({ number_unit: e.target.value })} placeholder="m, balls, beers" /></label>}
        {bests.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Decided by</span>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={!v.best} onClick={() => set({ best: '' })}>The vote</button>
              {bests.map((b) => <button key={b.key} type="button" className="chip" aria-pressed={v.best === b.key} onClick={() => set({ best: b.key })} data-testid={`best-${b.key}`}>{b.label}</button>)}
            </div>
            {v.best && <span className="small muted">The app ranks the claims; the group’s vote confirms.</span>}
          </div>
        )}
        <AutoSettings v={{ ...v, best: row.best || '' }} set={set} />
        {cupList.length > 0 && (
          <label className="field"><span>Counts towards</span>
            <select className="select" value={v.comp_id || ''} onChange={(e) => set({ comp_id: e.target.value })} data-testid="counts-towards">
              <option value="">No cup</option>
              {cupList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {cupPart.points && (
          <label className="field"><span>{v.award_kind === 'fine' ? 'Points off the cup' : 'Points towards the cup'}</span>
            <input className="input" inputMode="decimal" value={v.cup_points ?? '1'} onChange={(e) => set({ cup_points: e.target.value.replace(/[^\d.]/g, '').slice(0, 5) })} data-testid="counts-towards-points" /></label>
        )}
        {trip && (
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.thisTrip} onChange={(e) => set({ thisTrip: e.target.checked })} /> <span>Just for {trip.name} (otherwise every trip)</span></label>
        )}
        <div className="card pad small" style={{ background: 'var(--gold-soft)' }} data-testid="propose-preview">
          {KIND_ICON[v.award_kind]} <strong>{v.title.trim() || '…'}</strong>{rewardWords(row.reward_type, row.reward_amount, row.reward_note) ? ` · ${rewardWords(row.reward_type, row.reward_amount, row.reward_note)}` : ''}
          {proofLabel(row.proof, row.number_unit) && <div className="muted">{proofLabel(row.proof, row.number_unit)}{row.best ? ` · ${bestLabel(row.best)}` : ''}</div>}
        </div>
        {err && <span className="err" role="alert">{err}</span>}
        {blockedVote && <span className="small muted">Proposing is switched off for this group (rule voting) — ask your organiser.</span>}
        <button type="button" className="btn gold block" disabled={busy || !v.title.trim() || !!err || blockedVote} onClick={save} data-testid="propose-save">Propose it</button>
        <span className="small muted">It goes in the Rulebook under Fines &amp; awards and is decided the group’s usual way. Words only — no money moves in the app.</span>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ opinions on a fine's size
/** "Too much / About right / Too little" + a comment, with the tally. For award / fine rules and the leftover kitty. */
export function OpinionBox({ rule }) {
  const data = useData();
  const { status } = useSession();
  const on = useFeature('dinner_awards');
  const [rows, setRows] = useState([]);
  const [pick, setPick] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, run] = useRun();
  const load = useCallback(async () => {
    const { data: r, error } = await supabase.from('rule_opinions').select('*').eq('rule_id', rule.id).order('updated_at');
    if (!error) setRows(r || []);
  }, [rule.id]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['rule_opinions'], load);
  const leftover = rule.system_key === LEFTOVER_KEY;
  if (!leftover && (!on || !rule.award_kind)) return null;
  const t = tallyOpinions(rows);
  const mine = rows.find((r) => r.player_id === status.player_id);
  const canSay = !status.viewing && status.role !== 'guest' && !!status.player_id && ['active', 'proposed'].includes(rule.status);
  const save = (opinion) => run(async () => {
    await must(supabase.from('rule_opinions').upsert({ rule_id: rule.id, player_id: status.player_id, opinion, comment: comment.trim() || mine?.comment || null }, { onConflict: 'rule_id,player_id' }));
    setPick(null); setComment('');
    await load();
  }, 'Opinion in');
  const q = leftover ? 'Happy with that?' : rule.award_kind === 'fine' ? 'Is the fine the right size?' : 'Is the reward the right size?';
  const labels = leftover ? { too_much: 'Change it', about_right: 'Happy with it', too_little: 'Not sure' } : null;
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="opinion-box">
      <strong>{q}</strong>
      <div className="small" data-testid="opinion-tally"><strong>{labels ? `${t.about_right} happy · ${t.too_much} want a change · ${t.too_little} not sure` : t.line}</strong></div>
      {canSay && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {OPINIONS.map((o) => {
              const sel = (pick || mine?.opinion) === o.key;
              return <button key={o.key} type="button" className="btn ghost sm" aria-pressed={sel} disabled={busy} data-testid={`opinion-${o.key}`}
                style={sel ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {}} onClick={() => setPick(o.key)}>{labels ? labels[o.key] : o.label}</button>;
            })}
          </div>
          {pick && (
            <>
              <input className="input" value={comment} maxLength={140} onChange={(e) => setComment(e.target.value)} placeholder="A one-liner (optional)" data-testid="opinion-comment" />
              <button type="button" className="btn gold block" disabled={busy} onClick={() => save(pick)} data-testid="opinion-save">Say it</button>
            </>
          )}
        </>
      )}
      {rows.filter((r) => r.comment).map((r) => (
        <div key={r.player_id} className="small"><strong>{playerName(data.playersById[r.player_id]) || 'Someone'}</strong> <span className="muted">({OPINIONS.find((o) => o.key === r.opinion)?.label.toLowerCase()})</span> “{r.comment}”</div>
      ))}
      <span className="small muted">An opinion doesn’t change anything. To change it, tap the amount and dispute it — the Tribunal decides.</span>
    </div>
  );
}

// ------------------------------------------------------------------ fines from the feed
/** Nominations linked to these posts, with their award's title and worth → { [post_id]: [chip] }. */
export function usePostChips(postIds) {
  const on = useFeature('dinner_awards');
  const key = (postIds || []).join(',');
  const [chips, setChips] = useState({});
  const load = useCallback(async () => {
    if (!on || !postIds?.length) { setChips({}); return; }
    const { data: noms, error } = await supabase.from('dinner_award_nominations').select('*').in('post_id', postIds);
    if (error || !noms?.length) { setChips({}); return; }
    const ids = [...new Set(noms.map((n) => n.award_id))];
    const { data: awards } = await supabase.from('dinner_awards').select('*').in('id', ids);
    const ruleIds = [...new Set((awards || []).map((a) => a.rule_id).filter(Boolean))];
    const { data: rules } = ruleIds.length ? await supabase.from('rules').select('*').in('id', ruleIds) : { data: [] };
    const rulesById = Object.fromEntries((rules || []).map((r) => [r.id, r]));
    const byId = Object.fromEntries((awards || []).map((a) => [a.id, a]));
    const out = {};
    for (const n of noms) {
      const a = byId[n.award_id];
      if (!a) continue;
      const terms = termsOf(a, rulesById);
      (out[n.post_id] ||= []).push({ nom: n, award: a, terms, text: chipText({ kind: a.kind, title: a.title, worth: worthOf(terms, a) }) });
    }
    setChips(out);
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['dinner_award_nominations', 'dinner_awards'], load);
  return [chips, load];
}

/** The chips under a post: "🏷 Fined: Wrong ball ($5) · Hamish". Organisers can remove one; the person fined can appeal. */
export function PostChips({ chips = [], onChanged }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  if (!chips.length) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="post-chips">
      {chips.map((c) => {
        const name = playerName(data.playersById[c.nom.player_id]) || 'Someone';
        const claim = claimWords(c.nom, c.terms);
        const mine = c.nom.player_id === status.player_id;
        return (
          <span key={c.nom.id} className="small row" style={{ gap: 6, padding: '3px 10px', borderRadius: 999, background: c.award.kind === 'fine' ? '#FFF1EE' : 'var(--gold-soft)', border: `1px solid ${c.award.kind === 'fine' ? 'var(--under)' : 'var(--gold)'}`, fontWeight: 700 }} data-testid="post-chip">
            <Link to={`/dinner/${c.award.trip_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{c.text} · {name}{claim ? `, ${claim}` : ''}</Link>
            {mine && c.award.kind === 'fine' && c.award.status !== 'closed' && (
              <RuleTag testId="appeal-fine" rule={{ table: 'dinner_award_nominations', id: c.nom.id, field: 'player_id', label: `${name} fined: ${c.award.title}`, where: { trip_id: c.award.trip_id } }}
                explain="You’ve been fined from the Feed. Appeal and the Tribunal decides — if it’s thrown out, an organiser removes the fine.">⚖️ Appeal</RuleTag>
            )}
            {status.is_admin && !status.viewing && c.award.status !== 'closed' && (
              <button type="button" className="btn ghost sm" style={{ minHeight: 24, padding: '0 6px' }} disabled={busy} aria-label={`Remove ${c.text}`} data-testid="remove-fine"
                onClick={() => window.confirm(`Remove “${c.text}” for ${name}?`) && run(async () => { await must(supabase.from('dinner_award_nominations').delete().eq('id', c.nom.id)); onChanged?.(); }, 'Removed')}>✕</button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** "🏷 Fine / award" on a post or comment → which one → who (the post's player) → a note, and any proof it needs. */
export function FineSheet({ post, who: whoStart, onClose, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const tripId = post.trip_id || data.currentTrip?.id || null;
  const trip = data.trips?.find((t) => t.id === tripId) || null;
  const ad = useAwardsData(tripId);
  const { list } = useMemo(() => tripAwardList({ rules: ad.rules, awards: ad.awards, tripId }), [ad.rules, ad.awards, tripId]);
  const open = list.filter((x) => !x.award || x.award.status !== 'closed');
  const [pick, setPick] = useState('');
  const [who, setWho] = useState(whoStart || post.player_id || '');
  const [reason, setReason] = useState('');
  const [time, setTime] = useState(() => toLocalInput(post.created_at));
  const [num, setNum] = useState('');
  const [file, setFile] = useState(null);
  const [busy, run] = useRun();
  const item = open.find((x) => x.key === pick);
  const needs = proofNeeds(item?.terms.proof);
  const people = data.players.filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const photoOk = !needs.photo || !!post.photo_url || !!file;
  const ok = item && who && photoOk && (!needs.time || time) && (!needs.number || num !== '');
  const save = () => run(async () => {
    const awardId = item.award?.id || await must(supabase.rpc('award_for_trip', { p_trip: tripId, p_rule: item.rule.id }));
    const photo = file ? await uploadPhoto(file, 'dinner') : null;
    const { error } = await supabase.from('dinner_award_nominations').insert({
      award_id: awardId, player_id: who, reason: reason.trim() || null, post_id: post.id, nominated_by: status.player_id,
      photo_url: photo, claim_at: needs.time && time ? new Date(time).toISOString() : null, claim_number: needs.number ? Number(num) : null,
    });
    if (error) {
      if (error.code === '23505') throw new Error(`${playerName(data.playersById[who])} is already up for that one`);
      throw error;
    }
    onSaved?.();
    onClose();
  }, item?.kind === 'fine' ? 'Fined — it’s on the post' : 'Nominated — it’s on the post');
  return (
    <Sheet title="🏷 Fine or award" onClose={onClose}>
      <div className="stack" data-testid="fine-sheet">
        {!tripId && <div className="small muted">This post isn’t on a trip — fines &amp; awards belong to a trip.</div>}
        {tripId && ad.ready && open.length === 0 && <div className="small muted">No awards or fines on {trip?.name || 'this trip'} yet. Propose one in the trip’s run-up.</div>}
        {open.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">Which one</span>
            {open.map((x) => (
              <button key={x.key} type="button" className="btn ghost block" aria-pressed={pick === x.key} data-testid="fine-pick"
                style={{ justifyContent: 'space-between', ...(pick === x.key ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {}) }} onClick={() => setPick(x.key)}>
                <span>{KIND_ICON[x.kind]} {x.title}</span>{x.worth && <span className="small" style={{ fontWeight: 800 }}>{x.worth}</span>}
              </button>
            ))}
          </div>
        )}
        {item && (
          <>
            <label className="field"><span>Who</span>
              <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who" data-testid="fine-who">
                <option value="">Pick someone</option>
                {people.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
              </select>
            </label>
            {who && <div className="row small" style={{ gap: 6 }}><Avatar player={data.playersById[who]} size={24} /><span>{playerName(data.playersById[who])}</span></div>}
            {needs.photo && (post.photo_url ? <div className="small">📷 The post’s photo is the proof.</div> : <><span className="label">Photo (needed)</span><PhotoButtons onPick={setFile} picked={!!file} /></>)}
            {needs.time && <label className="field"><span>Time (needed)</span><input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} data-testid="fine-time" /></label>}
            {needs.number && <label className="field"><span>{item.terms.number_unit ? `How many (${item.terms.number_unit})` : 'The number'} (needed)</span><input className="input" inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d.]/g, ''))} data-testid="fine-number" /></label>}
            <label className="field"><span>Note (optional)</span><input className="input" value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not his ball on 7" data-testid="fine-note" /></label>
            <div className="small muted">{chipText({ kind: item.kind, title: item.title, worth: item.worth })} goes on the post, and into the vote when you get together.</div>
            <button type="button" className="btn gold block" disabled={busy || !ok} onClick={save} data-testid="fine-save">{item.kind === 'fine' ? 'Fine them' : 'Nominate them'}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ------------------------------------------------------------------ the leftover kitty
/** On the settle-up: "Leftover $85 → on the bar the last night (group rule)", and each person's share when it's split. */
export function LeftoverKitty({ pot, people = 0, money, rolledIn = null }) {
  const ad = useAwardsData(null);
  const line = leftoverLine(pot, ad.leftover, people, money);
  if (!line && !rolledIn) return null;
  return (
    <div className="card pad stack" style={{ gap: 4, borderColor: 'var(--gold)' }} data-testid="leftover-kitty">
      {rolledIn && <div className="small" data-testid="rolled-in">↪️ Starting balance: <strong>{money(rolledIn.amount)}</strong> rolled over from {rolledIn.from} (group rule — words only, check the kitty).</div>}
      {line && (
        <>
          <div style={{ fontWeight: 800 }}>💰 Leftover {money(pot)} → <RuleTag rule={{ table: 'rules', id: ad.leftover.id, field: 'value', label: 'Leftover kitty', value: ad.leftover.value, rule_id: ad.leftover.id }}
            explain="What happens to money left in the kitty at the end of a trip. Words only — no money moves in the app.">{line.words.charAt(0).toLowerCase() + line.words.slice(1)}</RuleTag> <span className="small muted">(group rule)</span></div>
          {line.share != null && <div className="small" data-testid="leftover-share">That’s <strong>{money(line.share)}</strong> back to each of the {people} who are in.</div>}
          {ad.leftover?.leftover === 'rollover' && <div className="small muted">It’ll show as the next trip’s starting balance.</div>}
        </>
      )}
    </div>
  );
}

/** The previous trip's leftover, when the group rule is "rolls over" (for the next trip's kitty). */
export function useRolledIn(plan, kittyOf) {
  const ad = useAwardsData(null);
  const [r, setR] = useState(null);
  const rollover = ad.leftover?.leftover === 'rollover';
  useEffect(() => {
    let live = true;
    if (!rollover || !plan?.start_date) { setR(null); return undefined; }
    (async () => {
      const { data: prev } = await supabase.from('plans').select('id,name,end_date,start_date,status').lt('end_date', plan.start_date).neq('status', 'cancelled').neq('id', plan.id)
        .order('end_date', { ascending: false }).limit(1);
      const p = prev?.[0];
      if (!p) { if (live) setR(null); return; }
      const by = (t) => supabase.from(t).select('*').eq('plan_id', p.id);
      const [c, pay, tr, rs] = await Promise.all([by('plan_costs'), by('plan_payments'), by('plan_transfers'), by('plan_rsvps')]);
      const inIds = (rs.data || []).filter((x) => x.status === 'in').map((x) => x.player_id);
      const pot = kittyOf(c.data || [], pay.data || [], inIds, tr.data || []).kitty;
      if (live) setR(pot >= 0.5 ? { amount: pot, from: p.name } : null);
    })().catch(() => {});
    return () => { live = false; };
  }, [rollover, plan?.id, plan?.start_date]); // eslint-disable-line react-hooks/exhaustive-deps
  return r;
}

