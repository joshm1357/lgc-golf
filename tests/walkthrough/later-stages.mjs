// Stages 4–9 for a trip whose vote is in: results → courses & stays → call the courses → pick & lock in → jobs &
// money → the run-up → the day → just after. Shared by the scenarios; each passes its own trip and people.
import crypto from 'node:crypto';
import { GROUP } from './fake.mjs';
import { wait, plusDays } from './shoot.mjs';
import { pid, holes, scoresFor } from './fixtures.mjs';
import { go, settle, DESK, PHONE, step, state, openBuilder, moveTrip, ensureTripAndRounds, roundUnderWay, rsvp } from './common.mjs';

const nowIso = () => new Date().toISOString();
const sydneyAt = (h, m, day) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+11:00`).toISOString();

/** Fill every tee-time day on the Call the courses step that this person can edit. */
export async function fillTeeTimes(page, R, { times = ['7:30-8:00', '8:10-8:40', '9:00-9:30'], skip = () => false, noOn = () => false } = {}) {
  const days = page.getByTestId('tee-day');
  const n = await days.count();
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const d = days.nth(i);
    const date = await d.getAttribute('data-date');
    const course = await d.locator('xpath=ancestor::*[@data-testid="tb-call"]').first().innerText().then((t) => t.split('\n')[0]).catch(() => '');
    if (skip(course, date, i)) continue;
    const edit = d.getByTestId('tee-day-edit');
    if (!(await edit.count())) continue;
    await edit.click().catch(() => {});
    if (noOn(date, course)) {
      await d.getByRole('button', { name: '✗ No' }).click().catch(() => {});
      await d.getByTestId('tee-day-save').click().catch(() => {});
      await wait(page, 500); filled++; continue;
    }
    await d.getByRole('button', { name: '✓ Yes' }).click().catch(() => {});
    await d.getByLabel(`Times on offer ${date}`).fill(times[i % times.length]).catch(() => {});
    await d.getByLabel(`Price ${date}`).fill(String(65 + (i % 3) * 10)).catch(() => {});
    await d.getByTestId('tee-day-save').click().catch(() => {});
    await wait(page, 500);
    filled++;
  }
  return filled;
}

export async function laterStages(o) {
  const { R, S, db, P, org, open, PLAN, UNTIL = 99 } = o;
  const op = org.page;
  const plan = () => db.plans.find((p) => p.id === PLAN);

  // ============================================================================================ 4. Courses & stays, calls
  if (UNTIL < 4) return;
  if (!o.skipChoose) {
    await openBuilder(op, PLAN);
    const chose = await R.try('choose the voted result', async () => {
      const btn = o.area ? op.locator(`[data-testid="result-area"][data-area="${o.area}"]`).getByTestId('choose-voted-area') : op.getByTestId('choose-voted-area').first();
      if (await btn.count()) { await btn.first().click(); }
      else { await op.getByTestId('going-here').click(); }
      await wait(op, 1200);
      return true;
    });
    if (chose) await R.shot(op, 'courses-stays', 'organiser', `Organiser, laptop: pressed the button to go with the vote’s winner${o.area ? ` (${o.area})` : ''}`);
    await R.try('open Courses & stays', async () => { await step(op, 'courses').getByRole('button').first().click(); await wait(op, 1200); });
    await R.shot(op, 'courses-stays', 'organiser', 'Organiser, laptop: opened step 2, Courses & stays');
  }
  // Each day's course options: tick the area's suggested courses into the days if none are there yet.
  {
    const st = state(db, PLAN);
    if (st.days && st.days.every((d) => !d.options?.length) && o.courses?.length) {
      R.note(`${R.scenario}: the stay days had no course options after choosing the area; the walkthrough added the area’s courses to each day in the fake database.`);
    }
  }
  await R.try('open Call the courses', async () => { await step(op, 'calls').getByRole('button').first().click(); await wait(op, 900); });
  await R.shot(op, 'call-courses', 'organiser', 'Organiser, laptop: opened step 3, Call the courses');
  const made = await R.try('make the call jobs', async () => { await op.getByTestId('tb-make-calls').click(); await wait(op, 1500); return true; });
  if (made) await R.shot(op, 'call-courses', 'organiser', 'Organiser, laptop: pressed the button to make the calling jobs');
  if (o.onAfterCalls) await o.onAfterCalls();
  const caller = o.calls?.onePerson || P.keen;
  await R.try('hand every call to one person', async () => {
    await op.getByTestId('calls-one').click(); await wait(op, 300);
    await op.getByLabel('One person for all').selectOption(caller.player_id); await wait(op, 900);
  });
  await settle(op);
  await R.shot(op, 'call-courses', 'organiser', `Organiser, laptop: chose “One person for all” and picked ${db.players.find((p) => p.id === caller.player_id)?.nickname}`);
  if (UNTIL < 4.5) return;
  {
    const c = await open(caller, 'keen');
    await go(c.page, `/plan/${PLAN}`, null, 1500);
    await R.shot(c.page, 'call-courses', 'keen', 'Keen player, phone: opened the trip after the notification saying he has courses to call');
    await openBuilder(c.page, PLAN);
    await R.try('open the calls as the caller', async () => { await step(c.page, 'calls').getByRole('button').first().click(); await wait(c.page, 900); });
    await R.shot(c.page, 'call-courses', 'keen', 'Keen player, phone: opened Call the courses from his job');
    await R.try('open a call script', async () => {
      await c.page.getByTestId('tb-call').first().getByRole('button', { name: '📜 What to say' }).click(); await wait(c.page, 500);
      await c.page.getByTestId('tb-call').first().scrollIntoViewIfNeeded();
      await R.shot(c.page, 'call-courses', 'keen', 'Keen player, phone: tapped “What to say” before ringing the first course', { full: false });
    });
    const filled = await fillTeeTimes(c.page, R, { skip: o.teeSkip, noOn: o.teeNo });
    if (!filled) R.note(`${R.scenario}: the caller found no tee-time days he could fill in.`);
    await R.try('tick the calls done', async () => {
      for (let i = 0; i < 6; i++) {
        const b = c.page.getByRole('button', { name: /That’s the call done/ }).first();
        if (!(await b.count())) break;
        await b.click().catch(() => {}); await wait(c.page, 600);
      }
    });
    await settle(c.page);
    await R.shot(c.page, 'call-courses', 'keen', `Keen player, phone: rang the courses and typed in the tee times on offer for each day${o.teeNo ? ' (nothing free on the primary weekend)' : ''}`);
    await c.close();
  }
  if (o.afterTeeTimes && (await o.afterTeeTimes()) === 'stop') return;

  // ============================================================================================ 5. Pick & lock in
  if (UNTIL < 5) return;
  await openBuilder(op, PLAN);
  await R.try('open Call the courses again', async () => { await step(op, 'calls').getByRole('button').first().click(); await wait(op, 900); });
  await R.shot(op, 'call-courses', 'organiser', 'Organiser, laptop: opened Call the courses after the caller finished');
  await R.try('open Pick & lock in', async () => { await step(op, 'configs').getByRole('button').first().click(); await wait(op, 1200); });
  await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: opened step 4, Pick & lock in');
  const picked = await R.try('pick a configuration', async () => {
    await op.locator('[data-testid="tb-config"]').first().getByRole('button', { name: 'Pick this one' }).click({ timeout: 8000 });
    await op.locator('[data-testid="tb-picked"]').waitFor({ timeout: 8000 });
    await wait(op, 800);
    return true;
  });
  if (picked) await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: pressed “Pick this one” on the top combination');
  const setUp = picked && await R.try('set it up in the app', async () => {
    await op.getByRole('button', { name: /Set it up in the app/ }).click();
    await op.getByRole('button', { name: /^Set it up — \d+ round/ }).waitFor({ timeout: 8000 });
    await wait(op, 600);
    await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: pressed “Set it up in the app”');
    await op.getByRole('button', { name: /^Set it up — \d+ round/ }).click(); await wait(op, 1800);
    await settle(op);
    return true;
  });
  if (setUp) await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: pressed “Set it up” to make the rounds');
  if (!picked) {
    R.note(`${R.scenario}: “Pick this one” couldn’t be reached; the walkthrough locked the trip in the fake database (dates, place, rounds).`);
    const st = state(db, PLAN);
    const w = st.weekends?.[0];
    Object.assign(plan(), { status: 'confirmed', start_date: w?.start || plusDays(45), end_date: w?.end || plusDays(47), location_name: o.place || o.area });
  }
  if (plan().status === 'planning') {
    // Lock it in from the Overview's next step, if the builder didn't.
    await go(op, `/plan/${PLAN}?view=organise`, null, 1500);
    const lock = op.getByRole('button', { name: /Lock it in/ }).first();
    if (await lock.isVisible().catch(() => false)) {
      await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: opened Organise after picking the combination');
      await lock.click(); await wait(op, 800);
      const yes = op.getByRole('dialog').getByRole('button', { name: /Lock it in|Yes/ }).first();
      if (await yes.isVisible().catch(() => false)) { await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: pressed “Lock it in”', { full: false }); await yes.click(); await wait(op, 1500); }
      await settle(op);
      await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: confirmed the lock-in');
    } else if (plan().status === 'planning') {
      R.note(`${R.scenario}: no “Lock it in” button was found after picking; the walkthrough set the trip to locked in (confirmed) in the fake database.`);
      plan().status = 'confirmed';
    }
  }
  const tripId = ensureTripAndRounds(db, PLAN, { name: o.NAME, courses: o.courses });
  plan().status = 'confirmed';
  for (const i of o.players) if (!db.plan_rsvps.some((r) => r.plan_id === PLAN && r.player_id === pid(i))) rsvp(db, PLAN, i, i === o.quietIdx ? 'maybe' : 'in');
  for (const [acct, label, line] of [
    [P.keen, 'keen', 'Keen player, phone: opened the trip after the “It’s locked in” notification'],
    [P.quiet, 'quiet', 'Quiet player, phone: opened the trip a day after it was locked in'],
    [P.guest, 'guest', 'Guest, phone: opened the trip after it was locked in'],
  ]) {
    const x = await open(acct, label);
    await go(x.page, `/plan/${PLAN}`, null, 1600);
    await R.shot(x.page, 'pick-lock', label, line);
    await x.close();
  }
  await go(op, '/plan', null, 1400);
  await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: went back to Trips after locking it in');

  // ============================================================================================ 6. Jobs & money
  if (UNTIL < 6) return;
  await go(op, `/plan/${PLAN}?view=organise&tab=jobs`, null, 1500);
  await R.shot(op, 'jobs-money', 'organiser', 'Organiser, laptop: opened Organise → Jobs');
  await R.try('make the usual jobs', async () => {
    await op.getByTestId('next-step').getByRole('button', { name: /Make it/ }).click({ timeout: 4000 }); await wait(op, 1500);
    await settle(op);
    await R.shot(op, 'jobs-money', 'organiser', 'Organiser, laptop: pressed “Make it” to add the usual jobs');
  });
  // The accommodation is booked; the organiser fronted it, and asks for a deposit.
  Object.assign(plan(), { deposit_pp: 200, deposit_asked_at: nowIso(), kitty_note: 'PayID 0400 000 000 — Josh' });
  db.plan_costs.push(
    { id: crypto.randomUUID(), plan_id: PLAN, group_id: GROUP, title: 'Accommodation (the house)', amount: 2600, per_head: false, paid_by: P.organiser.player_id, split_between: null, created_by: P.organiser.player_id, created_at: nowIso() },
    { id: crypto.randomUUID(), plan_id: PLAN, group_id: GROUP, title: 'Green fees', amount: 210, per_head: true, paid_by: null, split_between: null, created_by: P.organiser.player_id, created_at: nowIso() },
  );
  for (const i of [2, 3, 5]) db.plan_transfers.push({ id: crypto.randomUUID(), plan_id: PLAN, group_id: GROUP, from_id: pid(i), to_id: P.organiser.player_id, amount: 200, confirmed: i !== 5, note: 'Deposit', created_at: nowIso() });
  await go(op, `/plan/${PLAN}?view=organise&tab=kitty`, null, 1500);
  await R.shot(op, 'jobs-money', 'organiser', 'Organiser, laptop: opened Organise → Kitty after adding the house and green fees and asking for a $200 deposit');
  await go(op, `/plan/${PLAN}?view=organise&tab=people`, null, 1500);
  await R.shot(op, 'jobs-money', 'organiser', 'Organiser, laptop: opened Organise → People');
  {
    const k = await open(P.keen, 'keen');
    await go(k.page, `/plan/${PLAN}`, null, 1600);
    await R.shot(k.page, 'jobs-money', 'keen', 'Keen player, phone: opened the trip after the deposit request');
    await R.try('pay the deposit as the keen player', async () => {
      await k.page.getByRole('button', { name: /Confirm and pay|Pay/ }).first().click({ timeout: 5000 }); await wait(k.page, 700);
      await R.shot(k.page, 'jobs-money', 'keen', 'Keen player, phone: tapped “Confirm and pay”', { full: false });
      await k.page.getByRole('button', { name: /I’ve paid/ }).first().click({ timeout: 5000 }); await wait(k.page, 1000);
      await settle(k.page);
      await R.shot(k.page, 'jobs-money', 'keen', 'Keen player, phone: paid by bank transfer and pressed “I’ve paid”');
    });
    await go(k.page, `/plan/${PLAN}?view=organise&tab=kitty`, null, 1500);
    await R.shot(k.page, 'jobs-money', 'keen', 'Keen player, phone: opened the Kitty');
    await k.close();
    const q = await open(P.quiet, 'quiet');
    await go(q.page, `/plan/${PLAN}`, null, 1600);
    await R.shot(q.page, 'jobs-money', 'quiet', 'Quiet player, phone: opened the trip a week after the deposit was asked for, without paying');
    await q.close();
    const g = await open(P.guest, 'guest');
    await go(g.page, `/plan/${PLAN}?view=organise&tab=kitty`, null, 1500);
    await R.shot(g.page, 'jobs-money', 'guest', 'Guest, phone: opened the Kitty');
    await g.close();
  }

  // ============================================================================================ 7. The run-up
  if (UNTIL < 7) return;
  // Nine-ish days out, keeping the trip on the same weekday it was booked for.
  const runUpIn = (() => { const dow = new Date(`${plan().start_date}T00:00:00Z`).getUTCDay(); for (let n = 7; n < 14; n++) if (new Date(`${plusDays(n)}T00:00:00Z`).getUTCDay() === dow) return n; return 9; })();
  moveTrip(db, PLAN, runUpIn);
  const trip = db.trips.find((t) => t.id === tripId);
  trip.status = 'locked';
  if (!db.trophies.some((t) => t.trip_id === tripId)) db.trophies.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: tripId, name: 'BD Trophy', type: 'stableford_total', created_at: nowIso() });
  db.handicap_history.push({ id: crypto.randomUUID(), player_id: pid(6), old_handicap: 9, new_handicap: 7, reason: 'Tribunal', created_at: plusDays(-20) + 'T01:00:00Z' });
  if (o.beforeRunUp) await o.beforeRunUp(tripId);
  {
    const k = await open(P.keen, 'keen');
    await go(k.page, `/plan/${PLAN}`, null, 1800);
    await R.shot(k.page, 'run-up', 'keen', `Keen player, phone: opened the trip ${runUpIn} days before it starts`);
    await R.try('say the handicap is right', async () => { await k.page.getByTestId('handicap-ok').click({ timeout: 4000 }); await wait(k.page, 500); });
    await R.try('ask for a lift', async () => { await k.page.getByTestId('need-lift').click({ timeout: 4000 }); await wait(k.page, 600); });
    await R.try('add a side activity', async () => {
      await k.page.getByTestId('add-activity').click({ timeout: 4000 });
      await k.page.getByTestId('activity-title').fill('Go-karts Friday arvo');
      await k.page.getByTestId('activity-cost').fill('45');
      await k.page.getByTestId('activity-save').click(); await wait(k.page, 900);
    });
    await R.try('add to what to bring', async () => { await k.page.getByTestId('bring-new').fill('Speaker'); await k.page.getByTestId('bring-add').click(); await wait(k.page, 700); });
    await R.try('tip a winner', async () => { await k.page.getByTestId('tip-grid').getByRole('button').nth(5).click({ timeout: 4000 }); await wait(k.page, 700); });
    await settle(k.page);
    await R.shot(k.page, 'run-up', 'keen', 'Keen player, phone: said his handicap is right, asked for a lift, put up go-karts, added a speaker to bring and picked a winner');
    await R.try('propose a fine', async () => {
      await k.page.getByTestId('propose-award').first().click({ timeout: 4000 });
      await k.page.getByTestId('propose-sheet').waitFor({ timeout: 4000 });
      await k.page.getByRole('button', { name: '🏷 Fine' }).click();
      await k.page.getByTestId('award-title').fill('Wrong-ball fine');
      await k.page.getByTestId('reward-type').selectOption('money');
      await k.page.getByTestId('reward-amount').fill('5');
      await wait(k.page, 400);
      await R.shot(k.page, 'run-up', 'keen', 'Keen player, phone: tapped “Propose one” and filled in a $5 wrong-ball fine', { full: false });
      await k.page.getByTestId('propose-save').click(); await wait(k.page, 1000);
    });
    await k.close();
  }
  await go(op, `/plan/${PLAN}?view=organise&step=day`, null, 1800);
  await R.shot(op, 'run-up', 'organiser', `Organiser, laptop: opened Organise → Comps & on the day ${runUpIn} days out`);
  await R.try('mark handicaps reviewed', async () => {
    await op.getByRole('button', { name: '✓ Done — they’re right' }).click({ timeout: 4000 }); await wait(op, 800); await settle(op);
    await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: checked the handicaps and pressed “Done — they’re right”');
  });
  await go(op, `/plan/${PLAN}?view=overview`, 'runup', 1800);
  await R.try('offer seats', async () => {
    await op.getByTestId('offer-seats').click({ timeout: 4000 });
    await op.getByTestId('offer-seat-count').fill('3');
    await op.getByLabel('Pick-up point').fill('Leichhardt');
    await op.getByLabel('Pick-up time').fill('6:30am Fri');
    await op.getByTestId('offer-save').click(); await wait(op, 900);
    await op.getByTestId('runup-car').getByRole('button', { name: new RegExp(`\\+ ${db.players.find((p) => p.id === P.keen.player_id).nickname}`) }).click({ timeout: 4000 }).catch(() => {});
    await wait(op, 800); await settle(op);
  });
  await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: opened the trip’s Overview, offered three seats from Leichhardt and put the keen player in his car');
  {
    const q = await open(P.quiet, 'quiet');
    await go(q.page, `/plan/${PLAN}`, null, 1800);
    await R.shot(q.page, 'run-up', 'quiet', 'Quiet player, phone: opened the trip a week before it starts, for the first time since it was locked in');
    await q.close();
    const g = await open(P.guest, 'guest');
    await go(g.page, `/plan/${PLAN}`, null, 1800);
    await R.shot(g.page, 'run-up', 'guest', 'Guest, phone: opened the trip a week before it starts');
    await g.close();
  }

  // ============================================================================================ 8. The day
  if (UNTIL < 8) return;
  {
    // Today is the day of the first round.
    const first = db.rounds.filter((r) => r.trip_id === tripId).map((r) => r.play_date).sort()[0];
    const off = first ? Math.round((Date.parse(first) - Date.parse(plan().start_date)) / 864e5) : 0;
    moveTrip(db, PLAN, -off);
  }
  trip.status = 'active';
  const r1 = roundUnderWay(db, tripId, o.players, 9);
  const P1 = (i) => pid(i);
  db.posts.unshift(
    { id: crypto.randomUUID(), group_id: GROUP, kind: 'auto', trip_id: tripId, round_id: r1.id, player_id: P1(6), body: `🐦 Birdie! ${db.players[6].nickname} on the 4th`, created_at: sydneyAt(9, 40, plusDays(0)) },
    { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', trip_id: tripId, player_id: P1(2), body: 'Who parked in the Captain’s spot? 😂', photo_url: 'https://walkthrough-fake.supabase.co/storage/v1/object/public/photos/feed/x.png', created_at: sydneyAt(8, 5, plusDays(0)) },
  );
  if (o.beforeDay) await o.beforeDay(tripId, r1);
  await go(op, '/', null, 2000);
  await R.shot(op, 'the-day', 'organiser', 'Organiser, laptop: opened the app on the trip’s first golf day, nine holes into round one');
  {
    const k = await open(P.keen, 'keen');
    await go(k.page, '/', null, 2000);
    await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: opened the app on the course during round one');
    await go(k.page, `/score/${r1.id}`, null, 2000);
    await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: tapped to enter his score for the next hole');
    await R.try('enter a score', async () => {
      await k.page.getByRole('button', { name: 'One more' }).click({ timeout: 4000 });
      await wait(k.page, 400);
      await k.page.getByRole('button', { name: /Save & next hole/ }).click(); await wait(k.page, 1000);
      await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: tapped + to make it a 5, then “Save & next hole”');
    });
    await go(k.page, `/leaderboard?r=${r1.id}`, null, 2000);
    await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: opened the leaderboard');
    await go(k.page, '/feed', null, 1800);
    await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: opened the Feed between holes');
    await k.close();
    const q = await open(P.quiet, 'quiet');
    await go(q.page, '/', null, 2000);
    await R.shot(q.page, 'the-day', 'quiet', 'Quiet player, phone: opened the app on the first tee of round one');
    await q.close();
    const g = await open(P.guest, 'guest');
    await go(g.page, '/', null, 2000);
    await R.shot(g.page, 'the-day', 'guest', 'Guest, phone: opened the app during round one');
    await go(g.page, `/leaderboard?r=${r1.id}`, null, 2000);
    await R.shot(g.page, 'the-day', 'guest', 'Guest, phone: opened the leaderboard');
    await g.close();
  }
  await go(op, `/leaderboard?r=${r1.id}`, null, 2000);
  await R.shot(op, 'the-day', 'organiser', 'Organiser, laptop: opened the leaderboard at lunch');

  // ============================================================================================ 9. Just after
  if (UNTIL < 9) return;
  const len = Math.round((Date.parse(plan().end_date) - Date.parse(plan().start_date)) / 864e5);
  moveTrip(db, PLAN, -(len + 1));
  trip.status = 'locked';
  const rounds = db.rounds.filter((r) => r.trip_id === tripId);
  for (const r of rounds) {
    r.status = 'locked';
    db.scores = db.scores.filter((x) => x.round_id !== r.id);
    db.round_players = db.round_players.filter((x) => x.round_id !== r.id);
    for (const i of o.players) {
      const p = db.players.find((x) => x.id === pid(i));
      db.round_players.push({ round_id: r.id, player_id: p.id, playing_handicap: Math.round(p.handicap), group_id: GROUP });
      db.scores.push(...scoresFor(r.id, p.id, 18, i % 3 === 0));
    }
  }
  const winner = db.players[6];
  db.honour_board.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: tripId, trophy_name: 'BD Trophy', label: plan().start_date.slice(0, 4), winner_names: winner.nickname, player_ids: [winner.id], sort_key: 3, created_at: nowIso() });
  const fineRule = db.rules.find((r) => r.title === 'Wrong-ball fine');
  if (fineRule) {
    fineRule.status = 'active';
    db.dinner_awards.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: tripId, rule_id: fineRule.id, title: fineRule.title, kind: 'fine', penalty: '$5', status: 'nominating', winner_id: pid(2), settled_at: nowIso(), sort: 0, created_by: P.keen.player_id, created_at: nowIso() });
  }
  db.posts.unshift({ id: crypto.randomUUID(), group_id: GROUP, kind: 'auto', trip_id: tripId, player_id: winner.id, body: `🏆 ${winner.nickname} wins the BD Trophy!`, created_at: nowIso() });
  if (o.beforeAfter) await o.beforeAfter(tripId);
  {
    const k = await open(P.keen, 'keen');
    await go(k.page, '/', null, 2000);
    await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened the app the day after getting home');
    await go(k.page, `/plan/${PLAN}`, null, 1800);
    await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened the trip');
    await go(k.page, '/trophies', null, 1800);
    await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened the Trophy Room');
    await go(k.page, `/dinner/${tripId}`, null, 1800);
    await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened Fines and dinner awards');
    await k.close();
  }
  await go(op, '/', null, 1800);
  await R.shot(op, 'just-after', 'organiser', 'Organiser, laptop: opened the app the day after the trip');
  await R.try('open Last trip from the sidebar', async () => {
    await op.locator('nav.side').getByRole('link', { name: /Last|Previous/ }).first().click({ timeout: 4000 }); await wait(op, 1800);
    await R.shot(op, 'just-after', 'organiser', 'Organiser, laptop: clicked the trip under Trips in the sidebar');
  });
  await go(op, `/plan/${PLAN}?view=organise&tab=kitty`, null, 1600);
  await R.shot(op, 'just-after', 'organiser', 'Organiser, laptop: opened the Kitty to settle up');
  {
    const q = await open(P.quiet, 'quiet');
    await go(q.page, '/', null, 2000);
    await R.shot(q.page, 'just-after', 'quiet', 'Quiet player, phone: opened the app two days after the trip');
    await q.close();
    const g = await open(P.guest, 'guest');
    await go(g.page, `/plan/${PLAN}`, null, 1800);
    await R.shot(g.page, 'just-after', 'guest', 'Guest, phone: opened the trip after it finished');
    await g.close();
  }
}
