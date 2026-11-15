// Counting the round door (ov44, claude/round-door-addendum.md piece 8): how many people get from opening "Ask some
// mates" to a locked-in round, and where they came from. COUNTS ONLY — no person, no phone, no ask is attached
// (migration 113's door_counts: day, step, source, how many). Josh reads it on his screen (admin_door_funnel).
//   opened #/ask → built (tapped "Make the link") → signed in → link made → link shared →
//   first reply → first 4-ball → locked in → a replier started their own ask.
// The first five and the last are counted by the app as they happen (once per visit each); first reply, 4-ball and
// locked in are read from the asks themselves.
// The pure parts are tested in door.test.js; count() is the only part that talks to the database.

export const DOOR_STEPS = ['opened', 'built', 'signed_in', 'link_made', 'shared', 'first_reply', 'fourball', 'locked', 'own_started'];
export const DOOR_LABEL = {
  opened: 'Opened “Ask some mates”', built: 'Tapped “Make the link”', signed_in: 'Signed in', link_made: 'Link made', shared: 'Link shared',
  first_reply: 'A mate answered', fourball: 'A 4-ball could play', locked: 'Locked in', own_started: 'A replier started their own', calendar: 'Added to a calendar',
};
const COUNTED = ['opened', 'built', 'signed_in', 'link_made', 'shared', 'own_started', 'calendar'];

/** A clean source tag ('web-home', 'reply', 'locked', 'front', 'groups') or 'direct'. */
export function cleanSource(s) {
  const t = String(s || '').trim().toLowerCase().slice(0, 24);
  return /^[a-z0-9_-]{1,24}$/.test(t) ? t : 'direct';
}

/** What a link into #/ask carries: '?src=web-home&from=<ask token>' → { source, from }. */
export function doorParams(search) {
  let p;
  try { p = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch { p = new URLSearchParams(); }
  const from = String(p.get('from') || '').trim().toUpperCase();
  const okFrom = /^[23456789A-HJ-NP-Z]{16}$/.test(from) ? from : null;
  const src = p.get('src');
  return { source: src ? cleanSource(src) : okFrom ? 'reply' : 'direct', from: okFrom };
}

/** The link "⛳ Ask your own mates" opens, from someone's ask (where: 'reply' after answering, 'locked' on the locked-in card). */
export const ownAskLink = (token, where = 'reply') => `#/ask?from=${encodeURIComponent(String(token || '').toUpperCase())}&src=${cleanSource(where)}`;

/**
 * Josh's funnel rows from admin_door_funnel's answer: [{ step, label, n, of (share of the step before, 0–100 or null) }].
 * The middle steps count no-group asks made in the period, so they can't be more than the links made.
 */
export function doorRows(f) {
  const c = f?.counts || {}; const a = f?.asks || {};
  const made = Math.max(Number(c.link_made) || 0, Number(a.asks) || 0);
  const n = {
    opened: Number(c.opened) || 0, built: Number(c.built) || 0, signed_in: Number(c.signed_in) || 0, link_made: made, shared: Number(c.shared) || 0,
    first_reply: Number(a.first_reply) || 0, fourball: Number(a.fourball) || 0, locked: Number(a.locked) || 0, own_started: Number(c.own_started) || 0,
  };
  let prev = null;
  return DOOR_STEPS.map((step) => {
    // "A replier started their own" is a share of the asks that got a reply, not of the locked-in ones.
    const base = step === 'own_started' ? n.first_reply : prev;
    const row = { step, label: DOOR_LABEL[step], n: n[step], of: base ? Math.min(100, Math.round((n[step] / base) * 100)) : null };
    prev = n[step];
    return row;
  });
}
/** Where people came from, most first: [{ source, opened, link_made }]. */
export function doorSources(f) {
  return Object.entries(f?.sources || {}).map(([source, steps]) => ({ source, opened: Number(steps?.opened) || 0, link_made: Number(steps?.link_made) || 0 }))
    .sort((x, y) => y.opened - x.opened || y.link_made - x.link_made || x.source.localeCompare(y.source));
}

// ------------------------------------------------------------------ counting (the only part that isn't pure)
const SRC_KEY = 'tgt-door-src';
const seenKey = (step) => `tgt-door-${step}`;
const ss = () => { try { return window.sessionStorage; } catch { return null; } };
/** Remember where this visit came from (first tag wins for the visit). */
export function setDoorSource(source) {
  const s = ss(); if (!s) return;
  try { if (!s.getItem(SRC_KEY) || s.getItem(SRC_KEY) === 'direct') s.setItem(SRC_KEY, cleanSource(source)); } catch { /* fine */ }
}
export function doorSource() {
  try { return cleanSource(ss()?.getItem(SRC_KEY)); } catch { return 'direct'; }
}
/** Count a step, once per visit. Never throws and nobody has to wait for it: counting must not get in anyone's way.
 *  It returns a promise that settles when the count has landed (or failed, or after `wait` ms) — only for the one
 *  place that's about to load a new page and would otherwise cut the request off. */
export function count(supabase, step, { once = true, wait = 800 } = {}) {
  if (!COUNTED.includes(step) || !supabase) return Promise.resolve();
  const s = ss();
  try { if (once && s?.getItem(seenKey(step))) return Promise.resolve(); s?.setItem(seenKey(step), '1'); } catch { /* fine */ }
  try {
    const sent = Promise.resolve(supabase.rpc('door_count', { p_step: step, p_source: doorSource() })).then(() => {}, () => {});
    return Promise.race([sent, new Promise((r) => setTimeout(r, wait))]);
  } catch { return Promise.resolve(); }
}
