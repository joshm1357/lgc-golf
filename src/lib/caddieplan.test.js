// ov16: the planning chat asks first (questions with no draft yet), lives in the Caddie, and writes its draft into the
// trip builder as ✨ suggestions while keeping what the organiser chose on the page.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readReply } from './aihelper.js';
import * as PC from './planchat.js';
import AiChat from '../components/AiChat.jsx';

const K = 'k-1'; const C = 'c-2'; const M = 'm-5';
const AREAS = [
  { name: 'Cessnock', region: 'Hunter Valley', lat: -32.8, lng: 151.3 },
  { name: 'Mudgee', region: 'Mudgee', lat: -32.6, lng: 149.6 },
  { name: 'Bowral', region: 'Southern Highlands', lat: -34.5, lng: 150.4 },
];
const draft = (over = {}) => ({
  name: 'March Away', kind: 'trip',
  places: [{ label: 'Hunter Valley', courses: [K, C], address: 'Kurri Kurri + Cypress Lakes' }, { label: 'Mudgee', courses: [M], address: 'Mudgee GC' }],
  dates: [{ start_date: '2027-03-12', end_date: '2027-03-14' }, { start_date: '2027-03-19', end_date: '2027-03-21' }],
  extras: [{ label: 'Bus', pp: 40 }],
  ...over,
});

describe('a reply with questions and no draft yet', () => {
  it('reads as a chat turn with draft null', () => {
    const r = readReply({ chat: { message: 'Got it — a weekend away. A couple of quick ones:', draft: null, questions: [{ id: 'when', text: 'Which month?', quick: ['March', 'April'] }], summary: [] }, remaining: { month: 9, today: 9 }, log_id: 7 });
    expect(r.kind).toBe('chat');
    expect(r.draft).toBe(null);
    expect(r.questions).toHaveLength(1);
    expect(r.logId).toBe(7);
  });
  it('renders fine: the questions and the "plan it" line show, no draft card', () => {
    const hint = React.createElement('span', { 'data-testid': 'plan-it-hint' }, PC.PLAN_IT_HINT);
    const html = renderToString(React.createElement(AiChat, {
      turns: [{ role: 'user', text: 'Golf trip next year' }, { role: 'assistant', text: 'Got it. A couple of quick ones:', questions: PC.cleanQuestions([{ text: 'Driving or flying?', quick: ['Driving', 'Flying', 'Not sure'] }]) }],
      onSend: () => {}, hint,
    }));
    expect(html).toContain('Driving or flying?');
    expect(html).toContain('Not sure');
    expect(html).toContain('plan it');
    expect(html).not.toContain('draft-card');
  });
  it('the "plan it" phrase and the hint', () => {
    expect(PC.PLAN_IT_HINT).toMatch(/just say “plan it”/);
    expect(PC.PLAN_IT.toLowerCase()).toBe('plan it');
  });
  it('the next question carries what the trip screen shows', () => {
    const b = PC.chatBody([{ role: 'user', text: 'hi' }], null, 'Swap a course', { areas: [{ area: 'Hunter Valley', courses: ['Kurri'] }] });
    expect(b.page.areas[0].area).toBe('Hunter Valley');
    expect(PC.chatBody([], null, 'x').page).toBeUndefined();
  });
  it('driving or flying is kept on the plan', () => {
    expect(PC.draftToPlan(draft({ travel: 'fly' })).travel).toBe('fly');
    expect(PC.draftToPlan(draft()).travel).toBeUndefined();
  });
});

describe('the trip screen filling in as you chat', () => {
  it('a first draft becomes ✨ suggested areas, courses, weekends and extras', () => {
    const s = PC.mergeDraftIntoBuild(null, draft({ travel: 'drive' }), AREAS);
    expect(s.regionOptions).toEqual(['Hunter Valley', 'Mudgee']);
    expect(s.areaCourses['Hunter Valley']).toEqual([K, C]);
    expect(s.suggested[`course:Hunter Valley:${K}`]).toBe(true);
    expect(s.weekends.map((w) => w.start)).toEqual(['2027-03-12', '2027-03-19']);
    expect(s.extras.find((e) => /bus/i.test(e.label))?.suggested).toBe(true);
    expect(s.travel).toBe('drive');
    expect(s.region).toBe(null); // nothing picked for them
  });
  it('the next draft swaps the helper’s suggestions but keeps what the organiser chose', () => {
    const first = PC.mergeDraftIntoBuild(null, draft(), AREAS);
    // On the page: the organiser ticks Kurri in (no longer just a suggestion), adds a course and an area of their own,
    // picks Hunter Valley, and settles the weekends.
    const theirs = {
      ...first,
      suggested: { ...first.suggested, [`course:Hunter Valley:${K}`]: false },
      areaCourses: { ...first.areaCourses, 'Hunter Valley': [K, C, 'own-9'] },
      regionOptions: [...first.regionOptions, 'Southern Highlands'],
      region: 'Hunter Valley', weekendsSettled: true, nights: 3,
    };
    // The helper's new draft drops Mudgee and Cypress Lakes, and offers other weekends.
    const next = PC.mergeDraftIntoBuild(theirs, draft({ places: [{ label: 'Hunter Valley', courses: [K, 'v-3'] }], dates: [{ start_date: '2027-04-09', end_date: '2027-04-11' }] }), AREAS);
    expect(next.region).toBe('Hunter Valley');
    expect(next.nights).toBe(3);
    expect(next.regionOptions).toContain('Southern Highlands'); // theirs
    expect(next.regionOptions).not.toContain('Mudgee'); // the helper's old idea, not kept
    expect(next.areaCourses['Hunter Valley']).toEqual([K, 'own-9', 'v-3']); // kept + theirs + the new suggestion
    expect(next.suggested[`course:Hunter Valley:${C}`]).toBeUndefined();
    expect(next.weekends.map((w) => w.start)).toEqual(['2027-03-12', '2027-03-19']); // settled: theirs now
  });
  it('unsettled weekends: the organiser’s own stay, the helper’s are updated', () => {
    const first = PC.mergeDraftIntoBuild(null, draft(), AREAS);
    const theirs = { ...first, weekends: [...first.weekends, { start: '2027-05-07', end: '2027-05-09', long: false }] };
    const next = PC.mergeDraftIntoBuild(theirs, draft({ dates: [{ start_date: '2027-04-09', end_date: '2027-04-11' }] }), AREAS);
    expect(next.weekends.map((w) => w.start)).toEqual(['2027-05-07', '2027-04-09']);
  });
  it('what the page shows goes back to the helper, with course names', () => {
    const s = PC.mergeDraftIntoBuild(null, draft(), AREAS);
    const page = PC.pageFromBuild({ ...s, region: 'Hunter Valley', suggested: { ...s.suggested, [`course:Hunter Valley:${K}`]: false }, headcount: 12 }, PC.courseNamesFromDraft(draft()));
    expect(page.areas[0]).toEqual({ area: 'Hunter Valley', courses: ['Kurri Kurri', 'Cypress Lakes (suggested)'], stays: [] });
    expect(page.chosen_area).toBe('Hunter Valley');
    expect(page.headcount).toBe(12);
    expect(PC.pageFromBuild(null)).toBe(null);
    expect(PC.sameExtra('Bus', 'Bus or transfers')).toBe(true);
    expect(PC.sameExtra('Bus', 'Group dinner out')).toBe(false);
  });
  it('a saved chat remembers the draft trip it is filling in', () => {
    const m = {}; const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
    PC.saveChat('g1', { turns: [{ role: 'user', text: 'hi' }], draft: null, planId: 'p-1' }, st);
    expect(PC.loadChat('g1', st).planId).toBe('p-1');
  });
});
