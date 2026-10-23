// Shared bits for the ov28 browser checks (your-round, day-screen, results): a fake database, a signed-in phone
// (375 px, Sydney time) and pass / fail reporting. Fake database only — nothing touches Supabase.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const GROUP = 'a0a0a0a0-0000-4000-8000-0000000000c8';
export const COURSE = 'cccccccc-0000-4000-8000-000000000028';
export const P = {
  mike: '28000000-0000-4000-8000-000000000001', bo: '28000000-0000-4000-8000-000000000002',
  kurt: '28000000-0000-4000-8000-000000000003', al: '28000000-0000-4000-8000-000000000004',
  cy: '28000000-0000-4000-8000-000000000005', di: '28000000-0000-4000-8000-000000000006',
  lou: '28000000-0000-4000-8000-000000000007', mo: '28000000-0000-4000-8000-000000000008',
  ed: '28000000-0000-4000-8000-000000000009', fin: '28000000-0000-4000-8000-00000000000a',
};
export const NAMES = { mike: 'Mike', bo: 'Bo', kurt: 'Kurt', al: 'Al', cy: 'Cy', di: 'Di', lou: 'Lou', mo: 'Mo', ed: 'Ed', fin: 'Fin' };
export const now = new Date().toISOString();
export const HOLES = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));

/** Sydney's date, offset by `d` days: 'YYYY-MM-DD'. */
export function sydney(d = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + d * 86400000));
}

/** A fresh fake database with the ten players, one course and every table the screens read (empty). */
export function baseDb(features = []) {
  return {
    players: Object.entries(P).map(([k, id]) => ({ id, group_id: GROUP, name: `${NAMES[k]} ${k.toUpperCase()}`, nickname: NAMES[k], handicap: 12, approved: true, created_at: now, cup_side: null })),
    trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
    courses: [{ id: COURSE, name: 'Cypress Lakes', holes: HOLES, created_at: now }],
    rounds: [], plans: [], plan_rsvps: [], plan_transfers: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [],
    posts: [], reactions: [], rules: [], comps: [], cup_sides: [], cup_matches: [], tee_groups: [], tips: [], trip_tips: [],
    dinner_awards: [], dinner_award_nominations: [], dinner_award_votes: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
    group_features: features.map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
}

function matches(r, k, v) {
  if (k === 'group_id' && r.group_id === undefined) return true;
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v === 'is.null') return r[k] == null;
  if (v === 'not.is.null') return r[k] != null;
  return true;
}
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'or'].includes(k)) continue;
      if (!matches(r, k, v)) return false;
    }
    return true;
  });
}

/**
 * Open the app as a signed-in player. opts: { db, me (player id), organiser, groupName }.
 * Returns { page, ctx, browser, check, fails, calls (notify bodies), rpcs, done() }.
 */
export async function start(name, { db, me = P.mike, organiser = false, groupName = 'Hunter Weekend' } = {}) {
  const shots = process.argv[3] || `./shots-${name}`;
  fs.mkdirSync(shots, { recursive: true });
  const fails = [];
  const calls = [];
  const rpcs = [];
  const state = { organiser, me };
  const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
  async function fake(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    const p = url.pathname;
    if (p.startsWith('/functions/v1/notify')) { calls.push(JSON.parse(req.postData() || '{}')); return json({ sent: 1 }); }
    if (p.startsWith('/functions/')) return json({});
    if (p.startsWith('/rest/v1/rpc/my_status')) {
      return json({ is_member: true, is_admin: state.organiser, player_id: state.me, group_name: groupName, group_id: GROUP, role: state.organiser ? 'organiser' : 'player', legacy: false,
        groups: [{ id: GROUP, name: groupName, slug: 'hunter', role: state.organiser ? 'organiser' : 'player' }] });
    }
    if (p.startsWith('/rest/v1/rpc/set_cup_hole')) {
      const b = JSON.parse(req.postData() || '{}');
      const m = (db.cup_matches || []).find((x) => x.id === b.p_match);
      if (!m) return json({ message: 'no match' }, 400);
      if (b.p_result) m.holes[String(b.p_hole)] = b.p_result; else delete m.holes[String(b.p_hole)];
      m.updated_at = new Date().toISOString();
      return json(m.holes);
    }
    if (p.startsWith('/rest/v1/rpc/')) { rpcs.push(p.split('/').pop()); return json(null); }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/')[3];
      const rows = db[table] || [];
      if (method === 'GET') return json(filterRows(rows, url.searchParams));
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        for (const b of Array.isArray(body) ? body : [body]) rows.push({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b });
        db[table] = rows;
        return json([], 201);
      }
      if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}');
        for (const r of filterRows(rows, url.searchParams)) Object.assign(r, body);
        return json([], 200);
      }
      if (method === 'DELETE') {
        const gone = new Set(filterRows(rows, url.searchParams));
        db[table] = rows.filter((r) => !gone.has(r));
        return json([], 200);
      }
    }
    return json({});
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Australia/Sydney' });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(([uid]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  }, ['99999999-9999-4999-8999-999999999928']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true }).catch(() => {});
  /** No sideways scroll at 375 px. */
  const noSideScroll = async (label) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scroll at 375px`);
  const done = async () => {
    check(!fails.some((f) => f.startsWith('page error')), 'no page errors');
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
    process.exit(fails.length ? 1 : 0);
  };
  return { page, ctx, browser, check, fails, calls, rpcs, state, shot, noSideScroll, done };
}

/** A stableford round's scores: { player id: [strokes for holes 1…n] }. */
export function scoreRows(roundId, byPlayer) {
  const out = [];
  for (const [pid, strokes] of Object.entries(byPlayer)) strokes.forEach((s, i) => out.push({ round_id: roundId, subject_id: pid, subject_type: 'player', hole: i + 1, strokes: s, picked_up: false, updated_at: now }));
  return out;
}
