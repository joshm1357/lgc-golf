// The Draw — random Ambrose teams with team handicaps worked out automatically.
//
// Plain words:
//   - Fully random: shuffle the field and deal it into teams.
//   - "Even it out" (optional): shuffle thousands of times, keep only splits where the
//     team handicaps are close together, then pick one of those at random.
//   - Team handicap (Australian Ambrose): combined handicaps ÷ (2 × team size),
//     i.e. 4-player ÷ 8, 3-player ÷ 6, 2-player ÷ 4.

export const TEAM_NAMES = ['Team Spray', 'Team Shank', 'Team Duff', 'Team Yips', 'Team Hack', 'Team Chunk', 'Team Skull', 'Team Lip-out'];

/** Split n players into k teams as evenly as possible, e.g. 10 into 3 → [4, 3, 3]. */
export function teamSizes(n, k) {
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Combined handicaps ÷ (2 × team size), to one decimal. */
export function teamHandicap(handicaps) {
  if (!handicaps.length) return 0;
  const total = handicaps.reduce((a, b) => a + Number(b || 0), 0);
  return Math.round((total / (2 * handicaps.length)) * 10) / 10;
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cryptoRand() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0] / 4294967296;
  }
  return Math.random();
}

function deal(players, sizes, rand) {
  const order = shuffle(players, rand);
  const teams = [];
  let at = 0;
  for (const s of sizes) {
    teams.push(order.slice(at, at + s));
    at += s;
  }
  return teams;
}

/**
 * players: [{ id, handicap }]
 * opts.balance: false = fully random; true = keep team handicaps within 1 shot of the most even split.
 * Returns { teams: [{ name, players: [id], handicap }], picks: [{ player_id, team }], spread }
 * picks are in a dramatic reveal order (round-robin across teams, shuffled).
 */
export function makeDraw(players, k, { balance = false, tries = 4000, slack = 1, rand = cryptoRand, names = TEAM_NAMES } = {}) {
  const sizes = teamSizes(players.length, k);
  const hcps = (tm) => teamHandicap(tm.map((p) => p.handicap));
  const spreadOf = (teams) => {
    const h = teams.map(hcps);
    return Math.max(...h) - Math.min(...h);
  };
  let chosen;
  if (!balance) {
    chosen = deal(players, sizes, rand);
  } else {
    const candidates = [];
    let best = Infinity;
    for (let t = 0; t < tries; t++) {
      const teams = deal(players, sizes, rand);
      const spread = spreadOf(teams);
      if (spread < best) best = spread;
      candidates.push({ teams, spread });
    }
    const good = candidates.filter((c) => c.spread <= best + slack);
    chosen = good[Math.floor(rand() * good.length)].teams;
  }
  const teamNames = shuffle(names, rand).slice(0, k);
  const teams = chosen.map((tm, i) => ({
    name: teamNames[i] || `Team ${i + 1}`,
    players: tm.map((p) => p.id),
    handicap: hcps(tm),
  }));
  // Lotto-style reveal: one team at a time (team order shuffled), names in random order within each team.
  const teamOrder = shuffle(teams.map((_, i) => i), rand);
  const picks = teamOrder.flatMap((ti) => shuffle(teams[ti].players, rand).map((id) => ({ player_id: id, team: ti })));
  return { teams, picks, spread: Math.round(spreadOf(chosen) * 10) / 10 };
}

export const REVEAL_MS = 4500; // timed mode: time per name
export const SPIN_MS = 2400; // the drum rolls this long before each name lands

/**
 * Rooms or cars: deal the players into the groups at random, one at a time across the
 * groups that still have space (so rooms fill evenly), never over a group's capacity.
 * groups: [{ id, name, capacity }]. Returns { teams, picks, leftOver } in the same shape
 * the live draw uses — teams[i].group_id says which room/car it is.
 */
export function makeGroupDraw(playerIds, groups, rand = cryptoRand) {
  const order = shuffle(playerIds, rand);
  const teams = groups.map((g) => ({ name: g.name, group_id: g.id, capacity: Number(g.capacity) || 1, players: [], handicap: null }));
  let gi = 0;
  const leftOver = [];
  for (const pid of order) {
    let tries = 0;
    while (tries < teams.length && teams[gi % teams.length].players.length >= teams[gi % teams.length].capacity) { gi++; tries++; }
    if (tries >= teams.length) { leftOver.push(pid); continue; }
    teams[gi % teams.length].players.push(pid);
    gi++;
  }
  const teamOrder = shuffle(teams.map((_, i) => i), rand);
  const picks = teamOrder.flatMap((ti) => shuffle(teams[ti].players, rand).map((id) => ({ player_id: id, team: ti })));
  return { teams, picks, leftOver };
}
