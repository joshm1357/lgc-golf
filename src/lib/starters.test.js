import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { STARTERS } from './starters.js';
import { roundSettingsFromRules } from './plan.js';

// The picker's list is written by hand; the rules themselves live in the newest migration that defines the function.
const sql = fs.readFileSync(new URL('../../supabase/migrations/032b_starter_review_fixes.sql', import.meta.url), 'utf8');
const rulesOf = (key) => [...sql.matchAll(new RegExp(`\\('${key}', '((?:[^']|'')+)'`, 'g'))].map((m) => m[1].replace(/''/g, "'"));

describe('starter rulebooks', () => {
  it('the picker lists the same rules, in order, as the database adds', () => {
    for (const s of STARTERS) {
      const titles = rulesOf(s.key);
      expect(titles.length).toBe(s.rules.length);
      s.rules.forEach((shown, i) => expect(shown.replace(/’/g, "'").startsWith(titles[i].replace(/’/g, "'"))).toBe(true));
    }
  });
  it('the Ambrose starter’s values drive round set-up', () => {
    const rows = [
      { title: 'Minimum drives', value: '4 drives each', applies_to: ['ambrose'], category: 'format', status: 'active' },
      { title: 'Closest to pin', value: '−2 strokes', applies_to: ['ambrose'], category: 'side_comp', status: 'active' },
    ];
    const s = roundSettingsFromRules(rows, 'ambrose');
    expect(s.min_drives).toBe(4);
    expect(s.comp_bonus).toBe(2);
  });
  it('no L.G.C names in the starters', () => {
    expect(/\bBD\b|Putt Buddies|Noodle|L\.G\.C|lads/.test(sql)).toBe(false);
  });
});
