// Votes by email (079) for the app. The rules live in one shared file that the server functions use too, so the app
// and the emails always agree.
export {
  CHANNELS, CHANNEL_LABEL, CHANNEL_HELP, VOTE_KINDS, ANSWERS, RSVP_ANSWERS,
  cleanEmail, isEmail, maskEmail, effectiveChoice, routeFor, usableEmail, firstName, planVoteSends,
  hasAnswered, reminderTargets, answeredByEmail, batchKeyOf, tokenExpiry, voteLink, parseVoteLink, escapeHtml, buildVoteEmail,
} from '../../supabase/functions/_shared/emailvotes.js';
import { CHANNEL_LABEL } from '../../supabase/functions/_shared/emailvotes.js';

/** "3 people answered by email" / "1 person …" / '' for none. */
export function emailAnswerLine(n) {
  if (!n) return '';
  return `📧 ${n} ${n === 1 ? 'person' : 'people'} answered by email`;
}

/**
 * For organisers: who gets votes how, from vote_channels() rows. Returns { email: [player ids], app: [...], both: [...],
 * none: [...] } — "none" = not on the app and no email, so they only hear about votes from the group chat.
 */
export function channelSummary(rows = []) {
  const out = { email: [], app: [], both: [], none: [] };
  for (const r of rows) {
    if (!r.on_app) { (r.has_email ? out.email : out.none).push(r.player_id); continue; }
    const c = CHANNEL_LABEL[r.choice] ? r.choice : 'app';
    if (c !== 'app' && r.has_email) out[c].push(r.player_id);
    else out.app.push(r.player_id);
  }
  return out;
}

/** The words for an answer the page just recorded. */
export function recordedLine(name, rec) {
  if (!rec) return '';
  const who = name && name !== 'there' ? `Thanks ${name}` : 'Thanks';
  if (rec.kind === 'rsvp') return `${who} — you’re ${rec.response === 'in' ? 'keen' : rec.response === 'out' ? 'out' : 'a maybe'}.`;
  const mark = { yes: '✓', maybe: '?', no: '✗' }[rec.response] || '';
  return `${who} — you’re a ${mark} for ${rec.label}.`;
}
