// The Rulebook v3 (migration 076): layers of rules and which ones apply. Pure functions, no screen code.
//
// Layers, most general first. A more specific layer beats a more general one when they cover the same thing:
//   0 golf    — the rules of golf, simplified (standard, lib/standardrules.js)
//   1 format  — the standard rules of a format, game or side comp (Stableford, Ambrose, skins, longest drive…)
//   2 local   — the group's own rules for everything (no scope, applies_to 'all')
//   3 local   — the group's own rules for one format (scope_kind 'format', or an older rule with applies_to set)
//   4 comp    — rules for one comp, trophy, game, custom game or side comp ("BD Trophy: max 2 mulligans a round")
// So "local beats all unless scoped": a group-wide local rule beats the standard rules, and a comp-specific rule
// beats the group-wide one — but only for that comp.
//
// A rule changes another explicitly: rules.overrides (a standard rule id like 'golf.ob') or rules.overrides_rule (one
// of the group's own rules). When several rules in play change the same rule, the most specific one wins and the
// others show "overridden by". The topic check (gimmes, mulligans, drops…) only WARNS when a rule is written; it never
// strikes anything out on its own.
import { STANDARD_SECTIONS, standardRule } from './standardrules.js';
import { compRounds, roundComps } from './comps.js';

export const FORMAT_KEYS = ['stableford', 'ambrose', 'stroke', 'fourball', 'cup'];
export const FORMAT_LABEL = { stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'Stroke play', fourball: '4BBB', cup: 'Match play' };
export const GAME_LABEL = { skins: 'Skins', nassau: 'Nassau', stableford_pot: 'Stableford pot', birdie_pool: 'Birdie pool', eclectic: 'Eclectic' };
export const SIDE_LABEL = { ctp: 'Closest to the pin', ld: 'Longest drive' };
export const SCOPE_KINDS = ['format', 'comp', 'trophy', 'game', 'custom_game', 'side_comp'];

export const LAYERS = [
  { key: 'golf', rank: 0, title: 'Rules of golf', emoji: '⛳' },
  { key: 'format', rank: 1, title: 'Format and game rules', emoji: '📘' },
  { key: 'local', rank: 2, title: 'Our local rules', emoji: '🏌️' },
  { key: 'comp', rank: 4, title: 'Comp rules', emoji: '🏆' },
];

const SECTION_BY_KEY = Object.fromEntries(STANDARD_SECTIONS.map((s) => [s.key, s]));
const arr = (v) => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ rank

/** How specific a rule is (higher beats lower). Standard rules: { standard: true, section }. */
export function rankOf(rule) {
  if (!rule) return -1;
  if (rule.standard) return rule.section === 'golf' ? 0 : 1;
  const k = rule.scope_kind || null;
  if (k && k !== 'format') return 4;
  if (k === 'format') return 3;
  const a = arr(rule.applies_to);
  if (!a.length || a.includes('all') || a.includes('trip')) return 2;
  return 3;
}

/** Which layer a rule is shown in: 'golf' | 'format' | 'local' | 'comp'. */
export function layerOf(rule) {
  const r = rankOf(rule);
  if (r === 0) return 'golf';
  if (r === 1) return 'format';
  if (r === 4) return 'comp';
  return rule.scope_kind === 'format' ? 'format' : 'local';
}

// ------------------------------------------------------------------ contexts (what's in play)

const emptyCtx = () => ({
  formats: new Set(), compIds: new Set(), trophyIds: new Set(), gameKeys: new Set(), gameIds: new Set(),
  customGameIds: new Set(), sideKeys: new Set(), sideIds: new Set(), standardKeys: new Set(['golf']), allFormats: false,
});

function finish(ctx) {
  for (const f of ctx.formats) ctx.standardKeys.add(f);
  for (const k of ctx.gameKeys) ctx.standardKeys.add(k);
  for (const k of ctx.sideKeys) ctx.standardKeys.add(k);
  if (ctx.sideIds.size) ctx.standardKeys.add('own_comps');
  return ctx;
}

function addRound(ctx, round, { games = [], customGames = [] } = {}) {
  if (!round) return;
  if (round.format) ctx.formats.add(round.format);
  if (arr(round.ctp_holes).length) ctx.sideKeys.add('ctp');
  if (arr(round.ld_holes).length) ctx.sideKeys.add('ld');
  for (const c of arr(round.own_comps)) if (c?.comp) ctx.sideIds.add(c.comp);
  const customById = Object.fromEntries(arr(customGames).map((c) => [c.id, c]));
  for (const g of arr(games)) {
    if (g?.round_id !== round.id || g.retired) continue;
    ctx.gameIds.add(g.id);
    ctx.gameKeys.add(customById[g.custom_game_id]?.base_type || g.kind);
    if (g.custom_game_id) ctx.customGameIds.add(g.custom_game_id);
  }
}

function addComp(ctx, comp) {
  if (!comp) return;
  if (comp.id && !comp.virtual) ctx.compIds.add(comp.id);
  if (comp.trophy_id) ctx.trophyIds.add(comp.trophy_id);
  if (comp.kind === 'cup') ctx.formats.add('cup');
}

/**
 * What's in play for a round: its format, the comps (and their trophies) it counts for, its games (and custom
 * games), and its side comps. data: { comps (trip comps, may include trophy stand-ins), rounds, games, customGames }.
 */
export function roundContext(round, data = {}) {
  const ctx = emptyCtx();
  if (!round) return finish(ctx);
  addRound(ctx, round, data);
  for (const c of roundComps(round, arr(data.comps), arr(data.rounds))) addComp(ctx, c);
  return finish(ctx);
}

/**
 * What's in play for a filter target (a comp, trophy, game…): the target itself and the layers it inherits — the
 * formats of the rounds it's played in. target: { kind, id?, key? } (kind null = the group's local rules overall).
 * data: { comps, trophies, rounds, games, customGames, ownDefs }.
 */
export function targetContext(target, data = {}) {
  const ctx = emptyCtx();
  const rounds = arr(data.rounds);
  const games = arr(data.games).filter((g) => !g.retired);
  const kind = target?.kind || null;
  const roundsOfGames = (list) => rounds.filter((r) => list.some((g) => g.round_id === r.id));
  if (!kind) {
    ctx.allFormats = true;
    for (const r of rounds) if (r.format) ctx.formats.add(r.format);
    return finish(ctx);
  }
  if (kind === 'format') {
    ctx.formats.add(target.key);
    return finish(ctx);
  }
  if (kind === 'comp' || kind === 'trophy') {
    const comps = arr(data.comps).filter((c) => (kind === 'comp' ? c.id === target.id : c.trophy_id === target.id));
    if (kind === 'trophy') ctx.trophyIds.add(target.id);
    for (const c of comps) {
      addComp(ctx, c);
      for (const r of compRounds(c, rounds)) {
        if (r.format) ctx.formats.add(r.format);
        if (c.kind === 'side_comps') addRound(ctx, { ...r, format: r.format }, {});
        if (c.kind === 'games') addRound(ctx, r, { games, customGames: data.customGames });
      }
    }
    return finish(ctx);
  }
  if (kind === 'game') {
    if (target.key) {
      ctx.gameKeys.add(target.key);
      const these = games.filter((g) => g.kind === target.key);
      for (const g of these) ctx.gameIds.add(g.id);
      for (const r of roundsOfGames(these)) if (r.format) ctx.formats.add(r.format);
    } else {
      const g = games.find((x) => x.id === target.id) || arr(data.games).find((x) => x.id === target.id);
      ctx.gameIds.add(target.id);
      if (g) {
        ctx.gameKeys.add(g.kind);
        if (g.custom_game_id) ctx.customGameIds.add(g.custom_game_id);
        for (const r of roundsOfGames([g])) if (r.format) ctx.formats.add(r.format);
      }
    }
    return finish(ctx);
  }
  if (kind === 'custom_game') {
    const c = arr(data.customGames).find((x) => x.id === target.id);
    ctx.customGameIds.add(target.id);
    if (c) ctx.gameKeys.add(c.base_type);
    const these = games.filter((g) => g.custom_game_id === target.id);
    for (const g of these) ctx.gameIds.add(g.id);
    for (const r of roundsOfGames(these)) if (r.format) ctx.formats.add(r.format);
    return finish(ctx);
  }
  if (kind === 'side_comp') {
    if (target.key) ctx.sideKeys.add(target.key);
    else ctx.sideIds.add(target.id);
    return finish(ctx);
  }
  return finish(ctx);
}

/** Everything the group has (for searching the whole Rulebook): every standard section and every rule applies. */
export function everythingContext(data = {}) {
  const ctx = emptyCtx();
  ctx.allFormats = true;
  for (const f of FORMAT_KEYS) ctx.formats.add(f);
  for (const c of arr(data.comps)) addComp(ctx, c);
  for (const t of arr(data.trophies)) ctx.trophyIds.add(t.id);
  for (const g of arr(data.games)) { ctx.gameIds.add(g.id); ctx.gameKeys.add(g.kind); }
  for (const k of Object.keys(GAME_LABEL)) ctx.gameKeys.add(k);
  for (const c of arr(data.customGames)) ctx.customGameIds.add(c.id);
  for (const k of Object.keys(SIDE_LABEL)) ctx.sideKeys.add(k);
  for (const d of arr(data.ownDefs)) ctx.sideIds.add(d.id);
  ctx.standardKeys = new Set(STANDARD_SECTIONS.map((s) => s.key));
  return ctx;
}

/** Does a local rule apply in this context? */
export function appliesIn(rule, ctx) {
  if (!rule || !ctx) return false;
  const k = rule.scope_kind || null;
  if (!k) {
    const a = arr(rule.applies_to);
    if (!a.length || a.includes('all') || a.includes('trip')) return true;
    if (ctx.allFormats) return true;
    return a.some((f) => ctx.formats.has(f));
  }
  if (k === 'format') return ctx.allFormats ? true : ctx.formats.has(rule.scope_key);
  if (k === 'comp') return ctx.compIds.has(rule.scope_id);
  if (k === 'trophy') return ctx.trophyIds.has(rule.scope_id);
  if (k === 'game') return rule.scope_key ? ctx.gameKeys.has(rule.scope_key) : ctx.gameIds.has(rule.scope_id);
  if (k === 'custom_game') return ctx.customGameIds.has(rule.scope_id);
  if (k === 'side_comp') return rule.scope_key ? ctx.sideKeys.has(rule.scope_key) : ctx.sideIds.has(rule.scope_id);
  return false;
}

// ------------------------------------------------------------------ names

/** names: { comps, trophies, customGames, games, ownDefs } (arrays). */
export function nameIndex(data = {}) {
  const by = (list) => Object.fromEntries(arr(list).map((x) => [x.id, x]));
  return { comps: by(data.comps), trophies: by(data.trophies), customGames: by(data.customGames), games: by(data.games), ownDefs: by(data.ownDefs) };
}

/** "BD Trophy", "Skins", "Stableford"… — what a rule is for (null for a group-wide rule). */
export function scopeLabel(rule, names = {}) {
  const k = rule?.scope_kind;
  if (!k) return null;
  if (k === 'format') return FORMAT_LABEL[rule.scope_key] || rule.scope_key;
  if (k === 'comp') return names.comps?.[rule.scope_id]?.name || 'A comp';
  if (k === 'trophy') return names.trophies?.[rule.scope_id]?.name || 'A trophy';
  if (k === 'custom_game') return names.customGames?.[rule.scope_id]?.name || 'Our game';
  if (k === 'game') {
    if (rule.scope_key) return GAME_LABEL[rule.scope_key] || rule.scope_key;
    const g = names.games?.[rule.scope_id];
    return g ? `${GAME_LABEL[g.kind] || g.kind} (one round)` : 'A game';
  }
  if (k === 'side_comp') return rule.scope_key ? SIDE_LABEL[rule.scope_key] : (names.ownDefs?.[rule.scope_id]?.name || 'A side comp');
  return null;
}

/** The scope fields for a rules row from a picker value 'comp:<id>' / 'format:ambrose' / '' (group-wide). */
export function scopeFromValue(value) {
  const [kind, ref] = String(value || '').split(':');
  if (!kind || !SCOPE_KINDS.includes(kind) || !ref) return { scope_kind: null, scope_id: null, scope_key: null };
  const isId = /^[0-9a-f-]{36}$/i.test(ref);
  return { scope_kind: kind, scope_id: isId ? ref : null, scope_key: isId ? null : ref };
}
export const scopeValue = (r) => (r?.scope_kind ? `${r.scope_kind}:${r.scope_id || r.scope_key}` : '');

// ------------------------------------------------------------------ effective rules

/**
 * The rules that actually apply in a context, by layer, with overridden rules marked.
 * localRules: the group's rules (only active ones count). names: from nameIndex.
 * Returns { layers: [{ key, title, emoji, items }], items, overriddenCount }. Each item:
 *   { id, standard, title, text, value, rank, layer, scope, rule?, overriddenBy: null | { id, title, scope } }
 */
export function effectiveRules({ ctx, localRules = [], names = {} } = {}) {
  const items = [];
  for (const key of ctx.standardKeys) {
    const s = SECTION_BY_KEY[key];
    if (!s) continue;
    for (const r of s.rules) {
      const it = { id: r.id, standard: true, section: s.key, sectionTitle: s.title, title: r.title, text: r.text, value: null };
      items.push({ ...it, rank: rankOf(it), layer: layerOf(it), scope: s.key === 'golf' ? null : s.title, overriddenBy: null });
    }
  }
  for (const r of arr(localRules)) {
    if (r?.status !== 'active' || !appliesIn(r, ctx)) continue;
    items.push({ id: r.id, standard: false, title: r.title, text: r.detail || '', value: r.value || null, rank: rankOf(r), layer: layerOf(r), scope: scopeLabel(r, names), rule: r, overriddenBy: null });
  }
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  // Who changes what (only rules in play count).
  const changers = {};
  for (const i of items) {
    if (i.standard) continue;
    for (const t of [i.rule.overrides, i.rule.overrides_rule]) {
      if (t && t !== i.id && byId[t]) (changers[t] ||= []).push(i);
    }
  }
  const newer = (a, b) => String(b.rule?.created_at || '').localeCompare(String(a.rule?.created_at || ''));
  for (const [target, list] of Object.entries(changers)) {
    const sorted = [...list].sort((a, b) => b.rank - a.rank || newer(a, b));
    const win = sorted[0];
    const by = { id: win.id, title: win.title, scope: win.scope };
    byId[target].overriddenBy ||= by;
    for (const loser of sorted.slice(1)) loser.overriddenBy ||= by;
  }
  // A rule overridden by a rule that is itself overridden: point at the one that's actually in force.
  for (const i of items) {
    let by = i.overriddenBy;
    for (let n = 0; by && byId[by.id]?.overriddenBy && n < 5; n++) by = byId[by.id].overriddenBy;
    if (by && by.id !== i.id) i.overriddenBy = by;
  }
  const layers = LAYERS.map((l) => ({ ...l, items: items.filter((i) => i.layer === l.key).sort((a, b) => a.rank - b.rank) }))
    .filter((l) => l.items.length);
  return { layers, items, overriddenCount: items.filter((i) => i.overriddenBy).length };
}

// ------------------------------------------------------------------ topics and the conflict check

export const TOPICS = [
  { key: 'gimmes', label: 'gimmes', re: /\bgimm(e|ie)s?\b|\bconced|putt (it|them|everything) out|inside the (leather|grip)|holed out/i },
  { key: 'mulligans', label: 'mulligans', re: /mulligan|do-?over|breakfast ball|free (second |extra )?(tee )?shot|hit (it )?again/i },
  { key: 'drops', label: 'drops, out of bounds and lost balls', re: /out of bounds|\bo\.?b\.?\b|lost ball|\bdrop(s|ped|ping)?\b|penalty area|unplayable|free relief|\bwater\b/i },
  { key: 'max_score', label: 'pick-ups and the most you can score', re: /pick(-| )?ups?\b|max(imum)? score|double par|net double|wipe(d)? (out|the hole)|blob/i },
  { key: 'drives', label: 'drives and tee shots', re: /\bdrives?\b|tee shots?|off the tee/i },
  { key: 'handicap', label: 'handicaps', re: /handicap|allowance|shots? (received|off|a side)|strokes? off|stroke index/i },
  { key: 'preferred_lies', label: 'preferred lies', re: /preferred lies?|lift,? clean|place (it|the ball|your ball)|winter rules|\bbump (it)?\b|roll (it|the ball)/i },
  { key: 'carry', label: 'carry-overs', re: /carr(y|ies|ied)(-| )?(over|on)?\b/i },
];
const TOPIC = Object.fromEntries(TOPICS.map((t) => [t.key, t]));

// Standard rules: topics set by hand (their wording mentions lots of things in passing).
const STANDARD_TOPICS = {
  'golf.as_it_lies': ['mulligans', 'preferred_lies'], 'golf.ob': ['drops'], 'golf.ob_local': ['drops'], 'golf.lost': ['drops'],
  'golf.provisional': ['drops'], 'golf.penalty_area': ['drops'], 'golf.unplayable': ['drops'], 'golf.free_relief': ['drops'],
  'golf.drop': ['drops'], 'golf.embedded': ['drops'], 'golf.green': ['gimmes'], 'golf.max_score': ['max_score'], 'golf.handicap': ['handicap'],
  'golf.bunker': ['preferred_lies'],
  'stableford.pickup': ['max_score'], 'stroke.strokes': ['gimmes'], 'stroke.pickup': ['max_score'],
  'ambrose.drives': ['drives'], 'ambrose.handicap': ['handicap'], 'ambrose.putting': ['gimmes'],
  'fourball.pickup': ['max_score'], 'cup.concede': ['gimmes'], 'cup.shots': ['handicap'],
  'skins.carry': ['carry'], 'skins.how': ['max_score'], 'nassau.pickup': ['max_score'], 'ld.how': ['drives'], 'ld.confirm': [],
};

/** The topics a rule (or a draft) is about. */
export function topicsOf(rule) {
  if (!rule) return [];
  if (rule.standard && STANDARD_TOPICS[rule.id]) return STANDARD_TOPICS[rule.id];
  const text = `${rule.title || ''} ${rule.text || rule.detail || ''} ${rule.value || ''}`;
  return TOPICS.filter((t) => t.re.test(text)).map((t) => t.key);
}

/**
 * The rules a new or changed rule might clash with: rules in the layers at or below it (in the context it applies
 * in) that are about the same thing. draft: { id?, title, detail, value, scope_kind, scope_id, scope_key, applies_to }.
 * Returns [{ id, standard, title, scope, topic, reason }], most specific first, at most 6. Rules it already changes are
 * left out (they're handled).
 */
export function keywordConflicts({ draft, ctx, localRules = [], names = {} } = {}) {
  const mine = topicsOf(draft);
  if (!mine.length || !ctx) return [];
  const myRank = rankOf(draft);
  const { items } = effectiveRules({ ctx, localRules: arr(localRules).filter((r) => r.id !== draft.id), names });
  const out = [];
  for (const i of items) {
    if (i.rank > myRank || i.overriddenBy) continue;
    if (i.id === draft.overrides || i.id === draft.overrides_rule) continue;
    const t = topicsOf(i).find((x) => mine.includes(x));
    if (!t) continue;
    out.push({ id: i.id, standard: i.standard, title: i.title, scope: i.scope, topic: t, reason: `Both are about ${TOPIC[t].label}` });
  }
  return out.sort((a, b) => (b.standard ? 0 : 1) - (a.standard ? 0 : 1)).slice(0, 6);
}

/** The best single rule to mark as "this changes" from a list of clashes: a local one first, else the first. */
export function suggestOverride(conflicts = []) {
  const c = conflicts.find((x) => !x.standard) || conflicts[0];
  if (!c) return { overrides: null, overrides_rule: null };
  return c.standard ? { overrides: c.id, overrides_rule: null } : { overrides: null, overrides_rule: c.id };
}

/** The title of what a rule changes ("Out of bounds", or a local rule's title). */
export function overrideTitle(rule, localRules = []) {
  if (rule?.overrides_rule) return arr(localRules).find((r) => r.id === rule.overrides_rule)?.title || 'one of our rules';
  if (rule?.overrides) return standardRule(rule.overrides)?.title || null;
  return null;
}

// ------------------------------------------------------------------ the Rulebook's filter bar

/**
 * The chips: basics, formats played, and each comp / trophy / game / custom game / side comp the group has.
 * data: { comps, trophies, rounds, games, customGames, ownDefs, trips }. showRetired: include retired ones.
 * Returns [{ value, label, group, retired? }]. value: 'all' | 'golf' | 'formats' | 'local' | 'voted' | 'waiting' |
 * '<scope kind>:<id or key>'.
 */
export function filterChips(data = {}, { showRetired = false } = {}) {
  const out = [
    { value: 'all', label: 'All', group: 'basics' },
    { value: 'golf', label: 'Rules of golf', group: 'basics' },
    { value: 'formats', label: 'Formats', group: 'basics' },
    { value: 'local', label: 'Local rules', group: 'basics' },
    { value: 'voted', label: 'Changed by a vote', group: 'basics' },
    { value: 'waiting', label: 'Waiting for a vote', group: 'basics' },
  ];
  const formats = new Set(arr(data.rounds).map((r) => r.format).filter(Boolean));
  if (arr(data.comps).some((c) => c.kind === 'cup' && !c.retired)) formats.add('cup');
  for (const f of FORMAT_KEYS) if (formats.has(f)) out.push({ value: `format:${f}`, label: FORMAT_LABEL[f], group: 'formats' });
  const tripStart = Object.fromEntries(arr(data.trips).map((t) => [t.id, t.start_date || '']));
  const comps = arr(data.comps).filter((c) => !c.virtual && (showRetired || !c.retired))
    .sort((a, b) => String(tripStart[b.trip_id] || '').localeCompare(String(tripStart[a.trip_id] || '')) || (a.sort ?? 0) - (b.sort ?? 0));
  const seen = new Set();
  for (const c of comps) {
    const label = c.name;
    if (seen.has(label.toLowerCase())) continue; // the same comp every trip: one chip (the newest)
    seen.add(label.toLowerCase());
    out.push({ value: `comp:${c.id}`, label, group: 'comps', retired: !!c.retired });
  }
  const linked = new Set(arr(data.comps).map((c) => c.trophy_id).filter(Boolean));
  for (const t of arr(data.trophies)) {
    if (linked.has(t.id) || seen.has(String(t.name).toLowerCase())) continue;
    seen.add(String(t.name).toLowerCase());
    out.push({ value: `trophy:${t.id}`, label: t.name, group: 'comps' });
  }
  const kinds = new Set(arr(data.games).filter((g) => !g.retired).map((g) => g.kind));
  for (const k of Object.keys(GAME_LABEL)) if (kinds.has(k)) out.push({ value: `game:${k}`, label: GAME_LABEL[k], group: 'games' });
  for (const c of arr(data.customGames)) if (showRetired || !c.retired) out.push({ value: `custom_game:${c.id}`, label: c.name, group: 'games', retired: !!c.retired });
  const rounds = arr(data.rounds);
  if (rounds.some((r) => arr(r.ctp_holes).length)) out.push({ value: 'side_comp:ctp', label: SIDE_LABEL.ctp, group: 'side' });
  if (rounds.some((r) => arr(r.ld_holes).length)) out.push({ value: 'side_comp:ld', label: SIDE_LABEL.ld, group: 'side' });
  for (const d of arr(data.ownDefs)) if (showRetired || !d.retired) out.push({ value: `side_comp:${d.id}`, label: `${d.emoji ? `${d.emoji} ` : ''}${d.name}`, group: 'side', retired: !!d.retired });
  return out;
}

/** A chip value as a target for targetContext (null for the basics). */
export function chipTarget(value) {
  const [kind, ref] = String(value || '').split(':');
  if (!ref || !SCOPE_KINDS.includes(kind)) return null;
  const isId = /^[0-9a-f-]{36}$/i.test(ref);
  return { kind, id: isId ? ref : null, key: isId ? null : ref };
}

/** Does a rule or standard item match the search words? (every word, anywhere in the title or wording) */
export function matchesSearch(item, search) {
  const words = String(search || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${item?.title || ''} ${item?.text || item?.detail || ''} ${item?.value || ''} ${item?.scope || ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * The group's own rules for a basic filter. versions: rule_versions rows; cases: governance cases.
 *   'local'   — rules with no comp scope (group-wide and format-specific)
 *   'voted'   — rules adopted or changed by a Tribunal case (a version linked to a case that passed)
 *   'waiting' — rules up for a vote, and rules with a passed change waiting to start
 * Anything else: every rule. Active ones only, except 'waiting'.
 */
export function filterLocal(rules = [], filter = 'all', { versions = [], cases = [], search = '' } = {}) {
  const passed = new Set(arr(cases).filter((c) => c.status === 'passed').map((c) => c.id));
  const byVote = new Set(arr(versions).filter((v) => v.case_id && passed.has(v.case_id) && ['adopted', 'changed', 'added'].includes(v.event)).map((v) => v.rule_id));
  for (const c of arr(cases)) if (c.status === 'passed' && c.rule_id && ['new_rule', 'change_rule'].includes(c.kind) && c.apply_state === 'applied') byVote.add(c.rule_id);
  const waitingIds = new Set(arr(cases).filter((c) => c.status === 'passed' && ['waiting_next_trip', 'next_round'].includes(c.apply_state) && c.rule_id).map((c) => c.rule_id));
  return arr(rules).filter((r) => {
    if (!matchesSearch(r, search)) return false;
    if (filter === 'waiting') return r.status === 'proposed' || (r.status === 'active' && waitingIds.has(r.id));
    if (r.status !== 'active') return false;
    if (filter === 'local') return !r.scope_kind || r.scope_kind === 'format';
    if (filter === 'voted') return byVote.has(r.id);
    return true;
  });
}

// ------------------------------------------------------------------ the scope picker

/**
 * Options for "What's this rule for?": the group as a whole, each format, and each comp / trophy / game / side comp.
 * Returns [{ value, label, group }] (value '' = everything).
 */
export function scopeOptions(data = {}) {
  const chips = filterChips(data).filter((c) => c.group !== 'basics');
  const formats = FORMAT_KEYS.map((f) => ({ value: `format:${f}`, label: FORMAT_LABEL[f], group: 'Formats' }));
  const games = Object.keys(GAME_LABEL).map((k) => ({ value: `game:${k}`, label: `${GAME_LABEL[k]} (every game)`, group: 'Games' }));
  const sides = Object.keys(SIDE_LABEL).map((k) => ({ value: `side_comp:${k}`, label: SIDE_LABEL[k], group: 'Side comps' }));
  const groupName = { comps: 'Comps and trophies', games: 'Games', side: 'Side comps' };
  const own = chips.filter((c) => c.group !== 'formats' && !/^game:|^side_comp:(ctp|ld)$/.test(c.value)).map((c) => ({ value: c.value, label: c.label, group: groupName[c.group] }));
  return [{ value: '', label: 'Everything (a local rule)', group: 'Everything' }, ...formats, ...own.filter((o) => o.group === 'Comps and trophies'), ...games, ...own.filter((o) => o.group === 'Games'), ...sides, ...own.filter((o) => o.group === 'Side comps')];
}

// ------------------------------------------------------------------ remember the filter (this session only)

const KEY = 'tgt-rulebook-filter';
export function loadFilter(storage) {
  try {
    const s = storage ?? globalThis.sessionStorage;
    const v = JSON.parse(s?.getItem(KEY) || 'null');
    return v && typeof v === 'object' ? { filter: String(v.filter || 'all'), round: v.round || null } : { filter: 'all', round: null };
  } catch { return { filter: 'all', round: null }; }
}
export function saveFilter(v, storage) {
  try { (storage ?? globalThis.sessionStorage)?.setItem(KEY, JSON.stringify({ filter: v.filter || 'all', round: v.round || null })); } catch { /* private mode */ }
}
