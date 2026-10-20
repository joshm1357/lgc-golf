// "View as a player" (21 Oct 2026): an organiser sees the app exactly as one of their players does — their scorecard,
// their profile, what a player (not an organiser) can see and tap — without signing in as them.
// It's read only and lives in this browser tab only (sessionStorage). Nothing is sent as the player: while it's on,
// the app refuses every change before it leaves the phone (supabase.js), and the score queue and outbox won't take
// anything. It grants nothing new: an organiser can already read everything in their group.

const KEY = 'tgt-preview';

/** Database reads that go through rpc() (a POST) and change nothing — still allowed while viewing as someone. */
export const READ_RPCS = new Set([
  'my_status', 'find_courses', 'course_page', 'search_courses', 'library_course', 'tv_board', 'player_link_info',
  'partner_courses_for', 'new_groups_open', 'my_club', 'invite_info', 'booking_disclosure', 'report_error',
  'club_stats', 'club_enquiries',
]);

/** The player being viewed as in this tab: { player_id, name, group_id } or null. */
export function previewOf(store = safeSession()) {
  try {
    const v = JSON.parse(store?.getItem(KEY) || 'null');
    return v && typeof v.player_id === 'string' && typeof v.group_id === 'string' ? v : null;
  } catch { return null; }
}
export function startPreview({ player_id, name, group_id }, store = safeSession()) {
  try { store?.setItem(KEY, JSON.stringify({ player_id, name: String(name || 'this player'), group_id })); } catch { /* fine */ }
}
export function stopPreview(store = safeSession()) {
  try { store?.removeItem(KEY); } catch { /* fine */ }
}
function safeSession() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/** Should this request be refused because we're only viewing? Reads pass; any change is stopped. */
export function blockedWhileViewing(url, method, viewing) {
  if (!viewing || !url) return false;
  const m = String(method || 'GET').toUpperCase();
  if (url.includes('/auth/v1/')) return false; // keeping the organiser signed in (token refresh) is fine
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  const rpc = url.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/i);
  if (rpc) return !READ_RPCS.has(rpc[1]);
  return url.includes('/rest/v1/') || url.includes('/storage/v1/') || url.includes('/functions/v1/');
}

/** The status the app works from while viewing: the player instead of the organiser, with a player's rights. */
export function viewAsStatus(status, viewing) {
  if (!status || !viewing || !status.is_member || !status.is_admin || status.group_id !== viewing.group_id) return status;
  return {
    ...status,
    player_id: viewing.player_id,
    is_admin: false,
    role: 'player',
    viewing: { name: viewing.name, organiser_player_id: status.player_id },
  };
}

export const READ_ONLY_MESSAGE = (name) => `You’re viewing as ${name || 'a player'}, so changes are off. Tap Stop at the top to make changes.`;
