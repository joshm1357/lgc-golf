// Running jokes in the background (072) browser check, 22 Oct 2026. Fake database only.
// No list anywhere (More, /in-jokes, Group & invites); dinner awards get a joke line from in_joke_lines (never the
// table); organisers have "Forget the running jokes" (calls forget_running_jokes); players don't; switch off = nothing.
// Usage: node jokes-test.mjs <base> <shotDir>   e.g. http://localhost:4383/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4383/lgc-golf/';
const SHOTS = process.argv[3] || './shots-jokes';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000f';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const TNOW = 'aaaaaaaa-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const today = now.slice(0, 10);
const LINES = ['Al still owes everyone for the cab', 'The ferry to nowhere'];

const feats = (jokes = true) => ['feed', 'dinner_awards', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true }))
  .concat([{ group_id: GROUP, feature_key: 'in_jokes', enabled: jokes }]);
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 10, approved: true, created_at: now },
    { id: A, name: 'Al Blue', nickname: null, handicap: 12, approved: true, created_at: now },
    { id: B, name: 'Bo Red', nickname: null, handicap: 18, approved: true, created_at: now },
  ],
  trips: [{ id: TNOW, name: 'Hunter Weekend', start_date: today, end_date: today, status: 'active', created_at: now }],
  rounds: [], courses: [], teams: [], team_players: [], round_players: [], scores: [], quick_results: [], honour_board: [],
  posts: [], comments: [], reactions: [], plans: [], plan_rsvps: [],
  dinner_awards: [{ id: 'aw-1', trip_id: TNOW, title: 'Hack of the day', kind: 'award', status: 'closed', created_by: K, group_id: GROUP, created_at: now }],
  dinner_award_nominations: [{ id: 'n1', award_id: 'aw-1', player_id: A, nominated_by: K, created_at: '1' }, { id: 'n2', award_id: 'aw-1', player_id: B, nominated_by: K, created_at: '2' }],
  dinner_award_votes: [{ award_id: 'aw-1', nomination_id: 'n1', voter_id: K, updated_at: now }, { award_id: 'aw-1', nomination_id: 'n1', voter_id: B, updated_at: now }],
  group_features: feats(),
};

let admin = true;
const calls = { lines: 0, forget: 0, table: 0 };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
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
  if (p.startsWith('/rest/v1/rpc/my_status')) {
    const role = admin ? 'organiser' : 'player';
    return json({ is_member: true, is_admin: admin, player_id: admin ? K : A, group_name: 'Hunter Crew', group_id: GROUP, role, legacy: false, groups: [{ id: GROUP, name: 'Hunter Crew', slug: 'hunter', role }] });
  }
  // 072: a few lines (only while the switch is on — the database checks); organisers forget them all.
  if (p.startsWith('/rest/v1/rpc/in_joke_lines')) { calls.lines++; return json(db.group_features.find((f) => f.feature_key === 'in_jokes').enabled ? LINES : []); }
  if (p.startsWith('/rest/v1/rpc/forget_running_jokes')) {
    calls.forget++;
    return admin ? json(2) : json({ code: 'P0001', message: 'Only an organiser can do that' }, 400);
  }
  if (p.startsWith('/rest/v1/in_jokes')) { calls.table++; return json({ code: '42501', message: 'permission denied for table in_jokes' }, 403); }
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/functions/')) return json({});
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || (db[table] = []);
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (method === 'GET') { const r = filterRows(rows, url.searchParams); return json(single ? r[0] || null : r); }
    return json(single ? null : [], 201);
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
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const settle = () => page.waitForTimeout(600);

// 1. Organiser: More has no Running jokes item; /in-jokes isn't a screen any more.
await page.goto(`${BASE}#/more`);
await page.getByText('Players & group').first().waitFor({ timeout: 15000 });
const more = await page.locator('body').innerText();
check(!/running jokes|in-jokes/i.test(more), 'organiser: More has no Running jokes item');
check(await page.locator('a[href*="in-jokes"]').count() === 0, 'organiser: no link to /in-jokes anywhere on More');
await page.screenshot({ path: `${SHOTS}/1-more-organiser.png`, fullPage: true });
await page.goto(`${BASE}#/in-jokes`);
await settle();
check(!/Roast the golf and the mates|No in-jokes yet|Add a joke/i.test(await page.locator('body').innerText()), '/in-jokes shows no jokes screen');

// 2. Group & invites: the feature's plain words, and the organiser's Forget button calls the RPC (after a confirm).
await page.goto(`${BASE}#/group`);
const card = page.getByTestId('forget-jokes');
await card.waitFor({ timeout: 15000 });
check(/never shown as a list|Nobody sees them/i.test(await card.innerText()), 'organiser: Forget card says they’re never shown as a list');
const featText = await page.locator('body').innerText();
check(featText.includes('The AI quietly picks up running jokes from the feed and trip chat to use in commentary and the replay. They’re never shown as a list.'), 'Features list: the new plain-words description');
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/2-group-forget.png` });
await card.getByRole('button', { name: 'Forget the running jokes' }).click();
await page.getByText('Running jokes forgotten').waitFor({ timeout: 10000 }).catch(() => {});
check(calls.forget === 1 && dialogs.some((m) => /Forget all the running jokes/.test(m)), `confirm, then forget_running_jokes called (${calls.forget})`);
await noSideScroll('group & invites');

// 3. Dinner awards: the decided award gets a joke line, from in_joke_lines.
await page.goto(`${BASE}#/dinner/${TNOW}`);
await page.getByTestId('award-result').waitFor({ timeout: 15000 });
const joke = page.getByTestId('award-joke');
await joke.waitFor({ timeout: 10000 }).catch(() => {});
const jt = await joke.innerText().catch(() => '');
check(LINES.some((l) => jt.includes(l)), `dinner award shows a running joke (${jt})`);
check(calls.lines > 0 && calls.table === 0, `jokes come from in_joke_lines, never the table (rpc ${calls.lines}, table ${calls.table})`);
await page.screenshot({ path: `${SHOTS}/3-dinner-joke.png`, fullPage: true });
await noSideScroll('dinner awards');

// 4. A player: no More item, no Forget button.
admin = false;
await page.goto(`${BASE}#/more`);
await page.reload();
await page.getByText('Players & group').first().waitFor({ timeout: 15000 });
check(!/running jokes|in-jokes/i.test(await page.locator('body').innerText()), 'player: More has no Running jokes item');
await page.goto(`${BASE}#/group`);
await page.getByText('Your data').first().waitFor({ timeout: 15000 }).catch(() => {});
await settle();
check(await page.getByTestId('forget-jokes').count() === 0, 'player: no Forget button');

// 5. Switched off: no joke on the dinner awards, no Forget button even for an organiser.
admin = true;
db.group_features = feats(false);
await page.goto(`${BASE}#/dinner/${TNOW}`);
await page.reload();
await page.getByTestId('award-result').waitFor({ timeout: 15000 });
await settle();
check(await page.getByTestId('award-joke').count() === 0, 'switched off: no joke on the dinner award');
await page.goto(`${BASE}#/group`);
await page.getByText('Your data').first().waitFor({ timeout: 15000 }).catch(() => {});
await settle();
check(await page.getByTestId('forget-jokes').count() === 0, 'switched off: no Forget button');
check(calls.table === 0, 'the in_jokes table was never read');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
