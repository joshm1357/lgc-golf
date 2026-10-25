// ov39 browser check (25 Oct 2026): trip ideas you can share. Fake database (the 108 functions are mimicked here; the
// real rules are tested in supabase/tests/108_trip_ideas.sql).
//   1. Josh puts out a trip idea and sets what he knows (an area Set, the length open).
//   2. 📣 Share it: a Feed post + buzz, a picture and a link for the group chat.
//   3. Al opens the link: the quick summary, "Help plan — 4 quick taps", a suggestion outside what's set (→ the queue),
//      a weekend, 👍, a comment. Bo adds a course and reacts.
//   4. The Caddie (faked function): quick idea cards, one flying (flight time, first/last flights, a search link, no
//      fare); one tap adds it to the lists, marked ✨.
//   5. Josh: the queue ("1 suggestion to look at" → add), tidy → 🗳️ send to the vote → the v10.6 vote opens with the
//      ticked weekends and areas and the fit lines.
//   6. Leftovers: the Caddie groups them → park one (Al gets first refusal); "Or start another trip idea now".
//   7. The parked idea: Bo sees it's Al's for now; Al claims it.
// Usage: node tests/e2e/trip-ideas-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4371/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ov39';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000039f';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-3939-4939-8939-393939393939`;
const names = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus', 'Hal'];
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
const JOSH = pid(0); const AL = pid(1); const BO = pid(2);
const stayAreas = [
  ['Pokolbin', 'Hunter Valley', -32.78, 151.29], ['Cessnock', 'Hunter Valley', -32.83, 151.36],
  ['Kiama', 'South Coast NSW', -34.67, 150.85], ['Port Macquarie', 'Mid North Coast', -31.43, 152.91],
].map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i }));
const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const library = [
  { id: L(1), name: 'The Vintage', area: 'Rothbury NSW', lat: -32.73, lng: 151.33, holes: 18, facts: [] },
  { id: L(2), name: 'Cypress Lakes', area: 'Pokolbin NSW', lat: -32.76, lng: 151.29, holes: 18, facts: [] },
];

const db = {
  players, trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [],
  honour_board: [], courses: [], rounds: [], plans: [], plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_items: [],
  plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [], plan_rsvps: [], plan_groups: [], plan_group_members: [],
  groups: [{ id: GROUP, vote_decider: 'admin' }], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  player_home_areas: [{ id: crypto.randomUUID(), group_id: GROUP, player_id: JOSH, label: 'Leichhardt', lat: -33.88, lng: 151.16, share: true }],
  trip_start_points: [], trip_finds: [], course_notes: [], course_ratings: [], stay_areas: stayAreas, trip_builds: [], trip_tee_options: [],
  course_booking_info: [], vote_batches: [], plan_coorganisers: [],
  plan_idea_items: [], plan_idea_reactions: [], plan_wishes: [],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder', 'ai_helper', 'notifications'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let who = JOSH;
const rpcCalls = [];
const notifyCalls = [];
const aiCalls = [];
const isSet = (f, k) => Array.isArray(f?.set) && f.set.includes(k);
const planOf = (id) => db.plans.find((p) => p.id === id);
const leftoversOf = (planId, ids) => db.plan_idea_items.filter((i) => i.plan_id === planId && !i.picked && ['in', 'declined'].includes(i.status) && !i.leftover && (!ids || ids.includes(i.id)));
const copyItems = (to, items) => { for (const i of items) db.plan_idea_items.push({ ...i, id: crypto.randomUUID(), plan_id: to, picked: false, status: 'in', leftover: null }); };
const newPlan = (o) => { const p = { id: crypto.randomUUID(), group_id: GROUP, kind: 'trip', status: 'planning', proposed: false, rsvp_locked: false, created_at: new Date().toISOString(), idea: true, idea_fixed: {}, ...o }; db.plans.push(p); return p; };

function rpc(name, body) {
  rpcCalls.push({ name, body });
  const admin = who === JOSH;
  if (name === 'my_status') return { is_member: true, signed_in: true, is_admin: admin, player_id: who, group_name: 'Inner West Hackers', group_id: GROUP, role: admin ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Inner West Hackers', slug: 'iwh', role: admin ? 'organiser' : 'player' }] };
  if (name === 'trip_finder_courses') return library;
  if (name === 'trip_finder_places') return [];
  if (name === 'idea_wish_answers') return db.plan_wishes.filter((w) => w.plan_id === body.p_plan).map(({ player_id, ...w }) => w); // eslint-disable-line no-unused-vars
  if (name === 'share_idea') {
    const p = planOf(body.p_plan);
    p.share_token ||= 'tok_' + crypto.randomBytes(12).toString('hex').slice(0, 20);
    p.shared_at ||= new Date().toISOString();
    if (body.p_card_url) p.card_url = body.p_card_url;
    return p.share_token;
  }
  if (name === 'idea_set_fixed') { planOf(body.p_plan).idea_fixed = body.p_fixed; return body.p_fixed; }
  if (name === 'idea_review') {
    const i = db.plan_idea_items.find((x) => x.id === body.p_item);
    i.status = body.p_accept ? 'in' : 'declined'; i.decline_note = body.p_note || null;
    return i.status;
  }
  if (name === 'idea_tidy') {
    for (const i of db.plan_idea_items.filter((x) => x.plan_id === body.p_plan)) i.picked = i.status === 'in' && body.p_picked.includes(i.id);
    if (body.p_send) planOf(body.p_plan).idea_sent_at = new Date().toISOString();
    return db.plan_idea_items.filter((x) => x.plan_id === body.p_plan && x.picked).length;
  }
  if (name === 'idea_park') {
    const src = planOf(body.p_plan);
    const items = leftoversOf(src.id, body.p_items);
    const main = [...items].sort((a, b) => ({ area: 0, date: 1, course: 2 }[a.kind] - { area: 0, date: 1, course: 2 }[b.kind]))[0];
    const p = newPlan({ name: body.p_name, idea_pool: true, shared_at: new Date().toISOString(), created_by: who, organiser_id: who, idea_from: src.id, brief: body.p_why, claim_owner: main?.added_by || null, claim_until: new Date(Date.now() + 48 * 3600e3).toISOString() });
    copyItems(p.id, items);
    for (const i of items) i.leftover = 'parked';
    return p.id;
  }
  if (name === 'idea_spin_off') {
    const src = planOf(body.p_plan);
    const items = leftoversOf(src.id, body.p_items);
    const p = newPlan({ name: `${src.name} — another idea`, created_by: who, organiser_id: who, idea_from: src.id });
    copyItems(p.id, items);
    for (const i of items) i.leftover = 'spun_off';
    return p.id;
  }
  if (name === 'idea_claim') {
    const p = planOf(body.p_plan);
    if (p.claim_owner && p.claim_owner !== who && new Date(p.claim_until) > new Date()) return { __error: 'It’s someone else’s for now' };
    Object.assign(p, { idea_pool: false, idea_organiser: who, claimed_at: new Date().toISOString(), shared_at: null });
    return p.id;
  }
  if (name === 'hand_over_idea') { planOf(body.p_plan).idea_organiser = body.p_player; return body.p_player; }
  return null;
}
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v === 'is.null' ? r[k] == null : true;
  if (v.startsWith('not.is.null')) return r[k] != null;
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
const outside = (row) => {
  const p = planOf(row.plan_id);
  const f = p?.idea_fixed || {};
  if (!p || who === JOSH) return false;
  if (row.kind === 'date') return isSet(f, 'weekend');
  if (row.kind === 'area') return isSet(f, 'area') && f.area && f.area.toLowerCase() !== String(row.label).toLowerCase();
  return false;
};
const CARDS = {
  message: 'March is warm up north and mild in the Hunter — three that suit most of you.',
  ideas: [
    { area: 'Port Douglas', why: 'Two great courses 10 min apart, and the reef', travel: 'fly', fly: { from: 'SYD', to: 'CNS', flight_min: 190, first_out: '6am', last_back: '9pm' }, cost_each: null, courses: ['Sea Temple', 'Palmer Sea Reef'], stay: 'Port Douglas town', weekend: null, fit: null },
    { area: 'Hunter Valley', why: 'Close, and you loved The Vintage', travel: 'drive', drive_min: 150, cost_each: 650, courses: ['The Vintage'], stay: 'Pokolbin', weekend: null, fit: null },
  ],
};
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) {
    const r = rpc(p.split('/').pop(), JSON.parse(req.postData() || '{}'));
    if (r && r.__error) return json({ message: r.__error, code: 'P0001' }, 400);
    return json(r);
  }
  if (p.startsWith('/storage/v1/object/')) return json({ Key: p.replace('/storage/v1/object/', ''), Id: crypto.randomUUID() });
  if (p.startsWith('/functions/v1/notify')) { notifyCalls.push(JSON.parse(req.postData() || '{}')); return json({ sent: 3 }); }
  if (p.startsWith('/functions/v1/ai-helper')) {
    const b = JSON.parse(req.postData() || '{}');
    aiCalls.push(b);
    if (b.mode === 'idea_chat' && b.source === 'leftovers') {
      const ids = (b.leftovers || []).map((x) => x.id);
      const areas = (b.leftovers || []).filter((x) => x.kind === 'area');
      return json({ idea_chat: { message: 'One for later.', ideas: [], groups: [{ name: `Fly north — ${areas[0]?.label || 'somewhere'}`, why: 'Al keeps saying it', items: areas.length ? [areas[0].id] : ids.slice(0, 1) }] }, remaining: { month: 50, today: 9 } });
    }
    if (b.mode === 'idea_chat') return json({ idea_chat: CARDS, model: 'fast', remaining: { month: 50, today: 9 }, ms: 1800 });
    return json({ error: 'not faked' });
  }
  if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict') || (table === 'plan_rsvps' ? 'plan_id,player_id' : table === 'plan_votes' ? 'option_id,player_id' : null);
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b, { updated_at: new Date().toISOString() }); made.push(old); continue; }
        if (table === 'plan_idea_items' && rows.some((r) => r.plan_id === b.plan_id && r.kind === b.kind && r.label.toLowerCase() === String(b.label).trim().toLowerCase())) {
          return json({ message: 'duplicate key value violates unique constraint "plan_idea_items_once"', code: '23505' }, 409);
        }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        if (table === 'plans') { row.created_by ??= who; row.organiser_id ??= who; row.idea_fixed ??= {}; }
        if (table === 'plan_idea_items') { row.added_by ??= who; row.picked ??= false; row.by_ai ??= false; row.detail ??= {}; row.status = outside(row) ? 'queued' : 'in'; }
        if (table === 'plan_comments') row.player_id ??= who;
        if (table === 'plan_polls') { row.status ??= 'open'; row.created_by ??= who; }
        if (table === 'vote_batches') row.created_by ??= who;
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
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

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999939']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '' : undefined));
const wait = (ms = 500) => page.waitForTimeout(ms);
const shot = async (name) => {
  for (const [w, h] of [[375, 812], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await wait(400);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 812 }); await wait(200);
};
const as = async (id, hash) => { who = id; await page.goto(`${BASE}${hash}`); await page.reload(); await wait(900); };
const fri = (weeks) => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7) + 7 * weeks); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ================================================================ 1. propose
await as(JOSH, '#/plan');
await page.getByTestId('propose-idea').first().click();
await page.getByTestId('idea-sheet').waitFor({ timeout: 10000 });
await page.getByLabel('Name it').fill('March away');
await page.getByLabel('Roughly when').fill('March');
await page.getByLabel('Where', { exact: true }).fill('somewhere within 3 h, or we fly');
await page.getByRole('button', { name: 'Either' }).click();
await shot('01-propose');
await page.getByTestId('idea-save').click();
await page.getByTestId('trip-idea').waitFor({ timeout: 10000 }); await wait(800);
const idea = db.plans.find((p) => p.name === 'March away');
check(idea && idea.idea === true && idea.kind === 'trip' && idea.status === 'planning' && idea.idea_travel === 'either' && idea.idea_when === 'March', 'the idea is a plan in the planning engine (idea, planning, rough when, either)');
check(/#\/idea\//.test(page.url()) && await page.getByTestId('organiser-panel').isVisible(), 'Josh lands on the idea with the organising tools');
// What's set: the area Set, the length open.
await page.getByTestId('edit-def').click();
await page.getByLabel('Where', { exact: true }).last().fill('Hunter Valley');
await page.getByTestId('set-area').click();
await page.getByLabel('How long').selectOption('2');
await page.getByTestId('def-save').click(); await wait(800);
check(idea.idea_fixed?.area === 'Hunter Valley' && idea.idea_fixed.nights === 2 && JSON.stringify(idea.idea_fixed.set) === '["area"]', `what's set is saved (${JSON.stringify(idea.idea_fixed)})`);
const defs = await page.getByTestId('def-line').allInnerTexts();
check(defs.some((t) => /Hunter Valley/.test(t) && /Set/.test(t)) && defs.some((t) => /3 days/.test(t) && /Open to ideas/.test(t)), `the top shows Set / Open to ideas (${defs.join(' | ').replace(/\n/g, ' ')})`);
await page.getByTestId('suggest-box').last().locator('input').fill('Kiama');
await page.getByTestId('suggest-add').last().click(); await wait(600);
await page.getByTestId('suggest-box').last().getByRole('button', { name: '📅 A weekend' }).click();
await page.getByTestId('suggest-box').last().locator('select').selectOption(fri(10));
await page.getByTestId('suggest-add').last().click(); await wait(600);
check(db.plan_idea_items.filter((i) => i.plan_id === idea.id && i.status === 'in').length === 2, 'Josh adds an area and a weekend (straight in — he organises it)');

// ================================================================ 2. share it
await page.getByTestId('share-it').click();
await page.getByTestId('share-out').waitFor({ timeout: 15000 }); await wait(500);
check(rpcCalls.some((c) => c.name === 'share_idea' && /\/storage\/v1\/object\/public\/photos\//.test(c.body.p_card_url || '')), 'share_idea is called with the preview picture uploaded');
const post = db.posts.find((x) => x.link === `/idea/${idea.id}`);
check(post && /^💡 Josh has a trip idea: March, Hunter Valley\. Add your ideas/.test(post.body), `a Feed post (${post?.body})`);
check(notifyCalls.some((n) => n.type === 'idea_shared' && n.plan_id === idea.id), 'and a buzz to the group (idea_shared)');
const msg = await page.getByTestId('share-message').innerText();
check(/March away/.test(msg) && /4 quick taps/.test(msg) && /#\/(join\/[A-Z0-9]+\?to=%2Fidea%2F|idea\/)/.test(msg), `the chat message has the link (${msg})`);
check(await page.getByTestId('share-card').isVisible(), 'the share picture shows');
await shot('02-share-it');
await page.keyboard.press('Escape'); await wait(300);

// ================================================================ 3. Al opens the link: the quick summary
await as(AL, `#/idea/${idea.id}`);
await page.getByTestId('wish-taps').waitFor({ timeout: 10000 });
check((await page.getByTestId('trip-idea').getAttribute('data-view')) === 'summary', 'Al lands on the quick summary, not the organising screen');
check(await page.getByTestId('organiser-panel').count() === 0, 'no organising tools for Al');
await shot('03-summary-al');
const josWeekend0 = db.plan_idea_items.find((i) => i.plan_id === idea.id && i.kind === 'date' && i.added_by === JOSH);
await page.getByTestId('cant-calendar').getByLabel(`Can't do ${josWeekend0.label}`).click(); await wait(400);
await page.getByRole('group', { name: 'Spend each' }).getByRole('button', { name: '$500–800' }).click(); await wait(300);
await page.getByRole('group', { name: 'Getting there' }).getByRole('button', { name: 'Happy to fly' }).click(); await wait(300);
await page.getByRole('group', { name: 'How much golf' }).getByRole('button', { name: 'A round a day' }).click(); await wait(300);
await page.getByRole('group', { name: 'Friday timing' }).getByRole('button', { name: 'Late' }).click(); await wait(300);
await page.getByRole('group', { name: 'Sunday timing' }).getByRole('button', { name: 'Early' }).click(); await wait(300);
await page.getByLabel('One wish').fill('Barnbougle one day'); await page.getByLabel('One wish').blur(); await wait(600);
const alw = db.plan_wishes.find((w) => w.plan_id === idea.id && w.player_id === AL);
check(alw && alw.cant_dates.length === 1 && alw.spend_band === '500_800' && alw.travel === 'fly' && alw.golf_per_day === 'daily' && alw.day_prefs.fri === 'late' && alw.day_prefs.sun === 'early' && alw.wish === 'Barnbougle one day',
  `Al's 4 quick taps are saved as one row (${JSON.stringify(alw && { ...alw, id: undefined })})`);
// A suggestion outside what's set → the organiser's queue.
await page.getByTestId('suggest-box').locator('input').fill('Port Macquarie');
check(/goes to the organiser/.test(await page.getByTestId('suggest-box').innerText()), 'Al is told it goes to the organiser (the area is set)');
await page.getByTestId('suggest-add').click(); await wait(600);
check(db.plan_idea_items.find((i) => i.label === 'Port Macquarie')?.status === 'queued', 'Port Macquarie is queued for Josh');
await page.getByTestId('suggest-box').getByRole('button', { name: '📅 A weekend' }).click();
await page.getByTestId('suggest-box').locator('select').selectOption(fri(11));
await page.getByTestId('suggest-add').click(); await wait(600);
await page.getByLabel('Comment').fill('Keen — not the 12th though');
await page.getByTestId('comment-send').click(); await wait(600);
check(db.plan_comments.some((c) => c.plan_id === idea.id && c.player_id === AL), 'Al comments');
await page.getByTestId('see-all').click(); await wait(600);
const josWeekend = db.plan_idea_items.find((i) => i.plan_id === idea.id && i.kind === 'date' && i.added_by === JOSH);
await page.getByRole('button', { name: `Thumbs up ${josWeekend.label}` }).click(); await wait(500);
check(db.plan_idea_reactions.some((r) => r.item_id === josWeekend.id && r.player_id === AL && r.value === 1), 'Al 👍 Josh’s weekend');
check(/from Josh/.test(await page.locator(`[data-testid="idea-item"][data-label="${josWeekend.label}"]`).innerText()), 'he sees who added what');

// ================================================================ 4. the Caddie's quick ideas (Al)
await page.getByTestId('caddie-ideas').click();
await page.getByTestId('caddie-card').first().waitFor({ timeout: 10000 });
const ask = aiCalls.find((b) => b.mode === 'idea_chat' && !b.source);
check(ask && ask.plan_id === idea.id && ask.context?.wishes?.answered === 1 && ask.context?.idea?.fixed?.area === 'Hunter Valley', 'the Caddie is asked with the group’s answers and what’s set up front');
const pd = await page.getByTestId('caddie-card').first().innerText();
check(/Port Douglas/.test(pd) && /SYD–CNS · about 3 h flight · first flights about 6am, last back about 9pm/.test(pd) && !/\$/.test(pd), `the flying card: flight time and first/last flights, no fare (${pd.replace(/\n/g, ' | ')})`);
check(/suits 1 of 1/.test(pd), 'its fit line is counts from the real answers ("suits 1 of 1")');
const fs1 = await page.getByTestId('flight-search').first().getAttribute('href');
check(/^https:\/\/www\.google\.com\/travel\/flights\?q=Flights%20from%20SYD%20to%20CNS/.test(fs1 || ''), 'with a pre-filled flight search link');
await shot('04-caddie-ideas');
await page.getByTestId('caddie-add').nth(1).click(); await wait(800);
const ai = db.plan_idea_items.filter((i) => i.plan_id === idea.id && i.by_ai);
check(ai.some((i) => i.kind === 'course' && i.label === 'The Vintage'), `one tap adds the Hunter card to the lists, marked ✨ (${ai.map((i) => i.label).join(', ')})`);
check(/✨/.test(await page.getByTestId('list-course').innerText()), 'the Caddie’s ones show ✨ in the lists');

// Bo adds a course and reacts.
await as(BO, `#/idea/${idea.id}?view=board`);
await page.getByTestId('idea-lists').waitFor({ timeout: 10000 });
await page.getByTestId('suggest-box').last().getByRole('button', { name: '⛳ A course' }).click();
await page.getByTestId('suggest-box').last().locator('input').fill('Cypress Lakes');
await page.getByTestId('suggest-add').last().click(); await wait(600);
await page.getByRole('button', { name: `Thumbs down ${josWeekend.label}` }).click(); await wait(500);
check(db.plan_idea_items.some((i) => i.label === 'Cypress Lakes' && i.added_by === BO) && db.plan_idea_reactions.some((r) => r.player_id === BO && r.value === -1), 'Bo adds a course and 👎 a weekend');
const t = await page.locator(`[data-testid="idea-item"][data-label="${josWeekend.label}"]`).innerText();
check(/👍 1/.test(t) && /👎 1/.test(t), `the weekend shows 👍 1 👎 1 (${t.replace(/\n/g, ' ')})`);
await shot('05-lists-bo');

// ================================================================ 5. Josh: the queue, tidy → vote
await as(JOSH, `#/idea/${idea.id}`);
await page.getByTestId('queue').waitFor({ timeout: 10000 });
check((await page.getByTestId('queue-count').innerText()) === '1 suggestion to look at', 'Josh sees "1 suggestion to look at"');
const alWeekend = db.plan_idea_items.find((i) => i.plan_id === idea.id && i.kind === 'date' && i.added_by === AL);
const jw = await page.locator(`[data-testid="idea-item"][data-label="${josWeekend.label}"]`).innerText();
check(/Can’t: Al/.test(jw) && /suits 0 of 1/.test(jw), `the organiser sees names with the fit line (${jw.replace(/\n/g, ' ')})`);
await shot('06-organiser-queue');
await page.getByTestId('queue-accept').click(); await wait(600);
check(db.plan_idea_items.find((i) => i.label === 'Port Macquarie')?.status === 'in', 'Josh adds Port Macquarie to the lists');
await page.getByTestId('tidy-vote').click(); await wait(300);
const tick = async (label) => page.getByTestId('tidy-box').getByLabel(`Send ${label} to the vote`).check();
await tick(josWeekend.label); await tick(alWeekend.label); await tick('Kiama'); await tick('Hunter Valley'); await tick('The Vintage');
await shot('07-tidy');
await page.getByTestId('send-to-vote').click();
await page.getByTestId('call-vote').waitFor({ timeout: 15000 }); await wait(600);
check(rpcCalls.some((c) => c.name === 'idea_tidy' && c.body.p_send === true && c.body.p_picked.length === 5), 'idea_tidy marks the 5 ticked and sends it');
const st = db.trip_builds.find((b) => b.plan_id === idea.id)?.state || {};
check(st.weekends?.length === 2 && JSON.stringify(st.regionOptions) === '["Hunter Valley","South Coast NSW"]' && st.areaCourses?.['Hunter Valley']?.length === 0 || (st.weekends?.length === 2 && (st.regionOptions || []).length === 2),
  `the trip builder gets the ticked weekends and areas (${JSON.stringify({ w: st.weekends, r: st.regionOptions })})`);
check(/\/build\?call=auto/.test(page.url()), 'and the vote opens straight away on the v10.6 builder');
const ballot = await page.getByTestId('call-vote').innerText();
check(/Which weekend\?/.test(ballot) && /Which area\?/.test(ballot), 'the ballot has When? and Where?');
check(/suits \d of \d/.test(ballot), `with the fit lines on the options (${(ballot.match(/suits \d of \d[^\n]*/) || [''])[0]})`);
await shot('08-vote-from-idea');
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 8000 });
check(db.vote_batches.some((b) => b.plan_id === idea.id), 'the vote is out');
await page.getByRole('button', { name: 'Done' }).click(); await wait(500);

// ================================================================ 6. leftovers → parked ideas
await as(JOSH, `#/idea/${idea.id}`);
await page.getByTestId('leftovers').waitFor({ timeout: 10000 });
check(await page.getByTestId('sent-to-vote').isVisible(), 'the idea says it’s been sent to the vote');
await page.getByTestId('park-suggest').click();
await page.getByTestId('park-group').first().waitFor({ timeout: 10000 });
check(aiCalls.some((b) => b.source === 'leftovers' && b.leftovers.length >= 2), 'the Caddie is asked to group what was dropped');
await shot('09-park-proposals');
await page.getByTestId('park-ok').first().click(); await wait(800);
const parked = db.plans.find((p) => p.idea_pool);
check(parked && /^Fly north/.test(parked.name) && parked.claim_owner && new Date(parked.claim_until) > new Date(Date.now() + 47 * 3600e3), `parked: "${parked?.name}", first refusal to its suggester for 48 h`);
await page.getByTestId('spin-off').click(); await wait(1200);
const spun = db.plans.find((p) => p.idea_from === idea.id && !p.idea_pool);
check(spun && /another idea/.test(spun.name) && /#\/idea\//.test(page.url()) && page.url().includes(spun.id), '"Or start another trip idea now" makes a new idea from the rest');
await as(JOSH, '#/plan');
await page.getByTestId('future-ideas').waitFor({ timeout: 10000 });
check(/Fly north/.test(await page.getByTestId('future-ideas').innerText()), 'Trips shows 💭 Future trip ideas');
await shot('10-future-ideas');

// ================================================================ 7. the parked idea: first refusal, then claim
const ownerName = names[players.findIndex((x) => x.id === parked.claim_owner)];
const other = parked.claim_owner === BO ? AL : BO;
await as(other, `#/idea/${parked.id}`);
await page.getByTestId('parked-banner').waitFor({ timeout: 10000 });
check((await page.getByTestId('parked-banner').getAttribute('data-state')) === 'theirs' && new RegExp(`${ownerName} gets first go`).test(await page.getByTestId('parked-banner').innerText()), `someone else sees it’s ${ownerName}’s first`);
check(await page.getByTestId('claim-it').count() === 0, 'and can’t claim it yet');
await as(parked.claim_owner, `#/idea/${parked.id}`);
await page.getByTestId('claim-it').waitFor({ timeout: 10000 });
await shot('11-parked-mine');
await page.getByTestId('claim-it').click(); await wait(1000);
check(parked.idea_pool === false && parked.idea_organiser === parked.claim_owner, `${ownerName} claims it — it’s their trip idea now`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.map((f) => `- ${f}`).join('\n')}` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
