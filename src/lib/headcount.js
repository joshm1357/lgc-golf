// The ONE headcount rule (O6, Josh's walkthrough 23 Oct: "9 in", "11 haven't answered", "deposits 0 of 10" and a
// calling script for 12, all on the same trip). Every screen that shows how many are coming, or works a number out
// from it (tee times, the calling script, accommodation searches), uses these. Pure functions, tested
// (headcount.test.js). Other builders import this too — keep the shapes stable.
//
// Plain words:
//   * The people a trip is for: everyone in the group (approved, not guests) plus anyone who has replied (a guest
//     who said they're in counts).
//   * Replies: in / maybe / out / not replied — counted over those people, one way, everywhere:
//     "9 in · 1 maybe · 1 not replied".
//   * How many are playing (the number tee times and searches use): the TARGET the organiser set (or the plan chat
//     set), labelled as a target ("for 10 (target)"); else the people who said they're in; else in + maybe; else the
//     whole group. Never a made-up default.
//   * Tee times: players ÷ 4, rounded up.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The people a trip is for: approved non-guest players, plus anyone with a reply. → [player ids] */
export function tripPeople({ players = [], rsvps = [] } = {}) {
  const ids = new Set((players || []).filter((p) => p && p.approved !== false && p.role !== 'guest').map((p) => p.id));
  (rsvps || []).forEach((r, i) => { if (r) ids.add(r.player_id || `reply:${i}`); });
  return [...ids];
}

/**
 * Who's said what. players: the group's players; rsvps: THIS trip's replies.
 * → { in, maybe, out, noReply, total, ids: { in, maybe, out, noReply } }
 */
export function replies({ players = [], rsvps = [] } = {}) {
  const people = tripPeople({ players, rsvps });
  const status = new Map((rsvps || []).map((r, i) => [r?.player_id || `reply:${i}`, r?.status]));
  const ids = { in: [], maybe: [], out: [], noReply: [] };
  for (const id of people) {
    const s = status.get(id);
    if (s === 'in' || s === 'maybe' || s === 'out') ids[s].push(id);
    else ids.noReply.push(id);
  }
  return { in: ids.in.length, maybe: ids.maybe.length, out: ids.out.length, noReply: ids.noReply.length, total: people.length, ids };
}

/**
 * One person's reply, by the same rule as replies(): (player id) → 'in' | 'maybe' | 'out' | null (not replied).
 * Anything that isn't in / maybe / out counts as not replied. (lib/yourround.js peopleStatus uses this.)
 */
export function replyOf({ rsvps = [] } = {}) {
  const status = new Map((rsvps || []).filter((r) => r?.player_id).map((r) => [r.player_id, r.status]));
  return (pid) => {
    const s = status.get(pid);
    return s === 'in' || s === 'maybe' || s === 'out' ? s : null;
  };
}

/** "9 in · 1 maybe · 1 not replied" (out only when someone's out; nothing when there's nobody). */
export function repliesLine(r) {
  if (!r || !r.total) return 'Nobody yet';
  return [`${r.in} in`, r.maybe ? `${r.maybe} maybe` : null, r.out ? `${r.out} out` : null, r.noReply ? `${r.noReply} not replied` : null]
    .filter(Boolean).join(' · ');
}

/** Tee times for n players: n ÷ 4, rounded up. */
export const teeTimesFor = (n) => (Number(n) > 0 ? Math.ceil(Number(n) / 4) : 0);

/**
 * How many are playing — the number tee times, the calling script and the accommodation searches use.
 * target: the number the organiser set (targetBy 'ai' = the plan chat set it).
 * → { people, needed, source: 'target' | 'ai' | 'in' | 'keen' | 'group' | 'none', label, words }
 *   label: what to show next to the number — a target always says it's a target: "for 10 (target)".
 */
export function playing({ target = null, targetBy = null, players = [], rsvps = [] } = {}) {
  const t = Math.round(Number(target));
  const r = replies({ players, rsvps });
  let people = 0; let source = 'none';
  if (t > 0) { people = t; source = targetBy === 'ai' ? 'ai' : 'target'; } else if (r.in) { people = r.in; source = 'in'; } else if (r.in + r.maybe) { people = r.in + r.maybe; source = 'keen'; } else {
    const group = (players || []).filter((p) => p && p.approved !== false && p.role !== 'guest').length;
    if (group) { people = group; source = 'group'; }
  }
  const words = {
    target: 'target', ai: 'target, from the plan chat', in: 'said they’re in', keen: 'in or maybe', group: 'everyone in the group', none: 'not known yet',
  }[source];
  const label = !people ? 'not known yet'
    : source === 'target' || source === 'ai' ? `for ${people} (target)`
      : source === 'in' ? `${people} in`
        : source === 'keen' ? `${people} in or maybe`
          : `${people} — everyone in the group`;
  return { people, needed: teeTimesFor(people), source, label, words, replies: r };
}

/** "10 players — 3 tee times in a row" (the calling script and the call screen say the same thing). */
export function playersLine(people, needed = teeTimesFor(people)) {
  if (!people) return `${plural(needed || 1, 'tee time')} in a row`;
  return `${plural(people, 'player')} — ${plural(needed, 'tee time')} in a row`;
}
