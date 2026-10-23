// First open (F1, Josh 23 Oct 2026 — walkthrough review option A).
//   - The organiser who's just made a group: a three-step start on Home — 1 invite your mates (a ready-made group-chat
//     message, then a live list of who's joined — idea I1), 2 suggest the next trip, 3 turn on notifications.
//   - A new player or guest: one welcome card (the group's name, the faces already in, the next trip or "nothing
//     planned yet").
//   - One pop-up at a time: at most one pop-up a visit (the notifications ask, Save your spot, Caddie's hello…).
//     The notifications ask waits for the second visit (the start card / welcome covers the first); Caddie's hello
//     waits for the second visit too, and for a visit nothing else has popped up in.
//   - The notifications card on Home goes away after "Not now".
// Pure functions plus small storage helpers (each takes the storage so the tests can pass a fake). A "visit" is one
// opening of the app: counted once per browser session.

export const VISITS_KEY = 'tgt-visits';           // localStorage: how many visits on this device
export const VISIT_NOTED = 'tgt-visit-noted';      // sessionStorage: this visit is counted
export const POPUP_KEY = 'tgt-popup-this-visit';   // sessionStorage: the one pop-up this visit had
export const NOTNOW_KEY = 'tgt-notify-notnow';     // localStorage: when "Not now" was tapped on notifications
export const STARTER_KEY = 'tgt-starter';          // localStorage: { [groupId]: { invited, hidden } }
export const WELCOME_KEY = 'tgt-welcome';          // localStorage: { [groupId]: true } once the welcome is put away

const DAY = 86400000;
const local = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
const session = () => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };
const readJson = (store, key) => { try { return JSON.parse(store?.getItem(key) || '{}') || {}; } catch { return {}; } };
const writeJson = (store, key, v) => { try { store?.setItem(key, JSON.stringify(v)); } catch { /* private browsing: fine */ } };

// ------------------------------------------------------------------ visits and the one pop-up a visit

/** Count this visit (once per browser session) → how many visits this device has had, this one included. */
export function noteVisit(store = local(), sess = session()) {
  try {
    const n = Number(store?.getItem(VISITS_KEY)) || 0;
    if (sess?.getItem(VISIT_NOTED)) return Math.max(1, n);
    sess?.setItem(VISIT_NOTED, '1');
    store?.setItem(VISITS_KEY, String(n + 1));
    return n + 1;
  } catch { return 2; } // no storage at all: behave like a returning visit, so nothing waits for ever
}

/** Visits so far (this one included once noteVisit has run). */
export function visitCount(store = local()) {
  try { return Number(store?.getItem(VISITS_KEY)) || 0; } catch { return 2; }
}

/** Which pop-up this visit has had (null = none yet). */
export function popupThisVisit(sess = session()) {
  try { return sess?.getItem(POPUP_KEY) || null; } catch { return null; }
}

/** May this pop-up show now? Only if no other pop-up has shown this visit. */
export function popupFree(name, sess = session()) {
  const had = popupThisVisit(sess);
  return !had || had === name;
}

/** This pop-up is this visit's one. */
export function takePopup(name, sess = session()) {
  try { if (!sess?.getItem(POPUP_KEY)) sess?.setItem(POPUP_KEY, name); } catch { /* fine */ }
}

/**
 * Caddie's hello: from the second visit, and only on a visit nothing else has popped up in.
 *   visits: visitCount(); had: popupThisVisit().
 */
export function helloReady({ visits = 0, had = null } = {}) {
  return visits >= 2 && (!had || had === 'caddie-hello');
}

/** The notifications ask: from the second visit (the first visit's start card or welcome covers notifications). */
export function notifyAskReady({ visits = 0, had = null } = {}) {
  return visits >= 2 && (!had || had === 'notify');
}

// ------------------------------------------------------------------ the notifications card on Home

/** "Not now" on notifications (the card or the pop-up): the Home card stays away for 30 days. */
export function notifyNotNow(now = Date.now(), store = local()) {
  try { store?.setItem(NOTNOW_KEY, String(now)); } catch { /* fine */ }
}
export function notifyCardHidden(now = Date.now(), store = local()) {
  try {
    const t = Number(store?.getItem(NOTNOW_KEY));
    return Number.isFinite(t) && t > 0 && now - t < 30 * DAY;
  } catch { return false; }
}

// ------------------------------------------------------------------ the organiser's three-step start

export function starterState(groupId, store = local()) {
  return readJson(store, STARTER_KEY)[groupId] || {};
}
export function setStarterState(groupId, patch, store = local()) {
  const all = readJson(store, STARTER_KEY);
  all[groupId] = { ...(all[groupId] || {}), ...patch };
  writeJson(store, STARTER_KEY, all);
  return all[groupId];
}

/**
 * The three steps and whether each is done.
 *   joined: how many others have joined (picked a name); invited: the invite was shared from here;
 *   plans: how many trips/ideas the group has; pushOn: notifications are on for this phone.
 */
export function starterSteps({ joined = 0, invited = false, plans = 0, pushOn = false } = {}) {
  return [
    { key: 'invite', title: 'Invite your mates', done: joined >= 2 || (invited && joined >= 1) },
    { key: 'suggest', title: 'Suggest the next trip', done: plans > 0 },
    { key: 'notify', title: 'Turn on notifications', done: !!pushOn },
  ];
}

/**
 * Show the start? Organisers only, while the group is new (fewer than 4 others joined, or no trip yet), until all
 * three are done or they tap "Hide this".
 */
export function showStarter({ isOrganiser = false, joined = 0, plans = 0, hidden = false, steps = [] } = {}) {
  if (!isOrganiser || hidden) return false;
  if (steps.length && steps.every((s) => s.done)) return false;
  return joined < 4 || plans === 0;
}

/** The ready-made message for the group chat. */
export function inviteMessage({ groupName = 'our golf group', link = '', from = '' } = {}) {
  const who = from ? ` — ${from}` : '';
  return `⛳ I’ve set up ${groupName} on The Golf Trip: scores, trip votes and who owes what, all in one place. `
    + `Tap the link, sign in and pick your name (takes a minute): ${link}${who}`;
}

/** "Bo, Cy and 3 more have joined" / "Nobody's joined yet" — the live list's heading (I1). */
export function joinedWords(names = []) {
  if (!names.length) return 'Nobody’s joined yet — they’ll pop up here as they do';
  if (names.length <= 3) return `${names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`} ${names.length === 1 ? 'has' : 'have'} joined`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more have joined`;
}

// ------------------------------------------------------------------ the welcome card (new player or guest)

export function welcomeHidden(groupId, store = local()) {
  return !!readJson(store, WELCOME_KEY)[groupId];
}
export function hideWelcome(groupId, store = local()) {
  const all = readJson(store, WELCOME_KEY);
  all[groupId] = true;
  writeJson(store, WELCOME_KEY, all);
}

/**
 * Show the welcome? Players and guests (not organisers) who joined in the last fortnight, until they put it away.
 *   joinedAt: their group_members.created_at.
 */
export function showWelcome({ isOrganiser = false, joinedAt = null, hidden = false, now = Date.now() } = {}) {
  if (isOrganiser || hidden || !joinedAt) return false;
  const t = Date.parse(joinedAt);
  return Number.isFinite(t) && now - t < 14 * DAY;
}

/** The welcome's next-trip line: "Next up: Hunter Valley · Fri 13 – Mon 16 Nov" / "Next up: Autumn trip (being organised)" / "Nothing planned yet". */
export function nextTripWords(next, fmt = (a, b) => `${a} – ${b}`) {
  if (!next) return 'Nothing planned yet — any of you can suggest one.';
  const when = next.start_date ? fmt(next.start_date, next.end_date) : null;
  const tail = when || (next.status === 'planning' ? 'being organised' : null);
  return `Next up: ${next.name}${tail ? ` · ${tail}` : ''}`;
}
