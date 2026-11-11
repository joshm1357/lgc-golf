import { describe, it, expect } from 'vitest';
import {
  askCells, askDates, isLong, askWords, cleanAsk, partWindow, finishWords, parseNote, narrow, answerSlots, quickPicks,
  typedPicks, usualFrom, prefill, rankCells, decideReady, voteChoices, nextBest, cellSpots, leaderLine, teeFor, rowKey,
  courseCheck, cleanWhere, whereSummary, funnel, funnelReading, againAsk, toMin, cellWords,
} from './ask.js';
import { spotList, promotedBy, rsvpSpots } from './callout.js';

const TODAY = '2026-11-12'; // a Thursday
const ASK = { days: ['thu', 'fri', 'sat', 'sun'], parts: [], range: { kind: 'next', days: 14 } };

describe('the ask', () => {
  it('covers the days asked, from tomorrow, four parts each', () => {
    const ds = askDates(ASK, TODAY);
    expect(ds[0]).toBe('2026-11-13'); // Fri
    expect(ds).toEqual(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-26']);
    expect(askCells(ASK, TODAY)).toHaveLength(8 * 4);
  });
  it('adds exact times on top, and drops past ones', () => {
    const cells = askCells({ ...ASK, parts: ['arvo'], times: [{ date: '2026-11-21', at: '1:20pm' }, { date: '2026-11-01', at: '9am' }] }, TODAY);
    const exact = cells.filter((c) => !c.part);
    expect(exact).toEqual([{ key: '2026-11-21|@13:20', date: '2026-11-21', part: null, from: '13:20', to: '13:20' }]);
  });
  it('twilight comes from that day’s sunset, and headings show a likely finish', () => {
    const w = partWindow('2026-11-21', 'twilight');
    expect(toMin(w.from)).toBeGreaterThan(15 * 60);
    expect(toMin(w.from)).toBeLessThan(17 * 60);
    expect(finishWords('2026-11-21', 'early')).toBe('done 10:30am');
    expect(finishWords('2026-11-21', 'twilight')).toMatch(/^till dark 7:\d\dpm$/);
  });
  it('long and open-ended asks', () => {
    expect(isLong(ASK, TODAY)).toBe(false);
    expect(isLong({ ...ASK, range: { kind: 'open' } }, TODAY)).toBe(true);
    expect(askDates({ days: ['fri'], range: { kind: 'open' } }, TODAY)).toHaveLength(8);
  });
  it('replies close: 2 days, by 6pm the day before, never under 12 hours', async () => {
    const { askCloses } = await import('./ask.js');
    const now = new Date('2026-11-11T20:30:00Z'); // Thu 12 Nov 7:30am Sydney
    expect(askCloses(ASK, TODAY, now).toISOString()).toBe('2026-11-12T08:30:00.000Z'); // first date tomorrow → 12 h
    expect(askCloses({ ...ASK, days: ['sat'] }, TODAY, now).toISOString()).toBe('2026-11-13T07:00:00.000Z'); // Fri 6pm
    expect(askCloses({ days: ['sat'], range: { kind: 'dates', dates: ['2026-11-28'] } }, TODAY, now).toISOString()).toBe('2026-11-13T20:30:00.000Z'); // 2 days
  });
  it('words and cleaning', () => {
    expect(askWords(ASK)).toBe('Thu, Fri, Sat, Sun · any time · next 2 weeks');
    expect(cleanAsk({ days: ['fri', 'xx'], parts: ['arvo', 'zz'], range: { kind: 'next', days: 999 }, times: [{ date: 'bad', at: '1pm' }] }))
      .toEqual({ days: ['fri'], parts: ['arvo'], range: { kind: 'next', days: 90 }, times: [] });
    expect(againAsk({ ...ASK, range: { kind: 'dates', dates: ['2026-11-21'] } }).range).toEqual({ kind: 'next', days: 14 });
  });
});

describe('notes on a square', () => {
  it('reads after / finish by / 9 holes', () => {
    expect(parseNote('only after 9')).toMatchObject({ after: '09:00', finishBy: null, nine: false });
    expect(parseNote('must finish by 12')).toMatchObject({ finishBy: '12:00' });
    expect(parseNote('home by 1pm, 9 holes only')).toMatchObject({ finishBy: '13:00', nine: true });
    expect(parseNote('need a cart').text).toBe('need a cart');
  });
  it('narrows the window, or rules the square out', () => {
    expect(narrow('08:00', '11:29', 'only after 9')).toEqual({ from: '09:00', to: '11:29' });
    expect(narrow('06:00', '07:59', 'must finish by 12')).toEqual({ from: '06:00', to: '07:30' });
    expect(narrow('11:30', '15:00', 'must finish by 12')).toBeNull();
    expect(narrow('11:30', '15:00', 'finish by 3, 9 holes')).toEqual({ from: '11:30', to: '12:45' });
  });
});

describe('the reply', () => {
  const cells = askCells(ASK, TODAY);
  it('one-tap answers', () => {
    expect(quickPicks('any', cells).size).toBe(cells.length);
    expect([...quickPicks('weekends', cells)].every((k) => /2026-11-(14|15|21|22)/.test(k))).toBe(true);
    const aw = quickPicks('afterwork', cells);
    expect([...aw].sort()).toEqual(['2026-11-13|twilight', '2026-11-19|twilight', '2026-11-20|twilight', '2026-11-26|twilight']);
  });
  it('type it: "fri arvos and any Sunday"', () => {
    const { picks, understood } = typedPicks('fri arvos and any Sunday', cells);
    expect(understood).toBe(true);
    expect(picks.has('2026-11-13|arvo')).toBe(true);
    expect(picks.has('2026-11-13|morning')).toBe(false);
    expect(picks.has('2026-11-15|early')).toBe(true);
    expect(picks.has('2026-11-22|twilight')).toBe(true);
    expect(typedPicks('whatever mate', cells).understood).toBe(false);
  });
  it('ticks + notes → slots; can’t dates on long asks', () => {
    const picks = new Set(['2026-11-14|morning', '2026-11-14|arvo']);
    const s = answerSlots(cells, picks, { notes: { '2026-11-14|arvo': 'must finish by 2' } });
    expect(s).toEqual([{ date: '2026-11-14', from: '08:00', to: '11:29', part: 'morning' }]); // the arvo note rules it out
    const long = { days: ['sat'], range: { kind: 'open' } };
    const lc = askCells(long, TODAY);
    const ws = answerSlots(lc, new Set(['sat|morning']), { weekly: true, cantDates: ['2026-11-21'] });
    expect(ws.map((x) => x.date)).not.toContain('2026-11-21');
    expect(ws).toHaveLength(7);
  });
  it('the usual week saves and prefills', () => {
    const picks = new Set(['2026-11-14|morning', '2026-11-21|morning', '2026-11-13|twilight']);
    const u = usualFrom(cells, picks, { notes: { '2026-11-14|morning': 'only after 9' } });
    expect(u.pattern).toEqual({ 'sat|morning': true, 'fri|twilight': true });
    expect(u.notes['sat|morning']).toBe('only after 9');
    const p = prefill(cells, u);
    expect(p.picks.has('2026-11-21|morning')).toBe(true);
    expect(p.picks.has('2026-11-20|twilight')).toBe(true);
    expect(p.notes['2026-11-21|morning']).toBe('only after 9');
    // Next time, Saturday morning offered and not ticked → forgotten; Sunday not offered → kept.
    const u2 = usualFrom(cells.filter((c) => rowKey(c) === 'sat|morning'), new Set(), { before: { pattern: { ...u.pattern, 'sun|arvo': true }, notes: u.notes } });
    expect(u2.pattern).toEqual({ 'fri|twilight': true, 'sun|arvo': true });
  });
});

// ------------------------------------------------------------------ the simulated group (test plan item 5)
describe('a simulated group of ten', () => {
  const cells = askCells(ASK, TODAY);
  const at = (h) => `2026-11-12T${String(h).padStart(2, '0')}:00:00Z`;
  const slotsFor = (picks, notes = {}) => answerSlots(cells, picks, { notes });
  const P = {
    keen1: { picks: quickPicks('any', cells), t: 1 },
    keen2: { picks: quickPicks('weekends', cells), t: 2 },
    nineToFive: { picks: quickPicks('afterwork', cells), t: 3 },
    parent: { picks: typedPicks('sat early, sun early', cells).picks, notes: {}, t: 4 },
    parentHomeBy: { picks: typedPicks('sat morning', cells).picks, notes: { '2026-11-21|morning': 'must finish by 1' }, t: 5 },
    regular: { picks: typedPicks('sat arvo, sun arvo', cells).picks, t: 6 },
    regular2: { picks: typedPicks('sat', cells).picks, t: 7 },
    shifty: { picks: typedPicks('fri arvo, sat arvo', cells).picks, t: 8 },
    lurker: { picks: typedPicks('sat arvo', cells).picks, t: 20 }, // decides late
    cant: { cant: true, t: 9 },
  };
  const answers = Object.entries(P).map(([id, p]) => ({ player_id: id, cant: !!p.cant, slots: p.cant ? [] : slotsFor(p.picks, p.notes), first_at: at(p.t) }));

  it('picks the first good slot that fills a group', () => {
    const ranked = rankCells(cells, answers);
    expect(cellWords(ranked[0].cell)).toBe('Sat 14 arvo');
    expect(ranked[0].can).toEqual(['keen1', 'keen2', 'regular', 'regular2', 'shifty', 'lurker']);
    expect(leaderLine(ranked[0])).toBe('Sat 14 arvo · 6 can');
    expect(decideReady(ranked, { spots: 4 })).toEqual({ ready: true, why: 'full' });
    expect(decideReady(ranked, { spots: 8 }).ready).toBe(false);
    expect(decideReady(ranked, { spots: 8, closesAt: '2026-11-12T00:00:00Z', now: new Date('2026-11-12T01:00:00Z') })).toEqual({ ready: true, why: 'closed' });
  });
  it('spots go in reply order; the late lurker is on reserve', () => {
    const ranked = rankCells(cells, answers);
    expect(cellSpots(ranked[0], 4)).toEqual({ in: ['keen1', 'keen2', 'regular', 'regular2'], reserve: ['shifty', 'lurker'] });
    // the same order the database's lock-in uses (103's spot rule)
    const entries = ranked[0].can.map((id) => ({ player_id: id, at: answers.find((a) => a.player_id === id).first_at }));
    expect(spotList({ cap: 4, entries })).toEqual(cellSpots(ranked[0], 4));
  });
  it('the home-by note keeps the parent out of a slot they can’t finish', () => {
    const ranked = rankCells(cells, answers);
    const satMorn = ranked.find((r) => r.cell.key === '2026-11-21|morning');
    expect(satMorn.can).toContain('parentHomeBy');
    expect(satMorn.notes).toEqual([{ player_id: 'parentHomeBy', note: 'must finish by 1' }]);
    const sat21Arvo = ranked.find((r) => r.cell.key === '2026-11-21|arvo');
    expect(sat21Arvo.can).not.toContain('parentHomeBy');
  });
  it('“Full” moves to the next-best slot', () => {
    const ranked = rankCells(cells, answers);
    const nb = nextBest(ranked, [ranked[0].cell.key]);
    expect(cellWords(nb.cell)).toBe('Sat 21 arvo');
    expect(nb.can.length).toBe(6);
    expect(rankCells(cells, answers, { full: [ranked[0].cell.key] })[0].cell.key).toBe(nb.cell.key);
  });
  it('put 2–3 to a vote', () => {
    const v = voteChoices(rankCells(cells, answers), 3);
    expect(v).toHaveLength(3);
    expect(v.every((r) => r.can.length >= 2)).toBe(true);
  });
  it('pull-outs after lock-in move the first reserve up (103)', () => {
    const ranked = rankCells(cells, answers);
    const rsvps = ranked[0].can.map((id) => ({ player_id: id, status: 'in', first_in_at: answers.find((a) => a.player_id === id).first_at }));
    expect(promotedBy({ cap: 4, rsvps }, 'keen2')).toBe('shifty');
    const after = rsvpSpots({ cap: 4, rsvps: rsvps.map((r) => (r.player_id === 'keen2' ? { ...r, status: 'out' } : r)) });
    expect(after.in).toEqual(['keen1', 'regular', 'regular2', 'shifty']);
    expect(after.reserve).toEqual(['lurker']);
  });
  it('people who haven’t replied count as probably, never as can', () => {
    const usual = usualFrom(cells, typedPicks('sat arvo', cells).picks);
    const probably = [{ player_id: 'quiet', slots: answerSlots(cells, prefill(cells, usual).picks) }];
    const ranked = rankCells(cells, answers.slice(0, 2), { probably });
    const top = ranked.find((r) => r.cell.key === '2026-11-14|arvo');
    expect(top.probably).toEqual(['quiet']);
    expect(top.can).not.toContain('quiet');
  });
  it('a can’t-this-round reply is never matched', () => {
    expect(rankCells(cells, answers).every((r) => !r.can.includes('cant'))).toBe(true);
  });
});

describe('locking, course check, where, funnel', () => {
  it('tee time inside the window', () => {
    const c = { date: '2026-11-21', part: 'arvo', from: '11:30', to: '15:00' };
    expect(teeFor(c, '1:20pm')).toBe('13:20');
    expect(teeFor(c, '7am')).toBe('11:30');
  });
  it('course check: visitors, daylight, booking', () => {
    const cell = { date: '2026-11-21', part: 'early', from: '06:00', to: '07:59' };
    const sat = { windows: [{ from: 12 * 60 + 30, to: null }], known: false };
    expect(courseCheck({ cell, windows: sat }).words).toBe('Members only then (unconfirmed) · daylight ✓ · no booking link yet');
    const arvo = { ...cell, part: 'arvo', from: '13:00', to: '15:00' };
    expect(courseCheck({ cell: arvo, windows: { ...sat, known: true }, booking: 'https://x' }).words).toBe('Visitors OK · daylight ✓ · booking link ✓');
  });
  it('where: any by default, and the group’s picks counted', () => {
    expect(cleanWhere({})).toEqual({ any: true, courses: [], wishes: [] });
    const s = whereSummary([
      { where: cleanWhere({ courses: [{ id: 'a', kind: 'group', name: 'Moore Park' }], wishes: ['nine_ok'] }) },
      { where: cleanWhere({ courses: [{ id: 'a', kind: 'group', name: 'Moore Park' }, { id: 'b', kind: 'library', name: 'Bondi' }] }) },
      { cant: true, where: cleanWhere({ courses: [{ id: 'b', kind: 'library', name: 'Bondi' }] }) },
    ]);
    expect(s.courses.map((c) => [c.name, c.n])).toEqual([['Moore Park', 2], ['Bondi', 1]]);
    expect(s.wishes).toEqual({ nine_ok: 1 });
  });
  it('the funnel and its two numbers', () => {
    const ev = [
      { plan_id: 'p', player_id: 'a', kind: 'asked', at: '2026-11-12T00:00:00Z' },
      { plan_id: 'p', player_id: 'b', kind: 'asked', at: '2026-11-12T00:00:00Z' },
      { plan_id: 'p', player_id: 'a', kind: 'opened', at: '2026-11-12T01:00:00Z' },
      { plan_id: 'p', player_id: 'b', kind: 'opened', at: '2026-11-12T03:00:00Z' },
      { plan_id: 'p', player_id: 'a', kind: 'replied', at: '2026-11-12T01:00:30Z' },
      { plan_id: 'p', player_id: 'o', kind: 'locked', at: '2026-11-12T06:00:00Z' },
    ];
    const f = funnel(ev);
    expect(f.steps.map((s) => s.n)).toEqual([2, 2, 1, 1, 0, 0]);
    expect(f.replyRate).toBe(0.5);
    expect(f.hoursToLock).toBe(6);
    expect(funnelReading(f)).toMatch(/reply screen/);
  });
});

describe('sharing', () => {
  it('the WhatsApp message', async () => {
    const { askShareText } = await import('./ask.js');
    expect(askShareText({ who: 'Bo', ask: ASK, link: 'https://x/#/plan/1?c=1' })).toBe('⛳ Bo: anyone keen for a round?\nThu, Fri, Sat, Sun · any time · next 2 weeks\nTap the times you can play (10 seconds): https://x/#/plan/1?c=1');
  });
});
