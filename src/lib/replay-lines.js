// Commentary lines for the round replay, in two styles the group picks:
//   Broadcast — calm, like the telly on a Sunday afternoon.
//   Larrikins — cheeky, the way your mates would call it from the cart.
//
// Guardrails (a unit test checks these): roast the golf and the mates, never race, religion, sexuality,
// disability or tragedy; no real commentators' names. In-jokes come from the group itself (the in_jokes table) and
// are only dropped in where they fit the moment.
//
// Placeholders: {name} {other} {hole} {par} {strokes} {over} {places} {rank} {gap} {left} {comp} {score} {by}
// {round} {course} {count} {text} {holes}

export const STYLES = [
  { key: 'broadcast', name: 'Broadcast', blurb: 'Calm, like the telly' },
  { key: 'larrikins', name: 'Larrikins', blurb: 'Cheeky, like your mates' },
];
export const DEFAULT_STYLE = 'broadcast';

export const LINES = {
  broadcast: {
    welcome: ['Welcome to {course}. {round} — let’s see how it unfolded.', 'Good afternoon from {course}, and the replay of {round}.', '{round} at {course}. Settle in.'],
    field: ['{count} in the field today. Let’s meet them.', 'The field: {count} of them, all quietly confident.', 'Here’s who teed it up — {count} in all.'],
    quiet: ['Steady going through {hole}.', 'Nothing much changes on {hole}.', 'A quiet one. Pars and patience.', 'The field moves on, little changed.'],
    birdie: ['Birdie for {name} on {hole}. Lovely.', 'That’s a birdie for {name} — nicely done.', '{name} picks up a shot on {hole}.'],
    eagle: ['An eagle for {name}! Quite something on {hole}.', 'Eagle — {name} on {hole}. Superb golf.', '{name} with a {strokes} on a par {par}. Eagle.'],
    ace: ['A hole in one for {name}! On {hole}! Remarkable.', 'In the hole from the tee. {name}, take a bow.', 'An ace for {name}. The drinks are on them, by tradition.'],
    blowup: ['A {strokes} for {name} on {hole}. One to forget.', '{name} will want that one back — {over} over on {hole}.', 'Trouble for {name} on {hole}. A {strokes}.'],
    pickup: ['{name} picks up on {hole}. Sensible.', 'Ball in pocket for {name} on {hole}.', '{name} moves on from {hole} without a score.'],
    lead_change: ['A new leader: {name} goes past {other}.', '{name} takes over at the top from {other}.', 'And there’s a change at the top — {name} leads.'],
    new_leader: ['{name} takes the early lead.', '{name} edges out in front.', 'It’s {name} who leads.'],
    tied_lead: ['All square at the top — {name} and {other}.', 'We have a tie for the lead: {name} and {other}.', '{name} and {other} share it now.'],
    climber: ['{name} climbs {places} places, up to {rank}.', 'Good move from {name} — up {places}.', '{name} on the rise, now {rank}.'],
    faller: ['{name} slips {places} places.', 'A backward step for {name}, down {places}.', '{name} drops back to {rank}.'],
    side_comp: ['{comp} on {hole} goes to {name}.', '{name} wins the {comp} on {hole}.', 'The {comp} on {hole}: {name}.'],
    side_comp_round: ['{comp}: {name}.', '{name} takes the {comp}.'],
    close: ['{gap} in it with {left} to play. This is tight.', 'Just {gap} between {name} and {other}, {left} to go.', '{left} holes left and only {gap} in it.'],
    gap: ['{name} leads by {gap} with {left} to play.', '{gap} the margin, {left} holes left.'],
    win: ['{name} wins it, {score}.', 'And {name} closes it out — {score}.', 'Victory for {name}. {score}.'],
    post: ['From the feed — {name}: “{text}”', 'Meanwhile, {name} posts: “{text}”'],
    award_climber: ['Biggest climber: {name}, up {places} places.'],
    award_worst: ['Toughest hole: {name}, a {strokes} on {hole}.'],
    award_best: ['Shot of the day: {name}, a {strokes} on {hole}.'],
    end: ['That’s the replay. Until next time.', 'And that’s how it finished. Thanks for watching.'],
    // The story (replaybeats.js): stretches of holes, where the top of the board stands, the turn, the last holes.
    swing: ['A big swing on {hole}. {name} now {gap} clear.', 'That hole changes things — {name}, {gap} in front.'],
    stretch_start: ['{holes}: a steady start.', '{holes}: everyone finding their feet.', '{holes}: a cagey opening.'],
    stretch_quiet: ['{holes}: pars and patience.', '{holes}: not much between them.', '{holes}: steady going.'],
    stretch_birdies: ['{holes}: {count} birdies in that run.', '{holes}: the birdies start to come — {count} of them.'],
    standing_new: ['Now it’s {name} in front, by {gap}.', '{name} out in front, by {gap}.'],
    standing_same: ['{name} still in front, by {gap}.', 'Still {name} on top, {gap} clear.'],
    standing_extends: ['{name} pulling clear — {gap} now.', '{name} stretching it out to {gap}.'],
    standing_narrows: ['{name} still in front, but only by {gap}.', 'The gap to {name} is down to {gap}.'],
    standing_tied: ['{name} and {other} all square up top.', 'Level at the top: {name} and {other}.'],
    turn: ['At the turn it’s {name}, {gap} clear.', 'Nine down, nine to go. {name} in front by {gap}.'],
    turn_tied: ['All square at the turn: {name} and {other}.', 'Nine down and nothing in it — {name} and {other} level.'],
    to_play: ['{left} to play.', '{left} holes left.'],
    last_hole: ['One to play.', 'Down the last.'],
  },
  larrikins: {
    welcome: ['Righto, {round} at {course}. Grab a cold one.', '{course}, {round}. Let’s relive the carnage.', 'Strap in. {round} at {course}, warts and all.'],
    field: ['{count} brave souls. Some can even play.', 'The field: {count} legends and a couple of hackers.', '{count} punters, one trophy, zero excuses accepted.'],
    quiet: ['Nothing to see here on {hole}.', 'Bogeys all round, probably.', 'A hole of pure filler on {hole}.', 'Everyone’s just hacking along.'],
    birdie: ['Birdie {name}! Someone check the card.', '{name} birdies {hole}. Won’t shut up about it now.', 'A birdie for {name}. Wonders never cease.'],
    eagle: ['EAGLE for {name}! Who taught them that?', '{name} eagles {hole}. Handicap committee, take note.', 'A {strokes} on a par {par}! {name}’s been sandbagging.'],
    ace: ['HOLE IN ONE, {name}! Bar tab’s open, legend.', '{name} jars it from the tee on {hole}! Your shout, mate.', 'An ace for {name}. Frame the ball. Frame the card.'],
    blowup: ['A {strokes} for {name} on {hole}. Absolute shambles.', '{name} goes {over} over on {hole}. Bring a sandwich next time.', '{name} played {hole} like it owed them money.'],
    pickup: ['{name} pockets it on {hole}. Probably wise.', '{name} gives up on {hole}. We all saw nothing.', 'Ball in pocket, {name}. Dignity: also in pocket.'],
    lead_change: ['{name} pinches the lead off {other}! Cheeky.', '{other} gets mugged — {name} hits the front.', 'Changing of the guard: {name} up, {other} sulking.'],
    new_leader: ['{name} hits the front. Early days, mate.', '{name} leads. Don’t get used to it.', '{name} out in front. Enjoy it while it lasts.'],
    tied_lead: ['{name} and {other} level at the top. Handbags.', 'Level pegging up top: {name}, {other}. Tension.', '{name} and {other}, joined at the hip.'],
    climber: ['{name} up {places}! Someone found the middle of the clubface.', 'Look at {name} go — up {places} spots.', '{name} on a heater, up to {rank}.'],
    faller: ['{name} down {places}. The wheels are wobbling.', 'Plummeting: {name}, down to {rank}.', '{name} drops {places}. Drinks cart can’t come fast enough.'],
    side_comp: ['{comp} on {hole}: {name}. Insufferable now.', '{name} snaffles the {comp} on {hole}.', '{name} takes the {comp} on {hole}. Expect to hear about it.'],
    side_comp_round: ['{comp} goes to {name}. Of course it does.', '{name} wins the {comp}. Brag mode on.'],
    close: ['{gap} in it with {left} to play. Squeaky bum time.', '{name} and {other}, {gap} apart, {left} to go. Nerves.', '{left} to play, {gap} in it. Somebody’s going to choke.'],
    gap: ['{name} by {gap} with {left} left. Cruising, or about to fall apart?', '{gap} the gap, {left} to go. Not over yet, mate.'],
    win: ['{name} WINS! {score}. Insufferable for a week.', '{name} gets it done, {score}. Drinks are on them.', 'Champion: {name}. {score}. The speeches will be long.'],
    post: ['Hot off the feed — {name}: “{text}”', '{name} found time to post: “{text}”'],
    award_climber: ['Rocket of the day: {name}, up {places} spots.'],
    award_worst: ['Shocker of the day: {name}, a {strokes} on {hole}.'],
    award_best: ['Best hole: {name}, a {strokes} on {hole}. Lucky.'],
    end: ['That’s a wrap. Same time next trip.', 'Show’s over. Back to the bar.'],
    swing: ['Huge swing on {hole}! {name} now {gap} clear.', 'Well, {hole} sorted a few things out. {name} by {gap}.'],
    stretch_start: ['{holes}: a nervy start, nobody wants to blink.', '{holes}: the first tee jitters wear off.', '{holes}: all a bit polite so far.'],
    stretch_quiet: ['{holes}: just hacking along.', '{holes}: not a lot to report, mate.', '{holes}: steady, boring, lovely.'],
    stretch_birdies: ['{holes}: {count} birdies! Who are these people?', '{holes}: birdie party — {count} of them.'],
    standing_new: ['Sneaky — {name} in front now, by {gap}.', 'Now it’s {name} up top, {gap} clear.'],
    standing_same: ['{name} still up top, {gap} clear.', 'Still {name} in front, by {gap}. Smug.'],
    standing_extends: ['{name} getting away — {gap} now.', '{name} out to {gap}. Someone stop them.'],
    standing_narrows: ['{name} still in front, but it’s only {gap}. Sweating.', 'Gap’s down to {gap}. {name} can hear footsteps.'],
    standing_tied: ['{name} and {other} level up top. Handbags.', 'Nothing in it: {name} and {other}.'],
    turn: ['Halfway, and it’s {name} by {gap}. Pies at the turn.', 'At the turn: {name}, {gap} clear. Plenty of golf left to stuff it up.'],
    turn_tied: ['All square at the turn — {name} and {other}. Grab a pie.', 'Nine down, {name} and {other} level. Game on.'],
    to_play: ['{left} to play.', '{left} left. Hold your nerve.'],
    last_hole: ['Down the last.', 'One to go. Don’t look at the water.'],
  },
};

/** Small string hash, so the same replay always picks the same lines. */
export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Fill {placeholders}; any missing value becomes an empty string (and doubled spaces are tidied). */
export function fill(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/\s{2,}/g, ' ').trim();
}

/** One line for a moment kind, in a style, picked by seed. */
export function pickLine(kind, style, vars = {}, seed = 0) {
  const bank = LINES[style] || LINES[DEFAULT_STYLE];
  const list = bank[kind] || LINES[DEFAULT_STYLE][kind] || [];
  if (!list.length) return '';
  const line = fill(list[hashSeed(`${seed}|${kind}`) % list.length], vars);
  // A line that starts with a placeholder ("{comp} on …") still starts with a capital.
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const holeText = (h) => (h == null ? '' : `the ${ordinal(h)}`);
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Which in-joke "moment" a replay moment counts as. */
export const JOKE_KIND = { birdie: 'birdie', eagle: 'birdie', ace: 'birdie', blowup: 'bogey', pickup: 'bogey', lead_change: 'lead', new_leader: 'lead', win: 'win' };

/**
 * Maybe pick one of the group's in-jokes for this moment: it must match the moment ('any' matches everything), and
 * if it names a player, it must be that player (or their team). Each joke is used once per replay, and only about
 * half the time, so they stay a surprise. Returns the joke text or null.
 */
export function pickInJoke(jokes, moment, used = new Set(), seed = 0) {
  if (!jokes?.length || !moment) return null;
  const kind = JOKE_KIND[moment.kind];
  if (!kind) return null;
  const ids = new Set([moment.playerId, moment.subjectId].filter(Boolean));
  const fits = jokes.filter((j) => {
    const text = String(j?.text || '').trim();
    if (!text || text.length > 140 || used.has(j.id ?? text)) return false;
    const mk = j.moment || j.moment_kind || j.kind || 'any';
    if (mk !== 'any' && mk !== kind) return false;
    if (j.player_id && !ids.has(j.player_id)) return false;
    return true;
  });
  if (!fits.length) return null;
  // Player-specific jokes first: they land better.
  const own = fits.filter((j) => j.player_id);
  const pool = own.length ? own : fits;
  const h = hashSeed(`${seed}|joke|${moment.kind}`);
  if (moment.kind !== 'win' && h % 2 === 1) return null;
  const j = pool[h % pool.length];
  used.add(j.id ?? String(j.text).trim());
  return String(j.text).trim();
}

// Verbs the lines put straight after a name, and their "they" form (for teams: "Josh & Hamish go past").
const PLURAL_VERBS = {
  goes: 'go', picks: 'pick', takes: 'take', birdies: 'birdie', eagles: 'eagle', wins: 'win', closes: 'close', gets: 'get',
  pinches: 'pinch', hits: 'hit', leads: 'lead', climbs: 'climb', slips: 'slip', drops: 'drop', pockets: 'pocket',
  gives: 'give', moves: 'move', snaffles: 'snaffle', edges: 'edge', sneaks: 'sneak', jars: 'jar', ties: 'tie',
  plays: 'play', posts: 'post', will: 'will', played: 'played',
};
/** Make the verb after a team's name agree with it ("Josh & Hamish goes" → "Josh & Hamish go"). */
export function agree(line, name) {
  if (!name) return line;
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return line.replace(new RegExp(`(${esc}) (\\w+)`, 'g'), (all, n, verb) => (PLURAL_VERBS[verb] ? `${n} ${PLURAL_VERBS[verb]}` : all));
}

/**
 * The words for a moment: the template line, plus an in-joke if one fits. `plural`: the name is a team (Ambrose
 * and 4BBB pairs), so verbs agree with "they" — except when the moment names one player.
 */
export function captionFor(moment, { style = DEFAULT_STYLE, seed = 0, jokes = [], used, plural = false } = {}) {
  if (!moment) return '';
  const vars = { ...moment, hole: moment.hole != null ? holeText(moment.hole) : 'this hole', rank: moment.rank != null ? ordinal(moment.rank) : '' };
  const kind = moment.kind === 'side_comp' && moment.hole == null ? 'side_comp_round' : moment.kind;
  let line = pickLine(kind, style, vars, seed);
  if (plural && !moment.playerId) line = agree(line, moment.name);
  const joke = pickInJoke(jokes, moment, used, seed);
  return joke ? `${line} ${joke}` : line;
}

/** The big pop-up word for a moment (or null). */
export function popWord(moment) {
  if (!moment) return null;
  switch (moment.kind) {
    case 'ace': return 'HOLE IN ONE!';
    case 'eagle': return moment.strokes != null && moment.par != null && moment.strokes - moment.par <= -3 ? 'ALBATROSS!' : 'EAGLE!';
    case 'birdie': return 'BIRDIE!';
    case 'lead_change': return 'NEW LEADER';
    case 'new_leader': return null;
    case 'tied_lead': return 'ALL SQUARE';
    case 'blowup': return 'OUCH';
    case 'close': return 'TIGHT!';
    case 'swing': return 'BIG SWING';
    case 'side_comp': return moment.emoji || null;
    default: return null;
  }
}

// The win and the close finish have their own scenes, so a race frame talks about its next-best moment.
const OWN_SCENE = new Set(['win', 'close']);

/** The moment a race frame is about (or null for a quiet hole). */
export function topMoment(frame) {
  return (frame?.moments || []).find((m) => !OWN_SCENE.has(m.kind)) || null;
}

/** The big word for a race frame: the most dramatic moment that has one. */
export function popFor(frame) {
  for (const m of frame?.moments || []) {
    if (OWN_SCENE.has(m.kind)) continue;
    const w = popWord(m);
    if (w) return { word: w, kind: m.kind };
  }
  return null;
}

/** The group's chosen style, kept on this phone (per group) for now. */
const styleKey = (groupId) => `tgt-replay-style-${groupId || 'x'}`;
export function savedStyle(groupId) {
  try {
    const v = localStorage.getItem(styleKey(groupId));
    return LINES[v] ? v : DEFAULT_STYLE;
  } catch { return DEFAULT_STYLE; }
}
export function saveStyle(groupId, style) {
  try { if (LINES[style]) localStorage.setItem(styleKey(groupId), style); } catch { /* fine */ }
}
