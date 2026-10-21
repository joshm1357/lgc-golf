// Commentary lines for the round replay, in two styles the group picks:
//   Broadcast — calm, like the telly on a Sunday afternoon.
//   Larrikins — cheeky, the way your mates would call it from the cart.
//
// Guardrails (a unit test checks these): roast the golf and the mates, never race, religion, sexuality,
// disability or tragedy; no real commentators' names. In-jokes come from the group itself (the in_jokes table) and
// are only dropped in where they fit the moment.
//
// Placeholders: {name} {other} {hole} {par} {strokes} {over} {places} {rank} {gap} {left} {comp} {score} {by}
// {round} {course} {count} {text}

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
  return fill(list[hashSeed(`${seed}|${kind}`) % list.length], vars);
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

/** The words for a moment: the template line, plus an in-joke if one fits. */
export function captionFor(moment, { style = DEFAULT_STYLE, seed = 0, jokes = [], used } = {}) {
  if (!moment) return '';
  const vars = { ...moment, hole: moment.hole != null ? holeText(moment.hole) : 'this hole', rank: moment.rank != null ? ordinal(moment.rank) : '' };
  const kind = moment.kind === 'side_comp' && moment.hole == null ? 'side_comp_round' : moment.kind;
  const line = pickLine(kind, style, vars, seed);
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

/**
 * The words under every step of the replay (buildTimeline's steps). Same replay + style + seed = same words.
 * In-jokes are each used once, in order.
 */
export function captionsFor(replay, steps, { style = DEFAULT_STYLE, seed = 0, jokes = [], roundName = '', courseName = '' } = {}) {
  const used = new Set();
  return steps.map((s, i) => {
    const sd = seed + i * 7919;
    if (s.scene === 'welcome') return pickLine('welcome', style, { round: roundName || 'Today’s round', course: courseName || 'the course' }, sd);
    if (s.scene === 'field') return pickLine('field', style, { count: replay.subjects.length }, sd);
    if (s.scene === 'race') {
      const f = replay.frames[s.frame];
      const m = topMoment(f);
      return m ? captionFor(m, { style, seed: sd, jokes, used }) : captionFor({ kind: 'quiet', hole: f.hole }, { style, seed: sd });
    }
    if (s.scene === 'finish' && replay.finish) {
      const f = replay.finish;
      return pickLine(f.close ? 'close' : 'gap', style, { name: f.leader, other: f.second, gap: f.gapText, left: f.left }, sd);
    }
    if (s.scene === 'winner' && replay.winner) {
      const last = replay.frames[replay.frames.length - 1];
      return captionFor(last.moments.find((m) => m.kind === 'win'), { style, seed: sd, jokes, used });
    }
    if (s.scene === 'awards') {
      const a = replay.awards;
      if (a.worst && a.worst.diff >= 2) return pickLine('award_worst', style, { name: a.worst.name, strokes: a.worst.strokes, hole: `the ${ordinal(a.worst.hole)}` }, sd);
      if (a.climber) return pickLine('award_climber', style, { name: a.climber.name, places: a.climber.places }, sd);
      if (a.best) return pickLine('award_best', style, { name: a.best.name, strokes: a.best.strokes, hole: `the ${ordinal(a.best.hole)}` }, sd);
      return '';
    }
    if (s.scene === 'end') return pickLine('end', style, {}, sd);
    return '';
  });
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
