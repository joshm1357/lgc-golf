// "Was that helpful? 👍 👎" under every AI answer (components/AnswerFeedback.jsx, migration 075). After 👎 people
// can say why with one tap (a reason chip) and, if they like, a short note. The note goes to Josh's Wishes screen
// only — it's never sent to the AI. The database cleans it again (helper_feedback).

export const REASONS = [
  { key: 'wrong', label: 'Wrong' },
  { key: 'no_answer', label: 'Didn’t answer' },
  { key: 'slow', label: 'Too slow' },
  { key: 'long', label: 'Too long' },
  { key: 'not_useful', label: 'Not useful' },
  { key: 'other', label: 'Other' },
];
export const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.key, r.label]));
export const reasonLabel = (k) => REASON_LABEL[k] || String(k || 'Other');
export const isReason = (k) => Object.prototype.hasOwnProperty.call(REASON_LABEL, k);
export const MAX_NOTE = 200;

/** A note made safe and short: one line, no control characters or angle brackets, at most 200 characters.
 *  Empty → null (nothing sent). */
export function cleanNote(s) {
  const t = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE)
    .trim();
  return t || null;
}
