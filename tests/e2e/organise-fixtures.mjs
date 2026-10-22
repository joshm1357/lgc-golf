// Shared fake database for the Organise tidy-up (ov14, 22 Oct 2026): three trip shapes, and a fake Supabase that
// answers every request from these rows (writes change them). Nothing real is touched.
//   A  "March"        brand new: a place only, nothing done
//   B  "Spring away"  the staging demo shape: regions, weekends, places to stay, extras, a combined vote open
//   C  "Autumn Trip"  locked in: the usual jobs (some done), costs in the kitty, a deposit being collected
import crypto from 'node:crypto';

export const GROUP = 'a0a0a0a0-0000-4000-8000-0000000000e4';
export const PA = 'eeeeeeee-0000-4000-8000-0000000000a1';
export const PB = 'eeeeeeee-0000-4000-8000-0000000000b1';
export const PC = 'eeeeeeee-0000-4000-8000-0000000000c1';
const now = new Date().toISOString();
export const pid = (i) => `${String(i + 1).padStart(8, '0')}-3333-4333-8333-333333333333`;
export const K = pid(0); // Josh, the organiser
export const AL = pid(1); // Al, a player
const NAMES = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const fri = (() => { const d = new Date(); d.setDate(d.getDate() + 28); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d; })();
const addTo = (d, n) => iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
export const W1 = { start: iso(fri), end: addTo(fri, 2), long: false };
export const W2 = { start: addTo(fri, 7), end: addTo(fri, 9), long: false };
const C_START = plusDays(60);
const C_END = (() => { const d = new Date(); d.setDate(d.getDate() + 62); return iso(d); })();

export function makeDb() {
  const players = NAMES.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
  const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const courses = {
    [L(1)]: { id: L(1), name: 'Stonebridge Golf Club', area: 'Cessnock NSW', lat: -32.824, lng: 151.339 },
    [L(2)]: { id: L(2), name: 'Cypress Lakes Golf & Country Club', area: 'Pokolbin NSW', lat: -32.783, lng: 151.291 },
    [L(11)]: { id: L(11), name: 'Shoalhaven Heads Golf Course', area: 'Shoalhaven Heads NSW', lat: -34.845, lng: 150.748 },
    [L(14)]: { id: L(14), name: 'Kiama Golf Club', area: 'Kiama NSW', lat: -34.627, lng: 150.852 },
  };
  const pin = (name, lat, lng) => ({ key: name, name, lat, lng });
  const stateB = {
    v: 1, region: null, regionOptions: ['Hunter Valley', 'South Coast NSW'], origin: null, nights: 2,
    weekends: [W1, W2], weekendsSettled: true, stays: [], pins: [], stayMax: 40, detourMax: 25,
    days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [] }, { index: 2, leg: 'home', options: [] }],
    courses, headcount: 8, votes: {}, optionKeys: {}, callsMade: false, configs: [], picked: null,
    areaCourses: { 'Hunter Valley': [L(1), L(2)], 'South Coast NSW': [L(11), L(14)] },
    areaStays: { 'Hunter Valley': [pin('Pokolbin', -32.78, 151.29)], 'South Coast NSW': [pin('Kiama', -34.67, 150.85)] },
    extras: [{ key: 'trophy', label: 'Trophy', pp: 15, kind: 'trophy', state: 'in' }, { key: 'shirts', label: 'Shirts or caps', pp: 45, kind: 'shirts', state: 'vote' }],
  };
  const BATCH = crypto.randomUUID();
  const pollWhere = { id: crypto.randomUUID(), plan_id: PB, group_id: GROUP, kind: 'location', question: 'Where should we go?', status: 'open', closes_on: plusDays(5), vote_batch: BATCH, created_by: K, created_at: now };
  const pollWhen = { id: crypto.randomUUID(), plan_id: PB, group_id: GROUP, kind: 'dates', question: 'Which weekend?', status: 'open', closes_on: plusDays(5), vote_batch: BATCH, created_by: K, created_at: now };
  const opt = (poll, label, extra = {}) => ({ id: crypto.randomUUID(), poll_id: poll.id, group_id: GROUP, label, created_by: K, created_at: now, ...extra });
  const oHunter = opt(pollWhere, 'Hunter Valley', { address: 'Stonebridge + Cypress Lakes' });
  const oSouth = opt(pollWhere, 'South Coast NSW', { address: 'Shoalhaven Heads + Kiama' });
  const oW1 = opt(pollWhen, `${W1.start}`, { start_date: W1.start, end_date: W1.end });
  const oW2 = opt(pollWhen, `${W2.start}`, { start_date: W2.start, end_date: W2.end });
  const vote = (o, i, value = 'yes') => ({ id: crypto.randomUUID(), poll_id: o.poll_id, option_id: o.id, player_id: pid(i), group_id: GROUP, response: value, updated_at: now, created_at: now });
  const stay = (name, area, link, total) => ({ id: crypto.randomUUID(), group_id: GROUP, plan_id: PB, name, area, link, total_cost: total, sleeps: 8, is_list: false, option_id: null, chosen: false, created_by: K, created_at: now });
  const job = (key, title, extra = {}) => ({ id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, kind: 'job', title, formula_key: key, owner_id: K, stage: 'todo', done: false, created_by: K, created_at: now, ...extra });
  const shortlist = job('shortlist_stay', 'Shortlist accommodation', { stage: 'done', done: true, due: plusDays(4), sort: 100 });
  const reserve = job('reserve_stay', 'Reserve accommodation', { stage: 'done', done: true, amount: 2400, due: plusDays(11), after_item: shortlist.id, sort: 101 });
  const ask = job('deposit_ask', 'Ask everyone to confirm and pay the deposit', { stage: 'done', done: true, due: plusDays(12), after_item: reserve.id, sort: 102 });
  return {
    players, trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [], honour_board: [],
    courses: [], rounds: [], comps: [], rules: [], posts: [], tribunal_cases: [], tribunal_votes: [], notify_prefs: [], player_home_areas: [],
    plans: [
      { id: PA, kind: 'trip', name: 'March', status: 'planning', start_date: null, end_date: null, location_name: 'Hunter Valley', proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now },
      { id: PB, kind: 'trip', name: 'Spring away', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, budget_pp: 900, created_at: now },
      { id: PC, kind: 'trip', name: 'Autumn Trip', status: 'confirmed', start_date: C_START, end_date: C_END, location_name: 'Nowra', proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, deposit_pp: 300, deposit_asked_at: now, kitty_note: 'PayID 0400 000 000 — Josh', created_at: now },
    ],
    plan_polls: [pollWhere, pollWhen],
    plan_options: [oHunter, oSouth, oW1, oW2],
    plan_votes: [vote(oHunter, 0), vote(oHunter, 1), vote(oSouth, 2, 'maybe'), vote(oW1, 0), vote(oW2, 1, 'no'), vote(oHunter, 3), vote(oW1, 3)],
    vote_batches: [{ id: BATCH, plan_id: PB, group_id: GROUP, title: 'Where and when?', closes_on: plusDays(5), keen: true, created_by: K, created_at: now }],
    plan_comments: [{ id: crypto.randomUUID(), plan_id: PB, group_id: GROUP, player_id: AL, body: 'Hunter for mine — wineries!', created_at: now }],
    plan_items: [
      shortlist, reserve, ask,
      job('chase_deposits', 'Chase deposits', { due: plusDays(7), after_item: ask.id, sort: 103 }),
      job('pay_balance', 'Pay the balance / final numbers', { due: plusDays(46), after_item: reserve.id, sort: 105 }),
      job('transport', 'Transport / who’s driving', { owner_id: null, due: plusDays(46), sort: 106 }),
      job('teams_draw', 'Teams, draw and side comps', { due: plusDays(59), sort: 107 }),
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, kind: 'job', title: '📞 Call Nowra Golf Club for tee times', owner_id: AL, stage: 'asked', done: false, created_by: K, created_at: now },
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, kind: 'bring', title: 'Clubs', sort: 0, created_by: K, created_at: now },
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, kind: 'bring', title: 'Esky', sort: 1, created_by: K, created_at: now },
    ],
    plan_costs: [
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, title: 'Accommodation', amount: 2400, per_head: false, paid_by: K, split_between: null, created_at: now },
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, title: 'Green fees', amount: 95, per_head: true, paid_by: null, split_between: null, created_at: now },
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, title: 'Trophy engraving', amount: 60, per_head: false, paid_by: AL, split_between: null, created_at: now },
    ],
    plan_payments: [],
    plan_transfers: [
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, from_id: pid(2), to_id: null, amount: 300, confirmed: true, note: 'Deposit', created_at: now },
      { id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, from_id: pid(3), to_id: null, amount: 300, confirmed: false, note: 'Deposit', created_at: now },
    ],
    plan_rsvps: [
      ...[0, 1, 2, 3].map((i) => ({ plan_id: PB, player_id: pid(i), status: i === 2 ? 'maybe' : 'in', updated_at: now })),
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ plan_id: PC, player_id: pid(i), status: i === 5 ? 'maybe' : 'in', updated_at: now })),
    ],
    plan_groups: [], plan_group_members: [], plan_budget_items: [],
    groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
    trip_builds: [{ plan_id: PB, group_id: GROUP, state: stateB }],
    plan_stays: [stay('Vineyard house, Pokolbin', 'Hunter Valley', 'https://www.stayz.com.au/holiday-rental/p1', 3200), stay('Beach house, Kiama', 'South Coast NSW', 'https://www.stayz.com.au/holiday-rental/p2', 2900)],
    trip_finds: [], course_notes: [], course_ratings: [], stay_areas: [], trip_tee_options: [], course_booking_info: [], course_social_times: [],
    trip_start_points: [],
    group_features: ['feed', 'planner', 'planner_tasks', 'planner_costs', 'planner_rooms', 'trip_finder', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
}

/** A fake Supabase over `db`. who() → the signed-in player; returns the route handler plus call logs. */
export function fakeSupabase(db, who = () => ({ id: K, admin: true })) {
  const rpcCalls = []; const notifyCalls = [];
  const match = (r, k, v) => {
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
    if (v === 'is.null') return r[k] == null;
    if (v === 'not.is.null') return r[k] != null;
    return true;
  };
  const filterRows = (rows, params) => rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (!match(r, k, v)) return false;
    }
    return true;
  });
  const rpc = (name, body) => {
    rpcCalls.push({ name, body });
    const me = who();
    if (name === 'my_status') return { is_member: true, is_admin: me.admin, player_id: me.id, group_name: 'Test Golfers', group_id: GROUP, role: me.admin ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: me.admin ? 'organiser' : 'player' }] };
    if (name === 'decide_poll') {
      const poll = db.plan_polls.find((p) => p.id === body.p_poll);
      const o = db.plan_options.find((x) => x.id === body.p_option);
      if (poll) { poll.status = 'closed'; poll.winner_option_id = body.p_option; }
      const plan = db.plans.find((p) => p.id === poll?.plan_id);
      if (plan && o && body.p_apply) {
        if (poll.kind === 'dates') { plan.start_date = o.start_date; plan.end_date = o.end_date; }
        if (poll.kind === 'location') plan.location_name = o.label;
      }
      return null;
    }
    if (name === 'vote_channels') return db.players.map((p) => ({ player_id: p.id, on_app: true, choice: 'app', has_email: false, source: 'own' }));
    if (name === 'group_invite') return 'ABCDEFGH2345';
    if (name === 'trip_finder_courses') return [];
    return null;
  };
  const handler = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    const p = url.pathname;
    if (p.startsWith('/rest/v1/rpc/')) return json(rpc(p.split('/').pop(), JSON.parse(req.postData() || '{}')));
    if (p.startsWith('/functions/v1/notify')) { notifyCalls.push(JSON.parse(req.postData() || '{}')); return json({ sent: 3 }); }
    if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/')[3];
      const rows = (db[table] ||= []);
      if (method === 'GET') {
        const out = filterRows(rows, url.searchParams);
        if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out[0] ? json(out[0]) : json(null);
        return json(out);
      }
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        const conflict = url.searchParams.get('on_conflict') || (table === 'plan_rsvps' ? 'plan_id,player_id' : table === 'plan_votes' ? 'option_id,player_id' : table === 'trip_builds' ? 'plan_id' : null);
        const made = [];
        for (const b of Array.isArray(body) ? body : [body]) {
          const keys = conflict ? conflict.split(',') : null;
          const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
          if (old) { Object.assign(old, b, { updated_at: new Date().toISOString() }); made.push(old); continue; }
          const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b };
          if (table === 'plan_polls') { row.status ??= 'open'; row.created_by ??= who().id; }
          if (table === 'plan_options') row.created_by ??= who().id;
          if (table === 'plan_items') { row.stage = row.stage || (row.done ? 'done' : 'todo'); row.done = row.stage === 'done'; row.created_by ??= who().id; }
          rows.push(row);
          made.push(row);
        }
        if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
        return json(url.searchParams.has('select') ? made : [], 201);
      }
      if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}');
        const hit = filterRows(rows, url.searchParams);
        for (const r of hit) { Object.assign(r, body); if (table === 'plan_items' && 'stage' in body) r.done = r.stage === 'done'; }
        return json(url.searchParams.has('select') ? hit : [], 200);
      }
      if (method === 'DELETE') {
        const gone = new Set(filterRows(rows, url.searchParams));
        db[table] = rows.filter((r) => !gone.has(r));
        return json([], 200);
      }
    }
    return json({});
  };
  return { handler, rpcCalls, notifyCalls };
}

/** Signed-in browser context (fake session), routed to the fake database. */
export async function fakeContext(browser, fake, { width = 375, height = 812, mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route('https://*.supabase.co/**', fake.handler);
  await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.addInitScript(([uid]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  }, ['99999999-9999-4999-8999-999999999999']);
  return ctx;
}
