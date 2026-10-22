import { describe, it, expect } from 'vitest';
import { hasUnsavedWork, updateNow, watchTyping, typedIn, UNSAVED_QUESTION } from './unsaved.js';

// A tiny stand-in for the page: what's open and which text boxes are there.
const page = ({ sheet = false, fields = [] } = {}) => ({
  querySelector: (sel) => (sel.includes('.sheet-bg') && sheet ? {} : null),
  querySelectorAll: () => fields,
});
const ta = (value) => ({ tagName: 'TEXTAREA', value });
const input = (value, defaultValue = value, type = 'text', extra = {}) => ({ tagName: 'INPUT', type, value, defaultValue, ...extra });

describe('hasUnsavedWork', () => {
  it('an open sheet, or a text box with something typed', () => {
    expect(hasUnsavedWork(page())).toBe(false);
    expect(hasUnsavedWork(page({ sheet: true }))).toBe(true);
    expect(hasUnsavedWork(page({ fields: [ta('')] }))).toBe(false);
    expect(hasUnsavedWork(page({ fields: [ta('Who won the BD?')] }))).toBe(true);
    expect(hasUnsavedWork(page({ fields: [input('Kurt', '')] }))).toBe(true);
  });
  it('ignores boxes as they started, ticks, disabled and read-only ones', () => {
    expect(hasUnsavedWork(page({ fields: [input('14.2')] }))).toBe(false); // a pre-filled handicap, untouched
    expect(hasUnsavedWork(page({ fields: [input('on', '', 'checkbox')] }))).toBe(false);
    expect(hasUnsavedWork(page({ fields: [{ ...ta('x'), disabled: true }] }))).toBe(false);
    expect(hasUnsavedWork(page({ fields: [input('x', '', 'text', { readOnly: true })] }))).toBe(false);
    expect(hasUnsavedWork(null)).toBe(false);
  });
  it('a box someone typed in counts even when the app keeps its starting value in step', () => {
    const box = input('Bluey');
    expect(hasUnsavedWork(page({ fields: [box] }))).toBe(false);
    let handler = null;
    const doc = { addEventListener: (_t, fn) => { handler = fn; }, removeEventListener: () => { handler = null; } };
    const stop = watchTyping(doc);
    handler({ target: box });
    expect(typedIn.has(box)).toBe(true);
    expect(hasUnsavedWork(page({ fields: [box] }))).toBe(true);
    stop();
    expect(handler).toBe(null);
  });
});

describe('updateNow (the banner never reloads by itself)', () => {
  it('reloads straight away when nothing would be lost', () => {
    let reloaded = 0;
    let asked = 0;
    expect(updateNow({ doc: page(), ask: () => { asked++; return false; }, reload: () => { reloaded++; } })).toBe(true);
    expect([asked, reloaded]).toEqual([0, 1]);
  });
  it('asks first when something is unsaved, and only reloads on yes', () => {
    const seen = [];
    let reloaded = 0;
    expect(updateNow({ doc: page({ sheet: true }), ask: (q) => { seen.push(q); return false; }, reload: () => { reloaded++; } })).toBe(false);
    expect(reloaded).toBe(0);
    expect(updateNow({ doc: page({ fields: [ta('half a post')] }), ask: (q) => { seen.push(q); return true; }, reload: () => { reloaded++; } })).toBe(true);
    expect(reloaded).toBe(1);
    expect(seen).toEqual([UNSAVED_QUESTION, UNSAVED_QUESTION]);
  });
});
