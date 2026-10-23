// "Your round" (ov28, 23 Oct 2026) — who you're with, who you're against and when you're off, for any round: a Cup
// match, an Ambrose team, a 4BBB pair, or just a playing group with a tee time. Plain JavaScript, no imports, so the
// app (src/lib/yourround.js re-exports these) and the notify function (the draw-out and night-before buzzes) share it.
//
// Josh (walkthrough C1): "Don't treat this uniquely [to the Ryder Cup]. Should be general: need to ensure teams or
// groups are assigned before the round, or even at the course. Need teams for e.g. Ambrose, and an option for playing
// groups. Definitely need the opponent or opposing teams."
//
// Inputs are plain rows (ids, not player objects), so this works the same on a phone and on the server:
//   round:    { id, name, format, play_date }
//   me:       a player id
//   teams:    the round's Ambrose teams / 4BBB pairs: [{ id, name, players: [ids or { id }] }]
//   matches:  the round's Cup matches: [{ id, a_players, b_players, sort, tee_time, start_hole, format }]
//   sides:    the Cup's two sides: [{ id, name, colour, sort }] (sort 1 = side A, 2 = side B)
//   teeRows:  the round's tee groups: [{ group_no, tee_time, start_hole, player_ids }]

const idOf = (p) => (typeof p === 'string' ? p : p?.id);
const ids = (list) => (list || []).map(idOf).filter(Boolean);

/** "Al", "Al and Bo", "Al, Bo and Cy". */
export function andList(names) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** '07:52' → '7:52', '13:04' → '1:04pm' (the app's tee time style). Anything else → ''. */
export function teeClock(hhmm) {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return '';
  if (h < 12) return `${h || 12}:${m[2]}${h === 0 ? 'am' : ''}`;
  return `${h === 12 ? 12 : h - 12}:${m[2]}pm`;
}

/**
 * Everything about one player's round, or null when there's nothing to tell them (not in a team, a match or a group,
 * and no tee time).
 * Returns {
 *   kind: 'cup' | 'ambrose' | 'fourball' | 'group',
 *   team: { id, name, colour } | null      — the Cup side, Ambrose team or 4BBB pair
 *   partners: [ids]                        — your side of the match / your team or pair, not you
 *   opponents: [ids]                       — the other side of your Cup match (empty for team formats)
 *   opposingTeams: [{ id, name }]          — the other teams / pairs in the round (team formats), or the other side
 *   match: the Cup match row | null
 *   group: [ids]                           — the others in your playing group (tee group, else your Cup match)
 *   groupNo: number | null
 *   tee: { time: '07:52' | null, hole: number | null } | null
 * }
 */
export function yourRound({ round, me, teams = [], matches = [], sides = [], teeRows = [] } = {}) {
  if (!round || !me) return null;
  const sorted = [...(sides || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const match = [...(matches || [])].filter((m) => m.round_id == null || m.round_id === round.id)
    .find((m) => ids(m.a_players).includes(me) || ids(m.b_players).includes(me)) || null;
  const row = (teeRows || []).find((r) => ids(r.player_ids).includes(me)) || null;
  const teamFormat = round.format === 'ambrose' || round.format === 'fourball';
  const myTeam = teamFormat ? (teams || []).find((t) => ids(t.players).includes(me)) || null : null;

  let kind = 'group';
  let team = null;
  let partners = [];
  let opponents = [];
  let opposingTeams = [];
  if (match) {
    kind = 'cup';
    const onA = ids(match.a_players).includes(me);
    const mine = onA ? sorted[0] : sorted[1];
    const theirs = onA ? sorted[1] : sorted[0];
    team = mine ? { id: mine.id, name: mine.name, colour: mine.colour || null } : null;
    partners = ids(onA ? match.a_players : match.b_players).filter((x) => x !== me);
    opponents = ids(onA ? match.b_players : match.a_players);
    opposingTeams = theirs ? [{ id: theirs.id, name: theirs.name, colour: theirs.colour || null }] : [];
  } else if (myTeam) {
    kind = round.format === 'fourball' ? 'fourball' : 'ambrose';
    team = { id: myTeam.id, name: myTeam.name, colour: null };
    partners = ids(myTeam.players).filter((x) => x !== me);
    // In a playing group with another team or pair: that's who you're up against on the day. Else everyone else.
    const inMyGroup = row ? (teams || []).filter((t) => t.id !== myTeam.id && ids(t.players).some((p) => ids(row.player_ids).includes(p))) : [];
    opposingTeams = (inMyGroup.length ? inMyGroup : (teams || []).filter((t) => t.id !== myTeam.id)).map((t) => ({ id: t.id, name: t.name, colour: null }));
  }
  const group = row ? ids(row.player_ids).filter((x) => x !== me) : match ? [...partners, ...opponents] : [];
  const time = (match && match.tee_time) || row?.tee_time || null;
  const hole = (match && match.tee_time ? match.start_hole : null) ?? row?.start_hole ?? null;
  const tee = time || hole != null ? { time, hole } : null;
  if (!team && !group.length && !tee) return null;
  return { kind, team, partners, opponents, opposingTeams, match, group, groupNo: row?.group_no ?? null, tee };
}

/** "7:52, hole 1", "8:00 shotgun, hole 3", "Group 2", or '' — when you're off. */
export function teeWhen(y) {
  if (!y?.tee) return y?.groupNo ? `Group ${y.groupNo}` : '';
  const t = teeClock(y.tee.time);
  const hole = y.tee.hole ?? (t ? 1 : null);
  return [t, hole != null ? `hole ${hole}` : null].filter(Boolean).join(', ');
}

/** "You're off 7:52, hole 1, with Bo, Cy and Di" — or null when there's no time or group. */
export function offLine(y, nameOf = (id) => id) {
  if (!y) return null;
  const when = teeWhen(y);
  const mates = andList(y.group.map(nameOf));
  if (!when && !mates) return null;
  if (y.tee?.time) return `You’re off ${when}${mates ? `, with ${mates}` : ''}`;
  if (when) return `${when}${mates ? ` with ${mates}` : ''}`;
  return `Your group: ${mates}`;
}

/** "You & Bo v Kurt & Al" for a Cup match; "Team 2 with Bo and Cy" for a team; null otherwise. */
export function matchLine(y, nameOf = (id) => id) {
  if (!y) return null;
  if (y.kind === 'cup') {
    const us = ['You', ...y.partners.map(nameOf)].join(' & ');
    return `${us} v ${y.opponents.map(nameOf).join(' & ') || '—'}`;
  }
  if (y.team) return `${y.team.name}${y.partners.length ? ` with ${andList(y.partners.map(nameOf))}` : ''}`;
  return null;
}

/** "Thu 7:00am" style: the round's day and tee time (no time → just the day). */
export function dayAndTime(round, y) {
  const parts = [];
  if (round?.play_date && /^\d{4}-\d{2}-\d{2}/.test(round.play_date)) {
    const [yy, mm, dd] = round.play_date.slice(0, 10).split('-').map(Number);
    parts.push(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()]);
  }
  const t = teeClock(y?.tee?.time);
  if (t) parts.push(/am|pm/.test(t) ? t : `${t}am`);
  return parts.join(' ');
}

/**
 * I8 — "the draw is out": one player's own line for any team / group allocation.
 *   Cup:      "You & Bo v Kurt & Al, Thu 7:00am"
 *   Ambrose:  "You're in Team 2 with Bo and Cy, Sat 8:16am"
 *   A group:  "You're off Sat 8:16am with Bo, Cy and Di"
 * Returns { title, body } or null when this player isn't in it.
 */
export function drawOutMessage({ roundName = '', round = null, y = null, nameOf = (id) => id } = {}) {
  if (!y) return null;
  const when = dayAndTime(round, y);
  let body;
  if (y.kind === 'cup') body = `${matchLine(y, nameOf)}${when ? `, ${when}` : ''}`;
  else if (y.team) body = `You’re in ${matchLine(y, nameOf)}${when ? `, ${when}` : ''}`;
  else {
    const mates = andList(y.group.map(nameOf));
    if (!mates && !when) return null;
    body = `You’re off${when ? ` ${when}` : ''}${mates ? ` with ${mates}` : ''}`;
  }
  return { title: `📣 The draw is out${roundName ? ` — ${roundName}` : ''}`, body };
}

/**
 * I11 — the night before, only when a tee time or group is set:
 *   title "⛳ Your tee time tomorrow: 7:52"   body "Hole 1 with Bo, Cy and Di · Josh picks you up 6:30am"
 * car (optional): { driver: { name, nickname }, driving, pickup_time, pickup_place }.
 * Returns { title, body } or null (no time and no group → no buzz).
 */
export function teeTomorrowMessage({ roundName = '', courseName = '', y = null, nameOf = (id) => id, car = null } = {}) {
  if (!y || (!y.tee?.time && !y.group.length)) return null;
  const t = teeClock(y.tee?.time);
  const mates = andList(y.group.map(nameOf));
  const bits = [];
  if (y.kind === 'cup' && y.opponents.length) bits.push(matchLine(y, nameOf));
  else if (mates) bits.push(`${y.tee?.hole != null || t ? `Hole ${y.tee?.hole ?? 1} ` : ''}with ${mates}`.trim());
  if (car) {
    const first = (p) => String(p?.nickname || p?.name || '').trim().split(/\s+/)[0];
    const pick = [car.pickup_time, car.pickup_place ? `from ${car.pickup_place}` : null].filter(Boolean).join(' ');
    if (car.driving) bits.push(`You’re driving${pick ? ` · pick-ups ${pick}` : ''}`);
    else if (car.driver) bits.push(`${first(car.driver)} picks you up${pick ? ` ${pick}` : ''}`);
  }
  const where = [roundName, courseName].filter(Boolean).join(' · ');
  return {
    title: t ? `⛳ Your tee time tomorrow: ${t}` : `⛳ Your group tomorrow${roundName ? ` — ${roundName}` : ''}`,
    body: [bits.join(' · '), !bits.length ? where : null].filter(Boolean).join(' · ') || where || 'Check the app for your group.',
  };
}
