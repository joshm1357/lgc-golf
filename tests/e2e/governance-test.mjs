// Governance and the Tribunal (Stage 11b, migration 061) — phone-width browser check, 21 Oct 2026. Fake database only;
// the fake server decides cases with the same rules as the app (src/lib/governance.js) so the flow is realistic.
// Usage: node governance-test.mjs <base> <shotDir>   e.g. http://localhost:4322/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { effectiveSettings, presetSettings, electorate, evaluate, tally, KINDS } from '../../src/lib/governance.js';

const BASE = process.argv[2] || 'http://localhost:4322/lgc-golf/';
const SHOTS = process.argv[3] || './shots-governance';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';   // Kurt, organiser
const AL = '22222222-2222-4222-8222-222222222222';  // Al "Bluey", player
const BO = '33333333-3333-4333-8333-333333333333';  // Bo, player
const RULE = 'rrrrrrrr-0000-4000-8000-000000000001'.replace(/r/g, 'a');
const now = '2026-10-21T08:00:00.000Z';
const users = { [K]: 'organiser', [AL]: 'player', [BO]: 'player' };
let me = K;
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now },
    { id: AL, name: 'Al Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now },
    { id: BO, name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now },
  ],
  trips: [{ id: 'tttttttt-0000-4000-8000-000000000001'.replace(/t/g, 'b'), name: 'Mudgee 2027', start_date: '2027-03-05', end_date: '2027-03-08', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [], rounds: [], plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], side_entries: [],
  posts: [{ id: 'cccccccc-0000-4000-8000-000000000001', group_id: GROUP, kind: 'user', body: 'Day 2 outfit check', player_id: BO, created_at: now }],
  rules: [{ id: RULE, group_id: GROUP, title: 'CTP is $5', detail: 'Closest to the pin on every par 3.', category: 'side_comp', applies_to: ['all'], value: '$5', status: 'active', proposed_by: BO, decided_at: '2026-03-06T00:00:00Z', decision_note: '3–1 vote.', sort: 0, created_at: now }],
  rule_votes: [],
  rule_versions: [
    { id: 'v1', group_id: GROUP, rule_id: RULE, version: 1, event: 'adopted', title: 'CTP is $2', value: '$2', detail: 'Closest to the pin.', created_at: '2025-03-06T00:00:00Z' },
    { id: 'v2', group_id: GROUP, rule_id: RULE, version: 2, event: 'changed', title: 'CTP is $5', value: '$5', detail: 'Closest to the pin on every par 3.', note: 'Changed by the Tribunal 3–1.', created_at: '2026-03-06T00:00:00Z' },
  ],
  round_rule_versions: [],
  group_members: [
    { group_id: GROUP, player_id: K, role: 'organiser' }, { group_id: GROUP, player_id: AL, role: 'player' }, { group_id: GROUP, player_id: BO, role: 'player' },
  ],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  cases: [], case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
  group_features: ['feed', 'tribunal', 'rule_voting', 'rule_challenges', 'other_cases'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const rpcCalls = [];
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
const settingsNow = () => effectiveSettings(db.governance_settings, { voteDecider: db.groups[0].vote_decider });
function settle(c) {
  const s = c.settings;
  const e = electorate({ settings: s, members: db.group_members, subjectId: c.subject_id, fallback: c.stage !== 'voting' });
  const votes = db.case_votes.filter((v) => v.case_id === c.id);
  const r = evaluate({ settings: s, voters: e.voters, votes, closed: false, fallback: c.stage !== 'voting' });
  if (r.state === 'passed' || r.state === 'failed') {
    const t = tally(votes, e.voters);
    Object.assign(c, { status: r.state, reason: r.reason, decided_at: new Date().toISOString(), votes_for: t.for, votes_against: t.against, votes_abstain: t.abstain, apply_state: r.state === 'passed' ? 'applied' : 'none' });
  }
  return r.state;
}
const rpc = {
  my_status: () => ({ is_member: true, is_admin: users[me] === 'organiser', player_id: me, group_name: 'Hunter Weekend', group_id: GROUP, role: users[me], legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: users[me] }] }),
  governance_tick: () => 0,
  raise_case: (b) => {
    const s = settingsNow()[b.p_kind];
    const c = {
      id: crypto.randomUUID(), group_id: GROUP, kind: b.p_kind, title: b.p_title, body: b.p_body, subject_id: b.p_subject, rule_id: b.p_rule,
      proposal: b.p_proposal || {}, penalty: b.p_penalty, evidence_url: b.p_evidence_url, evidence_post_id: b.p_evidence_post, raised_by: me,
      raised_via: 'app', settings: s, stage: s.decides === 'organiser' ? 'organiser' : 'voting', status: 'open', hidden: false,
      closes_at: new Date(Date.now() + s.close_hours * 3600000).toISOString(), created_at: new Date().toISOString(),
    };
    db.cases.push(c);
    return c.id;
  },
  vote_case: (b) => {
    const c = db.cases.find((x) => x.id === b.p_case);
    if (me === c.subject_id) return { error: 'You can’t vote on a case about yourself' };
    db.case_votes = db.case_votes.filter((v) => !(v.case_id === c.id && v.player_id === me));
    db.case_votes.push({ case_id: c.id, group_id: GROUP, player_id: me, vote: b.p_vote, comment: b.p_comment, created_at: new Date().toISOString() });
    return settle(c);
  },
  decide_case: (b) => { const c = db.cases.find((x) => x.id === b.p_case); Object.assign(c, { status: b.p_outcome, verdict: b.p_verdict, decided_by: me, decided_at: new Date().toISOString(), apply_state: 'applied' }); return null; },
  add_case_post: (b) => {
    const c = db.cases.find((x) => x.id === b.p_case);
    const p = { id: crypto.randomUUID(), case_id: c.id, group_id: GROUP, player_id: me, kind: me === c.subject_id ? 'reply' : b.p_photo_url ? 'evidence' : 'comment', body: b.p_body, photo_url: b.p_photo_url, created_at: new Date().toISOString() };
    db.case_posts.push(p);
    return p.id;
  },
  apply_governance_preset: (b) => {
    db.governance_settings = KINDS.filter((k) => k.key !== 'trip_decision').map((k) => ({ group_id: GROUP, kind: k.key, ...presetSettings(b.p_preset, k.key) }));
    db.governance_group = [{ group_id: GROUP, preset: b.p_preset, share_cards: true }];
    return null;
  },
  set_governance: (b) => {
    db.governance_settings = db.governance_settings.filter((r) => r.kind !== b.p_kind);
    db.governance_settings.push({ group_id: GROUP, kind: b.p_kind, ...settingsNow()[b.p_kind], ...b.p_settings });
    return null;
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
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const added = (Array.isArray(body) ? body : [body]).map((b) => ({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b }));
      rows.push(...added);
      return json((req.headers().prefer || '').includes('return=representation') ? added : [], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      for (const r of rows) if (r.id === id) Object.assign(r, JSON.parse(req.postData() || '{}'));
      return json([], 200);
    }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const seen = async (loc, t = 8000) => loc.waitFor({ timeout: t }).then(() => true, () => false);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
const as = async (who, hash) => { me = who; await page.goto(`${BASE}#${hash}`); await page.reload(); };

// 1. The Tribunal: one list, "Raise a case".
await as(K, '/tribunal');
check(await seen(page.getByTestId('gov-tab-tribunal'), 15000) && page.url().includes('#/governance/tribunal'), 'Tribunal screen opens (ov19: /tribunal → Governance, Tribunal tab)');
await page.getByRole('button', { name: /Raise a case/ }).click();
check(await seen(page.getByRole('button', { name: /Anything else/ })), 'raise sheet offers “Anything else”');
check(await page.getByRole('button', { name: /Handicap/ }).isVisible(), '…and Handicap (today’s Tribunal)');

// 2. A silly case: Bluey's shirt.
await page.getByLabel('About who (optional)').selectOption(AL);
await page.getByLabel('The charge').fill('Crimes against fashion on day 2');
await page.getByLabel('The case').fill('Pink shirt, orange shorts, no shame.');
await page.getByLabel('Penalty if guilty (optional, in words)').fill('Buys the first round');
await page.getByLabel('Or point to a feed post').selectOption('cccccccc-0000-4000-8000-000000000001');
check(await page.getByText(/How it’s decided: Majority of players/).isVisible(), 'shows how it’s decided (L.G.C default: majority of players)');
await page.screenshot({ path: `${SHOTS}/1-raise.png`, fullPage: true });
await page.getByRole('button', { name: 'Raise the case' }).click();
check(await seen(page.getByText('The Lads v Bluey').first()), 'raising opens the hearing: The Lads v Bluey');
const c = db.cases[0];
check(c && c.kind === 'other' && c.subject_id === AL && c.penalty === 'Buys the first round' && c.evidence_post_id === 'cccccccc-0000-4000-8000-000000000001', 'case saved with subject, penalty and the linked feed post');
check(await seen(page.getByText(/From the feed: Day 2 outfit check/)), 'the linked feed post shows as evidence');
await page.screenshot({ path: `${SHOTS}/2-hearing.png`, fullPage: true });

// 3. The accused replies, and can't vote.
await as(AL, `/tribunal/case/${c.id}`);
check(await seen(page.getByText(/You can’t vote on a case about yourself/), 15000), 'the accused can’t vote');
await page.getByLabel('Your reply').fill('It was vintage, your honour');
await page.getByRole('button', { name: 'Reply to the court' }).click();
check(await seen(page.getByText('It was vintage, your honour')), 'the accused’s reply shows in the hearing');
check(db.case_posts[0]?.kind === 'reply', 'saved as a reply');
check(await seen(page.getByText('· the accused')), 'marked as the accused');

// 4. Bo votes guilty (two taps), Kurt votes guilty: verdict.
await as(BO, `/tribunal/case/${c.id}`);
await page.getByRole('button', { name: 'Guilty', exact: true }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Guilty', exact: true }).click();
await page.getByPlaceholder('One-liner for the court (optional)').fill('Seen it with my own eyes');
await page.getByRole('button', { name: 'Cast my vote: Guilty' }).click();
check(await seen(page.getByText(/Your vote: Guilty/)), 'Bo’s vote recorded');
check(db.cases[0].status === 'open', 'one of two votes: still open (the rule isn’t met yet)');
await as(K, `/tribunal/case/${c.id}`);
await page.getByRole('button', { name: 'Guilty', exact: true }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Guilty', exact: true }).click();
await page.getByRole('button', { name: 'Cast my vote: Guilty' }).click();
check(await seen(page.getByTestId('verdict')), 'verdict shows once the decision rule is met');
check(db.cases[0].status === 'passed', 'case passed (2–0)');
check(await page.getByText(/The Tribunal finds Bluey GUILTY: Crimes against fashion on day 2\. Penalty: Buys the first round\./).isVisible(), 'verdict line with the penalty in words');
check(await page.getByRole('button', { name: /Share the verdict/ }).isVisible(), 'share card button');
await page.screenshot({ path: `${SHOTS}/3-verdict.png`, fullPage: true });
await as(K, '/tribunal');
check(await seen(page.getByText(/GUILTY 2–0/), 15000), 'past verdicts list it');

// 5. Governance settings: presets.
await as(K, '/group');
check(await seen(page.getByRole('link', { name: /Governance/ }), 15000), 'Players & group links to Governance');
await page.getByRole('link', { name: /Governance/ }).click();
check(await seen(page.getByTestId('presets')), 'Governance screen opens with presets');
for (const label of ['Organiser runs it', 'Majority rules', 'Club style', 'L.G.C (as today)']) check(await page.getByText(label, { exact: true }).isVisible(), `preset: ${label}`);
check(await page.getByTestId('row-change_rule').getByText(/Any organiser/).isVisible(), 'today: an organiser decides rule changes');
await page.screenshot({ path: `${SHOTS}/4-governance.png`, fullPage: true });
await page.getByTestId('presets').locator('.card', { hasText: 'Majority rules' }).getByRole('button', { name: 'Use this' }).click();
await page.waitForTimeout(800);
check(rpcCalls.some((x) => x.name === 'apply_governance_preset' && x.body.p_preset === 'majority'), 'Majority rules applied through the database function');
check(await seen(page.getByTestId('row-change_rule').getByText(/Majority of players · at least half must vote · closes after 2 days · from the next trip/)), 'rows now show the majority rules');
check(await page.getByText(/Changes here are a case/).isVisible(), 'after that, governance changes are a case');
check(await page.getByRole('button', { name: 'Propose a change' }).first().isVisible(), '…so rows offer “Propose a change”');
await page.screenshot({ path: `${SHOTS}/5-governance-majority.png`, fullPage: true });
await as(BO, '/governance/settings');
check(await seen(page.getByTestId('presets'), 15000), 'a player can see the Governance screen');
check(!(await page.getByRole('button', { name: 'Use this' }).first().isVisible().catch(() => false)), 'a player can’t switch presets directly');

// 6. Tap any rule: wording, history, and "Challenge this rule".
await as(BO, '/rules');
await page.getByRole('link', { name: /CTP is \$5/ }).waitFor({ timeout: 15000 });
await page.getByRole('link', { name: /CTP is \$5/ }).click();
check(await seen(page.getByTestId('rule-history')), 'tapping a rule opens its page');
check(await page.getByText('Version 2 · Changed').isVisible() && await page.getByText('Version 1 · Adopted').isVisible(), 'past versions listed');
check(await page.getByText(/proposed by Bo Red/).isVisible(), 'who proposed it');
await page.screenshot({ path: `${SHOTS}/6-rule.png`, fullPage: true });
await page.getByRole('button', { name: /Challenge this rule/ }).click();
check(await seen(page.getByRole('button', { name: /Change a rule/ })), 'challenge offers Change…');
check(await page.getByRole('button', { name: /Scrap a rule/ }).isVisible() && await page.getByRole('button', { name: /Ruling/ }).isVisible(), '…Scrap and Ruling');
check(!(await page.getByRole('button', { name: /Anything else/ }).isVisible().catch(() => false)), 'only rule kinds when challenging a rule');
await page.getByLabel('Worth / amount').fill('$10');
await page.getByLabel('The rule should say').fill('CTP is $10');
await page.screenshot({ path: `${SHOTS}/7-challenge.png`, fullPage: true });
await page.getByRole('button', { name: 'Raise the case' }).click();
check(await seen(page.getByText('Change: CTP is $5').first()), 'challenge raised: hearing opens');
const ch = db.cases.find((x) => x.kind === 'change_rule');
check(ch && ch.rule_id === RULE && ch.proposal.value === '$10' && ch.settings.decides === 'players_majority', 'saved as a change-rule case with the new wording, decided by majority');
await as(BO, `/rules/${RULE}`);
check(await seen(page.getByText(/Before the Tribunal: Change: CTP is \$5/), 15000), 'the rule page shows it’s before the Tribunal');
check(!(await page.getByRole('button', { name: /Challenge this rule/ }).isVisible().catch(() => false)), 'one open case per rule: no second challenge');

// 7. A passed change waiting for the next trip shows on the rule.
Object.assign(ch, { status: 'passed', apply_state: 'waiting_next_trip', decided_at: new Date().toISOString(), votes_for: 2, votes_against: 0 });
await as(BO, `/rules/${RULE}`);
check(await seen(page.getByTestId('pending-change'), 15000), 'pending change shows on the rule');
check(await page.getByText('Changes from Mudgee 2027').isVisible(), '“Changes from <next trip>”');
await page.screenshot({ path: `${SHOTS}/8-pending.png`, fullPage: true });

// 8. Switched off: no "Anything else".
db.group_features = db.group_features.map((f) => (f.feature_key === 'other_cases' ? { ...f, enabled: false } : f));
await as(BO, '/tribunal');
await page.getByRole('button', { name: /Raise a case/ }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /Raise a case/ }).click();
await page.getByRole('button', { name: /Change a rule/ }).waitFor({ timeout: 8000 });
check(!(await page.getByRole('button', { name: /Anything else/ }).isVisible().catch(() => false)), '“Anything else” switched off: not offered');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
