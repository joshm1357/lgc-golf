// The A/B model test's results on Josh's Wishes screen (AI helper tab; migration 075, admin_ai_abtest).
// Pure maths and words: the verdict is worked out here in code — never by the AI.
//
// The verdict: compare the share of 👍 among rated answers for model A and model B with a two-proportion z-test.
// It only speaks once each model has at least 30 rated answers; "95% sure" means |z| ≥ 1.96.
import { reasonLabel, REASONS } from './feedback.js';

export const MIN_RATED = 30;
export const Z95 = 1.96;

/** Two-proportion z-test: z > 0 means B's 👍 share is higher. Null when it can't be worked out. */
export function twoPropZ(upA, nA, upB, nB) {
  const a = Number(nA) || 0;
  const b = Number(nB) || 0;
  if (!a || !b) return null;
  const pA = (Number(upA) || 0) / a;
  const pB = (Number(upB) || 0) / b;
  const p = ((Number(upA) || 0) + (Number(upB) || 0)) / (a + b);
  const se = Math.sqrt(p * (1 - p) * (1 / a + 1 / b));
  return { pA, pB, z: se > 0 ? (pB - pA) / se : 0 };
}

/** The plain-words verdict from each model's 👍 and 👎 counts. */
export function abVerdict(A, B) {
  const upA = Number(A?.up) || 0;
  const upB = Number(B?.up) || 0;
  const nA = upA + (Number(A?.down) || 0);
  const nB = upB + (Number(B?.down) || 0);
  const n = nA + nB;
  if (nA < MIN_RATED || nB < MIN_RATED) {
    return { kind: 'wait', z: null, text: `Not enough ratings yet — keep going (${n} rated so far; needs ${MIN_RATED} on each: A ${nA}, B ${nB})` };
  }
  const t = twoPropZ(upA, nA, upB, nB);
  if (t && t.z >= Z95) return { kind: 'B', z: t.z, text: 'B is better (95% sure)' };
  if (t && t.z <= -Z95) return { kind: 'A', z: t.z, text: 'A is better (95% sure)' };
  return { kind: 'same', z: t ? t.z : 0, text: `Not enough difference yet — keep going (${n} rated so far)` };
}

const pct = (a, b) => (Number(b) ? Math.round((100 * (Number(a) || 0)) / Number(b)) : null);

/** "1.2 s" from milliseconds. */
export const secs = (ms) => (ms == null || ms === '' || !Number.isFinite(Number(ms)) ? '—' : `${(Number(ms) / 1000).toFixed(1)} s`);

/** "US$0.42" (or "<US$0.01"); null when there's no cost. */
export function money(cost) {
  if (cost == null || cost === '') return null;
  const v = Number(cost);
  if (!Number.isFinite(v)) return null;
  if (v > 0 && v < 0.01) return '<US$0.01';
  return `US$${v.toFixed(2)}`;
}

/** 👎 reasons as "Wrong 3 · Too slow 1", most first (the chips' order on ties). */
export function reasonsLine(reasons) {
  const order = REASONS.map((r) => r.key);
  const rows = Object.entries(reasons || {}).filter(([, n]) => Number(n) > 0);
  rows.sort((x, y) => Number(y[1]) - Number(x[1]) || order.indexOf(x[0]) - order.indexOf(y[0]));
  return rows.length ? rows.map(([k, n]) => `${reasonLabel(k)} ${n}`).join(' · ') : '—';
}

/** One variant's numbers, ready to show. */
export function variantRow(v) {
  if (!v) return null;
  const up = Number(v.up) || 0;
  const down = Number(v.down) || 0;
  const rated = up + down;
  const q = Number(v.questions) || 0;
  const models = (v.models || []).map((m) => m.model).filter(Boolean);
  return {
    variant: v.variant,
    model: models[0] || '?',
    otherModels: models.slice(1),
    questions: q,
    people: Number(v.people) || 0,
    up, down, rated,
    upShare: pct(up, rated),
    reasons: reasonsLine(v.reasons),
    failed: Number(v.failed) || 0,
    errorRate: pct(v.failed, q),
    fallbacks: Number(v.fallbacks) || 0,
    median: secs(v.median_ms),
    tokensIn: Number(v.tokens_in) || 0,
    tokensOut: Number(v.tokens_out) || 0,
    cost: money(v.cost),
  };
}

/** The latest test from admin_ai_abtest: { name, A, B, verdict, running } (null when there's no test data). */
export function abView(data) {
  const t = (data?.tests || [])[0];
  if (!t) return null;
  const by = Object.fromEntries((t.variants || []).map((v) => [v.variant, v]));
  const A = variantRow(by.A);
  const B = variantRow(by.B);
  return { name: t.ab_test || '—', A, B, running: !!(A && B), verdict: A && B ? abVerdict(by.A, by.B) : null };
}
