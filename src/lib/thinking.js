// What the "AI is working" line says after `secs` seconds (see components/Thinking.jsx).
export const PLAN_STEPS = ['Reading what you asked', 'Looking at regions and courses', 'Checking weekends and drive times',
  'Weighing up places to stay', 'Putting the options together'];

export function thinkingLine(secs, steps = PLAN_STEPS) {
  const s = Math.max(0, Number(secs) || 0);
  if (s >= 60) return 'Still going — nearly there. If nothing shows soon, try again.';
  if (s >= 25) return 'Still working — a full plan can take up to a minute…';
  const list = steps && steps.length ? steps : PLAN_STEPS;
  return `${list[Math.min(list.length - 1, Math.floor(s / 5))]}…`;
}
