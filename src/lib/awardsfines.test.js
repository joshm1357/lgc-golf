import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  rewardWords, leftoverWords, proofNeeds, proofLabel, checkProposal, signedAmount, termsOf, tripAwardList, chipText,
  timeWords, claimWords, rankClaims, resultText, tallyOpinions, leftoverLine, LEFTOVER, REWARD_TYPES,
} from './awardsfines.js';

const sql = fs.readFileSync(new URL('../../supabase/migrations/093_awards_fines.sql', import.meta.url), 'utf8');

describe('what it is worth (same words as the database)', () => {
  it('strokes, points, money and words', () => {
    expect(rewardWords('strokes', -1)).toBe('−1 stroke');
    expect(rewardWords('strokes', 2)).toBe('+2 strokes');
    expect(rewardWords('points', 3)).toBe('+3 points');
    expect(rewardWords('money', 5)).toBe('$5');
    expect(rewardWords('money', 2.5, 'into the kitty')).toBe('$2.5 · into the kitty');
    expect(rewardWords('drink')).toBe('Buys a round');
    expect(rewardWords('drink', null, 'Buys the first round')).toBe('Buys the first round');
    expect(rewardWords('title')).toBe('The title');
    expect(rewardWords('bragging')).toBe('Bragging rights');
    expect(rewardWords('other', null, 'Sings at dinner')).toBe('Sings at dinner');
    expect(rewardWords(null)).toBe('');
  });
  it('the migration writes the same fixed words', () => {
    for (const w of ["'Buys a round'", "'The title'", "'Bragging rights'", "' stroke'", "' point'"]) expect(sql).toContain(w);
    for (const l of LEFTOVER.filter((x) => x.key !== 'other')) expect(sql).toContain(`'${l.label}'`);
    for (const t of REWARD_TYPES) expect(sql).toContain(`'${t.key}'`);
  });
  it('leftover kitty words', () => {
    expect(leftoverWords('bar')).toBe('On the bar the last night');
    expect(leftoverWords(null)).toBe('On the bar the last night');
    expect(leftoverWords('rollover')).toBe('Rolls over to the next trip');
    expect(leftoverWords('other', 'To the greenkeeper')).toBe('To the greenkeeper');
  });
});

describe('proof', () => {
  it('what a claim needs', () => {
    expect(proofNeeds('photo_time')).toEqual({ photo: true, time: true, number: false });
    expect(proofNeeds('number')).toEqual({ photo: false, time: false, number: true });
    expect(proofNeeds(null)).toEqual({ photo: false, time: false, number: false });
    expect(proofLabel('photo_time')).toBe('Needs 📷 photo + ⏱ time');
    expect(proofLabel('number', 'm')).toBe('Needs 🔢 m');
    expect(proofLabel('none')).toBe('');
  });
});

describe('proposals', () => {
  it('checks names and amounts', () => {
    expect(checkProposal({ title: 'x' })).toMatch(/Name/);
    expect(checkProposal({ title: 'Latest out', reward_type: 'strokes', reward_amount: -1 })).toBe('');
    expect(checkProposal({ title: 'Zero', reward_type: 'strokes', reward_amount: 0 })).toMatch(/Strokes/);
    expect(checkProposal({ title: 'Half', reward_type: 'strokes', reward_amount: 1.5 })).toMatch(/Strokes/);
    expect(checkProposal({ title: 'Big', reward_type: 'money', reward_amount: 5000 })).toMatch(/Money/);
    expect(checkProposal({ title: 'Words', reward_type: 'other', reward_note: '' })).toMatch(/worth/);
  });
  it('an award takes strokes off, a fine adds them', () => {
    expect(signedAmount('award', 'strokes', 1)).toBe(-1);
    expect(signedAmount('fine', 'strokes', 2)).toBe(2);
    expect(signedAmount('award', 'points', 3)).toBe(3);
    expect(signedAmount('fine', 'points', 3)).toBe(-3);
    expect(signedAmount('fine', 'money', 5)).toBe(5);
    expect(signedAmount('award', 'drink', 5)).toBe(null);
  });
});

describe('which list applies to a trip', () => {
  const T = 'trip-1';
  const rules = [
    { id: 'r1', title: 'Wrong-ball fine', award_kind: 'fine', status: 'active', reward_type: 'money', reward_amount: 5 },
    { id: 'r2', title: 'Latest out', award_kind: 'award', status: 'active', reward_type: 'strokes', reward_amount: -1, proof: 'photo_time', best: 'latest' },
    { id: 'r3', title: 'Other trip only', award_kind: 'award', status: 'active', for_trip: 'trip-2', reward_type: 'bragging' },
    { id: 'r4', title: 'This trip only', award_kind: 'fine', status: 'active', for_trip: T, reward_type: 'drink' },
    { id: 'r5', title: 'Waiting', award_kind: 'fine', status: 'proposed', reward_type: 'money', reward_amount: 2 },
    { id: 'r6', title: 'Waiting elsewhere', award_kind: 'fine', status: 'proposed', for_trip: 'trip-2' },
    { id: 'r7', title: 'Retired', award_kind: 'fine', status: 'retired' },
    { id: 'r8', title: 'Birdie bonus', status: 'active', category: 'bonus' },
  ];
  const awards = [
    { id: 'a1', trip_id: T, rule_id: 'r2', title: 'Latest out', kind: 'award' },
    { id: 'a2', trip_id: T, rule_id: null, title: 'Hack of the day', kind: 'award' },
    { id: 'a3', trip_id: 'trip-2', rule_id: null, title: 'Elsewhere', kind: 'award' },
    { id: 'a4', trip_id: T, rule_id: null, title: 'Late to dinner', kind: 'fine', penalty: 'sings' },
  ];
  const { list, proposed } = tripAwardList({ rules, awards, tripId: T });
  it('Rulebook ones for every trip or this one, plus the trip’s own; awards first', () => {
    expect(list.map((x) => x.title)).toEqual(['Hack of the day', 'Latest out', 'Late to dinner', 'This trip only', 'Wrong-ball fine']);
  });
  it('links a Rulebook one to its trip copy', () => {
    expect(list.find((x) => x.title === 'Latest out').award.id).toBe('a1');
    expect(list.find((x) => x.title === 'Wrong-ball fine').award).toBe(null);
  });
  it('worth lines', () => {
    expect(list.find((x) => x.title === 'Latest out').worth).toBe('−1 stroke');
    expect(list.find((x) => x.title === 'Late to dinner').worth).toBe('sings');
  });
  it('waiting for a decision', () => expect(proposed.map((r) => r.id)).toEqual(['r5']));
  it('a trip copy takes its Rulebook rule’s terms', () => {
    expect(termsOf(awards[0], { r2: rules[1] })).toMatchObject({ proof: 'photo_time', best: 'latest', reward_amount: -1, rule_id: 'r2' });
    expect(termsOf(awards[1], {})).toMatchObject({ proof: 'none', rule_id: null });
  });
});

describe('the chip on a post', () => {
  it('fine and award', () => {
    expect(chipText({ kind: 'fine', title: 'Wrong ball', worth: '$5' })).toBe('🏷 Fined: Wrong ball ($5)');
    expect(chipText({ kind: 'award', title: 'Latest out', worth: '−1 stroke' })).toBe('🏅 Up for: Latest out (−1 stroke)');
    expect(chipText({ kind: 'fine', title: 'Air shot', worth: '' })).toBe('🏷 Fined: Air shot');
  });
});

describe('claims and the result', () => {
  const at = (h, m, day = 23) => new Date(Date.UTC(2026, 9, day - 1, h - 11, m)).toISOString(); // Sydney is UTC+11 in Oct
  it('time words in Sydney', () => {
    expect(timeWords(at(2, 47))).toBe('2:47am');
    expect(timeWords(at(23, 15))).toBe('11:15pm');
  });
  it('ranks the latest first, ties share', () => {
    const noms = [
      { id: 'h', claim_at: at(23, 15, 22) },
      { id: 't', claim_at: at(2, 47) },
      { id: 'x', claim_at: null },
      { id: 'd', claim_at: at(2, 47) },
    ];
    const r = rankClaims(noms, 'latest');
    expect(r.map((n) => `${n.id}${n.rank}`)).toEqual(['t1', 'd1', 'h3', 'xnull']);
    expect(rankClaims(noms, null)).toEqual([]);
    expect(rankClaims([{ id: 'a', claim_number: 4 }, { id: 'b', claim_number: 15 }], 'highest')[0].id).toBe('b');
  });
  it('the result post, as the database writes it', () => {
    const terms = { reward_type: 'strokes', reward_amount: -1, proof: 'photo_time' };
    expect(resultText({ kind: 'award', title: 'Latest out', name: 'Hamish', nom: { claim_at: at(2, 47), photo_url: 'https://x/y.jpg' }, terms }))
      .toBe('🏆 Latest out — Hamish, 2:47am 📷 · −1 stroke next round');
    expect(resultText({ kind: 'fine', title: 'Wrong-ball fine', name: 'Tom', nom: {}, terms: { reward_type: 'money', reward_amount: 5 } }))
      .toBe('🍺 Wrong-ball fine — Tom · $5');
    expect(claimWords({ claim_number: 15 }, { number_unit: 'm' })).toBe('15 m');
  });
});

describe('opinions on a fine’s size', () => {
  it('tallies and leans', () => {
    const t = tallyOpinions([{ opinion: 'too_much' }, { opinion: 'too_much' }, { opinion: 'about_right' }]);
    expect(t).toMatchObject({ too_much: 2, about_right: 1, too_little: 0, total: 3, lean: 'too_much' });
    expect(t.line).toBe('2 say too much · 1 about right');
    expect(tallyOpinions([{ opinion: 'too_much' }, { opinion: 'too_little' }]).lean).toBe(null);
    expect(tallyOpinions([]).line).toBe('No opinions yet');
  });
});

describe('the leftover kitty line', () => {
  const money = (n) => `$${n}`;
  it('on the bar, split, nothing left', () => {
    expect(leftoverLine(85, { leftover: 'bar' }, 8, money).text).toBe('Leftover $85 → on the bar the last night (group rule)');
    const s = leftoverLine(85, { leftover: 'split' }, 8, money);
    expect(s.share).toBe(10.62);
    expect(leftoverLine(0.2, { leftover: 'bar' }, 8)).toBe(null);
    expect(leftoverLine(50, null, 8)).toBe(null);
  });
});
