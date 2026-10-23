// Plan UX (080): Call the vote, answer words, extras, the planning chat, area course sets, the tee grid, stay links.
import { describe, it, expect } from 'vitest';
import * as CV from './callvote.js';
import { answerKind, answersFor, buildVoteEmail, recordedLine, PLACE_ANSWERS, EXTRA_ANSWERS, ANSWERS } from './emailvotes.js';
import * as EX from './extras.js';
import * as PC from './planchat.js';
import * as TB from './tripbuilder.js';
import * as TG from './teegrid.js';
import { stayLinks, bedroomsFor, staySearchLine, isListLink } from './tripbudget.js';
import { rememberReturn, takeReturn } from './home.js';
import { nextStep, bulkAllocate, callMode } from './tripjobs.js';

const PLAN = '11111111-2222-4333-8444-555555555555';
const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

describe('answer words by what is being voted on', () => {
  it('dates are Yes / Maybe / No (V3)', () => {
    expect(answerKind({ kind: 'dates', question: 'Which weekend?' })).toBe('dates');
    expect(answerKind({ kind: 'other', question: 'Which weekend?' })).toBe('dates');
    expect(answersFor({ kind: 'dates' })).toEqual(ANSWERS);
  });
  it('places, stays, courses and trips are Keen / Happy with it / Not keen (V3)', () => {
    for (const p of [{ kind: 'location', question: 'Which area?' }, { kind: 'other', question: 'Where should we stay?', purpose: 'stay' },
      { kind: 'other', question: 'Day 2 — stay day (Sat 14 Mar): which course?' }, { kind: 'other', question: 'Which trip?' }]) {
      expect(answersFor(p)).toEqual(PLACE_ANSWERS);
    }
    expect(PLACE_ANSWERS).toEqual({ yes: '⭐ Keen', maybe: '👍 Happy with it', no: '👎 Not keen' });
    expect(ANSWERS).toEqual({ yes: '✓ Yes', maybe: '? Maybe', no: '✗ No' });
  });
  it('extras use the same words as places (V3)', () => {
    expect(answerKind({ kind: 'other', question: 'Would you do these?' })).toBe('extra');
    expect(answersFor({ question: 'Would you do these?' })).toEqual(EXTRA_ANSWERS);
  });
  it('the vote email uses the right words per poll', () => {
    const m = buildVoteEmail({ app: 'https://x/', token: 't', first: 'Jo', planName: 'March', planId: PLAN, polls: [
      { id: 'p1', question: 'Which weekend?', kind: 'dates', options: [{ id: 'o1', label: '13–15 Mar' }] },
      { id: 'p2', question: 'Which area?', kind: 'location', options: [{ id: 'o2', label: 'Hunter' }] },
    ] });
    expect(m.text).toContain('✓ Yes:');
    expect(m.text).toContain('⭐ Keen:');
    expect(m.text).toContain('👎 Not keen:');
  });
  it('the thanks line on the vote page', () => {
    expect(recordedLine('Jo', { kind: 'vote', response: 'yes', label: 'Hunter' }, { kind: 'location' })).toBe('Thanks Jo — ⭐ Keen for Hunter.');
    expect(recordedLine('Jo', { kind: 'vote', response: 'yes', label: '13 Mar' }, { kind: 'dates' })).toBe('Thanks Jo — you’re a ✓ for 13 Mar.');
  });
});

describe('Call the vote', () => {
  const range = [
    { key: 'area', kind: 'location', question: 'Which area?', options: [{ key: 'area:Hunter', label: 'Hunter' }, { key: 'area:Mudgee', label: 'Mudgee' }] },
    { key: 'weekend', kind: 'dates', question: 'Which weekend?', options: [{ key: 'w:1', label: '13 Mar', start_date: '2027-03-13' }, { key: 'w:2', label: '20 Mar', start_date: '2027-03-20' }] },
  ];
  it('everything starts ticked; unticking takes it off the ballot', () => {
    let t = CV.allTicked(range);
    expect(CV.ballotFrom(range, t).count).toBe(4);
    t = CV.toggleTick(t, 'area:Mudgee');
    const b = CV.ballotFrom(range, t);
    expect(b.sections[0].options.map((o) => o.label)).toEqual(['Hunter']);
    // One weekend left isn't worth a vote.
    const b2 = CV.ballotFrom(range, CV.toggleTick(t, 'w:2'));
    expect(b2.sections.map((s) => s.key)).toEqual(['area']);
    expect(b2.skipped).toEqual(['Which weekend?']);
  });
  it('unticking an area takes its towns, courses and ideas off too', () => {
    const r = [{ key: 'area', options: [{ key: 'area:A', label: 'A' }, { key: 'area:B', label: 'B' }] }, { key: 'stay', options: [{ key: 'stay:x', area: 'A' }, { key: 'stay:y', area: 'B' }] }];
    let t = CV.allTicked(r);
    t = CV.toggleTick(t, 'area:A', r);
    expect(t['stay:x']).toBe(false);
    expect(t['stay:y']).toBe(true);
    expect(CV.toggleTick(t, 'area:A', r)['stay:x']).toBe(true);
  });
  it('the polls payload', () => {
    const rows = CV.pollRows(CV.ballotFrom(range, CV.allTicked(range)).sections, { planId: PLAN, batchId: 'b', closes: '2026-10-25' });
    expect(rows[0].poll).toEqual({ plan_id: PLAN, kind: 'location', question: 'Which area?', closes_on: '2026-10-25', vote_batch: 'b' });
    expect(rows[1].options[0]).toMatchObject({ label: '13 Mar', start_date: '2027-03-13' });
    expect(rows[1].keys).toEqual(['w:1', 'w:2']);
  });
  it('closing dates and problems', () => {
    expect(CV.defaultCloses('2026-10-22')).toBe('2026-10-25');
    expect(CV.closesWord('2026-10-24', '2026-10-22')).toBe('Sat');
    expect(CV.closesWord('2026-11-07', '2026-10-22')).toBe('Sat 7 Nov');
    expect(CV.callProblem({ sections: [], keen: false })).toMatch(/Tick/);
    expect(CV.callProblem({ sections: [{}], closes: '2026-10-01', today: '2026-10-22' })).toMatch(/passed/);
    expect(CV.callProblem({ sections: [], keen: true })).toBe('');
  });
  it('how it goes out: app, email, neither', () => {
    const r = CV.reach([
      { player_id: 'a', on_app: true, choice: 'app', has_email: true },
      { player_id: 'b', on_app: true, choice: 'both', has_email: true },
      { player_id: 'c', on_app: false, has_email: true },
      { player_id: 'd', on_app: false, has_email: false },
      { player_id: 'e', on_app: true, choice: 'email', has_email: false },
    ]);
    expect(r).toMatchObject({ app: 3, email: 2, none: 1 });
    expect(r.noneIds).toEqual(['d']);
  });
  it('the share link goes through the invite, then lands on the vote', () => {
    const link = CV.voteShareLink({ base: 'https://app/', code: 'ABCDEFGH2345', planId: PLAN });
    expect(link).toBe(`https://app/#/join/ABCDEFGH2345?to=%2Fplan%2F${PLAN}%3Ftab%3Dvote`); // one scheme (083)
    expect(CV.voteShareLink({ base: 'https://app/', planId: PLAN })).toBe(`https://app/#/plan/${PLAN}?tab=vote`);
    expect(CV.voteTarget(`#/join/ABCDEFGH2345?vote=${PLAN}`)).toBe(`#/plan/${PLAN}?tab=vote`);
    expect(CV.voteTarget('#/join/ABCDEFGH2345?vote=<script>')).toBe(null);
    // The return path survives signing in (Google) — kept on the phone with its ?vote= part.
    const s = mem();
    rememberReturn(`#/join/ABCDEFGH2345?vote=${PLAN}`, s, 1000);
    expect(takeReturn(s, 2000)).toBe(`#/join/ABCDEFGH2345?vote=${PLAN}`);
    rememberReturn('#/join/x?y=<b>', s, 1000);
    expect(takeReturn(s, 2000)).toBe(null);
  });
  it('the share message', () => {
    expect(CV.shareMessage({ title: 'Where and when?', planName: 'the March trip', closes: '2026-10-24', today: '2026-10-22', link: 'L' }))
      .toBe('🗳️ Where and when for the March trip? Vote by Sat: L');
  });
  it('the organiser’s results: leader, against, who’s answered', () => {
    const poll = { id: 'p', kind: 'location', question: 'Which area?' };
    const options = [{ id: 'o1', poll_id: 'p', label: 'Hunter' }, { id: 'o2', poll_id: 'p', label: 'Mudgee' }];
    const votes = [
      { poll_id: 'p', option_id: 'o1', player_id: 'a', response: 'yes' }, { poll_id: 'p', option_id: 'o2', player_id: 'a', response: 'no' },
      { poll_id: 'p', option_id: 'o2', player_id: 'b', response: 'no' }, { poll_id: 'p', option_id: 'o2', player_id: 'c', response: 'no' },
    ];
    const r = CV.sectionResults(poll, options, votes, ['a', 'b', 'c', 'd']);
    expect(r.leader.option.label).toBe('Hunter');
    expect(r.rows.find((x) => x.option.label === 'Mudgee').against).toBe('3 don’t like it');
    expect(r.waiting).toEqual(['d']);
    expect(CV.againstLine(2, 'extra')).toBe('2 would skip it');
    expect(CV.againstLine(1)).toBe('');
  });
  it('who gets the organiser view', () => {
    expect(CV.organiserView({ isAdmin: true })).toBe(true);
    expect(CV.organiserView({ isAdmin: true, asVoter: true })).toBe(false);
    expect(CV.organiserView({ me: 'x', plan: { organiser_id: 'x' } })).toBe(true);
    expect(CV.organiserView({ me: 'y', plan: { organiser_id: 'x' } })).toBe(false);
    expect(CV.hasAnsweredAll({ polls: [{ id: 'p' }], votes: [{ poll_id: 'p', player_id: 'y' }], me: 'y', keen: true, rsvps: [] })).toBe(false);
    expect(CV.timeLeft('2026-10-25', '2026-10-22')).toBe('Closes in 3 days');
  });
});

describe('extras', () => {
  it('a sensible default list, all off', () => {
    const l = EX.startExtras();
    expect(l.length).toBeGreaterThanOrEqual(10);
    expect(l.every((e) => e.state === 'off')).toBe(true);
    expect(l.find((e) => e.key === 'bus').job).toBe('Book the bus');
  });
  it('in / vote / own extras; the ballot section', () => {
    let l = EX.setExtraState(EX.startExtras(), 'bus', 'vote');
    l = EX.setExtraState(l, 'trophy', 'in');
    l = EX.addCustomExtra(l, 'Footy tipping', '20');
    expect(EX.addCustomExtra(l, 'footy tipping')).toBe(null);
    expect(EX.addCustomExtra(l, 'x')).toBe(null);
    const s = EX.extrasSection(l);
    expect(s.question).toBe('Would you do these?');
    expect(s.options.map((o) => o.label)).toEqual(['Bus or transfers', 'Footy tipping']);
    expect(s.options[0].notes).toBe('~$40 each');
    expect(EX.extrasIn(l).map((e) => e.key)).toEqual(['trophy']);
    expect(EX.extrasSection(EX.startExtras())).toBe(null);
  });
  it('winning and what it adds to the trip plan', () => {
    expect(EX.extraWins({ yes: 3, maybe: 2, no: 4 })).toBe(true);
    expect(EX.extraWins({ yes: 0, maybe: 5, no: 0 })).toBe(false);
    expect(EX.extraWins({ yes: 1, maybe: 0, no: 2 })).toBe(false);
    const bus = EX.DEFAULT_EXTRAS.find((e) => e.key === 'bus');
    const r = EX.extrasToPlan([bus], { planId: PLAN, budget: [], items: [] });
    expect(r.budgetRows[0]).toMatchObject({ kind: 'transport', label: 'Bus or transfers', amount: 40, per_person: true });
    expect(r.jobRows[0].title).toBe('Book the bus');
    const again = EX.extrasToPlan([bus], { planId: PLAN, budget: [{ label: 'Bus or transfers' }], items: [{ title: 'Book the bus' }] });
    expect(again.budgetRows).toEqual([]);
    expect(again.jobRows).toEqual([]);
    expect(EX.extrasFromOptions([{ label: 'Bus or transfers' }, { id: 'z', label: 'Darts', notes: '~$10 each' }])[1].pp).toBe(10);
  });
});

describe('the planning chat', () => {
  const d1 = { name: 'March away', places: [{ label: 'Hunter Valley', courses: ['a', 'b'], cost_pp: 800 }, { label: 'Port Stephens', courses: [] }],
    dates: [{ start_date: '2027-03-13', end_date: '2027-03-15' }], budget_pp: 800 };
  it('what changed is highlighted; the first draft isn’t', () => {
    expect(PC.diffDraft(null, d1)).toEqual({ added: [], changed: [], removed: [] });
    const d2 = { ...d1, places: [d1.places[0], { label: 'Mudgee', courses: ['c'] }], budget_pp: 700 };
    const diff = PC.diffDraft(d1, d2);
    expect(diff.added).toContain('place:mudgee');
    expect(diff.removed).toContain('place:port stephens');
    expect(diff.changed).toContain('budget');
    expect(PC.markFor(diff, 'place', { label: 'Mudgee' })).toBe('new');
    expect(PC.markFor(diff, 'place', { label: 'Hunter Valley' })).toBe('');
    expect(PC.removedNames(diff, d1)).toEqual(['Port Stephens']);
  });
  it('quick answers: send it, or open the box', () => {
    const q = { id: 'places', text: 'These are the places — any others?' };
    expect(PC.quickChoice(q, 'Looks good')).toEqual({ send: 'These are the places — any others? → Looks good' });
    expect(PC.quickChoice(q, 'Add another…')).toEqual({ ask: 'Add another: ' });
    expect(PC.quickChoice(q, 'Different dates...')).toEqual({ ask: 'Different dates: ' });
    expect(PC.cleanQuestions([{ id: 'a', text: 'x', quick: ['1', '2', '3', '4', '5'] }, { text: '' }])[0].quick).toHaveLength(4);
  });
  it('turns, the request body and the session copy', () => {
    const turns = Array.from({ length: 4 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `t${i}` }));
    expect(PC.turnsLeft(turns)).toBe(PC.MAX_TURNS - 2);
    const b = PC.chatBody(turns, d1, ' Add Mudgee ');
    expect(b).toMatchObject({ mode: 'plan_chat', text: 'Add Mudgee', draft: d1 });
    expect(b.messages).toHaveLength(4);
    const s = mem();
    PC.saveChat('g', { turns, draft: d1 }, s);
    expect(PC.loadChat('g', s).draft.name).toBe('March away');
    PC.clearChat('g', s);
    expect(PC.loadChat('g', s)).toBe(null);
  });
  it('the trip builder starts from the draft with options, not a pick', () => {
    const st = PC.builderStateFromDraft(d1, [{ name: 'Cessnock', region: 'Hunter Valley', lat: -32.8, lng: 151.3 }, { name: 'Nelson Bay', region: 'Port Stephens', lat: -32.7, lng: 152.1 }]);
    expect(st.region).toBe(null);
    expect(st.regionOptions).toEqual(['Hunter Valley', 'Port Stephens']);
    expect(st.areaCourses['Hunter Valley']).toEqual(['a', 'b']);
    expect(st.suggested['course:Hunter Valley:a']).toBe(true);
    expect(st.weekends[0].start).toBe('2027-03-13');
    expect(PC.draftToPlan(d1).places[0]).toMatchObject({ place: 'Hunter Valley', courses: ['a', 'b'], cost_each: 800 });
  });
});

describe('each area has its own course set and places to stay', () => {
  const towns = [{ key: 'Nowra', name: 'Nowra', lat: -34.88, lng: 150.6 }];
  const courses = [
    { id: 'near1', name: 'Nowra GC', lat: -34.87, lng: 150.6 }, { id: 'near2', name: 'Shoalhaven Heads', lat: -34.85, lng: 150.75 },
    { id: 'near3', name: 'Worrigee', lat: -34.9, lng: 150.62 }, { id: 'far', name: 'Far away', lat: -36.5, lng: 150.0 },
  ];
  it('every viable course within the drive, the best few suggested — never just one', () => {
    const c = TB.areaCourseCandidates(courses, towns, { stayMax: 40 });
    expect(c.map((x) => x.course.id)).not.toContain('far');
    expect(c.length).toBe(3);
    expect(c.every((x) => x.suggested)).toBe(true);
    expect(TB.proposeAreaCourses(courses, towns).length).toBe(3);
    expect(TB.areaCourseCandidates(courses, [], {})).toEqual([]);
  });
  it('stay support, toggling and pre-filled days', () => {
    const map = Object.fromEntries(courses.map((c) => [c.id, c]));
    expect(TB.staySupport(towns[0], ['near1', 'near2', 'far'], map, 30)).toBe(2);
    expect(TB.toggleId(['a'], 'a')).toEqual([]);
    expect(TB.toggleId(['a'], 'b')).toEqual(['a', 'b']);
    const days = TB.prefillStayDays([{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [] }, { index: 2, leg: 'stay', options: ['x'] }], ['near2', 'near1', 'far'], map, { stays: towns });
    expect(days[0].options).toEqual([]);
    expect(days[1].options).toEqual(['near1', 'near2']);
    expect(days[2].options).toEqual(['x']);
  });
  it('the start range: areas with their courses and stays, weekends, stays, courses, ideas, extras', () => {
    const map = Object.fromEntries(courses.map((c) => [c.id, c]));
    const st = { regionOptions: ['South Coast', 'Hunter'], areaCourses: { 'South Coast': ['near1', 'near2'] }, areaStays: { 'South Coast': towns },
      weekends: [{ start: '2027-03-12', end: '2027-03-14' }, { start: '2027-03-19', end: '2027-03-21' }] };
    const r = TB.startRange(st, { courseMap: map, accom: [{ id: 's1', name: 'Beach house', area: 'South Coast', total_cost: 3000, sleeps: 12 }], extras: EX.extrasSection(EX.setExtraState(EX.startExtras(), 'bus', 'vote')) });
    // ov23: with 2+ areas, each area's courses and places to stay are its own optional questions (the detail).
    expect(r.map((s) => s.question)).toEqual(['Which area?', 'Which weekend?', 'South Coast: which courses?', 'South Coast: where to stay?', 'Where should we stay?', 'Would you do these?']);
    expect(r.filter((s) => s.optional).map((s) => s.area)).toEqual(['South Coast', 'South Coast']);
    expect(r[0].options[0].notes).toBe('Courses: Nowra GC, Shoalhaven Heads · Stay: Nowra');
    expect(r[4].options[0].notes).toBe('South Coast · $3000 total · sleeps 12');
    // Areas only: just the main questions (no detail, no accommodation ideas).
    const a = TB.startRange(st, { courseMap: map, accom: [{ id: 's1', name: 'Beach house' }], depth: 'areas', extras: null });
    expect(a.map((s) => s.question)).toEqual(['Which area?', 'Which weekend?']);
    expect(TB.areaCourseVotes({ 'areacourse:South Coast:near1': 4, 'area:x': 1 }, 'South Coast')).toEqual({ near1: 4 });
  });
});

describe('the regions side by side', () => {
  it('courses, stays, cost each, drive and tee days per area', () => {
    const st = { regionOptions: ['South Coast', 'Hunter'], areaCourses: { 'South Coast': ['a', 'b'], Hunter: [] }, areaStays: { 'South Coast': [{ key: 'Kiama', name: 'Kiama' }] },
      courses: { a: { name: 'Kiama GC' }, b: { name: 'Gerringong GC' } } };
    const r = TB.compareAreas(st, {
      areas: [{ name: 'Kiama', region: 'South Coast', lat: -34.67, lng: 150.85 }, { name: 'Cessnock', region: 'Hunter', lat: -32.83, lng: 151.36 }],
      accom: [{ id: 'x', area: 'South Coast', name: 'House', total_cost: 2400 }, { id: 'y', area: 'South Coast', name: 'List', is_list: true }],
      people: 12, origin: { lat: -33.88, lng: 151.16 },
      tees: [{ course_id: 'a', play_date: '2027-03-12', available: 'yes', ranges: ['08:00-09:00'] }, { course_id: 'b', play_date: '2027-03-12', available: 'no' }],
    });
    expect(r[0]).toMatchObject({ area: 'South Coast', courses: ['Kiama GC', 'Gerringong GC'], stays: ['Kiama'], costEach: 200, teeDays: 1 });
    expect(r[0].ideas).toHaveLength(2);
    expect(r[0].drive).toBeGreaterThan(60);
    expect(r[1]).toMatchObject({ area: 'Hunter', courses: [], costEach: null, teeDays: 0 });
  });
});

describe('tee times over the whole window', () => {
  const dates = TG.windowDates([{ start: '2027-03-12', end: '2027-03-14' }, { start: '2027-03-19', end: '2027-03-21' }]);
  it('every day of every weekend', () => {
    expect(dates).toEqual(['2027-03-12', '2027-03-13', '2027-03-14', '2027-03-19', '2027-03-20', '2027-03-21']);
  });
  it('ranges and slots', () => {
    expect(TG.parseRanges('7:30-9, 1pm–2:30pm; junk')).toEqual(['07:30-09:00', '13:00-14:30']);
    expect(TG.slotsFor({ available: 'yes', ranges: ['07:30-08:00'], times: ['10:00'] })).toEqual(['07:30', '07:40', '07:50', '08:00', '10:00']);
    expect(TG.slotsFor({ available: 'no', ranges: ['07:30-08:00'] })).toEqual([]);
  });
  it('completeness: every day needs an answer; unknown counts but asks again', () => {
    const rows = [{ play_date: '2027-03-12', available: 'yes', ranges: ['07:30-09:00'] }, { play_date: '2027-03-13', available: 'unknown' }];
    const p = TG.callProgress(rows, dates.slice(0, 3), null);
    expect(p.line).toBe('2 of 3 days filled');
    expect(TG.canFinishCall(p).ok).toBe(false);
    expect(TG.canFinishCall(p).message).toMatch(/Sun 14 Mar/);
    const done = TG.callProgress([...rows, { play_date: '2027-03-14', available: 'no' }], dates.slice(0, 3), { weekdays: 'after 11' });
    const f = TG.canFinishCall(done);
    expect(f.ok).toBe(true);
    expect(f.nudge).toMatch(/ask again/);
    expect(done.line).toBe('3 of 3 days filled · social times in');
    expect(TG.callChecklist(dates, { need: 3 })[0]).toBe('Every golf day: Fri, Sat, Sun — each weekend');
    expect(TG.callScript({ course: 'Nowra GC', need: 3, dates: dates.slice(0, 2) })).toMatch(/3 tee times in a row — 12 players/);
  });
  it('the best times per day across courses', () => {
    const rows = [
      { play_date: '2027-03-13', course_id: 'a', available: 'yes', ranges: ['09:00-10:00'], price: 70 },
      { play_date: '2027-03-13', course_id: 'b', available: 'yes', ranges: ['07:30-08:30'], price: 90 },
      { play_date: '2027-03-13', course_id: 'c', available: 'yes', times: ['07:00'] },
      { play_date: '2027-03-14', course_id: 'a', available: 'no', ranges: ['07:00-09:00'] },
    ];
    const b = TG.bestPerDay(rows, { needed: 3, dates: ['2027-03-13', '2027-03-14'], courses: { a: { name: 'A' }, b: { name: 'B' } } });
    expect(b[0].best.map((x) => x.course_id)).toEqual(['b', 'a']);
    expect(b[0].best[0].block.text).toMatch(/7:30/);
    expect(b[1].best).toEqual([]);
    expect(TG.socialLine({ weekdays: 'after 11', weekends: 'Sat after 2', price: '$65' })).toBe('Weekdays after 11 · Weekends Sat after 2 · $65');
  });
});

describe('calling the courses: one person for all, or per course', () => {
  const items = [
    { id: 'j1', kind: 'job', title: '📞 Call Nowra GC', owner_id: null },
    { id: 'j2', kind: 'job', title: '📞 Call Worrigee', owner_id: 'b' },
    { id: 'j3', kind: 'job', title: '📞 Call Gerringong', owner_id: null, stage: 'done', done: true },
  ];
  it('bulk allocate skips done jobs and ones already theirs', () => {
    expect(bulkAllocate(items, ['j1', 'j2', 'j3'], 'b')).toEqual(['j1']);
    expect(bulkAllocate(items, ['j1', 'j2', 'j3'], null)).toEqual([]);
    expect(callMode(items, ['j1', 'j2', 'j3'])).toBe('per');
    expect(callMode(items.map((j) => ({ ...j, owner_id: 'b' })), ['j1', 'j2', 'j3'])).toBe('one');
  });
  it('one combined next step for the person with several calls', () => {
    const mine = items.slice(0, 2).map((j) => ({ ...j, owner_id: 'b' }));
    const s = nextStep({ plan: { id: PLAN, status: 'planning', start_date: null }, stage: 'deciding', items: mine, rsvps: [{ player_id: 'b', status: 'in' }], me: 'b', playerIds: ['b'], builder: { callJobIds: ['j1', 'j2'], weekends: 1 } });
    expect(s.title).toBe('Your job: call 2 courses for tee times');
  });
});

describe('links travel with the vote; reminders for missing lists', () => {
  it('the vote email carries a View places link for a place with a list', () => {
    const m = buildVoteEmail({ app: 'https://x/', token: 't', first: 'Jo', planName: 'March', planId: PLAN, polls: [
      { id: 'p', question: 'Where should we stay?', kind: 'other', purpose: 'stay', options: [{ id: 'o', label: 'Kiama list', link: 'https://www.airbnb.com.au/wishlists/v/1' }, { id: 'o2', label: 'Bad', link: 'javascript:alert(1)' }] },
    ] });
    expect(m.html).toContain('View places ↗');
    expect(m.html).toContain('https://www.airbnb.com.au/wishlists/v/1');
    expect(m.html).not.toContain('javascript:');
    expect(m.text).toContain('View places: https://www.airbnb.com.au/wishlists/v/1');
  });
  it('the organiser is reminded when an area has places to stay but no list', () => {
    const s = nextStep({ plan: { id: PLAN, status: 'planning', start_date: null }, stage: 'deciding', items: [], rsvps: [], me: 'o', isOrganiser: true, playerIds: ['o'], builder: { weekends: 1, noStayList: ['Kiama'] } });
    expect(s.title).toBe('Find places to stay in Kiama');
  });
});

describe('stay search links from the real requests', () => {
  const base = { town: 'Kiama', start: '2027-03-12', end: '2027-03-14', people: 12, bedrooms: 6, maxPerNight: 400 };
  it('each site gets bedrooms and the price cap', () => {
    const [b, a, s] = stayLinks(base);
    expect(b.url).toContain('no_rooms=6');
    expect(b.url).toContain('group_adults=12');
    expect(a.url).toContain('min_bedrooms=6');
    expect(a.url).toContain('price_max=400');
    expect(a.url).toContain('checkin=2027-03-12&checkout=2027-03-14');
    expect(s.url).toContain('minBedrooms=6');
    expect(s.url).toContain('price=0-400');
    // Older call (no bedrooms): as before.
    expect(stayLinks({ town: 'Kiama', start: '2027-03-12', end: '2027-03-14', people: 4 })[1].url).not.toContain('min_bedrooms');
  });
  it('the summary line, bedrooms and list links', () => {
    expect(bedroomsFor(12)).toBe(6);
    expect(staySearchLine({ ...base, fmt: () => '12–14 Mar' })).toBe('Kiama · 12–14 Mar · 12 people · 6+ bedrooms · under $400/night');
    expect(isListLink('https://www.airbnb.com.au/wishlists/v/123456')).toBe(true);
    expect(isListLink('https://www.stayz.com.au/tripboards/abc')).toBe(true);
    expect(isListLink('https://www.airbnb.com.au/rooms/123')).toBe(false);
  });
});
