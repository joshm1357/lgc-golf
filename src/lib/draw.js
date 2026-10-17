// The Draw — random Ambrose teams, kept fair with "salaries".
//
// Plain words:
//   - Every player gets a salary: better golfers cost more. It comes from their handicap,
//     nudged by how they've gone in this trip's Stableford rounds.
//   - We shuffle the field thousands of times and keep only the splits where the teams'
//     total salaries are close together, then pick one of those at random.
//   - So the teams are random, but nobody gets stacked.

export const TEAM_NAMES = ['Team Spray', 'Team Shank', 'Team Duff', 'Team Yips', 'Team Hack', 'Team Chunk', 'Team Skull', 'Team Lip-out'];

/** Salary in $M. Lower handicap = dearer. Each Stableford point above/below 36 on average moves it $0.2M. */
export function salary(handicap, avgPoints = null) {
  const base = 15 - 0.3 * Number(handicap || 0);
  const form = avgPoints == null ? 0 : 0.2 * (avgPoints - 36);
  return Math.max(1, Math.round((base + form) * 10) / 10);
}

/** Split n players into k teams as evenly as possible, e.g. 10 into 3 → [4, 3, 3]. */
export function teamSizes(n, k) {
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Team handicap rule: combined handicaps ÷ (2 × team size) — i.e. 4-player ÷ 8, 3-player ÷ 6, 2-player ÷ 4. */
export function teamHandicap(handicaps) {
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

/**
 * players: [{ id, handicap, salary }]
 * Returns { teams: [{ name, players: [id], salary, handicap }], picks: [{ player_id, team }], spread }
 * picks are in a dramatic reveal order (shuffled, alternating across teams).
 */
export function makeDraw(players, k, { tries = 4000, slack = 0.4, rand = cryptoRand, names = TEAM_NAMES } = {}) {
  const sizes = teamSizes(players.length, k);
  const candidates = [];
  let best = Infinity;
  for (let t = 0; t < tries; t++) {
    const order = shuffle(players, rand);
    const teams = [];
    let at = 0;
    for (const s of sizes) {
      teams.push(order.slice(at, at + s));
      at += s;
    }
    // Compare salary per player so uneven team sizes are fair too.
    const per = teams.map((tm) => tm.reduce((a, p) => a + p.salary, 0) / tm.length);
    const spread = Math.max(...per) - Math.min(...per);
    if (spread < best) best = spread;
    candidates.push({ teams, spread });
  }
  // Fair enough = average salary per player within $0.4M of the fairest split found.
  const good = candidates.filter((c) => c.spread <= best + slack);
  const chosen = good[Math.floor(rand() * good.length)];
  const teamNames = shuffle(names, rand).slice(0, k);
  const teams = chosen.teams.map((tm, i) => ({
    name: teamNames[i] || `Team ${i + 1}`,
    players: tm.map((p) => p.id),
    salary: Math.round(tm.reduce((a, p) => a + p.salary, 0) * 10) / 10,
    handicap: teamHandicap(tm.map((p) => p.handicap)),
  }));
  // Reveal order: round-robin across teams (team order shuffled), players shuffled within each team.
  const queues = teams.map((tm, i) => shuffle(tm.players, rand).map((id) => ({ player_id: id, team: i })));
  const teamOrder = shuffle(teams.map((_, i) => i), rand);
  const picks = [];
  for (let r = 0; r < Math.max(...sizes); r++) {
    for (const ti of teamOrder) if (queues[ti][r]) picks.push(queues[ti][r]);
  }
  return { teams, picks, spread: Math.round(chosen.spread * 100) / 100 };
}

export const REVEAL_MS = 4200; // time per player in the ceremony
export const SPIN_MS = 2800; // of which: spinning through faces
