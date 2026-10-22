// The Rulebook v2, custom games and side comp conditions (073) browser check, 22 Oct 2026. Fake database only.
// Usage: node rulebook-v2-test.mjs <base> <shotDir>   e.g. http://localhost:4384/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4384/lgc-golf/';
const SHOTS = process.argv[3] || './shots-rulebook-v2';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000d';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const OB_RULE = 'bbbbbbbb-0000-4000-8000-000000000001';
const now = '2026-10-22T08:00:00.000Z';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const feats = ['feed', 'side_comps', 'planner', 'games', 'rule_voting', 'tribunal'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true }));

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
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: '2026-10-23', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [],
  rules: [
    { id: OB_RULE, group_id: GROUP, title: 'OB plays as a penalty area', detail: 'Drop where it went out, one shot.', category: 'etiquette', applies_to: ['all'], value: '+1 shot', status: 'active', overrides: 'golf.ob', sort: 1, created_at: now },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', group_id: GROUP, title: 'Ready golf always', detail: null, category: 'etiquette', applies_to: ['all'], value: null, status: 'active', sort: 2, created_at: now },
  ],
  rule_votes: [], rule_versions: [], round_rule_versions: [], cases: [], case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], comps: [],
  round_games: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', group_id: GROUP, round_id: R1, kind: 'skins', stake: 5, options: { net: true, carry: true }, settings: {}, retired: false, created_at: now }],
  custom_games: [],
  side_comp_conditions: [{ id: 'f0000000-0000-4000-8000-000000000001', group_id: GROUP, comp: 'ld', conditions: { picks: ['fairway', 'first_shot'] }, updated_at: now }],
  group_members: [{ group_id: GROUP, player_id: K, role: 'organiser' }, { group_id: GROUP, player_id: A, role: 'player' }],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  group_features: feats,
};
const writes = [];
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
  if (p.startsWith('/rest/v1/rpc/')) { writes.push({ method: 'RPC', table: p.split('/').pop() }); return json(p.endsWith('governance_tick') ? 0 : null); }
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

// 1. The Rulebook: Standard rules first, then the group's own; only what the group plays (plus "Show all").
await page.goto(`${BASE}#/rules`);
const std = page.getByTestId('standard-rules');
await std.waitFor({ timeout: 15000 });
await page.getByRole('link', { name: /^OB plays as a penalty area/ }).waitFor({ timeout: 15000 });
const yStd = (await std.boundingBox()).y;
const yOur = (await page.getByTestId('our-rules').boundingBox()).y;
check(yStd < yOur, 'Rulebook shows Standard rules above the local and special rules');
for (const k of ['golf', 'stableford', 'skins', 'ld']) check(await page.getByTestId(`std-${k}`).isVisible(), `standard section shown for what's played: ${k}`);
for (const k of ['ambrose', 'nassau', 'cup']) check(!(await page.getByTestId(`std-${k}`).isVisible().catch(() => false)), `standard section hidden (not played): ${k}`);
await std.getByRole('button', { name: 'Show all' }).click();
check(await page.getByTestId('std-ambrose').isVisible(), '"Show all" shows Ambrose too');
await std.getByRole('button', { name: 'Just ours' }).click();

// 2. The overridden standard rule links to the group's rule.
check((await page.getByTestId('std-golf').innerText()).includes('we differ'), 'Rules of golf section says "we differ"');
await page.getByTestId('std-golf').locator('summary').click();
const link = page.getByTestId('std-rule-golf.ob').getByTestId('override-link');
check(await link.isVisible() && (await link.innerText()).includes('We play this differently — see our rule: OB plays as a penalty area'), 'Out of bounds shows "We play this differently — see our rule"');
check(await page.getByTestId('changes-standard').first().isVisible(), 'the local rule says which standard rule it changes');
await page.getByTestId('std-ld').locator('summary').click();
check((await page.getByTestId('std-ld').innerText()).includes('Fairway only · first shot'), 'longest drive section shows our conditions');
await page.screenshot({ path: `${SHOTS}/1-rulebook.png`, fullPage: true });
await link.click();
await page.waitForURL(new RegExp(`#/rules/${OB_RULE}`), { timeout: 10000 });
check(true, 'tapping the link opens our rule');

// 3. Propose an idea: it goes up for a vote (a case), with the standard rule it changes.
await page.goto(`${BASE}#/rules`);
await page.getByTestId('rule-ideas').waitFor({ timeout: 15000 });
await page.getByTestId('rule-ideas').locator('summary').click();
const idea = page.getByTestId('rule-ideas').locator('.row', { hasText: 'Beer-can gimmes' });
await idea.getByRole('button', { name: 'Propose' }).click();
const titleBox = page.getByPlaceholder('e.g. Birdie bonus');
await titleBox.waitFor({ timeout: 5000 });
check(await titleBox.inputValue() === 'Beer-can gimmes', 'the idea fills in the propose sheet');
check(await page.getByTestId('overrides-select').inputValue() === 'golf.green', 'it links to the standard rule it changes (On the green)');
await page.screenshot({ path: `${SHOTS}/2-propose.png`, fullPage: true });
await page.getByRole('button', { name: 'Put it to a vote' }).click();
await page.waitForTimeout(800);
const proposed = writes.find((w) => w.method === 'POST' && w.table === 'rules');
check(proposed && proposed.body.status === 'proposed' && proposed.body.overrides === 'golf.green', 'the idea goes in as a proposed rule (the database opens its case / vote) with overrides = golf.green');

// 4. Copy Skins → a custom game with carry-overs off and a house rule; pick it for Saturday.
await page.goto(`${BASE}#/games?r=${R1}`);
const card = page.getByTestId('custom-games');
await card.waitFor({ timeout: 15000 });
await card.getByRole('button', { name: /Copy Skins/ }).click();
await page.getByRole('button', { name: 'No carry-overs' }).click();
await page.getByPlaceholder(/skin won with a birdie/).fill('Loser of the last skin shouts the first round.');
await page.getByLabel('Name', { exact: true }).fill('Beer skins');
await page.screenshot({ path: `${SHOTS}/3-custom-game.png`, fullPage: true });
await page.getByRole('button', { name: 'Save our game' }).click();
await page.waitForTimeout(800);
const cg = db.custom_games[0];
check(cg && cg.name === 'Beer skins' && cg.base_type === 'skins' && cg.settings.carry === false && cg.rules_text.includes('shouts'), 'custom game saved: Beer skins, based on Skins, carry-overs off, house rule');
await page.reload();
await page.getByTestId('custom-game').first().waitFor({ timeout: 10000 });
check((await page.getByTestId('custom-game').first().innerText()).includes('No carry-overs'), 'custom game shows on the Games screen with its settings');

await page.goto(`${BASE}#/admin`);
await page.getByTestId('round-games').first().waitFor({ timeout: 15000 });
const sat = page.getByTestId('round-games').last();
const chip = sat.getByRole('button', { name: /\+ Beer skins/ });
check(await chip.isVisible(), 'the custom game is offered on a round like a standard one');
await chip.click();
await page.waitForTimeout(800);
const rg = db.round_games.find((g) => g.round_id === R2);
check(rg && rg.kind === 'skins' && rg.custom_game_id === cg.id && rg.options.carry === false, 'picked for Saturday: a skins game linked to Beer skins, carry-overs off');
await page.screenshot({ path: `${SHOTS}/4-admin-pick.png`, fullPage: true });

// 4b. Standard options are standard: validated skins on Friday's skins is still the standard game.
const fri = page.getByTestId('round-games').first();
const skinsRow = fri.locator('.card', { hasText: 'Skins $5' }).first();
await skinsRow.getByRole('button', { name: 'Change' }).click();
await skinsRow.getByRole('button', { name: 'Validated skins' }).click();
await skinsRow.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(800);
const friSkins = db.round_games.find((g) => g.round_id === R1);
check(friSkins.settings.validate === true && !friSkins.custom_game_id, 'validated skins is a standard option (no custom game)');

await page.goto(`${BASE}#/games?r=${R2}`);
await page.getByTestId('house-rules').waitFor({ timeout: 15000 });
check((await page.getByTestId('game-skins').innerText()).includes('Beer skins'), 'Games screen shows the custom game by its name with its house rules');

// 5. Longest drive "Fairway only · first shot" on the comp card and the entry screen.
await page.goto(`${BASE}#/comps?r=${R1}&kind=ld`);
const cond = page.getByTestId('comp-conditions').first();
await cond.waitFor({ timeout: 15000 });
check((await cond.innerText()).includes('Fairway only · first shot'), 'longest drive card shows "Fairway only · first shot"');
await page.screenshot({ path: `${SHOTS}/5-ld.png`, fullPage: true });
await page.getByRole('button', { name: /Enter a shot/ }).click();
await page.waitForTimeout(500);
check(await page.getByTestId('comp-conditions').count() >= 2, 'the entry screen shows the conditions too');

// 6. Organiser sets closest-to-the-pin conditions in Admin.
await page.goto(`${BASE}#/admin`);
await page.getByRole('button', { name: 'Your own side comps' }).click();
const ctpRow = page.locator('.row', { hasText: 'Closest to the pin' }).filter({ has: page.getByTestId('conditions-button') }).first();
await ctpRow.getByTestId('conditions-button').click();
await page.getByLabel('Must finish on the green').check();
await page.getByLabel('Must be the tee shot').check();
await page.getByRole('button', { name: 'Save conditions' }).click();
await page.waitForTimeout(800);
const ctp = db.side_comp_conditions.find((c) => c.comp === 'ctp');
check(ctp && JSON.stringify(ctp.conditions) === JSON.stringify({ picks: ['tee_shot', 'green_only'] }), 'closest to the pin conditions saved: tee shot only, on the green only');
await page.screenshot({ path: `${SHOTS}/6-admin-conditions.png`, fullPage: true });

// 7. Games switched off: no custom games card.
db.group_features = feats.map((f) => (f.feature_key === 'games' ? { ...f, enabled: false } : f));
await page.goto(`${BASE}#/rules`);
await page.reload();
await page.getByTestId('standard-rules').waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(!(await page.getByTestId('std-skins').isVisible().catch(() => false)), 'games off: no skins in the standard rules');

await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
