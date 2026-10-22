// The walkthrough's fake group: players, the course library for three areas (South Coast, Hunter Valley, Port
// Stephens), places to stay, course research, a previous trip with winners, and the group's rules. Each scenario
// starts from makeWorld() and adds its own trip. Dates are relative to Sydney's today.
import crypto from 'node:crypto';
import { GROUP } from './fake.mjs';
import { plusDays } from './shoot.mjs';

export const pid = (i) => `${String(i + 1).padStart(8, '0')}-4444-4444-8444-444444444444`;
export const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const holes = [[4, 7], [5, 15], [3, 11], [4, 1], [4, 9], [3, 17], [5, 3], [4, 13], [4, 5], [4, 8], [3, 16], [5, 2], [4, 12], [4, 6], [3, 18], [5, 4], [4, 14], [4, 10]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const nowIso = () => new Date().toISOString();

export const LIBRARY = [
  // South Coast NSW
  { id: L(1), name: 'Shoalhaven Heads GC', area: 'Shoalhaven Heads NSW', lat: -34.85, lng: 150.73, holes: 18, facts: [] },
  { id: L(2), name: 'Nowra GC', area: 'Nowra NSW', lat: -34.87, lng: 150.61, holes: 18, facts: [], mine_avg: 4.5, mine_n: 6, played: true },
  { id: L(3), name: 'Gerringong GC', area: 'Gerringong NSW', lat: -34.75, lng: 150.82, holes: 18, facts: [] },
  { id: L(5), name: 'Kiama GC', area: 'Kiama NSW', lat: -34.67, lng: 150.85, holes: 18, facts: [] },
  { id: L(6), name: 'Mollymook Hilltop', area: 'Mollymook NSW', lat: -35.33, lng: 150.46, holes: 18, facts: [], others_avg: 4.3, others_n: 2 },
  // Hunter Valley
  { id: L(7), name: 'Cypress Lakes', area: 'Pokolbin NSW', lat: -32.79, lng: 151.30, holes: 18, facts: [] },
  { id: L(8), name: 'The Vintage', area: 'Rothbury NSW', lat: -32.74, lng: 151.33, holes: 18, facts: [] },
  { id: L(9), name: 'Cessnock GC', area: 'Cessnock NSW', lat: -32.84, lng: 151.35, holes: 18, facts: [] },
  // Port Stephens
  { id: L(10), name: 'Horizons Golf Resort', area: 'Salamander Bay NSW', lat: -32.73, lng: 152.08, holes: 18, facts: [] },
  { id: L(11), name: 'Nelson Bay GC', area: 'Nelson Bay NSW', lat: -32.72, lng: 152.13, holes: 18, facts: [] },
  { id: L(12), name: 'Pacific Dunes', area: 'Medowie NSW', lat: -32.75, lng: 151.90, holes: 18, facts: [] },
];

const STAY_AREAS = [
  ['Kiama', 'South Coast NSW', -34.67, 150.85], ['Shoalhaven Heads', 'South Coast NSW', -34.85, 150.74], ['Nowra', 'South Coast NSW', -34.88, 150.60],
  ['Jervis Bay (Huskisson)', 'South Coast NSW', -35.04, 150.67],
  ['Pokolbin', 'Hunter Valley', -32.78, 151.29], ['Cessnock', 'Hunter Valley', -32.83, 151.36],
  ['Nelson Bay', 'Port Stephens', -32.72, 152.14], ['Salamander Bay', 'Port Stephens', -32.73, 152.08],
];

const research = (id, name, town, wd, we, groups, style, extra = {}) => ({ library_id: id, name, town, state: 'NSW', fee_weekday: wd, fee_weekend: we, access_type: 'public',
  good_for_groups: groups, last_checked: '2026-10-01', details: { style, ...extra }, ...(extra.phone ? { phone: extra.phone } : {}) });

export const PEOPLE = {
  // name, handicap
  A: [['Josh', 14], ['Al', 9], ['Bo', 18], ['Cy', 12], ['Di', 22], ['Ed', 16], ['Fin', 7], ['Gus', 20], ['Mo', 25], ['Lou', 28]],
};

/**
 * A fresh database for one scenario. names: [[nickname, handicap], …]. guest: a guest's name (read-only).
 * extraFeatures: e.g. ['cup'].
 */
export function makeWorld({ names = PEOPLE.A, guest = 'Pete', extraFeatures = [], pastTrip = true } = {}) {
  const now = nowIso();
  const players = names.map(([n, h], i) => ({ id: pid(i), name: `${n} ${['Carter', 'Nguyen', 'Walsh', 'Ryan', 'Patel', 'Kelly', 'Moore', 'Brennan', 'Fraser', 'Hughes', 'Dahl', 'Morris'][i % 12]}`, nickname: n, handicap: h, approved: true, created_at: now }));
  const guestPlayer = guest ? { id: pid(40), name: `${guest} Lang`, nickname: guest, handicap: 18, approved: true, created_at: now } : null;
  if (guestPlayer) players.push(guestPlayer);
  const db = {
    players,
    trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [], honour_board: [],
    courses: [], rounds: [], comps: [], rules: [], posts: [], comments: [], reactions: [], tribunal_cases: [], tribunal_votes: [], notify_prefs: [], player_home_areas: [],
    plans: [], plan_polls: [], plan_options: [], plan_votes: [], vote_batches: [], plan_comments: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], plan_rsvps: [],
    plan_groups: [], plan_group_members: [], plan_budget_items: [],
    groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
    trip_builds: [], plan_stays: [], trip_finds: [], course_notes: [], course_ratings: [], trip_tee_options: [], course_booking_info: [], course_social_times: [],
    trip_start_points: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: null, label: 'Inner West', lat: -33.88, lng: 151.16, headcount: names.length, leave_after: '06:00', finish_by: '17:00', sort: 0 }],
    stay_areas: STAY_AREAS.map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i })),
    region_guides: [
      { title: 'NSW: Hunter, Newcastle, Port Stephens', kind: 'region', regions: ['Hunter Valley', 'Port Stephens'], body: 'Lots of courses close together. Busy on long weekends.', sort: 1, active: true },
      { title: 'NSW: Illawarra and South Coast', kind: 'region', regions: ['Shoalhaven / South Coast', 'Illawarra'], body: 'Beach towns with plenty of golf.', sort: 2, active: true },
    ],
    course_research: [
      research(L(2), 'Nowra Golf Club', 'North Nowra', 45, 50, 4, 'parkland', { phone: '02 4421 0000 (pro shop)', members_times: 'Wed and Sat mornings are member comps', visitor_times: 'Sat after 12pm; Sun after 11am' }),
      research(L(1), 'Shoalhaven Heads Golf Club', 'Shoalhaven Heads', 42, 48, 4, 'links-style'),
      research(L(5), 'Kiama Golf Club', 'Kiama', 55, 65, 3, 'coastal'),
      research(L(7), 'Cypress Lakes', 'Pokolbin', 89, 99, 5, 'resort'),
      research(L(8), 'The Vintage', 'Rothbury', 110, 130, 4, 'championship'),
      research(L(10), 'Horizons Golf Resort', 'Salamander Bay', 75, 85, 4, 'resort'),
      research(L(11), 'Nelson Bay Golf Club', 'Nelson Bay', 60, 70, 4, 'bushland'),
    ],
    handicap_history: [], cases: [],
    trip_runup_people: [], trip_activities: [], trip_activity_people: [], trip_tips: [],
    dinner_awards: [], dinner_award_nominations: [], dinner_award_votes: [], rule_opinions: [], award_strokes: [], score_adjustments: [], rule_votes: [], rule_versions: [],
    cup_sides: [], cup_matches: [], side_entries: [], tee_groups: [],
    group_features: ['feed', 'planner', 'planner_tasks', 'planner_costs', 'planner_rooms', 'trip_finder', 'ai_helper', 'notifications', 'trophies', 'dinner_awards',
      'awards', 'stats', 'side_comps', 'rule_voting', ...extraFeatures].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
  // The group's standing rules: gimmes, and what happens to the leftover kitty.
  db.rules.push(
    { id: crypto.randomUUID(), group_id: GROUP, title: 'Gimmes inside the leather', category: 'other', applies_to: ['all'], status: 'active', created_at: now },
    { id: crypto.randomUUID(), group_id: GROUP, title: 'Leftover kitty', category: 'other', applies_to: ['trip'], status: 'active', system_key: 'leftover_kitty', leftover: 'bar', detail: 'Whatever’s left in the kitty at the end of a trip: on the bar the last night.', sort: 910, created_at: now },
  );
  if (pastTrip) {
    // Last year's trip, finished, with its winners — so the Trips list and the Trophy Room aren't empty.
    const T = 'aaaaaaaa-0000-4000-8000-00000000a025';
    const P = 'eeeeeeee-0000-4000-8000-00000000a025';
    const C = 'cccccccc-0000-4000-8000-00000000a025';
    db.courses.push({ id: C, group_id: GROUP, name: 'Mollymook Hilltop', library_id: L(6), holes, created_at: now });
    db.trips.push({ id: T, group_id: GROUP, name: 'South Coast 2025', start_date: '2025-10-17', end_date: '2025-10-19', status: 'locked', created_at: '2025-08-01T00:00:00Z' });
    db.plans.push({ id: P, kind: 'trip', name: 'South Coast 2025', status: 'done', start_date: '2025-10-17', end_date: '2025-10-19', location_name: 'Mollymook', trip_id: T, group_id: GROUP, created_by: pid(0), organiser_id: pid(0), created_at: '2025-08-01T00:00:00Z' });
    db.rounds.push({ id: 'dddddddd-0000-4000-8000-00000000a025', group_id: GROUP, trip_id: T, course_id: C, name: 'Saturday', play_date: '2025-10-18', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: '2025-08-01T00:00:00Z' });
    db.trophies.push({ id: 'aaaaaaaa-0000-4000-8000-00000000f025', group_id: GROUP, trip_id: T, name: 'BD Trophy', type: 'stableford_total', created_at: now });
    db.honour_board.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: T, trophy_name: 'BD Trophy', label: '2025', winner_names: names[3]?.[0] || 'Cy', player_ids: [pid(3)], sort_key: 1, created_at: now },
      { id: crypto.randomUUID(), group_id: GROUP, trip_id: T, trophy_name: 'Putt Buddies (Ambrose)', label: '2025', winner_names: `${names[1]?.[0]} & ${names[5]?.[0]}`, player_ids: [pid(1), pid(5)], sort_key: 2, created_at: now });
  }
  return db;
}

/** Accounts for the five people we follow. idx: player index per role. */
export function addPeople(S, { organiser = 0, keen = 1, quiet = 8, guest = 40, late = 9, others = [] } = {}) {
  const acct = (i, role) => S.addAccount({ id: `aaaaaaaa-5555-4555-8555-${String(i + 1).padStart(12, '0')}`, email: `player${i}@example.com`, password: 'fairway123', player_id: pid(i), role });
  const P = {
    organiser: acct(organiser, 'organiser'),
    keen: acct(keen, 'player'),
    quiet: acct(quiet, 'player'),
    guest: acct(guest, 'guest'),
  };
  for (const i of others) acct(i, 'player');
  P.lateIdx = late;
  return P;
}

/** A course copied into the group (what "Pick this one" does), with holes. */
export function groupCourse(db, libId) {
  const l = LIBRARY.find((x) => x.id === libId);
  let c = db.courses.find((x) => x.library_id === libId);
  if (!c) { c = { id: crypto.randomUUID(), group_id: GROUP, name: l.name, library_id: libId, holes, created_at: nowIso() }; db.courses.push(c); }
  return c;
}

/** Stableford-ish scores for a player through `thru` holes (deterministic per player). */
export function scoresFor(roundId, playerId, thru, skill = 0) {
  const out = [];
  for (const h of holes.slice(0, thru)) {
    const seed = (parseInt(playerId.slice(0, 8), 10) * 7 + h.n * 13) % 10;
    const over = seed < 2 ? 0 : seed < 6 ? 1 : seed < 9 ? 2 : 3;
    out.push({ id: crypto.randomUUID(), group_id: GROUP, round_id: roundId, subject_id: playerId, subject_type: 'player', hole: h.n, strokes: Math.max(2, h.par + over - (skill && seed === 0 ? 1 : 0)), picked_up: false, entered_by: playerId, updated_at: nowIso() });
  }
  return out;
}

export { plusDays, GROUP };
