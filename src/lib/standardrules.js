// The Rulebook's standard rules (migration 073): a short "rules of golf, simplified" plus the standard rules for each
// format, game and side comp the app runs — written in our own plain words (not the R&A / USGA text) and versioned
// with the app, not stored in the database. The group's own rules (the `rules` table) sit underneath as "Our rules":
// a local rule can say which standard rule it changes (rules.overrides = a standard rule id below), and then the
// standard rule shows "We play this differently". Pure functions, no screen code.
//
// Also here: ideas for local rules the group can tap to propose (they go through the usual vote / case).

export const STANDARD_VERSION = '2026-10-22';

// ------------------------------------------------------------------ the sections
// group: 'golf' (always shown) | 'format' | 'game' | 'comp'. key matches what's in use (see inUse below).
const S = (key, group, emoji, title, rules) => ({ key, group, emoji, title, rules: rules.map(([id, t, text]) => ({ id: `${key}.${id}`, title: t, text })) });

export const STANDARD_SECTIONS = [
  S('golf', 'golf', '⛳', 'Rules of golf, simplified', [
    ['as_it_lies', 'Play it as it lies', 'Hit the ball from where it ended up. Don’t move it, press down behind it or break branches to improve your shot — unless a rule (or your group’s local rule) says you can.'],
    ['ball', 'Play your own ball', 'Know which ball is yours (put a mark on it). Hitting someone else’s ball costs two shots in stroke play and the hole in match play — then go back and play yours.'],
    ['order', 'Ready golf', 'Whoever’s ready plays first, as long as it’s safe. On the tee, the lowest score on the last hole usually goes first, but ready golf is fine.'],
    ['ob', 'Out of bounds', 'Past the white stakes or the boundary fence is out of bounds. The standard rule: one penalty shot and play again from where you hit it (stroke and distance). Hit a provisional if you think it’s gone.'],
    ['ob_local', 'Out of bounds — the faster option', 'Many clubs allow this local rule instead: drop near where the ball went out (or on the edge of the fairway, level with it, no closer to the hole) for two penalty shots. Only use it if your group says so.'],
    ['lost', 'Lost ball', 'You get three minutes to look. Not found? Same as out of bounds: one penalty shot and replay from where you hit it — or the faster two-shot drop if your group plays it.'],
    ['provisional', 'Provisional ball', 'If your ball might be lost or out of bounds, say “provisional” and hit another from the same spot. If the first one turns up in bounds, play it and pick up the provisional.'],
    ['penalty_area', 'Penalty areas (water)', 'Yellow stakes: play it as it lies, or for one penalty shot drop behind the area keeping the point it crossed between you and the hole. Red stakes: you can also drop within two club-lengths of where it crossed, no closer to the hole.'],
    ['unplayable', 'Unplayable ball', 'You can call your ball unplayable anywhere except in a penalty area. One penalty shot, then: replay from where you hit it, drop within two club-lengths, or drop back on a line from the hole through the ball.'],
    ['bunker', 'In a bunker', 'Don’t touch the sand with your club before your shot (no practice swings, no resting the club). Loose stuff like leaves can be moved. Rake it when you leave.'],
    ['free_relief', 'Free relief', 'No penalty for cart paths, sprinkler heads, ground under repair, burrows or standing water: find the nearest spot that’s clear, then drop within one club-length, no closer to the hole.'],
    ['drop', 'How to drop', 'Drop from knee height, straight down, in the relief area. If it rolls out of the area, drop again; if it rolls out twice, place it where it landed the second time.'],
    ['green', 'On the green', 'You can mark, lift and clean your ball, fix pitch marks and spike marks, and leave the flag in or take it out. Don’t test the surface by rolling a ball.'],
    ['moved', 'Ball moved by accident', 'Moved your ball by accident while searching or on the green? No penalty — put it back. Anywhere else, if you caused it to move, it’s one shot and put it back.'],
    ['wrong_place', 'Embedded ball', 'A ball plugged in its own pitch mark anywhere on the course (not in sand) can be lifted, cleaned and dropped right behind the spot, no penalty.'],
    ['max_score', 'Pick up when you’re out of it', 'Keep the group moving: once you can’t score on a hole, pick up. The app counts a pick-up the way each format says (below).'],
    ['handicap', 'Handicaps and shots received', 'Your playing handicap says how many shots you get. You get a shot on each hole whose stroke index is your handicap or lower (index 1 is the hardest hole); over 18 you get two shots on the hardest holes.'],
    ['scores', 'Enter your scores', 'Put your strokes in after each hole (or a marker does it for the group). Check your card before the round is locked — once it’s locked, a missing hole counts as a pick-up.'],
    ['etiquette', 'Look after the course and each other', 'Repair divots and pitch marks, rake bunkers, call “fore” loudly, and keep up with the group in front.'],
  ]),

  S('stableford', 'format', '🏌️', 'Stableford', [
    ['points', 'Points for each hole', 'Net score on a hole (your strokes less the shots you get): net double bogey or worse 0, bogey 1, par 2, birdie 3, eagle 4. Most points wins.'],
    ['pickup', 'Pick up at zero', 'Once you can’t score a point, pick up. A pick-up is 0 points.'],
    ['countback', 'Ties', 'Ties are broken on countback: best points over the last 9 holes, then the last 6, 3 and 1.'],
  ]),
  S('stroke', 'format', '📉', 'Stroke play', [
    ['strokes', 'Every shot counts', 'Count every stroke and penalty. Net score = gross less your handicap. Lowest net wins.'],
    ['pickup', 'Pick-ups', 'To keep it moving, a pick-up counts as a net double bogey (par + 2 + the shots you get on that hole).'],
    ['countback', 'Ties', 'Countback on net score over the last 9, 6, 3 and 1 holes.'],
  ]),
  S('ambrose', 'format', '🤝', 'Ambrose', [
    ['how', 'How it works', 'Everyone in the team tees off; pick the best shot and everyone plays from there (within a club-length, no closer to the hole). Repeat until it’s in the hole.'],
    ['drives', 'Each player’s drives', 'Each player must have a minimum number of their tee shots used (your organiser sets it — often 4 or 6 in a team of four).'],
    ['putting', 'On the green', 'Mark the chosen spot and everyone putts from within a putter-head of it. First one in counts.'],
    ['handicap', 'Team handicap', 'Combined handicaps ÷ (2 × the number in the team): pairs ÷ 4, threes ÷ 6, fours ÷ 8 — unless the organiser sets the team handicap.'],
    ['score', 'Scoring', 'Straight strokes, not points. Net = gross less the team handicap. Lowest net wins; ties on countback.'],
  ]),
  S('fourball', 'format', '👯', '4BBB (four-ball better ball)', [
    ['how', 'How it works', 'Play in pairs, each with your own ball and your own handicap. On each hole the better Stableford score of the pair counts.'],
    ['pickup', 'Pick up if your partner’s got it', 'If your partner has the hole covered and you can’t beat them, pick up.'],
    ['score', 'Scoring', 'The pair’s points are added up. Most points wins; ties on countback.'],
  ]),
  S('cup', 'format', '⚔️', 'The Cup — team match play', [
    ['holes', 'Win holes, not strokes', 'Each hole is won by the lower net score, or halved if level. The match is won by whoever is more holes up than there are left to play.'],
    ['shots', 'Shots in a match', 'The higher handicap side gets the difference in shots, on the holes by stroke index.'],
    ['concede', 'Concessions', 'You can concede a putt, a hole or the match at any time. A concession can’t be taken back or refused.'],
    ['halved', 'Halved holes and matches', 'Level on a hole: halved. Level after 18: the match is halved and each side gets half the points.'],
    ['points', 'Points', 'Each match is worth the points set for that day. More than half of all the points wins the Cup.'],
  ]),

  S('skins', 'game', '💰', 'Skins', [
    ['how', 'Win the hole outright', 'The single lowest score on a hole (net unless you play it gross) wins the skin. A pick-up never wins a skin.'],
    ['carry', 'Ties carry', 'A tie carries the skin to the next hole (if carry-overs are on), so a hole can be worth several skins.'],
    ['money', 'Paying out', 'Each skin won collects the stake from every other player.'],
  ]),
  S('nassau', 'game', '🎰', 'Nassau', [
    ['bets', 'Three bets', 'Best front 9, best back 9 and best 18 — each its own bet. Ties split the pot.'],
    ['pickup', 'Pick-ups', 'In stroke totals a pick-up counts as a double bogey (net); in Stableford points it’s 0.'],
  ]),
  S('stableford_pot', 'game', '🏺', 'Stableford pot', [
    ['how', 'Most points takes the pot', 'Everyone puts in the stake; most Stableford points for the round takes it. Ties split.'],
  ]),
  S('birdie_pool', 'game', '🐦', 'Birdie pool', [
    ['how', 'Birdies share the pool', 'Everyone puts in; each birdie or better takes an equal share. A pick-up never makes a birdie. No birdies — everyone keeps their money.'],
  ]),
  S('eclectic', 'game', '🧩', 'Eclectic', [
    ['how', 'Your best on each hole', 'Your best score on each hole across the trip’s rounds on the same course. Lowest total wins; only a full card can win.'],
  ]),

  S('ctp', 'comp', '🎯', 'Closest to the pin', [
    ['how', 'Closest wins', 'On the nominated holes, the ball finishing closest to the hole wins. Measure from the ball to the hole.'],
    ['confirm', 'The organiser confirms', 'Enter it in the app with a photo if you can. The organiser confirms the winner — a confirmed call beats any number.'],
  ]),
  S('ld', 'comp', '💣', 'Longest drive', [
    ['how', 'Longest wins', 'On the nominated hole, the longest tee shot wins. Distances from the tee GPS are approximate.'],
    ['confirm', 'The organiser confirms', 'The organiser confirms the winner — a confirmed call beats any number.'],
  ]),
  S('own_comps', 'comp', '🏅', 'Our other side comps', [
    ['measured', 'Measured comps', 'Smallest or biggest number wins, as the comp says. The organiser confirms the winner.'],
    ['dots', 'Dots', 'Tap +1 each time it happens. Most dots wins (or “wins”, for the penalty ones).'],
  ]),
];

const BY_ID = Object.fromEntries(STANDARD_SECTIONS.flatMap((s) => s.rules.map((r) => [r.id, { ...r, section: s.key, sectionTitle: s.title }])));

/** A standard rule by id ('golf.ob'), with its section — or null. */
export const standardRule = (id) => BY_ID[id] || null;

/** Every standard rule as [{ id, label }] for a picker ("Rules of golf — Out of bounds"). */
export function standardOptions() {
  return STANDARD_SECTIONS.flatMap((s) => s.rules.map((r) => ({ id: r.id, label: `${s.title} — ${r.title}` })));
}

// ------------------------------------------------------------------ what the group plays

/**
 * The section keys in use: 'golf' always; each round format played; the Cup; each game kind (custom games count as
 * their base game); closest to the pin / longest drive if any round has the holes set; 'own_comps' if the group has
 * its own side comps.
 */
export function inUse({ rounds = [], games = [], customGames = [], comps = [], ownDefs = [] } = {}) {
  const keys = new Set(['golf']);
  for (const r of rounds) {
    if (r?.format) keys.add(r.format);
    if (r?.ctp_holes?.length) keys.add('ctp');
    if (r?.ld_holes?.length) keys.add('ld');
  }
  const customById = Object.fromEntries(customGames.map((c) => [c.id, c]));
  for (const g of games) {
    if (g?.retired) continue;
    keys.add(customById[g.custom_game_id]?.base_type || g.kind);
  }
  for (const c of customGames) if (!c.retired) keys.add(c.base_type);
  if (comps.some((c) => c.kind === 'cup' && !c.retired)) keys.add('cup');
  if (ownDefs.some((d) => !d.retired)) keys.add('own_comps');
  return keys;
}

/**
 * The standard sections to show, with each rule's local overrides linked.
 * localRules: the group's rules (only active ones override). showAll: every section, used or not.
 * Returns [{ ...section, used, rules: [{ ...rule, overriddenBy: [localRule] }] }].
 */
export function standardSections({ used = new Set(['golf']), localRules = [], showAll = false } = {}) {
  const over = {};
  for (const r of localRules) {
    if (r?.status !== 'active' || !r.overrides || !BY_ID[r.overrides]) continue;
    (over[r.overrides] ||= []).push(r);
  }
  return STANDARD_SECTIONS
    .filter((s) => showAll || used.has(s.key))
    .map((s) => ({ ...s, used: used.has(s.key), rules: s.rules.map((r) => ({ ...r, overriddenBy: over[r.id] || [] })) }));
}

/** How many standard rules the group plays differently (for the section's header). */
export const overrideCount = (sections) => sections.reduce((n, s) => n + s.rules.filter((r) => r.overriddenBy.length).length, 0);

// ------------------------------------------------------------------ ideas for local rules

// Our own wording. overrides: the standard rule it changes (if any). category / applies_to as for the rules table.
const I = (key, title, detail, { value = null, category = 'other', applies_to = ['all'], overrides = null } = {}) => ({ key, title, detail, value, category, applies_to, overrides });

export const RULE_IDEAS = [
  I('beer_gimmes', 'Beer-can gimmes', 'Gimme length is the height of the empty cans you’ve had on the course, stacked. No cans, no gimmes.', { category: 'etiquette', overrides: 'golf.green' }),
  I('ob_lateral', 'Out of bounds plays like a penalty area', 'Out of bounds or lost? Drop near where it went out, no closer to the hole, one penalty shot. No walking back.', { value: '+1 shot', category: 'etiquette', overrides: 'golf.ob' }),
  I('lost_lateral', 'Lost ball — drop and go', 'Can’t find it in a minute? Drop where it was probably lost, one penalty shot.', { value: '+1 shot', category: 'etiquette', overrides: 'golf.lost' }),
  I('mulligan_nine', 'One mulligan each nine', 'One do-over per nine, any shot except a putt. Use it or lose it.', { category: 'etiquette', overrides: 'golf.as_it_lies' }),
  I('breakfast_ball', 'Breakfast ball', 'A free second tee shot on the 1st hole. Play the better one.', { category: 'etiquette', overrides: 'golf.as_it_lies' }),
  I('preferred_lies', 'Preferred lies through the green', 'On the fairway and rough you can lift, clean and place within a scorecard length, no closer to the hole.', { category: 'etiquette', overrides: 'golf.as_it_lies' }),
  I('max_double_par', 'Max score is double par', 'Nobody writes down more than double the par. Pick it up and move on.', { category: 'format', overrides: 'golf.max_score' }),
  I('leather_gimme', 'Gimmes inside the leather', 'Anything inside the grip of the putter (laid down from the hole) is given — except on the last hole, where you putt everything out.', { category: 'etiquette', overrides: 'golf.green' }),
  I('no_gimme_last', 'No gimmes on the 18th', 'Every putt on the last hole gets holed. No exceptions, no matter how short.', { category: 'etiquette' }),
  I('bunker_rake', 'Rake and place in bunkers', 'Unraked footprint? Smooth it and place your ball, no penalty.', { category: 'etiquette', overrides: 'golf.bunker' }),
  I('one_bounce_drop', 'Drop in the fairway', 'Any relief drop can go on the nearest bit of fairway, no closer to the hole.', { category: 'etiquette', overrides: 'golf.drop' }),
  I('whiff_free', 'Air shots are free on the tee', 'Swing and miss on the tee? Doesn’t count (but everyone saw it).', { category: 'etiquette' }),
  I('trap_beer', 'Leave it in the bunker, buy a round', 'Take two goes to get out of a bunker and you’re shouting the next round.', { category: 'fines' }),
  I('three_putt_fine', 'Three-putt fine', 'Every three-putt is a gold coin in the kitty.', { value: '$1 a three-putt', category: 'fines' }),
  I('sledging_hour', 'No talking on the backswing', 'Talk in someone’s backswing and they replay it free if they want — and you owe them a beer.', { category: 'etiquette' }),
  I('ld_fairway_only', 'Longest drive must be on the fairway', 'For longest drive, the ball has to finish on the short grass to count.', { category: 'side_comp', applies_to: ['all'], overrides: 'ld.how' }),
  I('ctp_green_only', 'Closest to the pin must be on the green', 'For closest to the pin, your ball has to be on the green to count.', { category: 'side_comp', overrides: 'ctp.how' }),
  I('drive_min_ambrose', 'Four drives each in Ambrose', 'Each player must have at least four of their drives used.', { value: '4 drives each', category: 'format', applies_to: ['ambrose'], overrides: 'ambrose.drives' }),
  I('stableford_pickup_net_bogey', 'Pick up after net double bogey', 'In Stableford, once you’re past net bogey and can’t score, pick up — no exceptions.', { category: 'format', applies_to: ['stableford'], overrides: 'stableford.pickup' }),
  I('skins_no_carry', 'Skins don’t carry', 'A tied hole kills the skin — nobody gets it.', { category: 'other', overrides: 'skins.carry' }),
  I('handicap_cut', 'Winner’s cut', 'Win a round and your handicap drops two shots for the next one.', { value: '−2 shots', category: 'handicap', overrides: 'golf.handicap' }),
  I('last_place_shout', 'Last place shouts', 'Lowest score of the day buys the first round at the pub.', { category: 'fines' }),
];

/** Ideas not already in the Rulebook (same title, any status except rejected / retired). */
export function freshIdeas(localRules = []) {
  const have = new Set(localRules.filter((r) => r.status === 'active' || r.status === 'proposed').map((r) => String(r.title || '').trim().toLowerCase()));
  return RULE_IDEAS.filter((i) => !have.has(i.title.toLowerCase()));
}

/** The rules-table row for an idea (what the propose sheet starts from). */
export function ideaToRule(idea) {
  return { title: idea.title, detail: idea.detail, value: idea.value, category: idea.category, applies_to: [...idea.applies_to], overrides: idea.overrides, status: 'proposed' };
}
