import { describe, it, expect } from 'vitest';
import {
  DRIVES_KEY, drivesRule, baseDrives, minDrivesFor, drivePenaltyFor, drivesTable, driveStatus, projectedDrivePenalties,
  drivesValue, drivesDetail, drivesRoundLine, drivesRulePatch, penaltyPower, breachLabel, ruleStrokes, penaltyArgs, signed,
} from './drives.js';
import { penaltyFor } from './scoring.js';
import { roundBoard } from './board.js';

const RULE = { id: 'rd', system_key: DRIVES_KEY, status: 'active', drives_2: 6, drives_3: 6, drives_4: 4, breach_strokes: 2 };
const DR = drivesRule([{ id: 'x', system_key: 'late_job' }, RULE]);
const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const H9 = H18.slice(0, 9);
const P = [{ id: 'al', name: 'Al' }, { id: 'bo', name: 'Bo' }, { id: 'cy', name: 'Cy' }, { id: 'di', name: 'Di' }];
/** Scores for holes 1..n with the given drivers in order. */
const card = (drivers) => Object.fromEntries(drivers.map((d, i) => [i + 1, { strokes: 4, tee_shot_player: d }]));

describe('the drives rule and its numbers', () => {
  it('reads the rule (defaults when blank)', () => {
    expect(DR).toMatchObject({ n2: 6, n3: 6, n4: 4, strokes: 2, on: true });
    expect(drivesRule([{ system_key: DRIVES_KEY, status: 'retired' }])).toMatchObject({ n3: 6, n4: 4, strokes: 2, on: false });
    expect(drivesRule([])).toBeNull();
  });
  it('N by team size on 18 holes: 6 in a three, 4 in a four, 6 in a pair, fives share the four’s total', () => {
    expect(baseDrives(DR, 3)).toBe(6);
    expect(baseDrives(DR, 4)).toBe(4);
    expect(baseDrives(DR, 2)).toBe(6);
    expect(baseDrives(DR, 5)).toBe(3);
    expect(baseDrives(DR, 1)).toBe(0);
  });
  it('scales to 9 holes and never asks for more than a fair share', () => {
    expect(minDrivesFor({ dr: DR, teamSize: 3, holes: 18 })).toBe(6);
    expect(minDrivesFor({ dr: DR, teamSize: 4, holes: 18 })).toBe(4);
    expect(minDrivesFor({ dr: DR, teamSize: 3, holes: 9 })).toBe(3);
    expect(minDrivesFor({ dr: DR, teamSize: 4, holes: 9 })).toBe(2);
    expect(minDrivesFor({ dr: drivesRule([{ ...RULE, drives_4: 9 }]), teamSize: 4, holes: 18 })).toBe(4); // 18 ÷ 4
  });
  it('the round’s own N wins (capped); no rule and no round N = nothing to track', () => {
    expect(minDrivesFor({ dr: DR, round: { min_drives: 5 }, teamSize: 3, holes: 18 })).toBe(5);
    expect(minDrivesFor({ dr: DR, round: { min_drives: 9 }, teamSize: 4, holes: 18 })).toBe(4);
    expect(minDrivesFor({ dr: null, round: { min_drives: null }, teamSize: 3, holes: 18 })).toBe(0);
    expect(minDrivesFor({ dr: null, round: { min_drives: 6 }, teamSize: 3, holes: 18 })).toBe(6);
    expect(minDrivesFor({ dr: { ...DR, on: false }, teamSize: 3, holes: 18 })).toBe(0);
  });
  it('P: the round’s, else the rule’s', () => {
    expect(drivePenaltyFor({ dr: DR, round: {} })).toBe(2);
    expect(drivePenaltyFor({ dr: DR, round: { drive_penalty: 1 } })).toBe(1);
    expect(drivePenaltyFor({ dr: DR, round: { drive_penalty: 0 } })).toBe(0);
    expect(drivePenaltyFor({ dr: null, round: {} })).toBe(0);
  });
  it('shows a defaults table for pairs to fives, 18 and 9 holes', () => {
    expect(drivesTable(DR)).toEqual([
      { size: 2, label: 'Pair', n18: 6, n9: 3 },
      { size: 3, label: 'Three', n18: 6, n9: 3 },
      { size: 4, label: 'Four', n18: 4, n9: 2 },
      { size: 5, label: 'Five', n18: 3, n9: 1 },
    ]);
  });
  it('words match the database', () => {
    expect(drivesValue(6, 6, 4, 2)).toBe('6 drives each in a three · 4 in a four · 6 in a pair · +2 a drive short');
    expect(drivesDetail(6, 6, 4, 1)).toMatch(/costs the team 1 stroke,/);
    expect(drivesRoundLine({ dr: DR, round: {}, teamSizes: [3] })).toBe('Minimum drives: 6 each — +2 strokes for each drive short');
    expect(drivesRoundLine({ dr: DR, round: {}, teamSizes: [3, 4] })).toBe('Minimum drives: 6 each in a three, 4 each in a four — +2 strokes for each drive short');
    expect(drivesRoundLine({ dr: null, round: {}, teamSizes: [3] })).toBe('');
  });
  it('checks the organiser’s numbers', () => {
    expect(drivesRulePatch({ n2: '6', n3: '5', n4: '4', strokes: '1' })).toEqual({ drives_2: 6, drives_3: 5, drives_4: 4, breach_strokes: 1 });
    expect(drivesRulePatch({ n2: '6', n3: '12', n4: '4', strokes: '1' }).error).toMatch(/0 to 9/);
    expect(drivesRulePatch({ n2: '6', n3: '6', n4: '4', strokes: '' }).error).toMatch(/0 to 10/);
  });
});

describe('live drives: tracker, warnings and the next-tee hint', () => {
  const three = P.slice(0, 3);
  it('counts drives and writes the tracker line', () => {
    const st = driveStatus({ players: three, holes: H18, scores: card(['al', 'bo', 'cy', 'al']), need: 6, per: 2 });
    expect(st.line).toBe('Drives: Al 2/6 · Bo 1/6 · Cy 1/6');
    expect(st.open).toBe(14);
    expect(st.warnings).toEqual([]);
    expect(st.tracked).toBe(true);
  });
  it('warns when a drive can’t be made up: "Cy needs 4 more in 3 holes: +2 strokes coming"', () => {
    // 15 holes played: Al 7, Bo 6, Cy 2 — 3 holes left.
    const drivers = [...Array(7).fill('al'), ...Array(6).fill('bo'), 'cy', 'cy'];
    const st = driveStatus({ players: three, holes: H18, scores: card(drivers), need: 6, per: 2 });
    expect(st.open).toBe(3);
    expect(st.warnings).toEqual(['Cy needs 4 more in 3 holes: +2 strokes coming']);
    expect(st.coming).toBe(2);
    expect(st.needsOne).toEqual(['cy']);
  });
  it('the hole being entered counts (its pick, or as open)', () => {
    const drivers = [...Array(7).fill('al'), ...Array(6).fill('bo'), 'cy', 'cy'];
    const withPick = driveStatus({ players: three, holes: H18, scores: card(drivers), need: 6, per: 2, current: { n: 16, pick: 'cy' } });
    expect(withPick.rows.find((r) => r.id === 'cy')).toMatchObject({ used: 3, short: 3, coming: 1 });
    expect(withPick.open).toBe(2);
    expect(withPick.warnings[0]).toBe('Cy needs 3 more in 2 holes: +2 strokes coming');
  });
  it('a hole saved without a drive is lost (not open); the end of the round says what it cost', () => {
    const drivers = [...Array(6).fill('al'), ...Array(6).fill('bo'), ...Array(4).fill('cy'), null, null];
    const st = driveStatus({ players: three, holes: H18, scores: card(drivers), need: 6, per: 2 });
    expect(st.open).toBe(0);
    expect(st.warnings).toEqual(['Cy had 4 of 6: +4 strokes']);
    expect(st.coming).toBe(4);
  });
  it('squeeze: no one is certain to miss, but they can’t all fit', () => {
    // 12 played (Al 6, Bo 6), Cy 0 and Di 0 in a four? use a three with Cy needing 6 in 6 holes, plus Bo needing 1.
    const drivers = [...Array(7).fill('al'), ...Array(5).fill('bo')];
    const st = driveStatus({ players: three, holes: H18, scores: card(drivers), need: 6, per: 2 });
    expect(st.rows.every((r) => r.coming === 0)).toBe(true);
    expect(st.squeeze).toBe(true);
    expect(st.warnings[0]).toMatch(/only 6 holes left: at least \+2 coming/);
    expect(st.needsOne).toEqual(['cy', 'bo']);
  });
  it('nothing recorded = not tracked: no warnings', () => {
    const st = driveStatus({ players: three, holes: H18, scores: card(Array(16).fill(null)), need: 6, per: 2 });
    expect(st.tracked).toBe(false);
    expect(st.warnings).toEqual([]);
  });
  it('a four on 18 holes: "Drives: Al 3/4 · Bo 4/4 · Cy 2/4 · Di 4/4"', () => {
    const st = driveStatus({ players: P, holes: H18, scores: card(['al', 'al', 'al', 'bo', 'bo', 'bo', 'bo', 'cy', 'cy', 'di', 'di', 'di', 'di']), need: 4, per: 2 });
    expect(st.line).toBe('Drives: Al 3/4 · Bo 4/4 · Cy 2/4 · Di 4/4');
  });
});

describe('projected and applied drive penalties on the board', () => {
  const team = { id: 't1', name: 'Team A', players: P.slice(0, 3), handicap: 6 };
  const round = { id: 'r1', format: 'ambrose', status: 'live' };
  const drivers = [...Array(7).fill('al'), ...Array(6).fill('bo'), 'cy', 'cy'];
  const scoresIdx = { t1: card(drivers) };
  it('projects what’s certain while the round is live', () => {
    const rows = projectedDrivePenalties({ round, teams: [team], holes: H18, scoresIdx, dr: DR });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ player_id: 'cy', strokes: 2, projected: true, kind: 'rule_breach', rule_id: 'rd' });
    expect(rows[0].label).toBe('Drives: Cy 2 of 6, 3 holes left (+2 projected)');
    expect(projectedDrivePenalties({ round: { ...round, status: 'locked' }, teams: [team], holes: H18, scoresIdx, dr: DR })).toEqual([]);
    expect(projectedDrivePenalties({ round: { ...round, drive_penalty: 0 }, teams: [team], holes: H18, scoresIdx, dr: DR })).toEqual([]);
  });
  it('projected lines are shown, not counted; waived ones are struck out; awards are bonus lines', () => {
    const adj = [
      { id: 'a1', player_id: 'cy', strokes: 4, kind: 'rule_breach', label: 'Drives: Cy 4 of 6 (+4)' },
      { id: 'a2', player_id: 'al', strokes: 2, kind: 'rule_breach', label: 'No mulligans · hole 4 (+2)', waived_at: '2026-10-23' },
      { id: 'a3', player_id: 'bo', strokes: -1, kind: 'award', label: 'Latest out (−1)' },
      { id: 'p1', player_id: 'cy', strokes: 2, kind: 'rule_breach', projected: true, label: 'proj' },
    ];
    const p = penaltyFor(adj, ['al', 'bo', 'cy']);
    expect(p.strokes).toBe(3);
    expect(p.lines.find((l) => l.id === 'a3').bonus).toBe(true);
    expect(p.lines.find((l) => l.id === 'p1').projected).toBe(true);
    expect(p.lines.find((l) => l.id === 'a2').waived).toBe(true);
  });
  it('an Ambrose team’s total carries its rule penalties', () => {
    const course = { holes: H18 };
    const scores = { t1: Object.fromEntries(H18.map((h) => [h.n, { strokes: 4, tee_shot_player: 'al' }])) };
    const base = roundBoard({ round: { ...round, status: 'locked' }, course, teams: [team], scoresIdx: { r1: scores } });
    const withPen = roundBoard({ round: { ...round, status: 'locked' }, course, teams: [team], scoresIdx: { r1: scores },
      adjustments: [{ id: 'a1', round_id: 'r1', player_id: 'cy', strokes: 12, kind: 'rule_breach', label: 'Drives: Cy 0 of 6 (+12)' }] });
    const a = base.rows.find((r) => r.id === 't1');
    const b = withPen.rows.find((r) => r.id === 't1');
    expect(b.penalty).toBe(12);
    expect(b.netToPar - a.netToPar).toBe(12);
  });
});

describe('a penalty for any rule', () => {
  it('who can do what', () => {
    expect(penaltyPower('organiser')).toBe('apply');
    expect(penaltyPower('player')).toBe('propose');
    expect(penaltyPower('guest')).toBeNull();
    expect(penaltyPower(undefined)).toBeNull();
  });
  it('labels, default strokes and the RPC arguments', () => {
    expect(breachLabel('No mulligans', 4, 1)).toBe('No mulligans · hole 4 (+1)');
    expect(breachLabel('No mulligans', null, 2)).toBe('No mulligans (+2)');
    expect(ruleStrokes({ breach_strokes: 2 })).toBe(2);
    expect(ruleStrokes({ breach_strokes: 0 })).toBeNull();
    expect(penaltyArgs({ round: { id: 'r' }, player: 'p', rule: { id: 'x' }, strokes: '2', hole: '4', note: ' sledged ' }))
      .toEqual({ p_round: 'r', p_player: 'p', p_rule: 'x', p_strokes: 2, p_hole: 4, p_note: 'sledged' });
    expect(penaltyArgs({ round: { id: 'r' }, player: null, rule: { id: 'x' }, strokes: 2 }).error).toMatch(/Who/);
    expect(penaltyArgs({ round: { id: 'r' }, player: 'p', rule: null, strokes: 2 }).error).toMatch(/rule/);
    expect(penaltyArgs({ round: { id: 'r' }, player: 'p', rule: { id: 'x' }, strokes: 0 }).error).toMatch(/1 to 10/);
    expect(penaltyArgs({ round: { id: 'r' }, player: 'p', rule: { id: 'x' }, strokes: 2, hole: 19 }).error).toMatch(/1 to 18/);
    expect(signed(-1)).toBe('−1');
  });
});
