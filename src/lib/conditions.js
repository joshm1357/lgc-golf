// Side comp conditions (migration 073, feature 'side_comps'): the standard options of a measured comp — longest drive
// "fairway only · first shot", closest to the pin "on the green only · tee shot only" — plus a short note of the
// group's own. They're options of the comp, not a different comp. Stored as { picks: [key…], note } in
// side_comp_defs.conditions (the group's own / library comps) or side_comp_conditions (closest to the pin and longest
// drive, which aren't side_comp_defs rows). The database checks the same keys. Pure functions, no screen code.

export const CONDITIONS = {
  fairway: { label: 'Must finish on the fairway', short: 'fairway only' },
  first_shot: { label: 'First shot on the hole only', short: 'first shot' },
  tee_shot: { label: 'Must be the tee shot', short: 'tee shot only' },
  green_only: { label: 'Must finish on the green', short: 'on the green only' },
  one_go: { label: 'One go each', short: 'one go each' },
  no_mulligans: { label: 'No mulligans', short: 'no mulligans' },
  make_par: { label: 'Must make par on the hole to win', short: 'must make par' },
  driver_only: { label: 'Driver only', short: 'driver only' },
  holed: { label: 'Must be holed', short: 'must be holed' },
  first_putt: { label: 'First putt only', short: 'first putt only' },
  paces: { label: 'Measured in paces', short: 'measured in paces' },
};
export const CONDITION_KEYS = Object.keys(CONDITIONS);
export const MAX_PICKS = 6;
export const NOTE_MAX = 140;

const LISTS = {
  drive: ['fairway', 'first_shot', 'one_go', 'driver_only', 'no_mulligans'],
  pin: ['green_only', 'first_shot', 'tee_shot', 'one_go', 'make_par', 'no_mulligans'],
  putt: ['holed', 'first_putt', 'paces', 'one_go'],
  other: ['first_shot', 'one_go', 'no_mulligans'],
};

/** What sort of measured comp it is: 'drive' | 'pin' | 'putt' | 'other'. comp: 'ctp' | 'ld' | a side_comp_defs row. */
export function compSort(comp) {
  if (comp === 'ld') return 'drive';
  if (comp === 'ctp') return 'pin';
  const preset = comp?.preset || '';
  const name = String(comp?.name || '').toLowerCase();
  if (['ld_fairway', 'closest_line'].includes(preset) || /drive|line/.test(name)) return 'drive';
  if (['longest_putt', 'longest_holeout'].includes(preset) || /putt|hole-?out/.test(name)) return 'putt';
  if (/^ntp|closest_chip|bunker_ntp/.test(preset) || /pin|chip|closest|nearest/.test(name)) return 'pin';
  return 'other';
}

/** Can this comp have conditions? Not the dots or the comps worked out from the scores (nothing is measured). */
export const takesConditions = (comp) => comp === 'ctp' || comp === 'ld' || (comp && !comp.scoring);

/** The conditions offered for a comp, as [{ key, label, short }]. */
export function conditionsFor(comp) {
  return LISTS[compSort(comp)].map((key) => ({ key, ...CONDITIONS[key] }));
}

/** Tidy conditions: known keys only (no repeats, in the list's order), a trimmed note. Empty = null. */
export function cleanConditions(c) {
  if (!c || typeof c !== 'object') return null;
  const picks = CONDITION_KEYS.filter((k) => Array.isArray(c.picks) && c.picks.includes(k)).slice(0, MAX_PICKS);
  const note = String(c.note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  if (!picks.length && !note) return null;
  return { picks, ...(note ? { note } : {}) };
}

/** Problems with conditions (mirrors the database check). [] = fine. */
export function conditionsProblems(c) {
  if (c == null) return [];
  if (typeof c !== 'object' || Array.isArray(c)) return ['Conditions must be a set of picks and a note'];
  const out = [];
  for (const k of Object.keys(c)) if (k !== 'picks' && k !== 'note') out.push(`${k} isn’t part of a comp’s conditions`);
  if (c.picks != null) {
    if (!Array.isArray(c.picks)) out.push('Picks must be a list');
    else {
      if (c.picks.length > MAX_PICKS) out.push(`Up to ${MAX_PICKS} conditions`);
      for (const k of c.picks) if (!CONDITION_KEYS.includes(k)) out.push(`${k} isn’t one of the conditions`);
    }
  }
  if (c.note != null && (typeof c.note !== 'string' || c.note.length > NOTE_MAX)) out.push(`The note is up to ${NOTE_MAX} letters`);
  return out;
}

/** "Fairway only · first shot · drop zone counts" — conditions in a line ('' if none). */
export function conditionsLine(c) {
  const clean = cleanConditions(c);
  if (!clean) return '';
  const parts = [...clean.picks.map((k) => CONDITIONS[k].short), ...(clean.note ? [clean.note] : [])];
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
