// Links, not PINs (083, Josh 22 Oct: "I don't want PINs any more. It should all be links").
// Every link the app shares works for someone with no session on that phone. One scheme:
//
//   <app>#/join/<CODE>?to=<the page, URL-encoded>      e.g. #/join/ABCDEFGH2345?to=%2F%3Fr%3D<round id>
//
// Open it → already in that group: straight to the page. In another group on this phone: switch, then the page.
// Not in it: join (pick your name) → the page. Old vote links (#/join/CODE?vote=<plan>) keep working.
// Only in-app pages are allowed as targets (start with one "/", never /join or /me) — no open redirects.
// Pure functions, tested in links.test.js.
import { inviteCode } from './invite.js';
import { personalCode } from './personal.js';
import { voteTarget } from './callvote.js';

const PATH = /^\/[A-Za-z0-9/_.~-]*(\?[A-Za-z0-9=&_.~%-]*)?$/;

/** An in-app page ("/plan/123?view=overview") safe to send someone to, or null. */
export function safeTarget(path) {
  if (typeof path !== 'string') return null;
  let p = path.trim();
  if (p.startsWith('#')) p = p.slice(1);
  if (!p.startsWith('/') || p.startsWith('//') || p.length > 300) return null;
  if (!PATH.test(p) || p.includes('..')) return null;
  if (/^\/(join|me)(\/|\?|$)/i.test(p)) return null; // never another invite or someone's personal link
  return p;
}

/** The link to share: through the group's join code when there is one, else straight to the page. */
export function shareLink({ base = '', code = null, to = '/' } = {}) {
  const t = safeTarget(to) || '/';
  const c = inviteCode(code);
  if (!c) return `${base}#${t}`;
  return t === '/' ? `${base}#/join/${c}` : `${base}#/join/${c}?to=${encodeURIComponent(t)}`;
}

/** After joining (or signing in from a link): the page to land on ('#/plan/…'), or null. */
export function linkTarget(hash = '') {
  const s = String(hash || '');
  const at = s.indexOf('?');
  if (at < 0) return null;
  let to = null;
  try { to = new URLSearchParams(s.slice(at + 1)).get('to'); } catch { to = null; }
  if (to != null) {
    const t = safeTarget(to);
    return t ? `#${t}` : null;
  }
  return voteTarget(s);
}

/** The "?to=…" part to keep when a join link is re-written (e.g. a sign-in that comes back to it). */
export function targetQuery(hash = '') {
  const t = linkTarget(hash);
  return t ? `?to=${encodeURIComponent(t.slice(1))}` : '';
}

/**
 * Anything pasted into the "open your link" box. → { hash, kind } or null.
 *  kind: 'invite' (any join link — player, guest, team, organiser), 'personal' (#/me/…), 'page' (an app page with no
 *  join code: the page is remembered, but they still need a join link).
 */
export function readLink(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const mine = personalCode(s);
  if (mine) return { kind: 'personal', hash: `#/me/${mine}` };
  const code = inviteCode(s);
  if (code) {
    const hashPart = s.includes('#') ? s.slice(s.indexOf('#')) : '';
    return { kind: 'invite', code, hash: `#/join/${code}${targetQuery(hashPart)}` };
  }
  if (s.includes('#/')) {
    const t = safeTarget(s.slice(s.indexOf('#') + 1));
    if (t) return { kind: 'page', hash: `#${t}` };
  }
  return null;
}

/**
 * What an opened join link does, once the server has said what it is (invite_info).
 *  'bad'    not a working link
 *  'go'     already in this group, and it's the one open: straight to the page
 *  'switch' already in this group, but another one is open on this phone: switch, then the page
 *  'open'   already in (a plain invite with no page): a button to open it
 *  'join'   not in it yet (or a team link that would put them on a team): the Join button
 */
export function inviteNext({ info, inside = false, currentGroupId = null, hasTarget = false } = {}) {
  if (!info || info.bad) return 'bad';
  const teamToJoin = !!(info.team && !info.my_team);
  if (info.already_in && !teamToJoin) {
    if (inside && info.group_id === currentGroupId) return 'go';
    return hasTarget ? 'switch' : 'open';
  }
  return 'join';
}

/** The page a no-session visitor opened (an old link with no join code), to come back to after joining. */
export function pageToKeep(hash = '') {
  const t = safeTarget(String(hash || '').replace(/^#/, ''));
  return t && t !== '/' ? `#${t}` : null;
}
