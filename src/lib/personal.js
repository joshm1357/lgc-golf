// Personal links: an organiser sends each player their OWN link (#/me/CODE). The player opens it, signs in
// properly, and that sign-in is connected to their existing player — same name, scores and history.
// The server side is migration 046. Pure functions here, tested in personal.test.js.

const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/; // the same letters as invite codes (no 0/O/1/I/L)

/** The code in "#/me/ABCD…", a full link, or "/me/ABCD…" (the router's path). Null if there isn't one. */
export function personalCode(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/#\/me\/([A-Za-z0-9]+)/) || s.match(/^\/?me\/([A-Za-z0-9]+)$/);
  const code = m ? m[1].toUpperCase() : null;
  return code && CODE.test(code) ? code : null;
}

/** The link to send. */
export function personalLink(code, base = typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env.BASE_URL}` : '') {
  return `${base}#/me/${code}`;
}

/** The message that goes with it, ready for Messenger or WhatsApp. */
export function personalMessage(name, groupName, link, role = 'player') {
  const who = String(name || '').trim() || 'mate';
  const group = String(groupName || '').trim() || 'the group';
  const organiser = role === 'organiser' ? ` It also makes you an organiser of ${group}, so keep it to yourself.` : '';
  return `G'day ${who}, here's your own link for ${group} on The Golf Trip. Tap it and sign in, and your scores and history stay with you on any phone. It's just for you, so please don't share it (it works once and lasts 14 days).${organiser} ${link}`;
}

/** One player's line on the organiser's Personal links card. */
export function signInLine(row, now = Date.now()) {
  if (!row) return { word: 'Not signed in yet', done: false };
  if (row.signed_in) return { word: row.email ? `Signed in as ${row.email}` : 'Signed in', done: true };
  if (row.link_waiting) {
    const until = row.link_expires ? new Date(row.link_expires) : null;
    const left = until ? Math.ceil((until.getTime() - now) / 86_400_000) : null;
    return { word: left != null && left > 0 ? `Link sent · works for ${left} more day${left === 1 ? '' : 's'}` : 'Link sent', done: false, waiting: true };
  }
  return { word: row.phones > 0 ? 'Not signed in yet (phone only)' : 'Not signed in yet', done: false };
}

/** What the "Hi Mike" screen shows, from player_link_info and whether this phone is signed in properly. */
export function linkScreen(info, signedIn) {
  if (!info) return 'bad';
  // Done only for a proper sign-in: the old phone is already this player, but still has to sign in.
  if (info.mine && signedIn) return 'done';
  if (info.state === 'used') return 'used';
  if (info.state === 'expired') return 'expired';
  if (info.state === 'replaced') return 'replaced';
  return signedIn ? 'confirm' : 'sign-in';
}
