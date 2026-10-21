// Paste from a spreadsheet (Stage 11c, full desktop): turn what someone copied out of Excel, Google Sheets or a
// scorecard into rows we can show in a preview before anything is saved. Pure functions, tested in paste.test.js.
//
// Plain words:
//   - A copied block of cells arrives as lines with tabs between the cells. A CSV file has commas (and "quotes"
//     around cells that have commas in them). We read both, and plain lines with spaces too ("Josh M 14.2").
//   - Players: name, then (optionally) nickname, then handicap. A first line with headings ("Name, Handicap") is
//     used to find the columns. Each row is shown as new, a handicap change, the same as now, or a problem.
//   - Course scorecards: the Par and Index (stroke index, "SI", "Hcp") rows across the card, with or without the
//     Out / In / Total columns; or one line per hole ("1, 4, 7"). The result is 9 or 18 holes with a par and an SI.
import { readHandicap } from './history.js';

/** Which character separates the cells: tab (spreadsheets), comma or semicolon (CSV), else spaces. */
export function detectDelimiter(text) {
  const t = String(text || '');
  if (t.includes('\t')) return '\t';
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const commas = lines.filter((l) => l.includes(',')).length;
  const semis = lines.filter((l) => l.includes(';')).length;
  if (commas && commas >= semis) return ',';
  if (semis) return ';';
  return ' ';
}

/** One line into cells, with CSV quotes ("Smith, J") respected. Spaces as the separator: runs of spaces count once. */
export function splitLine(line, delim) {
  if (delim === ' ') return String(line).trim().split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  let q = false;
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"' && cur.trim() === '') { q = true; cur = ''; } else if (c === delim) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The whole paste as rows of cells (blank lines dropped). Each row keeps its line number for messages. */
export function parseTable(text, delim = detectDelimiter(text)) {
  return String(text || '').split(/\r?\n/).map((raw, i) => ({ n: i + 1, raw: raw.trim(), cells: splitLine(raw, delim) }))
    .filter((r) => r.raw && r.cells.some((c) => c !== ''));
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const HEAD = {
  name: /^(name|player|full name|golfer)$/,
  nickname: /^(nick|nickname|nick name|known as)$/,
  handicap: /^(handicap|hcp|h\/cap|hcap|ga|ga handicap|index|handicap index|daily handicap)$/,
};

/**
 * Players pasted from a spreadsheet.
 * players: the group's players now ({ id, name, nickname, handicap }).
 * Returns { rows, problems, counts } — each row { n, name, nickname, handicap, status, player_id?, old?, problem? }
 *   status: 'new' (will be added), 'update' (handicap changes), 'same' (nothing to do), 'problem' (skipped)
 */
export function parsePlayers(text, players = []) {
  const table = parseTable(text);
  const rows = [];
  if (!table.length) return { rows, problems: [], counts: { new: 0, update: 0, same: 0, problem: 0 } };
  // A heading line: find the columns by name.
  let cols = null;
  const first = table[0].cells.map(norm);
  if (first.some((c) => HEAD.name.test(c)) || (first.some((c) => HEAD.handicap.test(c)) && !first.some((c) => readHandicap(c) != null))) {
    cols = {};
    first.forEach((c, i) => { for (const [k, re] of Object.entries(HEAD)) if (re.test(c) && cols[k] == null) cols[k] = i; });
    if (cols.name == null) cols.name = 0;
    table.shift();
  }
  const seen = new Map();
  for (const { n, cells } of table) {
    let name; let nickname = null; let hText = '';
    if (cols) {
      name = cells[cols.name] || '';
      nickname = cols.nickname != null ? cells[cols.nickname] || null : null;
      hText = cols.handicap != null ? cells[cols.handicap] || '' : '';
    } else if (cells.length === 1 || detectDelimiter(text) === ' ') {
      // "Josh M 14.2" or just "Josh M": the last word is the handicap if it's a number.
      const words = cells.length === 1 ? cells[0].split(/\s+/) : cells;
      const last = words[words.length - 1];
      if (words.length > 1 && readHandicap(last) != null) { hText = last; name = words.slice(0, -1).join(' '); } else name = words.join(' ');
    } else {
      // name, handicap  — or name, nickname, handicap
      const last = cells[cells.length - 1];
      if (readHandicap(last) != null || /^[+-]?\d/.test(last)) {
        hText = last;
        name = cells[0];
        if (cells.length >= 3) nickname = cells[1] || null;
      } else {
        name = cells[0];
        nickname = cells[1] || null;
      }
    }
    name = String(name || '').replace(/\s+/g, ' ').trim();
    const row = { n, name, nickname: nickname ? nickname.trim() : null, handicap: null, status: 'new' };
    if (!name) { rows.push({ ...row, status: 'problem', problem: `Line ${n}: no name` }); continue; }
    if (hText !== '') {
      const h = readHandicap(hText);
      if (h == null) { rows.push({ ...row, status: 'problem', problem: `Line ${n}: a handicap of “${hText}” doesn’t look right (a number from −10 to 54; write a plus handicap as +2)` }); continue; }
      row.handicap = h;
    }
    const key = norm(name);
    if (seen.has(key)) { rows.push({ ...row, status: 'problem', problem: `Line ${n}: ${name} is already on line ${seen.get(key)}` }); continue; }
    seen.set(key, n);
    const hits = players.filter((p) => [p.name, p.nickname].filter(Boolean).some((x) => norm(x) === key));
    if (hits.length > 1) { rows.push({ ...row, status: 'problem', problem: `Line ${n}: more than one player is called “${name}”` }); continue; }
    if (hits.length === 1) {
      const p = hits[0];
      const dup = rows.find((x) => x.player_id === p.id);
      if (dup) { rows.push({ ...row, status: 'problem', problem: `Line ${n}: ${name} is ${p.name}, already on line ${dup.n}` }); continue; }
      row.player_id = p.id;
      row.old = p.handicap == null ? null : Number(p.handicap);
      row.status = row.handicap != null && row.handicap !== row.old ? 'update' : 'same';
    } else if (row.handicap == null) {
      row.note = 'No handicap — starts on 18';
    }
    rows.push(row);
  }
  const counts = { new: 0, update: 0, same: 0, problem: 0 };
  for (const r of rows) counts[r.status] += 1;
  return { rows, problems: rows.filter((r) => r.status === 'problem').map((r) => r.problem), counts };
}

// ------------------------------------------------------------------ Course scorecards

const isInt = (c) => /^\d{1,3}$/.test(String(c).trim());
const LABEL = {
  hole: /^(hole|holes|no\.?|#)$/,
  par: /^(par|pars)$/,
  si: /^(si|s\.i\.?|index|stroke index|stroke|hcp|handicap|h\/cap|idx)$/,
  out: /^(out|in|tot|total|net|gross)$/,
};

/** Drop the Out / In / Total cells from a run of numbers read across a card (21 → 18, 10 → 9). */
export function dropTotals(nums) {
  if (nums.length === 21) return nums.filter((_, i) => i !== 9 && i !== 19 && i !== 20);
  if (nums.length === 20) return nums.filter((_, i) => i !== 9 && i !== 19);
  if (nums.length === 19) return nums.slice(0, 18);
  if (nums.length === 11) return nums.slice(0, 9);
  if (nums.length === 10) return nums.slice(0, 9);
  return nums;
}

/**
 * A course scorecard pasted from a spreadsheet or a website.
 * Returns { holes: [{ n, par, si }], problems: [plain words] } — holes is empty when it couldn't be read.
 */
export function parseScorecard(text) {
  const table = parseTable(text);
  const problems = [];
  if (!table.length) return { holes: [], problems };
  const labelOf = (cells) => norm(cells.find((c) => !isInt(c)) || '');
  const numsOf = (cells) => cells.filter(isInt).map(Number);
  let pars = null;
  let sis = null;
  // One line per hole: every line has 2 or 3 numbers (hole, par, SI — or par, SI).
  const data = table.filter((r) => numsOf(r.cells).length > 0);
  const vertical = data.length >= 9 && data.every((r) => { const k = numsOf(r.cells).length; return k === 2 || k === 3; });
  if (vertical) {
    const hdr = table.find((r) => !numsOf(r.cells).length);
    let iPar = null; let iSi = null;
    if (hdr) hdr.cells.map(norm).forEach((c, i) => { if (LABEL.par.test(c)) iPar = i; if (LABEL.si.test(c)) iSi = i; });
    const rows = data.filter((r) => !LABEL.out.test(labelOf(r.cells)));
    pars = []; sis = [];
    for (const r of rows) {
      if (iPar != null && iSi != null) { pars.push(Number(r.cells[iPar])); sis.push(Number(r.cells[iSi])); continue; }
      const k = numsOf(r.cells);
      if (k.length === 3) { pars.push(k[1]); sis.push(k[2]); } else { pars.push(k[0]); sis.push(k[1]); }
    }
  } else {
    // Across the card: find the Hole, Par and Index rows by their labels (or by what the numbers look like).
    let holeCols = null;
    const holeRow = table.find((r) => LABEL.hole.test(labelOf(r.cells)));
    if (holeRow) holeCols = holeRow.cells.map((c, i) => (isInt(c) && Number(c) >= 1 && Number(c) <= 18 ? i : null)).filter((i) => i != null);
    const pick = (r) => (holeCols ? holeCols.map((i) => r.cells[i]).filter(isInt).map(Number) : dropTotals(numsOf(r.cells)));
    for (const r of table) {
      if (r === holeRow) continue;
      const lab = labelOf(r.cells);
      if (LABEL.par.test(lab) && !pars) pars = pick(r);
      else if (LABEL.si.test(lab) && !sis) sis = pick(r);
    }
    // No labels: a row of 3s, 4s and 5s is the par; a row with each number once is the index.
    if (!pars || !sis) {
      for (const r of table) {
        if (r === holeRow || LABEL.par.test(labelOf(r.cells)) || LABEL.si.test(labelOf(r.cells))) continue;
        const v = pick(r);
        if (v.length !== 9 && v.length !== 18) continue;
        if (!pars && v.every((x) => x >= 3 && x <= 6)) pars = v;
        else if (!sis && new Set(v).size === v.length && v.every((x) => x >= 1 && x <= 18)) sis = v;
      }
    }
  }
  if (!pars || !pars.length) return { holes: [], problems: ['Couldn’t find the pars — paste the Par row (and the Index row) from the card'] };
  if (!sis || !sis.length) return { holes: [], problems: ['Couldn’t find the stroke index — paste the Index (SI) row from the card too'] };
  const count = pars.length;
  if (count !== 9 && count !== 18) problems.push(`Found ${count} pars — a course has 9 or 18 holes`);
  if (sis.length !== count) problems.push(`Found ${count} pars but ${sis.length} stroke indexes`);
  pars.forEach((p, i) => { if (p < 3 || p > 6) problems.push(`Hole ${i + 1}: a par of ${p} doesn’t look right`); });
  const max = count === 9 ? 18 : count;
  const dupes = sis.filter((s, i) => sis.indexOf(s) !== i);
  if (dupes.length) problems.push(`Stroke index ${[...new Set(dupes)].join(', ')} is on more than one hole`);
  sis.forEach((s, i) => { if (s < 1 || s > max) problems.push(`Hole ${i + 1}: a stroke index of ${s} doesn’t look right`); });
  const holes = pars.map((par, i) => ({ n: i + 1, par, si: sis[i] }));
  return { holes, problems };
}
