// Side games: propose → opt in → settle-up counts only those in (098, ov29, 23 Oct 2026). Fake database only.
// The fake does what 098's triggers do: the proposer is put in, and the Feed post appears.
// Usage: node side-games-test.mjs <base> <shotDir>   e.g. http://localhost:4354/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4354/lgc-golf/';
const SHOTS = process.argv[3] || './shots-side-games';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const G1 = 'eeeeeeee-0000-4000-8000-000000000001';
const now = '2026-10-21T08:00:00.000Z';
const sydToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
const addDays = (ymd, n) => { const t = new Date(`${ymd}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
// Same card as games-test: pars except Kurt birdies 1; Al birdies 2 and 10; Bo birdies 2 and 3.
// Friday's $5 skins is opt-in and only Kurt and Al are in — Bo's birdies don't count and he pays nothing:
//   hole 1 Kurt (1 skin); hole 2 Al (1 skin — Bo's tie doesn't count); 3–9 tie and carry; hole 10 Al (8 skins);
//   11–18 carry (8 in the pot). Kurt +$5 −$45 = −$40, Al +$45 −$5 = +$40. Settle: Kurt pays Al $40.
// (With everyone in it would be Kurt −$35, Al +$55, Bo −$20.)
const birdie = { [K]: [1], [A]: [2, 10], [B]: [2, 3] };
const scores = [];
for (const pid of [K, A, B]) {
  for (const h of holes) {
    scores.push({ id: crypto.randomUUID(), round_id: R1, subject_id: pid, subject_type: 'player', hole: h.n, strokes: h.par - (birdie[pid].includes(h.n) ? 1 : 0), picked_up: false, updated_at: now, group_id: GROUP });
  }
}
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 0, approved: true, created_at: now },
    { id: A, name: 'Al Blue', nickname: null, handicap: 0, approved: true, created_at: now },
    { id: B, name: 'Bo Red', nickname: 'Bo', handicap: 0, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: addDays(sydToday, -1), end_date: addDays(sydToday, 2), status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [K, A, B].flatMap((p) => [R1, R2].map((r) => ({ round_id: r, player_id: p, playing_handicap: 0 }))),
  scores,
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday — Cypress Lakes', play_date: sydToday, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday — Cypress Lakes', play_date: addDays(sydToday, 1), format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [], comments: [], reactions: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], tee_groups: [], custom_games: [],
  round_games: [{ id: G1, group_id: GROUP, round_id: R1, kind: 'skins', stake: 5, options: { net: true, carry: true }, who_in: 'opt_in', created_by: K, retired: false, created_at: now }],
  round_game_players: [K, A].map((p) => ({ game_id: G1, player_id: p, group_id: GROUP, created_at: now })),
  group_features: ['feed', 'side_comps', 'planner', 'games'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let me = { player_id: B, is_admin: false, role: 'player' };
const notifies = [];
const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(')) { const ids = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!ids.includes(String(r[k]))) return false; }
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
  if (p.startsWith('/functions/v1/notify')) { notifies.push(JSON.parse(req.postData() || '{}')); return json({ sent: 2 }); }
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, ...me, group_name: 'Hunter Weekend', group_id: GROUP, legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: me.role }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...(table === 'round_games' ? { retired: false, who_in: 'everyone' } : {}), ...b };
        rows.push(row);
        // What 098's triggers do for an opt-in game: the proposer is in, and one Feed post.
        if (table === 'round_games' && row.who_in === 'opt_in') {
          db.round_game_players.push({ game_id: row.id, player_id: row.created_by, group_id: GROUP, created_at: row.created_at });
          db.posts.push({ id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: row.created_by, round_id: row.round_id, trip_id: TRIP,
            body: `🎲 Bo’s put up $${row.stake} skins for Saturday. You in?`, link: `/games?r=${row.round_id}&g=${row.id}`, created_at: new Date().toISOString() });
        }
      }
      db[table] = rows;
      return json([], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
      return json([], 200);
    }
    if (method === 'DELETE') {
      if (table !== 'round_game_players') return json({ message: 'the app should never delete this' }, 400);
      const keep = rows.filter((r) => !(r.game_id === eqOf(url.searchParams, 'game_id') && r.player_id === eqOf(url.searchParams, 'player_id')));
      db[table] = keep;
      return json([], 200);
    }
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const clean = (arr) => arr.map((t) => t.replace(/\s+/g, ' ').trim());

// 1. Friday's opt-in skins: only Kurt and Al are in, and the settle-up counts only them (Bo is a player, not in it).
await page.goto(`${BASE}#/games?r=${R1}`);
await page.getByTestId('game-skins').waitFor({ timeout: 15000 });
const whos = await page.getByTestId('game-skins').getByTestId('whos-in').innerText();
check(/Who’s in \(2\)/.test(whos) && whos.includes('Al Blue') && whos.includes('Kurt') && !whos.includes('Bo'), `Friday: who's in shows Al Blue and Kurt only (got ${whos.replace(/\s+/g, ' ')})`);
check(/closed at the first tee/.test(await page.getByTestId('opt-closes').first().innerText()), 'Friday (live): opt-in has closed — the list is fixed');
check(!(await page.getByTestId('opt-toggle').first().isVisible().catch(() => false)), 'Friday (live): no "I’m in" toggle once it’s closed');
await page.getByTestId('skin-10').getByText('Al Blue').waitFor({ timeout: 15000 });
check((await page.getByTestId('skin-2').innerText()).includes('Al Blue'), 'skins: Al wins hole 2 — Bo’s birdie doesn’t count, he isn’t in');
check(/8 skins/i.test(await page.getByTestId('skin-10').innerText()), 'skins: Al’s hole 10 is worth 8 skins (3–9 carried)');
const tally = clean(await page.getByTestId('tally-row').allInnerTexts());
check(JSON.stringify(tally) === JSON.stringify(['Al Blue +$40', 'Kurt −$40']), `tally: only those in — Al +$40, Kurt −$40, Bo not in it (got ${JSON.stringify(tally)})`);
const settle = clean(await page.getByTestId('settle-row').allInnerTexts());
check(JSON.stringify(settle) === JSON.stringify(['Kurt pays Al Blue $40']), `settle-up: Kurt pays Al $40 (got ${JSON.stringify(settle)})`);
await page.screenshot({ path: `${SHOTS}/1-friday-opt-in.png`, fullPage: true });

// 2. Bo (a player) puts up $5 skins for Saturday.
await page.getByTestId('propose-game').click();
await page.getByTestId('propose-sheet').waitFor();
const roundsOffered = await page.getByTestId('propose-round').locator('option').allInnerTexts();
check(JSON.stringify(roundsOffered) === JSON.stringify(['Saturday — Cypress Lakes']), `only rounds still open are offered (got ${JSON.stringify(roundsOffered)})`);
await page.getByTestId('propose-stake').fill('5');
await page.screenshot({ path: `${SHOTS}/2-propose.png` });
await page.getByTestId('propose-go').click();
await page.getByTestId('propose-sheet').waitFor({ state: 'detached', timeout: 10000 });
const made = db.round_games.find((g) => g.round_id === R2);
check(made && made.kind === 'skins' && Number(made.stake) === 5 && made.who_in === 'opt_in' && made.created_by === B, 'propose: an opt-in $5 skins for Saturday, put up by Bo');
check(notifies.length === 1 && notifies[0].type === 'game_proposed' && notifies[0].game_id === made?.id, `propose: one "game_proposed" notification (got ${JSON.stringify(notifies)})`);
await page.getByTestId('game-skins').waitFor({ timeout: 15000 });
// The screen moves from Friday to Saturday after the sheet closes — wait for Saturday's list (Bo alone).
await page.getByTestId('game-skins').getByText(/Who’s in \(1\)/).waitFor({ timeout: 15000 }).catch(() => {});
const satWhos = await page.getByTestId('game-skins').getByTestId('whos-in').innerText();
check(/Who’s in \(1\)/.test(satWhos) && satWhos.includes('Bo'), 'Saturday: Bo is in automatically');
check(/Opt-in closes at the first tee/.test(await page.getByTestId('opt-closes').first().innerText()), 'Saturday: "Opt-in closes at the first tee"');
await page.screenshot({ path: `${SHOTS}/3-saturday.png`, fullPage: true });

// 3. "I'm out" / "I'm in" while it's open.
await page.getByTestId('opt-toggle').first().click();
await page.waitForTimeout(800);
check(!db.round_game_players.some((r) => r.game_id === made.id && r.player_id === B), 'I’m out: Bo’s row is gone');
await page.getByRole('button', { name: 'I’m in' }).first().waitFor({ timeout: 5000 });
await page.getByTestId('opt-toggle').first().click();
await page.waitForTimeout(800);
check(db.round_game_players.some((r) => r.game_id === made.id && r.player_id === B), 'I’m in: Bo’s back in');

// 4. The Feed post has In / Out.
await page.goto(`${BASE}#/feed`);
const ask = page.getByTestId('side-game-ask').first();
check(await ask.waitFor({ timeout: 15000 }).then(() => true, () => false), 'Feed: the proposal post has who’s in and an In / Out button');
check((await page.locator('.page').innerText()).includes('put up $5 skins for Saturday'), 'Feed: “Bo’s put up $5 skins for Saturday. You in?”');
await page.screenshot({ path: `${SHOTS}/4-feed.png`, fullPage: true });

// 4b. The day screen (today is Friday, live): the side games card says who's in, and that opt-in has closed.
await page.goto(`${BASE}#/`);
const today = page.getByTestId('side-games-today');
check(await today.waitFor({ timeout: 15000 }).then(() => true, () => false), 'day screen: a Side games card');
const todayText = (await today.innerText().catch(() => '')).replace(/\s+/g, ' ');
check(/Who’s in \(2\): Al Blue, Kurt/.test(todayText) && /closed at the first tee/.test(todayText), `day screen: who's in (names) and opt-in closed (${todayText})`);
await page.screenshot({ path: `${SHOTS}/4b-day.png`, fullPage: true });

// 5. An organiser: Saturday's game shows "Opt-in" in Admin; house rules are optional on a custom game.
me = { player_id: K, is_admin: true, role: 'organiser' };
await page.goto(`${BASE}#/games?r=${R2}`);
await page.reload();
await page.getByTestId('custom-games').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /Copy Skins/ }).click();
check(await page.getByText('House rules (optional)').isVisible(), 'custom game form: "House rules (optional)"');
await page.getByRole('button', { name: /Save our game/ }).click();
await page.waitForTimeout(800);
const cg = db.custom_games[0];
check(cg && cg.rules_text === '' && cg.name === 'Skins — our way', 'custom game saves with no house rules');
await page.waitForTimeout(300);
check(!(await page.getByTestId('custom-game-rules').isVisible().catch(() => false)), 'no empty "House rules:" line');
await page.goto(`${BASE}#/admin`);
await page.getByTestId('admin-opt-in').first().waitFor({ timeout: 15000 }).catch(() => {});
check((await page.getByTestId('admin-opt-in').allInnerTexts()).some((t) => t.includes('put up by Bo')), 'Admin: Saturday’s game says "Opt-in · put up by Bo"');
await page.screenshot({ path: `${SHOTS}/5-admin.png`, fullPage: true });

// 6. The organiser takes Saturday's game down before the round (retired, never deleted).
await page.goto(`${BASE}#/games?r=${R2}`);
await page.getByTestId('take-down').first().waitFor({ timeout: 15000 });
await page.getByTestId('take-down').first().click();
await page.waitForTimeout(800);
check(db.round_games.find((g) => g.id === made.id)?.retired === true, 'take it down: Saturday’s game is retired');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
