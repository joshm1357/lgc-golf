// Stage 11c full desktop browser check, 21 Oct 2026. Fake database only.
// Usage: node desktop-test.mjs <base> <shotDir> [baselineBase]
//   e.g. node desktop-test.mjs http://localhost:4323/lgc-golf/ ./shots-desktop http://localhost:4329/lgc-golf/
// At 1280 and 1920 px (laptop), 768 px (tablet) and 375 px (phone): open the Trip desk, close a vote, add a cost,
// enter a paper card with the keyboard only, paste players with a preview. With a baseline build's address, the
// main phone screens are also compared at 375 px, before and after, to show phones haven't changed.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4323/lgc-golf/';
const SHOTS = process.argv[3] || './shots-desktop';
const BASELINE = process.argv[4] || null;
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLAN = 'bbbbbbbb-0000-4000-8000-000000000001';
const POLL = 'bbbbbbbb-0000-4000-8000-0000000000a1';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const T1 = 'eeeeeeee-0000-4000-8000-000000000001';
const T2 = 'eeeeeeee-0000-4000-8000-000000000002';
const now = '2026-10-21T08:00:00.000Z';
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const holes = PAR.map((par, i) => ({ n: i + 1, par, si: SI[i] }));
const names = ['Kurt', 'Al', 'Bo', 'Cy', 'Di', 'Ed'];
const hcps = [12, 20, 8, 16, 4, 28];
const pid = (i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`;
const K = pid(0);

function freshDb() {
  const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: i === 1 ? 'Big Al' : null, handicap: hcps[i], approved: true, created_at: now, cup_side: null }));
  return {
    players,
    groups: [{ id: GROUP, vote_decider: 'admin' }],
    trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-12-04', end_date: '2026-12-06', status: 'active', created_at: now }],
    trophies: [], quick_results: [], honour_board: [], round_pins: [], scores: [],
    teams: [{ id: T1, round_id: R2, name: 'Kurt & Al', handicap: 8 }, { id: T2, round_id: R2, name: 'Bo & Cy', handicap: 6 }],
    team_players: [[T1, 0], [T1, 1], [T2, 2], [T2, 3]].map(([team_id, i]) => ({ team_id, player_id: pid(i) })),
    round_players: players.slice(0, 3).map((p) => ({ round_id: R1, player_id: p.id, playing_handicap: p.handicap })),
    courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
    rounds: [
      { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday Stableford', play_date: '2026-12-04', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now },
      { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday Ambrose', play_date: '2026-12-05', format: 'ambrose', status: 'setup', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, min_drives: 0, created_at: now },
    ],
    plans: [{ id: PLAN, group_id: GROUP, name: 'Hunter Weekend', kind: 'trip', status: 'confirmed', start_date: '2026-12-04', end_date: '2026-12-06', location_name: 'Hunter Valley', trip_id: TRIP, rsvp_locked: false, proposed: false, created_at: now }],
    plan_polls: [{ id: POLL, plan_id: PLAN, kind: 'other', question: 'Shirt colour?', status: 'open', created_at: now }],
    plan_options: [
      { id: 'o1', poll_id: POLL, label: 'Navy', created_at: now }, { id: 'o2', poll_id: POLL, label: 'Pink', created_at: '2026-10-21T08:01:00.000Z' },
    ],
    plan_votes: [
      { poll_id: POLL, option_id: 'o1', player_id: pid(0), response: 'yes' }, { poll_id: POLL, option_id: 'o1', player_id: pid(1), response: 'yes' },
      { poll_id: POLL, option_id: 'o2', player_id: pid(0), response: 'no' },
    ],
    plan_rsvps: [0, 1, 2, 3].map((i) => ({ plan_id: PLAN, player_id: pid(i), status: i === 3 ? 'maybe' : 'in' })),
    plan_items: [{ id: crypto.randomUUID(), plan_id: PLAN, kind: 'job', title: 'Book the accommodation', done: false, owner_id: null, created_at: now, sort: 0 }],
    plan_costs: [{ id: crypto.randomUUID(), plan_id: PLAN, title: 'House', amount: 1200, per_head: false, paid_by: K, split_between: null, created_at: now }],
    plan_payments: [], plan_groups: [{ id: crypto.randomUUID(), plan_id: PLAN, kind: 'room', name: 'Room 1', capacity: 2, sort: 0, created_at: now }],
    plan_group_members: [], plan_transfers: [], plan_comments: [],
    tribunal_cases: [{ id: crypto.randomUUID(), accused_id: pid(4), lodged_by: pid(1), proposed_change: -2, case_text: 'Sandbagging on the back nine', status: 'open', created_at: now }],
    tribunal_votes: [], posts: [], rules: [], cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
    tee_groups: [{ id: crypto.randomUUID(), round_id: R1, group_no: 1, tee_time: '08:00', start_hole: null, player_ids: [pid(0), pid(1), pid(2)], created_at: now }],
    handicap_history: [{ id: crypto.randomUUID(), player_id: pid(1), old_handicap: 22, new_handicap: 20, reason: 'Tribunal', created_at: '2026-09-01T00:00:00.000Z' }],
    group_features: ['planner', 'planner_tasks', 'planner_costs', 'planner_rooms', 'tribunal', 'tee_groups', 'replay', 'feed'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
}

let db = freshDb();
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('gt.')) return Number(r[k]) > Number(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v.slice(3) === 'null' ? r[k] == null : true;
  return true;
};
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (!match(r, k, v)) return false;
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
  if (p.startsWith('/rest/v1/rpc/decide_poll')) {
    const b = JSON.parse(req.postData() || '{}');
    const poll = db.plan_polls.find((x) => x.id === b.p_poll);
    Object.assign(poll, { status: 'closed', winner_option_id: b.p_option });
    return json(null);
  }
  if (p.startsWith('/rest/v1/rpc/admin_create_player')) {
    const b = JSON.parse(req.postData() || '{}');
    const id = crypto.randomUUID();
    db.players.push({ id, name: b.p_name, nickname: b.p_nickname, handicap: b.p_handicap ?? 18, approved: true, created_at: new Date().toISOString() });
    return json(id);
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    const one = /vnd\.pgrst\.object/.test(req.headers().accept || '');
    if (method === 'GET') { const out = filterRows(rows, url.searchParams); return json(one ? out[0] || null : out); }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (one) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const hit = filterRows(rows, url.searchParams);
      for (const r of hit) Object.assign(r, body);
      if (table === 'players' && 'handicap' in body) for (const r of hit) db.handicap_history.push({ id: crypto.randomUUID(), player_id: r.id, old_handicap: null, new_handicap: body.handicap, reason: 'Admin change', created_at: new Date().toISOString() });
      return json(url.searchParams.has('select') ? hit : [], 200);
    }
    if (method === 'DELETE') {
      const gone = new Set(filterRows(rows, url.searchParams));
      db[table] = rows.filter((r) => !gone.has(r));
      return json([], 200);
    }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

async function open(width, { mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 812 : width >= 1900 ? 1080 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(([uid]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
  }, ['99999999-9999-4999-8999-999999999999']);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-21T10:00:00+11:00'));
  page.on('pageerror', (e) => fails.push(`page error (${width}): ${e}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const go = async (page, hash) => { await page.goto(`${BASE}#${hash}`); };

// The four jobs, at a given width.
async function flow(width, mobile = false) {
  db = freshDb();
  const tag = `${width}`;
  const { ctx, page } = await open(width, { mobile });

  // 1. The Trip desk opens on the trip that matters now.
  await go(page, '/desk');
  await page.getByTestId('trip-desk').waitFor({ timeout: 15000 });
  await page.getByTestId('panel-costs').getByText('House').waitFor({ timeout: 10000 });
  const panels = await page.locator('.desk-panel').evaluateAll((els) => els.map((e) => e.dataset.testid));
  check(['panel-people', 'panel-votes', 'panel-costs', 'panel-jobs', 'panel-rooms', 'panel-checklist', 'panel-rounds', 'panel-tribunal'].every((p) => panels.includes(p)), `${tag}: every panel is on the Trip desk (${panels.join(', ')})`);
  check((await page.getByTestId('desk-countdown').innerText()).includes('6 weeks'), `${tag}: the countdown says in 6 weeks`);
  check((await page.getByTestId('panel-people').innerText()).includes('Haven’t said'), `${tag}: who's in shows who hasn't said`);
  check((await page.getByTestId('panel-rounds').innerText()).includes('8:00'), `${tag}: rounds show tee times`);
  check((await page.getByTestId('panel-tribunal').innerText()).includes('Di'), `${tag}: the open Tribunal case is listed`);
  await page.screenshot({ path: `${SHOTS}/${tag}-1-desk.png`, fullPage: true });

  // 2. Close a vote (the leading option is picked by default).
  await page.getByTestId('panel-votes').getByRole('button', { name: 'Close & pick' }).click();
  await page.getByTestId('panel-votes').getByText('No votes open').waitFor({ timeout: 8000 });
  check(db.plan_polls[0].status === 'closed' && db.plan_polls[0].winner_option_id === 'o1', `${tag}: the vote is closed with Navy as the winner`);

  // 3. Add a cost with the keyboard: n, type, Tab, amount, Enter.
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(focused === 'New cost: what for', `${tag}: "n" starts a new cost (${focused})`);
  if (focused !== 'New cost: what for') await page.getByLabel('New cost: what for').focus();
  await page.keyboard.type('Green fees');
  await page.keyboard.press('Tab');
  await page.keyboard.type('600');
  await page.keyboard.press('Enter');
  await page.getByTestId('costs-table').getByText('Green fees').waitFor({ timeout: 8000 });
  check(db.plan_costs.some((c) => c.title === 'Green fees' && Number(c.amount) === 600), `${tag}: the cost is saved`);
  check((await page.getByTestId('who-owes').innerText()).includes('→'), `${tag}: who pays whom is shown`);
  await page.screenshot({ path: `${SHOTS}/${tag}-2-cost.png`, fullPage: true });

  // 4. A paper card, keyboard only: Friday Stableford, 3 players.
  await go(page, `/desk/card/${R1}`);
  await page.getByTestId('pc-0-1').waitFor({ timeout: 10000 });
  await page.getByTestId('pc-0-1').focus();
  const card = [5, 4, 3, 6, 4, 'p', 3, 5, 5, 4, 4, 4, 5, 4, 3, 4, 6, 4];
  for (const v of card) { await page.keyboard.type(String(v)); await page.keyboard.press('Tab'); }
  // Tab from the last hole went to the next player's first hole: one more score there, then Enter → third player.
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  const f2 = await page.evaluate(() => document.activeElement?.dataset.testid);
  check(f2 === 'pc-2-1', `${tag}: Enter jumps to the next player's first hole (${f2})`);
  await page.keyboard.type('0');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  const kurt = db.scores.filter((s) => s.subject_id === pid(0));
  check(kurt.length === 18, `${tag}: all 18 of Kurt's holes saved (${kurt.length})`);
  check(kurt.find((s) => s.hole === 6)?.picked_up === true && kurt.find((s) => s.hole === 1)?.strokes === 5, `${tag}: strokes and the pick-up saved right`);
  check(db.scores.some((s) => s.subject_id === pid(1) && s.hole === 1 && s.strokes === 4), `${tag}: the next player's first hole saved`);
  check(!db.scores.some((s) => s.subject_id === pid(2)), `${tag}: a 0 is refused, not saved`);
  check(await page.getByTestId('pc-2-1').getAttribute('aria-invalid') === 'true', `${tag}: the bad box is marked`);
  const pts = await page.getByTestId('pc-score-0').innerText();
  check(pts === '41', `${tag}: Kurt's Stableford points add up as you type (${pts})`);
  await page.screenshot({ path: `${SHOTS}/${tag}-3-card.png`, fullPage: true });

  // 5. Paste players with a preview.
  await go(page, '/desk/players');
  await page.getByTestId('players-table').waitFor({ timeout: 10000 });
  await page.getByLabel('Paste players').fill('Name\tHandicap\nZed New\t11\nBig Al\t15\nBo Test\t8\nGus\t77');
  const prev = await page.getByTestId('paste-preview').innerText();
  check(prev.includes('New') && prev.includes('20 → 15') && prev.includes('No change') && prev.includes('Skipped'), `${tag}: the preview shows new, change, no change and skipped`);
  check(db.players.length === 6, `${tag}: nothing saved before Save`);
  await page.screenshot({ path: `${SHOTS}/${tag}-4-paste.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save 2 players' }).click();
  await page.getByTestId('players-table').getByText('Zed New').waitFor({ timeout: 8000 });
  check(db.players.some((p) => p.name === 'Zed New' && p.handicap === 11) && db.players.find((p) => p.id === pid(1)).handicap === 15, `${tag}: the new player is added and Al's handicap changed`);
  await ctx.close();
}

await flow(1280);
await flow(1920);
await flow(768);
await flow(375, true);

// ---------------------------------------------------------------- Laptop extras (1280)
{
  db = freshDb();
  const { ctx, page } = await open(1280);
  await go(page, '/');
  await page.locator('.side').waitFor({ timeout: 15000 });
  check(await page.locator('.side').getByText('Trip desk').count() === 1, 'the sidebar has the Trip desk');
  // Shortcuts: ? list, Esc, g t, g l, / finder.
  await page.keyboard.press('?');
  await page.getByTestId('shortcut-list').waitFor({ timeout: 4000 });
  await page.screenshot({ path: `${SHOTS}/1280-5-shortcuts.png` });
  await page.keyboard.press('Escape');
  check(await page.getByTestId('shortcut-list').count() === 0, 'Esc closes the shortcut list');
  await page.keyboard.press('g'); await page.keyboard.press('t');
  await page.getByTestId('trip-desk').waitFor({ timeout: 8000 });
  check(page.url().includes('#/desk'), 'g t opens the Trip desk');
  await page.keyboard.press('g'); await page.keyboard.press('l');
  await page.waitForTimeout(500);
  check(/#\/$/.test(page.url()), `g l goes to the leaderboard (${page.url()})`);
  await page.keyboard.press('/');
  await page.getByRole('textbox', { name: 'Find a screen or a player' }).fill('big al');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check(page.url().includes(`/player/${pid(1)}`), 'the / finder finds a player by nickname');

  // Costs table: inline edit, sort, CSV.
  await go(page, '/desk');
  await page.getByTestId('costs-table').getByText('House').waitFor({ timeout: 10000 });
  await page.getByTestId('costs-table').getByRole('button', { name: '$1,200' }).click();
  await page.getByLabel('Edit amount').fill('1500');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check(Number(db.plan_costs[0].amount) === 1500, 'a cost amount edits in place');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ Export CSV' }).click();
  const file = await dl;
  const csv = fs.readFileSync(await file.path(), 'utf8');
  check(file.suggestedFilename() === 'hunter-weekend-costs.csv' && csv.includes('House,1500.00,Total,Kurt Test'), `the costs CSV downloads (${file.suggestedFilename()})`);

  // Players table: sort, filter, edit a handicap, history.
  await go(page, '/desk/players');
  await page.getByTestId('players-table').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Handicap', exact: true }).click();
  const firstSorted = await page.getByTestId('player-row').first().innerText();
  check(firstSorted.includes('Di Test'), 'sorting by handicap puts the lowest first');
  await page.getByLabel('Filter players').fill('cy');
  check(await page.getByTestId('player-row').count() === 1, 'the filter narrows the table');
  await page.getByRole('button', { name: /Change Cy Test’s handicap/ }).click();
  await page.getByLabel('Cy Test handicap').fill('14.5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check(db.players.find((p) => p.id === pid(3)).handicap === 14.5, 'a handicap edits in place');
  await page.getByLabel('Filter players').fill('al');
  await page.getByRole('button', { name: 'History' }).first().click();
  check((await page.getByTestId('handicap-history').innerText()).includes('22 → 20'), 'handicap history shows');

  // Course scorecard paste.
  await go(page, '/desk/courses');
  await page.getByLabel('New course name').fill('Pasted Links');
  const row = (label, vals) => [label, ...vals].join('\t');
  await page.getByLabel('Paste the scorecard').fill([row('Hole', holes.map((h) => h.n)), row('Par', PAR), row('Index', SI)].join('\n'));
  check((await page.getByTestId('course-preview').innerText()).includes('72'), 'the scorecard preview shows par 72');
  await page.screenshot({ path: `${SHOTS}/1280-6-course.png`, fullPage: true });
  await page.getByRole('button', { name: 'Add this course' }).click();
  await page.waitForTimeout(600);
  const added = db.courses.find((c) => c.name === 'Pasted Links');
  check(added && added.holes.length === 18 && added.holes[4].si === 1, 'the pasted course is saved');

  // Present and print.
  db.scores.push({ id: crypto.randomUUID(), round_id: R1, subject_id: pid(0), subject_type: 'player', hole: 1, strokes: 4, picked_up: false, updated_at: now });
  await go(page, `/desk/present/${R1}`);
  await page.getByTestId('present-board').waitFor({ timeout: 10000 });
  check(await page.getByTestId('present-board').locator('tbody tr').count() === 3, 'Present shows the leaderboard big');
  await page.screenshot({ path: `${SHOTS}/1280-7-present.png` });
  await page.keyboard.press('Escape');
  await go(page, `/desk/print/${R1}`);
  await page.getByTestId('print-results').waitFor({ timeout: 10000 });
  check(await page.getByTestId('print-cards').locator('tbody tr').count() === 3, 'the print page has every scorecard');
  await page.emulateMedia({ media: 'print' });
  check(!(await page.locator('.side').isVisible()) && !(await page.locator('.desk-nav').isVisible()), 'printing hides the sidebar and tabs');
  await page.screenshot({ path: `${SHOTS}/1280-8-print.png`, fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await ctx.close();
}

// Sheets as a side panel on a wide screen, and three columns at 1920.
{
  db = freshDb();
  const { ctx, page } = await open(1920);
  await go(page, '/desk');
  await page.getByTestId('panel-costs').waitFor({ timeout: 15000 });
  const xs = await page.locator('.desk-panel').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  check(xs.length === 3, `three columns of panels at 1920 (${xs.join(', ')})`);
  await go(page, `/plan/${PLAN}?tab=kitty`);
  await page.getByRole('button', { name: /Add a cost/ }).first().click();
  const box = await page.locator('.sheet').boundingBox();
  check(box && Math.abs(box.x + box.width - 1920) < 2 && box.height > 1000, `a sheet opens as a side panel on the right (${box && Math.round(box.x)})`);
  await page.screenshot({ path: `${SHOTS}/1920-9-side-panel.png` });
  await ctx.close();
}

// Phones unchanged: the main screens, before and after, at 375 px.
if (BASELINE) {
  const screens = [['/', 'leaderboard'], [`/score/${R1}`, 'score'], ['/feed', 'feed'], ['/more', 'more'], ['/plan', 'trips'], [`/plan/${PLAN}`, 'plan'], ['/admin', 'admin']];
  for (const [base, label] of [[BASELINE, 'before'], [BASE, 'after']]) {
    db = freshDb();
    const { ctx, page } = await open(375, { mobile: true });
    for (const [hash, name] of screens) {
      await page.goto(`${base}#${hash}`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/phone-${name}-${label}.png`, fullPage: true });
    }
    await ctx.close();
  }
  for (const [, name] of screens) {
    const a = fs.readFileSync(`${SHOTS}/phone-${name}-before.png`);
    const b = fs.readFileSync(`${SHOTS}/phone-${name}-after.png`);
    check(a.equals(b), `375 px ${name}: identical before and after`);
  }
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
