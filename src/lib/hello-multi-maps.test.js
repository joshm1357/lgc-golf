// ov22 (Josh 23 Oct): Caddie says hello once; pick several quick answers then send; the planning maps' club names,
// labels that don't overlap, hover summaries and first tap / second tap.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { HELLO_KEY, HELLO_TEXT, helloSeen, markHelloSeen, shouldSayHello, isPlanATrip, caddieHidden } from './caddie.js';
import { cleanQuestions, togglePick, multiSend, multiOther, typesIt, quickChoice, answersMessage, pickCount } from './planchat.js';
import {
  readNames, saveNames, NAMES_KEY, shortName, declutter, labelPriority, courseTip, stayTip, nearestCourses, stayIdeasSummary,
  extraResearchLines, mapLink, tapAction,
} from './placeinfo.js';
import AiChat from '../components/AiChat.jsx';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

describe('Caddie says hello, once', () => {
  it('a new device has not had it; after either button it never shows again', () => {
    const s = mem();
    expect(helloSeen(s)).toBe(false);
    expect(shouldSayHello({ seen: helloSeen(s) })).toBe(true);
    markHelloSeen(s, 123);
    expect(s.getItem(HELLO_KEY)).toBe('123');
    expect(helloSeen(s)).toBe(true);
    expect(shouldSayHello({ seen: helloSeen(s) })).toBe(false);
  });
  it('storage blocked: never nags (treated as seen), and saving never throws', () => {
    expect(helloSeen(broken)).toBe(true);
    expect(helloSeen(null)).toBe(true);
    expect(() => markHelloSeen(broken)).not.toThrow();
  });
  it('waits for a normal screen: not while the Caddie is open, another pop-up is up, or viewing as someone', () => {
    expect(shouldSayHello({ caddieOpen: true })).toBe(false);
    expect(shouldSayHello({ otherPopUp: true })).toBe(false); // the notifications sheet goes first
    expect(shouldSayHello({ viewing: true })).toBe(false);
    expect(shouldSayHello({ hidden: true })).toBe(false);
    expect(shouldSayHello({})).toBe(true);
  });
  it('never on the join or sign-in screens (the Caddie is hidden there)', () => {
    expect(caddieHidden('/join/ABC123')).toBe(true);
    expect(caddieHidden('/start')).toBe(true);
    expect(caddieHidden('/')).toBe(false);
  });
  it('says what Josh asked for', () => {
    expect(HELLO_TEXT).toMatch(/^Hi, I’m Caddie\. Ask me anything/);
    expect(HELLO_TEXT).toMatch(/plan a trip/);
    expect(HELLO_TEXT).toMatch(/I’m here to help\.$/);
  });
  it('"plan a trip" typed into Ask goes to planning', () => {
    for (const t of ['plan a trip', 'Plan a trip!', "let's plan a trip", 'plan the next trip']) expect(isPlanATrip(t)).toBe(true);
    for (const t of ['who planned the last trip?', 'plan', 'when is the trip']) expect(isPlanATrip(t)).toBe(false);
  });
});

describe('pick several quick answers, then send', () => {
  const regions = { id: 'where', text: 'Which areas?', quick: ['Hunter Valley', 'South Coast', 'Central West', 'Other…'], multi: true };
  it('multi comes through from the helper; it is false unless said', () => {
    const [a, b] = cleanQuestions([regions, { text: 'Driving or flying?', quick: ['Driving', 'Flying'] }]);
    expect(a.multi).toBe(true);
    expect(b.multi).toBeUndefined();
    expect(cleanQuestions([{ text: 'How many?', quick: ['8'], multi: 'yes' }])[0].multi).toBeUndefined();
  });
  it('tapping toggles, in the order picked; "Other…" is never a pick', () => {
    let p = togglePick([], 'South Coast');
    p = togglePick(p, 'Hunter Valley');
    p = togglePick(p, 'Central West');
    expect(p).toEqual(['South Coast', 'Hunter Valley', 'Central West']);
    expect(togglePick(p, 'South Coast')).toEqual(['Hunter Valley', 'Central West']);
    expect(togglePick(p, 'Other…')).toBe(p);
    expect(typesIt('Add another...')).toBe(true);
  });
  it('Send (3) sends them together, with the question; nothing picked → nothing sent', () => {
    expect(multiSend(regions, ['Hunter Valley', 'South Coast', 'Central West'])).toEqual({ send: 'Which areas? → Hunter Valley, South Coast, Central West' });
    expect(multiSend(regions, [])).toBeNull();
    expect(multiSend({ text: '' }, ['A', 'B'])).toEqual({ send: 'A, B' });
  });
  it('quickChoice still words one answer the same way (used for wording only now)', () => {
    expect(quickChoice({ text: 'Driving or flying?' }, 'Driving')).toEqual({ send: 'Driving or flying? → Driving' });
  });
  it('v10.4: one Send carries every question’s picks plus what’s typed, one line each', () => {
    const qs = [regions, { id: 'go', text: 'Driving or flying?', quick: ['Driving', 'Flying'] }];
    expect(answersMessage(qs, { where: ['Hunter Valley', 'South Coast'], go: ['Driving'] }, ''))
      .toBe('Which areas? → Hunter Valley, South Coast\nDriving or flying? → Driving');
    expect(answersMessage(qs, { go: ['Flying'] }, '  12 of us  ')).toBe('Driving or flying? → Flying\n12 of us');
    expect(answersMessage(qs, {}, 'just typed')).toBe('just typed');
    expect(answersMessage(qs, {}, '   ')).toBe('');
    expect(pickCount({ where: ['A', 'B'], go: ['C'] })).toBe(3);
    expect(pickCount({})).toBe(0);
  });
  it('"Other…" opens the box with the picks so far', () => {
    expect(multiOther(regions, ['Hunter Valley'])).toEqual({ ask: 'Which areas? → Hunter Valley, ' });
    expect(multiOther(regions, [])).toEqual({ ask: 'Other: ' });
  });
  it('v10.4: every question has toggle chips, and there is one Send for all of them', () => {
    const turns = [{ role: 'assistant', text: 'Where to?', questions: cleanQuestions([regions, { id: 'go', text: 'Driving or flying?', quick: ['Driving', 'Flying'] }]) }];
    const html = renderToString(React.createElement(AiChat, { turns, onSend: () => {} }));
    expect(html).toMatch(/aria-pressed="false"[^>]*>Hunter Valley/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Driving/);
    expect(html).toContain('Tap as many as fit, then send');
    expect((html.match(/data-testid="chat-multi-send"/g) || []).length).toBe(1);
  });
});

describe('club names on the planning maps', () => {
  it('on by default; remembered on this device; storage trouble → on', () => {
    const s = mem();
    expect(readNames(s)).toBe(true);
    saveNames(false, s);
    expect(s.getItem(NAMES_KEY)).toBe('off');
    expect(readNames(s)).toBe(false);
    saveNames(true, s);
    expect(readNames(s)).toBe(true);
    expect(readNames(broken)).toBe(true);
    expect(() => saveNames(false, broken)).not.toThrow();
  });
  it('short names: the "Golf Club" bits go, long ones are cut', () => {
    expect(shortName('Kiama Golf Club')).toBe('Kiama');
    expect(shortName('The Vintage Golf Club')).toBe('The Vintage');
    expect(shortName('Gerringong GC')).toBe('Gerringong');
    expect(shortName('Cypress Lakes Golf & Country Club')).toBe('Cypress Lakes');
    expect(shortName('Shoalhaven Heads Golf Club (Shoalhaven Heads)')).toBe('Shoalhaven Heads');
    expect(shortName('Port Macquarie Golf Club Extended Name Here', 18)).toBe('Port Macquarie Go…'); // 18 with the "…"
    expect(shortName('Golf')).toBe('Golf');
  });
  it('labels that overlap: the more important keeps its label; ones on top of a 🏠 label hide', () => {
    const boxes = [
      { id: 'a', x: 0, y: 0, w: 60, h: 14, p: 1 },
      { id: 'b', x: 30, y: 4, w: 60, h: 14, p: 3 }, // on the table — wins over a
      { id: 'c', x: 200, y: 0, w: 60, h: 14, p: 1 },
      { id: 'd', x: 400, y: 0, w: 60, h: 14, p: 2 },
    ];
    const hidden = declutter(boxes, [{ x: 405, y: 5, w: 40, h: 20 }]);
    expect([...hidden].sort()).toEqual(['a', 'd']);
    expect(declutter([])).toEqual(new Set());
  });
  it('priority: hovered > most voted > on the table > suggested > the rest', () => {
    expect(labelPriority({}, true)).toBeGreaterThan(labelPriority({ top: true }));
    expect(labelPriority({ top: true })).toBeGreaterThan(labelPriority({ on: true }));
    expect(labelPriority({ on: true })).toBeGreaterThan(labelPriority({ sug: true }));
    expect(labelPriority({ sug: true })).toBeGreaterThan(labelPriority({}));
  });
});

describe('hover for a quick summary', () => {
  const research = {
    fee_weekday: 45, fee_weekend: 50, access_type: 'public', good_for_groups: 4,
    details: { style: 'coastal', visitor_times: 'Visitors 7 days after 10am' },
  };
  it('a course: style, ★ for groups, fees, drive, visitor times', () => {
    const t = courseTip({ course: { name: 'Nowra GC' }, research, drive: '12 min' });
    expect(t.name).toBe('Nowra GC');
    expect(t.lines[0]).toBe('coastal · Public · ★★★★☆ for groups');
    expect(t.lines[1]).toBe('$45 weekdays · $50 weekends · 🚗 12 min');
    expect(t.lines[2]).toBe('Visitors: Visitors 7 days after 10am');
  });
  it('a course with nothing known still says something', () => {
    expect(courseTip({ course: { name: 'X', area: 'Kiama NSW' } }).lines).toEqual(['Kiama NSW']);
    expect(courseTip({ course: { name: 'X' } }).lines[0]).toMatch(/open it for more/);
  });
  it('a place to stay: type, places saved, sleeps, price, nearest courses', () => {
    const stay = { key: 'Kiama', name: 'Kiama', lat: -34.67, lng: 150.85 };
    const courses = [{ id: 'k', name: 'Kiama Golf Club', lat: -34.68, lng: 150.85 }, { id: 'g', name: 'Gerringong GC', lat: -34.75, lng: 150.82 }, { id: 'far', name: 'Far GC', lat: -35.5, lng: 150.3 }];
    const ideas = [{ name: 'Beach house', total_cost: 2400, sleeps: 10 }, { name: 'Motel', total_cost: 1800, sleeps: 8 }];
    const t = stayTip({ stay, courses, ideas, people: 12 });
    expect(t.name).toBe('Kiama');
    expect(t.lines[0]).toBe('Town · 2 places saved · sleeps up to 10');
    expect(t.lines[1]).toBe('From $1800 (about $150 each)');
    expect(t.lines[2]).toMatch(/^⛳ Kiama under 5 min · Gerringong \d+ min · Far \d+ min$/); // right next door → "under 5"
    expect(nearestCourses(stay, courses, 1)[0].id).toBe('k');
    expect(stayTip({ stay: { name: 'Beachside', custom: true } }).lines[0]).toBe('Your pin');
    expect(stayIdeasSummary([], 10)).toEqual({ count: 0, from: null, each: null, sleeps: null });
  });
});

describe('click for everything', () => {
  it('every research field not already in the block, with plain labels', () => {
    const r = { details: { style: 'links', signature_features: 'The 7th over the cliffs', practice_facilities: 'Range and chipping green', dress_code: 'Collared shirts', best_months: 'Oct–Apr', food_and_drink: 'Bistro', pace_of_play: '4h15', crowd_notes: 'Busy on long weekends', weather_notes: 'Windy afternoons', nearby_courses: 'Gerringong', accommodation_on_site: 'Lodge (12 rooms)', odd_new_field: 'Something', nothing: 'n/a' } };
    const lines = extraResearchLines(r);
    const labels = lines.map((l) => l.label);
    expect(labels.slice(0, 3)).toEqual(['Signature', 'Practice', 'Food & drink']);
    for (const l of ['Dress code', 'Best months', 'Pace', 'Crowds', 'Weather', 'Nearby courses', 'Accommodation', 'Odd new field']) expect(labels).toContain(l);
    expect(labels).not.toContain('Style'); // already in the block
    expect(labels).not.toContain('Nothing');
    expect(extraResearchLines(null)).toEqual([]);
  });
  it('a map link for the spot', () => {
    expect(mapLink({ lat: -34.6712345, lng: 150.85 })).toBe('https://www.openstreetmap.org/?mlat=-34.67123&mlon=150.85000#map=14/-34.6712/150.8500');
    expect(mapLink({})).toBeNull();
  });
  it('mouse: click opens; phone: first tap summary, second tap on the same one opens', () => {
    expect(tapAction({ key: 'c:1', canHover: true })).toBe('open');
    expect(tapAction({ key: 'c:1', hotKey: null, canHover: false })).toBe('tip');
    expect(tapAction({ key: 'c:1', hotKey: 'c:2', canHover: false })).toBe('tip');
    expect(tapAction({ key: 'c:1', hotKey: 'c:1', canHover: false })).toBe('open');
  });
});
