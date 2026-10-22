// AI helper browser check, 21 Oct 2026. Fake database and a fake ai-helper function only (no model, no key).
// Usage: node ai-helper-test.mjs <base> <shotDir>   e.g. http://localhost:4317/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4317/lgc-golf/';
const SHOTS = process.argv[3] || './shots-aihelper';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const now = '2026-10-21T08:00:00.000Z';
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Al Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now, cup_side: null },
  ],
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [], rounds: [],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'side_comps', 'planner', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
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
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(p.endsWith('group_invite') ? 'PLAYERLINK23' : null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    if (method === 'GET') return json(filterRows(db[table] || [], url.searchParams));
    return json([], 201);
  }
  return json({});
}

// The fake ai-helper edge function.
const calls = [];
const PLAN = {
  trip: { id: null, name: 'Hunter Valley 2026', start_date: '2026-10-22', end_date: '2026-10-24' },
  courses: [{ ref: 'lib-kurri', kind: 'library', name: 'Kurri Kurri Golf Club', holes: 18, par3s: [2, 6, 11, 15] }],
  rounds: [{ date: '2026-10-22', course: 'lib-kurri', course_name: 'Kurri Kurri Golf Club', format: 'stableford', ctp_holes: [2, 6, 11, 15], ld_holes: [], name: 'Thursday — Kurri Kurri' }],
  notes: 'Couldn’t find The Vintage in the library — add it by hand.',
  warnings: [],
};
const SUMMARY = [
  'Make the trip “Hunter Valley 2026”, Thursday 22 Oct to Saturday 24 Oct',
  'Add a course from the library: Kurri Kurri Golf Club',
  'Thursday 22 Oct: Kurri Kurri Golf Club · Stableford · closest to the pin on 2, 6, 11, 15',
];
let left = { month: 57, today: 9 };
async function fakeHelper(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' });
  const body = JSON.parse(req.postData() || '{}');
  calls.push({ body, auth: req.headers().authorization || '' });
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
  if (body.mode === 'setup') { left = { month: left.month - 1, today: left.today - 1 }; return json({ plan: PLAN, summary: SUMMARY, remaining: left }); }
  if (body.mode === 'apply') {
    const id = crypto.randomUUID();
    db.trips.push({ id, group_id: GROUP, name: body.plan.trip.name, start_date: body.plan.trip.start_date, end_date: body.plan.trip.end_date, status: 'active', created_at: now });
    return json({ done: true, trip_id: id, made: ['the trip “Hunter Valley 2026”', 'Kurri Kurri Golf Club', 'Thursday — Kurri Kurri'] });
  }
  // 22 Oct: the AI company busy once → the app tries again by itself (a failed go isn't counted).
  if (body.mode === 'history' && body.text === 'Who has the most birdies?' && !calls.some((c, i) => i < calls.length - 1 && c.body.text === body.text)) return json({ error: 'The AI helper is busy right now — try again in a minute.', code: 'provider_busy', remaining: left });
  if (body.mode === 'history') { left = { month: left.month - 1, today: left.today - 1 }; return json({ answer: 'Bluey’s 44 points at Kurri on Hunter 2024 is the best Stableford round.', remaining: left }); }
  return json({ error: 'Unknown request.' });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('**/functions/v1/ai-helper', fakeHelper); // registered last, so it wins for the function
await ctx.addInitScript(([uid, group]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('lgc-group', group);
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999', GROUP]);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. Set it up for me: the box is at the top of Set up your trip, with the example as its placeholder.
await page.goto(`${BASE}#/setup`);
await page.getByText('✨ Set it up for me').waitFor({ timeout: 15000 });
check(true, 'the "Set it up for me" box shows at the top of the guide');
const box = page.getByLabel('Describe your trip');
check((await box.getAttribute('placeholder')).startsWith('Hunter Valley, Thu 22 to Sat 24 Oct.'), 'the example is the placeholder');
check(await page.getByRole('button', { name: 'Send' }).isDisabled(), 'Send waits for some words');
await box.fill('Hunter Valley, Thu 22 to Sat 24 Oct. Kurri Thursday, stableford, ctp on the par 3s');
await page.getByRole('button', { name: 'Send' }).click();
await page.getByText('I’ll set up:').waitFor({ timeout: 10000 });
const card = await page.getByLabel('What will be made').innerText();
check(SUMMARY.every((l) => card.includes(l)), 'the confirm card lists exactly what will be made');
check(await page.getByText('Note: Couldn’t find The Vintage').isVisible(), 'the helper’s note shows');
check(await page.getByText('56 questions left this month for the group · 8 for you today').isVisible(), 'questions left this month shows');
check(calls[0]?.body.mode === 'setup' && calls[0].body.group_id === GROUP && /^Bearer /.test(calls[0].auth), 'setup call: mode, group and the person’s own sign-in');
check(db.trips.length === 0, 'nothing saved before Do it');
await page.screenshot({ path: `${SHOTS}/1-confirm.png`, fullPage: true });

// 2. Change something: back to the words, kept.
await page.getByRole('button', { name: 'Change something' }).click();
check((await page.getByLabel('Describe your trip').inputValue()).includes('Kurri Thursday'), 'Change something goes back with the words kept');
await page.getByLabel('Describe your trip').fill('Hunter Valley, Thu 22 to Sat 24 Oct. Kurri Thursday, stableford, ctp on the par 3s. 12 of us.');
await page.getByRole('button', { name: 'Send' }).click();
await page.getByRole('button', { name: 'Do it' }).waitFor({ timeout: 10000 });

// 3. Do it: calls apply with the plan, then the guide shows the new trip.
await page.getByRole('button', { name: 'Do it' }).click();
await page.getByText('All set up — check each step below').waitFor({ timeout: 10000 });
const apply = calls.find((c) => c.body.mode === 'apply');
check(!!apply && JSON.stringify(apply.body.plan) === JSON.stringify(PLAN) && apply.body.group_id === GROUP, 'Do it calls apply with the plan');
await page.getByText(/Hunter Valley 2026 · Thursday 22 Oct/).first().waitFor({ timeout: 10000 });
check(true, 'the guide shows the trip it made');
await page.screenshot({ path: `${SHOTS}/2-done.png`, fullPage: true });

// 4. Ask about our history: linked from More, example chips, an answer.
await page.goto(`${BASE}#/more`);
await page.getByText('✨ Ask the AI helper').click();
await page.getByRole('button', { name: 'Best Stableford round ever?' }).click();
await page.getByText(/Bluey’s 44 points at Kurri/).waitFor({ timeout: 10000 });
check(true, 'a history answer shows');
check(calls.at(-1).body.mode === 'history' && calls.at(-1).body.text === 'Best Stableford round ever?', 'history call sends the question');
check(await page.getByText('54 questions left this month for the group · 6 for you today').isVisible(), 'questions left shows on Ask');
await page.screenshot({ path: `${SHOTS}/3-ask.png`, fullPage: true });
// The conversation is still there after leaving the page (kept for the session).
await page.goto(`${BASE}#/more`);
await page.getByText('Group & invites').waitFor({ timeout: 10000 });
check(await page.getByText('📜 History and import').isVisible(), 'More has "📜 History and import" for organisers');
await page.goto(`${BASE}#/ask`);
await page.getByText(/Bluey’s 44 points at Kurri/).waitFor({ timeout: 10000 });
check(await page.getByText('Best Stableford round ever?').last().isVisible(), 'back on Ask: the earlier question and answer are still there');
// Busy once: retried by itself, the answer shows, no error.
const n0 = calls.length;
await page.getByLabel('Your question').fill('Who has the most birdies?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.getByText('Who has the most birdies?').waitFor({ timeout: 10000 });
await page.waitForTimeout(800);
check(calls.length - n0 === 2 && !(await page.getByText(/busy right now/).isVisible().catch(() => false)), 'busy once: one automatic retry, then the answer (no error shown)');

// 5. A player can ask too.
organiser = false;
await page.reload();
await page.getByLabel('Your question').fill('Who won our last trip?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.getByText(/Bluey’s 44 points/).first().waitFor({ timeout: 10000 });
check(calls.at(-1).body.text === 'Who won our last trip?', 'a player can ask about the history');
organiser = true;

// 6. Switched off: hidden everywhere.
db.group_features.find((f) => f.feature_key === 'ai_helper').enabled = false;
const before = calls.length;
await page.goto(`${BASE}#/setup`);
await page.reload();
await page.getByText('Set up your trip').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
check(!(await page.getByText('✨ Set it up for me').isVisible().catch(() => false)), 'switched off: no "Set it up for me" box');
await page.goto(`${BASE}#/more`);
await page.getByText('Group & invites').waitFor({ timeout: 10000 });
check(!(await page.getByText('✨ Ask the AI helper').isVisible().catch(() => false)), 'switched off: no Ask in More');
await page.goto(`${BASE}#/ask`);
await page.getByText('The AI helper is switched off for this group.').waitFor({ timeout: 10000 });
check(true, 'switched off: /ask says so');
check(calls.length === before, 'switched off: the function isn’t called');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
