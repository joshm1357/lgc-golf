// The Rulebook v3 (076) browser check, 22 Oct 2026: filter chips, search, "the rules for this round" with a comp rule
// overriding an Ambrose rule, the clash warning when adding a comp rule, tidy wording, and a decided case's
// AI-drafted rule change. Fake database and a fake ai-helper function only.
// Usage: node rulebook-v3-test.mjs <base> <shotDir>   e.g. http://localhost:4388/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4388/lgc-golf/';
const SHOTS = process.argv[3] || './shots-rulebook-v3';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000d';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const BD = 'ffffffff-0000-4000-8000-0000000000bd';
const PB = 'ffffffff-0000-4000-8000-0000000000bb';
const OB_RULE = 'bbbbbbbb-0000-4000-8000-000000000001';
const PB_RULE = 'bbbbbbbb-0000-4000-8000-000000000002';
const BD_RULE = 'bbbbbbbb-0000-4000-8000-000000000003';
const CASE = 'eeeeeeee-0000-4000-8000-0000000000c1';
const now = '2026-10-22T08:00:00.000Z';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const feats = ['feed', 'side_comps', 'planner', 'games', 'rule_voting', 'rule_challenges', 'tribunal', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true }));

const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 0, approved: true, created_at: now },
    { id: A, name: 'Al Blue', nickname: null, handicap: 0, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-21', end_date: '2026-10-23', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], scores: [],
  round_players: [K, A].flatMap((p) => [R1, R2].map((r) => ({ round_id: r, player_id: p, playing_handicap: 0 }))),
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday', play_date: '2026-10-22', format: 'stableford', status: 'live', ld_holes: [5], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: '2026-10-23', format: 'ambrose', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
  ],
  comps: [
    { id: BD, group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [R1], settings: {}, trophy_id: null, sort: 1, retired: false, created_at: now },
    { id: PB, group_id: GROUP, trip_id: TRIP, name: 'Putt Buddies', kind: 'ambrose_teams', round_ids: [R2], settings: {}, trophy_id: null, sort: 2, retired: false, created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [],
  rules: [
    { id: OB_RULE, group_id: GROUP, title: 'OB plays as a penalty area', detail: 'Drop where it went out, one shot.', category: 'etiquette', applies_to: ['all'], value: '+1 shot', status: 'active', overrides: 'golf.ob', sort: 1, created_at: now },
    { id: PB_RULE, group_id: GROUP, title: 'Putt Buddies: both drives used 3 times', detail: 'Each player’s drive must be used at least 3 times.', category: 'format', applies_to: ['all'], value: null, status: 'active', overrides: 'ambrose.drives', scope_kind: 'comp', scope_id: PB, sort: 2, created_at: now },
    { id: BD_RULE, group_id: GROUP, title: 'BD: max 2 mulligans a round', detail: 'Two mulligans a round, never on the green.', category: 'etiquette', applies_to: ['all'], value: '2 a round', status: 'active', scope_kind: 'comp', scope_id: BD, sort: 3, created_at: now },
  ],
  rule_votes: [], rule_versions: [], round_rule_versions: [],
  cases: [{ id: CASE, group_id: GROUP, kind: 'ruling', title: 'Does OB count as a penalty area in the BD?', body: 'Al dropped near the fence in the BD.', rule_id: OB_RULE, proposal: { answer: 'No' },
    raised_by: A, raised_via: 'app', settings: { decides: 'organiser' }, stage: 'organiser', status: 'passed', verdict: 'In the BD it’s stroke and distance — no penalty-area drop.', votes_for: 3, votes_against: 1, votes_abstain: 0, decided_at: now, apply_state: 'applied', hidden: false, created_at: now }],
  case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], side_comp_conditions: [],
  round_games: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', group_id: GROUP, round_id: R1, kind: 'skins', stake: 5, options: { net: true, carry: true }, settings: {}, retired: false, created_at: now }],
  custom_games: [],
  group_members: [{ group_id: GROUP, player_id: K, role: 'organiser' }, { group_id: GROUP, player_id: A, role: 'player' }],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  group_features: feats,
};
const writes = [];
const aiCalls = [];
const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}
function aiAnswer(body) {
  aiCalls.push(body);
  if (body.mode === 'rules_draft') return { draft: { action: 'add', rule_id: null, title: 'BD: OB is stroke and distance', detail: 'In the BD Trophy, out of bounds is one shot and replay from where you hit it.', value: null, category: 'etiquette', scope_kind: 'comp', scope_id: BD, scope_key: null, overrides: null, overrides_rule: OB_RULE, note: 'From the ruling', ai: true }, remaining: { month: 50, today: 8 } };
  if (body.mode === 'rules_tidy') return { tidy: { title: 'Putt Buddies: four drives each', detail: 'Each player must have four of their drives used.', value: '4 drives' } };
  if (body.mode === 'rules_conflicts') return { conflicts: [] };
  return { error: 'Unknown request.' };
}
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/functions/v1/ai-helper')) return json(aiAnswer(JSON.parse(req.postData() || '{}')));
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    writes.push({ method: 'RPC', table: fn, body });
    if (fn === 'apply_verdict_draft') {
      const id = crypto.randomUUID();
      db.rules.push({ id, group_id: GROUP, status: 'active', applies_to: ['all'], created_at: new Date().toISOString(), ...body.p_draft });
      const c = db.cases.find((x) => x.id === body.p_case);
      c.proposal = { ...c.proposal, draft_applied_at: new Date().toISOString(), draft_rule_id: id };
      return json(id);
    }
    return json(fn === 'governance_tick' ? 0 : null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || (db[table] = []);
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (method === 'GET') { const out = filterRows(rows, url.searchParams); return json(single ? out[0] || null : out); }
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    writes.push({ method, table, body });
    if (method === 'POST') {
      const made = (Array.isArray(body) ? body : [body]).map((b) => ({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), retired: false, ...b }));
      rows.push(...made);
      return json(single ? made[0] : made, 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
      return json(single ? rows.find((r) => r.id === id) : [], 200);
    }
    if (method === 'DELETE') return json([]);
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. The filter bar: a comp chip shows its rules and the layers it inherits, with overrides worked out.
await page.goto(`${BASE}#/rules`);
const bar = page.getByTestId('rules-filter');
await bar.waitFor({ timeout: 15000 });
await page.getByTestId('standard-rules').waitFor({ timeout: 15000 });
check(await page.getByTestId('standard-rules').isVisible(), '"All" shows the classic Rulebook (standard rules + ours)');
await bar.getByRole('button', { name: 'Putt Buddies' }).click();
const eff = page.getByTestId('effective-rules');
await eff.waitFor({ timeout: 5000 });
check(await page.getByTestId(`eff-${PB_RULE}`).isVisible(), 'Putt Buddies chip: its own rule is shown');
check(!(await page.getByTestId(`eff-${BD_RULE}`).isVisible().catch(() => false)), 'Putt Buddies chip: the BD rule is not');
check(await page.getByTestId('eff-ambrose.drives').isVisible(), 'Putt Buddies chip: inherits the Ambrose rules');
check(!(await page.getByTestId('eff-stableford.points').isVisible().catch(() => false)), 'Putt Buddies chip: no Stableford rules');
check(await page.getByTestId('layer-golf').isVisible(), 'Putt Buddies chip: inherits the rules of golf');
const drives = await page.getByTestId('eff-ambrose.drives').innerText();
check(drives.includes('Overridden by Putt Buddies: both drives used 3 times (Putt Buddies)'), 'the Ambrose drives rule says "Overridden by … (Putt Buddies)"');
const deco = await page.getByTestId('eff-ambrose.drives').locator('strong').first().evaluate((el) => getComputedStyle(el).textDecorationLine);
check(deco.includes('line-through'), 'the overridden rule is struck through');
await page.screenshot({ path: `${SHOTS}/1-comp-chip.png`, fullPage: true });

// 2. Search across titles and wording.
await bar.getByRole('button', { name: 'All', exact: true }).click();
await page.getByPlaceholder('🔎 Search the rules').fill('mulligans');
await eff.waitFor({ timeout: 5000 });
check(await page.getByTestId(`eff-${BD_RULE}`).isVisible(), 'search "mulligans" finds the BD rule');
check(!(await page.getByTestId(`eff-${PB_RULE}`).isVisible().catch(() => false)), 'search leaves out rules without the word');
await page.getByPlaceholder('🔎 Search the rules').fill('');

// 3. The round view: Saturday (Ambrose, counts for Putt Buddies).
await page.getByTestId('round-picker').selectOption(R2);
await page.getByTestId('round-rules-title').waitFor({ timeout: 5000 });
check((await page.getByTestId('round-rules-title').innerText()).includes('Saturday'), 'round picker shows "The rules for Saturday"');
check((await page.getByTestId('eff-ambrose.drives').innerText()).includes('Overridden by Putt Buddies'), 'Ambrose round: the comp rule overrides the Ambrose rule');
await page.getByTestId('layer-golf').locator('summary').click();
check((await page.getByTestId('eff-golf.ob').innerText()).includes('Overridden by OB plays as a penalty area'), 'Ambrose round: our local rule overrides the rules of golf');
check(!(await page.getByTestId(`eff-${BD_RULE}`).isVisible().catch(() => false)), 'Ambrose round: the BD rule (Friday only) isn’t in play');
await page.screenshot({ path: `${SHOTS}/2-round-view.png`, fullPage: true });
await page.getByRole('button', { name: 'Close' }).click();

// 4. The leaderboard's "Rules for today" chip opens Friday's rules.
await page.goto(`${BASE}#/leaderboard`);
await page.getByTestId('rules-today').waitFor({ timeout: 15000 });
await page.getByTestId('rules-today').click();
await page.getByTestId('round-rules-title').waitFor({ timeout: 10000 });
check((await page.getByTestId('round-rules-title').innerText()).includes('Friday'), 'leaderboard chip opens "The rules for Friday"');
check(await page.getByTestId(`eff-${BD_RULE}`).isVisible(), 'Friday: the BD rule is in play');
check(await page.getByTestId('eff-skins.how').isVisible(), 'Friday: the skins game’s rules are in play');
await page.getByRole('button', { name: 'Close' }).click();

// 5. Add a comp rule from the Putt Buddies chip: the scope is set and the clash warning shows.
await page.getByTestId('rules-filter').getByRole('button', { name: 'Putt Buddies' }).click();
await page.getByRole('button', { name: /Add a rule|Propose a rule/ }).click();
const sheetTitle = page.getByPlaceholder('e.g. Birdie bonus');
await sheetTitle.waitFor({ timeout: 5000 });
check(await page.getByTestId('scope-select').inputValue() === `comp:${PB}`, 'a new rule from the Putt Buddies chip is for Putt Buddies');
await sheetTitle.fill('PB four drives');
await page.getByPlaceholder('How it works, when it counts').fill('each player needs 4 drives used');
const warn = page.getByTestId('conflict-warning');
await warn.waitFor({ timeout: 5000 });
const wt = await warn.innerText();
// (The Ambrose drives rule is already overridden by our Putt Buddies rule, so the clash is with the rule in force.)
check(wt.includes('⚠️ This changes: Putt Buddies: both drives used 3 times') && wt.includes('Both are about drives'), 'clash warning: "⚠️ This changes: Putt Buddies: both drives used 3 times" (the drives rule in force)');
check(await warn.locator('input[type=checkbox]').first().isChecked(), 'the clash is ticked as "this changes" (the organiser can untick)');
await page.getByTestId('ai-tidy').click();
await page.getByTestId('tidy-suggestion').waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Use this' }).click();
check(await sheetTitle.inputValue() === 'Putt Buddies: four drives each', '"✨ Tidy the wording" → "Use this" takes the AI’s wording');
await page.screenshot({ path: `${SHOTS}/3-add-comp-rule.png`, fullPage: true });
await page.getByRole('button', { name: 'Add it straight in' }).click();
await page.waitForTimeout(800);
const added = writes.find((w) => w.method === 'POST' && w.table === 'rules');
check(added && added.body.scope_kind === 'comp' && added.body.scope_id === PB && added.body.overrides_rule === PB_RULE, 'saved as a Putt Buddies rule that changes our Putt Buddies rule (organiser could untick)');

// 6. A decided ruling: the AI drafts the rule change; confirming writes it through apply_verdict_draft.
await page.goto(`${BASE}#/tribunal/case/${CASE}`);
const card = page.getByTestId('verdict-rulebook');
await card.waitFor({ timeout: 15000 });
await page.getByTestId('draft-source').waitFor({ timeout: 10000 });
check((await page.getByTestId('draft-source').innerText()).includes('The Caddie drafted this from the verdict — check it'), 'the case shows "The Caddie drafted this from the verdict — check it"');
check(await page.getByTestId('draft-title').inputValue() === 'BD: OB is stroke and distance', 'the draft has the AI’s title');
check(await page.getByTestId('draft-scope').inputValue() === `comp:${BD}`, 'the draft is for the BD Trophy');
check(aiCalls.some((b) => b.mode === 'rules_draft' && b.case_id === CASE && Array.isArray(b.standard)), 'the app asked the AI with the case id and the standard rules (as data)');
await page.getByTestId('draft-title').fill('BD: OB is stroke and distance (no drop)');
await page.screenshot({ path: `${SHOTS}/4-verdict-draft.png`, fullPage: true });
await page.getByTestId('draft-confirm').click();
await page.waitForTimeout(800);
const rpc = writes.find((w) => w.table === 'apply_verdict_draft');
check(rpc && rpc.body.p_case === CASE && rpc.body.p_draft.title === 'BD: OB is stroke and distance (no drop)' && rpc.body.p_draft.overrides_rule === OB_RULE && rpc.body.p_draft.ai === true, 'confirming writes the (edited) rule through apply_verdict_draft');

// 7. AI switched off: the case's own words are pre-filled instead (no AI call).
db.cases[0].proposal = { answer: 'No' };
db.group_features = feats.map((f) => (f.feature_key === 'ai_helper' ? { ...f, enabled: false } : f));
const before = aiCalls.length;
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('tgt-verdict-draft-')) localStorage.removeItem(k); });
await page.reload();
await page.getByTestId('draft-source').waitFor({ timeout: 15000 });
check((await page.getByTestId('draft-source').innerText()).includes('case’s own wording'), 'AI off: the case’s own wording is pre-filled');
check((await page.getByTestId('draft-detail').inputValue()).includes('stroke and distance'), 'AI off: the verdict is the starting wording');
check(aiCalls.length === before, 'AI off: no call to the AI');

await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
