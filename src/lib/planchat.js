// "✨ Plan it with AI" as a conversation (22 Oct, Josh): the helper replies with its current draft — a SHORTLIST of
// options (places with their courses, weekends, rough costs, extras) — and 1–3 short questions with tappable quick
// answers ("These are the places I'd look at — any others?" [Looks good] [Add another…]). The organiser answers by
// tapping or typing; the draft updates each turn with what changed highlighted. The AI suggests, the organiser
// chooses: nothing is ever narrowed to one answer for them. Pure functions, tested (planchat.test.js). The chat UI
// itself (components/AiChat.jsx) is reusable by the Caddie later.

import { startExtras, planningExtras } from './extras.js';

export const MAX_TURNS = 10;     // questions per planning chat (each one counts as one helper question)
export const KEEP_TURNS = 12;    // what's sent back to the helper each time (the last 12 messages)
export const MAX_QUICK = 4;
export const STORE_PREFIX = 'tgt-planchat:';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const placeKey = (p) => `place:${norm(p.label ?? p.place)}`;
const dateKey = (d) => `date:${d.start_date}`;

/** Everything in a draft that can change, as key → a fingerprint. */
function prints(draft) {
  const out = {};
  if (!draft) return out;
  out.name = norm(draft.name);
  out.budget = String(draft.budget_pp ?? '');
  for (const p of draft.places || []) out[placeKey(p)] = JSON.stringify([norm(p.label), p.cost_pp ?? null, (p.courses || []).join(','), norm(p.notes), (p.stays || []).join(',')]);
  for (const d of draft.dates || []) out[dateKey(d)] = `${d.start_date}|${d.end_date}|${norm(d.note)}`;
  for (const c of draft.costs || []) out[`cost:${norm(c.item)}`] = String(c.each);
  for (const e of draft.extras || []) out[`extra:${norm(e.label ?? e)}`] = String(e.pp ?? '');
  return out;
}

/**
 * What changed between two drafts: { added: [keys], changed: [keys], removed: [keys] }. Keys look like
 * 'place:mudgee', 'date:2027-03-13', 'cost:golf', 'extra:shirts or caps', 'name', 'budget'. No previous draft →
 * nothing is "new" (the first draft isn't highlighted all over).
 */
export function diffDraft(prev, next) {
  const out = { added: [], changed: [], removed: [] };
  if (!prev || !next) return out;
  const a = prints(prev); const b = prints(next);
  for (const k of Object.keys(b)) {
    if (!(k in a)) out.added.push(k);
    else if (a[k] !== b[k]) out.changed.push(k);
  }
  for (const k of Object.keys(a)) if (!(k in b)) out.removed.push(k);
  return out;
}
/** 'new' | 'changed' | '' for one thing on the draft card. */
export function markFor(diff, kind, item) {
  const k = kind === 'place' ? placeKey(item) : kind === 'date' ? dateKey(item) : kind === 'cost' ? `cost:${norm(item.item)}` : kind === 'extra' ? `extra:${norm(item.label ?? item)}` : kind;
  if (diff?.added?.includes(k)) return 'new';
  if (diff?.changed?.includes(k)) return 'changed';
  return '';
}
/** Names of what was taken off ("Port Stephens"), for a "Taken off: …" line. */
export function removedNames(diff, prev) {
  if (!diff?.removed?.length || !prev) return [];
  const out = [];
  for (const p of prev.places || []) if (diff.removed.includes(placeKey(p))) out.push(p.label);
  for (const d of prev.dates || []) if (diff.removed.includes(dateKey(d))) out.push(d.label || d.start_date);
  return out;
}

/**
 * A quick answer tapped. One ending in "…" ("Add another…", "Different dates…") opens the box to type, started with
 * the question's context; anything else is sent as it is, with the question so the helper knows what it answers.
 * → { send: 'text' } | { ask: 'prefix' }
 */
export function quickChoice(question, quick) {
  const q = String(quick || '').trim();
  const about = String(question?.text || '').trim();
  if (/(…|\.\.\.)$/.test(q)) return { ask: `${q.replace(/(…|\.\.\.)$/, '').trim()}: ` };
  return { send: about ? `${about} → ${q}` : q };
}

/** The questions as the screen shows them (capped; quick answers trimmed and capped). */
export function cleanQuestions(list) {
  return (Array.isArray(list) ? list : []).slice(0, 3).map((q, i) => ({
    id: String(q?.id || `q${i + 1}`).slice(0, 30),
    text: String(q?.text || '').slice(0, 160),
    quick: (Array.isArray(q?.quick) ? q.quick : []).map((x) => String(x).slice(0, 30)).filter(Boolean).slice(0, MAX_QUICK),
    // ov22: the helper says when several answers make sense together (regions, extras, weekends…).
    ...(q?.multi === true ? { multi: true } : {}),
  })).filter((q) => q.text);
}

// ------------------------------------------------------------------ pick several, then send (ov22, Josh 23 Oct)
// "When Plan the trip has multiple pre-filled options you can select, allow the selection of multiple, then click
// submit." A question with multi: true has toggle chips and a "Send (3)" button; one-answer questions still send on tap.
/** A quick answer that opens the box to type ("Other…") rather than being picked. */
export const typesIt = (quick) => /(…|\.\.\.)$/.test(String(quick || '').trim());
/** Tap a chip on a pick-several question: on → off, off → on (in the order they were picked). */
export function togglePick(picks = [], quick) {
  const q = String(quick || '').trim();
  if (!q || typesIt(q)) return picks;
  return picks.includes(q) ? picks.filter((x) => x !== q) : [...picks, q];
}
/** "Send (3)": the picks, sent together → { send } (null with nothing picked). */
export function multiSend(question, picks = []) {
  const list = (picks || []).map((x) => String(x).trim()).filter((x) => x && !typesIt(x));
  if (!list.length) return null;
  const about = String(question?.text || '').trim();
  const words = list.join(', ');
  return { send: about ? `${about} → ${words}` : words };
}
/** "Other…" on a pick-several question: the box opens with what's picked so far, ready to add to. */
export function multiOther(question, picks = [], quick = 'Other…') {
  const list = (picks || []).filter((x) => x && !typesIt(x));
  if (!list.length) return quickChoice(question, quick);
  const about = String(question?.text || '').trim();
  return { ask: `${about ? `${about} → ` : ''}${list.join(', ')}, ` };
}

/** How many questions are left in this chat. */
export const turnsLeft = (turns) => Math.max(0, MAX_TURNS - (turns || []).filter((t) => t.role === 'user').length);

/** The request for one turn: the latest words, the conversation so far (slimmed) and the current draft. */
export function chatBody(turns, draft, text, page = null) {
  const messages = (turns || []).slice(-KEEP_TURNS).map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', text: String(t.text || '').slice(0, 600) }));
  return { mode: 'plan_chat', text: String(text || '').trim().slice(0, 600), messages, ...(draft ? { draft } : {}), ...(page ? { page } : {}) };
}

/** Under every helper reply (Josh, 22 Oct): you can stop the questions any time — and "plan it" does just that. */
export const PLAN_IT_HINT = 'Or just say “plan it” and I’ll put a plan together now.';
export const PLAN_IT = 'Plan it';

// ------------------------------------------------------------------ the trip screen filling in as you chat (ov16)
// "Plan it with AI" lives in the Caddie: once there's a draft, a draft trip is made and the trip builder opens beside
// (laptop) or under (phone) the chat. Each turn the helper's draft is written into the builder's saved state as ✨
// suggestions; what the organiser kept, added or removed on the page stays theirs. Before each turn, what the page
// shows is sent back to the helper (pageFromBuild) so it sees their changes.

/** Library course id → name, from the draft's places (address is the names joined " + ", in the same order). */
export function courseNamesFromDraft(draft) {
  const out = {};
  for (const p of draft?.places || []) {
    const names = String(p.address || '').split(' + ');
    (p.courses || []).forEach((id, i) => { if (names[i]) out[id] = names[i]; });
  }
  return out;
}

/** "Bus" and "Bus or transfers" are the same extra (the helper's words are looser than the list's). */
export function sameExtra(a, b) {
  const x = String(a || '').trim().toLowerCase(); const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x) || x.split(/[^a-z]+/)[0] === y.split(/[^a-z]+/)[0];
}

/**
 * The builder's state with a new AI draft written in. `prev` is the saved state (or null for a new build). The
 * helper's earlier suggestions (prev.ai) that the organiser hasn't kept are replaced by the new ones; anything the
 * organiser added or kept stays. The chosen area, stays, days, votes, nights… are never touched.
 */
export function mergeDraftIntoBuild(prev, draft, stayAreas = [], { nights = 2 } = {}) {
  const start = builderStateFromDraft(draft, stayAreas, { nights });
  const tick = (labels) => (labels.length ? startExtras().map((e) => (labels.some((l) => sameExtra(l, e.label)) ? { ...e, suggested: true } : e)) : null);
  // How many are coming (ov23): the helper's number, unless the organiser has set their own.
  const hc = Number.isInteger(draft?.headcount) && draft.headcount > 0 && draft.headcount < 200 && prev?.headcountBy !== 'organiser'
    ? { headcount: draft.headcount, headcountBy: 'ai' } : {};
  if (!prev) {
    const { extrasSuggested, ...rest } = start;
    return { ...rest, ...hc, ...(draft?.travel ? { travel: draft.travel } : {}), extras: tick(extrasSuggested), ai: { regions: start.regionOptions, weekends: start.weekends.map((w) => w.start) } };
  }
  const ai = prev.ai || { regions: [], weekends: [] };
  const sugg = { ...(prev.suggested || {}) };
  // Areas: the organiser's own (never suggested by the helper) stay; the helper's are swapped for its new ones.
  const own = (prev.regionOptions || []).filter((r) => !(ai.regions || []).includes(r));
  const regionOptions = [...new Set([...own, ...start.regionOptions, ...(prev.region ? [prev.region] : [])])].slice(0, Math.max(3, own.length));
  const areaCourses = {};
  const areaStays = { ...(prev.areaStays || {}) };
  for (const r of regionOptions) {
    const before = prev.areaCourses?.[r] || [];
    const kept = before.filter((id) => !sugg[`course:${r}:${id}`]); // ticked in by the organiser (or added by hand)
    for (const id of before) if (sugg[`course:${r}:${id}`] && !(start.areaCourses[r] || []).includes(id)) delete sugg[`course:${r}:${id}`];
    const fresh = (start.areaCourses[r] || []).filter((id) => !kept.includes(id));
    for (const id of fresh) sugg[`course:${r}:${id}`] = true;
    areaCourses[r] = [...kept, ...fresh].slice(0, 10);
    if (!areaStays[r] && start.areaStays[r]) { areaStays[r] = start.areaStays[r]; Object.assign(sugg, Object.fromEntries(Object.keys(start.suggested).filter((k) => k.startsWith(`stay:${r}:`)).map((k) => [k, true]))); }
  }
  // Weekends: once the organiser has settled them, they're theirs. Otherwise their own stay and the helper's update.
  let weekends = prev.weekends || [];
  let aiWeekends = ai.weekends || [];
  if (!prev.weekendsSettled) {
    const mine = weekends.filter((w) => !(ai.weekends || []).includes(w.start));
    weekends = [...mine, ...start.weekends.filter((w) => !mine.some((m) => m.start === w.start))].slice(0, 26); // ov23: any number
    aiWeekends = weekends.filter((w) => !mine.includes(w)).map((w) => w.start);
  }
  // Extras: the list is the organiser's once it exists — the helper's ideas are just marked ✨.
  let extras = planningExtras(prev.extras) ?? tick(start.extrasSuggested);
  if (Array.isArray(prev.extras) && start.extrasSuggested.length) {
    extras = extras.map((e) => (start.extrasSuggested.some((l) => sameExtra(l, e.label)) && e.state === 'off' ? { ...e, suggested: true } : e));
  }
  return {
    ...prev, ...hc, regionOptions, areaCourses, areaStays, suggested: sugg, weekends, extras,
    // Driving or flying (ov16): flying isn't planned yet — it's kept so the trip screen can say so later.
    ...(draft?.travel ? { travel: draft.travel } : {}),
    ai: { regions: start.regionOptions.filter((r) => !own.includes(r)), weekends: aiWeekends },
  };
}

/** What the trip screen shows now, small, for the helper (it goes in as data). names: course id → name. */
export function pageFromBuild(state, names = {}) {
  if (!state) return null;
  const sugg = state.suggested || {};
  const areas = (state.regionOptions || []).slice(0, 4).map((r) => ({
    area: r,
    courses: (state.areaCourses?.[r] || []).slice(0, 10).map((id) => `${names[id] || id}${sugg[`course:${r}:${id}`] ? ' (suggested)' : ''}`),
    stays: (state.areaStays?.[r] || []).slice(0, 6).map((s) => s.name),
  }));
  return {
    areas,
    chosen_area: state.region || null,
    weekends: (state.weekends || []).slice(0, 4).map((w) => (w.end && w.end !== w.start ? `${w.start} to ${w.end}` : w.start)),
    nights: Number.isInteger(state.nights) ? state.nights : null,
    headcount: Number.isInteger(state.headcount) ? state.headcount : null,
    extras: (state.extras || []).filter((e) => e.state && e.state !== 'off').map((e) => e.label),
  };
}

/** The draft as the plan "Use this plan" sends to plan_apply (same shape the plan mode checks). */
export function draftToPlan(draft) {
  if (!draft) return null;
  return {
    name: draft.name, kind: draft.kind || 'trip', ...(draft.travel ? { travel: draft.travel } : {}),
    dates: (draft.dates || []).map((d) => ({ start_date: d.start_date, end_date: d.end_date, note: d.note || '' })),
    places: (draft.places || []).map((p) => ({ place: p.label, courses: p.courses || [], cost_each: p.cost_pp ?? undefined, note: p.notes || '' })),
    jobs: draft.jobs || [], bring: draft.bring || [], costs: draft.costs || [], budget_each: draft.budget_pp ?? undefined, notes: draft.notes || '',
    extras: (draft.extras || []).map((e) => ({ label: e.label, pp: e.pp ?? null })),
  };
}

/**
 * The trip builder's starting state from a chat draft (when the trip builder is on): the places that match a
 * region become area options (with their courses as that area's set, ✨ suggested until the organiser keeps them),
 * the date options become weekends, extras come across to be ticked. Nothing is picked for the organiser.
 * stayAreas: the stay_areas rows ({ name, region, lat, lng }).
 */
export function builderStateFromDraft(draft, stayAreas = [], { nights = 2 } = {}) {
  const regions = [...new Set((stayAreas || []).map((a) => a.region))];
  const regionFor = (label) => {
    const l = norm(label);
    return regions.find((r) => norm(r) === l) || regions.find((r) => norm(r).includes(l) || l.includes(norm(r)))
      || (stayAreas || []).find((a) => norm(a.name) === l || l.includes(norm(a.name)))?.region || null;
  };
  const regionOptions = []; const areaCourses = {}; const areaStays = {}; const suggested = {};
  for (const p of draft?.places || []) {
    const r = regionFor(p.label);
    if (!r || regionOptions.includes(r) || regionOptions.length >= 3) continue;
    regionOptions.push(r);
    areaCourses[r] = (p.courses || []).slice(0, 10);
    for (const id of areaCourses[r]) suggested[`course:${r}:${id}`] = true;
    const town = (stayAreas || []).find((a) => a.region === r && norm(p.label).includes(norm(a.name)));
    if (town) { areaStays[r] = [{ key: town.name, name: town.name, lat: town.lat, lng: town.lng }]; suggested[`stay:${r}:${town.name}`] = true; }
  }
  const weekends = (draft?.dates || []).slice(0, 3).map((d) => ({ start: d.start_date, end: d.end_date || d.start_date, long: false }));
  return {
    regionOptions, region: null, areaCourses, areaStays, suggested, weekends, weekendsSettled: false, nights,
    extrasSuggested: (draft?.extras || []).map((e) => e.label),
  };
}

// ------------------------------------------------------------------ keeping the chat (Josh 22 Oct: "I clicked away and it's lost")
// Kept on this device for a week (localStorage), not just this tab, so leaving the screen, closing the sheet or the
// phone dropping the app doesn't lose it. A question still on its way when you leave is finished in the background
// (see pending below) and its answer is saved, so it's there when you come back.
const WEEK = 7 * 24 * 3600 * 1000;
const store = (s) => { try { return s || (typeof localStorage !== 'undefined' ? localStorage : null); } catch { return null; } };
/** The planning chat for this group on this device: { turns, draft, savedAt } or null (none, or older than a week). */
export function loadChat(groupId, s, now = Date.now()) {
  const st = store(s);
  if (!st || !groupId) return null;
  try {
    const v = JSON.parse(st.getItem(STORE_PREFIX + groupId) || 'null');
    if (!v || !Array.isArray(v.turns)) return null;
    if (v.savedAt != null && now - v.savedAt > WEEK) return null;
    return { turns: v.turns.slice(-30), draft: v.draft || null, savedAt: v.savedAt || null, planId: typeof v.planId === 'string' ? v.planId : null };
  } catch { return null; }
}
export function saveChat(groupId, chat, s, now = Date.now()) {
  const st = store(s);
  if (!st || !groupId) return;
  const turns = (chat?.turns || []).slice(-30);
  try {
    if (!turns.length && !chat?.draft) { st.removeItem(STORE_PREFIX + groupId); return; }
    // planId (ov16): the draft trip the chat is filling in on the trip builder.
    st.setItem(STORE_PREFIX + groupId, JSON.stringify({ turns, draft: chat?.draft || null, savedAt: now, ...(chat?.planId ? { planId: chat.planId } : {}) }));
  } catch { /* fine */ }
}
export function clearChat(groupId, s) {
  const st = store(s);
  try { st?.removeItem(STORE_PREFIX + groupId); } catch { /* fine */ }
}
/** How many messages a saved chat has (for "Carry on your plan"). */
export function chatSize(chat) { return (chat?.turns || []).length; }

/** Questions still on their way, by group: { promise, before, mine } — lives as long as the app is open. */
export const pending = new Map();
