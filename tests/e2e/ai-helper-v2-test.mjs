// AI helper v2 browser check, 21 Oct 2026. Fake database and a fake ai-helper function only (no model, no key).
//   * Trips tab: "✨ Plan it with AI" (organisers) → confirm card → 👍 → Create it calls plan_apply → opens the trip.
//   * Leaderboard: "✨ Ask about this round" chip → /ask?about=round → answer → 👎.
//   * Players: Ask chip yes, Plan button no. Josh's Wishes screen: the AI tab.
//   * Switched off: all hidden, the function never called.
// Usage: node ai-helper-v2-test.mjs <base> <shotDir>   e.g. http://localhost:4321/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4321/lgc-golf/';
const SHOTS = process.argv[3] || './shots-aihelper-v2';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const now = '2026-10-21T08:00:00.000Z';
const holes = [[4, 7], [3, 15], [5, 1], [4, 11], [4, 3], [3, 17], [4, 5], [5, 9], [4, 13], [4, 8], [3, 16], [4, 2], [5, 10], [4, 4], [3, 18], [4, 6], [4, 12], [5, 14]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    { id: B, name: 'Al Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now, cup_side: null },
  ],
  trips: [{ id: TRIP, name: 'Hunter 2026', start_date: '2026-10-21', end_date: '2026-10-23', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [{ round_id: R1, player_id: K, playing_handicap: 12 }, { round_id: R1, player_id: B, playing_handicap: 20 }],
  scores: [
    { id: 's1', round_id: R1, subject_id: K, subject_type: 'player', hole: 1, strokes: 4, picked_up: false, updated_at: now },
    { id: 's2', round_id: R1, subject_id: B, subject_type: 'player', hole: 1, strokes: 5, picked_up: false, updated_at: now },
  ],
  courses: [{ id: COURSE, name: 'Kurri Kurri', holes, created_at: now }],
  rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Wednesday — Kurri', play_date: '2026-10-21', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  plans: [], plan_rsvps: [], plan_polls: [], plan_options: [], plan_votes: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], plan_comments: [],
  plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'planner', 'planner_tasks', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
const rpcs = [];
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((s) => s.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcs.push({ name, body });
    if (name === 'rate_helper') return json(body.p_rating);
    if (name === 'am_platform_admin') return json(true);
    if (name === 'admin_ai_usage') {
      return json({ days: body.p_days, requests: 14, failed: 1, cap_hits: 2, groups_using: 2, people_using: 5, up: 6, down: 2, applied: 3, apply_failed: 0,
        tokens_in: 42000, tokens_out: 5100, avg_in: 3000, avg_out: 364, avg_ms: 4200,
        areas: [{ area: 'ask', requests: 9, ok: 8, failed: 1, up: 4, down: 2, avg_in: 2500, avg_out: 120 }, { area: 'plan', requests: 5, ok: 5, failed: 0, up: 2, down: 0, avg_in: 3900, avg_out: 800 }],
        weeks: [{ week: '2026-10-19', area: 'ask', requests: 6 }, { week: '2026-10-19', area: 'plan', requests: 5 }, { week: '2026-10-12', area: 'ask', requests: 3 }],
        groups: [{ group_id: GROUP, group_name: 'Hunter Weekend', requests: 11, cap_hits: 2, up: 5, down: 1, people: 4, last_used: now }],
        models: [{ provider: 'openai', model: 'example/cheap-model', requests: 14, failed: 1, avg_in: 3000, avg_out: 364 }],
        errors: [{ error: 'provider_busy', times: 1 }] });
    }
    if (name === 'admin_wishes') return json([]);
    if (name === 'admin_connector_stats') return json({ calls: 0 });
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = filterRows(db[table] || [], url.searchParams);
    if (method === 'GET') {
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(rows[0] || null);
      return json(rows);
    }
    return json([], 201);
  }
  return json({});
}

// The fake ai-helper edge function.
const calls = [];
const TRIP_PLAN = {
  name: 'March Away 2027', kind: 'trip',
  dates: [{ start_date: '2027-03-12', end_date: '2027-03-14', note: '' }, { start_date: '2027-03-19', end_date: '2027-03-21', note: '' }],
  places: [{ label: 'Hunter Valley', courses: [], address: 'Kurri Kurri Golf Club + Cypress Lakes', cost_pp: 520, notes: null }, { label: 'Port Stephens', courses: [], address: null, cost_pp: 480, notes: null }],
  jobs: ['Book accommodation', 'Book tee times'], bring: ['Clubs', 'Trip shirt'],
  costs: [{ item: 'Golf', each: 180 }, { item: 'Accommodation', each: 200 }], budget_pp: 500,
  notes: 'Both within 3 hours of Sydney.', closes_on: '2026-10-31', warnings: [],
};
const SUMMARY = [
  'Start the trip “March Away 2027”, about $500 each',
  'Vote on dates: Fri 12 Mar – Sun 14 Mar · Fri 19 Mar – Sun 21 Mar',
  'Vote on where: Hunter Valley (~$520) · Port Stephens (~$480)',
  'Jobs: Book accommodation, Book tee times',
  'Rough costs each: Golf ~$180, Accommodation ~$200',
];
let left = { month: 57, today: 9 };
async function fakeHelper(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' });
  const body = JSON.parse(req.postData() || '{}');
  calls.push({ body, auth: req.headers().authorization || '' });
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
  if (body.mode === 'plan') { left = { month: left.month - 1, today: left.today - 1 }; return json({ trip_plan: TRIP_PLAN, summary: SUMMARY, remaining: left, log_id: 11 }); }
  // The planning chat (080): the draft (a shortlist) + questions with quick answers.
  if (body.mode === 'plan_chat') {
    left = { month: left.month - 1, today: left.today - 1 };
    return json({ chat: { message: 'Here are some options — want to add any?', draft: { ...TRIP_PLAN, extras: [] }, questions: [{ id: 'places', text: 'These are the places I’d look at — any others?', quick: ['Looks good', 'Add another…'] }], done: false, summary: SUMMARY }, remaining: left, log_id: 11 });
  }
  if (body.mode === 'plan_apply') {
    const id = crypto.randomUUID();
    db.plans.push({ id, group_id: GROUP, kind: 'trip', name: body.plan.name, status: 'planning', proposed: false, brief: 'Rough costs each (AI estimate — check before booking)', budget_pp: 500, created_by: K, created_at: now });
    return json({ done: true, plan_id: id, made: ['the trip', 'the votes'] });
  }
  if (body.mode === 'history') { left = { month: left.month - 1, today: left.today - 1 }; return json({ answer: 'Kurt leads on 3 points after 1 hole; Bluey is on 2.', remaining: left, log_id: 12 }); }
  return json({ error: 'Unknown request.' });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('**/functions/v1/ai-helper', fakeHelper); // registered last, so it wins for the function
await ctx.route('**/functions/v1/notify', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"sent":0}' }));
await ctx.addInitScript(([uid, group]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('lgc-group', group);
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999', GROUP]);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. Trips tab: Plan it with AI + Ask chip.
await page.goto(`${BASE}#/plan`);
await page.getByRole('button', { name: /✨ (Plan it with the Caddie|Carry on your plan)/ }).waitFor({ timeout: 15000 });
check(true, 'organiser sees "✨ Plan it with AI" on the Trips tab');
check(await page.getByText('✨ Ask about our trips').isVisible(), 'the Ask chip shows on the Trips tab');
await page.screenshot({ path: `${SHOTS}/1-trips.png`, fullPage: true });
await page.getByRole('button', { name: /✨ (Plan it with the Caddie|Carry on your plan)/ }).click();
const box = page.getByLabel('Your message');
check((await box.getAttribute('placeholder')).startsWith('Weekend away in March'), 'the example is the placeholder');
check(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'Send waits for some words');
await box.fill('Weekend away in March, 12 of us, somewhere within 3 hours of Sydney, about $500 each');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.locator('.pc-inline-card [data-testid="draft-card"]').waitFor({ timeout: 10000 });
check(await page.getByText('56 questions left this month for the group · 8 for you today').isVisible(), 'questions left shows');
const planCall = calls.find((c) => c.body.mode === 'plan_chat');
check(!!planCall && planCall.body.group_id === GROUP && /^Bearer /.test(planCall.auth), 'plan call: mode, group and the person’s own sign-in');
check(db.plans.length === 0, 'nothing saved before Create it');
// 👍
await page.getByRole('button', { name: 'Helpful', exact: true }).click();
await page.getByText('Thanks!').waitFor({ timeout: 5000 });
const rate = rpcs.find((r) => r.name === 'rate_helper');
check(!!rate && rate.body.p_log === 11 && rate.body.p_rating === 1, '👍 is recorded against this answer (rate_helper, log 11, +1)');
check((await page.getByRole('button', { name: 'Helpful', exact: true }).getAttribute('aria-pressed')) === 'true', '👍 shows as chosen');
await page.getByTestId('use-plan').click();
await page.getByText('I’ll set up:').waitFor({ timeout: 10000 });
const card = await page.getByLabel('What will be made').innerText();
check(SUMMARY.every((l) => card.includes(l)), 'the confirm card lists exactly what will be made');
await page.screenshot({ path: `${SHOTS}/2-plan-confirm.png`, fullPage: true });
// Create it → plan_apply → the new trip opens.
await page.getByRole('button', { name: 'Create it' }).click();
await page.waitForURL(/#\/plan\/[0-9a-f-]{36}/, { timeout: 10000 });
const apply = calls.find((c) => c.body.mode === 'plan_apply');
check(!!apply && apply.body.plan.name === TRIP_PLAN.name && apply.body.plan.places.map((p) => p.place).join() === 'Hunter Valley,Port Stephens' && apply.body.plan.dates.length === 2 && apply.body.group_id === GROUP, 'Create it calls plan_apply with the draft as a plan');
await page.getByText('March Away 2027').first().waitFor({ timeout: 10000 });
check(true, 'the new trip opens');
await page.screenshot({ path: `${SHOTS}/3-created.png`, fullPage: true });

// 2. Leaderboard: the Ask chip → /ask?about=round → an answer → 👎.
await page.goto(`${BASE}#/leaderboard`);
await page.getByText('✨ Ask about this round').waitFor({ timeout: 15000 });
check(true, 'the "✨ Ask about this round" chip shows on the leaderboard');
await page.screenshot({ path: `${SHOTS}/4-leaderboard.png` });
await page.getByText('✨ Ask about this round').click();
await page.getByText('Ask about this round').first().waitFor({ timeout: 10000 });
check(page.url().includes('#/ask?about=round'), 'it opens Ask for this round');
await page.getByRole('button', { name: 'Who’s leading?' }).click();
await page.getByText(/Kurt leads on 3 points/).waitFor({ timeout: 10000 });
check(calls.at(-1).body.mode === 'history' && calls.at(-1).body.text === 'Who’s leading?', 'the question goes to the helper');
await page.getByRole('button', { name: 'Not helpful' }).click();
await page.getByText('Thanks!').waitFor({ timeout: 5000 });
const down = rpcs.filter((r) => r.name === 'rate_helper').at(-1);
check(down.body.p_log === 12 && down.body.p_rating === -1, '👎 is recorded (log 12, -1)');
await page.screenshot({ path: `${SHOTS}/5-ask-round.png`, fullPage: true });

// 3. Josh's Wishes screen: the AI tab.
await page.goto(`${BASE}#/wishes`);
await page.getByRole('button', { name: '✨ The Caddie' }).click();
await page.getByLabel('Caddie usage').waitFor({ timeout: 10000 });
const usage = await page.getByLabel('Caddie usage').innerText();
check(/75%/.test(usage) && /Hit the limit/.test(usage) && /Plan it with the Caddie/.test(usage) && /example\/cheap-model/.test(usage) && /Caddie busy or down — 1×/.test(usage), 'Wishes → AI helper: 👍 share, cap hits, areas, models, errors');
await page.screenshot({ path: `${SHOTS}/6-wishes-ai.png`, fullPage: true });

// 4. A player: the Ask chip, but no Plan button.
organiser = false;
await page.goto(`${BASE}#/plan`);
await page.reload();
await page.getByText('✨ Ask about our trips').waitFor({ timeout: 15000 });
check(!(await page.getByRole('button', { name: /✨ (Plan it with the Caddie|Carry on your plan)/ }).isVisible().catch(() => false)), 'a player doesn’t get "Plan it with AI"');
organiser = true;

// 5. Switched off: hidden everywhere, the function never called.
db.group_features.find((f) => f.feature_key === 'ai_helper').enabled = false;
const before = calls.length;
await page.goto(`${BASE}#/plan`);
await page.reload();
await page.getByText('💡 Suggest a trip or round').waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
check(!(await page.getByRole('button', { name: /✨ (Plan it with the Caddie|Carry on your plan)/ }).isVisible().catch(() => false)), 'switched off: no Plan it with AI');
check(!(await page.getByText('✨ Ask about our trips').isVisible().catch(() => false)), 'switched off: no Ask chip on Trips');
await page.goto(`${BASE}#/leaderboard`);
await page.getByText('Wednesday — Kurri').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
check(!(await page.getByText('✨ Ask about this round').isVisible().catch(() => false)), 'switched off: no Ask chip on the leaderboard');
await page.goto(`${BASE}#/ask?about=round`);
await page.getByText('The Caddie is switched off for this group.').waitFor({ timeout: 10000 });
check(true, 'switched off: /ask says so');
check(calls.length === before, 'switched off: the function isn’t called');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
