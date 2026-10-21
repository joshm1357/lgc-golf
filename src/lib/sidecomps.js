// A group's own side comps (migration 051). Closest to pin and longest drive stay in Comps.jsx as before.
// def: { id, name, emoji, how: 'lowest'|'highest'|'pick', unit }. Round: own_comps [{ comp, holes: [n] }] (empty = whole round).

export const HOW = [
  { value: 'lowest', label: 'Smallest number wins', hint: 'e.g. metres from the pin' },
  { value: 'highest', label: 'Biggest number wins', hint: 'e.g. longest putt holed' },
  { value: 'pick', label: 'Organiser picks', hint: 'e.g. best shot of the day — no number' },
];

/** The group's comps that this round has, with their holes, in the round's order. */
export function compsForRound(round, defs) {
  const byId = Object.fromEntries((defs || []).map((d) => [d.id, d]));
  return (round?.own_comps || []).map((c) => (byId[c.comp] ? { ...byId[c.comp], holes: (c.holes || []).map(Number) } : null)).filter(Boolean);
}

/** Entries best first: a confirmed winner always leads; then by the number (or newest first for 'pick'). */
export function sortOwnEntries(how, list) {
  return [...(list || [])].sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
    if (how === 'pick') return String(b.created_at).localeCompare(String(a.created_at));
    const av = a.value == null ? null : Number(a.value);
    const bv = b.value == null ? null : Number(b.value);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return how === 'highest' ? bv - av : av - bv;
  });
}

/** Does a new number beat the current leader? (Never for 'pick'.) */
export function beats(how, value, leader) {
  if (how === 'pick' || value == null || Number.isNaN(Number(value))) return false;
  if (!leader || leader.value == null) return true;
  return how === 'highest' ? Number(value) > Number(leader.value) : Number(value) < Number(leader.value);
}

/** "3 7 12" → [3, 7, 12] (1–18, no repeats, in order). */
export function parseHoles(text) {
  return [...new Set(String(text || '').split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 18))].sort((a, b) => a - b);
}
