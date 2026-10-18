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
    expect(children('planner').sort()).toEqual(['planner_costs', 'planner_rooms', 'planner_tasks']);
  });
});

describe('the database list matches this one', () => {
  it('same keys, parents and defaults as migration 029', () => {
    const sql = fs.readFileSync(new URL('../../supabase/migrations/029_features.sql', import.meta.url), 'utf8');
    const rows = [...sql.matchAll(/\('([a-z_]+)', (true|false), (null|'[a-z_]+'), 'free'\)/g)]
      .map((m) => ({ key: m[1], newGroup: m[2] === 'true', parent: m[3] === 'null' ? null : m[3].slice(1, -1) }));
    expect(rows).toEqual(FEATURES.map((f) => ({ key: f.key, newGroup: f.newGroup, parent: f.parent })));
  });
});
