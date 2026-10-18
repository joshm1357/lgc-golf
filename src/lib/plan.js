// The Planner — pure functions (no database, no React) so they can be tested.
//
// Plain words:
//   - Votes are ✓ / ? / ✗ on every option. Score = 2 per ✓ + 1 per ?. Highest score leads;
//     a tie goes to the option fewer people said ✗ to.
//   - The kitty: each cost is either a total (split between everyone who's in) or per head.
//     Your balance = your share − what you've paid in − anything you fronted. Positive = you owe.
//   - Suggestions: a checklist of what usually needs doing and when. Nothing happens
//     automatically — the admin taps to add it as a job or to act on it.

export const RESPONSES = ['yes', 'maybe', 'no'];
export const RESPONSE_LABEL = { yes: '✓ Can', maybe: '? Maybe', no: '✗ Can’t' };
export const RSVP_LABEL = { in: 'In', maybe: 'Maybe', out: 'Out' };

const DAY = 24 * 3600 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-03-12" → Date at local midnight (no timezone surprises). */
export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Whole days from today to the date (negative = past). */
export function daysUntil(date, today = todayISO()) {
  const a = parseDate(today);
  const b = parseDate(date);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY);
}

/** "Fri 12 – Sun 14 Mar 2027", "Sat 13 Mar 2027", or "Fri 30 Apr – Sun 2 May 2027". */
export function fmtRange(start, end) {
  const a = parseDate(start);
  if (!a) return '';
  const b = parseDate(end);
  const one = (d, withMonth = true, withYear = true) =>
    `${DOW[d.getDay()]} ${d.getDate()}${withMonth ? ` ${MON[d.getMonth()]}` : ''}${withYear ? ` ${d.getFullYear()}` : ''}`;
  if (!b || +b === +a) return one(a);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${one(a, !sameMonth, !sameYear)} – ${one(b)}`;
}

/** "in 47 days", "tomorrow", "today", "3 days ago". */
export function countdown(date, today = todayISO()) {
  const n = daysUntil(date, today);
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1) return n >= 21 ? `in ${Math.round(n / 7)} weeks` : `in ${n} days`;
  return n === -1 ? 'yesterday' : `${-n} days ago`;
}

/**
 * Tally one poll.
 * options: [{ id, created_at }]; votes: [{ option_id, player_id, response }]
 * Returns rows sorted best-first: { option, yes: [ids], maybe: [ids], no: [ids], score, leading }
 */
export function tallyPoll(options, votes) {
  const rows = options.map((option, i) => {
    const mine = votes.filter((v) => v.option_id === option.id);
    const pick = (r) => mine.filter((v) => v.response === r).map((v) => v.player_id);
    const yes = pick('yes');
    const maybe = pick('maybe');
    const no = pick('no');
    return { option, yes, maybe, no, score: 2 * yes.length + maybe.length, order: i };
  });
  rows.sort((a, b) => b.score - a.score || a.no.length - b.no.length || a.order - b.order);
  const top = rows[0];
  for (const r of rows) {
    r.leading = !!top && top.score > 0 && r.score === top.score && r.no.length === top.no.length;
  }
  return rows;
}

/** Players (from `playerIds`) who haven't answered every option in the poll. */
export function nonVoters(options, votes, playerIds) {
  const optionIds = new Set(options.map((o) => o.id));
  return playerIds.filter((pid) => {
    const answered = new Set(votes.filter((v) => v.player_id === pid && optionIds.has(v.option_id)).map((v) => v.option_id));
    return options.length > 0 && answered.size < options.length;
  });
}

const cents = (x) => Math.round(x * 100) / 100;

/**
 * The kitty.
 * costs: [{ amount, per_head, paid_by }]; payments: [{ player_id, paid }]; inIds: players who are in.
 * Returns { total, perHead, pot, people: [{ player_id, share, fronted, paid, balance }] }
 *   share   = what this person's part of the trip costs
 *   fronted = money they paid on the group's behalf (e.g. put the house on their card)
 *   paid    = money they've put into the kitty
 *   balance = share − fronted − paid (positive = still owes, negative = is owed)
 *   pot     = money in the kitty that hasn't been spent on a cost paid from the kitty
 */
export function kitty(costs, payments, inIds) {
  const n = inIds.length;
  const totalOf = (c) => (c.per_head ? Number(c.amount) * n : Number(c.amount));
  const total = cents(costs.reduce((s, c) => s + totalOf(c), 0));
  const perHead = n ? cents(costs.reduce((s, c) => s + (c.per_head ? Number(c.amount) : Number(c.amount) / n), 0)) : 0;
  const everyone = [...new Set([...inIds, ...payments.map((p) => p.player_id), ...costs.map((c) => c.paid_by).filter(Boolean)])];
  const people = everyone.map((pid) => {
    const share = inIds.includes(pid) ? perHead : 0;
    const fronted = cents(costs.filter((c) => c.paid_by === pid).reduce((s, c) => s + totalOf(c), 0));
    const paid = cents(payments.filter((p) => p.player_id === pid).reduce((s, p) => s + Number(p.paid || 0), 0));
    return { player_id: pid, share, fronted, paid, balance: cents(share - fronted - paid) };
  });
  const paidIn = payments.reduce((s, p) => s + Number(p.paid || 0), 0);
  const spentFromKitty = costs.filter((c) => !c.paid_by).reduce((s, c) => s + totalOf(c), 0);
  return { total, perHead, pot: cents(paidIn - spentFromKitty), people };
}

/** Organising checklist. Each: { title, weeksOut, match, kinds, why } — `match` spots it already on the jobs list. */
export const JOB_TEMPLATES = [
  { title: 'Book the accommodation', weeksOut: 12, match: /accom|house|airbnb|motel|hotel|room|stay/i, kinds: ['trip'], why: 'Good houses for a big group go early. Get a deposit down once the dates are locked.' },
  { title: 'Book tee times', weeksOut: 8, match: /tee time|tee-time|book.*(course|golf|round)|golf.*book/i, kinds: ['trip', 'round'], why: 'Weekend tee times for a group fill up — ring the clubs once you know numbers.' },
  { title: 'Collect deposits', weeksOut: 8, match: /deposit|kitty|collect|money/i, kinds: ['trip'], why: 'Money in = commitment. Set up the kitty and chase it.' },
  { title: 'Order the trip shirts', weeksOut: 6, match: /shirt|polo|merch|hat/i, kinds: ['trip'], why: 'Printing takes 2–4 weeks. Get sizes from everyone who’s in.' },
  { title: 'Sort cars and who’s driving', weeksOut: 3, match: /car|driv|lift|transport/i, kinds: ['trip', 'round'], why: 'Work out drivers and who goes with who.' },
  { title: 'Book the big dinner', weeksOut: 3, match: /dinner|restaurant|pub|feed/i, kinds: ['trip'], why: 'A group table on a Saturday night needs booking.' },
  { title: 'Confirm numbers with the club', weeksOut: 1, match: /confirm|numbers/i, kinds: ['trip', 'round'], why: 'Courses want final numbers a week out.' },
  { title: 'Check the weather and send final details', weeksOut: 0.5, match: /weather|final details/i, kinds: ['trip', 'round'], why: 'A few days out: weather, meeting times, what to bring.' },
];

export const DEFAULT_BRING = ['Clubs & a dozen balls', 'Trip shirt', 'Golf shoes', 'Cash for side bets', 'Wet-weather gear', 'Sunscreen & hat', 'Esky / drinks', 'Phone charger'];

/**
 * What the admin should think about next. Nothing is automatic.
 * ctx: { polls, items, rsvps, costs, groups, playerIds, today }
 * Returns [{ key, title, why, when, tab, action? }] — action: { type: 'job', title } | { type: 'bring' }
 */
export function suggestions(plan, ctx) {
  const { polls = [], items = [], rsvps = [], costs = [], groups = [], playerIds = [], today = todayISO() } = ctx;
  const out = [];
  const days = plan.start_date ? daysUntil(plan.start_date, today) : null;
  const weeks = days == null ? null : days / 7;
  const isTrip = plan.kind === 'trip';
  const openPoll = (k) => polls.some((p) => p.kind === k && p.status === 'open');
  const jobs = items.filter((i) => i.kind === 'job');
  const replied = new Set(rsvps.map((r) => r.player_id));
  const inCount = rsvps.filter((r) => r.status === 'in').length;

  if (!plan.start_date && !openPoll('dates')) {
    out.push({ key: 'dates', title: 'Put up a date vote', why: 'Offer 3–4 options, ideally 3+ months out so everyone can clear the calendar.', when: 'Now', tab: 'vote' });
  }
  if (!plan.location_name && !openPoll('location')) {
    out.push({ key: 'location', title: isTrip ? 'Put up a location vote' : 'Pick the course', why: 'Let the lads suggest places with a link and rough cost per head, then vote.', when: 'Now', tab: 'vote' });
  }
  const missing = playerIds.filter((id) => !replied.has(id)).length;
  if (missing > 0 && !plan.rsvp_locked) {
    out.push({ key: 'chase', title: `Chase ${missing} who haven’t said if they’re in`, why: 'Send a nudge to Messenger or a phone notification from the Who’s in tab.', when: 'Now', tab: 'people' });
  }
  if (!plan.rsvp_locked && plan.start_date && weeks != null && weeks <= 8) {
    out.push({ key: 'lock', title: 'Lock in who’s coming', why: 'Lock the list so you can book rooms, tee times and split costs on real numbers.', when: weeks <= 6 ? 'Overdue' : 'Soon', tab: 'people' });
  }
  for (const t of JOB_TEMPLATES) {
    if (!t.kinds.includes(plan.kind)) continue;
    if (jobs.some((j) => t.match.test(j.title))) continue;
    const due = weeks == null ? 'Once dates are set' : weeks <= t.weeksOut ? (weeks <= t.weeksOut / 2 ? 'Overdue' : 'Now') : `${t.weeksOut >= 1 ? `${t.weeksOut} weeks` : 'a few days'} out`;
    out.push({ key: `job:${t.title}`, title: t.title, why: t.why, when: due, tab: 'jobs', action: { type: 'job', title: t.title } });
  }
  if (isTrip && costs.length === 0) {
    out.push({ key: 'kitty', title: 'Set up the kitty', why: 'Add the big costs (house, green fees) — the app works out everyone’s share.', when: plan.start_date ? 'Now' : 'Once dates are set', tab: 'kitty' });
  }
  if (isTrip && plan.rsvp_locked && !groups.some((g) => g.kind === 'room')) {
    out.push({ key: 'rooms', title: 'Allocate rooms', why: 'Add the rooms and beds, then run the live draw — or set them by hand.', when: 'Now', tab: 'groups' });
  }
  if (!items.some((i) => i.kind === 'bring')) {
    out.push({ key: 'bring', title: 'Add a what-to-bring list', why: 'Start from the usual list and edit it.', when: 'Any time', tab: 'details', action: { type: 'bring' } });
  }
  if (days != null && days <= 21 && !items.some((i) => i.kind === 'day')) {
    out.push({ key: 'days', title: 'Write the day-by-day plan', why: 'Tee times, meeting points, dinners — so nobody has to ask in the chat.', when: 'Now', tab: 'details' });
  }
  const rank = { Overdue: 0, Now: 1, Soon: 2 };
  return out.sort((a, b) => (rank[a.when] ?? 3) - (rank[b.when] ?? 3));
}

/** A calendar file (.ics) for the plan's dates — opens in Apple/Google/Outlook calendars. */
export function icsFor(plan, url = '') {
  const a = parseDate(plan.start_date);
  if (!a) return null;
  const b = parseDate(plan.end_date) || a;
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1); // all-day end is exclusive
  const d8 = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
  const where = [plan.location_name, plan.address].filter(Boolean).join(', ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LGC Golf//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:plan-${plan.id}@lgc-golf`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d8(a)}`,
    `DTEND;VALUE=DATE:${d8(end)}`,
    `SUMMARY:${esc(`⛳ ${plan.name}`)}`,
    where ? `LOCATION:${esc(where)}` : null,
    `DESCRIPTION:${esc(`${plan.brief || ''}${url ? `\n\nDetails: ${url}` : ''}`.trim())}`,
    'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${plan.name} is a week away`)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/** A ready-to-paste Messenger message. */
export function nudgeText(kind, { plan, names = [], url = '', extra = '' }) {
  const who = names.length ? names.join(', ') : 'everyone';
  const lines = {
    votes: `🗳️ ${plan.name}: still waiting on votes from ${who}. Takes 10 seconds 👇`,
    rsvp: `🙋 ${plan.name}: are you in? Still need to hear from ${who} 👇`,
    kitty: `💰 ${plan.name} kitty: ${who} still owe${names.length === 1 ? 's' : ''} money.${extra ? ` ${extra}` : ''} Check your balance 👇`,
    details: `⛳ ${plan.name}${plan.start_date ? ` · ${fmtRange(plan.start_date, plan.end_date)}` : ''}${plan.location_name ? ` · ${plan.location_name}` : ''}. All the details are in the app 👇`,
  };
  return `${lines[kind] || lines.details}\n${url}`.trim();
}

/** Google Maps search link from an address or place name. */
export function mapsLink(text) {
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}

export const money = (x) => `$${Number(x || 0).toLocaleString('en-AU', { minimumFractionDigits: Number(x) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
