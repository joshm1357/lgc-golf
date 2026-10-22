// Course research import (088, ov17, 22 Oct 2026): turns Josh's research files into the payload for
// public.import_course_research(p_rows, p_guides). Pure functions only (no files, no network), so they're tested
// with Vitest (parse.test.js) and used by scripts/import-course-research.mjs.
//
//   golf_courses_australia.csv  — one row a course, 47 columns of free text ("?" = not sure, dates and sources inline)
//   golf_trip_region_guide.md   — access types, member times, booking platforms and deal sites, then one section a region
//
// Typed columns are filled only when the text is clear; the words as written always go into `details`, so nothing
// is lost. The matching to the course library happens in the database (it has the library); matchCourse() below is
// the same rules in JavaScript, for tests and for a dry run against an exported library.

export const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
export const ACCESS_TYPES = ['public', 'semi_private', 'handicap_visitor', 'stay_and_play_only', 'corporate_or_event', 'member_intro_only', 'closed'];

// Columns kept in their own (typed or verbatim) place, so they're left out of `details`.
const NOT_IN_DETAILS = new Set(['name', 'suburb_or_town', 'state', 'region', 'sources', 'website', 'phone', 'email', 'access_type']);

/** Cut, trim and strip control characters. */
export function clean(v, max = 1500) {
  const t = String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** A small CSV reader (RFC 4180: quotes, doubled quotes, commas and new lines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.filter((r) => r.some((x) => x.trim() !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * The name without the usual words — the same as the database's private.course_key (040): "Bowral Golf Club",
 * "Bowral GC" and "The Bowral Country Club" all give "bowral". "&" goes with the punctuation (and "and" is one of the
 * words), so "Cape Schanck & Co" and "Cape Schanck and Co" match.
 */
export function courseKey(name) {
  return String(name || '').toLowerCase()
    .replace(/\b(golf|country|club|course|links|gc|cc|inc|ltd|the|and|of|resort|sporting|recreation|reserve)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
/** A town or area, for comparing: lower case, letters and numbers only. */
export const townKey = (t) => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

export const importKey = (name, state) => `${courseKey(name)}|${String(state || '').toUpperCase()}`;

/**
 * The names to try when matching: the name without anything in brackets or a "?", then what's in the brackets when
 * it's one name ("Easts Leisure & Golf (Maitland Golf Club)" → "eastsleisure", "maitland"; "Palmer Gold Coast
 * (formerly Robina Woods)" → "palmergoldcoast", "robinawoods"). A list in brackets ("(West, East)") is left out.
 * Keys under 3 letters are left out. At most 4.
 */
export function matchKeys(name, town = '') {
  const n = String(name || '').replace(/\?/g, ' ');
  const towns = townKeys(town);
  const out = [];
  const add = (t) => { const k = courseKey(t); if (k.length >= 3 && !out.includes(k)) out.push(k); };
  add(n.replace(/\([^)]*\)?/g, ' '));
  for (const m of n.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1].trim();
    const was = inner.match(/^(formerly|former|now|aka)\s+(.+)$/i);
    if (was) { for (const p of was[2].split('/')) add(p); continue; }
    if (/[,+&/]/.test(inner)) continue; // a list of courses: "(West, East)", "(Open & Legends)"
    // A plain word about the course ("(closed)", "(South Course)", "(Whitsunday mainland)") isn't another name — but
    // "(Taree Golf Course)" is.
    const named = /\b(golf|club|country|links)\b/i.test(inner);
    if (/\b(closed|course|courses|only|north|south|east|west|legends|champions|mainland|open)\b/i.test(inner) && !named) continue;
    if (!named && towns.includes(courseKey(inner))) continue; // "(Bowral)" is where it is, not what it's called
    add(inner);
  }
  return out.slice(0, 4);
}

/**
 * The towns to try: "Marrangaroo (Lithgow)" → marrangaroo, lithgow; "Pambula / Merimbula" → both; "Kew (185 Kendall
 * Rd)" → kew (a part with a number in it is a street address, so it's dropped). At most 6.
 */
export function townKeys(town) {
  const out = [];
  for (const part of String(town || '').replace(/\?/g, ' ').split(/[()/,;~]|\bnear\b|\bopp\.|\bto\b/i)) {
    if (/\d/.test(part)) continue;
    const k = townKey(part.replace(/\b(area|region|cbd)\b/gi, ' '));
    if (k.length >= 3 && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 6);
}

const yearsIn = (t) => [...String(t).matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));

/** "55 for 18 walking; cart +50 (club golf page, Oct 2026)" → 55. Anything unclear ("?", "see the PDF", an old
 *  2022 figure, two courses' prices) → null; the words are kept in details. */
export function parseFee(v) {
  const t = clean(v, 400);
  if (!t) return null;
  const m = t.match(/^~?\s*\$?\s*(\d{1,4}(?:\.\d{1,2})?)(?!\d)(\s*\?)?/);
  if (!m || m[2]) return null;
  const ys = yearsIn(t);
  if (ys.length && Math.max(...ys) < 2025) return null; // a figure from years ago isn't "clear"
  const n = Number(m[1]);
  return n > 0 && n <= 2000 ? n : null;
}

/** "3.0", "2.0 h", "~7", "2.0-2.5 h", "45 min" → hours. "fly SYD–MEL + …" → null (a flight, not a drive). */
export function parseDriveHours(v) {
  const t = clean(v, 200).toLowerCase();
  if (!t || /^fly\b/.test(t)) return null;
  const min = t.match(/^~?\s*(\d{1,3})\s*min/);
  if (min) return Math.round((Number(min[1]) / 60) * 100) / 100;
  const m = t.match(/^~?\s*(\d{1,2}(?:\.\d{1,2})?)(?!\d)(\s*\?)?/);
  if (!m || m[2]) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 30 ? n : null;
}

/** A whole number at the start ("18", "18 (10 holes with alternate tees)"), unless it's marked "?" or out of range. */
export function parseLeadingInt(v, lo, hi) {
  const t = clean(v, 200);
  const m = t.match(/^(\d{1,3})(?!\d)(\s*\?)?/);
  if (!m || m[2]) return null;
  const n = Number(m[1]);
  return n >= lo && n <= hi ? n : null;
}
export const parseHoles = (v) => parseLeadingInt(v, 1, 72);
export const parsePar = (v) => parseLeadingInt(v, 27, 80);

/** "No - walking permitted" → false; "Yes - cart included", "Cart included in 18-hole rate" → true; "likely…?" → null. */
export function parseCartRequired(v) {
  const t = clean(v, 200).toLowerCase();
  if (!t || t.includes('?') || /^likely|^maybe|^unknown/.test(t)) return null;
  if (/^no\b/.test(t)) return false;
  if (/^yes\b/.test(t) || /^(cart )?included\b/.test(t) || /carts?-only/.test(t)) return true;
  return null;
}

/** "4 - ranked course, …" → 4. */
export function parseGoodForGroups(v) {
  const m = clean(v, 300).match(/^([1-5])(?![\d.])/);
  return m ? Number(m[1]) : null;
}

export function parseAccessType(v) {
  const t = clean(v, 60).toLowerCase().replace(/[\s-]+/g, '_');
  return ACCESS_TYPES.includes(t) ? t : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Oct 2026", "Oct 2026 (fees not confirmed)", "2026-10-14" → a date (the 1st when only the month is known). */
export function parseChecked(v) {
  const t = clean(v, 200);
  const iso = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d\d)\b/);
  if (!m) return null;
  return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-01`;
}

const URL_RE = /https?:\/\/[^\s,;)"'<>\]]+/gi;
const trimUrl = (u) => u.replace(/[.,;:!?)]+$/, '');
/** Every web link in the text, in order, without repeats. */
export function urlsIn(v, max = 30) {
  const out = [];
  for (const m of String(v || '').matchAll(URL_RE)) {
    const u = trimUrl(m[0]);
    if (u.length <= 400 && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
export const firstUrl = (v) => urlsIn(v, 1)[0] || null;

/** One CSV row → one payload row for import_course_research. Returns null for a row with no usable name or state. */
export function toPayloadRow(r) {
  const name = clean(r.name, 120);
  const state = clean(r.state, 10).toUpperCase();
  if (name.length < 2 || !STATES.includes(state)) return null;
  const typed = {
    holes: parseHoles(r.holes), par: parsePar(r.par), good_for_groups: parseGoodForGroups(r.good_for_groups),
    drive_from_sydney_hours: parseDriveHours(r.drive_from_sydney_cbd), cart_required: parseCartRequired(r.cart_required),
    booking_url: firstUrl(r.online_booking_url), group_enquiry_url: firstUrl(r.group_enquiry_url), last_checked: parseChecked(r.last_checked),
  };
  // The words as written go in details — unless they say nothing more than the typed column ("18", "No", a bare link,
  // "Oct 2026").
  const same = {
    holes: (t) => t === String(typed.holes), par: (t) => t === String(typed.par), good_for_groups: (t) => t === String(typed.good_for_groups),
    drive_from_sydney_cbd: (t) => typed.drive_from_sydney_hours != null && /^\d+(\.\d+)?$/.test(t),
    cart_required: (t) => /^(yes|no)$/i.test(t), online_booking_url: (t) => t === typed.booking_url,
    group_enquiry_url: (t) => t === typed.group_enquiry_url, last_checked: (t) => /^[A-Z][a-z]{2} 20\d\d$/.test(t),
  };
  const details = {};
  for (const [k, v] of Object.entries(r)) {
    if (NOT_IN_DETAILS.has(k)) continue;
    const t = clean(v);
    if (t && !(same[k] && same[k](t))) details[k] = t;
  }
  const keys = matchKeys(name, r.suburb_or_town);
  const towns = townKeys(r.suburb_or_town);
  const town = clean(r.suburb_or_town, 80) || null;
  return {
    import_key: importKey(name, state),
    // Only sent when they differ from the plain name and town (the database works those out itself).
    ...(keys.length === 1 && keys[0] === courseKey(name) ? {} : { match_keys: keys }),
    ...(towns.length === 1 && towns[0] === townKey(town) ? {} : { match_towns: towns }),
    name,
    town: clean(r.suburb_or_town, 80) || null,
    state,
    region: clean(r.region, 80) || null,
    holes: parseHoles(r.holes),
    par: parsePar(r.par),
    fee_weekday: parseFee(r.green_fee_weekday_aud),
    fee_weekend: parseFee(r.green_fee_weekend_aud),
    cart_required: parseCartRequired(r.cart_required),
    access_type: parseAccessType(r.access_type),
    good_for_groups: parseGoodForGroups(r.good_for_groups),
    drive_from_sydney_hours: parseDriveHours(r.drive_from_sydney_cbd),
    booking_url: firstUrl(r.online_booking_url),
    group_enquiry_url: firstUrl(r.group_enquiry_url),
    website: firstUrl(r.website),
    phone: clean(r.phone, 200) || null,
    email: clean(r.email, 200) || null,
    details,
    sources: urlsIn(r.sources),
    last_checked: parseChecked(r.last_checked),
  };
}

/** All rows. Two rows with the same name and state (rare) get the town added to the key so neither is lost. */
export function toPayloadRows(csvRows) {
  const out = [];
  const seen = new Map();
  const skipped = [];
  for (const r of csvRows) {
    const p = toPayloadRow(r);
    if (!p) { skipped.push(clean(r.name, 80) || '(no name)'); continue; }
    if (seen.has(p.import_key)) p.import_key = `${p.import_key}|${townKey(p.town) || out.length}`;
    seen.set(p.import_key, true);
    out.push(p);
  }
  return { rows: out, skipped };
}

// ------------------------------------------------------------------ Matching (same rules as the database)

/** "Bowral NSW" → { town: 'bowral', state: 'NSW' }. */
export function splitArea(area) {
  const t = clean(area, 120);
  const m = t.match(/^(.*?)[\s,]*\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$/i);
  return m ? { town: townKey(m[1]), state: m[2].toUpperCase() } : { town: townKey(t), state: null };
}
const townMatches = (towns, l) => {
  const a = splitArea(l.area).town;
  return !!a && towns.some((t) => a === t || a.startsWith(t) || t.startsWith(a));
};
const km = (a, b) => {
  if (a?.lat == null || b?.lat == null) return null;
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
};

/**
 * Find the library course for a research row. library: [{ id, name, area, lat, lng, hidden }].
 * The names tried are matchKeys(name) (the name, and a single name in brackets); the towns are townKeys(town).
 *   exact — same name (without "Golf Club", "GC" …), same state, same town.
 *   near  — same name and state in another town (the nearest to the row's town if there are several), or a name that
 *           contains the other (e.g. "Kiama" / "Kiama Downs") in the same town.
 *   new   — nothing found and the course isn't closed: the database adds it to the library as a listing.
 *   unmatched — nothing found and it's closed (or the name is too short to match safely).
 * → { match, id }
 */
export function matchCourse(row, library) {
  const keys = row.match_keys || matchKeys(row.name, row.town);
  const towns = row.match_towns || townKeys(row.town);
  const closed = row.access_type === 'closed';
  if (!keys.length) return { match: 'unmatched', id: null };
  // Never a driving range.
  const inState = library.filter((l) => !l.hidden && splitArea(l.area).state === row.state && !/driving range/i.test(l.name));
  const ki = (l) => keys.indexOf(courseKey(l.name));
  const same = inState.filter((l) => ki(l) >= 0);
  const byName = (a, b) => (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : String(a.id).localeCompare(String(b.id)));
  const here = same.filter((l) => townMatches(towns, l))
    .sort((a, b) => ki(a) - ki(b) || Number(towns.includes(splitArea(b.area).town)) - Number(towns.includes(splitArea(a.area).town)) || byName(a, b));
  if (here.length) return { match: 'exact', id: here[0].id };
  // Same name in another town (OpenStreetMap often names the suburb next door) — within 40 km of the row's town when
  // the library knows where that is ("Wentworth GC, Orange" isn't the one at Wentworth).
  const pts = inState.filter((l) => l.lat != null && towns.includes(splitArea(l.area).town));
  const mid = pts.length ? { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length } : null;
  const near = same.filter((l) => (km(mid, l) ?? 0) < 40)
    .sort((a, b) => ki(a) - ki(b) || (km(mid, a) ?? 1e9) - (km(mid, b) ?? 1e9) || byName(a, b));
  if (near.length) return { match: 'near', id: near[0].id };
  const part = inState.filter((l) => {
    const k = courseKey(l.name);
    return k.length >= 5 && keys.some((key) => key.length >= 5 && (k.includes(key) || key.includes(k))) && townMatches(towns, l);
  }).sort((a, b) => courseKey(a.name).length - courseKey(b.name).length || byName(a, b));
  if (part.length) return { match: 'near', id: part[0].id };
  // A closed course, or a row that's only a note ("Gibraltar 9-hole course (Bowral) - note only"), isn't added.
  return closed || /\bnote only\b/i.test(row.name) ? { match: 'unmatched', id: null } : { match: 'new', id: null };
}

// ------------------------------------------------------------------ The region guide

export const slug = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** "NSW & ACT: Illawarra…" → 'NSW/ACT'; "Tasmania" → 'TAS'; "WA and NT" → 'WA/NT'. */
export function guideStates(title) {
  const t = String(title || '');
  const found = [];
  const add = (s) => { if (!found.includes(s)) found.push(s); };
  for (const [re, s] of [[/\bNSW\b|New South Wales/i, 'NSW'], [/\bACT\b/, 'ACT'], [/\bVIC\b|Victoria/i, 'VIC'], [/\bQLD\b|Queensland/i, 'QLD'],
    [/\bSA\b|South Australia/i, 'SA'], [/\bWA\b|Western Australia/i, 'WA'], [/\bTAS\b|Tasmania/i, 'TAS'], [/\bNT\b|Northern Territory/i, 'NT']]) {
    if (re.test(t)) add(s);
  }
  return found;
}

/** The distinctive part of a course name, for spotting it in the guide: "Bermagui Country Club" → "bermagui". */
const mentionKey = (name) => String(name || '').toLowerCase().replace(/\(.*?\)/g, '')
  .replace(/\b(golf|country|club|course|links|gc|cc|resort|the|and|&)\b/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The guide → rows for public.region_guides: general sections (access types, member times, booking platforms and deal
 * sites, an intro) and one per region heading. Each region section lists the dataset's regions it covers (`regions`),
 * worked out from which section mentions that region's courses most — so the AI's region_guide("Hunter Valley")
 * finds "NSW: Hunter, Newcastle, Port Stephens, Central Coast".
 */
export function parseGuide(md, rows = []) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const sections = [];
  let cur = null;
  let inRegions = false;
  const intro = [];
  for (const line of lines) {
    if (/^# /.test(line)) {
      if (/region guides/i.test(line)) inRegions = true;
      cur = null;
      continue;
    }
    if (/^---\s*$/.test(line)) continue;
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      cur = { title: clean(h2[1], 120), inRegions, lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
    else if (!inRegions) intro.push(line);
  }
  const body = (ls) => ls.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  const introText = body(intro);
  if (introText) out.push({ key: 'about', kind: 'general', title: 'About this research', state: null, regions: [], body: introText });
  for (const s of sections) {
    if (s.inRegions) continue;
    if (/access/i.test(s.title)) {
      const i = s.lines.findIndex((l) => /^\*\*Member times/i.test(l.trim()));
      const access = i >= 0 ? s.lines.slice(0, i) : s.lines;
      out.push({ key: 'access-types', kind: 'general', title: s.title, state: null, regions: [], body: body(access) });
      if (i >= 0) {
        let j = i + 1;
        while (j < s.lines.length && s.lines[j].trim() !== '') j++;
        out.push({ key: 'member-times', kind: 'general', title: 'Member times', state: null, regions: [], body: body(s.lines.slice(i, j)) });
        const rest = body(s.lines.slice(j));
        if (rest) out[out.length - 2].body += `\n\n${rest}`;
      }
    } else if (/booking|deal/i.test(s.title)) {
      out.push({ key: 'booking-platforms', kind: 'general', title: s.title, state: null, regions: [], body: body(s.lines) });
    } else {
      out.push({ key: slug(s.title), kind: 'general', title: s.title, state: null, regions: [], body: body(s.lines) });
    }
  }
  const regionSecs = sections.filter((s) => s.inRegions).map((s) => ({
    key: slug(s.title), kind: 'region', title: s.title, states: guideStates(s.title), regions: [], body: body(s.lines),
  }));
  // Which dataset regions does each section cover? Count mentions of the region's course names (and its own name).
  const byRegion = new Map();
  for (const r of rows) {
    if (!r.region) continue;
    const k = `${r.state}|${r.region}`;
    if (!byRegion.has(k)) byRegion.set(k, { region: r.region, state: r.state, names: [] });
    byRegion.get(k).names.push(mentionKey(r.name));
  }
  for (const g of byRegion.values()) {
    let best = null;
    let bestScore = 0;
    for (const s of regionSecs) {
      if (s.states.length && !s.states.includes(g.state)) continue;
      const text = `${s.title}\n${s.body}`.toLowerCase();
      let score = g.names.filter((n) => n.length >= 4 && text.includes(n)).length;
      const words = g.region.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
      score += words.filter((w) => s.title.toLowerCase().includes(w)).length * 3;
      score += words.filter((w) => text.includes(w)).length * 0.5;
      if (score > bestScore) { best = s; bestScore = score; }
    }
    if (!best) best = regionSecs.find((s) => s.states.includes(g.state)) || null;
    if (best && !best.regions.includes(g.region)) best.regions.push(g.region);
  }
  regionSecs.forEach((s, i) => out.push({ key: s.key, kind: 'region', title: s.title, state: s.states.join('/') || null, regions: s.regions.sort(), body: s.body, sort: 100 + i }));
  return out.map((g, i) => ({ sort: i, ...g }));
}

/** The whole payload, ready to send in chunks. */
export function buildPayload(csvText, mdText) {
  const parsed = toPayloadRows(parseCsv(csvText));
  return { rows: parsed.rows, skipped: parsed.skipped, guides: parseGuide(mdText, parsed.rows) };
}
