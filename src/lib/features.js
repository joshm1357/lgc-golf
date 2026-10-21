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
  { key: 'booking_links', name: 'Booking links', description: 'Buttons on a trip to find accommodation, a course and directions, with your place and dates filled in.', newGroup: false },
  { key: 'clubhouse_tv', name: 'Clubhouse TV leaderboard', description: 'Show your round on the clubhouse TV — first names only, and only for rounds you choose.', newGroup: false },
  { key: 'cup', name: 'Team match play (Ryder Cup)', description: 'Two teams, match play matches (singles or Ambrose pairs) scored hole by hole, and a live team points board.', newGroup: false },
  { key: 'awards', name: 'Award moments', description: 'When a round, side comp or trophy is decided: a winner card, the winner’s photo, a pinned post and a buzz.', newGroup: false },
  { key: 'games', name: 'Games and side bets', description: 'Skins, Nassau and other games worked out from the scores, with a running tally.', newGroup: false },
  { key: 'tee_groups', name: 'Tee groups', description: 'Fair groups of four for each round — new partners each day, handicaps mixed.', newGroup: false },
  { key: 'replay', name: 'Round replay', description: 'Watch a finished round as a 60-second animated replay.', newGroup: true },
  { key: 'in_jokes', name: 'In-jokes', description: 'Your group’s nicknames and running jokes, used in awards and replays.', newGroup: false },
  { key: 'ai_helper', name: 'AI helper', description: 'Ask the app in plain words: set up a trip for you, or answer questions about your group’s history.', newGroup: true },
  { key: 'rule_challenges', name: 'Rule challenges', description: 'Anyone can challenge a rule: change it, scrap it or ask for a ruling.', parent: 'tribunal', newGroup: true },
  { key: 'other_cases', name: '“Anything else” cases', description: 'Raise anything with the Tribunal — that shirt on day 2.', parent: 'tribunal', newGroup: true },
  { key: 'committees', name: 'Committees and terms', description: 'Named committees (e.g. Handicap Committee) with seats and terms.', parent: 'tribunal', newGroup: false },
  { key: 'stats', name: 'Player stats and season ladder', description: 'Each player’s scoring, best and worst holes, head-to-heads, and an order of merit across trips.', newGroup: true },
  { key: 'trip_finder', name: 'Trip finder', description: 'Which courses suit the group: tee-time windows, drive times and course facts, ranked on a map.', parent: 'planner', newGroup: false },
  { key: 'weather', name: 'Weather on the trip', description: 'The forecast for the trip’s place in the week before.', parent: 'planner', newGroup: true },
  { key: 'dinner_awards', name: 'Fines and dinner awards', description: 'Nominate and vote for the trip’s awards and fines at dinner.', newGroup: false },
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

/**
 * Presets for a new group (Stage 7 wizard). Each gives every feature an on/off, so the group's choices are written
 * down from day one. "Custom" starts from "Full trip" and lets the organiser flip each switch.
 */
const ALL_OFF = Object.fromEntries(FEATURES.map((f) => [f.key, false]));
export const PRESETS = [
  {
    key: 'just_scoring',
    name: 'Just scoring',
    blurb: 'Scores, the leaderboard and GPS distances. Nothing else to learn.',
    switches: { ...ALL_OFF, gps: true, notifications: true },
  },
  {
    key: 'full_trip',
    name: 'Full trip',
    blurb: 'Plus the feed, side comps, trophies, the Tribunal, the draw, the Trips planner and rule votes.',
    switches: { ...ALL_OFF, ...Object.fromEntries(FEATURES.filter((f) => f.newGroup).map((f) => [f.key, true])), planner_rooms: true },
  },
  {
    key: 'everything',
    name: 'Everything',
    blurb: 'Every feature that’s ready, including bonus strokes, the where’s-everyone map and the Claude connector.',
    switches: Object.fromEntries(FEATURES.map((f) => [f.key, !f.soon])),
  },
];
export const PRESET_BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
