import { describe, it, expect } from 'vitest';
import { canSend, remainingLabel, readReply, nextRating, askExamples, askTitle, MAX_TEXT, SETUP_EXAMPLE, PLAN_EXAMPLE } from './aihelper.js';

describe('canSend', () => {
  it('needs a few characters and not too many', () => {
    expect(canSend('')).toBe(false);
    expect(canSend('  hi ')).toBe(false);
    expect(canSend('Who won?')).toBe(true);
    expect(canSend(SETUP_EXAMPLE)).toBe(true);
    expect(canSend('x'.repeat(MAX_TEXT + 1))).toBe(false);
  });
});

describe('remainingLabel', () => {
  it('says what’s left for the group and for you', () => {
    expect(remainingLabel({ month: 57, today: 9 })).toBe('57 questions left this month for the group · 9 for you today');
    expect(remainingLabel({ month: 1 })).toBe('1 question left this month for the group');
    expect(remainingLabel(null)).toBe('');
  });
});

describe('readReply', () => {
  const remaining = { month: 10, today: 2 };
  it('a plan to confirm', () => {
    const plan = { trip: { name: 'Hunter' }, rounds: [], warnings: ['Those dates are in the past.'], notes: 'About 12 of you.' };
    const r = readReply({ plan, summary: ['Make the trip “Hunter”'], remaining });
    expect(r).toEqual({ kind: 'plan', plan, summary: ['Make the trip “Hunter”'], warnings: ['Those dates are in the past.'], notes: 'About 12 of you.', remaining });
  });
  it('an answer, a question back, and done', () => {
    expect(readReply({ answer: 'Bluey has.', remaining })).toEqual({ kind: 'answer', text: 'Bluey has.', remaining });
    expect(readReply({ message: 'Which dates?' })).toEqual({ kind: 'message', text: 'Which dates?', remaining: null });
    expect(readReply({ done: true, trip_id: 't1', made: ['Friday — Kurri'] })).toEqual({ kind: 'done', tripId: 't1', made: ['Friday — Kurri'], remaining: null });
  });
  it('errors: switched off, capped, not on yet, no signal, odd replies', () => {
    expect(readReply({ error: 'off', off: true })).toMatchObject({ kind: 'error', off: true });
    expect(readReply({ error: 'Used all 60', capped: true, remaining: { month: 0, today: 3 } })).toMatchObject({ kind: 'error', capped: true, remaining: { month: 0, today: 3 } });
    expect(readReply({ error: 'The AI helper isn’t switched on yet' }).text).toBe('The AI helper isn’t switched on yet');
    expect(readReply(null, { name: 'FunctionsFetchError', message: 'Failed to send a request' }).text).toMatch(/No signal/);
    expect(readReply(null, { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' }).text).toMatch(/Couldn’t reach the helper/);
    expect(readReply({}).kind).toBe('error');
  });
});

describe('v2: plans, ratings, where Ask was opened from', () => {
  it('a trip plan to confirm, and the log id for 👍 / 👎', () => {
    const trip_plan = { name: 'March Away', warnings: ['Only one place option'], notes: 'Two hours away.' };
    const r = readReply({ trip_plan, summary: ['Start the trip “March Away”'], remaining: { month: 9, today: 4 }, log_id: 42 });
    expect(r).toEqual({ kind: 'tripplan', plan: trip_plan, summary: ['Start the trip “March Away”'], warnings: ['Only one place option'], notes: 'Two hours away.', remaining: { month: 9, today: 4 }, logId: 42 });
    expect(readReply({ answer: 'Bluey leads.', log_id: 7 }).logId).toBe(7);
    expect(readReply({ done: true, plan_id: 'p1', made: ['the votes'] })).toEqual({ kind: 'done', planId: 'p1', made: ['the votes'], remaining: null });
  });
  it('tapping the same thumb clears it', () => {
    expect(nextRating(0, 1)).toBe(1);
    expect(nextRating(1, 1)).toBe(0);
    expect(nextRating(1, -1)).toBe(-1);
  });
  it('examples and headings depend on where Ask was opened', () => {
    expect(askExamples('round')[0]).toBe('Who’s leading?');
    expect(askExamples('trips')).toContain('Who won our last trip?');
    expect(askExamples()).toContain('What’s on today?');
    expect(askTitle('round').title).toBe('Ask about this round');
    expect(askTitle(null).title).toBe('Ask');
    expect(canSend(PLAN_EXAMPLE)).toBe(true);
  });
});
