// Runs every walkthrough capture (in parallel, one Node process each), then writes MANIFEST.md and BUILDER-NOTES.md
// from their results. The app must already be built and served (see README in BUILDER-NOTES.md).
// Usage: node tests/walkthrough/run-all.mjs [only-these-scripts…]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReports } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const all = ['first-open.mjs', 'scenario-a.mjs', 'scenario-b.mjs', 'scenario-c.mjs', 'scenario-d.mjs'];
const pick = process.argv.slice(2).length ? process.argv.slice(2) : all;
const run = (f) => new Promise((done) => {
  const p = spawn(process.execPath, [path.join(here, f)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => { console.log(`== ${f} (exit ${code})\n${out.split('\n').filter((l) => !/^\s+\d\d-/.test(l)).join('\n')}`); done(code); });
});
await Promise.all(pick.map(run));
writeReports();
