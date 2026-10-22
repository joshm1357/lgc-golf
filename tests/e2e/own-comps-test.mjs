// A group's own side comps (051) browser check, 21 Oct 2026. Fake database only.
// Usage: node own-comps-test.mjs <base> <shotDir>   e.g. http://localhost:4301/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4301/lgc-golf/';
const SHOTS = process.argv[3] || './shots-own-comps';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const now = '2026-10-21T08:00:00.000Z';
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    { id: ids[0], name: 'Al Blue', nickname: null, handicap: 20, approved: true, created_at: now, cup_side: null },
    { id: ids[1], name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now, cup_side: null },
    { id: ids[2], name: 'Cy Red', nickname: null, handicap: 16, approved: true, created_at: now, cup_side: null },
  ],
  trips: [{ id: TRIP, name: '6th Ryder Cup', start_date: '2026-10-22', end_date: '2026-10-24', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [{ round_id: 'dddddddd-0000-4000-8000-000000000001', player_id: '11111111-1111-4111-8111-111111111111', playing_hcp: 12 }, { round_id: 'dddddddd-0000-4000-8000-000000000001', player_id: '22222222-2222-4222-8222-222222222222', playing_hcp: 20 }], scores: [],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday — Cypress Lakes', play_date: '2026-10-23', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday — The Vintage', play_date: '2026-10-24', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'side_comps', 'planner'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
const rpcs = [];
const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcs.push(name);
    if (name === 'team_invite') return json(body.p_side === db.cup_sides[0]?.id ? 'BLUETEAM2345' : 'REDTEAM23456');
    if (name === 'set_cup_hole') {
      const m = db.cup_matches.find((x) => x.id === body.p_match);
      if (body.p_result) m.holes[String(body.p_hole)] = body.p_result; else delete m.holes[String(body.p_hole)];
      m.updated_at = new Date().toISOString();
      return json(m.holes);
    }
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      for (const b of Array.isArray(body) ? body : [body]) rows.push({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), holes: {}, ...b });
      return json([], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
      return json([], 200);
    }
    if (method === 'DELETE') {
      const id = eqOf(url.searchParams, 'id');
      db[table] = rows.filter((r) => r.id !== id);
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. Organiser adds two of the group's own comps in Admin.
await page.goto(`${BASE}#/admin`);
await page.getByRole('button', { name: 'Your own side comps' }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Your own side comps' }).click();
const ownSec = page.locator('.card', { hasText: 'Add side comp' }).last();
await ownSec.getByLabel('Emoji').fill('⛳');
await ownSec.getByLabel('Name').fill('Longest putt');
await ownSec.getByText('Biggest number wins').click();
check(await ownSec.getByLabel(/Unit/).inputValue() === 'ft', 'biggest-number comp defaults the unit to ft');
await ownSec.getByRole('button', { name: 'Add side comp' }).click();
await page.waitForTimeout(600);
await ownSec.getByLabel('Emoji').fill('🎯');
await ownSec.getByLabel('Name').fill('Shot of the day');
await ownSec.getByText('Organiser picks').click();
await ownSec.getByRole('button', { name: 'Add side comp' }).click();
await page.waitForTimeout(600);
const [putt, shot] = db.side_comp_defs;
check(putt?.name === 'Longest putt' && putt.how === 'highest' && putt.unit === 'ft', 'Longest putt saved (biggest wins, ft)');
check(shot?.how === 'pick' && shot.unit === null, 'Shot of the day saved (organiser picks, no unit)');
await page.screenshot({ path: `${SHOTS}/1-admin-defs.png`, fullPage: true });

// 2. Switch them on for Friday: putt on 3 and 7, shot of the day for the whole round.
// (The fake database has no realtime, so reload to see the new comps on the round cards.)
await page.reload();
const card = page.locator('div.card.pad.stack', { hasText: 'Friday — Cypress Lakes' });
await card.getByRole('button', { name: '⛳ Longest putt' }).waitFor({ timeout: 15000 });
await card.getByRole('button', { name: '⛳ Longest putt' }).click();
await card.getByPlaceholder('Holes, or blank = whole round').first().fill('3, 7, 19');
await card.getByRole('button', { name: '🎯 Shot of the day' }).click();
await card.getByRole('button', { name: 'Save your side comps' }).click();
await page.waitForTimeout(800);
const r1 = db.rounds.find((r) => r.id === R1);
check(JSON.stringify(r1.own_comps) === JSON.stringify([{ comp: putt.id, holes: [3, 7] }, { comp: shot.id, holes: [] }]), 'round saved with putt on 3 & 7 (19 dropped) and shot of the day for the round');

// 3. Side comps screen shows them; enter a putt.
await page.goto(`${BASE}#/comps?r=${R1}`);
await page.getByRole('button', { name: '⛳ Longest putt' }).waitFor({ timeout: 15000 });
check(await page.getByRole('button', { name: 'Closest to pin' }).isVisible(), 'closest to pin is still there');
await page.getByRole('button', { name: '⛳ Longest putt' }).click();
await page.getByRole('button', { name: 'Hole 7' }).waitFor({ timeout: 5000 });
check(await page.getByText('No entries on hole 3 yet').isVisible(), 'no entries yet on hole 3');
await page.getByRole('button', { name: /Enter — hole 3/ }).click();
await page.getByLabel('How many ft').fill('24');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(800);
check(db.side_comp_entries.length === 1 && Number(db.side_comp_entries[0].value) === 24 && db.side_comp_entries[0].hole === 3, 'putt entry saved: 24 ft on hole 3');
check(db.posts.some((p) => /Longest putt on 3: Kurt.*24 ft/.test(p.body)), 'a new leader posts to the feed');
await page.reload();
await page.getByRole('button', { name: '⛳ Longest putt' }).click();
await page.getByText('24').first().waitFor({ timeout: 5000 });
const txt = await page.locator('.page').innerText();
check(/leader/i.test(txt) && txt.includes('Kurt'), 'Kurt leads the putt');
await page.screenshot({ path: `${SHOTS}/2-putt.png`, fullPage: true });

// 4. Organiser confirms the winner.
await page.getByRole('button', { name: 'Winner' }).click();
await page.waitForTimeout(600);
check(db.side_comp_entries[0].confirmed === true, 'organiser confirmed the winner');

// 5. Shot of the day: whole round, no number, nominate with a note.
await page.getByRole('button', { name: '🎯 Shot of the day' }).click();
check(!(await page.getByRole('button', { name: 'Hole 3' }).isVisible().catch(() => false)), 'whole-round comp has no hole chips');
await page.getByRole('button', { name: /^Nominate$/ }).click();
check(!(await page.getByLabel(/How many|Number/).isVisible().catch(() => false)), 'pick comp asks for no number');
await page.getByLabel('What happened').fill('Holed out from the bunker on 12');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(800);
const nom = db.side_comp_entries.find((e) => e.comp_id === shot.id);
check(nom && nom.hole === null && nom.value === null && nom.note.includes('bunker'), 'nomination saved for the whole round');
await page.screenshot({ path: `${SHOTS}/3-shot.png`, fullPage: true });

// 6. A player sees the comps but not the organiser buttons.
organiser = false;
await page.reload();
await page.getByRole('button', { name: '⛳ Longest putt' }).click();
await page.getByText('Winner ✓ confirmed').waitFor({ timeout: 10000 });
check(!(await page.getByRole('button', { name: /^Winner$|^Unconfirm$/ }).isVisible().catch(() => false)), 'players don’t see the winner buttons');
await page.screenshot({ path: `${SHOTS}/4-player.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
