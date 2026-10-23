// ov34 (migration 103): "Who's up for a hit?" — the call-out buzzes. The database writes every one of them into
// notify_queue (kinds below, words and who-gets-what decided there): put out → the people asked; locked in → "You're in"
// / "You're reserve #1" / "Didn't get a spot this time"; a pull-out → the reserve moved up and whoever put it out;
// replies closed → "lock it in"; the evening before → everyone with a spot. This picks who gets one NOW. Pure — tested
// in callout.test.ts.

export const CALLOUT_KINDS = ['callout_new', 'callout_in', 'callout_reserve', 'callout_full', 'callout_locked', 'callout_booker',
  'callout_promoted', 'callout_pullout', 'callout_lockit', 'callout_tomorrow', 'callout_off'];
/** Still sent to people on "only important": where you stand, a job for you, and the day before. */
export const CALLOUT_IMPORTANT = ['callout_in', 'callout_reserve', 'callout_promoted', 'callout_pullout', 'callout_lockit', 'callout_tomorrow',
  'callout_booker', 'callout_off'];
/** Older than this, the round screen has it — not worth a buzz. */
export const STALE_MS = 24 * 3600000;

export type QueueRow = { id: string; group_id: string; user_id: string; kind: string; title: string; body?: string | null; url?: string | null; created_at: string };
export type Pref = { group_id: string; user_id: string; mode: string };
export type Send = { group_id: string; user_id: string; ids: string[]; msg: { title: string; body: string; url: string; tag: string } };

/** '#/plan/…' (written by the database, which doesn't know the app's address) → a full link. */
export function absUrl(url: string | null | undefined, app: string) {
  if (!url) return app;
  if (url.startsWith('#')) return `${app}${url}`;
  return url;
}

/**
 * From the waiting call-out buzzes, who gets what now. Each is personal ("You're reserve #1"), so each goes on its
 * own — except several for one person about the same round, which become one ("⛳ 3 updates: …"). People on
 * "straight away" (the default) get everything; "only important" people get the important kinds; daily-digest people
 * are left for their digest hour (the hourly send). Stale ones are just marked sent.
 * Returns { send, done } — done: every row id to mark sent (sent now, or stale).
 */
export function calloutSends(rows: QueueRow[], prefs: Pref[], app: string, now = Date.now()): { send: Send[]; done: string[] } {
  const mode = new Map(prefs.map((p) => [`${p.group_id}|${p.user_id}`, p.mode]));
  const by = new Map<string, QueueRow[]>();
  const done: string[] = [];
  for (const r of rows) {
    if (!CALLOUT_KINDS.includes(r.kind)) continue;
    if (now - new Date(r.created_at).getTime() > STALE_MS) { done.push(r.id); continue; }
    const m = mode.get(`${r.group_id}|${r.user_id}`) || 'instant';
    if (m === 'digest') continue;
    if (m === 'important' && !CALLOUT_IMPORTANT.includes(r.kind)) continue;
    const k = `${r.group_id}|${r.user_id}|${r.url || ''}`;
    by.set(k, [...(by.get(k) || []), r]);
  }
  const send: Send[] = [];
  for (const [k, list] of by) {
    const [group_id, user_id, url] = k.split('|');
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = list[list.length - 1];
    const msg = list.length === 1
      ? { title: last.title, body: last.body || 'Open the app to see who’s in.', url: absUrl(url, app), tag: `callout-${url || group_id}` }
      : { title: `⛳ ${list.length} updates: ${last.title}`.slice(0, 160), body: list.slice(0, -1).map((r) => r.title).join(' · ').slice(0, 300), url: absUrl(url, app), tag: `callout-${url || group_id}` };
    send.push({ group_id, user_id, ids: list.map((r) => r.id), msg });
    done.push(...list.map((r) => r.id));
  }
  return { send, done };
}
