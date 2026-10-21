import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TRAGEDY_BLOCKED, AWARD_IDEAS, FINE_IDEAS, awardBlocked, checkAward, checkReason, canNominate, canVote, nextStep, myVote,
  tally, resultLine, sortAwards, closedPost, resultsCard,
} from './dinnerawards.js';

const A = { id: 'a1', title: 'Hack of the day', kind: 'award', status: 'voting', created_at: '1' };
const F = { id: 'f1', title: 'Late to the tee', kind: 'fine', penalty: 'buys the first round', status: 'closed', created_at: '2' };
const nom = (id, award_id, player_id, created_at = id) => ({ id, award_id, player_id, created_at });
const vote = (award_id, voter_id, nomination_id, updated_at = '1') => ({ award_id, voter_id, nomination_id, updated_at });
const names = { tom: 'Tom', dick: 'Dick', harry: 'Harry' };
const nameOf = (id) => names[id] || id;

describe('keeping it friendly', () => {
  it('blocks slurs (the in-jokes list) and tragedy', () => {
    expect(awardBlocked('Biggest r3tard')).toBe(true);
    expect(awardBlocked('Golfs like he has cancer')).toBe(true);
    expect(awardBlocked('Most S U I C I D E shots')).toBe(false); // split letters aren't a word — fine, it's a word list
    expect(awardBlocked('Hack of the day')).toBe(false);
    expect(awardBlocked('His putting died on the back nine')).toBe(false);
  });
  it('checks an award or fine before saving', () => {
    expect(checkAward({ title: 'Hack of the day' })).toBe('');
    expect(checkAward({ title: 'x' })).toBe('Name the award first');
    expect(checkAward({ title: '', kind: 'fine' })).toBe('Name the fine first');
    expect(checkAward({ title: 'a'.repeat(61) })).toMatch(/under 60/);
    expect(checkAward({ title: 'Late', kind: 'fine', penalty: 'b'.repeat(81) })).toMatch(/under 80/);
    expect(checkAward({ title: 'Air shot', kind: 'fine', penalty: 'buys the kys round' })).toMatch(/friendly/);
  });
  it('checks a reason', () => {
    expect(checkReason('')).toBe('');
    expect(checkReason('Three balls in the dam on 7')).toBe('');
    expect(checkReason('x'.repeat(141))).toMatch(/under 140/);
    expect(checkReason('total paedo')).toMatch(/friendly/);
  });
  it('the ideas are all friendly', () => {
    for (const t of AWARD_IDEAS) expect(checkAward({ title: t })).toBe('');
    for (const f of FINE_IDEAS) expect(checkAward({ ...f, kind: 'fine' })).toBe('');
  });
  it('the database (064) has the same tragedy list', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/064_trip_extras.sql'), 'utf8');
    const words = sql.split('-- TRAGEDY-START')[1].split('-- TRAGEDY-END')[0].match(/'([a-z ]+)'/g).map((s) => s.slice(1, -1));
    expect(new Set(words)).toEqual(new Set(TRAGEDY_BLOCKED));
  });
});

describe('who can do what', () => {
  it('nominate while nominations are open (organiser during voting too)', () => {
    expect(canNominate({ status: 'nominating' })).toBe(true);
    expect(canNominate({ status: 'voting' })).toBe(false);
    expect(canNominate({ status: 'voting' }, true)).toBe(true);
    expect(canNominate({ status: 'closed' }, true)).toBe(false);
    expect(canNominate(null)).toBe(false);
  });
  it('vote only while voting is open', () => {
    expect(canVote({ status: 'voting' })).toBe(true);
    expect(canVote({ status: 'nominating' })).toBe(false);
  });
  it('the organiser’s next step', () => {
    expect(nextStep({ status: 'nominating' })).toEqual({ status: 'voting', label: 'Open the voting' });
    expect(nextStep({ status: 'voting' })).toEqual({ status: 'closed', label: 'Close the voting' });
    expect(nextStep({ status: 'closed' }).status).toBe('voting');
  });
  it('my vote', () => {
    expect(myVote([vote('a1', 'tom', 'n2')], 'a1', 'tom')).toBe('n2');
    expect(myVote([vote('a1', 'tom', 'n2')], 'a1', 'dick')).toBeNull();
  });
});

describe('tally', () => {
  const noms = [nom('n1', 'a1', 'tom'), nom('n2', 'a1', 'dick'), nom('n3', 'a1', 'harry'), nom('x', 'other', 'tom')];
  it('most votes wins', () => {
    const r = tally(A, noms, [vote('a1', 'v1', 'n2'), vote('a1', 'v2', 'n2'), vote('a1', 'v3', 'n1')]);
    expect(r.rows.map((x) => [x.player_id, x.votes])).toEqual([['dick', 2], ['tom', 1], ['harry', 0]]);
    expect(r.winners.map((w) => w.player_id)).toEqual(['dick']);
    expect(r.tie).toBe(false);
    expect(r.total).toBe(3);
  });
  it('level on votes is a tie', () => {
    const r = tally(A, noms, [vote('a1', 'v1', 'n2'), vote('a1', 'v2', 'n1')]);
    expect(r.tie).toBe(true);
    expect(r.winners.map((w) => w.player_id)).toEqual(['tom', 'dick']); // in the order they were nominated
  });
  it('no votes, no winner; votes for another award or a missing nomination are ignored', () => {
    expect(tally(A, noms, []).winners).toEqual([]);
    const r = tally(A, noms, [vote('other', 'v1', 'x'), vote('a1', 'v2', 'gone')]);
    expect(r.total).toBe(0);
    expect(r.winners).toEqual([]);
  });
  it('one vote per person (the latest counts)', () => {
    const r = tally(A, noms, [vote('a1', 'v1', 'n1', '1'), vote('a1', 'v1', 'n3', '2')]);
    expect(r.winners.map((w) => w.player_id)).toEqual(['harry']);
    expect(r.total).toBe(1);
  });
});

describe('results in words', () => {
  const noms = [nom('n1', 'a1', 'tom'), nom('n2', 'a1', 'dick'), nom('n3', 'f1', 'harry'), nom('n4', 'f1', 'tom')];
  it('a winner, a tie, nothing yet', () => {
    expect(resultLine(A, tally(A, noms, [vote('a1', 'v1', 'n1'), vote('a1', 'v2', 'n1')]), nameOf)).toBe('Tom (2 votes)');
    expect(resultLine(A, tally(A, noms, [vote('a1', 'v1', 'n1'), vote('a1', 'v2', 'n2')]), nameOf)).toBe('Tie — Tom & Dick (1 vote each)');
    expect(resultLine(A, tally(A, noms, []), nameOf)).toBe('No votes yet');
    expect(resultLine(A, tally(A, [], []), nameOf)).toBe('No nominations');
  });
  it('a fine says what the winner does', () => {
    expect(resultLine(F, tally(F, noms, [vote('f1', 'v1', 'n3')]), nameOf)).toBe('Harry (1 vote) — fine: buys the first round');
  });
  it('the feed post', () => {
    expect(closedPost(A, tally(A, noms, [vote('a1', 'v1', 'n2')]), nameOf)).toBe('🏅 Dinner award — Hack of the day: Dick (1 vote)');
    expect(closedPost(F, tally(F, noms, [vote('f1', 'v1', 'n4')]), nameOf)).toBe('🍺 Fine — Late to the tee: Tom (1 vote) — fine: buys the first round');
  });
  it('order: voting, then nominations, then decided; awards before fines', () => {
    const list = [F, { ...A, id: 'a2', status: 'nominating' }, A, { id: 'f2', kind: 'fine', status: 'voting' }];
    expect(sortAwards(list).map((a) => a.id)).toEqual(['a1', 'f2', 'a2', 'f1']);
  });
  it('the share card: decided ones only', () => {
    const card = resultsCard({
      tripName: 'Hunter 2026', awards: [{ ...A, status: 'closed' }, F, { id: 'open', kind: 'award', status: 'voting', title: 'Open' }],
      nominations: noms, votes: [vote('a1', 'v1', 'n1'), vote('a1', 'v2', 'n2'), vote('f1', 'v1', 'n3')], nameOf,
    });
    expect(card).toEqual({
      title: 'Hunter 2026', sub: '2 decided',
      rows: [
        { label: 'AWARD · HACK OF THE DAY', name: 'Tie: Tom & Dick', line: '1 vote' },
        { label: 'FINE · LATE TO THE TEE', name: 'Harry', line: '1 vote · buys the first round' },
      ],
    });
  });
});
