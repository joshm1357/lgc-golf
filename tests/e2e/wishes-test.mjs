// Wishes screen (connector learning loop, 057) browser check, 21 Oct 2026. Fake database only.
// Usage: node wishes-test.mjs <base> <shotDir>   e.g. http://localhost:4315/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4315/lgc-golf/';
const SHOTS = process.argv[3] || './shots-wishes';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const now = '2026-10-21T08:00:00.000Z';
const db = {
  players: [{ id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now }],
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [], rounds: [], plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [],
  posts: [], rules: [], cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'side_comps', 'planner', 'connector'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const WISHES = [
  { id: 1, job: 'Chase who hasn’t paid', group_id: 'g1', group_name: 'L.G.C', source: 'connector', created_at: '2026-10-02T10:00:00Z' },
  { id: 2, job: 'chase who has not paid', group_id: 'g2', group_name: 'Hunter Weekend', source: 'connector', created_at: '2026-10-05T10:00:00Z' },
  { id: 3, job: 'Chase who hasn’t paid', group_id: 'g3', group_name: 'Bowral Boys', source: 'connector', created_at: '2026-10-03T10:00:00Z' },
  { id: 4, job: 'Book a tee time', group_id: 'g1', group_name: 'L.G.C', source: 'connector', created_at: '2026-10-01T10:00:00Z' },
  { id: 5, job: 'Weather for the weekend', group_id: 'g2', group_name: 'Hunter Weekend', source: 'connector', created_at: '2026-10-06T10:00:00Z' },
];
const STATS = {
  days: 90, calls: 42, failed: 5, groups_using: 2,
  tools: [{ tool: 'get_leaderboard', calls: 20, failed: 0, avg_ms: 350 }, { tool: 'enter_scores', calls: 15, failed: 4, avg_ms: 900 }, { tool: 'suggest_feature', calls: 7, failed: 1, avg_ms: 120 }],
  groups: [
    { group_id: 'g1', group_name: 'L.G.C', calls: 30, failed: 4, last_used: '2026-10-20T09:00:00Z',
      tools: [{ tool: 'get_leaderboard', calls: 14, failed: 0 }, { tool: 'enter_scores', calls: 12, failed: 4 }, { tool: 'suggest_feature', calls: 3, failed: 0 }, { tool: 'lgc_overview', calls: 1, failed: 0 }] },
    { group_id: 'g2', group_name: 'Hunter Weekend', calls: 12, failed: 1, last_used: '2026-10-18T09:00:00Z',
      tools: [{ tool: 'get_leaderboard', calls: 6, failed: 0 }, { tool: 'suggest_feature', calls: 4, failed: 1 }, { tool: 'enter_scores', calls: 2, failed: 0 }] },
  ],
  errors: [{ tool: 'enter_scores', error: 'not_found', times: 3 }, { tool: 'enter_scores', error: 'locked', times: 1 }, { tool: 'suggest_feature', error: 'bad_input', times: 1 }],
};
let admin = true;
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcs.push({ name, body });
    const refuse = () => json({ code: 'P0001', message: 'Only Josh can do that', details: null, hint: null }, 400);
    if (name === 'am_platform_admin') return json(admin);
    if (name === 'admin_wishes') return admin ? json(WISHES) : refuse();
    if (name === 'admin_connector_stats') return admin ? json({ ...STATS, days: body.p_days }) : refuse();
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'PATCH' || method === 'DELETE') return json([], 200);
    if (method === 'POST') return json([], 201);
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

// 1. Josh (a platform admin): More shows Wishes; it opens on the grouped wishes, most asked first.
await page.goto(`${BASE}#/more`);
await page.getByText('Players & group').first().waitFor({ timeout: 15000 });
await page.getByText('Wishes', { exact: true }).waitFor({ timeout: 10000 });
check(true, 'More shows the Wishes link to a platform admin');
await page.getByText('Wishes', { exact: true }).click();
await page.locator('[data-testid="wish"]').first().waitFor({ timeout: 10000 });
const cards = await page.locator('[data-testid="wish"]').allInnerTexts();
check(cards.length === 3, `three distinct jobs (got ${cards.length})`);
check(/^1\. Chase who hasn’t paid/.test(cards[0]) && cards[0].includes('3×') && cards[0].includes('3 groups'), 'most-wanted first: "Chase who hasn’t paid" 3× from 3 groups');
check(cards[0].includes('Also put as') && cards[0].includes('chase who has not paid'), 'other wordings are shown');
check(cards[1].includes('Weather for the weekend') && cards[2].includes('Book a tee time'), 'ties broken by the newest');
check(rpcs.some((r) => r.name === 'admin_wishes' && r.body.p_days === 90), 'asks for the last 90 days of wishes');
const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check(wide, 'no sideways scrolling at 375px');
await page.screenshot({ path: `${SHOTS}/1-wishes.png`, fullPage: true });

// 2. Tool calls: totals, tools, per group with most used tools, and why calls failed.
await page.getByRole('button', { name: 'Tool calls' }).click();
await page.locator('[data-testid="group-calls"]').first().waitFor({ timeout: 10000 });
const body = await page.locator('.page').innerText();
check(body.includes('42') && body.includes('Failed (12%)') && body.includes('Groups using it'), 'totals: 42 calls, 12% failed');
const g = await page.locator('[data-testid="group-calls"]').allInnerTexts();
check(g.length === 2 && g[0].includes('L.G.C') && g[0].includes('30 calls') && g[0].includes('4 failed (13%)'), 'busiest group first with its failures');
check(g[0].includes('Most used: Leaderboard 14 · Enter scores 12 · Wish 3') && !g[0].includes('Overview'), 'top 3 tools per group, in plain words');
check(body.includes('Enter scores: couldn’t find it — 3×'), 'failure reasons in plain words');
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'tool calls fit at 375px');
await page.screenshot({ path: `${SHOTS}/2-calls.png`, fullPage: true });

// 3. Changing the period asks again.
await page.getByLabel('Period').selectOption('30');
await page.waitForTimeout(500);
check(rpcs.some((r) => r.name === 'admin_connector_stats' && r.body.p_days === 30) && rpcs.some((r) => r.name === 'admin_wishes' && r.body.p_days === 30), 'period change reloads both lists');

// 4. Anyone else: no link in More, and the screen itself says no (the database refuses).
admin = false;
await page.goto(`${BASE}#/more`);
await page.reload();
await page.getByText('Players & group').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(!(await page.getByText('Wishes', { exact: true }).count()), 'no Wishes link for someone who isn’t a platform admin');
await page.goto(`${BASE}#/wishes`);
await page.getByText('Only Josh can see this.').waitFor({ timeout: 10000 });
check(true, 'opening #/wishes directly: "Only Josh can see this."');
await page.screenshot({ path: `${SHOTS}/3-refused.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
