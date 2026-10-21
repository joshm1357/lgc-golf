import { describe, it, expect } from 'vitest';
import { checkFeedback, shouldShowWhatsNew, FEEDBACK_MAX, WHATS_NEW_ID } from './beta.js';

describe('checkFeedback', () => {
  it('accepts a normal message and tidies it', () => {
    expect(checkFeedback('idea', '  Add weather to the trip \r\n')).toEqual({ text: 'Add weather to the trip', error: '' });
  });
  it('needs a known kind', () => {
    expect(checkFeedback('rant', 'hello there').error).toMatch(/kind/);
    expect(checkFeedback(undefined, 'hello there').error).toMatch(/kind/);
  });
  it('needs a few words', () => {
    expect(checkFeedback('like', '  ').error).toMatch(/few words/);
    expect(checkFeedback('like', 'ok').error).toMatch(/few words/);
    expect(checkFeedback('like', 'yes').error).toBe('');
  });
  it('limits the length', () => {
    expect(checkFeedback('problem', 'x'.repeat(FEEDBACK_MAX)).error).toBe('');
    expect(checkFeedback('problem', 'x'.repeat(FEEDBACK_MAX + 1)).error).toMatch(/under/);
  });
});

describe('shouldShowWhatsNew', () => {
  it('shows once on builds with sign-in', () => {
    expect(shouldShowWhatsNew({ signInOn: true, seen: null })).toBe(true);
    expect(shouldShowWhatsNew({ signInOn: true, seen: WHATS_NEW_ID })).toBe(false);
    expect(shouldShowWhatsNew({ signInOn: true, seen: 'older-note' })).toBe(true);
  });
  it('never shows on the old live build (no sign-in)', () => {
    expect(shouldShowWhatsNew({ signInOn: false, seen: null })).toBe(false);
  });
});
