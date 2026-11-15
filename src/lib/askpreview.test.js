import { describe, it, expect } from 'vitest';
import { askPreviewWords, askPreviewPage, askPreviewResponse, askToken, askShareLink, askCard, PLAIN } from './askpreview.js';

const TOK = 'ABCDEFGH23456789';
const P = { by: 'Josh', ask: { days: [], parts: [], range: { kind: 'next', days: 28 }, times: [] }, course: 'Moore Park', status: 'planning', card_url: 'https://x.supabase.co/storage/v1/object/public/photos/g/asks/1.jpg' };

describe('the round ask’s link preview', () => {
  it('says who’s asking, the ask in a line, and that there’s no sign-in', () => {
    expect(askPreviewWords(P)).toEqual({ title: '⛳ Josh: anyone keen for a round?', description: 'Any day · any time · next 4 weeks · Moore Park. Tap the times you can play. No app, no sign-in.' });
    expect(askPreviewWords({ ...P, by: null, course: null }).title).toBe('⛳ Anyone keen for a round?');
    expect(askPreviewWords({ ...P, status: 'confirmed' }).description).toBe('Moore Park · It’s locked in. Tap to see when.');
    expect(askPreviewWords({ ...P, status: 'cancelled' }).description).toBe('This one was called off.');
  });
  it('a bad or unknown token gets the plain The Golf Trip preview', async () => {
    expect(askPreviewWords(null)).toEqual(PLAIN);
    let asked = 0;
    const bad = await askPreviewResponse({ token: "x' or 1=1", rpc: async () => { asked++; return P; }, image: 'https://a/brand/trip-512.png' });
    expect(asked).toBe(0);
    expect(bad.body).toContain('<meta property="og:title" content="The Golf Trip" />');
    expect(bad.body).toContain('og:image" content="https://a/brand/trip-512.png"');
    expect(bad.body).toContain('<meta name="twitter:card" content="summary" />'); // the square icon, not a wide card
    expect(bad.body).not.toContain('og:image:width');
    expect(bad.headers['cache-control']).toBe('no-store');
    const unknown = await askPreviewResponse({ token: TOK, rpc: async () => null, image: 'https://a/b.png' });
    expect(unknown.body).toContain('<title>The Golf Trip</title>');
    const down = await askPreviewResponse({ token: TOK, rpc: async () => { throw new Error('down'); } });
    expect(down.status).toBe(200);
    expect(down.body).toContain('The Golf Trip');
  });
  it('a live token: the words, the picture, noindex, and the hop to the grid', async () => {
    const r = await askPreviewResponse({ token: TOK.toLowerCase(), url: `https://app.example/a/${TOK}`, rpc: async (t) => { expect(t).toBe(TOK); return P; }, image: 'https://a/b.png' });
    expect(r.body).toContain('<meta property="og:title" content="⛳ Josh: anyone keen for a round?" />');
    expect(r.body).toContain('Tap the times you can play. No app, no sign-in.');
    expect(r.body).toContain(`<meta property="og:image" content="${P.card_url}" />`);
    expect(r.body).toContain('<meta name="robots" content="noindex" />');
    expect(r.headers['x-robots-tag']).toBe('noindex');
    expect(r.body).toContain(`"#/a/${TOK}"`);
    expect(r.body).toContain('location.replace("/" + h)');
    expect(r.headers['cache-control']).toBe('public, max-age=300');
  });
  it('never carries contact details or anyone’s answer, even if the lookup handed them over', async () => {
    const leaky = { ...P, by: 'Josh "<script>"', email: 'sam@example.com', phone: '0412 345 678', answers: [{ name: 'Sam', slots: [] }], contacts: [{ email: 'al@example.com' }] };
    const r = await askPreviewResponse({ token: TOK, rpc: async () => leaky });
    expect(r.body).not.toMatch(/sam@example\.com|0412|al@example\.com|"Sam"/);
    expect(r.body).not.toContain('<script>"');
    expect(r.body).toContain('&lt;script&gt;');
  });
  it('the page itself is the same shape as the idea’s', () => {
    const html = askPreviewPage({ preview: P, token: TOK, url: 'https://app.example/a/x', image: '' });
    expect(html).toContain('<meta property="og:site_name" content="The Golf Trip" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(askPreviewPage({ preview: null, token: 'nope' })).toContain('"#/"');
  });
  it('tokens and the link to share', () => {
    expect(askToken(` ${TOK.toLowerCase()} `)).toBe(TOK);
    expect(askToken('ABCDEFGH2345678O')).toBeNull(); // no O, I, 0 or 1 in a token
    expect(askShareLink({ origin: 'https://app.thegolftrip.club', base: '/', token: TOK })).toBe(`https://app.thegolftrip.club/a/${TOK}`);
    expect(askShareLink({ origin: 'https://joshm1357.github.io', base: '/lgc-golf/', token: TOK })).toBe(`https://joshm1357.github.io/lgc-golf/#/a/${TOK}`);
  });
  it('the share picture’s words', () => {
    expect(askCard({ who: 'Josh', ask: P.ask, courseName: 'Moore Park', sun: 'Sunset 7:37' })).toEqual({
      eyebrow: '⛳ ANYONE KEEN FOR A ROUND?', title: 'Josh is asking', line: 'Any day · any time · next 4 weeks · Moore Park',
      cta: 'Tap the times you can play — no app, no sign-in', sub: 'Sunset 7:37',
    });
  });
});
