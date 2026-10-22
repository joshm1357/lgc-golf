// Governance hub, committees and elections (ov19, migration 090) — browser check at phone (375) and laptop (1440)
// width, 23 Oct 2026. Fake database only; the fake decides elections with the same rules as the app
// (src/lib/governance.js: electionCount, afterNominations, electorate), which the staging SQL test checks against the
// real database (supabase/tests/090_committees_elections.sql).
// Usage: node governance-hub-test.mjs <base> <shotDir>   e.g. http://localhost:4322/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { effectiveSettings, electorate, electionCount, afterNominations } from '../../src/lib/governance.js';

const BASE = process.argv[2] || 'http://localhost:4322/lgc-golf/';
const SHOTS = process.argv[3] || './shots-governance-hub';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000001c';
const K = '11111111-1111-4111-8111-111111111111';   // Kurt, organiser
const AL = '22222222-2222-4222-8222-222222222222';  // Al "Bluey", player
const BO = '33333333-3333-4333-8333-333333333333';  // Bo, player
const GU = '44444444-4444-4444-8444-444444444444';  // Gus, guest
const RULE = 'aaaaaaaa-0000-4000-8000-000000000001';
const now = '2026-10-21T08:00:00.000Z';
const users = { [K]: 'organiser', [AL]: 'player', [BO]: 'player', [GU]: 'guest' };
let me = K;
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now },
    { id: AL, name: 'Al Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now },
    { id: BO, name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now },
    { id: GU, name: 'Gus Guest', nickname: null, handicap: 28, approved: true, created_at: now },
  ],
  trips: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'Mudgee 2027', start_date: '2027-03-05', end_date: '2027-03-08', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [], rounds: [], plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], side_entries: [],
  posts: [],
  rules: [{ id: RULE, group_id: GROUP, title: 'CTP is $5', detail: 'Closest to the pin on every par 3.', category: 'side_comp', applies_to: ['all'], value: '$5', status: 'active', proposed_by: BO, decided_at: '2026-03-06T00:00:00Z', decision_note: '3–1 vote.', sort: 0, created_at: now }],
  rule_votes: [], rule_versions: [], round_rule_versions: [],
  group_members: [
    { group_id: GROUP, player_id: K, role: 'organiser' }, { group_id: GROUP, player_id: AL, role: 'player' },
    { group_id: GROUP, player_id: BO, role: 'player' }, { group_id: GROUP, player_id: GU, role: 'guest' },
  ],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  cases: [], case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
  election_nominations: [], election_ballots: [],
  group_features: ['feed', 'tribunal', 'rule_voting', 'rule_challenges', 'other_cases', 'committees'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const rpcCalls = [];
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const settingsNow = () => effectiveSettings(db.governance_settings, { voteDecider: db.groups[0].vote_decider });
const voters = (c) => electorate({ settings: c.settings, members: db.group_members, subjectId: null }).voters;
const accepted = (c) => db.election_nominations.filter((n) => n.case_id === c.id && n.status === 'accepted').map((n) => n.player_id);
function fill(c, winner, reason, results) {
  const seat = db.committee_seats.find((s) => s.committee_id === c.proposal.committee_id && s.seat_no === c.proposal.seat_no);
  Object.assign(seat, { player_id: winner, started_at: new Date().toISOString(), term_no: seat.player_id === winner ? (seat.term_no || 0) + 1 : 1 });
  const nm = db.players.find((p) => p.id === winner);
  Object.assign(c, { status: 'passed', stage: 'voting', election_phase: null, subject_id: winner, reason, verdict: `${nm.nickname || nm.name} elected`, decided_at: new Date().toISOString(), proposal: { ...c.proposal, candidate: winner, results } });
  db.posts.push({ id: crypto.randomUUID(), group_id: GROUP, kind: 'tribunal', body: `🗳️ Elected: ${nm.nickname || nm.name}`, created_at: new Date().toISOString() });
}
function settle(c, closed = false) {
  if (c.election_phase === 'nominating') {
    if (!closed && new Date(c.closes_at) > new Date()) return 'nominating';
    db.election_nominations.filter((n) => n.case_id === c.id && n.status === 'pending').forEach((n) => { n.status = 'declined'; });
    const a = accepted(c);
    const next = afterNominations(a.length, c.settings);
    if (next === 'none') { Object.assign(c, { status: 'failed', reason: 'Nobody stood, so the seat stays as it is' }); return 'failed'; }
    if (next === 'unopposed') { fill(c, a[0], 'Elected unopposed', [{ player_id: a[0], votes: 0 }]); return 'passed'; }
    Object.assign(c, { election_phase: 'voting', closes_at: iso(48 * 3600000) });
    return 'open';
  }
  const ballots = db.election_ballots.filter((b) => b.case_id === c.id);
  const r = electionCount({ nominees: accepted(c), ballots, voters: voters(c), closed });
  if (!r.settled) return 'open';
  if (r.winner) { fill(c, r.winner, 'Most votes', r.results); return 'passed'; }
  if (r.tied.length) { Object.assign(c, { stage: 'casting', proposal: { ...c.proposal, tied: r.tied, results: r.results } }); return 'casting'; }
  Object.assign(c, { status: 'failed', reason: 'Nobody voted' });
  return 'failed';
}
const rpc = {
  my_status: () => ({ is_member: true, is_admin: users[me] === 'organiser', player_id: me, group_name: 'Hunter Weekend', group_id: GROUP, role: users[me], legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: users[me] }] }),
  governance_tick: () => {
    let n = 0;
    for (const c of db.cases) if (c.status === 'open' && c.election_phase && new Date(c.closes_at) <= new Date()) { settle(c, true); n += 1; }
    return n;
  },
  save_committee_v2: (b) => {
    const id = crypto.randomUUID();
    db.committees.push({ id, group_id: GROUP, name: b.p_name, kinds: b.p_kinds, seats: b.p_seats, fill: b.p_fill, term_trips: b.p_term_trips, term_years: b.p_term_years, term_limit: b.p_term_limit, staggered: b.p_staggered, nominate_hours: b.p_nominate_hours, created_at: new Date().toISOString() });
    for (let i = 1; i <= b.p_seats; i += 1) db.committee_seats.push({ id: crypto.randomUUID(), group_id: GROUP, committee_id: id, seat_no: i, player_id: null, started_at: null, term_no: 0, half_term: !!b.p_staggered && i % 2 === 0 });
    return id;
  },
  call_election: (b) => {
    if (users[me] !== 'organiser') return { error: 'Only an organiser can call an election' };
    const com = db.committees.find((x) => x.id === b.p_committee);
    const c = { id: crypto.randomUUID(), group_id: GROUP, kind: 'election', title: `${com.name}, seat ${b.p_seat_no}: election`, body: 'Nominate yourself or a mate.', proposal: { mode: 'contest', committee_id: com.id, seat_no: b.p_seat_no, why: 'call' }, settings: settingsNow().election, stage: 'voting', election_phase: 'nominating', status: 'open', hidden: false, raised_by: me, raised_via: 'app', closes_at: iso(com.nominate_hours * 3600000), created_at: new Date().toISOString() };
    db.cases.push(c);
    return c.id;
  },
  nominate: (b) => {
    if (users[me] === 'guest') return { error: 'Guests can’t nominate' };
    const st = b.p_player === me ? 'accepted' : 'pending';
    db.election_nominations.push({ id: crypto.randomUUID(), group_id: GROUP, case_id: b.p_case, player_id: b.p_player, nominated_by: me, status: st, created_at: new Date().toISOString() });
    return st;
  },
  answer_nomination: (b) => { const n = db.election_nominations.find((x) => x.case_id === b.p_case && x.player_id === me); n.status = b.p_accept ? 'accepted' : 'declined'; return n.status; },
  election_turnout: (b) => {
    const c = db.cases.find((x) => x.id === b.p_case);
    const v = voters(c);
    const ballots = db.election_ballots.filter((x) => x.case_id === c.id);
    return { voted: ballots.filter((x) => v.includes(x.voter_id)).length, voters: v.length, can_vote: users[me] !== 'guest' && v.includes(me), mine: ballots.find((x) => x.voter_id === me)?.nominee_id || null };
  },
  vote_election: (b) => {
    if (users[me] === 'guest') return { error: 'Guests don’t vote in elections' };
    const c = db.cases.find((x) => x.id === b.p_case);
    db.election_ballots = db.election_ballots.filter((x) => !(x.case_id === c.id && x.voter_id === me));
    db.election_ballots.push({ case_id: c.id, group_id: GROUP, voter_id: me, nominee_id: b.p_nominee });
    return settle(c);
  },
};
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcCalls.push({ name, body, me });
    const out = rpc[name] ? rpc[name](body) : null;
    if (out && out.error) return json({ message: out.error, code: 'P0001' }, 400);
    return json(out ?? null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    if (table === 'election_ballots') return json([]); // secret ballot: nobody reads them directly
    const rows = (db[table] ||= []);
    if (method === 'GET') {
      return json(rows.filter((r) => [...url.searchParams].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || (k === 'group_id' && r.group_id === undefined) || !v.startsWith('eq.') || String(r[k]) === v.slice(3))));
    }
    return json([], 201);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const seen = async (loc, t = 8000) => loc.waitFor({ timeout: t }).then(() => true, () => false);
const browser = await chromium.launch();
async function makePage(width, height, mobile) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(([uid]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now() + 86400000 * 400));
  }, ['99999999-9999-4999-8999-999999999999']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  page.on('dialog', (d) => d.accept());
  return page;
}
const page = await makePage(375, 812, true);
const as = async (who, hash, pg = page) => { me = who; await pg.goto(`${BASE}#${hash}`); await pg.reload(); };
const path = (pg = page) => decodeURIComponent(new URL(pg.url()).hash);

// 1. Old links land in the right tab; the summary and "How groups work" sit on top.
await as(K, '/rules');
check(await seen(page.getByTestId('gov-tab-rulebook'), 15000), '/rules opens Governance');
check(path().startsWith('#/governance/rulebook'), '…on the Rulebook tab');
for (const t of ['rulebook', 'tribunal', 'committees']) check(await page.getByTestId(`gov-tab-${t}`).isVisible(), `tab: ${t}`);
check(await seen(page.getByTestId('how-we-decide').getByText(/Organisers decide new rules.*; the group votes on handicaps/)), 'How we decide things, in plain words (L.G.C default)');
check(await page.getByTestId('change-how').getByText('Change how we decide →').isVisible(), 'organisers get “Change how we decide”');
await page.getByTestId('how-groups-work').locator('summary').click();
check(await seen(page.getByText(/A group is your golf group — Hunter Weekend/)), '“How groups work” explains groups, members, organisers, guests, committees');
check(await seen(page.getByRole('link', { name: /CTP is \$5/ })), 'the Rulebook shows inside the tab');
await page.screenshot({ path: `${SHOTS}/375-1-rulebook.png`, fullPage: true });
await as(K, '/tribunal');
check(await seen(page.getByTestId('gov-tab-tribunal'), 15000) && path().startsWith('#/governance/tribunal'), '/tribunal → the Tribunal tab');
check(await seen(page.getByRole('button', { name: /Raise a case/ })), 'the Tribunal shows inside the tab');
await page.screenshot({ path: `${SHOTS}/375-2-tribunal.png`, fullPage: true });
await as(K, '/cases');
check(await seen(page.getByTestId('gov-tab-tribunal'), 15000) && path().startsWith('#/governance/tribunal'), '/cases → the Tribunal tab');
await as(K, '/rules?propose=1');
check(await seen(page.getByTestId('gov-tab-rulebook'), 15000) && path() === '#/governance/rulebook?propose=1', '/rules?propose=1 keeps its ?propose');
await as(K, `/rules/${RULE}`);
check(await seen(page.getByTestId('rule-history'), 15000), 'a deep link to one rule still opens its page');
await as(K, '/governance');
check(await seen(page.getByTestId('gov-tab-rulebook'), 15000) && path().startsWith('#/governance/rulebook'), '/governance → the Rulebook tab');
await page.getByTestId('change-how').click();
check(await seen(page.getByTestId('presets')) && path() === '#/governance/settings', '“Change how we decide” opens the settings');

// 2. Committees: set one up (seats, election, term, term limit, staggered).
await as(K, '/committees');
check(await seen(page.getByTestId('committees'), 15000) && path().startsWith('#/governance/committees'), '/committees → the Committees tab');
check(await page.getByText('No committees yet.', { exact: false }).isVisible(), 'empty to start');
await page.getByRole('button', { name: '+ Add a committee' }).click();
await page.getByLabel('Name').fill('Rules Committee');
await page.getByTestId('committee-sheet').getByRole('button', { name: 'Change a rule' }).click();
await page.getByLabel('Seats', { exact: true }).fill('2');
await page.getByLabel('Term limit').selectOption('2');
await page.getByTestId('committee-sheet').getByText('Staggered terms').click();
check(await page.getByText(/Seat 2 get a half-length first term/).isVisible(), 'staggered: says which seats get a short first term');
await page.screenshot({ path: `${SHOTS}/375-3-new-committee.png`, fullPage: true });
await page.getByTestId('committee-sheet').getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(600);
const saved = rpcCalls.find((x) => x.name === 'save_committee_v2');
check(saved && saved.body.p_seats === 2 && saved.body.p_term_limit === 2 && saved.body.p_staggered === true && saved.body.p_fill === 'election' && saved.body.p_term_trips === 2, 'saved through save_committee_v2 with seats, term limit and staggering');
const com = db.committees[0];
check(await seen(page.getByTestId('committee-Rules Committee')), 'the committee is listed');
check(await page.getByText(/2 seats · elected · term 2 trips or 1 year, whichever comes first · no more than 2 terms in a row · staggered/).isVisible(), 'its seats, how they’re filled, term, limit and staggering in words');
check(await page.getByText(/Set up for handicaps and rule changes — not handling any cases yet/).isVisible(), 'its job in plain words (and that no cases go to it yet)');
await page.screenshot({ path: `${SHOTS}/375-4-committees.png`, fullPage: true });

// 3. Call an election for seat 1: nominations.
await page.getByTestId('call-1').click();
check(await seen(page.getByTestId('election'), 15000), 'calling an election opens its page');
check(await page.getByText(/Nominations close in 3 days/).isVisible(), 'nominations open for 3 days');
await page.getByTestId('stand').click();
check(await seen(page.getByTestId('nominees').getByText('Standing')), 'Kurt stands');
await page.getByLabel('Nominate a mate').selectOption(AL);
await page.getByRole('button', { name: 'Nominate', exact: true }).click();
check(await seen(page.getByText('Waiting for them to accept')), 'Bluey nominated — waiting for him to accept');
const el = db.cases.find((c) => c.kind === 'election');
await page.screenshot({ path: `${SHOTS}/375-5-nominations.png`, fullPage: true });
await as(AL, `/tribunal/case/${el.id}`);
check(await seen(page.getByTestId('accept-nomination'), 15000), 'Bluey is asked to accept');
await page.getByTestId('accept-nomination').getByRole('button', { name: 'Accept' }).click();
check(await seen(page.getByRole('button', { name: 'Withdraw my nomination' })), 'Bluey accepts');
await as(K, '/governance/committees');
check(await seen(page.getByTestId('election-row'), 15000), 'the Committees tab lists the election');
check(await page.getByTestId('election-row').getByText(/nominations close in 3 days · 2 standing/).isVisible(), '…with 2 standing');

// 4. Nominations close (the hourly clock): the vote.
el.closes_at = iso(-60000);
await as(GU, `/tribunal/case/${el.id}`);
check(await seen(page.getByText(/Voting closes in 2 days/), 15000), 'nominations closed → voting open');
check(await seen(page.getByText('Guests don’t vote in elections.')), 'a guest can’t vote');
await as(BO, `/tribunal/case/${el.id}`);
await page.getByRole('group', { name: 'Candidates' }).getByRole('button', { name: /Bluey/ }).waitFor({ timeout: 15000 });
check(await page.getByText(/0 of 3 have voted/).isVisible(), 'secret ballot: shows how many have voted, not who for');
await page.getByRole('group', { name: 'Candidates' }).getByRole('button', { name: /Bluey/ }).click();
await page.screenshot({ path: `${SHOTS}/375-6-vote.png`, fullPage: true });
await page.getByRole('button', { name: 'Vote for Bluey' }).click();
check(await seen(page.getByText('✓ Your vote')), 'Bo votes for Bluey');
check(el.status === 'open', 'one vote of three: still open');
await as(AL, `/tribunal/case/${el.id}`);
await page.getByRole('group', { name: 'Candidates' }).getByRole('button', { name: /Bluey/ }).waitFor({ timeout: 15000 });
await page.getByRole('group', { name: 'Candidates' }).getByRole('button', { name: /Bluey/ }).click();
await page.getByRole('button', { name: 'Vote for Bluey' }).click();
check(await seen(page.getByTestId('election-result')), 'two of three for Bluey: nobody can catch him — result in');
check(await page.getByTestId('election-result').getByText('Bluey elected').isVisible(), 'Bluey elected');
check(el.status === 'passed' && db.committee_seats.find((s) => s.committee_id === com.id && s.seat_no === 1).player_id === AL, 'seat 1 filled with Bluey');
check(db.posts.some((p) => p.body.startsWith('🗳️ Elected: Bluey')), 'result posted to the feed');
await page.screenshot({ path: `${SHOTS}/375-7-result.png`, fullPage: true });
await as(AL, '/governance/committees');
check(await seen(page.getByTestId('seat-1').getByText('Bluey'), 15000), 'Committees tab: Bluey in seat 1');
check(await page.getByTestId('seat-1').getByText('Term ends after 2 more trips or on', { exact: false }).isVisible(), '…with when his term ends');
check(await page.getByTestId('seat-1').getByRole('button', { name: 'Resign' }).isVisible(), '…and he can resign');
check(!(await page.getByTestId('call-2').isVisible().catch(() => false)), 'a player can’t call an election');
await page.screenshot({ path: `${SHOTS}/375-8-committees-filled.png`, fullPage: true });

// 5. Laptop width: one Governance item in the sidebar, the tabs across the top.
const wide = await makePage(1440, 900, false);
await as(K, '/governance/committees', wide);
check(await seen(wide.locator('nav.side').getByRole('link', { name: 'Governance' }), 15000), 'sidebar: one “Governance” item');
check(!(await wide.locator('nav.side').getByRole('link', { name: 'Rulebook' }).isVisible().catch(() => false)) && !(await wide.locator('nav.side').getByRole('link', { name: 'Tribunal' }).isVisible().catch(() => false)), 'sidebar: no separate Rulebook / Tribunal items');
check(await wide.locator('nav.side').getByRole('link', { name: 'Governance' }).evaluate((a) => a.classList.contains('active')), 'sidebar item lit on a Governance tab');
await wide.screenshot({ path: `${SHOTS}/1440-committees.png`, fullPage: true });
for (const t of ['rulebook', 'tribunal']) { await wide.getByTestId(`gov-tab-${t}`).click(); await wide.waitForTimeout(700); await wide.screenshot({ path: `${SHOTS}/1440-${t}.png`, fullPage: true }); }
await as(K, `/tribunal/case/${el.id}`, wide);
await wide.getByTestId('election-result').waitFor({ timeout: 15000 });
await wide.screenshot({ path: `${SHOTS}/1440-election.png`, fullPage: true });

// 6. More (phone): one Governance entry.
await as(K, '/more');
check(await seen(page.getByRole('link', { name: /⚖️ Governance/ }), 15000), 'More: a ⚖️ Governance entry');
check(!(await page.getByRole('link', { name: /Handicap Tribunal/ }).isVisible().catch(() => false)), 'More: no separate Tribunal entry');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
