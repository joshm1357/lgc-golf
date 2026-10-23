// The Rulebook v3 (migration 076): layers of rules, "the rules for this round", the filter bar, comp-specific rules
// (scope + "⚠️ This changes…"), the AI's "tidy the wording", and the card that turns a Tribunal verdict into a rule
// change. All the logic is in lib/rulelayers.js; the AI runs in the ai-helper function (rules.ts), and nothing the AI
// says is written until an organiser confirms it.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { currentGroup } from '../lib/group.js';
import { useRun, must } from '../lib/run.js';
import { toast } from './ui.jsx';
import { fmtRange } from '../lib/plan.js';
import { useComps } from './CompsChip.jsx';
import { useRoundGames } from './GamesChip.jsx';
import { useCustomGames } from './CustomGames.jsx';
import { useOwnDefs } from '../screens/OwnComps.jsx';
import { STANDARD_SECTIONS, standardOptions, standardRule } from '../lib/standardrules.js';
import {
  roundContext, targetContext, everythingContext, effectiveRules, nameIndex, scopeLabel, scopeOptions, scopeFromValue, scopeValue,
  keywordConflicts, suggestOverride, chipTarget, filterChips, matchesSearch, overrideTitle,
} from '../lib/rulelayers.js';

const STANDARD_FOR_AI = STANDARD_SECTIONS.flatMap((s) => s.rules.map((r) => ({ id: r.id, title: `${s.title} — ${r.title}`, text: r.text })));

/** Everything the layers need: comps, trophies, rounds, games, custom games, side comps, trips. */
export function useRuleData() {
  const data = useData();
  const [comps] = useComps();
  const [games] = useRoundGames();
  const [customGames] = useCustomGames();
  const [ownDefs] = useOwnDefs();
  const sideOn = useFeature('side_comps');
  return useMemo(() => {
    const d = { comps, trophies: data?.trophies || [], rounds: data?.rounds || [], games, customGames, ownDefs: sideOn ? ownDefs : [], trips: data?.trips || [] };
    return { ...d, names: nameIndex(d) };
  }, [comps, data?.trophies, data?.rounds, data?.trips, games, customGames, ownDefs, sideOn]);
}

/** Call the ai-helper's Rulebook jobs. Returns the function's answer, or { error }. */
export async function askRulesAi(body) {
  try {
    const { data, error } = await supabase.functions.invoke('ai-helper', { body: { ...body, standard: STANDARD_FOR_AI, group_id: currentGroup() || undefined } });
    if (error) return { error: 'The Caddie didn’t answer — check your signal and try again.' };
    return data || { error: 'No answer' };
  } catch {
    return { error: 'The Caddie didn’t answer — check your signal and try again.' };
  }
}

// ------------------------------------------------------------------ the layered view

/** The rules that apply in a context, by layer; overridden ones struck through with "overridden by". */
export function EffectiveRules({ ctx, localRules, names, search = '', layers: only = null, empty = 'No rules match.' }) {
  const eff = useMemo(() => effectiveRules({ ctx, localRules, names }), [ctx, localRules, names]);
  const layers = eff.layers
    .filter((l) => !only || only.includes(l.key))
    .map((l) => ({ ...l, items: l.items.filter((i) => matchesSearch(i, search)) }))
    .filter((l) => l.items.length);
  if (!layers.length) return <div className="empty">{empty}</div>;
  return (
    <div className="stack" data-testid="effective-rules">
      {eff.overriddenCount > 0 && !only && <div className="small muted">Struck-through rules are changed by a more specific rule — the one that applies is named underneath.</div>}
      {/* Most specific first (what's special about today), the rules of golf folded away at the end. */}
      {(only ? layers : [...layers].reverse()).map((l) => {
        const list = l.items.map((i) => <EffectiveItem key={i.id} i={i} />);
        const changed = l.items.filter((i) => i.overriddenBy).length;
        if (l.key === 'golf' && !only && !search.trim()) {
          return (
            <details key={l.key} className="stack" data-testid={`layer-${l.key}`}>
              <summary className="label" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>{l.emoji} {l.title} ({l.items.length}{changed ? `, ${changed} changed` : ''}) — tap to open</summary>
              <div className="stack" style={{ gap: 6 }}>{list}</div>
            </details>
          );
        }
        return (
          <div key={l.key} className="stack" style={{ gap: 6 }} data-testid={`layer-${l.key}`}>
            <span className="label">{l.emoji} {l.title}</span>
            {list}
          </div>
        );
      })}
    </div>
  );
}

function EffectiveItem({ i }) {
  const over = !!i.overriddenBy;
  const body = (
    <>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <strong style={{ textDecoration: over ? 'line-through' : 'none', opacity: over ? 0.6 : 1 }}>{i.title}</strong>
        {i.value && <span className="small" style={{ padding: '1px 8px', borderRadius: 999, background: 'var(--gold-soft)', border: '1px solid var(--gold)', fontWeight: 800, flex: 'none' }}>{i.value}</span>}
      </div>
      {i.scope && <div className="small muted">{i.standard ? i.scope : `For: ${i.scope}`}</div>}
      {i.text && <div className="small" style={{ lineHeight: 1.45, textDecoration: over ? 'line-through' : 'none', opacity: over ? 0.6 : 1 }}>{i.text}</div>}
      {over && <div className="small" style={{ fontWeight: 700 }} data-testid="overridden-by">⚠️ Overridden by {i.overriddenBy.title}{i.overriddenBy.scope ? ` (${i.overriddenBy.scope})` : ''}</div>}
    </>
  );
  const style = { gap: 4, textAlign: 'left', color: 'inherit', textDecoration: 'none', width: '100%', background: over ? 'var(--ground, #F6F7F9)' : undefined };
  return i.standard
    ? <div className="card pad stack" style={style} data-testid={`eff-${i.id}`}>{body}</div>
    : <Link to={`/rules/${i.id}`} className="card pad stack" style={style} data-testid={`eff-${i.id}`}>{body}</Link>;
}

/** "The rules for this round" for a round id (the Rulebook's round view). */
export function RoundRules({ round, localRules, rd, search }) {
  const ctx = useMemo(() => roundContext(round, rd), [round, rd]);
  return <EffectiveRules ctx={ctx} localRules={localRules} names={rd.names} search={search} empty="No rules match for this round." />;
}

/** The view for a filter chip: a comp / game / format and the layers it inherits; or golf / formats only. */
export function TargetRules({ filter, localRules, rd, search }) {
  const ctx = useMemo(() => {
    if (filter === 'all') return everythingContext(rd);
    return targetContext(chipTarget(filter), rd);
  }, [filter, rd]);
  const only = filter === 'golf' ? ['golf'] : filter === 'formats' ? ['format'] : null;
  return <EffectiveRules ctx={ctx} localRules={localRules} names={rd.names} search={search} layers={only} />;
}

// ------------------------------------------------------------------ the filter bar

export function RulesFilterBar({ filter, onFilter, round, onRound, search, onSearch, rd }) {
  const [showRetired, setShowRetired] = useState(false);
  const chips = useMemo(() => filterChips(rd, { showRetired }), [rd, showRetired]);
  const hasRetired = useMemo(() => filterChips(rd, { showRetired: true }).some((c) => c.retired), [rd]);
  const rounds = [...(rd.rounds || [])].sort((a, b) => String(b.play_date || '').localeCompare(String(a.play_date || '')));
  const tripName = Object.fromEntries((rd.trips || []).map((t) => [t.id, t.name]));
  const sections = [['basics', null], ['formats', 'Formats'], ['comps', 'Comps & trophies'], ['games', 'Games'], ['side', 'Side comps']];
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="rules-filter">
      <input className="input" type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="🔎 Search the rules" aria-label="Search the rules" />
      <label className="field" style={{ margin: 0 }}><span className="small">The rules for a round</span>
        <select className="select" value={round || ''} onChange={(e) => onRound(e.target.value || null)} data-testid="round-picker">
          <option value="">— Pick a round —</option>
          {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}{r.play_date ? ` · ${fmtRange(r.play_date)}` : ''}{tripName[r.trip_id] ? ` · ${tripName[r.trip_id]}` : ''}</option>)}
        </select>
      </label>
      {!round && sections.map(([g, label]) => {
        const list = chips.filter((c) => c.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className="row" style={{ gap: 6, overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 2, scrollbarWidth: 'none' }} role="group" aria-label={label || 'Show'}>
            {label && <span className="small muted" style={{ flex: 'none', fontWeight: 700 }}>{label}</span>}
            {list.map((c) => (
              <button key={c.value} type="button" className="chip" aria-pressed={filter === c.value} onClick={() => onFilter(c.value)} style={{ opacity: c.retired ? 0.6 : 1 }}>{c.label}</button>
            ))}
          </div>
        );
      })}
      {!round && hasRetired && (
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired comps and games</label>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ on a rule's page

/** On a rule's page: what it's for and what it changes. */
export function RuleScopeLine({ rule, localRules = [] }) {
  const rd = useRuleData();
  const s = scopeLabel(rule, rd.names);
  const ch = rule?.overrides_rule ? overrideTitle(rule, localRules) : null;
  if (!s && !ch) return null;
  return <div className="small" data-testid="rule-scope">{s ? <>🏆 Just for <strong>{s}</strong>. </> : null}{ch ? <>Changes our rule: <strong>{ch}</strong>.</> : null}</div>;
}

// ------------------------------------------------------------------ writing a rule: scope, clashes, tidy

/**
 * In the rule sheet: "What's this rule for?", then any clashes with the layers below ("⚠️ This changes: …", ticked
 * for the best match; the organiser can untick), a "✨ Check with AI too" button, and "✨ Tidy the wording".
 * v / set: the sheet's draft row. localRules: the group's rules.
 */
export function RuleScopeFields({ v, set, localRules }) {
  const rd = useRuleData();
  const { status } = useSession();
  const aiOn = useFeature('ai_helper') && status.is_admin;
  const [touched, setTouched] = useState(false);
  const [aiConflicts, setAiConflicts] = useState(null);
  const [tidy, setTidy] = useState(null);
  const [busy, setBusy] = useState('');
  const opts = useMemo(() => scopeOptions(rd), [rd]);
  const value = scopeValue(v);
  const ctx = useMemo(() => targetContext(chipTarget(value), rd), [value, rd]);
  const kw = useMemo(() => keywordConflicts({ draft: { ...v, overrides: null, overrides_rule: null }, ctx, localRules, names: rd.names }), [v.title, v.detail, v.value, value, ctx, localRules, rd.names]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = useMemo(() => {
    const out = [...kw];
    for (const a of aiConflicts || []) if (!out.some((c) => c.id === a.id)) out.push({ ...a, ai: true });
    return out;
  }, [kw, aiConflicts]);
  // Tick the best match once (the organiser can untick it; we never re-tick after they touch it).
  useEffect(() => {
    if (touched || v.overrides || v.overrides_rule || !conflicts.length) return;
    const s = suggestOverride(conflicts);
    set((cur) => ({ ...cur, ...s }));
  }, [conflicts]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticked = (c) => (c.standard ? v.overrides === c.id : v.overrides_rule === c.id);
  const tick = (c, on) => {
    setTouched(true);
    set((cur) => (c.standard ? { ...cur, overrides: on ? c.id : null } : { ...cur, overrides_rule: on ? c.id : null }));
  };
  const checkAi = async () => {
    setBusy('check');
    const r = await askRulesAi({ mode: 'rules_conflicts', draft: { id: v.id, title: v.title, detail: v.detail, value: v.value, scope: value } });
    setBusy('');
    if (r.error) return toast(r.error);
    setAiConflicts(r.conflicts || []);
    if (!(r.conflicts || []).length) toast('The Caddie found no clashes');
  };
  const askTidy = async () => {
    setBusy('tidy');
    const r = await askRulesAi({ mode: 'rules_tidy', draft: { title: v.title, detail: v.detail, value: v.value } });
    setBusy('');
    if (r.error) return toast(r.error);
    setTidy(r.tidy);
  };
  const ownRule = v.overrides_rule && !conflicts.some((c) => c.id === v.overrides_rule) ? localRules.find((r) => r.id === v.overrides_rule) : null;
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="rule-scope-fields">
      <label className="field"><span>What’s this rule for?</span>
        <select className="select" value={value} onChange={(e) => { set((cur) => ({ ...cur, ...scopeFromValue(e.target.value) })); setAiConflicts(null); }} data-testid="scope-select">
          {['Everything', 'Formats', 'Comps and trophies', 'Games', 'Side comps'].map((g) => {
            const list = opts.filter((o) => o.group === g);
            if (!list.length) return null;
            return g === 'Everything' ? list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
              : <optgroup key={g} label={g}>{list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>;
          })}
        </select>
      </label>
      {value && <span className="small muted">Just for {scopeLabel(scopeFromValue(value), rd.names)} — it beats the general rules when they cover the same thing.</span>}
      {(conflicts.length > 0 || ownRule) && (
        <div className="card pad stack" style={{ gap: 6, borderColor: 'var(--gold)', background: 'var(--gold-soft)' }} data-testid="conflict-warning">
          {conflicts.map((c) => (
            <label key={c.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={ticked(c)} onChange={(e) => tick(c, e.target.checked)} style={{ marginTop: 4 }} />
              <span className="grow small"><strong>⚠️ This changes: {c.title}</strong>{c.scope ? ` (${c.scope})` : ''}<br /><span className="muted">{c.reason}{c.ai ? ' · the Caddie says' : ''}</span></span>
            </label>
          ))}
          {ownRule && <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked onChange={() => tick({ id: ownRule.id, standard: false }, false)} /> <strong>This changes: {ownRule.title}</strong></label>}
          <span className="small muted">Ticked = this rule replaces that one wherever both apply. Untick if they both still apply.</span>
        </div>
      )}
      {aiOn && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn ghost sm" disabled={!!busy || !(v.title || '').trim()} onClick={checkAi} data-testid="ai-check">{busy === 'check' ? 'Checking…' : '✨ Ask the Caddie to check for clashes'}</button>
          <button type="button" className="btn ghost sm" disabled={!!busy || !(v.title || '').trim()} onClick={askTidy} data-testid="ai-tidy">{busy === 'tidy' ? 'Tidying…' : '✨ Tidy the wording'}</button>
        </div>
      )}
      {tidy && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="tidy-suggestion">
          <span className="small muted">The Caddie suggests (check it says the same thing):</span>
          <strong>{tidy.title}</strong>
          {tidy.detail && <div className="small">{tidy.detail}</div>}
          {tidy.value && <div className="small">Worth: {tidy.value}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn gold sm" onClick={() => { set((cur) => ({ ...cur, title: tidy.title, detail: tidy.detail || cur.detail, value: tidy.value ?? cur.value })); setTidy(null); }}>Use this</button>
            <button type="button" className="btn ghost sm" onClick={() => setTidy(null)}>Keep mine</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The new columns for a rules row — only the ones set (or being cleared), so a database without 076 still works. */
export function scopeRow(v, before = null) {
  const row = {};
  for (const k of ['scope_kind', 'scope_id', 'scope_key', 'overrides_rule']) if (v[k] || before?.[k]) row[k] = v[k] || null;
  return row;
}

// ------------------------------------------------------------------ a verdict into the Rulebook

const RULE_CASES = ['new_rule', 'change_rule', 'ruling', 'scrap_rule'];
const draftKey = (id) => `tgt-verdict-draft-${id}`;
const readDraft = (id) => { try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch { return null; } };
const keepDraft = (id, d) => { try { localStorage.setItem(draftKey(id), JSON.stringify(d)); } catch { /* fine */ } };

/** The case's own words as a starting point (when the AI is off or fails). */
export function caseDraft(c, rule) {
  const p = c?.proposal || {};
  const ruling = c?.kind === 'ruling';
  return {
    action: ruling ? 'add' : 'change',
    rule_id: c?.rule_id || null,
    title: (ruling ? '' : p.title || rule?.title || '') || String(c?.title || '').replace(/^(Change|Scrap):\s*/, '').slice(0, 80),
    detail: (ruling ? c?.verdict || p.answer : p.detail ?? rule?.detail) || '',
    value: (ruling ? '' : p.value ?? rule?.value) || '',
    category: rule?.category || p.category || 'other',
    scope_kind: rule?.scope_kind || null, scope_id: rule?.scope_id || null, scope_key: rule?.scope_key || null,
    overrides: rule?.overrides || null, overrides_rule: rule?.overrides_rule || null,
    ai: false,
  };
}

/**
 * On a decided case: the exact rule change the verdict leads to, drafted by the AI ("AI drafted this from the
 * verdict — check it") or from the case's own words, for an organiser to check, edit and confirm. Confirming writes
 * it through apply_verdict_draft (the Rulebook's normal path, with the case in the rule's history).
 */
export function VerdictToRulebook({ c }) {
  const { status } = useSession();
  const aiOn = useFeature('ai_helper');
  const rd = useRuleData();
  const [rule, setRule] = useState(null);
  const [rules, setRules] = useState([]);
  const [d, setD] = useState(null);
  const [aiState, setAiState] = useState('');
  const [busy, run] = useRun();
  const show = status.is_admin && c && c.status === 'passed' && RULE_CASES.includes(c.kind) && !c.proposal?.draft_applied_at;
  useEffect(() => {
    if (!show || c.kind === 'scrap_rule') return;
    let live = true;
    (async () => {
      const { data: rs } = await supabase.from('rules').select('*').in('status', ['active', 'proposed']).order('sort');
      const list = rs || [];
      const mine = c.rule_id ? (list.find((r) => r.id === c.rule_id) || (await supabase.from('rules').select('*').eq('id', c.rule_id)).data?.[0] || null) : null;
      if (!live) return;
      setRules(list); setRule(mine);
      const kept = readDraft(c.id);
      if (kept) { setD(kept); return; }
      const base = caseDraft(c, mine);
      if (!aiOn) { setD(base); return; }
      setAiState('working');
      const r = await askRulesAi({ mode: 'rules_draft', case_id: c.id });
      if (!live) return;
      if (r.draft && r.draft.action !== 'none') {
        const next = { ...base, ...r.draft, value: r.draft.value || '', ai: true };
        setD(next); keepDraft(c.id, next); setAiState('done');
      } else { setD(base); setAiState(r.error ? 'failed' : 'done'); }
    })();
    return () => { live = false; };
  }, [show, c?.id, aiOn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  if (c.kind === 'scrap_rule') return <div className="small muted" data-testid="verdict-rulebook">📘 The verdict retires the rule{c.apply_state === 'applied' ? '' : ' when the change starts'} — nothing more to write.</div>;
  if (!d) return <div className="card pad small muted" data-testid="verdict-rulebook">{aiState === 'working' ? '✨ The Caddie is drafting the rule change from the verdict…' : 'Getting the rule ready…'}</div>;
  const f = (k) => ({ value: d[k] ?? '', onChange: (e) => setD({ ...d, [k]: e.target.value }) });
  const confirm = () => run(async () => {
    const draft = { action: d.action, rule_id: d.rule_id, title: d.title.trim(), detail: (d.detail || '').trim(), value: (d.value || '').trim(), category: d.category,
      scope_kind: d.scope_kind, scope_id: d.scope_id, scope_key: d.scope_key, overrides: d.overrides || null, overrides_rule: d.overrides_rule || null, ai: !!d.ai };
    await must(supabase.rpc('apply_verdict_draft', { p_case: c.id, p_draft: draft }));
    try { localStorage.removeItem(draftKey(c.id)); } catch { /* fine */ }
  }, 'It’s in the Rulebook');
  const waiting = c.kind === 'change_rule' && ['waiting_next_trip', 'next_round'].includes(c.apply_state);
  const local = rules.filter((r) => r.status === 'active' && r.id !== d.rule_id);
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)' }} data-testid="verdict-rulebook">
      <strong>📘 Into the Rulebook</strong>
      <div className="small" data-testid="draft-source" style={{ fontWeight: 700 }}>{d.ai ? '✨ The Caddie drafted this from the verdict — check it' : aiState === 'failed' ? 'The Caddie couldn’t draft it — here’s the case’s own wording to start from.' : 'Here’s the case’s own wording to start from — check it.'}</div>
      {d.note && <div className="small muted">{d.note}</div>}
      {c.kind === 'ruling' && (
        <div className="seg light" role="group">
          <button type="button" aria-pressed={d.action === 'add'} onClick={() => setD({ ...d, action: 'add' })}>Add as a new rule</button>
          {rule && <button type="button" aria-pressed={d.action === 'change'} onClick={() => setD({ ...d, action: 'change', rule_id: rule.id })}>Reword “{rule.title}”</button>}
        </div>
      )}
      <label className="field"><span>Rule</span><input className="input" {...f('title')} data-testid="draft-title" /></label>
      <label className="field"><span>Wording</span><textarea className="textarea" rows={4} style={{ padding: 12 }} {...f('detail')} data-testid="draft-detail" /></label>
      <label className="field"><span>Worth / amount (optional)</span><input className="input" {...f('value')} /></label>
      <label className="field"><span>What’s it for?</span>
        <select className="select" value={scopeValue(d)} onChange={(e) => setD({ ...d, ...scopeFromValue(e.target.value) })} data-testid="draft-scope">
          {scopeOptions(rd).map((o) => <option key={o.value} value={o.value}>{o.group === 'Everything' ? o.label : `${o.group}: ${o.label}`}</option>)}
        </select>
      </label>
      <label className="field"><span>What it changes (optional)</span>
        <select className="select" value={d.overrides_rule ? `r:${d.overrides_rule}` : d.overrides ? `s:${d.overrides}` : ''} data-testid="draft-overrides"
          onChange={(e) => { const [k, id] = e.target.value.split(/:(.*)/s); setD({ ...d, overrides: k === 's' ? id : null, overrides_rule: k === 'r' ? id : null }); }}>
          <option value="">Nothing — it’s an extra rule</option>
          <optgroup label="Our rules">{local.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.title}</option>)}</optgroup>
          <optgroup label="Standard rules">{standardOptions().map((o) => <option key={o.id} value={`s:${o.id}`}>{o.label}</option>)}</optgroup>
        </select>
      </label>
      {d.overrides && standardRule(d.overrides) && <span className="small">⚠️ This changes: {standardRule(d.overrides).title}</span>}
      {waiting && <span className="small muted">The change starts {c.apply_state === 'next_round' ? 'from the next round' : 'next trip'} — this wording goes in then.</span>}
      <button type="button" className="btn gold block" disabled={busy || (d.title || '').trim().length < 3} onClick={confirm} data-testid="draft-confirm">✅ Write it into the Rulebook</button>
    </div>
  );
}

/** A rule's scope next to its title ("🏆 BD Trophy"). */
export function ScopeBadge({ rule, names }) {
  const s = scopeLabel(rule, names);
  if (!s) return null;
  return <span className="small" data-testid="scope-badge" style={{ padding: '2px 10px', borderRadius: 999, background: '#E7EEF8', border: '1px solid var(--navy)', fontWeight: 700 }}>🏆 {s}</span>;
}
