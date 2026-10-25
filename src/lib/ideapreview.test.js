import { describe, it, expect } from 'vitest';
import { previewWords, previewPage, previewResponse, okToken } from './ideapreview.js';

const P = { name: 'March fly trip', when: 'March', where: 'Somewhere we fly to', travel: 'fly', by: 'Chris', group: 'The Lads', card_url: 'https://x.supabase.co/storage/v1/object/public/photos/g/ideas/1.jpg', plan_id: '11111111-1111-4111-8111-111111111111', fixed: {} };

describe('the trip idea link preview', () => {
  it('says the idea in a title and a line', () => {
    expect(previewWords(P)).toEqual({ title: '💡 March fly trip', description: 'Chris’s trip idea for The Lads — March · Somewhere we fly to · flying. Help plan it: 4 quick taps.' });
    expect(previewWords(null).title).toBe('A golf trip idea — The Golf Trip');
  });
  it('has the meta tags chat apps read, escaped', () => {
    const html = previewPage({ preview: { ...P, name: 'Big "<b>" trip' }, url: 'https://app.example/i/tok', image: 'https://app.example/brand/trip-512.png' });
    expect(html).toContain('<meta property="og:title" content="💡 Big &quot;&lt;b&gt;&quot; trip" />');
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
    expect(r.headers['cache-control']).toBe('no-store');
    const ok = await previewResponse({ token: 'abcdefghijklmnopqrstuvwx', rpc: async () => P, image: 'https://a/b.png' });
    expect(ok.body).toContain('💡 March fly trip');
    expect(ok.headers['content-type']).toMatch(/text\/html/);
    const failed = await previewResponse({ token: 'abcdefghijklmnopqrstuvwx', rpc: async () => { throw new Error('down'); }, image: 'https://a/b.png' });
    expect(failed.body).toContain('A golf trip idea');
    expect(failed.body).toContain('og:image" content="https://a/b.png"');
  });
});
