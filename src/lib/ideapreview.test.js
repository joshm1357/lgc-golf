import { describe, it, expect } from 'vitest';
import { previewWords, previewPage, previewResponse, okToken } from './ideapreview.js';

const P = { name: 'March fly trip', when: 'March', where: 'Somewhere we fly to', travel: 'fly', by: 'Chris', group: 'The Lads', card_url: 'https://x.supabase.co/storage/v1/object/public/photos/g/ideas/1.jpg', plan_id: '11111111-1111-4111-8111-111111111111', fixed: {} };

describe('the trip idea link preview', () => {
  it('says the idea in a title and a line', () => {
    // ov42: an answer from before 110 (no stage) reads as collecting, with no deadline or counts.
    expect(previewWords(P)).toEqual({ title: '💡 March fly trip: have your say', description: 'Chris’s trip idea · March · Somewhere we fly to. Can you make it, budget, getting there, golf: 4 taps.' });
    expect(previewWords(null).title).toBe('A golf trip idea — The Golf Trip');
  });
  it('has the meta tags chat apps read, escaped', () => {
    const html = previewPage({ preview: { ...P, name: 'Big "<b>" trip' }, url: 'https://app.example/i/tok', image: 'https://app.example/brand/trip-512.png' });
    expect(html).toContain('<meta property="og:title" content="💡 Big &quot;&lt;b&gt;&quot; trip: have your say" />');
    expect(html).toContain(`<meta property="og:image" content="${P.card_url}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta property="og:url" content="https://app.example/i/tok" />');
    expect(html).not.toContain('<b>');
  });
  it('sends people on: the in-app link after the #, else the idea', () => {
    const html = previewPage({ preview: P });
    expect(html).toContain('"#/idea/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('location.replace("/" + h)');
    expect(previewPage({ preview: { ...P, plan_id: 'x"); alert(1); ("' } })).toContain('"#/"');
  });
  it('only looks up proper tokens, and copes with a lookup failing', async () => {
    expect(okToken('abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(okToken("x' or 1=1")).toBe(false);
    let asked = 0;
    const r = await previewResponse({ token: 'bad', rpc: async () => { asked++; return P; } });
    expect(asked).toBe(0);
    expect(r.headers['cache-control']).toBe('public, max-age=60');
    const ok = await previewResponse({ token: 'abcdefghijklmnopqrstuvwx', rpc: async () => P, image: 'https://a/b.png' });
    expect(ok.body).toContain('💡 March fly trip');
    expect(ok.headers['cache-control']).toBe('public, max-age=300');
    expect(ok.headers['content-type']).toMatch(/text\/html/);
    const failed = await previewResponse({ token: 'abcdefghijklmnopqrstuvwx', rpc: async () => { throw new Error('down'); }, image: 'https://a/b.png' });
    expect(failed.body).toContain('A golf trip idea');
    expect(failed.body).toContain('og:image" content="https://a/b.png"');
  });
});

describe('v10.7.1: picture sizes in the preview', async () => {
  const { previewPage } = await import('./ideapreview.js');
  it('the fallback icon is sent with its real square size', () => {
    const html = previewPage({ preview: null, url: 'https://x/i/abc', image: 'https://x/brand/trip-512.png' });
    expect(html).toContain('og:image:width" content="512"');
    expect(html).toContain('twitter:card" content="summary"');
  });
  it('an idea\'s own card is 1200 × 630', () => {
    const html = previewPage({ preview: { name: 'March', card_url: 'https://cdn/x.jpg' }, url: 'https://x/i/abc', image: 'https://x/brand/trip-512.png' });
    expect(html).toContain('og:image:width" content="1200"');
    expect(html).toContain('summary_large_image');
  });
});

describe('ov42: the preview says what is asked, and by when', async () => {
  const { ideaAsk, previewWords: words, shortWhen, defaultAnswerBy, shortDates, previewResponse: respond, TITLE_MAX, LINE_MAX } = await import('./ideapreview.js');
  // Mon 26 Oct 2026, 10am Sydney (daylight saving: UTC+11).
  const now = new Date('2026-10-25T23:00:00Z');
  const base = { name: 'Hunter trip', by: 'Chris', group: 'The Lads', when: 'March', where: 'Hunter Valley', fixed: {}, plan_id: '11111111-1111-4111-8111-111111111111' };

  it('times are short and in Sydney time', () => {
    expect(shortWhen('2026-10-29T07:00:00Z', now)).toBe('Thu 6pm');
    expect(shortWhen('2026-10-29T07:30:00Z', now)).toBe('Thu 6:30pm');
    expect(shortWhen('2026-10-26T07:00:00Z', now)).toBe('today 6pm');
    expect(shortWhen('2026-10-27', now)).toBe('tomorrow');
    expect(shortWhen('2026-11-05', now)).toBe('Thu 5 Nov');
    expect(shortWhen(null, now)).toBe('');
    expect(shortDates('2027-03-13', '2027-03-15')).toBe('13–15 Mar');
    expect(shortDates('2026-10-30', '2026-11-01')).toBe('30 Oct – 1 Nov');
  });
  it('the default deadline is 4 days on at 6pm Sydney', () => {
    expect(defaultAnswerBy(now).toISOString()).toBe('2026-10-30T07:00:00.000Z');
    // Winter (no daylight saving: UTC+10).
    expect(defaultAnswerBy(new Date('2026-06-01T02:00:00Z')).toISOString()).toBe('2026-06-05T08:00:00.000Z');
  });
  it('collecting: have your say by, and how many have answered', () => {
    const w = words({ ...base, stage: 'collecting', answer_by: '2026-10-29T07:00:00Z', answered: 3, people: 9 }, { now });
    expect(w.title).toBe('💡 Hunter trip: have your say by Thu 6pm');
    expect(w.description).toBe('Chris’s trip idea · March · Hunter Valley. 3 of 9 have answered. Can you make it, budget, getting there, golf: 4 taps.');
    const fixed = words({ ...base, stage: 'collecting', fixed: { weekend: { start: '2027-03-12', end: '2027-03-14' }, area: 'Cessnock' }, answered: 0, people: 4 }, { now });
    expect(fixed.description).toContain('· 12–14 Mar · Cessnock. 0 of 4 have answered.');
  });
  it('the vote: what is open, closing, how many voted', () => {
    const w = words({ ...base, stage: 'vote', vote_open: ['dates', 'location'], vote_closes: '2026-10-29', voted: 4, people: 9 }, { now });
    expect(w.title).toBe('🗳️ Hunter trip: vote by Thu');
    expect(w.description).toBe('When? and Where? are open · 4 of 9 voted. One tap each.');
    expect(words({ ...base, stage: 'vote', vote_open: ['location'], voted: 0, people: 9 }, { now }).title).toBe('🗳️ Hunter trip: vote now');
    expect(words({ ...base, stage: 'vote', vote_open: ['dates'], voted: 1, people: 9 }, { now }).description).toMatch(/^When\? is open/);
  });
  it('decided: where and when, and how many are in', () => {
    const w = words({ ...base, stage: 'decided', decided_where: 'Cessnock', decided_start: '2027-03-20', decided_end: '2027-03-22', in_count: 6 }, { now });
    expect(w).toEqual({ title: '✅ It’s on: Cessnock, 20–22 Mar', description: '6 in so far. Say if you’re in.' });
    expect(words({ ...base, stage: 'decided' }, { now }).title).toBe('✅ It’s on: Hunter trip');
  });
  it('counts never go backwards (n of m with m below n shows n of n)', () => {
    expect(words({ ...base, stage: 'collecting', answered: 5, people: 3 }, { now }).description).toContain('5 of 5 have answered');
  });
  it('keeps to WhatsApp lengths, and never carries a name from the lists', () => {
    const long = { ...base, name: 'The very long annual end of season Hunter Valley golf and wine weekend away', where: 'x'.repeat(200), when: 'y'.repeat(120), by: 'Bartholomew-Maximilian the Third', stage: 'collecting', answer_by: '2026-10-29T07:00:00Z', answered: 12, people: 14 };
    const a = ideaAsk(long, { now });
    expect(a.title.length).toBeLessThanOrEqual(TITLE_MAX + 1);
    expect(a.title).toMatch(/: have your say by Thu 6pm$/);
    expect(a.line.length).toBeLessThanOrEqual(LINE_MAX);
    expect(a.line).toMatch(/12 of 14 have answered/);
    for (const st of ['vote', 'decided']) {
      const b = ideaAsk({ ...long, stage: st, decided_where: 'z'.repeat(100), vote_open: ['dates'] }, { now });
      expect(b.title.length).toBeLessThanOrEqual(TITLE_MAX + 1);
      expect(b.line.length).toBeLessThanOrEqual(LINE_MAX);
    }
  });
  it('the fallback (no idea found) is unchanged', () => {
    expect(words(null)).toEqual({ title: 'A golf trip idea — The Golf Trip', description: 'Help plan it: 4 quick taps — your dates, budget, how you’d get there and what golf you’re after.' });
  });
  it('a slow database never holds the page up: the plain preview goes out at the time limit', async () => {
    let aborted = false;
    const slow = (token, signal) => new Promise((resolve) => { signal?.addEventListener('abort', () => { aborted = true; }); setTimeout(() => resolve(base), 5000); });
    const t0 = Date.now();
    const r = await respond({ token: 'abcdefghijklmnopqrstuvwx', rpc: slow, image: 'https://a/b.png', timeoutMs: 60 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe(200);
    expect(r.body).toContain('A golf trip idea');
    expect(r.headers['cache-control']).toBe('public, max-age=60');
    expect(aborted).toBe(true);
    const odd = await respond({ token: 'abcdefghijklmnopqrstuvwx', rpc: async () => 'not json', image: 'https://a/b.png' });
    expect(odd.body).toContain('A golf trip idea');
  });
});

describe('ov42: the app works out the same stage (share picture, summary)', async () => {
  const { previewFromPlan, pictureWords } = await import('./ideapreview.js');
  const now = new Date('2026-10-25T23:00:00Z');
  const plan = { id: 'p1', name: 'Hunter trip', status: 'planning', idea_when: 'March', idea_where: 'Hunter Valley', idea_fixed: {}, idea_answer_by: '2026-10-29T07:00:00Z' };
  it('collecting → the picture says have your say by', () => {
    const p = previewFromPlan({ plan, by: 'Chris', wishes: [{ spend_band: 'any' }, { spend_band: 'lt500' }] });
    expect(p.stage).toBe('collecting');
    expect(p.answered).toBe(2);
    expect(pictureWords(p, { now })).toEqual({ eyebrow: '💡 TRIP IDEA', title: 'Hunter trip', line: 'March · Hunter Valley', cta: 'Have your say by Thu 6pm', sub: 'from Chris' });
  });
  it('a When? / Where? vote open → vote by its closing day', () => {
    const polls = [{ id: 'q1', plan_id: 'p1', kind: 'dates', status: 'open', closes_on: '2026-10-29' }, { id: 'q2', plan_id: 'p1', kind: 'other', status: 'open' }];
    const p = previewFromPlan({ plan: { ...plan, idea_sent_at: '2026-10-26T00:00:00Z' }, polls, votes: [{ poll_id: 'q1', player_id: 'a' }, { poll_id: 'q2', player_id: 'b' }] });
    expect([p.stage, p.vote_open.join(), p.voted, p.vote_closes]).toEqual(['vote', 'dates', 1, '2026-10-29']);
    expect(pictureWords(p, { now }).cta).toBe('Vote by Thu');
  });
  it('locked in → It’s on', () => {
    const p = previewFromPlan({ plan: { ...plan, status: 'confirmed', location_name: 'Cessnock', start_date: '2027-03-20', end_date: '2027-03-22' }, rsvps: [{ player_id: 'a', status: 'in' }, { player_id: 'b', status: 'out' }] });
    expect([p.stage, p.in_count]).toEqual(['decided', 1]);
    expect(pictureWords(p, { now })).toMatchObject({ eyebrow: '✅ IT’S ON', title: 'Cessnock, 20–22 Mar', cta: 'Say if you’re in' });
  });
});
