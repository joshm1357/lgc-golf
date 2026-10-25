import { describe, it, expect } from 'vitest';
import {
  fridayOf, upcomingFridays, tripDayKeys, toggleCant, wishRow, summariseWishes, dateFit, travelFit, spendFit, fitLine,
  tally, nextReaction, lists, outsideDefinition, newItem, itemsFromIdea, builderFromPicks, voteToCall, leftovers,
  ideaShape, feedLine, shareMessage, ideaCard, ideaLink, pullTogetherText, homeBase, areaDrive, itemFit, tapsDone, caddieContext,
} from './ideas.js';

const stayAreas = [
  { name: 'Pokolbin', region: 'Hunter Valley', state: 'NSW', lat: -32.78, lng: 151.29 },
  { name: 'Cessnock', region: 'Hunter Valley', state: 'NSW', lat: -32.83, lng: 151.36 },
  { name: 'Kiama', region: 'South Coast NSW', state: 'NSW', lat: -34.67, lng: 150.85 },
];
const W = (o) => ({ cant_dates: [], ...o });

describe('dates', () => {
  it('finds the weekend’s Friday', () => {
    expect(fridayOf('2027-03-12')).toBe('2027-03-12'); // Fri
    expect(fridayOf('2027-03-13')).toBe('2027-03-12'); // Sat
    expect(fridayOf('2027-03-14')).toBe('2027-03-12'); // Sun
    expect(fridayOf('2027-03-15')).toBe('2027-03-12'); // Mon
    expect(fridayOf('2027-03-11')).toBe('2027-03-12'); // Thu
    expect(fridayOf('nope')).toBe(null);
  });
  it('lists the coming Fridays', () => {
    expect(upcomingFridays('2026-10-25', 3)).toEqual(['2026-10-30', '2026-11-06', '2026-11-13']);
    expect(upcomingFridays('2026-10-30', 1)).toEqual(['2026-10-30']);
  });
  it('knows the trip’s days', () => {
    expect(tripDayKeys({})).toEqual(['fri', 'sat', 'sun']);
    expect(tripDayKeys({ nights: 3 })).toEqual(['fri', 'sat', 'sun', 'mon']);
    expect(tripDayKeys({ nights: 0 })).toEqual(['sat']);
    expect(tripDayKeys({ nights: 5 })).toEqual(['thu', 'fri', 'sat', 'sun', 'mon']);
    expect(tripDayKeys({ weekend: { start: '2027-03-13', end: '2027-03-14' } })).toEqual(['sat', 'sun']);
  });
  it('toggles a weekend I can’t do', () => {
    expect(toggleCant(['2027-03-19'], '2027-03-12')).toEqual(['2027-03-12', '2027-03-19']);
    expect(toggleCant(['2027-03-12'], '2027-03-12')).toEqual([]);
  });
});

describe('the 4 quick taps', () => {
  it('cleans a row to the database’s shape', () => {
    const r = wishRow('p', 'me', { cant_dates: ['2027-03-12', '2027-03-13', '2027-03-12'], spend_band: 'heaps', travel: 'fly', max_drive_min: '180', golf_per_day: 'daily', day_prefs: { fri: 'late', sun: 'early', tue: 'early', sat: 'brunch' }, home_by: '16:00:00', wish: '  Barnbougle please ' });
    expect(r).toEqual({ plan_id: 'p', player_id: 'me', cant_dates: ['2027-03-12'], spend_band: null, travel: 'fly', max_drive_min: 180, golf_per_day: 'daily', day_prefs: { fri: 'late', sun: 'early' }, home_by: '16:00', wish: 'Barnbougle please' });
  });
  it('counts the taps done', () => {
    expect(tapsDone({ spend_band: 'any', travel: 'drive' })).toBe(2);
    expect(tapsDone({ cant_dates: ['x'], spend_band: 'any', travel: 'drive', golf_per_day: 'daily' })).toBe(4);
    expect(tapsDone({}, { weekendFixed: true, rsvp: 'in' })).toBe(1);
  });
  it('sums up the group’s answers in one line', () => {
    const ws = [
      W({ cant_dates: ['2027-03-12'], travel: 'fly', spend_band: '500_800', golf_per_day: 'daily', day_prefs: { sat: 'midday' }, max_drive_min: 180, wish: 'Barnbougle' }),
      W({ cant_dates: ['2027-03-12'], travel: 'either', spend_band: '500_800', golf_per_day: 'daily', day_prefs: { sat: 'midday' }, max_drive_min: 240, home_by: '17:00' }),
      W({ travel: 'drive', spend_band: 'lt500', golf_per_day: 'max', max_drive_min: 120, home_by: '15:30' }),
    ];
    const s = summariseWishes(ws);
    expect(s.answered).toBe(3);
    expect(s.cant[0]).toEqual({ fri: '2027-03-12', n: 2 });
    expect(s.fly).toBe(2);
    expect(s.maxDrive).toBe(180);
    expect(s.homeBy).toBe('15:30');
    expect(s.line).toBe('3 answered · most can’t do 12 Mar · 2 happy to fly · most say $500–800 · most want a round a day, play midday Sat');
    expect(summariseWishes([]).line).toBe('Nobody’s answered yet');
  });
  it('with the weekend fixed, says who can make it instead', () => {
    const s = summariseWishes([W({})], { fixed: { weekend: { start: '2027-03-12', end: '2027-03-14' }, set: ['weekend'] }, rsvps: [{ status: 'in' }, { status: 'in' }, { status: 'out' }] });
    expect(s.line).toBe('1 answered · 2 can make 12 Mar, 1 can’t');
  });
});

describe('fit lines', () => {
  const ws = [W({ cant_dates: ['2027-03-12'], travel: 'drive', max_drive_min: 120, spend_band: 'lt500' }), W({ travel: 'fly', max_drive_min: 240, spend_band: '800_1200' }), W({})];
  it('a weekend: who can do it', () => expect(dateFit({ start_date: '2027-03-13' }, ws)).toEqual({ can: 2, of: 3 }));
  it('travel: within their drive, or happy to fly', () => {
    expect(travelFit({ driveMin: 170 }, ws)).toEqual({ fits: 2, of: 3 });
    expect(travelFit({ fly: true }, ws)).toEqual({ fits: 2, of: 3 });
  });
  it('spend', () => expect(spendFit(750, ws)).toEqual({ fits: 2, of: 3 }));
  it('reads as one line', () => {
    expect(fitLine({ fit: { can: 9, of: 11 }, driveMin: 170, costEach: 748 })).toBe('suits 9 of 11 · within 3 h · about $750 each');
    expect(fitLine({ fit: { fits: 6, of: 9 }, fly: { flightMin: 150 }, costEach: 1200 })).toBe('suits 6 of 9 · 2½ h flight');
  });
  it('an area’s drive from home, and its line', () => {
    const base = homeBase([{ lat: -33.88, lng: 151.16, headcount: 10 }], []);
    const d = areaDrive('Hunter', stayAreas, base);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(220);
    expect(itemFit({ kind: 'area', label: 'Hunter Valley' }, { wishes: ws, stayAreas, base })).toMatch(/^suits \d of 3 · within \d h$/);
    expect(itemFit({ kind: 'area', label: 'Nowhere' }, { wishes: ws, stayAreas, base })).toBe('');
    expect(itemFit({ kind: 'area', label: 'X', fit: 'the Caddie’s' }, {})).toBe('the Caddie’s');
    expect(homeBase([], [])).toBe(null);
  });
});

describe('the lists', () => {
  const items = [
    { id: 'a1', kind: 'area', label: 'Hunter Valley', status: 'in', created_at: '1' },
    { id: 'a2', kind: 'area', label: 'Port Douglas', status: 'in', created_at: '2', by_ai: true },
    { id: 'd2', kind: 'date', label: 'b', start_date: '2027-03-19', end_date: '2027-03-21', status: 'in' },
    { id: 'd1', kind: 'date', label: 'a', start_date: '2027-03-12', end_date: '2027-03-14', status: 'in' },
    { id: 'q', kind: 'area', label: 'Hobart', status: 'queued' },
    { id: 'x', kind: 'area', label: 'Bali', status: 'declined', decline_note: 'Too far' },
  ];
  const rx = [{ item_id: 'a2', player_id: 'me', value: 1 }, { item_id: 'a2', player_id: 'b', value: 1 }, { item_id: 'a1', player_id: 'c', value: -1 }];
  it('tallies 👍 / 👎', () => {
    expect(tally(rx, 'me').a2).toEqual({ up: 2, down: 0, mine: 1 });
    expect(nextReaction(1, 1)).toBe(0);
    expect(nextReaction(-1, 1)).toBe(1);
  });
  it('sorts each list and keeps the queue apart', () => {
    const l = lists(items, rx, 'me');
    expect(l.area.map((i) => i.id)).toEqual(['a2', 'a1']);
    expect(l.date.map((i) => i.id)).toEqual(['d1', 'd2']);
    expect(l.queued.map((i) => i.id)).toEqual(['q']);
    expect(l.declined[0].decline_note).toBe('Too far');
  });
  it('knows what’s outside the definition', () => {
    expect(outsideDefinition({ kind: 'date' }, { weekend: { start: '2027-03-12' }, set: ['weekend'] })).toBe(true);
    expect(outsideDefinition({ kind: 'date' }, { weekend: { start: '2027-03-12' }, set: [] })).toBe(false); // open to ideas
    expect(outsideDefinition({ kind: 'area', label: 'hunter valley' }, { area: 'Hunter Valley', set: ['area'] })).toBe(false);
    expect(outsideDefinition({ kind: 'area', label: 'Kiama' }, { area: 'Hunter Valley', set: ['area'] })).toBe(true);
    expect(outsideDefinition({ kind: 'area', label: 'Kiama' }, { area: 'Hunter Valley' })).toBe(false);
    expect(outsideDefinition({ kind: 'course', label: 'X' }, { area: 'Hunter Valley', set: ['area'] })).toBe(false);
    expect(outsideDefinition({ kind: 'area', label: 'Kiama' }, {})).toBe(false);
  });
  it('makes new items', () => {
    expect(newItem('date', { start: '2027-03-13', nights: 2 })).toMatchObject({ kind: 'date', start_date: '2027-03-12', end_date: '2027-03-14', label: 'Fri 12 – Sun 14 Mar' });
    expect(newItem('date', { start: '2027-03-12', nights: 1 })).toMatchObject({ start_date: '2027-03-13', end_date: '2027-03-14' });
    expect(newItem('area', { label: '  Port   Macquarie ' })).toMatchObject({ label: 'Port Macquarie' });
    expect(newItem('area', { label: 'x' }).error).toBeTruthy();
    expect(newItem('course', { label: 'Sea Temple', area: 'Port Douglas' })).toMatchObject({ area: 'Port Douglas' });
  });
  it('turns a Caddie idea card into ✨ items', () => {
    const out = itemsFromIdea({ area: 'Port Douglas', why: 'Reef and two good courses', fit: 'fits 6 of 9 · 2½ h flight', fly: { from: 'SYD', to: 'CNS', flight_min: 180, first_out: '6am', last_back: '9pm' }, courses: ['Sea Temple', { name: 'Palmer Sea Reef', library_id: 'L1' }], weekend: '2027-05-14' });
    expect(out.map((i) => i.kind)).toEqual(['area', 'course', 'course', 'date']);
    expect(out.every((i) => i.by_ai)).toBe(true);
    expect(out[0].detail.fly.flight_min).toBe(180);
    expect(out[2].library_course_id).toBe('L1');
    expect(out[3].start_date).toBe('2027-05-14');
  });
});

describe('tidy → vote, and the leftovers', () => {
  const items = [
    { id: 'd1', kind: 'date', start_date: '2027-03-19', end_date: '2027-03-21', picked: true, status: 'in' },
    { id: 'd2', kind: 'date', start_date: '2027-03-12', end_date: '2027-03-14', picked: true, status: 'in' },
    { id: 'd3', kind: 'date', start_date: '2027-04-09', end_date: '2027-04-11', picked: false, status: 'in' },
    { id: 'a1', kind: 'area', label: 'Hunter', picked: true, status: 'in' },
    { id: 'a2', kind: 'area', label: 'Kiama', picked: true, status: 'in' },
    { id: 'c1', kind: 'course', label: 'The Vintage', area: 'Hunter Valley', library_course_id: 'L9', picked: true, status: 'in' },
    { id: 'c2', kind: 'course', label: 'No library', picked: true, status: 'in' },
    { id: 'q', kind: 'area', label: 'Hobart', picked: false, status: 'queued' },
  ];
  it('fills the builder for the When? / Where? votes', () => {
    const st = builderFromPicks({ nights: 2, areaCourses: {} }, items, { stayAreas, fits: { d2: 'fits 9 of 11', a1: 'fits 8 of 11 · within 3 h' } });
    expect(st.weekends.map((w) => w.start)).toEqual(['2027-03-12', '2027-03-19']);
    expect(st.regionOptions).toEqual(['Hunter Valley', 'South Coast NSW']);
    expect(st.region).toBe(null);
    expect(st.areaCourses['Hunter Valley']).toEqual(['L9']);
    expect(st.fitNotes).toEqual({ 'weekend:2027-03-12': 'fits 9 of 11', 'area:Hunter Valley': 'fits 8 of 11 · within 3 h' });
    expect(voteToCall(st)).toBe('both');
  });
  it('one area → it’s the area; one weekend → settled', () => {
    const st = builderFromPicks({}, [items[0], items[3]], { stayAreas });
    expect(st.region).toBe('Hunter Valley');
    expect(st.weekendsSettled).toBe(true);
    expect(voteToCall(st)).toBe(null);
    expect(voteToCall(builderFromPicks({}, [items[0], items[1], items[3]], { stayAreas }))).toBe('when');
  });
  it('the fixed parts stand in when nothing’s ticked for them', () => {
    const st = builderFromPicks({}, [items[3], items[4]], { stayAreas, fixed: { weekend: { start: '2027-05-14', end: '2027-05-16' }, nights: 2 } });
    expect(st.weekends).toEqual([{ start: '2027-05-14', end: '2027-05-16', long: false }]);
    expect(voteToCall(st)).toBe('where');
  });
  it('leftovers are the unticked ones on the list', () => expect(leftovers(items).map((i) => i.id)).toEqual(['d3']));
});

describe('sharing', () => {
  const plan = { name: 'March fly trip', idea_when: 'March', idea_where: 'Somewhere we fly to', idea_travel: 'fly' };
  it('says the shape so far', () => {
    expect(ideaShape(plan)).toBe('March · Somewhere we fly to');
    expect(ideaShape({ idea_when: 'Autumn', idea_travel: 'drive' })).toBe('Autumn · driving');
    expect(ideaShape({ idea_fixed: { weekend: { start: '2027-03-12', end: '2027-03-14' }, area: 'Hunter Valley' } })).toBe('Fri 12 – Sun 14 Mar · Hunter Valley');
  });
  it('writes the feed line and the chat message', () => {
    expect(feedLine(plan, 'Chris')).toBe('💡 Chris has a trip idea: March, Somewhere we fly to. Add your ideas — 4 quick taps.');
    expect(shareMessage(plan, 'Chris', 'https://x/i/T')).toBe("💡 March fly trip (March · Somewhere we fly to) — Chris's trip idea. Help plan it: 4 quick taps — your dates, budget, how you'd get there and what golf you're after. https://x/i/T");
  });
  it('the card', () => expect(ideaCard(plan, 'Chris')).toEqual({ eyebrow: '💡 TRIP IDEA', title: 'March fly trip', line: 'March · Somewhere we fly to', sub: 'from Chris', cta: 'Add your dates, areas and courses' }));
  it('the link: a preview page on Cloudflare, the plain link elsewhere', () => {
    const app = 'https://app.thegolftrip.club/#/join/ABCD?to=%2Fidea%2F1';
    expect(ideaLink({ origin: 'https://app.thegolftrip.club', base: '/', token: 'tok_123', appLink: app })).toBe('https://app.thegolftrip.club/i/tok_123#/join/ABCD?to=%2Fidea%2F1');
    expect(ideaLink({ origin: 'https://x.github.io', base: '/lgc-golf/', token: 'tok', appLink: 'https://x.github.io/lgc-golf/#/idea/1' })).toBe('https://x.github.io/lgc-golf/#/idea/1');
    expect(ideaLink({ base: '/', token: null, appLink: 'A' })).toBe('A');
  });
  it('the pull-together message (for the planning chat) ends with "Plan it now."', () => {
    const t = pullTogetherText({ plan: { ...plan, idea_fixed: { nights: 2 } }, lists: { date: [{ label: 'Fri 12 – Sun 14 Mar', t: { up: 3, down: 0 } }], area: [{ label: 'Port Douglas' }], course: [] }, summary: { answered: 4, line: '4 answered' } });
    expect(t).toMatch(/^Pull together a draft for our trip idea "March fly trip"/);
    expect(t).toContain('Weekends: Fri 12 – Sun 14 Mar (👍3 👎0).');
    expect(t).toContain('3 days (2 nights).');
    expect(t).toMatch(/Plan it now\.$/);
    expect(t.length).toBeLessThanOrEqual(590);
  });
  it('the Caddie’s context', () => {
    const c = caddieContext({ plan, summary: summariseWishes([W({ travel: 'fly' })]), base: { lat: -33.8812, lng: 151.163 } });
    expect(c.idea.travel).toBe('fly');
    expect(c.wishes.happy_to_fly).toBe(1);
    expect(c.home).toEqual({ lat: -33.88, lng: 151.16, name: null });
  });
});

describe('the definition, flights and names (Josh 19:34)', () => {
  it('lists what the organiser has set, any mix, each Set or Open to ideas', async () => {
    const { defLines, defPayload, isSet } = await import('./ideas.js');
    const f = defPayload({ when: 'This weekend', from: 'Sydney', within_min: 180, nights: 1, golf: 'max', set: { weekend: true, area: true, golf: true } });
    expect(f).toEqual({ when: 'This weekend', from: 'Sydney', within_min: 180, nights: 1, golf: 'max', set: ['weekend', 'golf'] });
    expect(isSet(f, 'weekend')).toBe(true);
    expect(defLines(f).map((l) => `${l.label}${l.set ? ' [set]' : ''}`)).toEqual(['📅 This weekend [set]', '📍 within 3 h of Sydney', '🛏️ 2 days', '⛳ As much as possible [set]']);
    const g = defPayload({ weekendStart: '2027-06-04', nights: 3, area: 'Melbourne', travel: 'fly', set: { weekend: true, area: true, travel: true } });
    expect(g.weekend).toEqual({ start: '2027-06-04', end: '2027-06-07' });
    expect(g.set).toEqual(['weekend', 'area', 'travel']);
    expect(defLines({ nights: 0 })[0].label).toBe('🛏️ A day trip');
    expect(defLines({ nights: 5 })[0].label).toBe('🛏️ 6 days');
  });
  it('flights: time and first/last flights, a search link, no fares', async () => {
    const { flightLine, flightSearchLink } = await import('./ideas.js');
    expect(flightLine({ from: 'SYD', to: 'CNS', flight_min: 190, first_out: '6am', last_back: '9pm' })).toBe('SYD–CNS · about 3 h flight · first flights about 6am, last back about 9pm');
    expect(flightSearchLink({ from: 'SYD', to: 'Cairns', depart: '2027-03-12', back: '2027-03-14' })).toBe('https://www.google.com/travel/flights?q=Flights%20from%20SYD%20to%20Cairns%20on%202027-03-12%20returning%202027-03-14');
    expect(flightSearchLink({ to: '' })).toBe(null);
  });
  it('names who can’t do a weekend — for the organiser', async () => {
    const { whoCant } = await import('./ideas.js');
    const rows = [{ player_id: 'a', cant_dates: ['2027-03-12'] }, { player_id: 'b', cant_dates: [] }, { cant_dates: ['2027-03-12'] }];
    expect(whoCant({ start_date: '2027-03-13' }, rows, (id) => ({ a: 'Bo' }[id]))).toEqual(['Bo']);
  });
});

describe('parked ideas', () => {
  it('groups leftovers without the Caddie', async () => {
    const { parkGroups } = await import('./ideas.js');
    const items = [
      { id: 'a', kind: 'area', label: 'Tasmania', status: 'in' }, { id: 'c', kind: 'course', label: 'Barnbougle', area: 'tasmania', status: 'in' },
      { id: 'b', kind: 'area', label: 'Hobart', status: 'declined' }, { id: 'd', kind: 'date', label: 'Fri 23 – Mon 26 Apr', status: 'in' },
      { id: 'x', kind: 'area', label: 'Picked', status: 'in', picked: true }, { id: 'q', kind: 'area', label: 'Queued', status: 'queued' },
    ];
    expect(parkGroups(items)).toEqual([
      { name: 'Tasmania — Barnbougle', why: null, items: ['a', 'c'] },
      { name: 'Hobart', why: null, items: ['b'] },
      { name: 'Fri 23 – Mon 26 Apr', why: null, items: ['d'] },
    ]);
    expect(parkGroups([{ id: 'a', kind: 'area', label: 'Kiama', status: 'in' }, { id: 'd', kind: 'date', label: 'W', status: 'in' }])).toEqual([{ name: 'Kiama', why: null, items: ['a', 'd'] }]);
  });
  it('knows whose it is to claim', async () => {
    const { claimState } = await import('./ideas.js');
    const now = new Date('2026-10-25T10:00:00Z');
    const p = { claim_owner: 'tom', claim_until: '2026-10-27T10:00:00Z' };
    expect(claimState(p, 'tom', now).state).toBe('mine');
    expect(claimState(p, 'chris', now).state).toBe('theirs');
    expect(claimState(p, 'chris', new Date('2026-10-28T00:00:00Z')).state).toBe('open');
    expect(claimState({}, 'chris', now).state).toBe('open');
  });
});
