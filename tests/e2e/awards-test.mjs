// Award moments browser check, 21 Oct 2026. Fake database only.
// Usage: node awards-test.mjs <base> <shotDir>   e.g. http://localhost:4311/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4311/lgc-golf/';
const SHOTS = process.argv[3] || './shots-awards';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const AL = '22222222-2222-4222-8222-222222222222';
const BO = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const now = '2026-10-21T08:00:00.000Z';
const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
// Kurt pars every hole (36 pts), Al bogeys every hole (18), Bo doubles every hole (0).
const fullScores = () => [[K, 0], [AL, 1], [BO, 2]].flatMap(([pid, over]) => holes.map((h) => ({
  id: crypto.randomUUID(), group_id: GROUP, round_id: R1, subject_id: pid, subject_type: 'player', hole: h.n, strokes: h.par + over, picked_up: false, updated_at: now,
})));

let db;
function reset({ awards = true, scores = fullScores() } = {}) {
  db = {
    players: [
      { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 0, approved: true, created_at: now, cup_side: null },
      { id: AL, name: 'Al Blue', nickname: null, handicap: 0, approved: true, created_at: now, cup_side: null },
      { id: BO, name: 'Bo Red', nickname: null, handicap: 0, approved: true, created_at: now, cup_side: null },
    ],
    trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: TODAY, end_date: TODAY, status: 'active', created_at: now }],
    trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
    round_players: [K, AL, BO].map((pid) => ({ id: crypto.randomUUID(), round_id: R1, player_id: pid, playing_handicap: 0 })),
    scores,
    courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
    rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday Stableford', play_date: TODAY, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [3], own_comps: [], comp_bonus: 0, created_at: now }],
    side_entries: [
      { id: crypto.randomUUID(), group_id: GROUP, round_id: R1, kind: 'ctp', hole: 3, player_id: AL, distance_m: 2.1, confirmed: false, created_at: now },
      { id: crypto.randomUUID(), group_id: GROUP, round_id: R1, kind: 'ctp', hole: 3, player_id: BO, distance_m: 4.5, confirmed: false, created_at: now },
    ],
    plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
    cup_sides: [], cup_matches: [], side_comp_defs: [], side_comp_entries: [], award_moments: [],
    group_features: ['feed', 'side_comps', ...(awards ? ['awards'] : [])].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
}
reset();
let organiser = true;
const posts = [];
const uploads = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
      if (v.startsWith('gte.') && String(r[k]) < v.slice(4)) return false;
    }
    return true;
  });
}
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (p.startsWith('/storage/v1/object/')) { uploads.push(p); return json({ Key: p.split('/object/')[1], Id: crypto.randomUUID() }); }
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') {
      let out = filterRows(rows, url.searchParams);
      if (table === 'award_moments') out = [...out].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(out);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        if (table === 'award_moments') {
          // The database: switched off = refused; same key = nothing added (on conflict do nothing); a new one posts.
          if (!db.group_features.some((f) => f.feature_key === 'awards' && f.enabled)) return json({ code: '42501', message: 'new row violates row-level security policy' }, 403);
          if (rows.some((r) => r.key === b.key)) continue;
          const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), created_by: K, photo_url: null, photo_by: null, ...b };
          rows.push(row); made.push(row);
          posts.push({ kind: 'auto', body: row.title });
          continue;
        }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body, table === 'award_moments' && 'photo_url' in body ? { photo_by: K } : {});
      return json([], 200);
    }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1');
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (dl) => dl.accept());
const card = () => page.locator('[aria-label="Just decided"]');

// 1. Every score is in: the round and the closest-to-the-pin hole are decided, each recorded once, and the card shows.
await page.goto(`${BASE}#/`);
await page.getByText('🏆 Kurt wins Saturday Stableford — 36 pts').first().waitFor({ timeout: 15000 });
check(true, 'award card: Kurt wins Saturday Stableford — 36 pts');
const txt = await card().innerText();
check(txt.indexOf('Kurt wins') < txt.indexOf('closest to the pin'), 'the round is the headline, the side comp below');
check(/2nd Al Blue 18 pts · 3rd Bo Red 0 pts/.test(txt), 'card shows 2nd and 3rd');
check(txt.includes('🎯 Al Blue wins closest to the pin on 3 — 2.1 m'), 'closest to the pin on 3 decided: Al, 2.1 m');
check(db.award_moments.filter((m) => m.key === `round:${R1}`).length === 1 && db.award_moments.filter((m) => m.key === `ctp:${R1}:3`).length === 1, 'each moment recorded once');
check(JSON.stringify(db.award_moments.find((m) => m.kind === 'round').winner_player_ids) === JSON.stringify([K]), 'winner ids saved');
check(await card().locator('.av').first().isVisible(), 'no photo yet: the winner’s avatar shows');
await page.screenshot({ path: `${SHOTS}/1-card.png`, fullPage: true });

// 2. Reload: nothing recorded twice.
await page.reload();
await page.getByText('🏆 Kurt wins Saturday Stableford').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
check(db.award_moments.length === 2 && posts.length === 2, `still two moments and two feed posts (${db.award_moments.length}, ${posts.length})`);

// 3. Take the winner's photo.
const file = path.join(SHOTS, 'winner.png');
fs.writeFileSync(file, PNG);
const big = card().locator('.card', { hasText: 'Kurt wins Saturday' });
await big.locator('input[type=file][capture]').setInputFiles(file);
await page.getByText('Photo added 📸').waitFor({ timeout: 15000 });
const rm = db.award_moments.find((m) => m.kind === 'round');
check(/\/storage\/v1\/object\/public\/photos\/.*awards\//.test(rm.photo_url || ''), `photo_url saved (${rm.photo_url})`);
check(uploads.some((u) => u.includes('/awards/')), 'photo uploaded to the awards folder');
await big.locator('img').first().waitFor({ timeout: 5000 });
check(await big.getByRole('button', { name: '🔁 Swap photo' }).isVisible(), 'organiser can swap the photo');
await page.screenshot({ path: `${SHOTS}/2-photo.png`, fullPage: true });

// 4. A player who didn't take it can't change it.
organiser = false;
rm.photo_by = AL;
await page.reload();
await page.getByText('🏆 Kurt wins Saturday Stableford').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
const big2 = card().locator('.card', { hasText: 'Kurt wins Saturday' });
check(!(await big2.getByRole('button', { name: /Swap photo|Retake photo/ }).isVisible().catch(() => false)) && !(await big2.getByText('Take the winner’s photo').isVisible().catch(() => false)), 'player: no photo buttons on someone else’s photo');
const ctpCard = card().locator('.card', { hasText: 'closest to the pin' });
await ctpCard.getByRole('button', { name: '📸 Add the winner’s photo' }).click();
check(await ctpCard.getByText('Take the winner’s photo').isVisible(), 'player: can add the first photo to the closest-to-the-pin card');
organiser = true;

// 5. Hide a card on this phone.
await big2.getByRole('button', { name: 'Hide this card' }).click();
check(!(await page.getByText('🏆 Kurt wins Saturday Stableford').isVisible().catch(() => false)), 'hidden card goes away');

// 6. Not everyone in yet: nothing announced (no spoilers).
reset({ scores: fullScores().filter((s) => !(s.subject_id === BO && s.hole === 18)) });
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
check(!db.award_moments.some((m) => m.kind === 'round'), 'one score missing: no round winner recorded');
check(db.award_moments.some((m) => m.key === `ctp:${R1}:3`), 'but hole 3 is done, so closest to the pin is');
check(!(await page.getByText('🏆 Kurt wins').isVisible().catch(() => false)), 'no round card yet');

// 7. Switched off: nothing recorded, no card.
reset({ awards: false });
const before = posts.length;
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
check(db.award_moments.length === 0 && posts.length === before, 'switched off: nothing recorded');
check(!(await card().isVisible().catch(() => false)), 'switched off: no award card');
await page.screenshot({ path: `${SHOTS}/3-off.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
