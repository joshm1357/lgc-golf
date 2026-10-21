// In-jokes (058) browser check, 21 Oct 2026. Fake database only.
// Usage: node injokes-test.mjs <base> <shotDir>   e.g. http://localhost:4316/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4316/lgc-golf/';
const SHOTS = process.argv[3] || './shots-injokes';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const AL = '22222222-2222-4222-8222-222222222222';
const BO = '33333333-3333-4333-8333-333333333333';
const now = '2026-10-21T08:00:00.000Z';
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now },
    { id: AL, name: 'Al Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now },
    { id: BO, name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now },
  ],
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [], rounds: [], plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  side_entries: [],
  // A joke Bo added (Kurt is a player in step 4, so he can't edit or retire it then).
  in_jokes: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', group_id: GROUP, text: 'Lunch is on {name}', player_id: null, moment: 'lead', active: true, created_by: BO, created_at: now }],
  group_features: ['feed', 'in_jokes'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: organiser ? 'organiser' : 'player' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const added = (Array.isArray(body) ? body : [body]).map((b) => ({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), active: true, ...b }));
      rows.push(...added);
      const wants = (req.headers().prefer || '').includes('return=representation');
      return json(wants ? added : [], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
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
  localStorage.setItem('tgt-whats-new', 'beta-1');
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. More → In-jokes, and the link in Group & invites.
await page.goto(`${BASE}#/more`);
await page.getByRole('link', { name: /Running jokes/ }).waitFor({ timeout: 15000 });
check(true, 'More lists Running jokes (organisers)');
await page.goto(`${BASE}#/group`);
await page.getByRole('link', { name: /Running jokes/ }).waitFor({ timeout: 15000 });
await page.getByRole('link', { name: /Running jokes/ }).click();
await page.getByText('Roast the golf and the mates, keep it friendly').waitFor({ timeout: 10000 });
check(true, 'Group & invites links to In-jokes; the screen says keep it friendly');
check(await page.getByText('Lunch is on someone').waitFor({ timeout: 5000 }).then(() => true, () => false), 'an existing joke about anyone lists ({name} → someone)');

// 2. The block list stops a slur before it's sent.
const text = page.getByLabel('The joke');
await text.fill('what a r3tard');
check(await page.getByRole('alert').filter({ hasText: /friendly/ }).isVisible(), 'a slur shows the keep-it-friendly message');
check(await page.getByRole('button', { name: 'Add joke' }).isDisabled(), 'and Add is greyed out');

// 3. Add a joke about Al for birdies.
await page.getByRole('button', { name: "{name}'s driver has a mind of its own" }).click();
check(await text.inputValue() === "{name}'s driver has a mind of its own", 'tapping an example fills the joke');
await text.fill('Even a blind squirrel finds a nut, {name}');
await page.getByLabel('About who (optional)').selectOption(AL);
await page.getByLabel('When it comes up').selectOption('birdie');
check(await page.getByText('Shows as: “Even a blind squirrel finds a nut, Bluey”').isVisible(), 'preview fills in the player’s name');
await page.screenshot({ path: `${SHOTS}/1-add.png`, fullPage: true });
await page.getByRole('button', { name: 'Add joke' }).click();
await page.waitForTimeout(800);
const added = db.in_jokes.find((j) => j.text.startsWith('Even a blind'));
check(added && added.player_id === AL && added.moment === 'birdie' && added.created_by === K, 'saved: about Al, for a birdie, added by Kurt');
const groupAl = page.getByTestId('joke-group').filter({ hasText: 'About Bluey' });
await groupAl.waitFor({ timeout: 5000 });
check(await groupAl.getByText('Even a blind squirrel finds a nut, Bluey').isVisible(), 'it lists under Al (Bluey) with his name filled in');
check(await groupAl.getByText('A birdie · from Kurt').isVisible(), 'shows the moment and who added it');
await page.screenshot({ path: `${SHOTS}/2-listed.png`, fullPage: true });

// 4. Edit it.
await groupAl.getByRole('button', { name: 'Edit' }).click();
await page.getByLabel('The joke').last().fill('Bluey’s birdie: even a blind squirrel finds a nut');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(800);
check(added.text === 'Bluey’s birdie: even a blind squirrel finds a nut', 'edit saved');
await page.reload();
await page.getByText('Bluey’s birdie: even a blind squirrel finds a nut').waitFor({ timeout: 10000 });
check(true, 'edited joke lists');

// 5. Players don't see the list at all (not a public list).
organiser = false;
await page.reload();
await page.getByText('Only organisers see the running jokes').waitFor({ timeout: 10000 });
check(true, 'a player sees no list');
await page.goto(`${BASE}#/more`);
await page.waitForTimeout(1000);
check(!(await page.getByRole('link', { name: /Running jokes/ }).isVisible().catch(() => false)), 'a player has no link in More');
await page.goto(`${BASE}#/in-jokes`);

// 7. Organiser can retire anyone's.
organiser = true;
await page.reload();
await page.getByText('Lunch is on someone').waitFor({ timeout: 10000 });
await page.locator('.row', { hasText: 'Lunch is on someone' }).getByRole('button', { name: 'Retire' }).click();
await page.waitForTimeout(800);
check(db.in_jokes[0].active === false, 'organiser retired Bo’s joke');

// 8. Feature off: hidden in More and Group, and the screen says it's off.
db.group_features = db.group_features.map((f) => (f.feature_key === 'in_jokes' ? { ...f, enabled: false } : f));
await page.goto(`${BASE}#/more`);
await page.getByRole('link', { name: /Group & invites/ }).waitFor({ timeout: 15000 });
await page.reload();
await page.getByRole('link', { name: /Group & invites/ }).waitFor({ timeout: 15000 });
check(!(await page.getByRole('link', { name: /Running jokes/ }).isVisible().catch(() => false)), 'switched off: not in More');
await page.goto(`${BASE}#/group`);
await page.getByText('Group & invites').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
check(!(await page.getByRole('link', { name: /Running jokes/ }).isVisible().catch(() => false)), 'switched off: no link in Group & invites');
await page.goto(`${BASE}#/in-jokes`);
await page.getByText('In-jokes is switched off for this group.').waitFor({ timeout: 10000 });
check(true, 'switched off: the screen says so');
await page.screenshot({ path: `${SHOTS}/4-off.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
