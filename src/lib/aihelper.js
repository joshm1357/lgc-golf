// The AI helper (21 Oct 2026): the small, pure bits the screens use (screens/AiHelper.jsx). The helper itself runs
// in the ai-helper edge function (supabase/functions/ai-helper), which does all the checking and the cap.

export const SETUP_EXAMPLE = 'Hunter Valley, Thu 22 to Sat 24 Oct. Kurri Thursday, Cypress Lakes Friday, The Vintage Saturday. Stableford all three, closest to pin on the par 3s.';
export const ASK_EXAMPLES = ['Who’s won the most trips?', 'Best Stableford round ever?', 'Who won our last trip?', 'How has my handicap changed?'];
export const MAX_TEXT = 600;

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

/**
 * What the function said, as one thing for the screen to show:
 *   plan    — a setup plan to confirm ({ plan, summary, warnings, notes })
 *   message — the helper needs to ask something back
 *   answer  — a history answer
 *   done    — "Do it" worked ({ tripId, made })
 *   error   — friendly words (off: the feature is switched off; capped: the limit's reached)
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
  if (d.error) return { kind: 'error', text: String(d.error), off: !!d.off, capped: !!d.capped, remaining };
  if (d.done) return { kind: 'done', tripId: d.trip_id || null, made: Array.isArray(d.made) ? d.made : [], remaining };
  if (d.plan && Array.isArray(d.summary)) {
    return { kind: 'plan', plan: d.plan, summary: d.summary, warnings: d.plan.warnings || [], notes: d.plan.notes || '', remaining };
  }
  if (typeof d.message === 'string' && d.message) return { kind: 'message', text: d.message, remaining };
  if (typeof d.answer === 'string' && d.answer) return { kind: 'answer', text: d.answer, remaining };
  return { kind: 'error', text: 'The helper didn’t have an answer — try asking another way.', remaining };
}
