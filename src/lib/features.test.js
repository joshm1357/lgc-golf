import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { FEATURES, featureOn, children } from './features.js';

describe('featureOn', () => {
  it('uses the default when a group has no setting', () => {
    expect(featureOn('feed', {})).toBe(true);
    expect(featureOn('location', {})).toBe(false);
    expect(featureOn('scoring', {})).toBe(true); // core: always on
  });
  it('a group setting wins', () => {
    expect(featureOn('location', { location: true })).toBe(true);
    expect(featureOn('feed', { feed: false })).toBe(false);
  });
  it('a feature is off when its parent is off', () => {
    expect(featureOn('planner_costs', { planner: false })).toBe(false);
    expect(featureOn('planner_costs', { planner: false, planner_costs: true })).toBe(false);
    expect(featureOn('comp_bonus', { comp_bonus: true })).toBe(true);
    expect(featureOn('comp_bonus', { comp_bonus: true, side_comps: false })).toBe(false);
  });
  it('lists dependants', () => {
    expect(children('planner').sort()).toEqual(['planner_costs', 'planner_rooms', 'planner_tasks', 'trip_finder', 'weather']);
  });
});

describe('the database list matches this one', () => {
  it('same keys, parents and defaults as the migrations (029, plus 036 for Clubhouse TV, … 071 for commentary)', () => {
    const sql = ['029_features.sql', '036_quick_round.sql', '050_cup.sql', '053_overnight_features.sql', '060_wave2_features.sql', '071_commentary.sql', '097_your_round_tips.sql', '102_saved_accounts.sql']
      .map((f) => fs.readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('\n');
    const rows = [...sql.matchAll(/\('([a-z_]+)', (true|false), (null|'[a-z_]+'), 'free'\)/g)]
      .map((m) => ({ key: m[1], newGroup: m[2] === 'true', parent: m[3] === 'null' ? null : m[3].slice(1, -1) }));
    expect(rows).toEqual(FEATURES.map((f) => ({ key: f.key, newGroup: f.newGroup, parent: f.parent })));
  });
});

import { PRESETS } from './features.js';
describe('presets for a new group', () => {
  it('every preset sets every feature, and never one that isn’t built yet', () => {
    for (const p of PRESETS) {
      expect(Object.keys(p.switches).sort()).toEqual(FEATURES.map((f) => f.key).sort());
      for (const f of FEATURES.filter((x) => x.soon)) expect(p.switches[f.key]).toBe(false);
    }
  });
  it('no preset turns on a feature whose parent is off', () => {
    for (const p of PRESETS) for (const f of FEATURES) if (f.parent && p.switches[f.key]) expect(p.switches[f.parent]).toBe(true);
  });
  it('just scoring keeps the extras off', () => {
    const s = PRESETS.find((p) => p.key === 'just_scoring').switches;
    expect(s.feed || s.tribunal || s.planner || s.trophies).toBe(false);
    expect(s.gps).toBe(true);
  });
});

import { followers, withFollowers } from './features.js';
describe('v8: running jokes are a background part of commentary, not a switch', () => {
  it('isn’t listed as a switch', () => {
    expect(FEATURES.filter((f) => !f.hidden).map((f) => f.key)).not.toContain('in_jokes');
  });
  it('is on exactly when commentary is on, whatever was stored', () => {
    expect(featureOn('in_jokes', { awards: true, commentary: true, in_jokes: false })).toBe(true);
    expect(featureOn('in_jokes', { awards: true, commentary: false, in_jokes: true })).toBe(false);
    expect(featureOn('in_jokes', { awards: false, in_jokes: true })).toBe(false); // commentary needs awards
  });
  it('the database copy is kept in step: switching commentary also switches it, and every preset matches', () => {
    expect(followers('commentary')).toEqual(['in_jokes']);
    expect(withFollowers({ commentary: true, in_jokes: false }).in_jokes).toBe(true);
    for (const p of PRESETS) expect(!!p.switches.in_jokes).toBe(!!p.switches.commentary);
  });
});
