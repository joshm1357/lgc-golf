// "Bring your history" (AI import) browser check, 21 Oct 2026. Fake database and a fake ai-helper function.
// Usage: node ai-import-test.mjs <base> <shotDir>   e.g. http://localhost:4381/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4381/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ai-import';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const JM = '33333333-3333-4333-8333-333333333333';
const CM = '44444444-4444-4444-8444-444444444444';
const now = '2026-10-21T08:00:00.000Z';
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now },
    { id: B, name: 'Matt Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now },
    { id: JM, name: 'Joshua Moran', nickname: 'Josh', handicap: 15, approved: true, created_at: now },
    { id: CM, name: 'Craig MacDougal', nickname: null, handicap: 18, approved: true, created_at: now },
  ],
  trips: [{ id: 'trip-old', name: 'Bowral 2023', start_date: '2023-05-04', end_date: '2023-05-06', status: 'locked', created_at: now }],
  trophies: [{ id: 'tro1', trip_id: 'trip-old', name: 'BD', type: 'stableford_total', created_at: now }],
  honour_board: [], teams: [], team_players: [], quick_results: [], round_pins: [], round_players: [], scores: [], courses: [], rounds: [],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [],
  rules: [{ id: 'r1', title: 'Ready golf', status: 'active', category: 'etiquette', applies_to: ['all'], sort: 1, created_at: now }],
  rule_votes: [], handicap_history: [], cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'trophies', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
const rpcs = [];
const patches = [];
const calls = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

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
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcs.push({ name, body });
    if (name === 'admin_create_player') {
      const id = crypto.randomUUID();
      db.players.push({ id, name: body.p_name, nickname: body.p_nickname, handicap: body.p_handicap, approved: true, created_at: now });
      return json(id);
    }
    if (name === 'import_honours') {
      let n = 0;
      for (const r of body.p_rows) {
        if (db.honour_board.some((h) => h.trophy_name === r.trophy && h.label === r.label && h.winner_names === r.winners)) continue;
        db.honour_board.push({ id: crypto.randomUUID(), trophy_name: r.trophy, label: r.label, winner_names: r.winners, player_ids: r.player_ids, trip_id: r.trip_id, imported: true, sort_key: 0, created_at: now });
        n++;
      }
      return json(n);
    }
    if (name === 'import_handicaps') {
      for (const r of body.p_rows) db.handicap_history.push({ id: crypto.randomUUID(), player_id: r.player_id, new_handicap: r.handicap, created_at: `${r.date}T12:00:00Z`, imported: true });
      return json(body.p_rows.length);
    }
    if (name === 'import_rules') {
      let added = 0;
      for (const r of body.p_rows) {
        if (db.rules.some((x) => x.title.toLowerCase() === r.title.toLowerCase())) continue;
        db.rules.push({ id: crypto.randomUUID(), ...r, status: 'active', applies_to: ['all'], sort: 9, created_at: now });
        added++;
      }
      return json({ added, proposed: 0, skipped: body.p_rows.length - added });
    }
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const hit = filterRows(rows, url.searchParams);
      for (const r of hit) Object.assign(r, body);
      patches.push({ table, body, ids: hit.map((r) => r.id) });
      return json(hit, 200);
    }
    return json([], 200);
  }
  return json({});
}

const PROPOSAL = {
  players: [{ name: 'Kurt', nickname: null }, { name: 'Pete Green', nickname: 'Greeny' }, { name: 'Josh Moran', nickname: null }, { name: 'Craig', nickname: 'Macca' }],
  trips: [{ name: 'Hunter Valley 2019', year: 2019, place: 'Hunter Valley', courses: ['Cypress Lakes'], start_date: null, end_date: null }, { name: 'Bowral 2023', year: 2023, place: 'Bowral', courses: [], start_date: null, end_date: null }, { name: 'Port Stephens 2021', year: 2021, place: 'Port Stephens', courses: [], start_date: null, end_date: null }],
  winners: [
    { trophy: 'BD Trophy', year: 2019, trip: 'Hunter Valley 2019', winners: 'Kurt & Greeny', score: '44 pts' },
    { trophy: 'Wooden Spoon', year: 2021, trip: null, winners: 'Bluey', score: null },
    { trophy: 'Wooden Spoon', year: 2017, trip: null, winners: 'Kurt', score: null, guess: true },
  ],
  handicaps: [{ player: 'Greeny', date: '2019-01-01', handicap: 22 }, { player: 'Josh Moran', date: '2019-01-01', handicap: 14 }],
  rules: [
    { title: 'Ready golf', wording: '', category: 'etiquette', value: null },
    { title: 'Lost ball fine', wording: '$5 a ball off the tee.', category: 'fines', value: '$5' },
    { title: 'Gimmes inside the leather', wording: 'gimmes inside the leather', category: 'etiquette', value: null },
    { title: 'OB played as a lateral hazard', wording: 'OB is played as a lateral hazard: drop where it went out, one shot penalty.', category: 'other', value: null },
  ],
  unsure: ['The 2017 winner on the plaque is hard to read — guessed Kurt'],
  dropped: 0,
};
async function fakeHelper(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' });
  const body = JSON.parse(req.postData() || '{}');
  calls.push(body);
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
  if (body.mode === 'import') return json({ import: PROPOSAL, found: 10, remaining: { month: 58, today: 9 }, log_id: 21 });
  return json({ error: 'Unknown request.' });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('**/functions/v1/ai-helper', fakeHelper);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. The ways in: History, the guided setup, the Rulebook and the Ask screen.
await page.goto(`${BASE}#/history`);
await page.getByRole('link', { name: '📥 Add past trips, scorecards, cups…' }).waitFor({ timeout: 15000 });
check(true, 'History has "📥 Add past trips, scorecards, cups…"');
await page.goto(`${BASE}#/setup`);
await page.getByLabel('Bring your history').waitFor({ timeout: 15000 });
check(true, 'the guided setup has a "Bring your history" card');
await page.goto(`${BASE}#/rules`);
await page.getByRole('link', { name: '✨ Import rules from a photo or text' }).waitFor({ timeout: 15000 });
check(true, 'the Rulebook has "Import rules from a photo or text" for organisers');
await page.goto(`${BASE}#/ask`);
await page.getByRole('link', { name: '✨ Bring in our history' }).waitFor({ timeout: 15000 });
check(true, 'the Ask screen suggests bringing in history (organisers)');

// 2. Paste text, add a photo, read it.
await page.goto(`${BASE}#/import`);
await page.getByLabel('Paste your history').waitFor({ timeout: 15000 });
await page.screenshot({ path: `${SHOTS}/1-input.png`, fullPage: true });
await page.getByLabel('Paste your history').fill('BD Trophy\n2019 Hunter Valley — Kurt & Greeny (44 pts)\nWooden Spoon 2021 Bluey\nFines: $5 a ball off the tee');
// A real (tiny) PNG, so the browser can shrink it on a canvas.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await page.getByLabel('Add photos').setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: png });
await page.getByAltText('Photo 1').waitFor({ timeout: 10000 });
check(true, 'a photo is added (and shown) before sending');
await page.getByLabel('Upload a file').setInputFiles({ name: 'rules.txt', mimeType: 'text/plain', buffer: Buffer.from('Rule: no mulligans on the 1st') });
await page.getByText('Read rules.txt.').waitFor({ timeout: 10000 });
check((await page.getByLabel('Paste your history').inputValue()).includes('no mulligans'), 'an uploaded .txt file is read into the text');
await page.getByRole('button', { name: 'Read it' }).click();
await page.getByLabel('Not sure about').waitFor({ timeout: 15000 });
const sent = calls.at(-1);
check(sent.mode === 'import' && sent.text.includes('BD Trophy') && sent.images.length === 1 && sent.images[0].startsWith('data:image/jpeg;base64,'), 'sent: the text and the photo as a JPEG');
check(await page.getByText('The 2017 winner on the plaque is hard to read — guessed Kurt').isVisible(), 'the "not sure" notes are at the top');

// 3. The confirm screen: how each item matches.
const txt = await page.locator('.page').innerText();
check(/→ already a player \(Kurt Dahl\) · already there/.test(txt), 'Kurt → already a player');
check(/→ new player/.test(txt), 'Pete Green → new player');
check(/→ existing trophy BD\b/.test(txt) && /→ new trophy/.test(txt), 'BD Trophy → existing trophy BD; Wooden Spoon → new trophy');
const bdPick = page.getByLabel(/^Trophy for BD Hunter Valley 2019/);
check(await bdPick.inputValue() === 'BD', 'the trophy picker has BD picked');
await bdPick.selectOption('');
check(/→ new trophy/.test(await page.locator('.page').innerText()) && await page.getByLabel(/^Trophy for BD Trophy Hunter Valley 2019/).isVisible(), 'the organiser can change it to a new trophy');
await page.getByLabel(/^Trophy for BD Trophy Hunter Valley 2019/).selectOption('BD');
check(await page.getByLabel(/^Trophy for BD Hunter Valley 2019/).inputValue() === 'BD', '…and back to BD');
// Josh Moran: likely Joshua Moran — asked, not made new.
check(/Is this Joshua Moran\?/.test(txt), '"Is this Joshua Moran?" is asked');
const who = page.getByLabel('Who is Josh Moran?');
check(await who.inputValue() === JM, 'Joshua Moran is picked to start with');
check(!(await page.getByLabel('Add Josh Moran', { exact: true }).isChecked()), 'Josh Moran isn’t made a new player by default');
// Craig "Macca": matched to Craig MacDougal, nickname offered and ticked.
check(/→ Craig MacDougal · add nickname Macca/.test(txt) && await page.getByLabel('Add Craig (“Macca”)').isChecked(), 'Craig → Craig MacDougal, add nickname Macca (ticked)');
// The guess: unticked and marked.
check(/⚠️ a guess/.test(txt) && !(await page.getByLabel(/^Add Wooden Spoon 2017/).isChecked()), 'the guessed 2017 winner starts unticked with ⚠️ a guess');
// Rules: the title, and the wording only when it says more.
check(!/gimmes inside the leather/.test(txt) && /Gimmes inside the leather/.test(txt), 'rule title without a lowercase copy underneath');
check(/OB played as a lateral hazard\n[\s\S]*OB is played as a lateral hazard: drop where it went out, one shot penalty\./.test(txt), 'a rule with more to say keeps its full wording');
// A year-only trip shows the year, not 1 January.
check(/Hunter Valley 2019 · 2019 \(date unknown\)/.test(txt), 'a year-only trip shows "2019 (date unknown)"');
check(/→ existing trip · already there/.test(txt) && (txt.match(/→ new past trip/g) || []).length === 2, 'Bowral 2023 → existing trip; two new past trips');
check(/→ already in the Rulebook · already there/.test(txt) && /→ new rule/.test(txt), 'Ready golf → already in the Rulebook');
check(!(await page.getByLabel('Add Kurt').isChecked()), 'items already there are unticked');
await page.screenshot({ path: `${SHOTS}/2-confirm.png`, fullPage: true });

// 4. Untick one (Port Stephens), edit one (the rule's amount), then Add these.
await page.getByLabel('Add Port Stephens 2021 · Port Stephens').uncheck().catch(async () => page.getByLabel(/Add Port Stephens 2021/).uncheck());
await page.getByRole('button', { name: 'Edit Lost ball fine ($5)' }).click();
await page.getByLabel('Worth / amount').fill('$10');
await page.getByRole('button', { name: 'Done' }).click();
check(await page.getByText('Lost ball fine ($10)').isVisible(), 'an item can be edited inline');
const addBtn = page.getByRole('button', { name: /^Add these \(\d+\)$/ });
check(/Add these \(10\)/.test(await addBtn.innerText()), `Add these counts the ticked items (10): ${await addBtn.innerText()}`);
await addBtn.click();
await page.getByText(/^✅ Added /).waitFor({ timeout: 15000 });
const done = await page.getByText(/^✅ Added /).innerText();
check(done.includes('Added 1 player, 1 nickname, 1 past trip, 2 winners, 2 past handicaps and 3 rules'), `summary: ${done}`);
check(patches.some((x) => x.table === 'players' && x.body.nickname === 'Macca' && x.ids[0] === CM), 'nickname Macca saved on Craig MacDougal (the player editor’s path)');
check(!rpcs.some((r) => r.name === 'admin_create_player' && /Josh|Craig/.test(r.body.p_name)), 'no new Josh Moran or Craig');
const created = rpcs.filter((r) => r.name === 'admin_create_player');
check(created.length === 1 && created[0].body.p_name === 'Pete Green' && created[0].body.p_nickname === 'Greeny' && created[0].body.p_handicap === 22, 'one new player (Pete Green "Greeny", starting on his latest handicap 22)');
const newTrips = db.trips.filter((t) => t.id !== 'trip-old');
check(newTrips.length === 1 && newTrips[0].name === 'Hunter Valley 2019' && newTrips[0].status === 'locked' && newTrips[0].start_date === '2019-01-01', 'one past trip (Hunter Valley 2019, locked) — the unticked one wasn’t made');
const pete = db.players.find((p) => p.name === 'Pete Green');
const hon = rpcs.find((r) => r.name === 'import_honours').body.p_rows;
check(hon.length === 2 && hon[0].trophy === 'BD' && hon[0].label === 'Hunter Valley 2019' && hon[0].player_ids.includes(K) && hon[0].player_ids.includes(pete.id) && hon[0].trip_id === newTrips[0].id, 'winners: matched to Kurt, the new player and the new trip');
check(hon[1].label === '2021' && hon[1].player_ids[0] === B, 'Wooden Spoon 2021 → Bluey');
const hc = rpcs.find((r) => r.name === 'import_handicaps').body.p_rows;
check(hc.length === 2 && hc[0].player_id === pete.id && hc[0].handicap === 22 && hc[0].date === '2019-01-01', 'past handicap on the new player');
check(hc[1].player_id === JM && hc[1].handicap === 14, '"Josh Moran"’s handicap goes on Joshua Moran (the organiser’s answer)');
const ru = rpcs.find((r) => r.name === 'import_rules').body.p_rows;
check(ru.length === 3 && ru[0].title === 'Lost ball fine' && ru[0].value === '$10' && ru[0].category === 'fines', 'only the new rules are sent, with the edit');
check(ru[1].title === 'Gimmes inside the leather' && ru[1].detail === null && /drop where it went out/.test(ru[2].detail), 'rule wording only when it says more than the title');
check(await page.getByRole('link', { name: '🏆 The Trophy Room' }).isVisible() && await page.getByRole('link', { name: '📜 The Rulebook' }).isVisible(), 'links to the Trophy Room, History and the Rulebook');
await page.screenshot({ path: `${SHOTS}/3-done.png`, fullPage: true });

// 5. Safe to run twice: the same import again finds everything already there.
await page.getByRole('button', { name: 'Bring in more' }).click();
await page.getByLabel('Paste your history').fill('BD Trophy\n2019 Hunter Valley — Kurt & Greeny');
await page.getByRole('button', { name: 'Read it' }).click();
await page.getByLabel('Not sure about').waitFor({ timeout: 15000 });
const txt2 = await page.locator('.page').innerText();
check(/Pete Green \(“Greeny”\)\n→ already a player · already there/.test(txt2) || /→ already a player · already there/.test(txt2), 'second time: Pete is already a player');
check(/already on the honour board/.test(txt2), 'second time: the winners are already on the honour board');
const nBefore = rpcs.length;
const btn2 = page.getByRole('button', { name: /^Add these \(\d+\)$/ });
// Only Port Stephens (still new) and nothing else is ticked.
check(/Add these \(1\)/.test(await btn2.innerText()), `second time: only the one still-new item is ticked (${await btn2.innerText()})`);
check(/→ already a player \(Craig MacDougal\)/.test(txt2), 'second time: Craig has his nickname, nothing to add');
await page.getByLabel(/Add Port Stephens 2021/).uncheck();
check(await btn2.isDisabled(), 'nothing ticked: Add these is off');
check(rpcs.length === nBefore, 'nothing written the second time');

// 6. A player: no way in, and /import says organisers only.
organiser = false;
await page.goto(`${BASE}#/ask`);
await page.reload();
await page.getByLabel('Your question').waitFor({ timeout: 15000 });
check(!(await page.getByRole('link', { name: '✨ Bring in our history' }).isVisible().catch(() => false)), 'a player doesn’t get the import chip on Ask');
await page.goto(`${BASE}#/import`);
await page.getByText('Only an organiser can bring in the group’s history.').waitFor({ timeout: 10000 });
check(true, 'a player can’t open the import');
organiser = true;

// 7. Switched off: hidden, and /import says so.
db.group_features.find((f) => f.feature_key === 'ai_helper').enabled = false;
const before = calls.length;
await page.goto(`${BASE}#/history`);
await page.reload();
await page.getByText('Past winners').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
check(!(await page.getByRole('link', { name: '📥 Add past trips, scorecards, cups…' }).isVisible().catch(() => false)), 'switched off: no Import with AI on History');
await page.goto(`${BASE}#/setup`);
await page.getByText('Set up your trip').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
check(!(await page.getByLabel('Bring your history').isVisible().catch(() => false)), 'switched off: no card in the guided setup');
await page.goto(`${BASE}#/import`);
await page.getByText('The Caddie is switched off for this group.').waitFor({ timeout: 10000 });
check(true, 'switched off: /import says so');
check(calls.length === before, 'switched off: the function isn’t called');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
