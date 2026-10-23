// The run-up reminders (ov25, 23 Oct 2026) — the words only, shared by the notify function (Deno) and the app's tests
// (src/lib/runup.js re-exports these). Plain JavaScript, no imports, so both can load it.
//
//   A week out:     "3 things waiting for you" — only sent when there's something (else nothing).
//   The day before: "Your car: Josh's, pick-up Leichhardt 6:30am Fri · Room 3 with Hamish · tee time 9:12 ·
//                    You're bringing: speaker".

const first = (p) => String(p?.nickname || p?.name || '').trim().split(/\s+/)[0] || 'someone';
const pl = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "9:12" / "9:12am" / "1:05pm" from "09:12" / "13:05"; anything else comes back as it is. */
export function teeWords(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const h = Number(m[1]);
  if (h < 12) return `${h || 12}:${m[2]}`;
  return `${h === 12 ? 12 : h - 12}:${m[2]}pm`;
}

/**
 * The things waiting on one person, as short lines: ["Pay your $300 deposit", "Book the bus (job)", …].
 *   todo: { reply, deposit, jobs: [title], handicap, bring: [title], tip }
 */
export function waitingLines(todo = {}) {
  const out = [];
  if (todo.reply) out.push('Say if you’re in');
  if (todo.deposit) out.push(`Pay your ${todo.deposit} deposit`);
  for (const j of todo.jobs || []) out.push(`Job: ${j}`);
  if (todo.handicap) out.push('Check your handicap');
  if (todo.tip) out.push('Pick your winner (tipping)');
  return out;
}

/** The week-out reminder for one person → { title, body } or null when nothing's waiting. */
export function weekOutMessage(planName, todo = {}) {
  const lines = waitingLines(todo);
  if (!lines.length) return null;
  return {
    title: `⛳ ${planName} is a week away — ${pl(lines.length, 'thing')} waiting for you`,
    body: lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ` · +${lines.length - 3} more` : ''),
  };
}

/**
 * The day-before line for one person.
 *   car:   { name, driver, pickup_place, pickup_time, driving } (driving: they're the driver)
 *   room:  { name, with: [player] }
 *   tee:   "09:12"
 *   bring: ["Speaker", …]
 * → "Your car: Josh's, pick-up Leichhardt 6:30am Fri · Room 3 with Hamish · tee time 9:12 · You're bringing: speaker"
 */
export function dayBeforeLine({ car = null, room = null, tee = null, bring = [] } = {}) {
  const parts = [];
  if (car) {
    const pick = [car.pickup_place, car.pickup_time].filter(Boolean).join(' ');
    const whose = car.driving ? 'you’re driving' : car.driver ? `${first(car.driver)}’s` : car.name;
    parts.push(`Your car: ${whose}${pick ? `, pick-up ${pick}` : ''}`);
  }
  if (room) {
    const mates = (room.with || []).map(first);
    parts.push(`${room.name}${mates.length ? ` with ${nameList(mates)}` : ''}`);
  }
  if (tee) parts.push(`tee time ${teeWords(tee)}`);
  if (bring.length) parts.push(`You’re bringing: ${nameList(bring.map((b) => String(b).toLowerCase()))}`);
  return parts.join(' · ');
}

/** The day-before reminder for one person → { title, body }. No lift sorted (ov27): that's the one thing it says. */
export function dayBeforeMessage(planName, place, bits = {}) {
  if (bits.lift === 'none' && !bits.car) {
    return { title: `⛳ ${planName} is tomorrow`, body: 'No lift sorted yet — tap to hop in a car with a seat free, or say you need one.' };
  }
  const line = dayBeforeLine(bits);
  return { title: `⛳ ${planName} is tomorrow`, body: line || [place, 'Check the details and what to bring.'].filter(Boolean).join(' · ') };
}

const money = (x) => `$${Number(x).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;

/**
 * I10 (ov27, walkthrough review): the countdown pushes — one per person at 30, 7 and 1 days out, each about ONE thing,
 * and nothing at all when there's nothing to do (no flooding).
 *   days: 30 | 7 (the day before is dayBeforeMessage)
 *   info: { owes: dollars still to pay, payTo: "Josh", reply: hasn't said if they're in, handicap: not checked,
 *           hcp: their handicap, lift: 'none' | 'asked' | 'car' | 'driving' }
 *   30 days → pay (else: are you in?)        7 days → handicap (else pay, else lift)
 * → { title, body, about: 'pay' | 'reply' | 'handicap' | 'lift' } or null
 */
export function countdownPush(days, planName, info = {}) {
  const pay = Number(info.owes) > 0.5
    ? { about: 'pay', body: `Pay ${info.payTo || 'the organiser'} your ${money(info.owes)} — tap for the payment details, then “I’ve paid”.` } : null;
  const reply = info.reply ? { about: 'reply', body: 'Are you in? Tap to say — the organiser’s counting heads.' } : null;
  const hcp = info.handicap ? { about: 'handicap', body: `Is your handicap${info.hcp != null ? ` (${info.hcp})` : ''} still right? One tap to confirm or fix it.` } : null;
  const lift = info.lift === 'none' ? { about: 'lift', body: 'How are you getting there? Hop in a car, offer your seats or say you need a lift.' } : null;
  let pick = null;
  let when = '';
  if (days >= 28) { pick = pay || reply; when = 'is a month away'; }
  else if (days >= 5) { pick = hcp || pay || lift; when = 'is a week away'; }
  if (!pick) return null;
  return { title: `⛳ ${planName} ${when}`, body: pick.body, about: pick.about };
}
