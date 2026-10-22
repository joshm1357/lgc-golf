// The walkthrough's fake Supabase (capture only, 23 Oct 2026). Every request the app makes is answered here from
// in-memory rows; nothing real is touched. Builds on tests/e2e/organise-fixtures.mjs (the table handler) and adds:
//   * accounts by token: each browser is one person (organiser, keen player, quiet player, late joiner, guest);
//   * sign-in by email + password and the join link (invite_info → join_by_invite → claim_player);
//   * the database functions the planning, run-up, cup and awards screens call, acted out on the rows;
//   * every other address (map tiles, fonts, weather, Google) gets an empty answer, and websockets go nowhere.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fakeSupabase, GROUP } from '../e2e/organise-fixtures.mjs';
import { rewardWords, leftoverWords } from '../../src/lib/awardsfines.js';

export { GROUP };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 86400 * 30, role: 'authenticated', is_anonymous: !!u.anon })}.x`;
const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', is_anonymous: !!u.anon, email: u.email || '', app_metadata: {}, user_metadata: {}, identities: u.anon ? [] : [{ id: 'i' }] });
export const sessionFor = (u) => ({ access_token: jwtFor(u), refresh_token: 'r', token_type: 'bearer', expires_in: 86400 * 30, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user: userObj(u) });
const subOf = (req) => { try { return JSON.parse(Buffer.from((req.headers().authorization || '').split('.')[1] || '', 'base64url').toString()).sub; } catch { return null; } };
/** A stand-in photo: sky over a fairway (a plain picture, so photo posts don't show as a flat colour). */
function photoPng(w = 160, h = 120) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const horizon = h * 0.45 + Math.sin(x / 18) * 6;
      const c = y < horizon ? [150 + y / 2, 190 + y / 3, 235] : [70 + (x % 23 < 2 ? 10 : 0), 130 + (y - horizon) / 2, 60];
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = photoPng();

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'or', 'and']);
function matchOne(r, k, v) {
  const val = r[k];
  const neg = v.startsWith('not.');
  const w = neg ? v.slice(4) : v;
  const dot = w.indexOf('.');
  const op = w.slice(0, dot); const arg = w.slice(dot + 1);
  let ok = true;
  if (op === 'eq') ok = String(val) === arg;
  else if (op === 'neq') ok = String(val) !== arg;
  else if (op === 'in') ok = arg.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, '')).includes(String(val));
  else if (op === 'is') ok = arg === 'null' ? val == null : arg === 'true' ? val === true : arg === 'false' ? val === false : true;
  else if (op === 'gte') ok = val != null && String(val) >= arg;
  else if (op === 'gt') ok = val != null && String(val) > arg;
  else if (op === 'lte') ok = val != null && String(val) <= arg;
  else if (op === 'lt') ok = val != null && String(val) < arg;
  else if (op === 'ilike' || op === 'like') ok = new RegExp(`^${arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`, 'i').test(String(val ?? ''));
  else if (op === 'cs') ok = Array.isArray(val) && arg.replace(/^[{[]|[}\]]$/g, '').split(',').filter(Boolean).every((x) => val.map(String).includes(x.replace(/"/g, '')));
  return neg ? !ok : ok;
}
export function readRows(rows, params) {
  let out = rows.filter((r) => {
    for (const [k, v] of params) {
      if (SKIP.has(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (!matchOne(r, k, v)) return false;
    }
    return true;
  });
  const orders = params.getAll('order').flatMap((o) => o.split(',')).filter(Boolean);
  if (orders.length) {
    const keys = orders.map((o) => { const [col, ...mods] = o.split('.'); return { col, desc: mods.includes('desc') }; });
    out = [...out].sort((a, b) => {
      for (const { col, desc } of keys) {
        const x = a[col]; const y = b[col];
        if (x == null && y == null) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        if (c) return desc ? -c : c;
      }
      return 0;
    });
  }
  const off = Number(params.get('offset') || 0);
  const lim = params.get('limit') ? Number(params.get('limit')) : null;
  return lim != null ? out.slice(off, off + lim) : out.slice(off);
}

/**
 * A fake server over `db`. opts: { groupName, invite, library, holes }.
 * S.accounts: account id → { id, email, password, player_id, role, member, confirmed }.
 */
export function makeServer(db, { groupName = 'L.G.C', invite = 'GCTRPJ234567', library = [], holes = [] } = {}) {
  const S = { db, accounts: new Map(), invite, calls: [], notifyCalls: [], library, current: null, errors: [] };
  const who = () => {
    const a = S.current;
    return { id: a?.player_id || null, admin: a?.role === 'organiser' };
  };
  const base = fakeSupabase(db, who);
  S.addAccount = (a) => { S.accounts.set(a.id, { confirmed: true, member: true, role: 'player', ...a }); return S.accounts.get(a.id); };
  const nick = (id) => db.players.find((p) => p.id === id)?.nickname;
  const now = () => new Date().toISOString();

  function serverRules() {
    for (const r of db.rules || []) {
      if (r.award_kind) { r.category = 'fines'; if (r.reward_type) r.value = rewardWords(r.reward_type, r.reward_amount, r.reward_note); }
      if (r.system_key === 'leftover_kitty') r.value = leftoverWords(r.leftover, r.leftover_note);
    }
  }
  function syncActivityCosts() {
    db.plan_costs = (db.plan_costs || []).filter((c) => !c.activity_id);
    for (const a of db.trip_activities || []) {
      const ids = (db.trip_activity_people || []).filter((x) => x.activity_id === a.id).map((x) => x.player_id);
      if (Number(a.cost_pp) > 0 && ids.length) db.plan_costs.push({ id: crypto.randomUUID(), plan_id: a.plan_id, group_id: GROUP, title: `🎯 ${a.title}`, amount: Number(a.cost_pp), per_head: true, split_between: ids, paid_by: a.created_by, created_by: a.created_by, note: 'Side activity', activity_id: a.id, created_at: now() });
    }
  }

  // Database functions the walkthrough's screens call (the rest answer null, as the table handler does).
  function rpc(name, b, acct) {
    const me = acct?.player_id || null;
    if (name === 'my_status') {
      if (!acct || !acct.member) return { is_member: false, signed_in: !!acct && !acct.anon, groups: [] };
      return { is_member: true, is_admin: acct.role === 'organiser', player_id: acct.player_id || null, group_name: groupName, group_id: GROUP, role: acct.role, legacy: false,
        signed_in: !acct.anon, look: null, groups: [{ id: GROUP, name: groupName, slug: 'lgc', role: acct.role, legacy: false }] };
    }
    if (name === 'invite_info') return { group_id: GROUP, group_name: groupName, role: 'player', already_in: !!acct?.member };
    if (name === 'used_link_info') return null;
    if (name === 'join_by_invite') { if (acct && !acct.member) Object.assign(acct, { member: true, role: 'player', player_id: null }); return GROUP; }
    if (name === 'claim_player') { if (acct) acct.player_id = b.p_player_id; return null; }
    if (name === 'group_invite' || name === 'share_join_code') return invite;
    if (name === 'new_groups_open') return true;
    if (name === 'vote_channels') return db.players.map((p) => ({ player_id: p.id, on_app: true, choice: 'app', has_email: false, source: 'own' }));
    if (name === 'trip_finder_courses') return library;
    if (name === 'trip_finder_places') return [];
    if (name === 'copy_library_course') {
      const l = library.find((x) => x.id === b.p_id);
      const had = db.courses.find((c) => c.library_id === b.p_id);
      if (had) return had.id;
      const c = { id: crypto.randomUUID(), group_id: GROUP, name: l?.name || 'Course', library_id: b.p_id, holes, created_at: now() };
      db.courses.push(c);
      return c.id;
    }
    // The run-up (094)
    if (name === 'runup_offer_car') {
      let car = db.plan_groups.find((g) => g.plan_id === b.p_plan && g.kind === 'car' && g.driver_id === me);
      if (!car) {
        car = { id: crypto.randomUUID(), plan_id: b.p_plan, group_id: GROUP, kind: 'car', name: `${nick(me)}’s car`, sort: 100, driver_id: me, created_at: now() };
        db.plan_groups.push(car);
        db.plan_group_members.push({ group_id: car.id, player_id: me });
      }
      Object.assign(car, { capacity: Number(b.p_seats) + 1, pickup_place: b.p_place, pickup_time: b.p_time });
      return car.id;
    }
    if (name === 'runup_join_car') {
      const p = b.p_player || me;
      db.plan_group_members = db.plan_group_members.filter((m) => !(m.player_id === p && db.plan_groups.some((g) => g.id === m.group_id && g.kind === 'car')));
      db.plan_group_members.push({ group_id: b.p_car, player_id: p });
      const row = (db.trip_runup_people || []).find((r) => r.player_id === p);
      if (row) row.needs_lift = false;
      return null;
    }
    if (name === 'runup_leave_car') { db.plan_group_members = db.plan_group_members.filter((m) => !(m.group_id === b.p_car && m.player_id === (b.p_player || me))); return null; }
    if (name === 'runup_claim_bring') { const it = db.plan_items.find((i) => i.id === b.p_item); if (it) it.owner_id = b.p_on ? me : null; return null; }
    // The Cup (050)
    if (name === 'team_invite') return b.p_side === db.cup_sides?.[0]?.id ? 'BLUETEAM2345' : 'REDTEAM23456';
    if (name === 'set_cup_hole') {
      const m = db.cup_matches.find((x) => x.id === b.p_match);
      if (b.p_result) m.holes[String(b.p_hole)] = b.p_result; else delete m.holes[String(b.p_hole)];
      m.updated_at = now();
      return m.holes;
    }
    // Awards and fines (093)
    if (name === 'award_for_trip') {
      const r = db.rules.find((x) => x.id === b.p_rule);
      let a = db.dinner_awards.find((x) => x.trip_id === b.p_trip && x.rule_id === b.p_rule);
      if (!a) {
        a = { id: crypto.randomUUID(), group_id: GROUP, trip_id: b.p_trip, rule_id: r.id, title: r.title, kind: r.award_kind, penalty: r.award_kind === 'fine' ? r.value : null, status: 'nominating', sort: 0, created_by: me, created_at: now() };
        db.dinner_awards.push(a);
      }
      return a.id;
    }
    return undefined;
  }

  S.handler = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const p = url.pathname;
    const sub = subOf(req);
    const acct = sub ? S.accounts.get(sub) : null;
    S.calls.push({ p, method, sub, body });
    const err = (status, code, msg) => json({ code: status, error_code: code, msg, message: msg }, status);
    const byEmail = (e) => [...S.accounts.values()].find((u) => u.email && u.email === String(e || '').toLowerCase());
    // ---- auth
    if (p === '/auth/v1/signup') {
      if (!body?.email) { const u = S.addAccount({ id: crypto.randomUUID(), anon: true, member: false }); return json(sessionFor(u)); }
      const had = byEmail(body.email);
      if (had) return json({ ...userObj(had), identities: [] });
      const u = S.addAccount({ id: crypto.randomUUID(), email: body.email.toLowerCase(), password: body.password, confirmed: false, member: false, role: null });
      return json(userObj(u));
    }
    if (p === '/auth/v1/verify') {
      const u = byEmail(body?.email);
      if (!u || body.token !== '123456') return err(403, 'otp_expired', 'Token has expired or is invalid');
      u.confirmed = true;
      return json(sessionFor(u));
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = byEmail(body?.email);
      if (u && u.password === body.password && !u.confirmed) return err(400, 'email_not_confirmed', 'Email not confirmed');
      if (u && u.password === body.password) return json(sessionFor(u));
      return err(400, 'invalid_credentials', 'Invalid login credentials');
    }
    if (p === '/auth/v1/user') return acct ? json(userObj(acct)) : err(401, 'bad_jwt', 'no user');
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    if (p.startsWith('/auth/v1/')) return json({});
    if (p.startsWith('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (p.startsWith('/storage/v1/')) return json({ Key: 'x' });
    if (p.startsWith('/functions/v1/notify')) { S.notifyCalls.push(body); return json({ sent: 6 }); }
    if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
    if (p.startsWith('/rest/v1/rpc/')) {
      const out = rpc(p.split('/').pop(), body || {}, acct);
      if (out !== undefined) return json(out);
    }
    // Who has which name (the name picker greys out names already taken).
    if (p === '/rest/v1/group_members' && method === 'GET') {
      return json([...S.accounts.values()].filter((a) => a.member && a.player_id).map((a) => ({ group_id: GROUP, player_id: a.player_id, role: a.role, user_id: a.id })));
    }
    // Reads: filtered, ordered and limited like PostgREST (the base handler ignores order and limit).
    if (p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/') && method === 'GET') {
      serverRules();
      const table = p.split('/')[3];
      const out = readRows(db[table] || [], url.searchParams);
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(out[0] ?? null);
      return json(out);
    }
    S.current = acct;
    serverRules();
    const table = p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/') ? p.split('/')[3] : null;
    const before = table && method === 'POST' ? (db[table] || []).length : 0;
    await base.handler(route);
    // The real database fills created_by with the signed-in player (default my_player_id()).
    if (table && method === 'POST') for (const r of (db[table] || []).slice(before)) if (r.created_by == null && acct?.player_id && !['players', 'plan_rsvps', 'plan_votes'].includes(table)) r.created_by = acct.player_id;
    serverRules();
    if (/trip_activit/.test(p) && method !== 'GET') syncActivityCosts();
    return undefined;
  };
  return S;
}

/**
 * A browser for one person. acct: an account from S.addAccount (null = a fresh phone that's never signed in).
 * fresh: this phone has never opened the app (the hello, what's new and the notifications prompt can show).
 */
export async function personBrowser(browser, S, acct, { width = 375, height = 812, fresh = false } = {}) {
  const mobile = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
    timezoneId: 'Australia/Sydney', locale: 'en-AU',
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' : undefined });
  // Nothing beyond this computer: the app's own files from localhost, the fake database, and empty answers otherwise.
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return r.continue();
    if (u.hostname.endsWith('.supabase.co')) return S.handler(r);
    return r.fulfill({ status: 204, body: '' });
  });
  await ctx.routeWebSocket(/.*/, () => { /* realtime: answered by nobody */ });
  await ctx.addInitScript(([cfg]) => {
    if (sessionStorage.getItem('wt-seeded')) return;
    sessionStorage.setItem('wt-seeded', '1');
    if (!cfg.fresh) {
      localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    }
    if (cfg.sess && !localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', cfg.sess);
  }, [{ fresh, sess: acct ? JSON.stringify(sessionFor(acct)) : null }]);
  // A phone that hasn't said yes or no to notifications yet (nothing is really subscribed).
  await ctx.addInitScript(() => {
    // The build points at a made-up database, so it wears a red "TEST" tag; hide it so it isn't in the pictures.
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#test-marker{display:none!important}'; document.head.append(s); });
    class FakeNotification { static get permission() { return 'default'; } static async requestPermission() { return 'default'; } }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
    if (!('PushManager' in window)) window.PushManager = function PushManager() {};
    const reg = { pushManager: { getSubscription: async () => null, subscribe: async () => null }, scope: '/' };
    const sw = { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg), controller: null, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true });
  });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
