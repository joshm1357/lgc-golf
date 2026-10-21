// The group this phone is working in (one person can be in several golf groups).
//
// Every database request carries it (the x-group-id header), and every read of a group's table is
// filtered to it — see supabase.js — so a screen can never show another group's rows, even for
// someone who is in two groups. The database checks the header against who you are, so it can't
// be used to reach a group you're not in.
//
// Words: a "group" is a golf group (L.G.C is one). The planner's plan_groups / plan_group_members
// are rooms and cars — not groups — and are never filtered here.

const KEY = 'lgc-group';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tables that belong to a group (they have a group_id column). Same list as migrations 022 and 025. */
export const GROUP_TABLES = new Set([
  'players', 'trips', 'courses', 'honour_board', 'rules', 'tribunal_cases', 'tribunal_votes',
  'location_pings', 'handicap_history', 'trophies', 'rounds', 'teams', 'team_players', 'round_players',
  'scores', 'quick_results', 'side_entries', 'round_pins', 'draws', 'posts', 'comments', 'reactions',
  'plans', 'plan_polls', 'plan_options', 'plan_votes', 'plan_rsvps', 'plan_items', 'plan_costs',
  'plan_payments', 'plan_groups', 'plan_transfers', 'rule_votes',
  // Stage 1b (migration 025)
  'plan_comments', 'notify_prefs',
  // Stage 3 (migration 029)
  'group_features',
  // Team match play (migration 050)
  'cup_sides', 'cup_matches',
  // A group's own side comps (migration 051)
  'side_comp_defs', 'side_comp_entries',
  // Overnight build (054 award moments, 056 tee groups, 058 in-jokes)
  'award_moments', 'tee_groups', 'in_jokes',
  // The AI helper's usage log (migration 059; only the edge function reads it)
  'helper_log',
]);

let current = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v && UUID.test(v) ? v : null;
  } catch { return null; }
})();

export const currentGroup = () => current;

/** Remember the group this phone is working in. Returns true if it changed. */
export function setCurrentGroup(id) {
  const next = id && UUID.test(id) ? id : null;
  if (next === current) return false;
  current = next;
  try {
    if (next) localStorage.setItem(KEY, next); else localStorage.removeItem(KEY);
  } catch { /* the app still works; it just asks the database again next time */ }
  return true;
}

/** Photos are filed under the group: <group id>/<folder>/… (a folder already filed is left alone). */
export function groupFolder(folder, group = current) {
  if (!group || UUID.test(String(folder).split('/')[0])) return folder;
  return `${group}/${folder}`;
}

/** Add the group header, and a group filter to reads of a group's table. Pure, so it can be tested. */
export function scopeRequest(url, method, group) {
  if (!group) return { url, header: null };
  const u = new URL(url);
  const m = u.pathname.match(/\/rest\/v1\/([a-z_]+)$/);
  if (!u.pathname.includes('/rest/v1/')) return { url, header: null };
  if (m && GROUP_TABLES.has(m[1]) && (method === 'GET' || method === 'HEAD') && !u.searchParams.has('group_id')) {
    u.searchParams.append('group_id', `eq.${group}`);
  }
  return { url: u.toString(), header: group };
}
