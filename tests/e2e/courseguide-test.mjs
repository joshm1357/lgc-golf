// Course guide browser check, 21 Oct 2026. Fake database only; satellite tiles replaced with plain green squares.
// Usage: node courseguide-test.mjs <base> <shotDir>   e.g. http://localhost:4318/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4318/lgc-golf/';
const SHOTS = process.argv[3] || './shots-courseguide';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const MAPPED = 'cccccccc-0000-4000-8000-000000000001';
const BARE = 'cccccccc-0000-4000-8000-000000000002';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const now = '2026-10-21T08:00:00.000Z';

// Hole n runs due north from its tee, 150 m east of the last hole. Hole 1: 350 m to the middle, green 30 m deep.
const o = { lat: -34.85, lng: 150.75 };
const at = (northM, eastM = 0) => ({ lat: o.lat + northM / 111195, lng: o.lng + eastM / (111195 * Math.cos((o.lat * Math.PI) / 180)) });
const parsi = [[4, 7], [3, 15], [5, 1], [4, 9], [4, 3], [3, 17], [5, 5], [4, 11], [4, 13], [4, 8], [3, 16], [5, 2], [4, 10], [4, 4], [3, 18], [5, 6], [4, 12], [4, 14]];
const mappedHoles = parsi.map(([par, si], i) => {
  const L = i === 0 ? 350 : 150 + i * 20;
  const e = i * 150;
  return { n: i + 1, par, si, tee: at(0, e), front: at(L - 15, e), green: at(L, e), back: at(L + 15, e) };
});
const bareHoles = parsi.map(([par, si], i) => ({ n: i + 1, par, si }));

const db = {
  players: [{ id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now }],
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-22', end_date: '2026-10-24', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [],
  round_pins: [{ round_id: R1, hole: 1, lat: at(358).lat, lng: at(358).lng, set_by: K, set_at: now }],
  round_players: [{ round_id: R1, player_id: K, playing_handicap: 12 }],
  scores: [],
  courses: [
    { id: MAPPED, name: 'Cypress Lakes', holes: mappedHoles, created_at: now },
    { id: BARE, name: 'The Vintage', holes: bareHoles, created_at: now },
  ],
  rounds: [{ id: R1, trip_id: TRIP, course_id: MAPPED, name: 'Friday — Cypress Lakes', play_date: '2026-10-23', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [],
  group_features: ['gps'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
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
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = (Array.isArray(body) ? body : [body]).map((b) => ({ id: crypto.randomUUID(), group_id: GROUP, created_at: now, ...b }));
      rows.push(...made);
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    return json([], 200);
  }
  return json({});
}
// A plain green square for every satellite tile (no network needed, and the screenshots stay readable).
const GREEN_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgaGj4DwAEhAI/dvJ1nQAAAABJRU5ErkJggg==', 'base64');

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: GREEN_PNG }));
await ctx.grantPermissions(['geolocation']);
await ctx.setGeolocation({ latitude: at(200).lat, longitude: at(200).lng, accuracy: 6 }); // 200 m up hole 1's fairway
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (x) => btoa(JSON.stringify(x)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1');
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const holeText = async () => (await page.getByTestId('guide-hole').innerText()).replace(/\s+/g, ' ').replace(/^HOLE/, 'Hole');

// 1. The leaderboard has a course guide chip for the round's course.
await page.goto(`${BASE}#/?r=${R1}`);
await page.getByRole('link', { name: '📍 Course guide' }).waitFor({ timeout: 15000 });
await page.screenshot({ path: `${SHOTS}/1-board.png` });
await page.getByRole('link', { name: '📍 Course guide' }).click();
await page.getByTestId('guide-hole').waitFor({ timeout: 15000 });
check(page.url().includes(`/guide/${MAPPED}`) && page.url().includes(`r=${R1}`), `the chip opens the guide for the round's course (${page.url()})`);

// 2. Hole 1: par, SI and length.
let t = await holeText();
check(/Hole 1 Par 4 SI 7 350 m approx/.test(t), `hole 1: par 4, SI 7, 350 m approx (${t})`);
check(await page.locator('.leaflet-container').isVisible(), 'the satellite map shows');
check((await page.locator('.leaflet-control-attribution').innerText()).includes('Esri'), 'the map carries the Esri credit');

// 3. GPS distances (faked position, 200 m up the fairway; today's pin at 358 m).
await page.getByRole('button', { name: 'GPS on' }).click();
await page.getByText('GPS ±6 m').waitFor({ timeout: 10000 });
const dist = (await page.getByTestId('guide-distances').innerText()).replace(/\s+/g, ' ');
check(/Front 135 Middle 150 Back 165 🚩 Pin 158/.test(dist), `distances front 135 / middle 150 / back 165 / pin 158 (${dist})`);
check(/Approx/.test(dist), 'distances are labelled approx');
check(/Today’s pin from Friday/.test(dist), 'says the pin comes from today’s round');
await page.screenshot({ path: `${SHOTS}/2-hole1.png` });

// 4. Shot planner: tap the map, see the distance from me and on to the pin.
const box = await page.locator('.leaflet-container').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
await page.getByText('Shot 1').waitFor({ timeout: 5000 });
const plan = (await page.getByTestId('guide-planner').innerText()).replace(/\s+/g, ' ');
check(/Shot 1 you → target 1 \d+ m Shot 2 target 1 → the pin \d+ m Total 1[56]\d m/.test(plan), `planner: me → target → pin (${plan})`);
await page.screenshot({ path: `${SHOTS}/3-planner.png` });

// 5. Next hole (button), then a swipe, then the hole strip.
await page.getByRole('button', { name: 'Next hole' }).click();
await page.waitForFunction(() => /Hole\s*2/i.test(document.querySelector('[data-testid=guide-hole]')?.innerText || ''));
t = await holeText();
check(/Hole 2 Par 3 SI 15 170 m approx/.test(t) && page.url().includes(`/guide/${MAPPED}/2`), `next hole: hole 2, par 3, SI 15, 170 m (${t})`);
check(!(await page.getByText('Shot 1').isVisible().catch(() => false)), 'planner targets clear on a new hole');
await page.evaluate(() => {
  const el = document.querySelector('[data-testid=guide-hole]');
  const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(300)], changedTouches: [mk(300)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(120)] }));
});
await page.waitForFunction(() => /Hole\s*3/i.test(document.querySelector('[data-testid=guide-hole]')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
check(/Hole 3 Par 5/.test(await holeText()), 'swiping left goes to the next hole');
await page.getByRole('group', { name: 'Hole' }).getByRole('button', { name: '18', exact: true }).click();
await page.waitForFunction(() => /Hole\s*18/i.test(document.querySelector('[data-testid=guide-hole]')?.innerText || ''));
check(/Hole 18 Par 4 SI 14/.test(await holeText()), 'the hole strip jumps to 18');
await page.getByRole('button', { name: 'Next hole' }).click();
await page.waitForFunction(() => /Hole\s*1\b/i.test(document.querySelector('[data-testid=guide-hole]')?.innerText || ''));
check(/Hole 1 Par 4/.test(await holeText()), 'next after 18 goes round to 1');
const gpsDist = (await page.getByTestId('guide-distances').innerText()).replace(/\s+/g, ' ');
check(/Middle 150/.test(gpsDist), 'GPS stays on between holes');

// 6. Far away (at home): no silly distances.
await ctx.setGeolocation({ latitude: o.lat + 0.2, longitude: o.lng, accuracy: 10 });
await page.getByText(/km from this green/).waitFor({ timeout: 10000 }).catch(() => {});
check(await page.getByText(/You’re about 22 km from this green/).isVisible(), 'a long way off: says how far, not front/middle/back');
await ctx.setGeolocation({ latitude: at(200).lat, longitude: at(200).lng, accuracy: 6 });

// 7. The score screen's distances link to this hole in the guide.
await page.goto(`${BASE}#/score/${R1}`);
await page.getByRole('link', { name: /in the course guide/ }).first().waitFor({ timeout: 15000 });
const href = await page.getByRole('link', { name: /in the course guide/ }).first().getAttribute('href');
check(href.includes(`/guide/${MAPPED}/1`), `score screen links to hole 1 in the guide (${href})`);

// 8. Courses list: a course guide button on each course.
await page.goto(`${BASE}#/courses`);
await page.getByText('The Vintage').first().waitFor({ timeout: 15000 });
await page.getByText('The Vintage').first().click();
await page.getByRole('link', { name: /Course guide/ }).waitFor({ timeout: 5000 });
await page.getByRole('link', { name: /Course guide/ }).click();
await page.getByTestId('unmapped').waitFor({ timeout: 15000 });
check(page.url().includes(`/guide/${BARE}`), 'the Courses button opens that course’s guide');

// 9. A course with no greens: par/SI, the mapping prompt for an organiser.
t = await holeText();
check(/Hole 1 Par 4 SI 7/.test(t) && !/approx/.test(t), `no greens: still par and SI, no length (${t})`);
let un = await page.getByTestId('unmapped').innerText();
check(un.includes('Greens aren’t mapped for this course yet — distances need them.'), 'says greens aren’t mapped');
check(await page.getByRole('link', { name: /Map the greens \(about 2 minutes\)/ }).isVisible(), 'organiser sees "Map the greens (about 2 minutes)"');
check(await page.getByRole('link', { name: /Find The Vintage on a map/ }).isVisible(), 'offers the course location on a map');
check(await page.locator('table.sc').isVisible(), 'shows the card (par and SI for every hole)');
await page.screenshot({ path: `${SHOTS}/4-unmapped-organiser.png`, fullPage: true });
await page.getByRole('button', { name: 'Next hole' }).click();
await page.waitForFunction(() => /Hole\s*2/i.test(document.querySelector('[data-testid=guide-hole]')?.innerText || ''));
await page.getByRole('link', { name: /Map the greens/ }).click();
await page.getByTestId('map-progress').waitFor({ timeout: 15000 });
const prog = (await page.getByTestId('map-progress').innerText()).replace(/\s+/g, ' ');
check(/0 of 18 greens mapped/.test(prog), `the green mapper shows progress (${prog})`);
check(await page.getByText('How it works (about 2 minutes)').isVisible() && await page.getByText(/Fill from OpenStreetMap/).first().isVisible(), 'the green mapper shows the how-to');
check(await page.getByText('Hole 2 · par 3').isVisible(), 'the mapper opens on the hole you were looking at');
check(/Next: hole 3/.test(prog), 'offers the next unmapped hole');
await page.screenshot({ path: `${SHOTS}/5-mapper.png` });

// 10. A player: no mapping button.
organiser = false;
await page.goto(`${BASE}#/guide/${BARE}`);
await page.reload();
await page.getByTestId('unmapped').waitFor({ timeout: 15000 });
un = await page.getByTestId('unmapped').innerText();
check(un.includes('Greens aren’t mapped') && un.includes('Ask an organiser'), 'player sees the not-mapped card');
check(!(await page.getByRole('link', { name: /Map the greens/ }).isVisible().catch(() => false)), 'player gets no "Map the greens" button');
await page.screenshot({ path: `${SHOTS}/6-unmapped-player.png` });

// 11. GPS switched off for the group: no chip, and the guide says it's off.
db.group_features = [{ group_id: GROUP, feature_key: 'gps', enabled: false }];
await page.goto(`${BASE}#/?r=${R1}`);
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
check(!(await page.getByRole('link', { name: '📍 Course guide' }).isVisible().catch(() => false)), 'GPS off: no course guide chip');
await page.goto(`${BASE}#/guide/${MAPPED}`);
await page.getByText(/switched off for this group/).waitFor({ timeout: 15000 });
check(await page.getByText('The course guide is switched off for this group.').isVisible(), 'GPS off: the guide says it’s switched off');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
