// "Bring your history" (AI import, wave 3): the pure parts of the confirm screen (screens/AiImport.jsx).
// The AI (ai-helper function, import mode) proposes players, past trips, winners, past handicaps and rules. Here we
// match each one against what the group already has ("Kurt → already a player", "BD Trophy → existing trophy",
// "2019 Hunter → new past trip"), untick the ones already there, and turn the ticked ones into the rows the app's
// existing paths take: admin_create_player, trips, import_honours, import_handicaps and import_rules.
// Also: reading an uploaded file in the browser (.txt .csv .md, and .docx / .xlsx without a library) and the size a
// photo is shrunk to before it's sent.
import { matchPlayers, sameHonour, winnerNames } from './history.js';
import { readReply } from './aihelper.js';

export const MAX_TEXT = 200_000; // characters (~200 KB)
export const MAX_PHOTOS = 4;
export const PHOTO_MAX_PX = 1600;
export const IMPORT_EXAMPLE = 'BD Trophy\n2019 Hunter Valley — Kurt & Bluey (44 pts)\n2018 Bowral — Sammy\n\nFines: $5 for a lost ball off the tee';

const low = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const words = (s) => low(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w));
const yearOfDate = (d) => (d ? Number(String(d).slice(0, 4)) : null);

// ------------------------------------------------------------------ Matching against the group

// Common short forms of first names (Josh = Joshua, Rob = Robert = Bob …). Each list is one name.
const SHORT_FORMS = [
  ['joshua', 'josh'], ['michael', 'mike', 'mick'], ['christopher', 'chris'], ['matthew', 'matt'], ['david', 'dave'],
  ['thomas', 'tom'], ['daniel', 'dan', 'danny'], ['nicholas', 'nick'], ['robert', 'rob', 'bob', 'robbie'],
  ['william', 'will', 'bill'], ['james', 'jim', 'jimmy'], ['andrew', 'andy'], ['anthony', 'tony'], ['benjamin', 'ben'],
  ['samuel', 'sam'], ['alexander', 'alex'], ['peter', 'pete'], ['stephen', 'steve', 'steven'], ['jonathan', 'jono'],
];
const FORM = new Map(SHORT_FORMS.flatMap((g) => g.map((n) => [n, g[0]])));
/** A first name in its long form ("josh" → "joshua"), so short and long forms compare equal. */
export const firstForm = (n) => FORM.get(low(n)) || low(n);
/** A name's words, lower case, punctuation gone ("O'Brien, Kurt" → ["obrien", "kurt"]). */
const nameWords = (s) => low(s).replace(/[^a-z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean);

/**
 * How an imported name matches the group's players:
 *   { player, sure: true }  — the same full name; the same nickname; or a lone first name / nickname only one has
 *   { player, sure: false } — likely but not certain: first name + surname with a short form (Josh Moran → Joshua
 *                             Moran), the same surname and first initial, or a first name matching a player who has no
 *                             surname yet ("Mike Morris" → "Mike")
 *   null                    — someone new
 * Only one candidate counts: two possibles are treated as nobody (the organiser picks).
 */
export function matchPlayer(name, nickname, players = []) {
  const n = low(name);
  const nick = low(nickname);
  const one = (list) => (list.length === 1 ? list[0] : null);
  if (!n && !nick) return null;
  // 1. The same full name.
  let hit = one(players.filter((p) => low(p.name) === n));
  if (hit) return { player: hit, sure: true };
  // 2. The same nickname (either way round: their nickname is my name, or my nickname is their name or nickname).
  const keys = [n, nick].filter(Boolean);
  hit = one(players.filter((p) => (p.nickname && keys.includes(low(p.nickname))) || (nick && low(p.name) === nick)));
  if (hit) return { player: hit, sure: true };
  const w = nameWords(name);
  // 3. A lone first name (or nickname): only when exactly one player has it.
  if (w.length === 1) {
    hit = one(players.filter((p) => nameWords(p.name)[0] === w[0] || low(p.nickname) === w[0]));
    if (hit) return { player: hit, sure: true };
    // …or as a short form ("Josh" → the only Joshua): likely.
    hit = one(players.filter((p) => firstForm(nameWords(p.name)[0]) === firstForm(w[0])));
    return hit ? { player: hit, sure: false } : null;
  }
  if (w.length < 2) return null;
  const first = w[0];
  const last = w[w.length - 1];
  const withSurname = players.filter((p) => nameWords(p.name).length >= 2 && nameWords(p.name).at(-1) === last);
  // 4. First name (or their nickname) + surname, with short forms: likely.
  hit = one(withSurname.filter((p) => firstForm(nameWords(p.name)[0]) === firstForm(first) || (p.nickname && firstForm(p.nickname) === firstForm(first))));
  if (hit) return { player: hit, sure: false };
  // 5. The same surname and first initial (J. Moran, Jo Moran): likely.
  hit = one(withSurname.filter((p) => nameWords(p.name)[0][0] === first[0]));
  if (hit) return { player: hit, sure: false };
  // 6. A player with no surname yet whose name or nickname is this first name ("Mike Morris" → "Mike"): likely.
  hit = one(players.filter((p) => nameWords(p.name).length === 1 && [p.name, p.nickname].filter(Boolean).some((x) => firstForm(x) === firstForm(first))));
  if (hit) return { player: hit, sure: false };
  return null;
}

/** An existing player for a name, only when it's certain (see matchPlayer): full name, nickname, or a lone first
 *  name only one player has ("Kurt" finds Kurt Dahl / nickname Kurt). */
export function findPlayer(name, nickname, players = []) {
  const m = matchPlayer(name, nickname, players);
  return m?.sure ? m.player : null;
}

/** A name's player: what the organiser chose on the confirm screen first (aliases: lower-case name → id), else a
 *  certain match. */
export function resolvePlayer(name, players = [], aliases = {}) {
  const id = aliases[low(name)];
  if (id) return players.find((p) => p.id === id) || null;
  return findPlayer(name, null, players);
}

// ------------------------------------------------------------------ Trophies

const TROPHY_FILLER = new Set(['the', 'trophy', 'cup', 'shield', 'award', 'awards', 'plate', 'medal']);
/** A trophy's name for matching: lower case, no punctuation, without "the / trophy / cup / shield / award". */
export function trophyKey(name) {
  const w = low(name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const core = w.filter((x) => !TROPHY_FILLER.has(x));
  return (core.length ? core : w).join(' ');
}
/** The group's trophy for an imported trophy name: the same name, then the same without the filler words
 *  ("BD Trophy" → "BD"), then one inside the other ("The Spoon" → "Wooden Spoon"). Only one may match. */
export function matchTrophy(name, names = []) {
  const exact = names.filter((t) => low(t) === low(name));
  if (exact.length === 1) return exact[0];
  const k = trophyKey(name);
  if (!k) return null;
  const same = names.filter((t) => trophyKey(t) === k);
  if (same.length === 1) return same[0];
  if (same.length > 1) return null;
  const inside = (a, b) => ` ${a} `.includes(` ${b} `);
  const near = names.filter((t) => { const tk = trophyKey(t); return tk && (inside(tk, k) || inside(k, tk)); });
  return near.length === 1 ? near[0] : null;
}

/** An existing trip for a past trip: the same name, or the same year with a word in common (place or name). */
export function findTrip(t, trips = []) {
  const byName = trips.filter((x) => low(x.name) === low(t.name));
  if (byName.length === 1) return byName[0];
  const ws = new Set([...words(t.name), ...words(t.place)]);
  const near = trips.filter((x) => (yearOfDate(x.start_date) === t.year || String(x.name || '').includes(String(t.year)))
    && words(x.name).some((w) => ws.has(w)));
  return near.length === 1 ? near[0] : null;
}

/** The group's trophy names: its trophies and every name on its honour boards. */
export function trophyNames(trophies = [], board = []) {
  const m = new Map();
  for (const t of trophies) if (t?.name) m.set(low(t.name), t.name);
  for (const h of board) if (h?.trophy_name && !m.has(low(h.trophy_name))) m.set(low(h.trophy_name), h.trophy_name);
  return m;
}

/** The honour board label for a winner: the trip's name when it has the year in it ("Hunter 2019"), else the
 *  trip plus the year, else just the year. At most 30 letters (the board's limit), always with the year. */
export function honourLabel(w, tripName = w.trip) {
  const y = String(w.year);
  const t = String(tripName || '').trim();
  if (t && t.includes(y) && t.length <= 30) return t;
  if (t && `${t} ${y}`.length <= 30) return `${t} ${y}`;
  return y;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hcpText = (h) => (h < 0 ? `+${-h}` : String(h));

/**
 * The confirm screen's items, each with a tick (on unless it's already there) and how it matches the group:
 *   { id, section, label, detail, match, already, ticked, data }
 * `group` = { players, trips, trophies, honour_board, rules, handicaps (imported ones: { player_id, date, handicap }) }.
 */
export function buildReview(proposal, group = {}) {
  const p = proposal || {};
  const players = group.players || [];
  const trips = group.trips || [];
  const board = group.honour_board || [];
  const rules = group.rules || [];
  const trophies = trophyNames(group.trophies, board);
  const items = [];

  (p.players || []).forEach((x, i) => {
    const m = matchPlayer(x.name, x.nickname, players);
    items.push(playerItem({
      id: `pl${i}`, section: 'players', data: { name: x.name, nickname: x.nickname || '' }, guess: !!x.guess,
      candidateId: m?.player.id || null, sure: !!m?.sure, choice: m ? m.player.id : 'new', addNick: true,
    }, players));
  });
  (p.trips || []).forEach((x, i) => {
    const hit = findTrip(x, trips);
    items.push({
      id: `tr${i}`, section: 'trips', data: { name: x.name, year: x.year, place: x.place || '', courses: x.courses || [], start_date: x.start_date || null, end_date: x.end_date || null },
      match: hit ? `existing trip${low(hit.name) !== low(x.name) ? ` (${hit.name})` : ''}` : 'new past trip',
      existingId: hit?.id || null, already: !!hit, ticked: !hit && !x.guess, guess: !!x.guess,
    });
  });
  const trophyList = [...trophies.values()];
  (p.winners || []).forEach((x, i) => {
    const known = matchTrophy(x.trophy, trophyList);
    items.push(winnerItem({
      id: `wn${i}`, section: 'winners', data: { trophy: x.trophy, year: x.year, trip: x.trip || '', winners: x.winners, score: x.score || '' },
      guess: !!x.guess, trophyChoice: known || '', trophyOptions: trophyList,
    }, board));
  });
  (p.handicaps || []).forEach((x, i) => {
    // A likely player ("Josh Moran" → Joshua Moran) counts for "already there"; who it's saved on follows the
    // organiser's answer in the players section (playerAliases) or a certain match.
    const m = matchPlayer(x.player, null, players);
    const hit = m?.player || null;
    const already = !!hit && (group.handicaps || []).some((h) => h.player_id === hit.id && h.date === x.date && Number(h.handicap) === Number(x.handicap));
    items.push({
      id: `hc${i}`, section: 'handicaps', data: { player: x.player, date: x.date, handicap: x.handicap },
      match: already ? 'already in their history' : hit ? `${hit.name}’s history${m.sure ? '' : '?'}` : 'a new player’s history',
      existingId: hit?.id || null, already, ticked: !already && !x.guess, guess: !!x.guess,
    });
  });
  (p.rules || []).forEach((x, i) => {
    const already = rules.some((r) => (r.status === 'active' || r.status === 'proposed') && low(r.title) === low(x.title));
    // The wording only when it says more than the title (an older function sent the title again underneath).
    const wording = bareWords(x.wording) && bareWords(x.wording) !== bareWords(x.title) ? x.wording : '';
    items.push({
      id: `ru${i}`, section: 'rules', data: { title: x.title, wording, category: x.category || 'other', value: x.value || '' },
      match: already ? 'already in the Rulebook' : 'new rule', already, ticked: !already && !x.guess, guess: !!x.guess,
    });
  });
  return items;
}

const bareWords = (s) => low(s).replace(/[^a-z0-9$%+-]+/g, ' ').trim();

/** A player item's match words and tick, from the organiser's choice (an existing player's id, or 'new'):
 *   - certain match, nothing to add → "already a player", unticked (nothing to do);
 *   - likely match → "Is this Joshua Moran?" with a picker (that player picked; "someone new" is the other choice);
 *   - an existing player with no nickname yet, and one in the import → "add nickname Macca" (ticked: it's saved);
 *   - someone new → "new player", ticked (unless it was a guess).
 * `players` are the group's players. */
export function playerItem(it, players = []) {
  const chosen = it.choice && it.choice !== 'new' ? players.find((p) => p.id === it.choice) || null : null;
  const candidate = it.candidateId ? players.find((p) => p.id === it.candidateId) || null : null;
  const nick = String(it.data.nickname || '').trim();
  const canAddNick = !!chosen && !String(chosen.nickname || '').trim() && !!nick
    && ![chosen.name, ...String(chosen.name).split(/\s+/)].some((x) => low(x) === low(nick));
  const ask = candidate && !it.sure ? `Is this ${candidate.name}?` : '';
  let match;
  if (!chosen) match = candidate && !it.sure ? 'someone new' : 'new player';
  else if (canAddNick && it.addNick) match = `${chosen.name} · add nickname ${nick}`;
  else match = `already a player${low(chosen.name) !== low(it.data.name) ? ` (${chosen.name})` : ''}`;
  const work = !chosen || (canAddNick && it.addNick); // something to save
  return {
    ...it, ask, match, canAddNick, nickToAdd: canAddNick ? nick : '',
    existingId: chosen?.id || null, already: !work,
    // Ticked when there’s something to save, except a guess (the organiser decides on those).
    ticked: work && !it.guess,
  };
}

/** The trophy an imported winner goes on: the organiser's pick (an existing trophy), else the name as written. */
export const trophyOf = (it) => it.trophyChoice || it.data.trophy;

/** A winner item's match words and tick: "existing trophy BD" or "new trophy", or already on the honour board. */
export function winnerItem(it, board = []) {
  const x = it.data;
  const trophy = trophyOf(it);
  const label = honourLabel(x);
  const already = board.some((h) => sameHonour({ trophy, label, winners: x.winners }, h))
    || board.some((h) => low(h.trophy_name) === low(trophy) && String(h.label).includes(String(x.year)) && low(h.winner_names) === low(x.winners));
  return {
    ...it,
    match: already ? 'already on the honour board' : it.trophyChoice ? `existing trophy ${it.trophyChoice}` : 'new trophy',
    already, ticked: !already && !it.guess,
  };
}

export const SECTIONS = [
  { key: 'players', title: 'Players', icon: '👥' },
  { key: 'trips', title: 'Past trips', icon: '🧳' },
  { key: 'winners', title: 'Trophies & winners', icon: '🏆' },
  { key: 'handicaps', title: 'Past handicaps', icon: '📈' },
  { key: 'rules', title: 'Rules', icon: '📜' },
];

/** One line for an item on the confirm screen. */
export function itemLine(it) {
  const d = it.data;
  if (it.section === 'players') return d.nickname ? `${d.name} (“${d.nickname}”)` : d.name;
  if (it.section === 'trips') return [d.name, d.start_date ? '' : `${d.year} (date unknown)`, d.place && !low(d.name).includes(low(d.place)) ? d.place : '', d.courses?.length ? d.courses.join(', ') : ''].filter(Boolean).join(' · ');
  if (it.section === 'winners') return `${trophyOf(it)} ${honourLabel(d)} — ${d.winners}${d.score ? ` (${d.score})` : ''}`;
  if (it.section === 'handicaps') return `${d.player} · ${hcpText(d.handicap)} · ${d.date.endsWith('-01-01') ? d.date.slice(0, 4) : d.date}`;
  return d.value ? `${d.title} (${d.value})` : d.title;
}

// ------------------------------------------------------------------ "Add these": the rows to write

/** Ticked items that aren't already there, by section. */
export function picked(items) {
  const out = { players: [], trips: [], winners: [], handicaps: [], rules: [] };
  for (const it of items) if (it.ticked && out[it.section]) out[it.section].push(it);
  return out;
}

/** Can a handicap be saved: its player is in the group, or is a ticked new player? */
export function handicapPlayer(h, players, newPlayers, aliases = {}) {
  return resolvePlayer(h.data.player, players, aliases)
    || newPlayers.find((n) => [n.data.name, n.data.nickname].filter(Boolean).some((x) => low(x) === low(h.data.player))) || null;
}

/** import_handicaps rows for the ticked handicaps, once every player is in the group (`players` includes the ones
 *  just made). Ones with no player by that name are skipped and counted. */
export function handicapRows(handicaps, players, aliases = {}) {
  const rows = [];
  let skipped = 0;
  for (const h of handicaps) {
    const p = resolvePlayer(h.data.player, players, aliases);
    if (p) rows.push({ player_id: p.id, date: h.data.date, handicap: Number(h.data.handicap) });
    else skipped++;
  }
  return { rows, skipped };
}

/** A new player's starting handicap: the latest from the ticked history, else 18 (the app's usual default). */
export function startingHandicap(player, handicaps) {
  const mine = handicaps.filter((h) => [player.data.name, player.data.nickname].filter(Boolean).some((x) => low(x) === low(h.data.player)))
    .sort((a, b) => b.data.date.localeCompare(a.data.date));
  return mine.length ? Number(mine[0].data.handicap) : 18;
}

/** A past trip row for the trips table: locked (it's over), dated from what's known. With only a year it's saved as
 *  1 January of that year (so it sorts by year and, being locked, never becomes the current trip); the app shows
 *  such a trip as "2019 (date unknown)" (isYearOnly in trips.js). */
export function tripRow(t) {
  const start = t.data.start_date || `${t.data.year}-01-01`;
  return { name: String(t.data.name).trim().slice(0, 60), start_date: start, end_date: t.data.end_date || start, status: 'locked' };
}

/** import_honours rows for the ticked winners, matched to players (after the new ones exist) and trips. */
export function honourRows(winners, players, trips, aliases = {}) {
  return winners.map((w) => {
    const d = w.data;
    const trip = d.trip ? (trips.find((t) => low(t.name) === low(d.trip)) || findTrip({ name: d.trip, year: d.year }, trips)) : null;
    // Each winner name: an exact name / nickname match, or a first-name match when it's the only one.
    const ids = [];
    for (const n of winnerNames(d.winners)) {
      const hit = resolvePlayer(n, players, aliases);
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    const exact = matchPlayers(d.winners, players);
    return {
      label: honourLabel(d, trip?.name || d.trip), trophy: String(trophyOf(w)).trim().slice(0, 60), winners: String(d.winners).trim().slice(0, 200),
      player_ids: ids.length >= exact.length ? ids : exact, trip_id: trip?.id || null,
    };
  });
}

/** import_rules rows. */
export function ruleRows(rules) {
  return rules.map((r) => ({ title: String(r.data.title).trim().slice(0, 80), detail: String(r.data.wording || '').trim().slice(0, 1000) || null, category: r.data.category || 'other', value: String(r.data.value || '').trim().slice(0, 40) || null }));
}

/** "Added 6 players, 3 past trips, 14 winners and 9 rules" (only what was added). */
export function summaryLine(n) {
  const parts = [
    n.players ? plural(n.players, 'player') : '',
    n.nicknames ? plural(n.nicknames, 'nickname') : '',
    n.trips ? plural(n.trips, 'past trip') : '',
    n.winners ? plural(n.winners, 'winner') : '',
    n.handicaps ? plural(n.handicaps, 'past handicap') : '',
    n.rules ? plural(n.rules, 'rule') : '',
    n.proposed ? `${plural(n.proposed, 'rule')} up for a vote` : '',
  ].filter(Boolean);
  if (!parts.length) return 'Nothing new to add — it’s all there already.';
  return `Added ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}`;
}

/** What the function said: { kind: 'import', proposal, found } for a proposal, else the helper's usual reply
 *  (error / message), from readReply in aihelper.js. */
export function readImportReply(data, error) {
  if (!error && data && typeof data === 'object' && data.import && typeof data.import === 'object') {
    const p = data.import;
    const list = (k) => (Array.isArray(p[k]) ? p[k] : []);
    const proposal = { players: list('players'), trips: list('trips'), winners: list('winners'), handicaps: list('handicaps'), rules: list('rules'), unsure: list('unsure'), dropped: Number(p.dropped) || 0 };
    return { kind: 'import', proposal, found: Number(data.found) || 0, remaining: data.remaining || null, ...(data.log_id != null ? { logId: data.log_id } : {}) };
  }
  return readReply(data, error);
}

// ------------------------------------------------------------------ Files and photos

/** What kind of file this is for reading in the browser: 'text', 'docx', 'xlsx', or null (not readable). */
export function fileKind(name) {
  const n = String(name || '').toLowerCase();
  if (/\.(txt|csv|tsv|md|markdown|text)$/.test(n)) return 'text';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** Cut text to the limit, saying so. */
export function capText(text) {
  const t = String(text ?? '');
  return t.length > MAX_TEXT ? { text: t.slice(0, MAX_TEXT), cut: true } : { text: t, cut: false };
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => String(s).replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENT[e.toLowerCase()]));

/** The words of a Word document's word/document.xml: one line per paragraph, tabs kept. */
export function docxText(xml) {
  return String(xml || '')
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .split('\n').map((l) => unxml(l).replace(/[  ]+/g, ' ').replace(/\t+$/, '').trim()).filter(Boolean).join('\n');
}

/** A spreadsheet's first sheet as tab-separated lines, from xl/sharedStrings.xml and xl/worksheets/sheet1.xml. */
export function xlsxText(sheetXml, sharedXml = '') {
  const shared = [...String(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows = [];
  for (const row of String(sheetXml || '').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || '')?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2] || '')?.[1];
      const val = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? unxml(inline ?? '') : unxml(v ?? '');
      while (cells.length < col) cells.push('');
      cells[col] = val;
    }
    if (cells.some((x) => String(x).trim())) rows.push(cells.join('\t').replace(/\t+$/, ''));
  }
  return rows.join('\n');
}

/** The files inside a .docx / .xlsx (a zip), read with the browser's own DecompressionStream — no library. */
export async function unzip(buffer, wanted) {
  const b = new Uint8Array(buffer);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let k = 0; k < count && p + 46 <= b.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = b.subarray(start, start + size);
    if (method === 0) out[name] = new TextDecoder().decode(data);
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[name] = await new Response(stream).text();
    }
  }
  return out;
}

/** An uploaded file's text, read in the browser. { text, cut } or { error } in plain words. */
export async function readFileText(file) {
  const kind = fileKind(file?.name);
  if (!kind) return { error: 'That kind of file can’t be read here — open it, copy the text and paste it in.' };
  if (file.size > 10_000_000) return { error: 'That file is too big — copy and paste the part with the history.' };
  try {
    if (kind === 'text') return capText(await file.text());
    if (typeof DecompressionStream === 'undefined') return { error: 'This phone can’t open that file — copy and paste the text instead.' };
    const buf = await file.arrayBuffer();
    if (kind === 'docx') {
      const f = await unzip(buf, ['word/document.xml']);
      if (!f['word/document.xml']) throw new Error('no document');
      return capText(docxText(f['word/document.xml']));
    }
    const f = await unzip(buf, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
    if (!f['xl/worksheets/sheet1.xml']) throw new Error('no sheet');
    return capText(xlsxText(f['xl/worksheets/sheet1.xml'], f['xl/sharedStrings.xml'] || ''));
  } catch {
    return { error: 'Couldn’t read that file — open it, copy the text and paste it in.' };
  }
}

/** The size to shrink a photo to: the longest side at most `max` pixels, never bigger than it was. */
export function fitSize(w, h, max = PHOTO_MAX_PX) {
  const W = Math.max(1, Math.round(Number(w) || 1));
  const H = Math.max(1, Math.round(Number(h) || 1));
  const s = Math.min(1, max / Math.max(W, H));
  return { width: Math.max(1, Math.round(W * s)), height: Math.max(1, Math.round(H * s)) };
}

/** An item after it's been edited on the confirm screen: matched again (and unticked if it's now already there). */
export function rematch(item, group) {
  const d = item.data;
  const one = {
    players: { players: [{ name: d.name, nickname: d.nickname || null }] },
    trips: { trips: [{ ...d, year: Number(d.year) }] },
    winners: { winners: [{ ...d, year: Number(d.year) }] },
    handicaps: { handicaps: [{ ...d, handicap: Number(d.handicap) }] },
    rules: { rules: [d] },
  }[item.section];
  const fresh = buildReview(one, group)[0];
  if (!fresh) return item;
  if (item.section === 'players') {
    // Matched again from the new name; the tick follows (something to save → ticked).
    return { ...fresh, id: item.id, guess: item.guess, ticked: fresh.already ? false : (item.guess ? item.ticked : fresh.ticked) };
  }
  if (item.section === 'winners') {
    // A trophy the organiser picked stays picked.
    const next = winnerItem({ ...item, data: { ...item.data, ...fresh.data }, trophyChoice: item.trophyPicked ? item.trophyChoice : fresh.trophyChoice, trophyOptions: fresh.trophyOptions }, group.honour_board || []);
    return { ...next, ticked: next.already ? false : item.ticked };
  }
  return { ...item, data: { ...item.data, ...fresh.data }, match: fresh.match, existingId: fresh.existingId || null, already: fresh.already, ticked: fresh.already ? false : item.ticked };
}

/** The organiser picked who a player is on the confirm screen ('new', or an existing player's id). */
export function choosePlayer(item, choice, players = []) {
  return playerItem({ ...item, choice }, players);
}
/** The organiser ticked / unticked "add nickname". */
export function chooseNickname(item, addNick, players = []) {
  return playerItem({ ...item, addNick }, players);
}
/** The organiser picked a trophy for a winner ('' = a new trophy by the name as written). */
export function chooseTrophy(item, trophyChoice, board = []) {
  const next = winnerItem({ ...item, trophyChoice, trophyPicked: true }, board);
  return { ...next, ticked: next.already ? false : (item.already ? true : item.ticked) };
}

/** Names → player ids from the organiser's choices on the players section (incl. ones just made), so handicaps and
 *  winners written under that name go to the same player. `made` = [{ itemId, id }]. */
export function playerAliases(items, made = []) {
  const out = {};
  for (const it of items) {
    if (it.section !== 'players') continue;
    const id = it.existingId || made.find((m) => m.itemId === it.id)?.id;
    if (!id) continue;
    for (const n of [it.data.name, it.data.nickname]) if (String(n || '').trim()) out[low(n)] = id;
  }
  return out;
}

/** Is an edited item still good enough to save? (Words for the screen, or '' when fine.) */
export function itemProblem(item, nextYear = new Date().getFullYear() + 1) {
  const d = item.data;
  const yearOk = (y) => Number.isInteger(Number(y)) && Number(y) >= 1950 && Number(y) <= nextYear;
  if (item.section === 'players') return String(d.name || '').trim().length < 2 ? 'Needs a name' : '';
  if (item.section === 'trips') return String(d.name || '').trim().length < 2 ? 'Needs a name' : !yearOk(d.year) ? 'Needs a year' : '';
  if (item.section === 'winners') return !String(d.trophy || '').trim() ? 'Needs the trophy' : !yearOk(d.year) ? 'Needs a year' : !String(d.winners || '').trim() ? 'Needs the winner(s)' : '';
  if (item.section === 'handicaps') {
    const h = Number(d.handicap);
    return !String(d.player || '').trim() ? 'Needs the player' : !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) ? 'Date as YYYY-MM-DD' : !(String(d.handicap).trim() !== '' && h >= -10 && h <= 54) ? 'Handicap −10 to 54' : '';
  }
  return String(d.title || '').trim().length < 2 ? 'Needs a name' : '';
}
