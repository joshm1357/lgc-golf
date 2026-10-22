// Disputes (migration 082): any value that's a rule — a side comp "worth 2 strokes", minimum drives, a game's stake,
// Cup points, a team handicap, today's rules, a standard rule like countback — can be tapped and disputed. A dispute is
// a 'ruling' case that also records what was disputed (cases.subject_kind / subject_ref). Pure functions only; the
// chip and sheet are in components/RuleTag.jsx, the database decides (raise_dispute).

/** What can be disputed, by table → fields. Same list as private.dispute_fields in 082. Scores and names never. */
export const DISPUTABLE = {
  rounds: ['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps'],
  teams: ['handicap'],
  round_games: ['stake', 'options', 'settings'],
  cup_matches: ['points', 'a_hcp', 'b_hcp'],
  trips: ['cup_points'],
  comps: ['settings'],
  side_comp_defs: ['how', 'unit', 'scoring', 'settings', 'conditions'],
  trophies: ['description'],
  custom_games: ['rules_text', 'settings'],
  rules: ['value', 'title', 'detail'],
  standard: ['rule'],
};

/** Plain words for where a value comes from. */
export const SOURCE = {
  rounds: 'Round setting', teams: 'Team setting', round_games: 'Game setting', cup_matches: 'Cup match setting',
  trips: 'Trip setting', comps: 'Comp setting', side_comp_defs: 'Side comp setting', trophies: 'Trophy rule',
  custom_games: 'Game rules', rules: 'Rulebook rule', standard: 'Standard rule (built into the app)',
};

/** Is this reference something that can be disputed at all? */
export function isDisputable(ref) {
  if (!ref || typeof ref !== 'object') return false;
  const fields = DISPUTABLE[ref.table];
  if (!fields || !fields.includes(ref.field)) return false;
  if (ref.table === 'standard') return !!ref.key && /^[a-z0-9_.-]{1,60}$/.test(ref.key);
  return typeof ref.id === 'string' && UUID.test(ref.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Rulebook rule a round setting comes from, if any (same matching as "Apply from the Rulebook", lib/plan.js):
 * comp_bonus ← a side comp rule worth "N strokes"; min_drives ← a rule about "N drives" (Ambrose).
 */
export function ruleForSetting(rules = [], format, field) {
  const applies = (rules || []).filter((r) => r.status === 'active' && (r.applies_to || []).some((a) => a === 'all' || a === format));
  if (field === 'comp_bonus') return applies.find((r) => r.category === 'side_comp' && /(\d+)\s*stroke/i.test(String(r.value || ''))) || null;
  if (field === 'min_drives' && format === 'ambrose') return applies.find((r) => /(\d+)\s*drive/i.test(`${r.value || ''} ${r.title || ''}`)) || null;
  return null;
}

/** One key per "thing" (table + row + field + sub-key) — the database's one-open-dispute-per-person key. */
export function refKey(ref) {
  if (!ref) return '';
  return [ref.table, ref.id || '', ref.field, ref.key || ''].join('|');
}

/** Open dispute cases about this thing (or, for a rule-backed value, any open case on that rule). */
export function openCasesFor(ref, cases = []) {
  if (!ref) return [];
  const k = refKey(ref);
  const ruleId = ref.table === 'rules' ? ref.id : ref.rule_id;
  return cases.filter((c) => c.status === 'open'
    && ((c.subject_ref && refKey(c.subject_ref) === k) || (ruleId && c.rule_id === ruleId)));
}

/**
 * What the sheet shows for this person:
 *   { canView, canDispute, state, mine, other, why }
 * state: 'off' (Tribunal / rule challenges off) | 'guest' | 'not_allowed' (organisers only raise) | 'mine' (you've
 * already raised it) | 'open' (someone else has — see the case) | 'ok' (you can dispute it) | 'invalid'.
 * The explanation is always shown; only the Dispute button depends on this.
 */
export function disputeState({ ref, cases = [], me = null, role = null, tribunalOn = false, rulingOn = false, canRaiseRuling = true } = {}) {
  const open = openCasesFor(ref, cases);
  const mine = open.find((c) => me && c.raised_by === me) || null;
  const other = open.find((c) => c !== mine) || null;
  const base = { canView: true, canDispute: false, mine, other, underDispute: open.length > 0 };
  if (!isDisputable(ref)) return { ...base, state: 'invalid', why: 'This can’t be disputed.' };
  if (!tribunalOn || !rulingOn) return { ...base, state: 'off', why: 'Disputes need the Tribunal and rule challenges switched on (Group & invites → Features).' };
  if (!role || role === 'guest') return { ...base, state: 'guest', why: 'Guests can see the rule but can’t dispute it.' };
  if (mine) return { ...base, state: 'mine', why: 'You’ve already raised this — see the case.' };
  if (other) return { ...base, state: 'open', why: 'It’s already before the Tribunal — have your say in the hearing.' };
  if (!canRaiseRuling) return { ...base, state: 'not_allowed', why: 'In your group only organisers raise these.' };
  return { ...base, state: 'ok', canDispute: true, why: '' };
}

/** A short case title from what was tapped: Is “Worth 2 strokes” right? (3–140 letters). */
export function disputeTitle(label) {
  const l = String(label || 'this rule').replace(/\s+/g, ' ').trim();
  const cut = l.length > 110 ? `${l.slice(0, 107)}…` : l;
  return `Is “${cut}” right?`;
}

/** A value as plain words (numbers, lists of holes, on/off). */
export function valueWords(v) {
  if (v == null || v === '') return 'not set';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') {
    const parts = Object.entries(v).filter(([, x]) => x != null && typeof x !== 'object').map(([k, x]) => `${k.replace(/_/g, ' ')}: ${valueWords(x)}`);
    return parts.length ? parts.join(' · ') : 'set';
  }
  return String(v);
}

/** The reference sent to raise_dispute (only the keys the database reads). */
export function refForServer(ref) {
  const out = { table: ref.table, field: ref.field };
  if (ref.id) out.id = ref.id;
  if (ref.key) out.key = ref.key;
  if (ref.rule_id) out.rule_id = ref.rule_id;
  if (ref.label) out.label = String(ref.label).slice(0, 120);
  if (ref.table === 'standard' && ref.value != null) out.value = String(ref.value).slice(0, 200);
  if (ref.where) out.where = ref.where;
  return out;
}

/** "Disputed: …" line for a case's hearing page. */
export function subjectLine(c) {
  const r = c?.subject_ref;
  if (!r) return null;
  return { label: r.label || `${SOURCE[r.table] || 'Setting'}`, source: SOURCE[r.table] || 'Setting', value: valueWords(r.value), path: r.where?.path || null, ruleId: r.rule_id || (r.table === 'rules' ? r.id : null) };
}
