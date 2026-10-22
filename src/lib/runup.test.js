import { describe, it, expect } from 'vitest';
import {
  stageLook, stageTag, stageSections, organisingWords, daysToGo, monthYear, winnerLine, mainTrophy, sideItems, soonestOrganising,
  showRunUp, countdownHeader, runUpSections, myTodos, todoForReminder, carsView, joinProblem, roomsView, activityMoney, cleanActivity,
  bringView, bringAskText, bringAskLink, bringAskPlan, claimPostText, bringEmoji, tippingState, tipResult, tipTally, sydneyNow,
  weekOutMessage, dayBeforeLine, dayBeforeMessage, teeWords, myDayBefore, trendWords, formGuide,
} from './runup.js';
import { sortTrips } from './trips.js';
import { buildHistory } from './stats.js';

const T = '2026-02-18'; // "today" in these tests
const P = (id, extra = {}) => ({ id, name: id, status: 'planning', proposed: false, created_at: '2026-01-01', ...extra });

describe('stage → label and look', () => {
  it('gives every stage its own label, icon and class', () => {
    const looks = ['on', 'locked', 'deciding', 'idea', 'done', 'cancelled'].map(stageLook);
    expect(looks.map((l) => l.label)).toEqual(['On now', 'Upcoming', 'Being organised', 'Proposed', 'Previous', 'Called off']);
    expect(looks.map((l) => l.icon)).toEqual(['⛳', '🔒', '🧭', '💡', '🏁', '✖️']);
    expect(new Set(looks.map((l) => l.cls)).size).toBe(6);
    expect(stageLook('weird').label).toBe('Being organised');
  });
  it('tags each stage', () => {
    expect(stageTag({ stage: 'locked', plan: P('a', { start_date: '2026-03-06' }), today: T })).toBe('16 days');
    expect(stageTag({ stage: 'on', plan: P('a'), dayWords: 'Day 2 of 3' })).toBe('Day 2 of 3');
    expect(stageTag({ stage: 'deciding', plan: P('a'), polls: [{ plan_id: 'a', kind: 'dates', status: 'open' }] })).toBe('voting on dates');
    expect(stageTag({ stage: 'deciding', plan: P('a', { start_date: '2026-03-06', location_name: 'Hunter' }) })).toBe('calling courses');
    expect(stageTag({ stage: 'idea', plan: P('a'), rsvps: [{ plan_id: 'a', status: 'in' }, { plan_id: 'a', status: 'in' }, { plan_id: 'a', status: 'in' }, { plan_id: 'b', status: 'in' }] })).toBe('3 keen');
    expect(stageTag({ stage: 'done', plan: P('a', { start_date: '2025-10-16', end_date: '2025-10-18' }) })).toBe('Oct 2025');
    expect(stageTag({ stage: 'cancelled', plan: P('a') })).toBe('Called off');
  });
  it('words for what a trip being organised is up to', () => {
    expect(organisingWords(P('a'), [{ plan_id: 'a', kind: 'dates' }, { plan_id: 'a', kind: 'location' }])).toBe('voting on dates and where');
    expect(organisingWords(P('a'), [{ plan_id: 'a', kind: 'location' }])).toBe('voting on where');
    expect(organisingWords(P('a'), [{ plan_id: 'a', kind: 'other' }])).toBe('voting');
    expect(organisingWords(P('a'), [{ plan_id: 'x', kind: 'dates' }])).toBe('getting started');
  });
  it('counts down and names months', () => {
    expect(daysToGo('2026-02-19', T)).toBe('Tomorrow');
    expect(daysToGo('2026-02-18', T)).toBe('Today');
    expect(daysToGo('2026-05-18', T)).toBe('13 weeks');
    expect(monthYear('2025-10-18')).toBe('Oct 2025');
  });
  it('picks the main trophy for the winner line', () => {
    const h = [{ trophy_name: 'Ambrose Cup', winner_names: 'Al & Bo' }, { trophy_name: 'BD Trophy', winner_names: 'Mike' }];
    expect(mainTrophy(h).trophy_name).toBe('BD Trophy');
    expect(winnerLine(h)).toBe('🏆 BD Trophy: Mike');
    expect(winnerLine([])).toBe('');
  });
  it('sorts the Trips list into stage sections in order', () => {
    const plans = [
      P('idea', { proposed: true }), P('org'), P('up', { status: 'confirmed', start_date: '2026-03-06', end_date: '2026-03-08' }),
      P('old', { status: 'done', start_date: '2025-10-16', end_date: '2025-10-18' }), P('off', { status: 'cancelled' }),
      P('now', { status: 'confirmed', start_date: '2026-02-17', end_date: '2026-02-19' }),
    ];
    const s = stageSections(sortTrips(plans, [], T));
    expect(s.map((x) => x.look.label)).toEqual(['On now', 'Upcoming', 'Being organised', 'Proposed', 'Previous', 'Called off']);
    expect(s.map((x) => x.items.map((i) => i.plan.id))).toEqual([['now'], ['up'], ['org'], ['idea'], ['old'], ['off']]);
  });
});

describe('sidebar sub-items', () => {
  const hunter = { id: 't1', name: 'Hunter', start_date: '2026-03-06' };
  const sc = { id: 't0', name: 'South Coast' };
  it('labels by stage, at most three', () => {
    const items = sideItems({ menu: { now: { trip: hunter, on: false }, next: null, last: sc }, organising: { id: 'p', name: 'March' }, today: T });
    expect(items.map((x) => x.label)).toEqual(['Upcoming: Hunter · 16 days', 'Being organised: March', 'Previous: South Coast']);
  });
  it('while a trip is on: On now, Upcoming, Being organised (Previous waits)', () => {
    const items = sideItems({ menu: { now: { trip: { id: 'n', name: 'Now trip' }, on: true }, next: hunter, last: sc }, organising: { id: 'p', name: 'March' }, today: T });
    expect(items.map((x) => x.kind)).toEqual(['on', 'upcoming', 'organising']);
  });
  it('two trips coming up: the second Upcoming goes before Being organised or Previous', () => {
    const items = sideItems({ menu: { now: { trip: hunter, on: false }, next: { id: 't2', name: 'Xmas', start_date: '2026-12-12' }, last: sc }, organising: { id: 'p', name: 'March' }, today: T });
    expect(items.map((x) => x.label)).toEqual(['Upcoming: Hunter · 16 days', 'Being organised: March', 'Previous: South Coast']);
  });
  it('finds the soonest trip being organised', () => {
    const a = P('a', { start_date: '2026-09-01' }); const b = P('b', { start_date: '2026-04-01' }); const c = P('c');
    expect(soonestOrganising([{ plan: a, stage: 'deciding' }, { plan: b, stage: 'deciding' }, { plan: c, stage: 'idea' }]).id).toBe('b');
    expect(soonestOrganising([])).toBe(null);
  });
});

describe('the run-up page', () => {
  it('shows only on an Upcoming (locked in) trip', () => {
    expect(['idea', 'deciding', 'locked', 'on', 'done', 'cancelled'].filter(showRunUp)).toEqual(['locked']);
  });
  it('has a countdown header', () => {
    expect(countdownHeader({ start_date: '2026-03-06', end_date: '2026-03-08', location_name: 'Hunter Valley' }, T))
      .toBe('16 days to go · Hunter Valley · Fri 6 – Sun 8 Mar 2026');
    expect(countdownHeader({ start_date: '2026-02-19', location_name: 'Hunter' }, T)).toMatch(/^Tomorrow · Hunter/);
  });
  it('shows sections by feature and the tipping switch', () => {
    expect(runUpSections()).toEqual(['todos', 'getting_there', 'votes', 'up_for_grabs', 'rules', 'activities', 'bring', 'form', 'tipping', 'chat']);
    const off = runUpSections({ feature: (k) => k !== 'planner_rooms' && k !== 'stats', tippingOff: true });
    expect(off).not.toContain('getting_there');
    expect(off).not.toContain('form');
    expect(off).not.toContain('tipping');
    expect(off[0]).toBe('todos');
  });
});

describe('your to-dos', () => {
  const plan = { id: 'p', deposit_pp: 300, start_date: '2026-03-06' };
  const base = { me: 'm', plan, today: T };
  it('lists what is waiting, late jobs first', () => {
    const todos = myTodos({
      ...base,
      rsvps: [{ player_id: 'm', status: 'in' }],
      transfers: [],
      items: [
        { id: 'j1', kind: 'job', title: 'Book the bus', owner_id: 'm', due: '2026-02-01' },
        { id: 'j2', kind: 'job', title: 'Trophy', owner_id: 'm', due: '2026-03-01' },
        { id: 'j3', kind: 'job', title: 'Not mine', owner_id: 'x' },
        { id: 'b1', kind: 'bring', title: 'Speaker', owner_id: 'm', bring_shared: true },
      ],
      lateRuleV: { on: true, strokes: 2, days: 5 },
      player: { handicap: 14 },
      tipping: { open: true, closesWords: 'at the first tee' },
    });
    expect(todos.map((t) => t.key)).toEqual(['job-j1', 'deposit', 'job-j2', 'bring', 'handicap', 'tip']);
    expect(todos[0].detail).toBe('⚠️ 17 days late — 2 penalty strokes if it’s not done before the next round');
    expect(todos.find((t) => t.key === 'bring').title).toBe('You’re bringing: Speaker');
    expect(todos.find((t) => t.key === 'handicap').title).toBe('Check your handicap (14)');
  });
  it('asks a maybe to decide, drops paid deposits, checked handicaps and a tip already in', () => {
    const todos = myTodos({ ...base, rsvps: [{ player_id: 'm', status: 'maybe' }], transfers: [{ from_id: 'm', to_id: null, amount: 300, confirmed: true }],
      mine: { handicap_checked_at: '2026-02-10' }, tipping: { open: true }, myTip: { pick_id: 'x' } });
    expect(todos.map((t) => t.key)).toEqual(['reply']);
  });
  it('gives the reminder its counts', () => {
    const r = todoForReminder([{ key: 'reply' }, { key: 'job-1', action: 'job', title: 'Bus' }, { key: 'handicap' }]);
    expect(r).toEqual({ reply: true, deposit: null, jobs: ['Bus'], handicap: true, tip: false });
  });
});

describe('getting there: cars', () => {
  const groups = [
    { id: 'c1', kind: 'car', name: 'Josh’s car', capacity: 3, driver_id: 'josh', pickup_place: 'Leichhardt', pickup_time: '6:30am Fri' },
    { id: 'c2', kind: 'car', name: 'Al’s ute', capacity: 2, driver_id: 'al' },
    { id: 'r1', kind: 'room', name: 'Room 3', capacity: 2 },
  ];
  const members = [{ group_id: 'c1', player_id: 'hamish' }, { group_id: 'c1', player_id: 'josh' }, { group_id: 'c2', player_id: 'al' }, { group_id: 'c2', player_id: 'bo' },
    { group_id: 'r1', player_id: 'josh' }, { group_id: 'r1', player_id: 'hamish' }];
  const rsvps = ['josh', 'hamish', 'al', 'bo', 'cy', 'di'].map((id) => ({ player_id: id, status: 'in' }));
  const people = [{ player_id: 'cy', needs_lift: true }];
  it('counts seats, the driver first, who needs a lift and who is unsorted', () => {
    const v = carsView({ groups, members, people, rsvps, me: 'cy' });
    expect(v.cars.map((c) => [c.name, c.taken, c.free])).toEqual([['Josh’s car', 2, 1], ['Al’s ute', 2, 0]]);
    expect(v.cars[0].people[0]).toBe('josh');
    expect(v.cars[0].pickup).toBe('Leichhardt 6:30am Fri');
    expect(v.needLift).toEqual(['cy']);
    expect(v.unsorted).toEqual(['di']);
    expect(v.iNeedLift).toBe(true);
    expect(v.seatsSpare).toBe(1);
    expect(v.seatsShort).toBe(0);
  });
  it('says when you can and can’t hop in', () => {
    const v = carsView({ groups, members, people, rsvps, me: 'cy' });
    expect(joinProblem(v.cars[0], 'cy', v)).toBe('');
    expect(joinProblem(v.cars[1], 'cy', v)).toBe('Al’s ute is full');
    const j = carsView({ groups, members, people, rsvps, me: 'josh' });
    expect(joinProblem(j.cars[1], 'josh', j)).toBe('You’re driving your own car');
    expect(joinProblem(j.cars[0], 'josh', j)).toBe('You’re in this car');
  });
  it('knows who you share a room with', () => {
    expect(roomsView({ groups, members, me: 'josh' }).mine).toEqual({ name: 'Room 3', with: ['hamish'] });
  });
});

describe('side activities', () => {
  it('splits the cost each between those in', () => {
    const a = { id: 'a', cost_pp: 40 };
    const ppl = [{ activity_id: 'a', player_id: 'm' }, { activity_id: 'a', player_id: 'x' }, { activity_id: 'a', player_id: 'y' }, { activity_id: 'b', player_id: 'm' }];
    const m = activityMoney(a, ppl, 'm');
    expect(m).toMatchObject({ each: 40, count: 3, total: 120, mine: 40 });
    expect(m.line).toBe('$40 each · 3 in · $120 into the kitty');
    expect(activityMoney(a, ppl, 'z').mine).toBe(0);
    expect(activityMoney({ id: 'b', cost_pp: null }, ppl, 'm').line).toBe('Free · 1 in');
  });
  it('cleans what was typed', () => {
    expect(cleanActivity({ title: '  Go-karts ', cost_pp: '$40', link: 'karts.com.au', time: '4pm' }))
      .toEqual({ title: 'Go-karts', day: null, time: '4pm', place: null, cost_pp: 40, link: 'https://karts.com.au' });
    expect(cleanActivity({ title: '' }).error).toBeTruthy();
    expect(cleanActivity({ title: 'x', cost_pp: 'lots' }).error).toBeTruthy();
  });
});

describe('what to bring', () => {
  const items = [
    { id: '1', kind: 'bring', title: 'Speaker', bring_shared: true, owner_id: null },
    { id: '2', kind: 'bring', title: 'Esky', bring_shared: true, owner_id: 'h' },
    { id: '3', kind: 'bring', title: 'Cards', bring_shared: true, owner_id: null },
    { id: '4', kind: 'bring', title: 'Golf shoes', bring_shared: false },
  ];
  it('splits shared things into claimed and nobody yet', () => {
    const v = bringView(items);
    expect(v.open.map((i) => i.title)).toEqual(['Speaker', 'Cards']);
    expect(v.claimed.map((i) => i.title)).toEqual(['Esky']);
    expect(v.personal.map((i) => i.title)).toEqual(['Golf shoes']);
  });
  it('writes ONE ask-the-group post listing the unclaimed things', () => {
    expect(bringAskText(bringView(items).open)).toBe('Can anyone help with these? 🔊 Speaker · 🃏 Cards — tap to say you’ll bring it');
    expect(bringAskText([])).toBe('');
    const id = '11111111-2222-4333-8444-555555555555';
    expect(bringAskPlan(bringAskLink(id))).toBe(id);
    expect(bringAskPlan('/plan/abc')).toBe(null);
  });
  it('writes the optional claim line', () => {
    expect(claimPostText({ nickname: 'Hamish' }, { title: 'Speaker' })).toBe('🔊 Hamish is bringing the speaker');
    expect(bringEmoji('Esky')).toBe('🧊');
    expect(bringEmoji('Pool noodles')).toBe('🎒');
  });
});

describe('tipping', () => {
  const plan = { id: 'p', status: 'confirmed', start_date: '2026-03-06' };
  const rounds = [{ id: 'r2', play_date: '2026-03-07', status: 'setup' }, { id: 'r1', play_date: '2026-03-06', status: 'setup' }];
  const tees = [{ round_id: 'r1', tee_time: '10:00' }, { round_id: 'r1', tee_time: '9:12' }, { round_id: 'r2', tee_time: '07:00' }];
  const at = (s) => new Date(s); // UTC instants; Sydney is UTC+11 in March
  it('locks at the first tee of the first round (Sydney time)', () => {
    const before = tippingState({ plan, rounds, teeGroups: tees, now: at('2026-03-05T22:11:00Z') }); // 9:11am Sydney
    expect(before.closesAt).toBe('2026-03-06 09:12');
    expect(before.open).toBe(true);
    expect(before.closesWords).toBe('at the first tee (9:12am Fri 6 Mar)');
    expect(tippingState({ plan, rounds, teeGroups: tees, now: at('2026-03-05T22:12:00Z') }).open).toBe(false);
  });
  it('falls back to 7am, and closes once a round is under way or tipping is off', () => {
    expect(tippingState({ plan, rounds: [], now: at('2026-02-01T00:00:00Z') }).closesAt).toBe('2026-03-06 07:00');
    expect(tippingState({ plan, rounds: [{ ...rounds[1], status: 'live' }], now: at('2026-02-01T00:00:00Z') }).open).toBe(false);
    expect(tippingState({ plan: { ...plan, tipping_off: true } }).off).toBe(true);
    expect(tippingState({ plan: { ...plan, status: 'planning' }, now: at('2026-02-01T00:00:00Z') }).open).toBe(false);
  });
  it('reads Sydney time', () => {
    expect(sydneyNow(at('2026-03-05T22:11:00Z'))).toBe('2026-03-06 09:11');
  });
  it('names the best tipster', () => {
    const pb = { m: { nickname: 'Mike' }, a: { nickname: 'Al' }, j: { nickname: 'Josh' } };
    const tips = [{ player_id: 'm', pick_id: 'j' }, { player_id: 'a', pick_id: 'm' }, { player_id: 'j', pick_id: 'j' }];
    expect(tipResult({ tips, winnerIds: ['j'], playersById: pb }).line).toBe('Best tipsters: Mike and Josh');
    expect(tipResult({ tips: tips.slice(1, 2), winnerIds: ['j'], playersById: pb }).line).toBe('Nobody tipped Josh');
    expect(tipResult({ tips, winnerIds: [] }).line).toBe('');
    expect(tipTally(tips)).toEqual([{ id: 'j', n: 2 }, { id: 'm', n: 1 }]);
  });
});

describe('reminders', () => {
  it('a week out: only when something is waiting', () => {
    expect(weekOutMessage('Hunter', {})).toBe(null);
    const m = weekOutMessage('Hunter', { deposit: '$300', jobs: ['Book the bus'], handicap: true });
    expect(m.title).toBe('⛳ Hunter is a week away — 3 things waiting for you');
    expect(m.body).toBe('Pay your $300 deposit · Job: Book the bus · Check your handicap');
  });
  it('the day before: car, room, tee time and what you’re bringing', () => {
    const line = dayBeforeLine({
      car: { name: 'Josh’s car', driver: { nickname: 'Josh' }, pickup_place: 'Leichhardt', pickup_time: '6:30am Fri' },
      room: { name: 'Room 3', with: [{ nickname: 'Hamish' }] }, tee: '09:12', bring: ['Speaker'],
    });
    expect(line).toBe('Your car: Josh’s, pick-up Leichhardt 6:30am Fri · Room 3 with Hamish · tee time 9:12 · You’re bringing: speaker');
    expect(dayBeforeLine({ car: { name: 'Car 1', driving: true } })).toBe('Your car: you’re driving');
    expect(dayBeforeMessage('Hunter', 'Pokolbin', {}).body).toBe('Pokolbin · Check the details and what to bring.');
    expect(teeWords('13:05')).toBe('1:05pm');
  });
  it('builds my line from the app’s data', () => {
    const v = carsView({ groups: [{ id: 'c', kind: 'car', name: 'Josh’s car', capacity: 3, driver_id: 'j', pickup_place: 'Leichhardt', pickup_time: '6:30am Fri' }],
      members: [{ group_id: 'c', player_id: 'j' }, { group_id: 'c', player_id: 'h' }], me: 'h' });
    const rooms = roomsView({ groups: [{ id: 'r', kind: 'room', name: 'Room 3' }], members: [{ group_id: 'r', player_id: 'h' }, { group_id: 'r', player_id: 'j' }], me: 'h' });
    const line = myDayBefore({ me: 'h', carView: v, rooms, teeTime: '09:12', items: [], playersById: { j: { nickname: 'Josh' } } });
    expect(line).toBe('Your car: Josh’s, pick-up Leichhardt 6:30am Fri · Room 3 with Josh · tee time 9:12');
  });
});

describe('form guide', () => {
  it('shows last rounds, the handicap trend and the best result at the trip’s courses', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
    const course = { id: 'cA', name: 'Cypress Lakes', holes };
    const other = { id: 'cB', name: 'Kiama', holes };
    const rounds = [
      { id: 'r1', course_id: 'cA', format: 'stableford', status: 'locked', play_date: '2025-03-01' },
      { id: 'r2', course_id: 'cB', format: 'stableford', status: 'locked', play_date: '2025-10-01' },
    ];
    const scoresIdx = { r1: { m: Object.fromEntries(holes.map((h) => [h.n, { strokes: 4 }])) }, r2: { m: Object.fromEntries(holes.map((h) => [h.n, { strokes: 5 }])) } };
    const data = { rounds, trips: [], coursesById: { cA: course, cB: other }, roundPlayers: { r1: [{ player_id: 'm', playing_handicap: 18 }], r2: [{ player_id: 'm', playing_handicap: 16 }] },
      teamsByRound: {}, playersById: { m: { id: 'm', name: 'Mike' } }, quick_results: [], honour_board: [], trophies: [] };
    const [f] = formGuide(buildHistory(data, scoresIdx), ['m'], ['cA']);
    expect(f.last.map((r) => r.course)).toEqual(['Kiama', 'Cypress Lakes']);
    expect(f.trend).toMatchObject({ from: 18, to: 16, dir: 'down' });
    expect(trendWords(f.trend)).toBe('↓ 18 → 16');
    expect(f.best).toMatchObject({ course: 'Cypress Lakes' });
    expect(f.best.points).toBeGreaterThan(f.last[0].points);
  });
});
