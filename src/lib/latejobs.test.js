import { describe, it, expect } from 'vitest';
import {
  lateRule, lateInfo, lateMessage, lateLabel, lateJobs, lateRuleRefs, penaltyRef, lateRulePatch, lateDetail, daysBetween,
} from './latejobs.js';
import { penaltyFor, applyPenalty } from './scoring.js';
import { roundBoard, stablefordTrophyBoard } from './board.js';
import { nextStep } from './tripjobs.js';
import { isDisputable, applySpec, canApplyVerdict, parseApplyValue } from './disputes.js';

const TODAY = '2026-10-22';
const RULE0 = { id: 'r1', system_key: 'late_job', status: 'active', late_strokes: 0, late_days: 5, value: '0 strokes · 5 days' };
const RULE2 = { ...RULE0, late_strokes: 2, value: '2 strokes · 5 days' };
const job = (over = {}) => ({ id: 'j1', kind: 'job', title: 'Book the bus', owner_id: 'p1', due: '2026-10-16', done: false, stage: 'todo', ...over });

describe('the late job rule', () => {
  it('starts listed but off (0 strokes, 5 days)', () => {
    const r = lateRule([{ id: 'x', title: 'Other' }, RULE0]);
    expect(r).toMatchObject({ strokes: 0, days: 5, on: false });
    expect(r.rule.id).toBe('r1');
    expect(lateRule([{ id: 'x' }])).toBe(null);
  });
  it('is on with strokes, off when retired', () => {
    expect(lateRule([RULE2]).on).toBe(true);
    expect(lateRule([{ ...RULE2, status: 'retired' }]).on).toBe(false);
  });
  it('fills in the defaults if the numbers are missing', () => {
    expect(lateRule([{ ...RULE0, late_strokes: null, late_days: null }])).toMatchObject({ strokes: 0, days: 5 });
  });
  it('checks the organiser’s numbers', () => {
    expect(lateRulePatch('2', '5')).toEqual({ late_strokes: 2, late_days: 5 });
    expect(lateRulePatch('0', '0')).toEqual({ late_strokes: 0, late_days: 0 });
    expect(lateRulePatch('11', '5').error).toMatch(/0 to 10/);
    expect(lateRulePatch('1.5', '5').error).toMatch(/whole number/);
    expect(lateRulePatch('2', '61').error).toMatch(/0 to 60/);
    expect(lateRulePatch('', '5').error).toBeUndefined(); // blank = 0
  });
  it('words the rule the same way as the server', () => {
    expect(lateDetail(2, 5)).toBe('If you’re given a trip job and it’s more than 5 days overdue, you cop 2 penalty strokes in the next round. Finish it before that round starts and it’s off. An organiser can waive it.');
    expect(lateDetail(0, 1)).toMatch(/more than 1 day overdue, you cop 0 penalty strokes.*listed but nothing happens/);
  });
});

describe('when a job is late', () => {
  const rule = lateRule([RULE2]);
  it('counts days between dates', () => {
    expect(daysBetween('2026-10-16', TODAY)).toBe(6);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('nope', TODAY)).toBe(null);
  });
  it('is late more than N days past due', () => {
    expect(lateInfo(job(), rule, { today: TODAY })).toMatchObject({ daysLate: 6, strokes: 2, waived: false, applied: null });
    expect(lateInfo(job({ due: '2026-10-17' }), rule, { today: TODAY })).toBe(null); // exactly 5 days: not yet
  });
  it('never at 0 strokes, done, unowned, undated or not a job', () => {
    expect(lateInfo(job(), lateRule([RULE0]), { today: TODAY })).toBe(null);
    expect(lateInfo(job({ done: true, stage: 'done' }), rule, { today: TODAY })).toBe(null);
    expect(lateInfo(job({ stage: 'done' }), rule, { today: TODAY })).toBe(null);
    expect(lateInfo(job({ owner_id: null }), rule, { today: TODAY })).toBe(null);
    expect(lateInfo(job({ due: null }), rule, { today: TODAY })).toBe(null);
    expect(lateInfo(job({ kind: 'bring' }), rule, { today: TODAY })).toBe(null);
    expect(lateInfo(job(), null, { today: TODAY })).toBe(null);
  });
  it('knows a waiver and an applied penalty', () => {
    expect(lateInfo(job(), rule, { today: TODAY, penalties: [{ item_id: 'j1', waived_at: '2026-10-20T00:00:00Z' }] }).waived).toBe(true);
    const a = { id: 'a1', item_id: 'j1', kind: 'late_job', strokes: 2, roundName: 'Round 1' };
    expect(lateInfo(job(), rule, { today: TODAY, adjustments: [a] }).applied).toBe(a);
    expect(lateInfo(job(), rule, { today: TODAY, adjustments: [{ ...a, waived_at: 'x' }] }).waived).toBe(true);
  });
  it('lists a trip’s late jobs, latest first', () => {
    const items = [job(), job({ id: 'j2', title: 'Wine', due: '2026-10-10' }), job({ id: 'j3', due: '2026-10-20' })];
    expect(lateJobs(items, rule, { today: TODAY }).map((x) => x.job.id)).toEqual(['j2', 'j1']);
  });
});

describe('the messages', () => {
  it('warns the owner', () => {
    expect(lateMessage({ daysLate: 6, strokes: 2 })).toBe('⚠️ 6 days late — 2 penalty strokes if it’s not done before the next round');
    expect(lateMessage({ daysLate: 1, strokes: 1 })).toBe('⚠️ 1 day late — 1 penalty stroke if it’s not done before the next round');
  });
  it('says when it was waived or added', () => {
    expect(lateMessage({ daysLate: 6, strokes: 2, waived: true })).toBe('⚠️ 6 days late — penalty waived');
    expect(lateMessage({ daysLate: 6, strokes: 2, applied: { strokes: 2, roundName: 'Round 1' } })).toBe('⚠️ 6 days late — 2 penalty strokes added to Round 1');
    expect(lateMessage(null)).toBe('');
  });
  it('labels the scorecard line like the server', () => {
    expect(lateLabel('Book the bus', 2)).toBe('Late job: Book the bus (+2)');
  });
});

describe('next step', () => {
  const plan = { id: 'p', kind: 'trip', status: 'confirmed', start_date: '2026-11-20', name: 'Trip' };
  const items = [job({ formula_key: null })];
  const late = { rule: lateRule([RULE2]), penalties: [], adjustments: [] };
  it('puts the owner’s late job first, with the warning', () => {
    const s = nextStep({ plan, stage: 'locked', items, me: 'p1', isOrganiser: false, today: TODAY, late, rsvps: [{ player_id: 'p1', status: 'in' }] });
    expect(s.key).toBe('late:j1');
    expect(s.late).toBe(true);
    expect(s.title).toBe('Your job: Book the bus');
    expect(s.detail).toBe('⚠️ 6 days late — 2 penalty strokes if it’s not done before the next round.');
  });
  it('is the plain job step at 0 strokes', () => {
    const s = nextStep({ plan, stage: 'locked', items, me: 'p1', isOrganiser: false, today: TODAY, late: { ...late, rule: lateRule([RULE0]) } });
    expect(s.key).toBe('job:j1');
    expect(s.late).toBeUndefined();
  });
  it('shows the organiser whose job is late', () => {
    const s = nextStep({ plan, stage: 'locked', items: [...items, { id: 'f', kind: 'job', formula_key: 'transport', title: 'T', due: '2026-12-01', owner_id: 'org' }], me: 'org', isOrganiser: true, today: TODAY, late, names: { p1: 'Sam' } });
    expect(s.detail).toBe('Sam is on it — 6 days late — 2 penalty strokes if it’s not done before the next round.');
    expect(s.late).toBe(true);
  });
  it('drops the warning once waived', () => {
    const s = nextStep({ plan, stage: 'locked', items, me: 'p1', isOrganiser: false, today: TODAY, late: { ...late, penalties: [{ item_id: 'j1', waived_at: 'x' }] } });
    expect(s.key).toBe('job:j1');
  });
});

describe('penalty strokes on the score', () => {
  const adj = [
    { id: 'a1', round_id: 'r', player_id: 'p1', strokes: 2, label: 'Late job: Book the bus (+2)', kind: 'late_job', rule_id: 'r1' },
    { id: 'a2', round_id: 'r', player_id: 'p1', strokes: 1, label: 'Late job: Wine (+1)', kind: 'late_job', waived_at: 'x' },
    { id: 'a3', round_id: 'other', player_id: 'p2', strokes: 3, label: 'Late job: X (+3)' },
  ];
  it('adds the unwaived ones', () => {
    const p = penaltyFor(adj, ['p1']);
    expect(p.strokes).toBe(2);
    expect(p.lines.map((l) => [l.id, l.waived])).toEqual([['a1', false], ['a2', true]]);
    expect(penaltyFor(adj, ['p9']).strokes).toBe(0);
  });
  it('costs strokes in net formats and points in points formats', () => {
    expect(applyPenalty('stroke', { netToPar: 3 }, 2)).toMatchObject({ netToPar: 5, penalty: 2 });
    expect(applyPenalty('ambrose', { netToPar: -4, finalNet: 60 }, 2)).toMatchObject({ netToPar: -2, finalNet: 62 });
    expect(applyPenalty('stableford', { points: 30, vsExpected: -6 }, 2)).toMatchObject({ points: 28, vsExpected: -8 });
    expect(applyPenalty('stableford', { points: 30, vsExpected: -6 }, 0)).toMatchObject({ points: 30, penalty: 0 });
  });

  const holes = [{ n: 1, par: 4, si: 1 }, { n: 2, par: 4, si: 2 }];
  const course = { holes };
  const players = { p1: { id: 'p1', name: 'Sam' }, p2: { id: 'p2', name: 'Al' } };
  const rp = [{ player_id: 'p1', playing_handicap: 0 }, { player_id: 'p2', playing_handicap: 0 }];
  const scoresIdx = { r: { p1: { 1: { strokes: 4 }, 2: { strokes: 4 } }, p2: { 1: { strokes: 5 }, 2: { strokes: 4 } } } };
  it('Stableford: 2 strokes cost Sam 2 points and the lead', () => {
    const b = roundBoard({ round: { id: 'r', format: 'stableford' }, course, roundPlayers: rp, playersById: players, scoresIdx, adjustments: adj });
    const sam = b.rows.find((r) => r.id === 'p1');
    expect(sam.points).toBe(2); // 4 − 2
    expect(sam.penalty).toBe(2);
    expect(sam.penaltyLines).toHaveLength(2);
    expect(b.rows[0].id).toBe('p2'); // Al 3 points now leads
  });
  it('stroke play: + strokes on net', () => {
    const b = roundBoard({ round: { id: 'r', format: 'stroke' }, course, roundPlayers: rp, playersById: players, scoresIdx, adjustments: adj });
    expect(b.rows.find((r) => r.id === 'p1').netToPar).toBe(2);
  });
  it('Ambrose: the team carries its player’s penalty', () => {
    const teams = [{ id: 't1', name: 'A', handicap: 0, players: [players.p1] }, { id: 't2', name: 'B', handicap: 0, players: [players.p2] }];
    const idx = { r: { t1: { 1: { strokes: 4 }, 2: { strokes: 4 } }, t2: { 1: { strokes: 4 }, 2: { strokes: 5 } } } };
    const b = roundBoard({ round: { id: 'r', format: 'ambrose' }, course, teams, scoresIdx: idx, adjustments: adj });
    expect(b.rows.find((r) => r.id === 't1').netToPar).toBe(2);
    expect(b.rows[0].id).toBe('t2');
  });
  it('the trip trophy counts it', () => {
    const tb = stablefordTrophyBoard({ trip: { id: 'tr' }, rounds: [{ id: 'r', trip_id: 'tr', format: 'stableford', course_id: 'c', status: 'locked' }], coursesById: { c: course }, roundPlayers: { r: rp }, playersById: players, scoresIdx, quickResults: [], adjustments: adj });
    expect(tb.rows.find((r) => r.id === 'p1').total).toBe(2);
  });
  it('no adjustments: the board is unchanged', () => {
    const b = roundBoard({ round: { id: 'r', format: 'stableford' }, course, roundPlayers: rp, playersById: players, scoresIdx });
    expect(b.rows.find((r) => r.id === 'p1').points).toBe(4);
  });
});

describe('disputing it', () => {
  const lr = lateRule([RULE2]);
  it('both numbers are disputable rule values', () => {
    const refs = lateRuleRefs(lr);
    expect(isDisputable(refs.strokes)).toBe(false); // 'r1' isn't a uuid — the real id is
    const real = lateRuleRefs(lateRule([{ ...RULE2, id: '00000000-0000-4000-8000-000000000001' }]));
    expect(isDisputable(real.strokes)).toBe(true);
    expect(isDisputable(real.days)).toBe(true);
    expect(real.strokes.label).toBe('2 penalty strokes for a late job');
  });
  it('one penalty is disputable, and an upheld verdict can set it', () => {
    const ref = penaltyRef({ id: '00000000-0000-4000-8000-000000000002', label: 'Late job: Bus (+2)', strokes: 2 }, { id: 'r', trip_id: 't' });
    expect(isDisputable(ref)).toBe(true);
    expect(applySpec(ref)).toBeTruthy();
    expect(parseApplyValue(ref, '0')).toEqual({ ok: true, value: 0 });
  });
  it('an organiser can apply a verdict on the numbers', () => {
    const c = { kind: 'ruling', subject_kind: 'rule', status: 'passed', subject_ref: { table: 'rules', id: 'x', field: 'late_strokes' } };
    expect(canApplyVerdict(c, 'organiser')).toBe(true);
    expect(canApplyVerdict(c, 'player')).toBe(false);
    expect(canApplyVerdict({ ...c, subject_ref: { table: 'rules', id: 'x', field: 'value' } }, 'organiser')).toBe(false);
    expect(parseApplyValue(c.subject_ref, '11').ok).toBe(false);
  });
});
