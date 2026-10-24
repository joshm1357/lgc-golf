// ov38 (migration 106): the Handicap Tribunal's closing time and verdict sharing — phone-width browser check, 24 Oct
// 2026. Fake database only (the words in the Feed posts are the database's; they're tested in supabase/tests/106).
//   1. An open case shows when voting closes (list and case page).
//   2. The organiser moves the closing time from the chair's sheet (set_case_closing).
//   3. A verdict post on the Feed has a one-tap "📤 Share the verdict"; the lodged and defence posts don't.
//   4. Governance settings: handicap cases have "Voting closes after".
// Usage: node tribunal-clock-test.mjs <base> <shotDir>   e.g. http://localhost:4369/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4369/lgc-golf/';
const SHOTS = process.argv[3] || './shots-tribunal-clock';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000010c';
const K = '11111111-1111-4111-8111-111111111111';   // Kurt, organiser
const MIKE = '22222222-2222-4222-8222-222222222222'; // Mike, player (the accused)
const BO = '33333333-3333-4333-8333-333333333333';  // Bo, player
const CHRIS = '44444444-4444-4444-8444-444444444444';
const OPEN = 'c0c0c0c0-0000-4000-8000-000000000001';
const SHUT = 'c0c0c0c0-0000-4000-8000-000000000002';
const now = new Date().toISOString();
// Voting closes 8pm Sydney, two days from now.
const closes = (() => { const d = new Date(Date.now() + 2 * 86400000); const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
  for (const off of ['+11:00', '+10:00']) { const t = new Date(`${ymd}T20:00:00${off}`); if (new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).format(t) === '20') return t.toISOString(); }
  return d.toISOString(); })();
const dayName = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' }).format(new Date(closes));
const users = { [K]: 'organiser', [MIKE]: 'player', [BO]: 'player' };
let me = K;
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now },
    { id: MIKE, name: 'Mike Brown', nickname: 'Mike', handicap: 30, approved: true, created_at: now },
    { id: BO, name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now },
    { id: CHRIS, name: 'Chris Payton', nickname: 'Chris', handicap: 27, approved: true, created_at: now },
  ],
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [], rounds: [], plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], side_entries: [],
  tribunal_cases: [
    { id: OPEN, group_id: GROUP, accused_id: MIKE, lodged_by: BO, proposed_change: -4, case_text: 'Hit them far too well!', defence: 'This was a one-off, I got lucky', status: 'open', created_at: now, closes_at: closes },
    { id: SHUT, group_id: GROUP, accused_id: CHRIS, lodged_by: K, proposed_change: 2, case_text: 'Wind excuses', status: 'closed', verdict: 'dismissed', guilty_votes: 1, not_guilty_votes: 2, old_handicap: 27, new_handicap: 27, overruled: false, created_at: '2026-10-18T02:00:00Z', closed_at: '2026-10-20T09:00:00Z', closes_at: '2026-10-20T09:00:00Z' },
  ],
  tribunal_votes: [{ case_id: OPEN, voter_id: BO, vote: 'guilty', comment: null, created_at: now }],
  posts: [
    { id: 'p0000000-0000-4000-8000-000000000001'.replace('p', 'a'), group_id: GROUP, kind: 'tribunal', body: '⚖️ NOT GUILTY 1–2. Chris walks free and stays on 27.', link: `/tribunal/${SHUT}`, created_at: '2026-10-20T09:00:01Z' },
    { id: 'p0000000-0000-4000-8000-000000000002'.replace('p', 'a'), group_id: GROUP, kind: 'tribunal', body: '🗣️ Mike\'s defence: “This was a one-off, I got lucky”', player_id: MIKE, link: `/tribunal/${OPEN}`, created_at: '2026-10-19T09:00:00Z' },
    { id: 'p0000000-0000-4000-8000-000000000003'.replace('p', 'a'), group_id: GROUP, kind: 'tribunal', body: `⚖️ Mike's in the dock: “Hit them far too well!” 30 → 26 if guilty. Guilty or not? Vote by ${dayName} 8pm.`, player_id: BO, link: `/tribunal/${OPEN}`, created_at: '2026-10-19T08:00:00Z' },
  ],
  comments: [], reactions: [],
  group_members: [{ group_id: GROUP, player_id: K, role: 'organiser' }, { group_id: GROUP, player_id: MIKE, role: 'player' }, { group_id: GROUP, player_id: BO, role: 'player' }, { group_id: GROUP, player_id: CHRIS, role: 'player' }],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  cases: [], case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
  group_features: ['feed', 'tribunal'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const rpcCalls = [];
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
const rpc = {
  my_status: () => ({ is_member: true, is_admin: users[me] === 'organiser', player_id: me, group_name: 'Hunter Weekend', group_id: GROUP, role: users[me], legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: users[me] }] }),
  my_saved_status: () => ({ saved: true, limited: true }),
  governance_tick: () => 0,
  set_case_closing: (b) => { const c = db.tribunal_cases.find((x) => x.id === b.p_case); c.closes_at = b.p_closes_at; return b.p_closes_at; },
};
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcCalls.push({ name, body, me });
    const out = rpc[name] ? rpc[name](body) : null;
    if (out && out.error) return json({ message: out.error, code: 'P0001' }, 400);
    return json(out ?? null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const added = (Array.isArray(body) ? body : [body]).map((b) => ({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b }));
      rows.push(...added);
      return json((req.headers().prefer || '').includes('return=representation') ? added : [], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      for (const r of rows) if (r.id === id) Object.assign(r, JSON.parse(req.postData() || '{}'));
      return json([], 200);
    }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const seen = async (loc, t = 8000) => loc.waitFor({ timeout: t }).then(() => true, () => false);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now() + 86400000 * 400));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const as = async (who, hash) => { me = who; await page.goto(`${BASE}#${hash}`); await page.reload(); };


// 1. When voting closes.
await as(K, '/governance/tribunal');
check(await seen(page.getByText(new RegExp(`closes ${dayName} 8pm`)), 15000), `the open case in the list says “closes ${dayName} 8pm”`);
await as(K, `/tribunal/${OPEN}`);
check(await seen(page.getByText(new RegExp(`Voting closes ${dayName} 8pm \\(sooner if everyone votes\\)`)), 15000), 'the case page says when voting closes');
check(!(await page.getByText(/Closes automatically once everyone has voted/).isVisible().catch(() => false)), 'the old “closes once everyone has voted” line is gone');
await page.screenshot({ path: `${SHOTS}/1-case.png`, fullPage: true });

// 2. The organiser moves it.
await page.getByRole('button', { name: /Chair: close the case or move the closing time/ }).click();
const box = page.getByLabel('Voting closes');
check(await seen(box), 'the chair’s sheet has “Voting closes”');
const later = new Date(Date.now() + 3 * 86400000); later.setHours(19, 30, 0, 0);
const pad = (n) => String(n).padStart(2, '0');
await box.fill(`${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T19:30`);
await page.getByRole('button', { name: 'Save the closing time' }).click();
await page.waitForTimeout(600);
const call = rpcCalls.find((c) => c.name === 'set_case_closing');
check(call && call.body.p_case === OPEN && Math.abs(new Date(call.body.p_closes_at) - later) < 60000, 'set_case_closing called with the new time');
await page.screenshot({ path: `${SHOTS}/2-moved.png`, fullPage: true });

// A player sees no chair button.
await as(BO, `/tribunal/${OPEN}`);
await page.getByText(/Voting closes/).first().waitFor({ timeout: 15000 });
check(!(await page.getByRole('button', { name: /Chair:/ }).isVisible().catch(() => false)), 'a player has no chair button');

// The closed case page shares with the new label.
await as(BO, `/tribunal/${SHUT}`);
check(await seen(page.getByRole('button', { name: '📤 Share the verdict' }), 15000), 'closed case page: “📤 Share the verdict”');

// 3. The Feed.
await as(BO, '/feed');
check(await seen(page.getByText('⚖️ NOT GUILTY 1–2. Chris walks free and stays on 27.'), 15000), 'the verdict post is on the Feed');
const shares = page.getByRole('button', { name: '📤 Share the verdict' });
await shares.first().waitFor({ timeout: 8000 }).catch(() => {});
check(await shares.count() === 1, 'exactly one “📤 Share the verdict” on the Feed (the verdict post, not the lodged or defence posts)');
const verdictCard = page.locator('article.post', { hasText: 'Chris walks free' });
check(await verdictCard.getByRole('button', { name: '📤 Share the verdict' }).isVisible(), '…and it sits on the verdict post');
await page.screenshot({ path: `${SHOTS}/3-feed.png`, fullPage: true });

// 4. Governance settings: handicap cases have "Voting closes after".
await as(K, '/governance/settings');
const hc = page.getByTestId('row-handicap').getByRole('button', { name: 'Change' });
if (await seen(hc, 15000)) {
  check(await page.getByTestId('row-handicap').getByText(/closes after 2 days, or once everyone has voted/).isVisible(), 'the Handicap row says “closes after 2 days, or once everyone has voted”');
  await hc.click();
  check(await seen(page.getByText('Voting closes after')), 'the Handicap setting has “Voting closes after”');
  await page.screenshot({ path: `${SHOTS}/4-settings.png`, fullPage: true });
} else { await page.screenshot({ path: `${SHOTS}/4-missing.png`, fullPage: true }); check(false, 'Governance settings: a Handicap row to open'); }

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
