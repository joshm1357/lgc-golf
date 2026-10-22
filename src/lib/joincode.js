// The group's join code for shared links (083). Fetched once when the group opens; appLink() (push.js) then puts it
// in every link the app shares, so a link opened on a phone with no session joins first and lands on the page.
// Kept per group: a link made in one group never carries another group's code.
import { currentGroup } from './group.js';

let known = { group: null, code: null };

/** The join code for the group open now (or null: not fetched yet, offline, or an older database). */
export function joinCodeNow() {
  const now = currentGroup();
  return known.code && (!now || known.group === now) ? known.code : null;
}

export function rememberJoinCode(group, code) {
  known = { group: group || null, code: code || null };
}

/**
 * Ask the database for it: share_join_code (any member, 083), else group_invite (organisers, older databases).
 * Never throws — links simply go without a code.
 */
export async function loadJoinCode(supabase, { role = 'player', group: g = null } = {}) {
  const group = currentGroup() || g;
  try {
    let { data, error } = await supabase.rpc('share_join_code');
    if ((error || typeof data !== 'string') && role === 'organiser') {
      ({ data, error } = await supabase.rpc('group_invite', { p_role: 'player' }));
    }
    if (!error && typeof data === 'string') rememberJoinCode(group, data);
  } catch { /* fine: links go without a code */ }
  return joinCodeNow();
}
