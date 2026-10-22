#!/usr/bin/env node
// Course research → the database (088). Re-runnable: a newer CSV updates rows (by import_key), never duplicates.
//
//   node scripts/import-course-research.mjs <courses.csv> <region_guide.md> [outDir] [--chunk 40] [--library lib.json]
//
// Writes to outDir (default ./research-import):
//   payload.json          — { rows, guides } (what the database function takes)
//   sql/00-guides.sql     — select public.import_course_research('[]', <guides>)
//   sql/01-rows.sql …     — one file a chunk of rows: select public.import_course_research(<rows>, null)
//   summary.txt           — counts of what was parsed (fees, drive times, access types …)
// Each .sql file runs as the service role (it sets it for its own transaction), so it can be pasted into the Supabase
// SQL editor or run with the Supabase MCP's execute_sql. Run 00-guides.sql once and every rows file; each returns
// counts (exact / near / new / unmatched, plus the unmatched names). Josh: STAGING first, live only after his OK.
//
// --library lib.json: a dry run of the matching against an exported library ([{ id, name, area, lat, lng }]) —
// prints the counts without touching any database.
import fs from 'node:fs';
import path from 'node:path';
import { buildPayload, matchCourse } from './research/parse.js';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const chunk = Math.max(1, Math.min(200, Number(flag('--chunk', 40)) || 40));
const libFile = flag('--library', null);
const [csvPath, mdPath, outDir = 'research-import'] = args;
if (!csvPath || !mdPath) {
  console.error('Usage: node scripts/import-course-research.mjs <courses.csv> <region_guide.md> [outDir] [--chunk 40] [--library lib.json]');
  process.exit(1);
}

const payload = buildPayload(fs.readFileSync(csvPath, 'utf8'), fs.readFileSync(mdPath, 'utf8'));
fs.mkdirSync(path.join(outDir, 'sql'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'payload.json'), JSON.stringify({ rows: payload.rows, guides: payload.guides }, null, 1));

// Dollar-quoting with a tag that can't appear in the data.
const lit = (obj) => {
  const s = JSON.stringify(obj);
  let tag = 'cr';
  while (s.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${s}$${tag}$::jsonb`;
};
// The compact form the database also takes: { c: [column names], r: [[values] …] }, details as "d.<name>" columns.
// About a third smaller than a list of objects (the names aren't repeated on every row).
const compact = (rows) => {
  const cols = [];
  const seen = new Set();
  const flat = rows.map((r) => {
    const { details, ...top } = r;
    const o = { ...top };
    for (const [k, v] of Object.entries(details || {})) o[`d.${k}`] = v;
    for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return o;
  });
  return {
    c: cols,
    r: flat.map((o) => {
      const a = cols.map((k) => (o[k] === undefined || o[k] === '' ? null : o[k]));
      while (a.length && a[a.length - 1] === null) a.pop();
      return a;
    }),
  };
};
// One course a line; long guide text in pieces joined with || — easy to read, check and paste.
const tag = (s) => { let t = 'cr'; while (s.includes(`$${t}$`)) t += 'x'; return t; };
const dq = (s) => { const t = tag(s); return `$${t}$${s}$${t}$`; };
const pieces = (s, n = 900) => {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(dq(s.slice(i, i + n)));
  return out.length ? out.join('\n  || ') : "''";
};
const rowsLit = (c) => {
  const body = `{"c":${JSON.stringify(c.c)},\n"r":[\n${c.r.map((a) => JSON.stringify(a)).join(',\n')}\n]}`;
  return `${dq(body)}::jsonb`;
};
const guidesSql = (gs) => `jsonb_build_array(\n${gs.map((g) => `jsonb_build_object('key', ${dq(g.key)}, 'kind', ${dq(g.kind)}, 'title', ${dq(g.title)}, 'state', ${g.state ? dq(g.state) : 'null'}, 'sort', ${Number(g.sort) || 0},\n 'regions', ${lit(g.regions)},\n 'body', ${pieces(g.body)})`).join(',\n')})`;
const asService = `set local role service_role;\nset local request.jwt.claims to '{"role":"service_role"}';\n`;
fs.writeFileSync(path.join(outDir, 'sql', '00-guides.sql'), `begin;\n${asService}select public.import_course_research('[]'::jsonb, ${guidesSql(payload.guides)});\ncommit;\n`);
const files = [];
for (let i = 0; i < payload.rows.length; i += chunk) {
  const name = `${String(files.length + 1).padStart(2, '0')}-rows.sql`;
  fs.writeFileSync(path.join(outDir, 'sql', name), `begin;\n${asService}select public.import_course_research(${rowsLit(compact(payload.rows.slice(i, i + chunk)))}, null);\ncommit;\n`);
  files.push(name);
}

const count = (f) => payload.rows.filter(f).length;
const by = (k) => payload.rows.reduce((m, r) => ((m[r[k] ?? '—'] = (m[r[k] ?? '—'] || 0) + 1), m), {});
const lines = [
  `Rows: ${payload.rows.length} (skipped ${payload.skipped.length}${payload.skipped.length ? ': ' + payload.skipped.join(', ') : ''})`,
  `Guides: ${payload.guides.length} — ${payload.guides.map((g) => `${g.key}${g.regions.length ? ` (${g.regions.length} regions)` : ''}`).join(', ')}`,
  `Weekday fee parsed: ${count((r) => r.fee_weekday != null)} · weekend fee: ${count((r) => r.fee_weekend != null)}`,
  `Drive hours parsed: ${count((r) => r.drive_from_sydney_hours != null)} · holes: ${count((r) => r.holes != null)} · par: ${count((r) => r.par != null)}`,
  `Good for groups: ${count((r) => r.good_for_groups != null)} · cart required known: ${count((r) => r.cart_required != null)} · last checked: ${count((r) => r.last_checked)}`,
  `Access types: ${JSON.stringify(by('access_type'))}`,
  `Booking link: ${count((r) => r.booking_url)} · group enquiry link: ${count((r) => r.group_enquiry_url)} · website: ${count((r) => r.website)} · phone: ${count((r) => r.phone)}`,
  `SQL files: 00-guides.sql + ${files.length} rows files of up to ${chunk}`,
];
const unplaced = payload.guides.filter((g) => g.kind === 'region' && !g.regions.length).map((g) => g.title);
if (unplaced.length) lines.push(`Region sections with no dataset regions: ${unplaced.join('; ')}`);

if (libFile) {
  const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
  const res = { exact: 0, near: 0, new: 0, unmatched: 0 };
  const unmatched = [];
  for (const r of payload.rows) {
    const m = matchCourse(r, lib);
    res[m.match]++;
    if (m.match === 'unmatched') unmatched.push(`${r.name} (${r.town || '?'} ${r.state})`);
  }
  lines.push(`Dry-run matching: ${JSON.stringify(res)}`, ...unmatched.map((u) => `  unmatched: ${u}`));
}
fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
