// ov34 — open the "⛳ Put a round out" sheet from anywhere: openCallout({ text, date, place }). components/CalloutHost.jsx
// (rendered once in App.jsx) listens. Kept tiny so Home, Trips, the Feed and the Caddie can import it cheaply.
export const CALLOUT_EVENT = 'callout:open';
export function openCallout(prefill = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CALLOUT_EVENT, { detail: prefill || {} }));
}
