// Custom games (migration 073, feature 'games'). Every standard option of a game (skins with or without carry-overs,
// validated skins, Nassau bet values and auto-presses…) is part of the standard game — see STANDARD_OPTIONS in
// games.js. A custom game is the group's own saved version of a game: "Copy and change" on a standard game saves it
// under the group's own name with its chosen standard options, a stake and, if they like, house rules (free text,
// optional since 098 — Josh, 23 Oct: "it should not be a compulsory field"). It's picked for a round like a standard game: the round_games row gets the base kind, the options and a
// link back (custom_game_id). The maths is the base game's (games.js); the house rules are shown, not worked out.
// Pure functions, no screen code.
import { GAME_KINDS, GAME_INFO, PRESETS, STANDARD_OPTIONS, fullOptions, splitOptions, gameOptions } from './games.js';

export const NAME_MAX = 40;
export const RULES_MAX = 1000;

const presetStake = (kind) => PRESETS.find((p) => p.kind === kind)?.stake ?? 0;

/** A custom game's settings: every standard option of the base game plus a default stake ($0–1000). */
export function cleanCustomSettings(base, settings = {}) {
  const n = Number(settings?.stake);
  const stake = Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : presetStake(base);
  return { ...fullOptions(base, settings), stake };
}

/** "Copy and change": a draft custom game from a standard game (or one already on a round). */
export function copyFrom(kind, game = null) {
  return {
    name: `${GAME_INFO[kind]?.name || 'Game'} — our way`,
    base_type: kind,
    settings: cleanCustomSettings(kind, { ...gameOptions(game || { kind }), stake: game?.stake ?? presetStake(kind) }),
    rules_text: '',
  };
}

/** Problems with a custom game (mirrors the database check in 073). [] = fine to save. */
export function customProblems(c = {}) {
  const out = [];
  const name = String(c.name || '').trim();
  if (name.length < 2 || name.length > NAME_MAX) out.push(`Give it a name (2 to ${NAME_MAX} letters)`);
  if (!GAME_KINDS.includes(c.base_type)) out.push('Pick the game it’s based on');
  // House rules are optional (098, Josh 23 Oct): with none, it's the group's saved version of a standard game — its
  // own name, stake and options.
  const rules = String(c.rules_text || '').trim();
  if (rules.length > RULES_MAX) out.push(`House rules: up to ${RULES_MAX} letters`);
  const s = c.settings;
  if (!s || typeof s !== 'object' || Array.isArray(s)) out.push('Settings must be a set of options');
  else if (GAME_KINDS.includes(c.base_type)) {
    const specs = Object.fromEntries((STANDARD_OPTIONS[c.base_type] || []).map((x) => [x.key, x]));
    const money = (v) => typeof v === 'number' && v >= 0 && v <= 1000;
    for (const [k, v] of Object.entries(s)) {
      const spec = specs[k];
      if (k === 'stake') { if (!money(v)) out.push('The stake is dollars, up to $1000'); continue; }
      if (!spec) { out.push(`${k} isn’t an option for ${GAME_INFO[c.base_type].name}`); continue; }
      const ok = spec.type === 'bool' ? typeof v === 'boolean' : spec.type === 'enum' ? spec.values.includes(v) : v == null || money(v);
      if (!ok) out.push(`${k} isn’t one of the choices`);
    }
  }
  return out;
}

/** The custom_games row to save. */
export function customRow(c) {
  return { name: String(c.name).trim(), base_type: c.base_type, settings: cleanCustomSettings(c.base_type, c.settings), rules_text: houseRules(c) };
}

/** The round_games row for picking a custom game for a round. */
export function roundGameFromCustom(custom, roundId) {
  const { options, settings } = splitOptions(custom.base_type, custom.settings);
  return { round_id: roundId, kind: custom.base_type, stake: cleanCustomSettings(custom.base_type, custom.settings).stake, options, settings, custom_game_id: custom.id };
}

/** A custom game's house rules, trimmed — '' when there are none (show nothing then, never an empty line). */
export function houseRules(c) {
  return String(c?.rules_text ?? '').trim();
}

/** A round's game with its custom game's name and house rules attached (if it's one). house_rules is '' when none. */
export function withCustom(game, customById = {}) {
  const c = game?.custom_game_id ? customById[game.custom_game_id] : null;
  return c ? { ...game, name: c.name, house_rules: houseRules(c), base_name: GAME_INFO[game.kind]?.name } : game;
}

/** "Skins: no carry-overs, validated · $5 a skin" — a custom game's settings in words. */
export function customSummary(c) {
  const o = cleanCustomSettings(c.base_type, c.settings);
  const words = [];
  for (const spec of STANDARD_OPTIONS[c.base_type] || []) {
    const v = o[spec.key];
    if (spec.type === 'bool') words.push(v ? spec.on : spec.off);
    else if (spec.type === 'enum') words.push(spec.labels?.[v] ?? String(v));
    else if (spec.type === 'money' && v != null) words.push(`${spec.label.replace(' ($)', '')} $${v}`);
  }
  return `Based on ${GAME_INFO[c.base_type]?.name || c.base_type}: ${words.join(', ')} · stake $${o.stake}`;
}
