import { describe, it, expect } from 'vitest';
import {
  isDisputable, refKey, openCasesFor, disputeState, disputeTitle, valueWords, refForServer, subjectLine, ruleForSetting, DISPUTABLE,
  canApplyVerdict, parseApplyValue, suggestedValue, appliedLine, applySpec,
} from './disputes.js';

const R = '00000000-0000-4000-8000-0000000d0c03';
const RULE = '00000000-0000-4000-8000-0000000d0c04';
const ME = 'me-player';
const bonus = { table: 'rounds', id: R, field: 'comp_bonus', label: 'Worth 2 strokes', value: 2 };
const on = { tribunalOn: true, rulingOn: true, role: 'player', me: ME };

describe('what can be disputed', () => {
  it('round settings, stakes, Cup points, rules and standard rules', () => {
    expect(isDisputable(bonus)).toBe(true);
    expect(isDisputable({ table: 'round_games', id: R, field: 'stake' })).toBe(true);
    expect(isDisputable({ table: 'cup_matches', id: R, field: 'points' })).toBe(true);
    expect(isDisputable({ table: 'rules', id: RULE, field: 'value' })).toBe(true);
    expect(isDisputable({ table: 'standard', field: 'rule', key: 'stableford.tie_break' })).toBe(true);
  });
  it('never scores or names, never an unknown table, never a stand-in id', () => {
    expect(isDisputable({ table: 'scores', id: R, field: 'strokes' })).toBe(false);
    expect(isDisputable({ table: 'rounds', id: R, field: 'name' })).toBe(false);
    expect(isDisputable({ table: 'players', id: R, field: 'name' })).toBe(false);
    expect(isDisputable({ table: 'comps', id: 'trophy:abc', field: 'settings' })).toBe(false);
    expect(isDisputable({ table: 'standard', field: 'rule' })).toBe(false);
    expect(isDisputable({ table: 'standard', field: 'rule', key: 'Bad Key!' })).toBe(false);
    expect(isDisputable(null)).toBe(false);
  });
  it('matches the database list (082) — no scores anywhere', () => {
    expect(Object.keys(DISPUTABLE)).not.toContain('scores');
    expect(DISPUTABLE.rounds).toContain('comp_bonus');
  });
});

describe('open disputes', () => {
  const mine = { id: 'c1', status: 'open', raised_by: ME, subject_ref: { table: 'rounds', id: R, field: 'comp_bonus' } };
  const theirs = { id: 'c2', status: 'open', raised_by: 'other', subject_ref: { table: 'rounds', id: R, field: 'comp_bonus' } };
  const closed = { ...mine, id: 'c3', status: 'passed' };
  const ruleCase = { id: 'c4', status: 'open', raised_by: 'other', rule_id: RULE, kind: 'change_rule' };

  it('same thing = same table, row, field and key', () => {
    expect(refKey(bonus)).toBe(refKey({ table: 'rounds', id: R, field: 'comp_bonus', label: 'x' }));
    expect(refKey(bonus)).not.toBe(refKey({ table: 'rounds', id: R, field: 'min_drives' }));
  });
  it('closed cases don’t count; a rule-backed value counts any open case on its rule', () => {
    expect(openCasesFor(bonus, [closed])).toEqual([]);
    expect(openCasesFor({ ...bonus, rule_id: RULE }, [ruleCase])).toEqual([ruleCase]);
    expect(openCasesFor(bonus, [ruleCase])).toEqual([]);
  });
  it('can dispute when the Tribunal is on and nothing is open', () => {
    const s = disputeState({ ref: bonus, cases: [], ...on });
    expect(s.state).toBe('ok');
    expect(s.canDispute).toBe(true);
    expect(s.underDispute).toBe(false);
  });
  it('already raised by me → “You’ve already raised this — see the case”', () => {
    const s = disputeState({ ref: bonus, cases: [mine], ...on });
    expect(s.state).toBe('mine');
    expect(s.canDispute).toBe(false);
    expect(s.mine).toBe(mine);
    expect(s.why).toMatch(/already raised this/);
    expect(s.underDispute).toBe(true);
  });
  it('raised by someone else → see the case, have your say', () => {
    const s = disputeState({ ref: bonus, cases: [theirs], ...on });
    expect(s.state).toBe('open');
    expect(s.other).toBe(theirs);
    expect(s.canDispute).toBe(false);
  });
  it('feature off → explanation only', () => {
    expect(disputeState({ ref: bonus, ...on, tribunalOn: false }).state).toBe('off');
    expect(disputeState({ ref: bonus, ...on, rulingOn: false }).state).toBe('off');
    expect(disputeState({ ref: bonus, ...on, tribunalOn: false }).canView).toBe(true);
  });
  it('guest → can view, can’t dispute', () => {
    const s = disputeState({ ref: bonus, ...on, role: 'guest' });
    expect(s.state).toBe('guest');
    expect(s.canView).toBe(true);
    expect(s.canDispute).toBe(false);
  });
  it('organisers-only raising', () => {
    expect(disputeState({ ref: bonus, ...on, canRaiseRuling: false }).state).toBe('not_allowed');
    expect(disputeState({ ref: bonus, ...on, role: 'organiser', canRaiseRuling: true }).state).toBe('ok');
  });
  it('a value that can’t be disputed', () => {
    expect(disputeState({ ref: { table: 'scores', id: R, field: 'strokes' }, ...on }).state).toBe('invalid');
  });
});

describe('words', () => {
  it('a title from the label', () => {
    expect(disputeTitle('Worth 2 strokes')).toBe('Is “Worth 2 strokes” right?');
    expect(disputeTitle('x'.repeat(200)).length).toBeLessThanOrEqual(140);
  });
  it('values in plain words', () => {
    expect(valueWords(2)).toBe('2');
    expect(valueWords([6, 9])).toBe('6, 9');
    expect(valueWords(null)).toBe('not set');
    expect(valueWords({ net: true, carry: false })).toBe('net: yes · carry: no');
  });
  it('only what the database reads is sent (never a value for a stored setting)', () => {
    const out = refForServer({ ...bonus, explain: 'long words', where: { round_id: R } });
    expect(out).toEqual({ table: 'rounds', id: R, field: 'comp_bonus', label: 'Worth 2 strokes', where: { round_id: R } });
    expect(refForServer({ table: 'standard', field: 'rule', key: 'a.b', value: 'Ties: countback' }).value).toBe('Ties: countback');
  });
  it('the hearing line', () => {
    const s = subjectLine({ subject_ref: { table: 'rounds', id: R, field: 'comp_bonus', value: 2, label: 'Worth 2 strokes', where: { path: '/comps' }, rule_id: RULE } });
    expect(s).toEqual({ label: 'Worth 2 strokes', source: 'Round setting', value: '2', path: '/comps', ruleId: RULE });
    expect(subjectLine({})).toBe(null);
  });
});

describe('the Rulebook rule behind a round setting', () => {
  const rules = [
    { id: 'r1', status: 'active', category: 'side_comp', applies_to: ['ambrose'], value: '2 strokes', title: 'Side comps' },
    { id: 'r2', status: 'active', category: 'format', applies_to: ['ambrose'], value: null, title: 'Min 3 drives each' },
    { id: 'r3', status: 'retired', category: 'side_comp', applies_to: ['all'], value: '5 strokes', title: 'Old' },
  ];
  it('finds the matching rule for the format', () => {
    expect(ruleForSetting(rules, 'ambrose', 'comp_bonus')?.id).toBe('r1');
    expect(ruleForSetting(rules, 'ambrose', 'min_drives')?.id).toBe('r2');
    expect(ruleForSetting(rules, 'stableford', 'comp_bonus')).toBe(null);
    expect(ruleForSetting(rules, 'ambrose', 'rules')).toBe(null);
  });
});

describe('applying an upheld verdict (084)', () => {
  const upheld = { id: 'c', kind: 'ruling', subject_kind: 'setting', status: 'passed', subject_ref: bonus, proposal: { answer: '1 stroke, not 2' } };
  it('only organisers, only upheld setting disputes, only once', () => {
    expect(canApplyVerdict(upheld, 'organiser')).toBe(true);
    expect(canApplyVerdict(upheld, 'player')).toBe(false);
    expect(canApplyVerdict(upheld, 'guest')).toBe(false);
    expect(canApplyVerdict({ ...upheld, status: 'failed' }, 'organiser')).toBe(false);
    expect(canApplyVerdict({ ...upheld, status: 'open' }, 'organiser')).toBe(false);
    expect(canApplyVerdict({ ...upheld, setting_applied_at: '2026-10-22T04:41:00Z' }, 'organiser')).toBe(false);
    expect(canApplyVerdict({ ...upheld, subject_kind: 'standard', subject_ref: { table: 'standard', field: 'rule', key: 'a.b' } }, 'organiser')).toBe(false);
    expect(canApplyVerdict({ ...upheld, subject_ref: { table: 'comps', id: R, field: 'settings' } }, 'organiser')).toBe(false);
  });
  it('checks the value against the field', () => {
    expect(parseApplyValue(bonus, '1')).toEqual({ ok: true, value: 1 });
    expect(parseApplyValue(bonus, '1.5').ok).toBe(false);
    expect(parseApplyValue(bonus, '25').ok).toBe(false);
    expect(parseApplyValue(bonus, 'one').ok).toBe(false);
    expect(parseApplyValue({ table: 'round_games', id: R, field: 'stake' }, '$2.50')).toEqual({ ok: true, value: 2.5 });
    expect(parseApplyValue({ table: 'round_games', id: R, field: 'stake' }, '2.555').ok).toBe(false);
    expect(parseApplyValue({ table: 'rounds', id: R, field: 'min_drives' }, '')).toEqual({ ok: true, value: null });
    expect(parseApplyValue({ table: 'rounds', id: R, field: 'ctp_holes' }, '15, 6, 6')).toEqual({ ok: true, value: [6, 15] });
    expect(parseApplyValue({ table: 'rounds', id: R, field: 'ctp_holes' }, '19').ok).toBe(false);
    expect(parseApplyValue({ table: 'side_comp_defs', id: R, field: 'how' }, 'pick')).toEqual({ ok: true, value: 'pick' });
    expect(parseApplyValue({ table: 'side_comp_defs', id: R, field: 'how' }, 'closest').ok).toBe(false);
    expect(applySpec({ table: 'rules', id: R, field: 'value' })).toBe(null);
  });
  it('starts from "What it should be"', () => {
    expect(suggestedValue(upheld)).toBe('1');
    expect(suggestedValue({ ...upheld, subject_ref: { table: 'rounds', id: R, field: 'ctp_holes' }, proposal: { answer: 'Holes 6 and 15' } })).toBe('6, 15');
    expect(suggestedValue({ ...upheld, proposal: {} })).toBe('');
  });
  it('says who applied it and what changed', () => {
    const line = appliedLine({ setting_applied_at: '2026-10-22T03:41:00Z', setting_change: { old: 2, new: 1 } }, 'Josh');
    expect(line).toMatch(/^Applied by Josh, .+: 2 → 1$/);
    expect(appliedLine({}, 'Josh')).toBe(null);
  });
});
