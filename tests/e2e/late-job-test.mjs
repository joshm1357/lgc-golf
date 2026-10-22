// Late organising jobs (085), 22 Oct 2026: the job's "⚠️ 6 days late" badge, the owner's Next step, the organiser's
// late list and one-tap waiver, the penalty line on the leaderboard and scorecard, and the Rulebook rule (0 strokes,
// 5 days, editable by the organiser). No real database: every request to Supabase is answered here.
// Usage: node tests/e2e/late-job-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4391/lgc-golf/';
const SHOTS = process.argv[3] || './shots-latejob';
fs.mkdirSync(SHOTS, { recursive: true });

const P1 = '11111111-1111-4111-8111-111111111111'; // Josh, organiser
const P2 = '22222222-2222-4222-8222-222222222222'; // Mike, owns the bus job
const P3 = '33333333-3333-4333-8333-333333333333'; // Adam
const GROUP = 'a0a0a0a0-0000-4000-8000-00000000085a';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000085';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000085';
const COURSE = 'cccccccc-0000-4000-8000-000000000085';
const R1 = 'dddddddd-0000-4000-8000-000000000085';
const RULE = 'bbbbbbbb-0000-4000-8000-000000000085';
const BUS = 'ffffffff-0000-4000-8000-000000000001';
const ADJ = 'ffffffff-0000-4000-8000-0000000000a1';
const now = new Date().toISOString();
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));

const lateRule = (x, n) => ({
  id: RULE, group_id: GROUP, title: 'Late organising job', category: 'fines', applies_to: ['all'], status: 'active', system_key: 'late_job',
  late_strokes: x, late_days: n, value: `${x} stroke${x === 1 ? '' : 's'} · ${n} days`, sort: 900, proposed_by: null, decided_at: now, created_at: now,
  detail: `If you’re given a trip job and it’s more than ${n} days overdue, you cop ${x} penalty strokes in the next round. Finish it before that round starts and it’s off. An organiser can waive it.${x === 0 ? ' (At 0 strokes it’s listed but nothing happens.)' : ''}`,
  decision_note: 'Standard rule — starts at 0 strokes, so it’s listed but does nothing until the group changes it.',
});

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Autumn Trip', start_date: day(-1), end_date: day(1), status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], side_entries: [],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday — Cypress Lakes', play_date: day(0), format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  round_players: [{ round_id: R1, player_id: P2, playing_handicap: 18 }, { round_id: R1, player_id: P3, playing_handicap: 22 }],
  scores: [
    ...[1, 2, 3].map((h) => ({ round_id: R1, subject_id: P2, subject_type: 'player', hole: h, strokes: 5, picked_up: false, updated_at: now })),
    ...[1, 2, 3].map((h) => ({ round_id: R1, subject_id: P3, subject_type: 'player', hole: h, strokes: 6, picked_up: false, updated_at: now })),
  ],
  rules: [lateRule(0, 5)], rule_votes: [], rule_versions: [], round_rule_versions: [], cases: [], comps: [], posts: [],
  group_features: [], tribunal_cases: [], tribunal_votes: [], governance_settings: [], custom_games: [], round_games: [],
  side_comp_defs: [], side_comp_entries: [], side_comp_conditions: [], cup_sides: [], cup_matches: [],
  plans: [{ id: PLAN, kind: 'trip', name: 'Autumn Trip', status: 'confirmed', start_date: day(30), end_date: day(32), location_name: 'Nowra', proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, trip_id: null, created_at: now }],
  plan_items: [
    { id: BUS, plan_id: PLAN, kind: 'job', title: 'Book the bus', owner_id: P2, due: day(-6), done: false, stage: 'todo', sort: 1, created_by: P1, created_at: now, formula_key: null },
    { id: 'ffffffff-0000-4000-8000-000000000002', plan_id: PLAN, kind: 'job', title: 'Transport / who’s driving', owner_id: P1, due: day(10), done: false, stage: 'todo', sort: 2, created_by: P1, created_at: now, formula_key: 'transport' },
    { id: 'ffffffff-0000-4000-8000-000000000003', plan_id: PLAN, kind: 'job', title: 'Book dinner', owner_id: P3, due: day(-3), done: false, stage: 'todo', sort: 3, created_by: P1, created_at: now, formula_key: null },
  ],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_costs: [], plan_payments: [], plan_transfers: [],
  plan_groups: [], plan_group_members: [], notify_prefs: [], plan_stays: [], plan_budget_items: [],
  plan_rsvps: [[P1, 'in'], [P2, 'in'], [P3, 'in']].map(([p, s]) => ({ plan_id: PLAN, player_id: p, status: s, updated_at: now })),
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  job_penalties: [], score_adjustments: [],
};

let who = P1;
const writes = [];
function match(r, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'group_id' && r.group_id === undefined) continue;
    if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
    else if (v.startsWith('neq.')) { if (String(r[k]) === v.slice(4)) return false; }
    else if (v === 'is.null') { if (r[k] != null) return false; }
    else if (v === 'not.is.null') { if (r[k] == null) return false; }
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
  }
  return true;
}
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const p = url.pathname;
  if (p.startsWith('/functions/')) return json({});
  if (p.startsWith('/rest/v1/rpc/my_status')) {
    const admin = who === P1;
    return json({ is_member: true, is_admin: admin, player_id: who, group_name: 'Hunter Weekend', group_id: GROUP, role: admin ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: admin ? 'organiser' : 'player' }] });
  }
  if (p.endsWith('/rpc/waive_late_penalty')) {
    writes.push({ rpc: 'waive_late_penalty', body });
    if (who !== P1) return json({ message: 'Only an organiser can waive a penalty' }, 400);
    db.job_penalties.push({ item_id: body.p_item, group_id: GROUP, waived_at: new Date().toISOString(), waived_by: P1 });
    let applied = false;
    for (const a of db.score_adjustments) if (a.item_id === body.p_item && !a.waived_at) { a.waived_at = new Date().toISOString(); a.waived_by = P1; applied = true; }
    return json({ status: 'waived', applied });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const rows = (db[table] || []).filter((r) => match(r, url.searchParams));
    if (method === 'GET' || method === 'HEAD') return json(single ? rows[0] || null : rows);
    if (method === 'PATCH') {
      writes.push({ table, body });
      for (const r of rows) Object.assign(r, body);
      if (table === 'rules') for (const r of rows) if (r.system_key === 'late_job') Object.assign(r, lateRule(r.late_strokes, r.late_days));
      return json(single ? rows[0] || null : rows);
    }
    if (method === 'POST') {
      writes.push({ table, body });
      const list = (Array.isArray(body) ? body : [body]).map((b) => { const row = { id: b.id || `9${Math.random().toString(16).slice(2, 9)}-0000-4000-8000-000000000000`, created_at: now, ...b }; (db[table] ||= []).push(row); return row; });
      return json(single ? list[0] : list, 201);
    }
    if (method === 'DELETE') { writes.push({ table, del: true }); return json([]); }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.addInitScript(([u]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: u, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  try { localStorage.setItem('tgt-notify-prompt', String(Date.now())); localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ } catch { /* fine */ }
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const sheet = () => page.locator('.sheet');
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const go = async (hash) => { await page.goto(`${BASE}#${hash}`); await page.reload(); };

// 1. The Rulebook: the standard rule is listed at 0 strokes / 5 days.
who = P1;
await go('/rules');
await page.getByText('Late organising job').first().waitFor({ timeout: 15000 });
check(await page.getByText('0 strokes · 5 days').first().isVisible(), 'Rulebook lists the rule at 0 strokes · 5 days');
check(await page.getByText('Fines', { exact: true }).first().isVisible(), 'it sits under Fines');
check(await page.getByText(/Start your Rulebook/).count() > 0, 'a group with only the standard rule still gets the starter picker');
await shot('lj1-rulebook');
await noSideScroll('rulebook');
await page.getByText('Late organising job').first().click();
await page.getByTestId('late-rule-numbers').waitFor({ timeout: 8000 });
check(/Penalty: 0 strokes/.test(await page.getByTestId('late-rule-numbers').innerText()), 'rule page shows the numbers (tap to dispute)');
await shot('lj2-rule-page');
await page.getByTestId('late-strokes-tag').click();
await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
check(/Rulebook rule · now: 0/.test(await page.getByTestId('rule-sheet').innerText()), 'tapping the strokes shows the rule sheet (disputable)');
await shot('lj3-rule-tag');
await page.keyboard.press('Escape');
await page.locator('.sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
// Organiser turns it up to 2.
await page.getByRole('button', { name: 'Edit (organiser)' }).click();
await page.getByTestId('late-rule-fields').waitFor({ timeout: 5000 });
check(await page.getByTestId('late-strokes').inputValue() === '0' && await page.getByTestId('late-days').inputValue() === '5', 'edit sheet starts at 0 and 5');
check(await sheet().getByRole('button', { name: 'Delete' }).count() === 0, 'the standard rule has no Delete');
await page.getByTestId('late-strokes').fill('2');
await shot('lj4-rule-edit');
await sheet().getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(700);
const ruleWrite = writes.find((w) => w.table === 'rules');
check(ruleWrite && ruleWrite.body.late_strokes === 2 && ruleWrite.body.late_days === 5 && !('value' in ruleWrite.body), `saving sends the numbers, not the words (${JSON.stringify(ruleWrite?.body || {}).slice(0, 120)})`);
check(db.rules[0].late_strokes === 2, 'the rule is now 2 strokes');

// 2. Mike (owner): the Next step warns him.
who = P2;
await page.evaluate(() => localStorage.clear());
await go(`/plan/${PLAN}?view=overview`);
await page.getByTestId('next-step').waitFor({ timeout: 15000 });
try {
  await page.getByTestId('next-step-late').waitFor({ timeout: 8000 });
  const t = await page.getByTestId('next-step').innerText();
  check(/Your job: Book the bus/.test(t) && /⚠️ 6 days late — 2 penalty strokes if it’s not done before the next round/.test(t), 'Mike’s Next step: ⚠️ 6 days late — 2 penalty strokes …');
} catch { check(false, `Mike’s Next step warns him (saw "${(await page.getByTestId('next-step').innerText()).replace(/\s+/g, ' ')}")`); }
await shot('lj5-owner-next-step');
await noSideScroll('owner next step');
await page.getByTestId('next-step').getByRole('button', { name: 'Open the job' }).click();
await sheet().getByTestId('late-badge').waitFor({ timeout: 5000 });
check(await sheet().getByTestId('waive-penalty').count() === 0, 'Mike can’t waive his own penalty');
await shot('lj6-owner-job');

// 3. Josh (organiser): jobs tab badge + late list; waive in one tap.
who = P1;
await page.evaluate(() => localStorage.clear());
await go(`/plan/${PLAN}?view=organise&tab=jobs`);
await page.getByTestId('job-row').first().waitFor({ timeout: 15000 });
const busRow = page.getByTestId('job-row').filter({ hasText: 'Book the bus' }).first();
await busRow.getByTestId('late-badge').waitFor({ timeout: 8000 });
check(/6 days late — 2 penalty strokes/.test(await busRow.innerText()), 'the bus job shows the late badge');
const dinnerRow = page.getByTestId('job-row').filter({ hasText: 'Book dinner' }).first();
check(await dinnerRow.getByTestId('late-badge').count() === 0, '3 days overdue is not late yet (N = 5)');
check(/1 late job/.test(await page.getByTestId('late-summary').innerText()), 'organiser sees the late list');
await shot('lj7-organiser-jobs');
await noSideScroll('organiser jobs');
await busRow.locator('button').first().click();
await sheet().getByTestId('waive-penalty').waitFor({ timeout: 5000 });
await shot('lj8-waive');
await sheet().getByTestId('waive-penalty').click();
await page.waitForTimeout(800);
check(writes.some((w) => w.rpc === 'waive_late_penalty' && w.body.p_item === BUS), 'one tap calls waive_late_penalty');
await go(`/plan/${PLAN}?view=organise&tab=jobs`);
await page.getByTestId('job-row').first().waitFor({ timeout: 15000 });
const busAfter = page.getByTestId('job-row').filter({ hasText: 'Book the bus' }).first();
await busAfter.getByText(/penalty waived/).waitFor({ timeout: 8000 }).catch(() => {});
check(/penalty waived/.test(await busAfter.innerText()), 'after the waiver the badge says so');
check(await page.getByTestId('late-summary').count() === 0, 'the late list is empty again');
await shot('lj9-waived');

// 4. The leaderboard and scorecard: a penalty already added to Mike's round.
db.job_penalties = [];
db.score_adjustments = [{ id: ADJ, group_id: GROUP, round_id: R1, player_id: P2, strokes: 2, label: 'Late job: Book the bus (+2)', kind: 'late_job', item_id: BUS, rule_id: RULE, waived_at: null, created_at: now }];
await go(`/?r=${R1}`);
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.getByTestId('lb-penalty').waitFor({ timeout: 10000 });
const rows = await page.locator('.lb-row').allInnerTexts();
check(/Mike[\s\S]*late job/.test(rows.join('|')), 'leaderboard shows Mike’s “+2 late job” tag');
await page.waitForTimeout(500);
const mikeRow = page.locator('.lb-row').filter({ hasText: 'Mike' }).first();
// Mike: 3 holes of 5 on par 4s, 18 handicap (1 shot a hole) → 2 points each = 6, minus 2 = 4.
check(/\b4\b/.test(await mikeRow.locator('.lb-main').innerText()), `Mike’s points include the penalty (${await mikeRow.locator('.lb-main').innerText()})`);
await shot('lj10-leaderboard');
await mikeRow.click();
await page.getByTestId('penalty-lines').waitFor({ timeout: 5000 });
check(/Late job: Book the bus \(\+2\)/.test(await page.getByTestId('penalty-lines').innerText()), 'scorecard shows “Late job: Book the bus (+2)”');
check(await page.getByTestId('sc-penalty-row').count() === 1, 'scorecard has a Penalty row before the total');
await shot('lj11-scorecard');
await page.getByTestId('penalty-line').click();
await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
check(/Penalty on the scorecard/.test(await page.getByTestId('rule-sheet').innerText()), 'the penalty line is a RuleTag (disputable)');
await shot('lj12-penalty-tag');

check(!errors.length, `no page errors (${errors.join(' | ')})`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
