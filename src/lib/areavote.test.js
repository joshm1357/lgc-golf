import { describe, it, expect } from 'vitest';
import { addArea, removeArea, guideAreaGroups, areaVoteResults, chooseAreaFromVotes, reopenArea, courseSummary, staySummary, areaSummary, regionNote, MAX_AREAS } from './areavote.js';
import { groupBallot, detailCounts, detailQuestion, hasAnsweredAll, pollRows } from './callvote.js';
import { batchNonVoters, newState, startRange } from './tripbuilder.js';
import { planningExtras, startExtras, extrasSection, setExtraState } from './extras.js';

describe('the areas we’re considering (ov23)', () => {
  it('add, no doubles, a cap; remove keeps the area’s courses', () => {
    const st = { regionOptions: ['Hunter Valley'], areaCourses: { 'South Coast NSW': ['a'] } };
    expect(addArea(st, 'South Coast NSW')).toEqual({ regionOptions: ['Hunter Valley', 'South Coast NSW'] });
    expect(addArea(st, 'Hunter Valley')).toBe(null);
    expect(addArea({ regionOptions: ['a', 'b', 'c', 'd', 'e'] }, 'f')).toBe(null);
    expect(MAX_AREAS).toBe(5);
    expect(removeArea({ regionOptions: ['Hunter Valley', 'South Coast NSW'] }, 'Hunter Valley')).toEqual({ regionOptions: ['South Coast NSW'] });
    expect(removeArea({ region: 'X', regionOptions: ['X'] }, 'X')).toEqual({ regionOptions: [], region: null });
  });
  it('the region guide as a browse list of the builder’s areas', () => {
    const guides = [
      { title: 'NSW: Hunter, Newcastle, Port Stephens, Central Coast', kind: 'region', regions: ['Central Coast', 'Hunter Valley', 'Port Stephens'] },
      { title: 'About this research', kind: 'general', regions: [] },
      { title: 'Tasmania', kind: 'region', regions: ['Hobart & South'] },
    ];
    const g = guideAreaGroups(guides, ['Hunter Valley', 'Central Coast', 'Port Stephens & Great Lakes', 'Tasmania', 'Gold Coast']);
    expect(g[0]).toEqual({ title: 'NSW: Hunter, Newcastle, Port Stephens, Central Coast', areas: ['Central Coast', 'Hunter Valley', 'Port Stephens & Great Lakes'] });
    expect(g[1]).toEqual({ title: 'Tasmania', areas: ['Tasmania'] });
    expect(g[2]).toEqual({ title: 'Other areas', areas: ['Gold Coast'] });
    expect(regionNote([{ ...guides[0], body: 'Lots of courses close together. Busy on long weekends.' }], 'Hunter Valley')).toBe('Lots of courses close together.');
  });
});

describe('the vote: how deep (ov23)', () => {
  const st = { regionOptions: ['Hunter Valley', 'South Coast NSW'], areaCourses: { 'Hunter Valley': ['c1', 'c2'], 'South Coast NSW': ['c3'] },
    areaStays: { 'Hunter Valley': [{ key: 'Cessnock', name: 'Cessnock' }], 'South Coast NSW': [{ key: 'Kiama', name: 'Kiama' }] },
    weekends: [{ start: '2027-03-05', end: '2027-03-07' }, { start: '2027-03-12', end: '2027-03-14' }] };
  const map = { c1: { name: 'Cypress Lakes' }, c2: { name: 'The Vintage' }, c3: { name: 'Kiama GC' } };
  it('areas only: which area + weekends (+ how long)', () => {
    const r = startRange(st, { courseMap: map, depth: 'areas', length: { key: 'length', kind: 'other', question: 'How long?', options: [{ key: 'nights:2', label: '2 nights' }, { key: 'nights:3', label: '3 nights' }] } });
    expect(r.map((s) => s.question)).toEqual(['Which area?', 'Which weekend?', 'How long?']);
  });
  it('areas + what’s in them: a question per area for its courses and its places, optional, grouped by area', () => {
    const r = startRange(st, { courseMap: map, notes: { 'areacourse:Hunter Valley:c1': 'Parkland · ★4 for groups' } });
    expect(r.map((s) => s.question)).toEqual(['Which area?', 'Which weekend?', 'Hunter Valley: which courses?', 'Hunter Valley: where to stay?', 'South Coast NSW: which courses?', 'South Coast NSW: where to stay?']);
    expect(r[2].options[0].notes).toBe('Parkland · ★4 for groups');
    const g = groupBallot(r);
    expect(g.main.map((s) => s.question)).toEqual(['Which area?', 'Which weekend?']);
    expect(g.areas.map((a) => [a.area, a.polls.length])).toEqual([['Hunter Valley', 2], ['South Coast NSW', 2]]);
    expect(detailQuestion(r[2])).toBe('Which courses?');
    const rows = pollRows(r, { planId: 'p' });
    expect(rows[0].poll.optional).toBeUndefined(); // main questions: no new columns sent (works before 092)
    expect(rows[2].poll).toMatchObject({ optional: true, area: 'Hunter Valley' });
  });
  it('voters: area + weekends is "answered"; skipping the detail is never "still to answer"', () => {
    const polls = [{ id: 'a' }, { id: 'w' }, { id: 'd1', optional: true, area: 'Hunter Valley' }];
    const votes = [{ poll_id: 'a', player_id: 'p1' }, { poll_id: 'w', player_id: 'p1' }, { poll_id: 'a', player_id: 'p2' }, { poll_id: 'd1', player_id: 'p3' }];
    expect(hasAnsweredAll({ polls, votes, me: 'p1' })).toBe(true);
    expect(hasAnsweredAll({ polls, votes, me: 'p2' })).toBe(false);
    expect(batchNonVoters({ polls, votes, playerIds: ['p1', 'p2', 'p3'] })).toEqual(['p2', 'p3']);
    expect(detailCounts(polls, votes)).toEqual({ 'Hunter Valley': 1 });
  });
});

describe('the results by area (ov23)', () => {
  const st = { ...newState({}), regionOptions: ['Hunter Valley', 'South Coast NSW'], areaCourses: { 'Hunter Valley': ['c1', 'c2', 'c3'] },
    areaStays: { 'Hunter Valley': [{ key: 'Cessnock', name: 'Cessnock', lat: -32.83, lng: 151.36 }, { key: 'Pokolbin', name: 'Pokolbin', lat: -32.78, lng: 151.29 }] },
    courses: { c1: { id: 'c1', name: 'A', lat: -32.8, lng: 151.3 }, c2: { id: 'c2', name: 'B', lat: -32.8, lng: 151.31 }, c3: { id: 'c3', name: 'C', lat: -32.81, lng: 151.32 } } };
  const points = { 'area:Hunter Valley': 10, 'area:South Coast NSW': 4, 'areacourse:Hunter Valley:c3': 5, 'areacourse:Hunter Valley:c1': 2, 'stay:Pokolbin': 3 };
  it('the winner, and the courses and places inside each area ranked', () => {
    const r = areaVoteResults(st, points, { detail: { 'Hunter Valley': 4 } });
    expect(r.map((x) => [x.area, x.points, x.leading])).toEqual([['Hunter Valley', 10, true], ['South Coast NSW', 4, false]]);
    expect(r[0].courses.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
    expect(r[0].stays.map((s) => s.key)).toEqual(['Pokolbin', 'Cessnock']);
    expect(r[0].detail).toBe(4);
  });
  it('"Choose this one": the area, its favourites first and the voted places ticked; re-open keeps everything', () => {
    const s = chooseAreaFromVotes(st, 'Hunter Valley', points);
    expect(s.region).toBe('Hunter Valley');
    expect(s.areaCourses['Hunter Valley']).toEqual(['c3', 'c1', 'c2']);
    expect(s.stays.map((x) => x.key)).toEqual(['Pokolbin']);
    expect(s.days.find((d) => d.leg === 'stay').options.length).toBeGreaterThan(0);
    const back = reopenArea({ ...s, areaPool: ['Hunter Valley', 'South Coast NSW'] }, points);
    expect(back.runnerUp).toBe('South Coast NSW');
    expect(back.state.region).toBe(null);
    expect(back.state.regionOptions).toEqual(['Hunter Valley', 'South Coast NSW']);
    expect(back.state.areaCourses['Hunter Valley']).toEqual(['c3', 'c1', 'c2']);
  });
});

describe('one-line summaries on the vote card (ov23)', () => {
  it('course, place to stay, area', () => {
    expect(courseSummary({ course: { lat: -32.8, lng: 151.3 }, research: { details: { style: 'parkland' }, good_for_groups: 4, fee_weekday: 45, fee_weekend: 50 }, from: { lat: -32.83, lng: 151.36 } }))
      .toMatch(/^Parkland · ★4 for groups · \$45\/\$50 · about \d+ min$/);
    expect(courseSummary({ course: { mine_avg: 4.5 } })).toBe('★4.5 (ours)');
    expect(staySummary({ stay: { lat: -32.83, lng: 151.36 }, courseIds: ['a', 'b'], courseMap: { a: { lat: -32.8, lng: 151.3 }, b: { lat: -34, lng: 150 } } })).toBe('Town · 1 course within 30 min');
    expect(staySummary({ idea: { sleeps: 12, total_cost: 1200 }, nights: 2, people: 12 })).toBe('sleeps 12 · $600/night · about $100 a head');
    expect(areaSummary({ region: { lat: -32.8, lng: 151.3 }, courses: [{ id: 'a', lat: -32.8, lng: 151.31 }], research: { a: { fee_weekend: 80 } }, note: 'Wine country.' }))
      .toBe('1 course within 30 min · about $80 a round · Wine country.');
  });
});

describe('comps aren’t planning extras (ov23)', () => {
  it('no Ryder Cup in the extras; old saved lists are cleaned; the trophy purchase stays', () => {
    expect(startExtras().some((e) => /ryder/i.test(e.label))).toBe(false);
    const old = [...startExtras(), { key: 'ryder', label: 'Ryder Cup format (two teams)', state: 'vote' }, { key: 'own-x', label: 'Ryder Cup', own: true, state: 'vote' }, { key: 'own-f', label: 'Footy tipping comp', own: true, state: 'vote' }];
    const clean = planningExtras(old);
    expect(clean.some((e) => /ryder/i.test(e.label))).toBe(false);
    expect(clean.some((e) => e.key === 'own-f')).toBe(true);
    expect(clean.some((e) => e.key === 'trophy')).toBe(true);
    expect(extrasSection(old).options.map((o) => o.label)).toEqual(['Footy tipping comp']);
    expect(extrasSection(setExtraState(startExtras(), 'bus', 'vote')).options.length).toBe(1);
  });
});

describe('the plan chat’s head count (ov23)', () => {
  it('the helper’s "how many" goes in, unless the organiser set their own', async () => {
    const { mergeDraftIntoBuild } = await import('./planchat.js');
    const draft = { places: [], dates: [], extras: [{ label: 'Ryder Cup format' }], headcount: 9 };
    expect(mergeDraftIntoBuild(null, draft, [])).toMatchObject({ headcount: 9, headcountBy: 'ai' });
    expect(mergeDraftIntoBuild({ headcount: 12, headcountBy: 'organiser', weekends: [] }, draft, [])).toMatchObject({ headcount: 12, headcountBy: 'organiser' });
    expect(mergeDraftIntoBuild({ headcount: 7, headcountBy: 'ai', weekends: [] }, draft, []).headcount).toBe(9);
  });
});
