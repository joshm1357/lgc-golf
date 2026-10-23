// "Was that helpful?" + the A/B model test, browser check (22 Oct 2026, migration 075). Fake database and a fake
// ai-helper function only (no model, no key).
//   * Ask: an answer → "Was that helpful? 👍 👎" → 👎 → reason chips → saved → thank-you → optional note (cleaned).
//   * Josh's Wishes screen, ✨ AI helper tab: model A vs model B from fake data, with the verdict in plain words.
// Usage: node ai-feedback-test.mjs <base> <shotDir>   e.g. http://localhost:4387/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4321/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ai-feedback';
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
    if (name === 'helper_feedback') return json(body.p_reason);
    if (name === 'admin_ai_abtest') return json(AB);
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


// Fake A/B results: A 20👍/20👎, B 30👍/10👎 → z ≈ 2.31 → "B is better (95% sure)".
const AB = { days: 90, tests: [{ ab_test: 'kimi-vs-claude', first_used: now, last_used: now, variants: [
  { variant: 'A', questions: 52, people: 9, up: 20, down: 20, failed: 3, fallbacks: 0, median_ms: 4100, tokens_in: 150000, tokens_out: 21000, cost: 0.18,
    reasons: { wrong: 9, slow: 6, long: 5 }, models: [{ provider: 'openai', model: 'moonshotai/kimi-k2', questions: 52 }] },
  { variant: 'B', questions: 49, people: 8, up: 30, down: 10, failed: 1, fallbacks: 1, median_ms: 2600, tokens_in: 140000, tokens_out: 18000, cost: 0.95,
    reasons: { wrong: 4, long: 6 }, models: [{ provider: 'anthropic', model: 'claude-sonnet-x', questions: 49 }] },
] }], notes: [{ at: now, ab_test: 'kimi-vs-claude', variant: 'A', reason: 'wrong', note: 'Said Bluey won 2024, it was Kurt' }] };

async function fakeHelper(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' });
  const b = JSON.parse(req.postData() || '{}');
  return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b.mode === 'history' ? { answer: 'Kurt leads on 3 points after 1 hole; Bluey is on 2.', remaining: { month: 50, today: 8 }, log_id: 21 } : { error: 'Unknown request.' }) });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('**/functions/v1/ai-helper', fakeHelper);
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

// 1. Ask → an answer → "Was that helpful?" under it.
await page.goto(`${BASE}#/ask?about=round`);
await page.getByRole('button', { name: 'Who’s leading?' }).click();
await page.getByText(/Kurt leads on 3 points/).waitFor({ timeout: 10000 });
check(await page.getByText('Was that helpful?').isVisible(), '"Was that helpful?" shows under the answer');
check(await page.getByRole('button', { name: 'What was wrong' }).count() === 0 && await page.getByRole('group', { name: 'What was wrong' }).count() === 0, 'no reasons until 👎 (no nagging)');
await page.screenshot({ path: `${SHOTS}/1-answer.png`, fullPage: true });

// 2. 👎 → reasons → saved → thank-you.
await page.getByRole('button', { name: 'Not helpful' }).click();
await page.getByText('Thanks!').waitFor({ timeout: 5000 });
const rate = rpcs.filter((r) => r.name === 'rate_helper').at(-1);
check(rate?.body.p_log === 21 && rate.body.p_rating === -1, '👎 saved against this answer (rate_helper, log 21, -1)');
const chips = page.getByRole('group', { name: 'What was wrong' });
check(JSON.stringify(await chips.getByRole('button').allInnerTexts()) === JSON.stringify(['Wrong', 'Didn’t answer', 'Too slow', 'Too long', 'Not useful', 'Other']), 'six reason chips after 👎');
await page.screenshot({ path: `${SHOTS}/2-reasons.png`, fullPage: true });
await chips.getByRole('button', { name: 'Too long' }).click();
await page.getByText('Got it, cheers').waitFor({ timeout: 5000 });
const fb = rpcs.filter((r) => r.name === 'helper_feedback').at(-1);
check(fb?.body.p_log === 21 && fb.body.p_reason === 'long' && fb.body.p_note === null, 'reason saved (helper_feedback, log 21, long)');
check((await chips.getByRole('button', { name: 'Too long' }).getAttribute('aria-pressed')) === 'true', 'the chosen reason shows as chosen');
await page.getByLabel('Add a note (optional)').fill('  Just wanted the\nleader <b>name</b>  ');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.getByText('Note sent to the app’s owner.').waitFor({ timeout: 5000 });
const fb2 = rpcs.filter((r) => r.name === 'helper_feedback').at(-1);
check(fb2?.body.p_reason === 'long' && fb2.body.p_note === 'Just wanted the leader b name /b', 'the note is cleaned and saved');
await page.screenshot({ path: `${SHOTS}/3-thanks.png`, fullPage: true });
// Changing to 👍 hides the reasons.
await page.getByRole('button', { name: 'Helpful', exact: true }).click();
await page.waitForTimeout(300);
check(await page.getByRole('group', { name: 'What was wrong' }).count() === 0, '👍 instead hides the reasons');

// 3. Wishes → ✨ AI helper: A vs B with the verdict.
await page.goto(`${BASE}#/wishes`);
await page.getByRole('button', { name: '✨ The Caddie' }).click();
await page.getByLabel('Model test').waitFor({ timeout: 10000 });
const verdict = await page.getByLabel('Verdict').innerText();
check(/B is better \(95% sure\)/.test(verdict), `verdict from the fake data: ${verdict.trim()}`);
const table = await page.getByLabel('A vs B').innerText();
check(/moonshotai\/kimi-k2/.test(table) && /claude-sonnet-x/.test(table) && /50%/.test(table) && /75%/.test(table), 'both models with 👍 share');
check(/Wrong 9/.test(table) && /Too long 6/.test(table) && /4\.1 s/.test(table) && /2\.6 s/.test(table) && /fell back to A 1×/.test(table) && /US\$0\.95/.test(table), 'reasons, median time, fallback and rough cost');
check(await page.getByText('Said Bluey won 2024, it was Kurt').isVisible(), 'the latest 👎 note shows (admins only)');
check(await page.getByText('How to run a model test').isVisible(), 'How to run a model test note');
await page.getByLabel('Model test').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/4-wishes-ab.png`, fullPage: true });
const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check(noScroll, 'no sideways scroll at 375px');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
