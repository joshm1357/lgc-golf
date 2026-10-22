import { describe, it, expect } from 'vitest';
import {
  STANDARD_SECTIONS, standardRule, standardOptions, inUse, standardSections, overrideCount, RULE_IDEAS, freshIdeas, ideaToRule,
} from './standardrules.js';
import { CONDITION_KEYS } from './conditions.js';

describe('standard rules', () => {
  it('has a simplified rules of golf (15–25 rules) and unique, well-formed ids', () => {
    const golf = STANDARD_SECTIONS.find((s) => s.key === 'golf');
    expect(golf.rules.length).toBeGreaterThanOrEqual(15);
    expect(golf.rules.length).toBeLessThanOrEqual(25);
    const ids = STANDARD_SECTIONS.flatMap((s) => s.rules.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    // Matches the database check on rules.overrides (073).
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{2,30}\.[a-z0-9_]{2,30}$/);
    for (const s of STANDARD_SECTIONS) for (const r of s.rules) expect(r.text.length).toBeGreaterThan(20);
    expect(standardRule('golf.ob').title).toBe('Out of bounds');
    expect(standardRule('golf.nope')).toBeNull();
    expect(standardOptions().find((o) => o.id === 'golf.ob').label).toBe('Rules of golf, simplified — Out of bounds');
  });

  it('only the formats, games and comps the group uses show (plus show all)', () => {
    const used = inUse({
      rounds: [{ format: 'stableford', ctp_holes: [3], ld_holes: [] }, { format: 'ambrose', ctp_holes: [], ld_holes: [] }],
      games: [{ kind: 'skins' }, { kind: 'nassau', retired: true }, { kind: 'skins', custom_game_id: 'c1' }],
      customGames: [{ id: 'c1', base_type: 'skins' }, { id: 'c2', base_type: 'birdie_pool', retired: true }],
      comps: [{ kind: 'cup' }],
      ownDefs: [],
    });
    expect([...used].sort()).toEqual(['ambrose', 'ctp', 'cup', 'golf', 'skins', 'stableford']);
    const shown = standardSections({ used }).map((s) => s.key);
    expect(shown).toEqual(['golf', 'stableford', 'ambrose', 'cup', 'skins', 'ctp']);
    expect(standardSections({ used, showAll: true })).toHaveLength(STANDARD_SECTIONS.length);
    expect(standardSections({ used, showAll: true }).find((s) => s.key === 'nassau').used).toBe(false);
    expect([...inUse({})]).toEqual(['golf']);
    expect(inUse({ ownDefs: [{ retired: false }] }).has('own_comps')).toBe(true);
  });

  it('links a local rule to the standard rule it changes (active rules only)', () => {
    const local = [
      { id: 'r1', status: 'active', title: 'OB as lateral', overrides: 'golf.ob' },
      { id: 'r2', status: 'proposed', title: 'Gimmes', overrides: 'golf.green' },
      { id: 'r3', status: 'active', title: 'Typo', overrides: 'golf.unknown' },
      { id: 'r4', status: 'active', title: 'Plain' },
    ];
    const s = standardSections({ localRules: local });
    const golf = s.find((x) => x.key === 'golf');
    expect(golf.rules.find((r) => r.id === 'golf.ob').overriddenBy.map((r) => r.id)).toEqual(['r1']);
    expect(golf.rules.find((r) => r.id === 'golf.green').overriddenBy).toEqual([]);
    expect(overrideCount(s)).toBe(1);
  });

  it('ideas: about 20, our wording, each override points at a real standard rule, and already-added ones drop out', () => {
    expect(RULE_IDEAS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(RULE_IDEAS.map((i) => i.key)).size).toBe(RULE_IDEAS.length);
    for (const i of RULE_IDEAS) {
      if (i.overrides) expect(standardRule(i.overrides)).not.toBeNull();
      expect(['format', 'side_comp', 'bonus', 'handicap', 'etiquette', 'fines', 'other']).toContain(i.category);
    }
    const left = freshIdeas([{ title: 'Beer-can gimmes', status: 'active' }, { title: 'Breakfast ball', status: 'rejected' }]);
    expect(left.some((i) => i.key === 'beer_gimmes')).toBe(false);
    expect(left.some((i) => i.key === 'breakfast_ball')).toBe(true);
    const row = ideaToRule(RULE_IDEAS.find((i) => i.key === 'ob_lateral'));
    expect(row).toMatchObject({ title: 'Out of bounds plays like a penalty area', status: 'proposed', overrides: 'golf.ob', category: 'etiquette' });
    expect(CONDITION_KEYS.length).toBeGreaterThan(5);
  });
});
