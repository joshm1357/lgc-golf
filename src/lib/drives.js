// Ambrose minimum drives, and penalties for breaking a rule (migration 099) — pure functions, no database or screen code.
//
// Plain words:
//   - Every group has a standard Rulebook rule, "Ambrose minimum drives" (rules.system_key = 'ambrose_drives'): each
//     player's drive must be used N times in the round; each drive short costs the team P strokes.
//   - N depends on the team size, for an 18-hole round: 6 in a three, 4 in a four, 6 in a pair (rules.drives_3 /
//     drives_4 / drives_2). Five or more share the four's total (4 × 4 = 16 ÷ 5 = 3 each). 9 holes: half, rounded
//     down. Never more than a fair share of the holes (18 ÷ 4 = 4 each at most).
//   - For one round the organiser can set N (rounds.min_drives) and P (rounds.drive_penalty).
//   - Whose drive is saved per hole with the score (scores.tee_shot_player). The server adds the strokes when the
//     round is locked (private.apply_drive_penalties); while it's live, these functions show what's coming.
//   - A team that records no drives at all isn't tracked: no warning, no penalty.
// The same maths is in the database (private.drives_needed / drive_shortfalls) — keep them the same.

export const DRIVES_KEY = 'ambrose_drives';
export const DRIVE_DEFAULTS = { 2: 6, 3: 6, 4: 4, strokes: 2 };

const int = (x, d) => (x == null || x === '' || !Number.isFinite(Number(x)) ? d : Math.trunc(Number(x)));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "+2", "−1", "0". */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** The group's drives rule from its rules → { rule, n2, n3, n4, strokes, on } (on = in force), or null. */
export function drivesRule(rules = []) {
  const rule = (rules || []).find((r) => r?.system_key === DRIVES_KEY);
  if (!rule) return null;
  return {
    rule,
    n2: int(rule.drives_2, DRIVE_DEFAULTS[2]),
    n3: int(rule.drives_3, DRIVE_DEFAULTS[3]),
    n4: int(rule.drives_4, DRIVE_DEFAULTS[4]),
    strokes: int(rule.breach_strokes, DRIVE_DEFAULTS.strokes),
    on: rule.status === 'active',
  };
}

/** N for an 18-hole round by team size, from the rule (or the defaults). */
export function baseDrives(dr, size) {
  const n2 = dr?.n2 ?? DRIVE_DEFAULTS[2];
  const n3 = dr?.n3 ?? DRIVE_DEFAULTS[3];
  const n4 = dr?.n4 ?? DRIVE_DEFAULTS[4];
  if (!size || size < 2) return 0;
  if (size === 2) return n2;
  if (size === 3) return n3;
  if (size === 4) return n4;
  return Math.floor((n4 * 4) / size);
}

/**
 * Drives each player needs in this round. dr: drivesRule(...) (null = no rule); round: { min_drives }; teamSize;
 * holes: how many holes the round has. The round's own N wins when set. 0 = nothing to track.
 */
export function minDrivesFor({ dr, round, teamSize, holes = 18 }) {
  const size = int(teamSize, 0);
  const h = int(holes, 0);
  if (size < 1 || h < 1) return 0; // a one-player "team" only counts a round's own N (as before 099)
  const cap = Math.floor(h / size);
  if (round?.min_drives != null && round.min_drives !== '') return Math.max(0, Math.min(int(round.min_drives, 0), cap));
  if (!dr?.on) return 0;
  return Math.max(0, Math.min(Math.floor((baseDrives(dr, size) * h) / 18), cap));
}

/** Strokes per drive short in this round: the round's own, else the rule's. 0 = no penalty (still tracked). */
export function drivePenaltyFor({ dr, round }) {
  if (round?.drive_penalty != null && round.drive_penalty !== '') return Math.max(0, int(round.drive_penalty, 0));
  return dr?.on ? dr.strokes : 0;
}

/** The defaults table to show: [{ size, label, n18, n9 }] for pairs to fives. */
export function drivesTable(dr) {
  const d = dr ? { ...dr, on: true } : { n2: DRIVE_DEFAULTS[2], n3: DRIVE_DEFAULTS[3], n4: DRIVE_DEFAULTS[4], on: true };
  return [2, 3, 4, 5].map((size) => ({
    size,
    label: { 2: 'Pair', 3: 'Three', 4: 'Four', 5: 'Five' }[size],
    n18: minDrivesFor({ dr: d, round: null, teamSize: size, holes: 18 }),
    n9: minDrivesFor({ dr: d, round: null, teamSize: size, holes: 9 }),
  }));
}

/**
 * Where a team is with its drives.
 *   players: [{ id, name }]; holes: [{ n }]; scores: { [holeN]: { tee_shot_player, strokes, picked_up } } (the team's);
 *   need: N; per: P; current: the hole being entered (its pick, if any, counts) — { n, pick } or null.
 * Returns {
 *   need, per, tracked (any drive recorded), open (holes still to come that can take a drive),
 *   rows: [{ id, name, used, short, coming }]  — coming = drives short that can't be made up now,
 *   coming (total strokes certain so far), squeeze (the team can't fit everyone's drives in the holes left),
 *   needsOne: [ids] (should take this tee), warnings: [words], line: "Drives: Al 3/6 · Bo 5/6"
 * }
 */
export function driveStatus({ players = [], holes = [], scores = {}, need = 0, per = 0, current = null }) {
  const ps = (players || []).filter(Boolean);
  const used = Object.fromEntries(ps.map((p) => [p.id, 0]));
  let recorded = 0;
  let open = 0;
  for (const h of holes) {
    const isCur = current && h.n === current.n;
    const who = isCur && current.pick !== undefined ? current.pick : scores[h.n]?.tee_shot_player;
    if (who && who in used) { used[who] += 1; recorded += 1; } else if (!scores[h.n] || isCur) open += 1;
  }
  const rows = ps.map((p) => {
    const short = Math.max(0, need - used[p.id]);
    return { id: p.id, name: p.name, used: used[p.id], short, coming: Math.max(0, short - open) };
  });
  const totalShort = rows.reduce((s, r) => s + r.short, 0);
  const sureShort = Math.max(rows.reduce((s, r) => s + r.coming, 0), totalShort - open);
  const tracked = recorded > 0;
  const squeeze = need > 0 && tracked && totalShort > open;
  const tight = need > 0 && totalShort > 0 && totalShort >= open;
  const needsOne = need > 0 && open > 0 && tight ? rows.filter((r) => r.short > 0).sort((a, b) => b.short - a.short).map((r) => r.id) : [];
  const warnings = [];
  if (need > 0 && tracked) {
    for (const r of rows.filter((x) => x.coming > 0)) {
      warnings.push(open === 0
        ? `${r.name} had ${r.used} of ${need}: ${signed(r.coming * per)} stroke${r.coming * per === 1 ? '' : 's'}`
        : `${r.name} needs ${r.short} more in ${plural(open, 'hole')}: ${signed(r.coming * per)} stroke${r.coming * per === 1 ? '' : 's'} coming`);
    }
    if (!warnings.length && squeeze) {
      warnings.push(`${rows.filter((r) => r.short).map((r) => `${r.name} needs ${r.short}`).join(', ')} — only ${plural(open, 'hole')} left: at least ${signed(sureShort * per)} coming`);
    }
  }
  return {
    need, per, tracked, open, rows, squeeze, needsOne, warnings,
    coming: sureShort * per,
    line: need > 0 ? `Drives: ${rows.map((r) => `${r.name} ${r.used}/${need}`).join(' · ')}` : '',
  };
}

/**
 * Drives penalties still to come on a live Ambrose round, as adjustment-like rows for the board (projected: true —
 * shown, not counted). teams: [{ id, players }]; scoresIdx: { [teamId]: { [holeN]: row } }.
 */
export function projectedDrivePenalties({ round, teams = [], holes = [], scoresIdx = {}, dr, nameOf = (p) => p?.name }) {
  if (!round || round.format !== 'ambrose' || round.status !== 'live') return [];
  const per = drivePenaltyFor({ dr, round });
  if (!per) return [];
  const out = [];
  for (const t of teams) {
    const players = (t.players || []).filter(Boolean).map((p) => ({ id: p.id, name: nameOf(p) }));
    const need = minDrivesFor({ dr, round, teamSize: players.length, holes: holes.length });
    if (!need) continue;
    const st = driveStatus({ players, holes, scores: scoresIdx[t.id] || {}, need, per });
    if (!st.tracked) continue;
    for (const r of st.rows.filter((x) => x.coming > 0)) {
      out.push({
        id: `proj-${round.id}-${r.id}`, round_id: round.id, player_id: r.id, strokes: r.coming * per, kind: 'rule_breach', projected: true,
        rule_id: dr?.rule?.id || null, waived_at: null,
        label: `Drives: ${r.name} ${r.used} of ${need}, ${plural(st.open, 'hole')} left (${signed(r.coming * per)} projected)`,
      });
    }
  }
  return out;
}

/** What a board row's strokes are for, in a word or two: 'late job', 'penalty', 'strokes' (mixed or awards). */
export function penaltyBadgeWord(lines = []) {
  const kinds = [...new Set((lines || []).filter((l) => !l.waived && !l.projected).map((l) => l.kind || 'late_job'))];
  if (kinds.length === 1 && kinds[0] === 'late_job') return 'late job';
  if (kinds.length === 1 && kinds[0] === 'rule_breach') return 'penalty';
  return 'strokes';
}
/** "(late job)", "(rule penalties)", "(awards and fines, late job)" — the scorecard's penalty row. */
export function penaltyRowWords(lines = []) {
  const W = { late_job: 'late job', rule_breach: 'rule penalties', award: 'fines & awards' };
  const kinds = [...new Set((lines || []).filter((l) => !l.waived && !l.projected).map((l) => l.kind || 'late_job'))];
  return kinds.map((k) => W[k] || 'strokes').join(', ');
}
/** Projected strokes on a row's lines (drives still to come on a live round): shown, not counted. */
export const projectedStrokes = (lines = []) => (lines || []).filter((l) => l.projected && !l.waived).reduce((s, l) => s + (Number(l.strokes) || 0), 0);

// ------------------------------------------------------------------ the words (same as the database's)
/** "6 drives each in a three · 4 in a four · 6 in a pair · +2 a drive short" (private.drives_value). */
export function drivesValue(n2, n3, n4, strokes) {
  return `${n3} drives each in a three · ${n4} in a four · ${n2} in a pair · +${strokes} a drive short`;
}
/** The rule's wording with the numbers in (private.drives_detail). */
export function drivesDetail(n2, n3, n4, strokes) {
  return `In Ambrose, each player’s drive must be used at least ${n3} times in a team of three, ${n4} in a team of four and ${n2} in a pair (over 18 holes; half that on 9). Each drive short costs the team ${plural(strokes, 'stroke')}, added when the round is locked. Tap whose drive it was on each hole. The organiser can change the numbers for a round and waive a penalty; anyone can dispute it.`;
}

/** One line for a round's rules / How it works: "Drives: 6 each (team of 3) — +2 a drive short". */
export function drivesRoundLine({ dr, round, teamSizes = [3], holes = 18 }) {
  const sizes = [...new Set((teamSizes || []).filter((s) => s >= 2))].sort();
  const list = (sizes.length ? sizes : [3, 4]).map((s) => ({ s, n: minDrivesFor({ dr, round, teamSize: s, holes }) })).filter((x) => x.n > 0);
  if (!list.length) return '';
  const per = drivePenaltyFor({ dr, round });
  const each = list.length === 1 ? `${list[0].n} each` : list.map((x) => `${x.n} each in a ${{ 2: 'pair', 3: 'three', 4: 'four' }[x.s] || `team of ${x.s}`}`).join(', ');
  return `Minimum drives: ${each}${per ? ` — ${signed(per)} stroke${per === 1 ? '' : 's'} for each drive short` : ''}`;
}

/** The organiser's form → the rules row update, or { error }. */
export function drivesRulePatch({ n2, n3, n4, strokes }) {
  const vals = { drives_2: int(String(n2 ?? '').trim(), NaN), drives_3: int(String(n3 ?? '').trim(), NaN), drives_4: int(String(n4 ?? '').trim(), NaN) };
  for (const v of Object.values(vals)) if (!Number.isInteger(v) || v < 0 || v > 9) return { error: 'Drives each: a whole number from 0 to 9' };
  const p = int(String(strokes ?? '').trim(), NaN);
  if (!Number.isInteger(p) || p < 0 || p > 10) return { error: 'Strokes per drive short: a whole number from 0 to 10' };
  return { ...vals, breach_strokes: p };
}

// ------------------------------------------------------------------ any rule broken on the course
/** Who can do what with a penalty: 'apply' (organiser), 'propose' (player), null (guest / not signed in). */
export function penaltyPower(role) {
  if (role === 'organiser') return 'apply';
  if (role === 'player') return 'propose';
  return null;
}

/** "No mulligans · hole 4 (+1)" — the label the server writes. */
export function breachLabel(title, hole, strokes) {
  return `${String(title || 'Rule').slice(0, 110)}${hole ? ` · hole ${hole}` : ''} (+${strokes})`;
}

/** A rule's penalty strokes for the picker (null = not set: ask). */
export const ruleStrokes = (rule) => (rule?.breach_strokes > 0 ? Number(rule.breach_strokes) : null);

/** The Penalty sheet's choices → the RPC arguments, or { error }. */
export function penaltyArgs({ round, player, rule, strokes, hole, note }) {
  if (!round?.id) return { error: 'No round' };
  if (!player) return { error: 'Who broke the rule?' };
  if (!rule?.id) return { error: 'Pick the rule' };
  const s = int(String(strokes ?? '').trim(), NaN);
  if (!Number.isInteger(s) || s < 1 || s > 10) return { error: 'Penalty strokes: a whole number from 1 to 10' };
  const h = hole == null || hole === '' ? null : int(hole, NaN);
  if (h != null && (!Number.isInteger(h) || h < 1 || h > 18)) return { error: 'Holes are 1 to 18' };
  const n = String(note || '').trim().slice(0, 200) || null;
  return { p_round: round.id, p_player: player, p_rule: rule.id, p_strokes: s, p_hole: h, p_note: n };
}
