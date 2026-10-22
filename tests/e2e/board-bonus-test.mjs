// v8 fix (23 Oct 2026): Sunday Ambrose (comp_bonus 2, LD on 9, CTP on 6) showed Josh & Hamish −9, then −7, then −9.
// The board was drawn from the phone's saved scores before the side comp entries had loaded. This checks that the
// un-bonused total is never on screen — on the trip status page's short leaderboard or the full one — whether the side entries
// are slow, saved on the phone, or not saved yet while the scores are.
// No real database is touched: every request to Supabase is answered here (side entries answer 1.5 s late).
// Usage: node board-bonus-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/lgc-golf/';
const SHOTS = process.argv[3] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const P4 = '44444444-4444-4444-8444-444444444444';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const ROUND = 'dddddddd-0000-4000-8000-000000000001';
const TA = 'abababab-0000-4000-8000-00000000000a';
const TB = 'abababab-0000-4000-8000-00000000000b';
const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000a';
const now = new Date().toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date()); // the app's 'today' is Sydney time
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
// Josh & Hamish: 7 birdies, rest pars, handicap 0 → −7 before the bonus, −9 with the longest drive on 9.
const teamCard = (team, birdies) => holes.map((h) => ({ round_id: ROUND, subject_id: team, subject_type: 'team', hole: h.n, strokes: h.n <= birdies ? 3 : 4, picked_up: false, updated_at: now }));

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Hamish B', nickname: 'Hamish', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P4, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Ryder Weekend', start_date: today, end_date: today, status: 'active', created_at: now }],
  trophies: [], quick_results: [], honour_board: [],
  teams: [
    { id: TA, round_id: ROUND, name: 'Josh & Hamish', handicap: 0, created_at: now },
    { id: TB, round_id: ROUND, name: 'Mike & Adam', handicap: 0, created_at: now },
  ],
  team_players: [{ team_id: TA, player_id: P1 }, { team_id: TA, player_id: P2 }, { team_id: TB, player_id: P3 }, { team_id: TB, player_id: P4 }],
  courses: [{ id: COURSE, name: 'Test Links', holes, created_at: now }],
  rounds: [{ id: ROUND, trip_id: TRIP, course_id: COURSE, name: 'Sunday Ambrose', play_date: today, format: 'ambrose', status: 'live', ld_holes: [9], ctp_holes: [6], comp_bonus: 2, created_at: now }],
  round_players: [P1, P2, P3, P4].map((p) => ({ round_id: ROUND, player_id: p, playing_handicap: 10 })),
  scores: [...teamCard(TA, 7), ...teamCard(TB, 2)],
  side_entries: [{ id: 'e1000000-0000-4000-8000-000000000001', round_id: ROUND, kind: 'ld', hole: 9, player_id: P1, distance_m: 262, confirmed: false, created_at: now }],
  plans: [], plan_rsvps: [], plan_polls: [], plan_options: [], posts: [], rules: [], comps: [], group_features: [], notify_prefs: [],
  score_adjustments: [], tribunal_cases: [], draws: [],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
};

function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v === 'not.is.null') { if (r[k] == null) return false; }
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: false, player_id: P1, group_name: 'L.G.C', group_id: GROUP, role: 'player', groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: 'player' }] });
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/')[3];
    if (table === 'side_entries') await new Promise((r) => setTimeout(r, 1500)); // slow signal on the course
    const rows = filterRows(db[table] || [], url.searchParams);
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (method === 'GET' || method === 'HEAD') return json(single ? rows[0] || null : rows);
    return json(single ? null : [], 201);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => { try { localStorage.setItem('tgt-caddie-hello', '1'); } catch { /* ov22 */ }
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  try { localStorage.setItem('tgt-notify-prompt', String(Date.now())); } catch {}
  // Record every total ever drawn on a leaderboard row, from the very first paint.
  window.__seen = new Set();
  const grab = () => document.querySelectorAll('.lb-row').forEach((row) => {
    const name = row.querySelector('.lb-name')?.textContent || '';
    const total = row.querySelector('.lb-main')?.textContent || '';
    if (name.includes('Josh')) window.__seen.add(total.replace('−', '-').trim());
  });
  new MutationObserver(grab).observe(document, { childList: true, subtree: true, characterData: true });
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const seen = () => page.evaluate(() => [...window.__seen]);
async function visit(path, label, prep) {
  if (prep) await page.evaluate(prep);
  await page.goto(`${BASE}${path}`);
  await page.reload();
  await page.locator('.lb-row', { hasText: 'Josh' }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500); // past the slow side entries and any re-render
  const s = await seen();
  check(!s.includes('-7'), `${label}: the total without its bonus (−7) never shows (saw ${s.join(', ') || 'nothing'})`);
  check(s.includes('-9'), `${label}: Josh & Hamish show −9 (bonus included)`);
}

await page.goto(`${BASE}#/`);
// 1. The trip status page's short leaderboard, nothing saved on the phone yet.
await visit('#/', 'Trip status, first visit');
await page.screenshot({ path: `${SHOTS}/bb1-this-trip.png`, fullPage: true });
// 2. Again, with scores and side entries saved on the phone.
await visit('#/', 'Trip status, from the phone’s copy');
// 3. Scores saved on the phone but no copy of the side entries (the case that flickered on Sunday).
const dropSide = () => { for (const k of Object.keys(localStorage)) if (k.startsWith('lgc-cache-side-')) localStorage.removeItem(k); };
await visit('#/', 'Trip status, scores saved but side entries not', dropSide);
// 4. The full leaderboard, same three ways.
await visit(`#/?r=${ROUND}`, 'Full leaderboard, side entries not saved', dropSide);
await page.screenshot({ path: `${SHOTS}/bb2-full-board.png`, fullPage: true });
await visit(`#/?r=${ROUND}`, 'Full leaderboard, from the phone’s copy');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
