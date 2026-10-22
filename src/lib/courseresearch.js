// Josh's course research (088, ov17): what the app shows from a course_research row — the "About this course for
// groups" block on the course page and the trip builder, a one-line summary for the trip builder's course rows, and
// what the person calling the course needs (phone, group enquiry and booking links, a member-times warning).
// Pure functions; the rows are read in components/CourseResearch.jsx.

export const ACCESS = {
  public: 'Public — anyone can book',
  semi_private: 'Members’ club — visitors at set times',
  handicap_visitor: 'Golf ID / handicap needed, set days only',
  stay_and_play_only: 'Stay-and-play only — stay on site to play',
  corporate_or_event: 'Only as a group golf day booked with the club',
  member_intro_only: 'Members and their guests only — not for groups',
  closed: 'Closed',
};
const SHORT_ACCESS = {
  public: 'Public', semi_private: 'Visitors at set times', handicap_visitor: 'Handicap needed', stay_and_play_only: 'Stay-and-play only',
  corporate_or_event: 'Group days only', member_intro_only: 'Members only', closed: 'Closed',
};

const str = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
/** Drop "(club golf page, Oct 2026)"-style source notes for the short forms (the sources list carries them). */
export const tidy = (v) => str(v).replace(/\s*\((?:[^()]*\b(?:page|site|calendar|directory|listing|Oct|Sep|Aug|20\d\d)\b[^()]*)\)/g, '').trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Only http(s) links are ever shown as links. */
export const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(str(u)) ? str(u) : null);
const money = (n) => (n == null || n === '' ? null : `$${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}`);

export function feesText(r) {
  if (!r) return '';
  const wd = money(r.fee_weekday);
  const we = money(r.fee_weekend);
  if (wd && we && wd !== we) return `${wd} weekdays · ${we} weekends`;
  if (wd || we) return `${wd || we} (18 holes)`;
  return cut(tidy(r.details?.green_fee_weekday_aud), 80);
}

export const stars = (n) => (n >= 1 && n <= 5 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

/** "Researched Oct 2026 — check with the club". */
export function checkedLabel(r) {
  const d = r?.last_checked ? new Date(`${String(r.last_checked).slice(0, 10)}T00:00:00`) : null;
  const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }) : null;
  return when ? `Researched ${when} — check with the club` : 'Not checked yet — check with the club';
}

/** The block's rows: [{ label, value }], only the ones we have. */
export function aboutLines(r) {
  if (!r) return [];
  const d = r.details || {};
  const groups = r.good_for_groups ? `${stars(r.good_for_groups)}${d.good_for_groups ? ` ${tidy(String(d.good_for_groups).replace(/^\d\s*-\s*/, ''))}` : ''}` : '';
  return [
    ['Style', [str(d.style), tidy(String(d.difficulty || '').replace(/^\d\s*-\s*/, ''))].filter(Boolean).join(' · ')],
    ['Ranked', tidy(d.rankings)],
    ['Getting a game', [ACCESS[r.access_type] || '', tidy(d.access_route)].filter(Boolean).join('. ')],
    ['Fees', [feesText(r), tidy(d.twilight_or_group_rates)].filter(Boolean).join('. ')],
    ['Visitor times', tidy(d.visitor_times)],
    ['Members have', tidy(d.members_times)],
    ['How to book', tidy(d.group_bookings_how) || tidy(d.booking_platform)],
    ['Stay and play', tidy(d.stay_and_play)],
    ['Good for groups', groups],
    ['Drive from Sydney', r.drive_from_sydney_hours != null ? `about ${Number(r.drive_from_sydney_hours)} h` : tidy(d.drive_from_sydney_cbd)],
  ].filter(([, v]) => v).map(([label, value]) => ({ label, value: cut(value, 320) }));
}

/** Links for the block and the call: booking, group enquiry, website (each only if a real link), phone, email. */
export function contactLinks(r) {
  if (!r) return {};
  const tel = str(r.phone).match(/\(?0\d\)?[\d ]{7,12}\d|1[38]00[\d ]{6,8}\d|13 ?\d{2} ?\d{2}/);
  const mail = str(r.email).match(/[^\s;,@]+@[^\s;,@]+\.[a-z]{2,}/i);
  return {
    booking: safeUrl(r.booking_url), enquiry: safeUrl(r.group_enquiry_url), website: safeUrl(r.website),
    phone: str(r.phone) || null, tel: tel ? tel[0].replace(/[^\d+]/g, '') : null, email: mail ? mail[0] : null,
  };
}

/** Is there a stay-and-play option? (Anything written that isn't "no …" / "none".) */
export const hasStayPlay = (r) => r?.access_type === 'stay_and_play_only'
  || (!!str(r?.details?.stay_and_play) && !/^(no\b|none|n\/a|not found|nil)/i.test(str(r?.details?.stay_and_play)));

/** One line for a trip builder course row: "Public · $55 weekdays · groups ★★★★ · members Sat am". */
export function shortFacts(r) {
  if (!r) return '';
  const d = r.details || {};
  const fees = r.fee_weekday != null || r.fee_weekend != null ? `$${Number(r.fee_weekday ?? r.fee_weekend)}${r.fee_weekend != null && r.fee_weekday != null && Number(r.fee_weekend) !== Number(r.fee_weekday) ? `–${Number(r.fee_weekend)}` : ''}` : '';
  return [
    SHORT_ACCESS[r.access_type] || '',
    fees,
    r.good_for_groups ? `groups ${stars(r.good_for_groups)}` : '',
    hasStayPlay(r) ? 'stay & play' : '',
  ].filter(Boolean).join(' · ');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_WORDS = [/\bsun(day)?s?\b/i, /\bmon(day)?s?\b/i, /\btue(s|sday)?s?\b/i, /\bwed(nesday)?s?\b/i, /\bthu(r|rs|rsday)?s?\b/i, /\bfri(day)?s?\b/i, /\bsat(urday)?s?\b/i];

/**
 * For the person calling the course: what members have, and which of the trip's days it touches.
 * dates: ['2027-03-13', …]. → { text, days: ['Sat'] } or null when we don't know the member times.
 */
export function memberWarning(r, dates = []) {
  const m = tidy(r?.details?.members_times);
  const closedToGroups = r?.access_type === 'member_intro_only' ? 'Members and their guests only — a group can’t book here.' : '';
  if (!m && !closedToGroups) return null;
  const tripDays = [...new Set((dates || []).map((x) => new Date(`${String(x).slice(0, 10)}T00:00:00`).getDay()).filter((n) => n >= 0))];
  const hit = tripDays.filter((n) => DAY_WORDS[n].test(m)).map((n) => DAYS[n]);
  const text = closedToGroups || `Members have: ${cut(m, 220)}${hit.length ? ` — that touches your ${hit.join(' and ')}: ask for times outside it.` : ' — ask for times outside these.'}`;
  return { text, days: hit };
}
