// Votes by email (079) — the rules, in one place, shared by the app (src/lib/emailvotes.js), the notify function and
// the vote-link function. Plain JavaScript with no imports, so Vite, Vitest, Node and Deno can all load it.
//
//   * How someone gets votes and trip questions: 'app' (notifications), 'email' or 'both'. Their own choice wins;
//     otherwise the group's default. Email needs an address — without one, email-only falls back to the app.
//   * Someone who isn't on the app yet only gets email (an address an organiser typed in), never a notification.
//   * One email per vote batch (a combined vote card = several polls) per person, with one-tap answer links.
//   * At most one reminder email before a vote closes, only to people on email who haven't answered.

export const CHANNELS = ['app', 'email', 'both'];
export const CHANNEL_LABEL = { app: 'In the app', email: 'By email', both: 'Both' };
export const CHANNEL_HELP = {
  app: 'A notification on your phone.',
  email: 'An email with one-tap answers — no app needed.',
  both: 'A notification and an email.',
};
/** The notification kinds that are "votes and trip questions". */
export const VOTE_KINDS = new Set(['poll_open', 'poll_closing', 'nudge_votes']);
export const ANSWERS = { yes: '✓ Can', maybe: '? Maybe', no: '✗ Can’t' };
export const RSVP_ANSWERS = { in: 'I’m keen', maybe: 'Maybe', out: 'Out' };
// Josh, 22 Oct: the words depend on what's being voted on. The stored answers stay yes / maybe / no (so tallies,
// emails and older app versions keep working) and score the same: 2 / 1 / 0.
//   dates and weekends: ✓ Can · ? Maybe · ✗ Can't
//   places (areas, where to stay, courses, which trip, accommodation, anything else): ⭐ Prefer · 👍 Option · 👎 Don't like
//   optional extras ("Would you do these?"): ⭐ Want it · 👍 Happy either way · 👎 Skip it
export const PLACE_ANSWERS = { yes: '⭐ Prefer', maybe: '👍 Option', no: '👎 Don’t like' };
export const EXTRA_ANSWERS = { yes: '⭐ Want it', maybe: '👍 Happy either way', no: '👎 Skip it' };
export const EXTRA_QUESTION = 'Would you do these?';

/** 'dates' | 'place' | 'extra' for a poll ({ kind, question, purpose }). */
export function answerKind(poll) {
  const q = String(poll?.question || '').trim();
  if (poll?.kind === 'dates') return 'dates';
  if (/^would you\b/i.test(q)) return 'extra';
  if (poll?.kind === 'location' || poll?.purpose === 'stay') return 'place';
  if (/\bweekends?\b|\bwhich dates?\b|^when\b|\bwhat dates?\b/i.test(q)) return 'dates';
  return 'place';
}
/** The three answer words for a poll: { yes, maybe, no }. */
export function answersFor(poll) {
  const k = answerKind(poll);
  return k === 'dates' ? ANSWERS : k === 'extra' ? EXTRA_ANSWERS : PLACE_ANSWERS;
}

export function cleanEmail(s) {
  return String(s || '').trim().toLowerCase();
}
/** Good enough to send to (the database checks the same shape). */
export function isEmail(s) {
  const e = cleanEmail(s);
  return e.length <= 254 && /^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$/i.test(e);
}
/** j…@gmail.com */
export function maskEmail(s) {
  const e = cleanEmail(s);
  const at = e.indexOf('@');
  return at > 0 ? `${e[0]}…${e.slice(at)}` : '';
}

/** Someone's choice: their own, else the group's, else the app. */
export function effectiveChoice(personal, groupDefault) {
  if (CHANNELS.includes(personal)) return personal;
  if (CHANNELS.includes(groupDefault)) return groupDefault;
  return 'app';
}

/** Where one person's votes go: { push, email }. */
export function routeFor({ onApp, personal, groupDefault, hasEmail }) {
  if (!onApp) return { push: false, email: !!hasEmail };
  const c = effectiveChoice(personal, groupDefault);
  const email = !!hasEmail && c !== 'app';
  return { push: c !== 'email' || !hasEmail, email };
}

/**
 * The address to use for a player, or null. Their own address only while they're still the one on the app for that
 * name (someone who left, or a freed name, doesn't keep getting emails); an organiser's "invited" address is used
 * until the person removes it.
 */
export function usableEmail(row, memberUserId) {
  if (!row || !row.email) return null;
  if (row.source === 'own') return memberUserId && row.user_id === memberUserId ? row.email : null;
  return row.email;
}

export function firstName(p) {
  return String((p && (p.nickname || p.name)) || 'there').trim().split(/\s+/)[0] || 'there';
}

/**
 * Who gets a vote how, for the given players (default: everyone approved), skipping `except` (the person who opened it).
 * players: [{ id, name, nickname, approved }]; members: [{ user_id, player_id }]; prefs: [{ user_id, vote_channel }];
 * emails: [{ player_id, user_id, email, source }].
 * Returns { push: [user ids], email: [{ player_id, user_id, email, first }], emailOnlyUsers: [user ids] }.
 * @param {{ players?: any[], members?: any[], prefs?: any[], groupDefault?: string, emails?: any[], only?: string[] | null, except?: string | null }} args
 */
export function planVoteSends({ players = [], members = [], prefs = [], groupDefault = 'app', emails = [], only = null, except = null }) {
  const memberOf = new Map(members.filter((m) => m.player_id).map((m) => [m.player_id, m.user_id]));
  const prefOf = new Map(prefs.map((p) => [p.user_id, p.vote_channel || null]));
  const emailOf = new Map(emails.map((e) => [e.player_id, e]));
  const want = only ? new Set(only) : null;
  const out = { push: [], email: [], emailOnlyUsers: [] };
  for (const p of players) {
    if (p.approved === false || (want && !want.has(p.id)) || (except && p.id === except)) continue;
    const user = memberOf.get(p.id) || null;
    const addr = usableEmail(emailOf.get(p.id), user);
    const r = routeFor({ onApp: !!user, personal: user ? prefOf.get(user) : null, groupDefault, hasEmail: !!addr });
    if (r.push && user) out.push.push(user);
    if (r.email) out.email.push({ player_id: p.id, user_id: user, email: addr, first: firstName(p) });
    if (user && !r.push) out.emailOnlyUsers.push(user);
  }
  return out;
}

/** Has this player answered every option of these polls? (Single-choice polls: any one option counts.) */
export function hasAnswered({ polls = [], options = [], votes = [], playerId }) {
  if (!polls.length) return true;
  return polls.every((poll) => {
    const opts = options.filter((o) => o.poll_id === poll.id);
    const mine = votes.filter((v) => v.poll_id === poll.id && v.player_id === playerId);
    if (!opts.length) return true;
    if (poll.choice === 'single') return mine.length > 0;
    return opts.every((o) => mine.some((v) => v.option_id === o.id));
  });
}

/** The reminder list: people on email who haven't answered and haven't had a reminder for this batch yet. */
export function reminderTargets({ emailPeople = [], polls = [], options = [], votes = [], reminded = [] }) {
  const done = new Set(reminded);
  return emailPeople.filter((p) => !done.has(p.player_id) && !hasAnswered({ polls, options, votes, playerId: p.player_id }));
}

/** "📧 3 people answered by email": people whose answer on this poll (or polls) came in by email. */
export function answeredByEmail(votes = [], pollIds = null) {
  const want = pollIds ? new Set([].concat(pollIds)) : null;
  return new Set(votes.filter((v) => v.via === 'email' && (!want || want.has(v.poll_id))).map((v) => v.player_id)).size;
}

/** The batch a poll belongs to: its combined vote card (077's vote_batch), or just itself. */
export function batchKeyOf(poll) {
  return String((poll && (poll.vote_batch || poll.id)) || '');
}

/** When a link stops working: the end of the last closing day (Sydney), or 45 days if a vote has no closing day. */
export function tokenExpiry(polls = [], now = Date.now()) {
  const days = polls.map((p) => p.closes_on).filter(Boolean).sort();
  if (days.length !== polls.length || !days.length) return new Date(now + 45 * 864e5).toISOString();
  return new Date(Date.parse(`${days[days.length - 1]}T23:59:59+10:00`)).toISOString();
}

/** A one-tap answer link. The token is the person's own; the rest says which answer. */
export function voteLink(app, token, params = {}) {
  const qs = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${app}#/v/${encodeURIComponent(token)}${qs ? `?${qs}` : ''}`;
}

/** Read an answer link back (the app's /v/:token page). */
export function parseVoteLink(token, search = '') {
  const q = new URLSearchParams(String(search).replace(/^\?/, ''));
  const r = q.get('r');
  const rsvp = q.get('rsvp');
  return {
    t: String(token || ''),
    o: q.get('o') || null,
    r: r && ANSWERS[r] ? r : null,
    rsvp: rsvp && RSVP_ANSWERS[rsvp] ? rsvp : null,
    stop: q.get('stop') === '1',
  };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const BTN = 'display:inline-block;margin:4px 6px 4px 0;padding:12px 16px;border-radius:10px;font:700 16px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;';
const COLOURS = { yes: '#0B2545', maybe: '#7A5A00', no: '#B3261E', in: '#0B2545', out: '#B3261E', pick: '#0B2545' };
const button = (href, label, tone) => `<a href="${escapeHtml(href)}" style="${BTN}background:${COLOURS[tone] || '#0B2545'};color:#ffffff;">${escapeHtml(label)}</a>`;

/**
 * The vote email. Only the trip's name, the questions and options, and the person's own first name — nothing else
 * about the group goes in it.
 * polls: [{ id, question, kind, choice, options: [{ id, label }] }]; rsvp: ask "are you keen?" too.
 */
export function buildVoteEmail({ app, token, first, planName, planId, polls = [], rsvp = false, reminder = false, closes = '' }) {
  const link = (p) => voteLink(app, token, p);
  const openApp = `${app}#/plan/${planId}?tab=vote`;
  const stop = link({ stop: 1 });
  const topic = polls.length === 1 ? polls[0].question : `${polls.length + (rsvp ? 1 : 0)} quick questions`;
  const subject = `${reminder ? '⏰ Reminder — ' : '🗳️ '}${planName}: ${polls.length ? topic : 'are you keen?'}`;
  const h = [];
  const t = [];
  h.push(`<div style="max-width:560px;margin:0 auto;padding:16px;font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1b1b;">`);
  h.push(`<p style="margin:0 0 4px;">Hi ${escapeHtml(first)},</p>`);
  const intro = reminder ? `The vote for <strong>${escapeHtml(planName)}</strong> closes soon and we haven’t got your answer yet.` : `Have your say on <strong>${escapeHtml(planName)}</strong>. Tap an answer — no app or sign-in needed.`;
  h.push(`<p style="margin:0 0 16px;">${intro}${closes ? ` Closes ${escapeHtml(closes)}.` : ''}</p>`);
  t.push(`Hi ${first},`, '', reminder ? `The vote for ${planName} closes soon and we haven't got your answer yet.` : `Have your say on ${planName}. Tap an answer — no app or sign-in needed.${closes ? ` Closes ${closes}.` : ''}`, '');
  for (const poll of polls) {
    h.push(`<h2 style="font-size:18px;margin:18px 0 6px;">${escapeHtml(poll.question)}</h2>`);
    t.push(poll.question);
    for (const o of poll.options || []) {
      if (poll.choice === 'single') {
        h.push(`<div>${button(link({ o: o.id, r: 'yes' }), o.label, 'pick')}</div>`);
        t.push(`  ${o.label}: ${link({ o: o.id, r: 'yes' })}`);
      } else {
        h.push(`<div style="margin:10px 0 2px;font-weight:700;">${escapeHtml(o.label)}</div><div>`);
        const words = answersFor(poll);
        h.push(['yes', 'maybe', 'no'].map((r) => button(link({ o: o.id, r }), words[r], r)).join(''));
        h.push('</div>');
        t.push(`  ${o.label}`);
        for (const r of ['yes', 'maybe', 'no']) t.push(`    ${words[r]}: ${link({ o: o.id, r })}`);
      }
    }
    t.push('');
  }
  if (rsvp) {
    h.push(`<h2 style="font-size:18px;margin:18px 0 6px;">Are you keen for ${escapeHtml(planName)}?</h2><div>`);
    h.push(['in', 'maybe', 'out'].map((s) => button(link({ rsvp: s }), RSVP_ANSWERS[s], s)).join(''));
    h.push('</div>');
    t.push(`Are you keen for ${planName}?`);
    for (const s of ['in', 'maybe', 'out']) t.push(`  ${RSVP_ANSWERS[s]}: ${link({ rsvp: s })}`);
    t.push('');
  }
  h.push(`<p style="margin:22px 0 6px;">Change your answer any time — tap another one, or <a href="${escapeHtml(openApp)}">open the vote in the app</a>.</p>`);
  h.push(`<p style="margin:16px 0 0;font-size:13px;color:#666;">These links are just for you, so please don’t forward this email. <a href="${escapeHtml(stop)}" style="color:#666;">Stop vote emails</a></p>`);
  h.push('</div>');
  t.push(`Change your answer any time, or open the vote in the app: ${openApp}`, '', `These links are just for you, so please don't forward this email. Stop vote emails: ${stop}`);
  return { subject, html: h.join('\n'), text: t.join('\n'), unsubscribe: stop };
}
