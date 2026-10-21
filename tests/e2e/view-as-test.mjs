// "View as a player" browser check (21 Oct 2026). Fake database only.
// Usage: node view-as-test.mjs <liveStyleBase> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4301/lgc-golf/';
const SHOTS = process.argv[3] || './shots-view-as';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000a';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const ROUND = 'dddddddd-0000-4000-8000-000000000001';
const now = '2026-10-20T08:00:00.000Z';
const today = new Date().toISOString().slice(0, 10);
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const db = {
  players: [
    { id: P1, name: 'Joshua Moran', nickname: 'Josh', handicap: 13, approved: true, created_at: now },
    { id: P2, name: 'Michael Morris', nickname: 'Mike', handicap: 30, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'South Coast 2026', start_date: today, end_date: today, status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  courses: [{ id: COURSE, name: 'Test Links', holes, created_at: now }],
  rounds: [{ id: ROUND, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: today, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  round_players: [P1, P2].map((p) => ({ round_id: ROUND, player_id: p, playing_handicap: 14 })),
  scores: [
    { round_id: ROUND, subject_id: P1, subject_type: 'player', hole: 1, strokes: 4, picked_up: false, updated_at: now },
    { round_id: ROUND, subject_id: P2, subject_type: 'player', hole: 1, strokes: 6, picked_up: false, updated_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  group_features: ['feed', 'side_comps', 'trophies', 'tribunal', 'planner', 'notifications'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const writes = [];
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
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
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: P1, group_name: 'L.G.C', group_id: GROUP, role: 'organiser', legacy: true, groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: 'organiser' }] });
  if (method !== 'GET') writes.push(`${method} ${url.pathname}`);
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/')[3];
    const rows = filterRows(db[table] || [], url.searchParams);
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (method === 'GET') return json(single ? rows[0] || null : rows);
    return json(single ? null : [], 201);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));

// 1. Organiser on Mike's profile: the button is there; not on their own profile.
await page.goto(`${BASE}#/player/${P1}`);
await page.locator('.page .hdr-title').first().waitFor({ timeout: 15000 });
check(!(await page.getByRole('button', { name: /View the app as/ }).isVisible().catch(() => false)), 'no View as button on your own profile');
await page.goto(`${BASE}#/player/${P2}`);
await page.getByRole('button', { name: 'View the app as Mike' }).waitFor({ timeout: 15000 });
check(true, 'organiser sees "View the app as Mike" on his profile');
await page.screenshot({ path: `${SHOTS}/1-profile.png` });

// 2. Start viewing: the bar shows, the app is Mike's (organiser things gone).
await page.getByRole('button', { name: 'View the app as Mike' }).click();
await page.getByText('Viewing as', { exact: false }).first().waitFor({ timeout: 15000 });
check(await page.locator('.viewing-bar').innerText().then((t) => t.includes('Mike') && t.includes('read only')), 'bar: Viewing as Mike · read only');
await page.screenshot({ path: `${SHOTS}/2-leaderboard-as-mike.png` });
await page.goto(`${BASE}#/more`);
await page.locator('.page .hdr-title', { hasText: 'More' }).waitFor({ timeout: 15000 });
const moreText = await page.locator('.page').innerText();
check(moreText.includes('Signed in as Mike') || moreText.includes('Mike'), 'More shows Mike as the person');
check(!moreText.includes('Trips, courses, players, rounds'), 'no organiser Admin entry while viewing');
check(!(await page.getByText('Notifications', { exact: false }).first().isVisible().catch(() => false)), 'no notifications card while viewing (they belong to this phone)');
await page.screenshot({ path: `${SHOTS}/3-more-as-mike.png` });

// 3. A change is refused before it leaves the phone.
writes.length = 0;
await page.goto(`${BASE}#/score/${ROUND}`);
await page.waitForTimeout(2500);
const saveBtn = page.getByRole('button', { name: /^Save/ }).first();
if (await saveBtn.isVisible().catch(() => false)) {
  await saveBtn.click();
  await page.waitForTimeout(1500);
  check(await page.getByText(/viewing as Mike, so changes are off/i).isVisible().catch(() => false), 'saving a score says changes are off');
}
const queued = await page.evaluate(() => Object.keys(localStorage).filter((k) => /queue|outbox/i.test(k)).map((k) => [k, localStorage.getItem(k)]));
check(!writes.some((w) => !w.includes('/rpc/my_status') && !w.includes('/rpc/report_error')), `no change reached the database (${writes.join(', ') || 'none'})`);
check(!queued.some(([, v]) => v && v.includes(P2) && v.includes('strokes')), 'nothing waiting in the score queue');
await page.screenshot({ path: `${SHOTS}/4-score-refused.png` });

// 4. Stop: back to the organiser, on Mike's profile.
await page.goto(`${BASE}#/`);
await page.locator('.viewing-bar').waitFor({ timeout: 15000 });
await page.locator('.viewing-bar').getByRole('button', { name: 'Stop' }).click();
await page.waitForTimeout(2500);
check(!(await page.locator('.viewing-bar').isVisible().catch(() => false)), 'Stop: the bar goes');
check(await page.getByRole('button', { name: 'View the app as Mike' }).isVisible().catch(() => false), 'Stop: back as the organiser on Mike’s profile');

// 5. A new tab isn't viewing (it lives in this tab only).
const p2 = await ctx.newPage();
await p2.goto(`${BASE}#/`);
await p2.waitForTimeout(2000);
check(!(await p2.locator('.viewing-bar').isVisible().catch(() => false)), 'another tab is not viewing');

// 6. Viewing that no longer applies (e.g. another group) stops by itself, so the phone isn't left read only.
await p2.evaluate(() => sessionStorage.setItem('tgt-preview', JSON.stringify({ player_id: 'x', name: 'Ghost', group_id: 'another-group' })));
await p2.reload();
await p2.waitForTimeout(2500);
check(!(await p2.locator('.viewing-bar').isVisible().catch(() => false)), 'viewing for another group: no bar');
check(await p2.evaluate(() => sessionStorage.getItem('tgt-preview') === null), 'viewing for another group: stopped by itself');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
