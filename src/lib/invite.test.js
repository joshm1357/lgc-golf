import { describe, it, expect } from 'vitest';
import { inviteCode, inviteLink } from './invite.js';

describe('inviteCode', () => {
  it('finds the code in a link, a hash or on its own, any case', () => {
    expect(inviteCode('https://joshm1357.github.io/lgc-golf/#/join/ABCDEFGH2345')).toBe('ABCDEFGH2345');
    expect(inviteCode('#/join/abcdefgh2345')).toBe('ABCDEFGH2345');
    expect(inviteCode(' abcdefgh2345 ')).toBe('ABCDEFGH2345');
    expect(inviteCode('/join/ABCDEFGH2345')).toBe('ABCDEFGH2345');
  });
  it('ignores anything that is not a real code', () => {
    expect(inviteCode('#/plan/123')).toBeNull();
    expect(inviteCode('ABCDEFGH234')).toBeNull(); // 11 long
    expect(inviteCode('ABCDEFGH0123')).toBeNull(); // 0 and 1 are never used
    expect(inviteCode('')).toBeNull();
  });
});

describe('inviteLink', () => {
  it('builds the link', () => {
    expect(inviteLink('ABCDEFGH2345', 'https://x.test/lgc-golf/')).toBe('https://x.test/lgc-golf/#/join/ABCDEFGH2345');
  });
});
