// The Caddie (22 Oct 2026): the AI helper as a button that's always there — bottom-right on a phone, a panel down
// the right on a laptop. Josh: "can help with moving to the right screen etc. Not hidden." And: it's never greyed
// out — when the AI can't answer (switched off, not set up, no signal, a guest…) it still takes you to the right page.
//
// The pure bits (components/Caddie.jsx and CaddieChat.jsx use them):
//   * where the caddie shows (not on full-screen views) and what screen you're on (route → context);
//   * three suggested questions per screen;
//   * whether the AI can answer here, and if not, why (in plain words);
//   * the places it can take you (DESTINATIONS — the same list as supabase/functions/ai-helper/routes.ts, checked
//     by caddie.test.js), how to build each link, and a keyword search over them that works with no AI and no signal.

const D = (key, label, o = {}) => ({ key, label, needs: [], takes: [], organiser: false, feature: null, words: [], ...o });

/** The places the caddie can take you. Keys, ids, organiser-only and features match the function's routes.ts. */
export const DESTINATIONS = [
  D('trip_now', 'Trip status', { path: () => '/', // ov21: home — the On now / Next trip's status page
    words: ['this trip', 'next trip', 'on now', 'home', 'trip status', 'today', 'whats happening', 'what is happening', 'trip feed'] }),
  D('leaderboard', 'Leaderboard', { takes: ['round'], path: (i) => (i.round ? `/?r=${i.round}` : '/leaderboard'),
    words: ['leaderboard', 'leading', 'leader', 'winning', 'standings', 'board', 'results', 'whos winning', 'who is winning'] }),
  D('score', 'Enter scores', { needs: ['round'], path: (i) => `/score/${i.round}`,
    words: ['enter score', 'enter my score', 'put in score', 'scorecard', 'score', 'scores', 'card', 'keypad'] }),
  D('comps_board', 'Trophies & cups', { path: () => '/comps-board',
    words: ['trophies', 'trophies & cups', 'playing for', 'prizes', 'prize', 'comps', 'comp', 'side comps', 'closest to pin', 'closest to the pin', 'ctp', 'nearest pin', 'longest drive'] }),
  D('cup', 'The Cup', { feature: 'cup', path: () => '/cup', words: ['cup', 'ryder', 'match play', 'matches', 'match'] }),
  D('rulebook', 'The Rulebook', { path: () => '/rules',
    words: ['rule', 'rules', 'rulebook', 'gimme', 'gimmes', 'mulligan', 'mulligans', 'breakfast ball', 'local rule', 'bonus', 'pick up'] }),
  D('propose_rule', 'Propose a rule', { path: () => '/rules?propose=1',
    words: ['propose', 'propose a rule', 'new rule', 'suggest a rule', 'change a rule', 'vote on a rule', 'add a rule'] }),
  D('games', 'Games & side bets', { takes: ['round'], feature: 'games', path: (i) => (i.round ? `/games?r=${i.round}` : '/games'),
    words: ['game', 'games', 'side bet', 'side bets', 'bet', 'bets', 'skins', 'nassau', 'pot', 'pots', 'wolf', 'who pays who'] }),
  D('admin_round', 'Round setup', { needs: ['round'], organiser: true, path: (i) => `/admin?round=${i.round}`,
    words: ['round setup', 'set up the round', 'edit round', 'change round', 'format', 'change format', 'tee', 'tee time', 'side comp holes', 'lock round', 'lock'] }),
  D('admin_teams', 'Teams & pairs', { needs: ['round'], organiser: true, path: (i) => `/admin?round=${i.round}`,
    words: ['team', 'teams', 'ambrose teams', 'pair', 'pairs', 'pairing', 'pairings', 'partner', 'partners', '4bbb', 'fourball', 'draw', 'team handicap'] }),
  D('admin_players', 'Players & handicaps', { organiser: true, path: () => '/admin?open=players',
    words: ['player', 'players', 'add player', 'add a player', 'handicap', 'handicaps', 'approve', 'remove player'] }),
  D('setup_trip', 'Set up your trip', { takes: ['trip'], organiser: true, path: (i) => (i.trip ? `/setup?trip=${i.trip}` : '/setup'),
    words: ['set up', 'setup', 'set up trip', 'set up the trip', 'add round', 'add a round', 'add course', 'add a course', 'courses'] }),
  D('trips', 'Trips', { feature: 'planner', path: () => '/plan', words: ['trips', 'trip', 'last trip', 'past trips', 'plan a trip', 'new trip', 'plans'] }),
  D('trip_overview', 'Trip overview', { needs: ['plan'], feature: 'planner', path: (i) => `/plan/${i.plan}?view=overview`,
    words: ['trip overview', 'overview', 'itinerary', 'schedule', 'whats on', 'what is on', 'when', 'where are we'] }),
  D('trip_organise', 'Plan the trip', { needs: ['plan'], feature: 'planner',
    path: (i) => `/plan/${i.plan}?view=organise${i.tab ? `&tab=${i.tab}` : ''}`,
    words: ['organise', 'organize', 'kitty', 'money', 'pay', 'paid', 'payment', 'cost', 'costs', 'owe', 'jobs', 'job', 'vote', 'votes', 'rooms', 'room', 'cars', 'car', 'beds', 'accommodation', 'chat', 'whos in', 'who is in', 'rsvp'] }),
  D('history_import', 'Bring in our history', { organiser: true, feature: 'ai_helper', path: () => '/import',
    words: ['import', 'bring in', 'old results', 'past results', 'spreadsheet', 'history'] }),
  D('notifications', 'Notifications', { feature: 'notifications', path: () => '/notifications',
    words: ['notification', 'notifications', 'alert', 'alerts', 'push', 'notify', 'buzz'] }),
  D('profile', 'My profile', { path: (i) => (i.me ? `/player/${i.me}` : '/more'), words: ['profile', 'my profile', 'photo', 'nickname', 'avatar', 'my details'] }),
  D('group', 'Players & group', { path: () => '/group',
    words: ['players list', 'everyones handicap', 'dispute a handicap', 'invite', 'invites', 'invite link', 'link', 'qr', 'join', 'group', 'organiser', 'organisers', 'roles', 'features', 'switch on', 'switch off'] }),
  D('stats', 'Stats & season ladder', { feature: 'stats', path: () => '/stats',
    words: ['stats', 'statistics', 'ladder', 'order of merit', 'head to head', 'records', 'record', 'average', 'averages'] }),
  D('trophies', 'The Trophy Room', { feature: 'trophies', path: () => '/trophies',
    words: ['trophy', 'trophies', 'trophy room', 'honour board', 'honours', 'winners', 'past winners'] }),
  D('replay', 'Round replay', { needs: ['round'], feature: 'replay', path: (i) => `/replay/${i.round}`, words: ['replay', 'rewind', 'watch the round', 'watch'] }),
  D('feed', 'The Feed', { feature: 'feed', path: () => '/feed', words: ['feed', 'post', 'posts', 'photos', 'banter'] }),
];
export const ORGANISE_TABS = ['vote', 'chat', 'people', 'details', 'jobs', 'kitty', 'groups'];
// Words that point to one Organise tab ("money" → the kitty).
const TAB_WORDS = {
  kitty: ['kitty', 'money', 'pay', 'paid', 'payment', 'cost', 'costs', 'owe'],
  jobs: ['jobs', 'job'], vote: ['vote', 'votes'], groups: ['rooms', 'room', 'cars', 'car', 'beds', 'accommodation'],
  chat: ['chat'], people: ['whos in', 'who is in', 'rsvp'],
};

// ------------------------------------------------------------------ Where the caddie shows, and the screen you're on

/** Full-screen views where the caddie stays out of the way (and score entry, where the keypad needs the room). */
export function caddieHidden(pathname = '') {
  return /^\/(tv|start|join|c|club|privacy|terms|me|replay|score)(\/|$)/.test(pathname)
    || /^\/round\/[^/]+\/(present|print)(\/|$)/.test(pathname) || /^\/present(\/|$)/.test(pathname)
    || /^\/desk\/(present|print)(\/|$)/.test(pathname)
    || pathname === '/ask';
}

/** The caddie is a side panel on a laptop (1024 px and up) and on the laptop tools (the players table, pasting a
 *  scorecard, paper cards — the Trip desk's tools until 22 Oct); a button and a sheet on a phone. */
export const usesPanel = (pathname = '', width = 0) => width >= 1024
  || /^\/(desk|cards)(\/|$)/.test(pathname) || /^\/(group\/players|courses\/paste)(\/|$)/.test(pathname) || /^\/round\/[^/]+\/cards(\/|$)/.test(pathname);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (s) => (UUID.test(String(s || '')) ? String(s).toLowerCase() : undefined);
const tidy = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * Route → the screen you're on, sent to the AI as data (the function cleans it again).
 * `defaults.round` is the leaderboard's round when the address doesn't say (data.defaultRound).
 */
export function caddieContext(pathname = '/', search = '', defaults = {}) {
  const q = new URLSearchParams(search || '');
  const seg = pathname.split('/').filter(Boolean);
  const [a, b] = seg;
  // ov15/ov21: "/" is the trip status (On now / Next trip); "/?r=<round>" (and /leaderboard) is a round's leaderboard.
  if (!a) return q.get('r') ? tidy({ screen: 'leaderboard', round_id: id(q.get('r')) }) : tidy({ screen: 'trip_now', round_id: id(defaults.round) });
  if (a === 'leaderboard') return tidy({ screen: 'leaderboard', round_id: id(defaults.round) });
  switch (a) {
    case 'score': return tidy({ screen: 'score', round_id: id(b) });
    case 'games': return tidy({ screen: 'games', round_id: id(q.get('r')) });
    case 'comps-board': return tidy({ screen: 'comps_board', round_id: id(q.get('round')) });
    case 'comps': return { screen: 'side_comps' };
    case 'cup': return { screen: 'cup' };
    case 'rules': return { screen: 'rulebook' };
    case 'admin': return tidy({ screen: 'admin', round_id: id(q.get('round')) });
    case 'setup': return tidy({ screen: 'setup', trip_id: id(q.get('trip')) });
    case 'trip': return tidy({ screen: 'trip', trip_id: id(b) });
    case 'trip-now': return tidy({ screen: 'trip_now', trip_id: id(b) }); // ov21: a trip's status page
    case 'plan': {
      if (!b) return { screen: 'trips' };
      const view = ['organise', 'overview'].includes(q.get('view')) ? q.get('view') : undefined;
      const tab = ORGANISE_TABS.includes(q.get('tab')) ? q.get('tab') : undefined;
      return tidy({ screen: seg[2] === 'find' ? 'trip_finder' : 'plan', plan_id: id(b), view, tab });
    }
    case 'history': case 'import': return { screen: 'history' };
    case 'stats': return { screen: 'stats' };
    case 'trophies': return { screen: 'trophies' };
    case 'feed': return { screen: 'feed' };
    case 'tribunal': case 'governance': return { screen: 'tribunal' };
    case 'group': case 'groups': return { screen: 'group' };
    case 'player': return { screen: 'profile' };
    case 'notifications': return { screen: 'notifications' };
    case 'courses': case 'guide': return { screen: 'courses' };
    case 'round': return tidy({ screen: 'leaderboard', round_id: id(b) }); // a round's paper cards, Present, Print
    case 'cards': case 'present': return tidy({ screen: 'leaderboard', round_id: id(defaults.round) });
    case 'desk': return tidy({ screen: 'desk', plan_id: seg[1] === 'trip' ? id(seg[2]) : undefined }); // old links (they forward)
    case 'more': return { screen: 'more' };
    default: return { screen: 'other' };
  }
}

/**
 * Three things to ask, by screen. `roundName` makes the leaderboard's about that round. playing: false when no round is
 * live or on today — then nothing about who's leading or entering scores (ov27, walkthrough small fix).
 */
export function caddieSuggestions(ctx = {}, { isAdmin = false, roundName = '', playing = true } = {}) {
  const list = suggestionsFor(ctx, { isAdmin, roundName });
  if (playing) return list;
  const idle = ['What’s on our next trip?', isAdmin ? 'Plan a trip' : 'Who won our last trip?', 'Where are the rules?', 'Who’s won the most trips?'];
  const kept = list.filter((q) => !/leading|enter my score|last few holes|on today/i.test(q));
  return [...kept, ...idle.filter((q) => !kept.includes(q))].slice(0, 3);
}
function suggestionsFor(ctx = {}, { isAdmin = false, roundName = '' } = {}) {
  const r = roundName ? ` in ${roundName}` : '';
  switch (ctx.screen) {
    case 'trip_now': return ['Who’s leading today?', 'What’s on this trip?', isAdmin ? 'Set up the next round' : 'Where do I enter my score?'];
    case 'leaderboard': return [`Who’s leading${r}?`, 'What do I need to win?', isAdmin ? 'Change the teams' : 'Where do I enter my score?'];
    case 'score': return ['What do I need on the last few holes?', 'Is a gimme allowed?', 'Who’s leading?'];
    case 'games': return ['Who’s winning the skins?', 'Who pays who?', 'What games are on today?'];
    case 'comps_board': case 'side_comps': return ['Who’s winning the trophies?', 'Who has closest to the pin?', 'How does the Cup work?'];
    case 'cup': return ['Who’s winning the Cup?', 'What matches are left?', 'Where’s the leaderboard?'];
    case 'rulebook': return ['What are the gimme rules?', 'How do I propose a rule?', 'What bonuses are there?'];
    case 'admin': case 'setup': return ['Change the teams', 'Add a player', 'Set up the next round'];
    case 'trips': case 'plan': case 'trip': case 'trip_finder': case 'desk': return ['What’s on this trip?', 'Where do I pay the kitty?', 'Who won our last trip?'];
    case 'history': case 'stats': case 'trophies': return ['Who’s won the most trips?', 'Best Stableford round ever?', 'How has my handicap changed?'];
    case 'group': return ['How do I invite someone?', 'Switch on notifications', 'Who are the organisers?'];
    case 'notifications': return ['Switch on notifications', 'What’s on today?', 'Who’s leading?'];
    default: return ['What’s on today?', 'Who’s leading?', 'Where are the rules?'];
  }
}

// ------------------------------------------------------------------ Can the AI answer here?

/**
 * Whether the caddie's AI can answer, and if not, why — the caddie still opens and still takes you places.
 * Checked in this order (the first that applies is the reason given).
 */
export function caddieMode({ viewing = false, guest = false, quick = false, featureOn = true, notSetUp = false, capped = false, offline = false } = {}) {
  if (viewing) return { ai: false, reason: 'viewing', text: 'you’re viewing as someone else' };
  if (quick) return { ai: false, reason: 'quick', text: 'quick rounds don’t have the Caddie’s answers' };
  if (guest) return { ai: false, reason: 'guest', text: 'the Caddie’s answers are for the group’s players' };
  if (!featureOn) return { ai: false, reason: 'off', text: 'the Caddie is switched off for your group' };
  if (notSetUp) return { ai: false, reason: 'not_set_up', text: 'the Caddie isn’t switched on for your group' };
  if (capped) return { ai: false, reason: 'capped', text: 'your group’s used up its Caddie questions for now' };
  if (offline) return { ai: false, reason: 'offline', text: 'there’s no signal' };
  return { ai: true, reason: null, text: '' };
}

/** "I can't answer questions yet — the AI isn't switched on for your group — but I can take you to the right page:" */
export function fallbackIntro(mode) {
  if (!mode || mode.ai) return '';
  const when = mode.reason === 'off' || mode.reason === 'not_set_up' ? 'yet' : mode.reason === 'offline' || mode.reason === 'capped' ? 'right now' : 'here';
  return `I can’t answer questions ${when} — ${mode.text} — but I can take you to the right page:`;
}

/** What a function reply means for the rest of this session (remembered so we don't keep asking). */
export function sessionFlag(reply) {
  if (!reply || reply.kind !== 'error') return null;
  if (/isn.t switched on yet/i.test(reply.text || '')) return 'not_set_up';
  if (reply.capped) return 'capped';
  return null;
}

// ------------------------------------------------------------------ The places, and the search over them

/** Can this person use the place? (Organiser-only for organisers; switched-off features never.) */
export function canUse(dest, { isAdmin = false, featureOn = () => true } = {}) {
  if (!dest) return false;
  if (dest.organiser && !isAdmin) return false;
  return !dest.feature || !!featureOn(dest.feature);
}

/** The link for a place, or null if it needs an id it hasn't got. ids: { round, trip, plan, tab, me }. */
export function destinationPath(key, ids = {}) {
  const d = DESTINATIONS.find((x) => x.key === key);
  if (!d) return null;
  if (d.needs.some((k) => !id(ids[k]))) return null;
  const clean = { ...Object.fromEntries(['round', 'trip', 'plan', 'me'].map((k) => [k, id(ids[k])])), tab: ORGANISE_TABS.includes(ids.tab) ? ids.tab : undefined };
  return d.path(clean);
}

/** The function's go_to → a button: { key, label, path }, or null if it's not one this person can use. */
export function goButton(go, { isAdmin = false, featureOn = () => true, me = null } = {}) {
  const d = DESTINATIONS.find((x) => x.key === go?.key);
  if (!d || !canUse(d, { isAdmin, featureOn })) return null;
  const path = destinationPath(d.key, { round: go.round, trip: go.trip, plan: go.plan, tab: go.tab, me });
  return path ? { key: d.key, label: d.label, path } : null;
}

const norm = (w) => w.replace(/’/g, "'").replace(/'s$/, 's').replace(/'/g, '').replace(/^(.{3,})s$/, '$1');
const words = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(norm);
const has = (hay, phrase) => {
  const p = words(phrase);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= hay.length; i++) if (p.every((w, j) => hay[i + j] === w)) return true;
  return false;
};

/** The ids the caddie uses for a place when the question doesn't say: the screen's, else the current/next one. */
export function caddieIds(ctx = {}, { rounds = [], liveRound = null, defaultRound = null, currentTrip = null, plan = null, me = null, today = '' } = {}) {
  const next = rounds.filter((r) => r.status !== 'locked' && r.play_date && (!today || r.play_date >= today))
    .sort((a, b) => String(a.play_date).localeCompare(String(b.play_date)))[0];
  return tidy({
    round: ctx.round_id || liveRound?.id || next?.id || defaultRound?.id,
    trip: ctx.trip_id || currentTrip?.id,
    plan: ctx.plan_id || plan?.id,
    me,
  });
}

/**
 * Keyword search over the places (no AI, works with no signal): "teams" → Teams & pairs for the current round,
 * "gimme" → the Rulebook, "money" → the trip's kitty. Only places this person can use, with the ids they need.
 * Returns up to `limit` buttons, best first: [{ key, label, path }].
 */
export function searchDestinations(text, { isAdmin = false, featureOn = () => true, ids = {}, limit = 4 } = {}) {
  const hay = words(text);
  if (!hay.length) return [];
  const scored = [];
  DESTINATIONS.forEach((d, order) => {
    if (!canUse(d, { isAdmin, featureOn })) return;
    let score = 0;
    for (const w of d.words) if (has(hay, w)) score += words(w).length * 2;
    if (!score) return;
    let tab;
    if (d.key === 'trip_organise') tab = Object.keys(TAB_WORDS).find((t) => TAB_WORDS[t].some((w) => has(hay, w)));
    const path = destinationPath(d.key, { ...ids, tab });
    if (!path) return;
    scored.push({ key: d.key, label: tab ? `${d.label} › ${tab === 'kitty' ? 'Kitty' : tab[0].toUpperCase() + tab.slice(1)}` : d.label, path, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(({ key, label, path }) => ({ key, label, path }));
}

// ------------------------------------------------------------------ Caddie says hello (ov22, Josh 23 Oct)
// "When you open for the first time, a small overlay shows a message from Caddie: Hi, I'm Caddie. Ask me anything,
// here to help." Once per device: after they've joined and picked a name, never on the join / sign-in screens, never
// over another pop-up (the notifications sheet waits its turn first). Gone for good after either button.
export const HELLO_KEY = 'tgt-caddie-hello';
export const HELLO_TEXT = 'Hi, I’m Caddie. Ask me anything about the group, the rules or the next trip — or say “plan a trip”. I’m here to help.';
const local = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** Has this device had the hello? No storage at all (blocked) → treat as seen, so it never nags every visit. */
export function helloSeen(store = local()) {
  try { return store ? !!store.getItem(HELLO_KEY) : true; } catch { return true; }
}
export function markHelloSeen(store = local(), now = Date.now()) {
  try { store?.setItem(HELLO_KEY, String(now)); } catch { /* fine: it may say hello once more */ }
}
/** Say hello now? Only on a normal screen, with the Caddie button showing and nothing else popped up. */
export function shouldSayHello({ seen = false, hidden = false, viewing = false, caddieOpen = false, otherPopUp = false } = {}) {
  return !seen && !hidden && !viewing && !caddieOpen && !otherPopUp;
}
/** "plan a trip" typed into Ask → the ✨ Plan a trip mode. */
export const isPlanATrip = (text) => /^\s*(let'?s\s+|can you\s+|help me\s+)?plan (a|our|the next) trip\s*[.!?]?\s*$/i.test(String(text || ''));
