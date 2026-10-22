// Awards and fines (ov24, migration 093): propose a fine and a "Latest out" award, decide them, give an opinion on
// the fine's size, see them in the run-up and on the Overview, fine a feed post (chip), claim "Latest out" from a
// photo post with a time, vote, close → the result post and −1 stroke on the next round's leaderboard; appeal and
// organiser remove; the leftover kitty rule on the settle-up (on the bar → split, each person's share).
// Fake database only (organise-fixtures.mjs + the 093 server bits below). Usage:
//   node tests/e2e/awards-fines-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeDb, fakeSupabase, fakeContext, PC, K, AL, pid, plusDays, GROUP } from './organise-fixtures.mjs';
import { rewardWords, leftoverWords } from '../../src/lib/awardsfines.js';

const BASE = process.argv[2] || 'http://localhost:4424/lgc-golf/';
const SHOTS = process.argv[3] || './shots-awards-fines';
fs.mkdirSync(SHOTS, { recursive: true });
const BO = pid(2);
const T = 'aaaaaaaa-0000-4000-8000-0000000000f1';
const COURSE = 'cccccccc-0000-4000-8000-0000000000f1';
const R = 'dddddddd-0000-4000-8000-0000000000f1';
const LEFT = 'bbbbbbbb-0000-4000-8000-0000000000f1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PHOTO = 'https://example.supabase.co/storage/v1/object/public/photos/feed/x.png';
const sydney = (h, m, daysAgo = 0) => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+11:00`).toISOString();
};

// ------------------------------------------------------------------ the database
const db = makeDb();
const plan = db.plans.find((p) => p.id === PC);
Object.assign(plan, { trip_id: T, start_date: plusDays(6), end_date: plusDays(8) });
db.trips = [{ id: T, group_id: GROUP, name: 'Autumn Trip', start_date: plusDays(6), end_date: plusDays(8), status: 'active', created_at: new Date().toISOString() }];
db.group_features.push(...['dinner_awards', 'rule_voting', 'tribunal', 'rule_challenges'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })));
db.rules = [{ id: LEFT, group_id: GROUP, title: 'Leftover kitty', category: 'other', applies_to: ['trip'], status: 'active', system_key: 'leftover_kitty', leftover: 'bar', value: 'On the bar the last night', detail: 'Whatever’s left in the kitty at the end of a trip: on the bar the last night.', sort: 910, created_at: new Date().toISOString() }];
db.posts = [
  { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: AL, trip_id: T, body: 'Found my ball! (it wasn’t mine)', photo_url: PHOTO, created_at: sydney(14, 5, 1) },
  { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: BO, trip_id: T, body: 'Still going at the pub 🍺', photo_url: PHOTO, created_at: sydney(2, 47) },
];
db.comments = []; db.reactions = [];
db.dinner_awards = []; db.dinner_award_nominations = []; db.dinner_award_votes = []; db.rule_opinions = []; db.award_strokes = []; db.score_adjustments = [];
db.rule_votes = []; db.rule_versions = [];

// What the server does (093), for the fake: worth lines, photos from posts, a trip's copy, settling.
function serverRules() {
  for (const r of db.rules) {
    if (r.award_kind) { r.category = 'fines'; if (r.reward_type) r.value = rewardWords(r.reward_type, r.reward_amount, r.reward_note); }
    if (r.system_key === 'leftover_kitty') r.value = leftoverWords(r.leftover, r.leftover_note);
  }
  for (const n of db.dinner_award_nominations) {
    const post = n.post_id && db.posts.find((p) => p.id === n.post_id);
    if (post && !n.photo_url && post.photo_url) n.photo_url = post.photo_url;
  }
}
let me = { id: AL, admin: false };
const fake = fakeSupabase(db, () => me);
function rpc(name, b) {
  if (name === 'award_for_trip') {
    const r = db.rules.find((x) => x.id === b.p_rule);
    let a = db.dinner_awards.find((x) => x.trip_id === b.p_trip && x.rule_id === b.p_rule);
    if (!a) {
      a = { id: crypto.randomUUID(), group_id: GROUP, trip_id: b.p_trip, rule_id: r.id, title: r.title, kind: r.award_kind, penalty: r.award_kind === 'fine' ? r.value : null, status: 'nominating', sort: 0, created_by: me.id, created_at: new Date().toISOString() };
      db.dinner_awards.push(a);
    }
    return a.id;
  }
  if (name === 'settle_dinner_award') {
    const a = db.dinner_awards.find((x) => x.id === b.p_award);
    const r = db.rules.find((x) => x.id === a.rule_id) || a;
    const noms = db.dinner_award_nominations.filter((n) => n.award_id === a.id);
    const count = (n) => db.dinner_award_votes.filter((v) => v.nomination_id === n.id).length;
    let win = b.p_player ? noms.find((n) => n.player_id === b.p_player) : null;
    if (!win) {
      const top = Math.max(0, ...noms.map(count));
      if (top > 0) win = noms.filter((n) => count(n) === top).length === 1 ? noms.find((n) => count(n) === top) : null;
      else if (r.best === 'latest') win = [...noms].sort((x, y) => Date.parse(y.claim_at) - Date.parse(x.claim_at))[0];
    }
    if (!win) return { status: 'tie', players: noms.map((n) => n.player_id) };
    const name = db.players.find((p) => p.id === win.player_id).nickname;
    const worth = rewardWords(r.reward_type, r.reward_amount, r.reward_note);
    const t = win.claim_at ? new Date(win.claim_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s+/g, '').toLowerCase() : '';
    const body = `${a.kind === 'fine' ? '🍺' : '🏆'} ${a.title} — ${name}${t ? `, ${t}` : ''}${win.photo_url ? ' 📷' : ''}${worth ? ` · ${worth}${r.reward_type === 'strokes' ? ' next round' : ''}` : ''}`;
    Object.assign(a, { winner_id: win.player_id, settled_at: new Date().toISOString() });
    db.posts.unshift({ id: crypto.randomUUID(), group_id: GROUP, kind: 'auto', trip_id: a.trip_id, player_id: win.player_id, body, link: `/dinner/${a.trip_id}`, photo_url: win.photo_url, created_at: new Date().toISOString() });
    if (r.reward_type === 'strokes') {
      // Waiting for the winner's next round; it goes on when that round goes live (below).
      db.award_strokes.push({ id: crypto.randomUUID(), group_id: GROUP, award_id: a.id, rule_id: r.id, player_id: win.player_id, strokes: r.reward_amount, label: `${a.title} (${r.reward_amount < 0 ? '−' : '+'}${Math.abs(r.reward_amount)})`, round_id: null, created_at: new Date().toISOString() });
    }
    return { status: 'settled', player: win.player_id, post: body };
  }
  return undefined;
}
const handler = async (route) => {
  const url = new URL(route.request().url());
  serverRules();
  if (url.pathname.startsWith('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const out = rpc(url.pathname.split('/').pop(), JSON.parse(route.request().postData() || '{}'));
    if (out !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  }
  await fake.handler(route);
  serverRules();
};

// ------------------------------------------------------------------ the browser
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await fakeContext(browser, { handler });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const wait = (ms = 600) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const go = async (hash, testId) => { await page.goto(`${BASE}#${hash}`); await page.reload(); if (testId) await page.getByTestId(testId).first().waitFor({ timeout: 15000 }); await wait(); };
const as = (who) => { me = who; };
const AL_ = { id: AL, admin: false };
const JOSH = { id: K, admin: true };

// 1. Al proposes a fine from the run-up (Organise → On the day).
as(AL_);
await go(`/plan/${PC}?view=organise&step=day`, 'awards-runup');
check(await page.getByTestId('awards-runup').getByText('Leftover kitty').isVisible(), 'run-up shows the leftover kitty rule');
await page.getByTestId('propose-award').click();
await page.getByTestId('propose-sheet').waitFor();
await page.getByRole('button', { name: '🏷 Fine' }).click();
await page.getByTestId('award-title').fill('Wrong-ball fine');
await page.getByTestId('reward-type').selectOption('money');
await page.getByTestId('reward-amount').fill('5');
check((await page.getByTestId('propose-preview').innerText()).includes('$5'), 'preview: Wrong-ball fine · $5');
await page.getByTestId('propose-save').click();
await wait(900);
const fine = db.rules.find((r) => r.title === 'Wrong-ball fine');
check(fine && fine.award_kind === 'fine' && fine.status === 'proposed' && fine.reward_amount === 5 && fine.category === 'fines', 'proposed as a Rulebook rule: fine, $5, waiting');

// 2. …and "Latest out" (photo + time, latest wins, −1 stroke) from the ideas.
await page.getByTestId('propose-award').click();
await page.getByTestId('propose-sheet').waitFor();
await page.getByRole('button', { name: 'Latest out' }).click();
const prev = await page.getByTestId('propose-preview').innerText();
check(prev.includes('−1 stroke') && prev.includes('📷 photo + ⏱ time') && prev.includes('Latest wins'), `preview: −1 stroke, photo + time, latest wins (${prev.replace(/\n/g, ' ')})`);
await page.getByTestId('propose-save').click();
await wait(900);
const late = db.rules.find((r) => r.title === 'Latest out');
check(late && late.reward_type === 'strokes' && late.reward_amount === -1 && late.proof === 'photo_time' && late.best === 'latest', 'Latest out saved: −1 stroke, photo + time, latest wins');
await page.getByTestId('awards-waiting').waitFor();
const waitingTxt = await page.getByTestId('awards-waiting').innerText();
check(/WAITING FOR A DECISION \(2\)/i.test(waitingTxt), `run-up: 2 waiting for a decision (${waitingTxt.replace(/\n/g, ' ')})`);
await shot('1-runup-proposed-375');

// 3. Al gives an opinion on the fine's size.
await go(`/rules/${fine.id}`, 'opinion-box');
await page.getByTestId('opinion-too_much').click();
await page.getByTestId('opinion-comment').fill('Two bucks is plenty');
await page.getByTestId('opinion-save').click();
await wait(800);
check(db.rule_opinions.some((o) => o.player_id === AL && o.opinion === 'too_much' && o.comment === 'Two bucks is plenty'), 'opinion saved');
db.rule_opinions.push({ rule_id: fine.id, group_id: GROUP, player_id: BO, opinion: 'about_right', updated_at: new Date().toISOString() });
await go(`/rules/${fine.id}`, 'opinion-tally');
check((await page.getByTestId('opinion-tally').innerText()).includes('1 says too much · 1 about right'), 'tally: 1 says too much · 1 about right');
await shot('2-opinion-375');

// 4. Josh (organiser) decides both in the Rulebook.
as(JOSH);
await go('/governance/rulebook', null);
await page.getByRole('button', { name: '✅ Adopt' }).first().waitFor({ timeout: 15000 });
for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: '✅ Adopt' }).first().click(); await wait(900); }
check(fine.status === 'active' && late.status === 'active', 'both adopted');
check(await page.getByText('Fines & awards').first().isVisible(), 'Rulebook: a "Fines & awards" part');

// 5. The run-up and the Overview list them.
await go(`/plan/${PC}?view=organise&step=day`, 'award-line');
const runup = await page.getByTestId('awards-runup').innerText();
check(runup.includes('Wrong-ball fine') && runup.includes('$5') && runup.includes('Latest out') && runup.includes('−1 stroke') && runup.includes('Needs 📷 photo + ⏱ time'), 'run-up lists both with worth and proof');
await shot('3-runup-375');
await go(`/plan/${PC}?view=overview`, 'awards-runup');
const ov = await page.getByTestId('awards-runup').innerText();
check(ov.includes('What’s up for grabs') && ov.includes('Wrong-ball fine') && ov.includes('Latest out'), 'Overview: What’s up for grabs');
await shot('4-overview-375');

// 6. Fine Al's post from the Feed.
await go('/feed', 'fine-post');
const alPost = page.locator('article', { hasText: 'Found my ball' });
await alPost.getByTestId('fine-post').click();
await page.getByTestId('fine-sheet').waitFor();
await page.getByTestId('fine-pick').filter({ hasText: 'Wrong-ball fine' }).click();
check(await page.getByTestId('fine-who').inputValue() === AL, 'who defaults to the post’s player');
await page.getByTestId('fine-note').fill('Not his ball on 7');
await shot('5-fine-sheet-375');
await page.getByTestId('fine-save').click();
await wait(1000);
const fineAward = db.dinner_awards.find((a) => a.rule_id === fine.id);
const fineNom = db.dinner_award_nominations.find((n) => n.award_id === fineAward?.id);
check(fineNom && fineNom.player_id === AL && fineNom.post_id === db.posts.find((p) => p.player_id === AL).id && fineNom.reason === 'Not his ball on 7', 'nomination linked to the post');
await alPost.getByTestId('post-chip').waitFor({ timeout: 8000 });
check((await alPost.getByTestId('post-chip').innerText()).includes('🏷 Fined: Wrong-ball fine ($5) · Al'), 'chip on the post: 🏷 Fined: Wrong-ball fine ($5) · Al');

// 7. Claim "Latest out" for Bo from his 2:47am photo post (the time comes from the post).
const boPost = page.locator('article', { hasText: 'Still going at the pub' });
await boPost.getByTestId('fine-post').click();
await page.getByTestId('fine-pick').filter({ hasText: 'Latest out' }).click();
check(await page.getByText('📷 The post’s photo is the proof.').isVisible(), 'the post’s photo is the proof');
check((await page.getByTestId('fine-time').inputValue()).length >= 16, 'time filled from the post');
await page.getByTestId('fine-save').click();
await wait(1000);
const lateAward = db.dinner_awards.find((a) => a.rule_id === late.id);
const boNom = db.dinner_award_nominations.find((n) => n.award_id === lateAward?.id && n.player_id === BO);
check(boNom && boNom.claim_at && boNom.photo_url, 'Bo’s claim: time + photo');
await boPost.getByTestId('post-chip').waitFor({ timeout: 8000 });
check((await boPost.getByTestId('post-chip').innerText()).includes('🏅 Up for: Latest out (−1 stroke) · Bo, 2:47am'), 'chip: 🏅 Up for: Latest out (−1 stroke) · Bo, 2:47am');
await shot('6-feed-chips-375');
// Al's rival claim (11:15pm the night before).
db.dinner_award_nominations.push({ id: crypto.randomUUID(), group_id: GROUP, award_id: lateAward.id, player_id: AL, nominated_by: AL, photo_url: PHOTO, claim_at: sydney(23, 15, 1), created_at: new Date().toISOString() });

// 8. The fined player can appeal; the organiser can remove a frivolous one.
as(AL_);
await go('/feed', 'post-chip');
check(await page.locator('article', { hasText: 'Found my ball' }).getByTestId('appeal-fine').isVisible(), 'Al sees ⚖️ Appeal on his fine');
check(!(await page.getByTestId('remove-fine').first().isVisible().catch(() => false)), 'a player can’t remove fines');

// 9. Dinner: the fine and the award with worth, proof and ranked claims; the fine goes to the vote.
as(JOSH);
await go(`/dinner/${T}`, 'award-card');
const fineCard = page.getByTestId('award-card').filter({ hasText: 'Wrong-ball fine' });
const lateCard = page.getByTestId('award-card').filter({ hasText: 'Latest out' });
check((await lateCard.innerText()).includes('Reward: −1 stroke in the next round'), 'award card: reward −1 stroke in the next round');
check((await lateCard.getByTestId('claim-rank').first().innerText()) === '#1' && (await lateCard.getByTestId('nominee').first().innerText()).includes('Bo'), 'claims ranked: Bo #1 (2:47am)');
await fineCard.getByRole('button', { name: 'Open the voting' }).click();
await wait(900);
check(await fineCard.getByRole('button', { name: 'Vote' }).first().isVisible(), 'the fine from the Feed is in the fines vote');
await shot('7-dinner-375');

// 10. Close "Latest out" (no votes: the latest claim wins) → the result post, and −1 stroke waiting for Bo's next round.
await lateCard.getByRole('button', { name: 'Open the voting' }).click();
await wait(900);
await lateCard.getByRole('button', { name: 'Close the voting' }).click();
await wait(1200);
const resultPost = db.posts.find((p) => p.kind === 'auto' && p.body.startsWith('🏆 Latest out'));
check(resultPost?.body === '🏆 Latest out — Bo, 2:47am 📷 · −1 stroke next round', `result post: ${resultPost?.body}`);
check((await lateCard.getByTestId('award-result').innerText()).includes('Bo, 2:47am · −1 stroke next round'), 'card shows the result');
check(db.award_strokes.length === 1 && db.award_strokes[0].player_id === BO && db.award_strokes[0].strokes === -1, 'strokes waiting for Bo');
await shot('8-dinner-decided-375');

// 11. The next round goes live: the −1 is on Bo's card.
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
db.courses.push({ id: COURSE, group_id: GROUP, name: 'Nowra Golf Club', holes, created_at: new Date().toISOString() });
db.rounds.push({ id: R, group_id: GROUP, trip_id: T, course_id: COURSE, name: 'Saturday Stableford', play_date: plusDays(0), format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: new Date().toISOString() });
db.round_players.push(...[AL, BO].map((p) => ({ id: crypto.randomUUID(), group_id: GROUP, round_id: R, player_id: p, playing_handicap: 10 })));
Object.assign(db.award_strokes[0], { round_id: R, applied_at: new Date().toISOString() });
await go('/leaderboard', null);
await page.getByTestId('lb-penalty').first().waitFor({ timeout: 15000 });
check((await page.getByTestId('lb-penalty').first().innerText()).includes('🏆 −1 strokes'), 'leaderboard: 🏆 −1 strokes on Bo');
await shot('9-leaderboard-375');
db.rounds[0].status = 'locked';

// 12. The organiser removes the frivolous fine from the Feed.
await go('/feed', 'remove-fine');
await page.locator('article', { hasText: 'Found my ball' }).getByTestId('remove-fine').click();
await wait(900);
check(!db.dinner_award_nominations.some((n) => n.id === fineNom.id), 'organiser removed the fine');

// 13. Leftover kitty on the settle-up: the last night → "on the bar"; then the organiser makes it "split".
Object.assign(plan, { start_date: plusDays(-2), end_date: plusDays(0) });
db.trips[0].start_date = plusDays(-2); db.trips[0].end_date = plusDays(0);
db.plan_payments.push({ id: crypto.randomUUID(), plan_id: PC, group_id: GROUP, player_id: K, paid: 600 });
await go(`/plan/${PC}?view=organise&tab=kitty`, 'leftover-kitty');
const lk = await page.getByTestId('leftover-kitty').innerText();
check(lk.includes('Leftover $425 → on the bar the last night (group rule)'), `kitty: ${lk.replace(/\n/g, ' ')}`);
await shot('10-kitty-bar-375');
await go(`/rules/${LEFT}`, 'award-worth');
await page.getByRole('button', { name: 'Edit (organiser)' }).click();
await page.getByTestId('leftover-choice').selectOption('split');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await wait(900);
check(db.rules.find((r) => r.id === LEFT).leftover === 'split', 'leftover rule changed to split');
await go(`/plan/${PC}?view=organise&tab=kitty`, 'leftover-share');
check((await page.getByTestId('leftover-share').innerText()).includes('$85'), 'split: $85 back to each of the 5 who are in');
await shot('11-kitty-split-375');

// 14. Laptop width.
await page.setViewportSize({ width: 1440, height: 900 });
Object.assign(plan, { start_date: plusDays(6), end_date: plusDays(8) });
db.trips[0].start_date = plusDays(6); db.trips[0].end_date = plusDays(8);
await go(`/plan/${PC}?view=overview`, 'awards-runup'); await shot('12-overview-1440');
await go('/feed', 'post-chip'); await shot('13-feed-1440');
await go(`/dinner/${T}`, 'award-card'); await shot('14-dinner-1440');
await go(`/plan/${PC}?view=organise&step=day`, 'awards-runup'); await shot('15-runup-1440');

check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
