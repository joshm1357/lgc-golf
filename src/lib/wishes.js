// The connector's learning loop (057), for Josh's Wishes screen. Pure functions only — no React, no database.
//
// Wishes are one-line jobs the assistant couldn't do ("Remind who hasn't paid the kitty"). Similar lines are put
// together with a simple rule: lower case, no punctuation, filler words dropped, plurals trimmed, word order ignored.
// So "Chase who hasn't paid" and "chase who has not paid!" count as the same job.

// Words that don't change what the job is.
const FILLER = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'on', 'in', 'at', 'and', 'or', 'with', 'about', 'from', 'by', 'up',
  'please', 'can', 'could', 'would', 'you', 'i', 'we', 'me', 'us', 'my', 'our', 'it', 'is', 'be', 'that', 'this',
  'want', 'wants', 'wanted', 'like', 'need', 'needs', 'some', 'way', 'able', 'let', 'help',
  // contractions split on the apostrophe ("hasn't" → "hasn", "t"; "has not" → "has", "not")
  'hasn', 'haven', 'hadn', 'isn', 'aren', 'wasn', 'weren', 'don', 'doesn', 'didn', 'won', 'not', 't', 's', 'has', 'have', 'had',
]);

/** One word in its plain form: "reminders" → "reminder", "players" → "player" (simple, on purpose). */
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The grouping key for a wish: its meaningful words, plain, sorted, no repeats. '' if nothing's left. */
export function wishKey(job) {
  const words = String(job ?? '').toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .map(stem);
  return [...new Set(words)].sort().join(' ');
}

/** The tidy text to show for a group of wishes: the most common wording (ties: the newest). */
function label(rows) {
  const n = new Map();
  for (const r of rows) {
    const t = String(r.job || '').trim().replace(/\s+/g, ' ');
    if (t) n.set(t, (n.get(t) || 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const r of rows) { // rows are newest first, so the first one seen wins a tie
    const t = String(r.job || '').trim().replace(/\s+/g, ' ');
    if ((n.get(t) || 0) > most) { best = t; most = n.get(t); }
  }
  return best;
}

/**
 * Put similar wishes together, most asked-for first.
 * rows: [{ job, group_id, group_name, created_at }] (any order).
 * Returns [{ key, job, times, groups, groupNames, last, wordings }] — `groups` = how many different groups asked,
 * `wordings` = the different ways it was put (up to 3), `last` = newest ISO time.
 * Order: most times, then most groups, then most recent, then alphabetical.
 */
export function groupWishes(rows) {
  const by = new Map();
  const sorted = [...(rows || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  for (const r of sorted) {
    const text = String(r?.job || '').trim();
    if (!text) continue;
    const key = wishKey(text) || text.toLowerCase();
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const out = [...by.entries()].map(([key, list]) => {
    const names = new Map();
    for (const r of list) if (r.group_id && !names.has(r.group_id)) names.set(r.group_id, r.group_name || 'A group');
    const wordings = [...new Set(list.map((r) => String(r.job).trim().replace(/\s+/g, ' ')))].slice(0, 3);
    return { key, job: label(list), times: list.length, groups: names.size, groupNames: [...names.values()], last: list[0].created_at || null, wordings };
  });
  return out.sort((a, b) => b.times - a.times || b.groups - a.groups
    || String(b.last || '').localeCompare(String(a.last || '')) || a.job.localeCompare(b.job));
}

/** Share of calls that failed, as a whole percentage (0 when there were no calls). */
export function failRate(calls, failed) {
  const c = Number(calls) || 0;
  return c > 0 ? Math.round((100 * (Number(failed) || 0)) / c) : 0;
}

/** A group's most-used tools, top `n` (default 3), from admin_connector_stats' per-group tool list. */
export function topTools(tools, n = 3) {
  return [...(tools || [])]
    .sort((a, b) => (Number(b.calls) || 0) - (Number(a.calls) || 0) || String(a.tool).localeCompare(String(b.tool)))
    .slice(0, n);
}

// Plain words for the tool names and error kinds the connector logs.
const TOOL_WORDS = {
  lgc_overview: 'Overview', get_leaderboard: 'Leaderboard', enter_scores: 'Enter scores', confirm_side_comp: 'Side comp winner',
  post_to_feed: 'Post to feed', plan_details: 'Trip plan', set_rsvp: 'Who’s in', add_job: 'Add a job', add_cost: 'Add a cost',
  create_poll: 'Start a vote', list_rules: 'Rulebook', suggest_feature: 'Wish', unknown: 'Unknown tool',
};
const ERROR_WORDS = {
  not_found: 'couldn’t find it', ambiguous: 'name matched more than one', locked: 'round locked', bad_input: 'didn’t make sense',
  switched_off: 'feature switched off', database: 'database refused', unknown_tool: 'no such tool', other: 'something else',
};
/** "get_leaderboard" → "Leaderboard"; anything new is shown as it is. */
export const toolName = (t) => TOOL_WORDS[t] || String(t || '');
/** "not_found" → "couldn’t find it". */
export const errorName = (e) => ERROR_WORDS[e] || String(e || 'something else');
