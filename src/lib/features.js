// Feature switches — one list for the whole app. Each group can switch these on or off (More → Group & invites →
// Features). Core things (scoring, leaderboard, players, rounds, courses) are always on and aren't listed.
//
// The database has the same list (migration 029, table feature_catalogue) and refuses writes to a switched-off
// feature, even from an old app version or the Claude connector; reads stay allowed so nothing is lost.
// A unit test checks this file and the migration agree.
//
// key        — stable id (never rename)
// parent     — needs this feature on (switching the parent off switches this off too)
// newGroup   — default for a new group
// tier       — 'free' for everything now; a later premium plan can check it
// soon       — not built yet: shown as "coming soon", can't be switched on

export const FEATURES = [
  { key: 'feed', name: 'Feed, photos and auto-posts', description: 'The Feed tab: posts, photos, comments and the automatic birdie/result posts.', newGroup: true },
  { key: 'side_comps', name: 'Side comps', description: 'Closest to the pin and longest drive on chosen holes.', newGroup: true },
  { key: 'comp_bonus', name: 'Side comp bonus strokes', description: 'Winning a side comp takes strokes off your team’s Ambrose score.', parent: 'side_comps', newGroup: false },
  { key: 'trophies', name: 'Trophies and honour board', description: 'The Trophy Room and honour boards.', newGroup: true },
  { key: 'tribunal', name: 'Handicap Tribunal', description: 'Lodge a case against a sandbagger; the group votes.', newGroup: true },
  { key: 'draw', name: 'The Draw', description: 'Random Ambrose teams drawn live, with the draw room.', newGroup: true },
  { key: 'gps', name: 'GPS distances and shot planner', description: 'Distances to the green and today’s pin, and the shot planner.', newGroup: true },
  { key: 'location', name: 'Where’s everyone map', description: 'Share where your group is on the course while the app is open.', newGroup: false },
  { key: 'planner', name: 'Trips planner', description: 'The Trips tab: ideas, votes on when and where, chat, who’s in, details.', newGroup: true },
  { key: 'planner_tasks', name: 'Votes, jobs and bring list', description: 'Votes, jobs and the bring list on each trip.', parent: 'planner', newGroup: true },
  { key: 'planner_costs', name: 'Shared costs', description: 'The kitty: shared costs and who pays who.', parent: 'planner', newGroup: true },
  { key: 'planner_rooms', name: 'Rooms and cars', description: 'Who’s in which room and car.', parent: 'planner', newGroup: false },
  { key: 'rule_voting', name: 'Rulebook voting', description: 'Anyone proposes rule changes and the group votes.', newGroup: true },
  { key: 'notifications', name: 'Phone notifications and reminders', description: 'Buzzes for votes, jobs, reminders and the draw room.', newGroup: true },
  { key: 'connector', name: 'Claude connector', description: 'Run the group from a Claude chat (organisers).', newGroup: false },
  { key: 'scorecard_photo', name: 'Scorecard photo reading', description: 'Read a photo of a scorecard into scores (needs an API key).', newGroup: false, soon: true },
  { key: 'booking_links', name: 'Booking links', description: 'Links to find accommodation and book courses for a trip.', newGroup: false, soon: true },
].map((f) => ({ parent: null, tier: 'free', ...f }));

export const FEATURE_BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

/**
 * Is a feature on for a group? `settings` is { key: true/false } from group_features (missing = the default).
 * A feature is off if its parent is off.
 */
export function featureOn(key, settings = {}) {
  const f = FEATURE_BY_KEY[key];
  if (!f) return true; // core / unknown keys are always on
  const own = key in settings ? !!settings[key] : f.newGroup;
  return own && (!f.parent || featureOn(f.parent, settings));
}

/** The features that depend on this one (switched off with it). */
export function children(key) {
  return FEATURES.filter((f) => f.parent === key).map((f) => f.key);
}
