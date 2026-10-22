// Writes walkthrough/MANIFEST.md (every shot in order, one neutral line each) and walkthrough/BUILDER-NOTES.md
// (what the run noticed, plus the builder's own observations in observations.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './shoot.mjs';
import { OBSERVATIONS, HOW_TO_RUN } from './observations.mjs';

const ORDER = ['0-first-open', 'A-lgc-long-weekend', 'B-multi-area', 'C-kurts-ryder-cup', 'D-weekend-falls-through'];

export function writeReports() {
  const results = ORDER.map((d) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, d, '_result.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
  const m = ['# Walkthrough — what each person sees', '',
    'Each line says who is looking, on what, and what they just did. Pictures are full-page unless a pop-up or sheet is open.',
    'Widths: 1440 = laptop, 375 = phone. Roles: organiser, keen player, quiet player (hasn’t replied or voted), late joiner (first time, from a link), guest.', ''];
  for (const r of results) {
    m.push(`## ${r.scenario} — ${r.title} (${r.shots.length} shots)`, '');
    for (const s of r.shots) m.push(`- \`${r.scenario}/${s.file}\` — ${s.line}`);
    m.push('');
  }
  fs.writeFileSync(path.join(OUT, 'MANIFEST.md'), m.join('\n'));
  const n = ['# Builder notes', '', HOW_TO_RUN, '', OBSERVATIONS, '', '## What the run logged', ''];
  for (const r of results) {
    n.push(`### ${r.scenario}`, '');
    if (!r.notes.length && !r.errors.length) n.push('- Nothing logged: every step was reached, no page or console errors.');
    for (const x of r.notes) n.push(`- ${x}`);
    const seen = new Set();
    for (const e of r.errors) {
      const k = `${e.who}|${e.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      n.push(`- Error (${e.who}, around shot ${String(e.at).padStart(2, '0')}): ${e.text}`);
    }
    n.push('');
  }
  fs.writeFileSync(path.join(OUT, 'BUILDER-NOTES.md'), n.join('\n'));
  console.log(`Wrote MANIFEST.md (${results.reduce((a, r) => a + r.shots.length, 0)} shots) and BUILDER-NOTES.md`);
}

if (process.argv[1] && process.argv[1].endsWith('report.mjs')) writeReports();
