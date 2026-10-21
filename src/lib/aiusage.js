// AI helper usage on Josh's Wishes screen (migration 065, admin_ai_usage): the small pure bits that turn the
// numbers into words. "Do people want it?" — requests a week, groups using it, 👍/👎, cap hits, errors, tokens.

export const AREA_NAMES = {
  ask: 'Questions (Ask)',
  setup: 'Set it up for me',
  plan: 'Plan it with AI',
  apply: 'Do it (setup)',
  plan_apply: 'Create it (plan)',
};
export const areaName = (a) => AREA_NAMES[a] || String(a || 'Other');

const ERROR_NAMES = {
  capped: 'Hit the limit',
  provider_busy: 'AI busy or down',
  provider_key: 'Key not working',
  provider_credit: 'Out of credit',
  provider_model: 'Model not found',
  provider_refused: 'AI refused the request',
  bad_json: 'Muddled reply (bad JSON)',
  no_answer: 'No answer',
  too_many_rounds: 'Gave up (too many steps)',
  timeout: 'Too slow',
  network: 'Couldn’t reach the AI',
  odd_reply: 'Odd reply',
  crash: 'Helper crashed',
  apply_refused: '“Do it” refused',
};
export const errorLabel = (code) => ERROR_NAMES[code] || String(code || 'Other');

/** % of ratings that were 👍, or null when nobody has rated yet. */
export function upShare(up, down) {
  const u = Number(up) || 0;
  const d = Number(down) || 0;
  return u + d ? Math.round((100 * u) / (u + d)) : null;
}

/** "12,400" → "12.4k"; small numbers as they are. */
export function tokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-19" → "19 Oct" (the Monday the week starts). */
export function weekLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : '—';
}

/** Weekly table: one row a week (newest first) with a count per area and the total; and the areas that appear. */
export function weekRows(weeks = [], limit = 12) {
  const by = new Map();
  const areas = new Set();
  for (const w of weeks || []) {
    if (!w?.week) continue;
    const row = by.get(w.week) || { week: w.week, label: weekLabel(w.week), total: 0, byArea: {} };
    const n = Number(w.requests) || 0;
    row.byArea[w.area] = (row.byArea[w.area] || 0) + n;
    row.total += n;
    areas.add(w.area);
    by.set(w.week, row);
  }
  const order = Object.keys(AREA_NAMES);
  return {
    rows: [...by.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, limit),
    areas: [...areas].sort((a, b) => (order.indexOf(a) + 99 * (order.indexOf(a) < 0)) - (order.indexOf(b) + 99 * (order.indexOf(b) < 0))),
  };
}
