// Disputes (082) browser check, 22 Oct 2026: a side comp's "Worth 2 strokes" is tappable → the rule sheet → "⚖️ Dispute
// this" → the Tribunal's raise sheet, filled in → raise_dispute with the right reference → the case page shows what
// was disputed. Then: "Under dispute" on the chip, "You've already raised this", guests and Tribunal-off see the
// explanation only. Fake database only.
// Usage: node dispute-test.mjs <base> <shotDir>   e.g. http://localhost:4389/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4389/lgc-golf/';
const SHOTS = process.argv[3] || './shots-dispute';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000d';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const T1 = 'abababab-0000-4000-8000-000000000001';
const T2 = 'abababab-0000-4000-8000-000000000002';
const G = '33333333-3333-4333-8333-333333333333';
const SC_RULE = 'bbbbbbbb-0000-4000-8000-000000000001';
const NEW_CASE = 'eeeeeeee-0000-4000-8000-0000000000d1';
const now = '2026-10-22T08:00:00.000Z';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const featKeys = ['feed', 'side_comps', 'comp_bonus', 'rule_voting', 'rule_challenges', 'tribunal'];
const feats = (off = []) => featKeys.map((k) => ({ group_id: GROUP, feature_key: k, enabled: !off.includes(k) }));

const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 8, approved: true, created_at: now },
    { id: A, name: 'Al Blue', nickname: null, handicap: 16, approved: true, created_at: now },
    { id: G, name: 'Gus Guest', nickname: null, handicap: 20, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-21', end_date: '2026-10-23', status: 'active', created_at: now }],
  trophies: [], quick_results: [], honour_board: [], round_pins: [], scores: [], round_players: [],
  teams: [{ id: T1, round_id: R2, name: 'Team Kurt', handicap: 4, created_at: now }, { id: T2, round_id: R2, name: 'Team Al', handicap: 5, created_at: now }],
  team_players: [{ team_id: T1, player_id: K }, { team_id: T2, player_id: A }],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [{ id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: '2026-10-22', format: 'ambrose', status: 'live', ld_holes: [9], ctp_holes: [6], comp_bonus: 2, min_drives: 3, own_comps: [], created_at: now }],
  comps: [], plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [],
  rules: [{ id: SC_RULE, group_id: GROUP, title: 'Side comps are worth strokes', detail: 'Closest to pin and longest drive: the winner’s team takes strokes off.', category: 'side_comp', applies_to: ['ambrose'], value: '2 strokes', status: 'active', sort: 1, created_at: now }],
  rule_votes: [], rule_versions: [], round_rule_versions: [],
  cases: [], case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], side_comp_conditions: [],
  round_games: [], custom_games: [],
  group_members: [{ group_id: GROUP, player_id: K, role: 'organiser' }, { group_id: GROUP, player_id: A, role: 'player' }, { group_id: GROUP, player_id: G, role: 'guest' }],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  group_features: feats(),
};
let role = 'player';
const writes = [];
const filterRows = (rows, params) => rows.filter((r) => {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'group_id' && r.group_id === undefined) continue;
    if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
    if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
  }
  return true;
});
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) {
    return json({ is_member: true, is_admin: role === 'organiser', player_id: role === 'guest' ? G : A, group_name: 'Hunter Weekend', group_id: GROUP, role, legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role }] });
  }
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    writes.push({ method: 'RPC', table: fn, body });
    if (fn === 'raise_dispute') {
      const r = await db.rounds.find((x) => x.id === body.p_ref.id);
      db.cases.unshift({ id: NEW_CASE, group_id: GROUP, kind: 'ruling', title: body.p_title, body: body.p_body, rule_id: body.p_ref.rule_id || null,
        proposal: body.p_suggest ? { answer: body.p_suggest } : {}, raised_by: A, raised_via: 'app', settings: { decides: 'players_majority', close_hours: 48 },
        stage: 'voting', status: 'open', closes_at: '2026-10-24T08:00:00.000Z', hidden: false, created_at: new Date().toISOString(),
        subject_kind: 'setting', subject_ref: { ...body.p_ref, value: r ? r[body.p_ref.field] : null } });
      return json(NEW_CASE);
    }
    return json(fn === 'governance_tick' ? 0 : null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || (db[table] = []);
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (method === 'GET') { const out = filterRows(rows, url.searchParams); return json(single ? out[0] || null : out); }
    writes.push({ method, table, body: req.postData() });
    return json(method === 'POST' ? [] : [], method === 'POST' ? 201 : 200);
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
page.on('dialog', (d) => d.accept());

// 1. Side comps: "Worth 2 strokes" looks like normal text, and is tappable.
await page.goto(`${BASE}#/comps?r=${R2}`);
const tag = page.getByTestId('worth-strokes');
await tag.waitFor({ timeout: 15000 });
check((await tag.innerText()).includes('Worth 2 strokes'), 'side comps: "Worth 2 strokes" is a rule chip');
const deco = await tag.evaluate((el) => getComputedStyle(el).textDecorationStyle);
check(deco === 'dotted', 'the chip is a subtle dotted underline (not a loud button)');
await page.screenshot({ path: `${SHOTS}/1-side-comp-worth.png` });

// 2. Tap → the rule sheet: what it says, where it's from, the Rulebook link, "Dispute this".
await tag.click();
const sheet = page.getByTestId('rule-sheet');
await sheet.waitFor({ timeout: 5000 });
const st = await sheet.innerText();
check(st.includes('Worth 2 strokes') && st.includes('takes 2 strokes off'), 'sheet: what the rule says, in plain words');
check(st.includes('Round setting') && st.includes('now: 2'), 'sheet: where it comes from and the value now');
check(await sheet.getByRole('link', { name: 'See it in the Rulebook →' }).getAttribute('href').then((h) => h.includes(SC_RULE)), 'sheet: "See it in the Rulebook" goes to the side comp rule');
await page.screenshot({ path: `${SHOTS}/2-rule-sheet.png` });

// 3. "⚖️ Dispute this" → the Tribunal's raise sheet, pre-filled.
await page.getByTestId('dispute-this').click();
const raise = page.getByTestId('raise-dispute');
await raise.waitFor({ timeout: 10000 });
check(await raise.getByRole('textbox').first().inputValue() === 'Is “Worth 2 strokes” right?', 'raise sheet: the question is filled in');
check((await page.getByTestId('dispute-subject').innerText()).includes('Worth 2 strokes'), 'raise sheet: shows what is being disputed');
await page.getByPlaceholder('e.g. 1 stroke, not 2').fill('1 stroke');
await page.getByPlaceholder('Too much for one lucky shot').fill('One lucky shot shouldn’t swing the day');
await page.screenshot({ path: `${SHOTS}/3-raise-dispute.png` });
await page.getByRole('button', { name: 'Raise the dispute' }).click();
await page.waitForURL(/tribunal\/case\//, { timeout: 10000 });
const rpc = writes.find((w) => w.table === 'raise_dispute');
check(rpc && rpc.body.p_ref.table === 'rounds' && rpc.body.p_ref.id === R2 && rpc.body.p_ref.field === 'comp_bonus', 'raise_dispute gets the round setting (table, id, field)');
check(rpc && rpc.body.p_ref.rule_id === SC_RULE && rpc.body.p_ref.where?.round_id === R2 && rpc.body.p_ref.where?.path?.startsWith('/comps'), '…its Rulebook rule and where it was seen');
check(rpc && rpc.body.p_ref.value === undefined, '…but not the value (the database reads that itself)');
check(rpc && rpc.body.p_suggest === '1 stroke' && rpc.body.p_title === 'Is “Worth 2 strokes” right?', '…the suggestion and the question');
check(!writes.some((w) => w.table === 'rounds' && w.method !== 'GET'), 'nothing changed the setting');

// 4. The case page shows what was disputed.
const thing = page.getByTestId('disputed-thing');
await thing.waitFor({ timeout: 10000 });
const tt = await thing.innerText();
check(tt.includes('Worth 2 strokes') && tt.includes('Value when raised: 2'), 'case page: what was disputed and its value when raised');
await page.screenshot({ path: `${SHOTS}/4-case.png`, fullPage: true });

// 5. Back on side comps: "Under dispute", and "You've already raised this".
await page.goto(`${BASE}#/comps?r=${R2}`);
await page.getByTestId('worth-strokes').waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
check((await page.getByTestId('worth-strokes').innerText()).includes('⚖️'), 'the chip shows ⚖️ while the case is open');
await page.getByTestId('worth-strokes').click();
await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
check(await page.getByTestId('under-dispute').isVisible(), 'sheet says "Under dispute"');
check((await page.getByTestId('rule-sheet').innerText()).includes('You’ve already raised this — see the case'), 'sheet: "You’ve already raised this — see the case"');
check(!(await page.getByTestId('dispute-this').isVisible().catch(() => false)), 'no second Dispute button');
await page.screenshot({ path: `${SHOTS}/5-already-raised.png` });

// 6. A guest sees the explanation but can't dispute.
db.cases = [];
role = 'guest';
await page.goto(`${BASE}#/comps?r=${R2}`);
await page.reload();
await page.getByTestId('worth-strokes').waitFor({ timeout: 15000 });
await page.getByTestId('worth-strokes').click();
await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
check((await page.getByTestId('rule-sheet').innerText()).includes('takes 2 strokes off'), 'guest: sees the explanation');
check(!(await page.getByTestId('dispute-this').isVisible().catch(() => false)), 'guest: no Dispute button');
check((await page.getByTestId('rule-sheet').innerText()).includes('Guests can see the rule'), 'guest: told why');
await page.screenshot({ path: `${SHOTS}/6-guest.png` });

// 7. Tribunal switched off: explanation only.
role = 'player';
db.group_features = feats(['tribunal']);
await page.reload();
await page.getByTestId('worth-strokes').waitFor({ timeout: 15000 });
await page.getByTestId('worth-strokes').click();
await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
check(!(await page.getByTestId('dispute-this').isVisible().catch(() => false)), 'Tribunal off: no Dispute button');
check((await page.getByTestId('rule-sheet').innerText()).includes('switched on'), 'Tribunal off: says it needs switching on');

// 8. Score entry: "min 3 each" is a rule chip too.
db.group_features = feats();
await page.goto(`${BASE}#/score/${R2}`);
const md = page.getByTestId('min-drives');
const mdOk = await md.waitFor({ timeout: 10000 }).then(() => true, () => false);
check(mdOk, 'score entry: minimum drives is a rule chip');
if (mdOk) await page.screenshot({ path: `${SHOTS}/7-min-drives.png` });

await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); for (const f of fails) console.log(` - ${f}`); process.exit(1); }
console.log('\nAll checks passed.');
