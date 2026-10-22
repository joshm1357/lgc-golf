// Live commentary browser check (071), 21 Oct 2026. Fake database only.
// Usage: node commentary-test.mjs <base> <shotDir>   e.g. http://localhost:4382/lgc-golf/
// Scores arrive → a lead change is recorded once → the server's line (a template here, as with no AI) shows in the
// Feed as a commentary card → the organiser changes the tone and hides a line → switched off = nothing.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { templateLine } from '../../src/lib/commentary.js';

const BASE = process.argv[2] || 'http://localhost:4382/lgc-golf/';
const SHOTS = process.argv[3] || './shots-commentary';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const AL = '22222222-2222-4222-8222-222222222222';
const BO = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const NAMES = { [K]: 'Kurt', [AL]: 'Al', [BO]: 'Bo' };

/** Scores for holes `from`..`to`: Kurt pars, Al bogeys then birdies from hole 4, Bo doubles. Saved minutes ago. */
function scoresFor(from, to) {
  const out = [];
  for (let n = from; n <= to; n++) {
    for (const [pid, strokes] of [[K, 4], [AL, n <= 3 ? 5 : 3], [BO, 6]]) {
      out.push({ id: crypto.randomUUID(), group_id: GROUP, round_id: R1, subject_id: pid, subject_type: 'player', hole: n, strokes, picked_up: false,
        updated_at: new Date(Date.now() - (16 - n) * 60000 + (pid === K ? 0 : pid === AL ? 1000 : 2000)).toISOString() });
    }
  }
  return out;
}

let db;
function reset({ commentary = true } = {}) {
  db = {
    players: [K, AL, BO].map((id) => ({ id, name: NAMES[id], nickname: null, handicap: 0, approved: true, created_at: now, cup_side: null })),
    trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: TODAY, end_date: TODAY, status: 'active', created_at: now }],
    trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
    round_players: [K, AL, BO].map((pid) => ({ id: crypto.randomUUID(), round_id: R1, player_id: pid, playing_handicap: 0 })),
    scores: scoresFor(1, 3),
    courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
    rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday Stableford', play_date: TODAY, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now }],
    plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], comments: [], reactions: [], rules: [],
    cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], award_moments: [], commentary: [], commentary_settings: [],
    group_features: [
      ...['feed', 'awards'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
      ...(commentary ? [] : [{ group_id: GROUP, feature_key: 'commentary', enabled: false }]),
    ],
  };
}
reset();

const commentaryOn = () => !db.group_features.some((f) => f.feature_key === 'commentary' && !f.enabled) && db.group_features.some((f) => f.feature_key === 'awards' && f.enabled);
/** What the server does a minute later: a template line (no AI configured), then the database posts it. */
function serverWrites() {
  const tone = db.commentary_settings[0]?.tone || 'cheeky';
  for (const c of db.commentary.filter((x) => x.status === 'pending')) {
    const f = c.facts;
    const vals = { who: NAMES[f.subject], prev: NAMES[f.prev], hole: f.hole, streak: f.streak, behind: f.behind != null ? `${f.behind} points` : '', score: f.points != null ? `${f.points} pts thru ${f.thru}` : '' };
    c.line = templateLine(c.kind, vals, tone, c.key);
    c.status = 'ready';
    const post = { id: crypto.randomUUID(), group_id: GROUP, kind: 'auto', body: `🎙️ ${c.line}`, round_id: R1, link: `/?r=${R1}`, player_id: f.subject || null, created_at: new Date().toISOString() };
    db.posts.push(post);
    c.post_id = post.id;
  }
}

const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
      if (v.startsWith('gte.') && String(r[k]) < v.slice(4)) return false;
      if (v.startsWith('like.') && !String(r[k]).startsWith(v.slice(5).replace(/[%*]$/, ''))) return false;
    }
    return true;
  });
}
let rejected = 0;
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') {
      let out = filterRows(rows, url.searchParams);
      if (table === 'posts' || table === 'commentary') out = [...out].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(out);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      const upsert = /resolution=merge-duplicates/.test(req.headers().prefer || '');
      for (const b of Array.isArray(body) ? body : [body]) {
        if (table === 'commentary' || table === 'commentary_settings') {
          // The database: switched off = refused (restrictive policy).
          if (!commentaryOn()) { rejected++; return json({ code: '42501', message: 'new row violates row-level security policy' }, 403); }
        }
        if (table === 'commentary') {
          if (rows.some((r) => r.key === b.key)) continue; // on conflict do nothing
          const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), created_by: K, status: 'pending', line: null, post_id: null, ...b };
          rows.push(row); made.push(row);
          continue;
        }
        if (table === 'commentary_settings' && upsert) {
          const was = rows.find((r) => r.group_id === b.group_id);
          if (was) { Object.assign(was, b); made.push(was); continue; }
        }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) {
        if (r.id !== id) continue;
        Object.assign(r, body);
        // Hidden: the database takes its Feed post down.
        if (table === 'commentary' && body.status === 'hidden') db.posts = db.posts.filter((x) => x.id !== r.post_id);
      }
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (dl) => dl.accept());
const leads = () => db.commentary.filter((c) => c.kind === 'lead' || c.kind === 'charge');

// 1. Three holes in: Kurt leads from the start — nobody new on top, nothing to say.
await page.goto(`${BASE}#/`);
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
check(leads().length === 0, `first leader isn't a lead change (${db.commentary.map((c) => c.key).join(', ') || 'none'})`);

// 2. Scores arrive: Al birdies 4–7 and goes clear — a lead change (a charge, from 3 back), recorded once.
db.scores.push(...scoresFor(4, 7));
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
for (let i = 0; i < 30 && !leads().length; i++) await page.waitForTimeout(250);
const lead = leads()[0];
check(!!lead && lead.key === `charge:${R1}:${AL}:7` && lead.facts.subject === AL && lead.facts.prev === K && lead.facts.behind >= 3, `lead change recorded: ${lead?.key} ${JSON.stringify(lead?.facts)}`);
check(db.commentary.some((c) => c.kind === 'birdies' && c.facts.subject === AL), 'Al’s birdie run recorded too');
check(db.commentary.every((c) => !/Al|Kurt|Bo/.test(JSON.stringify(c.facts))), 'facts carry ids, never names or text');
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
check(leads().length === 1, `reload: still one lead moment (${leads().length})`);
const keys = db.commentary.map((c) => c.key);
check(new Set(keys).size === keys.length, 'no moment recorded twice');

// 3. The server writes the line → a commentary card in the Feed.
serverWrites();
await page.goto(`${BASE}#/feed`);
const card = page.locator('article.post', { hasText: lead.line }).first();
await card.waitFor({ timeout: 15000 });
const cardText = await card.innerText();
check(/🎙️/.test(cardText) && /\bAl\b/.test(cardText), `commentary card in the Feed: “${cardText.split('\n')[0]}”`);
check(/Commentary ·/.test(cardText), 'labelled Commentary (not Scoreboard)');
await page.screenshot({ path: `${SHOTS}/1-feed.png`, fullPage: false });

// 4. Organiser: change the tone and hide a line.
await page.goto(`${BASE}#/admin`);
const settings = page.locator('[aria-label="Live commentary"]');
await settings.waitFor({ timeout: 15000 });
check(await settings.getByRole('button', { name: 'Cheeky' }).getAttribute('aria-pressed') === 'true', 'tone starts Cheeky');
check(await settings.getByRole('button', { name: 'Sometimes' }).getAttribute('aria-pressed') === 'true', 'buzz starts Sometimes');
await settings.getByRole('button', { name: 'Old-school TV' }).click();
await page.getByText('Saved').first().waitFor({ timeout: 5000 });
check(db.commentary_settings[0]?.tone === 'tv' && db.commentary_settings[0]?.group_id === GROUP, `tone saved: ${JSON.stringify(db.commentary_settings[0])}`);
await page.waitForTimeout(500);
check(await settings.getByRole('button', { name: 'Old-school TV' }).getAttribute('aria-pressed') === 'true', 'Old-school TV now picked');
check(/summit|And there it is/.test(await settings.innerText()), 'the sample line is in the new tone');
await settings.getByRole('button', { name: 'Feed only' }).click();
await page.waitForTimeout(600);
check(db.commentary_settings[0]?.buzz === 'feed' && db.commentary_settings.length === 1, 'buzz level saved (one settings row)');
await settings.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/2-settings.png`, fullPage: false });
const postsBefore = db.posts.length;
await settings.getByRole('button', { name: 'Hide' }).first().click();
await page.getByText('Hidden from the Feed').first().waitFor({ timeout: 5000 });
check(db.commentary.some((c) => c.status === 'hidden') && db.posts.length === postsBefore - 1, 'hide: line hidden and its Feed post taken down');

// 5. Switched off: nothing recorded, no settings card.
reset({ commentary: false });
db.scores.push(...scoresFor(4, 7));
rejected = 0;
await page.goto(`${BASE}#/`);
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(2000);
check(db.commentary.length === 0 && rejected === 0, `switched off: nothing recorded or even tried (${db.commentary.length}, ${rejected})`);
await page.goto(`${BASE}#/admin`);
await page.reload();
await page.getByText('Set up your trip').first().waitFor({ timeout: 15000 });
check(!(await page.locator('[aria-label="Live commentary"]').isVisible().catch(() => false)), 'switched off: no commentary settings');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
