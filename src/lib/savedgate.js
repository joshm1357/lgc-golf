// Phone-only accounts look and play; saved accounts organise, pay and propose (v10.2, Josh's option B, 23 Oct 2026).
//
// Plain words:
//   - "Just this phone" (joining from the group's link) makes a phone-only account. "Save your spot" adds Google or an
//     email to that SAME account — then it's a saved account.
//   - Phone-only CAN: see everything, say In / Maybe / Out, vote, enter scores, post / react / comment, give cap tips,
//     opt in to a side game, claim "Latest out" for themselves.
//   - Everything in GATED_ACTIONS needs a saved account. The button stays where it is; tapping it opens the
//     "Save your spot to do this" sheet (components/SavedGate.jsx), and once they've saved, what they tapped carries on.
//   - The database refuses the same things (migration 102) with SAVE_MESSAGE, so an older app or a button missed here
//     still ends in the same sheet (ui.jsx's toast spots the message).
//   - A group can switch it off: feature 'phone_only_limited' (on by default). Quick rounds never ask.
//   - Starting a group or a quick round, and a club claiming its course page, always need a saved account (no group
//     yet, and whoever starts a group is its organiser).
//
// Pure functions only — tested in savedgate.test.js.

export const PHONE_ONLY_LABEL = 'Just this phone: scoring and voting only';
export const PHONE_ONLY_HELP = 'You can follow along, vote and score. To organise, pay or propose things, save your spot (Google or email).';
export const SAVE_MESSAGE = 'Save your spot first (Google or email) to do this';
export const FEATURE_KEY = 'phone_only_limited';

/** What needs a saved account. key → the words in the sheet ("… needs a saved account"). */
export const GATED_ACTIONS = {
  propose_trip: 'Suggesting a trip or starting the planning',
  call_vote: 'Calling or closing a vote',
  organise: 'Organising',
  money: 'Money (“I’ve paid”, costs and deposits)',
  propose_award: 'Proposing an award, a fine or a side game',
  fine: 'Fining or nominating someone',
  penalty: 'Penalties',
  dispute: 'Disputes and Tribunal cases',
  propose_rule: 'Proposing a rule change',
  create_cup: 'Creating a cup',
  invite: 'Inviting people (the invite link and personal links)',
  // Always, whatever the group's switch:
  start_group: 'Starting a group or a quick round',
  club_claim: 'Claiming a course page for your club',
};

/** What a phone-only account can still do (never gated). */
export const CAN_ACTIONS = ['look', 'rsvp', 'vote', 'score', 'post', 'react', 'comment', 'cap_tip', 'side_game_opt_in', 'claim_own'];

/** Actions that need a saved account even before there's a group (or when the group's switch is off). */
const ALWAYS = new Set(['start_group', 'club_claim']);

/**
 * Does this tap need a saved account first?
 *   status   — my_status (signed_in = a saved account; is_member; quick; viewing)
 *   signInOn — this build can sign in (VITE_SIGN_IN lists something). With no way to save, never ask.
 *   limited  — the group's 'phone_only_limited' switch (default on).
 */
export function needsSaved(action, { status, signInOn = true, limited = true } = {}) {
  if (!(action in GATED_ACTIONS)) return false;
  if (!signInOn) return false;
  if (status?.signed_in) return false;
  if (ALWAYS.has(action)) return true;
  if (!status?.is_member || status.viewing || status.quick) return false;
  return limited !== false;
}

/** Is this error the database's "Save your spot first"? */
export function isSaveSpotError(err) {
  const msg = typeof err === 'string' ? err : String(err?.message || '');
  return msg.includes(SAVE_MESSAGE) || err?.hint === 'save_spot';
}

/** The sheet's one line. */
export function gateWords(action) {
  const what = GATED_ACTIONS[action] || 'This';
  return `${what} needs a saved account. Connect Google or email — same account, same name, same scores — and we’ll carry on.`;
}

/** Put on a button: data-needs-saved="<action>". The SavedGate catches the tap if it needs a saved account first. */
export const gate = (action) => ({ 'data-needs-saved': action });
