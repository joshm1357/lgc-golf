// The run-up to a trip (ov23): what's up for grabs, the rules, the handicaps check. Pure functions, tested
// (runup.test.js); the screen is components/RunUp.jsx (Organise → Comps & on the day).
import { tripComps, COMP_TYPE } from './comps.js';

/**
 * The trip's comps and trophies, for "What's up for grabs" (tick which are on). The Cup only when the group uses it.
 * → [{ id, name, kind, retired, virtual, what }]
 */
export function upForGrabs({ comps = [], trophies = [], tripId, cupOn = false }) {
  // tripComps leaves retired comps out — here they show unticked, so the organiser can tick them back on.
  const live = tripComps({ comps, trophies, tripId });
  const retired = (comps || []).filter((c) => c.trip_id === tripId && c.retired);
  return [...live, ...retired]
    .filter((c) => cupOn || c.kind !== 'cup')
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, retired: !!c.retired, virtual: !!c.virtual, what: COMP_TYPE[c.kind]?.name || 'Trophy' }));
}

/** Before the trip's in the app: the trophy names from the group's most recent trip that had any. */
export function usualComps({ trips = [], trophies = [], cupOn = false }) {
  const sorted = [...(trips || [])].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
  for (const t of sorted) {
    const names = (trophies || []).filter((x) => x.trip_id === t.id && (cupOn || !/\bcup\b/i.test(x.name || ''))).map((x) => x.name);
    if (names.length) return [...new Set(names)];
  }
  return [];
}

const fmt = (h) => (h == null || h === '' ? '—' : Number(h).toFixed(1).replace(/\.0$/, ''));

/**
 * Everyone's handicap for the check: the people who said they're in (else every approved player, no guests),
 * with the last change ("Was 14 → 12.5 on 3 Oct · Tribunal") and whether a dispute about it is open.
 * history: handicap_history rows (newest first or not); cases: open cases with subject_ref.
 * → [{ id, name, handicap, text, lastChange, dispute }] by name
 */
export function handicapRows({ players = [], inIds = [], history = [], cases = [] }) {
  const ins = new Set(inIds);
  const who = (players || []).filter((p) => p.approved !== false && p.role !== 'guest' && (!ins.size || ins.has(p.id)));
  return who.map((p) => {
    const mine = (history || []).filter((h) => h.player_id === p.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const last = mine.find((h) => h.old_handicap != null) || null;
    const when = last ? new Date(last.created_at) : null;
    const lastChange = last ? `Was ${fmt(last.old_handicap)} → ${fmt(last.new_handicap)}${when && !Number.isNaN(when) ? ` on ${when.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][when.getMonth()]}` : ''}${last.reason ? ` · ${last.reason}` : ''}` : 'No changes yet';
    const dispute = (cases || []).some((c) => c.status === 'open' && c.subject_ref?.table === 'players' && c.subject_ref?.id === p.id && c.subject_ref?.field === 'handicap');
    return { id: p.id, name: p.nickname || p.name, handicap: p.handicap == null ? null : Number(p.handicap), text: fmt(p.handicap), lastChange, dispute };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Open cases about the rules (a rule challenge, or a dispute on a rule). */
export function ruleDisputes(cases = []) {
  return (cases || []).filter((c) => c.status === 'open' && (c.rule_id || c.subject_ref?.table === 'rules'));
}

/**
 * Should organisers be prompted to review the handicaps? Any time before the first round, until someone marks them
 * reviewed (a review more than `staleDays` before the first round doesn't count — they've likely moved since).
 */
export function reviewDue({ firstRound = null, today, reviewed = null, staleDays = 30 } = {}) {
  if (!firstRound || !today) return false;
  if (String(firstRound).slice(0, 10) < String(today).slice(0, 10)) return false;
  if (!reviewed?.at) return true;
  const first = new Date(`${String(firstRound).slice(0, 10)}T00:00:00Z`).getTime();
  return first - new Date(reviewed.at).getTime() > staleDays * 86400000;
}
