// Tee groups (migration 056): fair groups of four for a round, and their tee times. Pure functions, no React.
//
// How a set of groups is made:
//  1. "Blocks": players who must play together — an Ambrose team, a 4BBB pair, a Cup match, or a "keep together"
//     pair the organiser picked (e.g. a car). Everyone else is a block of one.
//  2. "Shape": how the blocks fit into groups — groups of 4, with 3s when the numbers need it, a 5 only when nothing
//     else fits, and never a 1 or 2 unless there are fewer than 3 players (or the teams can't be split any other way).
//  3. Fill the shape at random (from a seed), then keep swapping blocks between groups while it makes things better:
//     first keep "keep apart" pairs apart, then avoid partners from earlier rounds of the trip, then mix handicaps.
//  4. Do that a number of times and keep the best. The same seed always gives the same groups; "Shuffle again"
//     just uses the next seed.

// ------------------------------------------------------------------ Small helpers
/** A small seeded random number generator (mulberry32): the same seed gives the same numbers. */
export function seeded(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** "Al", "Al and Bo", "Al, Bo and Cy". */
export function joinNames(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

// ------------------------------------------------------------------ Times
const TIME = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/;
/** '8:00', '0800', '8.00' → '08:00'; anything else → null. */
export function parseTime(s) {
  const m = TIME.exec(String(s ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
/** '08:00' + 16 → '08:16' (wraps past midnight). */
export function addMinutes(hhmm, mins) {
  const t = parseTime(hhmm);
  if (!t) return null;
  const total = (((Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + Math.round(mins)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
/** '08:16' → '8:16', '13:04' → '1:04pm', '12:30' → '12:30pm'. */
export function showTime(hhmm) {
  const t = parseTime(hhmm);
  if (!t) return '';
  const h = Number(t.slice(0, 2));
  const m = t.slice(3);
  if (h < 12) return `${h || 12}:${m}${h === 0 ? 'am' : ''}`;
  return `${h === 12 ? 12 : h - 12}:${m}pm`;
}

/**
 * Tee times for `count` groups.
 *  - 'times': first group at `first`, then every `gap` minutes (8:00, 8:08, 8:16…), all off the 1st.
 *  - 'shotgun': everyone at `first`, starting on holes 1, 2, 3… (more than 18 groups double up from the 1st).
 * No (or a bad) first time → no times.
 */
export function teeTimes(count, { mode = 'times', first = '08:00', gap = 8 } = {}) {
  const start = parseTime(first);
  const g = Math.max(0, Math.min(60, Math.round(Number(gap) || 0)));
  return Array.from({ length: count }, (_, i) => {
    if (mode === 'shotgun') return { tee_time: start, start_hole: (i % 18) + 1 };
    return { tee_time: start ? addMinutes(start, i * g) : null, start_hole: null };
  });
}

/** What the saved rows say about how tee times were set: { mode, first, gap }. */
export function timeSettings(rows) {
  const list = [...(rows || [])].sort((a, b) => a.group_no - b.group_no);
  const first = list.find((r) => r.tee_time)?.tee_time || '08:00';
  if (list.some((r) => r.start_hole != null)) return { mode: 'shotgun', first, gap: 8 };
  const t = list.filter((r) => r.tee_time).map((r) => r.tee_time);
  let gap = 8;
  if (t.length >= 2) {
    const mins = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
    const d = mins(t[1]) - mins(t[0]);
    if (d > 0 && d <= 60) gap = d;
  }
  return { mode: 'times', first, gap };
}

// ------------------------------------------------------------------ Who's playing
/**
 * The players in a round and who must stay together, from the app's data.
 *  - players: everyone in round_players, a team/pair, or a Cup match: [{ id, hcp }] (hcp = the round's playing
 *    handicap if set, else the player's handicap).
 *  - units: Ambrose teams and 4BBB pairs (kept together). Stableford and stroke play have none.
 *  - matches: the round's Cup matches, in order, each as one list of players (both sides).
 */
export function roundTeeInputs({ round, roundPlayers = [], teams = [], matches = [], playersById = {} }) {
  const hcpOf = Object.fromEntries(roundPlayers.map((rp) => [rp.player_id, rp.playing_handicap]));
  const teamFormat = round?.format === 'ambrose' || round?.format === 'fourball';
  const units = teamFormat ? teams.map((t) => (t.players || []).map((p) => (typeof p === 'string' ? p : p.id))).filter((u) => u.length) : [];
  const matchUnits = [...matches]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map((m) => [...(m.a_players || []), ...(m.b_players || [])])
    .filter((u) => u.length);
  const ids = [];
  const seen = new Set();
  for (const id of [...roundPlayers.map((rp) => rp.player_id), ...units.flat(), ...matchUnits.flat()]) {
    if (!seen.has(id) && playersById[id]) { seen.add(id); ids.push(id); }
  }
  const players = ids.map((id) => ({ id, hcp: Number(hcpOf[id] ?? playersById[id]?.handicap ?? 18) }));
  const inRound = (u) => u.filter((id) => seen.has(id));
  return { players, units: units.map(inRound).filter((u) => u.length), matches: matchUnits.map(inRound).filter((u) => u.length) };
}

/**
 * How many times each pair of players has already played in a group together earlier in the same trip.
 * Earlier rounds' saved tee groups count; a round with none saved falls back to its Ambrose teams / 4BBB pairs.
 * Returns { 'a|b': times }.
 */
export function pastPartners({ round, rounds = [], teeRowsByRound = {}, teamsByRound = {} }) {
  const out = {};
  if (!round) return out;
  const key = (r) => `${r.play_date || '9999-12-31'}|${r.created_at || ''}`;
  const earlier = rounds.filter((r) => r.id !== round.id && r.trip_id === round.trip_id && key(r) < key(round));
  const add = (ids) => {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = pairKey(ids[i], ids[j]);
      out[k] = (out[k] || 0) + 1;
    }
  };
  for (const r of earlier) {
    const rows = teeRowsByRound[r.id] || [];
    if (rows.length) rows.forEach((g) => add(g.player_ids || []));
    else if (r.format === 'ambrose' || r.format === 'fourball') (teamsByRound[r.id] || []).forEach((t) => add((t.players || []).map((p) => (typeof p === 'string' ? p : p.id))));
  }
  return out;
}

// ------------------------------------------------------------------ Blocks
const MAX_GROUP = 5;   // the database allows 1–5 a group
const MAX_TOGETHER = 4; // a "keep together" never makes a block bigger than a four

/**
 * Who has to play together. Cup matches first, then teams/pairs, then "keep together" pairs (each skipped, with a
 * note, if it would make a block too big). Returns { blocks: [{ ids, solo }], notes: [...] }.
 * `solo`: a Cup match with "one match per group" — it gets a group of its own.
 */
export function buildBlocks({ playerIds, units = [], matches = [], together = [], oneMatchPerGroup = false }) {
  const parent = Object.fromEntries(playerIds.map((id) => [id, id]));
  const size = Object.fromEntries(playerIds.map((id) => [id, 1]));
  const solo = new Set();
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const notes = [];
  const unite = (a, b, limit) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return true;
    if (size[ra] + size[rb] > limit) return false;
    parent[rb] = ra;
    size[ra] += size[rb];
    if (solo.has(rb)) solo.add(ra);
    return true;
  };
  const has = (id) => id in parent;
  for (const m of matches) {
    const ids = m.filter(has);
    let ok = true;
    for (const id of ids.slice(1)) ok = unite(ids[0], id, MAX_GROUP) && ok;
    if (!ok) notes.push({ kind: 'too-big', ids });
    if (oneMatchPerGroup && ids.length) solo.add(find(ids[0]));
  }
  for (const u of units) {
    const ids = u.filter(has);
    let ok = true;
    for (const id of ids.slice(1)) ok = unite(ids[0], id, MAX_GROUP) && ok;
    if (!ok) notes.push({ kind: 'too-big', ids });
  }
  for (const [a, b] of together) {
    if (!has(a) || !has(b)) continue;
    if (!unite(a, b, MAX_TOGETHER)) notes.push({ kind: 'together-skipped', ids: [a, b] });
  }
  const byRoot = new Map();
  for (const id of playerIds) {
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(id);
  }
  // A solo root may have changed when it was merged; re-check by membership.
  const soloIds = new Set([...solo].flatMap((r) => byRoot.get(find(r)) || []));
  return { blocks: [...byRoot.values()].map((ids) => ({ ids, solo: soloIds.has(ids[0]) })), notes };
}

// ------------------------------------------------------------------ Shape
// Every way to make one group from block sizes (largest first), up to 5 players.
const COMPOSITIONS = (() => {
  const out = [];
  const walk = (left, max, acc) => {
    if (acc.length) out.push([...acc]);
    for (let s = Math.min(max, left); s >= 1; s--) walk(left - s, s, [...acc, s]);
  };
  walk(MAX_GROUP, MAX_GROUP, []);
  return out;
})();
const SIZE_COST = { 4: 0, 3: 1, 5: 6, 2: 40, 1: 60 };

/**
 * How blocks of these sizes best fit into groups: a list of groups, each a list of block sizes, e.g.
 * sizes [2,2,1,1,1,1] → [[2,2],[1,1,1,1]] or [[2,1,1],[2,1,1]]. Ties are broken with `rand`, so different tries
 * can use different (equally good) shapes. Fewer than 3 players: one group.
 */
export function groupShape(sizes, rand = Math.random) {
  const total = sizes.reduce((s, x) => s + x, 0);
  if (!sizes.length) return [];
  if (total < 3) return [[...sizes].sort((a, b) => b - a)];
  const counts = [0, 0, 0, 0, 0, 0];
  for (const s of sizes) counts[Math.min(s, MAX_GROUP)]++;
  const memo = new Map();
  const order = shuffle(COMPOSITIONS, rand);
  const best = (c) => {
    const k = c.join(',');
    if (memo.has(k)) return memo.get(k);
    let top = 0;
    for (let s = MAX_GROUP; s >= 1; s--) if (c[s]) { top = s; break; }
    if (!top) { memo.set(k, { cost: 0, groups: [] }); return memo.get(k); }
    let res = null;
    for (const comp of order) {
      if (comp[0] !== top) continue;
      const need = [0, 0, 0, 0, 0, 0];
      for (const s of comp) need[s]++;
      if (need.some((n, s) => n > c[s])) continue;
      const next = c.map((n, s) => n - need[s]);
      const rest = best(next);
      const sum = comp.reduce((a, b) => a + b, 0);
      const cost = SIZE_COST[sum] + rest.cost;
      if (!res || cost < res.cost) res = { cost, groups: [comp, ...rest.groups] };
    }
    memo.set(k, res);
    return res;
  };
  return best(counts).groups;
}

// ------------------------------------------------------------------ Scoring
/** Everything the scorer needs, worked out once. */
export function scoringContext({ players, blocks = [], history = {}, apart = [] }) {
  const hcp = Object.fromEntries(players.map((p) => [p.id, Number(p.hcp) || 0]));
  const blockOf = {};
  blocks.forEach((b, i) => b.ids.forEach((id) => { blockOf[id] = i; }));
  const all = players.map((p) => hcp[p.id]);
  const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  const range = all.length ? Math.max(...all) - Math.min(...all) : 0;
  const apartSet = new Set(apart.filter(([a, b]) => a in hcp && b in hcp && a !== b).map(([a, b]) => pairKey(a, b)));
  return { hcp, blockOf, history, mean, range, apartSet, blocks };
}

/** One group's cost: keep-aparts broken (huge), repeat partners (big, worse each time), handicap average off the middle. */
function groupCost(ids, ctx) {
  let cost = 0;
  let sum = 0;
  for (let i = 0; i < ids.length; i++) {
    sum += ctx.hcp[ids[i]] ?? 0;
    for (let j = i + 1; j < ids.length; j++) {
      const k = pairKey(ids[i], ids[j]);
      if (ctx.apartSet.has(k)) cost += 1e8;
      if (ctx.blockOf[ids[i]] !== undefined && ctx.blockOf[ids[i]] === ctx.blockOf[ids[j]]) continue; // teammates: no choice
      const rep = ctx.history[k] || 0;
      cost += 1e4 * rep * rep;
    }
  }
  if (ids.length) {
    const d = sum / ids.length - ctx.mean;
    cost += d * d * ids.length;
  }
  return cost;
}

/**
 * How good a set of groups is, in numbers and in words.
 * Returns { total, repeats: [[a,b,times]], apartBroken: [[a,b]], split: [[ids of a block that got split]],
 *           averages: [avg per group], spread, mixed, small: number of groups under 3 }.
 */
export function scoreGroups(groups, ctx) {
  let total = 0;
  const repeats = [];
  const apartBroken = [];
  for (const g of groups) {
    total += groupCost(g, ctx);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const k = pairKey(g[i], g[j]);
      if (ctx.apartSet.has(k)) apartBroken.push([g[i], g[j]]);
      const same = ctx.blockOf[g[i]] !== undefined && ctx.blockOf[g[i]] === ctx.blockOf[g[j]];
      if (!same && ctx.history[k]) repeats.push([g[i], g[j], ctx.history[k]]);
    }
  }
  const groupOf = {};
  groups.forEach((g, i) => g.forEach((id) => { groupOf[id] = i; }));
  const split = (ctx.blocks || []).filter((b) => b.ids.length > 1 && new Set(b.ids.map((id) => groupOf[id])).size > 1).map((b) => b.ids);
  const averages = groups.map((g) => (g.length ? g.reduce((s, id) => s + (ctx.hcp[id] ?? 0), 0) / g.length : 0));
  const spread = averages.length > 1 ? Math.max(...averages) - Math.min(...averages) : 0;
  const players = groups.reduce((s, g) => s + g.length, 0);
  const small = players >= 3 ? groups.filter((g) => g.length < 3).length : 0;
  return { total, repeats, apartBroken, split, averages, spread, mixed: spread <= Math.max(4, ctx.range * 0.25), small };
}

/**
 * The score in plain words, for the screen: [{ text, ok }]. `nameOf(id)` gives a player's name.
 * e.g. "No repeat partners" ✓ · "Handicaps mixed" ✓ · "Al and Bo together again" ✗
 */
export function explain(score, nameOf = (id) => id, { notes = [], hasApart = false, groups = [] } = {}) {
  const out = [];
  if (!score.repeats.length) out.push({ text: 'No repeat partners', ok: true });
  else if (score.repeats.length <= 2) out.push({ text: `${score.repeats.map(([a, b]) => `${nameOf(a)} & ${nameOf(b)}`).join(', ')} together again`, ok: false });
  else out.push({ text: `${score.repeats.length} repeat partners — the fewest we could find`, ok: false });
  if (groups.length > 1) out.push(score.mixed ? { text: 'Handicaps mixed', ok: true } : { text: 'Handicaps a bit uneven', ok: false });
  if (hasApart) {
    out.push(score.apartBroken.length
      ? { text: `${score.apartBroken.map(([a, b]) => `${nameOf(a)} & ${nameOf(b)}`).join(', ')} not kept apart`, ok: false }
      : { text: 'Kept apart as asked', ok: true });
  }
  for (const ids of score.split) out.push({ text: `${joinNames(ids.map(nameOf))} split up`, ok: false });
  for (const n of notes) {
    if (n.kind === 'together-skipped') out.push({ text: `Couldn’t keep ${nameOf(n.ids[0])} & ${nameOf(n.ids[1])} together (their group would be too big)`, ok: false });
    if (n.kind === 'too-big') out.push({ text: `${joinNames(n.ids.map(nameOf))} are too many for one group`, ok: false });
  }
  if (score.small) out.push({ text: score.small === 1 ? 'One group of 2 — the teams don’t split any other way' : `${score.small} groups under 3 — the teams don’t split any other way`, ok: false });
  return out;
}

export const explainLine = (items) => items.map((i) => i.text).join(' · ');

// ------------------------------------------------------------------ Making the groups
/**
 * Make tee groups for a round.
 *   players: [{ id, hcp }]           everyone playing
 *   units:   [[ids]]                  Ambrose teams / 4BBB pairs (kept together)
 *   matches: [[ids]]                  Cup matches (kept together; two singles a group, a pairs match on its own)
 *   oneMatchPerGroup                  each Cup match gets its own group
 *   together / apart: [[a, b]]       the organiser's "keep together" and "keep apart" pairs
 *   history: { 'a|b': times }        from pastPartners()
 *   seed, tries                       same seed → same groups
 * Returns { groups: [[ids]], score, notes, blocks, ctx }.
 */
export function makeTeeGroups({ players = [], units = [], matches = [], oneMatchPerGroup = false, together = [], apart = [], history = {}, seed = 1, tries = 40 }) {
  const playerIds = players.map((p) => p.id);
  const { blocks, notes } = buildBlocks({ playerIds, units, matches, together, oneMatchPerGroup });
  const ctx = scoringContext({ players, blocks, history, apart });
  if (!playerIds.length) return { groups: [], score: scoreGroups([], ctx), notes, blocks, ctx };
  const soloGroups = blocks.filter((b) => b.solo).map((b) => b.ids);
  const free = blocks.filter((b) => !b.solo);
  const rand = seeded(seed);
  // A fast copy of the costs by number (index), so trying thousands of swaps stays quick on a phone.
  const n = playerIds.length;
  const pos = Object.fromEntries(playerIds.map((id, i) => [id, i]));
  const hc = playerIds.map((id) => ctx.hcp[id]);
  const pair = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const k = pairKey(playerIds[i], playerIds[j]);
    let c = ctx.apartSet.has(k) ? 1e8 : 0;
    const same = ctx.blockOf[playerIds[i]] === ctx.blockOf[playerIds[j]];
    const rep = same ? 0 : ctx.history[k] || 0;
    c += 1e4 * rep * rep;
    pair[i * n + j] = c;
    pair[j * n + i] = c;
  }
  const fastCost = (g) => {
    const ix = [];
    for (const b of g) for (const i of b.ix) ix.push(i);
    let c = 0;
    let sum = 0;
    for (let a = 0; a < ix.length; a++) {
      sum += hc[ix[a]];
      for (let b = a + 1; b < ix.length; b++) c += pair[ix[a] * n + ix[b]];
    }
    if (ix.length) { const d = sum / ix.length - ctx.mean; c += d * d * ix.length; }
    return c;
  };
  const freeIx = free.map((b) => ({ ids: b.ids, ix: b.ids.map((id) => pos[id]) }));
  const tryCount = Math.max(1, Math.min(tries, Math.round(1600 / Math.max(1, freeIx.length))));
  let best = null;
  for (let t = 0; t < tryCount; t++) {
    const shape = groupShape(freeIx.map((b) => b.ids.length), rand);
    // Fill the shape: blocks of each size, shuffled, into the slots that size.
    const pool = {};
    for (const b of shuffle(freeIx, rand)) (pool[b.ids.length] ||= []).push(b);
    const slots = shape.map((comp) => comp.map((sz) => pool[sz].pop()));
    const costs = slots.map(fastCost);
    // Improve: swap two blocks of the same size between groups while it helps.
    let improved = true;
    let passes = 0;
    while (improved && passes++ < 30) {
      improved = false;
      for (let g1 = 0; g1 < slots.length; g1++) for (let g2 = g1 + 1; g2 < slots.length; g2++) {
        for (let i = 0; i < slots[g1].length; i++) for (let j = 0; j < slots[g2].length; j++) {
          const a = slots[g1][i];
          const b = slots[g2][j];
          if (a.ids.length !== b.ids.length) continue;
          slots[g1][i] = b; slots[g2][j] = a;
          const c1 = fastCost(slots[g1]);
          const c2 = fastCost(slots[g2]);
          if (c1 + c2 < costs[g1] + costs[g2] - 1e-9) { costs[g1] = c1; costs[g2] = c2; improved = true; }
          else { slots[g1][i] = a; slots[g2][j] = b; }
        }
      }
    }
    const total = costs.reduce((x, y) => x + y, 0);
    if (!best || total < best.total - 1e-9) best = { slots, total };
  }
  const groups = [...soloGroups, ...shuffle(best.slots.map((g) => g.flatMap((b) => b.ids)), rand)];
  best = { groups };
  return { groups: best.groups, score: scoreGroups(best.groups, ctx), notes, blocks, ctx };
}

/** Swap two players between groups (or do nothing if they're in the same group or not found). */
export function swapPlayers(groups, a, b) {
  const ga = groups.findIndex((g) => g.includes(a));
  const gb = groups.findIndex((g) => g.includes(b));
  if (ga < 0 || gb < 0 || ga === gb) return groups;
  return groups.map((g, i) => (i === ga ? g.map((x) => (x === a ? b : x)) : i === gb ? g.map((x) => (x === b ? a : x)) : g));
}

/** The rows to save for a round: one per group, numbered from 1, with tee times. */
export function rowsToSave(roundId, groups, times) {
  const tt = teeTimes(groups.length, times);
  return groups.map((ids, i) => ({ round_id: roundId, group_no: i + 1, tee_time: tt[i].tee_time, start_hole: tt[i].start_hole, player_ids: ids }));
}

// ------------------------------------------------------------------ Showing them
/** When a group goes: "8:16", "8:00 · hole 3", or "Group 2". */
export function groupWhen(row) {
  const t = showTime(row.tee_time);
  if (row.start_hole != null) return `${t ? `${t} · ` : ''}hole ${row.start_hole}`;
  return t || `Group ${row.group_no}`;
}

/** "8:16 with Al, Bo and Cy" for the player in `rows`, or null if they aren't in a group. */
export function myGroupLine(rows, playerId, nameOf) {
  const row = (rows || []).find((r) => (r.player_ids || []).includes(playerId));
  if (!row) return null;
  const others = row.player_ids.filter((id) => id !== playerId).map(nameOf);
  const t = showTime(row.tee_time);
  const when = row.start_hole != null ? `${t ? `${t} shotgun, ` : ''}hole ${row.start_hole},` : t || `Group ${row.group_no}`;
  return others.length ? `${when} with ${joinNames(others)}` : `${when.replace(/,$/, '')} — just you`;
}

/** A tidy list for the group chat. */
export function shareTeeText({ round, rows, nameOf, courseName }) {
  const list = [...(rows || [])].sort((a, b) => a.group_no - b.group_no);
  const date = round?.play_date ? new Date(`${round.play_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const head = [`⛳ ${round?.name || 'Round'} — tee groups`, [courseName, date].filter(Boolean).join(' · ')].filter(Boolean);
  const shotgun = list.some((r) => r.start_hole != null);
  if (shotgun && list[0]?.tee_time) head.push(`Shotgun start ${showTime(list[0].tee_time)}`);
  const lines = list.map((r) => {
    const names = r.player_ids.map(nameOf).join(', ');
    if (shotgun) return `Hole ${r.start_hole}: ${names}`;
    return `${showTime(r.tee_time) || `Group ${r.group_no}`}  ${names}`;
  });
  return `${head.join('\n')}\n\n${lines.join('\n')}`;
}
