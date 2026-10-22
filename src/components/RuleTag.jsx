// Tap a rule to see it and dispute it (migration 082). <RuleTag rule={ref} explain="…">Worth 2 strokes</RuleTag>
// shows the value as normal text with a faint dotted underline. Tap: what the rule says, where it comes from (Rulebook
// rule / comp / round setting, who set it, when), a link to the Rulebook, and "⚖️ Dispute this" → the Tribunal's
// raise-a-case sheet, filled in. While a case about it is open the chip shows ⚖️ ("Under dispute").
// The rules about who may dispute are in lib/disputes.js; the database decides (raise_dispute).
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useFeature, useData, playerName } from '../lib/store.jsx';
import { currentGroup } from '../lib/group.js';
import { Sheet } from './ui.jsx';
import { disputeState, openCasesFor, isDisputable, SOURCE, valueWords, ruleForSetting } from '../lib/disputes.js';

// ------------------------------------------------------------------ open disputes, shared by every chip on screen
// One small query and one realtime channel however many chips there are.
const store = { rows: [], subs: new Set(), ch: null, timer: null, loading: false };
async function loadOpen() {
  if (store.loading) return;
  store.loading = true;
  try {
    const { data, error } = await supabase.from('cases').select('id,status,rule_id,raised_by,subject_kind,subject_ref,title').eq('status', 'open');
    // An older database (no subject_ref yet): fall back to rule cases only.
    if (error) {
      const r = await supabase.from('cases').select('id,status,rule_id,raised_by,title').eq('status', 'open');
      store.rows = r.data || [];
    } else store.rows = data || [];
  } catch { /* no signal: keep what we had */ }
  store.loading = false;
  store.subs.forEach((f) => f());
}
function subscribe(f) {
  store.subs.add(f);
  if (store.subs.size === 1) {
    loadOpen();
    try {
      const g = currentGroup();
      store.ch = supabase.channel(`rt-disputes-${Math.random().toString(36).slice(2, 7)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cases', ...(g ? { filter: `group_id=eq.${g}` } : {}) }, () => {
          clearTimeout(store.timer);
          store.timer = setTimeout(loadOpen, 250);
        });
      store.ch.subscribe();
    } catch { store.ch = null; }
  }
  return () => {
    store.subs.delete(f);
    if (!store.subs.size && store.ch) { supabase.removeChannel(store.ch); store.ch = null; }
  };
}
/** Open cases (for "Under dispute" and "already raised"), live. */
export function useOpenDisputes() {
  return useSyncExternalStore(subscribe, () => store.rows, () => store.rows);
}
/** Refresh after raising one (the realtime event does it too). */
export function refreshDisputes() { return loadOpen(); }

// The group's rules in force (to link a round setting to the Rulebook rule it came from). Fetched once per screen.
let rulesCache = { at: 0, rows: [] };
export function useActiveRules() {
  const [rows, setRows] = useState(rulesCache.rows);
  useEffect(() => {
    if (Date.now() - rulesCache.at < 60000) return;
    supabase.from('rules').select('id,title,value,category,applies_to,status').eq('status', 'active').then(({ data: r }) => {
      rulesCache = { at: Date.now(), rows: r || [] };
      setRows(rulesCache.rows);
    }, () => {});
  }, []);
  return rows;
}

/** A RuleTag reference for one of a round's settings, linked to its Rulebook rule when there is one. */
export function roundRef(round, field, label, rules = []) {
  if (!round) return null;
  const rule = ruleForSetting(rules, round.format, field);
  return {
    table: 'rounds', id: round.id, field, label, value: round[field], rule_id: rule?.id,
    where: { round_id: round.id, ...(round.trip_id ? { trip_id: round.trip_id } : {}) },
  };
}

// ------------------------------------------------------------------ the chip
export default function RuleTag({ rule, explain, setBy, setAt, children, style, testId }) {
  const [open, setOpen] = useState(false);
  const cases = useOpenDisputes();
  if (!rule || !isDisputable(rule)) return <>{children ?? rule?.label}</>;
  const under = openCasesFor(rule, cases).length > 0;
  return (
    <>
      <button type="button" className={`rule-tag${under ? ' disputed' : ''}`} style={style} data-testid={testId || 'rule-tag'}
        aria-label={`${rule.label || 'This rule'}${under ? ' (under dispute)' : ''} — tap to see the rule or dispute it`}
        title={under ? 'Under dispute — tap to see' : 'Tap to see the rule or dispute it'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
        {children ?? rule.label}{under && <span className="rule-tag-flag" aria-hidden="true"> ⚖️</span>}
      </button>
      {/* In a portal (so it doesn't pick up the bold/link styling around the chip); clicks stop here, so a row or card
          the chip sits in doesn't also react. */}
      {open && createPortal(
        <div onClick={(e) => e.stopPropagation()}><RuleSheet rule={rule} explain={explain} setBy={setBy} setAt={setAt} onClose={() => setOpen(false)} /></div>,
        document.body,
      )}
    </>
  );
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// ------------------------------------------------------------------ the sheet
function RuleSheet({ rule, explain, setBy, setAt, onClose }) {
  const { status } = useSession();
  const data = useData();
  const cases = useOpenDisputes();
  const tribunalOn = useFeature('tribunal');
  const challengesOn = useFeature('rule_challenges');
  const votingOn = useFeature('rule_voting');
  const rulingOn = challengesOn && votingOn;
  const [raising, setRaising] = useState(false);
  const [raiseBy, setRaiseBy] = useState(null); // the group's "who may raise a ruling" (loaded when the sheet opens)
  useEffect(() => {
    if (!tribunalOn) return;
    supabase.from('governance_settings').select('kind,raise_by').eq('kind', 'ruling')
      .then(({ data: r }) => setRaiseBy((r || [])[0]?.raise_by || 'players'), () => setRaiseBy('players'));
  }, [tribunalOn]);
  const st = disputeState({
    ref: rule, cases, me: status?.player_id, role: status?.role, tribunalOn, rulingOn,
    canRaiseRuling: raiseBy !== 'organisers' || status?.role === 'organiser',
  });
  const ruleId = rule.table === 'rules' ? rule.id : rule.rule_id;
  const who = setBy ? (typeof setBy === 'string' ? data.playersById?.[setBy] : setBy) : null;
  const seen = st.mine || st.other;
  return (
    <>
      <Sheet title="The rule" onClose={onClose}>
        <div className="stack" data-testid="rule-sheet">
          <div className="card pad stack" style={{ gap: 6 }}>
            <strong style={{ fontSize: 18 }}>{rule.label}</strong>
            {explain && <div style={{ fontSize: 15, lineHeight: 1.45 }}>{explain}</div>}
            <div className="small muted">
              {SOURCE[rule.table] || 'Setting'}
              {rule.table !== 'standard' && rule.value !== undefined ? ` · now: ${valueWords(rule.value)}` : ''}
              {who ? ` · set by ${playerName(who)}` : ''}
              {setAt ? ` · ${fmtDate(setAt)}` : ''}
            </div>
            {ruleId && <Link to={`/rules/${ruleId}`} className="small" onClick={onClose}>See it in the Rulebook →</Link>}
            {!ruleId && rule.table !== 'standard' && <span className="small muted">Not in the Rulebook — it’s a setting. A dispute is about this setting.</span>}
          </div>
          {st.underDispute && <div className="small" data-testid="under-dispute" style={{ fontWeight: 700 }}>⚖️ Under dispute</div>}
          {seen && (
            <Link to={`/tribunal/case/${seen.id}`} className="card pad" style={{ color: 'inherit', textDecoration: 'none', borderColor: 'var(--gold)' }} onClick={onClose}>
              <strong>{st.state === 'mine' ? 'You’ve already raised this — see the case' : `Before the Tribunal: ${seen.title}`}</strong>
              <div className="small muted">Tap to see the hearing{st.state === 'open' ? ' and have your say' : ''}</div>
            </Link>
          )}
          {st.canDispute && (
            <button type="button" className="btn gold block" data-testid="dispute-this" onClick={() => setRaising(true)}>⚖️ Dispute this</button>
          )}
          {!st.canDispute && !seen && st.why && <div className="small muted">{st.why}</div>}
          <div className="small muted">A dispute never changes anything by itself. If the verdict says change it, an organiser makes the change.</div>
        </div>
      </Sheet>
      {raising && <LazyRaise rule={rule} explain={explain} onClose={() => { setRaising(false); onClose(); }} />}
    </>
  );
}

// The Tribunal's raise-a-case sheet (Cases.jsx is a big screen: only loaded when someone actually disputes).
function LazyRaise(props) {
  const [mod, setMod] = useState(null);
  useEffect(() => { import('../screens/Cases.jsx').then(setMod); }, []);
  if (!mod) return null;
  return <RaiseWithGov mod={mod} {...props} />;
}
function RaiseWithGov({ mod, rule, explain, onClose }) {
  const g = mod.useGovernance();
  if (!g) return null;
  if (!g.ok) return null;
  return <mod.RaiseCase g={g} dispute={{ ...rule, explain }} onClose={onClose} />;
}
