// The AI helper (21 Oct 2026; v2 the same night): the small, pure bits the screens use (screens/AiHelper.jsx,
// screens/AiPlanner.jsx, components/AskChip.jsx). The helper itself runs in the ai-helper edge function
// (supabase/functions/ai-helper), which does all the checking and the cap.

export const SETUP_EXAMPLE = 'Hunter Valley, Thu 22 to Sat 24 Oct. Kurri Thursday, Cypress Lakes Friday, The Vintage Saturday. Stableford all three, closest to pin on the par 3s.';
export const PLAN_EXAMPLE = 'Weekend away in March, 12 of us, somewhere within 3 hours of Sydney, about $500 each.';
export const ASK_EXAMPLES = ['Who’s won the most trips?', 'Best Stableford round ever?', 'Who won our last trip?', 'How has my handicap changed?'];
export const MAX_TEXT = 600;

/** Example questions for the Ask screen, by where it was opened from (?about=round | trips | anything else). */
export function askExamples(about) {
  if (about === 'round') return ['Who’s leading?', 'What do I need on the last 3 holes?', 'Who’s got the best chance to win?', 'How’s everyone going today?'];
  if (about === 'trips') return ['What’s on this trip?', 'Who won our last trip?', 'Who’s won the most trips?', 'Where have we been?'];
  return ['What’s on today?', ...ASK_EXAMPLES];
}

/** The Ask screen's heading, by where it was opened from. */
export function askTitle(about) {
  if (about === 'round') return { title: 'Ask about this round', sub: 'Who’s leading, what anyone needs to win' };
  if (about === 'trips') return { title: 'Ask about our trips', sub: 'What’s on, who won, where you’ve been' };
  return { title: 'Ask', sub: 'What’s on, trips, winners, records and handicaps' };
}

/** Is there enough to send (and not too much)? */
export function canSend(text) {
  const t = String(text || '').trim();
  return t.length >= 3 && t.length <= MAX_TEXT;
}

/** "57 questions left this month for the group · 9 for you today" — from the function's `remaining`. */
export function remainingLabel(r) {
  if (!r || typeof r.month !== 'number') return '';
  const month = `${r.month} question${r.month === 1 ? '' : 's'} left this month for the group`;
  return typeof r.today === 'number' ? `${month} · ${r.today} for you today` : month;
}

/** 👍 / 👎: tapping the one already chosen clears it (0); otherwise it's the new rating. */
export function nextRating(current, tapped) {
  return current === tapped ? 0 : tapped;
}

/**
 * What the function said, as one thing for the screen to show:
 *   plan     — a setup plan to confirm ({ plan, summary, warnings, notes })
 *   tripplan — a trip plan (Plan it with AI) to confirm ({ plan, summary, warnings, notes })
 *   message  — the helper needs to ask something back
 *   answer   — an answer to a question
 *   done     — "Do it" / "Create it" worked ({ tripId | planId, made })
 *   error    — friendly words (off: the feature is switched off; capped: the limit's reached)
 * `logId` (when the function sends one) is what 👍 / 👎 rates.
 * `error` is the error from supabase.functions.invoke (no signal, sign-in problem…).
 */
export function readReply(data, error) {
  if (error) {
    const name = String(error.name || '');
    if (/FetchError|Relay/i.test(name) || /Failed to fetch|NetworkError|network/i.test(String(error.message || ''))) {
      return { kind: 'error', text: 'No signal — try again in a moment.' };
    }
    return { kind: 'error', text: 'Couldn’t reach the helper just now — try again in a minute.' };
  }
  const d = data && typeof data === 'object' ? data : {};
  const remaining = d.remaining || null;
  const log = d.log_id != null ? { logId: d.log_id } : {};
  if (d.error) return { kind: 'error', text: String(d.error), off: !!d.off, capped: !!d.capped, remaining, ...(d.code ? { code: String(d.code) } : {}), ...log };
  if (d.done) {
    return d.plan_id
      ? { kind: 'done', planId: d.plan_id, made: Array.isArray(d.made) ? d.made : [], remaining }
      : { kind: 'done', tripId: d.trip_id || null, made: Array.isArray(d.made) ? d.made : [], remaining };
  }
  if (d.plan && Array.isArray(d.summary)) {
    return { kind: 'plan', plan: d.plan, summary: d.summary, warnings: d.plan.warnings || [], notes: d.plan.notes || '', remaining, ...log };
  }
  if (d.trip_plan && Array.isArray(d.summary)) {
    return { kind: 'tripplan', plan: d.trip_plan, summary: d.summary, warnings: d.trip_plan.warnings || [], notes: d.trip_plan.notes || '', remaining, ...log };
  }
  if (typeof d.message === 'string' && d.message) return { kind: 'message', text: d.message, remaining, ...log };
  // The Caddie (22 Oct): an answer can come with a place to go (go_to) — { key, label, round?, trip?, plan?, tab? }.
  const go = d.go && typeof d.go === 'object' && typeof d.go.key === 'string' ? { go: d.go } : {};
  if (typeof d.answer === 'string' && d.answer) return { kind: 'answer', text: d.answer, remaining, ...log, ...go };
  return { kind: 'error', text: 'The helper didn’t have an answer — try asking another way.', remaining };
}

// ------------------------------------------------------------------ One automatic retry

/** The failures worth one more go by themselves (the AI company busy, an odd reply, too slow). Failed answers
 *  don't use up a question, so the retry is free. Never for "Do it" / "Create it" (they write). */
export const RETRY_CODES = ['provider_busy', 'odd_reply', 'timeout'];
export const shouldRetry = (r, body) => r?.kind === 'error' && RETRY_CODES.includes(r.code) && !/apply$/.test(String(body?.mode || ''));

/** Call once, and once more if it's worth it. `call` returns what readReply / readImportReply made. */
export async function withRetry(call, body) {
  const first = await call();
  if (!shouldRetry(first, body)) return first;
  const second = await call();
  return second;
}

// ------------------------------------------------------------------ The Ask conversation, kept for the session

export const ASK_PREFIX = 'tgt-ask:';
export const ASK_KEEP = 20;
const store = (s) => {
  try { return s || (typeof sessionStorage !== 'undefined' ? sessionStorage : null); } catch { return null; }
};

/** The Ask conversation for this group (newest first), from this tab's session; [] if none or unreadable. */
export function loadAsk(groupId, s) {
  const st = store(s);
  if (!st || !groupId) return [];
  try {
    const list = JSON.parse(st.getItem(ASK_PREFIX + groupId) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.q === 'string' && x.reply && typeof x.reply.text === 'string').slice(0, ASK_KEEP) : [];
  } catch { return []; }
}

/** Keep the last 20 questions and answers for this group (only what's shown: words, kind, rating id). */
export function saveAsk(groupId, thread, s) {
  const st = store(s);
  if (!st || !groupId) return;
  const slim = (thread || []).slice(0, ASK_KEEP).map(({ q, reply }) => ({ q, reply: { kind: reply.kind, text: reply.text, ...(reply.logId != null ? { logId: reply.logId } : {}) } }));
  try { st.setItem(ASK_PREFIX + groupId, JSON.stringify(slim)); } catch { /* full or blocked: it just isn't kept */ }
}

/** Forget every group's Ask conversation (signing out, or switching group). */
export function clearAsk(s) {
  const st = store(s);
  if (!st) return;
  try {
    const keys = [];
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith(ASK_PREFIX)) keys.push(k); }
    keys.forEach((k) => st.removeItem(k));
  } catch { /* fine */ }
}
