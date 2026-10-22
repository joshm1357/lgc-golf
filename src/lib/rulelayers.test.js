import { describe, it, expect } from 'vitest';
import {
  rankOf, layerOf, roundContext, targetContext, appliesIn, effectiveRules, topicsOf, keywordConflicts, suggestOverride,
  filterChips, chipTarget, filterLocal, matchesSearch, scopeFromValue, scopeValue, scopeLabel, nameIndex, scopeOptions,
  loadFilter, saveFilter, overrideTitle,
} from './rulelayers.js';

const TRIP = 't1';
const R_AMB = { id: 'r-amb', trip_id: TRIP, format: 'ambrose', play_date: '2026-10-25', ctp_holes: [3], ld_holes: [], own_comps: [{ comp: 'def-putt', holes: [] }] };
const R_STB = { id: 'r-stb', trip_id: TRIP, format: 'stableford', play_date: '2026-10-24', ctp_holes: [], ld_holes: [7], own_comps: [] };
const rounds = [R_AMB, R_STB];
const BD = { id: '11111111-1111-4111-8111-111111111111', trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [], trophy_id: 'troph-bd' };
const PB = { id: '22222222-2222-4222-8222-222222222222', trip_id: TRIP, name: 'Putt Buddies', kind: 'ambrose_teams', round_ids: [], trophy_id: null };
const comps = [BD, PB];
const SKINS = { id: 'g-skins', round_id: 'r-amb', kind: 'skins', retired: false };
const CUSTOM = { id: 'cg-beer', name: 'Beer skins', base_type: 'skins', retired: false };
const SKINS2 = { id: 'g-beer', round_id: 'r-stb', kind: 'skins', custom_game_id: 'cg-beer', retired: false };
const games = [SKINS, SKINS2];
const data = { comps, rounds, games, customGames: [CUSTOM], trophies: [{ id: 'troph-bd', name: 'BD Trophy' }], ownDefs: [{ id: 'def-putt', name: 'Longest putt', emoji: '⛳' }] };
const names = nameIndex(data);

const rule = (id, extra = {}) => ({ id, title: id, detail: '', status: 'active', applies_to: ['all'], created_at: '2026-10-01', ...extra });

describe('rank and layer', () => {
  it('comp beats format beats golf; local beats standard; scoped beats local', () => {
    const golf = { standard: true, section: 'golf' };
    const fmt = { standard: true, section: 'ambrose' };
    const local = rule('l');
    const localAmb = rule('la', { applies_to: ['ambrose'] });
    const fmtScoped = rule('fs', { scope_kind: 'format', scope_key: 'ambrose' });
    const comp = rule('c', { scope_kind: 'comp', scope_id: PB.id });
    expect(rankOf(golf)).toBeLessThan(rankOf(fmt));
    expect(rankOf(fmt)).toBeLessThan(rankOf(local));
    expect(rankOf(local)).toBeLessThan(rankOf(localAmb));
    expect(rankOf(localAmb)).toBe(rankOf(fmtScoped));
    expect(rankOf(fmtScoped)).toBeLessThan(rankOf(comp));
    expect([layerOf(golf), layerOf(fmt), layerOf(local), layerOf(fmtScoped), layerOf(comp)]).toEqual(['golf', 'format', 'local', 'format', 'comp']);
  });
});

describe('contexts', () => {
  it('a round: its format, the comps it counts for (and trophies), games, custom games and side comps', () => {
    const ctx = roundContext(R_AMB, data);
    expect([...ctx.formats]).toEqual(['ambrose']);
    expect(ctx.compIds.has(PB.id)).toBe(true);
    expect(ctx.compIds.has(BD.id)).toBe(false); // BD is Stableford only
    expect(ctx.gameKeys.has('skins')).toBe(true);
    expect(ctx.sideKeys.has('ctp')).toBe(true);
    expect(ctx.sideIds.has('def-putt')).toBe(true);
    for (const k of ['golf', 'ambrose', 'skins', 'ctp', 'own_comps']) expect(ctx.standardKeys.has(k)).toBe(true);
    const s = roundContext(R_STB, data);
    expect(s.compIds.has(BD.id) && s.trophyIds.has('troph-bd')).toBe(true);
    expect(s.customGameIds.has('cg-beer')).toBe(true);
    expect(s.sideKeys.has('ld')).toBe(true);
  });
  it('a cup comp adds match play', () => {
    const cup = { id: '33333333-3333-4333-8333-333333333333', trip_id: TRIP, name: 'Ryder', kind: 'cup', round_ids: ['r-stb'] };
    expect(roundContext(R_STB, { ...data, comps: [cup] }).formats.has('cup')).toBe(true);
  });
  it('a comp target inherits the formats of its rounds', () => {
    const ctx = targetContext({ kind: 'comp', id: PB.id }, data);
    expect(ctx.formats.has('ambrose')).toBe(true);
    expect(ctx.formats.has('stableford')).toBe(false);
    expect(ctx.compIds.has(PB.id)).toBe(true);
    const t = targetContext({ kind: 'trophy', id: 'troph-bd' }, data);
    expect(t.compIds.has(BD.id) && t.trophyIds.has('troph-bd') && t.formats.has('stableford')).toBe(true);
    const g = targetContext({ kind: 'game', key: 'skins' }, data);
    expect(g.gameKeys.has('skins') && g.formats.has('ambrose') && g.formats.has('stableford')).toBe(true);
    const cg = targetContext({ kind: 'custom_game', id: 'cg-beer' }, data);
    expect(cg.customGameIds.has('cg-beer') && cg.gameKeys.has('skins')).toBe(true);
    expect(targetContext({ kind: 'format', key: 'stroke' }, data).standardKeys.has('stroke')).toBe(true);
    expect(targetContext(null, data).allFormats).toBe(true);
  });
  it('applies: scoped rules only where their target is in play; old applies_to still works', () => {
    const amb = roundContext(R_AMB, data);
    expect(appliesIn(rule('a'), amb)).toBe(true);
    expect(appliesIn(rule('b', { applies_to: ['stableford'] }), amb)).toBe(false);
    expect(appliesIn(rule('c', { applies_to: ['ambrose'] }), amb)).toBe(true);
    expect(appliesIn(rule('d', { scope_kind: 'comp', scope_id: PB.id }), amb)).toBe(true);
    expect(appliesIn(rule('e', { scope_kind: 'comp', scope_id: BD.id }), amb)).toBe(false);
    expect(appliesIn(rule('f', { scope_kind: 'game', scope_key: 'skins' }), amb)).toBe(true);
    expect(appliesIn(rule('g', { scope_kind: 'game', scope_key: 'nassau' }), amb)).toBe(false);
    expect(appliesIn(rule('h', { scope_kind: 'side_comp', scope_id: 'def-putt' }), amb)).toBe(true);
    expect(appliesIn(rule('i', { scope_kind: 'trophy', scope_id: 'troph-bd' }), roundContext(R_STB, data))).toBe(true);
    expect(appliesIn(rule('j', { scope_kind: 'custom_game', scope_id: 'cg-beer' }), amb)).toBe(false);
  });
});

describe('effective rules for a round', () => {
  const pbDrives = rule('pb-drives', { title: 'Putt Buddies: 3 drives each', scope_kind: 'comp', scope_id: PB.id, overrides: 'ambrose.drives', created_at: '2026-10-10' });
  const localOb = rule('local-ob', { title: 'OB plays as a penalty area', overrides: 'golf.ob' });
  const bdOb = rule('bd-ob', { title: 'BD: stroke and distance', scope_kind: 'comp', scope_id: BD.id, overrides: 'golf.ob' });
  const skinsNo18 = rule('skins-18', { title: 'Skins: no carry-overs on 18', scope_kind: 'game', scope_key: 'skins', overrides: 'skins.carry' });
  const retired = rule('old', { status: 'retired', overrides: 'golf.green' });
  const local = [pbDrives, localOb, bdOb, skinsNo18, retired];

  it('Ambrose round: comp rule overrides the Ambrose rule, game rule overrides skins, local beats golf', () => {
    const { items, layers, overriddenCount } = effectiveRules({ ctx: roundContext(R_AMB, data), localRules: local, names });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by['ambrose.drives'].overriddenBy).toEqual({ id: 'pb-drives', title: 'Putt Buddies: 3 drives each', scope: 'Putt Buddies' });
    expect(by['skins.carry'].overriddenBy.id).toBe('skins-18');
    expect(by['golf.ob'].overriddenBy.id).toBe('local-ob');
    expect(by['bd-ob']).toBeUndefined(); // BD isn't played on the Ambrose day
    expect(by['golf.green'].overriddenBy).toBeNull(); // a retired rule changes nothing
    expect(by['stableford.points']).toBeUndefined();
    expect(by['ctp.how']).toBeTruthy();
    expect(overriddenCount).toBe(3);
    expect(layers.map((l) => l.key)).toEqual(['golf', 'format', 'local', 'comp']);
  });
  it('Stableford round with the BD: the comp rule beats the group-wide local rule on the same standard rule', () => {
    const { items } = effectiveRules({ ctx: roundContext(R_STB, data), localRules: local, names });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by['golf.ob'].overriddenBy.id).toBe('bd-ob');
    expect(by['local-ob'].overriddenBy).toEqual({ id: 'bd-ob', title: 'BD: stroke and distance', scope: 'BD Trophy' });
    expect(by['bd-ob'].overriddenBy).toBeNull();
    expect(by['ambrose.drives']).toBeUndefined();
  });
  it('a comp rule can override one of our own rules (overrides_rule), and chains point at the rule in force', () => {
    const noGimmes = rule('no-gimmes', { title: 'No gimmes in the BD', scope_kind: 'comp', scope_id: BD.id, overrides_rule: 'leather' });
    const leather = rule('leather', { title: 'Gimmes inside the leather', overrides: 'golf.green' });
    const { items } = effectiveRules({ ctx: roundContext(R_STB, data), localRules: [leather, noGimmes], names });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.leather.overriddenBy.id).toBe('no-gimmes');
    expect(by['golf.green'].overriddenBy.id).toBe('no-gimmes'); // leather is itself overridden in the BD
    const amb = effectiveRules({ ctx: roundContext(R_AMB, data), localRules: [leather, noGimmes], names });
    expect(amb.items.find((i) => i.id === 'leather').overriddenBy).toBeNull();
  });
  it('a scoped rule at the same level: the newer one wins', () => {
    const a = rule('a', { scope_kind: 'comp', scope_id: PB.id, overrides: 'ambrose.drives', created_at: '2026-10-01' });
    const b = rule('b', { scope_kind: 'comp', scope_id: PB.id, overrides: 'ambrose.drives', created_at: '2026-10-05' });
    const { items } = effectiveRules({ ctx: roundContext(R_AMB, data), localRules: [a, b], names });
    expect(items.find((i) => i.id === 'a').overriddenBy.id).toBe('b');
  });
});

describe('topics and conflicts', () => {
  it('finds topics in wording', () => {
    expect(topicsOf({ title: 'Max 2 mulligans a round' })).toEqual(['mulligans']);
    expect(topicsOf({ title: 'Gimmes inside the leather' })).toContain('gimmes');
    expect(topicsOf({ title: 'Both drives must be used 3 times' })).toEqual(['drives']);
    expect(topicsOf({ title: 'Skins', detail: 'no carry-overs on 18' })).toEqual(['carry']);
    expect(topicsOf({ title: 'Winter rules', detail: 'lift, clean and place' })).toEqual(['preferred_lies']);
    expect(topicsOf({ title: 'OB is a drop' })).toEqual(['drops']);
    expect(topicsOf({ title: 'Team handicap is 10% of combined' })).toEqual(['handicap']);
    expect(topicsOf({ title: 'Max score double par' })).toEqual(['max_score']);
    expect(topicsOf({ standard: true, id: 'golf.green', title: 'On the green' })).toEqual(['gimmes']);
    expect(topicsOf({ title: 'Last place shouts' })).toEqual([]);
  });
  it('a comp rule about drives clashes with the Ambrose drives rule and our own drives rule', () => {
    const ours = rule('ours', { title: 'Four drives each in Ambrose', applies_to: ['ambrose'] });
    const draft = { title: 'Putt Buddies: both drives used 3 times', scope_kind: 'comp', scope_id: PB.id };
    const ctx = targetContext({ kind: 'comp', id: PB.id }, data);
    const c = keywordConflicts({ draft, ctx, localRules: [ours], names });
    expect(c.map((x) => x.id)).toEqual(['ours', 'ambrose.drives']);
    expect(c[1].reason).toBe('Both are about drives and tee shots');
    expect(suggestOverride(c)).toEqual({ overrides: null, overrides_rule: 'ours' });
    expect(suggestOverride([c[1]])).toEqual({ overrides: 'ambrose.drives', overrides_rule: null });
    expect(suggestOverride([])).toEqual({ overrides: null, overrides_rule: null });
  });
  it('a group-wide rule never clashes with a comp rule above it; rules it already changes are left out', () => {
    const comp = rule('comp-m', { title: 'BD: max 2 mulligans', scope_kind: 'comp', scope_id: BD.id });
    const draft = { title: 'One mulligan each nine', overrides: 'golf.as_it_lies' };
    const c = keywordConflicts({ draft, ctx: targetContext(null, data), localRules: [comp], names });
    expect(c).toEqual([]);
    expect(keywordConflicts({ draft: { title: 'Last place shouts' }, ctx: targetContext(null, data) })).toEqual([]);
  });
  it('overrideTitle names what a rule changes', () => {
    expect(overrideTitle({ overrides: 'golf.ob' })).toBe('Out of bounds');
    expect(overrideTitle({ overrides_rule: 'x' }, [{ id: 'x', title: 'Ours' }])).toBe('Ours');
    expect(overrideTitle({})).toBeNull();
  });
});

describe('filters', () => {
  it('chips: basics, formats played, comps (once per name), trophies without a comp, games, custom games, side comps', () => {
    const chips = filterChips({ ...data, comps: [...comps, { ...PB, id: 'old-pb', retired: true }], trophies: [...data.trophies, { id: 'spoon', name: 'Wooden Spoon' }] });
    const v = chips.map((c) => c.value);
    expect(v.slice(0, 6)).toEqual(['all', 'golf', 'formats', 'local', 'voted', 'waiting']);
    expect(v).toContain('format:ambrose');
    expect(v).toContain('format:stableford');
    expect(v).not.toContain('format:stroke');
    expect(v).toContain(`comp:${BD.id}`);
    expect(v).not.toContain('trophy:troph-bd'); // the BD's trophy is its comp
    expect(v).toContain('trophy:spoon');
    expect(v).not.toContain('comp:old-pb');
    expect(v).toContain('game:skins');
    expect(v).toContain('custom_game:cg-beer');
    expect(v).toContain('side_comp:ctp');
    expect(v).toContain('side_comp:ld');
    expect(v).toContain('side_comp:def-putt');
    const all = filterChips({ ...data, customGames: [{ ...CUSTOM, retired: true }] }, { showRetired: true });
    expect(all.find((c) => c.value === 'custom_game:cg-beer').retired).toBe(true);
    expect(filterChips({ ...data, customGames: [{ ...CUSTOM, retired: true }] }).some((c) => c.value === 'custom_game:cg-beer')).toBe(false);
  });
  it('chip targets and scope values', () => {
    expect(chipTarget(`comp:${BD.id}`)).toEqual({ kind: 'comp', id: BD.id, key: null });
    expect(chipTarget('game:skins')).toEqual({ kind: 'game', id: null, key: 'skins' });
    expect(chipTarget('voted')).toBeNull();
    expect(scopeFromValue(`comp:${BD.id}`)).toEqual({ scope_kind: 'comp', scope_id: BD.id, scope_key: null });
    expect(scopeFromValue('format:ambrose')).toEqual({ scope_kind: 'format', scope_id: null, scope_key: 'ambrose' });
    expect(scopeFromValue('')).toEqual({ scope_kind: null, scope_id: null, scope_key: null });
    expect(scopeFromValue('nonsense:x')).toEqual({ scope_kind: null, scope_id: null, scope_key: null });
    expect(scopeValue({ scope_kind: 'side_comp', scope_key: 'ld' })).toBe('side_comp:ld');
    expect(scopeLabel({ scope_kind: 'comp', scope_id: BD.id }, names)).toBe('BD Trophy');
    expect(scopeLabel({ scope_kind: 'game', scope_id: 'g-skins' }, names)).toBe('Skins (one round)');
    expect(scopeLabel({}, names)).toBeNull();
    const opts = scopeOptions(data);
    expect(opts[0]).toEqual({ value: '', label: 'Everything (a local rule)', group: 'Everything' });
    expect(opts.some((o) => o.value === `comp:${PB.id}` && o.group === 'Comps and trophies')).toBe(true);
    expect(opts.filter((o) => o.value === 'game:skins').length).toBe(1);
  });
  it('local filters: local, changed by a vote, waiting, and search', () => {
    const rules = [
      rule('a', { title: 'Beer-can gimmes' }),
      rule('b', { title: 'BD mulligans', scope_kind: 'comp', scope_id: BD.id }),
      rule('c', { title: 'Ambrose drives', scope_kind: 'format', scope_key: 'ambrose' }),
      rule('d', { title: 'Up for a vote', status: 'proposed' }),
      rule('e', { title: 'Changing next trip' }),
      rule('f', { title: 'Old', status: 'retired' }),
    ];
    const cases = [
      { id: 'k1', status: 'passed', kind: 'change_rule', rule_id: 'e', apply_state: 'waiting_next_trip' },
      { id: 'k2', status: 'passed', kind: 'ruling', rule_id: 'a', apply_state: 'applied' },
      { id: 'k3', status: 'failed', kind: 'change_rule', rule_id: 'c', apply_state: 'none' },
    ];
    const versions = [{ rule_id: 'a', case_id: 'k2', event: 'changed' }, { rule_id: 'c', case_id: 'k3', event: 'changed' }];
    const ids = (f, o = {}) => filterLocal(rules, f, { cases, versions, ...o }).map((r) => r.id);
    expect(ids('all')).toEqual(['a', 'b', 'c', 'e']);
    expect(ids('local')).toEqual(['a', 'c', 'e']);
    expect(ids('voted')).toEqual(['a']);
    expect(ids('waiting')).toEqual(['d', 'e']);
    expect(ids('all', { search: 'beer GIMMES' })).toEqual(['a']);
    expect(matchesSearch({ title: 'x', text: 'Out of bounds' }, 'bounds')).toBe(true);
    expect(matchesSearch({ title: 'x' }, '')).toBe(true);
  });
  it('remembers the last filter per session, and survives storage that throws', () => {
    const mem = {}; const s = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
    expect(loadFilter(s)).toEqual({ filter: 'all', round: null });
    saveFilter({ filter: 'voted', round: 'r1' }, s);
    expect(loadFilter(s)).toEqual({ filter: 'voted', round: 'r1' });
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(loadFilter(bad)).toEqual({ filter: 'all', round: null });
    expect(() => saveFilter({ filter: 'x' }, bad)).not.toThrow();
  });
});
