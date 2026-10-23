// ov31 (migration 100): automatic awards' buzzes — "Proposed: Latest out last night: Hamish 2:47am 📷 …", "✅ Confirmed
// — Latest out: Hamish", and "⚖️ Dispute upheld — pick another claim" (to organisers). The database's 5-minute job
// queues them in notify_queue (words written by the server) and calls notify with the cron secret; this picks who
// gets one now. Pure — tested in autoawards.test.ts.

export const AUTO_AWARD_KINDS = ['award_proposed', 'award_confirmed', 'award_overturned'];
/** Still sent to people on "only important": you won it, or (organisers) you need to pick again. */
export const AUTO_AWARD_IMPORTANT = ['award_confirmed', 'award_overturned'];
/** Older than this, the Feed has it — not worth a buzz. */
export const STALE_MS = 12 * 3600000;

export type QueueRow = { id: string; group_id: string; user_id: string; kind: string; title: string; body?: string | null; created_at: string };
export type Pref = { group_id: string; user_id: string; mode: string };
export type Send = { group_id: string; user_id: string; ids: string[]; msg: { title: string; body: string; tag: string } };

/**
 * From the waiting award buzzes, who gets what now. One message per person per group (several → "🏅 3 award
 * updates"). People on "straight away" (the default) get everything; "only important" people get the important
 * kinds; daily-digest people are left for their digest hour (the hourly send). Stale ones are just marked sent.
 * Returns { send, done } — done: every row id to mark sent (sent now, or stale).
 */
export function autoAwardSends(rows: QueueRow[], prefs: Pref[], now = Date.now()): { send: Send[]; done: string[] } {
  const mode = new Map(prefs.map((p) => [`${p.group_id}|${p.user_id}`, p.mode]));
  const by = new Map<string, QueueRow[]>();
  const done: string[] = [];
  for (const r of rows) {
    if (!AUTO_AWARD_KINDS.includes(r.kind)) continue;
    if (now - new Date(r.created_at).getTime() > STALE_MS) { done.push(r.id); continue; }
    const m = mode.get(`${r.group_id}|${r.user_id}`) || 'instant';
    if (m === 'digest') continue;
    if (m === 'important' && !AUTO_AWARD_IMPORTANT.includes(r.kind)) continue;
    const k = `${r.group_id}|${r.user_id}`;
    by.set(k, [...(by.get(k) || []), r]);
  }
  const send: Send[] = [];
  for (const [k, list] of by) {
    const [group_id, user_id] = k.split('|');
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const msg = list.length === 1
      ? { title: list[0].title, body: list[0].body || 'Open the Feed to confirm or dispute.', tag: `awards-${group_id}` }
      : { title: `🏅 ${list.length} award updates`, body: list.map((r) => r.title).join(' · ').slice(0, 300), tag: `awards-${group_id}` };
    send.push({ group_id, user_id, ids: list.map((r) => r.id), msg });
    done.push(...list.map((r) => r.id));
  }
  return { send, done };
}
