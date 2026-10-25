import { describe, it, expect } from 'vitest';
import { closingLabel, closingLine, handicapCaseFromLink, isVerdictPost, toLocalInput } from './tribunalWords.js';

describe('Tribunal closing time words (ov38)', () => {
  it('says the Sydney day and time, like the database', () => {
    expect(closingLabel('2030-11-03T09:00:00Z')).toBe('Sun 8pm');      // AEDT +11
    expect(closingLabel('2030-11-08T20:30:00Z')).toBe('Sat 7:30am');
    expect(closingLabel('2031-06-01T10:00:00Z')).toBe('Sun 8pm');      // AEST +10
    expect(closingLabel(null)).toBe('');
    expect(closingLabel('nonsense')).toBe('');
  });
  it('the line under the votes', () => {
    const now = Date.parse('2030-11-03T05:00:00Z');
    expect(closingLine({ closes_at: '2030-11-03T09:00:00Z' }, now)).toBe('Voting closes Sun 8pm (sooner if everyone votes). The chair can close it early.');
    expect(closingLine({ closes_at: '2030-11-03T04:00:00Z' }, now)).toBe('Voting has closed — the verdict is on its way.');
    expect(closingLine({}, now)).toBe('Closes once everyone has voted, or when the chair closes it.');
  });
  it('finds a handicap case in a Feed link', () => {
    expect(handicapCaseFromLink('/tribunal/0b7c2d0e-1111-4222-8333-444455556666')).toBe('0b7c2d0e-1111-4222-8333-444455556666');
    expect(handicapCaseFromLink('/tribunal/case/0b7c2d0e-1111-4222-8333-444455556666')).toBe(null);
    expect(handicapCaseFromLink('/plan/x')).toBe(null);
    expect(handicapCaseFromLink(null)).toBe(null);
  });
  it('knows a verdict post (new and old words)', () => {
    expect(isVerdictPost('⚖️ GUILTY 3–1. Mike goes 30 → 26. The “one-off” defence didn\'t wash.')).toBe(true);
    expect(isVerdictPost('⚖️ NOT GUILTY 2–1. Chris walks free and stays on 27.')).toBe(true);
    expect(isVerdictPost('Verdict: NOT GUILTY 1–2. Chris Payton stays on 27.0.')).toBe(true);
    expect(isVerdictPost('⚖️ Mike\'s in the dock: “Hit them far too well!” 30 → 26 if guilty. Guilty or not? Vote by Sun 8pm.')).toBe(false);
    expect(isVerdictPost('🗣️ Mike\'s defence: “This was a one-off”')).toBe(false);
    expect(isVerdictPost(null)).toBe(false);
  });
  it('a datetime-local value round-trips', () => {
    const v = toLocalInput('2030-11-03T09:00:00Z');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(v).toISOString()).toBe('2030-11-03T09:00:00.000Z');
  });
});
