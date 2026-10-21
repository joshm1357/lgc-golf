// Invite links: https://…/lgc-golf/#/join/<CODE>. The code is 12 letters and numbers made by the server
// (no 0/O/1/I/L), so it reads back cleanly; it's matched without caring about upper or lower case.

const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/;

/** The invite code in a link or hash ("#/join/ABCD…", a full URL, or the bare code), or null. */
export function inviteCode(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/#\/join\/([A-Za-z0-9]+)/) || s.match(/^\/?join\/([A-Za-z0-9]+)$/) || s.match(/^([A-Za-z0-9]{12})$/);
  const code = m ? m[1].toUpperCase() : null;
  return code && CODE.test(code) ? code : null;
}

/** The link to share. */
export function inviteLink(code, base = typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env.BASE_URL}` : '') {
  return `${base}#/join/${code}`;
}

/** Roles in plain words. */
export const ROLE_LABEL = { organiser: 'Organiser', player: 'Player', guest: 'Guest' };
export const ROLE_HELP = {
  organiser: 'Runs the group: trips, rounds, players, invites.',
  player: 'Plays, scores, votes on rules and in the Tribunal.',
  guest: 'A ring-in: plays, scores, posts and chats — no votes on rules or in the Tribunal.',
};
