import { describe, it, expect } from 'vitest';
import { abVerdict, abView, money, reasonsLine, secs, twoPropZ, variantRow, MIN_RATED } from './abstats.js';
import { cleanNote, isReason, reasonLabel, REASONS, MAX_NOTE } from './feedback.js';
// The server's own assignment function (the edge function's file; plain TypeScript, no Deno-only parts).
import { abVariant, hash32 } from '../../supabase/functions/ai-helper/abtest.ts';

const uid = (i) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

describe('who gets which model (abVariant)', () => {
  it('is stable for a person', () => {
    for (let i = 0; i < 100; i++) expect(abVariant(uid(i), 'ab1', 50)).toBe(abVariant(uid(i), 'ab1', 50));
    expect(abVariant(uid(1).toUpperCase(), 'ab1', 50)).toBe(abVariant(uid(1), 'ab1', 50));
    expect(hash32('golf')).toBe(hash32('golf'));
  });
  it('respects the split, including 0% and 100%', () => {
    const onB = (pct) => Array.from({ length: 4000 }, (_, i) => abVariant(uid(i), 'ab1', pct)).filter((v) => v === 'B').length;
    expect(onB(0)).toBe(0);
    expect(onB(100)).toBe(4000);
    expect(onB(-5)).toBe(0);
    expect(Math.abs(onB(50) - 2000)).toBeLessThan(200);
    expect(Math.abs(onB(10) - 400)).toBeLessThan(100);
    expect(abVariant('', 'ab1', 50)).toBe('A');
  });
  it('a new salt starts a fresh shuffle', () => {
    const moved = Array.from({ length: 400 }, (_, i) => abVariant(uid(i), 'ab1', 50) !== abVariant(uid(i), 'ab2', 50)).filter(Boolean).length;
    expect(moved).toBeGreaterThan(120);
  });
});

describe('the verdict (two-proportion z-test)', () => {
  it('known values', () => {
    // A 20/40 (50%), B 30/40 (75%): pooled 62.5%, se 0.10825 → z 2.309
    const t = twoPropZ(20, 40, 30, 40);
    expect(t.pA).toBe(0.5);
    expect(t.pB).toBe(0.75);
    expect(t.z).toBeCloseTo(2.3094, 3);
    expect(twoPropZ(30, 60, 30, 60).z).toBe(0);
    expect(twoPropZ(40, 40, 40, 40).z).toBe(0); // both 100%: no spread, no difference
    expect(twoPropZ(1, 0, 1, 1)).toBe(null);
  });
  it('needs 30 rated answers on each before it says anything', () => {
    const v = abVerdict({ up: 29, down: 0 }, { up: 0, down: 40 });
    expect(v.kind).toBe('wait');
    expect(v.text).toBe('Not enough ratings yet — keep going (69 rated so far; needs 30 on each: A 29, B 40)');
    expect(MIN_RATED).toBe(30);
  });
  it('B better, A better, or keep going', () => {
    expect(abVerdict({ up: 20, down: 20 }, { up: 30, down: 10 })).toMatchObject({ kind: 'B', text: 'B is better (95% sure)' });
    expect(abVerdict({ up: 30, down: 10 }, { up: 20, down: 20 })).toMatchObject({ kind: 'A', text: 'A is better (95% sure)' });
    expect(abVerdict({ up: 20, down: 20 }, { up: 24, down: 16 })).toMatchObject({ kind: 'same', text: 'Not enough difference yet — keep going (80 rated so far)' });
    // Just under and just over 1.96.
    expect(abVerdict({ up: 15, down: 15 }, { up: 22, down: 8 }).kind).toBe('same'); // z ≈ 1.86
    expect(abVerdict({ up: 15, down: 15 }, { up: 23, down: 7 }).kind).toBe('B'); // z ≈ 2.13
  });
});

describe('results words', () => {
  it('times, money and reasons', () => {
    expect(secs(1234)).toBe('1.2 s');
    expect(secs(null)).toBe('—');
    expect(money(null)).toBe(null);
    expect(money(0.004)).toBe('<US$0.01');
    expect(money('1.5')).toBe('US$1.50');
    expect(reasonsLine({ slow: 1, wrong: 3, long: 1 })).toBe('Wrong 3 · Too slow 1 · Too long 1');
    expect(reasonsLine({})).toBe('—');
  });
  it('a variant row and the latest test', () => {
    const r = variantRow({ variant: 'B', questions: 10, people: 4, up: 6, down: 2, failed: 1, fallbacks: 1, median_ms: 2500, tokens_in: 1000, tokens_out: 200, cost: 0.02, reasons: { wrong: 2 }, models: [{ model: 'vendor/b' }] });
    expect(r).toMatchObject({ model: 'vendor/b', rated: 8, upShare: 75, errorRate: 10, median: '2.5 s', cost: 'US$0.02', reasons: 'Wrong 2' });
    const v = abView({ tests: [{ ab_test: 'ab2', variants: [{ variant: 'A', up: 1, down: 1 }, { variant: 'B', up: 2, down: 0 }] }, { ab_test: 'ab1', variants: [] }] });
    expect(v.name).toBe('ab2');
    expect(v.running).toBe(true);
    expect(v.verdict.kind).toBe('wait');
    expect(abView({ tests: [] })).toBe(null);
    expect(abView({ tests: [{ ab_test: 'ab1', variants: [{ variant: 'A', up: 1 }] }] })).toMatchObject({ running: false, verdict: null });
  });
});

describe('feedback reasons and notes', () => {
  it('six reasons, in plain words', () => {
    expect(REASONS.map((r) => r.label)).toEqual(['Wrong', 'Didn’t answer', 'Too slow', 'Too long', 'Not useful', 'Other']);
    expect(isReason('slow')).toBe(true);
    expect(isReason('rude')).toBe(false);
    expect(isReason('toString')).toBe(false);
    expect(reasonLabel('no_answer')).toBe('Didn’t answer');
  });
  it('notes are cleaned: one line, no tags or control characters, 200 max', () => {
    expect(cleanNote('  It said  Kurt\nwon <b>twice</b>\u0007 ')).toBe('It said Kurt won b twice /b');
    expect(cleanNote('   ')).toBe(null);
    expect(cleanNote(null)).toBe(null);
    expect(cleanNote('x'.repeat(500)).length).toBe(MAX_NOTE);
  });
});
