// The areas we're considering, and the start vote's results by area (ov23, Josh 23 Oct). Pure functions, tested
// (areavote.test.js).
//
// Josh: "You should be able to have an 'Add another area' up the top … then you can submit the full voting for all
// areas. So you can then vote just for the area, or vote within the areas for the courses or locations too." And:
// "the people voting can also just choose to vote area and weekends, or also go into the detail."
import { MAX_STAYS, prefillStayDays, driveBetween } from './tripbuilder.js';
import { km, driveMinutes, fmtDrive } from './tripfinder.js';

export const MAX_AREAS = 5;

/** Add an area to the table (null when it's already there or there are too many). Returns the state change. */
export function addArea(st = {}, region) {
  const list = st.regionOptions || [];
  if (!region || list.includes(region) || list.length >= MAX_AREAS) return null;
  return { regionOptions: [...list, region] };
}
/** Take an area off the table. Its courses and places stay saved (in case it comes back). */
export function removeArea(st = {}, region) {
  return { regionOptions: (st.regionOptions || []).filter((r) => r !== region), ...(st.region === region ? { region: null } : {}) };
}

const SKIP = new Set(['coast', 'north', 'south', 'east', 'west', 'central', 'country', 'valley', 'island', 'mountains', 'peninsula', 'ranges', 'surrounds', 'great', 'upper', 'lakes', 'city']);
const words = (s) => String(s || '').toLowerCase().replace(/&/g, ' ').split(/[^a-z]+/).filter((w) => w.length > 3 && !SKIP.has(w));

/**
 * The region guides (course research, 088) as a browse list for "+ Add another area": each guide's title with the
 * trip builder's areas (stay_areas regions) it covers — matched on the guide's region names and shared words. Areas no
 * guide covers go under "Other areas". guides: [{ title, regions, kind }]; regions: the stay_areas region names.
 * → [{ title, areas: [region] }]
 */
export function guideAreaGroups(guides = [], regions = []) {
  const all = [...new Set(regions || [])].sort();
  const used = new Set();
  const out = [];
  for (const g of guides || []) {
    if (g.kind && g.kind !== 'region') continue;
    const gw = new Set([...(g.regions || []), g.title].flatMap(words));
    const full = new Set((g.regions || []).map((x) => String(x).toLowerCase()));
    const areas = all.filter((r) => full.has(r.toLowerCase()) || words(r).some((w) => gw.has(w)));
    if (!areas.length) continue;
    areas.forEach((r) => used.add(r));
    out.push({ title: g.title, areas });
  }
  const rest = all.filter((r) => !used.has(r));
  if (rest.length) out.push({ title: 'Other areas', areas: rest });
  return out;
}

/** A guide's first sentence about an area (the one-line region note on the ballot), or null. */
export function regionNote(guides = [], region) {
  const g = (guides || []).find((x) => (!x.kind || x.kind === 'region') && guideAreaGroups([x], [region]).some((y) => y.title === x.title && y.areas.includes(region)));
  const body = String(g?.body || '').replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const first = body.split(/(?<=[.!?])\s/)[0];
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
}

const strip = ({ j: _j, ...x }) => x;

/**
 * The start vote's results by area: each area's points, and inside it its courses and places to stay ranked by their
 * points, plus how many people went into the detail for it (answered one of its optional questions).
 * points: votePoints() of the vote's options ('area:<a>', 'areacourse:<a>:<id>', 'stay:<key>');
 * detail: { area: people } (detailCounts in callvote.js).
 * → [{ area, points, leading, courses: [{ id, name, points }], stays: [{ key, name, points }], detail }], best first
 */
export function areaVoteResults(st = {}, points = {}, { courseMap = {}, detail = {} } = {}) {
  const rows = (st.regionOptions || []).map((area, i) => {
    const courses = ((st.areaCourses || {})[area] || [])
      .map((id, j) => ({ id, name: courseMap[id]?.name || st.courses?.[id]?.name || 'Course', points: Number(points[`areacourse:${area}:${id}`]) || 0, j }))
      .sort((a, b) => b.points - a.points || a.j - b.j).map(strip);
    const stays = ((st.areaStays || {})[area] || [])
      .map((s, j) => ({ key: s.key || s.name, name: s.name, points: Number(points[`stay:${s.key || s.name}`]) || 0, j }))
      .sort((a, b) => b.points - a.points || a.j - b.j).map(strip);
    return { area, points: Number(points[`area:${area}`]) || 0, j: i, courses, stays, detail: Number(detail[area]) || 0 };
  }).sort((a, b) => b.points - a.points || a.j - b.j).map(strip);
  const top = rows[0]?.points || 0;
  return rows.map((r) => ({ ...r, leading: top > 0 && r.points === top }));
}

/**
 * "Choose this one" after the vote: the area becomes THE area, its courses go in the vote's order (so the stay days
 * start with the group's favourites) and its best-voted places to stay are ticked for step 2 (the ones with votes, up
 * to MAX_STAYS; none voted = the first ones). Nothing else is lost. → the new state
 */
export function chooseAreaFromVotes(st = {}, area, points = {}, courseMap = {}, { origin = null } = {}) {
  const [row] = areaVoteResults({ ...st, regionOptions: [area] }, points, { courseMap });
  const courses = row ? row.courses.map((c) => c.id) : [];
  const all = (st.areaStays || {})[area] || [];
  const ranked = row ? row.stays.map((s) => all.find((x) => (x.key || x.name) === s.key)).filter(Boolean) : all;
  const voted = row ? row.stays.filter((s) => s.points > 0).length : 0;
  const stays = ranked.slice(0, voted ? Math.min(MAX_STAYS, voted) : MAX_STAYS);
  const map = { ...(st.courses || {}), ...courseMap };
  const days = prefillStayDays((st.days || []).map((d) => (d.leg === 'stay' ? { ...d, options: [] } : d)), courses, map, { stays, stayMax: st.stayMax, origin: origin || st.origin || null, detourMax: st.detourMax });
  return { ...st, region: area, regionOptions: [area], areaCourses: { ...(st.areaCourses || {}), [area]: courses }, stays, days };
}

/**
 * "It's not working — open it up" (Josh, 23 Oct): re-open the area choice with the runner-up from the vote, keeping
 * everything (the chosen area stays on the table, its courses, places, days and tee times stay saved).
 * → { state, runnerUp } (runnerUp null = no other area to go to)
 */
export function reopenArea(st = {}, points = {}) {
  const pool = st.areaPool?.length ? st.areaPool : (st.regionOptions || []);
  const ranked = areaVoteResults({ ...st, regionOptions: pool }, points);
  const runnerUp = ranked.find((r) => r.area !== st.region)?.area || null;
  return { state: { ...st, region: null, regionOptions: pool.length ? pool : (st.region ? [st.region] : []), areaPool: pool }, runnerUp };
}

// ------------------------------------------------------------------ one-line summaries for the vote cards (Josh 08:37)

const money = (n) => (n != null && Number(n) > 0 ? `$${Math.round(Number(n))}` : null);

/**
 * A course on a ballot: "Parkland · ★4 for groups · $45/$50 · about 25 min". research: course_research row (088);
 * course: { mine_avg, others_avg, lat, lng }; from: a stay pin or the area's middle for the drive.
 */
export function courseSummary({ course = {}, research = null, from = null } = {}) {
  const style = research?.details?.style ? research.details.style.charAt(0).toUpperCase() + research.details.style.slice(1) : null;
  const groups = research?.good_for_groups ? `★${research.good_for_groups} for groups` : course.mine_avg != null ? `★${Number(course.mine_avg).toFixed(1)} (ours)` : course.others_avg != null ? `★${Number(course.others_avg).toFixed(1)}` : null;
  const wd = money(research?.fee_weekday); const we = money(research?.fee_weekend);
  const fees = wd && we && wd !== we ? `${wd}/${we}` : wd || we;
  const drive = from && course.lat != null && from.lat != null ? `about ${fmtDrive(driveBetween(from, course))}` : null;
  return [style, groups, fees, drive].filter(Boolean).join(' · ') || null;
}

/**
 * A place to stay on a ballot: "Town · 4 courses within 30 min" (a stay pin) or, for an accommodation idea,
 * "House · sleeps 12 · $250/night · about $63 a head".
 */
export function staySummary({ stay = {}, idea = null, courseIds = [], courseMap = {}, nights = 2, people = 0 } = {}) {
  if (idea) {
    const perNight = idea.total_cost && nights ? Math.round(Number(idea.total_cost) / Math.max(1, nights)) : null;
    const head = idea.total_cost && people ? Math.round(Number(idea.total_cost) / people) : null;
    return [idea.is_list ? 'A shared list' : null, idea.sleeps ? `sleeps ${idea.sleeps}` : null, perNight ? `$${perNight}/night` : null, head ? `about $${head} a head` : null, idea.distance_note || null].filter(Boolean).join(' · ') || null;
  }
  const near = courseIds.map((id) => courseMap[id]).filter((c) => c && c.lat != null && stay.lat != null && driveBetween(stay, c) <= 30).length;
  return [stay.custom ? 'Your pin' : 'Town', `${near} course${near === 1 ? '' : 's'} within 30 min`].join(' · ');
}

/**
 * An area on a ballot: "6 courses within 30 min · about 2 h 30 drive · about $90 a head golf · <guide line>".
 * region: { lat, lng } (its middle); courses: library rows with lat/lng and fees (research).
 */
export function areaSummary({ region = null, courses = [], research = {}, origin = null, note = null } = {}) {
  const near = region ? courses.filter((c) => c && c.lat != null && driveMinutes(km(region, c)) <= 30).length : 0;
  const drive = region && origin ? `about ${fmtDrive(driveMinutes(km(origin, region)))} drive` : null;
  const fees = courses.map((c) => Number(research[c.id]?.fee_weekend ?? research[c.id]?.fee_weekday)).filter((n) => n > 0);
  const avg = fees.length ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) : null;
  return [region ? `${near} course${near === 1 ? '' : 's'} within 30 min` : null, drive, avg ? `about $${avg} a round` : null, note].filter(Boolean).join(' · ') || null;
}
