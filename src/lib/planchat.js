// "✨ Plan it with AI" as a conversation (22 Oct, Josh): the helper replies with its current draft — a SHORTLIST of
// options (places with their courses, weekends, rough costs, extras) — and 1–3 short questions with tappable quick
// answers ("These are the places I'd look at — any others?" [Looks good] [Add another…]). The organiser answers by
// tapping or typing; the draft updates each turn with what changed highlighted. The AI suggests, the organiser
// chooses: nothing is ever narrowed to one answer for them. Pure functions, tested (planchat.test.js). The chat UI
// itself (components/AiChat.jsx) is reusable by the Caddie later.

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
  })).filter((q) => q.text);
}

/** How many questions are left in this chat. */
export const turnsLeft = (turns) => Math.max(0, MAX_TURNS - (turns || []).filter((t) => t.role === 'user').length);

/** The request for one turn: the latest words, the conversation so far (slimmed) and the current draft. */
export function chatBody(turns, draft, text) {
  const messages = (turns || []).slice(-KEEP_TURNS).map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', text: String(t.text || '').slice(0, 600) }));
  return { mode: 'plan_chat', text: String(text || '').trim().slice(0, 600), messages, ...(draft ? { draft } : {}) };
}

/** The draft as the plan "Use this plan" sends to plan_apply (same shape the plan mode checks). */
export function draftToPlan(draft) {
  if (!draft) return null;
  return {
    name: draft.name, kind: draft.kind || 'trip',
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
    return { turns: v.turns.slice(-30), draft: v.draft || null, savedAt: v.savedAt || null };
  } catch { return null; }
}
export function saveChat(groupId, chat, s, now = Date.now()) {
  const st = store(s);
  if (!st || !groupId) return;
  const turns = (chat?.turns || []).slice(-30);
  try {
    if (!turns.length && !chat?.draft) { st.removeItem(STORE_PREFIX + groupId); return; }
    st.setItem(STORE_PREFIX + groupId, JSON.stringify({ turns, draft: chat?.draft || null, savedAt: now }));
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
