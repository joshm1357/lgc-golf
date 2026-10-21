// In-jokes (migration 058, feature 'in_jokes'): a group's nicknames and running jokes, used by award moments and
// round replays ("{name}'s driver has a mind of its own"). Pure functions only — screens and other builders import
// these. The database has the same rules (length, moments and the block list) so an old app can't get around them.

/** When a joke can come up. Same list as the database's check (058). */
export const MOMENTS = [
  { value: 'any', label: 'Any time' },
  { value: 'birdie', label: 'A birdie' },
  { value: 'bogey', label: 'A bogey' },
  { value: 'blowup', label: 'A blow-up hole' },
  { value: 'lead', label: 'Takes the lead' },
  { value: 'win', label: 'Wins' },
  { value: 'ctp', label: 'Closest to the pin' },
  { value: 'ld', label: 'Longest drive' },
  { value: 'tribunal', label: 'The Tribunal' },
];
export const MOMENT_LABEL = Object.fromEntries(MOMENTS.map((m) => [m.value, m.label]));

export const MIN_LEN = 2;
export const MAX_LEN = 140;

/** A few to get people going. {name} is swapped for the player's name. */
export const EXAMPLES = [
  { text: "{name}'s driver has a mind of its own", moment: 'any' },
  { text: 'Even a blind squirrel finds a nut, {name}', moment: 'birdie' },
  { text: '{name} has entered the trees. Send a search party.', moment: 'blowup' },
  { text: 'Somebody check {name}’s handicap', moment: 'win' },
  { text: 'Lunch is on {name}', moment: 'lead' },
];

// Roast the golf and the mates — never race, religion, sexuality or disability. A short list of obvious slurs and
// abuse, matched as whole words after undoing common l33t swaps. Ordinary swearing is fine (it's a golf trip).
// The database (058, private.in_joke_blocked) has the same list; a unit test checks they match.
export const BLOCKED = [
  // race and religion
  'nigger', 'nigga', 'niggers', 'niggas', 'coon', 'coons', 'chink', 'chinks', 'gook', 'gooks', 'wog', 'wogs',
  'spic', 'spics', 'kike', 'kikes', 'boong', 'boongs', 'abo', 'abos', 'paki', 'pakis', 'towelhead', 'towelheads',
  'raghead', 'ragheads', 'wetback', 'wetbacks', 'sandnigger', 'jigaboo',
  // sexuality and gender
  'fag', 'fags', 'faggot', 'faggots', 'poofter', 'poofters', 'dyke', 'dykes', 'tranny', 'trannies',
  // disability
  'retard', 'retards', 'retarded', 'spastic', 'spastics', 'spaz', 'spazz', 'mong', 'mongs', 'mongoloid',
  // abuse
  'kys',
];
export const BLOCKED_PHRASES = ['kill yourself', 'kill urself', 'go die'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

/** Lower case, l33t undone, everything that isn't a letter becomes a space. */
export function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$!]/g, (c) => LEET[c])
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

const BLOCKED_SET = new Set(BLOCKED);

/** Does the text have a word on the block list? */
export function isBlocked(text) {
  const n = normalise(text);
  if (!n) return false;
  if (n.split(' ').some((w) => BLOCKED_SET.has(w))) return true;
  const padded = ` ${n} `;
  return BLOCKED_PHRASES.some((p) => padded.includes(` ${p} `));
}

/** Check a joke before saving. Returns '' when it's fine, otherwise a short reason to show. */
export function checkJoke(text) {
  const t = String(text || '').trim();
  if (t.length < MIN_LEN) return 'Write the joke first';
  if (t.length > MAX_LEN) return `Keep it under ${MAX_LEN} characters`;
  if (isBlocked(t)) return 'Keep it friendly — roast the golf, not who someone is';
  return '';
}

/** Can this person edit or retire this joke? The person who added it, or an organiser. */
export function canEdit(joke, { playerId, isOrganiser } = {}) {
  if (!joke) return false;
  return !!isOrganiser || (!!playerId && joke.created_by === playerId);
}

/** Swap {name} (any case, spaces allowed) for the name. No name: "someone" (capitalised at the start). */
export function fillJoke(text, { name } = {}) {
  const who = String(name || '').trim() || 'someone';
  const out = String(text || '').replace(/\{\s*name\s*\}/gi, who);
  return name ? out : out.replace(/^someone/, 'Someone');
}

// A small seeded random number (mulberry32), so the same seed always gives the same pick (and tests are steady).
function hashSeed(seed) {
  const s = String(seed ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seeded(seed) {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a joke for a moment. Prefers, in order:
 *   1. a joke about this player for this moment
 *   2. a joke about nobody in particular for this moment
 *   3. a joke about this player for 'any' time
 *   4. a joke about nobody in particular for 'any' time
 * Retired jokes and jokes about other players are never picked. `last` (a joke or its id) is never picked again, so
 * the same joke doesn't come up twice in a row; if it's the only one that fits, you get null. Same seed, same pick.
 */
export function pickJoke(jokes, { playerId = null, moment = 'any', seed = 0, last = null } = {}) {
  const lastId = last && typeof last === 'object' ? last.id : last;
  const live = (jokes || []).filter((j) => j && j.active !== false && j.text && (lastId == null || j.id !== lastId));
  const fits = (j, who, when) => (who ? j.player_id === who : !j.player_id) && (j.moment || 'any') === when;
  const tiers = [];
  if (moment && moment !== 'any') {
    if (playerId) tiers.push((j) => fits(j, playerId, moment));
    tiers.push((j) => fits(j, null, moment));
  }
  if (playerId) tiers.push((j) => fits(j, playerId, 'any'));
  tiers.push((j) => fits(j, null, 'any'));
  for (const t of tiers) {
    const pool = live.filter(t).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (pool.length) return pool[Math.floor(seeded(`${seed}|${playerId || ''}|${moment}`)() * pool.length)];
  }
  return null;
}

/**
 * For a run of picks (a replay, a set of award cards): remembers the last joke so it never repeats back to back.
 * const next = jokePicker(jokes, { seed: round.id }); next({ playerId, moment: 'birdie' }) → joke or null
 */
export function jokePicker(jokes, { seed = 0 } = {}) {
  let last = null;
  let n = 0;
  return (opts = {}) => {
    n += 1;
    const j = pickJoke(jokes, { ...opts, seed: `${seed}#${n}`, last });
    if (j) last = j;
    return j;
  };
}

/**
 * The list screen: live jokes grouped by who they're about, people in name order, "Everyone" (no player) first.
 * Returns [{ playerId|null, name, jokes: [...] }]. Retired jokes are left out unless `withRetired`.
 */
export function groupJokes(jokes, playersById = {}, { withRetired = false, nameOf } = {}) {
  const name = nameOf || ((p) => (p ? p.nickname || p.name : 'Unknown'));
  const groups = new Map();
  for (const j of jokes || []) {
    if (!withRetired && j.active === false) continue;
    const key = j.player_id || null;
    if (!groups.has(key)) groups.set(key, { playerId: key, name: key ? name(playersById[key]) : 'Everyone', jokes: [] });
    groups.get(key).jokes.push(j);
  }
  const out = [...groups.values()];
  for (const g of out) g.jokes.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out.sort((a, b) => (a.playerId ? 1 : 0) - (b.playerId ? 1 : 0) || a.name.localeCompare(b.name));
}
