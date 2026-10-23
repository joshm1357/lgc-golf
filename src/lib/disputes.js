// Disputes (migration 082): any value that's a rule — a side comp "worth 2 strokes", minimum drives, a game's stake,
// Cup points, a team handicap, today's rules, a standard rule like countback — can be tapped and disputed. A dispute is
// a 'ruling' case that also records what was disputed (cases.subject_kind / subject_ref). Pure functions only; the
// chip and sheet are in components/RuleTag.jsx, the database decides (raise_dispute).

/** What can be disputed, by table → fields. Same list as private.dispute_fields in 082 (+ players.handicap, 087). Scores and names never. */
export const DISPUTABLE = {
  rounds: ['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps', 'drive_penalty'],
  teams: ['handicap'],
  players: ['handicap'], // 087 (ov15): a player's handicap, from the players list
  round_games: ['stake', 'options', 'settings'],
  cup_matches: ['points', 'a_hcp', 'b_hcp'],
  trips: ['cup_points'],
  comps: ['settings'],
  side_comp_defs: ['how', 'unit', 'scoring', 'settings', 'conditions'],
  trophies: ['description'],
  custom_games: ['rules_text', 'settings'],
  rules: ['value', 'title', 'detail', 'late_strokes', 'late_days', 'breach_strokes', 'drives_2', 'drives_3', 'drives_4'],
  score_adjustments: ['strokes'],
  dinner_award_nominations: ['player_id'], // 093: appeal a fine or award from the Feed ("who's fined")
  standard: ['rule'],
};

/** Plain words for where a value comes from. */
export const SOURCE = {
  rounds: 'Round setting', teams: 'Team setting', players: 'Player handicap (set by an organiser)', round_games: 'Game setting', cup_matches: 'Cup match setting',
  trips: 'Trip setting', comps: 'Comp setting', side_comp_defs: 'Side comp setting', trophies: 'Trophy rule',
  custom_games: 'Game rules', rules: 'Rulebook rule', standard: 'Standard rule (built into the app)',
  score_adjustments: 'Penalty on the scorecard',
  dinner_award_nominations: 'A fine or award from the Feed',
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
  if (!tribunalOn || !rulingOn) return { ...base, state: 'off', why: 'Disputes need the Tribunal and rule challenges switched on (Players & group → Features).' };
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

// ------------------------------------------------------------------ applying an upheld verdict (migration 084)
// The settings an organiser can change straight from the case, with the same limits as the database
// (private.dispute_value). Anything else (whole settings objects, Rulebook rules, standard rules) is changed where it's set.
const NUM = (min, max, { whole = false, cents = false, blank = false, msg } = {}) => ({ type: 'number', min, max, whole, cents, blank, msg });
const WORDS = (max, { oneOf = null, msg } = {}) => ({ type: 'words', max, oneOf, msg });
export const APPLY_SPEC = {
  'rounds.comp_bonus': NUM(0, 10, { whole: true, msg: 'Side comp strokes: a whole number from 0 to 10' }),
  'rounds.min_drives': NUM(0, 9, { whole: true, blank: true, msg: 'Minimum drives: a whole number from 0 to 9' }),
  'teams.handicap': NUM(-10, 54, { msg: 'A team handicap is between −10 and 54' }),
  'players.handicap': NUM(-10, 54, { msg: 'A handicap is between −10 and 54' }),
  'round_games.stake': NUM(0, 1000, { cents: true, msg: 'A stake is dollars and cents, up to $1000' }),
  'cup_matches.points': NUM(0.01, 10, { msg: 'A match is worth more than 0 and up to 10 points' }),
  'cup_matches.a_hcp': NUM(-10, 54, { msg: 'A handicap is between −10 and 54' }),
  'cup_matches.b_hcp': NUM(-10, 54, { msg: 'A handicap is between −10 and 54' }),
  'trips.cup_points': NUM(0, 200, { blank: true, msg: 'The Cup is worth 0 to 200 points' }),
  'rounds.ctp_holes': { type: 'holes' },
  'rounds.ld_holes': { type: 'holes' },
  'rounds.rules': WORDS(1000),
  'side_comp_defs.how': WORDS(12, { oneOf: ['lowest', 'highest', 'pick'], msg: 'How it’s won: lowest, highest or pick' }),
  'side_comp_defs.unit': WORDS(12),
  'trophies.description': WORDS(500),
  'custom_games.rules_text': WORDS(2000),
  // Late organising jobs (085): the rule's two numbers, and one player's penalty (0 takes it off).
  'rules.late_strokes': NUM(0, 10, { whole: true, msg: 'Late job strokes: a whole number from 0 to 10' }),
  'rules.late_days': NUM(0, 60, { whole: true, msg: 'Days late: a whole number from 0 to 60' }),
  // 099: a penalty can be negative (strokes off); a rule's penalty, the drives numbers and a round's drive penalty.
  'score_adjustments.strokes': NUM(-20, 20, { whole: true, msg: 'Penalty strokes: a whole number from −20 to 20' }),
  'rules.breach_strokes': NUM(0, 10, { whole: true, msg: 'Penalty strokes: a whole number from 0 to 10' }),
  'rules.drives_2': NUM(0, 9, { whole: true, msg: 'Drives each: a whole number from 0 to 9' }),
  'rules.drives_3': NUM(0, 9, { whole: true, msg: 'Drives each: a whole number from 0 to 9' }),
  'rules.drives_4': NUM(0, 9, { whole: true, msg: 'Drives each: a whole number from 0 to 9' }),
  'rounds.drive_penalty': NUM(0, 10, { whole: true, blank: true, msg: 'Strokes per drive short: a whole number from 0 to 10' }),
};
/** The Rulebook numbers an upheld verdict can set in one tap (085 + 099). */
export const RULE_NUMBERS = ['late_strokes', 'late_days', 'breach_strokes', 'drives_2', 'drives_3', 'drives_4'];
export function applySpec(ref) {
  if (!ref || ref.key) return null;
  return APPLY_SPEC[`${ref.table}.${ref.field}`] || null;
}

/** Can this person apply this case's verdict to the setting now? (Organisers; an upheld dispute about a setting; once.) */
export function canApplyVerdict(c, role) {
  const lateNumbers = c?.subject_kind === 'rule' && c?.subject_ref?.table === 'rules' && RULE_NUMBERS.includes(c?.subject_ref?.field);
  return !!c && role === 'organiser' && c.kind === 'ruling' && (c.subject_kind === 'setting' || lateNumbers) && c.status === 'passed'
    && !c.setting_applied_at && !!applySpec(c.subject_ref);
}

/** Typed words → the value to send, or an error. */
export function parseApplyValue(ref, text) {
  const spec = applySpec(ref);
  if (!spec) return { ok: false, error: 'Change this one where it’s set' };
  const t = String(text ?? '').trim();
  if (spec.type === 'number') {
    if (!t && spec.blank) return { ok: true, value: null };
    const m = t.replace(/[$,\s]/g, '').replace('−', '-').match(/^-?\d+(\.\d+)?$/);
    const n = m ? Number(m[0]) : NaN;
    if (!Number.isFinite(n) || n < spec.min || n > spec.max || (spec.whole && !Number.isInteger(n))
      || (spec.cents && Math.abs(Math.round(n * 100) - n * 100) > 1e-9)) return { ok: false, error: spec.msg || 'That needs to be a number' };
    return { ok: true, value: n };
  }
  if (spec.type === 'holes') {
    const parts = t.split(/[\s,]+/).filter(Boolean);
    if (parts.some((p) => !/^([1-9]|1[0-8])$/.test(p))) return { ok: false, error: 'Holes are 1 to 18, e.g. 6, 15' };
    return { ok: true, value: [...new Set(parts.map(Number))].sort((a, b) => a - b) };
  }
  if (spec.oneOf && !spec.oneOf.includes(t)) return { ok: false, error: spec.msg };
  if (t.length > spec.max) return { ok: false, error: `Up to ${spec.max} letters` };
  return { ok: true, value: t || null };
}

/** A starting value from the case's "What it should be" ("1 stroke, not 2" → 1; "6 and 15" → "6, 15"). */
export function suggestedValue(c) {
  const spec = applySpec(c?.subject_ref);
  const a = String(c?.proposal?.answer || '').trim();
  if (!spec || !a) return '';
  if (spec.type === 'number') { const m = a.replace('−', '-').match(/-?\d+(\.\d+)?/); return m ? m[0] : ''; }
  if (spec.type === 'holes') return (a.match(/\b([1-9]|1[0-8])\b/g) || []).join(', ');
  if (spec.oneOf) return spec.oneOf.find((o) => a.toLowerCase().includes(o)) || '';
  return a;
}

/** "Applied by Josh, 2:41 pm: 2 → 1". */
export function appliedLine(c, name) {
  if (!c?.setting_applied_at) return null;
  const ch = c.setting_change || {};
  const time = new Date(c.setting_applied_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  return `Applied by ${name || 'an organiser'}, ${time}: ${valueWords(ch.old)} → ${valueWords(ch.new)}`;
}
