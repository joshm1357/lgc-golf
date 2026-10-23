// ov30 — rule penalties and Ambrose drives (migration 099), 23 Oct 2026. Josh: "not taking 6 drives from each player is 2
// strokes per drive under the requirement". Walks an Ambrose round: whose drive on each hole (also offline), the live
// tracker, the warning and the "needs one" hint, the projected strokes on the board, the round locking (the server's
// drives penalty), "+strokes" on the board, the organiser's one-tap waive, the Penalty sheet (organiser applies, a
// player proposes and the organiser confirms, a guest gets no button), and the drives rule in the Rulebook.
// No real database: every request to Supabase is answered here (the server's parts are mimicked, the SQL is tested
// in supabase/tests/099_rule_penalties.sql).
// Usage: node tests/e2e/rule-penalty-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4355/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ov30';
fs.mkdirSync(SHOTS, { recursive: true });

const AL = '11111111-1111-4111-8111-111111111111'; // Al — organiser
const BO = '22222222-2222-4222-8222-222222222222'; // Bo — player
const CY = '33333333-3333-4333-8333-333333333333'; // Cy — player, short of drives
const GU = '44444444-4444-4444-8444-444444444444'; // Gus — guest
const GROUP = 'a0a0a0a0-0000-4000-8000-000000000099';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000099';
const COURSE = 'cccccccc-0000-4000-8000-000000000099';
const R1 = 'dddddddd-0000-4000-8000-000000000099';
const TEAM = 'abababab-0000-4000-8000-000000000099';
const DRIVES = 'bbbbbbbb-0000-4000-8000-000000000099';
const MULL = 'bbbbbbbb-0000-4000-8000-0000000000aa';
const now = new Date().toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
// 15 holes played: Al 7 drives, Bo 6, Cy 2. Three holes left — Cy can make up at most 3 of the 4 he needs.
const drivers = [...Array(7).fill(AL), ...Array(6).fill(BO), CY, CY];
const uid = (n) => `9${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
let seq = 1;

const drivesRule = (n2, n3, n4, p) => ({
  id: DRIVES, group_id: GROUP, title: 'Ambrose minimum drives', category: 'format', applies_to: ['ambrose'], status: 'active', system_key: 'ambrose_drives',
  drives_2: n2, drives_3: n3, drives_4: n4, breach_strokes: p, value: `${n3} drives each in a three · ${n4} in a four · ${n2} in a pair · +${p} a drive short`,
  detail: `In Ambrose, each player’s drive must be used at least ${n3} times in a team of three…`, sort: 905, decided_at: now, created_at: now,
  decision_note: 'Standard rule — the usual numbers; the group can change them.',
});

const db = {
  players: [
    { id: AL, name: 'Al Able', nickname: 'Al', handicap: 10, approved: true, created_at: now },
    { id: BO, name: 'Bo Bell', nickname: 'Bo', handicap: 14, approved: true, created_at: now },
    { id: CY, name: 'Cy Cole', nickname: 'Cy', handicap: 20, approved: true, created_at: now },
    { id: GU, name: 'Gus Guest', nickname: 'Gus', handicap: 24, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Spring Trip', start_date: today, end_date: today, status: 'active', created_at: now }],
  trophies: [], quick_results: [], honour_board: [], round_pins: [], side_entries: [], posts: [], comps: [], group_features: [],
  courses: [{ id: COURSE, name: 'Test Links', holes, created_at: now }],
  rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Sunday Ambrose', play_date: today, format: 'ambrose', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, min_drives: null, created_at: now }],
  teams: [{ id: TEAM, round_id: R1, name: 'The Drivers', handicap: 5, created_at: now }],
  team_players: [AL, BO, CY].map((p) => ({ team_id: TEAM, player_id: p })),
  round_players: [AL, BO, CY].map((p) => ({ round_id: R1, player_id: p, playing_handicap: 10 })),
  scores: drivers.map((d, i) => ({ round_id: R1, subject_id: TEAM, subject_type: 'team', hole: i + 1, strokes: 4, picked_up: false, tee_shot_player: d, updated_at: now })),
  rules: [
    drivesRule(6, 6, 4, 2),
    { id: MULL, group_id: GROUP, title: 'No mulligans', category: 'etiquette', applies_to: ['all'], status: 'active', system_key: null, breach_strokes: 1, value: null, detail: 'One hit, one stroke.', sort: 1, decided_at: now, created_at: now },
  ],
  rule_votes: [], rule_versions: [], round_rule_versions: [], cases: [], tribunal_cases: [], tribunal_votes: [], governance_settings: [],
  custom_games: [], round_games: [], side_comp_defs: [], side_comp_entries: [], side_comp_conditions: [], cup_sides: [], cup_matches: [],
  plans: [], plan_rsvps: [], plan_polls: [], plan_options: [], notify_prefs: [], draws: [], award_strokes: [],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  score_adjustments: [], penalty_proposals: [], job_penalties: [],
};

let who = AL;
let offline = false;
const roleOf = () => (who === AL ? 'organiser' : who === GU ? 'guest' : 'player');
const rpcs = [];
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
const nameOf = (id) => db.players.find((p) => p.id === id)?.nickname;
/** What private.apply_drive_penalties does when the round locks (mimicked). */
function serverLock() {
  const used = {};
  for (const s of db.scores.filter((x) => x.round_id === R1 && x.tee_shot_player)) used[s.tee_shot_player] = (used[s.tee_shot_player] || 0) + 1;
  for (const p of [AL, BO, CY]) {
    const short = 6 - (used[p] || 0);
    if (short > 0) db.score_adjustments.push({ id: uid(seq++), group_id: GROUP, round_id: R1, player_id: p, strokes: short * 2, kind: 'rule_breach', rule_id: DRIVES, breach_key: 'drives', label: `Drives: ${nameOf(p)} ${used[p] || 0} of 6 (+${short * 2})`, waived_at: null, created_at: now });
  }
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
    const role = roleOf();
    return json({ is_member: true, is_admin: role === 'organiser', player_id: who, group_name: 'Drive Club', group_id: GROUP, role, legacy: false, groups: [{ id: GROUP, name: 'Drive Club', slug: 'drive', role }] });
  }
  if (p.endsWith('/rpc/apply_rule_penalty')) {
    rpcs.push({ rpc: 'apply_rule_penalty', who, body });
    if (roleOf() === 'guest') return json({ message: 'Guests can’t give penalties' }, 400);
    const rule = db.rules.find((r) => r.id === body.p_rule);
    const label = `${rule.title}${body.p_hole ? ` · hole ${body.p_hole}` : ''} (+${body.p_strokes})`;
    if (roleOf() === 'organiser') {
      const row = { id: uid(seq++), group_id: GROUP, round_id: body.p_round, player_id: body.p_player, strokes: body.p_strokes, kind: 'rule_breach', rule_id: rule.id, applied_by: who, hole: body.p_hole, note: body.p_note, label, waived_at: null, created_at: now };
      db.score_adjustments.push(row);
      return json({ status: 'applied', id: row.id });
    }
    const row = { id: uid(seq++), group_id: GROUP, round_id: body.p_round, player_id: body.p_player, rule_id: rule.id, strokes: body.p_strokes, hole: body.p_hole, note: body.p_note, label, proposed_by: who, status: 'open', created_at: now };
    db.penalty_proposals.push(row);
    return json({ status: 'proposed', id: row.id });
  }
  if (p.endsWith('/rpc/decide_rule_penalty')) {
    rpcs.push({ rpc: 'decide_rule_penalty', who, body });
    if (roleOf() !== 'organiser') return json({ message: 'Only an organiser can confirm a penalty' }, 400);
    const pp = db.penalty_proposals.find((x) => x.id === body.p_proposal);
    if (!body.p_confirm) { pp.status = 'declined'; return json({ status: 'declined' }); }
    const row = { id: uid(seq++), group_id: GROUP, round_id: pp.round_id, player_id: pp.player_id, strokes: pp.strokes, kind: 'rule_breach', rule_id: pp.rule_id, applied_by: who, proposed_by: pp.proposed_by, hole: pp.hole, label: pp.label, waived_at: null, created_at: now };
    db.score_adjustments.push(row);
    pp.status = 'confirmed'; pp.adjustment_id = row.id;
    return json({ status: 'confirmed', id: row.id });
  }
  if (p.endsWith('/rpc/waive_rule_penalty')) {
    rpcs.push({ rpc: 'waive_rule_penalty', who, body });
    if (roleOf() !== 'organiser') return json({ message: 'Only an organiser can waive a penalty' }, 400);
    const a = db.score_adjustments.find((x) => x.id === body.p_adjustment);
    a.waived_at = new Date().toISOString(); a.waived_by = who;
    return json({ status: 'waived' });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const rows = (db[table] || []).filter((r) => match(r, url.searchParams));
    if (method === 'GET' || method === 'HEAD') return json(single ? rows[0] || null : rows);
    if (table === 'scores' && offline) return route.abort('internetdisconnected');
    if (method === 'PATCH') {
      writes.push({ table, body });
      for (const r of rows) Object.assign(r, body);
      if (table === 'rules') for (const r of rows) if (r.system_key === 'ambrose_drives') Object.assign(r, drivesRule(r.drives_2, r.drives_3, r.drives_4, r.breach_strokes));
      return json(single ? rows[0] || null : rows);
    }
    if (method === 'POST') {
      writes.push({ table, body });
      const list = (Array.isArray(body) ? body : [body]).map((b) => {
        if (table === 'scores') db.scores = db.scores.filter((s) => !(s.round_id === b.round_id && s.subject_id === b.subject_id && s.hole === b.hole));
        const row = { id: b.id || uid(seq++), created_at: now, updated_at: now, ...b };
        (db[table] ||= []).push(row);
        return row;
      });
      return json(single ? list[0] : list, 201);
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
await ctx.addInitScript(([u]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: u, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  try { localStorage.setItem('tgt-notify-prompt', String(Date.now())); localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); } catch { /* fine */ }
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const go = async (hash) => { await page.goto(`${BASE}#${hash}`); await page.reload(); };
const as = async (p) => { who = p; await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (!['lgc-auth', 'tgt-notify-prompt', 'tgt-whats-new', 'tgt-caddie-hello'].includes(k)) localStorage.removeItem(k); }); };
const openTeamCard = async () => {
  await page.locator('.lb-row', { hasText: 'The Drivers' }).first().click();
  await page.locator('.sheet').waitFor({ timeout: 5000 });
};
const closeSheet = async () => { await page.keyboard.press('Escape'); await page.locator('.sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); };

// 1. The board: the drives rule on the round's rules line, and the projected strokes while it's live.
await go('/');
await go(`/?r=${R1}`);
await page.locator('.lb-row', { hasText: 'The Drivers' }).first().waitFor({ timeout: 15000 });
await page.getByTestId('drives-round-rule').waitFor({ timeout: 8000 });
const ruleLine = await page.getByTestId('drives-round-rule').innerText();
check(/Minimum drives: 6 each — \+2 strokes for each drive short/.test(ruleLine), `round rules line shows the drives rule and its penalty (${ruleLine.replace(/\s+/g, ' ')})`);
await page.getByTestId('lb-projected-penalty').waitFor({ timeout: 8000 });
check(/⏳ \+2 drives/.test(await page.getByTestId('lb-projected-penalty').innerText()), 'board shows "⏳ +2 drives" projected on the live round');
check(await page.getByTestId('lb-penalty').count() === 0, 'projected strokes are shown, not counted');
await shot('ov30-1-board-live');
await noSideScroll('board');
await openTeamCard();
check(/Drives: Al 7\/6 · Bo 6\/6 · Cy 2\/6/.test(await page.getByTestId('team-drive-tracker').innerText()), 'team card shows the live tracker');
check(/Cy 2 of 6, 3 holes left \(\+2 projected\)/.test(await page.getByTestId('projected-penalty').innerText()), 'team card shows the projected line');
await shot('ov30-2-team-card-live');
await closeSheet();

// 2. Score entry, hole 16: whose drive, tracker, warning, the next-tee hint.
await go(`/score/${R1}`);
await page.getByTestId('ambrose-drives').waitFor({ timeout: 15000 });
check(await page.getByTestId('drive-pick').count() === 3, 'one tap per player: three drive buttons');
const warn = await page.getByTestId('drive-warning').allInnerTexts();
check(warn.some((w) => /Cy needs 4 more in 3 holes: \+2 strokes coming/.test(w)), `warning: "Cy needs 4 more in 3 holes: +2 strokes coming" (${warn.join(' | ')})`);
check(/Cy needs one/.test(await page.getByTestId('drive-hint').innerText()), '"needs one" hint on the tee');
check(await page.getByTestId('drive-nudge').count() === 1, 'nudge while no drive is picked');
await shot('ov30-3-score-hole16');
await noSideScroll('score entry');
await page.getByTestId('drive-pick').filter({ hasText: 'Cy' }).click();
check(await page.getByTestId('drive-nudge').count() === 0, 'nudge goes once a drive is picked');
check(/3\/6/.test(await page.getByTestId('drive-pick').filter({ hasText: 'Cy' }).innerText()), 'Cy’s count goes to 3/6 straight away');
// Offline: the drive queues with the score.
offline = true;
await page.getByRole('button', { name: /Save & next hole/ }).click();
await page.waitForTimeout(1200);
const queued = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /queue|pending|outbox/i.test(k)).map(([, v]) => v).join(' '));
check(queued.includes('"tee_shot_player":"' + CY + '"') && queued.includes('"hole":16'), 'offline: hole 16 and whose drive wait on the phone together');
check(await page.locator('.sync', { hasText: /waiting to sync/ }).count() > 0, 'offline: "waiting to sync" shows');
offline = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(2500);
const h16 = db.scores.find((s) => s.hole === 16);
check(h16 && h16.tee_shot_player === CY, `back online: hole 16 saved with Cy’s drive (${JSON.stringify(h16 || {}).slice(0, 120)})`);
// Hole 17: no pick — the nudge, and saving without one is fine.
await page.getByTestId('ambrose-drives').waitFor({ timeout: 8000 });
const warn17 = (await page.getByTestId('drive-warning').allInnerTexts()).join(' | ');
check(/Cy needs 3 more in 2 holes: \+2 strokes coming/.test(warn17), `hole 17 warning updates (${warn17})`);
await shot('ov30-4-score-hole17');

// 3. Penalty sheet — the organiser applies "No mulligans" to Bo.
await page.getByTestId('penalty-button').click();
await page.getByTestId('penalty-sheet').waitFor({ timeout: 5000 });
await page.getByTestId('penalty-rule').selectOption(MULL);
check(await page.getByTestId('penalty-strokes').inputValue() === '1', 'strokes default from the rule (+1)');
await page.getByTestId('penalty-who').filter({ hasText: 'Bo' }).click();
await page.getByTestId('penalty-note').fill('Hit two off the 17th');
check(/No mulligans · hole 17 \(\+1\)/.test(await page.getByTestId('penalty-preview').innerText()), 'preview: "No mulligans · hole 17 (+1)"');
await shot('ov30-5-penalty-sheet');
await page.getByTestId('penalty-send').click();
await page.waitForTimeout(800);
const ap = rpcs.find((r) => r.rpc === 'apply_rule_penalty');
check(ap && ap.body.p_player === BO && ap.body.p_rule === MULL && ap.body.p_strokes === 1 && ap.body.p_hole === 17 && ap.body.p_note === 'Hit two off the 17th', `organiser’s penalty goes through apply_rule_penalty (${JSON.stringify(ap?.body || {})})`);
check(db.score_adjustments.some((a) => a.player_id === BO && a.kind === 'rule_breach'), 'it went straight on (organiser)');

// 4. Bo (player) proposes one; Al (organiser) confirms it.
await as(BO);
await go(`/score/${R1}`);
await page.getByTestId('penalty-button').waitFor({ timeout: 15000 });
await page.getByTestId('penalty-button').click();
await page.getByTestId('penalty-sheet').waitFor({ timeout: 5000 });
check(/organiser confirms it/.test(await page.getByTestId('penalty-sheet').innerText()), 'a player is told an organiser confirms it');
await page.getByTestId('penalty-rule').selectOption(MULL);
await page.getByTestId('penalty-who').filter({ hasText: 'Cy' }).click();
await page.getByTestId('penalty-send').click();
await page.waitForTimeout(800);
check(db.penalty_proposals.length === 1 && db.score_adjustments.filter((a) => a.player_id === CY && a.rule_id === MULL).length === 0, 'a player’s penalty is a proposal, not on the card');
await page.reload();
await page.getByTestId('pending-penalties').waitFor({ timeout: 8000 });
check(/waiting on an organiser/.test(await page.getByTestId('pending-penalties').innerText()) && await page.getByTestId('penalty-confirm').count() === 0, 'Bo sees it waiting, with no Confirm');
await shot('ov30-6-player-proposed');
await as(AL);
await go(`/?r=${R1}`);
await page.getByTestId('pending-penalties').waitFor({ timeout: 15000 });
await shot('ov30-7-organiser-confirm');
await page.getByTestId('penalty-confirm').click();
await page.waitForTimeout(800);
check(rpcs.some((r) => r.rpc === 'decide_rule_penalty' && r.body.p_confirm === true), 'organiser confirms with decide_rule_penalty');
check(db.score_adjustments.some((a) => a.player_id === CY && a.rule_id === MULL && a.proposed_by === BO), 'the confirmed penalty is on the card');

// 5. A guest gets no Penalty button.
await as(GU);
await go(`/score/${R1}`);
await page.getByTestId('ambrose-drives').waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
check(await page.getByTestId('penalty-button').count() === 0, 'guests get no Penalty button');

// 6. The round locks: the server adds the drives penalty → +strokes on the board; the organiser waives it.
await as(AL);
db.scores.push({ round_id: R1, subject_id: TEAM, subject_type: 'team', hole: 17, strokes: 4, picked_up: false, tee_shot_player: CY, updated_at: now });
db.scores.push({ round_id: R1, subject_id: TEAM, subject_type: 'team', hole: 18, strokes: 4, picked_up: false, tee_shot_player: null, updated_at: now });
db.rounds[0].status = 'locked';
serverLock();
check(db.score_adjustments.some((a) => a.label === 'Drives: Cy 4 of 6 (+4)'), 'locking: "Drives: Cy 4 of 6 (+4)" on the team');
await go(`/?r=${R1}`);
await page.locator('.lb-row', { hasText: 'The Drivers' }).first().waitFor({ timeout: 15000 });
await page.getByTestId('lb-penalty').waitFor({ timeout: 8000 });
const badge = await page.getByTestId('lb-penalty').innerText();
check(/⚠️ \+6 penalty/.test(badge), `board: "⚠️ +6 penalty" (drives 4 + two mulligans) (${badge})`);
check(await page.getByTestId('lb-projected-penalty').count() === 0, 'no projected strokes once locked');
await shot('ov30-8-board-locked');
await openTeamCard();
const lines = await page.getByTestId('rule-penalty-line').allInnerTexts();
check(lines.some((l) => /Drives: Cy 4 of 6 \(\+4\)/.test(l)), 'team card lists the drives penalty');
check(/rule penalties/.test(await page.getByTestId('sc-penalty-row').innerText()), 'scorecard penalty row: "rule penalties"');
await shot('ov30-9-team-card-locked');
await page.getByTestId('rule-penalty-line').filter({ hasText: 'Drives: Cy' }).getByTestId('waive-rule-penalty').click();
await page.waitForTimeout(800);
const drivesAdj = db.score_adjustments.find((a) => a.breach_key === 'drives');
check(rpcs.some((r) => r.rpc === 'waive_rule_penalty' && r.body.p_adjustment === drivesAdj.id) && drivesAdj.waived_at, 'organiser waives the drives penalty in one tap (recorded)');
await closeSheet();
await page.reload();
await page.getByTestId('lb-penalty').waitFor({ timeout: 15000 });
check(/⚠️ \+2 penalty/.test(await page.getByTestId('lb-penalty').innerText()), 'after the waive the board shows +2 (the two mulligans)');
await openTeamCard();
check(/waived/.test(await page.getByTestId('rule-penalty-line').filter({ hasText: 'Drives: Cy' }).innerText()), 'the waived line stays, struck out');
// Anyone can dispute it: the line is a RuleTag.
await page.getByTestId('penalty-line').filter({ hasText: 'No mulligans · hole 17' }).first().click();
await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
check(/Penalty on the scorecard/.test(await page.getByTestId('rule-sheet').innerText()), 'tapping a penalty opens the dispute sheet');
await shot('ov30-10-dispute');
await closeSheet();
await closeSheet();

// 7. Bo can't waive.
await as(BO);
await go(`/?r=${R1}`);
await page.locator('.lb-row', { hasText: 'The Drivers' }).first().waitFor({ timeout: 15000 });
await openTeamCard();
check(await page.getByTestId('waive-rule-penalty').count() === 0, 'a player gets no Waive button');
await closeSheet();

// 8. The Rulebook: the drives rule's numbers, table, and edit sheet; a rule's penalty.
await as(AL);
await go(`/rules/${DRIVES}`);
await page.getByTestId('drive-rule-numbers').waitFor({ timeout: 15000 });
const nums = await page.getByTestId('drive-rule-numbers').innerText();
check(/Three: 6 each/.test(nums) && /Four: 4 each/.test(nums) && /\+2 a drive short/.test(nums), `rule page shows the numbers (${nums.replace(/\s+/g, ' ').slice(0, 120)})`);
check(/Five\s+3 each\s+1 each/.test(await page.getByTestId('drives-table').innerText()), 'defaults table covers other team sizes and 9 holes');
await shot('ov30-11-drives-rule');
await noSideScroll('drives rule');
await page.getByRole('button', { name: 'Edit (organiser)' }).click();
await page.getByTestId('drive-rule-fields').waitFor({ timeout: 5000 });
await page.getByTestId('drives-4').fill('5');
await page.getByTestId('drives-strokes').fill('3');
await shot('ov30-12-drives-edit');
await page.locator('.sheet').getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(700);
const rw = writes.find((w) => w.table === 'rules');
check(rw && rw.body.drives_4 === 5 && rw.body.breach_strokes === 3 && rw.body.drives_3 === 6 && !('value' in rw.body), `saving sends the numbers (${JSON.stringify(rw?.body || {}).slice(0, 140)})`);
await go(`/rules/${MULL}`);
await page.getByTestId('breach-strokes').waitFor({ timeout: 15000 });
check(/Penalty for breaking it: \+1 stroke/.test(await page.getByTestId('breach-strokes').innerText()), 'any rule shows its penalty');
await page.getByRole('button', { name: 'Edit (organiser)' }).click();
await page.getByTestId('breach-strokes-input').fill('2');
await page.locator('.sheet').getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(700);
const mw = writes.filter((w) => w.table === 'rules').pop();
check(mw && mw.body.breach_strokes === 2, 'an organiser can change a rule’s penalty');

// 9. Standard rules: Ambrose "How it works" shows the group's drives rule.
await go('/rules');
await page.getByTestId('std-ambrose').waitFor({ timeout: 15000 }).catch(() => {});
if (await page.getByTestId('std-ambrose').count()) {
  await page.getByTestId('std-ambrose').locator('summary').click();
  check(/Our drives rule/.test(await page.getByTestId('std-ambrose').innerText()), 'Ambrose standard rules show "Our drives rule"');
} else check(false, 'Ambrose standard rules section is listed');
await shot('ov30-13-standard-ambrose');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
