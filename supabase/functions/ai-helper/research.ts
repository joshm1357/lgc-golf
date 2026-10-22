// ai-helper — Josh's course research (088, ov17, 22 Oct 2026) for the trip planner: compact key facts for each course
// the planner looks up, and a region_guide tool with the region's notes. Pure functions only (index.ts reads the
// tables as the person; research.test.ts tests these). Everything here is reference data, shown to the model inside
// <data> like any other tool result — information, never instructions.
import { clean } from './util.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

/** The columns index.ts reads from course_research. */
export const RESEARCH_COLS = 'library_id,name,town,state,region,fee_weekday,fee_weekend,access_type,good_for_groups,drive_from_sydney_hours,booking_url,group_enquiry_url,phone,details,last_checked';

/** How a group gets a game, in plain words (the guide's access types). */
export const ACCESS_WORDS: Record<string, string> = {
  public: 'public — anyone can book',
  semi_private: 'members’ club that takes visitors at set times',
  handicap_visitor: 'needs a Golf ID / handicap, set days only',
  stay_and_play_only: 'stay-and-play only — you need to stay on site',
  corporate_or_event: 'only as a group golf day booked with the club',
  member_intro_only: 'members and their guests only — not for a group',
  closed: 'closed',
};

const money = (n: unknown) => (n == null || n === '' ? null : `$${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}`);
const cut = (v: unknown, n: number) => clean(v, n) || null;
/** Drop "(club golf page, Oct 2026)"-style source notes so the short form reads well; the full words stay in the db. */
const plain = (v: unknown, n: number) => cut(String(v ?? '').replace(/\s*\((?:[^()]*\b(?:page|site|calendar|directory|listing|Oct|Sep|Aug|20\d\d)\b[^()]*)\)/g, ''), n);

/**
 * One course's researched facts, made small for the model: about 10 short fields, only the ones we have.
 * row: a course_research row (RESEARCH_COLS).
 */
export function researchFacts(row: Any) {
  if (!row) return null;
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  const fees = [row.fee_weekday != null ? `${money(row.fee_weekday)} weekdays` : null, row.fee_weekend != null && row.fee_weekend !== row.fee_weekday ? `${money(row.fee_weekend)} weekends` : null].filter(Boolean).join(', ');
  const groups = row.good_for_groups ? `${row.good_for_groups}/5${d.good_for_groups ? ` — ${plain(String(d.good_for_groups).replace(/^\d\s*-\s*/, ''), 70)}` : ''}` : null;
  const out: Record<string, unknown> = {
    style: cut(d.style, 40),
    difficulty: cut(String(d.difficulty || '').replace(/^\d\s*-\s*/, ''), 60),
    rankings: cut(d.rankings, 90),
    access: row.access_type ? (ACCESS_WORDS[row.access_type] || row.access_type) : null,
    how_in: plain(d.access_route, 180),
    visitors: plain(d.visitor_times, 140),
    members: plain(d.members_times, 140),
    fees: fees || plain(d.green_fee_weekday_aud, 70),
    group_rates: plain(d.twilight_or_group_rates, 100),
    book: row.booking_url || null,
    group_enquiry: row.group_enquiry_url || null,
    phone: cut(row.phone, 60),
    stay_and_play: plain(d.stay_and_play, 120),
    good_for_groups: groups,
    signature: cut(d.signature_features, 90),
    drive_hours_from_sydney: row.drive_from_sydney_hours != null ? Number(row.drive_from_sydney_hours) : (d.drive_from_sydney_cbd ? cut(d.drive_from_sydney_cbd, 50) : null),
    deals: cut(d.on_deal_sites, 70),
    checked: row.last_checked || null,
  };
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k];
  return Object.keys(out).length ? out : null;
}

/** Courses (from the library search) with their facts added where we have research for them. `max` courses get facts
 *  (the nearest first), so a 4-place search doesn't send the model pages of text. */
export function withFacts<T extends { id: string }>(courses: T[], rows: Any[], max = 6): (T & { facts?: Any; closed?: boolean })[] {
  const by = new Map<string, Any>();
  for (const r of rows || []) if (r?.library_id && !by.has(r.library_id)) by.set(r.library_id, r);
  return (courses || []).map((c, i) => {
    const r = by.get(c.id);
    if (!r) return c;
    if (r.access_type === 'closed') return { ...c, closed: true };
    const f = i < max ? researchFacts(r) : null;
    return f ? { ...c, facts: f } : c;
  });
}

/** Researched courses near a place that the library search didn't return (e.g. a listing with no map position yet):
 *  [{ id, name, area, holes: 0, km: null, facts }]. */
export function researchExtras(rows: Any[], have: Set<string>, max = 4) {
  return (rows || []).filter((r) => r?.library_id && !have.has(r.library_id) && r.access_type !== 'closed').slice(0, max).map((r) => ({
    id: r.library_id, name: clean(r.name, 60), area: clean([r.town, r.state].filter(Boolean).join(' '), 40) || null, holes: 0, km: null,
    facts: researchFacts(r),
  }));
}

/** A place name made safe for a PostgREST ilike filter: letters, numbers, spaces and hyphens only. */
export const placeWord = (s: unknown) => clean(s, 40).replace(/[^A-Za-z0-9 '-]+/g, ' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ The region guide

export const REGION_TOOL = {
  name: 'region_guide',
  description: 'Josh’s research notes for one golf region: the course clusters, best base, member times and weekends to avoid, booking and deal sites, and a rough cost each. Give a region or town, e.g. "Hunter Valley", "Mornington Peninsula", "Port Stephens". Also "access" (how groups get on at private clubs), "member times" or "booking" (platforms and deal sites). One call per region — it costs a turn.',
  input_schema: { type: 'object', properties: { region: { type: 'string', description: 'A region or town, or "access" / "member times" / "booking"' } }, required: ['region'], additionalProperties: false },
};

const words = (s: string) => String(s || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'nsw', 'vic', 'qld', 'tas', 'act', 'golf', 'club', 'course', 'courses', 'region', 'near', 'around', 'trip', 'weekend']);

/** Split a section into paragraphs (blank lines; "### " headings start a new one). */
const paragraphs = (body: string) => String(body || '').replace(/\r/g, '').split(/\n\s*\n|\n(?=### )/).map((p) => p.trim()).filter(Boolean);

/**
 * The best guide section for a question, trimmed to `max` characters: the paragraphs that mention the question's
 * words first (e.g. "Port Stephens" → that paragraph of the Hunter/Newcastle/Port Stephens section), then its booking
 * notes. guides: [{ key, kind, title, state, regions, body }]. → { title, key, text, more } or { none }.
 */
export function pickGuide(guides: Any[], query: string, max = 2400) {
  const q = clean(query, 60);
  const qw = words(q);
  const ql = q.toLowerCase();
  const list = (guides || []).filter((g) => g && g.body);
  if (!list.length) return { none: 'No region notes in the app yet.' };
  // General sections by keyword.
  const general = (k: string) => list.find((g) => g.key === k);
  if (/\b(access|private|handicap|intro|letter|corporate)\b/i.test(ql) && general('access-types')) return shaped(general('access-types'), [], max);
  if (/\bmember/i.test(ql) && general('member-times')) return shaped(general('member-times'), [], max);
  if (/\b(book|booking|deal|deals|platform|miclub|golfnow|pass)\b/i.test(ql) && general('booking-platforms')) return shaped(general('booking-platforms'), [], max);
  let best: Any = null;
  let bestScore = 0;
  for (const g of list.filter((x) => x.kind === 'region')) {
    const regions = (g.regions || []).map((r: string) => r.toLowerCase());
    let s = 0;
    if (regions.some((r: string) => r === ql)) s += 20;
    if (regions.some((r: string) => r.includes(ql) || (ql.length >= 4 && ql.includes(r)))) s += 8;
    const title = String(g.title || '').toLowerCase();
    for (const w of qw) {
      if (title.includes(w)) s += 5;
      if (regions.some((r: string) => r.includes(w))) s += 3;
      const hits = String(g.body).toLowerCase().split(w).length - 1;
      s += Math.min(hits, 6);
    }
    if (s > bestScore) { best = g; bestScore = s; }
  }
  if (!best) return { none: `No region notes for “${q}”. Try a broader region, e.g. "Hunter Valley" or "South Coast".` };
  return shaped(best, qw, max);
}

function shaped(g: Any, qw: string[], max: number) {
  const paras = paragraphs(g.body);
  const score = (p: string) => qw.reduce((s, w) => s + (p.toLowerCase().includes(w) ? (p.slice(0, 120).toLowerCase().includes(w) ? 3 : 1) : 0), 0);
  // The paragraphs about the place asked for first (by score), keeping the guide's order among equals; then the
  // section's booking notes; then the rest, until it's full.
  const order = paras.map((p, i) => ({ p, i, s: score(p), booking: /^\*\*(booking|deal)/i.test(p) || /^### Booking/i.test(p) }))
    .sort((a, b) => (b.s - a.s) || (Number(b.booking) - Number(a.booking)) || (a.i - b.i));
  let text = '';
  let used = 0;
  for (const x of order) {
    if (text.length + x.p.length + 2 > max) {
      if (!text) { text = x.p.slice(0, max - 1) + '…'; used++; }
      continue;
    }
    text += (text ? '\n\n' : '') + x.p;
    used++;
  }
  return { key: g.key, title: clean(g.title, 120), text, more: used < paras.length ? 'Trimmed — ask about a town in this region for more.' : undefined };
}

// ------------------------------------------------------------------ The prompt (added to the planner's)

export const RESEARCH_RULES = `USING THE COURSE RESEARCH:
- courses_near and find_course give a course its researched "facts" when we have them: how a group gets on (access, how_in), visitor and member times, fees, how to book, stay-and-play, good for groups (1–5), drive hours from Sydney, deal sites, when it was checked. region_guide(region) gives the region's notes: clusters, best base, weekends to avoid, rough cost each. Ask for the region guide in the same turn as courses_near (both at once) — once per region.
- Member times: plan rounds around them and say it plainly, e.g. "Members have Saturday mornings — book after 11:30" or "Fri and Sun are the easy days there".
- Access: never suggest a "members and their guests only" course for a group. "Needs a Golf ID / handicap": at most one bucket-list round, in fours, on its visitor days — say so. "Stay-and-play only": say it plainly ("stay-and-play only — you'd need to stay at the resort"). "Only as a group golf day": say that's how to get on. Never suggest a closed course.
- Prefer courses rated 4–5 for groups; give the reason in a few words. For 8 or more, say to book direct with the golf shop (online calendars usually take one or two four-balls). Mention a deal site or regional pass only when it clearly fits (e.g. the Murray River Card for 3+ Murray rounds), and stay-and-play when it's the easy option.
- Fees and times are research, not a quote: when they matter, add "check with the club". Never make up a fee, time or phone number.
- Keep replies short: one useful fact per course, not a list of everything.`;
