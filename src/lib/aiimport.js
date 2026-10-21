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

/** An existing player for a name: full name or nickname, either way round ("Kurt" finds Kurt Dahl / nickname Kurt). */
export function findPlayer(name, nickname, players = []) {
  const keys = [low(name), low(nickname)].filter(Boolean);
  const hits = players.filter((p) => [p.name, p.nickname].filter(Boolean).some((n) => keys.includes(low(n))));
  if (hits.length === 1) return hits[0];
  // "Kurt" against "Kurt Dahl" (first name), only when it's the only one.
  const first = players.filter((p) => keys.some((k) => !k.includes(' ') && low(p.name).split(' ')[0] === k));
  return hits.length === 0 && first.length === 1 ? first[0] : null;
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
    const hit = findPlayer(x.name, x.nickname, players);
    items.push({
      id: `pl${i}`, section: 'players', data: { name: x.name, nickname: x.nickname || '' },
      match: hit ? `already a player${low(hit.name) !== low(x.name) ? ` (${hit.name})` : ''}` : 'new player',
      existingId: hit?.id || null, already: !!hit, ticked: !hit,
    });
  });
  (p.trips || []).forEach((x, i) => {
    const hit = findTrip(x, trips);
    items.push({
      id: `tr${i}`, section: 'trips', data: { name: x.name, year: x.year, place: x.place || '', courses: x.courses || [], start_date: x.start_date || null, end_date: x.end_date || null },
      match: hit ? `existing trip${low(hit.name) !== low(x.name) ? ` (${hit.name})` : ''}` : 'new past trip',
      existingId: hit?.id || null, already: !!hit, ticked: !hit,
    });
  });
  (p.winners || []).forEach((x, i) => {
    const known = trophies.get(low(x.trophy));
    const trophy = known || x.trophy;
    const label = honourLabel(x);
    const already = board.some((h) => sameHonour({ trophy, label, winners: x.winners }, h))
      || board.some((h) => low(h.trophy_name) === low(trophy) && String(h.label).includes(String(x.year)) && low(h.winner_names) === low(x.winners));
    items.push({
      id: `wn${i}`, section: 'winners', data: { trophy, year: x.year, trip: x.trip || '', winners: x.winners, score: x.score || '' },
      match: already ? 'already on the honour board' : known ? 'existing trophy' : 'new trophy',
      already, ticked: !already,
    });
  });
  (p.handicaps || []).forEach((x, i) => {
    const hit = findPlayer(x.player, null, players);
    const already = !!hit && (group.handicaps || []).some((h) => h.player_id === hit.id && h.date === x.date && Number(h.handicap) === Number(x.handicap));
    items.push({
      id: `hc${i}`, section: 'handicaps', data: { player: x.player, date: x.date, handicap: x.handicap },
      match: already ? 'already in their history' : hit ? `${hit.name}’s history` : 'a new player’s history',
      existingId: hit?.id || null, already, ticked: !already,
    });
  });
  (p.rules || []).forEach((x, i) => {
    const already = rules.some((r) => (r.status === 'active' || r.status === 'proposed') && low(r.title) === low(x.title));
    items.push({
      id: `ru${i}`, section: 'rules', data: { title: x.title, wording: x.wording || '', category: x.category || 'other', value: x.value || '' },
      match: already ? 'already in the Rulebook' : 'new rule', already, ticked: !already,
    });
  });
  return items;
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
  if (it.section === 'trips') return [d.name, d.place && !low(d.name).includes(low(d.place)) ? d.place : '', d.courses?.length ? d.courses.join(', ') : ''].filter(Boolean).join(' · ');
  if (it.section === 'winners') return `${d.trophy} ${honourLabel(d)} — ${d.winners}${d.score ? ` (${d.score})` : ''}`;
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
export function handicapPlayer(h, players, newPlayers) {
  return findPlayer(h.data.player, null, players)
    || newPlayers.find((n) => [n.data.name, n.data.nickname].filter(Boolean).some((x) => low(x) === low(h.data.player))) || null;
}

/** A new player's starting handicap: the latest from the ticked history, else 18 (the app's usual default). */
export function startingHandicap(player, handicaps) {
  const mine = handicaps.filter((h) => [player.data.name, player.data.nickname].filter(Boolean).some((x) => low(x) === low(h.data.player)))
    .sort((a, b) => b.data.date.localeCompare(a.data.date));
  return mine.length ? Number(mine[0].data.handicap) : 18;
}

/** A past trip row for the trips table: locked (it's over), dated from what's known (1 January of its year if not). */
export function tripRow(t) {
  const start = t.data.start_date || `${t.data.year}-01-01`;
  return { name: String(t.data.name).trim().slice(0, 60), start_date: start, end_date: t.data.end_date || start, status: 'locked' };
}

/** import_honours rows for the ticked winners, matched to players (after the new ones exist) and trips. */
export function honourRows(winners, players, trips) {
  return winners.map((w) => {
    const d = w.data;
    const trip = d.trip ? (trips.find((t) => low(t.name) === low(d.trip)) || findTrip({ name: d.trip, year: d.year }, trips)) : null;
    // Each winner name: an exact name / nickname match, or a first-name match when it's the only one.
    const ids = [];
    for (const n of winnerNames(d.winners)) {
      const hit = findPlayer(n, null, players);
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    const exact = matchPlayers(d.winners, players);
    return {
      label: honourLabel(d, trip?.name || d.trip), trophy: String(d.trophy).trim().slice(0, 60), winners: String(d.winners).trim().slice(0, 200),
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
  return { ...item, data: { ...item.data, ...fresh.data }, match: fresh.match, existingId: fresh.existingId || null, already: fresh.already, ticked: fresh.already ? false : item.ticked };
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
